const { getStore } = require("@netlify/blobs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

function signToken(payload) {
  return jwt.sign(payload, process.env.SESSION_SECRET, { expiresIn: "30d" });
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return { statusCode: 400, headers: cors, body: "Bad request" };

  try {
    const { username, password } = JSON.parse(event.body || "{}");
    if (!username || !password) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false }) };
    }
    const uname = username.trim().toLowerCase();

    // Admin login uses the shared APP_PASSWORD env var.
    if (uname === "admin") {
      if (password === process.env.APP_PASSWORD) {
        const token = signToken({ username: "admin", name: "Admin", isAdmin: true });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, token, name: "Admin", isAdmin: true }) };
      }
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false }) };
    }

    // Regular technician login - looked up in the users store.
    const usersStore = getStore({
      name: "ucs-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN,
    });
    const userRaw = await usersStore.get(uname);
    if (!userRaw) return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false }) };
    const user = JSON.parse(userRaw);
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false }) };

    const token = signToken({ username: uname, name: user.name, isAdmin: false });
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, token, name: user.name, isAdmin: false }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: String(err) };
  }
};

const { getStore } = require("@netlify/blobs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

function requireAdmin(event) {
  const token = event.headers["x-app-token"] || event.headers["X-App-Token"];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    return decoded.isAdmin ? decoded : null;
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  const admin = requireAdmin(event);
  if (!admin) return { statusCode: 401, headers: cors, body: "Admin only" };

  const store = getStore({
    name: "ucs-users",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });

  try {
    if (event.httpMethod === "GET") {
      const { blobs } = await store.list();
      const users = await Promise.all(
        blobs.map(async (b) => {
          const u = JSON.parse(await store.get(b.key));
          return { username: b.key, name: u.name };
        })
      );
      return { statusCode: 200, headers: cors, body: JSON.stringify(users) };
    }

    if (event.httpMethod === "POST") {
      const { username, name, password } = JSON.parse(event.body || "{}");
      if (!username || !password) return { statusCode: 400, headers: cors, body: "Missing username or password" };
      const uname = username.trim().toLowerCase();
      if (uname === "admin") return { statusCode: 400, headers: cors, body: "That username is reserved" };
      const passwordHash = await bcrypt.hash(password, 10);
      await store.set(uname, JSON.stringify({ name: name || username, passwordHash }));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === "DELETE") {
      const { username } = event.queryStringParameters || {};
      if (!username) return { statusCode: 400, headers: cors, body: "Missing username" };
      await store.delete(username.trim().toLowerCase());
      return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers: cors, body: "Bad request" };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: String(err) };
  }
};

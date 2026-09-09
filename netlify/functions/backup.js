const { getStore } = require("@netlify/blobs");
const jwt = require("jsonwebtoken");

function checkAuth(event) {
  const token = event.headers["x-app-token"] || event.headers["X-App-Token"];
  if (!token) return false;
  try { jwt.verify(token, process.env.SESSION_SECRET); return true; }
  catch { return false; }
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: process.env.GOOGLE_SA_EMAIL,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const privateKey = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const assertion = jwt.sign(payload, privateKey, { algorithm: "RS256" });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Google auth failed: " + JSON.stringify(data));
  return data.access_token;
}

async function createFolder(token, name, parentId) {
  const body = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) body.parents = [parentId];
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.id) throw new Error("Folder create failed: " + JSON.stringify(data));
  return data;
}

async function uploadFile(token, name, mimeType, buffer, parentId) {
  const boundary = "ucsbnd" + Date.now();
  const metadata = JSON.stringify({ name, parents: [parentId] });
  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
  return res.json();
}

async function sharePermission(token, fileId, email) {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "writer", type: "user", emailAddress: email }),
  });
}

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-App-Token",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (!checkAuth(event)) return { statusCode: 401, headers: cors, body: "Unauthorized" };

  const { jobId } = event.queryStringParameters || {};
  if (!jobId) return { statusCode: 400, headers: cors, body: "Missing jobId" };

  try {
    const creds = { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN };
    const jobStore = getStore({ name: "ucs-jobs", ...creds });
    const photoStore = getStore({ name: "ucs-photos", ...creds });

    const jobRaw = await jobStore.get(jobId);
    if (!jobRaw) return { statusCode: 404, headers: cors, body: "Job not found" };
    const job = JSON.parse(jobRaw);

    const accessToken = await getAccessToken();
    const parentId = process.env.GOOGLE_DRIVE_FOLDER_ID || undefined;
    const folderName = `${job.customer || job.licensePlate || jobId} - ${jobId}`;
    const folder = await createFolder(accessToken, folderName, parentId);

    await uploadFile(
      accessToken,
      "job-info.json",
      "application/json",
      Buffer.from(JSON.stringify(job, null, 2)),
      folder.id
    );

    const photoEntries = [];
    const vp = job.vehiclePhotos || {};
    if (vp.vin) photoEntries.push(["VIN Door Jamb.jpg", vp.vin]);
    if (vp.plate) photoEntries.push(["License Plate.jpg", vp.plate]);
    if (vp.side) photoEntries.push(["Vehicle Side.jpg", vp.side]);
    (job.before?.photoKeys || []).forEach((k, i) => { if (k) photoEntries.push([`Before - Analyzer ${i + 1}.jpg`, k]); });
    (job.after?.photoKeys || []).forEach((k, i) => { if (k) photoEntries.push([`After - Analyzer ${i + 1}.jpg`, k]); });

    for (const [name, key] of photoEntries) {
      const data = await photoStore.get(key, { type: "arrayBuffer" });
      if (data) await uploadFile(accessToken, name, "image/jpeg", Buffer.from(data), folder.id);
    }

    if (process.env.GOOGLE_SHARE_EMAIL) {
      await sharePermission(accessToken, folder.id, process.env.GOOGLE_SHARE_EMAIL);
    }

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({
        ok: true,
        folderUrl: `https://drive.google.com/drive/folders/${folder.id}`,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: String(err) };
  }
};

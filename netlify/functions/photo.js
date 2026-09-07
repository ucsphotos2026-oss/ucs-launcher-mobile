const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const creds = { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN };
  const photoStore = getStore({ name: "ucs-photos", ...creds });
  const jobStore = getStore({ name: "ucs-jobs", ...creds });
  const { jobId, stage, slot, key } = event.queryStringParameters || {};
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  try {
    if (event.httpMethod === "GET" && key) {
      const data = await photoStore.get(key, { type: "arrayBuffer" });
      if (!data) return { statusCode: 404, headers: cors, body: "Not found" };
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "image/jpeg" },
        body: Buffer.from(data).toString("base64"),
        isBase64Encoded: true,
      };
    }

    if (event.httpMethod === "POST" && jobId && stage && slot !== undefined) {
      const { image } = JSON.parse(event.body);
      const base64 = image.includes(",") ? image.split(",")[1] : image;
      const buffer = Buffer.from(base64, "base64");
      const photoKey = `${jobId}_${stage}_${slot}_${Date.now()}.jpg`;
      await photoStore.set(photoKey, buffer);

      const jobRaw = await jobStore.get(jobId);
      if (jobRaw) {
        const job = JSON.parse(jobRaw);

        if (stage === "vehicle") {
          if (!job.vehiclePhotos) job.vehiclePhotos = { vin: null, plate: null, side: null };
          job.vehiclePhotos[slot] = photoKey;
        } else {
          const slotIdx = parseInt(slot, 10);
          if (!Array.isArray(job[stage].photoKeys)) {
            job[stage].photoKeys = [job[stage].photoKey || null, null, null];
          }
          job[stage].photoKeys[slotIdx] = photoKey;
          job[stage].savedAt = new Date().toISOString();
        }

        await jobStore.set(jobId, JSON.stringify(job));
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({ photoKey }) };
    }

    return { statusCode: 400, headers: cors, body: "Bad request" };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: String(err) };
  }
};

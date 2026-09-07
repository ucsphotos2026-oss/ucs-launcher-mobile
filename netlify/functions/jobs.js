const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const store = getStore({
    name: "ucs-jobs",
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_AUTH_TOKEN,
  });
  const { id } = event.queryStringParameters || {};
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };

  try {
    if (event.httpMethod === "GET" && !id) {
      const { blobs } = await store.list();
      const jobs = await Promise.all(
        blobs.map(async (b) => JSON.parse(await store.get(b.key)))
      );
      jobs.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return { statusCode: 200, headers: cors, body: JSON.stringify(jobs) };
    }

    if (event.httpMethod === "GET" && id) {
      const job = await store.get(id);
      if (!job) return { statusCode: 404, headers: cors, body: "Not found" };
      return { statusCode: 200, headers: cors, body: job };
    }

    if (event.httpMethod === "POST") {
      const data = JSON.parse(event.body);
      const jobId = `job_${Date.now()}`;
      const job = {
        id: jobId,
        customer: data.customer || "",
        licensePlate: data.licensePlate || "",
        mileage: data.mileage || "",
        make: data.make || "",
        model: data.model || "",
        engine: data.engine || "",
        vin: data.vin || "",
        createdAt: new Date().toISOString(),
        vehiclePhotos: { vin: null, plate: null, side: null },
        before: { co: "", co2: "", o2: "", photoKeys: [null, null, null], savedAt: null },
        after: { co: "", co2: "", o2: "", photoKeys: [null, null, null], savedAt: null },
      };
      await store.set(jobId, JSON.stringify(job));
      return { statusCode: 200, headers: cors, body: JSON.stringify(job) };
    }

    if (event.httpMethod === "PUT" && id) {
      const existingRaw = await store.get(id);
      if (!existingRaw) return { statusCode: 404, headers: cors, body: "Not found" };
      const existing = JSON.parse(existingRaw);
      const updates = JSON.parse(event.body);
      const merged = { ...existing, ...updates };
      await store.set(id, JSON.stringify(merged));
      return { statusCode: 200, headers: cors, body: JSON.stringify(merged) };
    }

    if (event.httpMethod === "DELETE" && id) {
      await store.delete(id);
      return { statusCode: 200, headers: cors, body: "deleted" };
    }

    return { statusCode: 400, headers: cors, body: "Bad request" };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: String(err) };
  }
};

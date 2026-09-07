const { getStore } = require("@netlify/blobs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const DISCLAIMER_TEXT =
  "USA Carbon Solutions provides hydrogen-based engine carbon cleaning services designed to help reduce existing carbon buildup " +
  "and support improved combustion and airflow. Results may vary based on engine design, mileage, maintenance history, fuel quality, " +
  "and operating conditions.\n\n" +
  "This service does not damage engines, remove metal, alter engine timing, replace mechanical stress, or create new mechanical or " +
  "electronic faults. The process is non-invasive, performed without disassembly, and does not involve chemical additives.\n\n" +
  "Carbon removal may improve combustion efficiency and restore airflow within the engine. In some cases, the removal of carbon buildup " +
  "may reveal pre-existing mechanical, fuel, ignition, vacuum, or emissions-related conditions that were previously masked by deposits. " +
  "These conditions are not caused by the carbon cleaning service.\n\n" +
  "This service is not a repair and is not a substitute for manufacturer-recommended maintenance, diagnostics, or mechanical service. " +
  "USA Carbon Solutions does not guarantee fuel economy improvements, emissions compliance, or the correction of underlying mechanical issues.";

const COMPLIANCE_TEXT =
  "This report reflects measured tailpipe readings from a portable emissions analyzer and is provided for informational and " +
  "diagnostic purposes only. This service does not modify, remove, or replace factory-installed emissions control components " +
  "and is not a substitute for an official California smog inspection. Official compliance is determined through state-certified " +
  "smog inspection procedures.";

const WHAT_WE_DID_TEXT =
  "USA Carbon Solutions performed a hydrogen-based engine carbon cleaning service on your vehicle. This non-invasive process " +
  "introduced controlled hydrogen through the engine's air intake, loosening and removing carbon deposits from combustion " +
  "chambers, intake valves, and the exhaust pathway - without chemicals, disassembly, or vehicle downtime.";

const RELEARNING_TEXT =
  "Modern vehicles use an onboard computer (ECU) that constantly adjusts fuel delivery, air/fuel mixture, and ignition timing " +
  "based on real-time sensor feedback. During this service, carbon deposits were removed from key engine areas, which can " +
  "temporarily change how the engine breathes and burns fuel. As a result, the ECU may require a short period of normal " +
  "driving to recalibrate and optimize these settings.\n\n" +
  "What to expect during the relearning phase:\n" +
  "- Temporary fluctuations in emissions readings immediately after service.\n" +
  "- Gradual stabilization over the next 50-150 miles of normal driving.\n" +
  "- Improved combustion efficiency as the system adapts to cleaner internal conditions.\n" +
  "- Possible changes in idle quality or throttle response during this window - this is normal.";

const TIPS = [
  "For best results, we recommend Top Tier gasoline, with a preference for major brands such as Shell and Chevron. When compatible with your vehicle, mid- to high-octane fuel (91 or higher) may help support smoother combustion.",
  "Avoid excessive short trips. Short drives that never fully warm the engine up create conditions where carbon reaccumulates faster. Highway driving helps keep combustion surfaces clean between service visits.",
  "Stay current on oil changes. Clean oil reduces internal carbon deposits and supports efficient combustion.",
  "Consider a follow-up cleaning in 12 months to maintain today's results and protect against deposit-related wear over time.",
  "Allow ECU relearning. Drive the vehicle normally over the next several days so the engine computer can fully adapt.",
];

const GAS_META = {
  co:  { label: "CO",  unit: " ppm", max: 10000 },
  co2: { label: "CO2", unit: "%", max: 15 },
  o2:  { label: "O2",  unit: "%", max: 21 },
};

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function pctChange(before, after) {
  const b = num(before), a = num(after);
  if (b === null || a === null || b === 0) return null;
  return ((a - b) / b) * 100;
}

function fmtPct(pct) {
  if (pct === null) return "n/a";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function wrapText(text, font, size, maxWidth) {
  const paragraphs = text.split("\n");
  const lines = [];
  for (const para of paragraphs) {
    if (para === "") { lines.push(""); continue; }
    const words = para.split(" ");
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function coMeaning(pct) {
  if (pct === null) return "No comparable data.";
  if (pct <= -20) return "CO significantly reduced - efficient combustion observed.";
  if (pct < 0) return "CO reduced - combustion trending more efficient.";
  return "CO increased - worth monitoring on the next visit.";
}
function co2Meaning(pct) {
  if (pct === null) return "No comparable data.";
  if (pct >= 0) return "CO2 stable or higher - consistent with more complete combustion.";
  return "CO2 decreased - may reflect a leaner mixture during ECU relearning.";
}
function o2Meaning(pct) {
  if (pct === null) return "No comparable data.";
  if (pct > 0) return "O2 elevated - reflects air/fuel adjustment as the ECU recalibrates.";
  return "O2 decreased - richer mixture indicated.";
}

exports.handler = async (event) => {
  const creds = { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN };
  const jobStore = getStore({ name: "ucs-jobs", ...creds });
  const photoStore = getStore({ name: "ucs-photos", ...creds });
  const { jobId } = event.queryStringParameters || {};
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (!jobId) return { statusCode: 400, headers: cors, body: "Missing jobId" };

  try {
    const jobRaw = await jobStore.get(jobId);
    if (!jobRaw) return { statusCode: 404, headers: cors, body: "Job not found" };
    const job = JSON.parse(jobRaw);

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    const pageW = 612, pageH = 792, margin = 50;

    const navy = rgb(0.06, 0.12, 0.3);
    const green = rgb(0.1, 0.55, 0.2);
    const grayText = rgb(0.35, 0.35, 0.35);
    const lightLine = rgb(0.82, 0.82, 0.82);

    let page, y;
    const newPage = () => { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; return page; };
    const ensureSpace = (needed) => { if (y - needed < margin) newPage(); };
    const drawText = (text, x, yy, size, opts = {}) => {
      page.drawText(text, { x, y: yy, size, font: opts.bold ? fontBold : (opts.italic ? fontItalic : font), color: opts.color || rgb(0.08, 0.1, 0.12) });
    };
    const drawWrapped = (text, size, opts = {}) => {
      const f = opts.bold ? fontBold : font;
      const lines = wrapText(text, f, size, pageW - margin * 2);
      for (const line of lines) {
        ensureSpace(size + 4);
        drawText(line, margin, y, size, opts);
        y -= (opts.lineHeight || size + 4);
      }
    };

    const embedPhoto = async (photoKey) => {
      if (!photoKey) return null;
      try {
        const data = await photoStore.get(photoKey, { type: "arrayBuffer" });
        if (!data) return null;
        return await pdfDoc.embedJpg(data);
      } catch { return null; }
    };

    // ================= PAGE 1: COVER =================
    newPage();
    let coverImg = null;
    try {
      const base = process.env.URL || process.env.DEPLOY_PRIME_URL || "";
      if (base) {
        const res = await fetch(`${base}/assets/cover.jpg`);
        if (res.ok) coverImg = await pdfDoc.embedJpg(await res.arrayBuffer());
      }
    } catch { coverImg = null; }

    if (coverImg) {
      page.drawImage(coverImg, { x: 0, y: 0, width: pageW, height: pageH });
    } else {
      page.drawRectangle({ x: 0, y: 0, width: pageW, height: pageH, color: rgb(0.94, 0.97, 1) });
      drawText("USA CARBON SOLUTIONS", margin, pageH - 140, 26, { bold: true, color: navy });
      drawText("Emissions & Efficiency Report", margin, pageH - 175, 15, { color: grayText });
      page.drawLine({ start: { x: margin, y: pageH - 195 }, end: { x: pageW - margin, y: pageH - 195 }, thickness: 1.5, color: navy });
    }
    drawText(job.customer || job.licensePlate || "Vehicle Report", margin, 140, 20, { bold: true, color: navy });
    drawText(`Prepared ${(job.createdAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10)}`, margin, 118, 11, { color: grayText });

    // ================= PAGE 2: HEADER + GAUGES (always page 2) =================
    newPage();
    drawText(job.customer || "-", margin, y, 18, { bold: true }); y -= 18;
    drawText("USA Carbon Solutions - Emissions & Efficiency Report", margin, y, 12, { bold: true, color: navy }); y -= 15;
    drawText("Measured Pre- and Post-Service Emissions Analysis", margin, y, 9.5, { color: grayText }); y -= 16;

    const infoLeft = [
      ["VIN", job.vin || "-"],
      ["License Plate", job.licensePlate || "-"],
      ["Make / Model", [job.make, job.model].filter(Boolean).join(" ") || "-"],
      ["Engine", job.engine || "-"],
    ];
    const infoRight = [
      ["Mileage", job.mileage || "-"],
      ["Job ID", job.id || "-"],
      ["Date", (job.createdAt || "").slice(0, 10) || "-"],
    ];
    const infoStartY = y;
    infoLeft.forEach(([label, val], i) => {
      drawText(`${label}:`, margin, infoStartY - i * 13, 9, { bold: true });
      drawText(String(val), margin + 90, infoStartY - i * 13, 9);
    });
    infoRight.forEach(([label, val], i) => {
      drawText(`${label}:`, margin + 300, infoStartY - i * 13, 9, { bold: true });
      drawText(String(val), margin + 370, infoStartY - i * 13, 9);
    });
    y -= infoLeft.length * 13 + 14;

    // What We Found callout
    const calloutTop = y;
    drawText("WHAT WE FOUND", margin + 10, y - 13, 8.5, { bold: true, color: navy });
    drawText("This report captures a before and after emissions snapshot taken", margin + 10, y - 27, 9.5, { bold: true });
    drawText("on the same visit using the same analyzer.", margin + 10, y - 40, 9.5, { bold: true });
    y -= 54;
    const foundLines = wrapText(
      "Post-service readings reflect the engine's immediate state following carbon removal. The ECU relearning " +
      "process typically completes within 50-150 miles of normal driving.",
      font, 8.5, pageW - margin * 2 - 20
    );
    for (const line of foundLines) { drawText(line, margin + 10, y, 8.5, { color: grayText }); y -= 11; }
    page.drawRectangle({ x: margin, y: y - 6, width: pageW - margin * 2, height: calloutTop - (y - 6), borderColor: navy, borderWidth: 1 });
    y -= 18;

    // Gauges
    const coPct = pctChange(job.before?.co, job.after?.co);
    const co2Pct = pctChange(job.before?.co2, job.after?.co2);
    const o2Pct = pctChange(job.before?.o2, job.after?.o2);

    const drawGauge = (cx, cy, radius, value, meta) => {
      const v = num(value);
      const steps = 36;
      let prev = null;
      for (let i = 0; i <= steps; i++) {
        const angle = Math.PI - (Math.PI * i) / steps;
        const px = cx + radius * Math.cos(angle);
        const py = cy + radius * Math.sin(angle);
        if (prev) page.drawLine({ start: prev, end: { x: px, y: py }, thickness: 7, color: green });
        prev = { x: px, y: py };
      }
      if (v !== null) {
        const clamped = Math.max(0, Math.min(meta.max, v));
        const pct = clamped / meta.max;
        const angle = Math.PI - Math.PI * pct;
        const nx = cx + (radius - 12) * Math.cos(angle);
        const ny = cy + (radius - 12) * Math.sin(angle);
        page.drawLine({ start: { x: cx, y: cy }, end: { x: nx, y: ny }, thickness: 2, color: rgb(0.1, 0.1, 0.1) });
      }
      page.drawEllipse({ x: cx, y: cy, xScale: 3.5, yScale: 3.5, color: rgb(0.1, 0.1, 0.1) });
      page.drawLine({ start: { x: cx - radius, y: cy }, end: { x: cx + radius, y: cy }, thickness: 1, color: lightLine });
      const labelW = fontBold.widthOfTextAtSize(meta.label, 10);
      drawText(meta.label, cx - labelW / 2, cy - radius - 14, 10, { bold: true });
      const valText = v !== null ? `${v}${meta.unit}` : "-";
      const valW = font.widthOfTextAtSize(valText, 9);
      drawText(valText, cx - valW / 2, cy - radius - 26, 9, { color: grayText });
    };

    const drawGaugeRow = (title, phase) => {
      const titleW = fontBold.widthOfTextAtSize(title, 11);
      drawText(title, pageW / 2 - titleW / 2, y, 11, { bold: true, color: navy });
      y -= 52;
      const gaugeY = y;
      const radius = 42;
      const usableW = pageW - margin * 2;
      const slot = usableW / 3;
      ["co", "co2", "o2"].forEach((gas, i) => {
        const cx = margin + slot * i + slot / 2;
        drawGauge(cx, gaugeY, radius, job[phase]?.[gas], GAS_META[gas]);
      });
      y -= 42;
    };

    drawGaugeRow("--- BEFORE SERVICE ---", "before");
    drawGaugeRow("--- AFTER SERVICE ---", "after");

    const changeLabel = `Change: CO ${fmtPct(coPct)}   |   CO2 ${fmtPct(co2Pct)}   |   O2 ${fmtPct(o2Pct)}`;
    const chW = fontBold.widthOfTextAtSize(changeLabel, 10);
    drawText(changeLabel, pageW / 2 - chW / 2, y, 10, { bold: true, color: green });
    y -= 18;
    const thanks = "Thank you for lowering your carbon footprint!";
    const thW = fontItalic.widthOfTextAtSize(thanks, 12);
    drawText(thanks, pageW / 2 - thW / 2, y, 12, { italic: true, color: green });
    y -= 20;

    drawWrapped(COMPLIANCE_TEXT, 8, { color: grayText, lineHeight: 10.5 });

    // ================= PAGE 3: PHOTOS =================
    newPage();
    drawText("Vehicle Identification Photos", margin, y, 13, { bold: true, color: navy }); y -= 16;

    const vp = job.vehiclePhotos || {};
    const [vinImg, plateImg, sideImg] = await Promise.all([
      embedPhoto(vp.vin), embedPhoto(vp.plate), embedPhoto(vp.side),
    ]);

    const drawPhotoRow = (label, entries) => {
      const present = entries.filter(([img]) => img);
      if (!present.length) return;
      ensureSpace(140);
      drawText(label, margin, y, 10, { bold: true }); y -= 12;
      const cols = 3, gap = 12;
      const boxW = (pageW - margin * 2 - gap * (cols - 1)) / cols, boxH = 110;
      const rowY = y;
      entries.forEach(([img, capLabel], i) => {
        const x = margin + i * (boxW + gap);
        if (img) {
          const scale = Math.min(boxW / img.width, boxH / img.height);
          const w = img.width * scale, h = img.height * scale;
          page.drawImage(img, { x, y: rowY - h, width: w, height: h });
        }
        if (capLabel) drawText(capLabel, x, rowY - boxH - 12, 8, { color: grayText });
      });
      y -= boxH + 24;
    };

    drawPhotoRow("Identification", [
      [vinImg, "VIN Door Jamb"], [plateImg, "License Plate"], [sideImg, "Vehicle Side"],
    ]);

    const getKeys = (phase) => {
      const p = job[phase] || {};
      return Array.isArray(p.photoKeys) ? p.photoKeys : [p.photoKey || null, null, null];
    };
    const beforeImgs = await Promise.all(getKeys("before").map(embedPhoto));
    const afterImgs = await Promise.all(getKeys("after").map(embedPhoto));

    const drawAnalyzerRow = (label, imgs) => {
      const present = imgs.filter(Boolean);
      if (!present.length) return;
      ensureSpace(140);
      drawText(label, margin, y, 10, { bold: true }); y -= 12;
      const cols = 3, gap = 12;
      const boxW = (pageW - margin * 2 - gap * (cols - 1)) / cols, boxH = 110;
      const rowY = y;
      imgs.forEach((img, i) => {
        if (!img) return;
        const x = margin + i * (boxW + gap);
        const scale = Math.min(boxW / img.width, boxH / img.height);
        const w = img.width * scale, h = img.height * scale;
        page.drawImage(img, { x, y: rowY - h, width: w, height: h });
      });
      y -= boxH + 24;
    };

    drawAnalyzerRow("Before Photos", beforeImgs);
    drawAnalyzerRow("After Photos", afterImgs);

    // ================= PAGE 4: SERVICE SUMMARY =================
    newPage();
    drawText("Your Service Summary", margin, y, 16, { bold: true, color: navy }); y -= 18;
    drawText(`Date: ${(job.createdAt || "").slice(0, 10) || "-"}   |   VIN: ${job.vin || "-"}`, margin, y, 9, { color: grayText }); y -= 24;

    drawText("OVERALL EMISSIONS OBSERVATION", margin, y, 10, { bold: true, color: navy }); y -= 15;
    const obsParts = [];
    if (coPct !== null) obsParts.push(coPct < 0 ? "a reduction in CO" : "an increase in CO");
    if (co2Pct !== null) obsParts.push(co2Pct >= 0 ? "CO2 trending upward, consistent with more complete combustion" : "CO2 trending downward");
    if (o2Pct !== null) obsParts.push(o2Pct > 0 ? "an increase in O2 consistent with ECU air/fuel recalibration" : "a decrease in O2");
    const obsText = obsParts.length
      ? `Overall emissions profile showed measurable post-service change. Key observations: ${obsParts.join("; ")}. Results reflect a controlled before-and-after comparison taken during the same visit.`
      : "Readings were recorded for this visit; before/after comparison will populate once both phases are complete.";
    drawWrapped(obsText, 9.5, { lineHeight: 13 });
    y -= 8;

    drawText("What We Did", margin, y, 11, { bold: true }); y -= 15;
    drawWrapped(WHAT_WE_DID_TEXT, 9.5, { lineHeight: 13 });
    y -= 8;

    ensureSpace(100);
    drawText("Gas Reading Results", margin, y, 11, { bold: true }); y -= 18;
    const gasCols = [margin, margin + 60, margin + 130, margin + 190, margin + 250, margin + 320];
    ["Gas", "Unit", "Before", "After", "Change", "What It Means"].forEach((h, i) => drawText(h, gasCols[i], y, 8.5, { bold: true }));
    y -= 5;
    page.drawLine({ start: { x: margin, y }, end: { x: pageW - margin, y }, thickness: 0.75, color: lightLine });
    y -= 14;

    const gasRows = [
      ["CO", "ppm", job.before?.co, job.after?.co, coPct, coMeaning(coPct)],
      ["CO2", "%", job.before?.co2, job.after?.co2, co2Pct, co2Meaning(co2Pct)],
      ["O2", "%", job.before?.o2, job.after?.o2, o2Pct, o2Meaning(o2Pct)],
    ];
    for (const [gas, unit, before, after, pct, meaning] of gasRows) {
      ensureSpace(30);
      const meaningLines = wrapText(meaning, font, 8, 130);
      drawText(gas, gasCols[0], y, 9, { bold: true });
      drawText(unit, gasCols[1], y, 9);
      drawText(before != null && before !== "" ? String(before) : "-", gasCols[2], y, 9);
      drawText(after != null && after !== "" ? String(after) : "-", gasCols[3], y, 9);
      drawText(fmtPct(pct), gasCols[4], y, 9);
      let my = y;
      for (const line of meaningLines) { drawText(line, gasCols[5], my, 8, { color: grayText }); my -= 10; }
      y = Math.min(y, my) - 10;
    }
    y -= 10;

    ensureSpace(40);
    drawText("What's Next: Getting the Most from Your Service", margin, y, 11, { bold: true }); y -= 16;
    TIPS.forEach((tip, i) => {
      ensureSpace(30);
      drawWrapped(`${i + 1}. ${tip}`, 9, { lineHeight: 12 });
      y -= 4;
    });

    // ================= PAGE 5: ECU RELEARNING =================
    newPage();
    drawText("Understanding Post-Service Engine Relearning", margin, y, 14, { bold: true, color: navy }); y -= 22;
    drawWrapped(RELEARNING_TEXT, 9.5, { lineHeight: 13 });
    y -= 10;
    ensureSpace(50);
    drawText("TECHNICIAN NOTE", margin, y, 9, { bold: true, color: navy }); y -= 14;
    drawWrapped(
      "The emissions readings captured in this report represent a snapshot taken immediately before and after the carbon " +
      "cleaning service. The most accurate representation of long-term engine performance occurs after the ECU completes " +
      "its relearning cycle - typically within 50 to 150 miles of normal mixed driving.",
      9, { italic: true, color: grayText, lineHeight: 12 }
    );

    // ================= PAGE 6: LEGAL / DISCLAIMER =================
    newPage();
    drawText("Service Documentation & Legal Notices", margin, y, 14, { bold: true, color: navy }); y -= 18;
    drawText("USA Carbon Solutions - Hydrogen-Based Engine Carbon Cleaning Services", margin, y, 9, { color: grayText }); y -= 20;

    drawText("EMISSIONS COMPLIANCE CONTEXT", margin, y, 9.5, { bold: true, color: navy }); y -= 14;
    drawWrapped(COMPLIANCE_TEXT, 9, { lineHeight: 12 });
    y -= 8;
    drawText("Please retain this document for your vehicle service records.", margin, y, 8.5, { italic: true, color: grayText });
    y -= 20;

    drawText("Carbon Cleaning Service Disclaimer", margin, y, 10.5, { bold: true }); y -= 16;
    const disclaimerLines = wrapText(DISCLAIMER_TEXT, font, 9, pageW - margin * 2);
    for (const line of disclaimerLines) {
      ensureSpace(13);
      drawText(line, margin, y, 9, { color: grayText });
      y -= 12.5;
    }

    const pdfBytes = await pdfDoc.save();
    const base64Body = Buffer.from(pdfBytes).toString("base64");

    if (base64Body.length > 5_800_000) {
      return {
        statusCode: 500,
        headers: cors,
        body: "Report too large to generate - one or more stored photos are too high resolution. Please retake photos in the app (they're now auto-compressed) and try again.",
      };
    }

    return {
      statusCode: 200,
      headers: {
        ...cors,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="report_${jobId}.pdf"`,
      },
      body: base64Body,
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: String(err) };
  }
};

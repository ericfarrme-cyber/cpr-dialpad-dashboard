import { NextResponse } from "next/server";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;
const OFFICE_ID = "5606731898273792";

function headers() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
}

function parseCSV(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const hdrs = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const values = []; let current = ""; let inQ = false;
    for (const c of line) { if (c === '"') inQ = !inQ; else if (c === "," && !inQ) { values.push(current.trim()); current = ""; } else current += c; }
    values.push(current.trim());
    const obj = {};
    hdrs.forEach((h, i) => { obj[h] = values[i] || ""; });
    return obj;
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "initiate";
  const requestId = searchParams.get("requestId");

  if (action === "initiate") {
    try {
      const res = await fetch(`${DIALPAD_BASE}/stats`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          target_id: OFFICE_ID,
          target_type: "office",
          export_type: "records",
          stat_type: "calls",
          is_today: true,
          timezone: "America/Indiana/Indianapolis",
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ success: false, error: `POST failed (${res.status}): ${err}` });
      }
      const data = await res.json();
      return NextResponse.json({ success: true, requestId: data.request_id || data.id, state: "processing" });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  if (action === "poll" && requestId) {
    try {
      const res = await fetch(`${DIALPAD_BASE}/stats/${requestId}`, {
        method: "GET",
        headers: headers(),
      });
      if (!res.ok) {
        return NextResponse.json({ success: true, state: "processing" });
      }
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("text/csv")) {
        const csv = await res.text();
        return NextResponse.json({ success: true, state: "completed", data: parseCSV(csv) });
      }
      const json = await res.json();
      if (json.file_url) {
        const csvRes = await fetch(json.file_url, { headers: headers() });
        const csv = await csvRes.text();
        return NextResponse.json({ success: true, state: "completed", data: parseCSV(csv) });
      }
      if (json.state === "failed") return NextResponse.json({ success: false, error: "Export failed" });
      return NextResponse.json({ success: true, state: "processing" });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

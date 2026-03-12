import { NextResponse } from "next/server";
import { STORES } from "@/lib/constants";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;

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

// GET /api/dialpad/stats?action=initiate&store=fishers
// GET /api/dialpad/stats?action=poll&requestId=xxx
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "initiate";
  const requestId = searchParams.get("requestId");
  const store = searchParams.get("store") || "fishers";

  if (action === "initiate") {
    const storeConfig = STORES[store];
    if (!storeConfig || !storeConfig.dialpadId) {
      return NextResponse.json({ success: false, error: `Unknown store: ${store}` });
    }
    try {
      const res = await fetch(`${DIALPAD_BASE}/stats`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          target_id: storeConfig.dialpadId,
          target_type: "department",
          export_type: "records",
          stat_type: "calls",
          days_ago_start: 7,
          days_ago_end: 0,
          timezone: "America/Indiana/Indianapolis",
        }),
      });
      const rawText = await res.text();
      let data;
      try { data = JSON.parse(rawText); } catch(e) { data = rawText; }
      if (!res.ok) {
        return NextResponse.json({ success: false, error: `POST failed (${res.status})`, raw: data });
      }
      return NextResponse.json({ success: true, store, requestId: data.request_id || data.id, state: "processing" });
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
      const status = res.status;
      const ct = res.headers.get("content-type") || "";
      const rawText = await res.text();

      if (status === 200 && ct.includes("text/csv")) {
        const rows = parseCSV(rawText);
        return NextResponse.json({ success: true, state: "completed", data: rows, recordCount: rows.length });
      }

      if (status === 200) {
        let json;
        try { json = JSON.parse(rawText); } catch(e) { json = null; }

        if (json && (json.file_url || json.download_url)) {
          const dlUrl = json.file_url || json.download_url;
          const csvRes = await fetch(dlUrl, { headers: headers() });
          const csv = await csvRes.text();
          const rows = parseCSV(csv);
          return NextResponse.json({ success: true, state: "completed", data: rows, recordCount: rows.length });
        }

        if (json?.state === "failed") return NextResponse.json({ success: false, error: "Export failed" });
        return NextResponse.json({ success: true, state: json?.state || "processing" });
      }

      return NextResponse.json({ success: true, state: "processing" });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

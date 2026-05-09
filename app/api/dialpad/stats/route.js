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

// ── Initiate ONE Dialpad stats request, return its requestId ──
// Body is the request payload (historical or today variant)
async function initiateDialpadStats(body) {
  const res = await fetch(`${DIALPAD_BASE}/stats`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  let data;
  try { data = JSON.parse(rawText); } catch(e) { data = rawText; }
  if (!res.ok) {
    return { ok: false, status: res.status, raw: data };
  }
  return { ok: true, requestId: data.request_id || data.id };
}

// ── Poll ONE Dialpad stats request, return rows or state ──
// Returns: { state: "completed", rows: [...] } | { state: "processing" } | { state: "failed", error }
async function pollDialpadStats(requestId) {
  const res = await fetch(`${DIALPAD_BASE}/stats/${requestId}`, {
    method: "GET",
    headers: headers(),
  });
  const status = res.status;
  const ct = res.headers.get("content-type") || "";
  const rawText = await res.text();

  if (status === 200 && ct.includes("text/csv")) {
    return { state: "completed", rows: parseCSV(rawText) };
  }

  if (status === 200) {
    let json;
    try { json = JSON.parse(rawText); } catch(e) { json = null; }

    if (json && (json.file_url || json.download_url)) {
      const dlUrl = json.file_url || json.download_url;
      const csvRes = await fetch(dlUrl, { headers: headers() });
      const csv = await csvRes.text();
      return { state: "completed", rows: parseCSV(csv) };
    }

    if (json?.state === "failed") return { state: "failed", error: "Export failed" };
    return { state: json?.state || "processing" };
  }

  return { state: "processing" };
}

// GET /api/dialpad/stats?action=initiate&store=fishers
// GET /api/dialpad/stats?action=poll&requestId=xxx
//
// To capture today's calls, this route fires TWO Dialpad stats requests in parallel:
//   1. HISTORICAL: days_ago_start=7, days_ago_end=1 (excludes today, since Dialpad's
//      day range queries don't include today's data even with days_ago_end=0)
//   2. TODAY: is_today=true (the only way to get current-day calls per Dialpad's API)
// Both Dialpad requestIds are encoded into a single composite requestId returned to
// the caller as "historicalId__todayId" (double-underscore separator — URL-safe and
// not present in UUIDs). On poll, this is split back into two, each is polled in
// parallel, and rows are merged + de-duplicated by call_id.
//
// If a legacy single-id requestId is received (no pipe), it's polled as-is for
// backwards compatibility with any in-flight requests during deploy.
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
      const baseBody = {
        target_id: storeConfig.dialpadId,
        target_type: "department",
        export_type: "records",
        stat_type: "calls",
        timezone: "America/Indiana/Indianapolis",
      };

      // Fire both requests in parallel
      const [historical, today] = await Promise.all([
        initiateDialpadStats({ ...baseBody, days_ago_start: 7, days_ago_end: 1 }),
        initiateDialpadStats({ ...baseBody, is_today: true }),
      ]);

      if (!historical.ok) {
        return NextResponse.json({ success: false, error: `Historical POST failed (${historical.status})`, raw: historical.raw });
      }
      if (!today.ok) {
        // If today's request fails, fall back to historical-only — better than nothing
        console.warn(`[Stats] today initiate failed (${today.status}), proceeding with historical only`);
        return NextResponse.json({ success: true, store, requestId: historical.requestId, state: "processing" });
      }

      // Composite requestId encodes both Dialpad requestIds.
      // Separator is __ (double underscore) — URL-safe and not present in UUIDs.
      const compositeId = `${historical.requestId}__${today.requestId}`;
      return NextResponse.json({ success: true, store, requestId: compositeId, state: "processing" });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  if (action === "poll" && requestId) {
    try {
      // Split composite requestId; legacy single-id requests still work
      const ids = requestId.split("__");
      const isComposite = ids.length === 2;

      if (!isComposite) {
        // Legacy path — single requestId, behave exactly like before
        const result = await pollDialpadStats(requestId);
        if (result.state === "completed") {
          return NextResponse.json({ success: true, state: "completed", data: result.rows, recordCount: result.rows.length });
        }
        if (result.state === "failed") return NextResponse.json({ success: false, error: result.error });
        return NextResponse.json({ success: true, state: result.state });
      }

      // Composite path — poll both in parallel
      const [historicalId, todayId] = ids;
      const [histResult, todayResult] = await Promise.all([
        pollDialpadStats(historicalId),
        pollDialpadStats(todayId),
      ]);

      // Both must be done (or one done + one failed) for us to return.
      const histDone = histResult.state === "completed";
      const todayDone = todayResult.state === "completed";
      const histFailed = histResult.state === "failed";
      const todayFailed = todayResult.state === "failed";

      if (histFailed && todayFailed) {
        return NextResponse.json({ success: false, error: "Both exports failed" });
      }

      // If one side is completed and the other is FAILED, return the completed
      // side's rows rather than waiting forever for the dead one.
      if (histDone && todayFailed) {
        console.warn(`[Stats] today export failed; returning historical only`);
        return NextResponse.json({
          success: true,
          state: "completed",
          data: histResult.rows,
          recordCount: histResult.rows.length,
          breakdown: { historical: histResult.rows.length, today: 0, merged: histResult.rows.length, todayFailed: true },
        });
      }
      if (todayDone && histFailed) {
        console.warn(`[Stats] historical export failed; returning today only`);
        return NextResponse.json({
          success: true,
          state: "completed",
          data: todayResult.rows,
          recordCount: todayResult.rows.length,
          breakdown: { historical: 0, today: todayResult.rows.length, merged: todayResult.rows.length, historicalFailed: true },
        });
      }

      // At least one side is still processing — keep waiting
      if (!histDone || !todayDone) {
        const stateLabel = (s) => (s.state === "failed" ? "failed" : s.state);
        return NextResponse.json({
          success: true,
          state: "processing",
          historicalState: stateLabel(histResult),
          todayState: stateLabel(todayResult),
        });
      }

      // Both completed — merge rows, de-dupe by call_id (today's window may overlap
      // with historical window edge if Dialpad surfaces a call in both)
      const seen = new Set();
      const merged = [];
      for (const row of [...histResult.rows, ...todayResult.rows]) {
        const id = row.call_id;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        merged.push(row);
      }

      return NextResponse.json({
        success: true,
        state: "completed",
        data: merged,
        recordCount: merged.length,
        breakdown: { historical: histResult.rows.length, today: todayResult.rows.length, merged: merged.length },
      });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

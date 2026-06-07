import { NextResponse } from "next/server";
import { STORES, storeDeptIds } from "@/lib/constants";

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
    const deptIds = storeDeptIds(storeConfig);
    if (!storeConfig || deptIds.length === 0) {
      return NextResponse.json({ success: false, error: `Unknown store: ${store}` });
    }
    try {
      // For EACH department belonging to this store, fire a historical + today
      // pair. The composite requestId encodes every segment in order, joined by
      // "__". Segment order is [hist1, today1, hist2, today2, ...] — always two
      // per department — so the poll path can split + poll them all and merge.
      const initiatePromises = [];
      deptIds.forEach((deptId) => {
        const baseBody = {
          target_id: deptId,
          target_type: "department",
          export_type: "records",
          stat_type: "calls",
          timezone: "America/Indiana/Indianapolis",
        };
        initiatePromises.push(initiateDialpadStats({ ...baseBody, days_ago_start: 7, days_ago_end: 1 }));
        initiatePromises.push(initiateDialpadStats({ ...baseBody, is_today: true }));
      });

      const results = await Promise.all(initiatePromises);

      // If EVERY request failed, surface an error. Otherwise proceed with the
      // ones that succeeded (a single dead department shouldn't blank the store).
      const anyOk = results.some((r) => r.ok && r.requestId);
      if (!anyOk) {
        const firstErr = results.find((r) => !r.ok) || {};
        return NextResponse.json({ success: false, error: `All ${results.length} stats POSTs failed (first status ${firstErr.status})`, raw: firstErr.raw });
      }

      // Encode each segment; failed segments become "x" placeholders so the
      // index structure stays intact and the poll path can skip them.
      const compositeId = results.map((r) => (r.ok && r.requestId ? r.requestId : "x")).join("__");
      return NextResponse.json({ success: true, store, requestId: compositeId, state: "processing" });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  if (action === "poll" && requestId) {
    try {
      // Split composite requestId into segments. "x" marks a segment whose
      // initiate failed — skip it. Legacy single-id requests (no "__") still work.
      const segments = requestId.split("__");

      // Legacy single-id path — behave exactly like before.
      if (segments.length === 1) {
        const result = await pollDialpadStats(requestId);
        if (result.state === "completed") {
          return NextResponse.json({ success: true, state: "completed", data: result.rows, recordCount: result.rows.length });
        }
        if (result.state === "failed") return NextResponse.json({ success: false, error: result.error });
        return NextResponse.json({ success: true, state: result.state });
      }

      // N-segment path (2 per department: [hist1, today1, hist2, today2, ...]).
      // Poll every real segment in parallel.
      const pollResults = await Promise.all(
        segments.map((seg) => (seg && seg !== "x" ? pollDialpadStats(seg) : Promise.resolve({ state: "skipped" })))
      );

      // A segment is "settled" if it's completed, failed, or was skipped.
      // We can only return once every segment has settled (no segment still
      // processing) — otherwise we'd drop a department's calls that are still
      // exporting.
      const stillProcessing = pollResults.some((r) => r.state === "processing" || r.state === "pending" || r.state === "queued");
      if (stillProcessing) {
        return NextResponse.json({
          success: true,
          state: "processing",
          segmentStates: pollResults.map((r) => r.state),
        });
      }

      // Every segment has settled. Gather rows from all completed segments.
      const completed = pollResults.filter((r) => r.state === "completed");
      if (completed.length === 0) {
        return NextResponse.json({ success: false, error: "All exports failed" });
      }

      // Merge all rows, de-dupe by call_id (windows overlap at the today/hist
      // edge, and a call could in principle surface under multiple departments —
      // dedupe keeps each unique call once).
      const seen = new Set();
      const merged = [];
      let totalRows = 0;
      for (const r of completed) {
        for (const row of r.rows) {
          totalRows++;
          const id = row.call_id;
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          merged.push(row);
        }
      }

      return NextResponse.json({
        success: true,
        state: "completed",
        data: merged,
        recordCount: merged.length,
        breakdown: {
          segments: segments.length,
          completedSegments: completed.length,
          failedSegments: pollResults.filter((r) => r.state === "failed").length,
          skippedSegments: pollResults.filter((r) => r.state === "skipped").length,
          rawRows: totalRows,
          merged: merged.length,
        },
      });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

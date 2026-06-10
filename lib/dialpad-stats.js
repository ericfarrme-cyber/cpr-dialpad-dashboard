// lib/dialpad-stats.js
// Direct Dialpad stats helpers — shared by server-side jobs (cron).
//
// WHY THIS EXISTS: the cron previously fetched call data by making HTTP calls to
// its OWN /api/dialpad/stats endpoint (initiate → poll). Vercel serverless
// functions cannot reliably call themselves over HTTP (deployment-URL origins,
// Deployment Protection walls, killed connections), and the cron's poll window
// (~95s) was shorter than Dialpad's export time — so runs exited "successfully"
// with zero records and the dashboards silently went stale. This module talks to
// Dialpad DIRECTLY, polls patiently within an explicit time budget, and returns
// partial results (with a flag) instead of nothing when some segments are slow.
//
// The Dialpad request construction below intentionally mirrors
// app/api/dialpad/stats/route.js exactly (historical 7d window + is_today pair
// per department, CSV parsing, file_url fallback).

import { storeDeptIds, STORES } from "@/lib/constants";

const DIALPAD_BASE = "https://dialpad.com/api/v2";

function dialpadHeaders() {
  return {
    Authorization: "Bearer " + (process.env.DIALPAD_API_KEY || ""),
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function parseCSV(csvText) {
  var lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  var hdrs = lines[0].split(",").map(function (h) { return h.trim().replace(/^"|"$/g, ""); });
  return lines.slice(1).map(function (line) {
    var values = []; var current = ""; var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line[i];
      if (c === '"') inQ = !inQ;
      else if (c === "," && !inQ) { values.push(current.trim()); current = ""; }
      else current += c;
    }
    values.push(current.trim());
    var obj = {};
    hdrs.forEach(function (h, idx) { obj[h] = values[idx] || ""; });
    return obj;
  });
}

// ── Initiate ONE Dialpad stats export. Returns { ok, requestId } | { ok:false, status, raw } ──
async function initiateDialpadStats(body) {
  var res = await fetch(DIALPAD_BASE + "/stats", {
    method: "POST",
    headers: dialpadHeaders(),
    body: JSON.stringify(body),
  });
  var rawText = await res.text();
  var data;
  try { data = JSON.parse(rawText); } catch (e) { data = rawText; }
  if (!res.ok) return { ok: false, status: res.status, raw: data };
  return { ok: true, requestId: data.request_id || data.id };
}

// ── Poll ONE Dialpad stats export. ──
// Returns { state:"completed", rows } | { state:"processing"|... } | { state:"failed", error }
async function pollDialpadStats(requestId) {
  var res = await fetch(DIALPAD_BASE + "/stats/" + requestId, {
    method: "GET",
    headers: dialpadHeaders(),
  });
  var status = res.status;
  var ct = res.headers.get("content-type") || "";
  var rawText = await res.text();

  if (status === 200 && ct.includes("text/csv")) {
    return { state: "completed", rows: parseCSV(rawText) };
  }
  if (status === 200) {
    var json = null;
    try { json = JSON.parse(rawText); } catch (e) { json = null; }
    if (json && (json.file_url || json.download_url)) {
      var dlUrl = json.file_url || json.download_url;
      var csvRes = await fetch(dlUrl, { headers: dialpadHeaders() });
      var csv = await csvRes.text();
      return { state: "completed", rows: parseCSV(csv) };
    }
    if (json && json.state === "failed") return { state: "failed", error: "Export failed" };
    return { state: (json && json.state) || "processing" };
  }
  return { state: "processing" };
}

// ── Fetch ALL call records for one store, directly from Dialpad. ──
// Initiates a historical(7d-or-daysBack)+today export pair per department, then
// polls every pollIntervalMs until every segment settles OR budgetMs expires.
// On budget expiry, returns whatever segments completed (partial: true) instead
// of returning nothing — a partially-fresh dashboard beats a silently stale one.
//
// Returns: { records, meta: { segments, completedSegments, failedSegments,
//            pendingSegments, partial, elapsedMs, rawRows } }
export async function fetchStoreCalls(storeKey, opts) {
  opts = opts || {};
  var budgetMs = opts.budgetMs || 180000;       // default 180s of patience
  var pollIntervalMs = opts.pollIntervalMs || 10000;
  var initialWaitMs = opts.initialWaitMs != null ? opts.initialWaitMs : 20000;
  var daysBack = opts.daysBack ? parseInt(opts.daysBack, 10) : null;

  var storeConfig = STORES[storeKey];
  var deptIds = storeDeptIds(storeConfig);
  if (!storeConfig || deptIds.length === 0) {
    return { records: [], meta: { error: "Unknown store or no department ids: " + storeKey, segments: 0, completedSegments: 0, failedSegments: 0, pendingSegments: 0, partial: false, elapsedMs: 0, rawRows: 0 } };
  }

  var startTime = Date.now();

  // ── Initiate: historical + today pair per department ──
  var initiatePromises = [];
  deptIds.forEach(function (deptId) {
    var baseBody = {
      target_id: deptId,
      target_type: "department",
      export_type: "records",
      stat_type: "calls",
      timezone: "America/Indiana/Indianapolis",
    };
    initiatePromises.push(initiateDialpadStats(Object.assign({}, baseBody, { days_ago_start: (daysBack && daysBack > 0) ? daysBack : 7, days_ago_end: 1 })));
    initiatePromises.push(initiateDialpadStats(Object.assign({}, baseBody, { is_today: true })));
  });
  var initResults = await Promise.all(initiatePromises);

  var segments = initResults.map(function (r) {
    return { requestId: r.ok ? r.requestId : null, state: r.ok ? "processing" : "failed", rows: null, initStatus: r.ok ? 200 : r.status };
  });

  var anyOk = segments.some(function (s) { return !!s.requestId; });
  if (!anyOk) {
    var firstErr = initResults.find(function (r) { return !r.ok; }) || {};
    return { records: [], meta: { error: "All " + initResults.length + " stats POSTs failed (first status " + (firstErr.status || "?") + ")", segments: segments.length, completedSegments: 0, failedSegments: segments.length, pendingSegments: 0, partial: false, elapsedMs: Date.now() - startTime, rawRows: 0 } };
  }

  // ── Give Dialpad a head start before the first poll ──
  if (initialWaitMs > 0) {
    await new Promise(function (r) { setTimeout(r, initialWaitMs); });
  }

  // ── Patient poll loop: poll all unsettled segments in parallel each round ──
  while (Date.now() - startTime < budgetMs) {
    var unsettled = segments.filter(function (s) { return s.requestId && s.state !== "completed" && s.state !== "failed"; });
    if (unsettled.length === 0) break;

    await Promise.all(unsettled.map(function (seg) {
      return pollDialpadStats(seg.requestId).then(function (res) {
        seg.state = res.state;
        if (res.state === "completed") seg.rows = res.rows || [];
      }).catch(function (e) {
        // Network blip on a poll round is not fatal — try again next round.
        console.error("[dialpad-stats] poll error for " + seg.requestId + ": " + e.message);
      });
    }));

    var stillPending = segments.some(function (s) { return s.requestId && s.state !== "completed" && s.state !== "failed"; });
    if (!stillPending) break;
    await new Promise(function (r) { setTimeout(r, pollIntervalMs); });
  }

  // ── Merge completed segments, dedupe by call_id ──
  var seen = new Set();
  var merged = [];
  var rawRows = 0;
  segments.forEach(function (seg) {
    if (seg.state !== "completed" || !seg.rows) return;
    seg.rows.forEach(function (row) {
      rawRows++;
      var id = row.call_id;
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      merged.push(row);
    });
  });

  var completedSegments = segments.filter(function (s) { return s.state === "completed"; }).length;
  var failedSegments = segments.filter(function (s) { return s.state === "failed" || !s.requestId; }).length;
  var pendingSegments = segments.length - completedSegments - failedSegments;

  return {
    records: merged,
    meta: {
      segments: segments.length,
      completedSegments: completedSegments,
      failedSegments: failedSegments,
      pendingSegments: pendingSegments,
      partial: pendingSegments > 0 || failedSegments > 0,
      elapsedMs: Date.now() - startTime,
      rawRows: rawRows,
    },
  };
}

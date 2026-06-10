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
// RESUME MECHANISM: Dialpad's is_today exports have been observed taking >3
// minutes — longer than one run's poll budget. Rather than abandon an initiated
// export, any requestIds still processing at budget expiry are stashed in the
// pending_dialpad_exports table (see migration_pending_exports.sql). The NEXT
// run polls those FIRST — by then they're nearly always complete — so today's
// calls land at most one cycle late instead of never.
//
// The Dialpad request construction below intentionally mirrors
// app/api/dialpad/stats/route.js exactly (historical 7d window + is_today pair
// per department, CSV parsing, file_url fallback).

import { storeDeptIds, STORES } from "@/lib/constants";
import { supabase } from "@/lib/supabase";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const PENDING_MAX_AGE_MS = 6 * 60 * 60 * 1000; // ignore stashed exports older than 6h

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
  // ── Terminal non-200 states. CRITICAL: these must NOT map to "processing". ──
  // Dialpad returns 400 "Results have expired. Please re-initiate processing"
  // once a completed export's results pass their TTL, and 404 for unknown ids.
  // Treating those as "processing" (the old behavior) made expired exports look
  // eternally in-flight: they were re-stashed forever and the pending list grew
  // without bound while zero data arrived.
  if (status === 400 && /expired/i.test(rawText)) return { state: "expired", error: "Results expired before collection" };
  if (status === 404) return { state: "failed", error: "Export not found" };
  if (status === 400 || status === 410) return { state: "failed", error: "Export rejected (" + status + ")" };
  return { state: "processing" };
}

// ── Pending-export stash (resume across runs) ──
async function loadPendingExports(storeKey) {
  if (!supabase) return [];
  try {
    var { data, error } = await supabase
      .from("pending_dialpad_exports")
      .select("request_ids, initiated_at")
      .eq("store", storeKey)
      .maybeSingle();
    if (error || !data || !data.request_ids) return [];
    var age = Date.now() - new Date(data.initiated_at).getTime();
    if (age > PENDING_MAX_AGE_MS) {
      // Too old to be useful — clean up and start fresh.
      await supabase.from("pending_dialpad_exports").delete().eq("store", storeKey);
      return [];
    }
    return data.request_ids.split("__").filter(function (id) { return id && id !== "x"; });
  } catch (e) {
    console.error("[dialpad-stats] loadPendingExports error: " + e.message);
    return [];
  }
}

async function savePendingExports(storeKey, requestIds) {
  if (!supabase) return;
  try {
    if (!requestIds || requestIds.length === 0) {
      await supabase.from("pending_dialpad_exports").delete().eq("store", storeKey);
      return;
    }
    await supabase.from("pending_dialpad_exports").upsert(
      { store: storeKey, request_ids: requestIds.join("__"), initiated_at: new Date().toISOString() },
      { onConflict: "store" }
    );
  } catch (e) {
    console.error("[dialpad-stats] savePendingExports error: " + e.message);
  }
}

// ── Fetch ALL call records for one store, directly from Dialpad. ──
// 1. Resumes any requestIds stashed by a previous run (polled alongside new ones;
//    they're usually complete immediately).
// 2. Initiates a historical(7d-or-daysBack)+today export pair per department.
// 3. Polls every pollIntervalMs until every segment settles OR budgetMs expires.
// 4. Stashes any still-processing requestIds for the next run, and returns
//    whatever completed (partial: true) instead of returning nothing.
//
// Returns: { records, meta: { segments, completedSegments, failedSegments,
//            pendingSegments, resumedSegments, stashedForNextRun, partial,
//            elapsedMs, rawRows } }
export async function fetchStoreCalls(storeKey, opts) {
  opts = opts || {};
  var budgetMs = opts.budgetMs || 180000;       // default 180s of patience
  var pollIntervalMs = opts.pollIntervalMs || 10000;
  var initialWaitMs = opts.initialWaitMs != null ? opts.initialWaitMs : 20000;
  var daysBack = opts.daysBack ? parseInt(opts.daysBack, 10) : null;

  var storeConfig = STORES[storeKey];
  var deptIds = storeDeptIds(storeConfig);
  if (!storeConfig || deptIds.length === 0) {
    return { records: [], meta: { error: "Unknown store or no department ids: " + storeKey, segments: 0, completedSegments: 0, failedSegments: 0, pendingSegments: 0, resumedSegments: 0, stashedForNextRun: 0, partial: false, elapsedMs: 0, rawRows: 0 } };
  }

  var startTime = Date.now();

  // ── Resume: pick up exports a previous run initiated but couldn't finish ──
  var resumedIds = await loadPendingExports(storeKey);
  var segments = resumedIds.map(function (id) {
    return { requestId: id, state: "processing", rows: null, resumed: true };
  });
  if (resumedIds.length > 0) {
    console.log("[dialpad-stats] " + storeKey + ": resuming " + resumedIds.length + " pending export(s) from previous run");
  }

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
  initResults.forEach(function (r) {
    segments.push({ requestId: r.ok ? r.requestId : null, state: r.ok ? "processing" : "failed", rows: null, resumed: false, initStatus: r.ok ? 200 : r.status });
  });

  var anyOk = segments.some(function (s) { return !!s.requestId; });
  if (!anyOk) {
    var firstErr = initResults.find(function (r) { return !r.ok; }) || {};
    return { records: [], meta: { error: "All " + initResults.length + " stats POSTs failed (first status " + (firstErr.status || "?") + ")", segments: segments.length, completedSegments: 0, failedSegments: segments.length, pendingSegments: 0, resumedSegments: resumedIds.length, stashedForNextRun: 0, partial: false, elapsedMs: Date.now() - startTime, rawRows: 0 } };
  }

  // ── Give Dialpad a head start before the first poll. Skip the wait when ──
  // ── resuming: inherited exports have been processing for minutes already. ──
  if (initialWaitMs > 0 && resumedIds.length === 0) {
    await new Promise(function (r) { setTimeout(r, initialWaitMs); });
  }

  // ── Patient poll loop: poll all unsettled segments in parallel each round ──
  while (Date.now() - startTime < budgetMs) {
    var unsettled = segments.filter(function (s) { return s.requestId && s.state !== "completed" && s.state !== "failed" && s.state !== "expired"; });
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

    var stillPending = segments.some(function (s) { return s.requestId && s.state !== "completed" && s.state !== "failed" && s.state !== "expired"; });
    if (!stillPending) break;
    await new Promise(function (r) { setTimeout(r, pollIntervalMs); });
  }

  // ── Stash anything still processing so the NEXT run finishes the job ──
  // Only genuinely in-flight exports get stashed. Expired/failed ones are gone
  // on Dialpad's side — re-stashing them was the unbounded-growth bug. Cap the
  // stash so it can never balloon even in pathological cases.
  var leftover = segments
    .filter(function (s) { return s.requestId && s.state !== "completed" && s.state !== "failed" && s.state !== "expired"; })
    .map(function (s) { return s.requestId; })
    .slice(-6);
  await savePendingExports(storeKey, leftover);
  if (leftover.length > 0) {
    console.log("[dialpad-stats] " + storeKey + ": stashed " + leftover.length + " still-processing export(s) for next run");
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
  var expiredSegments = segments.filter(function (s) { return s.state === "expired"; }).length;
  var pendingSegments = segments.length - completedSegments - failedSegments - expiredSegments;

  return {
    records: merged,
    meta: {
      segments: segments.length,
      completedSegments: completedSegments,
      failedSegments: failedSegments,
      expiredSegments: expiredSegments,
      pendingSegments: pendingSegments,
      resumedSegments: resumedIds.length,
      stashedForNextRun: leftover.length,
      partial: pendingSegments > 0 || failedSegments > 0,
      elapsedMs: Date.now() - startTime,
      rawRows: rawRows,
    },
  };
}


// ── COLLECTOR: one cheap poll pass over a store's stashed exports. ──
// Dialpad's today-exports complete AFTER a cron run's in-run budget but their
// results EXPIRE before the next hourly run — so a frequent, lightweight
// collector is the only reliable way to catch them inside the expiry window.
// Polls each stashed id ONCE, returns completed rows, drops expired/failed ids,
// re-stashes only the genuinely still-processing ones. No initiation, no waiting
// loops — runs in seconds. Schedule every ~10 minutes.
export async function collectPendingExports(storeKey) {
  var startTime = Date.now();
  var pendingIds = await loadPendingExports(storeKey);
  if (pendingIds.length === 0) {
    return { records: [], meta: { pendingChecked: 0, completed: 0, expired: 0, failed: 0, stillProcessing: 0, elapsedMs: 0, rawRows: 0 } };
  }

  var results = await Promise.all(pendingIds.map(function (id) {
    return pollDialpadStats(id).then(function (res) { return { requestId: id, state: res.state, rows: res.rows || null }; })
      .catch(function (e) {
        console.error("[dialpad-stats] collector poll error for " + id + ": " + e.message);
        return { requestId: id, state: "processing", rows: null }; // transient — keep for next pass
      });
  }));

  var seen = new Set();
  var merged = [];
  var rawRows = 0;
  results.forEach(function (r) {
    if (r.state !== "completed" || !r.rows) return;
    r.rows.forEach(function (row) {
      rawRows++;
      var id = row.call_id;
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      merged.push(row);
    });
  });

  var stillProcessing = results.filter(function (r) { return r.state !== "completed" && r.state !== "failed" && r.state !== "expired"; }).map(function (r) { return r.requestId; });
  await savePendingExports(storeKey, stillProcessing);

  var meta = {
    pendingChecked: pendingIds.length,
    completed: results.filter(function (r) { return r.state === "completed"; }).length,
    expired: results.filter(function (r) { return r.state === "expired"; }).length,
    failed: results.filter(function (r) { return r.state === "failed"; }).length,
    stillProcessing: stillProcessing.length,
    elapsedMs: Date.now() - startTime,
    rawRows: rawRows,
  };
  console.log("[dialpad-stats] " + storeKey + " collector: " + JSON.stringify(meta));
  return { records: merged, meta: meta };
}

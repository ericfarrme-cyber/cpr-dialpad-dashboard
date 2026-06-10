import { NextResponse } from "next/server";
import { isCallAudited, saveAuditResult, updateSyncState, saveCallRecords, updateCallSyncState } from "@/lib/supabase";
import { STORES } from "@/lib/constants";
import { fetchStoreCalls } from "@/lib/dialpad-stats";
import { AUDIT_PROMPT, preAuditFilter, transcriptPreCheck } from "@/lib/audit-config";

export const maxDuration = 300;

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function dialpadHeaders() {
  return { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" };
}

async function fetchStoreCallData(storeKey, baseUrl, daysBack) {
  // Direct Dialpad fetch via lib/dialpad-stats — NO self-HTTP. The previous
  // implementation called this app's own /api/dialpad/stats endpoint (initiate →
  // 35s wait → six 10s polls). Two failure modes made the dashboards go silently
  // stale: (a) Vercel functions can't reliably HTTP-call themselves (deployment
  // URLs / Deployment Protection), and (b) the ~95s poll window was shorter than
  // Dialpad's export time, so runs exited "success" with 0 records.
  // fetchStoreCalls polls Dialpad directly with a generous budget and returns
  // partial results (flagged) rather than nothing when some exports lag.
  try {
    var result = await fetchStoreCalls(storeKey, { daysBack: daysBack, budgetMs: 180000 });
    if (result.meta && result.meta.error) {
      console.error("[Cron] " + storeKey + " fetch error: " + result.meta.error);
    }
    console.log("[Cron] " + storeKey + ": " + result.records.length + " records fetched directly from Dialpad (" +
      result.meta.completedSegments + "/" + result.meta.segments + " segments in " + Math.round(result.meta.elapsedMs / 1000) + "s" +
      (result.meta.partial ? ", PARTIAL" : "") + ")");
    var records = result.records.map(function(row) { row._storeKey = storeKey; return row; });
    return { records: records, meta: result.meta };
  } catch (err) {
    console.error("[Cron] " + storeKey + " fetch error:", err.message);
    return { records: [], meta: { error: err.message, partial: true, segments: 0, completedSegments: 0 } };
  }
}

async function scoreCall(call) {
  try {
    // ── Pre-audit filter ──
    var pf = preAuditFilter(call);
    if (!pf.pass) {
      console.log("[Cron] Pre-filter excluded " + call.call_id + ": " + pf.reason);
      return {
        call_id: call.call_id, date: call.date_started, store: call._storeKey,
        store_name: call.name || call._storeKey, call_type: "non_scorable",
        employee: "Unknown", customer_name: "Unknown", device_type: "Not mentioned",
        phone: call.external_number || "", direction: call.direction || "inbound",
        talk_duration: call.talk_duration ? parseFloat(call.talk_duration) : null,
        inquiry: pf.reason, outcome: "Auto-excluded by pre-filter",
        score: 0, max_score: 0, confidence: 100,
        confidence_reason: "Pre-filter auto-exclusion",
        excluded: true, exclude_reason: pf.detail || pf.reason,
        criteria: {}, transcript_preview: "",
        tone_score: null, clarity_score: null, empathy_score: null, qualitative_notes: null,
      };
    }

    // ── Fetch transcript ──
    var tRes = await fetch(DIALPAD_BASE + "/transcripts/" + call.call_id, { method: "GET", headers: dialpadHeaders() });
    if (!tRes.ok) return null;
    var tData = await tRes.json();
    var ft = "";
    if (tData.lines) {
      ft = tData.lines.map(function(l) { return (l.speaker || l.name || "Unknown") + ": " + (l.text || l.content || ""); }).join("\n");
    } else if (tData.transcript) {
      ft = typeof tData.transcript === "string" ? tData.transcript : JSON.stringify(tData.transcript);
    } else {
      ft = JSON.stringify(tData);
    }

    // ── Transcript pre-check ──
    var tc = transcriptPreCheck(ft);
    if (!tc.pass) {
      console.log("[Cron] Transcript check excluded " + call.call_id + ": " + tc.reason);
      return {
        call_id: call.call_id, date: call.date_started, store: call._storeKey,
        store_name: call.name || call._storeKey, call_type: "non_scorable",
        employee: "Unknown", customer_name: "Unknown", device_type: "Not mentioned",
        phone: call.external_number || "", direction: call.direction || "inbound",
        talk_duration: call.talk_duration ? parseFloat(call.talk_duration) : null,
        inquiry: tc.reason, outcome: "Auto-excluded by transcript check",
        score: 0, max_score: 0, confidence: 100,
        confidence_reason: "Transcript pre-check exclusion",
        excluded: true, exclude_reason: tc.detail || tc.reason,
        criteria: {}, transcript_preview: (ft || "").substring(0, 500),
        tone_score: null, clarity_score: null, empathy_score: null, qualitative_notes: null,
      };
    }

    // ── Score with Claude ──
    var ctx = "\nCall Info: " + call.direction + " call, " + (call.external_number || "unknown") + ", " + call.date_started + ", Store: " + (call.name || call._storeKey) + "\n";
    var cRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1500, messages: [{ role: "user", content: AUDIT_PROMPT + "\n" + ctx + "\n--- TRANSCRIPT ---\n" + ft + "\n--- END TRANSCRIPT ---" }] }),
    });
    if (!cRes.ok) return null;
    var cData = await cRes.json();
    var text = (cData.content && cData.content[0] && cData.content[0].text) || "";
    var m = text.match(/\{[\s\S]*\}/);
    var r = m ? JSON.parse(m[0]) : null;
    if (!r) return null;

    var shouldExclude = r.call_type === "non_scorable";
    return {
      call_id: call.call_id,
      date: call.date_started,
      store: call._storeKey,
      store_name: call.name || call._storeKey,
      call_type: r.call_type || "opportunity",
      employee: r.employee || "Unknown",
      customer_name: r.customer_name || "Unknown",
      device_type: r.device_type || "Not mentioned",
      phone: call.external_number || "",
      direction: call.direction || "inbound",
      talk_duration: call.talk_duration ? parseFloat(call.talk_duration) : null,
      inquiry: r.inquiry || "",
      outcome: r.outcome || "",
      score: r.score || 0,
      max_score: r.max_score || 4.0,
      confidence: r.confidence || 0,
      confidence_reason: r.confidence_reason || "",
      excluded: shouldExclude,
      exclude_reason: shouldExclude ? "AI classified as non-scorable" : "",
      criteria: r.criteria,
      transcript_preview: ft.substring(0, 500),
      // ── Qualitative grading (calibration mode — NOT used in employee scorecards) ──
      // These fields run alongside the structural score above. They're observation-only
      // for at least the first 4 weeks of data while we calibrate the AI's distribution.
      tone_score: r.tone_score != null ? r.tone_score : null,
      clarity_score: r.clarity_score != null ? r.clarity_score : null,
      empathy_score: r.empathy_score != null ? r.empathy_score : null,
      qualitative_notes: r.qualitative_notes || null,
    };
  } catch (err) {
    console.error("[Cron] Score error:", err.message);
    return null;
  }
}

export async function GET(request) {
  var url = new URL(request.url);
  var secret = url.searchParams.get("secret") || (request.headers.get("authorization") || "").replace("Bearer ", "");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Self-dispatch must target the PRODUCTION alias. url.origin can be a
  // deployment-specific URL (cpr-dialpad-dashboard-xxxx.vercel.app) when Vercel
  // invokes the cron, and self-calls to those can hit Deployment Protection and
  // die silently. Override with CRON_SELF_BASE_URL env var if the domain changes.
  var baseUrl = process.env.CRON_SELF_BASE_URL || "https://cpr-dialpad-dashboard.vercel.app";
  // Normalize store casing: "Bloomington" and "bloomington" must behave the
  // same. A mismatched case previously fell through to dispatcher mode
  // silently instead of running the requested store.
  var storeParam = (url.searchParams.get("store") || "").toLowerCase().trim() || null;

  // ── SINGLE STORE MODE: /api/dialpad/cron?store=fishers ──
  // Each store gets its own 300s budget
  if (storeParam && STORES[storeParam]) {
    var startTime = Date.now();
    var TIME_BUDGET_MS = 260000; // 260s — leave 40s buffer before 300s Vercel timeout
    var daysBack = url.searchParams.get("days") || null;
    console.log("[Cron] Single store mode: " + storeParam + (daysBack ? " (backfill " + daysBack + " days)" : ""));
    var results = { store: storeParam, callSync: {}, auditSync: {}, totalCallsSaved: 0, totalNewAudits: 0, skipped: 0, errors: [] };
    try {
      var fetchResult = await fetchStoreCallData(storeParam, baseUrl, daysBack);
      var allCalls = fetchResult.records;
      results.fetchMeta = fetchResult.meta;
      if (allCalls.length > 0) {
        var saveResult = await saveCallRecords(allCalls);
        results.callSync = { fetched: allCalls.length, saved: saveResult.saved };
        results.totalCallsSaved = saveResult.saved;
        await updateCallSyncState(storeParam, saveResult.saved);
      } else {
        // ZERO records is an ERROR, not a quiet success. A store with no synced
        // calls for a whole run means stale TVs and a wrong answer-rate basis —
        // surface it loudly in the response and the logs.
        var zeroMsg = "0 call records fetched for " + storeParam +
          (fetchResult.meta && fetchResult.meta.error ? " — " + fetchResult.meta.error : "") +
          (fetchResult.meta ? " (segments completed: " + fetchResult.meta.completedSegments + "/" + fetchResult.meta.segments + ")" : "");
        console.error("[Cron] " + zeroMsg);
        results.errors.push({ store: storeParam, error: zeroMsg });
      }

      var recorded = allCalls.filter(function(r) {
        return r.target_type === "department" && r.was_recorded === "true" && r.direction === "inbound" && r.categories && r.categories.includes("answered");
      });

      var newAudits = 0;
      var timedOut = false;
      for (var ci = 0; ci < recorded.length; ci++) {
        // Check time budget before each call
        if (Date.now() - startTime > TIME_BUDGET_MS) {
          console.log("[Cron] [" + storeParam + "] Time budget reached after " + newAudits + " audits. " + (recorded.length - ci) + " calls deferred to next run.");
          results.skipped = recorded.length - ci;
          timedOut = true;
          break;
        }
        var call = recorded[ci];
        if (!call.call_id) continue;
        var alreadyDone = await isCallAudited(call.call_id);
        if (alreadyDone) continue;
        console.log("[Cron] [" + storeParam + "] Scoring " + call.call_id + " (" + (ci+1) + "/" + recorded.length + ")...");
        var audit = await scoreCall(call);
        if (audit) {
          await saveAuditResult(audit);
          newAudits++;
          results.totalNewAudits++;
        }
        await new Promise(function(r) { setTimeout(r, 1000); });
      }

      await updateSyncState(storeParam, (recorded[0] && recorded[0].call_id) || "", newAudits);
      results.auditSync = { recorded: recorded.length, newAudits: newAudits, timedOut: timedOut };
    } catch (err) {
      console.error("[Cron] [" + storeParam + "] Error:", err.message);
      results.errors.push({ store: storeParam, error: err.message });
    }

    console.log("[Cron] [" + storeParam + "] Done: " + results.totalCallsSaved + " calls, " + results.totalNewAudits + " audits");
    return NextResponse.json({ success: results.errors.length === 0, ...results, timestamp: new Date().toISOString() });
  }

  // ── DISPATCHER MODE: /api/dialpad/cron (no store param) ──
  // Triggers all stores in PARALLEL — each as a separate request with its own 300s budget
  var storeKeys = Object.keys(STORES);
  var dispatchDays = url.searchParams.get("days") || "";
  console.log("[Cron] Dispatcher mode: triggering " + storeKeys.length + " stores in parallel");

  var dispatched = [];
  // ── Pattern: kick off all 3 store invocations and AWAIT just the dispatch handshake. ──
  // Each fetch resolves quickly when the dispatched function ACCEPTS the request
  // (in dispatcher mode the parent doesn't need to wait for the store's full work to complete —
  // each store invocation has its own 300s Vercel budget once it starts running).
  // The await here ensures Node actually sends the HTTP requests out before the parent function terminates.
  // Without this await, fire-and-forget fetches can be killed mid-handshake when the parent returns.
  var dispatchPromises = storeKeys.map(function(sk) {
    var storeUrl = baseUrl + "/api/dialpad/cron?secret=" + (CRON_SECRET || "") + "&store=" + sk;
    if (dispatchDays) storeUrl += "&days=" + dispatchDays;
    console.log("[Cron] Dispatching: " + sk);
    dispatched.push(sk);
    // Don't wait for the store work to finish — just wait for the request to be sent + headers received.
    // The dispatched invocation will continue running on Vercel with its own 300s budget.
    return fetch(storeUrl, { signal: AbortSignal.timeout(2000) })
      .then(function(r) { console.log("[Cron] " + sk + " accepted: " + r.status); })
      .catch(function(e) {
        // AbortSignal timeout is EXPECTED — it means the store is still running, which is what we want.
        // The dispatched invocation continues independently on Vercel even though we abandoned the connection.
        if (e.name === "TimeoutError" || e.name === "AbortError") {
          console.log("[Cron] " + sk + " dispatched (continues in background)");
        } else {
          console.error("[Cron] " + sk + " dispatch error:", e.message);
        }
      });
  });
  // Wait for all dispatch attempts to settle (success or expected timeout) before returning.
  // This gives Node a chance to actually push the HTTP requests onto the wire.
  await Promise.allSettled(dispatchPromises);

  return NextResponse.json({
    success: true,
    mode: "dispatcher",
    dispatched: dispatched,
    message: "Triggered " + dispatched.length + " store crons in parallel. Each runs independently with its own 300s budget.",
    timestamp: new Date().toISOString()
  });
}

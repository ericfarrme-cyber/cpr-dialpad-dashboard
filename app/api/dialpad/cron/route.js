import { NextResponse } from "next/server";
import { isCallAudited, saveAuditResult, updateSyncState, saveCallRecords, updateCallSyncState } from "@/lib/supabase";
import { STORES } from "@/lib/constants";
import { AUDIT_PROMPT, preAuditFilter, transcriptPreCheck } from "@/lib/audit-config";

export const maxDuration = 300;

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function dialpadHeaders() {
  return { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" };
}

async function fetchStoreCallData(storeKey, baseUrl, daysBack) {
  try {
    var initUrl = baseUrl + "/api/dialpad/stats?action=initiate&store=" + storeKey;
    if (daysBack) initUrl += "&days=" + daysBack;
    var initRes = await fetch(initUrl);
    if (!initRes.ok) { console.log("[Cron] initiate failed for " + storeKey + ": " + initRes.status); return []; }
    var initData = await initRes.json();
    if (!initData.success || !initData.requestId) { console.log("[Cron] no requestId for " + storeKey); return []; }
    var requestId = initData.requestId;
    console.log("[Cron] " + storeKey + ": requestId=" + requestId + ", waiting 35s...");

    await new Promise(function(r) { setTimeout(r, 35000); });

    var records = [];
    for (var attempt = 0; attempt < 6; attempt++) {
      var pollUrl = baseUrl + "/api/dialpad/stats?action=poll&requestId=" + requestId;
      var pollRes = await fetch(pollUrl);
      if (!pollRes.ok) { await new Promise(function(r) { setTimeout(r, 10000); }); continue; }
      var pollData = await pollRes.json();
      console.log("[Cron] " + storeKey + " poll " + (attempt + 1) + ": state=" + (pollData.state || "?") + " records=" + (pollData.data ? pollData.data.length : 0));
      if (pollData.data && pollData.data.length > 0) {
        records = pollData.data.map(function(row) { row._storeKey = storeKey; return row; });
        break;
      }
      await new Promise(function(r) { setTimeout(r, 10000); });
    }
    console.log("[Cron] " + storeKey + ": " + records.length + " records fetched");
    return records;
  } catch (err) {
    console.error("[Cron] " + storeKey + " fetch error:", err.message);
    return [];
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

  var baseUrl = url.origin;
  var storeParam = url.searchParams.get("store");

  // ── SINGLE STORE MODE: /api/dialpad/cron?store=fishers ──
  // Each store gets its own 300s budget
  if (storeParam && STORES[storeParam]) {
    var startTime = Date.now();
    var TIME_BUDGET_MS = 260000; // 260s — leave 40s buffer before 300s Vercel timeout
    var daysBack = url.searchParams.get("days") || null;
    console.log("[Cron] Single store mode: " + storeParam + (daysBack ? " (backfill " + daysBack + " days)" : ""));
    var results = { store: storeParam, callSync: {}, auditSync: {}, totalCallsSaved: 0, totalNewAudits: 0, skipped: 0, errors: [] };
    try {
      var allCalls = await fetchStoreCallData(storeParam, baseUrl, daysBack);
      if (allCalls.length > 0) {
        var saveResult = await saveCallRecords(allCalls);
        results.callSync = { fetched: allCalls.length, saved: saveResult.saved };
        results.totalCallsSaved = saveResult.saved;
        await updateCallSyncState(storeParam, saveResult.saved);
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
    return NextResponse.json({ success: true, ...results, timestamp: new Date().toISOString() });
  }

  // ── DISPATCHER MODE: /api/dialpad/cron (no store param) ──
  // Triggers all stores in PARALLEL — each as a separate request with its own 300s budget
  var storeKeys = Object.keys(STORES);
  var dispatchDays = url.searchParams.get("days") || "";
  console.log("[Cron] Dispatcher mode: triggering " + storeKeys.length + " stores in parallel");

  var dispatched = [];
  storeKeys.forEach(function(sk) {
    var storeUrl = baseUrl + "/api/dialpad/cron?secret=" + (CRON_SECRET || "") + "&store=" + sk;
    if (dispatchDays) storeUrl += "&days=" + dispatchDays;
    console.log("[Cron] Dispatching: " + sk);
    // Fire-and-forget — don't await, let each run independently
    fetch(storeUrl).then(function(r) {
      console.log("[Cron] " + sk + " responded: " + r.status);
    }).catch(function(e) {
      console.error("[Cron] " + sk + " dispatch error:", e.message);
    });
    dispatched.push(sk);
  });

  return NextResponse.json({
    success: true,
    mode: "dispatcher",
    dispatched: dispatched,
    message: "Triggered " + dispatched.length + " store crons in parallel. Each runs independently with its own 300s budget.",
    timestamp: new Date().toISOString()
  });
}

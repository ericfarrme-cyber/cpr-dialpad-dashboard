import { NextResponse } from "next/server";
import { isCallAudited, saveAuditResult, updateSyncState, saveCallRecords, updateCallSyncState } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

export const maxDuration = 300;

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function dialpadHeaders() {
  return { Authorization: "Bearer " + API_KEY, "Content-Type": "application/json" };
}

var AUDIT_PROMPT = "You are a phone call quality auditor for CPR Cell Phone Repair stores.\n\nSTEP 1 — CLASSIFY THE CALL:\n- \"opportunity\": A prospective customer calling about a NEW repair, price inquiry, or the store calling out to a potential customer. Examples: \"How much to fix my iPhone screen?\", \"Do you repair Samsung tablets?\", \"I cracked my phone, can you fix it today?\"\n- \"current_customer\": An existing customer checking on repair status, picking up a device, rescheduling or canceling an existing appointment, following up on a back-ordered part, or any call where a prior visit or existing repair is referenced. Examples: \"Is my phone ready?\", \"I dropped off my iPad yesterday\", \"I need to reschedule my appointment\", \"Any update on that part you ordered?\"\n- \"non_scorable\": Wrong number, disconnected/dropped call, vendor/sales call to the store, automated recording, or call too short to evaluate. Score = 0.\n\nSTEP 2 — SCORE BASED ON CALL TYPE:\n\nIF call_type = \"opportunity\", score these 4 criteria:\n1. Appointment Offered (1.25 pts): Did the employee offer to schedule an appointment?\n2. Discount for Scheduling (0.92 pts): Did the employee mention any discount for booking?\n3. Lifetime Warranty Mentioned (0.92 pts): Did the employee mention CPR's lifetime warranty?\n4. Appointment = Faster Turnaround (0.92 pts): Did the employee explain scheduling means faster service?\n\nIF call_type = \"current_customer\", score these 4 criteria:\n1. Clear Status Update (1.00 pts): Did the employee give a clear update on the repair status?\n2. ETA / Timeline Communicated (1.00 pts): Did the employee provide an estimated completion time?\n3. Professional & Empathetic Tone (1.00 pts): Was the employee courteous and patient?\n4. Next Steps Clearly Explained (1.00 pts): Did the employee clearly explain what happens next?\n\nIF call_type = \"non_scorable\", set score to 0 and max_score to 0.\n\nSTEP 3 — EXTRACT: Employee Name, Customer Name (or \"Unknown\"), Device Type (or \"Not mentioned\"), Caller Inquiry, Outcome.\n\nRespond ONLY with valid JSON:\n{\n  \"call_type\": \"opportunity\" or \"current_customer\" or \"non_scorable\",\n  \"employee\": \"Name\", \"customer_name\": \"Name or Unknown\", \"device_type\": \"Device or Not mentioned\",\n  \"inquiry\": \"Brief description\", \"outcome\": \"Brief outcome\",\n  \"criteria\": { ... },\n  \"score\": 0.00, \"max_score\": 4.00\n}";

async function fetchStoreCallData(storeKey, baseUrl) {
  try {
    var initUrl = baseUrl + "/api/dialpad/stats?action=initiate&store=" + storeKey;
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
    if (!ft || ft.length < 20) return null;

    var ctx = "\nCall Info: " + call.direction + " call, " + (call.external_number || "unknown") + ", " + call.date_started + ", Store: " + (call.name || call._storeKey) + "\n";
    var cRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1200, messages: [{ role: "user", content: AUDIT_PROMPT + "\n" + ctx + "\n--- TRANSCRIPT ---\n" + ft + "\n--- END TRANSCRIPT ---" }] }),
    });
    if (!cRes.ok) return null;
    var cData = await cRes.json();
    var text = (cData.content && cData.content[0] && cData.content[0].text) || "";
    var m = text.match(/\{[\s\S]*\}/);
    var r = m ? JSON.parse(m[0]) : null;
    if (!r) return null;
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
  var results = { callSync: {}, auditSync: {}, totalCallsSaved: 0, totalNewAudits: 0, errors: [] };
  var storeKeys = Object.keys(STORES);

  for (var si = 0; si < storeKeys.length; si++) {
    var storeKey = storeKeys[si];
    try {
      console.log("[Cron] === " + storeKey + " ===");
      var allCalls = await fetchStoreCallData(storeKey, baseUrl);

      if (allCalls.length > 0) {
        var saveResult = await saveCallRecords(allCalls);
        results.callSync[storeKey] = { fetched: allCalls.length, saved: saveResult.saved };
        results.totalCallsSaved += saveResult.saved;
        await updateCallSyncState(storeKey, saveResult.saved);
      } else {
        results.callSync[storeKey] = { fetched: 0, saved: 0 };
      }

      var recorded = allCalls.filter(function(r) {
        return r.target_type === "department" && r.was_recorded === "true" && r.direction === "inbound" && r.categories && r.categories.includes("answered");
      });

      var newAudits = 0;
      for (var ci = 0; ci < recorded.length; ci++) {
        var call = recorded[ci];
        if (!call.call_id) continue;
        var alreadyDone = await isCallAudited(call.call_id);
        if (alreadyDone) continue;
        console.log("[Cron] Scoring " + call.call_id + "...");
        var audit = await scoreCall(call);
        if (audit) {
          await saveAuditResult(audit);
          newAudits++;
          results.totalNewAudits++;
        }
        await new Promise(function(r) { setTimeout(r, 2000); });
      }

      await updateSyncState(storeKey, (recorded[0] && recorded[0].call_id) || "", newAudits);
      results.auditSync[storeKey] = { recorded: recorded.length, newAudits: newAudits };
    } catch (err) {
      console.error("[Cron] Error for " + storeKey + ":", err.message);
      results.errors.push({ store: storeKey, error: err.message });
    }
  }

  console.log("[Cron] Done: " + results.totalCallsSaved + " calls, " + results.totalNewAudits + " audits");
  return NextResponse.json({ success: true, callSync: results.callSync, auditSync: results.auditSync, totalCallsSaved: results.totalCallsSaved, totalNewAudits: results.totalNewAudits, errors: results.errors, timestamp: new Date().toISOString() });
}

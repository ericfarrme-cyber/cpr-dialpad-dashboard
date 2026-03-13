import { NextResponse } from "next/server";
import { isCallAudited, saveAuditResult, updateSyncState, saveCallRecords, updateCallSyncState } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

export const maxDuration = 300;

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function dialpadHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
}

const AUDIT_PROMPT = `You are a phone call quality auditor for CPR Cell Phone Repair stores.

STEP 1 — CLASSIFY THE CALL:
- "opportunity": A prospective customer calling about a NEW repair, price inquiry, or the store calling out to a potential customer. Examples: "How much to fix my iPhone screen?", "Do you repair Samsung tablets?", "I cracked my phone, can you fix it today?"
- "current_customer": An existing customer checking on repair status, picking up a device, rescheduling or canceling an existing appointment, following up on a back-ordered part, or any call where a prior visit or existing repair is referenced. Examples: "Is my phone ready?", "I dropped off my iPad yesterday", "I need to reschedule my appointment", "Any update on that part you ordered?"
- "non_scorable": Wrong number, disconnected/dropped call, vendor/sales call to the store, automated recording, or call too short to evaluate. Score = 0.

STEP 2 — SCORE BASED ON CALL TYPE:

IF call_type = "opportunity", score these 4 criteria:
1. Appointment Offered (1.25 pts): Did the employee offer to schedule an appointment?
2. Discount for Scheduling (0.92 pts): Did the employee mention any discount for booking?
3. Lifetime Warranty Mentioned (0.92 pts): Did the employee mention CPR's lifetime warranty?
4. Appointment = Faster Turnaround (0.92 pts): Did the employee explain scheduling means faster service?

IF call_type = "current_customer", score these 4 criteria:
1. Clear Status Update (1.00 pts): Did the employee give a clear update on the repair status?
2. ETA / Timeline Communicated (1.00 pts): Did the employee provide an estimated completion time?
3. Professional & Empathetic Tone (1.00 pts): Was the employee courteous and patient?
4. Next Steps Clearly Explained (1.00 pts): Did the employee clearly explain what happens next?

IF call_type = "non_scorable", set score to 0 and max_score to 0.

STEP 3 — EXTRACT: Employee Name, Customer Name (or "Unknown"), Device Type (or "Not mentioned"), Caller Inquiry, Outcome.

Respond ONLY with valid JSON:
{
  "call_type": "opportunity" or "current_customer" or "non_scorable",
  "employee": "Name", "customer_name": "Name or Unknown", "device_type": "Device or Not mentioned",
  "inquiry": "Brief description", "outcome": "Brief outcome",
  "criteria": { ... },
  "score": 0.00, "max_score": 4.00
}`;

async function fetchStoreCallData(storeKey, daysAgoStart, daysAgoEnd) {
  var store = STORES[storeKey];
  if (!store) return [];
  try {
    console.log("[Cron] Initiating stats for " + storeKey + "...");
    var initRes = await fetch(DIALPAD_BASE + "/stats", {
      method: "POST",
      headers: dialpadHeaders(),
      body: JSON.stringify({
        days_ago_start: daysAgoStart || 0,
        days_ago_end: daysAgoEnd || 7,
        stat_type: "calls",
        target_id: parseInt(store.dialpadId),
        target_type: "department",
        timezone: "America/Indiana/Indianapolis",
      }),
    });
    if (!initRes.ok) {
      console.log("[Cron] Initiate failed for " + storeKey + ": " + initRes.status);
      return [];
    }
    var initData = await initRes.json();
    var requestId = initData.request_id;
    console.log("[Cron] Got request_id " + requestId + " for " + storeKey + ", waiting 30s...");

    // Wait 30 seconds before first poll
    await new Promise(function(r) { setTimeout(r, 30000); });

    // Poll up to 6 times with 10s gaps
    var pollData = null;
    for (var attempt = 0; attempt < 6; attempt++) {
      var pollRes = await fetch(DIALPAD_BASE + "/stats/" + requestId, { method: "GET", headers: dialpadHeaders() });
      if (!pollRes.ok) {
        console.log("[Cron] Poll failed for " + storeKey + ": " + pollRes.status);
        return [];
      }
      pollData = await pollRes.json();
      console.log("[Cron] Poll attempt " + (attempt + 1) + " for " + storeKey + ": " + pollData.status);
      if (pollData.status === "complete" && pollData.download_url) break;
      pollData = null;
      await new Promise(function(r) { setTimeout(r, 10000); });
    }
    if (!pollData || !pollData.download_url) {
      console.log("[Cron] Stats never completed for " + storeKey);
      return [];
    }

    // *** KEY FIX: Download URL returns JSON, not CSV ***
    var dlRes = await fetch(pollData.download_url);
    var dlText = await dlRes.text();
    console.log("[Cron] Download response length for " + storeKey + ": " + dlText.length + " chars");

    var records = [];
    try {
      // Try JSON first (this is what Dialpad actually returns)
      var jsonData = JSON.parse(dlText);
      if (jsonData.data && Array.isArray(jsonData.data)) {
        // Response format: { success: true, state: "completed", data: [...], recordCount: N }
        records = jsonData.data.map(function(row) {
          row._storeKey = storeKey;
          return row;
        });
        console.log("[Cron] Parsed " + records.length + " JSON records for " + storeKey);
      } else if (Array.isArray(jsonData)) {
        // Maybe it's just an array directly
        records = jsonData.map(function(row) {
          row._storeKey = storeKey;
          return row;
        });
        console.log("[Cron] Parsed " + records.length + " JSON array records for " + storeKey);
      } else {
        console.log("[Cron] Unexpected JSON structure for " + storeKey + ": " + Object.keys(jsonData).join(","));
      }
    } catch (parseErr) {
      // Fallback: try CSV parsing if JSON fails
      console.log("[Cron] JSON parse failed, trying CSV for " + storeKey);
      var lines = dlText.split("\n");
      var headers = lines[0].split(",").map(function(h) { return h.trim().replace(/^"|"$/g, ""); });
      for (var i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        var values = (lines[i].match(/("([^"]*)"|[^,]*)/g) || []).map(function(v) { return v.replace(/^"|"$/g, "").trim(); });
        var row = {};
        headers.forEach(function(h, j) { row[h] = values[j] || ""; });
        row._storeKey = storeKey;
        records.push(row);
      }
      console.log("[Cron] Parsed " + records.length + " CSV records for " + storeKey);
    }

    return records;
  } catch (err) {
    console.error("[Cron] Error fetching " + storeKey + ":", err.message);
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

  var results = { callSync: {}, auditSync: {}, totalCallsSaved: 0, totalNewAudits: 0, errors: [] };
  var storeKeys = Object.keys(STORES);

  for (var si = 0; si < storeKeys.length; si++) {
    var storeKey = storeKeys[si];
    try {
      console.log("[Cron] === Processing " + storeKey + " ===");
      var allCalls = await fetchStoreCallData(storeKey, 0, 7);

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

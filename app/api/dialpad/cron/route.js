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

STEP 1 — CLASSIFY THE CALL (this is critical — read carefully):

"opportunity" — The caller is asking about a NEW repair they haven't started yet. They want a price quote, availability, or to schedule a new repair. KEY SIGNAL: the customer does NOT currently have a device at the shop.

"current_customer" — The caller ALREADY has a device at the shop, OR is calling about an existing repair/order. This includes ALL of the following:
  - Checking on repair status
  - Asking for an update on a device left for repair
  - Picking up a repaired device
  - Rescheduling or canceling an existing appointment
  - Following up on a back-ordered part
  - Calling about a warranty issue on a PREVIOUS repair
  - Any call where a repair ticket or prior visit is referenced

"non_scorable" — Wrong number, spam, call disconnected immediately, vendor call, transcript too short/corrupted.

STEP 2 — SCORE:

IF "opportunity" (max 4.01 pts):
1. Appointment Offered (1.25 pts) 2. Discount for Scheduling (0.92 pts) 3. Lifetime Warranty Mentioned (0.92 pts) 4. Faster Turnaround (0.92 pts)

IF "current_customer" (max 4.00 pts):
1. Clear Status Update (1.00 pts) 2. ETA/Timeline (1.00 pts) 3. Professional Tone (1.00 pts) 4. Next Steps Explained (1.00 pts)

IF "non_scorable": score=0, max_score=0

STEP 3 — EXTRACT: Employee Name, Customer Name, Device Type, Inquiry, Outcome.

Respond ONLY with valid JSON:
{
  "call_type": "opportunity" or "current_customer" or "non_scorable",
  "employee": "Name", "customer_name": "Name or Unknown", "device_type": "Device or Not mentioned",
  "inquiry": "Brief description", "outcome": "Brief outcome",
  "criteria": { each: {"pass": true/false, "notes": "explanation"} },
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
        days_ago_end: daysAgoEnd || 0,
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
    console.log("[Cron] Got request_id " + requestId + " for " + storeKey + ", waiting...");

    await new Promise(function(r) { setTimeout(r, 35000); });

    var pollRes = await fetch(DIALPAD_BASE + "/stats/" + requestId, { method: "GET", headers: dialpadHeaders() });
    if (!pollRes.ok) {
      console.log("[Cron] Poll failed for " + storeKey + ": " + pollRes.status);
      return [];
    }
    var pollData = await pollRes.json();
    if (pollData.status !== "complete" || !pollData.download_url) {
      console.log("[Cron] Not complete for " + storeKey + ": " + pollData.status);
      return [];
    }

    var csvRes = await fetch(pollData.download_url);
    var csvText = await csvRes.text();
    var lines = csvText.split("\n");
    var headers = lines[0].split(",").map(function(h) { return h.trim().replace(/^"|"$/g, ""); });
    var records = [];
    for (var i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      var values = (lines[i].match(/("([^"]*)"|[^,]*)/g) || []).map(function(v) { return v.replace(/^"|"$/g, "").trim(); });
      var row = {};
      headers.forEach(function(h, j) { row[h] = values[j] || ""; });
      row._storeKey = storeKey;
      records.push(row);
    }
    console.log("[Cron] Got " + records.length + " records for " + storeKey);
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
      var allCalls = await fetchStoreCallData(storeKey, 7, 0);

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

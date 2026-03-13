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
- "opportunity": A prospective customer calling about a NEW repair, price inquiry, or the store calling out to a potential customer.
- "current_customer": An existing customer checking on repair status, picking up a device, rescheduling or canceling an existing appointment, following up on a back-ordered part, or any call where a prior visit or existing repair is referenced.
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

async function fetchStoreCallData(storeKey, daysAgoStart, daysAgoEnd, debug) {
  var store = STORES[storeKey];
  if (!store) { debug.push(storeKey + ": store not found in STORES"); return []; }

  try {
    debug.push(storeKey + ": initiating stats request...");
    debug.push(storeKey + ": dialpadId=" + store.dialpadId + ", days_ago_start=" + (daysAgoStart || 0) + ", days_ago_end=" + (daysAgoEnd || 7));
    debug.push(storeKey + ": API_KEY present=" + (API_KEY ? "yes (" + API_KEY.substring(0, 8) + "...)" : "NO"));

    var initBody = {
      days_ago_start: daysAgoStart || 0,
      days_ago_end: daysAgoEnd || 7,
      stat_type: "calls",
      target_id: parseInt(store.dialpadId),
      target_type: "department",
      timezone: "America/Indiana/Indianapolis",
    };

    var initRes = await fetch(DIALPAD_BASE + "/stats", {
      method: "POST",
      headers: dialpadHeaders(),
      body: JSON.stringify(initBody),
    });

    debug.push(storeKey + ": initiate status=" + initRes.status);

    if (!initRes.ok) {
      var errText = await initRes.text();
      debug.push(storeKey + ": initiate error body=" + errText.substring(0, 200));
      return [];
    }

    var initData = await initRes.json();
    var requestId = initData.request_id;
    debug.push(storeKey + ": got request_id=" + requestId);

    if (!requestId) {
      debug.push(storeKey + ": NO request_id in response: " + JSON.stringify(initData).substring(0, 200));
      return [];
    }

    // Wait 30 seconds
    debug.push(storeKey + ": waiting 30s before polling...");
    await new Promise(function(r) { setTimeout(r, 30000); });

    // Poll up to 6 times with 10s gaps
    var pollData = null;
    for (var attempt = 0; attempt < 6; attempt++) {
      var pollRes = await fetch(DIALPAD_BASE + "/stats/" + requestId, { method: "GET", headers: dialpadHeaders() });
      debug.push(storeKey + ": poll attempt " + (attempt + 1) + " status=" + pollRes.status);

      if (!pollRes.ok) {
        var pollErrText = await pollRes.text();
        debug.push(storeKey + ": poll error body=" + pollErrText.substring(0, 200));
        return [];
      }

      pollData = await pollRes.json();
      debug.push(storeKey + ": poll result status=" + pollData.status + ", has download_url=" + (pollData.download_url ? "yes" : "no"));

      if (pollData.status === "complete" && pollData.download_url) break;
      pollData = null;
      await new Promise(function(r) { setTimeout(r, 10000); });
    }

    if (!pollData || !pollData.download_url) {
      debug.push(storeKey + ": stats never completed after 6 attempts");
      return [];
    }

    // Fetch the download URL
    debug.push(storeKey + ": fetching download_url=" + pollData.download_url.substring(0, 100) + "...");
    var dlRes = await fetch(pollData.download_url);
    debug.push(storeKey + ": download status=" + dlRes.status + ", content-type=" + (dlRes.headers.get("content-type") || "unknown"));

    var dlText = await dlRes.text();
    debug.push(storeKey + ": download body length=" + dlText.length + " chars");
    debug.push(storeKey + ": download body preview=" + dlText.substring(0, 200));

    var records = [];
    try {
      var jsonData = JSON.parse(dlText);
      if (jsonData.data && Array.isArray(jsonData.data)) {
        records = jsonData.data.map(function(row) { row._storeKey = storeKey; return row; });
        debug.push(storeKey + ": parsed " + records.length + " JSON records from data array");
      } else if (Array.isArray(jsonData)) {
        records = jsonData.map(function(row) { row._storeKey = storeKey; return row; });
        debug.push(storeKey + ": parsed " + records.length + " JSON array records");
      } else {
        debug.push(storeKey + ": unexpected JSON structure, keys=" + Object.keys(jsonData).join(","));
      }
    } catch (parseErr) {
      debug.push(storeKey + ": JSON parse failed (" + parseErr.message + "), trying CSV...");
      var lines = dlText.split("\n");
      debug.push(storeKey + ": CSV lines=" + lines.length + ", first line=" + (lines[0] || "").substring(0, 100));
      var headers = lines[0].split(",").map(function(h) { return h.trim().replace(/^"|"$/g, ""); });
      for (var i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        var values = (lines[i].match(/("([^"]*)"|[^,]*)/g) || []).map(function(v) { return v.replace(/^"|"$/g, "").trim(); });
        var row = {};
        headers.forEach(function(h, j) { row[h] = values[j] || ""; });
        row._storeKey = storeKey;
        records.push(row);
      }
      debug.push(storeKey + ": parsed " + records.length + " CSV records");
    }

    return records;
  } catch (err) {
    debug.push(storeKey + ": EXCEPTION: " + err.message);
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
    return null;
  }
}

export async function GET(request) {
  var url = new URL(request.url);
  var secret = url.searchParams.get("secret") || (request.headers.get("authorization") || "").replace("Bearer ", "");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  var debug = [];
  debug.push("STORES keys: " + Object.keys(STORES).join(", "));
  debug.push("API_KEY present: " + (API_KEY ? "yes" : "NO"));
  debug.push("Start time: " + new Date().toISOString());

  var results = { callSync: {}, auditSync: {}, totalCallsSaved: 0, totalNewAudits: 0, errors: [] };
  var storeKeys = Object.keys(STORES);

  // Only process first store for debugging (to keep it fast)
  var storeKey = storeKeys[0];
  try {
    debug.push("=== Processing " + storeKey + " ===");
    var allCalls = await fetchStoreCallData(storeKey, 0, 7, debug);

    if (allCalls.length > 0) {
      var saveResult = await saveCallRecords(allCalls);
      results.callSync[storeKey] = { fetched: allCalls.length, saved: saveResult.saved };
      results.totalCallsSaved += saveResult.saved;
      await updateCallSyncState(storeKey, saveResult.saved);
      debug.push(storeKey + ": saved " + saveResult.saved + " call records");
    } else {
      results.callSync[storeKey] = { fetched: 0, saved: 0 };
      debug.push(storeKey + ": no calls to save");
    }

    // Skip auditing for debug run
    results.auditSync[storeKey] = { recorded: 0, newAudits: 0, skipped: "debug mode" };

  } catch (err) {
    debug.push(storeKey + ": TOP-LEVEL ERROR: " + err.message);
    results.errors.push({ store: storeKey, error: err.message });
  }

  debug.push("End time: " + new Date().toISOString());

  return NextResponse.json({
    success: true,
    ...results,
    debug: debug,
    timestamp: new Date().toISOString()
  });
}

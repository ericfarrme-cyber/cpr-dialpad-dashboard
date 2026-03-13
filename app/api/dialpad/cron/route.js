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

// Use the working stats API route instead of calling Dialpad directly
async function fetchStoreCallData(storeKey, baseUrl, debug) {
  try {
    // Step 1: Initiate via our working stats route
    debug.push(storeKey + ": calling stats route to initiate...");
    var initUrl = baseUrl + "/api/dialpad/stats?action=initiate&store=" + storeKey;
    var initRes = await fetch(initUrl);
    if (!initRes.ok) {
      debug.push(storeKey + ": stats initiate failed: " + initRes.status);
      return [];
    }
    var initData = await initRes.json();
    if (!initData.success || !initData.requestId) {
      debug.push(storeKey + ": no requestId: " + JSON.stringify(initData).substring(0, 200));
      return [];
    }
    var requestId = initData.requestId;
    debug.push(storeKey + ": got requestId=" + requestId + ", waiting 35s...");

    // Step 2: Wait then poll via our working stats route
    await new Promise(function(r) { setTimeout(r, 35000); });

    var records = [];
    for (var attempt = 0; attempt < 6; attempt++) {
      var pollUrl = baseUrl + "/api/dialpad/stats?action=poll&requestId=" + requestId;
      var pollRes = await fetch(pollUrl);
      if (!pollRes.ok) {
        debug.push(storeKey + ": poll attempt " + (attempt + 1) + " HTTP error: " + pollRes.status);
        await new Promise(function(r) { setTimeout(r, 10000); });
        continue;
      }
      var pollData = await pollRes.json();
      debug.push(storeKey + ": poll attempt " + (attempt + 1) + " state=" + (pollData.state || "unknown") + " records=" + (pollData.data ? pollData.data.length : 0));

      if (pollData.data && pollData.data.length > 0) {
        records = pollData.data.map(function(row) { row._storeKey = storeKey; return row; });
        debug.push(storeKey + ": got " + records.length + " records!");
        break;
      }

      await new Promise(function(r) { setTimeout(r, 10000); });
    }

    if (records.length === 0) {
      debug.push(storeKey + ": no records after 6 poll attempts");
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

  // Get base URL for calling our own stats route
  var baseUrl = url.origin;
  var debug = [];
  debug.push("Base URL: " + baseUrl);
  debug.push("STORES: " + Object.keys(STORES).join(", "));
  debug.push("Start: " + new Date().toISOString());

  var results = { callSync: {}, auditSync: {}, totalCallsSaved: 0, totalNewAudits: 0, errors: [] };

  // Debug mode: only process first store to test
  var storeKeys = Object.keys(STORES);
  var storeKey = storeKeys[0];

  try {
    debug.push("=== Processing " + storeKey + " ===");
    var allCalls = await fetchStoreCallData(storeKey, baseUrl, debug);

    if (allCalls.length > 0) {
      var saveResult = await saveCallRecords(allCalls);
      results.callSync[storeKey] = { fetched: allCalls.length, saved: saveResult.saved };
      results.totalCallsSaved += saveResult.saved;
      await updateCallSyncState(storeKey, saveResult.saved);
      debug.push(storeKey + ": saved " + saveResult.saved + " records to Supabase");
    } else {
      results.callSync[storeKey] = { fetched: 0, saved: 0 };
    }

    // Skip auditing for debug run
    results.auditSync[storeKey] = { recorded: 0, newAudits: 0, skipped: "debug mode - test fetch only" };
  } catch (err) {
    debug.push(storeKey + ": ERROR: " + err.message);
    results.errors.push({ store: storeKey, error: err.message });
  }

  debug.push("End: " + new Date().toISOString());
  return NextResponse.json({ success: true, ...results, debug: debug, timestamp: new Date().toISOString() });
}

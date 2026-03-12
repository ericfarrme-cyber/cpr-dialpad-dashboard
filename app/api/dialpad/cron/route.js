import { NextResponse } from "next/server";
import { isCallAudited, saveAuditResult, updateSyncState, saveCallRecords, updateCallSyncState } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function dialpadHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
}

const AUDIT_PROMPT = `You are a phone call quality auditor for CPR Cell Phone Repair stores. Score this call transcript against these 4 criteria:

1. **Appointment Offered (1.25 pts)**: Did the employee offer to schedule an appointment? Even if the customer declines, the offer must be made.
2. **Discount for Scheduling (0.92 pts)**: Did the employee mention any discount, deal, or savings for booking an appointment?
3. **Lifetime Warranty Mentioned (0.92 pts)**: Did the employee mention CPR's lifetime warranty on repairs?
4. **Appointment = Faster Turnaround (0.92 pts)**: Did the employee explain that scheduling an appointment means faster/priority service or guaranteed turnaround?

For each criterion, respond with PASS or FAIL and a brief explanation.

Also provide:
- **Employee Name**: extracted from the transcript (the CPR store agent — look for who answers the phone on behalf of CPR)
- **Caller Inquiry**: what the caller was asking about (e.g., "iPhone 15 screen repair quote")
- **Outcome**: brief summary of call result (e.g., "Customer booked appointment", "Customer said they'd call back", "Just a price check")
- **Overall Score**: sum of passed criteria weights

Respond ONLY with valid JSON in this exact format:
{
  "employee": "Name",
  "inquiry": "Brief description",
  "outcome": "Brief outcome",
  "criteria": {
    "appointment_offered": {"pass": true/false, "notes": "explanation"},
    "discount_mentioned": {"pass": true/false, "notes": "explanation"},
    "warranty_mentioned": {"pass": true/false, "notes": "explanation"},
    "faster_turnaround": {"pass": true/false, "notes": "explanation"}
  },
  "score": 0.00,
  "max_score": 4.00
}`;

// Fetch call data for a store via Dialpad stats API (initiate/poll)
async function fetchStoreCallData(storeKey, daysAgoStart = 0, daysAgoEnd = 0) {
  const store = STORES[storeKey];
  if (!store) return [];

  console.log(`[Cron] Initiating stats request for ${storeKey}...`);

  const initiateRes = await fetch(`${DIALPAD_BASE}/stats`, {
    method: "POST",
    headers: dialpadHeaders(),
    body: JSON.stringify({
      days_ago_start: daysAgoStart,
      days_ago_end: daysAgoEnd,
      stat_type: "calls",
      target_id: parseInt(store.dialpadId),
      target_type: "department",
      timezone: "America/Indiana/Indianapolis",
    }),
  });

  if (!initiateRes.ok) {
    console.error(`[Cron] Stats initiate failed for ${storeKey}: ${initiateRes.status}`);
    return [];
  }

  const { request_id } = await initiateRes.json();
  console.log(`[Cron] Got request_id ${request_id} for ${storeKey}, waiting 35s...`);

  await new Promise(r => setTimeout(r, 35000));

  const pollRes = await fetch(`${DIALPAD_BASE}/stats/${request_id}`, {
    method: "GET",
    headers: dialpadHeaders(),
  });

  if (!pollRes.ok) {
    console.error(`[Cron] Stats poll failed for ${storeKey}: ${pollRes.status}`);
    return [];
  }

  const pollData = await pollRes.json();
  if (pollData.status !== "complete" || !pollData.download_url) {
    console.log(`[Cron] Stats not ready for ${storeKey}: ${pollData.status}`);
    return [];
  }

  const csvRes = await fetch(pollData.download_url);
  const csvText = await csvRes.text();

  // Parse CSV
  const lines = csvText.split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].match(/("([^"]*)"|[^,]*)/g)?.map(v => v.replace(/^"|"$/g, "").trim()) || [];
    const row = {};
    headers.forEach((h, j) => { row[h] = values[j] || ""; });
    row._storeKey = storeKey;
    records.push(row);
  }

  console.log(`[Cron] Got ${records.length} records for ${storeKey}`);
  return records;
}

// Score a single call transcript
async function scoreCall(call) {
  const transcriptRes = await fetch(`${DIALPAD_BASE}/transcripts/${call.call_id}`, {
    method: "GET",
    headers: dialpadHeaders(),
  });

  if (!transcriptRes.ok) return null;
  const transcriptData = await transcriptRes.json();

  let formattedTranscript = "";
  if (transcriptData.lines) {
    formattedTranscript = transcriptData.lines.map(line => {
      const speaker = line.speaker || line.name || "Unknown";
      const text = line.text || line.content || "";
      return `${speaker}: ${text}`;
    }).join("\n");
  } else if (transcriptData.transcript) {
    formattedTranscript = typeof transcriptData.transcript === "string"
      ? transcriptData.transcript : JSON.stringify(transcriptData.transcript);
  } else {
    formattedTranscript = JSON.stringify(transcriptData);
  }

  if (!formattedTranscript || formattedTranscript.length < 20) return null;

  const context = `\nCall Info: ${call.direction} call, ${call.external_number || "unknown"}, ${call.date_started}, Store: ${call.name || call._storeKey}\n`;

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: `${AUDIT_PROMPT}\n${context}\n--- TRANSCRIPT ---\n${formattedTranscript}\n--- END TRANSCRIPT ---` }],
    }),
  });

  if (!claudeRes.ok) return null;

  const claudeData = await claudeRes.json();
  const responseText = claudeData.content?.[0]?.text || "";

  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const auditResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    if (!auditResult) return null;

    return {
      call_id: call.call_id,
      date: call.date_started,
      store: call._storeKey,
      store_name: call.name || call._storeKey,
      employee: auditResult.employee || "Unknown",
      phone: call.external_number || "",
      direction: call.direction || "inbound",
      talk_duration: call.talk_duration ? parseFloat(call.talk_duration) : null,
      inquiry: auditResult.inquiry || "",
      outcome: auditResult.outcome || "",
      score: auditResult.score || 0,
      max_score: auditResult.max_score || 4.0,
      criteria: auditResult.criteria,
      transcript_preview: formattedTranscript.substring(0, 500),
    };
  } catch {
    return null;
  }
}

export async function GET(request) {
  // Verify cron secret
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret") || request.headers.get("authorization")?.replace("Bearer ", "");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = {
    callSync: {},
    auditSync: {},
    totalCallsSaved: 0,
    totalNewAudits: 0,
    errors: [],
  };

  for (const storeKey of Object.keys(STORES)) {
    try {
      // ── STEP 1: Fetch and save ALL call records ──
      console.log(`[Cron] === Processing ${storeKey} ===`);

      // Fetch today's calls (days_ago_start=0, days_ago_end=0)
      const allCalls = await fetchStoreCallData(storeKey, 0, 0);

      if (allCalls.length > 0) {
        const { saved, errors: saveErrors } = await saveCallRecords(allCalls);
        results.callSync[storeKey] = { fetched: allCalls.length, saved };
        results.totalCallsSaved += saved;
        await updateCallSyncState(storeKey, saved);
        console.log(`[Cron] Saved ${saved} call records for ${storeKey}`);
      } else {
        results.callSync[storeKey] = { fetched: 0, saved: 0 };
      }

      // ── STEP 2: Audit new recorded calls ──
      const recordedCalls = allCalls.filter(r =>
        r.target_type === "department" &&
        r.was_recorded === "true" &&
        r.direction === "inbound" &&
        r.categories?.includes("answered")
      );

      let newAudits = 0;
      for (const call of recordedCalls) {
        if (!call.call_id) continue;

        const done = await isCallAudited(call.call_id);
        if (done) continue;

        console.log(`[Cron] Scoring call ${call.call_id}...`);
        const audit = await scoreCall(call);
        if (audit) {
          await saveAuditResult(audit);
          newAudits++;
          results.totalNewAudits++;
        }

        // Rate limit delay
        await new Promise(r => setTimeout(r, 2000));
      }

      await updateSyncState(storeKey, recordedCalls[0]?.call_id || "", newAudits);
      results.auditSync[storeKey] = { recorded: recordedCalls.length, newAudits };

    } catch (err) {
      console.error(`[Cron] Error processing ${storeKey}:`, err);
      results.errors.push({ store: storeKey, error: err.message });
    }
  }

  console.log(`[Cron] Complete: ${results.totalCallsSaved} calls saved, ${results.totalNewAudits} new audits`);
  return NextResponse.json({ success: true, ...results, timestamp: new Date().toISOString() });
}

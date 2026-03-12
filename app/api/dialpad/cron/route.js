import { NextResponse } from "next/server";
import { isCallAudited, saveAuditResult, updateSyncState } from "@/lib/supabase";
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

// Fetch recent calls for a store using the stats initiate/poll pattern
async function fetchRecentCalls(storeKey) {
  const store = STORES[storeKey];
  if (!store) return [];

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000); // Look back 2 hours

  // Initiate stats request
  const initiateRes = await fetch(`${DIALPAD_BASE}/stats`, {
    method: "POST",
    headers: dialpadHeaders(),
    body: JSON.stringify({
      days_ago_start: 0,
      days_ago_end: 0,
      stat_type: "calls",
      target_id: parseInt(store.dialpadId),
      target_type: "department",
      timezone: "America/Indiana/Indianapolis",
    }),
  });

  if (!initiateRes.ok) {
    console.error(`Stats initiate failed for ${storeKey}: ${initiateRes.status}`);
    return [];
  }

  const { request_id } = await initiateRes.json();

  // Wait for processing
  await new Promise(r => setTimeout(r, 35000));

  // Poll for results
  const pollRes = await fetch(`${DIALPAD_BASE}/stats/${request_id}`, {
    method: "GET",
    headers: dialpadHeaders(),
  });

  if (!pollRes.ok) {
    console.error(`Stats poll failed for ${storeKey}: ${pollRes.status}`);
    return [];
  }

  const pollData = await pollRes.json();
  if (pollData.status !== "complete" || !pollData.download_url) return [];

  // Download CSV
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

  // Filter to department-level recorded inbound calls
  return records.filter(r =>
    r.target_type === "department" &&
    r.was_recorded === "true" &&
    r.direction === "inbound" &&
    r.categories?.includes("answered")
  );
}

// Score a single call
async function scoreCall(call) {
  // Fetch transcript
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

  // Call Claude
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
  // Verify cron secret (optional security)
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret") || request.headers.get("authorization")?.replace("Bearer ", "");
  if (CRON_SECRET && secret !== CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = { stores: {}, totalProcessed: 0, totalNew: 0, errors: [] };

  for (const storeKey of Object.keys(STORES)) {
    try {
      console.log(`[Cron] Fetching calls for ${storeKey}...`);
      const calls = await fetchRecentCalls(storeKey);
      let newCount = 0;

      for (const call of calls) {
        if (!call.call_id) continue;

        // Skip if already audited
        const done = await isCallAudited(call.call_id);
        if (done) continue;

        console.log(`[Cron] Scoring ${call.call_id} for ${storeKey}...`);
        const audit = await scoreCall(call);
        if (audit) {
          await saveAuditResult(audit);
          newCount++;
          results.totalNew++;
        }
        results.totalProcessed++;

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 2000));
      }

      await updateSyncState(storeKey, calls[0]?.call_id || "", newCount);
      results.stores[storeKey] = { callsFound: calls.length, newAudits: newCount };
    } catch (err) {
      console.error(`[Cron] Error processing ${storeKey}:`, err);
      results.errors.push({ store: storeKey, error: err.message });
    }
  }

  console.log(`[Cron] Complete: ${results.totalNew} new audits`);
  return NextResponse.json({ success: true, ...results, timestamp: new Date().toISOString() });
}

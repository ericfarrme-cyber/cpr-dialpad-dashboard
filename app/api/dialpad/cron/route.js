import { NextResponse } from "next/server";
import { isCallAudited, saveAuditResult, updateSyncState, saveCallRecords, updateCallSyncState } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function dialpadHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
}

const AUDIT_PROMPT = `You are a phone call quality auditor for CPR Cell Phone Repair stores.

STEP 1 — CLASSIFY THE CALL:
- "opportunity": A prospective customer calling about a NEW repair, price inquiry, or the store calling out to a potential customer.
- "current_customer": An existing customer checking on repair status, picking up a device, or following up.

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

STEP 3 — EXTRACT: Employee Name, Customer Name (or "Unknown"), Device Type (or "Not mentioned"), Caller Inquiry, Outcome.

Respond ONLY with valid JSON:
{
  "call_type": "opportunity" or "current_customer",
  "employee": "Name", "customer_name": "Name or Unknown", "device_type": "Device or Not mentioned",
  "inquiry": "Brief description", "outcome": "Brief outcome",
  "criteria": { ... },
  "score": 0.00, "max_score": 4.00
}`;

async function fetchStoreCallData(storeKey, daysAgoStart = 0, daysAgoEnd = 0) {
  const store = STORES[storeKey]; if (!store) return [];
  const initRes = await fetch(`${DIALPAD_BASE}/stats`, { method: "POST", headers: dialpadHeaders(),
    body: JSON.stringify({ days_ago_start: daysAgoStart, days_ago_end: daysAgoEnd, stat_type: "calls", target_id: parseInt(store.dialpadId), target_type: "department", timezone: "America/Indiana/Indianapolis" }) });
  if (!initRes.ok) return [];
  const { request_id } = await initRes.json();
  await new Promise(r => setTimeout(r, 35000));
  const pollRes = await fetch(`${DIALPAD_BASE}/stats/${request_id}`, { method: "GET", headers: dialpadHeaders() });
  if (!pollRes.ok) return [];
  const pollData = await pollRes.json();
  if (pollData.status !== "complete" || !pollData.download_url) return [];
  const csvRes = await fetch(pollData.download_url);
  const csvText = await csvRes.text();
  const lines = csvText.split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = lines[i].match(/("([^"]*)"|[^,]*)/g)?.map(v => v.replace(/^"|"$/g, "").trim()) || [];
    const row = {}; headers.forEach((h, j) => { row[h] = values[j] || ""; }); row._storeKey = storeKey; records.push(row);
  }
  return records;
}

async function scoreCall(call) {
  const tRes = await fetch(`${DIALPAD_BASE}/transcripts/${call.call_id}`, { method: "GET", headers: dialpadHeaders() });
  if (!tRes.ok) return null;
  const tData = await tRes.json();
  let ft = "";
  if (tData.lines) ft = tData.lines.map(l => `${l.speaker||l.name||"Unknown"}: ${l.text||l.content||""}`).join("\n");
  else if (tData.transcript) ft = typeof tData.transcript === "string" ? tData.transcript : JSON.stringify(tData.transcript);
  else ft = JSON.stringify(tData);
  if (!ft || ft.length < 20) return null;

  const ctx = `\nCall Info: ${call.direction} call, ${call.external_number||"unknown"}, ${call.date_started}, Store: ${call.name||call._storeKey}\n`;
  const cRes = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1200, messages: [{ role: "user", content: `${AUDIT_PROMPT}\n${ctx}\n--- TRANSCRIPT ---\n${ft}\n--- END TRANSCRIPT ---` }] })
  });
  if (!cRes.ok) return null;
  const cData = await cRes.json();
  const text = cData.content?.[0]?.text || "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const r = m ? JSON.parse(m[0]) : null; if (!r) return null;
    return {
      call_id: call.call_id, date: call.date_started, store: call._storeKey, store_name: call.name || call._storeKey,
      call_type: r.call_type || "opportunity", employee: r.employee || "Unknown",
      customer_name: r.customer_name || "Unknown", device_type: r.device_type || "Not mentioned",
      phone: call.external_number || "", direction: call.direction || "inbound",
      talk_duration: call.talk_duration ? parseFloat(call.talk_duration) : null,
      inquiry: r.inquiry || "", outcome: r.outcome || "",
      score: r.score || 0, max_score: r.max_score || 4.0,
      criteria: r.criteria, transcript_preview: ft.substring(0, 500),
    };
  } catch { return null; }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret") || request.headers.get("authorization")?.replace("Bearer ", "");
  if (CRON_SECRET && secret !== CRON_SECRET) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results = { callSync: {}, auditSync: {}, totalCallsSaved: 0, totalNewAudits: 0, errors: [] };

  for (const storeKey of Object.keys(STORES)) {
    try {
      console.log(`[Cron] Processing ${storeKey}...`);
      const allCalls = await fetchStoreCallData(storeKey, 0, 0);
      if (allCalls.length > 0) {
        const { saved } = await saveCallRecords(allCalls);
        results.callSync[storeKey] = { fetched: allCalls.length, saved };
        results.totalCallsSaved += saved;
        await updateCallSyncState(storeKey, saved);
      } else { results.callSync[storeKey] = { fetched: 0, saved: 0 }; }

      const recorded = allCalls.filter(r => r.target_type === "department" && r.was_recorded === "true" && r.direction === "inbound" && r.categories?.includes("answered"));
      let newAudits = 0;
      for (const call of recorded) {
        if (!call.call_id) continue;
        if (await isCallAudited(call.call_id)) continue;
        console.log(`[Cron] Scoring ${call.call_id}...`);
        const audit = await scoreCall(call);
        if (audit) { await saveAuditResult(audit); newAudits++; results.totalNewAudits++; }
        await new Promise(r => setTimeout(r, 2000));
      }
      await updateSyncState(storeKey, recorded[0]?.call_id || "", newAudits);
      results.auditSync[storeKey] = { recorded: recorded.length, newAudits };
    } catch (err) { results.errors.push({ store: storeKey, error: err.message }); }
  }

  return NextResponse.json({ success: true, ...results, timestamp: new Date().toISOString() });
}

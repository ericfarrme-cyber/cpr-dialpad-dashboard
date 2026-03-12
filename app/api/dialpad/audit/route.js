import { NextResponse } from "next/server";
import { saveAuditResult, getAuditResults, getEmployeePerformance, getStorePerformance, isCallAudited, getEmployeeStatsFromAudits } from "@/lib/supabase";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;

function dialpadHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
}

const AUDIT_PROMPT = `You are a phone call quality auditor for CPR Cell Phone Repair stores.

STEP 1 — CLASSIFY THE CALL:
- "opportunity": A prospective customer calling about a NEW repair, price inquiry, or the store calling out to a potential customer. The caller does NOT already have a device being repaired.
- "current_customer": An existing customer checking on repair status, picking up a device, following up on a previous repair, or calling about a device already in the shop.

STEP 2 — SCORE BASED ON CALL TYPE:

IF call_type = "opportunity", score these 4 criteria:
1. Appointment Offered (1.25 pts): Did the employee offer to schedule an appointment?
2. Discount for Scheduling (0.92 pts): Did the employee mention any discount for booking?
3. Lifetime Warranty Mentioned (0.92 pts): Did the employee mention CPR's lifetime warranty?
4. Appointment = Faster Turnaround (0.92 pts): Did the employee explain scheduling means faster service?

IF call_type = "current_customer", score these 4 criteria:
1. Clear Status Update (1.00 pts): Did the employee give a clear update on the device/repair status?
2. ETA / Timeline Communicated (1.00 pts): Did the employee provide an estimated completion time or timeline?
3. Professional & Empathetic Tone (1.00 pts): Was the employee courteous, patient, and empathetic?
4. Next Steps Clearly Explained (1.00 pts): Did the employee clearly explain what happens next?

STEP 3 — EXTRACT INFORMATION:
- **Employee Name**: The CPR store agent who answered/made the call
- **Customer Name**: The caller's name if mentioned (or "Unknown")
- **Device Type**: Device make and model if mentioned (e.g., "iPhone 15 Pro", "Samsung S24 Ultra") or "Not mentioned"
- **Caller Inquiry**: What the call was about
- **Outcome**: Brief summary of call result

Respond ONLY with valid JSON:
{
  "call_type": "opportunity" or "current_customer",
  "employee": "Name",
  "customer_name": "Name or Unknown",
  "device_type": "Device or Not mentioned",
  "inquiry": "Brief description",
  "outcome": "Brief outcome",
  "criteria": {
    FOR opportunity calls:
    "appointment_offered": {"pass": true/false, "notes": "explanation"},
    "discount_mentioned": {"pass": true/false, "notes": "explanation"},
    "warranty_mentioned": {"pass": true/false, "notes": "explanation"},
    "faster_turnaround": {"pass": true/false, "notes": "explanation"}

    FOR current_customer calls:
    "status_update_given": {"pass": true/false, "notes": "explanation"},
    "eta_communicated": {"pass": true/false, "notes": "explanation"},
    "professional_tone": {"pass": true/false, "notes": "explanation"},
    "next_steps_explained": {"pass": true/false, "notes": "explanation"}
  },
  "score": 0.00,
  "max_score": 4.00
}`;

// GET: Read audit results, employee perf, store perf
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const store = searchParams.get("store");
  const employee = searchParams.get("employee");
  const callType = searchParams.get("callType");
  const limit = parseInt(searchParams.get("limit") || "200");
  const daysBack = parseInt(searchParams.get("days") || "30");

  if (action === "employees") {
    // Try the view first, fall back to direct computation
    let data = await getEmployeePerformance(store);
    if (!data || data.length === 0) {
      data = await getEmployeeStatsFromAudits(store);
    }
    return NextResponse.json({ success: true, employees: data });
  }

  if (action === "stores") {
    const data = await getStorePerformance();
    return NextResponse.json({ success: true, stores: data });
  }

  const data = await getAuditResults({ store, employee, callType, limit, daysBack });
  return NextResponse.json({ success: true, audits: data, count: data.length });
}

// POST: Score a single call and save to Supabase
export async function POST(request) {
  try {
    const body = await request.json();
    const { callId, callInfo } = body;

    if (!callId) return NextResponse.json({ success: false, error: "callId required" });

    const alreadyDone = await isCallAudited(callId);
    if (alreadyDone) return NextResponse.json({ success: false, error: "Call already audited", alreadyAudited: true });

    // Fetch transcript
    const transcriptRes = await fetch(`${DIALPAD_BASE}/transcripts/${callId}`, { method: "GET", headers: dialpadHeaders() });
    if (!transcriptRes.ok) {
      return NextResponse.json({ success: false, error: transcriptRes.status === 404 ? "No transcript available" : `Transcript fetch failed (${transcriptRes.status})` });
    }
    const transcriptData = await transcriptRes.json();

    let formattedTranscript = "";
    if (transcriptData.lines) {
      formattedTranscript = transcriptData.lines.map(l => `${l.speaker || l.name || "Unknown"}: ${l.text || l.content || ""}`).join("\n");
    } else if (transcriptData.transcript) {
      formattedTranscript = typeof transcriptData.transcript === "string" ? transcriptData.transcript : JSON.stringify(transcriptData.transcript);
    } else {
      formattedTranscript = JSON.stringify(transcriptData);
    }

    if (!formattedTranscript || formattedTranscript.length < 20) {
      return NextResponse.json({ success: false, error: "Transcript too short to audit" });
    }

    let context = "";
    if (callInfo) {
      context = `\nCall Info: ${callInfo.direction || ""} call, ${callInfo.external_number || "unknown"}, ${callInfo.date_started || ""}, Store: ${callInfo.name || "unknown"}\n`;
    }

    // Score with Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        messages: [{ role: "user", content: `${AUDIT_PROMPT}\n${context}\n--- TRANSCRIPT ---\n${formattedTranscript}\n--- END TRANSCRIPT ---` }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return NextResponse.json({ success: false, error: `Claude API failed (${claudeRes.status}): ${err.substring(0, 200)}` });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || "";

    let auditResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      auditResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) { auditResult = null; }

    if (!auditResult) return NextResponse.json({ success: false, error: "Could not parse audit result", raw: responseText.substring(0, 500) });

    const storeName = callInfo?.name || "";
    const storeKey = callInfo?._storeKey ||
      (storeName.toLowerCase().includes("fisher") ? "fishers" :
       storeName.toLowerCase().includes("bloom") ? "bloomington" :
       storeName.toLowerCase().includes("indian") ? "indianapolis" : "unknown");

    const saved = await saveAuditResult({
      call_id: callId,
      date: callInfo?.date_started || new Date().toISOString(),
      store: storeKey,
      store_name: storeName,
      call_type: auditResult.call_type || "opportunity",
      employee: auditResult.employee || "Unknown",
      customer_name: auditResult.customer_name || "Unknown",
      device_type: auditResult.device_type || "Not mentioned",
      phone: callInfo?.external_number || "",
      direction: callInfo?.direction || "inbound",
      talk_duration: callInfo?.talk_duration || null,
      inquiry: auditResult.inquiry || "",
      outcome: auditResult.outcome || "",
      score: auditResult.score || 0,
      max_score: auditResult.max_score || 4.0,
      criteria: auditResult.criteria,
      transcript_preview: formattedTranscript.substring(0, 500),
    });

    return NextResponse.json({
      success: true,
      audit: { ...auditResult, call_id: callId, store: storeKey, store_name: storeName, phone: callInfo?.external_number || "", date: callInfo?.date_started, saved: !!saved },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

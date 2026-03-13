import { NextResponse } from "next/server";
import { saveAuditResult, getAuditResults, getEmployeePerformance, getStorePerformance, isCallAudited, getEmployeeStatsFromAudits } from "@/lib/supabase";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;

function dialpadHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
}

const AUDIT_PROMPT = `You are a phone call quality auditor for CPR Cell Phone Repair stores.

STEP 1 — CLASSIFY THE CALL (this is critical — read carefully):

"opportunity" — The caller is asking about a NEW repair they haven't started yet. They want a price quote, availability, or to schedule a new repair. The store may also be calling out to reach a potential customer. KEY SIGNAL: the customer does NOT currently have a device at the shop.

"current_customer" — The caller ALREADY has a device at the shop, OR is calling about an existing repair/order. This includes ALL of the following:
  - Checking on repair status ("is my phone ready?")
  - Asking for an update on a device left for repair
  - Picking up a repaired device
  - Rescheduling an existing appointment
  - Canceling an existing appointment or repair
  - Following up on a back-ordered part
  - Asking about a device they previously dropped off
  - Calling about a warranty issue on a PREVIOUS repair
  - Any call where a repair ticket or prior visit is referenced

"non_scorable" — The call does not fit either category. Examples:
  - Wrong number / spam / robocall
  - Call disconnected immediately after greeting
  - Vendor or supplier call (not a customer)
  - Internal call between employees or stores
  - Transcript is too short or corrupted to evaluate

CLASSIFICATION EXAMPLES:
- "Calling to check on my Samsung that I dropped off yesterday" → current_customer
- "How much to fix an iPhone 15 screen?" → opportunity
- "I need to reschedule my appointment for tomorrow" → current_customer
- "Is my laptop ready for pickup?" → current_customer
- "Do you guys fix PS5 controllers?" → opportunity
- "I was told my part would be in today, any update?" → current_customer
- "I want to cancel, I found somewhere cheaper" → current_customer
- (garbled 5-second call with no conversation) → non_scorable

STEP 2 — SCORE BASED ON CALL TYPE:

IF call_type = "opportunity", score these 4 criteria (max 4.01 pts):
1. Appointment Offered (1.25 pts): Did the employee offer to schedule an appointment? Even suggesting "want to bring it in at a specific time?" counts.
2. Discount for Scheduling (0.92 pts): Did the employee mention any discount, deal, or savings for booking an appointment?
3. Lifetime Warranty Mentioned (0.92 pts): Did the employee mention CPR's lifetime warranty on repairs?
4. Appointment = Faster Turnaround (0.92 pts): Did the employee explain that scheduling means faster/priority service?

IF call_type = "current_customer", score these 4 criteria (max 4.00 pts):
1. Clear Status Update (1.00 pts): Did the employee give a clear, specific update on the device/repair? Not just "let me check" — they need to actually communicate the status.
2. ETA / Timeline (1.00 pts): Did the employee provide a time estimate for completion, or confirm when the device will be ready?
3. Professional & Empathetic Tone (1.00 pts): Was the employee courteous, patient, and understanding? Especially important if the customer is frustrated about delays.
4. Next Steps Explained (1.00 pts): Did the employee clearly state what happens next? ("We'll call you when it's ready", "Come in after 3pm", etc.)

IF call_type = "non_scorable", set score to 0 and max_score to 0. Still extract employee name if possible.

STEP 3 — EXTRACT:
- Employee Name: The CPR agent (who answers the phone for the store)
- Customer Name: The caller's name if stated (or "Unknown")
- Device Type: Make/model if mentioned (e.g. "iPhone 15 Pro", "PS5", "Samsung S24") or "Not mentioned"
- Inquiry: Brief description of what the call was about
- Outcome: What happened (e.g. "Customer booked appointment", "Device ready for pickup", "Price quoted, customer will call back")

Respond ONLY with valid JSON:
{
  "call_type": "opportunity" or "current_customer" or "non_scorable",
  "employee": "Name",
  "customer_name": "Name or Unknown",
  "device_type": "Device or Not mentioned",
  "inquiry": "Brief description",
  "outcome": "Brief outcome",
  "criteria": {
    FOR opportunity: "appointment_offered", "discount_mentioned", "warranty_mentioned", "faster_turnaround"
    FOR current_customer: "status_update_given", "eta_communicated", "professional_tone", "next_steps_explained"
    FOR non_scorable: empty object {}
    Each criterion: {"pass": true/false, "notes": "brief explanation"}
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
    // Delete audits by employee name
    if (body.action === "delete_by_employee") {
      if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });
      var query = supabase.from("audit_results").delete().eq("employee", body.employee);
      if (body.store) query = query.eq("store", body.store);
      var { data, error } = await query;
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, deleted: data ? data.length : 0 });
    }
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

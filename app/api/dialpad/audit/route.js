import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;

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
- **Employee Name**: The name of the CPR store employee on the call. Look for how they introduce themselves (e.g., "This is Mahmoud" or "My name is Sarah"). If multiple employees, use the primary one. If truly unknown, use "Unknown".
- **Caller Inquiry**: what the caller was asking about (e.g., "iPhone 15 screen repair quote")
- **Outcome**: brief summary of call result (e.g., "Customer booked appointment", "Customer said they'd call back", "Just a price check")
- **Overall Score**: sum of passed criteria weights (1.25 + 0.92 + 0.92 + 0.92 = 4.01 max, round to 4.00)

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

// Format Dialpad transcript data into readable text
function formatTranscript(transcriptData) {
  if (transcriptData.lines) {
    return transcriptData.lines.map(line => {
      const speaker = line.speaker || line.name || "Unknown";
      const text = line.text || line.content || "";
      return `${speaker}: ${text}`;
    }).join("\n");
  }
  if (transcriptData.transcript) {
    return typeof transcriptData.transcript === "string"
      ? transcriptData.transcript
      : JSON.stringify(transcriptData.transcript);
  }
  return JSON.stringify(transcriptData);
}

// Score a transcript with Claude
async function scoreTranscript(transcriptText, callInfo) {
  let context = "";
  if (callInfo) {
    context = `\nCall Info: ${callInfo.direction || ""} call, ${callInfo.external_number || "unknown"}, ${callInfo.date_started || ""}, Store: ${callInfo.name || "unknown"}\n`;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: `${AUDIT_PROMPT}\n${context}\n--- TRANSCRIPT ---\n${transcriptText}\n--- END TRANSCRIPT ---` }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const responseText = data.content?.[0]?.text || "";
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Could not parse Claude response");
  return JSON.parse(jsonMatch[0]);
}

// GET — read audit data from Supabase
// ?action=list — all audits (paginated)
// ?action=employees — employee performance view
// ?action=stores — store performance view
// ?action=trend — weekly trend
// ?action=recent&limit=50 — recent audits
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "recent";
  const store = searchParams.get("store");
  const limit = parseInt(searchParams.get("limit") || "50");

  if (!supabase) {
    return NextResponse.json({ success: false, error: "Supabase not configured" });
  }

  try {
    if (action === "recent") {
      const days = parseInt(searchParams.get("days") || "30");
      const since = new Date();
      since.setDate(since.getDate() - days);
      let query = supabase
        .from("audit_results")
        .select("*")
        .gte("date_started", since.toISOString())
        .order("date_started", { ascending: false })
        .limit(limit);
      if (store && store !== "all") query = query.eq("store", store);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ success: true, audits: data });
    }

    if (action === "employees") {
      let query = supabase.from("employee_performance").select("*");
      if (store && store !== "all") query = query.eq("store", store);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ success: true, employees: data });
    }

    if (action === "stores") {
      const { data, error } = await supabase.from("store_performance").select("*");
      if (error) throw error;
      return NextResponse.json({ success: true, stores: data });
    }

    if (action === "trend") {
      let query = supabase.from("weekly_trend").select("*").order("week", { ascending: false }).limit(12);
      if (store && store !== "all") query = query.eq("store", store);
      const { data, error } = await query;
      if (error) throw error;
      return NextResponse.json({ success: true, trend: data });
    }

    return NextResponse.json({ success: false, error: "Invalid action" });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

// POST — audit a single call and store result
export async function POST(request) {
  try {
    const body = await request.json();
    const { callId, callInfo } = body;

    if (!callId) {
      return NextResponse.json({ success: false, error: "callId required" });
    }

    // Check if already audited
    if (supabase) {
      const { data: existing } = await supabase
        .from("audit_results")
        .select("id")
        .eq("call_id", callId)
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ success: false, error: "Call already audited", duplicate: true });
      }
    }

    // Fetch transcript from Dialpad
    const transcriptRes = await fetch(`${DIALPAD_BASE}/transcripts/${callId}`, {
      method: "GET",
      headers: dialpadHeaders(),
    });

    if (!transcriptRes.ok) {
      // Mark as processed with no transcript
      if (supabase) {
        await supabase.from("processed_calls").upsert({ call_id: callId, status: "no_transcript" });
      }
      return NextResponse.json({ success: false, error: `No transcript available (${transcriptRes.status})` });
    }

    const transcriptData = await transcriptRes.json();
    const transcriptText = formatTranscript(transcriptData);

    if (!transcriptText || transcriptText.length < 20) {
      if (supabase) {
        await supabase.from("processed_calls").upsert({ call_id: callId, status: "no_transcript" });
      }
      return NextResponse.json({ success: false, error: "Transcript too short to audit" });
    }

    // Score with Claude
    const auditResult = await scoreTranscript(transcriptText, callInfo);

    // Build the database record
    const storeKey = callInfo?.store || callInfo?._storeKey || "";
    const record = {
      call_id: callId,
      date_started: callInfo?.date_started || new Date().toISOString(),
      store: storeKey,
      store_name: STORES[storeKey]?.name || callInfo?.name || storeKey,
      employee: auditResult.employee || "Unknown",
      phone: callInfo?.external_number || "",
      inquiry: auditResult.inquiry || "",
      outcome: auditResult.outcome || "",
      score: auditResult.score || 0,
      max_score: auditResult.max_score || 4,
      appt_offered: auditResult.criteria?.appointment_offered?.pass || false,
      appt_notes: auditResult.criteria?.appointment_offered?.notes || "",
      discount_mentioned: auditResult.criteria?.discount_mentioned?.pass || false,
      discount_notes: auditResult.criteria?.discount_mentioned?.notes || "",
      warranty_mentioned: auditResult.criteria?.warranty_mentioned?.pass || false,
      warranty_notes: auditResult.criteria?.warranty_mentioned?.notes || "",
      faster_turnaround: auditResult.criteria?.faster_turnaround?.pass || false,
      turnaround_notes: auditResult.criteria?.faster_turnaround?.notes || "",
      transcript_preview: transcriptText.substring(0, 500),
      talk_duration: callInfo?.talk_duration ? parseFloat(callInfo.talk_duration) : null,
      direction: callInfo?.direction || "inbound",
    };

    // Save to Supabase
    if (supabase) {
      const { error } = await supabase.from("audit_results").insert(record);
      if (error) {
        console.error("Supabase insert error:", error);
        // Still return the result even if DB save fails
      }
      await supabase.from("processed_calls").upsert({ call_id: callId, status: "success" });
    }

    return NextResponse.json({
      success: true,
      audit: { ...record, criteria: auditResult.criteria },
    });
  } catch (err) {
    console.error("Audit error:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

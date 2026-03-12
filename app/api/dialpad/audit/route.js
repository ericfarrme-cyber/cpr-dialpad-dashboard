import { NextResponse } from "next/server";

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
- **Employee Name**: extracted from the transcript (the CPR store agent)
- **Caller Inquiry**: what the caller was asking about (e.g., "iPhone 15 screen repair quote")
- **Outcome**: brief summary of call result (e.g., "Customer booked appointment", "Customer said they'd call back", "Just a price check")
- **Overall Score**: X.XX / 4.00

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

// GET /api/dialpad/audit?action=list&store=fishers — list recent recorded calls
// GET /api/dialpad/audit?action=transcript&callId=xxx — get transcript
// POST /api/dialpad/audit — score a transcript with Claude
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const callId = searchParams.get("callId");

  if (action === "transcript" && callId) {
    try {
      const res = await fetch(`${DIALPAD_BASE}/transcripts/${callId}`, {
        method: "GET",
        headers: dialpadHeaders(),
      });
      if (!res.ok) {
        if (res.status === 404) return NextResponse.json({ success: false, error: "No transcript available for this call" });
        return NextResponse.json({ success: false, error: `Transcript fetch failed (${res.status})` });
      }
      const data = await res.json();
      return NextResponse.json({ success: true, transcript: data });
    } catch (err) {
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  return NextResponse.json({ success: false, error: "Invalid action. Use action=transcript&callId=xxx" });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { callId, transcript, callInfo } = body;

    // If callId provided but no transcript, fetch it first
    let transcriptData = transcript;
    if (callId && !transcriptData) {
      const res = await fetch(`${DIALPAD_BASE}/transcripts/${callId}`, {
        method: "GET",
        headers: dialpadHeaders(),
      });
      if (!res.ok) {
        return NextResponse.json({ success: false, error: "Could not fetch transcript" });
      }
      transcriptData = await res.json();
    }

    if (!transcriptData) {
      return NextResponse.json({ success: false, error: "No transcript data" });
    }

    // Format transcript for Claude
    let formattedTranscript = "";
    if (transcriptData.lines) {
      formattedTranscript = transcriptData.lines.map(line => {
        const speaker = line.speaker || line.name || "Unknown";
        const text = line.text || line.content || "";
        return `${speaker}: ${text}`;
      }).join("\n");
    } else if (transcriptData.transcript) {
      formattedTranscript = typeof transcriptData.transcript === "string"
        ? transcriptData.transcript
        : JSON.stringify(transcriptData.transcript);
    } else {
      formattedTranscript = JSON.stringify(transcriptData);
    }

    // Add call context if available
    let context = "";
    if (callInfo) {
      context = `\nCall Info: ${callInfo.direction || ""} call, ${callInfo.external_number || "unknown number"}, ${callInfo.date_started || ""}, Store: ${callInfo.name || "unknown"}\n`;
    }

    // Score with Claude
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: `${AUDIT_PROMPT}\n${context}\n--- TRANSCRIPT ---\n${formattedTranscript}\n--- END TRANSCRIPT ---`
        }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return NextResponse.json({ success: false, error: `Claude API failed (${claudeRes.status}): ${err}` });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || "";

    // Parse JSON from Claude's response
    let auditResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      auditResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) {
      auditResult = null;
    }

    if (!auditResult) {
      return NextResponse.json({ success: false, error: "Could not parse audit result", raw: responseText });
    }

    return NextResponse.json({
      success: true,
      audit: {
        ...auditResult,
        call_id: callId,
        transcript_preview: formattedTranscript.substring(0, 500),
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

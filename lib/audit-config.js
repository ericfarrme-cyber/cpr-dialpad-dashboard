// ═══════════════════════════════════════════════════════════════
// lib/audit-config.js — Shared audit prompt, pre-filters, scoring config
// ═══════════════════════════════════════════════════════════════

import { STORES } from "@/lib/constants";

// ── Known store phone numbers (used to detect inter-store calls) ──
// Add all store direct lines, toll-free numbers, and extensions here.
// Format: digits only, no dashes or spaces.
var STORE_PHONE_NUMBERS = [];

// Build from STORES config if they have phone numbers
Object.values(STORES).forEach(function(s) {
  if (s.phone) STORE_PHONE_NUMBERS.push(s.phone.replace(/\D/g, ""));
  if (s.phones) s.phones.forEach(function(p) { STORE_PHONE_NUMBERS.push(p.replace(/\D/g, "")); });
});

// Manually add known store numbers if not in STORES config:
// STORE_PHONE_NUMBERS.push("3175551234"); // Fishers main
// STORE_PHONE_NUMBERS.push("3175555678"); // Indianapolis main
// STORE_PHONE_NUMBERS.push("8125559012"); // Bloomington main

// ── Pre-audit filtering ──
// Returns { pass: true } or { pass: false, reason: "..." }
export function preAuditFilter(call) {
  // 1. Inter-store call detection by phone number
  if (call.external_number) {
    var digits = call.external_number.replace(/\D/g, "");
    // Strip leading 1 for US numbers
    if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.substring(1);
    if (STORE_PHONE_NUMBERS.indexOf(digits) >= 0) {
      return { pass: false, reason: "inter_store_call", detail: "Caller number matches a CPR store: " + call.external_number };
    }
    // Also check last 10 digits in case of formatting differences
    var last10 = digits.slice(-10);
    if (STORE_PHONE_NUMBERS.some(function(sp) { return sp.slice(-10) === last10; })) {
      return { pass: false, reason: "inter_store_call", detail: "Caller number matches a CPR store: " + call.external_number };
    }
  }

  // 2. Very short calls (under 30 seconds of talk time) — likely hangups or misdials
  var talkDuration = call.talk_duration ? parseFloat(call.talk_duration) : null;
  if (talkDuration !== null && talkDuration < 30) {
    return { pass: false, reason: "too_short", detail: "Talk duration " + talkDuration + "s (< 30s minimum)" };
  }

  // 3. Outbound calls from store (we only audit inbound)
  if (call.direction && call.direction !== "inbound") {
    return { pass: false, reason: "not_inbound", detail: "Call direction: " + call.direction };
  }

  return { pass: true };
}

// ── Transcript pre-check ──
// Returns { pass: true } or { pass: false, reason: "..." }
export function transcriptPreCheck(transcript) {
  if (!transcript || transcript.length < 40) {
    return { pass: false, reason: "transcript_too_short", detail: "Transcript only " + (transcript ? transcript.length : 0) + " chars" };
  }

  // Check for inter-store indicators in transcript text
  var lower = transcript.toLowerCase();
  var interStorePatterns = [
    "this is cpr", "calling from cpr", "it's cpr", "its cpr",
    "cell phone repair calling", "this is the fishers", "this is the bloomington",
    "this is the indianapolis", "this is the noblesville", "this is the carmel",
    "store to store", "transfer from", "calling from the .* store", "the .* location"
  ];
  var interStoreHits = 0;
  interStorePatterns.forEach(function(pat) {
    if (lower.match(new RegExp(pat))) interStoreHits++;
  });
  // If strong inter-store signal in transcript
  if (interStoreHits >= 2) {
    return { pass: false, reason: "inter_store_transcript", detail: "Transcript contains multiple inter-store indicators" };
  }

  return { pass: true, interStoreHits: interStoreHits };
}

// ── The hardened audit prompt ──
export var AUDIT_PROMPT = `You are a phone call quality auditor for CPR Cell Phone Repair stores.
These scores directly impact employee evaluations. ACCURACY IS CRITICAL.

═══ STEP 1 — CLASSIFY THE CALL ═══

Read the ENTIRE transcript before classifying. Classification determines which rubric applies.

"opportunity" — A prospective customer calling about a NEW repair they have NOT started yet.
  KEY SIGNALS: price inquiry, "how much to fix...", "do you repair...", asking about availability, wanting to schedule a new repair.
  The customer does NOT currently have a device at the shop.

"current_customer" — The caller ALREADY has a device at the shop, or is calling about an EXISTING repair/order.
  KEY SIGNALS: "is my phone ready?", "I dropped off my...", "any update on...", "I need to reschedule my appointment", "cancel my appointment", "the part I ordered", "I was told to call back", "checking on repair status", warranty issue on a PREVIOUS repair.

"non_scorable" — The call does NOT involve a customer interaction that can be meaningfully scored. This includes:
  - Wrong numbers, spam, robocalls, disconnected calls
  - Vendor, supplier, or sales calls TO the store
  - Inter-store calls (one CPR location calling another — e.g. "this is CPR Fishers calling", "calling from the Bloomington store")
  - Automated messages or recordings
  - Calls too short or garbled to evaluate (no real conversation occurred)
  - Employee-to-employee or internal communications
  - Calls where the store is MAKING an outbound call to another business (not a customer)

CRITICAL CLASSIFICATION RULES:
- If ANY party identifies themselves as being from a CPR store or "Cell Phone Repair" location, this is likely inter-store → non_scorable
- If the transcript is mostly one-sided with no real customer interaction → non_scorable
- When in doubt between scorable and non_scorable, classify as non_scorable. A missed score is better than a wrong score.
- When in doubt between opportunity and current_customer, look for references to a prior visit, existing ticket, or device already at the shop.

═══ STEP 2 — ASSIGN CONFIDENCE (0-100) ═══

Rate your confidence in the CLASSIFICATION (not the score):
- 90-100: Crystal clear classification. Transcript is long, coherent, and unambiguous.
- 70-89: Fairly confident. Minor ambiguity but classification is likely correct.
- 50-69: Uncertain. Transcript is short, garbled, or could reasonably be classified differently.
- 0-49: Very uncertain. Transcript is severely garbled, extremely short, or contradictory signals.

Provide a brief reason for your confidence level.

═══ STEP 3 — SCORE BASED ON CALL TYPE ═══

IF call_type = "opportunity", score these 4 criteria (max 4.01 pts):
1. Appointment Offered (1.25 pts): Did the employee offer to schedule an appointment? Even suggesting "want to bring it in at a specific time?" counts. Must be a clear offer, not just "you can come in anytime."
2. Discount for Scheduling (0.92 pts): Did the employee mention any discount, deal, or savings for booking an appointment? Must be explicit — "we have a discount if you schedule" or "10% off if you book now."
3. Lifetime Warranty Mentioned (0.92 pts): Did the employee mention CPR's lifetime warranty on repairs? Must explicitly reference "lifetime warranty" or "warranty for life."
4. Appointment = Faster Turnaround (0.92 pts): Did the employee explain that scheduling means faster/priority service? Must connect scheduling to speed — "if you schedule, we can have it ready faster."

IF call_type = "current_customer", score these 4 criteria (max 4.00 pts):
1. Clear Status Update (1.00 pts): Did the employee give a clear, specific update on the device/repair? Not just "let me check" — they need to actually communicate where things stand.
2. ETA / Timeline (1.00 pts): Did the employee provide a time estimate for completion, or confirm when the device will be ready? Must be specific — "about an hour" or "ready by 3pm", not "soon."
3. Professional & Empathetic Tone (1.00 pts): Was the employee courteous, patient, and understanding? Give the benefit of the doubt here — only fail if clearly rude, dismissive, or unprofessional.
4. Next Steps Explained (1.00 pts): Did the employee clearly state what happens next? ("We'll call you when it's ready", "Come in after 3pm", etc.)

SCORING RULES:
- Only mark a criterion as "pass" if there is CLEAR evidence in the transcript. Ambiguous or unclear doesn't count.
- If the transcript is garbled at the point where a criterion might have been met, note this in the criterion notes and do NOT pass it.
- For tone assessment, focus on the employee's words and phrasing. Transcription artifacts don't count against them.

IF call_type = "non_scorable":
- Set score to 0 and max_score to 0
- Still extract employee name if possible

═══ STEP 4 — EXTRACT ═══
- Employee Name: The CPR agent who answers/handles the call. If unclear, "Unknown".
- Customer Name: The caller's name if stated, otherwise "Unknown".
- Device Type: Make/model if mentioned (e.g. "iPhone 15 Pro", "PS5", "Samsung S24") or "Not mentioned".
- Inquiry: Brief description of what the call was about.
- Outcome: What happened (e.g. "Customer booked appointment", "Price quoted", "Device ready for pickup").

═══ RESPONSE FORMAT ═══
Respond ONLY with valid JSON — no markdown, no explanation, no preamble:
{
  "call_type": "opportunity" or "current_customer" or "non_scorable",
  "confidence": 0-100,
  "confidence_reason": "Brief explanation of confidence level",
  "employee": "Name",
  "customer_name": "Name or Unknown",
  "device_type": "Device or Not mentioned",
  "inquiry": "Brief description",
  "outcome": "Brief outcome",
  "criteria": {
    "appointment_offered": {"pass": true/false, "notes": "evidence"},
    "discount_mentioned": {"pass": true/false, "notes": "evidence"},
    "warranty_mentioned": {"pass": true/false, "notes": "evidence"},
    "faster_turnaround": {"pass": true/false, "notes": "evidence"}
  },
  "score": 0.00,
  "max_score": 4.01
}

NOTE: criteria keys depend on call_type:
- opportunity: appointment_offered, discount_mentioned, warranty_mentioned, faster_turnaround
- current_customer: status_update_given, eta_communicated, professional_tone, next_steps_explained
- non_scorable: empty object {}`;

export default { AUDIT_PROMPT, preAuditFilter, transcriptPreCheck, STORE_PHONE_NUMBERS };

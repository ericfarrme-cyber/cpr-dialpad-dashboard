import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status) {
  return NextResponse.json(data, { status: status || 200, headers: corsHeaders() });
}

function parseSafeDate(val) {
  if (!val) return null;
  // Strip leading "Date:" prefix
  var cleaned = String(val).replace(/^Date:\s*/i, "").trim();
  if (!cleaned) return null;
  var d = new Date(cleaned);
  if (isNaN(d.getTime())) {
    // Try common formats like "3/14/26 3:47 PM"
    var m = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(.*)/);
    if (m) {
      var year = parseInt(m[3]);
      if (year < 100) year += 2000;
      d = new Date(m[1] + "/" + m[2] + "/" + year + " " + (m[4] || ""));
    }
  }
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

var GRADING_PROMPT = `You are grading a CPR Cell Phone Repair ticket for process compliance. Score each section 0-100 and explain why. Be thorough but fair — partial credit for partial documentation.

═══ SECTION 1: INTAKE / DIAGNOSTIC NOTES (0-100) ═══
The initial diagnostics section should address these questions. Not every item applies to every repair — score based on what's RELEVANT to this specific ticket:

A) PRIMARY ISSUE: What is the main problem? What did the customer report?
B) SECONDARY ISSUES: Any additional issues noted? (Only penalize if there are obvious secondary issues visible but not documented)
C) SERVICE PLANNED: What service/repair will be provided?
D) REPAIR HISTORY: Any previous repairs mentioned? (e.g. "no previous repairs" or "was repaired elsewhere before")
E) LIQUID/SPILL CHECK: Any mention of spills, submersion, or liquid damage? (e.g. "no known liquid damage" or "customer reports water exposure")
F) WARRANTY OFFERED: Was a warranty mentioned or offered?
G) PRICING: What is the total before tax? Any discounts and reasons?
H) TURNAROUND/PROMISED BY: When is the customer expecting completion or an update? (e.g. "12-24hrs", "1-2 days for part + 1-2hrs once arrived", "ready by 3pm")

Scoring:
- 90-100: 6+ of the applicable items are clearly documented
- 75-89: 4-5 items documented
- 50-74: 2-3 items documented
- 25-49: Only 1 item documented
- 0-24: Empty or essentially no diagnostic information

═══ SECTION 2: REPAIR NOTES (0-100) ═══
The repair notes should read as if someone is taking over the repair. They should document:

A) PRETEST: What was pretested before starting? (if device was functional enough to pretest)
B) SERVICE PROVIDED: What repair/service was actually performed?
C) NEW FINDINGS: Any new details discovered during the repair? (e.g. "found water damage indicators tripped", "battery was swollen")
D) CUSTOMER COMMUNICATION: What has the customer been told along the way? Any updates given during the repair process?
E) POST-TEST: What was post-tested after the repair? (e.g. "tested all functions", "screen, touch, Face ID all working")

Scoring:
- 90-100: Service provided + post-test + at least 1-2 other items documented
- 70-89: Service provided clearly documented, plus post-test OR new findings
- 50-69: Service provided is documented but minimal detail, missing post-test
- 25-49: Notes exist but vague — unclear what was actually done
- 0-24: No repair notes or completely irrelevant

═══ SECTION 3: PICKUP NOTES (0-100) ═══
The pickup/completion notes should confirm the customer knows their device is ready:

A) CUSTOMER CONTACTED: Is the customer aware the device is ready? Look for:
   - "Called customer, ready for pickup"
   - "Texted customer repair complete"
   - "Left voicemail, device is ready"
   - "Customer VM not setup, auto email sent"
   EXCEPTION: If customer is waiting in store, returning soon, or was told a specific time and it's within that window, this counts as FULL CREDIT.

B) CUSTOMER INFORMED OF WORK: Does the customer know what was done and what they're paying for?

C) PICKUP TIMING: Any indication of when the customer is picking up? (e.g. "customer picking up today", "will return tomorrow")

Scoring:
- 90-100: Customer contacted + informed of what was done + pickup timing noted
- 70-89: Customer contacted and at least partially informed
- 50-69: Customer contacted but no detail on what was communicated
- 25-49: Some indication but unclear if customer actually knows device is ready
- 0-24: No evidence customer was notified at all

═══ SECTION 4: PAYMENT / DOWN PAYMENT (0-100) ═══
This ONLY applies if parts needed to be ordered. If no parts were ordered, mark "payment_not_applicable": true, score 100, and EXCLUDE from overall score.

Look at ticket items, notes, and transactions for ANY indication a part was ordered, back-ordered, or special-ordered.

INSURANCE CLAIM EXCEPTION: If the ticket appears to be an insurance claim (look for mentions of "insurance", "claim", "deductible", "Asurion", "warranty claim", carrier names like "Verizon claim", etc. in the notes, items, or ticket type), payment is typically invoiced/paid at a later date. In this case, mark "payment_not_applicable": true, score 100, and note "Insurance claim — payment invoiced separately."

TIMING IS CRITICAL: The down payment is our collateral. It must be collected at or very near ticket intake — within about 2 hours. Compare transaction/payment dates against the ticket creation date.

Scoring if parts were ordered (non-insurance):
- 100: Down payment or full payment collected within ~2 hours of ticket creation
- 50: Payment collected but more than 2 hours after intake
- 0: Part ordered with NO down payment, or payment only collected days later

If NO parts were ordered:
- Mark "payment_not_applicable": true and score 100

═══ SECTION 5: CONTACT INFORMATION (0-100) ═══
Check the customer information on the ticket for completeness:

A) FULL NAME: Does the customer have a first AND last name on file? (Not just a first name or a company name with no contact person)
B) PHONE NUMBER: Is there a main phone number?
C) ALTERNATE PHONE: Is there a second/alternate phone number? This is BONUS credit — employees who take the time to collect an alternate number are going above and beyond. Look at the "All Phones" field — if there are 2+ phone numbers listed, the alternate was collected.
D) EMAIL ADDRESS: Is there a REAL email address on file? 

   FAKE EMAIL DETECTION: Employees sometimes enter fake/placeholder emails to bypass required fields. The following are NOT real emails and should be scored as NO email:
   - none@gmail.com, none@yahoo.com, none@anything
   - declined@gmail.com, declined@anything
   - no@gmail.com, na@gmail.com, noemail@gmail.com
   - test@test.com, fake@fake.com, asdf@gmail.com
   - Any email starting with "none", "declined", "noemail", "na@", "no@", "test@test"
   - Any email containing "decline" or "noneemail"
   
   A REAL email ensures customers get automated Ready for Pickup notifications if we can't reach them by phone. This is important.

Scoring:
- 95-100: Full name + phone + REAL email + alternate phone (above and beyond)
- 85-94: Full name + phone + REAL email (no alternate, but solid)
- 70-84: Name + phone present, real email missing but alternate phone collected
- 55-69: Name + phone present, no real email, no alternate phone
- 25-54: Minimal info — only a name or only a phone number
- 0-24: Customer info is essentially empty or placeholder

═══ RESPONSE FORMAT ═══
Respond ONLY with this exact JSON format, no other text:
{
  "diagnostics_score": <number 0-100>,
  "diagnostics_notes": "<brief explanation — mention which items were found or missing>",
  "diagnostics_issue_found": <true/false>,
  "diagnostics_price_found": <true/false>,
  "diagnostics_turnaround_found": <true/false>,
  "diagnostics_history_noted": <true/false>,
  "diagnostics_liquid_check": <true/false>,
  "diagnostics_warranty_offered": <true/false>,
  "diagnostics_service_planned": <true/false>,
  "repair_notes_score": <number 0-100>,
  "repair_notes_detail": "<brief explanation>",
  "repair_pretest_documented": <true/false>,
  "repair_service_documented": <true/false>,
  "repair_findings_documented": <true/false>,
  "repair_communication_documented": <true/false>,
  "repair_posttest_documented": <true/false>,
  "pickup_score": <number 0-100>,
  "pickup_notes": "<brief explanation>",
  "pickup_customer_contacted": <true/false>,
  "pickup_customer_informed": <true/false>,
  "pickup_timing_noted": <true/false>,
  "payment_score": <number 0-100>,
  "payment_notes": "<brief explanation>",
  "payment_not_applicable": <true/false>,
  "contact_score": <number 0-100>,
  "contact_notes": "<brief explanation>",
  "contact_name_present": <true/false>,
  "contact_phone_present": <true/false>,
  "contact_email_present": <true/false>,
  "contact_alternate_phone": <true/false>,
  "overall_score": <number 0-100>,
  "confidence": <number 0-100>
}

The overall_score should be calculated as:
- If payment applies: Intake 25% + Repair Notes 25% + Pickup 20% + Payment 20% + Contact 5% (= 95%, round remaining 5% into Intake making it 30%)
- If payment is not applicable: Intake 30% + Repair Notes 35% + Pickup 25% + Contact 5% (= 95%, round remaining 5% into Repair making it 40%)
Simplified:
- If payment applies: Intake 30% + Repair Notes 25% + Pickup 20% + Payment 20% + Contact 5%
- If payment is not applicable: Intake 30% + Repair Notes 40% + Pickup 25% + Contact 5%`;

export async function GET(request) {
  if (!supabase) return jsonResponse({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action");
  var store = searchParams.get("store");
  var employee = searchParams.get("employee");
  var limit = parseInt(searchParams.get("limit") || "100");

  if (action === "list") {
    var query = supabase.from("ticket_grades").select("*").order("date_closed", { ascending: false }).limit(limit);
    if (store) query = query.eq("store", store);
    if (employee) query = query.or("employee_added.eq." + employee + ",employee_repaired.eq." + employee);
    var { data, error } = await query;
    if (error) return jsonResponse({ success: false, error: error.message });
    return jsonResponse({ success: true, tickets: data || [] });
  }

  if (action === "stats") {
    var query = supabase.from("ticket_grades").select("store, employee_added, employee_repaired, overall_score, diagnostics_score, payment_score, notes_score, categorization_score");
    if (store) query = query.eq("store", store);
    var { data, error } = await query;
    if (error) return jsonResponse({ success: false, error: error.message });

    var tickets = data || [];
    var total = tickets.length;
    if (total === 0) return jsonResponse({ success: true, stats: { total: 0 } });

    var avgOverall = Math.round(tickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / total);
    var avgDiag = Math.round(tickets.reduce(function(s, t) { return s + (t.diagnostics_score || 0); }, 0) / total);
    var avgPay = Math.round(tickets.reduce(function(s, t) { return s + (t.payment_score || 0); }, 0) / total);
    var avgNotes = Math.round(tickets.reduce(function(s, t) { return s + (t.notes_score || 0); }, 0) / total);
    var avgCategorization = Math.round(tickets.reduce(function(s, t) { return s + (t.categorization_score || 0); }, 0) / total);

    // Per-employee stats
    var empMap = {};
    tickets.forEach(function(t) {
      var emp = t.employee_repaired || t.employee_added || "Unknown";
      if (!empMap[emp]) empMap[emp] = { name: emp, scores: [], count: 0 };
      empMap[emp].scores.push(t.overall_score || 0);
      empMap[emp].count++;
    });
    var empStats = Object.values(empMap).map(function(e) {
      e.avg_score = Math.round(e.scores.reduce(function(s, v) { return s + v; }, 0) / e.count);
      return e;
    }).sort(function(a, b) { return b.avg_score - a.avg_score; });

    // Per-store stats
    var storeMap = {};
    tickets.forEach(function(t) {
      var sk = t.store || "unknown";
      if (!storeMap[sk]) storeMap[sk] = { store: sk, scores: [], count: 0 };
      storeMap[sk].scores.push(t.overall_score || 0);
      storeMap[sk].count++;
    });
    var storeStats = Object.values(storeMap).map(function(s) {
      s.avg_score = Math.round(s.scores.reduce(function(sum, v) { return sum + v; }, 0) / s.count);
      return s;
    });

    return jsonResponse({
      success: true,
      stats: { total: total, avgOverall: avgOverall, avgDiag: avgDiag, avgPay: avgPay, avgNotes: avgNotes, avgCategorization: avgCategorization, empStats: empStats, storeStats: storeStats }
    });
  }

  return jsonResponse({ success: false, error: "Invalid action" });
}

export async function POST(request) {
  if (!supabase) return jsonResponse({ success: false, error: "Supabase not configured" });
  var body = await request.json();

  if (body.action === "grade") {
    var ticket = body.ticket;
    if (!ticket || !ticket.ticket_number) return jsonResponse({ success: false, error: "ticket_number required" });

    // Resolve employee names against roster
    console.log("[tickets] Incoming employee_added:", JSON.stringify(ticket.employee_added), "employee_repaired:", JSON.stringify(ticket.employee_repaired), "store:", JSON.stringify(ticket.store));
    var rosterRes = await supabase.from("employee_roster").select("name, store, aliases, role").eq("active", true);
    if (rosterRes.error) {
      console.error("[tickets] Roster query FAILED:", rosterRes.error.message, rosterRes.error.code, rosterRes.error.hint);
    }
    var rosterList = rosterRes.data || [];
    console.log("[tickets] Roster returned", rosterList.length, "entries:", rosterList.map(function(r) { return r.name + " (" + r.store + ")"; }));
    var rosterLookup = {};
    rosterList.forEach(function(r) {
      rosterLookup[r.name.toLowerCase()] = r;
      var parts = r.name.split(/\s+/);
      parts.forEach(function(p) { if (p.length >= 3) rosterLookup[p.toLowerCase()] = r; });
      (r.aliases || []).forEach(function(a) { if (a) rosterLookup[a.toLowerCase()] = r; });
    });
    console.log("[tickets] Lookup keys:", Object.keys(rosterLookup).join(", "));
    function resolveEmpName(raw) {
      if (!raw) return { name: raw, store: "" };
      var lower = raw.toLowerCase().trim();
      console.log("[tickets] resolveEmpName input:", JSON.stringify(raw), "-> lower:", JSON.stringify(lower));
      // Handle "Last, First" format -> try both orderings
      if (lower.includes(",")) {
        var cp = lower.split(",").map(function(s){return s.trim();});
        // Try "First Last"
        var flipped = cp[1] ? cp[1] + " " + cp[0] : cp[0];
        if (rosterLookup[flipped]) return { name: rosterLookup[flipped].name, store: rosterLookup[flipped].store };
        // Try each part
        for (var ci = 0; ci < cp.length; ci++) {
          if (cp[ci].length >= 3 && rosterLookup[cp[ci]]) return { name: rosterLookup[cp[ci]].name, store: rosterLookup[cp[ci]].store };
        }
        lower = flipped; // use flipped for further matching
      }
      if (rosterLookup[lower]) { console.log("[tickets] MATCH exact:", lower); return { name: rosterLookup[lower].name, store: rosterLookup[lower].store }; }
      // Try each word individually
      var words = lower.split(/\s+/);
      for (var w = 0; w < words.length; w++) {
        if (words[w].length >= 3 && rosterLookup[words[w]]) { console.log("[tickets] MATCH word:", words[w]); return { name: rosterLookup[words[w]].name, store: rosterLookup[words[w]].store }; }
      }
      // Prefix match
      for (var key in rosterLookup) {
        if (key.length >= 3 && (key.startsWith(lower) || lower.startsWith(key))) { console.log("[tickets] MATCH prefix:", key); return { name: rosterLookup[key].name, store: rosterLookup[key].store }; }
      }
      console.log("[tickets] NO MATCH for:", JSON.stringify(raw));
      return { name: raw, store: "" };
    }
    var resolvedAdded = resolveEmpName(ticket.employee_added);
    var resolvedRepaired = resolveEmpName(ticket.employee_repaired);
    ticket.employee_added = resolvedAdded.name;
    ticket.employee_repaired = resolvedRepaired.name;
    // ALWAYS derive store from roster — the extension's store detection is unreliable
    var rosterStore = resolvedRepaired.store || resolvedAdded.store;
    if (rosterStore) ticket.store = rosterStore;
    console.log("[tickets] RESOLVED -> added:", JSON.stringify(ticket.employee_added), "repaired:", JSON.stringify(ticket.employee_repaired), "store:", JSON.stringify(ticket.store));

    // Build the prompt with ticket data
    var ticketContext = "TICKET #" + ticket.ticket_number + "\n";
    ticketContext += "Type: " + (ticket.ticket_type || "Unknown") + "\n";
    ticketContext += "Store: " + (ticket.store || "Unknown") + "\n";
    ticketContext += "Employee Added: " + (ticket.employee_added || "Unknown") + "\n";
    ticketContext += "Employee Repaired: " + (ticket.employee_repaired || "Unknown") + "\n";
    ticketContext += "Device: " + (ticket.device || "Unknown") + "\n";
    ticketContext += "Date Created (Intake): " + (ticket.date_created || "Unknown") + "\n";
    ticketContext += "Date Closed: " + (ticket.date_closed || "Unknown") + "\n\n";
    ticketContext += "CUSTOMER CONTACT INFO:\n";
    ticketContext += "Name: " + (ticket.customer_name || "(not found)") + "\n";
    ticketContext += "Phone: " + (ticket.customer_phone || "(not found)") + "\n";
    ticketContext += "All Phones: " + (ticket.customer_phones_all && ticket.customer_phones_all.length > 0 ? ticket.customer_phones_all.join(", ") : "(none)") + "\n";
    ticketContext += "Email: " + (ticket.customer_email || "(not found)") + "\n\n";
    ticketContext += "INITIAL DIAGNOSTICS:\n" + (ticket.raw_diagnostics || "(none)") + "\n\n";
    ticketContext += "TICKET ITEMS:\n" + (ticket.raw_items || "(none)") + "\n\n";
    ticketContext += "TICKET NOTES:\n" + (ticket.raw_notes || "(none)") + "\n\n";
    ticketContext += "TRANSACTIONS/PAYMENTS:\n" + (ticket.raw_transactions || "(none)") + "\n";

    try {
      var apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1500,
          messages: [
            { role: "user", content: GRADING_PROMPT + "\n\n" + ticketContext }
          ]
        })
      });
      var apiJson = await apiRes.json();
      var text = (apiJson.content && apiJson.content[0]) ? apiJson.content[0].text : "";
      var cleaned = text.replace(/```json|```/g, "").trim();
      var grade = JSON.parse(cleaned);

      // Save to Supabase — map new grading structure to existing columns
      var record = {
        ticket_number: ticket.ticket_number,
        ticket_type: ticket.ticket_type || "",
        store: ticket.store || "",
        employee_added: ticket.employee_added || "",
        employee_repaired: ticket.employee_repaired || "",
        customer_name: ticket.customer_name || "",
        customer_phone: ticket.customer_phone ? ticket.customer_phone.replace(/\D/g, "").slice(-10) : "",
        customer_phones_all: ticket.customer_phones_all || [],
        device: ticket.device || "",
        date_closed: parseSafeDate(ticket.date_closed),
        gross_sales: parseFloat(ticket.gross_sales || 0),
        gross_profit: parseFloat(ticket.gross_profit || 0),
        gpm_pct: parseFloat(ticket.gpm_pct || 0),
        overall_score: grade.overall_score || 0,
        // Section 1: Intake/Diagnostics
        diagnostics_score: grade.diagnostics_score || 0,
        diagnostics_notes: grade.diagnostics_notes || "",
        // Section 2: Repair Notes → stored in notes_score/notes_detail
        notes_score: grade.repair_notes_score || 0,
        notes_detail: grade.repair_notes_detail || "",
        notes_outcome_documented: !!grade.repair_service_documented,
        notes_customer_contacted: !!grade.pickup_customer_contacted,
        // Section 3: Pickup → stored in categorization_score/categorization_notes
        categorization_score: grade.pickup_score || 0,
        categorization_notes: grade.pickup_notes || "",
        // Section 4: Payment
        payment_score: grade.payment_score || 0,
        payment_notes: grade.payment_notes || (grade.payment_not_applicable ? "Payment N/A — no parts ordered" : ""),
        raw_diagnostics: ticket.raw_diagnostics || "",
        raw_notes: ticket.raw_notes || "",
        raw_items: ticket.raw_items || "",
        raw_transactions: ticket.raw_transactions || "",
        confidence: grade.confidence || 0,
        contact_score: grade.contact_score || 0,
        contact_notes: grade.contact_notes || "",
        graded_by: "extension",
      };

      var { data, error } = await supabase.from("ticket_grades")
        .upsert(record, { onConflict: "ticket_number" }).select();
      if (error) return jsonResponse({ success: false, error: error.message });

      return jsonResponse({ success: true, grade: grade, saved: data?.[0] });
    } catch (err) {
      console.error("Grading error:", err);
      return jsonResponse({ success: false, error: err.message });
    }
  }

  if (body.action === "delete") {
    var { id } = body;
    if (!id) return jsonResponse({ success: false, error: "id required" });
    var { error } = await supabase.from("ticket_grades").delete().eq("id", id);
    if (error) return jsonResponse({ success: false, error: error.message });
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, error: "Invalid action" });
}

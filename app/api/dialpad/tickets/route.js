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

var GRADING_PROMPT = `You are grading a CPR Cell Phone Repair ticket for process compliance. Score each applicable category 0-100 and explain why.

COMPLIANCE CRITERIA:

1. INTAKE DIAGNOSTICS (0-100): The initial diagnostics section must document THREE things:
   A) ISSUE: What is wrong with the device? What did the customer report?
   B) PRICE: Was the customer quoted a price or was pricing documented?
   C) TURNAROUND TIME: Was the customer given an estimated turnaround/completion time?

Scoring:
- 90-100: All three (issue, price, turnaround time) are clearly documented
- 70-89: Two of the three are documented
- 40-69: Only one is documented
- 0-39: None or essentially empty diagnostics

2. TICKET NOTES (0-100): The notes section at the bottom of the ticket must document TWO things:
   A) REPAIR OUTCOME: Was the repair successful? What was the result? What was encountered during repair? (e.g. "fully repaired, working as intended RFP!" or "unable to repair, board level damage" or "replaced screen, tested all functions")
   B) CUSTOMER NOTIFIED OF COMPLETION: From the customer's perspective — would they know their repair is done and ready for pickup? Look for notes indicating the customer was contacted AFTER the repair was completed to let them know. (e.g. "Called customer, phone is ready for pickup" or "Texted customer repair complete" or "Left voicemail, repair finished" or "Customer VM not setup, auto email sent about completion")
   
   EXCEPTION: If the notes indicate the customer is already aware and returning (e.g. "customer is returning soon", "customer waiting in store", "customer is on their way", "customer will be back shortly", "customer picking up today"), this counts as FULL CREDIT for customer notification — no contact attempt needed because the customer already knows.
   
   Simply documenting the repair outcome is NOT enough — the employee must have also attempted to notify the customer OR documented that the customer is already aware/returning.

Scoring:
- 90-100: BOTH repair outcome AND customer notification of completion are clearly documented
- 70-89: One of the two is documented well, the other is vague or implied
- 40-69: Only one is documented, the other is missing entirely
- 10-39: Notes exist but neither outcome nor completion notification is clearly stated
- 0-9: No notes at all or completely irrelevant notes

3. PAYMENT/DOWN PAYMENT: This criteria ONLY applies if parts needed to be ordered. If no parts were ordered, mark "payment_not_applicable": true, score 100, and EXCLUDE this category entirely from the overall score.

   Look at the ticket items, notes, and transactions for ANY indication that a part was ordered, back-ordered, or needed to be special-ordered.
   
   TIMING IS CRITICAL: The down payment is our collateral for ordering the part. It must be collected at or very near the time of ticket intake — within about 2 hours. Compare the transaction/payment dates against the ticket creation date.
   
   Scoring if parts were ordered:
   - 100: Down payment or full payment collected within ~2 hours of ticket creation
   - 50: Payment was collected but more than 2 hours after intake
   - 0: Part ordered with NO down payment, or payment only collected days later / after part arrived

   If NO parts were ordered:
   - Mark as "payment_not_applicable": true and score as 100

Respond ONLY with this exact JSON format, no other text:
{
  "diagnostics_score": <number 0-100>,
  "diagnostics_notes": "<brief explanation — mention which of issue/price/turnaround were found or missing>",
  "diagnostics_issue_found": <true/false>,
  "diagnostics_price_found": <true/false>,
  "diagnostics_turnaround_found": <true/false>,
  "notes_score": <number 0-100>,
  "notes_detail": "<brief explanation>",
  "notes_outcome_documented": <true/false>,
  "notes_customer_contacted": <true/false>,
  "payment_score": <number 0-100>,
  "payment_notes": "<brief explanation>",
  "payment_not_applicable": <true/false>,
  "overall_score": <number 0-100>,
  "confidence": <number 0-100>
}

The overall_score should be calculated as:
- If payment applies: Diagnostics 35% + Notes 40% + Payment 25%
- If payment is not applicable: Diagnostics 45% + Notes 55%`;

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
    var query = supabase.from("ticket_grades").select("store, employee_added, employee_repaired, overall_score, diagnostics_score, payment_score, notes_score");
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
      stats: { total: total, avgOverall: avgOverall, avgDiag: avgDiag, avgPay: avgPay, avgNotes: avgNotes, empStats: empStats, storeStats: storeStats }
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
    var rosterRes = await supabase.from("employee_roster").select("name, store, aliases, role").eq("active", true);
    var rosterList = rosterRes.data || [];
    var rosterLookup = {};
    var lastNameLookup = {};
    rosterList.forEach(function(r) {
      rosterLookup[r.name.toLowerCase()] = r;
      var parts = r.name.split(/\s+/);
      parts.forEach(function(p) { if (p.length >= 3) rosterLookup[p.toLowerCase()] = r; });
      (r.aliases || []).forEach(function(a) { if (a) rosterLookup[a.toLowerCase()] = r; });
    });
    function resolveEmpName(raw) {
      if (!raw) return { name: raw, store: "" };
      var lower = raw.toLowerCase().trim();
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
      if (rosterLookup[lower]) return { name: rosterLookup[lower].name, store: rosterLookup[lower].store };
      // Try each word individually
      var words = lower.split(/\s+/);
      for (var w = 0; w < words.length; w++) {
        if (words[w].length >= 3 && rosterLookup[words[w]]) return { name: rosterLookup[words[w]].name, store: rosterLookup[words[w]].store };
      }
      // Prefix match
      for (var key in rosterLookup) {
        if (key.length >= 3 && (key.startsWith(lower) || lower.startsWith(key))) return { name: rosterLookup[key].name, store: rosterLookup[key].store };
      }
      return { name: raw, store: "" };
    }
    var resolvedAdded = resolveEmpName(ticket.employee_added);
    var resolvedRepaired = resolveEmpName(ticket.employee_repaired);
    ticket.employee_added = resolvedAdded.name;
    ticket.employee_repaired = resolvedRepaired.name;
    // ALWAYS derive store from roster — the extension's store detection is unreliable
    var rosterStore = resolvedRepaired.store || resolvedAdded.store;
    if (rosterStore) ticket.store = rosterStore;

    // Build the prompt with ticket data
    var ticketContext = "TICKET #" + ticket.ticket_number + "\n";
    ticketContext += "Type: " + (ticket.ticket_type || "Unknown") + "\n";
    ticketContext += "Store: " + (ticket.store || "Unknown") + "\n";
    ticketContext += "Employee Added: " + (ticket.employee_added || "Unknown") + "\n";
    ticketContext += "Employee Repaired: " + (ticket.employee_repaired || "Unknown") + "\n";
    ticketContext += "Device: " + (ticket.device || "Unknown") + "\n";
    ticketContext += "Date: " + (ticket.date_closed || "Unknown") + "\n\n";
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
          max_tokens: 800,
          messages: [
            { role: "user", content: GRADING_PROMPT + "\n\n" + ticketContext }
          ]
        })
      });
      var apiJson = await apiRes.json();
      var text = (apiJson.content && apiJson.content[0]) ? apiJson.content[0].text : "";
      var cleaned = text.replace(/```json|```/g, "").trim();
      var grade = JSON.parse(cleaned);

      // Save to Supabase
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
        diagnostics_score: grade.diagnostics_score || 0,
        diagnostics_notes: grade.diagnostics_notes || "",
        payment_score: grade.payment_score || 0,
        payment_notes: grade.payment_notes || "",
        notes_score: grade.notes_score || 0,
        notes_detail: grade.notes_detail || "",
        notes_outcome_documented: !!grade.notes_outcome_documented,
        notes_customer_contacted: !!grade.notes_customer_contacted,
        categorization_score: 0,
        categorization_notes: grade.payment_not_applicable ? "Payment N/A — no parts ordered" : "",
        raw_diagnostics: ticket.raw_diagnostics || "",
        raw_notes: ticket.raw_notes || "",
        raw_items: ticket.raw_items || "",
        raw_transactions: ticket.raw_transactions || "",
        confidence: grade.confidence || 0,
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

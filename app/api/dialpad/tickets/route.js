import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

var GRADING_PROMPT = `You are grading a CPR Cell Phone Repair ticket for process compliance. Score each category 0-100 and explain why.

COMPLIANCE CRITERIA:

1. INTAKE DIAGNOSTICS (0-100): Did the tech properly document initial diagnostics?
- 90-100: Detailed description of device condition, issue reported, tests performed, liquid damage check, pretestable status noted
- 60-89: Basic diagnostics present but missing some detail
- 30-59: Minimal diagnostics, vague or incomplete
- 0-29: No diagnostics or essentially empty

2. PAYMENT/DOWN PAYMENT (0-100): If parts were ordered, was a down payment collected?
- 100: Part ordered AND down payment collected, OR no parts needed to order (repair done same-day with in-stock parts)
- 70: Part ordered with partial payment
- 30: Part ordered but no down payment collected
- N/A: Mark as 100 if no parts were ordered (same-day repair with stock parts)

3. TICKET NOTES (0-100): The notes section at the bottom of the ticket must document TWO things:
   A) REPAIR OUTCOME: Was the repair successful? What was the result? (e.g. "fully repaired, working as intended RFP!" or "unable to repair, board level damage")
   B) CUSTOMER CONTACT: Did they attempt to contact the customer to let them know the status? (e.g. "Customer VM inbox not setup, unable to contact. Auto email sent." or "Called customer, left voicemail about pickup" or "Texted customer repair is complete")

Scoring:
- 90-100: BOTH repair outcome AND customer contact attempt are clearly documented in notes
- 70-89: One of the two is documented well, the other is vague or implied
- 40-69: Only one is documented, the other is missing entirely
- 10-39: Notes exist but neither outcome nor contact is clearly stated
- 0-9: No notes at all or completely irrelevant notes

4. CATEGORIZATION (0-100): Is the ticket properly categorized?
- 100: Correct ticket type (Repair/Claim/Sale), correct catalog items, proper device info
- 70: Mostly correct but minor issues
- 30: Significant categorization errors
- 0: Wrong type or uncategorized

Respond ONLY with this exact JSON format, no other text:
{
  "diagnostics_score": <number>,
  "diagnostics_notes": "<brief explanation>",
  "payment_score": <number>,
  "payment_notes": "<brief explanation>",
  "notes_score": <number>,
  "notes_detail": "<brief explanation>",
  "notes_outcome_documented": <true/false>,
  "notes_customer_contacted": <true/false>,
  "categorization_score": <number>,
  "categorization_notes": "<brief explanation>",
  "overall_score": <number>,
  "confidence": <number 0-100>
}

The overall_score should be the weighted average: Diagnostics 30%, Notes 30%, Payment 20%, Categorization 20%.`;

export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });
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
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, tickets: data || [] });
  }

  if (action === "stats") {
    var query = supabase.from("ticket_grades").select("store, employee_added, employee_repaired, overall_score, diagnostics_score, payment_score, notes_score, categorization_score");
    if (store) query = query.eq("store", store);
    var { data, error } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message });

    var tickets = data || [];
    var total = tickets.length;
    if (total === 0) return NextResponse.json({ success: true, stats: { total: 0 } });

    var avgOverall = Math.round(tickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / total);
    var avgDiag = Math.round(tickets.reduce(function(s, t) { return s + (t.diagnostics_score || 0); }, 0) / total);
    var avgPay = Math.round(tickets.reduce(function(s, t) { return s + (t.payment_score || 0); }, 0) / total);
    var avgNotes = Math.round(tickets.reduce(function(s, t) { return s + (t.notes_score || 0); }, 0) / total);
    var avgCat = Math.round(tickets.reduce(function(s, t) { return s + (t.categorization_score || 0); }, 0) / total);

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

    return NextResponse.json({
      success: true,
      stats: { total: total, avgOverall: avgOverall, avgDiag: avgDiag, avgPay: avgPay, avgNotes: avgNotes, avgCat: avgCat, empStats: empStats, storeStats: storeStats }
    });
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

export async function POST(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });
  var body = await request.json();

  if (body.action === "grade") {
    var ticket = body.ticket;
    if (!ticket || !ticket.ticket_number) return NextResponse.json({ success: false, error: "ticket_number required" });

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
        device: ticket.device || "",
        date_closed: ticket.date_closed || null,
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
        categorization_score: grade.categorization_score || 0,
        categorization_notes: grade.categorization_notes || "",
        raw_diagnostics: ticket.raw_diagnostics || "",
        raw_notes: ticket.raw_notes || "",
        raw_items: ticket.raw_items || "",
        raw_transactions: ticket.raw_transactions || "",
        confidence: grade.confidence || 0,
        graded_by: "extension",
      };

      var { data, error } = await supabase.from("ticket_grades")
        .upsert(record, { onConflict: "ticket_number" }).select();
      if (error) return NextResponse.json({ success: false, error: error.message });

      return NextResponse.json({ success: true, grade: grade, saved: data?.[0] });
    } catch (err) {
      console.error("Grading error:", err);
      return NextResponse.json({ success: false, error: err.message });
    }
  }

  if (body.action === "delete") {
    var { id } = body;
    if (!id) return NextResponse.json({ success: false, error: "id required" });
    var { error } = await supabase.from("ticket_grades").delete().eq("id", id);
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status) {
  return NextResponse.json(data, { status: status || 200, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// Normalize phone to last 10 digits
function normPhone(p) {
  if (!p) return "";
  return String(p).replace(/\D/g, "").slice(-10);
}

export async function GET(request) {
  if (!supabase) return jsonResponse({ success: false, error: "Supabase not configured" });

  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action") || "journeys";
  var store = searchParams.get("store");
  var phone = searchParams.get("phone");
  var days = parseInt(searchParams.get("days") || "30");

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffISO = cutoff.toISOString();

  // ─── SINGLE CUSTOMER JOURNEY ───
  if (action === "lookup" && phone) {
    var normalized = normPhone(phone);
    if (normalized.length !== 10) return jsonResponse({ success: false, error: "Invalid phone number" });

    // Get all audits for this phone
    var { data: audits, error: aErr } = await supabase
      .from("audit_results")
      .select("call_id, employee, store, score, call_type, inquiry, outcome, date_started, talk_duration, confidence, transcript_preview, appt_offered, discount_mentioned, warranty_mentioned")
      .or("external_number.ilike.%" + normalized + ",external_number.ilike.%+" + normalized)
      .order("date_started", { ascending: false })
      .limit(50);
    if (aErr) console.error("[journey] Audit query error:", aErr.message);

    // Get all tickets for this phone
    var { data: tickets, error: tErr } = await supabase
      .from("ticket_grades")
      .select("id, ticket_number, store, employee_added, employee_repaired, customer_name, customer_phone, device, date_closed, overall_score, diagnostics_score, notes_score, categorization_score, payment_score, diagnostics_notes, notes_detail, categorization_notes, payment_notes")
      .or("customer_phone.eq." + normalized + ",customer_phones_all.cs.{" + normalized + "}")
      .order("date_closed", { ascending: false })
      .limit(50);
    if (tErr) console.error("[journey] Ticket query error:", tErr.message);

    // Build timeline
    var timeline = [];
    (audits || []).forEach(function(a) {
      timeline.push({
        type: "call",
        date: a.date_started,
        score: parseFloat(a.score || 0),
        employee: a.employee,
        store: a.store,
        detail: a.inquiry || "",
        outcome: a.outcome || "",
        call_type: a.call_type,
        duration: a.talk_duration,
        data: a,
      });
    });
    (tickets || []).forEach(function(t) {
      timeline.push({
        type: "ticket",
        date: t.date_closed,
        score: t.overall_score || 0,
        employee: t.employee_repaired || t.employee_added,
        store: t.store,
        detail: t.device || "",
        ticket_number: t.ticket_number,
        customer_name: t.customer_name,
        data: t,
      });
    });
    timeline.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });

    // Experience summary
    var callScores = (audits || []).filter(function(a) { return a.call_type !== "non_scorable"; }).map(function(a) { return parseFloat(a.score || 0); });
    var ticketScores = (tickets || []).map(function(t) { return t.overall_score || 0; });
    var avgCallScore = callScores.length > 0 ? callScores.reduce(function(s, v) { return s + v; }, 0) / callScores.length : null;
    var avgTicketScore = ticketScores.length > 0 ? ticketScores.reduce(function(s, v) { return s + v; }, 0) / ticketScores.length : null;

    // CX score: normalize call score (0-4) to 0-100, then average with ticket score
    var cxScore = null;
    if (avgCallScore !== null && avgTicketScore !== null) {
      cxScore = Math.round((avgCallScore / 4 * 100 + avgTicketScore) / 2);
    } else if (avgCallScore !== null) {
      cxScore = Math.round(avgCallScore / 4 * 100);
    } else if (avgTicketScore !== null) {
      cxScore = Math.round(avgTicketScore);
    }

    return jsonResponse({
      success: true,
      phone: normalized,
      customer_name: (tickets && tickets[0]) ? tickets[0].customer_name : "",
      total_calls: (audits || []).length,
      total_tickets: (tickets || []).length,
      avg_call_score: avgCallScore !== null ? Math.round(avgCallScore * 100) / 100 : null,
      avg_ticket_score: avgTicketScore !== null ? Math.round(avgTicketScore) : null,
      cx_score: cxScore,
      timeline: timeline,
    });
  }

  // ─── ALL CUSTOMER JOURNEYS (aggregated) ───
  if (action === "journeys") {
    // Get recent audits
    var auditQuery = supabase
      .from("audit_results")
      .select("call_id, external_number, employee, store, score, call_type, inquiry, outcome, date_started, talk_duration, confidence")
      .gte("date_started", cutoffISO)
      .not("external_number", "is", null);
    if (store && store !== "all") auditQuery = auditQuery.eq("store", store);
    var { data: allAudits, error: aErr2 } = await auditQuery;
    if (aErr2) console.error("[journey] Audits query error:", aErr2.message);

    // Get recent tickets
    var ticketQuery = supabase
      .from("ticket_grades")
      .select("ticket_number, customer_phone, customer_phones_all, customer_name, store, employee_repaired, employee_added, device, date_closed, overall_score, diagnostics_score, notes_score, categorization_score, payment_score");
    if (store && store !== "all") ticketQuery = ticketQuery.eq("store", store);
    var { data: allTickets, error: tErr2 } = await ticketQuery;
    if (tErr2) console.error("[journey] Tickets query error:", tErr2.message);

    // Index audits by normalized phone
    var auditsByPhone = {};
    (allAudits || []).forEach(function(a) {
      var ph = normPhone(a.external_number);
      if (ph.length !== 10) return;
      if (!auditsByPhone[ph]) auditsByPhone[ph] = [];
      auditsByPhone[ph].push(a);
    });

    // Index tickets by normalized phone
    var ticketsByPhone = {};
    (allTickets || []).forEach(function(t) {
      var phones = [normPhone(t.customer_phone)];
      (t.customer_phones_all || []).forEach(function(p) {
        var n = normPhone(p);
        if (n.length === 10 && phones.indexOf(n) < 0) phones.push(n);
      });
      phones.forEach(function(ph) {
        if (ph.length !== 10) return;
        if (!ticketsByPhone[ph]) ticketsByPhone[ph] = [];
        ticketsByPhone[ph].push(t);
      });
    });

    // Find all phones that appear in BOTH datasets
    var crossRefPhones = {};
    Object.keys(auditsByPhone).forEach(function(ph) {
      if (ticketsByPhone[ph]) {
        crossRefPhones[ph] = {
          phone: ph,
          calls: auditsByPhone[ph],
          tickets: ticketsByPhone[ph],
        };
      }
    });

    // Build customer journey summaries
    var journeys = Object.values(crossRefPhones).map(function(j) {
      var calls = j.calls;
      var tickets = j.tickets;
      var customerName = "";
      for (var ti = 0; ti < tickets.length; ti++) {
        if (tickets[ti].customer_name) { customerName = tickets[ti].customer_name; break; }
      }

      var scorableCalls = calls.filter(function(c) { return c.call_type !== "non_scorable"; });
      var avgCall = scorableCalls.length > 0 ? scorableCalls.reduce(function(s, c) { return s + parseFloat(c.score || 0); }, 0) / scorableCalls.length : null;
      var avgTicket = tickets.length > 0 ? tickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / tickets.length : null;

      var cxScore = null;
      if (avgCall !== null && avgTicket !== null) {
        cxScore = Math.round((avgCall / 4 * 100 + avgTicket) / 2);
      } else if (avgCall !== null) {
        cxScore = Math.round(avgCall / 4 * 100);
      } else if (avgTicket !== null) {
        cxScore = Math.round(avgTicket);
      }

      // Detect red flags
      var flags = [];

      // Flag 1: Low call score followed by a ticket (bad first impression)
      scorableCalls.forEach(function(c) {
        if (parseFloat(c.score || 0) < 2.0) {
          var callDate = new Date(c.date_started);
          var hasTicketAfter = tickets.some(function(t) {
            var tDate = new Date(t.date_closed);
            var diff = (tDate - callDate) / 86400000;
            return diff >= 0 && diff <= 14;
          });
          if (hasTicketAfter) flags.push("Low call score before repair");
        }
      });

      // Flag 2: Low pickup score + callback within 7 days
      tickets.forEach(function(t) {
        if ((t.categorization_score || 0) < 50) {
          var closeDate = new Date(t.date_closed);
          var hasCallback = calls.some(function(c) {
            var cDate = new Date(c.date_started);
            var diff = (cDate - closeDate) / 86400000;
            return diff > 0 && diff <= 7;
          });
          if (hasCallback) flags.push("Callback after low pickup score");
        }
      });

      // Flag 3: Multiple calls in short period (frustrated customer)
      if (calls.length >= 3) {
        var sorted = calls.slice().sort(function(a, b) { return new Date(a.date_started) - new Date(b.date_started); });
        for (var ci = 0; ci < sorted.length - 2; ci++) {
          var span = (new Date(sorted[ci + 2].date_started) - new Date(sorted[ci].date_started)) / 86400000;
          if (span <= 3) { flags.push("3+ calls within 3 days"); break; }
        }
      }

      // Flag 4: Low ticket compliance overall
      tickets.forEach(function(t) {
        if ((t.overall_score || 0) < 40) flags.push("Very low ticket compliance");
      });

      // Deduplicate flags
      var uniqueFlags = [];
      flags.forEach(function(f) { if (uniqueFlags.indexOf(f) < 0) uniqueFlags.push(f); });

      var latestDate = null;
      calls.forEach(function(c) { if (!latestDate || new Date(c.date_started) > latestDate) latestDate = new Date(c.date_started); });
      tickets.forEach(function(t) { if (!latestDate || new Date(t.date_closed) > latestDate) latestDate = new Date(t.date_closed); });

      return {
        phone: j.phone,
        customer_name: customerName,
        total_calls: calls.length,
        total_tickets: tickets.length,
        avg_call_score: avgCall !== null ? Math.round(avgCall * 100) / 100 : null,
        avg_ticket_score: avgTicket !== null ? Math.round(avgTicket) : null,
        cx_score: cxScore,
        flags: uniqueFlags,
        latest_date: latestDate ? latestDate.toISOString() : null,
        stores: (function() {
          var s = {};
          calls.forEach(function(c) { if (c.store) s[c.store] = true; });
          tickets.forEach(function(t) { if (t.store) s[t.store] = true; });
          return Object.keys(s);
        })(),
      };
    });

    // Sort: flagged customers first, then by most recent activity
    journeys.sort(function(a, b) {
      if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
      return new Date(b.latest_date) - new Date(a.latest_date);
    });

    // Stats
    var totalWithBoth = journeys.length;
    var totalFlagged = journeys.filter(function(j) { return j.flags.length > 0; }).length;
    var cxScores = journeys.filter(function(j) { return j.cx_score !== null; }).map(function(j) { return j.cx_score; });
    var avgCX = cxScores.length > 0 ? Math.round(cxScores.reduce(function(s, v) { return s + v; }, 0) / cxScores.length) : null;

    return jsonResponse({
      success: true,
      stats: {
        total_customers_cross_referenced: totalWithBoth,
        total_flagged: totalFlagged,
        avg_cx_score: avgCX,
        total_calls_analyzed: (allAudits || []).length,
        total_tickets_analyzed: (allTickets || []).length,
      },
      journeys: journeys.slice(0, 100),
    });
  }

  return jsonResponse({ success: false, error: "Unknown action" });
}

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

function normPhone(p) {
  if (!p) return "";
  return String(p).replace(/\D/g, "").slice(-10);
}

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });

  var { searchParams } = new URL(request.url);
  var store = searchParams.get("store") || "";
  var days = parseInt(searchParams.get("days")) || 30;

  try {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var cutoffStr = cutoff.toISOString().split("T")[0];

    // Get all "Arrived" appointments that haven't been verified yet
    var query = supabase.from("appointments")
      .select("id, customer_phone, date_of_appt, did_arrive, store")
      .eq("did_arrive", "Yes")
      .gte("date_of_appt", cutoffStr);

    if (store) query = query.eq("store", store);

    var { data: arrivedAppts, error: apptErr } = await query;
    if (apptErr) return json({ success: false, error: apptErr.message });
    if (!arrivedAppts || arrivedAppts.length === 0) return json({ success: true, verified: 0, checked: 0 });

    var withPhone = arrivedAppts.filter(function(a) {
      return normPhone(a.customer_phone).length === 10;
    });

    if (withPhone.length === 0) return json({ success: true, verified: 0, checked: 0, message: "No arrived appointments with phone numbers" });

    // Get ticket_grades from the relevant date range
    var { data: tickets, error: ticketErr } = await supabase.from("ticket_grades")
      .select("customer_phone, customer_phones_all, date_closed, intake_date, created_date")
      .gte("date_closed", cutoffStr);

    if (ticketErr) {
      console.error("Ticket query error:", ticketErr.message);
      return json({ success: false, error: "Failed to query tickets: " + ticketErr.message });
    }

    if (!tickets || tickets.length === 0) return json({ success: true, verified: 0, checked: withPhone.length, message: "No ticket data found to cross-reference" });

    // Build lookup: normalized phone -> array of ticket dates
    var ticketLookup = {};
    tickets.forEach(function(t) {
      var date = t.date_closed || t.intake_date || t.created_date;
      if (!date) return;

      // Primary phone
      var primary = normPhone(t.customer_phone);
      if (primary.length === 10) {
        if (!ticketLookup[primary]) ticketLookup[primary] = [];
        ticketLookup[primary].push(date);
      }

      // All phones — catches alternate numbers too
      if (t.customer_phones_all && Array.isArray(t.customer_phones_all)) {
        t.customer_phones_all.forEach(function(p) {
          var norm = normPhone(p);
          if (norm.length === 10) {
            if (!ticketLookup[norm]) ticketLookup[norm] = [];
            ticketLookup[norm].push(date);
          }
        });
      }
    });

    var ticketPhoneCount = Object.keys(ticketLookup).length;
    if (ticketPhoneCount === 0) return json({ success: true, verified: 0, checked: withPhone.length, message: "No ticket phone data found" });

    // Match: appointment phone in tickets within ±2 days
    var toUpdate = [];
    withPhone.forEach(function(appt) {
      var apptPhone = normPhone(appt.customer_phone);
      var dates = ticketLookup[apptPhone];
      if (!dates || dates.length === 0) return;

      var apptDate = new Date(appt.date_of_appt + "T12:00:00");
      var hasMatch = dates.some(function(td) {
        var ticketDate = new Date(td);
        if (isNaN(ticketDate.getTime())) return false;
        var diff = Math.abs(apptDate - ticketDate) / (1000 * 60 * 60 * 24);
        return diff <= 2;
      });

      if (hasMatch) toUpdate.push(appt.id);
    });

    // Batch update matched appointments to "Converted"
    var verified = 0;
    if (toUpdate.length > 0) {
      var { error: updateErr } = await supabase.from("appointments")
        .update({ did_arrive: "Converted", updated_at: new Date().toISOString() })
        .in("id", toUpdate);

      if (updateErr) {
        console.error("Verify update error:", updateErr.message);
        return json({ success: false, error: "Failed to update: " + updateErr.message });
      }
      verified = toUpdate.length;
    }

    return json({
      success: true,
      verified: verified,
      checked: withPhone.length,
      ticketPhones: ticketPhoneCount,
      totalTickets: tickets.length,
      message: verified > 0 ? verified + " appointments auto-verified as Converted" : "No new conversions found",
    });

  } catch(e) {
    console.error("Verify conversions error:", e);
    return json({ success: false, error: e.message });
  }
}

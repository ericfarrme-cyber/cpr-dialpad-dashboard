import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/dialpad/repeat-callers — detect customers calling multiple times (dropped ball)
export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });

  const { searchParams } = new URL(request.url);
  const daysBack = parseInt(searchParams.get("days") || "7");
  const store = searchParams.get("store");
  const minCalls = parseInt(searchParams.get("min") || "2");

  try {
    const since = new Date(Date.now() - daysBack * 86400000).toISOString();

    // Get all inbound department calls in the time window
    let query = supabase
      .from("call_records")
      .select("call_id, date_started, store, store_name, external_number, talk_duration, is_answered, is_missed, categories")
      .eq("target_type", "department")
      .eq("direction", "inbound")
      .gte("date_started", since)
      .order("date_started", { ascending: true });

    if (store && store !== "all") query = query.eq("store", store);

    const { data: calls, error: callErr } = await query;
    if (callErr) return NextResponse.json({ success: false, error: callErr.message });

    // Get audit data for these calls (to get customer name, device, inquiry)
    const { data: audits, error: auditErr } = await supabase
      .from("audit_results")
      .select("call_id, customer_name, device_type, inquiry, outcome, employee, call_type, score")
      .gte("date_started", since);

    const auditMap = {};
    (audits || []).forEach(a => { auditMap[a.call_id] = a; });

    // Group calls by phone number + store
    const groups = {};
    (calls || []).forEach(call => {
      const key = `${call.external_number}__${call.store}`;
      if (!groups[key]) {
        groups[key] = {
          phone: call.external_number,
          store: call.store,
          store_name: call.store_name,
          calls: [],
        };
      }
      const audit = auditMap[call.call_id];
      groups[key].calls.push({
        call_id: call.call_id,
        date: call.date_started,
        answered: call.is_answered,
        missed: call.is_missed,
        talk_duration: call.talk_duration,
        categories: call.categories,
        // Audit info if available
        customer_name: audit?.customer_name || null,
        device_type: audit?.device_type || null,
        inquiry: audit?.inquiry || null,
        outcome: audit?.outcome || null,
        employee: audit?.employee || null,
        call_type: audit?.call_type || null,
        score: audit?.score || null,
      });
    });

    // Filter to repeat callers (2+ calls from same number to same store)
    const repeatCallers = Object.values(groups)
      .filter(g => g.calls.length >= minCalls)
      .map(g => {
        const firstCall = g.calls[0];
        const lastCall = g.calls[g.calls.length - 1];
        const timeSpanHours = (new Date(lastCall.date) - new Date(firstCall.date)) / 3600000;

        // Determine customer name and device from any audited call
        const auditedCalls = g.calls.filter(c => c.customer_name && c.customer_name !== "Unknown");
        const customerName = auditedCalls[0]?.customer_name || "Unknown";
        const deviceType = g.calls.find(c => c.device_type && c.device_type !== "Not mentioned")?.device_type || "Unknown";

        // Count current_customer calls (status checks)
        const statusChecks = g.calls.filter(c => c.call_type === "current_customer").length;
        const missedCalls = g.calls.filter(c => c.missed).length;

        // Severity: higher = worse
        // More calls in shorter time = more frustrated customer
        let severity = "low";
        if (g.calls.length >= 4 || (g.calls.length >= 3 && timeSpanHours < 24)) severity = "high";
        else if (g.calls.length >= 3 || (g.calls.length >= 2 && timeSpanHours < 8)) severity = "medium";

        // Check if any outbound call was made TO this number (did we call back?)
        // We'll add this check separately

        return {
          phone: g.phone,
          store: g.store,
          store_name: g.store_name,
          customer_name: customerName,
          device_type: deviceType,
          total_calls: g.calls.length,
          status_checks: statusChecks,
          missed_calls: missedCalls,
          time_span_hours: Math.round(timeSpanHours * 10) / 10,
          first_call: firstCall.date,
          last_call: lastCall.date,
          severity,
          calls: g.calls,
        };
      })
      .sort((a, b) => {
        // Sort by severity then by call count
        const sev = { high: 3, medium: 2, low: 1 };
        if (sev[b.severity] !== sev[a.severity]) return sev[b.severity] - sev[a.severity];
        return b.total_calls - a.total_calls;
      });

    // Check for outbound calls to these numbers (proactive follow-up check)
    const repeatPhones = repeatCallers.map(r => r.phone);
    let outboundMap = {};
    if (repeatPhones.length > 0) {
      const { data: outbound } = await supabase
        .from("call_records")
        .select("external_number, store, date_started")
        .eq("direction", "outbound")
        .gte("date_started", since)
        .in("external_number", repeatPhones.slice(0, 100));

      (outbound || []).forEach(o => {
        const key = `${o.external_number}__${o.store}`;
        if (!outboundMap[key]) outboundMap[key] = [];
        outboundMap[key].push(o.date_started);
      });
    }

    // Enrich with outbound data
    repeatCallers.forEach(r => {
      const key = `${r.phone}__${r.store}`;
      const outboundDates = outboundMap[key] || [];
      r.we_called_back = outboundDates.length > 0;
      r.outbound_calls = outboundDates.length;
      // If customer called 3+ times and we never called them proactively, flag it
      if (r.total_calls >= 3 && !r.we_called_back) r.severity = "high";
    });

    // Summary stats
    const summary = {
      total_repeat_callers: repeatCallers.length,
      high_severity: repeatCallers.filter(r => r.severity === "high").length,
      medium_severity: repeatCallers.filter(r => r.severity === "medium").length,
      never_called_back: repeatCallers.filter(r => !r.we_called_back).length,
      by_store: {},
    };
    ["fishers", "bloomington", "indianapolis"].forEach(s => {
      const sr = repeatCallers.filter(r => r.store === s);
      summary.by_store[s] = {
        count: sr.length,
        high: sr.filter(r => r.severity === "high").length,
      };
    });

    return NextResponse.json({
      success: true,
      summary,
      repeatCallers: repeatCallers.slice(0, 50),
      daysBack,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

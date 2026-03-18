import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

function corsHeaders() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
}
function json(data) { return NextResponse.json(data, { headers: corsHeaders() }); }

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var daysBack = parseInt(searchParams.get("days") || "30");
  var since = new Date(Date.now() - daysBack * 86400000).toISOString();

  try {
    var [ticketRes, callRes, auditRes, rosterRes] = await Promise.all([
      supabase.from("ticket_grades").select("*"),
      supabase.from("call_records").select("store, direction, phone, date_started, is_answered, is_missed, employee, talk_duration")
        .eq("target_type", "department").gte("date_started", since),
      supabase.from("audit_results").select("store, employee, score, max_score, call_type, excluded, appt_offered, warranty_mentioned")
        .eq("excluded", false).neq("call_type", "non_scorable").gte("date_started", since),
      supabase.from("employee_roster").select("name, store, aliases, role").eq("active", true),
    ]);

    var tickets = ticketRes.data || [];
    var calls = callRes.data || [];
    var audits = auditRes.data || [];
    var roster = rosterRes.data || [];

    // Build roster resolver
    var rosterLookup = {};
    roster.forEach(function(r) {
      rosterLookup[r.name.toLowerCase()] = r;
      var parts = r.name.split(/\s+/);
      parts.forEach(function(p) { if (p.length >= 3) rosterLookup[p.toLowerCase()] = r; });
      (r.aliases || []).forEach(function(a) { rosterLookup[a.toLowerCase()] = r; });
    });
    function resolveEmp(raw) {
      if (!raw) return raw;
      var lower = raw.toLowerCase().trim();
      if (lower.includes(",")) { var cp = lower.split(",").map(function(s){return s.trim();}); lower = cp[1] ? cp[1] + " " + cp[0] : cp[0]; }
      if (rosterLookup[lower]) return rosterLookup[lower].name;
      var words = lower.split(/\s+/);
      for (var w = 0; w < words.length; w++) { if (rosterLookup[words[w]]) return rosterLookup[words[w]].name; }
      return raw;
    }

    // ═══════════════════════════════════════
    // 1. POST-REPAIR CALLBACKS
    // ═══════════════════════════════════════
    // Find tickets with customer_phone, then check if that phone called back after ticket close
    var callsByPhone = {};
    calls.forEach(function(c) {
      if (c.direction !== "inbound") return;
      var ph = (c.phone || "").replace(/\D/g, "").slice(-10);
      if (!ph || ph.length < 10) return;
      if (!callsByPhone[ph]) callsByPhone[ph] = [];
      callsByPhone[ph].push(c);
    });

    var callbacks = [];
    tickets.forEach(function(t) {
      // Collect all phone numbers for this ticket
      var allPhones = [];
      if (t.customer_phone && t.customer_phone.length >= 10) allPhones.push(t.customer_phone.replace(/\D/g, "").slice(-10));
      (t.customer_phones_all || []).forEach(function(p) {
        var norm = String(p).replace(/\D/g, "").slice(-10);
        if (norm.length === 10 && allPhones.indexOf(norm) < 0) allPhones.push(norm);
      });
      if (allPhones.length === 0) return;

      var closeDate = t.date_closed ? new Date(t.date_closed) : null;
      if (!closeDate) return;

      // Find calls from ANY of this customer's phones 1-14 days after close
      var postCalls = [];
      allPhones.forEach(function(ph) {
        var phoneCalls = callsByPhone[ph] || [];
        phoneCalls.forEach(function(c) {
          var callDate = new Date(c.date_started);
          var diff = callDate - closeDate;
          if (diff > 86400000 && diff < 14 * 86400000) postCalls.push(c);
        });
      });

      if (postCalls.length > 0) {
        callbacks.push({
          ticket_number: t.ticket_number,
          customer_name: t.customer_name,
          customer_phone: t.customer_phone,
          device: t.device,
          store: t.store,
          employee_repaired: resolveEmp(t.employee_repaired || t.employee_added),
          date_closed: t.date_closed,
          overall_score: t.overall_score,
          callback_count: postCalls.length,
          first_callback: postCalls.sort(function(a, b) { return new Date(a.date_started) - new Date(b.date_started); })[0].date_started,
          days_after: Math.round((new Date(postCalls[0].date_started) - closeDate) / 86400000),
        });
      }
    });
    callbacks.sort(function(a, b) { return b.callback_count - a.callback_count; });

    // ═══════════════════════════════════════
    // 2. DEVICE/REPAIR FAILURE PATTERNS
    // ═══════════════════════════════════════
    var deviceMap = {};
    tickets.forEach(function(t) {
      var device = (t.device || "Unknown").trim();
      var type = (t.ticket_type || "Repair").trim();
      var key = device + " — " + type;
      if (!deviceMap[key]) deviceMap[key] = { device: device, type: type, tickets: 0, total_score: 0, callbacks: 0, low_scores: 0 };
      deviceMap[key].tickets++;
      deviceMap[key].total_score += (t.overall_score || 0);
      if ((t.overall_score || 0) < 50) deviceMap[key].low_scores++;
    });
    // Add callback counts
    callbacks.forEach(function(cb) {
      var t = tickets.find(function(t) { return t.ticket_number === cb.ticket_number; });
      if (t) {
        var key = ((t.device || "Unknown") + " — " + (t.ticket_type || "Repair")).trim();
        if (deviceMap[key]) deviceMap[key].callbacks += cb.callback_count;
      }
    });
    var devicePatterns = Object.values(deviceMap).map(function(d) {
      d.avg_score = d.tickets > 0 ? Math.round(d.total_score / d.tickets) : 0;
      d.callback_rate = d.tickets > 0 ? Math.round((d.callbacks / d.tickets) * 100) : 0;
      d.low_score_rate = d.tickets > 0 ? Math.round((d.low_scores / d.tickets) * 100) : 0;
      return d;
    }).filter(function(d) { return d.tickets >= 2; })
      .sort(function(a, b) { return b.callback_rate - a.callback_rate || b.tickets - a.tickets; });

    // ═══════════════════════════════════════
    // 3. EMPLOYEE QUALITY CORRELATION
    // ═══════════════════════════════════════
    var empCorr = {};
    function ensureCorr(name) {
      if (!name) return null;
      var resolved = resolveEmp(name);
      if (!empCorr[resolved]) {
        var rEntry = roster.find(function(r) { return r.name === resolved; });
        empCorr[resolved] = {
          name: resolved, store: rEntry ? rEntry.store : "", role: rEntry ? rEntry.role : "",
          audit_scores: [], compliance_scores: [], repair_count: 0, callback_count: 0,
        };
      }
      return empCorr[resolved];
    }

    audits.forEach(function(a) {
      if (!a.employee) return;
      var e = ensureCorr(a.employee);
      if (e && a.max_score > 0) e.audit_scores.push(parseFloat(a.score) / parseFloat(a.max_score) * 100);
    });

    tickets.forEach(function(t) {
      var emp = resolveEmp(t.employee_repaired || t.employee_added);
      var e = ensureCorr(emp);
      if (e) {
        e.compliance_scores.push(t.overall_score || 0);
        e.repair_count++;
      }
    });

    callbacks.forEach(function(cb) {
      var e = ensureCorr(cb.employee_repaired);
      if (e) e.callback_count += cb.callback_count;
    });

    var employeeCorrelation = Object.values(empCorr).map(function(e) {
      e.avg_audit = e.audit_scores.length > 0 ? Math.round(e.audit_scores.reduce(function(s, v) { return s + v; }, 0) / e.audit_scores.length) : null;
      e.avg_compliance = e.compliance_scores.length > 0 ? Math.round(e.compliance_scores.reduce(function(s, v) { return s + v; }, 0) / e.compliance_scores.length) : null;
      e.callback_rate = e.repair_count > 0 ? Math.round((e.callback_count / e.repair_count) * 100) : 0;

      // Coaching recommendation
      e.coaching = [];
      if (e.avg_audit !== null && e.avg_audit < 50) e.coaching.push("Needs call quality training");
      if (e.avg_compliance !== null && e.avg_compliance < 50) e.coaching.push("Needs ticket documentation training");
      if (e.avg_audit !== null && e.avg_audit >= 70 && e.avg_compliance !== null && e.avg_compliance < 50) e.coaching.push("Great on phones but sloppy on tickets — focus on documentation");
      if (e.avg_compliance !== null && e.avg_compliance >= 70 && e.avg_audit !== null && e.avg_audit < 50) e.coaching.push("Good documentation but needs phone skills coaching");
      if (e.callback_rate > 20) e.coaching.push("High callback rate — review repair quality");
      if (e.avg_audit !== null && e.avg_audit >= 70 && e.avg_compliance !== null && e.avg_compliance >= 70 && e.callback_rate <= 10) e.coaching.push("Top performer — consider for mentoring role");

      return e;
    }).filter(function(e) { return e.avg_audit !== null || e.avg_compliance !== null; })
      .sort(function(a, b) {
        var aTotal = (a.avg_audit || 0) + (a.avg_compliance || 0);
        var bTotal = (b.avg_audit || 0) + (b.avg_compliance || 0);
        return bTotal - aTotal;
      });

    // ═══════════════════════════════════════
    // 4. SUMMARY STATS
    // ═══════════════════════════════════════
    var totalTickets = tickets.length;
    var totalCallbacks = callbacks.length;
    var callbackRate = totalTickets > 0 ? Math.round((totalCallbacks / totalTickets) * 100) : 0;
    var avgCompliance = totalTickets > 0 ? Math.round(tickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / totalTickets) : 0;

    return json({
      success: true,
      summary: { totalTickets: totalTickets, totalCallbacks: totalCallbacks, callbackRate: callbackRate, avgCompliance: avgCompliance },
      callbacks: callbacks.slice(0, 50),
      devicePatterns: devicePatterns.slice(0, 30),
      employeeCorrelation: employeeCorrelation,
      daysBack: daysBack,
    });
  } catch (err) {
    console.error("Insights error:", err);
    return json({ success: false, error: err.message });
  }
}

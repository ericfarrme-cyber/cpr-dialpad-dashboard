import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 60;

// ──────────────────────────────────────────────────────────────────────
// Performance Command Center — Detection + Triage Engine
// ──────────────────────────────────────────────────────────────────────
// Endpoints:
//   GET  ?action=active[&store=X]              → list active flags
//   GET  ?action=notes_for_employee&employee=X → list private coaching notes for that employee
//   GET  ?action=unread_count&employee=X       → count unread coaching notes (for badge)
//   POST ?action=compute (or body)             → run all rules, persist new flags
//   POST body action=dismiss                   → dismiss a flag
//   POST body action=acted                     → mark acted (with via + optional note)
//   POST body action=draft_message             → AI-draft a manager-voice message
//   POST body action=send_slack                → post to #wins webhook
//   POST body action=send_note                 → create coaching_note (private to employee)
//   POST body action=acknowledge_note          → employee marks note as read
// ──────────────────────────────────────────────────────────────────────

function jsonResponse(payload, status) {
  return NextResponse.json(payload, { status: status || 200 });
}

// ── Role-split scoring helpers (April 2026 rollout) ──
// Mirrors logic in tickets-route.js / scorecard-route.js so flag attribution matches the rest of the app.
function ROLE_SPLIT_CUTOFF() { return "2026-04-01"; }
function isRoleSplitEra(dateStr) { if (!dateStr) return false; return String(dateStr).substring(0, 10) >= ROLE_SPLIT_CUTOFF(); }
function paymentIsNA(t) {
  if (t == null || parseFloat(t.payment_score) !== 100) return false;
  var n = String(t.payment_notes || "").toLowerCase();
  return n.indexOf("not applicable") >= 0 || n.indexOf("n/a") >= 0 || n.indexOf("no parts") >= 0;
}
function computeRepairRoleScore(t) {
  if (!t) return null;
  var notes = t.notes_score, pickup = t.categorization_score;
  if (notes == null && pickup == null) return null;
  notes = notes == null ? 0 : parseFloat(notes);
  pickup = pickup == null ? 0 : parseFloat(pickup);
  if (paymentIsNA(t)) return Math.round((notes * 40 + pickup * 25) / 65);
  return Math.round((notes * 25 + pickup * 20) / 45);
}

// ── Notes-quality gap extraction ──
// Given a ticket with poor notes_score, identifies the specific things missing
// so coaching is concrete instead of "your notes were bad".
// Returns an array of human-readable gap labels (most-impactful first).
function extractNotesGaps(t) {
  var gaps = [];
  if (t == null) return gaps;
  // Boolean flags from grader (most reliable signal)
  if (t.notes_customer_contacted === false) gaps.push("customer-contacted note missing");
  if (t.notes_outcome_documented === false) gaps.push("repair outcome not documented");
  // Mine the free-text detail for keyword signals — graders tend to call out the same things
  var detail = String(t.notes_detail || "").toLowerCase();
  if (detail) {
    if (detail.indexOf("post-test") >= 0 || detail.indexOf("post test") >= 0 || detail.indexOf("posttest") >= 0) {
      if (gaps.indexOf("post-test results not documented") < 0) gaps.push("post-test results not documented");
    }
    if (detail.indexOf("pre-test") >= 0 || detail.indexOf("pre test") >= 0 || detail.indexOf("pretest") >= 0) {
      if (gaps.indexOf("pre-test condition not documented") < 0) gaps.push("pre-test condition not documented");
    }
    if (detail.indexOf("service performed") >= 0 || detail.indexOf("what was done") >= 0 || detail.indexOf("what was repaired") >= 0) {
      if (gaps.indexOf("service performed not described") < 0) gaps.push("service performed not described");
    }
    if (detail.indexOf("findings") >= 0 || detail.indexOf("diagnosis") >= 0 && gaps.length === 0) {
      gaps.push("repair findings not documented");
    }
    if (detail.indexOf("vague") >= 0 || detail.indexOf("generic") >= 0 || detail.indexOf("brief") >= 0) {
      if (gaps.length === 0) gaps.push("note too brief or generic");
    }
  }
  // Fallback: if we have nothing but a low score, generic message
  if (gaps.length === 0 && t.notes_score != null && t.notes_score < 50) {
    gaps.push("incomplete documentation");
  }
  return gaps;
}

// Aggregate gaps across multiple tickets, returning the most common first.
function summarizeGaps(tickets) {
  var counts = {};
  tickets.forEach(function(t) {
    extractNotesGaps(t).forEach(function(g) { counts[g] = (counts[g] || 0) + 1; });
  });
  var arr = Object.keys(counts).map(function(k) { return { gap: k, count: counts[k] }; });
  arr.sort(function(a, b) { return b.count - a.count; });
  return arr;
}

// ── Date helpers ──
function daysAgoISO(n) { var d = new Date(); d.setDate(d.getDate() - n); return d.toISOString(); }
function todayDateStr() { return new Date().toISOString().substring(0, 10); }
function isoToDate(s) { return s ? String(s).substring(0, 10) : null; }

// ── Roster resolution: maps "Alyssa P." → "Alyssa Parent", etc. ──
function buildAliasMap(roster) {
  var aliasMap = {};
  (roster || []).forEach(function(r) {
    if (!r || !r.name) return;
    var name = r.name;
    var lower = name.toLowerCase();
    aliasMap[lower] = name;
    var parts = lower.split(/\s+/);
    if (parts.length > 0) aliasMap[parts[0]] = name;        // first name → full
    if (parts.length > 1) aliasMap[parts[parts.length-1]] = name; // last name → full
    if (Array.isArray(r.aliases)) {
      r.aliases.forEach(function(a) { if (a) aliasMap[String(a).toLowerCase().trim()] = name; });
    }
  });
  return aliasMap;
}
function resolveName(raw, aliasMap) {
  if (!raw) return null;
  var lower = String(raw).toLowerCase().trim();
  if (aliasMap[lower]) return aliasMap[lower];
  // Substring fallback (e.g. "Parent, Alyssa" → "Alyssa Parent")
  for (var k in aliasMap) {
    if (k.length >= 3 && lower.indexOf(k) >= 0) return aliasMap[k];
  }
  return null;
}

// ── Tier thresholds (mirrors lib/constants tiers) ──
function tierForScore(score) {
  if (score >= 85) return "Diamond";
  if (score >= 70) return "Platinum";
  if (score >= 55) return "Gold";
  if (score >= 40) return "Silver";
  return "Bronze";
}

// ──────────────────────────────────────────────────────────────────────
// GET handler
// ──────────────────────────────────────────────────────────────────────
export async function GET(request) {
  if (!supabase) return jsonResponse({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action") || "active";

  if (action === "active") {
    var store = searchParams.get("store");
    var q = supabase.from("performance_flags").select("*").eq("status", "active").order("severity", { ascending: false }).order("created_at", { ascending: false });
    if (store) q = q.eq("store", store);
    var { data, error } = await q;
    if (error) return jsonResponse({ success: false, error: error.message });
    // Group by flag_type for the UI
    var groups = { regression: [], win: [], opportunity: [] };
    (data || []).forEach(function(f) { if (groups[f.flag_type]) groups[f.flag_type].push(f); });
    return jsonResponse({ success: true, flags: data || [], grouped: groups, total: (data || []).length });
  }

  if (action === "notes_for_employee") {
    var emp = searchParams.get("employee");
    if (!emp) return jsonResponse({ success: false, error: "employee required" });
    var { data: notes, error: nErr } = await supabase.from("coaching_notes")
      .select("*").eq("employee_name", emp).order("created_at", { ascending: false }).limit(50);
    if (nErr) return jsonResponse({ success: false, error: nErr.message });
    var unread = (notes || []).filter(function(n) { return !n.acknowledged_at; }).length;
    return jsonResponse({ success: true, notes: notes || [], unread_count: unread });
  }

  if (action === "unread_count") {
    var empU = searchParams.get("employee");
    if (!empU) return jsonResponse({ success: false, error: "employee required" });
    var { count, error: cErr } = await supabase.from("coaching_notes")
      .select("id", { count: "exact", head: true })
      .eq("employee_name", empU).is("acknowledged_at", null);
    if (cErr) return jsonResponse({ success: false, error: cErr.message });
    return jsonResponse({ success: true, unread_count: count || 0 });
  }

  if (action === "history") {
    // Recent admin-side flag history (for "X flags acted on this month" stats)
    var days = parseInt(searchParams.get("days")) || 30;
    var { data: hist, error: hErr } = await supabase.from("performance_flags")
      .select("flag_type, rule_key, status, acted_via, created_at, resolved_at")
      .gte("created_at", daysAgoISO(days))
      .order("created_at", { ascending: false }).limit(500);
    if (hErr) return jsonResponse({ success: false, error: hErr.message });
    return jsonResponse({ success: true, flags: hist || [], days: days });
  }

  return jsonResponse({ success: false, error: "Unknown action: " + action });
}

// ──────────────────────────────────────────────────────────────────────
// POST handler
// ──────────────────────────────────────────────────────────────────────
export async function POST(request) {
  if (!supabase) return jsonResponse({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var actionParam = searchParams.get("action");
  var body = {};
  try { body = await request.json(); } catch(e) { /* empty body OK for compute */ }
  var action = actionParam || body.action;

  if (action === "compute") {
    return await runDetection(body.secret);
  }

  if (action === "dismiss") {
    if (!body.flag_id) return jsonResponse({ success: false, error: "flag_id required" });
    var { error: dErr } = await supabase.from("performance_flags")
      .update({ status: "dismissed", resolved_at: new Date().toISOString() })
      .eq("id", body.flag_id);
    if (dErr) return jsonResponse({ success: false, error: dErr.message });
    return jsonResponse({ success: true });
  }

  if (action === "acted") {
    if (!body.flag_id) return jsonResponse({ success: false, error: "flag_id required" });
    var { error: aErr } = await supabase.from("performance_flags")
      .update({ status: "acted", acted_via: body.via || "manual", acted_note: body.note || null, resolved_at: new Date().toISOString() })
      .eq("id", body.flag_id);
    if (aErr) return jsonResponse({ success: false, error: aErr.message });
    return jsonResponse({ success: true });
  }

  if (action === "draft_message") {
    return await draftManagerMessage(body);
  }

  if (action === "send_slack") {
    return await sendToSlackWins(body);
  }

  if (action === "send_note") {
    if (!body.employee || !body.message) return jsonResponse({ success: false, error: "employee and message required" });
    var insertPayload = {
      employee_name: body.employee,
      store: body.store || null,
      from_admin: body.from_admin || "Admin",
      source_flag_id: body.flag_id || null,
      category: body.category || null,
      message: body.message,
    };
    var { data: inserted, error: insErr } = await supabase.from("coaching_notes").insert(insertPayload).select().single();
    if (insErr) return jsonResponse({ success: false, error: insErr.message });
    // Optionally mark the source flag as acted
    if (body.flag_id) {
      await supabase.from("performance_flags")
        .update({ status: "acted", acted_via: "note", acted_note: "Pushed to MyPerformance", resolved_at: new Date().toISOString() })
        .eq("id", body.flag_id);
    }
    return jsonResponse({ success: true, note: inserted });
  }

  if (action === "acknowledge_note") {
    if (!body.note_id) return jsonResponse({ success: false, error: "note_id required" });
    var { error: ackErr } = await supabase.from("coaching_notes")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_text: body.response || null })
      .eq("id", body.note_id);
    if (ackErr) return jsonResponse({ success: false, error: ackErr.message });
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, error: "Unknown action: " + action });
}

// ══════════════════════════════════════════════════════════════════════
// DETECTION ENGINE — runs all 8 rules
// ══════════════════════════════════════════════════════════════════════
async function runDetection(secret) {
  // Optional: gate by secret if called from cron
  if (secret && process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return jsonResponse({ success: false, error: "invalid secret" }, 403);
  }
  var startedAt = Date.now();
  try {
    // ── Fetch all source data in parallel ──
    var todayStr = todayDateStr();
    var d7  = daysAgoISO(7);
    var d14 = daysAgoISO(14);
    var d28 = daysAgoISO(28);
    var d35 = daysAgoISO(35);

    var [rosterRes, ticketsRes, auditsRes, shiftsRes, tierHistRes] = await Promise.all([
      supabase.from("employee_roster").select("name, store, aliases, role, active").eq("active", true),
      supabase.from("ticket_grades")
        .select("ticket_number, store, employee_added, employee_repaired, overall_score, notes_score, notes_detail, notes_outcome_documented, notes_customer_contacted, diagnostics_score, categorization_score, categorization_notes, payment_score, payment_notes, contact_score, device_category, turnaround_hours, date_closed, ticket_type")
        .gte("date_closed", d35)
        .or("ticket_type.is.null,ticket_type.neq.Sale"),
      supabase.from("audit_results")
        .select("store, employee, score, max_score, call_type, excluded, appt_offered, warranty_mentioned, date_started")
        .eq("excluded", false).neq("call_type", "non_scorable")
        .gte("date_started", d35),
      supabase.from("employee_shifts")
        .select("employee_name, store, date, start_time, end_time")
        .gte("date", todayStr).lte("date", todayStr),
      supabase.from("employee_tier_history")
        .select("employee_name, store, period, tier, overall_score")
        .order("period", { ascending: false }).limit(500),
    ]);

    if (rosterRes.error) throw new Error("roster: " + rosterRes.error.message);
    var roster = rosterRes.data || [];
    var aliasMap = buildAliasMap(roster);

    var tickets = ticketsRes.data || [];
    var audits  = auditsRes.data || [];
    var shifts  = shiftsRes.data || [];
    var tierHist = tierHistRes.data || [];

    // ── Bucket data by employee ──
    var byEmp = {};
    function ensureEmp(name) {
      if (!byEmp[name]) byEmp[name] = {
        name: name,
        intake_tickets_7d: [], repair_tickets_7d: [],
        intake_tickets_28d: [], repair_tickets_28d: [],
        all_tickets_7d: [], all_tickets_28d: [],
        all_tickets_14d: [], all_tickets_prior14: [],
        audits_7d: [], audits_prior7: [], audits_28d: [],
        notes_recent_chrono: [],
        appt_audits_recent: [],
        on_shift_today: false,
        store: null,
      };
      return byEmp[name];
    }
    // Seed every active roster employee so we don't miss anyone with zero data
    roster.forEach(function(r) { var e = ensureEmp(r.name); e.store = r.store; });

    // Bucket tickets
    tickets.forEach(function(t) {
      var dc = isoToDate(t.date_closed);
      if (!dc) return;
      // Intake side
      var intakeName = resolveName(t.employee_added, aliasMap);
      if (intakeName) {
        var ie = ensureEmp(intakeName); if (!ie.store && t.store) ie.store = t.store;
        if (dc >= isoToDate(d7))  { ie.intake_tickets_7d.push(t); ie.all_tickets_7d.push(t); }
        if (dc >= isoToDate(d28)) { ie.intake_tickets_28d.push(t); ie.all_tickets_28d.push(t); }
        if (dc >= isoToDate(d14)) ie.all_tickets_14d.push(t);
        else if (dc >= isoToDate(d28)) ie.all_tickets_prior14.push(t);
      }
      // Repair side
      var repairName = resolveName(t.employee_repaired, aliasMap);
      if (repairName) {
        var re = ensureEmp(repairName); if (!re.store && t.store) re.store = t.store;
        if (dc >= isoToDate(d7))  { re.repair_tickets_7d.push(t); if (intakeName !== repairName) re.all_tickets_7d.push(t); }
        if (dc >= isoToDate(d28)) { re.repair_tickets_28d.push(t); if (intakeName !== repairName) re.all_tickets_28d.push(t); }
        if (dc >= isoToDate(d14) && intakeName !== repairName) re.all_tickets_14d.push(t);
        else if (dc >= isoToDate(d28) && intakeName !== repairName) re.all_tickets_prior14.push(t);
      }
    });

    // Bucket audits
    audits.forEach(function(a) {
      var name = resolveName(a.employee, aliasMap);
      if (!name) return;
      var e = ensureEmp(name);
      if (!e.store && a.store) e.store = a.store;
      var ds = isoToDate(a.date_started);
      if (!ds) return;
      if (ds >= isoToDate(d7)) e.audits_7d.push(a);
      else if (ds >= isoToDate(d14)) e.audits_prior7.push(a);
      if (ds >= isoToDate(d28)) e.audits_28d.push(a);
      // Track recent appointment-eligible audits chronologically (newest first)
      if (a.call_type === "opportunity") e.appt_audits_recent.push(a);
    });

    // Sort recent appointment audits oldest-first then we'll check the *last* 5 chronologically
    Object.keys(byEmp).forEach(function(name) {
      var e = byEmp[name];
      e.appt_audits_recent.sort(function(a, b) { return String(a.date_started).localeCompare(String(b.date_started)); });
      // notes_recent_chrono: last 10 tickets sorted newest first, used for excellence streak
      var allRepairTix = e.repair_tickets_28d.slice().sort(function(a, b) { return String(b.date_closed).localeCompare(String(a.date_closed)); });
      e.notes_recent_chrono = allRepairTix.slice(0, 15);
    });

    // Bucket shifts (today only)
    shifts.forEach(function(s) {
      var name = resolveName(s.employee_name, aliasMap);
      if (!name) return;
      var e = ensureEmp(name);
      e.on_shift_today = true;
    });

    // ── Run rules, build candidate flags ──
    var candidates = [];

    // Phase 1 thresholds (per Eric's confirmation)
    var NOTES_STREAK_MIN = 3;                  // 3+ tickets <50 in 7 days
    var NOTES_STREAK_PCT = 0.15;               // OR 15% of week's repair-tickets, whichever is higher
    var COMPLIANCE_DROP = 15;                  // 7d-avg vs 30d-baseline drop
    var APPT_DROP = 30;                        // pp drop WoW
    var APPT_MIN_VOLUME = 5;                   // need 5+ opp calls in current week
    var ACTIVE_DIP_PCT = 20;                   // pts below 30d baseline today
    var TURNAROUND_DROP_PCT = 0.30;            // 30%+ improvement
    var TURNAROUND_MIN_TIX = 5;                // per device-category window
    var APPT_STREAK_LEN = 5;                   // consecutive opp calls all offered
    var NOTES_EXCELLENCE_LEN = 10;             // consecutive 90+ on repair-side notes

    Object.keys(byEmp).forEach(function(name) {
      var e = byEmp[name];

      // ─── Rule 1: Notes-quality streak (regression) ───
      // Repair-tech tickets where the repair-role score (Notes 25% + Pickup 20%) shows weak notes documentation.
      // Pre-April 2026: fall back to overall notes_score < 50 on repair-side tickets.
      // Post-April: use repair_role_score < 60 AND notes_score < 50 (the role-split repair score is what they're actually graded on).
      // Threshold: 3+ tickets OR 15% of week's repair tickets — whichever is higher.
      var poorNotes = e.repair_tickets_7d.filter(function(t) {
        if (t.notes_score == null) return false;
        if (t.notes_score >= 50) return false;
        // Role-split era: only flag if THIS person's repair-role score on this ticket is weak.
        // (Prevents flagging Matt for a low note that Aerick wrote on Matt's repair —
        // although Matt is still partly responsible since the docs reflect on his repair work.)
        if (isRoleSplitEra(t.date_closed)) {
          var rrs = computeRepairRoleScore(t);
          // rrs being null means we can't compute (e.g. this person wasn't repair-side) — skip
          if (rrs == null) return false;
          // Repair role score below 60 AND notes specifically below 50 = real signal
          return rrs < 60;
        }
        // Pre-April: legacy behavior — any low notes_score on a ticket they repaired
        return true;
      });
      var notesThreshold = Math.max(NOTES_STREAK_MIN, Math.ceil(e.repair_tickets_7d.length * NOTES_STREAK_PCT));
      if (poorNotes.length >= notesThreshold && poorNotes.length >= NOTES_STREAK_MIN) {
        // Surface the SPECIFIC gaps so coaching is concrete, not vague
        var gapSummary = summarizeGaps(poorNotes);
        var topGaps = gapSummary.slice(0, 2).map(function(g) { return g.gap; });
        var avgNotesScore = Math.round(avg(poorNotes.map(function(t) { return t.notes_score || 0; })));
        // Build per-ticket gap detail (used in coaching draft)
        var ticketDetails = poorNotes.slice(0, 6).map(function(t) {
          var gaps = extractNotesGaps(t);
          return {
            ticket_number: t.ticket_number,
            notes_score: t.notes_score,
            gaps: gaps,
            detail: t.notes_detail ? String(t.notes_detail).substring(0, 220) : null,
          };
        });
        candidates.push({
          flag_type: "regression", rule_key: "notes_streak", severity: 4,
          employee_name: name, store: e.store, category: "compliance",
          metric_label: "Repair tickets with weak notes",
          metric_current: poorNotes.length, metric_baseline: 0,
          delta: poorNotes.length,
          headline: name + " has " + poorNotes.length + " repair ticket" + (poorNotes.length === 1 ? "" : "s") + " in the last 7 days with weak notes (avg " + avgNotesScore + "/100)" + (topGaps.length > 0 ? " — most common gaps: " + topGaps.join(", ") : ""),
          evidence: {
            ticket_numbers: poorNotes.slice(0, 6).map(function(t) { return t.ticket_number; }),
            ticket_details: ticketDetails,
            top_gaps: topGaps,
            all_gaps: gapSummary,
            avg_notes_score: avgNotesScore,
            threshold_used: notesThreshold,
            total_repair_tickets_7d: e.repair_tickets_7d.length,
            attribution_note: isRoleSplitEra(todayStr) ? "Filtered to tickets where this employee was the repair tech (role-split era)" : "Pre-April 2026: legacy single-attribution scoring",
          },
        });
      }

      // ─── Rule 2: Compliance regression ───
      // 7d-avg overall_score drops 15+ pts vs prior 21d baseline
      // Need at least 3 tickets in each window for signal
      if (e.all_tickets_7d.length >= 3 && e.all_tickets_28d.length >= 6) {
        var avg7 = avg(e.all_tickets_7d.map(function(t) { return t.overall_score || 0; }));
        var prior21 = e.all_tickets_28d.filter(function(t) { return e.all_tickets_7d.indexOf(t) < 0; });
        if (prior21.length >= 3) {
          var avg21 = avg(prior21.map(function(t) { return t.overall_score || 0; }));
          var drop = avg21 - avg7;
          if (drop >= COMPLIANCE_DROP) {
            // Build per-ticket evidence so detail view can show what slipped
            var recentTixDetail = e.all_tickets_7d.slice().sort(function(a, b) { return String(b.date_closed).localeCompare(String(a.date_closed)); }).slice(0, 8).map(function(t) {
              return {
                ticket_number: t.ticket_number,
                date_closed: t.date_closed,
                overall_score: t.overall_score,
                notes_score: t.notes_score,
                diagnostics_score: t.diagnostics_score,
                categorization_score: t.categorization_score,
              };
            });
            candidates.push({
              flag_type: "regression", rule_key: "compliance_regression", severity: 4,
              employee_name: name, store: e.store, category: "compliance",
              metric_label: "7-day compliance avg",
              metric_current: Math.round(avg7), metric_baseline: Math.round(avg21),
              delta: -Math.round(drop),
              headline: name + " compliance dropped " + Math.round(drop) + " pts (was " + Math.round(avg21) + ", now " + Math.round(avg7) + ")",
              evidence: {
                tickets_7d: e.all_tickets_7d.length,
                tickets_prior21: prior21.length,
                avg_recent: Math.round(avg7),
                avg_prior: Math.round(avg21),
                recent_ticket_details: recentTixDetail,
              },
            });
          }
        }
      }

      // ─── Rule 3: Appointment-offered rate collapse (regression) ───
      // 30+ pp drop WoW on opportunity-call appt-offered rate, AND >= 5 opp calls in current week
      var oppCurrent = e.audits_7d.filter(function(a) { return a.call_type === "opportunity"; });
      var oppPrior   = e.audits_prior7.filter(function(a) { return a.call_type === "opportunity"; });
      if (oppCurrent.length >= APPT_MIN_VOLUME && oppPrior.length >= APPT_MIN_VOLUME) {
        var rateNow   = pct(oppCurrent.filter(function(a) { return a.appt_offered; }).length, oppCurrent.length);
        var ratePrior = pct(oppPrior.filter(function(a) { return a.appt_offered; }).length, oppPrior.length);
        var rateDrop = ratePrior - rateNow;
        if (rateDrop >= APPT_DROP) {
          // Per-call breakdown: which calls offered, which didn't
          var callBreakdown = oppCurrent.slice().sort(function(a, b) { return String(b.date_started).localeCompare(String(a.date_started)); }).slice(0, 10).map(function(a) {
            return {
              date: a.date_started,
              offered: !!a.appt_offered,
              warranty_mentioned: !!a.warranty_mentioned,
            };
          });
          candidates.push({
            flag_type: "regression", rule_key: "appt_collapse", severity: 5,
            employee_name: name, store: e.store, category: "audit",
            metric_label: "Appointment-offered rate (week)",
            metric_current: Math.round(rateNow), metric_baseline: Math.round(ratePrior),
            delta: -Math.round(rateDrop),
            headline: name + " appointment offers dropped to " + Math.round(rateNow) + "% this week (was " + Math.round(ratePrior) + "%)",
            evidence: {
              opps_current_week: oppCurrent.length,
              opps_prior_week: oppPrior.length,
              offers_current: oppCurrent.filter(function(a) { return a.appt_offered; }).length,
              offers_prior: oppPrior.filter(function(a) { return a.appt_offered; }).length,
              call_breakdown: callBreakdown,
            },
          });
        }
      }

      // ─── Rule 4: Active-shift dip (opportunity) ───
      // Employee on shift TODAY with current-day audit/notes scores 20+ pts below their 30d baseline
      if (e.on_shift_today && e.audits_28d.length >= 5) {
        var todaysAudits = e.audits_28d.filter(function(a) { return isoToDate(a.date_started) === todayStr; });
        if (todaysAudits.length >= 2) {
          var prior30 = e.audits_28d.filter(function(a) { return isoToDate(a.date_started) !== todayStr; });
          var avgToday = avg(todaysAudits.map(function(a) { return a.max_score > 0 ? (a.score / a.max_score) * 100 : 0; }));
          var avgPrior = avg(prior30.map(function(a) { return a.max_score > 0 ? (a.score / a.max_score) * 100 : 0; }));
          if (avgPrior - avgToday >= ACTIVE_DIP_PCT) {
            // Today's calls in detail — what's actually happening on shift right now
            var todayCallsDetail = todaysAudits.slice().sort(function(a, b) { return String(a.date_started).localeCompare(String(b.date_started)); }).map(function(a) {
              return {
                date: a.date_started,
                call_type: a.call_type,
                score: a.max_score > 0 ? Math.round((a.score / a.max_score) * 100) : null,
                appt_offered: !!a.appt_offered,
                warranty_mentioned: !!a.warranty_mentioned,
              };
            });
            candidates.push({
              flag_type: "opportunity", rule_key: "active_shift_dip", severity: 5,
              employee_name: name, store: e.store, category: "audit",
              metric_label: "Today's audit avg vs 30-day baseline",
              metric_current: Math.round(avgToday), metric_baseline: Math.round(avgPrior),
              delta: -Math.round(avgPrior - avgToday),
              headline: name + " is on shift now and " + Math.round(avgPrior - avgToday) + " pts below their normal — coachable today",
              evidence: {
                audits_today: todaysAudits.length,
                audits_baseline: prior30.length,
                avg_today: Math.round(avgToday),
                avg_baseline: Math.round(avgPrior),
                today_calls: todayCallsDetail,
              },
            });
          }
        }
      }

      // ─── Rule 5: Turnaround improvement (win) ───
      // Average turnaround for a device category drops 30%+ over last 14d vs prior 14d, min 5 tix per window
      var deviceCats = {};
      e.repair_tickets_28d.forEach(function(t) {
        if (!t.device_category || !t.turnaround_hours || t.turnaround_hours <= 0) return;
        var cat = t.device_category;
        if (!deviceCats[cat]) deviceCats[cat] = { recent: [], prior: [], recent_tix: [], prior_tix: [] };
        var dc = isoToDate(t.date_closed);
        if (dc >= isoToDate(d14)) { deviceCats[cat].recent.push(t.turnaround_hours); deviceCats[cat].recent_tix.push(t); }
        else { deviceCats[cat].prior.push(t.turnaround_hours); deviceCats[cat].prior_tix.push(t); }
      });
      Object.keys(deviceCats).forEach(function(cat) {
        var dc = deviceCats[cat];
        if (dc.recent.length < TURNAROUND_MIN_TIX || dc.prior.length < TURNAROUND_MIN_TIX) return;
        var avgRecent = avg(dc.recent);
        var avgPrior = avg(dc.prior);
        if (avgPrior <= 0) return;
        var pctImprove = (avgPrior - avgRecent) / avgPrior;
        if (pctImprove >= TURNAROUND_DROP_PCT) {
          // Sample tickets — fastest 3 from recent, slowest 2 from prior, for visual contrast
          var recentSorted = dc.recent_tix.slice().sort(function(a, b) { return a.turnaround_hours - b.turnaround_hours; });
          var priorSorted = dc.prior_tix.slice().sort(function(a, b) { return b.turnaround_hours - a.turnaround_hours; });
          var sampleRecent = recentSorted.slice(0, 5).map(function(t) { return { ticket_number: t.ticket_number, hours: round1(t.turnaround_hours), date_closed: t.date_closed }; });
          var samplePrior = priorSorted.slice(0, 3).map(function(t) { return { ticket_number: t.ticket_number, hours: round1(t.turnaround_hours), date_closed: t.date_closed }; });
          candidates.push({
            flag_type: "win", rule_key: "turnaround_improvement", severity: 3,
            employee_name: name, store: e.store, category: "turnaround",
            metric_label: cat + " avg turnaround",
            metric_current: round1(avgRecent), metric_baseline: round1(avgPrior),
            delta: -round1(avgPrior - avgRecent),
            headline: name + " dropped " + cat + " turnaround from " + round1(avgPrior) + "h to " + round1(avgRecent) + "h",
            evidence: {
              device_category: cat,
              recent_window_tix: dc.recent.length,
              prior_window_tix: dc.prior.length,
              pct_improvement: Math.round(pctImprove * 100),
              avg_recent_hours: round1(avgRecent),
              avg_prior_hours: round1(avgPrior),
              sample_recent: sampleRecent,
              sample_prior: samplePrior,
            },
          });
        }
      });

      // ─── Rule 6: Appointment streak (win) ───
      // Last 5 consecutive opportunity audits all hit appt_offered = true
      if (e.appt_audits_recent.length >= APPT_STREAK_LEN) {
        var last5 = e.appt_audits_recent.slice(-APPT_STREAK_LEN);
        if (last5.every(function(a) { return a.appt_offered; })) {
          // Capture the actual call list with dates so the win is verifiable
          var streakCalls = last5.map(function(a) {
            return {
              date: a.date_started,
              warranty_mentioned: !!a.warranty_mentioned,
              score: a.max_score > 0 ? Math.round((a.score / a.max_score) * 100) : null,
            };
          });
          candidates.push({
            flag_type: "win", rule_key: "appt_streak", severity: 3,
            employee_name: name, store: e.store, category: "audit",
            metric_label: "Consecutive appt offers",
            metric_current: APPT_STREAK_LEN, metric_baseline: 0,
            delta: APPT_STREAK_LEN,
            headline: name + " offered appointments on " + APPT_STREAK_LEN + " opportunity calls in a row",
            evidence: { streak_length: APPT_STREAK_LEN, streak_calls: streakCalls },
          });
        }
      }

      // ─── Rule 8: Notes excellence streak (win) ───
      // 10 consecutive repair-side tickets with notes_score >= 90
      if (e.notes_recent_chrono.length >= NOTES_EXCELLENCE_LEN) {
        var last10 = e.notes_recent_chrono.slice(0, NOTES_EXCELLENCE_LEN);
        if (last10.every(function(t) { return t.notes_score != null && t.notes_score >= 90; })) {
          var streakTixDetail = last10.map(function(t) {
            return {
              ticket_number: t.ticket_number,
              date_closed: t.date_closed,
              notes_score: t.notes_score,
              device_category: t.device_category,
            };
          });
          var avgStreakScore = Math.round(avg(last10.map(function(t) { return t.notes_score; })));
          candidates.push({
            flag_type: "win", rule_key: "notes_excellence", severity: 3,
            employee_name: name, store: e.store, category: "compliance",
            metric_label: "Consecutive 90+ notes scores",
            metric_current: NOTES_EXCELLENCE_LEN, metric_baseline: 0,
            delta: NOTES_EXCELLENCE_LEN,
            headline: name + " has " + NOTES_EXCELLENCE_LEN + " consecutive tickets with 90+ notes scores (avg " + avgStreakScore + "/100)",
            evidence: {
              streak_length: NOTES_EXCELLENCE_LEN,
              avg_streak_score: avgStreakScore,
              ticket_numbers: last10.map(function(t) { return t.ticket_number; }),
              ticket_details: streakTixDetail,
            },
          });
        }
      }
    });

    // ─── Rule 7: Tier crossover (win OR regression depending on direction) ───
    // Compare current month's tier (from latest scorecard period) vs prior month's tier
    var tierByEmp = {};
    tierHist.forEach(function(h) {
      var name = resolveName(h.employee_name, aliasMap);
      if (!name) return;
      if (!tierByEmp[name]) tierByEmp[name] = [];
      tierByEmp[name].push(h);
    });
    Object.keys(tierByEmp).forEach(function(name) {
      var hist = tierByEmp[name].sort(function(a, b) { return String(b.period).localeCompare(String(a.period)); });
      if (hist.length < 2) return;
      var current = hist[0];
      var prior = hist[1];
      if (!current.tier || !prior.tier || current.tier === prior.tier) return;
      var tierRank = { "Bronze": 1, "Silver": 2, "Gold": 3, "Platinum": 4, "Diamond": 5 };
      var direction = (tierRank[current.tier] || 0) - (tierRank[prior.tier] || 0);
      if (direction > 0) {
        candidates.push({
          flag_type: "win", rule_key: "tier_crossover", severity: 4,
          employee_name: name, store: byEmp[name] ? byEmp[name].store : null, category: "tier",
          metric_label: "Monthly tier",
          metric_current: current.overall_score || null, metric_baseline: prior.overall_score || null,
          delta: direction,
          headline: name + " moved up to " + current.tier + " from " + prior.tier + " (" + current.period + ")",
          evidence: { from_tier: prior.tier, to_tier: current.tier, period: current.period },
        });
      }
    });

    // ── Persist with dedup_key (one flag per rule per employee per day) ──
    var saved = 0, skipped = 0, errors = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      c.dedup_key = c.rule_key + ":" + c.employee_name + ":" + todayStr;
      var { error: insErr } = await supabase.from("performance_flags")
        .upsert(c, { onConflict: "dedup_key", ignoreDuplicates: true });
      if (insErr) errors.push(c.dedup_key + ": " + insErr.message);
      else saved++;
    }

    // ── Auto-resolve stale flags (open >7 days) ──
    var staleDate = daysAgoISO(7);
    await supabase.from("performance_flags")
      .update({ status: "dismissed", resolved_at: new Date().toISOString(), acted_note: "auto-dismissed (stale)" })
      .eq("status", "active").lt("created_at", staleDate);

    return jsonResponse({
      success: true,
      candidates_evaluated: candidates.length,
      saved: saved,
      skipped: skipped,
      errors: errors,
      employees_evaluated: Object.keys(byEmp).length,
      tickets_analyzed: tickets.length,
      audits_analyzed: audits.length,
      duration_ms: Date.now() - startedAt,
    });
  } catch(e) {
    return jsonResponse({ success: false, error: String(e && e.message || e), duration_ms: Date.now() - startedAt }, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════
// Manager-voice message draft (Flavor 2 — conversational, warm)
// ══════════════════════════════════════════════════════════════════════
async function draftManagerMessage(body) {
  if (!process.env.ANTHROPIC_API_KEY) return jsonResponse({ success: false, error: "ANTHROPIC_API_KEY not set" });
  if (!body.flag_id) return jsonResponse({ success: false, error: "flag_id required" });

  // Fetch the flag for context
  var { data: flag, error: fErr } = await supabase.from("performance_flags").select("*").eq("id", body.flag_id).single();
  if (fErr || !flag) return jsonResponse({ success: false, error: "flag not found" });

  var isWin = flag.flag_type === "win";
  var ev = flag.evidence || {};

  // Pull any rule-specific context we can include — e.g. notes-streak gaps
  var contextLines = [];
  if (ev.top_gaps && ev.top_gaps.length > 0) {
    contextLines.push("SPECIFIC GAPS (the actual problems you want them to fix):");
    ev.top_gaps.forEach(function(g) { contextLines.push("  - " + g); });
  }
  if (ev.ticket_details && ev.ticket_details.length > 0) {
    contextLines.push("EXAMPLE TICKETS (not for quoting — just so the coaching is grounded in real specifics):");
    ev.ticket_details.slice(0, 3).forEach(function(td) {
      var pieces = ["#" + td.ticket_number];
      if (td.notes_score != null) pieces.push("notes " + td.notes_score + "/100");
      if (td.gaps && td.gaps.length > 0) pieces.push("missing: " + td.gaps.join(", "));
      contextLines.push("  - " + pieces.join(" — "));
    });
  }
  if (ev.avg_notes_score != null) {
    contextLines.push("AVG NOTES SCORE on flagged tickets: " + ev.avg_notes_score + "/100");
  }
  if (ev.attribution_note) {
    contextLines.push("ATTRIBUTION: " + ev.attribution_note);
  }

  var promptLines = [
    "You are drafting a brief, friendly message from a store manager (Eric) to one of his retail technicians at CPR Cell Phone Repair.",
    "",
    isWin
      ? "PURPOSE: Recognize a positive performance trend. Make it personal and encouraging without being saccharine. The employee should feel genuinely seen."
      : "PURPOSE: Coach the employee on a SPECIFIC performance gap. Be warm and constructive — never accusatory. Frame it as 'I noticed' / 'let's' / 'you got this'. Acknowledge the issue is fixable. CRUCIAL: name the actual specific behavior you want them to change (e.g. 'add a post-test note when you close out repairs' — NOT 'work on your notes'). The employee should know exactly what to do differently after reading this.",
    "",
    "TONE: How a manager who actually likes their team would phrase it in a quick Slack DM. Conversational. Short. Uses their first name. No corporate-speak. No 'circle back' / 'leverage' / 'opportunity area'. No hashtags. No emojis at the start.",
    "",
    "LENGTH: 2-3 sentences max. ~60 words.",
    "",
    "DO NOT:",
    "- Use bullet points or lists",
    "- Cite raw numbers/percentages or score values (the manager already knows them; the employee finds them noisy)",
    "- Sign off with a name (Eric will add that himself)",
    "- Start with 'Hey [name]' if it feels awkward — vary the opening",
    "- Say vague things like 'your notes need work' — name the specific gap from the SPECIFIC GAPS list below",
    "",
    "EMPLOYEE: " + flag.employee_name,
    "STORE: " + (flag.store || "unknown"),
    "FLAG TYPE: " + flag.flag_type + " / " + flag.rule_key,
    "HEADLINE (for your context, do not quote): " + flag.headline,
  ].concat(contextLines).concat([
    "",
    "Your output: ONLY the message body, nothing else. No quotes around it. No 'Here's a draft:' preamble.",
  ]);

  try {
    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 250,
        messages: [{ role: "user", content: promptLines.join("\n") }],
      }),
    });
    var json = await resp.json();
    if (!resp.ok) return jsonResponse({ success: false, error: json.error && json.error.message || "Claude API error" });
    var text = (json.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("\n").trim();
    // Strip surrounding quotes if Claude added them anyway
    text = text.replace(/^["'\u201C]|["'\u201D]$/g, "").trim();
    return jsonResponse({ success: true, draft: text, flag: flag });
  } catch(e) {
    return jsonResponse({ success: false, error: String(e && e.message || e) });
  }
}

// ══════════════════════════════════════════════════════════════════════
// Slack webhook — wins only
// ══════════════════════════════════════════════════════════════════════
async function sendToSlackWins(body) {
  var url = process.env.SLACK_WEBHOOK_WINS;
  if (!url) return jsonResponse({ success: false, error: "SLACK_WEBHOOK_WINS not set in environment" });
  if (!body.message) return jsonResponse({ success: false, error: "message required" });
  try {
    var resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body.message }),
    });
    if (!resp.ok) {
      var t = await resp.text();
      return jsonResponse({ success: false, error: "Slack webhook failed: " + t });
    }
    // Mark source flag as acted (slack-delivered)
    if (body.flag_id) {
      await supabase.from("performance_flags")
        .update({ status: "acted", acted_via: "slack", acted_note: "Posted to #wins", resolved_at: new Date().toISOString() })
        .eq("id", body.flag_id);
    }
    return jsonResponse({ success: true });
  } catch(e) {
    return jsonResponse({ success: false, error: String(e && e.message || e) });
  }
}

// ══════════════════════════════════════════════════════════════════════
// Tiny utils
// ══════════════════════════════════════════════════════════════════════
function avg(arr) {
  if (!arr || arr.length === 0) return 0;
  var s = 0; for (var i = 0; i < arr.length; i++) s += parseFloat(arr[i]) || 0;
  return s / arr.length;
}
function pct(num, den) { return den > 0 ? (num / den) * 100 : 0; }
function round1(n) { return Math.round(n * 10) / 10; }

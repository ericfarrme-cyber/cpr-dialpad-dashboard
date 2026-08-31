import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { GET as scorecardGET } from "../scorecard/route";
import { GET as salesGET } from "../sales/route";

// Vercel serverless functions cannot reliably HTTP-call themselves, so sibling
// route handlers are invoked directly in-process instead of over fetch(). Both
// handlers read only `request.url`, so a synthetic absolute URL is sufficient
// and behaviour is identical. This also removes any dependency on
// NEXT_PUBLIC_BASE_URL / VERCEL_URL being set.
async function callRouteHandler(handler, path) {
  var res = await handler(new Request("http://internal" + path));
  return await res.json();
}

// ── Tier definitions (must match MyPerformanceTab.js) ───────────────────────
var TIER_THRESHOLDS = [
  { name: "Diamond",  min: 85, multiplier: 1.50, ptoPerMonth: 1 },
  { name: "Platinum", min: 70, multiplier: 1.50, ptoPerMonth: 0 },
  { name: "Gold",     min: 55, multiplier: 1.25, ptoPerMonth: 0 },
  { name: "Silver",   min: 40, multiplier: 1.00, ptoPerMonth: 0 },
  { name: "Bronze",   min: 0,  multiplier: 1.00, ptoPerMonth: 0 },
];

function tierForScore(score) {
  score = score || 0;
  for (var i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (score >= TIER_THRESHOLDS[i].min) return TIER_THRESHOLDS[i];
  }
  return TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1];
}

function tierRank(tierName) {
  // Higher number = higher tier. Used for "tier or better" checks.
  var ranks = { Bronze: 0, Silver: 1, Gold: 2, Platinum: 3, Diamond: 4 };
  return ranks[tierName] != null ? ranks[tierName] : 0;
}

// ── Period helpers ──────────────────────────────────────────────────────────
function currentPeriod() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function priorPeriod(period, n) {
  // period = 'YYYY-MM', returns the period n months earlier.
  // NOTE: must not use `n = n || 1` — that turns a legitimate n=0 ("this same
  // period") into 1, which made backfill skip the current month and snapshot
  // the previous one twice.
  if (n === undefined || n === null) n = 1;
  var parts = period.split("-");
  var y = parseInt(parts[0]);
  var m = parseInt(parts[1]) - 1; // 0-indexed
  m -= n;
  while (m < 0) { m += 12; y -= 1; }
  return y + "-" + String(m + 1).padStart(2, "0");
}

function periodsInRange(startPeriod, endPeriod) {
  // Inclusive list of YYYY-MM strings between the two
  var out = [];
  var cur = startPeriod;
  out.push(cur);
  while (cur < endPeriod) {
    cur = priorPeriod(cur, -1); // step forward
    out.push(cur);
  }
  return out;
}

// ── Streak computation from history ─────────────────────────────────────────
function computeStreaks(historyRows) {
  // historyRows: sorted descending by period (newest first).
  // Returns counts of consecutive months from the latest, "tier or better".
  if (!historyRows || historyRows.length === 0) {
    return { gold: 0, platinum: 0, diamond: 0, currentTier: null, currentScore: 0 };
  }
  var sorted = historyRows.slice().sort(function(a, b) { return b.period.localeCompare(a.period); });
  // Verify continuity (no missing months in the streak)
  var goldStreak = 0, platStreak = 0, diaStreak = 0;
  var goldBroken = false, platBroken = false, diaBroken = false;
  var expectedPeriod = sorted[0].period;
  for (var i = 0; i < sorted.length; i++) {
    var row = sorted[i];
    if (row.period !== expectedPeriod) {
      // Gap — all streaks break here
      break;
    }
    var rk = tierRank(row.tier);
    if (!goldBroken) { if (rk >= tierRank("Gold")) goldStreak++; else goldBroken = true; }
    if (!platBroken) { if (rk >= tierRank("Platinum")) platStreak++; else platBroken = true; }
    if (!diaBroken)  { if (rk >= tierRank("Diamond")) diaStreak++;  else diaBroken = true; }
    if (goldBroken && platBroken && diaBroken) break;
    expectedPeriod = priorPeriod(expectedPeriod, 1);
  }
  return {
    gold: goldStreak,
    platinum: platStreak,
    diamond: diaStreak,
    currentTier: sorted[0].tier,
    currentScore: sorted[0].overall_score,
  };
}

// ── Snapshot logic: pull current scorecard, write history rows ──────────────
async function snapshotPeriod(period, opts) {
  opts = opts || {};

  // Load the scorecard for this period (direct in-process call — see
  // callRouteHandler above). A failure here means every downstream row would be
  // wrong, so it throws rather than returning a soft failure.
  var sData;
  try {
    sData = await callRouteHandler(scorecardGET, "/api/dialpad/scorecard?period=" + encodeURIComponent(period));
  } catch (e) {
    throw new Error("Scorecard load failed for " + period + ": " + e.message);
  }
  if (!sData || !sData.success) {
    throw new Error("Scorecard load failed for " + period + ": " + ((sData && sData.error) || "unknown error"));
  }

  var employeeScores = sData.employeeScores || [];

  // Pull per-employee commission inputs for the same period (so we can store
  // base_commission and tier_bonus alongside the tier).
  // These feed base_commission / tier_bonus / total_commission, so a silent
  // failure here would write understated bonus dollars. Fail loudly instead.
  var commData;
  try {
    commData = await callRouteHandler(salesGET, "/api/dialpad/sales?action=performance&period=" + encodeURIComponent(period));
  } catch (e) {
    throw new Error("Sales performance load failed for " + period + ": " + e.message);
  }
  if (!commData || !commData.success) {
    throw new Error("Sales performance load failed for " + period + ": " + ((commData && commData.error) || "unknown error"));
  }
  var commRates = commData.rates || {};
  function findEmp(arr, name) {
    return (arr || []).find(function(e) { return (e.employee || "").toLowerCase() === (name || "").toLowerCase(); });
  }

  var written = 0, eventsCreated = 0, errors = [];
  var KNOWN = ["fishers", "bloomington", "indianapolis"];

  // Bonus eligibility comes from employee_roster.bonus_eligible, NOT from the
  // role label — a role rename must never silently restore someone's bonuses.
  // Ineligible people still get an employee_tier_history row (their tier is real
  // and useful); they are only excluded from award events.
  var { data: rosterRows, error: rosterErr } = await supabase
    .from("employee_roster")
    .select("name, store, bonus_eligible")
    .eq("active", true);
  if (rosterErr) {
    throw new Error("Roster load failed for " + period + ": " + rosterErr.message);
  }
  var bonusIneligible = {};
  (rosterRows || []).forEach(function(r) {
    if (r.bonus_eligible === false) bonusIneligible[String(r.name).toLowerCase()] = true;
  });

  for (var i = 0; i < employeeScores.length; i++) {
    var emp = employeeScores[i];
    if (!emp.name || !emp.store) continue;
    if (KNOWN.indexOf(String(emp.store).toLowerCase()) < 0) continue;
    if (!emp.hasData) continue;

    var t = tierForScore(emp.overall || 0);

    // Commission for the period
    var phone = commData ? findEmp(commData.phones, emp.name) : null;
    var other = commData ? findEmp(commData.others, emp.name) : null;
    var accy  = commData ? findEmp(commData.accessories, emp.name) : null;
    var clean = commData ? findEmp(commData.cleanings, emp.name) : null;
    var clnS  = commData ? findEmp(commData.cleaningSales, emp.name) : null;
    var commPhone = (phone ? (phone.repair_tickets || 0) : 0) * (commRates.phone_repair_standard || 1);
    var commOther = (other ? (other.repair_count || 0) : 0) * (commRates.other_repair_rate || 2.5);
    var commAccy  = (accy  ? (accy.accy_gp || 0) : 0) * (commRates.accessory_gp_rate || 0.15);
    var commClean = (clean ? (clean.clean_total || 0) : 0) * (commRates.cleaning_rate || 0.10);
    var commCS    = (clnS  ? (clnS.discounted_sales || clnS.gross_sales || 0) : 0) * (commRates.cleaning_sales_rate || 0.10);
    var baseTotal = commPhone + commOther + commAccy + commClean + commCS;
    var tierBonus = baseTotal * (t.multiplier - 1);
    var totalComm = baseTotal * t.multiplier;

    // Upsert the snapshot row
    var row = {
      employee_name: emp.name,
      store: String(emp.store).toLowerCase(),
      period: period,
      overall_score: Math.round(emp.overall || 0),
      tier: t.name,
      multiplier: t.multiplier,
      base_commission: Math.round(baseTotal * 100) / 100,
      tier_bonus: Math.round(tierBonus * 100) / 100,
      total_commission: Math.round(totalComm * 100) / 100,
      pto_earned: t.ptoPerMonth,
      // Column is `recorded_at` — there is no `updated_at` on this table.
      // Sending an unknown column makes PostgREST reject the whole upsert.
      recorded_at: new Date().toISOString(),
    };

    var { error: upsertErr } = await supabase
      .from("employee_tier_history")
      .upsert(row, { onConflict: "employee_name,store,period", ignoreDuplicates: false });
    if (upsertErr) {
      errors.push(emp.name + ": " + upsertErr.message);
      continue;
    }
    written++;

    // ── Generate celebration events ──
    // Pull this employee's recent history for streak math
    var { data: histRows } = await supabase
      .from("employee_tier_history")
      .select("period, tier, overall_score")
      .eq("employee_name", emp.name)
      .eq("store", row.store)
      // Only history UP TO the period being snapshotted. Without this, a
      // backfill re-run lets an earlier period see later months and award a
      // streak that had not happened yet — the same 3-month run then pays out
      // once per period processed.
      .lte("period", period)
      .order("period", { ascending: false })
      .limit(13);
    var hist = histRows || [];

    // 1. Tier-up event — compare to immediately prior month (if exists)
    var prior = hist.find(function(h) { return h.period === priorPeriod(period, 1); });
    if (prior && tierRank(t.name) > tierRank(prior.tier)) {
      var { error: evtErr } = await supabase.from("tier_celebrations").upsert({
        employee_name: emp.name,
        store: row.store,
        event_type: "tier_up",
        event_period: period,
        prior_tier: prior.tier,
        new_tier: t.name,
        streak_length: null,
        bonus_amount: 0,
        bonus_unit: null,
      }, { onConflict: "employee_name,store,event_period,event_type" , ignoreDuplicates: true });
      if (!evtErr) eventsCreated++;
    }

    // 2. Streak events — Gold streak ($100), Platinum streak (1 PTO)
    // RECURRING: awarded once per completed 3-month run at that level, so a
    // sustained streak earns again at 6, 9, 12 months. (Eric, 2026-08-31.)
    var streaks = computeStreaks(hist);
    var isBonusEligible = !bonusIneligible[String(emp.name).toLowerCase()];

    // Gold streak: every 3 consecutive months at Gold or higher = $100
    if (isBonusEligible && streaks.gold > 0 && streaks.gold % 3 === 0) {
      var { error: gErr } = await supabase.from("tier_celebrations").upsert({
        employee_name: emp.name,
        store: row.store,
        event_type: "gold_streak",
        event_period: period,
        prior_tier: null,
        new_tier: t.name,
        streak_length: streaks.gold,
        bonus_amount: 100,
        bonus_unit: "cash",
      }, { onConflict: "employee_name,store,event_period,event_type", ignoreDuplicates: true });
      if (!gErr) eventsCreated++;
    }
    // Platinum streak: every 3 consecutive months at Platinum or higher = 1 PTO day
    if (isBonusEligible && streaks.platinum > 0 && streaks.platinum % 3 === 0) {
      var { error: pErr } = await supabase.from("tier_celebrations").upsert({
        employee_name: emp.name,
        store: row.store,
        event_type: "platinum_streak",
        event_period: period,
        prior_tier: null,
        new_tier: t.name,
        streak_length: streaks.platinum,
        bonus_amount: 1,
        bonus_unit: "pto_day",
      }, { onConflict: "employee_name,store,event_period,event_type", ignoreDuplicates: true });
      if (!pErr) eventsCreated++;
    }

    // 3. Diamond plaque — 6 total Diamond months in calendar year
    var year = period.split("-")[0];
    var diamondMonthsThisYear = (hist || []).filter(function(h) {
      return h.period.indexOf(year + "-") === 0 && h.tier === "Diamond";
    }).length;
    if (isBonusEligible && diamondMonthsThisYear >= 6) {
      var { error: plErr } = await supabase.from("tier_celebrations").upsert({
        employee_name: emp.name,
        store: row.store,
        event_type: "diamond_plaque",
        event_period: year, // year-level event
        prior_tier: null,
        new_tier: "Diamond",
        streak_length: diamondMonthsThisYear,
        bonus_amount: 0,
        bonus_unit: "plaque",
      }, { onConflict: "employee_name,store,event_period,event_type", ignoreDuplicates: true });
      if (!plErr) eventsCreated++;
    }
  }

  // Loud, not silent: a run that wrote nothing, or hit any row error, is a
  // failure. Previously this returned success:true with written:0, which is how
  // an empty employee_tier_history went unnoticed.
  if (errors.length > 0) {
    console.error("[tier-history] snapshot " + period + " had " + errors.length + " row error(s):", errors);
  }
  if (written === 0) {
    console.error("[tier-history] snapshot " + period + " wrote 0 rows (" + employeeScores.length + " employee scores in)");
  }
  return {
    success: errors.length === 0 && written > 0,
    period: period,
    written: written,
    events_created: eventsCreated,
    errors: errors,
  };
}

// Run one snapshot and turn it into an HTTP response. A failed snapshot returns
// 5xx instead of a 200 carrying success:false, so cron logs and the browser both
// show it as broken.
async function snapshotResponse(period) {
  var r;
  try {
    r = await snapshotPeriod(period);
  } catch (e) {
    console.error("[tier-history] snapshot " + period + " threw:", e);
    return NextResponse.json({ success: false, period: period, error: e.message }, { status: 500 });
  }
  return NextResponse.json(r, { status: r.success ? 200 : 500 });
}

// Backfill N periods. Each period reports its own outcome; the overall response
// is 5xx if any single period failed.
async function backfillResponse(months) {
  var results = [];
  var cur = currentPeriod();
  // OLDEST → NEWEST. computeStreaks anchors on the most recent period present
  // and walks backwards, so feeding history in reverse attributes each streak
  // award to the wrong month. Snapshot chronologically so streaks accumulate the
  // way they actually did.
  for (var i = months - 1; i >= 0; i--) {
    var p = priorPeriod(cur, i);
    try {
      var r = await snapshotPeriod(p);
      results.push({ period: p, written: r.written || 0, events: r.events_created || 0, ok: r.success, errors: r.errors || [] });
    } catch (e) {
      console.error("[tier-history] backfill " + p + " threw:", e);
      results.push({ period: p, written: 0, events: 0, ok: false, errors: [e.message] });
    }
  }
  var allOk = results.length > 0 && results.every(function(x) { return x.ok; });
  return NextResponse.json({ success: allOk, periods: results }, { status: allOk ? 200 : 500 });
}

// ────────────────────────────────────────────────────────────────────────────
// GET handler
// ────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });

  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action");
  var employee = searchParams.get("employee");
  var store = searchParams.get("store");

  // ── Streak info for one employee ──
  if (action === "streaks") {
    if (!employee || !store) return NextResponse.json({ success: false, error: "employee and store required" });
    var { data, error } = await supabase
      .from("employee_tier_history")
      .select("period, tier, overall_score, multiplier, total_commission, pto_earned")
      .eq("employee_name", employee)
      .eq("store", String(store).toLowerCase())
      .order("period", { ascending: false })
      .limit(13);
    if (error) return NextResponse.json({ success: false, error: error.message });
    var streaks = computeStreaks(data);
    // Diamond plaque progress for current calendar year
    var thisYear = String(new Date().getFullYear());
    var diamondThisYear = (data || []).filter(function(r) {
      return r.period.indexOf(thisYear + "-") === 0 && r.tier === "Diamond";
    }).length;
    return NextResponse.json({
      success: true,
      streaks: streaks,
      history: data || [],
      diamond_plaque: {
        this_year: thisYear,
        diamond_months: diamondThisYear,
        target: 6,
        achieved: diamondThisYear >= 6,
      },
    });
  }

  // ── Celebration queue (admin) ──
  if (action === "celebration_queue") {
    var query = supabase
      .from("tier_celebrations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (store) query = query.eq("store", String(store).toLowerCase());
    var statusFilter = searchParams.get("status"); // pending | done | all
    if (statusFilter === "pending" || !statusFilter) {
      query = query.is("dismissed_at", null);
    }
    var { data: events, error: evErr } = await query;
    if (evErr) return NextResponse.json({ success: false, error: evErr.message });
    return NextResponse.json({ success: true, events: events || [] });
  }

  // ── Full history dump for admin views ──
  if (action === "history") {
    var months = parseInt(searchParams.get("months") || "12");
    var oldest = priorPeriod(currentPeriod(), months - 1);
    var q = supabase
      .from("employee_tier_history")
      .select("*")
      .gte("period", oldest)
      .order("period", { ascending: false });
    if (store) q = q.eq("store", String(store).toLowerCase());
    if (employee) q = q.eq("employee_name", employee);
    var { data: hist, error: hErr } = await q;
    if (hErr) return NextResponse.json({ success: false, error: hErr.message });
    return NextResponse.json({ success: true, history: hist || [] });
  }

  // ── Browser-friendly snapshot/backfill triggers (no curl needed) ──
  // These mirror the POST actions so admins can hit them from a URL bar.
  // Protected by SECRET param matching CRON_SECRET env var if set.
  function checkSecret() {
    var expected = process.env.CRON_SECRET;
    if (!expected) return true; // No secret configured = open
    return searchParams.get("secret") === expected;
  }

  if (action === "snapshot_current_month") {
    if (!checkSecret()) return NextResponse.json({ success: false, error: "Invalid or missing secret" });
    return await snapshotResponse(currentPeriod());
  }

  if (action === "snapshot") {
    if (!checkSecret()) return NextResponse.json({ success: false, error: "Invalid or missing secret" });
    var pParam = searchParams.get("period");
    if (!pParam) return NextResponse.json({ success: false, error: "period required (YYYY-MM)" }, { status: 400 });
    return await snapshotResponse(pParam);
  }

  if (action === "backfill") {
    if (!checkSecret()) return NextResponse.json({ success: false, error: "Invalid or missing secret" });
    return await backfillResponse(parseInt(searchParams.get("months") || "6"));
  }

  return NextResponse.json({ success: false, error: "Invalid action. Use: streaks, celebration_queue, history, snapshot_current_month, snapshot, backfill" });
}

// ────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });

  var body;
  try { body = await request.json(); } catch(e) { body = {}; }
  var action = body.action;

  // ── Snapshot a specific period (idempotent) ──
  if (action === "snapshot") {
    var period = body.period;
    if (!period) return NextResponse.json({ success: false, error: "period required (YYYY-MM)" }, { status: 400 });
    return await snapshotResponse(period);
  }

  // ── Snapshot the current month — designed to be called by cron daily ──
  if (action === "snapshot_current_month") {
    return await snapshotResponse(currentPeriod());
  }

  // ── Backfill: snapshot the past N months ──
  if (action === "backfill") {
    return await backfillResponse(parseInt(body.months) || 6);
  }

  // ── Lock a period (prevents auto-refresh after month closes) ──
  if (action === "lock_period") {
    var lp = body.period;
    if (!lp) return NextResponse.json({ success: false, error: "period required" });
    var { data: locked, error: lErr } = await supabase
      .from("employee_tier_history")
      .update({ is_locked: true, recorded_at: new Date().toISOString() })
      .eq("period", lp)
      .select();
    if (lErr) return NextResponse.json({ success: false, error: lErr.message });
    return NextResponse.json({ success: true, locked: (locked || []).length });
  }

  // ── Mark a celebration event as announced ──
  if (action === "mark_announced") {
    if (!body.event_id) return NextResponse.json({ success: false, error: "event_id required" });
    var { data: a1, error: aErr } = await supabase
      .from("tier_celebrations")
      .update({ announced_at: new Date().toISOString() })
      .eq("id", body.event_id)
      .select();
    if (aErr) return NextResponse.json({ success: false, error: aErr.message });
    return NextResponse.json({ success: true, event: (a1 || [])[0] });
  }

  // ── Mark a celebration event as bonus paid ──
  if (action === "mark_paid") {
    if (!body.event_id) return NextResponse.json({ success: false, error: "event_id required" });
    var { data: p1, error: pErr } = await supabase
      .from("tier_celebrations")
      .update({ bonus_paid_at: new Date().toISOString(), notes: body.notes || null })
      .eq("id", body.event_id)
      .select();
    if (pErr) return NextResponse.json({ success: false, error: pErr.message });
    return NextResponse.json({ success: true, event: (p1 || [])[0] });
  }

  // ── Dismiss a celebration event (admin doesn't want to act on it) ──
  if (action === "dismiss") {
    if (!body.event_id) return NextResponse.json({ success: false, error: "event_id required" });
    var { data: d1, error: dErr } = await supabase
      .from("tier_celebrations")
      .update({ dismissed_at: new Date().toISOString(), notes: body.notes || null })
      .eq("id", body.event_id)
      .select();
    if (dErr) return NextResponse.json({ success: false, error: dErr.message });
    return NextResponse.json({ success: true, event: (d1 || [])[0] });
  }

  return NextResponse.json({ success: false, error: "Invalid action. Use: snapshot, snapshot_current_month, backfill, lock_period, mark_announced, mark_paid, dismiss" });
}

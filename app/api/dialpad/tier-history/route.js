import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
  // period = 'YYYY-MM', returns the period n months earlier
  n = n || 1;
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
  var origin = opts.origin || process.env.NEXT_PUBLIC_BASE_URL || "";
  if (!origin) {
    // Best-effort: derive from VERCEL_URL
    if (process.env.VERCEL_URL) origin = "https://" + process.env.VERCEL_URL;
  }
  if (!origin) {
    return { success: false, error: "Cannot determine base URL for internal scorecard fetch" };
  }

  // Fetch scorecard for this period
  var url = origin + "/api/dialpad/scorecard?period=" + encodeURIComponent(period);
  var sRes;
  try {
    sRes = await fetch(url);
  } catch (e) {
    return { success: false, error: "Scorecard fetch failed: " + e.message };
  }
  if (!sRes.ok) return { success: false, error: "Scorecard route returned " + sRes.status };
  var sData = await sRes.json();
  if (!sData.success) return { success: false, error: "Scorecard route error: " + sData.error };

  var employeeScores = sData.employeeScores || [];

  // Pull per-employee commission inputs for the same period (so we can store
  // base_commission and tier_bonus alongside the tier).
  var commUrl = origin + "/api/dialpad/sales?action=performance&period=" + encodeURIComponent(period);
  var commRes;
  try { commRes = await fetch(commUrl); } catch(e) { commRes = null; }
  var commData = commRes && commRes.ok ? await commRes.json() : null;
  var commRates = commData && commData.rates ? commData.rates : {};
  function findEmp(arr, name) {
    return (arr || []).find(function(e) { return (e.employee || "").toLowerCase() === (name || "").toLowerCase(); });
  }

  var written = 0, eventsCreated = 0, errors = [];
  var KNOWN = ["fishers", "bloomington", "indianapolis"];

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
      updated_at: new Date().toISOString(),
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
    var streaks = computeStreaks(hist);
    // Gold streak: every 3 consecutive months at Gold or higher = $100
    if (streaks.gold > 0 && streaks.gold % 3 === 0) {
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
    if (streaks.platinum > 0 && streaks.platinum % 3 === 0) {
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
    if (diamondMonthsThisYear >= 6) {
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

  return { success: true, period: period, written: written, events_created: eventsCreated, errors: errors };
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

  return NextResponse.json({ success: false, error: "Invalid action. Use: streaks, celebration_queue, history" });
}

// ────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });

  var origin = new URL(request.url).origin;
  var body;
  try { body = await request.json(); } catch(e) { body = {}; }
  var action = body.action;

  // ── Snapshot a specific period (idempotent) ──
  if (action === "snapshot") {
    var period = body.period;
    if (!period) return NextResponse.json({ success: false, error: "period required (YYYY-MM)" });
    var result = await snapshotPeriod(period, { origin: origin });
    return NextResponse.json(result);
  }

  // ── Snapshot the current month — designed to be called by cron daily ──
  if (action === "snapshot_current_month") {
    var cur = currentPeriod();
    var result = await snapshotPeriod(cur, { origin: origin });
    return NextResponse.json(result);
  }

  // ── Backfill: snapshot the past N months ──
  if (action === "backfill") {
    var months = parseInt(body.months) || 6;
    var results = [];
    var cur = currentPeriod();
    // Walk backwards from current month
    for (var i = 0; i < months; i++) {
      var p = priorPeriod(cur, i);
      var r = await snapshotPeriod(p, { origin: origin });
      results.push({ period: p, written: r.written || 0, events: r.events_created || 0, error: r.error || null });
    }
    return NextResponse.json({ success: true, periods: results });
  }

  // ── Lock a period (prevents auto-refresh after month closes) ──
  if (action === "lock_period") {
    var lp = body.period;
    if (!lp) return NextResponse.json({ success: false, error: "period required" });
    var { data: locked, error: lErr } = await supabase
      .from("employee_tier_history")
      .update({ is_locked: true, updated_at: new Date().toISOString() })
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

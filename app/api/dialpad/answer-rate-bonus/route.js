import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// ANSWER-RATE BONUS — single source of truth
//
// Standalone, flat per-employee bonus based on each store's OPEN-HOURS answer
// rate for a calendar month. NOT part of the weighted scorecard.
//
// Tiers (highest reached only — NOT cumulative):
//   >= 90%  -> $100 / employee
//   >= 85%  -> $75  / employee
//   >= 80%  -> $50  / employee
//   <  80%  -> $0
//
// Rate = answered / (answered + open-hours missed), where "open-hours missed"
// EXCLUDES calls Dialpad tagged availability="closed". This matches exactly the
// open-hours rate shown on the TV (see app/api/dialpad/stored/route.js).
//
// Employee -> store assignment: each employee is assigned to the store where
// they logged the MOST WhenIWork hours in the month. Their bonus is the flat
// tier amount for that store.
//
// Payout basis: LIVE current-month rate. Mid-month the rate is still moving; the
// returned numbers always reflect the rate "as of now".
//
// GET /api/dialpad/answer-rate-bonus            -> current calendar month
// GET /api/dialpad/answer-rate-bonus?month=2026-05  -> a specific month
// ─────────────────────────────────────────────────────────────────────────────

// Tier table — single place to change the thresholds/amounts.
var BONUS_TIERS = [
  { min: 90, amount: 100 },
  { min: 85, amount: 75 },
  { min: 80, amount: 50 },
];

var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];

// ── Short-call exclusion (Eric, 2026-08-31) ─────────────────────────────────
// Answered calls shorter than 15 seconds are not real answered opportunities —
// they are test calls, hangups, misdials and wrong numbers. From the effective
// period forward they are removed from BOTH sides of the rate (they are in the
// answered count, never the missed count, so removing them lowers the rate).
//
// FORWARD-ONLY, and that is deliberate. Applied retroactively this would have
// pushed Fishers and Bloomington below 80% in July, and Bloomington in August,
// clawing back $50 bonuses that were already earned. Periods before the
// effective month are returned exactly as they were.
//
// ⚠ UNITS: call_records.talk_duration is stored in MINUTES, not seconds.
// 15 seconds is 0.25. Writing `< 15` here would match every call ever recorded
// and drive every answer rate to zero. See CLAUDE.md gotchas.
var SHORT_CALL_EFFECTIVE_PERIOD = "2026-09";   // YYYY-MM, inclusive
var SHORT_CALL_MIN_MINUTES = 0.25;             // 15 seconds

function shortCallFilterApplies(monthStr) {
  return String(monthStr) >= SHORT_CALL_EFFECTIVE_PERIOD;
}

// Map a rate (0-100) to the highest tier reached. Returns { amount, tier }.
function tierForRate(rate) {
  for (var i = 0; i < BONUS_TIERS.length; i++) {
    if (rate >= BONUS_TIERS[i].min) {
      return { amount: BONUS_TIERS[i].amount, tier: BONUS_TIERS[i].min };
    }
  }
  return { amount: 0, tier: null };
}

// Compute [start, endExclusive) YYYY-MM-DD bounds for a calendar month.
// monthStr is "YYYY-MM". Uses local (Indiana) calendar semantics via plain
// string math so there's no UTC drift.
function monthBounds(monthStr) {
  var parts = monthStr.split("-");
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10); // 1-12
  var start = year + "-" + String(month).padStart(2, "0") + "-01";
  var endMonth = month === 12 ? 1 : month + 1;
  var endYear = month === 12 ? year + 1 : year;
  var endExclusive = endYear + "-" + String(endMonth).padStart(2, "0") + "-01";
  return { start: start, endExclusive: endExclusive };
}

function currentMonthStr() {
  // Indiana local "now" so the month flips at local midnight, not UTC.
  var now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

// Indiana-local "today" as YYYY-MM-DD. Used to clamp the shift window to
// month-to-date so future PUBLISHED shifts aren't summed.
function indyTodayYMD() {
  var now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

// Inclusive last calendar day of a "YYYY-MM" month as YYYY-MM-DD.
function lastDayOfMonthYMD(monthStr) {
  var parts = monthStr.split("-");
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10); // 1-12
  var lastDay = new Date(year, month, 0).getDate();
  return parts[0] + "-" + String(month).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0");
}

export async function GET(request) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Database not configured" });
  }

  try {
    var { searchParams } = new URL(request.url);
    var month = searchParams.get("month") || currentMonthStr();
    var bounds = monthBounds(month);
    var startTs = bounds.start + "T00:00:00.000Z";
    var endTs = bounds.endExclusive + "T00:00:00.000Z";

    // ── 1. Answered per store/day from daily_call_volume (calendar month) ──
    var volRes = await supabase
      .from("daily_call_volume")
      .select("call_date, store, answered")
      .gte("call_date", bounds.start)
      .lt("call_date", bounds.endExclusive);
    if (volRes.error) return NextResponse.json({ success: false, error: volRes.error.message });

    // ── 2. Missed inbound dept calls (with availability) for the month ──
    var missedRes = await supabase
      .from("call_records")
      .select("date_started, store, categories, availability")
      .eq("target_type", "department")
      .eq("direction", "inbound")
      .eq("is_missed", true)
      .gte("date_started", startTs)
      .lt("date_started", endTs)
      .limit(20000);
    if (missedRes.error) return NextResponse.json({ success: false, error: missedRes.error.message });

    // ── 2b. Short answered calls to exclude (effective period forward) ──
    // Subtractive on purpose: `answered` keeps coming from daily_call_volume so
    // the existing baseline cannot drift. Verified 2026-08-31 that the view and
    // call_records agree exactly (456/414/498 for Aug), so the two populations
    // line up and this subtracts the right rows.
    var shortByStore = {};
    STORE_KEYS.forEach(function(s) { shortByStore[s] = 0; });
    var shortFilterOn = shortCallFilterApplies(month);
    if (shortFilterOn) {
      var shortRes = await supabase
        .from("call_records")
        .select("store, talk_duration, categories")
        .eq("target_type", "department")
        .eq("direction", "inbound")
        .eq("is_answered", true)
        .lt("talk_duration", SHORT_CALL_MIN_MINUTES)
        .gte("date_started", startTs)
        .lt("date_started", endTs)
        .limit(20000);
      if (shortRes.error) return NextResponse.json({ success: false, error: shortRes.error.message }, { status: 500 });
      (shortRes.data || []).forEach(function(row) {
        if (!row.store || shortByStore[row.store] === undefined) return;
        var cats = (row.categories || "").toLowerCase().split(/[,\s|]+/);
        if (cats.indexOf("dismissed") >= 0) return;
        shortByStore[row.store] += 1;
      });
    }

    // Open-hours missed per store (exclude availability=closed; also drop
    // answered/dismissed transfer artifacts — same rule as getHourlyMissed).
    var answeredByStore = {};
    var openMissedByStore = {};
    var closedMissedByStore = {};
    STORE_KEYS.forEach(function(s) {
      answeredByStore[s] = 0;
      openMissedByStore[s] = 0;
      closedMissedByStore[s] = 0;
    });

    (volRes.data || []).forEach(function(row) {
      if (!row.store || answeredByStore[row.store] === undefined) return;
      answeredByStore[row.store] += row.answered || 0;
    });

    (missedRes.data || []).forEach(function(row) {
      if (!row.store || openMissedByStore[row.store] === undefined) return;
      var cats = (row.categories || "").toLowerCase().split(/[,\s|]+/);
      if (cats.indexOf("answered") >= 0) return;   // actually answered transfer
      if (cats.indexOf("dismissed") >= 0) return;  // declined transfer, handled
      if (String(row.availability || "").toLowerCase() === "closed") {
        closedMissedByStore[row.store] += 1;
      } else {
        openMissedByStore[row.store] += 1;
      }
    });

    // ── 3. Per-store rate + tier ──
    var stores = STORE_KEYS.map(function(s) {
      var answeredRaw = answeredByStore[s];
      var shortExcluded = shortByStore[s];
      // Short calls sit in the answered count only, never in missed, so removing
      // them shrinks the numerator and the denominator by the same amount.
      var answered = answeredRaw - shortExcluded;
      var openMissed = openMissedByStore[s];
      var total = answered + openMissed;
      var rate = total > 0 ? (answered / total) * 100 : 0;
      var t = tierForRate(rate);
      return {
        store: s,
        answered: answered,
        // Surfaced so testing stays visible and praised rather than invisible.
        answered_before_short_exclusion: answeredRaw,
        short_calls_excluded: shortExcluded,
        short_call_filter_applied: shortFilterOn,
        short_call_threshold_seconds: Math.round(SHORT_CALL_MIN_MINUTES * 60),
        open_missed: openMissed,
        after_hours_missed: closedMissedByStore[s],
        total_open: total,
        answer_rate: total > 0 ? Math.round(rate * 10) / 10 : null,
        tier: t.tier,
        per_employee_bonus: t.amount,
      };
    });
    var bonusByStore = {};
    stores.forEach(function(s) { bonusByStore[s.store] = s.per_employee_bonus; });

    // ── 4. Employee -> store assignment (max WhenIWork hours that month) ──
    // Month-to-date clamp: WhenIWork publishes the whole month's schedule ahead
    // of time, so an unclamped full-month window sums shifts that haven't been
    // worked yet. That can mis-assign a mid-month floater to the store they're
    // SCHEDULED to work most rather than where they've worked most SO FAR — and
    // the assigned store is what picks the bonus tier. Clamping to today (Indiana
    // local) matches this route's "as of now" design. Past months are unaffected
    // (today is already beyond their last day). Only the shift window is clamped;
    // the call windows above need no clamp since no future calls exist.
    var shiftLastDay = lastDayOfMonthYMD(month);
    var todayYMD = indyTodayYMD();
    var shiftEndIncl = todayYMD < shiftLastDay ? todayYMD : shiftLastDay;
    var shiftRes = await supabase
      .from("employee_shifts")
      .select("employee_name, user_id, store, hours, date, synced_at")
      .gte("date", bounds.start)
      .lte("date", shiftEndIncl)
      .limit(5000);
    if (shiftRes.error) return NextResponse.json({ success: false, error: shiftRes.error.message });

    // Defensive dedup: one shift per (user_id, date), latest synced_at wins —
    // same rule the rest of the app uses so phantom duplicate shifts can't skew
    // the assignment.
    var bestByKey = {};
    (shiftRes.data || []).forEach(function(sh) {
      if (!sh.user_id || !sh.date) return;
      var key = sh.user_id + "|" + sh.date;
      var prev = bestByKey[key];
      if (!prev) { bestByKey[key] = sh; return; }
      var a = sh.synced_at || "";
      var b = prev.synced_at || "";
      if (a > b) bestByKey[key] = sh;
    });

    // Sum hours per (user_id) per store.
    var byUser = {};
    Object.keys(bestByKey).forEach(function(k) {
      var sh = bestByKey[k];
      var uid = String(sh.user_id);
      if (!byUser[uid]) byUser[uid] = { name: sh.employee_name || "Unknown", user_id: uid, hours: {} };
      // Keep the most recent display name we see.
      if (sh.employee_name) byUser[uid].name = sh.employee_name;
      var st = sh.store;
      if (STORE_KEYS.indexOf(st) === -1) return; // ignore "unknown" store
      byUser[uid].hours[st] = (byUser[uid].hours[st] || 0) + (parseFloat(sh.hours) || 0);
    });

    // Assign each employee to their max-hours store, attach the store's bonus.
    var employees = Object.keys(byUser).map(function(uid) {
      var u = byUser[uid];
      var assignedStore = null;
      var maxHours = -1;
      STORE_KEYS.forEach(function(st) {
        var h = u.hours[st] || 0;
        if (h > maxHours) { maxHours = h; assignedStore = st; }
      });
      var bonus = assignedStore ? (bonusByStore[assignedStore] || 0) : 0;
      return {
        employee: u.name,
        user_id: u.user_id,
        assigned_store: assignedStore,
        assigned_hours: Math.round(maxHours * 100) / 100,
        hours_by_store: u.hours,
        bonus: bonus,
      };
    }).filter(function(e) {
      // Only employees who actually logged hours at a real store this month.
      return e.assigned_store && e.assigned_hours > 0;
    }).sort(function(a, b) {
      // Sort by store, then highest bonus, then name — stable for display.
      if (a.assigned_store !== b.assigned_store) return a.assigned_store < b.assigned_store ? -1 : 1;
      if (b.bonus !== a.bonus) return b.bonus - a.bonus;
      return (a.employee || "").localeCompare(b.employee || "");
    });

    // ── 5. Totals for the admin/payroll view ──
    var totalPayout = employees.reduce(function(sum, e) { return sum + e.bonus; }, 0);
    var employeesByStore = {};
    STORE_KEYS.forEach(function(s) { employeesByStore[s] = 0; });
    employees.forEach(function(e) { employeesByStore[e.assigned_store] += 1; });

    return NextResponse.json({
      success: true,
      month: month,
      tiers: BONUS_TIERS,
      stores: stores,
      employees: employees,
      totals: {
        total_payout: totalPayout,
        employee_count: employees.length,
        employees_by_store: employeesByStore,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

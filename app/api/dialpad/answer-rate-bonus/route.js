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
      var answered = answeredByStore[s];
      var openMissed = openMissedByStore[s];
      var total = answered + openMissed;
      var rate = total > 0 ? (answered / total) * 100 : 0;
      var t = tierForRate(rate);
      return {
        store: s,
        answered: answered,
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
    var shiftRes = await supabase
      .from("employee_shifts")
      .select("employee_name, user_id, store, hours, date, synced_at")
      .gte("date", bounds.start)
      .lt("date", bounds.endExclusive)
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

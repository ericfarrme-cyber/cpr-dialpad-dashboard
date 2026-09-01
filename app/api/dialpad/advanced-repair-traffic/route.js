import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// ADVANCED REPAIR TRAFFIC — non-phone repair volume, mix and profit.
//
// Distinct from /api/advanced-repairs, which is the manual per-employee
// COMMISSION tracker built on the `advanced_repairs` table. This one is a
// read-only summary computed from `ticket_grades`, i.e. what RepairQ actually
// closed, and answers "how much non-phone work are we doing, and is it growing".
//
// Scope (Eric, 2026-09-01):
//   • Repair and Claim tickets only. SALE tickets are excluded — accessories and
//     screen protectors are not repair work. In Aug 2026 that is 870 tickets and
//     $22,711 of profit, deliberately out of scope.
//   • Non-phone = the categories in NON_PHONE below. `phone` is counted only to
//     compute non-phone's share of repair traffic.
//
// Money comes from RepairQ's Profitability by Ticket import (see
// tools/import-profitability.py), which is the source of truth; the ticket page
// disagrees with it on roughly half of tickets.
//
// ⚠ DATA QUALITY: `device_category` is blank on 75% of April 2026 repair/claim
// tickets — legacy failed scrapes whose raw_items read "(not found on page)".
// May 2026 onward is 100% categorised. Every month carries `complete` and
// `uncategorised` so the UI can grey out a month rather than show a wrong total.
// Nothing is ever silently dropped.
//
// GET /api/dialpad/advanced-repair-traffic            -> trailing 6 months
// GET /api/dialpad/advanced-repair-traffic?months=12
// GET /api/dialpad/advanced-repair-traffic?store=fishers
// ─────────────────────────────────────────────────────────────────────────────

var NON_PHONE = ["game_console", "tablet", "laptop", "computer", "other", "watch"];
var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];

// A month is trustworthy only if essentially every repair/claim ticket carries a
// category. Below this the total is a floor, not a total, and the UI says so.
var COMPLETE_THRESHOLD = 0.95;

// Bonus rules (Eric, 2026-09-01): $100 on reaching the threshold, then $50 per
// FULL $1,000 above it. Partial thousands are not paid.
var BONUS_THRESHOLD = 15000;
var BONUS_BASE = 100;
var BONUS_PER_1000 = 50;

function bucketFor(cat) {
  if (cat === "game_console") return "consoles";
  if (cat === "tablet") return "tablets";
  if (cat === "laptop" || cat === "computer") return "computers";
  return "misc";
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

// Indiana-local "now", so the month rolls at local midnight rather than UTC.
function indyNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
}

// First day of the month `back` months before the current one, as YYYY-MM-DD.
function monthStart(back) {
  var d = indyNow();
  var y = d.getFullYear(), m = d.getMonth() - back;
  while (m < 0) { m += 12; y -= 1; }
  return y + "-" + pad2(m + 1) + "-01";
}

function isRepairish(t) {
  return t === "Repair" || t === "Claim";
}

export async function GET(request) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Database not configured" }, { status: 500 });
  }

  try {
    var { searchParams } = new URL(request.url);
    var months = parseInt(searchParams.get("months") || "6", 10);
    if (!isFinite(months) || months < 1) months = 6;
    if (months > 24) months = 24;
    var storeFilter = searchParams.get("store");
    if (storeFilter === "all") storeFilter = null;

    var startYMD = monthStart(months - 1);

    // Paginate — PostgREST caps every response at the project's Max rows
    // setting regardless of any .limit(), so loop with .range() until short.
    // A stable .order() is required so rows don't shift between pages.
    var pageSize = 1000;
    var rows = [];
    var from = 0;
    while (true) {
      var q = supabase
        .from("ticket_grades")
        .select("ticket_number, ticket_type, device_category, store, date_closed, gross_sales, gross_profit, turnaround_hours, employee_repaired")
        .gte("date_closed", startYMD)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (storeFilter) q = q.eq("store", storeFilter);
      var res = await q;
      if (res.error) {
        return NextResponse.json({ success: false, error: res.error.message }, { status: 500 });
      }
      var page = res.data || [];
      for (var i = 0; i < page.length; i++) rows.push(page[i]);
      if (page.length < pageSize) break;
      from += pageSize;
    }

    // ── Aggregate ───────────────────────────────────────────────────────────
    var byMonth = {};
    function monthBucket(key) {
      if (!byMonth[key]) {
        byMonth[key] = {
          month: key,
          tickets: 0, revenue: 0, profit: 0,
          phone_tickets: 0,
          repairish_total: 0, uncategorised: 0,
          buckets: { consoles: mk(), tablets: mk(), computers: mk(), misc: mk() },
          stores: {},
        };
        STORE_KEYS.forEach(function (s) { byMonth[key].stores[s] = { tickets: 0, profit: 0 }; });
      }
      return byMonth[key];
    }
    function mk() { return { tickets: 0, profit: 0, turnaround_sum: 0, turnaround_n: 0 }; }

    rows.forEach(function (r) {
      if (!isRepairish(r.ticket_type)) return;          // Sale tickets excluded
      if (!r.date_closed) return;                        // unclosed carries no revenue event
      var key = String(r.date_closed).slice(0, 7);
      var M = monthBucket(key);

      M.repairish_total += 1;
      if (!r.device_category) { M.uncategorised += 1; return; }
      if (r.device_category === "phone") { M.phone_tickets += 1; return; }
      if (NON_PHONE.indexOf(r.device_category) < 0) return;

      var gp = parseFloat(r.gross_profit || 0);
      var gs = parseFloat(r.gross_sales || 0);
      M.tickets += 1;
      M.revenue += gs;
      M.profit += gp;

      var b = M.buckets[bucketFor(r.device_category)];
      b.tickets += 1;
      b.profit += gp;
      var th = parseFloat(r.turnaround_hours || 0);
      if (th > 0) { b.turnaround_sum += th; b.turnaround_n += 1; }

      if (r.store && M.stores[r.store]) {
        M.stores[r.store].tickets += 1;
        M.stores[r.store].profit += gp;
      }
    });

    var round2 = function (n) { return Math.round(n * 100) / 100; };

    var series = Object.keys(byMonth).sort().map(function (k) {
      var M = byMonth[k];
      var categorised = M.repairish_total - M.uncategorised;
      var coverage = M.repairish_total > 0 ? categorised / M.repairish_total : 1;
      var denom = M.tickets + M.phone_tickets;

      var buckets = {};
      Object.keys(M.buckets).forEach(function (b) {
        var v = M.buckets[b];
        buckets[b] = {
          tickets: v.tickets,
          profit: round2(v.profit),
          avg_per_ticket: v.tickets > 0 ? round2(v.profit / v.tickets) : 0,
          avg_turnaround_hours: v.turnaround_n > 0 ? round2(v.turnaround_sum / v.turnaround_n) : null,
        };
      });

      var stores = {};
      STORE_KEYS.forEach(function (s) {
        stores[s] = { tickets: M.stores[s].tickets, profit: round2(M.stores[s].profit) };
      });

      var over = M.profit - BONUS_THRESHOLD;
      return {
        month: k,
        tickets: M.tickets,
        revenue: round2(M.revenue),
        profit: round2(M.profit),
        avg_per_ticket: M.tickets > 0 ? round2(M.profit / M.tickets) : 0,
        phone_tickets: M.phone_tickets,
        share_of_repair_traffic: denom > 0 ? round2((M.tickets / denom) * 100) : null,
        buckets: buckets,
        stores: stores,
        // Data quality — surfaced, never used to silently hide a month.
        uncategorised: M.uncategorised,
        repairish_total: M.repairish_total,
        coverage_pct: round2(coverage * 100),
        complete: coverage >= COMPLETE_THRESHOLD,
        // Bonus projection. Only meaningful when `complete` is true.
        bonus: {
          threshold: BONUS_THRESHOLD,
          over: round2(over),
          cleared: M.profit >= BONUS_THRESHOLD,
          amount: M.profit >= BONUS_THRESHOLD
            ? BONUS_BASE + Math.floor(over / 1000) * BONUS_PER_1000
            : 0,
          unpaid_remainder: M.profit >= BONUS_THRESHOLD ? round2(over - Math.floor(over / 1000) * 1000) : 0,
        },
      };
    });

    // Technicians for the most recent COMPLETE month — an incomplete month would
    // rank people on partial data.
    var techs = [];
    var latestComplete = null;
    for (var j = series.length - 1; j >= 0; j--) {
      if (series[j].complete) { latestComplete = series[j].month; break; }
    }
    if (latestComplete) {
      var tally = {};
      rows.forEach(function (r) {
        if (!isRepairish(r.ticket_type) || !r.date_closed) return;
        if (String(r.date_closed).slice(0, 7) !== latestComplete) return;
        if (NON_PHONE.indexOf(r.device_category) < 0) return;
        var who = (r.employee_repaired || "").trim() || "Unattributed";
        if (!tally[who]) tally[who] = { employee: who, tickets: 0, profit: 0 };
        tally[who].tickets += 1;
        tally[who].profit += parseFloat(r.gross_profit || 0);
      });
      techs = Object.keys(tally).map(function (k) {
        var t = tally[k];
        return {
          employee: t.employee,
          tickets: t.tickets,
          profit: round2(t.profit),
          avg_per_ticket: t.tickets > 0 ? round2(t.profit / t.tickets) : 0,
        };
      }).sort(function (a, b) { return b.tickets - a.tickets; });
    }

    return NextResponse.json({
      success: true,
      months: series,
      technicians: techs,
      technicians_month: latestComplete,
      scope: {
        non_phone_categories: NON_PHONE,
        excludes: "Sale tickets (accessories) are excluded — not repair work",
        bonus: { threshold: BONUS_THRESHOLD, base: BONUS_BASE, per_1000: BONUS_PER_1000 },
        source: "ticket_grades; money reconciled to RepairQ's Profitability by Ticket export",
      },
    });
  } catch (err) {
    console.error("[advanced-repair-traffic]", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

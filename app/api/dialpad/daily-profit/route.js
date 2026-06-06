import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// DAILY PROFIT — gross profit per store per day, from graded tickets.
//
// Source: ticket_grades (populated by the RepairQ Chrome extension). Each row
// already carries gross_profit, gross_sales, total_cost, store, and date_closed.
// We sum gross_profit grouped by (store, date_closed).
//
// IMPORTANT HONESTY NOTE surfaced to the UI: this is GP on CAPTURED tickets —
// tickets the extension scraped into ticket_grades. It is NOT a complete store
// P&L (no rent/payroll/overhead — that lives on the Profitability tab) and can
// undercount if grading coverage for a day is incomplete. The response includes
// per-day ticket counts so the UI can show coverage context.
//
// Date basis: date_closed (the revenue event — customer paid / picked up).
// Sale tickets and repair tickets both count; we exclude rows with no
// date_closed (not yet a completed revenue event) and rows with no store.
//
// GET /api/dialpad/daily-profit?window=90        -> trailing 90 days (default)
// GET /api/dialpad/daily-profit?window=30        -> trailing 30 days
// GET /api/dialpad/daily-profit?month=2026-06    -> a specific calendar month
// ─────────────────────────────────────────────────────────────────────────────

var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

// Indiana-local "today" as YYYY-MM-DD.
function todayLocalYMD() {
  var d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function addDaysYMD(ymd, delta) {
  var p = ymd.split("-");
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function monthBounds(monthStr) {
  var p = monthStr.split("-");
  var year = parseInt(p[0], 10);
  var month = parseInt(p[1], 10);
  var start = year + "-" + pad2(month) + "-01";
  var endMonth = month === 12 ? 1 : month + 1;
  var endYear = month === 12 ? year + 1 : year;
  var endExclusive = endYear + "-" + pad2(endMonth) + "-01";
  return { start: start, endExclusive: endExclusive };
}

// Normalize a stored date_closed (could be ISO timestamp or date) to YYYY-MM-DD.
function toYMD(val) {
  if (!val) return null;
  var s = String(val);
  // Already YYYY-MM-DD or starts with it
  var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  var d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export async function GET(request) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Database not configured" });
  }

  try {
    var { searchParams } = new URL(request.url);
    var month = searchParams.get("month");
    var windowDays = parseInt(searchParams.get("window") || "90", 10);

    var startYMD, endExclusiveYMD, label;
    if (month) {
      var b = monthBounds(month);
      startYMD = b.start;
      endExclusiveYMD = b.endExclusive;
      label = month;
    } else {
      var today = todayLocalYMD();
      // window is inclusive of today; endExclusive = today + 1
      startYMD = addDaysYMD(today, -(windowDays - 1));
      endExclusiveYMD = addDaysYMD(today, 1);
      label = "last " + windowDays + " days";
    }

    // Pull graded tickets in range. ticket_grades.date_closed may be a date or
    // timestamp; query a slightly padded ISO range, then bucket precisely in JS.
    var startTs = startYMD + "T00:00:00.000Z";
    var endTs = endExclusiveYMD + "T00:00:00.000Z";

    var res = await supabase
      .from("ticket_grades")
      .select("store, date_closed, gross_profit, gross_sales, total_cost, ticket_number")
      .not("date_closed", "is", null)
      .gte("date_closed", startTs)
      .lt("date_closed", endTs)
      .limit(50000);
    if (res.error) return NextResponse.json({ success: false, error: res.error.message });

    // Bucket by store -> date -> aggregates. Dedup by ticket_number per store so
    // a ticket scraped twice can't double-count profit.
    var seen = {}; // store|ticket_number -> true
    var byStoreDate = {}; // store -> { date -> {gp, rev, cost, count} }
    STORE_KEYS.forEach(function(s) { byStoreDate[s] = {}; });

    (res.data || []).forEach(function(row) {
      var store = row.store;
      if (STORE_KEYS.indexOf(store) === -1) return;
      var ymd = toYMD(row.date_closed);
      if (!ymd) return;
      // Guard: ensure within the local-date window (the ISO query is UTC-padded)
      if (ymd < startYMD || ymd >= endExclusiveYMD) return;

      var tn = row.ticket_number ? String(row.ticket_number) : null;
      if (tn) {
        var dedupKey = store + "|" + tn;
        if (seen[dedupKey]) return;
        seen[dedupKey] = true;
      }

      if (!byStoreDate[store][ymd]) byStoreDate[store][ymd] = { gp: 0, rev: 0, cost: 0, count: 0 };
      var cell = byStoreDate[store][ymd];
      cell.gp += parseFloat(row.gross_profit || 0);
      cell.rev += parseFloat(row.gross_sales || 0);
      cell.cost += parseFloat(row.total_cost || 0);
      cell.count += 1;
    });

    // Build a continuous date axis from start..end-1 so charts have no gaps.
    var dates = [];
    var cursor = startYMD;
    var guard = 0;
    while (cursor < endExclusiveYMD && guard < 800) {
      dates.push(cursor);
      cursor = addDaysYMD(cursor, 1);
      guard++;
    }

    // Per-store daily series + summary stats.
    var stores = STORE_KEYS.map(function(s) {
      var map = byStoreDate[s];
      var series = dates.map(function(d) {
        var c = map[d] || { gp: 0, rev: 0, cost: 0, count: 0 };
        return {
          date: d,
          gp: Math.round(c.gp * 100) / 100,
          revenue: Math.round(c.rev * 100) / 100,
          cost: Math.round(c.cost * 100) / 100,
          tickets: c.count,
        };
      });

      // 7-day trailing rolling average of GP (for the smoothed line).
      var rolling = series.map(function(_, i) {
        var lo = Math.max(0, i - 6);
        var sum = 0, n = 0;
        for (var j = lo; j <= i; j++) { sum += series[j].gp; n++; }
        return Math.round((sum / n) * 100) / 100;
      });
      series.forEach(function(pt, i) { pt.gp_avg7 = rolling[i]; });

      var totalGp = series.reduce(function(a, p) { return a + p.gp; }, 0);
      var totalRev = series.reduce(function(a, p) { return a + p.revenue; }, 0);
      var totalTickets = series.reduce(function(a, p) { return a + p.tickets; }, 0);
      var activeDays = series.filter(function(p) { return p.tickets > 0; }).length;
      var best = series.reduce(function(b, p) { return (!b || p.gp > b.gp) ? p : b; }, null);

      // Day-of-week aggregation (0=Sun..6=Sat) for rhythm analysis.
      var dow = [0, 1, 2, 3, 4, 5, 6].map(function() { return { gp: 0, tickets: 0, days: 0 }; });
      series.forEach(function(p) {
        var parts = p.date.split("-");
        var dt = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        var k = dt.getDay();
        dow[k].gp += p.gp;
        dow[k].tickets += p.tickets;
        if (p.tickets > 0) dow[k].days += 1;
      });

      return {
        store: s,
        series: series,
        totals: {
          gp: Math.round(totalGp * 100) / 100,
          revenue: Math.round(totalRev * 100) / 100,
          tickets: totalTickets,
          active_days: activeDays,
          avg_gp_per_ticket: totalTickets > 0 ? Math.round((totalGp / totalTickets) * 100) / 100 : 0,
          avg_gp_per_active_day: activeDays > 0 ? Math.round((totalGp / activeDays) * 100) / 100 : 0,
          best_day: best ? { date: best.date, gp: best.gp, tickets: best.tickets } : null,
          gpm_pct: totalRev > 0 ? Math.round((totalGp / totalRev) * 1000) / 10 : 0,
        },
        dow: dow.map(function(x) {
          return {
            gp: Math.round(x.gp * 100) / 100,
            tickets: x.tickets,
            avg_gp: x.days > 0 ? Math.round((x.gp / x.days) * 100) / 100 : 0,
          };
        }),
      };
    });

    // Combined (all-stores) totals.
    var combined = {
      gp: 0, revenue: 0, tickets: 0,
    };
    stores.forEach(function(s) {
      combined.gp += s.totals.gp;
      combined.revenue += s.totals.revenue;
      combined.tickets += s.totals.tickets;
    });
    combined.gp = Math.round(combined.gp * 100) / 100;
    combined.revenue = Math.round(combined.revenue * 100) / 100;
    combined.gpm_pct = combined.revenue > 0 ? Math.round((combined.gp / combined.revenue) * 1000) / 10 : 0;
    combined.avg_gp_per_ticket = combined.tickets > 0 ? Math.round((combined.gp / combined.tickets) * 100) / 100 : 0;

    return NextResponse.json({
      success: true,
      label: label,
      range: { start: startYMD, end_exclusive: endExclusiveYMD },
      dates: dates,
      stores: stores,
      combined: combined,
      note: "Gross profit on captured (graded) tickets, by date closed. Not a full store P&L — excludes rent, payroll, and overhead.",
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

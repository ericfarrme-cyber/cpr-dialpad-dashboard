import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildResolver, resolveName } from "@/lib/roster-resolver";

// ─────────────────────────────────────────────────────────────────────────────
// ZERO / NEGATIVE PROFIT TICKETS
//
// Matt, 2026-09-10: "a section that we can put like tickets that are zero or
// negative profit... sort by like a month or by employee." This is how refunded
// benches, warranty redos and mis-logged tickets surface.
//
// READ-ONLY and deliberately its own route: app/api/dialpad/tickets/route.js is
// payroll-sensitive because it WRITES ticket_grades, and a reporting query has
// no business living in it.
//
// Three buckets, never one number. Lumping them together produces a list that
// sends Matt chasing tickets that are only a data-capture gap:
//
//   loss     gross_profit < 0                       — real money lost
//   zero     gross_profit = 0 and the line items agree
//   suspect  gross_profit = 0 but sales - discount - cost is materially not 0
//
// The suspect bucket is the known Chrome-extension scraping bug (CONTEXT § 10):
// some GP values were floored at $0 and some were never captured at all. Twelve
// of them are hiding real POSITIVE profit, so treating them as losses would be
// wrong in both directions.
//
// gross_profit is displayed as stored, never recomputed. RepairQ's Profitability
// by Ticket export is the source of truth (CONTEXT § 10) and it accounts for
// returns and adjustments that sales - cost does not.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

var PAGE = 1000;
var SUSPECT_TOLERANCE = 1; // dollars; below this, rounding noise not a real gap

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  var n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

// Paginated read — ticket_grades is ~4,800 rows and climbing, and a silent
// clip is exactly how this project has been bitten before.
async function fetchAll(store) {
  var out = [];
  for (var from = 0; ; from += PAGE) {
    var q = supabase
      .from("ticket_grades")
      .select("ticket_number,store,ticket_type,gross_sales,gross_profit,total_cost,discount_amount,total_collected,employee_repaired,employee_added,date_closed,device_category,device_brand,device,turnaround_hours")
      .lte("gross_profit", 0)
      .not("gross_profit", "is", null)
      .order("gross_profit", { ascending: true })
      .range(from, from + PAGE - 1);
    if (store && store !== "all") q = q.eq("store", store);
    var res = await q;
    if (res.error) throw new Error(res.error.message);
    var batch = res.data || [];
    out = out.concat(batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function classify(r) {
  var gp = num(r.gross_profit);
  var implied = num(r.gross_sales) - num(r.discount_amount) - num(r.total_cost);
  if (gp < 0) return { bucket: "loss", implied: implied };
  if (Math.abs(implied) > SUSPECT_TOLERANCE) return { bucket: "suspect", implied: implied };
  return { bucket: "zero", implied: implied };
}

export async function GET(request) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  }

  try {
    var { searchParams } = new URL(request.url);
    var store = searchParams.get("store") || "all";

    var raw = await fetchAll(store);

    // Canonicalise names so one person is one row. RepairQ has both "Sam Tomey"
    // and "Samuel Tomey", and "Ross, Jordan" alongside "Jordan Ross". Former
    // staff do not resolve (they are off the active roster) and deliberately
    // keep their raw name — they still owe these tickets, they just cannot be
    // coached, and inventing a canonical name for them would be a guess.
    var rosterRes = await supabase.from("employee_roster").select("name, aliases, active").eq("active", true);
    var aliasMap = buildResolver(rosterRes.data || []).map;

    var rows = raw.map(function(r) {
      var c = classify(r);
      // employee_repaired is the person who did the work, but 70 of these rows
      // only carry employee_added. Fall back rather than showing a blank, and
      // say which field it came from so nobody is blamed for an intake record.
      var rawWho = r.employee_repaired || r.employee_added || null;
      var who = (rawWho && resolveName(rawWho, aliasMap)) || rawWho;
      return {
        ticket_number: r.ticket_number,
        store: r.store,
        ticket_type: r.ticket_type || null,
        gross_sales: num(r.gross_sales),
        gross_profit: num(r.gross_profit),
        total_cost: num(r.total_cost),
        discount_amount: num(r.discount_amount),
        total_collected: num(r.total_collected),
        employee: who,
        employee_source: r.employee_repaired ? "repaired" : (r.employee_added ? "added" : null),
        date_closed: r.date_closed || null,
        closed: !!r.date_closed,
        month: r.date_closed ? String(r.date_closed).slice(0, 7) : null,
        device_category: r.device_category || null,
        device: r.device || r.device_brand || null,
        turnaround_hours: r.turnaround_hours === null || r.turnaround_hours === undefined ? null : num(r.turnaround_hours),
        bucket: c.bucket,
        implied_profit: Math.round(c.implied * 100) / 100,
      };
    });

    var loss = rows.filter(function(r) { return r.bucket === "loss"; });
    var zero = rows.filter(function(r) { return r.bucket === "zero"; });
    var suspect = rows.filter(function(r) { return r.bucket === "suspect"; });

    var sum = function(a, f) { return Math.round(a.reduce(function(s, r) { return s + f(r); }, 0) * 100) / 100; };

    // Group only the buckets that represent real money. A grouping that mixed
    // in `suspect` would overstate whichever employee happens to have the most
    // un-scraped tickets.
    var actionable = loss.concat(zero);
    var group = function(keyFn) {
      var m = {};
      actionable.forEach(function(r) {
        var k = keyFn(r) || "(unattributed)";
        if (!m[k]) m[k] = { key: k, tickets: 0, losses: 0, zeros: 0, lost: 0 };
        m[k].tickets++;
        if (r.bucket === "loss") { m[k].losses++; m[k].lost += r.gross_profit; }
        else m[k].zeros++;
      });
      return Object.keys(m)
        .map(function(k) { m[k].lost = Math.round(m[k].lost * 100) / 100; return m[k]; })
        .sort(function(a, b) { return a.lost - b.lost || b.tickets - a.tickets; });
    };

    return NextResponse.json({
      success: true,
      store: store,
      totals: {
        tickets: rows.length,
        loss_count: loss.length,
        zero_count: zero.length,
        suspect_count: suspect.length,
        lost_dollars: sum(loss, function(r) { return r.gross_profit; }),
        unclosed_count: rows.filter(function(r) { return !r.closed; }).length,
        suspect_hidden_profit: sum(suspect.filter(function(r) { return r.implied_profit > 0; }), function(r) { return r.implied_profit; }),
        suspect_hidden_loss: sum(suspect.filter(function(r) { return r.implied_profit < 0; }), function(r) { return r.implied_profit; }),
      },
      by_employee: group(function(r) { return r.employee; }),
      by_month: group(function(r) { return r.month; }),
      by_store: group(function(r) { return r.store; }),
      rows: rows,
    });
  } catch (e) {
    // Loud. A reporting endpoint that returns an empty list on failure is how a
    // problem hides for weeks (CONTEXT § 4).
    console.error("[zero-profit] failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

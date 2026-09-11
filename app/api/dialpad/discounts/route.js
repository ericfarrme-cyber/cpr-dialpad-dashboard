// Discounts for one day — which repair lines were rung under list, and which
// of those went under what that repair usually sells for.
//
//   GET /api/dialpad/discounts?date=YYYY-MM-DD      (default: yesterday, Indiana time)
//
// Read-only. "Below average" compares the line's collected amount with the
// 6-month average collected for the same model + repair + tier — the number
// the Price Book's booking floor is built on — so the two agree by
// construction. Insurance "(Protected)" lines are never counted: the insurer
// set that price, not the tech.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveModel } from "@/lib/device-model";
import { classifyCatalogItem, cleanCatalogName, tierOfCatalogLine, isInsuranceLine } from "@/lib/repair-type";

export const dynamic = "force-dynamic";

var PAGE = 1000;
var BASELINE_MONTHS = 6;
var MIN_BASELINE_LINES = 3;

function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
function round2(n) { return Math.round(n * 100) / 100; }
function indyDate(iso) {
  // Calendar day in Indiana for a timestamptz — "yesterday" must mean the
  // store's yesterday, not UTC's.
  var d = new Date(iso);
  var p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Indiana/Indianapolis", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  var o = {}; p.forEach(function(x) { o[x.type] = x.value; });
  return o.year + "-" + o.month + "-" + o.day;
}
function yesterdayIndy() {
  var now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  now.setDate(now.getDate() - 1);
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

async function fetchAll(select, apply) {
  var out = [];
  for (var from = 0; ; from += PAGE) {
    var q = supabase.from("ticket_grades").select(select).order("ticket_number", { ascending: true }).range(from, from + PAGE - 1);
    q = apply(q);
    var res = await q;
    if (res.error) throw new Error("ticket_grades: " + res.error.message);
    var batch = res.data || [];
    out = out.concat(batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

// Every retail repair line on a ticket, typed and tiered, insurance dropped.
function retailLines(t) {
  var rm = resolveModel(t.device);
  var out = [];
  (Array.isArray(t.item_details) ? t.item_details : []).forEach(function(it) {
    if (!it || String(it.category || "").toLowerCase().indexOf("repair") < 0) return;
    var rt = classifyCatalogItem(it.catalog_item).type;
    if (!rt) return;
    var name = cleanCatalogName(it.catalog_item);
    if (isInsuranceLine(name)) return;
    var list = num(it.unit_price);
    if (list <= 0) return;
    var disc = num(it.discount);
    var collected = it.line_total !== undefined && it.line_total !== null ? num(it.line_total) : list - disc;
    var tier = tierOfCatalogLine(name);
    out.push({
      key: rm.specified ? rm.canonical + "|" + rt + "|" + (tier || "") : null,
      model: rm.specified ? rm.canonical : null,
      repair: rt, tier: tier, list: list, discount: disc, collected: collected,
      sold_by: it.sold_by || null, catalog: name,
    });
  });
  return out;
}

export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  try {
    var { searchParams } = new URL(request.url);
    var date = searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = yesterdayIndy();

    // Baseline: what each model + repair + tier has actually sold for.
    var sinceD = new Date(); sinceD.setUTCMonth(sinceD.getUTCMonth() - BASELINE_MONTHS);
    var since = sinceD.toISOString().slice(0, 10);
    var history = await fetchAll("ticket_number,device,item_details,date_closed", function(q) {
      return q.gte("date_closed", since).not("date_closed", "is", null);
    });
    var base = {};
    history.forEach(function(t) {
      retailLines(t).forEach(function(l) {
        if (!l.key) return;
        var b = base[l.key] || (base[l.key] = { n: 0, sum: 0 });
        b.n++; b.sum += l.collected;
      });
    });

    // The day: a 3-day UTC window around the date, then filtered to Indiana's calendar day.
    var d0 = new Date(date + "T00:00:00Z"); d0.setUTCDate(d0.getUTCDate() - 1);
    var d1 = new Date(date + "T00:00:00Z"); d1.setUTCDate(d1.getUTCDate() + 2);
    var day = history.filter(function(t) { return t.date_closed >= d0.toISOString() && t.date_closed < d1.toISOString() && indyDate(t.date_closed) === date; });
    // Store + employee come from the ticket row; item_details only carries the seller.
    var ids = day.map(function(t) { return t.ticket_number; });
    var meta = {};
    if (ids.length) {
      var { data: rows, error: mErr } = await supabase.from("ticket_grades").select("ticket_number,store,employee_added,gross_profit,discount_amount").in("ticket_number", ids);
      if (mErr) throw new Error("ticket_grades meta: " + mErr.message);
      (rows || []).forEach(function(r) { meta[r.ticket_number] = r; });
    }

    var lines = [];
    var totalLines = 0;
    day.forEach(function(t) {
      retailLines(t).forEach(function(l) {
        totalLines++;
        if (l.discount <= 0) return;
        var b = l.key ? base[l.key] : null;
        var avg = b && b.n >= MIN_BASELINE_LINES ? round2(b.sum / b.n) : null;
        var m = meta[t.ticket_number] || {};
        lines.push({
          ticket_number: t.ticket_number,
          store: m.store || null,
          employee: l.sold_by || m.employee_added || null,
          device: t.device, model: l.model, repair: l.repair, tier: l.tier,
          list: round2(l.list), discount: round2(l.discount), collected: round2(l.collected),
          avg_collected: avg, baseline_lines: b ? b.n : 0,
          below_avg: avg !== null ? l.collected < avg - 0.005 : null,
          ticket_gp: m.gross_profit !== undefined ? num(m.gross_profit) : null,
        });
      });
    });
    lines.sort(function(a, b) { return (b.avg_collected !== null ? b.avg_collected - b.collected : -1) - (a.avg_collected !== null ? a.avg_collected - a.collected : -1); });

    return NextResponse.json({
      success: true,
      date: date,
      tickets: day.length,
      repair_lines: totalLines,
      discounted: lines.length,
      below_avg: lines.filter(function(l) { return l.below_avg === true; }).length,
      no_baseline: lines.filter(function(l) { return l.below_avg === null; }).length,
      discount_total: round2(lines.reduce(function(s, l) { return s + l.discount; }, 0)),
      baseline_months: BASELINE_MONTHS,
      lines: lines,
    });
  } catch (e) {
    console.error("[discounts] GET failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

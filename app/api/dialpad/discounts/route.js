// Discounts for one day — which repair lines were rung under list, and which
// of those went under what that repair usually sells for.
//
//   GET /api/dialpad/discounts?date=YYYY-MM-DD      (default: yesterday, Indiana time)
//   GET /api/dialpad/discounts?action=waived&date=   charges waived that day
//
// A waived charge is the 100% discount, which is why it lives here. RepairQ
// writes it into the line's status ("Sold ... Charge Waived"), not into the
// discount column, so it is invisible to every read above -- 291 lines in six
// months, Indianapolis 168 / Fishers 83 / Bloomington 40.
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
import { buildResolver, resolveNamePersonish, isSystemActor } from "@/lib/roster-resolver";

export const dynamic = "force-dynamic";

var PAGE = 1000;
var BASELINE_MONTHS = 6;
var MIN_BASELINE_LINES = 3;

function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

// item_details writes "Stirling, Luke"; every other screen in the dashboard
// says "Luke Stirling". Both cards on the Morning Brief read from here, so
// both go through the roster -- one card saying "Long, Aerick" next to another
// saying "Aerick Long" is the kind of small wrongness that makes a page look
// untrustworthy. A name that does not resolve keeps its own, flipped so it at
// least reads as a person: former staff still rang these.
function personName(raw, map) {
  var n = String(raw === null || raw === undefined ? "" : raw).replace(/\s+/g, " ").trim();
  if (!n || isSystemActor(n)) return null;
  var hit = resolveNamePersonish(n, map);
  if (hit) return hit;
  var m = n.match(/^([^,]+),\s*(.+)$/);
  return m ? m[2].trim() + " " + m[1].trim() : n;
}
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

// ── charges waived ──────────────────────────────────────────────────────────
// Every line on a ticket, not just repairs: 141 of the 291 are accessories
// (screen protectors handed over) and 117 are repair work given away.
//
// ⚠ RepairQ sends these at unit_price 0, so the LINE carries no value. For a
// repair we can say what the sheet would have charged -- 64 of 117 match a
// live sheet row, at $211.94 on average. The other 53 are Diagnostic and
// "Other repair", which the sheet deliberately does not price per model, and
// accessories are not on the sheet at all. So the figure is reported as a
// floor with the unpriced count beside it, never as a total: a 55% match
// dressed up as "waived $13,564" would be wrong by an unknown amount.
function waivedLines(t) {
  var rm = resolveModel(t.device);
  var out = [];
  (Array.isArray(t.item_details) ? t.item_details : []).forEach(function(it) {
    if (!it || !/charge waived/i.test(String(it.status || ""))) return;
    var cat = String(it.category || "").toLowerCase();
    var name = cleanCatalogName(it.catalog_item);
    var rt = cat.indexOf("repair") >= 0 ? classifyCatalogItem(it.catalog_item).type : null;
    out.push({
      category: cat || null,
      model: rm.specified ? rm.canonical : null,
      repair: rt,
      tier: rt ? tierOfCatalogLine(name) : null,
      catalog: name,
      sold_by: it.sold_by || null,
      repaired_by: it.repaired_by || null,
      insurance: isInsuranceLine(name),
    });
  });
  return out;
}

export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  try {
    var { searchParams } = new URL(request.url);
    var action = searchParams.get("action") || "discounts";
    var date = searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = yesterdayIndy();

    if (action === "waived") {
      var wSinceD = new Date(); wSinceD.setUTCMonth(wSinceD.getUTCMonth() - BASELINE_MONTHS);
      var wHistory = await fetchAll("ticket_number,store,device,item_details,date_closed", function(q) {
        return q.gte("date_closed", wSinceD.toISOString().slice(0, 10)).not("date_closed", "is", null);
      });

      // What the sheet would have charged. Live rows only -- a price taken off
      // the sheet is not what we would quote today.
      var { data: pRows, error: pErr } = await supabase.from("repair_prices")
        .select("canonical_model,canonical_repair,tier,set_price,active").eq("active", true).limit(5000);
      if (pErr) throw new Error("repair_prices: " + pErr.message);
      var exact = {}, loose = {};
      (pRows || []).forEach(function(p) {
        if (!p.canonical_model || !p.canonical_repair || p.set_price === null) return;
        exact[p.canonical_model + "|" + p.canonical_repair + "|" + (p.tier || "")] = num(p.set_price);
        var lk = p.canonical_model + "|" + p.canonical_repair;
        if (loose[lk] === undefined) loose[lk] = num(p.set_price);
      });
      function sheetPrice(l) {
        if (!l.model || !l.repair) return null;
        var v = exact[l.model + "|" + l.repair + "|" + (l.tier || "")];
        if (v === undefined) v = loose[l.model + "|" + l.repair];
        return v === undefined ? null : v;
      }

      var { data: wRoster } = await supabase.from("employee_roster").select("name,aliases,active");
      var wMap = buildResolver(wRoster || []).map;

      var monthKey = date.slice(0, 7);
      var dayOfMonth = parseInt(date.slice(8, 10), 10);
      var prevD = new Date(date + "T00:00:00Z"); prevD.setUTCDate(1); prevD.setUTCMonth(prevD.getUTCMonth() - 1);
      var prevKey = prevD.toISOString().slice(0, 7);

      function blank() { return { count: 0, priced: 0, unpriced: 0, duplicate_lines: 0, sheet_value: 0, by_store: {}, by_person: {}, lines: [] }; }
      var wDay = blank(), wMonth = blank(), wPrev = blank();

      wHistory.forEach(function(t) {
        var ymdIndy = indyDate(t.date_closed);
        var inDay = ymdIndy === date;
        var inMonth = ymdIndy.slice(0, 7) === monthKey && parseInt(ymdIndy.slice(8, 10), 10) <= dayOfMonth;
        // Same slice of the previous month, so "more than usual" is a like-for-
        // like comparison rather than a full month against a partial one.
        var inPrev = ymdIndy.slice(0, 7) === prevKey && parseInt(ymdIndy.slice(8, 10), 10) <= dayOfMonth;
        if (!inDay && !inMonth && !inPrev) return;
        // One repair, one price. RepairQ frequently writes the labour line AND
        // the part line for the same job, and categorises both as "repair":
        // ticket 2026-10-17 carried "iPhone 11 Screen Repair (LCD)" and "Apple
        // LCD Assembly With Steel Plate" and the first cut priced each at
        // $129.99, booking $259.98 for one waived screen. The second line is
        // still listed -- it happened -- but it is not priced twice.
        var seen = {};
        waivedLines(t).forEach(function(l) {
          var price = sheetPrice(l);
          var dedupeKey = l.model && l.repair ? l.model + "|" + l.repair + "|" + (l.tier || "") : null;
          var duplicate = false;
          if (price !== null && dedupeKey) {
            if (seen[dedupeKey]) { duplicate = true; price = null; }
            else seen[dedupeKey] = 1;
          }
          var row = {
            ticket_number: t.ticket_number, store: t.store || null, date: ymdIndy,
            category: l.category, device: t.device, model: l.model, repair: l.repair, tier: l.tier,
            catalog: l.catalog, person: personName(l.sold_by || l.repaired_by, wMap),
            sheet_price: price, insurance: l.insurance,
            // True when the same repair on the same ticket was already priced,
            // so the line is shown but deliberately not counted again.
            same_repair_as_above: duplicate,
          };
          [inDay ? wDay : null, inMonth ? wMonth : null, inPrev ? wPrev : null].forEach(function(acc) {
            if (!acc) return;
            acc.count++;
            if (duplicate) acc.duplicate_lines++;
            else if (price === null) acc.unpriced++;
            else { acc.priced++; acc.sheet_value += price; }
            if (t.store) acc.by_store[t.store] = (acc.by_store[t.store] || 0) + 1;
            if (row.person) acc.by_person[row.person] = (acc.by_person[row.person] || 0) + 1;
            if (acc === wDay) acc.lines.push(row);
          });
        });
      });

      [wDay, wMonth, wPrev].forEach(function(a) { a.sheet_value = round2(a.sheet_value); });
      wDay.lines.sort(function(a, b) { return (b.sheet_price || 0) - (a.sheet_price || 0); });
      delete wMonth.lines; delete wPrev.lines;

      return NextResponse.json({
        success: true,
        date: date,
        month: monthKey,
        prev_month: prevKey,
        through_day: dayOfMonth,
        day: wDay,
        month_to_date: wMonth,
        prev_month_to_date: wPrev,
        // Honest about the floor: see waivedLines.
        sheet_value_is_a_floor: true,
      });
    }

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

    var { data: dRoster } = await supabase.from("employee_roster").select("name,aliases,active");
    var dMap = buildResolver(dRoster || []).map;

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
          employee: personName(l.sold_by || m.employee_added, dMap),
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

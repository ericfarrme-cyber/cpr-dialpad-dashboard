import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveModels, resolveModel } from "@/lib/device-model";
import { classifyCatalogItem, classifyInquiry } from "@/lib/repair-type";

// ─────────────────────────────────────────────────────────────────────────────
// PRICE & DEMAND
//
// The question Matt named on 2026-09-10: "out of the two hundred iPhone 17 calls
// in three locations, you got fifteen repairs" — and Eric's: "what is the
// influence of a difference of twenty dollars on a repair." Both have been
// guesses for seven years.
//
// Three joins, all measured rather than assumed (see the 2026-09-10 probes):
//
//   DEMAND     audit_results opportunity calls -> canonical model
//              device_type is 100% populated on opportunity calls.
//
//   PRICING    ticket_grades.item_details repair lines -> unit_price, discount
//              95% of repair lines carry unit_price. This is list vs actual per
//              model, which is exactly the SKU breakdown Matt asked for.
//
//   CONVERSION call phone -> ticket phone within 30 days
//              appointments.call_id and .ticket_number are 0% populated, so the
//              stored chain does not exist. Phone does: 100% of calls, 86% of
//              tickets. Measured baseline 2026-06-01+: 21.2% of opportunity
//              calls became a ticket.
//
// Read-only. Touches no payroll file.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

var PAGE = 1000;
var CONVERT_WINDOW_DAYS = 30;

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  var n = parseFloat(v);
  return isFinite(n) ? n : 0;
}
function digits(s) {
  var d = String(s || "").replace(/\D/g, "");
  return d.length === 11 && d.charAt(0) === "1" ? d.slice(1) : d;
}
function addDays(iso, n) {
  var d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function monthsAgo(n) {
  var d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

// Paginated read — a silent clip is how this project has been bitten before.
//
// `orderBy` is REQUIRED, not optional. .range() without a stable sort lets
// PostgREST return pages that overlap and skip: the same request answered 109,
// then 63, when the true count was 93. Every figure on the tab was quietly
// unstable until this was ordered. CLAUDE.md calls for ordered pagination for
// exactly this reason.
async function fetchAll(table, select, orderBy, apply) {
  if (!orderBy) throw new Error("fetchAll(" + table + ") needs an orderBy for stable pagination");
  var out = [];
  for (var from = 0; ; from += PAGE) {
    var q = supabase.from(table).select(select).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    var res = await q;
    if (res.error) throw new Error(table + ": " + res.error.message);
    var batch = res.data || [];
    out = out.concat(batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function blankModel(name, family) {
  return {
    model: name, family: family || "other",
    calls: 0, appt_offered: 0,
    converted: 0, converted_same_model: 0,
    repairs: 0, revenue: 0, profit: 0,
    priced_lines: 0, list_total: 0, discount_total: 0, actual_total: 0,
    full_price: 0, discounted: 0,
    // A model is not one price. "iPhone 15" covers a $190 screen and a $58
    // diagnostic; averaging them describes no transaction that ever happened.
    types: {},
    months: {},
  };
}

function blankType(type) {
  return {
    type: type, calls: 0, repairs: 0,
    // Per-type funnel too, so the UI can filter to a repair with no round trip.
    appt_offered: 0, converted: 0,
    priced_lines: 0, list_total: 0, discount_total: 0, actual_total: 0,
    full_price: 0, discounted: 0, profit: 0,
  };
}
function bumpType(bag, type, field, amount) {
  if (!type) return null;
  if (!bag[type]) bag[type] = blankType(type);
  if (field) bag[type][field] += (amount === undefined ? 1 : amount);
  return bag[type];
}

export async function GET(request) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  }

  try {
    var { searchParams } = new URL(request.url);
    var store = searchParams.get("store") || "all";
    var months = Math.min(24, Math.max(1, parseInt(searchParams.get("months") || "6", 10)));
    var since = monthsAgo(months);

    // ── calls ────────────────────────────────────────────────────────────────
    var typeFilter = searchParams.get("type") || "all";

    var calls = await fetchAll(
      "audit_results",
      "call_id,device_type,inquiry,phone,store,date_started,appt_offered,call_type,excluded",
      "call_id",
      function(q) {
        q = q.eq("call_type", "opportunity").eq("excluded", false).gte("date_started", since);
        if (store !== "all") q = q.eq("store", store);
        return q;
      }
    );

    // ── tickets (all stores: a customer can call one store and visit another) ──
    var tickets = await fetchAll(
      "ticket_grades",
      "ticket_number,device,customer_phone,store,date_closed,gross_sales,gross_profit,discount_amount,item_details,ticket_type",
      "ticket_number",
      function(q) { return q.gte("date_closed", since).not("date_closed", "is", null); }
    );

    // ── index tickets by phone for the conversion join ───────────────────────
    var byPhone = {};
    tickets.forEach(function(t) {
      var d = digits(t.customer_phone);
      if (d.length < 10) return;
      if (!byPhone[d]) byPhone[d] = [];
      byPhone[d].push(t);
    });

    var models = {};
    var get = function(name, family) {
      if (!models[name]) models[name] = blankModel(name, family);
      return models[name];
    };
    var bumpMonth = function(m, month, field, amount) {
      if (!month) return;
      if (!m.months[month]) m.months[month] = { month: month, calls: 0, repairs: 0, list_total: 0, actual_total: 0, priced_lines: 0 };
      m.months[month][field] += (amount === undefined ? 1 : amount);
    };

    // ── DEMAND + CONVERSION ──────────────────────────────────────────────────
    var coverage = { total: calls.length, resolved: 0, generic: 0, not_mentioned: 0, unrecognised: 0 };
    var unspecified = { calls: 0, appt_offered: 0, converted: 0 }; // the coaching bucket
    var genericByFamily = {};

    // What the customer actually asked for, from the AI's one-line summary.
    // This is Matt's "what the customers want" — measured, screens are 40.9%.
    var callTypeRollup = {};
    var callTypeUnknown = 0;

    calls.forEach(function(c) {
      var resolved = resolveModels(c.device_type);
      var specified = resolved.filter(function(r) { return r.specified; });
      var day = String(c.date_started || "").slice(0, 10);
      var month = day.slice(0, 7);
      var repairType = classifyInquiry(c.inquiry).type;
      if (repairType) bumpType(callTypeRollup, repairType, "calls");
      else callTypeUnknown++;
      // A type filter narrows demand to callers asking for that repair.
      if (typeFilter !== "all" && repairType !== typeFilter) return;

      // Did this caller become a ticket anywhere within the window?
      var d = digits(c.phone);
      var hits = [];
      if (d.length >= 10 && day) {
        var until = addDays(day, CONVERT_WINDOW_DAYS);
        hits = (byPhone[d] || []).filter(function(t) {
          var td = String(t.date_closed).slice(0, 10);
          return td >= day && td <= until;
        });
      }
      var didConvert = hits.length > 0;

      if (specified.length) {
        coverage.resolved++;
        specified.forEach(function(r) {
          var m = get(r.canonical, r.family);
          m.calls++;
          if (c.appt_offered) m.appt_offered++;
          var mt = bumpType(m.types, repairType, "calls");
          if (mt && c.appt_offered) mt.appt_offered++;
          bumpMonth(m, month, "calls");
          if (didConvert) {
            m.converted++;
            if (mt) mt.converted++;
            var sameModel = hits.some(function(t) {
              var tr = resolveModel(t.device);
              return tr.canonical === r.canonical;
            });
            if (sameModel) m.converted_same_model++;
          }
        });
      } else {
        var r0 = resolved[0];
        if (r0.reason === "generic") {
          coverage.generic++;
          var fam = r0.family || "other";
          if (!genericByFamily[fam]) genericByFamily[fam] = { family: fam, calls: 0, appt_offered: 0, converted: 0 };
          genericByFamily[fam].calls++;
          if (c.appt_offered) genericByFamily[fam].appt_offered++;
          if (didConvert) genericByFamily[fam].converted++;
        } else if (r0.reason === "not_mentioned") {
          coverage.not_mentioned++;
        } else {
          coverage.unrecognised++;
        }
        // Eric asked for "not mentioned" to be surfaced: staff not capturing
        // what the customer actually has is itself the finding.
        if (r0.reason === "not_mentioned" || r0.reason === "generic") {
          unspecified.calls++;
          if (c.appt_offered) unspecified.appt_offered++;
          if (didConvert) unspecified.converted++;
        }
      }
    });

    // ── PRICING + REPAIR VOLUME ──────────────────────────────────────────────
    var storeTickets = store === "all" ? tickets : tickets.filter(function(t) { return t.store === store; });
    var pricedLines = 0, unpricedLines = 0;
    var lineTypeRollup = {};

    storeTickets.forEach(function(t) {
      var r = resolveModel(t.device);
      if (!r.specified) return;
      var m = get(r.canonical, r.family);
      var month = String(t.date_closed).slice(0, 7);
      m.repairs++;
      m.revenue += num(t.gross_sales);
      m.profit += num(t.gross_profit);
      bumpMonth(m, month, "repairs");

      // Per-line pricing: unit_price is the LIST price, discount comes off it.
      // Each line is typed, so a screen price never averages with a diagnostic.
      var items = Array.isArray(t.item_details) ? t.item_details : [];
      items.forEach(function(it) {
        if (!it || String(it.category || "").toLowerCase().indexOf("repair") < 0) return;
        var rt = classifyCatalogItem(it.catalog_item).type;
        if (typeFilter !== "all" && rt !== typeFilter) return;
        var list = num(it.unit_price);
        if (list <= 0) { unpricedLines++; return; }
        var disc = num(it.discount);
        var actual = it.line_total !== undefined && it.line_total !== null ? num(it.line_total) : list - disc;
        pricedLines++;
        m.priced_lines++;
        m.list_total += list;
        m.discount_total += disc;
        m.actual_total += actual;
        if (disc > 0) m.discounted++; else m.full_price++;

        var mt = bumpType(m.types, rt, "priced_lines");
        if (mt) {
          mt.list_total += list;
          mt.discount_total += disc;
          mt.actual_total += actual;
          mt.repairs++;
          // No per-type profit on purpose: cost lives on the ticket, not the
          // line, so splitting it across line items would be an invented number.
          if (disc > 0) mt.discounted++; else mt.full_price++;
        }
        var gt = bumpType(lineTypeRollup, rt, "priced_lines");
        if (gt) { gt.list_total += list; gt.actual_total += actual; gt.discount_total += disc; }

        bumpMonth(m, month, "priced_lines");
        bumpMonth(m, month, "list_total", list);
        bumpMonth(m, month, "actual_total", actual);
      });
    });

    // ── shape output ─────────────────────────────────────────────────────────
    var round = function(n) { return Math.round(n * 100) / 100; };
    var rows = Object.keys(models).map(function(k) {
      var m = models[k];

      // Per repair type, which is the only level at which a price means anything.
      var typeRows = Object.keys(m.types).map(function(tk) {
        var x = m.types[tk];
        return {
          type: x.type, calls: x.calls, priced_lines: x.priced_lines,
          appt_offered: x.appt_offered,
          appt_offered_rate: x.calls ? round((x.appt_offered / x.calls) * 100) : null,
          converted: x.converted,
          conversion_rate: x.calls ? round((x.converted / x.calls) * 100) : null,
          repairs: x.repairs,
          avg_list: x.priced_lines ? round(x.list_total / x.priced_lines) : null,
          avg_discount: x.priced_lines ? round(x.discount_total / x.priced_lines) : null,
          avg_actual: x.priced_lines ? round(x.actual_total / x.priced_lines) : null,
          discount_pct: x.list_total ? round((x.discount_total / x.list_total) * 100) : null,
          full_price: x.full_price, discounted: x.discounted,
          discounted_share: x.priced_lines ? round((x.discounted / x.priced_lines) * 100) : null,
        };
      }).sort(function(a, b) { return b.priced_lines - a.priced_lines || b.calls - a.calls; });

      // The headline price describes ONE repair type — the model's most common
      // priced job — and the row says which. A blended average would be a number
      // that matches no actual transaction.
      var priced = typeRows.filter(function(x) { return x.priced_lines > 0; });
      var dom = priced.length ? priced[0] : null;
      var avgList = dom ? dom.avg_list : null;
      var avgActual = dom ? dom.avg_actual : null;
      var avgDiscount = dom ? dom.avg_discount : null;
      return {
        types: typeRows,
        price_type: dom ? dom.type : null,
        price_type_lines: dom ? dom.priced_lines : 0,
        type_count: priced.length,
        model: m.model,
        family: m.family,
        calls: m.calls,
        appt_offered: m.appt_offered,
        appt_offered_rate: m.calls ? round((m.appt_offered / m.calls) * 100) : null,
        converted: m.converted,
        conversion_rate: m.calls ? round((m.converted / m.calls) * 100) : null,
        converted_same_model: m.converted_same_model,
        repairs: m.repairs,
        revenue: round(m.revenue),
        profit: round(m.profit),
        avg_profit: m.repairs ? round(m.profit / m.repairs) : null,
        priced_lines: m.priced_lines,
        avg_list: avgList === null ? null : round(avgList),
        avg_discount: avgDiscount === null ? null : round(avgDiscount),
        avg_actual: avgActual === null ? null : round(avgActual),
        discount_pct: dom ? dom.discount_pct : null,
        full_price: dom ? dom.full_price : m.full_price,
        discounted: dom ? dom.discounted : m.discounted,
        discounted_share: dom ? dom.discounted_share : null,
        months: Object.keys(m.months).sort().map(function(mo) {
          var x = m.months[mo];
          return {
            month: mo, calls: x.calls, repairs: x.repairs,
            avg_list: x.priced_lines ? round(x.list_total / x.priced_lines) : null,
            avg_actual: x.priced_lines ? round(x.actual_total / x.priced_lines) : null,
          };
        }),
      };
    });

    rows.sort(function(a, b) { return b.calls - a.calls || b.repairs - a.repairs; });

    var totalCalls = calls.length;
    var totalConverted = rows.reduce(function(s, r) { return s + r.converted; }, 0);
    var apptOfferedAll = calls.filter(function(c) { return c.appt_offered; }).length;

    return NextResponse.json({
      success: true,
      store: store,
      since: since,
      window_days: CONVERT_WINDOW_DAYS,
      totals: {
        opportunity_calls: totalCalls,
        appt_offered: apptOfferedAll,
        appt_offered_rate: totalCalls ? round((apptOfferedAll / totalCalls) * 100) : null,
        repairs: storeTickets.length,
        priced_lines: pricedLines,
        unpriced_lines: unpricedLines,
        models: rows.length,
      },
      type_filter: typeFilter,
      // "What the customers want" — Matt's phrase. Demand share by repair type,
      // beside what that repair actually sells for.
      repair_types: (function() {
        var keys = {};
        Object.keys(callTypeRollup).forEach(function(k) { keys[k] = 1; });
        Object.keys(lineTypeRollup).forEach(function(k) { keys[k] = 1; });
        var totalTyped = Object.keys(callTypeRollup).reduce(function(s, k) { return s + callTypeRollup[k].calls; }, 0);
        return Object.keys(keys).map(function(k) {
          var c = callTypeRollup[k] || blankType(k);
          var l = lineTypeRollup[k] || blankType(k);
          return {
            type: k,
            calls: c.calls,
            call_share: totalTyped ? round((c.calls / totalTyped) * 100) : null,
            priced_lines: l.priced_lines,
            avg_list: l.priced_lines ? round(l.list_total / l.priced_lines) : null,
            avg_actual: l.priced_lines ? round(l.actual_total / l.priced_lines) : null,
            discount_pct: l.list_total ? round((l.discount_total / l.list_total) * 100) : null,
          };
        }).sort(function(a, b) { return b.calls - a.calls || b.priced_lines - a.priced_lines; });
      })(),
      call_type_unclassified: callTypeUnknown,
      // Stated on screen. A model-level view built on 77% of calls should say so.
      coverage: coverage,
      unspecified: unspecified,
      generic_by_family: Object.keys(genericByFamily).map(function(k) { return genericByFamily[k]; }).sort(function(a, b) { return b.calls - a.calls; }),
      models: rows,
    });
  } catch (e) {
    console.error("[price-demand] failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

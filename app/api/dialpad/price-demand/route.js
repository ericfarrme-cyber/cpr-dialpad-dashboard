import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveModels, resolveModel } from "@/lib/device-model";

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
async function fetchAll(table, select, apply) {
  var out = [];
  for (var from = 0; ; from += PAGE) {
    var q = supabase.from(table).select(select).range(from, from + PAGE - 1);
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
    months: {},
  };
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
    var calls = await fetchAll(
      "audit_results",
      "call_id,device_type,phone,store,date_started,appt_offered,call_type,excluded",
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

    calls.forEach(function(c) {
      var resolved = resolveModels(c.device_type);
      var specified = resolved.filter(function(r) { return r.specified; });
      var day = String(c.date_started || "").slice(0, 10);
      var month = day.slice(0, 7);

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
          bumpMonth(m, month, "calls");
          if (didConvert) {
            m.converted++;
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
      var items = Array.isArray(t.item_details) ? t.item_details : [];
      items.forEach(function(it) {
        if (!it || String(it.category || "").toLowerCase().indexOf("repair") < 0) return;
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
        bumpMonth(m, month, "priced_lines");
        bumpMonth(m, month, "list_total", list);
        bumpMonth(m, month, "actual_total", actual);
      });
    });

    // ── shape output ─────────────────────────────────────────────────────────
    var round = function(n) { return Math.round(n * 100) / 100; };
    var rows = Object.keys(models).map(function(k) {
      var m = models[k];
      var avgList = m.priced_lines ? m.list_total / m.priced_lines : null;
      var avgActual = m.priced_lines ? m.actual_total / m.priced_lines : null;
      var avgDiscount = m.priced_lines ? m.discount_total / m.priced_lines : null;
      return {
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
        discount_pct: avgList ? round((avgDiscount / avgList) * 100) : null,
        full_price: m.full_price,
        discounted: m.discounted,
        discounted_share: m.priced_lines ? round((m.discounted / m.priced_lines) * 100) : null,
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

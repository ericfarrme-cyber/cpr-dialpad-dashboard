// Quote metrics — the pre-sale half of price elasticity.
//
//   GET /api/dialpad/quote-metrics?months=6&store=all|fishers|bloomington|indianapolis
//
// Every booking made from the Price Book carries the sheet price, what was
// actually quoted, why if it was under, and the row it came from. This route
// turns those into the questions Eric asked: do discounted quotes show up
// more than full-price ones (show rate by discount band), which reasons are
// used, who discounts, and — from the price ledger — what the register did
// in the 60 days either side of every price change.
//
// Read-only. States its sample sizes; a band with three quotes is three
// quotes, not a rate. Insurance "(Protected)" lines never enter the
// before/after averages.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { resolveModel } from "@/lib/device-model";
import { classifyCatalogItem, cleanCatalogName, tierOfCatalogLine, isInsuranceLine } from "@/lib/repair-type";

export const dynamic = "force-dynamic";

var PAGE = 1000;
var EVENT_WINDOW_DAYS = 60;
var MIN_SAMPLE = 20; // below this the UI says "too few to read"

function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round(n * 100) / 100; }
function addDays(ymd, n) { var d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function fetchAll(table, select, orderBy, apply) {
  var out = [];
  for (var from = 0; ; from += PAGE) {
    var q = supabase.from(table).select(select).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    var res = await q;
    if (res.error) throw new Error(table + ": " + res.error.message);
    out = out.concat(res.data || []);
    if ((res.data || []).length < PAGE) break;
  }
  return out;
}

function bandOf(pct) {
  if (pct === null) return "no_reference";
  if (pct <= 0.5) return "at_sheet";
  if (pct <= 10) return "1_10";
  if (pct <= 20) return "10_20";
  return "20_plus";
}
var BAND_ORDER = ["at_sheet", "1_10", "10_20", "20_plus", "no_reference"];
var BAND_LABEL = { at_sheet: "At the sheet", "1_10": "1–10% off", "10_20": "10–20% off", "20_plus": "20%+ off", no_reference: "No reference price" };

function blank(label) { return { label: label, quotes: 0, showed: 0, no_show: 0, pending: 0, ticketed: 0, at_sheet: 0, disc_sum: 0, disc_pct_sum: 0, disc_n: 0 }; }
function bump(b, a) {
  b.quotes++;
  if (a.showed) b.showed++; else if (a.no_show) b.no_show++; else b.pending++;
  if (a.ticketed) b.ticketed++;
  if (a.disc_pct !== null) { b.disc_n++; b.disc_sum += a.disc; b.disc_pct_sum += a.disc_pct; if (a.disc_pct <= 0.5) b.at_sheet++; }
}
function finish(b) {
  var decided = b.showed + b.no_show;
  return {
    label: b.label, quotes: b.quotes, showed: b.showed, no_show: b.no_show, pending: b.pending, ticketed: b.ticketed,
    decided: decided,
    show_rate: decided ? round1((b.showed / decided) * 100) : null,
    at_sheet: b.at_sheet, at_sheet_rate: b.disc_n ? round1((b.at_sheet / b.disc_n) * 100) : null,
    avg_discount: b.disc_n ? round2(b.disc_sum / b.disc_n) : null,
    avg_discount_pct: b.disc_n ? round1(b.disc_pct_sum / b.disc_n) : null,
    readable: decided >= MIN_SAMPLE,
  };
}

export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  try {
    var { searchParams } = new URL(request.url);
    var months = Math.min(24, Math.max(1, parseInt(searchParams.get("months") || "6", 10)));
    var store = searchParams.get("store") || "all";
    var sinceD = new Date(); sinceD.setUTCMonth(sinceD.getUTCMonth() - months);
    var since = sinceD.toISOString().slice(0, 10);
    var today = new Date().toISOString().slice(0, 10);

    // ── quotes ───────────────────────────────────────────────────────────────
    var appts = await fetchAll("appointments",
      "id,store,scheduled_by,date_set,date_of_appt,did_arrive,ticket_number,device,repair,tier,canonical_model,canonical_repair,sheet_price,book_floor,quoted_price,quote_reason,turnaround,source,created_at",
      "id",
      function(q) { q = q.eq("source", "price_book").gte("date_set", since); if (store !== "all") q = q.eq("store", store); return q; });

    var quotes = appts.map(function(a) {
      var sheet = num(a.sheet_price), quoted = num(a.quoted_price);
      var disc = sheet !== null && quoted !== null ? round2(sheet - quoted) : null;
      var discPct = sheet && disc !== null ? round1((disc / sheet) * 100) : null;
      var da = String(a.did_arrive || "").toLowerCase();
      var showed = da === "yes" || da === "converted";
      var noShow = da.indexOf("no") === 0;
      return {
        id: a.id, store: a.store, agent: a.scheduled_by || "—", date_set: a.date_set, date_of_appt: a.date_of_appt,
        device: a.device, repair: a.repair, tier: a.tier, model: a.canonical_model, canonical_repair: a.canonical_repair,
        sheet: sheet, quoted: quoted, disc: disc, disc_pct: discPct, band: bandOf(discPct),
        reason: a.quote_reason ? String(a.quote_reason).split(" — ")[0] : (disc !== null && disc > 0.005 ? "(no reason)" : null),
        turnaround: a.turnaround || null,
        showed: showed, no_show: noShow, pending: !showed && !noShow,
        ticketed: !!(a.ticket_number && String(a.ticket_number).trim()),
        under_floor: a.book_floor !== null && quoted !== null && quoted < num(a.book_floor) - 0.005,
      };
    });

    var totals = blank("All quotes");
    var bands = {}, reasons = {}, agents = {}, models = {}, stores = {};
    BAND_ORDER.forEach(function(b) { bands[b] = blank(BAND_LABEL[b]); });
    quotes.forEach(function(a) {
      bump(totals, a);
      bump(bands[a.band], a);
      if (a.reason) bump(reasons[a.reason] = reasons[a.reason] || blank(a.reason), a);
      bump(agents[a.agent] = agents[a.agent] || blank(a.agent), a);
      bump(stores[a.store] = stores[a.store] || blank(a.store), a);
      var mk = (a.model || a.device || "?") + "|" + (a.canonical_repair || a.repair || "?") + "|" + (a.tier || "");
      var mb = models[mk] = models[mk] || blank((a.model || a.device) + " · " + (a.canonical_repair || a.repair) + (a.tier ? " · " + a.tier : ""));
      mb.model = a.model || a.device; mb.repair = a.canonical_repair || a.repair; mb.tier = a.tier || null;
      bump(mb, a);
    });
    var underFloor = quotes.filter(function(a) { return a.under_floor; }).length;

    // ── price changes with before / after ───────────────────────────────────
    var ledger = await fetchAll("repair_price_changes",
      "batch_id,device,repair,tier,canonical_model,canonical_repair,field,old_value,new_value,changed_by,changed_at,effective_date,reason",
      "changed_at",
      function(q) { return q.eq("field", "set_price").gte("effective_date", addDays(since, -EVENT_WINDOW_DAYS)); });
    var earliest = ledger.reduce(function(m, r) { return r.effective_date < m ? r.effective_date : m; }, today);
    var tickets = ledger.length ? await fetchAll("ticket_grades", "ticket_number,device,store,item_details,date_closed", "ticket_number",
      function(q) { q = q.gte("date_closed", addDays(earliest, -EVENT_WINDOW_DAYS)).not("date_closed", "is", null); if (store !== "all") q = q.eq("store", store); return q; }) : [];
    // index retail lines by model|repair|tier -> [{day, collected}]
    var lines = {};
    tickets.forEach(function(t) {
      var rm = resolveModel(t.device);
      if (!rm.specified) return;
      var day = String(t.date_closed).slice(0, 10);
      (Array.isArray(t.item_details) ? t.item_details : []).forEach(function(it) {
        if (!it || String(it.category || "").toLowerCase().indexOf("repair") < 0) return;
        var rt = classifyCatalogItem(it.catalog_item).type;
        if (!rt) return;
        var name = cleanCatalogName(it.catalog_item);
        if (isInsuranceLine(name)) return;
        var list = num(it.unit_price);
        if (!list || list <= 0) return;
        var disc = num(it.discount) || 0;
        var collected = it.line_total !== undefined && it.line_total !== null ? (num(it.line_total) || 0) : list - disc;
        var k = rm.canonical + "|" + rt + "|" + (tierOfCatalogLine(name) || "");
        (lines[k] = lines[k] || []).push({ day: day, collected: collected, list: list, full: disc <= 0 });
      });
    });
    function windowStats(k, from, to) {
      var arr = (lines[k] || []).filter(function(l) { return l.day >= from && l.day < to; });
      var n = arr.length;
      var weeks = Math.max(1, EVENT_WINDOW_DAYS / 7);
      return { jobs: n, per_week: round1(n / weeks), avg_collected: n ? round2(arr.reduce(function(s, l) { return s + l.collected; }, 0) / n) : null, full_price_rate: n ? round1((arr.filter(function(l) { return l.full; }).length / n) * 100) : null };
    }
    var events = [];
    var byBatch = {};
    ledger.forEach(function(r) {
      if (!r.canonical_model || !r.canonical_repair) return;
      var k = r.canonical_model + "|" + r.canonical_repair + "|" + (r.tier || "");
      var id = r.batch_id + "|" + k;
      if (byBatch[id]) return;
      byBatch[id] = 1;
      var introduced = r.old_value === null || r.old_value === undefined;
      var afterEnd = addDays(r.effective_date, EVENT_WINDOW_DAYS);
      var ev = {
        batch_id: r.batch_id, date: r.effective_date, model: r.canonical_model, repair: r.canonical_repair, tier: r.tier || null,
        device: r.device, old_price: num(r.old_value), new_price: num(r.new_value), introduced: introduced,
        changed_by: r.changed_by, reason: r.reason || null,
        before: introduced ? null : windowStats(k, addDays(r.effective_date, -EVENT_WINDOW_DAYS), r.effective_date),
        after: windowStats(k, r.effective_date, afterEnd),
        after_days_elapsed: Math.max(0, Math.min(EVENT_WINDOW_DAYS, Math.round((new Date(today) - new Date(r.effective_date)) / 86400000))),
        quotes_after: quotes.filter(function(a) { return a.model === r.canonical_model && a.canonical_repair === r.canonical_repair && (a.tier || "") === (r.tier || "") && a.date_set >= r.effective_date; }).length,
      };
      events.push(ev);
    });
    events.sort(function(a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var eventsByModel = {};
    events.forEach(function(e) { (eventsByModel[e.model] = eventsByModel[e.model] || []).push(e); });

    var list = function(bag, sortKey) { return Object.keys(bag).map(function(k) { return finish(bag[k]); }).sort(function(a, b) { return b[sortKey || "quotes"] - a[sortKey || "quotes"]; }); };
    return NextResponse.json({
      success: true,
      since: since, months: months, store: store, min_sample: MIN_SAMPLE, event_window_days: EVENT_WINDOW_DAYS,
      totals: Object.assign(finish(totals), { under_floor: underFloor }),
      bands: BAND_ORDER.map(function(b) { return Object.assign({ key: b }, finish(bands[b])); }),
      reasons: list(reasons),
      agents: list(agents),
      stores: list(stores),
      models: Object.keys(models).map(function(k) { var m = models[k]; return Object.assign({ key: k, model: m.model, repair: m.repair, tier: m.tier }, finish(m)); }).sort(function(a, b) { return b.quotes - a.quotes; }),
      recent: quotes.slice().sort(function(a, b) { return a.date_set < b.date_set ? 1 : -1; }).slice(0, 25),
      events: events,
      events_by_model: eventsByModel,
    });
  } catch (e) {
    console.error("[quote-metrics] GET failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

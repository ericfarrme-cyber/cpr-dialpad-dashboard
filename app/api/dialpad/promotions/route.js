// Flash sales and store messages — the fourth TV screen, and Matt's editor.
//
// Two things in one route because they are one job: what a store is running
// this week, and what its people are told about it. Both are read by the TV
// board and managed from the Promotions tab.
//
// ── WHAT THIS ROUTE OWNS ────────────────────────────────────────────────────
// `?action=board&store=` is UNAUTHENTICATED, like ?action=review_leaders and
// the rankings screen, because the TV hangs unsigned-in in a public part of
// the shop. It is deliberately thin: the sale price, the device, the window,
// and the message text. No dollars about anybody's pay, no names beyond who
// posted a message, no customer anything.
//
// ⚠ THAT MAKES store_messages EFFECTIVELY PUBLIC. Anyone with the URL can read
// a message. The compose form says so, and anything private belongs in a
// different channel.
//
// ── WHY A SALE IS NOT A set_price LEDGER EVENT ──────────────────────────────
// Every sale still writes `repair_price_changes`, so there is one history of
// every price the stores have charged. But it writes `field: "sale_price"`,
// NOT "set_price", and that distinction matters in two places that already
// read the ledger:
//   - price-book's 30-day rule silences the "register rings a different
//     number" message after someone SETS a price. A sale is temporary; it
//     must not silence a comparison about the standing price.
//   - quote-metrics draws a before/after marker around a set_price event with
//     60 days either side. A sale has a start AND an end, so 60 days after
//     covers mostly the period after it finished. The right comparison for a
//     sale is the window against the same length of window before it, which
//     is what `?action=list` computes here instead.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { storeKeyFromName, isMissingTable } from "@/lib/constants";

export const dynamic = "force-dynamic";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function json(d, s) { return NextResponse.json(d, { status: s || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

// Indiana calendar day, same helper shape as every other route here. A sale
// window is a human date range and must not flip at 7pm local because the
// server thinks in UTC.
function indyToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Indiana/Indianapolis" });
}
function num(v) { var n = Number(v); return isFinite(n) ? n : null; }
function round2(n) { return Math.round(n * 100) / 100; }
function addDays(ymd, n) {
  var d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
}
var KINDS = ["heads_up", "this_week", "reminder", "win"];

// ── the one definition of "is this sale on today" ───────────────────────────
// Shared by the board, the list and the price-book read, so no two screens can
// disagree about the price an agent is supposed to say out loud.
export function saleState(sale, today) {
  if (!sale || sale.active === false) return "ended";
  if (today < sale.starts_on) return "upcoming";
  if (today > sale.ends_on) return "finished";
  return "live";
}

async function priceRowsFor(ids) {
  if (!ids.length) return {};
  var { data, error } = await supabase.from("repair_prices")
    .select("id,device,repair,tier,canonical_model,canonical_repair,set_price,floor_price,turnaround,family")
    .in("id", ids);
  if (error) throw new Error("repair_prices: " + error.message);
  var by = {};
  (data || []).forEach(function(r) { by[r.id] = r; });
  return by;
}

function decorate(sale, row, today) {
  var listed = row ? num(row.set_price) : null;
  var price = num(sale.sale_price);
  return {
    id: sale.id,
    repair_price_id: sale.repair_price_id,
    store: sale.store,
    sale_price: price,
    listed_price: listed,
    // Computed, never stored: a stored "off" figure goes stale the moment the
    // sheet price moves underneath it.
    off: listed !== null && price !== null ? round2(listed - price) : null,
    off_pct: listed ? Math.round(((listed - price) / listed) * 1000) / 10 : null,
    starts_on: sale.starts_on,
    ends_on: sale.ends_on,
    days: daysBetween(sale.starts_on, sale.ends_on) + 1,
    state: saleState(sale, today),
    days_left: today <= sale.ends_on ? daysBetween(today, sale.ends_on) : null,
    label: sale.label || null,
    note: sale.note || null,
    created_by: sale.created_by || null,
    created_at: sale.created_at,
    ended_by: sale.ended_by || null,
    active: sale.active !== false,
    device: row ? row.device : null,
    repair: row ? row.repair : null,
    tier: row ? row.tier : null,
    family: row ? row.family : null,
    turnaround: row ? row.turnaround : null,
    canonical_model: row ? row.canonical_model : null,
    canonical_repair: row ? row.canonical_repair : null,
    // Stated rather than implied: the sheet's part costs are the stale ones
    // Eric said to disregard, and no console row carries one at all, so a
    // sale's effect on PROFIT is not computable from this data. Revenue is.
    floor_price: row ? num(row.floor_price) : null,
    missing_row: !row,
  };
}

export async function GET(request) {
  try {
    var { searchParams } = new URL(request.url);
    var action = searchParams.get("action") || "board";
    var today = indyToday();

    // ── the TV board: unauthenticated, thin, this store only ───────────────
    if (action === "board") {
      var store = storeKeyFromName(searchParams.get("store") || "");
      if (!store) return json({ success: false, error: "a known store is required" }, 400);

      var { data: sRaw, error: sErr } = await supabase.from("repair_price_sales")
        .select("*").eq("store", store).eq("active", true)
        .lte("starts_on", today).gte("ends_on", today)
        .order("created_at", { ascending: false });
      // Before the migration is pasted there is no table, so there is no sale
      // -- "nothing running" is exactly true and the TV should say it rather
      // than hang "Promotions aren't reporting" on the wall. Any OTHER failure
      // is still a 500, because then we genuinely do not know.
      if (sErr && isMissingTable(sErr)) {
        return json({
          success: true, store: store, today: today, sales: [], messages: [],
          sales_count: 0, messages_count: 0, empty: true,
          not_configured: true,
          note: "promotions tables do not exist yet — run sql/migration_promotions.sql",
        });
      }
      if (sErr) return json({ success: false, error: sErr.message }, 500);

      var rowsBy = await priceRowsFor((sRaw || []).map(function(s) { return s.repair_price_id; }));
      var sales = (sRaw || []).map(function(s) { return decorate(s, rowsBy[s.repair_price_id], today); })
        .filter(function(s) { return !s.missing_row; });

      // store IS NULL means every store, so one clause has to say "mine or
      // everyone's". A date window is optional on a message; a message with
      // none runs until somebody removes it.
      var { data: mRaw, error: mErr } = await supabase.from("store_messages")
        .select("*").eq("active", true)
        .or("store.is.null,store.eq." + store)
        .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(50);
      // Both tables ship in one migration, so this can only diverge if one was
      // dropped. Guarded anyway: a sale on the wall with the message panel
      // 500ing is worse than a sale on the wall with no messages.
      if (mErr && !isMissingTable(mErr)) return json({ success: false, error: mErr.message }, 500);

      var messages = (mErr ? [] : (mRaw || [])).filter(function(m) {
        if (m.starts_on && today < m.starts_on) return false;
        if (m.ends_on && today > m.ends_on) return false;
        return true;
      }).map(function(m) {
        return {
          id: m.id, store: m.store, all_stores: !m.store, kind: m.kind || "heads_up",
          body: m.body, pinned: !!m.pinned, created_by: m.created_by || null,
          created_at: m.created_at, starts_on: m.starts_on, ends_on: m.ends_on,
        };
      });

      return json({
        success: true, store: store, today: today,
        sales: sales, messages: messages,
        sales_count: sales.length, messages_count: messages.length,
        // A board with nothing on it says so rather than rendering an empty
        // card that reads like a failed fetch.
        empty: sales.length === 0 && messages.length === 0,
      });
    }

    // ── the editor's view: every sale and message, with what happened ──────
    if (action === "list") {
      var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
      if (!gate.authorized) return gate.response;

      var { data: all, error: aErr } = await supabase.from("repair_price_sales")
        .select("*").order("starts_on", { ascending: false }).limit(2000);
      // Same split, and here the tab is TOLD so it can say what to do about it
      // rather than showing an empty screen that looks like it works.
      if (aErr && isMissingTable(aErr)) {
        return json({
          success: true, today: today, can_edit: false, not_configured: true,
          live: [], upcoming: [], past: [], messages: [], kinds: KINDS,
          viewer: { name: gate.result.name, role: gate.result.role },
          note: "The promotions tables have not been created yet. Run sql/migration_promotions.sql in the Supabase SQL editor, then reload.",
          measurement: "",
        });
      }
      if (aErr) return json({ success: false, error: aErr.message }, 500);
      var byRow = await priceRowsFor((all || []).map(function(s) { return s.repair_price_id; }));
      var decorated = (all || []).map(function(s) { return decorate(s, byRow[s.repair_price_id], today); });

      // ── did it bring work in ──────────────────────────────────────────────
      // Appointments booked against that sheet row at that store, inside the
      // window, against the SAME NUMBER OF DAYS immediately before it. That is
      // the right comparison for a sale and the wrong one for a permanent
      // price change, which is why this is computed here rather than left to
      // quote-metrics' 60-day markers.
      //
      // ⚠ Appointments, not tickets. A booking is the thing a sale directly
      // causes and it is exact; matching closed register lines back to a sheet
      // row needs the device-model machinery and would make this read heavy.
      // So this measures DEMAND, not revenue, and says so.
      var earliest = decorated.reduce(function(m, s) {
        var from = addDays(s.starts_on, -(s.days));
        return (!m || from < m) ? from : m;
      }, null);
      var appts = [];
      if (earliest) {
        var { data: aRows, error: apErr } = await supabase.from("appointments")
          .select("id,store,repair_price_id,appointment_date,quoted_price,price_quoted,did_arrive,ticket_number,scheduled_by")
          .gte("appointment_date", earliest).limit(20000);
        if (apErr) return json({ success: false, error: apErr.message }, 500);
        appts = aRows || [];
      }
      function window_(saleRow, from, to) {
        var hit = appts.filter(function(a) {
          if (String(a.store || "") !== saleRow.store) return false;
          if (Number(a.repair_price_id) !== Number(saleRow.repair_price_id)) return false;
          var d = String(a.appointment_date || "").slice(0, 10);
          return d >= from && d <= to;
        });
        var q = hit.map(function(a) { return num(a.quoted_price); }).filter(function(x) { return x !== null; });
        return {
          from: from, to: to, days: daysBetween(from, to) + 1,
          booked: hit.length,
          avg_quoted: q.length ? round2(q.reduce(function(a, b) { return a + b; }, 0) / q.length) : null,
          showed: hit.filter(function(a) { return a.did_arrive === true; }).length,
          with_ticket: hit.filter(function(a) { return a.ticket_number && a.ticket_number !== ""; }).length,
        };
      }
      decorated.forEach(function(s) {
        var to = s.state === "live" ? today : s.ends_on;
        s.during = window_(s, s.starts_on, to);
        s.before = window_(s, addDays(s.starts_on, -s.during.days), addDays(s.starts_on, -1));
        s.change = s.during.booked - s.before.booked;
        // A sale nobody has booked at yet is early, not failed. The sentence a
        // screen prints has to come from the numbers, so it is computed here.
        s.reading = s.state === "upcoming" ? "Not started."
          : (s.during.booked + s.before.booked) < 4
            ? "Too early to read — " + s.during.booked + " booked during, " + s.before.booked + " in the same number of days before."
            : s.change > 0 ? s.during.booked + " booked during, " + s.before.booked + " before — up " + s.change + "."
            : s.change < 0 ? s.during.booked + " booked during, " + s.before.booked + " before — down " + Math.abs(s.change) + "."
            : "Level: " + s.during.booked + " booked during and before.";
        s.revenue_given_up = s.off !== null ? round2(s.off * s.during.booked) : null;
      });

      var { data: msgs, error: msErr } = await supabase.from("store_messages")
        .select("*").order("created_at", { ascending: false }).limit(500);
      if (msErr) return json({ success: false, error: msErr.message }, 500);

      return json({
        success: true, today: today,
        can_edit: true,
        viewer: { name: gate.result.name, role: gate.result.role },
        live: decorated.filter(function(s) { return s.state === "live"; }),
        upcoming: decorated.filter(function(s) { return s.state === "upcoming"; }),
        past: decorated.filter(function(s) { return s.state === "finished" || s.state === "ended"; }),
        messages: (msgs || []).map(function(m) {
          return {
            id: m.id, store: m.store, all_stores: !m.store, kind: m.kind || "heads_up", body: m.body,
            pinned: !!m.pinned, starts_on: m.starts_on, ends_on: m.ends_on,
            created_by: m.created_by, created_at: m.created_at, active: m.active !== false,
            showing: m.active !== false && !(m.starts_on && today < m.starts_on) && !(m.ends_on && today > m.ends_on),
          };
        }),
        kinds: KINDS,
        measurement: "Appointments booked against that sheet row at that store, during the sale against the same number of days immediately before it. Demand, not revenue — and a sale's effect on PROFIT is not computable, because the sheet's part costs are the stale ones and no console row carries one at all.",
      });
    }

    // ── the sheet, thin, for the "start a sale" picker ─────────────────────
    // Purpose-built rather than reusing the price-book GET, which carries six
    // months of register actuals, quote evidence and sheet health for every
    // row. Picking a device needs seven columns.
    if (action === "rows") {
      var rGate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
      if (!rGate.authorized) return rGate.response;
      var { data: pr, error: pErr } = await supabase.from("repair_prices")
        .select("id,device,repair,tier,set_price,turnaround,family,model_group,sort_order")
        .eq("active", true).order("sort_order", { ascending: true }).limit(5000);
      if (pErr) return json({ success: false, error: pErr.message }, 500);
      return json({ success: true, rows: pr || [], count: (pr || []).length });
    }

    return json({ success: false, error: "unknown action: " + action }, 400);
  } catch (e) {
    // Loud. A promotions board that silently returns nothing is a TV showing
    // an empty card, and nobody would know it was broken.
    console.error("[promotions] GET failed:", e.message);
    return json({ success: false, error: e.message }, 500);
  }
}

export async function POST(request) {
  try {
    var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
    if (!gate.authorized) return gate.response;
    var who = gate.result.name || gate.result.email || "unknown";
    var body = await request.json();
    var action = body && body.action;
    var today = indyToday();

    // ── start a sale ───────────────────────────────────────────────────────
    if (action === "start_sale") {
      var rowId = parseInt(body.repair_price_id, 10);
      if (!rowId) return json({ success: false, error: "repair_price_id is required" }, 400);
      var price = num(body.sale_price);
      if (price === null || price < 0) return json({ success: false, error: "a sale price is required" }, 400);
      var starts = String(body.starts_on || today).slice(0, 10);
      var ends = String(body.ends_on || "").slice(0, 10);
      if (!ends) return json({ success: false, error: "an end date is required — a sale without one is a price change" }, 400);
      if (ends < starts) return json({ success: false, error: "the sale ends before it starts" }, 400);

      var stores = (Array.isArray(body.stores) ? body.stores : [body.store])
        .map(function(s) { return storeKeyFromName(s || ""); }).filter(Boolean);
      // De-duplicate, or "all stores" clicked twice writes two rows per store.
      stores = Object.keys(stores.reduce(function(a, s) { a[s] = 1; return a; }, {}));
      if (!stores.length) return json({ success: false, error: "at least one known store is required" }, 400);

      var { data: pr, error: prErr } = await supabase.from("repair_prices")
        .select("id,device,repair,tier,canonical_model,canonical_repair,set_price,active").eq("id", rowId).single();
      if (prErr || !pr) return json({ success: false, error: "that price row does not exist" }, 400);
      if (pr.active === false) return json({ success: false, error: "that row is not being offered — put it back on the sheet first" }, 400);

      // The general overlap case the unique index cannot express. Checked
      // BEFORE inserting, and reported per store rather than as one failure,
      // so a clash at one store does not silently drop the other two.
      var { data: existing, error: exErr } = await supabase.from("repair_price_sales")
        .select("id,store,starts_on,ends_on").eq("repair_price_id", rowId).eq("active", true).in("store", stores);
      if (exErr) return json({ success: false, error: exErr.message }, 500);
      var clash = (existing || []).filter(function(e) { return !(e.ends_on < starts || e.starts_on > ends); });
      if (clash.length) {
        return json({
          success: false,
          error: "a sale is already on this row at " + clash.map(function(c) { return c.store + " (" + c.starts_on + " to " + c.ends_on + ")"; }).join(", ")
            + ". End it first — two live sales on one row would make the price an agent reads out ambiguous.",
        }, 409);
      }

      var listed = num(pr.set_price);
      var rows = stores.map(function(s) {
        return {
          repair_price_id: rowId, store: s, sale_price: price,
          starts_on: starts, ends_on: ends,
          label: body.label ? String(body.label).slice(0, 120) : null,
          note: body.note ? String(body.note).slice(0, 500) : null,
          created_by: who, active: true,
        };
      });
      var { data: ins, error: insErr } = await supabase.from("repair_price_sales").insert(rows).select("*");
      if (insErr) return json({ success: false, error: insErr.message }, 500);

      // One ledger batch, field "sale_price" -- see the header for why it is
      // deliberately not "set_price".
      var batch = (globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : String(Date.now());
      var { error: ledErr } = await supabase.from("repair_price_changes").insert((ins || []).map(function(r) {
        return {
          batch_id: batch, repair_price_id: rowId,
          device: pr.device, repair: pr.repair, tier: pr.tier,
          canonical_model: pr.canonical_model, canonical_repair: pr.canonical_repair,
          field: "sale_price", old_value: listed, new_value: price,
          changed_by: who, effective_date: starts,
          reason: "Flash sale at " + r.store + " until " + ends + (body.label ? " — " + String(body.label).slice(0, 80) : ""),
        };
      }));
      // The sale is real whether or not its history line wrote. Reported, not
      // swallowed: a silent ledger failure is how a price change becomes
      // invisible to Price & Demand.
      return json({
        success: true, sales: ins, batch_id: batch,
        ledger_written: !ledErr,
        ledger_error: ledErr ? ledErr.message : null,
        listed_price: listed, off: listed !== null ? round2(listed - price) : null,
      });
    }

    // ── end one early ──────────────────────────────────────────────────────
    if (action === "end_sale") {
      var id = parseInt(body.id, 10);
      if (!id) return json({ success: false, error: "id is required" }, 400);
      // Never deleted. A sale that ran is a fact about what the store charged,
      // and the ledger line points at it.
      var { data: upd, error: uErr } = await supabase.from("repair_price_sales")
        .update({ active: false, ended_by: who, ended_at: new Date().toISOString() })
        .eq("id", id).select("*").single();
      if (uErr) return json({ success: false, error: uErr.message }, 500);
      return json({ success: true, sale: upd });
    }

    // ── messages ───────────────────────────────────────────────────────────
    if (action === "post_message") {
      var text = String(body.body || "").trim();
      if (!text) return json({ success: false, error: "a message needs some words" }, 400);
      if (text.length > 400) return json({ success: false, error: "keep it under 400 characters — it has to be readable from across the shop" }, 400);
      var mStore = body.all_stores ? null : storeKeyFromName(body.store || "");
      if (!body.all_stores && !mStore) return json({ success: false, error: "pick a store, or all stores" }, 400);
      var kind = KINDS.indexOf(body.kind) >= 0 ? body.kind : "heads_up";
      var { data: mIns, error: mErr2 } = await supabase.from("store_messages").insert([{
        store: mStore, kind: kind, body: text, pinned: !!body.pinned,
        starts_on: body.starts_on ? String(body.starts_on).slice(0, 10) : null,
        ends_on: body.ends_on ? String(body.ends_on).slice(0, 10) : null,
        created_by: who, active: true,
      }]).select("*").single();
      if (mErr2) return json({ success: false, error: mErr2.message }, 500);
      return json({ success: true, message: mIns });
    }

    if (action === "remove_message") {
      var mId = parseInt(body.id, 10);
      if (!mId) return json({ success: false, error: "id is required" }, 400);
      var { data: mDel, error: mdErr } = await supabase.from("store_messages")
        .update({ active: false }).eq("id", mId).select("*").single();
      if (mdErr) return json({ success: false, error: mdErr.message }, 500);
      return json({ success: true, message: mDel });
    }

    if (action === "pin_message") {
      var pId = parseInt(body.id, 10);
      if (!pId) return json({ success: false, error: "id is required" }, 400);
      var { data: mPin, error: mpErr } = await supabase.from("store_messages")
        .update({ pinned: !!body.pinned }).eq("id", pId).select("*").single();
      if (mpErr) return json({ success: false, error: mpErr.message }, 500);
      return json({ success: true, message: mPin });
    }

    return json({ success: false, error: "unknown action: " + action }, 400);
  } catch (e) {
    console.error("[promotions] POST failed:", e.message);
    return json({ success: false, error: e.message }, 500);
  }
}

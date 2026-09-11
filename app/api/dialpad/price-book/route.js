import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { resolveModel } from "@/lib/device-model";
import { classifyCatalogItem, cleanCatalogName, tierOfCatalogLine, isInsuranceLine } from "@/lib/repair-type";

// ─────────────────────────────────────────────────────────────────────────────
// PRICE BOOK
//
// The repair price cheat sheet, as a page. Agents read it on live calls; only
// admins (Eric and Matt) may change it.
//
// GET  ?months=6          every active price row, with what actually happened
//                         at the register for that device + repair in the window
// GET  ?action=changes    the ledger, newest batches first
// POST { action:"update", changes:[{id, set_price?, floor_price?, part_price?}],
//        reason?, effective_date? }
//
// Every POST writes to repair_price_changes under one batch_id. A bulk edit is
// therefore one deliberate event with a date, which is what lets Price & Demand
// turn its monthly trend into a real before/after for that repair.
//
// Two framing decisions Eric made on 2026-09-11, enforced here:
//   • Agents see ACCEPTANCE ("23 of 62 paid full price"), never an average
//     collected price. An average teaches discounting; acceptance argues for
//     holding the line. avg_collected is returned only to admins.
//   • Where the register rings a different list price than the sheet quotes,
//     both are shown. The gap is a finding, not something to hide.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

var PAGE = 1000;
var FLOOR_RULES = { "part+80": 80, "part+50": 50, "part+60": 60, "part+70": 70 };

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = parseFloat(v);
  return isFinite(n) ? n : null;
}
function round2(n) { return Math.round(n * 100) / 100; }
function monthsAgo(n) {
  var d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

// Ordered pagination — unordered .range() returns overlapping pages (see the
// price-demand route for the day that cost).
async function fetchAll(table, select, orderBy, apply) {
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

// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  try {
    var { searchParams } = new URL(request.url);
    var action = searchParams.get("action") || "list";

    if (action === "changes") {
      var { data: ch, error: chErr } = await supabase
        .from("repair_price_changes")
        .select("batch_id,device,repair,tier,field,old_value,new_value,changed_by,changed_at,effective_date,reason")
        .order("changed_at", { ascending: false })
        .limit(600);
      if (chErr) throw new Error(chErr.message);
      // group into batches so a bulk edit reads as one event
      var batches = {};
      (ch || []).forEach(function(r) {
        var b = batches[r.batch_id];
        if (!b) b = batches[r.batch_id] = { batch_id: r.batch_id, changed_by: r.changed_by, changed_at: r.changed_at, effective_date: r.effective_date, reason: r.reason, rows: [] };
        b.rows.push(r);
      });
      var list = Object.values(batches).sort(function(a, b) { return a.changed_at < b.changed_at ? 1 : -1; });
      return NextResponse.json({ success: true, batches: list });
    }

    // Who is asking decides whether avg_collected is included.
    var who = await requireAuth(request, { requiredRoles: ["admin", "manager", "employee"] });
    var isAdmin = who.authorized && who.result.role === "admin";

    var months = Math.min(24, Math.max(1, parseInt(searchParams.get("months") || "6", 10)));
    var since = monthsAgo(months);

    // Rows Matt has stopped offering (active = false) stay in the book so
    // their register history keeps attaching to them and they can be offered
    // again. Admins get them flagged; everyone else never sees them.
    // Paginate on id (unique — sort_order repeats once devices are added from
    // a template), then order the sheet in memory.
    var rows = await fetchAll("repair_prices", "*", "id");
    rows.sort(function(a, b) { return (a.sort_order - b.sort_order) || (a.id - b.id); });

    // ── what the register actually did for each (model, repair) ─────────────
    var tickets = await fetchAll(
      "ticket_grades",
      "device,item_details,date_closed",
      "ticket_number",
      function(q) { return q.gte("date_closed", since).not("date_closed", "is", null); }
    );

    // key: canonical_model|canonical_repair -> { tier -> stats, _any -> stats }
    var actuals = {};
    function bump(key, tier, list, disc, collected) {
      var slot = actuals[key] || (actuals[key] = {});
      var tk = tier || "_untiered";
      [tk, "_any"].forEach(function(k) {
        var s = slot[k] || (slot[k] = { sold: 0, full_price: 0, collected: 0, lists: {} });
        s.sold++;
        if (disc <= 0) s.full_price++;
        s.collected += collected;
        var lk = list.toFixed(2);
        s.lists[lk] = (s.lists[lk] || 0) + 1;
      });
    }
    // "(Protected)" lines are insurance claims (Assurant etc.): the insurer sets
    // the price per claim, so every one rings a different number and none of
    // them is a list price a customer was quoted. Counted separately, never
    // compared to the sheet — on the first pass they showed up as "register
    // rings $320.76 on 26 jobs, not on the sheet" for a screen that was.
    var insurance = {};
    tickets.forEach(function(t) {
      var rm = resolveModel(t.device);
      if (!rm.specified) return;
      (Array.isArray(t.item_details) ? t.item_details : []).forEach(function(it) {
        if (!it || String(it.category || "").toLowerCase().indexOf("repair") < 0) return;
        var rt = classifyCatalogItem(it.catalog_item).type;
        if (!rt) return;
        var list = num(it.unit_price);
        if (!list || list <= 0) return;
        var name = cleanCatalogName(it.catalog_item);
        var key = rm.canonical + "|" + rt;
        if (isInsuranceLine(name)) {
          var ins = insurance[key] || (insurance[key] = { sold: 0, sum: 0 });
          ins.sold++; ins.sum += list;
          return;
        }
        var disc = num(it.discount) || 0;
        var collected = it.line_total !== undefined && it.line_total !== null ? (num(it.line_total) || 0) : list - disc;
        bump(key, tierOfCatalogLine(name), list, disc, collected);
      });
    });

    function summarise(s) {
      if (!s) return null;
      var modal = Object.keys(s.lists).sort(function(a, b) { return s.lists[b] - s.lists[a]; })[0];
      var out = {
        sold: s.sold,
        full_price: s.full_price,
        full_price_rate: s.sold ? round2((s.full_price / s.sold) * 100) : null,
        pos_list: modal ? parseFloat(modal) : null,
        pos_list_share: modal && s.sold ? round2((s.lists[modal] / s.sold) * 100) : null,
      };
      if (isAdmin) out.avg_collected = s.sold ? round2(s.collected / s.sold) : null;
      // The booking floor: 20% under what this has actually sold for (Eric,
      // 2026-09-11). Needs a real sample; below that the sheet floor stands.
      out.book_floor = s.sold >= 3 ? round2(0.8 * (s.collected / s.sold)) : null;
      return out;
    }

    // Attach actuals to price rows. Prefer an exact tier match; otherwise the
    // row whose set price equals what the register most often rings; otherwise
    // the first row for that model+repair gets the untiered pool.
    var byKey = {};
    rows.forEach(function(r) {
      if (!r.canonical_model || !r.canonical_repair) return;
      var k = r.canonical_model + "|" + r.canonical_repair;
      (byKey[k] = byKey[k] || []).push(r);
    });
    rows.forEach(function(r) { r.actuals = null; });
    Object.keys(byKey).forEach(function(k) {
      var group = byKey[k];
      var ins = insurance[k];
      if (ins) group[0].insurance = { sold: ins.sold, avg_price: round2(ins.sum / ins.sold) };
      var slot = actuals[k];
      if (!slot) return;
      group.forEach(function(r) {
        if (r.tier && slot[r.tier]) r.actuals = summarise(slot[r.tier]);
      });
      var untiered = slot["_untiered"];
      if (untiered) {
        var summary = summarise(untiered);
        var modal = summary.pos_list;
        // A catalog line with no tier in its name: claim the row whose quote
        // equals the register price; failing that, if exactly one row is
        // still unclaimed it is the same repair and the difference is a real
        // disagreement to surface. Only when the sheet has several candidate
        // rows and none match is it a line the sheet does not have.
        var open = group.filter(function(r) { return !r.actuals; });
        var home = open.filter(function(r) { return r.set_price !== null && Math.abs(num(r.set_price) - modal) < 0.005; })[0]
          || (open.length === 1 ? open[0] : null);
        if (home) home.actuals = summary;
        else group[0].actuals_other = summary;
      }
    });

    var updatedMax = rows.reduce(function(m, r) { return r.updated_at > m ? r.updated_at : m; }, "");
    return NextResponse.json({
      success: true,
      since: since,
      window_months: months,
      can_edit: isAdmin,
      viewer: who.authorized ? { name: who.result.name, role: who.result.role } : null,
      updated_at_max: updatedMax,
      rows: isAdmin ? rows : rows.filter(function(r) { return r.active !== false; }),
    });
  } catch (e) {
    console.error("[price-book] GET failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });

  // Only admins. Managers can read the book; they cannot change a quote.
  var gate = await requireAuth(request, { requiredRoles: ["admin"] });
  if (!gate.authorized) return gate.response;
  var editor = gate.result.name || gate.result.email;

  try {
    var body = await request.json();

    // ── add a device by cloning a product line ───────────────────────────────
    // "iPhone 17 Pro Max" starts as a copy of every row the 16 Pro Max has —
    // LCD, OLED, OEM, back glass, charge port — at the template's prices, then
    // bulk edit takes it from there. New rows sort just above the template so
    // the newest model leads its line, exactly as the sheet does.
    if (body.action === "add_device") {
      var names = (Array.isArray(body.devices) ? body.devices : String(body.devices || "").split(/\r?\n|,/))
        .map(function(s) { return String(s || "").trim(); }).filter(Boolean);
      names = names.filter(function(n, i) { return names.indexOf(n) === i; });
      var template = String(body.template_device || "").trim();
      if (!names.length) return NextResponse.json({ success: false, error: "Give at least one device name" }, { status: 400 });
      if (names.length > 12) return NextResponse.json({ success: false, error: "At most 12 devices at once" }, { status: 400 });
      if (!template) return NextResponse.json({ success: false, error: "Pick the device to copy the product line from" }, { status: 400 });

      var { data: tRows, error: tErr } = await supabase.from("repair_prices").select("*").eq("device", template).order("sort_order").order("id");
      if (tErr) throw new Error(tErr.message);
      tRows = (tRows || []).filter(function(r) { return r.active !== false; });
      if (!tRows.length) return NextResponse.json({ success: false, error: "\"" + template + "\" has no rows to copy" }, { status: 404 });

      var { data: existingRows, error: exErr } = await supabase.from("repair_prices").select("device").in("device", names);
      if (exErr) throw new Error(exErr.message);
      var existing = {};
      (existingRows || []).forEach(function(r) { existing[r.device] = true; });
      var toAdd = names.filter(function(n) { return !existing[n]; });
      if (!toAdd.length) return NextResponse.json({ success: false, error: "Already on the sheet: " + names.join(", ") }, { status: 409 });

      var addBatch = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
      var addNow = new Date().toISOString();
      var addDate = addNow.slice(0, 10);
      var baseSort = Math.min.apply(null, tRows.map(function(r) { return r.sort_order; }));
      var newRows = [];
      var newLedger = [];
      var unresolved = [];
      toAdd.forEach(function(name, di) {
        var rm = resolveModel(name);
        if (!rm.specified) unresolved.push(name);
        tRows.forEach(function(t) {
          newRows.push({
            family: t.family, model_group: t.model_group, device: name, repair: t.repair, tier: t.tier,
            canonical_model: rm.specified ? rm.canonical : null, canonical_repair: t.canonical_repair,
            set_price: t.set_price, part_price: t.part_price, floor_price: t.floor_price, floor_rule: t.floor_rule,
            max_discount: t.max_discount, turnaround: t.turnaround, flags: t.flags || [], note: t.note,
            // the last name typed sorts first, so a list typed newest-first reads newest-first
            sort_order: baseSort - (toAdd.length - di),
            active: true, updated_at: addNow, updated_by: editor,
          });
        });
      });

      var { data: inserted, error: insErr } = await supabase.from("repair_prices").insert(newRows).select("id,device,repair,tier,canonical_model,canonical_repair,set_price");
      if (insErr) throw new Error("insert: " + insErr.message);
      (inserted || []).forEach(function(r) {
        newLedger.push({
          batch_id: addBatch, repair_price_id: r.id,
          device: r.device, repair: r.repair, tier: r.tier,
          canonical_model: r.canonical_model, canonical_repair: r.canonical_repair,
          field: "set_price", old_value: null, new_value: r.set_price,
          changed_by: editor, changed_at: addNow, effective_date: addDate,
          reason: "Added " + r.device + " from " + template + (body.reason ? " · " + String(body.reason).slice(0, 200) : ""),
        });
      });
      // Rows exist before the ledger here (the insert has to happen to know the
      // ids), so a ledger failure is reported loudly rather than swallowed.
      var { error: addLedErr } = await supabase.from("repair_price_changes").insert(newLedger);
      if (addLedErr) {
        console.error("[price-book] add_device rows inserted but ledger failed, batch " + addBatch + ":", addLedErr.message);
        return NextResponse.json({ success: false, error: "Rows were added but the change could not be recorded (" + addLedErr.message + "); batch " + addBatch + " needs review", added: (inserted || []).length }, { status: 500 });
      }
      return NextResponse.json({ success: true, batch_id: addBatch, added: (inserted || []).length, devices: toAdd, rows_per_device: tRows.length, template: template, skipped_existing: names.filter(function(n) { return existing[n]; }), unresolved: unresolved });
    }

    if (body.action !== "update") return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
    var changes = Array.isArray(body.changes) ? body.changes : [];
    if (!changes.length) return NextResponse.json({ success: false, error: "No changes supplied" }, { status: 400 });
    if (changes.length > 500) return NextResponse.json({ success: false, error: "Too many rows in one batch (max 500)" }, { status: 400 });

    var ids = changes.map(function(c) { return c.id; }).filter(Boolean);
    var { data: current, error: curErr } = await supabase.from("repair_prices").select("*").in("id", ids);
    if (curErr) throw new Error(curErr.message);
    var byId = {};
    (current || []).forEach(function(r) { byId[r.id] = r; });

    var batchId = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
    var effective = body.effective_date && /^\d{4}-\d{2}-\d{2}$/.test(body.effective_date) ? body.effective_date : new Date().toISOString().slice(0, 10);
    var reason = body.reason ? String(body.reason).slice(0, 300) : null;
    var now = new Date().toISOString();

    var ledger = [];
    var updates = [];
    var skipped = [];

    changes.forEach(function(c) {
      var row = byId[c.id];
      if (!row) { skipped.push({ id: c.id, why: "not found" }); return; }
      var patch = {};
      var diffs = [];
      ["set_price", "floor_price", "part_price"].forEach(function(f) {
        if (c[f] === undefined) return;
        var nv = num(c[f]);
        if (nv === null || nv < 0) { skipped.push({ id: c.id, why: "bad " + f }); return; }
        nv = round2(nv);
        var ov = num(row[f]);
        if (ov !== null && Math.abs(ov - nv) < 0.005) return; // no change
        patch[f] = nv;
        diffs.push({ field: f, old_value: ov, new_value: nv });
      });
      // A part-price change moves the floor by the row's own rule, so the rule
      // lives in one place and the derived change is recorded too.
      if (patch.part_price !== undefined && patch.floor_price === undefined && row.floor_rule && FLOOR_RULES[row.floor_rule] !== undefined) {
        var derived = round2(patch.part_price + FLOOR_RULES[row.floor_rule]);
        var oldFloor = num(row.floor_price);
        if (oldFloor === null || Math.abs(oldFloor - derived) >= 0.005) {
          patch.floor_price = derived;
          diffs.push({ field: "floor_price", old_value: oldFloor, new_value: derived, derived: true });
        }
      }
      // Offer / stop offering. Recorded in the same ledger as 1 → 0 so the
      // day LCDs came off the sheet is as findable as the day a price moved.
      if (c.active !== undefined) {
        var nvA = c.active === true || c.active === "true" || c.active === 1;
        var ovA = row.active !== false;
        if (nvA !== ovA) { patch.active = nvA; diffs.push({ field: "active", old_value: ovA ? 1 : 0, new_value: nvA ? 1 : 0 }); }
      }
      if (!diffs.length) { skipped.push({ id: c.id, why: "unchanged" }); return; }
      patch.updated_at = now;
      patch.updated_by = editor;
      updates.push({ id: row.id, patch: patch });
      diffs.forEach(function(d) {
        ledger.push({
          batch_id: batchId, repair_price_id: row.id,
          device: row.device, repair: row.repair, tier: row.tier,
          canonical_model: row.canonical_model, canonical_repair: row.canonical_repair,
          field: d.field, old_value: d.old_value, new_value: d.new_value,
          changed_by: editor, changed_at: now, effective_date: effective,
          reason: d.derived ? ((reason ? reason + " · " : "") + "floor recomputed from " + row.floor_rule) : reason,
        });
      });
    });

    if (!updates.length) {
      return NextResponse.json({ success: true, batch_id: null, updated: 0, skipped: skipped, message: "Nothing changed" });
    }

    // Ledger first: if the record of the change cannot be written, the change
    // does not happen. Silent price edits are the failure mode to avoid.
    var { error: ledErr } = await supabase.from("repair_price_changes").insert(ledger);
    if (ledErr) throw new Error("ledger: " + ledErr.message);

    var failed = [];
    for (var i = 0; i < updates.length; i++) {
      var u = updates[i];
      var { error: upErr } = await supabase.from("repair_prices").update(u.patch).eq("id", u.id);
      if (upErr) failed.push({ id: u.id, error: upErr.message });
    }
    if (failed.length) {
      console.error("[price-book] partial update failure, batch " + batchId + ":", JSON.stringify(failed));
      return NextResponse.json({ success: false, error: failed.length + " row(s) failed to update after the ledger was written; batch " + batchId + " needs review", batch_id: batchId, failed: failed }, { status: 500 });
    }

    return NextResponse.json({ success: true, batch_id: batchId, updated: updates.length, ledger_rows: ledger.length, skipped: skipped, effective_date: effective, changed_by: editor });
  } catch (e) {
    console.error("[price-book] POST failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

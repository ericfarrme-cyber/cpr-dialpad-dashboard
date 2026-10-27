import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { buildResolver, resolveNamePersonish, isSystemActor } from "@/lib/roster-resolver";

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGED & DEFECTIVE PARTS
//
// Eric, 2026-10-23, on who a damaged part belongs to: "the rule should
// attribute it to the person who repaired it."
//
// That rule is right, and the data supports it for exactly one of the two
// things RepairQ calls damage. Measured over the six months to 2026-10-27:
//
//   DEFECTIVE  17 lines, repaired_by filled on 17 of 17 (100%).
//              15 of 17 are category "part"; SIXTEEN OF SEVENTEEN are the same
//              catalog line, an "Aftermarket Pro: XO7 Soft" OLED assembly.
//              So the variable here is the part, not the technician, and the
//              screen leads with that -- a per-person list alone would read as
//              a competence ranking of a supplier problem.
//
//   DAMAGED    38 lines, repaired_by filled on 7 of 38 (18%). 31 of 38 are
//              category "accessory" -- Casper tempered glass and lens
//              protectors, 24 of them at Fishers, i.e. one unit spoiled out of
//              a ten-pack. There is no repairer on a box of screen protectors
//              and inventing one would put a tech's name on stockroom
//              breakage. These are reported BY STORE, never by person.
//
// ⚠ THERE IS NO DOLLAR VALUE ON ANY OF THESE LINES. unit_price and line_total
// are 0 on all 55, and item_details carries no cost field at all. Joining to
// repair_prices.part_price to estimate one was tried and rejected: those costs
// are the stale ones Eric already said to disregard (iPhone 15 Pro Max reads
// $40 next to 16 Pro Max at $370), so a total built on them would be a
// fabricated number on a page about accountability. The money lives in the
// P&L's damage / shrinkage lines, fed by RepairQ's inventory usage report.
// `priced_lines` is computed, not assumed -- if RepairQ ever starts sending a
// value the UI stops saying there is none.
//
// READ-ONLY. Admin/manager: this names individuals against defects.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

var PAGE = 1000;

function norm(s) { return String(s === null || s === undefined ? "" : s).replace(/\s+/g, " ").trim(); }
function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  var n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

// RepairQ's status cell is a scraped blob: the state, then whitespace, then
// sometimes "Charge Waived". Read the leading word only.
function statusOf(raw) {
  var n = norm(raw).toLowerCase();
  if (n.indexOf("damaged") === 0) return "damaged";
  if (n.indexOf("defective") === 0) return "defective";
  if (n.indexOf("sold") === 0) return "sold";
  return n.split(" ")[0] || "";
}
function isWaived(raw) { return /charge waived/i.test(String(raw || "")); }

// Former staff do not resolve to a roster name and keep their own -- the part
// still failed -- but "Ross, Jordan" should still read as a person.
function displayName(raw) {
  var m = norm(raw).match(/^([^,]+),\s*(.+)$/);
  return m ? norm(m[2]) + " " + norm(m[1]) : norm(raw);
}

// "Apple OLED Assembly Compatible For iPhone 14 Pro (Aftermarket Pro: XO7
// Soft)" -> a name short enough to group on without losing which part it is.
function partKey(name) {
  return norm(name).replace(/\s*\(.*$/, "").slice(0, 80) || "(unnamed line)";
}
// The grade inside the parentheses is what actually varies between a part that
// lasts and one that comes back.
function gradeOf(name) {
  var m = String(name || "").match(/\(([^)]{2,60})\)/);
  return m ? norm(m[1]) : null;
}

async function fetchTickets(since) {
  var out = [];
  for (var from = 0; ; from += PAGE) {
    var res = await supabase
      .from("ticket_grades")
      .select("ticket_number,store,device,employee_added,employee_repaired,item_details,date_closed")
      .gte("date_closed", since)
      .not("date_closed", "is", null)
      .order("ticket_number", { ascending: true })
      .range(from, from + PAGE - 1);
    if (res.error) throw new Error("ticket_grades: " + res.error.message);
    var batch = res.data || [];
    out = out.concat(batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

function rank(obj) {
  return Object.keys(obj).map(function(k) { return obj[k]; })
    .sort(function(a, b) { return b.lines - a.lines || String(a.name).localeCompare(String(b.name)); });
}

export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });

  var devAdmin = process.env.NODE_ENV !== "production" && new URL(request.url).searchParams.get("as_admin") === "1";
  if (!devAdmin) {
    var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
    if (!gate.authorized) return gate.response;
  }

  try {
    var { searchParams } = new URL(request.url);
    var store = searchParams.get("store") || "all";
    var months = Math.min(24, Math.max(1, parseInt(searchParams.get("months") || "6", 10)));
    var d = new Date();
    d.setUTCMonth(d.getUTCMonth() - months);
    var since = d.toISOString().slice(0, 10);

    var tickets = await fetchTickets(since);

    var rosterRes = await supabase.from("employee_roster").select("name,aliases,active").eq("active", true);
    var aliasMap = buildResolver(rosterRes.data || []).map;

    var scanned = 0, matched = 0, otherStore = 0, pricedLines = 0;
    var defective = [], damaged = [];

    tickets.forEach(function(t) {
      var items = Array.isArray(t.item_details) ? t.item_details : [];
      items.forEach(function(it) {
        scanned++;
        var st = statusOf(it && it.status);
        if (st !== "damaged" && st !== "defective") return;
        matched++;
        if (store !== "all" && t.store !== store) { otherStore++; return; }

        var value = Math.max(num(it.unit_price), num(it.line_total));
        if (value > 0) pricedLines++;

        // Eric's rule: the person who repaired it. Never the ticket owner --
        // that is an intake record, and 21 of the 38 damaged lines would land
        // on Aerick purely because the ticket is his.
        var rawWho = norm(it.repaired_by);
        // resolveNamePersonish, not resolveName: RepairQ writes "Long, Aerick"
        // on every one of these lines and the strict resolver does not flip it,
        // so every current employee came back unmatched and was labelled former
        // staff. Caught by the on_roster count reading 0 of 17.
        var resolved = rawWho && !isSystemActor(rawWho) ? (resolveNamePersonish(rawWho, aliasMap) || null) : null;
        // Someone off the active roster keeps their raw name rather than being
        // dropped -- the part still failed -- but is flagged so the screen can
        // say so instead of listing a former employee as if they were staff.
        var who = resolved || (rawWho && !isSystemActor(rawWho) ? displayName(rawWho) : null);
        var name = norm(it.catalog_item);

        var row = {
          ticket_number: t.ticket_number,
          store: t.store || null,
          device: t.device || null,
          month: String(t.date_closed || "").slice(0, 7) || null,
          date_closed: t.date_closed || null,
          status: st,
          category: norm(it.category) || null,
          item: name,
          part: partKey(name),
          grade: gradeOf(name),
          repaired_by: who,
          repaired_by_raw: rawWho || null,
          on_roster: !!resolved,
          waived: isWaived(it && it.status),
          value: value,
        };
        (st === "defective" ? defective : damaged).push(row);
      });
    });

    function group(rows, key, label) {
      var o = {};
      rows.forEach(function(r) {
        var k = r[key] === null || r[key] === undefined || r[key] === "" ? label : r[key];
        var g = o[k] || (o[k] = { name: k, lines: 0, months: {}, stores: {} });
        g.lines++;
        if (r.month) g.months[r.month] = (g.months[r.month] || 0) + 1;
        if (r.store) g.stores[r.store] = (g.stores[r.store] || 0) + 1;
      });
      return rank(o).map(function(g) {
        return { name: g.name, lines: g.lines, months: Object.keys(g.months).length, stores: Object.keys(g.stores) };
      });
    }

    // Defective parts attribute to a person; the leading question is still
    // which part, because one catalog line dominates.
    var defUnattributed = defective.filter(function(r) { return !r.repaired_by; }).length;
    var byPerson = group(defective.filter(function(r) { return r.repaired_by; }), "repaired_by", "—");
    // Former staff stay on the list -- the part still failed -- but are marked,
    // so nobody reads a leaver as part of today's bench.
    var rosterFlag = {};
    defective.forEach(function(r) { if (r.repaired_by) rosterFlag[r.repaired_by] = r.on_roster; });
    byPerson.forEach(function(p) { p.on_roster = rosterFlag[p.name] !== false; });
    var byPart = group(defective, "part", "(unnamed line)");
    // Grouped case-insensitively, displayed in the spelling RepairQ uses most.
    // It writes both "Aftermarket Pro: XO7 Soft" and "Aftermarket PRO: XO7
    // Soft", and keyed as typed the single biggest finding here splits into a
    // 12 and a 1 and stops looking like a pattern. Re-casing the string
    // instead would turn the part code "XO7" into "Xo7", so the real spelling
    // is kept rather than invented.
    var gradeAgg = {};
    defective.forEach(function(r) {
      if (!r.grade) return;
      var k = r.grade.toLowerCase();
      var g = gradeAgg[k] || (gradeAgg[k] = { lines: 0, spellings: {}, stores: {} });
      g.lines++;
      g.spellings[r.grade] = (g.spellings[r.grade] || 0) + 1;
      if (r.store) g.stores[r.store] = (g.stores[r.store] || 0) + 1;
    });
    var byGrade = Object.keys(gradeAgg).map(function(k) {
      var g = gradeAgg[k];
      var name = Object.keys(g.spellings).sort(function(a, b) { return g.spellings[b] - g.spellings[a]; })[0];
      return { name: name, lines: g.lines, stores: Object.keys(g.stores) };
    }).sort(function(a, b) { return b.lines - a.lines || a.name.localeCompare(b.name); });

    // Damaged stock is a store fact, not a person's.
    var damagedByStore = group(damaged, "store", "(no store)");
    var damagedByItem = group(damaged, "part", "(unnamed line)");
    var damagedByCategory = group(damaged, "category", "(none)");
    var damagedWithRepairer = damaged.filter(function(r) { return r.repaired_by; }).length;

    function monthly(rows) {
      var o = {};
      rows.forEach(function(r) { if (r.month) o[r.month] = (o[r.month] || 0) + 1; });
      return Object.keys(o).sort().map(function(m) { return { month: m, lines: o[m] }; });
    }

    return NextResponse.json({
      success: true,
      store: store,
      window_months: months,
      since: since,
      defective: {
        lines: defective.length,
        unattributed: defUnattributed,
        by_person: byPerson,
        by_part: byPart,
        by_grade: byGrade,
        by_month: monthly(defective),
        rows: defective.sort(function(a, b) { return String(b.date_closed).localeCompare(String(a.date_closed)); }),
      },
      damaged: {
        lines: damaged.length,
        with_repairer: damagedWithRepairer,
        by_store: damagedByStore,
        by_item: damagedByItem,
        by_category: damagedByCategory,
        by_month: monthly(damaged),
        rows: damaged.sort(function(a, b) { return String(b.date_closed).localeCompare(String(a.date_closed)); }),
      },
      // Zero means RepairQ sends no money on these lines, which is why the page
      // shows counts. If this ever goes above zero the UI stops saying so.
      priced_lines: pricedLines,
      // Every scanned line accounted for, the way the My Calls audit is: a
      // number that cannot be reconciled is a number nobody should trust.
      meta: {
        tickets: tickets.length,
        lines_scanned: scanned,
        lines_matched: matched,
        excluded_other_store: otherStore,
        returned: defective.length + damaged.length,
        balances: matched === otherStore + defective.length + damaged.length,
      },
    });
  } catch (e) {
    console.error("[damaged-parts] GET failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

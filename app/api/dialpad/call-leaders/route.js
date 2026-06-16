import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// CALL LEADERS — per-employee "Calls Handled" (audited) for the TV rankings.
//
// Source of truth: audit_results.employee — the audit transcribes the call
// recording and extracts the employee's spoken name. This is the attribution
// path Eric confirmed (not shift-inference).
//
// Counting model:
//   • ONE company-wide name→person resolver, built LIVE from employee_roster at
//     request time (add a roster row → that person auto-resolves, no code change).
//   • Each audited call is grouped by the call's OWN store column, so a floater's
//     calls land at the store where they happened (Matt's Fishers calls at
//     Fishers, his Indy calls at Indy), independent of where he's rostered.
//   • CONSERVATIVE matching only: full name + first + last + safe roster aliases.
//     Risky/ambiguous aliases are denylisted and any alias that maps to 2+ people
//     is dropped — both fall to "Unknown" rather than risk false credit.
//   • "Unknown" is kept as a visible per-store nudge for staff to say their name.
//
// NOT payroll-sensitive: this endpoint is display-only and is intentionally
// standalone — it does not touch scorecard / commission / bonus logic.
//
// GET /api/dialpad/call-leaders               -> current calendar month
// GET /api/dialpad/call-leaders?period=2026-05 -> a specific month
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];

// Aliases that are too risky to credit automatically — generic first names that
// could be anyone, cross-person ambiguity, or transcription mis-hears. Anything
// here (and anything unmatched) falls to "Unknown".
//
// NOTE: "eric"/"derek" are intentionally NOT here. They are common transcriptions
// of "Aerick" and are handled as explicit roster aliases on Aerick Long's row.
// Keeping them off the hard denylist lets the roster decide; they credit nobody
// unless a roster row lists them, so there's no auto-credit risk. (If owner-Eric
// is ever audited on the floor, his calls would credit Aerick — visible on-screen,
// not silent — revisit then.)
var RISKY_ALIASES = [
  "melissa", "duncan/sam", "fellis",
  "mood", "maud", "mau", "ma", "may", "bendy", "wendy",
];

// Compute [start, endExclusive) YYYY-MM-DD bounds for a calendar month.
function monthBounds(monthStr) {
  var parts = monthStr.split("-");
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10); // 1-12
  var start = year + "-" + String(month).padStart(2, "0") + "-01";
  var endMonth = month === 12 ? 1 : month + 1;
  var endYear = month === 12 ? year + 1 : year;
  var endExclusive = endYear + "-" + String(endMonth).padStart(2, "0") + "-01";
  return { start: start, endExclusive: endExclusive };
}

function currentMonthStr() {
  // Indiana local "now" so the month flips at local midnight, not UTC.
  var now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
}

// Normalize whatever the store column holds to one of the three canonical keys.
// Trusts the lowercase canonical the rest of the app uses, but defensively maps
// "Fishers" / "CPR Fishers" / "Indy" etc. so a stray value isn't silently lost.
function normalizeStore(s) {
  if (!s) return null;
  var v = String(s).toLowerCase().replace(/^cpr\s+/, "").trim();
  if (STORE_KEYS.indexOf(v) !== -1) return v;
  if (v.indexOf("fisher") === 0) return "fishers";
  if (v.indexOf("bloom") === 0) return "bloomington";
  if (v.indexOf("indian") === 0 || v.indexOf("indy") === 0) return "indianapolis";
  return null;
}

// Build the alias→canonical resolver from roster rows. Conservative:
// full name + first + last + safe aliases; denylist risky; drop collisions.
function buildResolver(rosterRows) {
  var risky = {};
  RISKY_ALIASES.forEach(function(a) { risky[a] = true; });

  var map = {};      // alias(lowercased) -> canonical full name
  var collide = {};  // alias -> true if it pointed at 2+ different people

  (rosterRows || []).forEach(function(r) {
    if (!r || !r.name) return;
    if (r.active === false) return; // skip deactivated roster rows
    var name = String(r.name).trim();
    var parts = name.split(/\s+/);

    var cands = {};
    cands[name.toLowerCase()] = true;
    if (parts[0]) cands[parts[0].toLowerCase()] = true;
    if (parts.length > 1) cands[parts[parts.length - 1].toLowerCase()] = true;

    var aliases = Array.isArray(r.aliases) ? r.aliases : [];
    aliases.forEach(function(a) {
      if (a == null) return;
      var al = String(a).trim().toLowerCase();
      if (al && !risky[al]) cands[al] = true;
    });

    Object.keys(cands).forEach(function(c) {
      if (risky[c]) return;
      if (map[c] && map[c] !== name) collide[c] = true;
      map[c] = name;
    });
  });

  // Any alias that resolved to 2+ people is unsafe — drop it to Unknown.
  Object.keys(collide).forEach(function(c) { delete map[c]; });
  return map;
}

// Resolve a raw audit "employee" string to a canonical person, or null (Unknown).
function resolveName(raw, map) {
  if (!raw) return null;
  var key = String(raw).trim().toLowerCase();
  if (!key || key === "unknown") return null;
  return map[key] || null;
}

export async function GET(request) {
  if (!supabase) {
    return NextResponse.json({ success: false, error: "Database not configured" });
  }

  try {
    var { searchParams } = new URL(request.url);
    var period = searchParams.get("period") || currentMonthStr();
    var bounds = monthBounds(period);
    var startTs = bounds.start + "T00:00:00.000Z";
    var endTs = bounds.endExclusive + "T00:00:00.000Z";

    // ── 1. Roster → live resolver ──────────────────────────────────────────
    var rosterRes = await supabase
      .from("employee_roster")
      .select("name, aliases, store, active");
    if (rosterRes.error) {
      return NextResponse.json({ success: false, error: rosterRes.error.message });
    }
    var resolver = buildResolver(rosterRes.data || []);

    // ── 2. Audited calls this month (exclude graded-out rows) ──────────────
    var auditRes = await supabase
      .from("audit_results")
      .select("employee, store, date_started, excluded")
      .gte("date_started", startTs)
      .lt("date_started", endTs)
      .limit(50000);
    if (auditRes.error) {
      return NextResponse.json({ success: false, error: auditRes.error.message });
    }

    // ── 3. Tally per store; resolve each row's name; bucket Unknown ────────
    var perStore = {}; // store -> { canonicalName -> count }
    STORE_KEYS.forEach(function(sk) { perStore[sk] = {}; });
    var unknownByStore = { fishers: 0, bloomington: 0, indianapolis: 0 };

    var totalRows = 0, placedRows = 0, unknownRows = 0, skippedStore = 0;

    (auditRes.data || []).forEach(function(row) {
      totalRows += 1;
      if (row.excluded === true) return;
      var sk = normalizeStore(row.store);
      if (!sk) { skippedStore += 1; return; } // can't place a call with no real store
      var canon = resolveName(row.employee, resolver);
      if (!canon) { unknownByStore[sk] += 1; unknownRows += 1; return; }
      perStore[sk][canon] = (perStore[sk][canon] || 0) + 1;
      placedRows += 1;
    });

    // ── 4. Shape per-store leader arrays (sorted desc) ─────────────────────
    var byStore = {};
    STORE_KEYS.forEach(function(sk) {
      var arr = Object.keys(perStore[sk]).map(function(n) {
        return { name: n, calls: perStore[sk][n] };
      });
      arr.sort(function(a, b) { return b.calls - a.calls; });
      byStore[sk] = { leaders: arr, unknown: unknownByStore[sk] };
    });

    // ── 5. Company #1 — highest single person-at-store cell (matches the
    //     other rankings cards, whose company #1 is one person's value at one
    //     store). Unknown is excluded from the company crown. ───────────────
    var companyTop = null;
    STORE_KEYS.forEach(function(sk) {
      Object.keys(perStore[sk]).forEach(function(n) {
        var v = perStore[sk][n];
        if (!companyTop || v > companyTop.calls) {
          companyTop = { name: n, calls: v, store: sk };
        }
      });
    });

    return NextResponse.json({
      success: true,
      period: period,
      byStore: byStore,
      companyTop: companyTop,
      fetchMeta: {
        rosterAliases: Object.keys(resolver).length,
        auditRows: totalRows,
        placed: placedRows,
        unknown: unknownRows,
        skippedNoStore: skippedStore,
      },
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message || "Failed to load call leaders" });
  }
}

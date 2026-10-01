// Bonus ledger — every bonus program in one place, per person, per month.
//
// WHY THIS EXISTS: three bonus programs run at once (tier streak, answer rate,
// Google reviews) and only ONE of them had any record of being paid. A streak
// award or a PTO day could be earned and never noticed. Eric, 2026-10-01:
// "I don't want to miss payment on somebody's streak or miss a PTO day for
// someone."
//
// ── THE PAYMENT LEDGER ──────────────────────────────────────────────────────
// `tier_celebrations` is the ledger for ALL programs, not just tier streaks.
// Its shape already fits (employee, store, event_period, amount, unit,
// bonus_paid_at) and it carries a unique index on
// (employee_name, store, event_period, event_type), so every write here is an
// idempotent upsert. New event types this route owns:
//
//   answer_rate   — the monthly answer-rate bonus ($100/$75/$50)
//   review_bonus  — the Google review bonus ($5/employee per review over 10,
//                   plus $5/employee per photo review)
//
// The tier types (gold_streak / platinum_streak / tier_up / diamond_plaque) are
// still written by tier-history/route.js and only READ here. Nothing in this
// route recomputes a tier award — it would be a second source of truth for the
// same dollars. `celebration_queue` in tier-history filters to the tier types
// so the AdminTab queue is unchanged by the rows added here.
//
// ── WHAT IS OWED vs WHAT IS UNRECORDED ──────────────────────────────────────
// An amount with no ledger row is reported as "no payment recorded", NEVER as
// "unpaid". Eric has been paying answer-rate bonuses by hand for months with
// nothing writing it down; calling those unpaid would invent a debt. He marks
// them, and from then on the ledger is the record.
//
// ── EVERY PROGRAM REPORTS ITS OWN DATA STATUS ───────────────────────────────
// A program with no data returns status "no_data" with the reason, not $0.
// A $0 that means "nothing earned" and a $0 that means "nobody entered the
// numbers" are different facts and this route never merges them. (June 2026.)
//
// GET  ?action=month&period=YYYY-MM     one month, every person, every program
// GET  ?action=outstanding&months=6     everything unpaid/unrecorded, all months
// GET  ?action=statement&period=YYYY-MM the monthly note, as text
// POST  mark_paid / unmark_paid / record_payment / mark_month_paid
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { GET as answerRateGET } from "../answer-rate-bonus/route";

export const dynamic = "force-dynamic";

// Tier awards are owned by tier-history. Listed here only so this route can
// tell them apart from the rows it writes itself.
var TIER_EVENT_TYPES = ["tier_up", "gold_streak", "platinum_streak", "diamond_plaque"];
var OWNED_EVENT_TYPES = ["answer_rate", "review_bonus", "manual"];

// Google review bonus (§2 of docs/CONTEXT.md, Eric's rule):
//   10 reviews/month is the floor — nothing pays at or below it
//   $5 per employee for every review ABOVE 10
//   $5 per employee for every photo review, regardless of the count
var REVIEW_FLOOR = 10;
var REVIEW_RATE = 5;

var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}
function json(d, s) { return NextResponse.json(d, { status: s || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

// Vercel serverless functions cannot reliably HTTP-call themselves (CLAUDE.md),
// so the answer-rate handler is invoked in-process. It reads only request.url.
async function callRouteHandler(handler, path) {
  var res = await handler(new Request("http://internal" + path));
  return await res.json();
}

function currentPeriod() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function priorPeriod(period, n) {
  if (n === undefined || n === null) n = 1;
  var parts = String(period).split("-");
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10) - 1 - n;
  while (m < 0) { m += 12; y -= 1; }
  return y + "-" + String(m + 1).padStart(2, "0");
}

function monthLabel(period) {
  var names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var p = String(period).split("-");
  return (names[parseInt(p[1], 10) - 1] || p[1]) + " " + p[0];
}

function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function tierRank(t) {
  var r = { Bronze: 0, Silver: 1, Gold: 2, Platinum: 3, Diamond: 4 };
  return r[t] != null ? r[t] : 0;
}

// ── Streak math ─────────────────────────────────────────────────────────────
// Counts consecutive months at a tier or better, working backwards from
// `upTo`. A gap in the months breaks the streak — a missing month is not a
// silent pass.
//
// ⚠ This counts the PERSON, across stores. tier-history's own streak query
// filters on store, so a transfer restarts the count there (Luke Stirling moved
// Bloomington → Indianapolis in September 2026). The two numbers are both
// returned so the difference is visible instead of quietly costing someone
// $100. Which one pays is Eric's call — this route does not decide it.
function streakAt(rows, upTo, minTier) {
  var byPeriod = {};
  (rows || []).forEach(function(r) {
    // Keep the best tier if a person somehow has two rows for one month
    // (one per store after a transfer).
    var cur = byPeriod[r.period];
    if (!cur || tierRank(r.tier) > tierRank(cur.tier)) byPeriod[r.period] = r;
  });
  var n = 0, p = upTo;
  while (byPeriod[p] && tierRank(byPeriod[p].tier) >= tierRank(minTier)) {
    n++;
    p = priorPeriod(p, 1);
  }
  return n;
}

function awardProgress(months) {
  // $100 per completed run of 3; recurring at 6, 9, 12 (Eric, 2026-08-31).
  var completed = Math.floor(months / 3);
  var into = months % 3;
  return {
    months: months,
    completed_runs: completed,
    months_into_run: into,
    months_to_next: months === 0 ? 3 : 3 - into,
    awards_at_next: completed + 1,
  };
}

// ── Google review bonus for a period ────────────────────────────────────────
// Returns per-store per-employee dollars, or a no_data reason. `google_reviews`
// is hand-entered and sparse — 4 rows in the whole table as of 2026-10-01 — so
// "nothing entered" is the common case and must not read as "nothing earned".
function reviewBonusForPeriod(reviewRows, period) {
  var rows = (reviewRows || []).filter(function(r) { return String(r.period) === String(period); });
  var byStore = {};
  rows.forEach(function(r) {
    var total = Number(r.total_reviews) || 0;
    var photos = Number(r.photo_reviews) || 0;
    var above = Math.max(0, total - REVIEW_FLOOR);
    byStore[String(r.store).toLowerCase()] = {
      store: String(r.store).toLowerCase(),
      total_reviews: total,
      photo_reviews: photos,
      above_floor: above,
      per_employee: money(REVIEW_RATE * above + REVIEW_RATE * photos),
      entered_employee_count: r.employee_count == null ? null : Number(r.employee_count),
      basis: total + " reviews (" + above + " over the " + REVIEW_FLOOR + "-review floor), " + photos + " with a photo",
    };
  });
  return byStore;
}

// ── Shared loader: everything one period needs ──────────────────────────────
async function loadPeriod(period) {
  var out = { period: period, programs: {} };

  // Roster first — it decides who appears at all, and bonus_eligible decides
  // who can be paid. Never the `role` label (a rename must not restore pay).
  var rosterRes = await supabase
    .from("employee_roster")
    .select("name, store, role, active, bonus_eligible")
    .eq("active", true)
    .order("name");
  if (rosterRes.error) throw new Error("Roster load failed: " + rosterRes.error.message);
  out.roster = rosterRes.data || [];

  // Tier history — all of it, for streak math across stores.
  var histRes = await supabase
    .from("employee_tier_history")
    .select("employee_name, store, period, overall_score, tier, multiplier, base_commission, tier_bonus, total_commission, pto_earned")
    .order("period", { ascending: true })
    .order("employee_name", { ascending: true });
  if (histRes.error) throw new Error("Tier history load failed: " + histRes.error.message);
  out.history = histRes.data || [];

  // The ledger.
  var ledgerRes = await supabase
    .from("tier_celebrations")
    .select("*")
    .order("event_period", { ascending: true })
    .order("id", { ascending: true });
  if (ledgerRes.error) throw new Error("Ledger load failed: " + ledgerRes.error.message);
  out.ledger = ledgerRes.data || [];

  // Google review sheet (hand-entered).
  var grRes = await supabase
    .from("google_reviews")
    .select("period, store, total_reviews, photo_reviews, employee_count, notes");
  if (grRes.error) throw new Error("Google reviews load failed: " + grRes.error.message);
  out.reviews = grRes.data || [];

  return out;
}

// Answer-rate bonus for one month. Loud on failure: this is bonus dollars, and
// a soft {success:false} with zeros is exactly the June 2026 failure mode.
async function answerRateForMonth(period) {
  var d;
  try {
    d = await callRouteHandler(answerRateGET, "/api/dialpad/answer-rate-bonus?month=" + encodeURIComponent(period));
  } catch (e) {
    return { status: "error", reason: "Answer-rate route threw: " + e.message, employees: [], stores: [] };
  }
  if (!d || !d.success) {
    return { status: "error", reason: "Answer-rate route failed: " + ((d && d.error) || "unknown"), employees: [], stores: [] };
  }
  return {
    status: "ok",
    employees: d.employees || [],
    stores: d.stores || [],
    tiers: d.tiers || [],
    total_payout: (d.totals && d.totals.total_payout) || 0,
  };
}

function ledgerFind(ledger, name, period, eventType) {
  return (ledger || []).find(function(r) {
    return String(r.employee_name) === String(name)
      && String(r.event_period) === String(period)
      && String(r.event_type) === String(eventType);
  }) || null;
}

// ── Build one person's month ─────────────────────────────────────────────────
// `inProgress` is true for the calendar month still running. An answer-rate
// bonus computed on day 1 of a month is a projection, not a debt — it is
// labelled in_progress, kept out of every owed total, and cannot be marked
// paid. Paying one of those out would be paying on a number that is still
// moving.
function buildPerson(ctx, person, period, arForMonth, reviewByStore, inProgress) {
  var name = person.name;
  var eligible = person.bonus_eligible !== false;
  var mine = ctx.history.filter(function(h) { return h.employee_name === name; });
  var thisMonth = mine.find(function(h) { return h.period === period; }) || null;
  var store = (thisMonth && thisMonth.store) || person.store || null;

  // A streak is counted as of the last month this person actually has a score
  // for, not blindly at the requested period. Viewing a month before its
  // snapshot has run would otherwise read every streak as 0 and report that
  // Duncan is three months from his next $100 when he is one.
  var asOf = period;
  if (!thisMonth) {
    var earlier = mine.filter(function(h) { return h.period <= period; })
      .map(function(h) { return h.period; }).sort();
    asOf = earlier.length ? earlier[earlier.length - 1] : period;
  }

  // Streaks: the person across stores, and store-scoped, so a transfer is
  // visible rather than silently resetting the count.
  var goldAll = streakAt(mine, asOf, "Gold");
  var platAll = streakAt(mine, asOf, "Platinum");
  var asOfStore = thisMonth ? store : ((mine.filter(function(h) { return h.period === asOf; })[0] || {}).store || store);
  var sameStore = mine.filter(function(h) { return h.store === asOfStore; });
  var goldStore = streakAt(sameStore, asOf, "Gold");
  var platStore = streakAt(sameStore, asOf, "Platinum");

  var items = [];

  // ── 1. Tier streak awards (read-only; written by tier-history) ──
  (ctx.ledger || []).forEach(function(ev) {
    if (ev.employee_name !== name) return;
    if (String(ev.event_period) !== String(period)) return;
    if (TIER_EVENT_TYPES.indexOf(ev.event_type) < 0) return;
    if (ev.dismissed_at) return;
    var amount = Number(ev.bonus_amount) || 0;
    if (amount <= 0) return; // tier_up is recognition, $0 — not a payable
    items.push({
      program: "tier_streak",
      event_type: ev.event_type,
      label: ev.event_type === "platinum_streak" ? "Platinum streak" : ev.event_type === "diamond_plaque" ? "Diamond plaque" : "Gold streak",
      basis: (ev.streak_length || 0) + " consecutive months at " + (ev.event_type === "platinum_streak" ? "Platinum" : "Gold") + " or better",
      amount: ev.bonus_unit === "cash" ? money(amount) : 0,
      pto_days: ev.bonus_unit === "pto_day" ? amount : 0,
      unit: ev.bonus_unit,
      ledger_id: ev.id,
      paid_at: ev.bonus_paid_at || null,
      state: ev.bonus_paid_at ? "paid" : "unpaid",
      owner: "tier-history",
      notes: ev.notes || null,
    });
  });

  // ── 2. Answer-rate bonus ──
  if (arForMonth.status === "ok") {
    // The answer-rate route keys on the WhenIWork name, which is not always
    // the roster spelling; it resolves through the roster itself and reports
    // not_bonused, so match on its own resolved view where possible.
    var ar = (arForMonth.employees || []).filter(function(e) {
      var n = String(e.employee || "").toLowerCase();
      var rn = String(name).toLowerCase();
      if (n === rn) return true;
      // "Last, First" and first+last agreement, the same conservative rule
      // used elsewhere. Deliberately NOT a first-name match — that is the bug
      // that showed Matthew Slade's commission on Matthew Ziegler's page.
      var a = n.split(/[\s,]+/).filter(Boolean).sort().join(" ");
      var b = rn.split(/[\s,]+/).filter(Boolean).sort().join(" ");
      return a === b;
    })[0];
    if (ar) {
      var row = ledgerFind(ctx.ledger, name, period, "answer_rate");
      var amt = money(ar.bonus || 0);
      var storeStat = (arForMonth.stores || []).find(function(s) { return s.store === ar.assigned_store; });
      items.push({
        program: "answer_rate",
        event_type: "answer_rate",
        label: "Answer-rate bonus",
        basis: ar.not_bonused
          ? "salaried · no answer-rate bonus"
          : (ar.assigned_store || "?") + " at " + (storeStat && storeStat.answer_rate != null ? Number(storeStat.answer_rate).toFixed(1) + "%" : "?") + " · " + (ar.assigned_hours || 0) + " hrs",
        amount: amt,
        pto_days: 0,
        unit: "cash",
        ledger_id: row ? row.id : null,
        paid_at: row ? row.bonus_paid_at : null,
        // No row at all means nobody wrote down whether this was paid. That is
        // a different fact from "unpaid" and is labelled as one.
        state: amt <= 0 ? "none" : row ? (row.bonus_paid_at ? "paid" : "unpaid") : (inProgress ? "in_progress" : "unrecorded"),
        owner: "bonuses",
        not_bonused: !!ar.not_bonused,
        assigned_store: ar.assigned_store || null,
        store: ar.assigned_store || store,
      });
    }
  }

  // ── 3. Google review bonus ──
  var rb = store ? reviewByStore[store] : null;
  if (rb && rb.per_employee > 0 && thisMonth) {
    var rrow = ledgerFind(ctx.ledger, name, period, "review_bonus");
    items.push({
      program: "review_bonus",
      event_type: "review_bonus",
      label: "Google review bonus",
      basis: rb.store + ": " + rb.basis,
      // Credited because this person has a scored month here; the roster as it
      // stands today is not evidence of who worked a past month.
      eligibility_basis: "scored in " + period,
      amount: money(rb.per_employee),
      pto_days: 0,
      unit: "cash",
      ledger_id: rrow ? rrow.id : null,
      paid_at: rrow ? rrow.bonus_paid_at : null,
      state: rrow ? (rrow.bonus_paid_at ? "paid" : "unpaid") : (inProgress ? "in_progress" : "unrecorded"),
      owner: "bonuses",
    });
  }

  // Ineligible people keep their tier row and their numbers; they just cannot
  // be paid from it. The row is marked blocked and zeroed rather than dropped —
  // silently removing a payable is how money goes missing in either direction.
  if (!eligible) {
    items = items.map(function(i) {
      if (i.amount === 0 && i.pto_days === 0) return i;
      return Object.assign({}, i, {
        state: "blocked", amount: 0, pto_days: 0,
        basis: i.basis + " — not paid: bonus_eligible is false",
        would_have_been: i.pto_days > 0 ? i.pto_days + " PTO day(s)" : "$" + i.amount.toFixed(2),
      });
    });
  }

  var owedCash = items.reduce(function(s, i) { return s + (i.state === "unpaid" ? i.amount : 0); }, 0);
  var progCash = items.reduce(function(s, i) { return s + (i.state === "in_progress" ? i.amount : 0); }, 0);
  var progPto = items.reduce(function(s, i) { return s + (i.state === "in_progress" ? i.pto_days : 0); }, 0);
  var unrecordedCash = items.reduce(function(s, i) { return s + (i.state === "unrecorded" ? i.amount : 0); }, 0);
  var paidCash = items.reduce(function(s, i) { return s + (i.state === "paid" ? i.amount : 0); }, 0);
  var owedPto = items.reduce(function(s, i) { return s + (i.state === "unpaid" ? i.pto_days : 0); }, 0);
  var unrecordedPto = items.reduce(function(s, i) { return s + (i.state === "unrecorded" ? i.pto_days : 0); }, 0);
  var paidPto = items.reduce(function(s, i) { return s + (i.state === "paid" ? i.pto_days : 0); }, 0);

  return {
    name: name,
    store: store,
    role: person.role || null,
    bonus_eligible: eligible,
    has_month: !!thisMonth,
    score: thisMonth ? thisMonth.overall_score : null,
    tier: thisMonth ? thisMonth.tier : null,
    multiplier: thisMonth ? thisMonth.multiplier : null,
    commission: thisMonth ? {
      base: money(thisMonth.base_commission),
      tier_bonus: money(thisMonth.tier_bonus),
      total: money(thisMonth.total_commission),
      // Commission rides the regular paycheck; it is shown for context and is
      // never counted as something owed on this screen.
      paid_via: "paycheck",
    } : null,
    streak: {
      gold: awardProgress(goldAll),
      platinum: awardProgress(platAll),
      gold_months_this_store: goldStore,
      platinum_months_this_store: platStore,
      store_scoped_differs: goldStore !== goldAll || platStore !== platAll,
      as_of: asOf,
      // true when the streak is quoted from an earlier month because this one
      // has no snapshot yet — the UI says so rather than implying it is current.
      as_of_is_stale: asOf !== period,
    },
    timeline: mine.map(function(h) {
      return { period: h.period, store: h.store, tier: h.tier, score: h.overall_score };
    }),
    items: items,
    totals: {
      owed_cash: money(owedCash),
      unrecorded_cash: money(unrecordedCash),
      paid_cash: money(paidCash),
      owed_pto: owedPto,
      unrecorded_pto: unrecordedPto,
      paid_pto: paidPto,
      in_progress_cash: money(progCash),
      in_progress_pto: progPto,
    },
  };
}

function programStatuses(period, arForMonth, reviewByStore, roster) {
  var reviewStores = Object.keys(reviewByStore);
  return [
    {
      key: "tier_streak",
      label: "Tier streak",
      status: "ok",
      detail: "$100 per completed run of 3 months at Gold+, recurring at 6/9/12. 1 PTO day per 3 months at Platinum+.",
      source: "employee_tier_history → tier_celebrations",
    },
    {
      key: "answer_rate",
      label: "Answer rate",
      status: arForMonth.status === "ok" ? "ok" : "error",
      detail: arForMonth.status === "ok"
        ? "≥ 90% = $100, ≥ 85% = $75, ≥ 80% = $50. Highest tier only, open hours, answered calls under 15s excluded from 2026-09."
        : arForMonth.reason,
      source: "call_records + employee_shifts (live)",
    },
    {
      key: "review_bonus",
      label: "Google reviews",
      status: reviewStores.length === 0 ? "no_data" : reviewStores.length < STORE_KEYS.length ? "partial" : "ok",
      detail: reviewStores.length === 0
        ? "No " + monthLabel(period) + " row in google_reviews — the sheet is entered by hand. This is 'not entered', not 'nothing earned'."
        : reviewStores.length + " of 3 stores entered: " + reviewStores.join(", ") + ". $" + REVIEW_RATE + "/employee per review over " + REVIEW_FLOOR + ", plus $" + REVIEW_RATE + "/employee per photo review.",
      source: "google_reviews (hand-entered)",
    },
    {
      key: "non_phone",
      label: "Non-phone repair bonus (Duncan)",
      status: "not_built",
      detail: "Agreed in principle — $100 at $15,000/month of console + tablet + computer + misc profit, plus $75 per $1,000 above. Not implemented: blocked on Daily Profit accuracy and closed-ticket sync (open items 2 and 3). Nothing is computed or owed from here.",
      source: "—",
    },
  ];
}

// ────────────────────────────────────────────────────────────────────────────
export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" }, 500);

  // Bonus dollars for named people. Admin and manager only; never public.
  // Local development only: `?as_admin=1` renders this read-only GET without a
  // session so the numbers can be audited against real data. Same precedent as
  // price-book. Ignored in production, and never on POST.
  var devAdmin = process.env.NODE_ENV !== "production" && new URL(request.url).searchParams.get("as_admin") === "1";
  if (!devAdmin) {
    var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
    if (!gate.authorized) return gate.response;
  }

  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action") || "month";

  try {
    // ── One month, every person, every program ──
    if (action === "month" || action === "statement") {
      var period = searchParams.get("period") || priorPeriod(currentPeriod(), 1);
      var ctx = await loadPeriod(period);
      var ar = await answerRateForMonth(period);
      var reviewByStore = reviewBonusForPeriod(ctx.reviews, period);

      var inProgress = period === currentPeriod();
      var people = ctx.roster.map(function(p) {
        return buildPerson(ctx, p, period, ar, reviewByStore, inProgress);
      });

      // Anyone with a tier row this month who is not on the active roster still
      // gets listed — a former employee can be owed a streak award.
      var rosterNames = {};
      ctx.roster.forEach(function(p) { rosterNames[p.name] = true; });
      ctx.history.filter(function(h) { return h.period === period && !rosterNames[h.employee_name]; })
        .forEach(function(h) {
          var ghost = buildPerson(ctx, { name: h.employee_name, store: h.store, bonus_eligible: true, role: "off roster" }, period, ar, reviewByStore, inProgress);
          ghost.off_roster = true;
          people.push(ghost);
        });

      var totals = people.reduce(function(a, p) {
        a.owed_cash += p.totals.owed_cash;
        a.unrecorded_cash += p.totals.unrecorded_cash;
        a.paid_cash += p.totals.paid_cash;
        a.owed_pto += p.totals.owed_pto;
        a.unrecorded_pto += p.totals.unrecorded_pto;
        a.paid_pto += p.totals.paid_pto;
        a.in_progress_cash += p.totals.in_progress_cash;
        a.in_progress_pto += p.totals.in_progress_pto;
        return a;
      }, { owed_cash: 0, unrecorded_cash: 0, paid_cash: 0, owed_pto: 0, unrecorded_pto: 0, paid_pto: 0, in_progress_cash: 0, in_progress_pto: 0 });
      totals.in_progress_cash = money(totals.in_progress_cash);
      totals.owed_cash = money(totals.owed_cash);
      totals.unrecorded_cash = money(totals.unrecorded_cash);
      totals.paid_cash = money(totals.paid_cash);

      var periodsAvailable = [];
      ctx.history.forEach(function(h) { if (periodsAvailable.indexOf(h.period) < 0) periodsAvailable.push(h.period); });
      if (periodsAvailable.indexOf(currentPeriod()) < 0) periodsAvailable.push(currentPeriod());
      periodsAvailable.sort().reverse();

      var payload = {
        success: true,
        period: period,
        period_label: monthLabel(period),
        periods_available: periodsAvailable,
        is_current_month: period === currentPeriod(),
        people: people.sort(function(a, b) {
          var d = (b.totals.owed_cash + b.totals.unrecorded_cash) - (a.totals.owed_cash + a.totals.unrecorded_cash);
          if (d) return d;
          return (b.score || 0) - (a.score || 0);
        }),
        programs: programStatuses(period, ar, reviewByStore, ctx.roster),
        answer_rate_stores: ar.stores || [],
        review_stores: Object.keys(reviewByStore).map(function(k) { return reviewByStore[k]; }),
        totals: totals,
      };

      if (action === "statement") {
        payload.statement = composeStatement(payload);
        payload.statement_markdown = composeStatement(payload, true);
      }
      return json(payload);
    }

    // ── Everything unpaid or unrecorded, across months ──
    if (action === "outstanding") {
      var months = Math.max(1, Math.min(24, parseInt(searchParams.get("months") || "8", 10)));
      var ctx2 = await loadPeriod(currentPeriod());
      var periods = [];
      for (var i = 0; i < months; i++) periods.push(priorPeriod(currentPeriod(), i));
      // Only months that actually have tier rows — scanning further back asks
      // the answer-rate route for months with no data and returns noise.
      var known = {};
      ctx2.history.forEach(function(h) { known[h.period] = true; });
      periods = periods.filter(function(p) { return known[p]; });

      var reviewByPeriod = {};
      periods.forEach(function(p) { reviewByPeriod[p] = reviewBonusForPeriod(ctx2.reviews, p); });

      // One answer-rate pass per period. Sequential on purpose: each pass is
      // several large reads and firing them all at once has timed out the
      // function before.
      var arByPeriod = {};
      for (var k = 0; k < periods.length; k++) {
        arByPeriod[periods[k]] = await answerRateForMonth(periods[k]);
      }

      var rows = [];
      periods.forEach(function(p) {
        ctx2.roster.forEach(function(person) {
          var built = buildPerson(ctx2, person, p, arByPeriod[p], reviewByPeriod[p], p === currentPeriod());
          built.items.forEach(function(it) {
            if (it.state !== "unpaid" && it.state !== "unrecorded") return;
            if (it.amount <= 0 && it.pto_days <= 0) return;
            rows.push({
              period: p, period_label: monthLabel(p),
              employee: built.name,
              // Where it was EARNED, which for the answer rate is the max-hours
              // store, not the roster store. This is what the ledger records.
              store: it.store || built.store,
              roster_store: built.store,
              program: it.program, event_type: it.event_type, label: it.label,
              basis: it.basis, amount: it.amount, pto_days: it.pto_days,
              unit: it.unit, state: it.state, ledger_id: it.ledger_id,
            });
          });
        });
        // Off-roster people with a tier award still owed.
        var names = {};
        ctx2.roster.forEach(function(r) { names[r.name] = true; });
        (ctx2.ledger || []).forEach(function(ev) {
          if (String(ev.event_period) !== String(p)) return;
          if (names[ev.employee_name]) return;
          if (TIER_EVENT_TYPES.indexOf(ev.event_type) < 0) return;
          if (ev.dismissed_at || ev.bonus_paid_at) return;
          var amt = Number(ev.bonus_amount) || 0;
          if (amt <= 0) return;
          rows.push({
            period: p, period_label: monthLabel(p),
            employee: ev.employee_name, store: ev.store, off_roster: true,
            program: "tier_streak", event_type: ev.event_type, label: "Tier streak (off roster)",
            basis: (ev.streak_length || 0) + " months",
            amount: ev.bonus_unit === "cash" ? money(amt) : 0,
            pto_days: ev.bonus_unit === "pto_day" ? amt : 0,
            unit: ev.bonus_unit, state: "unpaid", ledger_id: ev.id,
          });
        });
      });

      var byPerson = {};
      rows.forEach(function(r) {
        var e = byPerson[r.employee] || (byPerson[r.employee] = { employee: r.employee, store: r.store, owed_cash: 0, unrecorded_cash: 0, owed_pto: 0, unrecorded_pto: 0, rows: [] });
        e.rows.push(r);
        if (r.state === "unpaid") { e.owed_cash += r.amount; e.owed_pto += r.pto_days; }
        else { e.unrecorded_cash += r.amount; e.unrecorded_pto += r.pto_days; }
      });
      Object.keys(byPerson).forEach(function(n) {
        byPerson[n].owed_cash = money(byPerson[n].owed_cash);
        byPerson[n].unrecorded_cash = money(byPerson[n].unrecorded_cash);
      });

      var arErrors = periods.filter(function(p) { return arByPeriod[p].status !== "ok"; })
        .map(function(p) { return { period: p, reason: arByPeriod[p].reason }; });

      return json({
        success: true,
        periods_scanned: periods,
        rows: rows.sort(function(a, b) { return b.period.localeCompare(a.period) || a.employee.localeCompare(b.employee); }),
        by_person: Object.values(byPerson).sort(function(a, b) { return (b.owed_cash + b.unrecorded_cash) - (a.owed_cash + a.unrecorded_cash); }),
        totals: {
          owed_cash: money(rows.reduce(function(s, r) { return s + (r.state === "unpaid" ? r.amount : 0); }, 0)),
          unrecorded_cash: money(rows.reduce(function(s, r) { return s + (r.state === "unrecorded" ? r.amount : 0); }, 0)),
          owed_pto: rows.reduce(function(s, r) { return s + (r.state === "unpaid" ? r.pto_days : 0); }, 0),
          unrecorded_pto: rows.reduce(function(s, r) { return s + (r.state === "unrecorded" ? r.pto_days : 0); }, 0),
        },
        // Surfaced, never swallowed: a month whose answer rate could not be
        // read is a month whose bonus might be missing from this list.
        answer_rate_errors: arErrors,
      });
    }

    return json({ success: false, error: "Unknown action. Use: month, outstanding, statement" }, 400);
  } catch (e) {
    // Loud. A bonus screen that renders empty is worse than one that errors.
    console.error("[bonuses] " + action + " failed:", e.message);
    return json({ success: false, error: e.message }, 500);
  }
}

// ── The monthly note ────────────────────────────────────────────────────────
function composeStatement(p, asMarkdown) {
  var L = [];
  var h = asMarkdown ? "## " : "";
  // A month still running is a projection, not a bill. Heading, totals and
  // every line say so, because "Bonuses owed — October: $400" computed on
  // 1 October off seven hours of shifts would be a false debt.
  var live = !!p.is_current_month;
  L.push(h + (live ? "Bonuses on pace — " + p.period_label + " (month still running)" : "Bonuses owed — " + p.period_label));
  L.push("");
  if (live) {
    L.push("Nothing here is payable yet. The answer rate moves until the month closes, and the tier snapshot for " + p.period_label + " has not been taken.");
    L.push("");
  }
  var cash = live
    ? (p.totals.in_progress_cash || 0) + p.totals.owed_cash + p.totals.unrecorded_cash
    : p.totals.owed_cash + p.totals.unrecorded_cash;
  var pto = live
    ? (p.totals.in_progress_pto || 0) + p.totals.owed_pto + p.totals.unrecorded_pto
    : p.totals.owed_pto + p.totals.unrecorded_pto;
  if (cash === 0 && pto === 0) {
    L.push(live ? "Nothing on pace for " + p.period_label + " yet." : "Nothing outstanding for " + p.period_label + ".");
  } else {
    L.push((live ? "On pace: $" : "Total: $") + cash.toFixed(2) + (pto ? " and " + pto + " PTO day" + (pto === 1 ? "" : "s") : ""));
    L.push("");
    p.people.forEach(function(e) {
      var t = e.totals.owed_cash + e.totals.unrecorded_cash + (live ? (e.totals.in_progress_cash || 0) : 0);
      var tp = e.totals.owed_pto + e.totals.unrecorded_pto + (live ? (e.totals.in_progress_pto || 0) : 0);
      if (t === 0 && tp === 0) return;
      L.push((asMarkdown ? "**" : "") + e.name + (asMarkdown ? "**" : "") + " (" + (e.store || "?") + ")" + " — $" + t.toFixed(2) + (tp ? " + " + tp + " PTO day" + (tp === 1 ? "" : "s") : ""));
      e.items.forEach(function(i) {
        if (i.state !== "unpaid" && i.state !== "unrecorded" && i.state !== "in_progress") return;
        if (i.amount <= 0 && i.pto_days <= 0) return;
        var tagText = i.state === "unrecorded" ? " [no payment recorded]"
          : i.state === "in_progress" ? " [month still running — not payable yet]" : "";
        L.push("  • " + i.label + ": " + (i.pto_days ? i.pto_days + " PTO day" + (i.pto_days === 1 ? "" : "s") : "$" + i.amount.toFixed(2))
          + " — " + i.basis + tagText);
      });
    });
  }
  // Streak watch — the whole point of the note.
  var watch = p.people.filter(function(e) {
    return e.bonus_eligible && e.has_month && (e.streak.gold.months_to_next === 1 || e.streak.platinum.months_to_next === 1);
  });
  if (watch.length) {
    L.push("");
    L.push((asMarkdown ? "### " : "") + "One month away from an award");
    watch.forEach(function(e) {
      if (e.streak.gold.months_to_next === 1) L.push("  • " + e.name + ": " + e.streak.gold.months + " months at Gold+ — one more completes a run ($100)");
      if (e.streak.platinum.months_to_next === 1) L.push("  • " + e.name + ": " + e.streak.platinum.months + " months at Platinum+ — one more earns a PTO day");
    });
  }
  var gaps = (p.programs || []).filter(function(x) { return x.status === "no_data" || x.status === "partial" || x.status === "error"; });
  if (gaps.length) {
    L.push("");
    L.push((asMarkdown ? "### " : "") + "Programs that could not be fully computed");
    gaps.forEach(function(g) { L.push("  • " + g.label + ": " + g.detail); });
  }
  return L.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" }, 500);

  // Writing a payment record is an admin act. Managers can read the screen;
  // only Eric marks money paid.
  var gate = await requireAuth(request, { requiredRoles: ["admin"] });
  if (!gate.authorized) return gate.response;
  var who = (gate.result && gate.result.user) || {};

  var body;
  try { body = await request.json(); } catch (e) { body = {}; }
  var action = body.action;
  var stamp = new Date().toISOString();
  var byLine = "marked by " + (who.name || who.email || "admin") + " on " + stamp.slice(0, 10);

  try {
    // Mark an existing ledger row paid (any program, including tier awards).
    if (action === "mark_paid" || action === "unmark_paid") {
      if (!body.ledger_id) return json({ success: false, error: "ledger_id required" }, 400);
      var paid = action === "mark_paid";
      var upd = {
        bonus_paid_at: paid ? stamp : null,
        notes: body.notes != null ? body.notes : (paid ? byLine : null),
      };
      var r1 = await supabase.from("tier_celebrations").update(upd).eq("id", body.ledger_id).select();
      if (r1.error) return json({ success: false, error: r1.error.message }, 500);
      if (!(r1.data || []).length) return json({ success: false, error: "No ledger row with id " + body.ledger_id }, 404);
      return json({ success: true, row: r1.data[0] });
    }

    // Record a payment for a program that has no ledger row yet (answer rate,
    // review bonus, or a one-off). Idempotent via the table's unique index on
    // (employee_name, store, event_period, event_type).
    if (action === "record_payment") {
      var need = ["employee", "store", "period", "event_type"];
      for (var i = 0; i < need.length; i++) {
        if (!body[need[i]]) return json({ success: false, error: need[i] + " required" }, 400);
      }
      if (OWNED_EVENT_TYPES.indexOf(body.event_type) < 0) {
        // Tier awards are written by tier-history. Creating one here would make
        // two routes the source of the same dollars.
        return json({ success: false, error: "event_type must be one of " + OWNED_EVENT_TYPES.join(", ") + " — tier awards are written by tier-history and can only be marked, not created" }, 400);
      }
      var amount = Number(body.amount);
      if (!isFinite(amount) || amount < 0) return json({ success: false, error: "amount must be a non-negative number" }, 400);
      var row = {
        employee_name: body.employee,
        store: String(body.store).toLowerCase(),
        event_type: body.event_type,
        event_period: body.period,
        bonus_amount: money(amount),
        bonus_unit: body.unit || "cash",
        bonus_paid_at: body.paid === false ? null : stamp,
        notes: body.notes || byLine,
      };
      var r2 = await supabase
        .from("tier_celebrations")
        .upsert(row, { onConflict: "employee_name,store,event_period,event_type", ignoreDuplicates: false })
        .select();
      if (r2.error) return json({ success: false, error: r2.error.message }, 500);
      return json({ success: true, row: (r2.data || [])[0] || null });
    }

    // Mark every outstanding item in one month paid, in one go. Returns what it
    // did per item rather than a count, so a partial failure is visible.
    if (action === "mark_month_paid") {
      if (!body.period) return json({ success: false, error: "period required" }, 400);
      // The running month's answer rate is still moving. Settling it in bulk
      // would pay on a number that is not final yet.
      if (body.period === currentPeriod()) {
        return json({ success: false, error: currentPeriod() + " is still running — its answer rate is not final. Settle it after the month closes." }, 409);
      }
      var ctx = await loadPeriod(body.period);
      var ar = await answerRateForMonth(body.period);
      if (ar.status !== "ok") {
        // Refuse rather than mark a partial month paid and have the rest look
        // settled when it never was.
        return json({ success: false, error: "Answer rate could not be computed for " + body.period + " (" + ar.reason + "), so this month cannot be settled in bulk. Mark items individually." }, 503);
      }
      var rbs = reviewBonusForPeriod(ctx.reviews, body.period);
      var inProg = false; // guarded above
      var results = [];
      for (var j = 0; j < ctx.roster.length; j++) {
        var built = buildPerson(ctx, ctx.roster[j], body.period, ar, rbs, inProg);
        for (var m = 0; m < built.items.length; m++) {
          var it = built.items[m];
          if (it.state !== "unpaid" && it.state !== "unrecorded") continue;
          if (it.amount <= 0 && it.pto_days <= 0) continue;
          if (it.ledger_id) {
            var u = await supabase.from("tier_celebrations")
              .update({ bonus_paid_at: stamp, notes: byLine + " (whole month)" })
              .eq("id", it.ledger_id).select("id");
            results.push({ employee: built.name, program: it.program, ok: !u.error, error: u.error ? u.error.message : null });
          } else {
            var ins = await supabase.from("tier_celebrations").upsert({
              employee_name: built.name,
              store: String(it.store || built.store || "").toLowerCase(),
              event_type: it.event_type,
              event_period: body.period,
              bonus_amount: money(it.amount || it.pto_days),
              bonus_unit: it.unit || "cash",
              bonus_paid_at: stamp,
              notes: byLine + " (whole month)",
            }, { onConflict: "employee_name,store,event_period,event_type", ignoreDuplicates: false }).select("id");
            results.push({ employee: built.name, program: it.program, ok: !ins.error, error: ins.error ? ins.error.message : null });
          }
        }
      }
      var failed = results.filter(function(r) { return !r.ok; });
      return json({
        success: failed.length === 0,
        period: body.period,
        marked: results.filter(function(r) { return r.ok; }).length,
        failed: failed.length,
        results: results,
      }, failed.length ? 207 : 200);
    }

    if (action === "settle_through") {
      if (!body.period) return json({ success: false, error: "period required (YYYY-MM, inclusive)" }, 400);
      if (body.period >= currentPeriod()) {
        return json({ success: false, error: "Cannot settle through " + body.period + " — that month is not finished." }, 409);
      }
      var ctxS = await loadPeriod(body.period);
      var knownP = {};
      ctxS.history.forEach(function(h) { if (h.period <= body.period) knownP[h.period] = true; });
      var plist = Object.keys(knownP).sort();
      var note = "bulk reconciliation through " + body.period + " by " + (who.name || who.email || "admin")
        + " on " + stamp.slice(0, 10) + " — settled as a backlog, not verified item by item";
      var done = [], failures = [];
      for (var pi = 0; pi < plist.length; pi++) {
        var per = plist[pi];
        var arS = await answerRateForMonth(per);
        if (arS.status !== "ok") { failures.push({ period: per, error: arS.reason }); continue; }
        var rbS = reviewBonusForPeriod(ctxS.reviews, per);
        for (var ri = 0; ri < ctxS.roster.length; ri++) {
          var b2 = buildPerson(ctxS, ctxS.roster[ri], per, arS, rbS, false);
          for (var ii = 0; ii < b2.items.length; ii++) {
            var it2 = b2.items[ii];
            if (it2.state !== "unpaid" && it2.state !== "unrecorded") continue;
            if (it2.amount <= 0 && it2.pto_days <= 0) continue;
            var res2;
            if (it2.ledger_id) {
              res2 = await supabase.from("tier_celebrations")
                .update({ bonus_paid_at: stamp, notes: note }).eq("id", it2.ledger_id).select("id");
            } else {
              res2 = await supabase.from("tier_celebrations").upsert({
                employee_name: b2.name,
                store: String(it2.store || b2.store || "").toLowerCase(),
                event_type: it2.event_type,
                event_period: per,
                bonus_amount: money(it2.amount || it2.pto_days),
                bonus_unit: it2.unit || "cash",
                bonus_paid_at: stamp,
                notes: note,
              }, { onConflict: "employee_name,store,event_period,event_type", ignoreDuplicates: false }).select("id");
            }
            if (res2.error) failures.push({ period: per, employee: b2.name, program: it2.program, error: res2.error.message });
            else done.push({ period: per, employee: b2.name, program: it2.program, amount: it2.amount, pto_days: it2.pto_days });
          }
        }
      }
      return json({
        success: failures.length === 0,
        through: body.period, periods: plist,
        settled: done.length, failed: failures.length,
        total_cash: money(done.reduce(function(a, d) { return a + (d.amount || 0); }, 0)),
        total_pto: done.reduce(function(a, d) { return a + (d.pto_days || 0); }, 0),
        items: done, failures: failures.slice(0, 20),
      }, failures.length ? 207 : 200);
    }

    return json({ success: false, error: "Unknown action. Use: mark_paid, unmark_paid, record_payment, mark_month_paid, settle_through" }, 400);
  } catch (e) {
    console.error("[bonuses] POST " + action + " failed:", e.message);
    return json({ success: false, error: e.message }, 500);
  }
}

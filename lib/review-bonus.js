// The review bonus, in one place.
//
// ⚠ WHY THIS FILE EXISTS. This rule has now been copied four times, and every
// copy has been found wrong later: ReviewsTab kept its own TIERS table
// (CONTEXT § 10ao), `ask_pages` omitted a clause of the thin-page test
// (§ 10ar), My Reviews computed a rule nobody had agreed to (§ 10aw), and the
// Bonus Ledger -- the screen the money is actually paid from -- was still
// computing $5-per-review-above-10 plus $5-per-photo out of `google_reviews`,
// a table with four rows whose newest is August 2026.
//
// Two routes need this now and they cannot call each other: a Vercel function
// cannot reliably HTTP its own deployment (CLAUDE.md, architecture gotchas).
// So it lives here, both import it, and there is exactly one definition of
// what a store earns and what a person is named for.
//
// Nothing in this file reads the database or writes a row. It takes rows in
// and returns numbers, which is what makes it testable offline against live
// data before anything is paid.

import { creditReview } from "@/lib/review-credit";

// Indiana-local day, so "today" rolls when the stores' day does.
export function indyToday() {
  var d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export function monthStart(ymd) { return ymd.slice(0, 8) + "01"; }

// The store review tier. ONE definition -- ReviewsTab had a second copy of
// this table, which is how two screens come to disagree about what a store
// earned. Eric set the floor at 10 (2026-10-19) after rejecting 6.
//
// Counts EVERY review in the month, across that store's four pages. Highest
// tier only, per eligible person. Nothing in this route pays it: the bonus is
// not approved, and `payable` is false on every row that mentions money.
export var TIERS = [{ at: 10, pays: 50 }, { at: 15, pays: 75 }, { at: 20, pays: 100 }];
export function tierFor(n) {
  if (n === null || n === undefined) return null;
  var hit = null;
  TIERS.forEach(function(t) { if (n >= t.at) hit = t; });
  return hit;
}

// ── the 1-star deduction ────────────────────────────────────────────────────
// One 1-star halves the store's tier for that month; a second zeroes it.
//
// THREE DECISIONS INSIDE THIS, each one recommended rather than asked for, so
// each is written down with the reason it went that way:
//
// (a) ONE LEVER, NOT TWO. The 1-star still counts as a review toward the
//     threshold -- it is NOT subtracted from the month's count as well as
//     halving the payout. Stacking both would make a single bad review worth
//     the entire bonus at the margin: a store on 10 reviews would drop to 9,
//     miss the floor and earn nothing, where halving leaves it $25. With the
//     measured 45.8% chance that a store genuinely performing at 10 a month
//     lands at 9 anyway, stacking punishes variance rather than service. It
//     also keeps the count exactly what Google publishes, which is the
//     property that made the simple rule possible.
// (b) 1-STAR ONLY, not 2-star. Eric's earlier draft said "1 or 2". He said
//     "a 1 star" twice since. The line is cleaner and the data is indifferent:
//     across 42 captured reviews there is exactly one 1-star and no 2-star.
//     `PENALTY_AT_OR_BELOW` is the one constant to change if he wants 2 in.
// (c) NAMED CREDITS SURVIVE. The tier is collective; the $10/$20 for being
//     named follows the person. Docking Aerick's named credit because someone
//     else took a 1-star would punish the wrong people -- and a 1-star already
//     pays its own named employee nothing.
// THRESHOLD IS TOTAL REVIEWS, NOT FIVE-STAR. The premium asks whether a page
// is established yet, which is a question about the whole page. Module scope
// because two actions read it now -- `credits` proposes the money and
// `ask_pages` tells a tech which page is still worth the larger amount. A
// second copy is how two screens come to disagree (see TIERS above).
export var THIN_UNDER = 10, NAMED_MAIN = 10, NAMED_THIN = 20;

// A review that names two people SPLITS the credit between them -- Eric,
// 2026-11-03: "Yes it splits 5/5". So a $10 main-page credit naming two
// technicians pays $5 each, and a $20 thin-page credit pays $10 each. One
// line, one place, both screens move together.
export var SPLIT_NAMED_CREDIT = true;
// A named credit pays ONLY if the store reached the tier floor that month --
// Eric, same message: "no it doesnt pay if you miss 10". This reverses the
// earlier recommendation that named credits survive a missed floor, so note
// what it does NOT touch: the 1-star DEDUCTION still leaves named credits
// alone (CONTEXT 10ap (c)). Missing the floor and being docked for a 1-star
// are different things, and only the first one now blocks a named credit.
//
// The floor is checked against the month the review was POSTED in, measured
// the same way the tier is -- a subtraction between snapshots. Where that
// count is not knowable (no snapshot before the month began, which is every
// month before 2026-10) the credit does NOT pay and says why: inventing a
// count to justify a payment is the trap this file keeps away from. Nothing
// before November was ever going to be settled, so this costs nobody.
export var NAMED_CREDIT_NEEDS_STORE_FLOOR = true;

// ── reviews a store took in a given month ───────────────────────────────────
// The same subtraction `?action=tracking` does for the running month,
// generalised to ANY month, because the store-floor gate has to be applied to
// the month each review was posted in and not to today. Keeping it here means
// the gate and the tier can never disagree about what a store took.
export function storeGainsByMonth(snaps, listings) {
  var byListing = {};
  (snaps || []).forEach(function(sn) { (byListing[sn.listing_id] = byListing[sn.listing_id] || []).push(sn); });
  Object.keys(byListing).forEach(function(k) {
    byListing[k].sort(function(a, b) { return String(a.captured_on).localeCompare(String(b.captured_on)); });
  });
  var months = {};
  (snaps || []).forEach(function(sn) { months[String(sn.captured_on).slice(0, 7)] = true; });
  var out = {};
  Object.keys(months).forEach(function(ym) {
    var mStart = ym + "-01";
    var y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7));
    var mEnd = (mo === 12 ? (y + 1) + "-01" : y + "-" + String(mo + 1).padStart(2, "0")) + "-01";
    (listings || []).forEach(function(l) {
      if (!l.is_ours || !l.store) return;
      var rows = byListing[l.id] || [];
      var before = null, last = null;
      rows.forEach(function(r) {
        if (r.captured_on < mStart) before = r;
        if (r.captured_on < mEnd) last = r;
      });
      var gain = (before && last) ? last.total_reviews - before.total_reviews : null;
      // Provable-zero, same as `tracking`: a reading of 0 taken inside the
      // month proves the page held 0 on the 1st, so the baseline is deduced
      // rather than written.
      if (gain === null && last) {
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].captured_on >= mStart && rows[i].captured_on < mEnd && rows[i].total_reviews === 0) { gain = last.total_reviews; break; }
        }
      }
      var key = l.store + "|" + ym;
      var b = out[key] || (out[key] = { store: l.store, period: ym, gained: null, pages_without_baseline: 0 });
      if (gain === null) b.pages_without_baseline += 1;
      else b.gained = (b.gained || 0) + gain;
    });
  });
  Object.keys(out).forEach(function(k) {
    var b = out[k];
    b.complete = b.pages_without_baseline === 0 && b.gained !== null;
    // An INCOMPLETE count that already clears the floor still clears it --
    // missing pages can only make the figure larger, never smaller.
    b.reached = b.gained !== null && b.gained >= TIERS[0].at;
  });
  return out;
}

// Whether the store cleared the floor in the month a review was posted, or a
// sentence saying why that cannot be answered. Never a bare false: a $0 on
// somebody's screen with no reason attached is the thing that generates the
// phone call.
export function storeFloorState(gains, store, ym) {
  if (!NAMED_CREDIT_NEEDS_STORE_FLOOR) return { ok: true, required: false };
  var floor = TIERS[0].at;
  if (!store) return { ok: false, required: true, why: "this review is not attached to one of our stores" };
  if (!ym) return { ok: false, required: true, why: "this review has no posting date, so it belongs to no month" };
  var g = gains && gains[store + "|" + ym];
  if (!g || g.gained === null) {
    return { ok: false, required: true, gained: null, floor: floor,
      why: "we were not tracking review counts in " + ym + ", so there is no way to tell whether " + store + " cleared " + floor };
  }
  if (g.reached) return { ok: true, required: true, gained: g.gained, floor: floor, complete: g.complete };
  if (!g.complete) {
    return { ok: false, required: true, gained: g.gained, floor: floor, complete: false,
      why: store + " reads " + g.gained + " reviews in " + ym + ", under " + floor + " -- but " + g.pages_without_baseline + " page(s) have no baseline that month, so the count is incomplete" };
  }
  return { ok: false, required: true, gained: g.gained, floor: floor, complete: true,
    why: store + " took " + g.gained + " reviews in " + ym + ", under the " + floor + " floor" };
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE DEFINITION of "what a captured review is worth, and to whom".
//
// Used by ?action=credits (the manager's payment queue) and ?action=my_reviews
// (a technician's own screen). They must never disagree about a person's pay,
// and this file has already had that bug twice — ReviewsTab keeping its own
// copy of TIERS (§ 10ao) and ask_pages omitting a clause of the `thin` test
// that credits had (§ 10ar). Both were invisible until the day they cost
// somebody money, so the rule lives here once.
// ─────────────────────────────────────────────────────────────────────────────
export function creditRowsFor(items, lById, totalById, roster, gains) {
  return (items || []).map(function(it) {
    var l = lById[it.listing_id] || {};
    var total = totalById[it.listing_id];
    var thin = l.listing_type !== "main" && total !== undefined && total !== null && total < THIN_UNDER;
    var r = it.rating == null ? null : Number(it.rating);
    var ym = it.posted_at ? String(it.posted_at).slice(0, 7) : null;
    var credits = creditReview(it.text, roster || []);
    // Every review counts as a review. The one exception is the obvious
    // one: a 1-star does not pay the person it names, and it raises a flag
    // instead. A 2, 3 or 4 star counts and pays -- Eric, 2026-10-30, after
    // the five-star-only rule turned out not to be computable at all.
    var counts = r !== 1;
    var full = thin ? NAMED_THIN : NAMED_MAIN;
    var payableNames = credits.filter(function(c) { return c.payable; }).length;
    var share = (SPLIT_NAMED_CREDIT && payableNames > 1) ? payableNames : 1;
    // The store floor, scored against the month this review was posted in.
    var floor = storeFloorState(gains, l.store || null, ym);
    return {
      id: it.id,
      period: ym,
      store: l.store || null,
      listing_type: l.listing_type || null,
      listing_label: l.label || null,
      page_total_reviews: total === undefined ? null : total,
      page_under_threshold: thin,
      rating: r,
      author: it.author || null,
      text: it.text || null,
      has_photo: !!it.has_photo,
      posted_at: it.posted_at || null,
      counts_for_tier: counts,
      flagged: r === 1,
      why_not: counts ? null : "1 star — flagged for a person to look at, and it pays nobody",
      store_floor_met: floor.ok,
      store_reviews_in_month: floor.gained === undefined ? null : floor.gained,
      store_floor: floor,
      proposed_credits: credits.map(function(c) {
        return {
          name: c.name,
          matched: c.matched,
          payable: c.payable,
          // 0 whenever it cannot pay, so no screen has to re-derive the rule.
          amount: (counts && c.payable && floor.ok) ? Math.round((full / share) * 100) / 100 : 0,
          // What it WOULD have paid if the store had cleared the floor. Both
          // figures travel for the same reason the tier's two do: "$0 because
          // the store missed 10" and "$0 because you are not eligible" are
          // different conversations.
          amount_if_floor_met: (counts && c.payable) ? Math.round((full / share) * 100) / 100 : 0,
          shared_with: share > 1 ? share : null,
          blocked: !c.payable ? "not bonus-eligible"
            : (!counts ? "1 star review"
            : (!floor.ok ? (floor.why || "store did not reach the review floor") : null)),
        };
      }),
    };
  });
}

export var PENALTY_AT_OR_BELOW = 1;        // a review at or below this many stars docks the store
export var PENALTY_STEPS = [1, 0.5, 0];    // 0 such reviews -> full, 1 -> half, 2+ -> nothing
export function penaltyFactor(n) {
  var k = Math.max(0, Math.min(PENALTY_STEPS.length - 1, n || 0));
  return PENALTY_STEPS[k];
}

// One row per (store, listing_type), whatever the table actually holds.
//
// On 2026-10-20 a re-run of the seed doubled every listing: `on conflict do
// nothing` needs a constraint to conflict on, and there was none. The sync then
// resolved DIFFERENT place_ids for two of the copies and wrote eight days of
// null snapshots against them, so a store's history was split across two rows.
// The duplicates were deleted on 2026-10-27 and sql/migration_google_listings_unique.sql
// adds the index -- but until that is run, and after it for safety, every read
// goes through here so a duplicate can never double a count on screen.
//
// Keeps the row that is actually working: one with a place_id beats one
// without, then the lower id, which is the original.
export function dedupeListings(rows) {
  var best = {}, dropped = 0;
  (rows || []).forEach(function(l) {
    var key = (l.store == null ? "~competitor~" : String(l.store)) + "|" + String(l.listing_type);
    var cur = best[key];
    if (!cur) { best[key] = l; return; }
    dropped += 1;
    var curHas = !!cur.place_id, newHas = !!l.place_id;
    if (newHas && !curHas) best[key] = l;
    else if (newHas === curHas && Number(l.id) < Number(cur.id)) best[key] = l;
  });
  var out = Object.keys(best).map(function(k) { return best[k]; });
  out.sort(function(a, b) { return Number(a.id) - Number(b.id); });
  return { listings: out, duplicates_dropped: dropped };
}

// The 1-star flag. Not a penalty and not a count -- a prompt to go and look.
//
// WHAT IT CAN AND CANNOT SEE, stated here because the flag's honesty depends on
// it. Places returns a RELEVANCE SAMPLE of about five reviews per page, each
// with its own star rating, plus the page's exact total and its average to one
// decimal. So:
//
//   * On a page we hold in full (every department page: 0-8 reviews) the flag
//     is CERTAIN. We have every review's stars.
//   * On a main page (559 / 648 / 892 reviews) we hold about five, so a 1-star
//     is seen only if Google happens to sample it. It does happen -- a 1-star
//     from June is in the seven we hold for Bloomington -- but it is not a
//     guarantee, and the payload says so rather than implying the page is clean.
//   * The published average cannot rescue it. One 1-star moves a 648-review
//     4.8 to 4.794, which still prints as 4.8; it takes about NINE of them in a
//     month to shift the first decimal. So the average only ever catches a
//     catastrophe, never a single bad review.
//
// This incompleteness is why the deduction runs on EVIDENCE rather than on a
// clean-page assumption: a 1-star we can point at docks the store, and one
// nobody has seen does not. `manual_one_star` counts the ones a manager
// recorded from the Business Profile inbox, which is the complete source --
// that is the path that stops the rule reading as "you get away with it if
// Google does not show us".
// ⚠ THE DEDUCTION IS MONTHLY, so the count that drives it MUST be scoped to the
// month. Caught before shipping on live data: the only 1-star we hold is dated
// 2026-06-25 and an unscoped count docked OCTOBER for it. An all-time 1-star
// count is still returned, because "this page has a 1-star on it" is worth
// reading -- but it is a separate field and only the monthly one costs money.
//
// A 1-star with no `posted_at` cannot be assigned to a month, so it does NOT
// dock anyone; it is surfaced as `one_star_undated` instead. Same direction as
// everything else here: the gap errs toward the employee. (Today 42 of 42
// items carry a date, so this is a guard, not a live case.)
export function oneStarWatch(total, items, monthStartYmd, monthEndYmd) {
  var held = items || [];
  var bad = held.filter(function(r) { return Number(r.rating) <= PENALTY_AT_OR_BELOW; });
  function inMonth(r) {
    var d = r.posted_at ? String(r.posted_at).slice(0, 10) : null;
    return d && d >= monthStartYmd && d < monthEndYmd;
  }
  var thisMonth = bad.filter(inMonth);
  var undated = bad.filter(function(r) { return !r.posted_at; });
  var manual = thisMonth.filter(function(r) { return /^manual:/.test(String(r.review_key || "")); });
  var complete = total !== null && total !== undefined && held.length >= total;
  return {
    // The one that docks money.
    one_star_this_month: thisMonth.length,
    // Context only -- never multiplied by anything.
    one_star_all_time: bad.length,
    one_star_undated: undated.length,
    manual_one_star: manual.length,
    reviews_held: held.length,
    // True only when we hold the page's whole review set, so no screen has to
    // work out whether "0 one-star" means clean or merely unseen.
    flag_certain: complete,
    flag_note: complete
      ? null
      : "Google samples about five reviews a page; a 1-star outside that sample is invisible here until a manager records it from the Business Profile inbox.",
  };
}

// Google review tracking — the listings, what they read today, and what moved.
//
// Separate from `google-reviews`, which is the hand-entered monthly sheet and
// stays as it is. This one is the automated half.
//
// WHY A SEPARATE SHAPE: `google_reviews` counts reviews RECEIVED in a month,
// keyed (period, store), with no listing dimension and no star ratings. Eric's
// bonus needs five-star counts, a one-star penalty, and the console listing
// separated from the repair listing. None of that is answerable from a monthly
// total. See sql/migration_google_listings.sql.
//
// REVIEWS GAINED IS ALWAYS A SUBTRACTION between two snapshots of the lifetime
// total, never a stored figure, so it cannot drift away from what Google says.
//
// ⚠ Needs GOOGLE_PLACES_API_KEY. Without it `sync` fails loudly with a 503 and
// says exactly what is missing — it never returns success with zero rows
// written, which is how the June 2026 outage hid for eight days.
//
// GET  ?action=listings   the tracked listings and their latest reading
// GET  ?action=tracking   per store: this month's gain, rating, per listing
// GET  ?action=credits    captured reviews + PROPOSED name credits (admin/manager)
// GET  ?action=review_leaders  who gets named, counts only — safe for the TV
// GET  ?action=five_star  the hand-entered five-star counts for a period
// POST {action:'save_five_star', period, store, five_star_count, ...}  (admin/manager)
// GET  ?action=sync       capture today's reading for every listing (cron/admin)
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { placeLooksLikeOurs, searchQueryFor } from "@/lib/place-match";
import { creditReview } from "@/lib/review-credit";

export const dynamic = "force-dynamic";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(d, s) { return NextResponse.json(d, { status: s || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

// Indiana-local day, so "today" rolls when the stores' day does.
function indyToday() {
  var d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function monthStart(ymd) { return ymd.slice(0, 8) + "01"; }

// ── Places lookups ──────────────────────────────────────────────────────────
// Places API (New). A listing with no place_id gets one from a text search of
// its own label, which is why the migration leaves place_id null rather than
// guessing a value that would silently track the wrong shop.
// Ask for several results and pick the one that IS the listing we want, rather
// than taking Google's top hit on faith.
//
// All four of a store's pages share an address and a phone, and the parent
// store outranks its own departments on every query — so "Electronics at CPR
// Fishers IN" returns "CPR Cell Phone Repair" first and the electronics page
// further down. Taking result [0] is what collapsed six listings onto their
// parent. The vetting function is the selector: the first candidate it accepts
// wins, and if it accepts none we report what Google actually offered.
async function findPlaceId(listing, query, key) {
  var res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress" },
    body: JSON.stringify({ textQuery: query, maxResultCount: 10 }),
  });
  if (!res.ok) throw new Error("Places searchText " + res.status + ": " + (await res.text()).slice(0, 200));
  var j = await res.json();
  var places = j.places || [];
  var considered = [];
  for (var i = 0; i < places.length; i++) {
    var p = places[i];
    var name = (p.displayName && p.displayName.text) || null;
    var addr = p.formattedAddress || null;
    considered.push(name);
    var vet = placeLooksLikeOurs(listing, name, addr);
    if (vet.ok) return { place_id: p.id, matched: name, address: addr, rank: i + 1, considered: considered };
  }
  return { place_id: null, considered: considered, why: places.length ? "none of the " + places.length + " results was the right page" : "no results" };
}

async function fetchPlace(placeId, key) {
  var res = await fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId), {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,googleMapsUri,reviews" },
  });
  if (!res.ok) throw new Error("Places details " + res.status + ": " + (await res.text()).slice(0, 200));
  return res.json();
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
function dedupeListings(rows) {
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

// How many of a page's reviews are five-star -- computed EXACTLY, or refused.
//
// Eric's rule (2026-10-20) is that only five-star reviews count, and the
// Places API never sends a star histogram. But the ownership split (Eric,
// 2026-10-29: the three main listings are ours through GBP, the nine
// department pages belong to the franchisor) turns out to fall on exactly the
// right side of what is computable from public data:
//
//   * A page whose whole review set is in `google_review_items` is counted by
//     reading the stars Google already gave us. Every review, no arithmetic.
//     Places returns ~5 reviews, so this covers any page at or under that.
//   * A page with a few unsampled reviews left can still be pinned. The
//     published average fixes the TOTAL star sum when the one-decimal rounding
//     band contains a single integer; the residual's deficit from a perfect
//     5r then says how many are not five-star. That is only FORCED when the
//     deficit is 0 (all five) or 1 (exactly one four) -- at a deficit of 2 the
//     page could hold two fours or one three, which are different five-star
//     counts, so we refuse. Deliberately strict: a count that is merely likely
//     is an estimate, and estimates must not look like counts.
//   * The main pages (n = 559 / 648 / 892) cannot be pinned at all: the
//     rounding band is +/-0.05n, which is +/-32 to +/-44 stars. Refused, with
//     the reason, forever -- no sample size fixes this.
//
// Returns { count, exact, method, reason }. `exact` false means the caller
// must present it as an estimate or not at all; it never means zero.
function exactFiveStar(total, avg, items) {
  var held = items || [];
  var heldFive = held.filter(function(r) { return Number(r.rating) === 5; }).length;
  if (total === 0) return { count: 0, exact: true, method: "no reviews on the page", reason: null };
  if (total === null || total === undefined) return { count: null, exact: false, method: null, reason: "never captured" };
  if (held.length >= total) {
    return { count: heldFive, exact: true, method: "every one of the " + total + " reviews is held with its own star rating", reason: null };
  }
  var residual = total - held.length;
  if (avg === null || avg === undefined) {
    return { count: null, exact: false, method: null, reason: "no published average, so the " + residual + " unsampled review(s) cannot be pinned" };
  }
  // The star sum is pinned only when the rounding band holds one integer.
  var lo = Math.ceil((avg - 0.05) * total - 1e-9), hi = Math.floor((avg + 0.05) * total + 1e-9);
  if (lo > hi) {
    // No integer star sum rounds to this average at this review count, so the
    // two readings cannot both be current -- usually a snapshot that moved
    // after the review items were captured. Named rather than folded into the
    // ambiguous case, because this one means the INPUTS disagree.
    return { count: null, exact: false, method: null,
      reason: "no whole number of stars averages to " + avg + " across " + total + " reviews — the average and the count are from different captures" };
  }
  if (lo !== hi) {
    return { count: null, exact: false, method: null,
      reason: "the one-decimal average leaves the star sum anywhere in [" + lo + ", " + hi + "] across " + total + " reviews, so a four cannot be told from a five" };
  }
  var heldSum = held.reduce(function(a, r) { return a + (Number(r.rating) || 0); }, 0);
  var residSum = lo - heldSum;
  var deficit = 5 * residual - residSum;
  if (deficit < 0 || residSum < residual) {
    // Arithmetically impossible: the sample and the average disagree. Say so
    // rather than returning a number built on it.
    return { count: null, exact: false, method: null,
      reason: "the held reviews and the published average are inconsistent (residual of " + residual + " would need to sum to " + residSum + ")" };
  }
  if (deficit > 1) {
    return { count: null, exact: false, method: null,
      reason: "the " + residual + " unsampled review(s) are " + deficit + " stars short of perfect, which several different five-star counts satisfy" };
  }
  // deficit 0 -> every residual review is a five. deficit 1 -> exactly one four.
  return {
    count: heldFive + residual - deficit,
    exact: true,
    method: held.length + " of " + total + " held, the remaining " + residual +
      " pinned by the published average (" + (deficit === 0 ? "all five-star" : "exactly one four-star") + ")",
    reason: null,
  };
}

// The five-star counts a person entered. Separate from the snapshots on
// purpose: those are what Google reported, this is what somebody counted.
//
// If the migration has not been run, PostgREST answers PGRST205 and we say so
// by name. The alternative -- returning {} and letting the screen render zeros
// -- is exactly how `tier_celebrations` silently no-opped eight call sites for
// months (see CONTEXT 10af). An absent table is an error, never an empty month.
async function readFiveStar(period) {
  var qy = supabase.from("review_five_star").select("period,store,five_star_count,one_two_star_count,total_reviews_seen,entered_by,notes,updated_at");
  if (period) qy = qy.eq("period", period);
  var { data, error } = await qy;
  if (error) {
    var missing = String(error.code || "") === "PGRST205" || /review_five_star/.test(String(error.message || "")) && /does not exist|not find/i.test(String(error.message || ""));
    return {
      rows: null,
      missing: missing,
      error: missing
        ? "Table review_five_star does not exist. Run sql/migration_review_five_star.sql in the Supabase SQL editor; nothing can be entered or read until then."
        : error.message,
    };
  }
  return { rows: data || [], missing: false, error: null };
}

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" }, 500);
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action") || "tracking";

  // ── the tracked listings, each with its most recent reading ───────────────
  if (action === "listings") {
    var { data: lsRaw, error: lErr } = await supabase.from("google_listings").select("*").eq("active", true).order("store").order("listing_type");
    if (lErr) return json({ success: false, error: lErr.message }, 500);
    var lsDe = dedupeListings(lsRaw); var ls = lsDe.listings;
    var { data: snaps, error: sErr } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,rating,total_reviews,source").order("captured_on", { ascending: false }).limit(5000);
    if (sErr) return json({ success: false, error: sErr.message }, 500);
    var latest = {};
    (snaps || []).forEach(function(s) { if (!latest[s.listing_id]) latest[s.listing_id] = s; });
    return json({
      success: true,
      listings: (ls || []).map(function(l) { return Object.assign({}, l, { latest: latest[l.id] || null }); }),
      needs_place_id: (ls || []).filter(function(l) { return !l.place_id; }).length,
      duplicates_dropped: lsDe.duplicates_dropped,
    });
  }

  // ── what moved this month ─────────────────────────────────────────────────
  if (action === "tracking") {
    var today = indyToday(), mStart = monthStart(today);
    var { data: LRaw, error: e1 } = await supabase.from("google_listings").select("*").eq("active", true);
    if (e1) return json({ success: false, error: e1.message }, 500);
    var LDe = dedupeListings(LRaw); var L = LDe.listings;
    var { data: S, error: e2 } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,rating,total_reviews").order("captured_on", { ascending: true }).limit(20000);
    if (e2) return json({ success: false, error: e2.message }, 500);

    // Needed for the exact five-star derivation below: the per-review stars
    // Google already handed us. A failure here must not blank the whole
    // screen, so it degrades to "no exact count" rather than a 500 -- but it
    // is reported, not swallowed.
    //
    // ⚠ `action=tracking` is UNAUTHENTICATED (the TV reads this route without a
    // session). The select is therefore deliberately `listing_id,rating` and
    // nothing else -- no author, no review text, no posted_at. Anyone widening
    // it has to re-check that, or a public endpoint starts handing out
    // customers' names and words. `?action=credits` is where the full items
    // live, behind admin/manager.
    var { data: IT, error: e3 } = await supabase.from("google_review_items")
      .select("listing_id,rating").limit(20000);
    var itemsByListing = {};
    (IT || []).forEach(function(r) { (itemsByListing[r.listing_id] = itemsByListing[r.listing_id] || []).push(r); });

    var byListing = {};
    (S || []).forEach(function(s) { (byListing[s.listing_id] = byListing[s.listing_id] || []).push(s); });

    var out = (L || []).map(function(l) {
      var rows = byListing[l.id] || [];
      var newest = rows[rows.length - 1] || null;
      // The baseline is the last reading BEFORE this month began; without one
      // the gain is unknown rather than zero, and says so.
      var before = null;
      for (var i = 0; i < rows.length; i++) { if (rows[i].captured_on < mStart) before = rows[i]; }
      var gained = newest && before ? newest.total_reviews - before.total_reviews : null;
      var fsCalc = exactFiveStar(
        newest ? newest.total_reviews : null,
        newest ? newest.rating : null,
        itemsByListing[l.id] || []
      );
      return {
        id: l.id, store: l.store, listing_type: l.listing_type, label: l.label, is_ours: l.is_ours,
        has_place_id: !!l.place_id,
        // Built here, not in the browser, so one place owns the URL shape.
        // This is the free half of the review push: nine department pages
        // exist that a customer has no way to find from the store listing.
        write_review_url: l.place_id ? "https://search.google.com/local/writereview?placeid=" + encodeURIComponent(l.place_id) : null,
        maps_url: l.maps_url || null,
        rating: newest ? newest.rating : null,
        total_reviews: newest ? newest.total_reviews : null,
        captured_on: newest ? newest.captured_on : null,
        gained_this_month: gained,
        baseline_on: before ? before.captured_on : null,
        // Exact where the arithmetic forces it, refused with a reason where it
        // does not. The nine department pages all land on the exact side and
        // the three main pages never can -- see exactFiveStar.
        five_star: fsCalc.count,
        five_star_exact: fsCalc.exact,
        five_star_method: fsCalc.method,
        five_star_why_not: fsCalc.reason,
        // Honest about why a number is absent, rather than showing a zero.
        note: !newest ? "never captured" : (!before ? "no reading from before " + mStart + " yet — gain unknown until next month" : null),
      };
    });

    var stores = {};
    out.filter(function(r) { return r.is_ours && r.store; }).forEach(function(r) {
      var s = stores[r.store] || (stores[r.store] = { store: r.store, gained_this_month: null, main_rating: null, main_total: null, listings: [] });
      s.listings.push(r);
      if (r.listing_type === "main") { s.main_rating = r.rating; s.main_total = r.total_reviews; }
      if (r.gained_this_month !== null) s.gained_this_month = (s.gained_this_month || 0) + r.gained_this_month;
      // Five-star accounting per store, split by whether it is counted or
      // still owed. The tier is a store total across all four pages, so a
      // partial sum must NEVER be presented as the store's number -- the
      // screen needs to know how many pages are missing, which is what
      // five_star_pages_pending carries.
      if (r.five_star_exact) {
        s.five_star_exact_sum = (s.five_star_exact_sum || 0) + (r.five_star || 0);
        s.five_star_pages_counted = (s.five_star_pages_counted || 0) + 1;
      } else {
        s.five_star_pages_pending = (s.five_star_pages_pending || 0) + 1;
        (s.five_star_pending_pages = s.five_star_pending_pages || []).push({
          listing_type: r.listing_type, total_reviews: r.total_reviews, why_not: r.five_star_why_not,
        });
      }
    });

    // A store's tier number is only complete when every one of its pages is
    // counted. Stated as a flag so no screen has to infer it.
    Object.keys(stores).forEach(function(k) {
      var st = stores[k];
      st.five_star_exact_sum = st.five_star_exact_sum || 0;
      st.five_star_pages_counted = st.five_star_pages_counted || 0;
      st.five_star_pages_pending = st.five_star_pages_pending || 0;
      st.five_star_complete = st.five_star_pages_pending === 0;
    });

    // The five-star counts a person entered for this month, if the table is
    // there. A missing table is reported, not swallowed — the screen says the
    // migration has not been run rather than showing everyone zero five-stars.
    var fsT = await readFiveStar(mStart.slice(0, 7));

    return json({
      success: true, month_start: mStart, today: today,
      period: mStart.slice(0, 7),
      five_star_entered: fsT.rows ? (function() { var o = {}; fsT.rows.forEach(function(r) { o[r.store] = r; }); return o; })() : null,
      five_star_table_missing: fsT.missing,
      five_star_error: fsT.error,
      five_star_migration: fsT.missing ? "sql/migration_review_five_star.sql" : null,
      stores: Object.values(stores),
      competitors: out.filter(function(r) { return !r.is_ours; }),
      // Surfaced, never silent: the sync cannot run for these.
      listings_without_place_id: out.filter(function(r) { return !r.has_place_id; }).length,
      // Loud rather than silent: if this is ever non-zero the seed has been
      // re-run without the unique index.
      duplicates_dropped: LDe.duplicates_dropped,
      ever_captured: out.filter(function(r) { return r.captured_on; }).length,
      total_listings: out.length,
      // How much of the five-star count is now computed rather than typed.
      // The split is the ownership split: the franchisor's nine department
      // pages are small enough to count exactly from public data, and the
      // three main pages Eric owns are the ones that need the Business
      // Profile Reviews API. Reported so the screen states which is which.
      five_star_exact_pages: out.filter(function(r) { return r.is_ours && r.five_star_exact; }).length,
      five_star_pending_pages: out.filter(function(r) { return r.is_ours && !r.five_star_exact; }).length,
      review_items_error: e3 ? e3.message : null,
    });
  }

  // ── who gets named in reviews ──────────────────────────────────
  //
  // DELIBERATELY UNAUTHENTICATED, and deliberately thin. The TV in each shop is
  // not signed in, so this returns only what may hang on a wall: names, counts,
  // and which pages still have no reviews. No review text, no dollar amounts,
  // no payment state. `credits` keeps all of that behind admin/manager.
  //
  // Eric, 2026-10-23: "most named employee in reviews ... for the three stores,
  // and then most named employee for the particular store." The point is that
  // the bonus advertises itself on the floor instead of living in a back office.
  if (action === "review_leaders") {
    var rlPeriod = searchParams.get("period") || indyToday().slice(0, 7);

    var { data: rlLRaw, error: rlE1 } = await supabase.from("google_listings").select("id,store,listing_type,is_ours,place_id");
    if (rlE1) return json({ success: false, error: rlE1.message }, 500);
    var rlL = dedupeListings(rlLRaw).listings;
    var { data: rlItems, error: rlE2 } = await supabase.from("google_review_items")
      .select("listing_id,rating,text,posted_at,author").limit(5000);
    if (rlE2) return json({ success: false, error: rlE2.message }, 500);
    var { data: rlSnap, error: rlE3 } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,total_reviews").order("captured_on", { ascending: false }).limit(5000);
    if (rlE3) return json({ success: false, error: rlE3.message }, 500);
    var { data: rlRoster, error: rlE4 } = await supabase.from("employee_roster")
      .select("name,aliases,bonus_eligible,active").eq("active", true);
    if (rlE4) return json({ success: false, error: rlE4.message }, 500);

    var rlById = {}; (rlL || []).forEach(function(l) { rlById[l.id] = l; });
    var rlTotal = {};
    (rlSnap || []).forEach(function(sn) { if (rlTotal[sn.listing_id] === undefined) rlTotal[sn.listing_id] = sn.total_reviews; });

    // Only 5-star reviews count for anything (Eric, 2026-10-20), so the
    // leaderboard counts them and nothing else. A 4-star naming someone is not
    // a smaller credit, it is no credit.
    var company = {}, perStore = { fishers: {}, bloomington: {}, indianapolis: {} };
    var counted = 0, namedTotal = 0;
    (rlItems || []).forEach(function(it) {
      if (Number(it.rating) !== 5) return;
      counted += 1;
      var l = rlById[it.listing_id] || {};
      if (!l.is_ours) return;
      var who = creditReview(it.text, rlRoster || []);
      if (!who.length) return;
      namedTotal += 1;
      who.forEach(function(c) {
        // An ineligible person is still shown as named — the screen is about
        // recognition, and hiding Matt would make the board read as untrue.
        company[c.name] = company[c.name] || { name: c.name, count: 0, payable: c.payable };
        company[c.name].count += 1;
        if (l.store && perStore[l.store]) {
          perStore[l.store][c.name] = perStore[l.store][c.name] || { name: c.name, count: 0, payable: c.payable };
          perStore[l.store][c.name].count += 1;
        }
      });
    });

    function rank(obj) {
      return Object.keys(obj).map(function(k) { return obj[k]; })
        .sort(function(a, b) { return b.count - a.count || a.name.localeCompare(b.name); });
    }

    // Pages still waiting for their first reviews — the $20 ones. Named here so
    // the screen can point at a specific page rather than say "get reviews".
    var thin = (rlL || []).filter(function(l) {
      return l.is_ours !== false && l.listing_type !== "main" && (rlTotal[l.id] || 0) < 10;
    }).map(function(l) {
      return { store: l.store, listing_type: l.listing_type, total_reviews: rlTotal[l.id] || 0 };
    }).sort(function(a, b) { return a.total_reviews - b.total_reviews; });

    return json({
      success: true,
      period: rlPeriod,
      company: rank(company),
      by_store: {
        fishers: rank(perStore.fishers),
        bloomington: rank(perStore.bloomington),
        indianapolis: rank(perStore.indianapolis),
      },
      thin_pages: thin,
      named_bonus: { main: 10, thin: 20 },
      // Honest about the denominator: this counts the reviews Google handed us,
      // which is a relevance sample and not the full set.
      five_star_seen: counted,
      named_seen: namedTotal,
      coverage_note: "Counts the five-star reviews Google returned, which is a sample rather than every review. Leaderboard order is indicative; the Business Profile inbox is the record.",
    });
  }

  // ── captured reviews, with a PROPOSED credit for each ─────────────────
  //
  // A proposal, never a payment. Two separate reasons it cannot be the system
  // of record, both returned to the caller so the screen can say so:
  //
  // 1. COVERAGE. Places returns a RELEVANCE SAMPLE of reviews (~5 a page), not
  //    the newest and not all of them. 31 captured while the counts moved by 14
  //    in the same window. Totals are exact; this list is not complete.
  // 2. STAR COUNTS ARE NOT DERIVABLE. Eric's rule (2026-10-20) is that only 5
  //    reviews count. Places gives a total and an average rounded to one
  //    decimal, so the star-sum is uncertain by 0.05 x n -- +/-32 on Fishers
  //    main, +/-44 on Indianapolis. That cannot resolve one review, let alone
  //    separate a 4 from a 5. Exact five-star counts need the Business Profile
  //    Reviews API (owner OAuth), or a person reading the inbox.
  //
  // So the five-star figures DERIVED FROM THIS SAMPLE are labelled estimates.
  // Exact per-page counts, where the arithmetic forces them, come from
  // ?action=tracking instead -- see exactFiveStar. Nothing here computes a
  // payable amount either way.
  if (action === "credits") {
    var cGate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
    if (!cGate.authorized) return cGate.response;

    var { data: cLRaw, error: cE1 } = await supabase.from("google_listings").select("id,store,listing_type,label,is_ours,place_id");
    if (cE1) return json({ success: false, error: cE1.message }, 500);
    var cL = dedupeListings(cLRaw).listings;
    var { data: cSnap, error: cE2 } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,total_reviews").order("captured_on", { ascending: false }).limit(5000);
    if (cE2) return json({ success: false, error: cE2.message }, 500);
    var { data: cItems, error: cE3 } = await supabase.from("google_review_items")
      .select("id,listing_id,rating,author,text,has_photo,posted_at,first_seen_at").limit(5000);
    if (cE3) return json({ success: false, error: cE3.message }, 500);
    var { data: cRoster, error: cE4 } = await supabase.from("employee_roster")
      .select("name,bonus_eligible").eq("active", true);
    if (cE4) return json({ success: false, error: cE4.message }, 500);

    var lById = {}; (cL || []).forEach(function(l) { lById[l.id] = l; });
    var totalById = {};
    (cSnap || []).forEach(function(sn) { if (totalById[sn.listing_id] === undefined) totalById[sn.listing_id] = sn.total_reviews; });

    // THRESHOLD IS TOTAL REVIEWS, NOT FIVE-STAR. The premium asks whether a
    // page is established yet, which is a question about the whole page.
    var THIN_UNDER = 10, NAMED_MAIN = 10, NAMED_THIN = 20;

    var mix = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, unknown: 0 };
    var rows = (cItems || []).map(function(it) {
      var l = lById[it.listing_id] || {};
      var total = totalById[it.listing_id];
      var thin = l.listing_type !== "main" && total !== undefined && total !== null && total < THIN_UNDER;
      var r = it.rating == null ? null : Number(it.rating);
      if (r === 5 || r === 4 || r === 3 || r === 2 || r === 1) mix[r] += 1; else mix.unknown += 1;

      var credits = creditReview(it.text, cRoster || []);
      var counts = r === 5;
      return {
        id: it.id,
        store: l.store || null,
        listing_type: l.listing_type || null,
        page_total_reviews: total === undefined ? null : total,
        page_under_threshold: thin,
        rating: r,
        author: it.author || null,
        text: it.text || null,
        has_photo: !!it.has_photo,
        posted_at: it.posted_at || null,
        // Eric 2026-10-20: only 5 counts. A 4 or 3 is not a smaller credit,
        // it is no credit -- and it does not count toward the tier either.
        counts_for_tier: counts,
        why_not: counts ? null : (r == null ? "no rating captured" : r + " star — only 5 star counts"),
        proposed_credits: credits.map(function(c) {
          return {
            name: c.name,
            matched: c.matched,
            payable: c.payable,
            // 0 whenever it cannot pay, so no screen has to re-derive the rule.
            amount: (counts && c.payable) ? (thin ? NAMED_THIN : NAMED_MAIN) : 0,
            blocked: !c.payable ? "not bonus-eligible" : (!counts ? "not a 5 star review" : null),
          };
        }),
      };
    });

    var scored = mix[5] + mix[4] + mix[3] + mix[2] + mix[1];
    return json({
      success: true,
      rules: { thin_under: THIN_UNDER, named_main: NAMED_MAIN, named_thin: NAMED_THIN, only_five_star: true },
      rating_mix: mix,
      // Measured, not assumed -- and the sample it is measured on is small.
      five_star_share: scored ? mix[5] / scored : null,
      five_star_share_sample: scored,
      // Partially countable, and the split is worth stating precisely because
      // it decides how much of this is manual. Eric owns only the three main
      // listings through GBP; the nine department pages are the franchisor's.
      // Those nine are all small enough to count exactly from public data
      // (?action=tracking derives them), so the pages he CANNOT reach are the
      // ones he does not need the API for, and the three he CAN reach are the
      // only ones that need it.
      five_star_countable: "department_pages_only",
      five_star_blocker: "Exact per-page five-star counts are derived for the nine department listings (every review is held, or the unsampled remainder is pinned by the published average). The three main listings cannot be derived at any sample size: a one-decimal average leaves the star sum uncertain by 0.05 x review count, which is +/-28 to +/-45 stars at 559-892 reviews. Those three need the Business Profile Reviews API (owner OAuth on the listings Eric owns) or a person reading the Business Profile inbox.",
      text_coverage: "Places returns a relevance sample of reviews, not all of them. This list is incomplete by design; review totals are exact.",
      items: rows.sort(function(a, b) { return String(b.posted_at || "").localeCompare(String(a.posted_at || "")); }),
    });
  }

  // ── the hand-entered five-star counts ──────────────────────────
  if (action === "five_star") {
    var fGate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
    if (!fGate.authorized) return fGate.response;
    var fPeriod = searchParams.get("period") || indyToday().slice(0, 7);
    var fs = await readFiveStar(fPeriod);
    if (fs.error) return json({ success: false, error: fs.error, table_missing: fs.missing, migration: "sql/migration_review_five_star.sql" }, fs.missing ? 503 : 500);
    var byStore = {};
    fs.rows.forEach(function(r) { byStore[r.store] = r; });
    return json({ success: true, period: fPeriod, by_store: byStore, rows: fs.rows });
  }

  // ── capture today's reading ───────────────────────────────────────────────
  if (action === "sync") {
    var cronSecret = process.env.CRON_SECRET;
    var authz = request.headers.get("authorization") || "";
    if (!(cronSecret && authz === "Bearer " + cronSecret)) {
      var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
      if (!gate.authorized) return gate.response;
    }
    var key = process.env.GOOGLE_PLACES_API_KEY;
    if (!key) {
      // Loud, not silent. This is the whole lesson of June 2026.
      console.error("[google-tracking] GOOGLE_PLACES_API_KEY is not set — sync cannot run");
      return json({
        success: false,
        error: "GOOGLE_PLACES_API_KEY is not set. Create a Google Cloud API key with the Places API (New) enabled and add it to the Vercel project; nothing was written.",
      }, 503);
    }

    var { data: listingsRaw, error: lE } = await supabase.from("google_listings").select("*").eq("active", true);
    if (lE) return json({ success: false, error: lE.message }, 500);
    // Without this the sync hunts a place_id for a duplicate row and can match
    // a DIFFERENT Google page, which is exactly what happened on 2026-10-20.
    var listings = dedupeListings(listingsRaw).listings;

    var today2 = indyToday();
    var wrote = 0, resolved = 0, newReviews = 0, failures = [];
    for (var i = 0; i < (listings || []).length; i++) {
      var l = listings[i];
      try {
        if (!l.place_id) {
          // findPlaceId vets every candidate and returns only one it accepts,
          // so there is nothing left to re-check here.
          var qry = searchQueryFor(l);
          var found = await findPlaceId(l, qry, key);
          if (!found || !found.place_id) {
            failures.push({
              listing: l.label,
              error: (found && found.why) || "no Places match",
              query: qry,
              google_offered: (found && found.considered) || [],
            });
            continue;
          }
          var { error: uE } = await supabase.from("google_listings").update({ place_id: found.place_id }).eq("id", l.id);
          if (uE) { failures.push({ listing: l.label, error: "place_id not saved: " + uE.message }); continue; }
          l.place_id = found.place_id;
          resolved++;
        }
        var place = await fetchPlace(l.place_id, key);
        // fetchPlace throws on any non-200, so getting here means Google
        // answered for this place. Places then OMITS userRatingCount on a page
        // with no reviews rather than sending 0 — so an absent count is a real
        // zero, not a failure, and storing null made two live pages
        // (Bloomington electronics, Indianapolis computers — both verified on
        // Maps as our own listings with no reviews) read as "unknown" and drop
        // out of every gain calculation. rating stays null on purpose: a page
        // with no reviews has no rating, and 0 would drag any average.
        var { error: snapErr } = await supabase.from("google_review_snapshots").upsert({
          listing_id: l.id, captured_on: today2,
          rating: place.rating === undefined ? null : place.rating,
          total_reviews: place.userRatingCount === undefined ? 0 : place.userRatingCount,
          source: "places_api",
        }, { onConflict: "listing_id,captured_on" });
        if (snapErr) { failures.push({ listing: l.label, error: "snapshot: " + snapErr.message }); continue; }
        wrote++;
        if (place.googleMapsUri && !l.maps_url) await supabase.from("google_listings").update({ maps_url: place.googleMapsUri }).eq("id", l.id);

        // Places returns the handful of most recent reviews. At 10-20 a month
        // per listing a daily poll sees every one; upsert makes repeats free.
        var items = (place.reviews || []).map(function(rv) {
          return {
            listing_id: l.id,
            review_key: rv.name || (rv.publishTime + "|" + ((rv.authorAttribution && rv.authorAttribution.displayName) || "")),
            rating: rv.rating || 0,
            author: (rv.authorAttribution && rv.authorAttribution.displayName) || null,
            text: (rv.originalText && rv.originalText.text) || (rv.text && rv.text.text) || null,
            posted_at: rv.publishTime || null,
          };
        }).filter(function(x) { return x.rating > 0; });
        if (items.length) {
          var { data: ins, error: iErr } = await supabase.from("google_review_items")
            .upsert(items, { onConflict: "listing_id,review_key", ignoreDuplicates: true }).select("id");
          if (iErr) failures.push({ listing: l.label, error: "reviews: " + iErr.message });
          else newReviews += (ins || []).length;
        }
      } catch (e) {
        failures.push({ listing: l.label, error: e.message });
      }
    }
    if (failures.length) console.error("[google-tracking] sync partial failure:", JSON.stringify(failures.slice(0, 5)));
    return json({
      success: failures.length === 0,
      captured_on: today2, listings_read: wrote, place_ids_resolved: resolved,
      new_reviews_seen: newReviews, failed: failures.length, failures: failures.slice(0, 10),
    }, failures.length ? 207 : 200);
  }

  return json({ success: false, error: "Unknown action" }, 400);
}

// ── saving the hand-entered counts ──────────────────────────────────────────
// Upsert on (period, store) so a correction overwrites rather than duplicating.
// Writes nothing to any bonus ledger: this records what was counted, and the
// bonus itself is not approved or wired.
export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" }, 500);
  var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
  if (!gate.authorized) return gate.response;

  var body = null;
  try { body = await request.json(); } catch (e) { return json({ success: false, error: "Body is not JSON" }, 400); }
  var action = body && body.action;

  if (action === "save_five_star") {
    var period = String(body.period || "").trim();
    var store = String(body.store || "").trim().toLowerCase();
    if (!/^\d{4}-\d{2}$/.test(period)) return json({ success: false, error: "period must be YYYY-MM" }, 400);
    if (["fishers", "bloomington", "indianapolis"].indexOf(store) < 0) return json({ success: false, error: "unknown store: " + store }, 400);

    function nonNeg(v, name) {
      if (v === null || v === undefined || v === "") return null;
      var n = Number(v);
      if (!isFinite(n) || n < 0 || Math.floor(n) !== n) throw new Error(name + " must be a whole number of 0 or more");
      return n;
    }
    var five, bad, seen;
    try {
      five = nonNeg(body.five_star_count, "five_star_count");
      bad = nonNeg(body.one_two_star_count, "one_two_star_count");
      seen = nonNeg(body.total_reviews_seen, "total_reviews_seen");
    } catch (e) { return json({ success: false, error: String(e.message) }, 400); }
    if (five === null) return json({ success: false, error: "five_star_count is required" }, 400);

    var row = {
      period: period, store: store,
      five_star_count: five,
      one_two_star_count: bad === null ? 0 : bad,
      total_reviews_seen: seen,
      // requireAuth returns { authorized, result, response } — the person is on
      // `result`, not on the gate itself. Reading gate.user would have stored null.
      entered_by: (function() { var w = gate.result || {}; return w.name || w.email || null; })(),
      notes: body.notes ? String(body.notes).slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    };
    var { data, error } = await supabase.from("review_five_star")
      .upsert(row, { onConflict: "period,store" }).select();
    if (error) {
      var missing = String(error.code || "") === "PGRST205";
      // Loud: a write that cannot land must never answer 200.
      console.error("[google-tracking] save_five_star failed:", error.message);
      return json({
        success: false,
        error: missing
          ? "Table review_five_star does not exist. Run sql/migration_review_five_star.sql in the Supabase SQL editor; nothing was saved."
          : error.message,
        table_missing: missing,
        migration: missing ? "sql/migration_review_five_star.sql" : null,
      }, missing ? 503 : 500);
    }
    return json({ success: true, saved: (data && data[0]) || row });
  }

  return json({ success: false, error: "Unknown action: " + String(action) }, 400);
}

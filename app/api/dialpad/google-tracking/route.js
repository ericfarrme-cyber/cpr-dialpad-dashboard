// Google review tracking — the listings, what they read today, and what moved.
//
// Separate from `google-reviews`, which is the hand-entered monthly sheet and
// stays as it is. This one is the automated half.
//
// WHY A SEPARATE SHAPE: `google_reviews` counts reviews RECEIVED in a month,
// keyed (period, store), with no listing dimension. Eric's bonus needs the
// console listing separated from the repair listing, which a monthly total
// cannot answer. See sql/migration_google_listings.sql.
//
// THE RULE IS DELIBERATELY SIMPLE (Eric, 2026-10-30: "it just needs to flag if
// it notices that there's a 1-star and then everything else we just count as a
// review"). Every review counts toward the store tier, and a 1-star raises a
// FLAG for a person to look at -- it does not dock anybody automatically. That
// replaces the earlier five-star-only rule, which was not computable from this
// data source at all: Places sends a total and a one-decimal average, never a
// star histogram. Counting every review makes the tier EXACT, because the
// total is the one figure Google gives us exactly.
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
// GET  ?action=sync       capture today's reading for every listing (cron/admin)
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { placeLooksLikeOurs, searchQueryFor } from "@/lib/place-match";
import { creditReview } from "@/lib/review-credit";

export const dynamic = "force-dynamic";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(d, s) { return NextResponse.json(d, { status: s || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

// Indiana-local day, so "today" rolls when the stores' day does.
function indyToday() {
  var d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function monthStart(ymd) { return ymd.slice(0, 8) + "01"; }

// The store review tier. ONE definition -- ReviewsTab had a second copy of
// this table, which is how two screens come to disagree about what a store
// earned. Eric set the floor at 10 (2026-10-19) after rejecting 6.
//
// Counts EVERY review in the month, across that store's four pages. Highest
// tier only, per eligible person. Nothing in this route pays it: the bonus is
// not approved, and `payable` is false on every row that mentions money.
var TIERS = [{ at: 10, pays: 50 }, { at: 15, pays: 75 }, { at: 20, pays: 100 }];
function tierFor(n) {
  if (n === null || n === undefined) return null;
  var hit = null;
  TIERS.forEach(function(t) { if (n >= t.at) hit = t; });
  return hit;
}

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
// This incompleteness is the reason the rule is a flag rather than a deduction.
// An automatic halving would pay differently depending on whether Google chose
// to sample the review, which is not a rule anyone could explain to staff.
function oneStarWatch(total, items) {
  var held = items || [];
  var ones = held.filter(function(r) { return Number(r.rating) === 1; });
  var complete = total !== null && total !== undefined && held.length >= total;
  return {
    one_star_seen: ones.length,
    reviews_held: held.length,
    // True only when we hold the page's whole review set, so no screen has to
    // work out whether "0 one-star" means clean or merely unseen.
    flag_certain: complete,
    flag_note: complete
      ? null
      : "Google samples about five reviews a page; a 1-star outside that sample is not visible here. Matt's Business Profile inbox is the complete list.",
  };
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

    // The per-review stars Google already handed us, for the 1-star flag. A
    // failure here must not blank the whole screen, so it degrades to "flag
    // unknown" rather than a 500 -- but it is reported, not swallowed, and a
    // failed read must never render as "no 1-star reviews".
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
      // A review count cannot go below zero, so a reading of 0 taken INSIDE the
      // month proves the page held 0 on the first of it. That recovers a gain
      // for a page we only started tracking mid-month, without inventing a
      // snapshot: the baseline is deduced, not written to the table.
      //
      // Narrow on purpose. It fires only on an actual zero reading -- the nine
      // department pages went untracked until 2026-10-18, and for the seven
      // that already had a review on that date the month's gain is genuinely
      // unknowable and stays null. Today this recovers exactly two pages
      // (Bloomington electronics, Indianapolis computers), both at 0.
      var zeroBasis = null;
      if (gained === null && newest) {
        for (var z = 0; z < rows.length; z++) {
          if (rows[z].captured_on >= mStart && rows[z].total_reviews === 0) { zeroBasis = rows[z]; break; }
        }
        if (zeroBasis) gained = newest.total_reviews;
      }
      var watch = oneStarWatch(newest ? newest.total_reviews : null, itemsByListing[l.id] || []);
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
        baseline_on: before ? before.captured_on : (zeroBasis ? zeroBasis.captured_on : null),
        // Stated so a screen never has to guess whether a figure was measured
        // against a real prior reading or deduced from an in-month zero.
        baseline_deduced: !!zeroBasis,
        // The flag, plus whether it can be trusted to be complete on this
        // page. See oneStarWatch: certain on a page we hold in full, only a
        // sample on a main page.
        one_star_seen: watch.one_star_seen,
        flag_certain: watch.flag_certain,
        flag_note: watch.flag_note,
        reviews_held: watch.reviews_held,
        // Honest about why a number is absent, rather than showing a zero.
        note: !newest ? "never captured"
          : zeroBasis ? "no reading from before " + mStart + ", but this page read 0 on " + zeroBasis.captured_on + " — so it held 0 on the 1st and the gain is exact"
          : (!before ? "no reading from before " + mStart + " yet — gain unknown until next month" : null),
      };
    });

    var stores = {};
    out.filter(function(r) { return r.is_ours && r.store; }).forEach(function(r) {
      var s = stores[r.store] || (stores[r.store] = { store: r.store, gained_this_month: null, main_rating: null, main_total: null, listings: [] });
      s.listings.push(r);
      if (r.listing_type === "main") { s.main_rating = r.rating; s.main_total = r.total_reviews; }
      if (r.gained_this_month !== null) s.gained_this_month = (s.gained_this_month || 0) + r.gained_this_month;
      // A page with no pre-month baseline makes the store's gain INCOMPLETE,
      // not wrong. A tier must never be read off a partial sum, so the count
      // of such pages travels with it rather than being inferred downstream.
      if (r.gained_this_month === null) {
        s.pages_without_baseline = (s.pages_without_baseline || 0) + 1;
        (s.baseline_missing_pages = s.baseline_missing_pages || []).push(r.listing_type);
      }
      s.one_star_seen = (s.one_star_seen || 0) + r.one_star_seen;
      if (!r.flag_certain) s.flag_pages_sampled = (s.flag_pages_sampled || 0) + 1;
    });

    // The tier, computed -- which is the whole point of the simpler rule. The
    // review total is the one figure Places gives us exactly, so a tier read
    // off it needs no entry box, no estimate label and no second API.
    Object.keys(stores).forEach(function(k) {
      var st = stores[k];
      st.pages_without_baseline = st.pages_without_baseline || 0;
      st.one_star_seen = st.one_star_seen || 0;
      st.flag_pages_sampled = st.flag_pages_sampled || 0;
      st.gain_complete = st.pages_without_baseline === 0 && st.gained_this_month !== null;
      var t = tierFor(st.gained_this_month);
      st.tier_at = t ? t.at : null;
      st.tier_pays = t ? t.pays : 0;
      // Stated on the payload, not only in the UI: nothing here is approved to pay.
      st.payable = false;
    });

    return json({
      success: true, month_start: mStart, today: today,
      period: mStart.slice(0, 7),
      tiers: TIERS,
      floor: TIERS[0].at,
      stores: Object.values(stores),
      competitors: out.filter(function(r) { return !r.is_ours; }),
      // Surfaced, never silent: the sync cannot run for these.
      listings_without_place_id: out.filter(function(r) { return !r.has_place_id; }).length,
      // Loud rather than silent: if this is ever non-zero the seed has been
      // re-run without the unique index.
      duplicates_dropped: LDe.duplicates_dropped,
      ever_captured: out.filter(function(r) { return r.captured_on; }).length,
      total_listings: out.length,
      // How complete the 1-star flag is, page by page: certain on the pages we
      // hold in full, a sample on the three main pages. Reported so a screen
      // can say which, rather than letting a zero read as "clean".
      flag_certain_pages: out.filter(function(r) { return r.is_ours && r.flag_certain; }).length,
      flag_sampled_pages: out.filter(function(r) { return r.is_ours && !r.flag_certain; }).length,
      // A failed items read means the flag is UNKNOWN, not that there are no
      // 1-star reviews. Surfaced either way.
      review_items_error: e3 ? e3.message : null,
      flag_unavailable: !!e3,
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

    // Every review counts (Eric, 2026-10-30). The single exception is a 1-star,
    // which credits nobody -- being named in a complaint is not recognition.
    // Note this board therefore shows MORE names than it did under the
    // five-star-only rule, which is the intended effect.
    var company = {}, perStore = { fishers: {}, bloomington: {}, indianapolis: {} };
    var counted = 0, namedTotal = 0;
    (rlItems || []).forEach(function(it) {
      if (Number(it.rating) === 1) return;
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
      reviews_seen: counted,
      named_seen: namedTotal,
      coverage_note: "Counts the reviews Google returned, which is a sample rather than every review. Leaderboard order is indicative; the Business Profile inbox is the record.",
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
  // 2. A 1-STAR OUTSIDE THE SAMPLE IS INVISIBLE here, so the flag this returns
  //    is "what we can see", never "the page is clean". See oneStarWatch.
  //
  // Every review counts toward the store tier (Eric, 2026-10-30), so nothing
  // here has to derive a star breakdown -- the tier comes from the exact
  // totals in ?action=tracking. The only star test left is the narrow one: a
  // 1-star review does not earn its named employee a bonus. Nothing here
  // computes a payable amount.
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
      // Every review counts as a review. The one exception is the obvious
      // one: a 1-star does not pay the person it names, and it raises a flag
      // instead. A 2, 3 or 4 star counts and pays -- Eric, 2026-10-30, after
      // the five-star-only rule turned out not to be computable at all.
      var counts = r !== 1;
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
        counts_for_tier: counts,
        flagged: r === 1,
        why_not: counts ? null : "1 star — flagged for a person to look at, and it pays nobody",
        proposed_credits: credits.map(function(c) {
          return {
            name: c.name,
            matched: c.matched,
            payable: c.payable,
            // 0 whenever it cannot pay, so no screen has to re-derive the rule.
            amount: (counts && c.payable) ? (thin ? NAMED_THIN : NAMED_MAIN) : 0,
            blocked: !c.payable ? "not bonus-eligible" : (!counts ? "1 star review" : null),
          };
        }),
      };
    });

    var scored = mix[5] + mix[4] + mix[3] + mix[2] + mix[1];
    return json({
      success: true,
      rules: { thin_under: THIN_UNDER, named_main: NAMED_MAIN, named_thin: NAMED_THIN, every_review_counts: true, one_star_pays_nobody: true },
      rating_mix: mix,
      rating_mix_sample: scored,
      // The flag, over the sample we hold. NOT a count of the month's 1-star
      // reviews -- a main page shows us about five of its several hundred, so
      // zero here means "none seen", never "none happened".
      one_star_seen: mix[1],
      one_star_coverage: "Places returns a relevance sample of reviews, not all of them. A 1-star outside that sample does not appear here. Review TOTALS are exact; this list is not complete.",
      text_coverage: "Places returns a relevance sample of reviews, not all of them. This list is incomplete by design; review totals are exact.",
      items: rows.sort(function(a, b) { return String(b.posted_at || "").localeCompare(String(a.posted_at || "")); }),
    });
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

// NO POST HANDLER, deliberately. The only write this route ever had was
// save_five_star, the hand-entered five-star count. The tier is now computed
// from the review totals Google reports exactly, so there is nothing to type
// and nothing to keep in sync with what Google says. A stale client that still
// POSTs here gets a 405 from Next, which is the loud answer -- it used to get a
// 200 for a number nobody needs. `review_five_star` is left in the database,
// empty and unread; dropping a table is Eric's call, not a side effect of this.

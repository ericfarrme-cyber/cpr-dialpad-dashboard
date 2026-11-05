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
// THE RULE (Eric, 2026-10-30, in two steps). First: "everything else we just
// count as a review" -- every review counts toward the store tier, which makes
// the tier EXACT because the lifetime total is the one figure Google reports
// exactly. That replaced a five-star-only rule this data source could not
// measure at all. Then: "It should be a deduction. A 1 star should cut a
// bonus." So a 1-star HALVES the store's tier for the month and a second
// ZEROES it.
//
// ⚠ A DEDUCTION NEEDS EVIDENCE, which is the one thing that makes this rule
// honest. Places shows us about five reviews of a main page's several hundred,
// so "no 1-star seen" is not proof there was none. A penalty that fired only
// when Google happened to sample the review would be arbitrary; a penalty that
// fired on a page we cannot see at all would be a guess. So the deduction
// applies to a 1-star we can POINT AT -- captured by the sync, or recorded by a
// manager from the Business Profile inbox (`record_one_star`) -- and a review
// nobody has seen does not dock anyone. The gap therefore errs toward the
// employee, which is the same direction as the forward-only answer-rate rule:
// never take money back on a number we cannot stand behind.
//
// The count is NOT also reduced by the 1-star. One lever, not two -- see
// PENALTY below for why.
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
// GET  ?action=credits&period=YYYY-MM  named credits for ONE month (+ a month index)
// GET  ?action=review_leaders  who gets named THIS MONTH (+ all time), counts only — safe for the TV
// GET  ?action=ask_pages&name=  which of our pages this tech should ask on
// GET  ?action=my_reviews&name=  one person's own review credits (any role)
// GET  ?action=sync       capture today's reading for every listing (cron/admin)
// GET  ?action=sync_owned EVERY review on the pages we own, via Business Profile OAuth (admin)
//                         &dry_run=1 reports what it would write without writing
// POST {action:'record_review'|'record_one_star', store, listing_type, posted_at, rating?, author?, review_text?, note?}  (admin/manager)
// POST {action:'remove_review'|'remove_one_star', id}   undo a manual record only (admin/manager)
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { placeLooksLikeOurs, searchQueryFor } from "@/lib/place-match";
import { creditReview } from "@/lib/review-credit";
import { normalizeReview, reconcile, sweepStatus } from "@/lib/gbp-reviews";
import { buildResolver, resolveNamePersonish, isSystemActor } from "@/lib/roster-resolver";

export const dynamic = "force-dynamic";

import {
  indyToday, monthStart, TIERS, tierFor,
  THIN_UNDER, NAMED_MAIN, NAMED_THIN,
  SPLIT_NAMED_CREDIT, NAMED_CREDIT_NEEDS_STORE_FLOOR,
  storeGainsByMonth, storeFloorState, creditRowsFor,
  PENALTY_AT_OR_BELOW, PENALTY_STEPS, penaltyFactor,
  dedupeListings, oneStarWatch,
} from "@/lib/review-bonus";


function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(d, s) { return NextResponse.json(d, { status: s || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

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


// ── Business Profile (owned pages): every review, not a sample ───────
// Places gives ~5 reviews of a page however large it is, which is 1.6% of
// Bloomington main and 0.7% of Indianapolis (measured 2026-11-05). The
// Business Profile API returns all of them, 50 to a page, for locations the
// signed-in account owns or manages — the three main pages (§ 10ao), which
// are exactly the ones Places cannot cover.
//
// It authenticates as the OWNER over OAuth, not with an API key, so it needs
// a one-time consent and a stored refresh token. All three variables must be
// present or the action refuses loudly and writes nothing.
//
// ⚠ Reviews were never migrated off the legacy v4 host; accounts and
// locations live on the newer v1 hosts. That split is Google's, not a typo.
var GBP_TOKEN_URL = "https://oauth2.googleapis.com/token";
var GBP_ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
var GBP_INFO_HOST = "https://mybusinessbusinessinformation.googleapis.com/v1";
var GBP_V4_HOST = "https://mybusiness.googleapis.com/v4";

function gbpCreds() {
  return {
    client_id: process.env.GBP_CLIENT_ID,
    client_secret: process.env.GBP_CLIENT_SECRET,
    refresh_token: process.env.GBP_REFRESH_TOKEN,
  };
}

async function gbpAccessToken(c) {
  var body = new URLSearchParams({
    client_id: c.client_id, client_secret: c.client_secret,
    refresh_token: c.refresh_token, grant_type: "refresh_token",
  });
  var res = await fetch(GBP_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body,
  });
  var txt = await res.text();
  if (!res.ok) throw new Error("GBP token exchange " + res.status + ": " + txt.slice(0, 300));
  var j = JSON.parse(txt);
  if (!j.access_token) throw new Error("GBP token exchange returned no access_token");
  return j.access_token;
}

async function gbpGet(url, token) {
  var res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  var txt = await res.text();
  // Loud on every non-200. A 403 here usually means the project has not been
  // granted Business Profile API access yet, which is a thing a person has to
  // apply for — so the message has to survive into the response.
  if (!res.ok) throw new Error(res.status + " " + url.replace(/\?.*$/, "") + ": " + txt.slice(0, 300));
  try { return JSON.parse(txt); } catch (e) { throw new Error("Non-JSON from " + url + ": " + txt.slice(0, 200)); }
}

// Every location the account can see, keyed by its Google placeId, so our
// listings join on the id they already carry and nothing new is stored.
async function gbpLocationsByPlaceId(token) {
  var out = {}, accounts = [], pageToken = "";
  do {
    var aj = await gbpGet(GBP_ACCOUNTS_URL + "?pageSize=20" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""), token);
    (aj.accounts || []).forEach(function(a) { accounts.push(a.name); });
    pageToken = aj.nextPageToken || "";
  } while (pageToken);

  for (var i = 0; i < accounts.length; i++) {
    var lt = "";
    do {
      var url = GBP_INFO_HOST + "/" + accounts[i] + "/locations?readMask=name,title,metadata&pageSize=100" +
        (lt ? "&pageToken=" + encodeURIComponent(lt) : "");
      var lj = await gbpGet(url, token);
      (lj.locations || []).forEach(function(loc) {
        var pid = loc.metadata && loc.metadata.placeId;
        if (pid) out[pid] = { account: accounts[i], location: loc.name, title: loc.title };
      });
      lt = lj.nextPageToken || "";
    } while (lt);
  }
  return { byPlaceId: out, accounts: accounts };
}

// Walk every page of one location's reviews.
async function gbpAllReviews(account, location, token) {
  var all = [], pageToken = "", pages = 0, total = null;
  do {
    var url = GBP_V4_HOST + "/" + account + "/" + location + "/reviews?pageSize=50" +
      (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    var j = await gbpGet(url, token);
    pages++;
    if (j.totalReviewCount !== undefined) total = j.totalReviewCount;
    (j.reviews || []).forEach(function(r) { all.push(r); });
    pageToken = j.nextPageToken || "";
    // A page cap that cannot loop forever on a malformed token.
    if (pages > 200) break;
  } while (pageToken);
  return { reviews: all, pages: pages, total: total };
}


// ── which page should a tech ask for a review on? ───────────────────
// The free half of the review push, and it deliberately does not wait on the
// bonus: nine department pages exist that a customer has no way to find from
// the store listing, and a console job is the one moment somebody is holding a
// console and pleased about it. Precedent that a dashboard nudge alone moves
// behaviour: warranty mentions went 12.4% -> 24.2% after the free-closers
// strip, with no money attached (z=3.77, p<0.001).
//
// An EXPLICIT allowlist, never a prefix match, and an unmapped category is
// counted and shown rather than silently dropped -- the rule open item 11 asks
// for. Measured over 2,456 tickets since 2026-08-01: phone 1376, (null) 624,
// game_console 180, laptop 152, tablet 88, other 21, computer 12, watch 3.
// ⚠ The 624 nulls are a quarter of all tickets and are NOT evidence of
// anything; they are the category gap in open item 11 showing through here.
var ASK_BUCKET = {
  game_console: "consoles", console: "consoles", consoles: "consoles",
  laptop: "computers", computer: "computers", computers: "computers", desktop: "computers",
  // A tablet or a watch is not a phone and not a computer; "Electronics at CPR"
  // is the page that exists for it. Judgement, not measurement -- and the cost
  // of being wrong is a review on a neighbouring page of ours, not a loss.
  tablet: "electronics", watch: "electronics", other: "electronics",
  phone: "main",
};
function askBucket(cat) {
  var k = String(cat || "").trim().toLowerCase();
  if (!k) return null;
  return ASK_BUCKET[k] || null;
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
    var today = indyToday();
    // ⚠ THIS USED TO BE THE RUNNING MONTH AND NOTHING ELSE, which made every
    // screen that has a month picker lie. Found by opening the page (2026-11-03):
    // My Performance set to October showed "YOUR STORE'S REVIEW BONUS · 2026-10"
    // above **November's** review count, because the card took its heading from
    // the selected period and its numbers from here. The Reviews tab had the
    // same split -- store cards from this action, credit queue scoped by its own
    // picker. A tier figure under the wrong month's heading is the § 10au
    // defect on a screen that proposes money.
    //
    // `period` is OPTIONAL and defaults to today's month, so the TV board and
    // every existing caller are unchanged.
    var pReq = (searchParams.get("period") || "").trim();
    var mStart = /^\d{4}-\d{2}$/.test(pReq) ? pReq + "-01" : monthStart(today);
    // Exclusive upper bound for the month, so a 1-star is scored against the
    // month it was posted in and no other.
    var mEnd = (function() {
      var y = Number(mStart.slice(0, 4)), m = Number(mStart.slice(5, 7));
      return (m === 12 ? (y + 1) + "-01" : y + "-" + String(m + 1).padStart(2, "0")) + "-01";
    })();
    // A closed month is read AS IT STOOD at the end of it. Today's totals under
    // a past month's heading would be the same lie in a smaller place.
    var isPast = mEnd <= today;
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
    // session), so this select is kept to the four columns the deduction
    // actually needs and NO author and NO review text. `rating` and
    // `posted_at` are what scope a 1-star to its month; `review_key` tells a
    // manager-recorded 1-star from a synced one (the `manual:` prefix) and is
    // an opaque Google id otherwise. None of the four identifies a customer.
    // Anyone widening this further has to re-check that, or a public endpoint
    // starts handing out customers' names and words. `?action=credits` is
    // where the full items live, behind admin/manager.
    var { data: IT, error: e3 } = await supabase.from("google_review_items")
      .select("listing_id,rating,review_key,posted_at").limit(20000);
    var itemsByListing = {};
    (IT || []).forEach(function(r) { (itemsByListing[r.listing_id] = itemsByListing[r.listing_id] || []).push(r); });

    var byListing = {};
    (S || []).forEach(function(s) { (byListing[s.listing_id] = byListing[s.listing_id] || []).push(s); });

    var out = (L || []).map(function(l) {
      var rows = byListing[l.id] || [];
      // The last reading inside the window, not the last reading full stop.
      // For the running month those are the same row.
      var newest = null;
      for (var n = 0; n < rows.length; n++) { if (rows[n].captured_on < mEnd) newest = rows[n]; }
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
      var watch = oneStarWatch(newest ? newest.total_reviews : null, itemsByListing[l.id] || [], mStart, mEnd);
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
        one_star_this_month: watch.one_star_this_month,
        one_star_all_time: watch.one_star_all_time,
        one_star_undated: watch.one_star_undated,
        manual_one_star: watch.manual_one_star,
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
      s.one_star_this_month = (s.one_star_this_month || 0) + r.one_star_this_month;
      s.one_star_all_time = (s.one_star_all_time || 0) + r.one_star_all_time;
      s.one_star_undated = (s.one_star_undated || 0) + r.one_star_undated;
      s.manual_one_star = (s.manual_one_star || 0) + (r.manual_one_star || 0);
      if (!r.flag_certain) s.flag_pages_sampled = (s.flag_pages_sampled || 0) + 1;
    });

    // The tier, computed -- which is the whole point of the simpler rule. The
    // review total is the one figure Places gives us exactly, so a tier read
    // off it needs no entry box, no estimate label and no second API.
    Object.keys(stores).forEach(function(k) {
      var st = stores[k];
      st.pages_without_baseline = st.pages_without_baseline || 0;
      st.flag_pages_sampled = st.flag_pages_sampled || 0;
      st.gain_complete = st.pages_without_baseline === 0 && st.gained_this_month !== null;
      var t = tierFor(st.gained_this_month);
      st.tier_at = t ? t.at : null;
      // BOTH figures travel, always. A screen that only had the final number
      // could not tell a store that missed the threshold from one that reached
      // it and was docked -- which is the difference between "get more
      // reviews" and "we took a one-star", two completely different
      // conversations with a store manager.
      st.tier_pays_before_penalty = t ? t.pays : 0;
      st.one_star_this_month = st.one_star_this_month || 0;
      st.one_star_all_time = st.one_star_all_time || 0;
      st.one_star_undated = st.one_star_undated || 0;
      st.penalty_factor = penaltyFactor(st.one_star_this_month);
      st.tier_pays = Math.round((st.tier_pays_before_penalty * st.penalty_factor) * 100) / 100;
      st.penalty_docked = Math.round((st.tier_pays_before_penalty - st.tier_pays) * 100) / 100;
      // ⚠ APPLIED means money actually moved. A store with a 1-star that never
      // reached the threshold has nothing to halve, and a card that said "tier
      // halved" there would be stating something untrue -- it read exactly
      // that way on Bloomington before this split (1 one-star, 7 reviews, no
      // tier). `penalty_pending` is the honest version of that state: the
      // deduction is on the books and will bite if they reach the floor.
      st.penalty_applied = st.penalty_factor < 1 && st.tier_pays_before_penalty > 0;
      st.penalty_pending = st.penalty_factor < 1 && st.tier_pays_before_penalty === 0;
      st.penalty_reason = st.penalty_applied
        ? (st.one_star_this_month === 1 ? "one 1-star this month — tier halved"
           : st.one_star_this_month + " 1-star reviews this month — tier zeroed")
        : (st.penalty_pending
            ? st.one_star_this_month + " 1-star this month, but no tier reached — nothing to halve yet"
            : null);
      // Stated on the payload, not only in the UI: nothing here is approved to pay.
      st.payable = false;
    });

    return json({
      success: true, month_start: mStart, today: today,
      period: mStart.slice(0, 7),
      // Stated, so a screen can never put this payload under another month's
      // heading without noticing.
      is_past_month: isPast,
      requested_period: pReq || null,
      tiers: TIERS,
      floor: TIERS[0].at,
      penalty: {
        at_or_below: PENALTY_AT_OR_BELOW,
        steps: PENALTY_STEPS,
        counts_toward_threshold: true,
        scoped_to_month: true,
        named_credits_survive: true,
        evidence_only: true,
        note: "A 1-star halves the store's tier and a second zeroes it, scored against the month it was POSTED in. It still counts as a review toward the threshold -- one lever, not two. The deduction applies only to a 1-star we can point at: captured by the sync, or recorded by a manager from the Business Profile inbox.",
      },
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
    //
    // ⚠ SCOPED TO THE MONTH THE REVIEW WAS POSTED, and both windows travel.
    // This action took a `period` parameter, echoed it back and never filtered
    // on anything, so the board was an ALL-TIME tally sitting directly beside a
    // month-to-date "Reviews this month" tile on the same screen. Measured on
    // the 44 captured reviews the day Eric asked (2026-11-02): Samuel Tomey
    // ranked SECOND company-wide on 3 credits whose most recent is JUNE, and
    // Aerick's 5 span March to September — while October's actual named
    // reviews were Andrew x2 and Alec x1, every one of them Bloomington. The
    // Fishers panel hanging in Fishers named nobody who had earned anything
    // that month.
    //
    // The named bonus pays per month, so the month leads. All-time is kept
    // because a month is a small number and the first days of one are empty:
    // the screen falls back to it and SAYS which window it is showing.
    var company = {}, perStore = { fishers: {}, bloomington: {}, indianapolis: {} };
    var companyAll = {}, perStoreAll = { fishers: {}, bloomington: {}, indianapolis: {} };
    var counted = 0, namedTotal = 0, countedMonth = 0, namedMonth = 0, namedUndated = 0;

    // An ineligible person is still shown as named — the screen is about
    // recognition, and hiding Matt would make the board read as untrue.
    function bump(bucket, store, c, storeBuckets) {
      bucket[c.name] = bucket[c.name] || { name: c.name, count: 0, payable: c.payable };
      bucket[c.name].count += 1;
      if (store && storeBuckets[store]) {
        storeBuckets[store][c.name] = storeBuckets[store][c.name] || { name: c.name, count: 0, payable: c.payable };
        storeBuckets[store][c.name].count += 1;
      }
    }

    (rlItems || []).forEach(function(it) {
      if (Number(it.rating) === 1) return;
      var l = rlById[it.listing_id] || {};
      // Count OUR pages only. Carmel is tracked in this table as a competitor,
      // and the pre-existing `counted` was incremented before this check, so
      // `reviews_seen` had been quietly including their reviews. Harmless while
      // nothing read it; not harmless once a per-month version exists for a
      // screen to show.
      if (!l.is_ours) return;
      counted += 1;
      var ym = it.posted_at ? String(it.posted_at).slice(0, 7) : null;
      var inMonth = ym === rlPeriod;
      if (inMonth) countedMonth += 1;
      var who = creditReview(it.text, rlRoster || []);
      if (!who.length) return;
      namedTotal += 1;
      if (inMonth) namedMonth += 1;
      // A credit with no date cannot be assigned to a month, so it counts
      // all-time only and is reported rather than quietly folded into now.
      if (!ym) namedUndated += 1;
      who.forEach(function(c) {
        bump(companyAll, l.store, c, perStoreAll);
        if (inMonth) bump(company, l.store, c, perStore);
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
      // `company` / `by_store` are THIS MONTH. The all_time pair is the same
      // shape so a screen can fall back to it without reshaping anything —
      // and must label which window it drew.
      company: rank(company),
      by_store: {
        fishers: rank(perStore.fishers),
        bloomington: rank(perStore.bloomington),
        indianapolis: rank(perStore.indianapolis),
      },
      company_all_time: rank(companyAll),
      by_store_all_time: {
        fishers: rank(perStoreAll.fishers),
        bloomington: rank(perStoreAll.bloomington),
        indianapolis: rank(perStoreAll.indianapolis),
      },
      // The page totals ARE lifetime on purpose: the $20 premium asks whether
      // a page is established yet, which is a question about the whole page.
      thin_pages: thin,
      thin_pages_window: "all time",
      named_bonus: { main: 10, thin: 20 },
      // Honest about the denominator: this counts the reviews Google handed us,
      // which is a relevance sample and not the full set.
      reviews_seen: counted,
      named_seen: namedTotal,
      reviews_seen_this_month: countedMonth,
      named_seen_this_month: namedMonth,
      named_undated: namedUndated,
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
  // ── the pages THIS person should be asking on ───────────────────
  // Reads: the work they actually closed, and which of our pages is still thin
  // enough to be worth the larger named amount. Counts and links only -- it
  // proposes nothing and pays nothing.
  if (action === "ask_pages") {
    var apGate = await requireAuth(request, {});
    if (!apGate.authorized) return apGate.response;

    var apName = (searchParams.get("name") || "").trim();
    if (!apName) return json({ success: false, error: "name is required" }, 400);
    var apDays = Math.max(7, Math.min(90, Number(searchParams.get("days") || 30) || 30));

    var apToday = indyToday(), apMonth = monthStart(apToday);
    var cut = new Date(apToday + "T00:00:00Z");
    cut.setUTCDate(cut.getUTCDate() - apDays);
    var apFrom = cut.toISOString().slice(0, 10);

    var { data: apRoster, error: apRE } = await supabase.from("employee_roster").select("name,aliases,store,active");
    if (apRE) return json({ success: false, error: apRE.message }, 500);
    var apMap = buildResolver(apRoster || []).map;
    // Resolve the REQUESTED name the same way as the ticket names, so "Sam
    // Tomey" asking about his pages gets Samuel Tomey's tickets.
    var apWho = resolveNamePersonish(apName, apMap) || apName;

    // Paginated and ordered -- an unordered .range() returns overlapping pages
    // (CONTEXT, the 109/63/93 instability).
    var apRows = [], apScanned = 0;
    for (var apOff = 0; ; apOff += 1000) {
      var apRes = await supabase.from("ticket_grades")
        .select("ticket_number,store,device_category,date_closed,employee_added,employee_repaired")
        .gte("date_closed", apFrom).lte("date_closed", apToday)
        .order("ticket_number", { ascending: true })
        .range(apOff, apOff + 999);
      if (apRes.error) return json({ success: false, error: apRes.error.message }, 500);
      var apBatch = apRes.data || [];
      apScanned += apBatch.length;
      apBatch.forEach(function(t) {
        if (isSystemActor(t.employee_repaired) && isSystemActor(t.employee_added)) return;
        // employee_repaired first: the insurance tickets RepairQ opens as
        // "API, Assurant ServiceNetwork" are real work by a real technician
        // (CONTEXT 10an), and this is a prompt to the person who did it.
        var raw = t.employee_repaired || t.employee_added;
        if (resolveNamePersonish(raw, apMap) !== apWho) return;
        apRows.push(t);
      });
      if (apBatch.length < 1000) break;
    }

    // The main page is counted like any other. It was dropped in the first cut
    // on the theory that only the department pages need help -- but phone work
    // is about 60% of every tech's tickets, and the store TIER counts every
    // review across all four pages, so a phone review pays the store exactly
    // as much as a console one. Main pages carry 559-892 reviews, so they are
    // never "thin" and the sort below already puts them last. No special case.
    var apCounts = {}, apUncat = 0, apPhone = 0;
    apRows.forEach(function(t) {
      var b = askBucket(t.device_category);
      if (!b) { apUncat += 1; return; }
      var st = String(t.store || "").toLowerCase();
      if (!st) { apUncat += 1; return; }
      if (b === "main") apPhone += 1;
      var k = st + "|" + b;
      apCounts[k] = (apCounts[k] || 0) + 1;
    });

    var { data: apLRaw, error: apLE } = await supabase.from("google_listings")
      .select("id,store,listing_type,label,is_ours,place_id,maps_url").eq("active", true);
    if (apLE) return json({ success: false, error: apLE.message }, 500);
    var apLDe = dedupeListings(apLRaw);
    var apL = (apLDe.listings || []).filter(function(l) { return l.is_ours !== false; });

    var { data: apSnap, error: apSE } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,total_reviews").order("captured_on", { ascending: false }).limit(5000);
    if (apSE) return json({ success: false, error: apSE.message }, 500);
    var apTotal = {}, apBase = {};
    (apSnap || []).forEach(function(sn) {
      if (apTotal[sn.listing_id] === undefined) apTotal[sn.listing_id] = sn.total_reviews;
      if (sn.captured_on < apMonth && apBase[sn.listing_id] === undefined) apBase[sn.listing_id] = sn.total_reviews;
    });

    var apOut = [];
    Object.keys(apCounts).forEach(function(k) {
      var parts = k.split("|"), st = parts[0], b = parts[1];
      var l = apL.filter(function(x) { return x.store === st && x.listing_type === b; })[0];
      if (!l) return;   // no such page tracked; reported in meta rather than invented
      var total = apTotal[l.id];
      // Same test as `credits`, clause for clause, INCLUDING the main-page
      // exclusion. The main pages carry 559-893 reviews so it changes nothing
      // today -- but without it a failed snapshot that read null-then-low on a
      // main page would make this screen promise the $20 premium where
      // `credits` would not, and the two would quietly disagree about pay.
      var thin = l.listing_type !== "main" && total !== undefined && total !== null && total < THIN_UNDER;
      var base = apBase[l.id];
      apOut.push({
        store: st, listing_type: b, label: l.label,
        tickets: apCounts[k],
        total_reviews: total === undefined ? null : total,
        gained_this_month: (total === undefined || total === null || base === undefined) ? null : total - base,
        // $20 while the page is under 10 reviews, $10 after. Stated as the
        // rule's own numbers so this screen cannot drift from `credits`.
        named_amount: thin ? NAMED_THIN : NAMED_MAIN,
        still_worth_more: !!thin,
        write_review_url: l.place_id ? "https://search.google.com/local/writereview?placeid=" + encodeURIComponent(l.place_id) : null,
        maps_url: l.maps_url || null,
      });
    });
    // Highest-value ask first: a page still worth $20, then the most work done.
    apOut.sort(function(a, b2) {
      if (a.still_worth_more !== b2.still_worth_more) return a.still_worth_more ? -1 : 1;
      return b2.tickets - a.tickets;
    });

    var apMissing = [];
    Object.keys(apCounts).forEach(function(k) {
      var parts = k.split("|");
      if (!apL.filter(function(x) { return x.store === parts[0] && x.listing_type === parts[1]; })[0]) apMissing.push(k);
    });

    return json({
      success: true,
      employee: apWho, requested: apName, resolved: apWho !== apName,
      window: { from: apFrom, to: apToday, days: apDays },
      pages: apOut,
      // Everything matched is accounted for -- placed + uncategorised equals
      // tickets_matched -- so a figure can never quietly vanish. Work whose
      // category is null cannot pick a page and is counted, not dropped;
      // `phone_tickets` is context, already inside `placed`.
      meta: {
        tickets_matched: apRows.length,
        tickets_scanned: apScanned,
        placed: apOut.reduce(function(n, r) { return n + r.tickets; }, 0),
        phone_tickets: apPhone,
        uncategorised: apUncat,
        pages_not_tracked: apMissing,
        duplicates_dropped: apLDe.duplicates_dropped,
      },
      rules: { thin_under: THIN_UNDER, named_main: NAMED_MAIN, named_thin: NAMED_THIN },
      // Nothing here is approved pay. Same discipline as every other review
      // figure in this route.
      payable: true,   // Eric approved the review bonus on 2026-11-05, effective November.
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ?action=my_reviews&name=  — ONE PERSON'S OWN REVIEW CREDITS.
  //
  // Any signed-in role, because a technician must be able to see their own
  // number without being a manager. It deliberately returns the person's
  // credits and NOTHING ELSE: no other employee's credits, no payment state,
  // no store totals. The store's tier comes from ?action=tracking, which is
  // already public and already computes it — so this route never gets a second
  // copy of the tier arithmetic to drift from (§ 10ao).
  //
  // Named credits follow the PERSON, not the store (§ 10al), which is why
  // there is no store filter here: Duncan works three stores and a review that
  // names him at Bloomington is his wherever he is assigned for the month.
  // ───────────────────────────────────────────────────────────────────────────
  if (action === "my_reviews") {
    var mrGate = await requireAuth(request, {});
    if (!mrGate.authorized) return mrGate.response;

    var mrName = (searchParams.get("name") || "").trim();
    if (!mrName) return json({ success: false, error: "name is required" }, 400);
    var mrPeriod = searchParams.get("period") || indyToday().slice(0, 7);

    var { data: mrLRaw, error: mrE1 } = await supabase.from("google_listings").select("id,store,listing_type,label,is_ours,place_id");
    if (mrE1) return json({ success: false, error: mrE1.message }, 500);
    var mrL = dedupeListings(mrLRaw).listings;
    var { data: mrSnap, error: mrE2 } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,total_reviews").order("captured_on", { ascending: false }).limit(5000);
    if (mrE2) return json({ success: false, error: mrE2.message }, 500);
    var { data: mrItems, error: mrE3 } = await supabase.from("google_review_items")
      .select("id,listing_id,review_key,rating,author,text,has_photo,posted_at,first_seen_at").limit(5000);
    if (mrE3) return json({ success: false, error: mrE3.message }, 500);
    var { data: mrRoster, error: mrE4 } = await supabase.from("employee_roster")
      .select("name,aliases,store,active,bonus_eligible");
    if (mrE4) return json({ success: false, error: mrE4.message }, 500);

    var mrActive = (mrRoster || []).filter(function(r) { return r.active; });
    var mrMap = buildResolver(mrRoster || []).map;
    // Resolve the asking name the same way every other screen does, so "Sam
    // Tomey" sees Samuel Tomey's credits rather than none.
    var mrWho = resolveNamePersonish(mrName, mrMap) || mrName;
    var mrMe = mrActive.filter(function(r) { return r.name === mrWho; })[0] || null;

    var mrById = {}; mrL.forEach(function(l) { mrById[l.id] = l; });
    var mrTotal = {};
    (mrSnap || []).forEach(function(sn) { if (mrTotal[sn.listing_id] === undefined) mrTotal[sn.listing_id] = sn.total_reviews; });

    // Same rule object as the manager's queue, by construction.
    var mrGains = storeGainsByMonth(mrSnap, mrL);
    var mrRows = creditRowsFor(mrItems, mrById, mrTotal, mrActive, mrGains);
    var mrManual = {};
    (mrItems || []).forEach(function(it) { mrManual[it.id] = /^manual:/.test(String(it.review_key || "")); });
    mrRows.forEach(function(r) { r.recorded_by_hand = !!mrManual[r.id]; });

    function mine(r) {
      return (r.proposed_credits || []).filter(function(c) {
        return resolveNamePersonish(c.name, mrMap) === mrWho || c.name === mrWho;
      });
    }
    function pack(r, c) {
      return {
        id: r.id,
        period: r.period,
        store: r.store,
        listing_type: r.listing_type,
        listing_label: r.listing_label,
        rating: r.rating,
        author: r.author,
        posted_at: r.posted_at,
        has_photo: r.has_photo,
        // The review's own words. The manager's queue has shown these since it
        // shipped; the technician's card did not, so a person could be told
        // "you were named, $10" and have no way to see WHICH review, or to
        // check it was really them. Alec hit exactly that on 2026-11-05.
        // `matched` is the alias that fired, so the card can point at the word.
        text: r.text,
        matched: c.matched,
        // A row somebody typed from the Business Profile inbox rather than one
        // Google handed us. Worth saying on screen: it is the only kind of row
        // that exists because a person went looking.
        recorded_by_hand: r.recorded_by_hand,
        page_under_threshold: r.page_under_threshold,
        amount: c.amount,
        // Travels with the amount, always: the card has to be able to say
        // "$10, held because the store missed 10" rather than a bare $0.
        amount_if_floor_met: c.amount_if_floor_met,
        shared_with: c.shared_with,
        blocked: c.blocked,
        counts_for_tier: r.counts_for_tier,
        store_floor_met: r.store_floor_met,
      };
    }

    var mrMonth = [], mrAll = [], mrUndated = [];
    mrRows.forEach(function(r) {
      mine(r).forEach(function(c) {
        var row = pack(r, c);
        mrAll.push(row);
        if (r.period === mrPeriod) mrMonth.push(row);
        else if (!r.period) mrUndated.push(row);
      });
    });
    function byDateDesc(a, b) { return String(b.posted_at || "").localeCompare(String(a.posted_at || "")); }
    mrMonth.sort(byDateDesc); mrAll.sort(byDateDesc); mrUndated.sort(byDateDesc);
    var sum = function(a) { return Math.round(a.reduce(function(x, y) { return x + (y.amount || 0); }, 0) * 100) / 100; };

    // Every month this person has ever been named in, so a scoped view can
    // never hide a month they are owed for — the same index the manager's
    // queue carries, for the same reason.
    var mrIdx = {};
    mrIdx[mrPeriod] = { period: mrPeriod, credits: 0, amount: 0 };
    mrAll.forEach(function(r) {
      if (!r.period) return;
      var b = mrIdx[r.period] || (mrIdx[r.period] = { period: r.period, credits: 0, amount: 0 });
      b.credits += 1; b.amount = Math.round((b.amount + (r.amount || 0)) * 100) / 100;
    });

    // How much of this person's own store can we actually see? Held items
    // against the page's own published total, per page. The gap is the whole
    // reason a credit can be missing, so it is reported as a number rather
    // than as "a sample".
    var mrCoverage = (function() {
      var store = mrMe && mrMe.store ? mrMe.store : null;
      var held = {}, pages = [];
      (mrItems || []).forEach(function(it) { held[it.listing_id] = (held[it.listing_id] || 0) + 1; });
      Object.keys(mrById).forEach(function(k) {
        var l = mrById[k];
        if (!l || (store && l.store !== store)) return;
        if (l.is_ours === false) return;
        var total = mrTotal[l.id];
        pages.push({
          listing_type: l.listing_type, label: l.label,
          held: held[l.id] || 0,
          page_total: total === undefined ? null : total,
          pct: (total ? Math.round(1000 * (held[l.id] || 0) / total) / 10 : null),
        });
      });
      var main = pages.filter(function(x) { return x.listing_type === "main"; })[0] || null;
      var note = "Google hands back a sample of each page's reviews, not all of them, so this list can be short.";
      if (main && main.page_total) {
        note = "We can see " + main.held + " of your store's " + main.page_total.toLocaleString() +
          " main-page reviews (" + main.pct + "%), because Google only hands back a sample of a big page. " +
          "The smaller department pages we see in full. So if a customer named you on the main page and it is not here, " +
          "that is us not seeing it \u2014 ask Matt to record it from the Business Profile inbox and it will count.";
      }
      return { store: store, pages: pages, main: main, note: note };
    })();

    return json({
      success: true,
      period: mrPeriod,
      name: mrName,
      resolved_name: mrWho,
      on_roster: !!mrMe,
      // THE VIEWER'S OWN STORE, because the card must not read the tier off
      // whatever store the page header happens to be set to. Caught in the
      // browser: viewing Andrew (Bloomington) from the Fishers header showed
      // Fishers' tier above a banner naming Bloomington's review count.
      store: mrMe ? (mrMe.store || null) : null,
      bonus_eligible: mrMe ? mrMe.bonus_eligible !== false : null,
      // Stated, not implied: being off the active roster is why a real person
      // can see zero credits, and it is not the same as having none.
      why_none: mrMe ? null : "This name is not on the active roster, so no review can be credited to it.",
      tiers: TIERS,
      floor: TIERS[0].at,
      rules: {
        thin_under: THIN_UNDER, named_main: NAMED_MAIN, named_thin: NAMED_THIN,
        every_review_counts: true, one_star_pays_nobody: true,
        split_named_credit: SPLIT_NAMED_CREDIT,
        named_credit_needs_store_floor: NAMED_CREDIT_NEEDS_STORE_FLOOR,
      },
      my_credits: mrMonth,
      my_amount: sum(mrMonth),
      my_credit_count: mrMonth.length,
      all_time_credits: mrAll.length,
      all_time_amount: sum(mrAll),
      months: Object.keys(mrIdx).sort().reverse().map(function(k) { return mrIdx[k]; }),
      undated: mrUndated,
      // The floor state for this person's own store and month, so the card can
      // say "your store is 3 short this month" instead of showing a bare $0.
      // Read off the roster store; a review on another store's page carries
      // its own `store_floor` on the row.
      store_floor: mrMe && mrMe.store ? storeFloorState(mrGains, mrMe.store, mrPeriod) : null,
      store_reviews_this_month: (function() {
        var g = mrMe && mrMe.store ? mrGains[mrMe.store + "|" + mrPeriod] : null;
        return g ? g.gained : null;
      })(),
      // Places hands back a relevance SAMPLE of each page's reviews, so a
      // review naming this person may simply not be in it. "0" here means
      // "none we hold", never "nobody named you" — and saying so is the
      // difference between a prompt and an accusation.
      // COMPUTED, not a stock sentence. Measured 2026-11-05: we hold 9 of
      // Bloomington main's 564 reviews (1.6%), 9 of 652 at Fishers, 6 of 893
      // at Indianapolis -- while the nine department pages sit at or near
      // 100% because they are small enough for Google's sample to cover them
      // whole. So "no review named you" is near-meaningless on a main page
      // and near-certain on a console page, and a single disclaimer covering
      // both told the technician nothing. Alec had two main-page reviews
      // naming him that we do not hold, and the card said only "may not be
      // in it yet".
      coverage: mrCoverage.note,
      coverage_detail: mrCoverage,
      payable: true,   // Eric approved the review bonus on 2026-11-05, effective November.
    });
  }

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

    // ⚠ SCOPED TO THE MONTH THE REVIEW WAS POSTED (Eric, 2026-11-02).
    //
    // This action used to return EVERY review ever captured with a $10/$20
    // `amount` attached and no window at all, so the "Credits to confirm"
    // queue ran from 2025-09 to today in one list. Each row printed its own
    // date, so nothing on screen was false — but it is a payment queue for a
    // MONTHLY bonus, and working it in November meant confirming $10 against a
    // review from March. The "$120 proposed" figure in CONTEXT § 10al was a
    // lifetime total read as a month's.
    //
    // The hazard in fixing it is the opposite one: filtering to the current
    // month on the 2nd would show an empty queue and read as "nothing to
    // settle" while October sat unsettled. So `months` carries every month
    // that holds a credit, with its counts and dollars, and the tab offers
    // them — a month is hidden from the list, never from the index.
    var cPeriod = searchParams.get("period") || indyToday().slice(0, 7);

    var cGains = storeGainsByMonth(cSnap, cL);
    var rows = creditRowsFor(cItems, lById, totalById, cRoster, cGains);

    function emptyMix() { return { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0, unknown: 0 }; }
    var mix = emptyMix(), mixAll = emptyMix();
    rows.forEach(function(r) {
      var k = (r.rating === 5 || r.rating === 4 || r.rating === 3 || r.rating === 2 || r.rating === 1) ? r.rating : "unknown";
      mixAll[k] += 1;
      if (r.period === cPeriod) mix[k] += 1;
    });

    // Every month that holds a credit, with what it is worth. This is the
    // index that stops a scoped queue from hiding an unsettled month: the tab
    // lists these, so October with 3 pending stays visible while viewing
    // November with 0. The running month is always offered even when empty,
    // or there would be no way back to it from a past month.
    var monthIdx = {};
    function monthBucket(ym) {
      monthIdx[ym] = monthIdx[ym] || { period: ym, items: 0, credits: 0, payable_credits: 0, amount: 0,
        // Held = the person is named and eligible, but the store missed the
        // floor that month. Under the floor gate this is the NORMAL state, so
        // a month index that only counted payable credits would report every
        // month as empty and the queue would read "nothing to settle".
        held_credits: 0, amount_if_floor_met: 0 };
      return monthIdx[ym];
    }
    monthBucket(cPeriod);
    rows.forEach(function(r) {
      if (!r.period) return;
      var m = monthBucket(r.period);
      m.items += 1;
      (r.proposed_credits || []).forEach(function(c) {
        m.credits += 1;
        if (c.amount > 0) { m.payable_credits += 1; m.amount += c.amount; }
        if (c.amount_if_floor_met > 0) {
          m.amount_if_floor_met = Math.round((m.amount_if_floor_met + c.amount_if_floor_met) * 100) / 100;
          if (c.amount === 0) m.held_credits += 1;
        }
      });
    });
    var months = Object.keys(monthIdx).sort().reverse().map(function(k) { return monthIdx[k]; });

    function byDateDesc(a, b) { return String(b.posted_at || "").localeCompare(String(a.posted_at || "")); }
    var monthRows = rows.filter(function(r) { return r.period === cPeriod; }).sort(byDateDesc);
    // A review with no date cannot be assigned to a month, so it is never
    // folded into the current one. Returned separately, and only when it would
    // actually pay somebody -- surfaced, never dropped, never charged to a
    // month it may not belong to. (0 of 44 items today; this is a guard.)
    var undated = rows.filter(function(r) {
      return !r.period && (r.proposed_credits || []).some(function(c) { return c.amount > 0 || c.amount_if_floor_met > 0; });
    }).sort(byDateDesc);

    var thisMonth = monthIdx[cPeriod];
    var scored = mix[5] + mix[4] + mix[3] + mix[2] + mix[1];
    var scoredAll = mixAll[5] + mixAll[4] + mixAll[3] + mixAll[2] + mixAll[1];
    return json({
      success: true,
      period: cPeriod,
      months: months,
      rules: { thin_under: THIN_UNDER, named_main: NAMED_MAIN, named_thin: NAMED_THIN, every_review_counts: true, one_star_pays_nobody: true,
               split_named_credit: SPLIT_NAMED_CREDIT, named_credit_needs_store_floor: NAMED_CREDIT_NEEDS_STORE_FLOOR },
      // The mix is THIS MONTH's, because the sentence it sits under is about
      // the store tier and the tier is monthly. All-time kept beside it.
      rating_mix: mix,
      rating_mix_sample: scored,
      rating_mix_all_time: mixAll,
      rating_mix_sample_all_time: scoredAll,
      // The flag, over the sample we hold. NOT a count of the month's 1-star
      // reviews -- a main page shows us about five of its several hundred, so
      // zero here means "none seen", never "none happened".
      one_star_in_sample: mix[1],
      one_star_in_sample_all_time: mixAll[1],
      one_star_coverage: "Places returns a relevance sample of reviews, not all of them. A 1-star outside that sample does not appear here. Review TOTALS are exact; this list is not complete.",
      text_coverage: "Places returns a relevance sample of reviews, not all of them. This list is incomplete by design; review totals are exact.",
      items: monthRows,
      undated: undated,
      month_credits: thisMonth.credits,
      month_payable_credits: thisMonth.payable_credits,
      month_amount: thisMonth.amount,
      // What the month would pay if its stores clear the floor. Both figures
      // travel for the same reason the tier's two do.
      month_held_credits: thisMonth.held_credits,
      month_amount_if_floor_met: thisMonth.amount_if_floor_met,
      // Per store, the count the gate is reading and whether it cleared --
      // so the queue can explain a held credit without recomputing anything.
      store_floor_this_month: (function() {
        var o = {};
        Object.keys(cGains).forEach(function(k) {
          if (k.slice(-7) !== cPeriod) return;
          var g = cGains[k];
          o[g.store] = { gained: g.gained, complete: g.complete, reached: g.reached, floor: TIERS[0].at };
        });
        return o;
      })(),
      items_outside_month: rows.length - monthRows.length,
    });
  }

  // ── capture today's reading ───────────────────────────────────────────────
  // ?action=sync_owned — EVERY review on the pages we own.
  //
  // Separate from `sync` on purpose: that one is the nightly Places poll and
  // must keep working whether or not this is configured. This one is admin /
  // cron, and it is NOT on the cron schedule yet because it has never run
  // against the real API — Google gates Business Profile access behind a
  // manual approval, so the shapes below are written from the reference and
  // are unexercised. Run it once with &dry_run=1 and read the report before
  // letting it write, and before putting it in vercel.json.
  // ?action=probe_reviews — CAN WE GET NEWER REVIEWS WITH THE KEY WE ALREADY HAVE?
  //
  // Measured 2026-11-05: Places API (New) gives us ~5 reviews per page sorted
  // by RELEVANCE, and relevance is stable, so polling daily re-reads the same
  // old five forever — 1.6% of Bloomington main, newest held review 4 October
  // while the page took four more since.
  //
  // But the bonus only cares about reviews posted THIS MONTH, and a main page
  // takes ~20 a month. Five NEWEST per daily poll would cover that several
  // times over. `reviews_sort=newest` exists on Places (Legacy), which this
  // project may still have enabled — legacy can no longer be switched on for
  // NEW projects as of October 2026, but an older project keeps it.
  //
  // So: ask, do not assume. This reads only; it writes nothing, and it never
  // returns the key.
  if (action === "probe_reviews") {
    var prGate = await requireAuth(request, { requiredRoles: ["admin"] });
    if (!prGate.authorized) return prGate.response;
    var prKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!prKey) return json({ success: false, error: "GOOGLE_PLACES_API_KEY is not set." }, 503);

    var { data: prL, error: prE } = await supabase.from("google_listings")
      .select("id,store,listing_type,label,place_id,is_ours").eq("active", true);
    if (prE) return json({ success: false, error: prE.message }, 500);
    var prList = dedupeListings(prL).listings
      .filter(function(l) { return l.is_ours !== false && l.place_id && l.listing_type === "main"; });

    var out = [];
    for (var pi = 0; pi < prList.length; pi++) {
      var pl = prList[pi];
      var row = { listing: pl.label, store: pl.store };

      // What we already hold, so the probe can say whether this is NEW.
      var { data: held } = await supabase.from("google_review_items")
        .select("posted_at,author").eq("listing_id", pl.id).order("posted_at", { ascending: false }).limit(1);
      row.newest_held = (held && held[0] && held[0].posted_at) || null;

      for (var mi = 0; mi < 2; mi++) {
        var sort = mi === 0 ? "newest" : "most_relevant";
        var url = "https://maps.googleapis.com/maps/api/place/details/json?place_id=" +
          encodeURIComponent(pl.place_id) + "&fields=reviews,user_ratings_total&reviews_sort=" + sort +
          "&key=" + encodeURIComponent(prKey);
        try {
          var r = await fetch(url);
          var j = await r.json();
          var revs = (j.result && j.result.reviews) || [];
          row["legacy_" + sort] = {
            http: r.status,
            api_status: j.status || null,
            // The legacy API's own words when it refuses, minus anything
            // that could echo the key back.
            error: j.error_message ? String(j.error_message).slice(0, 200) : null,
            total_on_page: (j.result && j.result.user_ratings_total) || null,
            returned: revs.length,
            reviews: revs.map(function(rv) {
              return {
                author: rv.author_name || null,
                rating: rv.rating || null,
                when: rv.time ? new Date(rv.time * 1000).toISOString() : null,
                snippet: String(rv.text || "").slice(0, 80),
              };
            }),
          };
        } catch (e) {
          row["legacy_" + sort] = { error: String(e.message || e) };
        }
      }

      // Does sorting by newest actually hand back anything we do not hold?
      var nw = row.legacy_newest || {};
      if (nw.reviews && row.newest_held) {
        row.newer_than_anything_we_hold = nw.reviews.filter(function(x) {
          return x.when && x.when > row.newest_held;
        }).length;
      }
      out.push(row);
    }

    return json({
      success: true,
      question: "Does reviews_sort=newest on Places (Legacy) return reviews the New API's relevance sample does not?",
      reads_only: true,
      listings: out,
      how_to_read: "api_status REQUEST_DENIED means Places API (Legacy) is not enabled on this project, and that is the end of this route. OK with reviews newer than newest_held means a daily poll on 'newest' would capture this month's reviews without any new Google approval.",
    });
  }

  if (action === "sync_owned") {
    var ownCron = process.env.CRON_SECRET;
    var ownAuthz = request.headers.get("authorization") || "";
    if (!(ownCron && ownAuthz === "Bearer " + ownCron)) {
      var ownGate = await requireAuth(request, { requiredRoles: ["admin"] });
      if (!ownGate.authorized) return ownGate.response;
    }
    var dryRun = searchParams.get("dry_run") === "1";
    var creds = gbpCreds();
    var missing = ["GBP_CLIENT_ID", "GBP_CLIENT_SECRET", "GBP_REFRESH_TOKEN"]
      .filter(function(k) { return !process.env[k]; });
    if (missing.length) {
      console.error("[google-tracking] sync_owned missing env:", missing.join(", "));
      return json({
        success: false,
        error: "Business Profile sync is not configured. Missing: " + missing.join(", ") +
          ". These are an OAuth client and a refresh token for the Google account that OWNS the listings — not the Places API key. Nothing was written.",
        missing: missing,
      }, 503);
    }

    var token;
    try { token = await gbpAccessToken(creds); }
    catch (e) {
      console.error("[google-tracking] sync_owned token:", e.message);
      return json({ success: false, error: String(e.message || e), stage: "token" }, 502);
    }

    var locs;
    try { locs = await gbpLocationsByPlaceId(token); }
    catch (e) {
      console.error("[google-tracking] sync_owned locations:", e.message);
      return json({
        success: false, stage: "locations", error: String(e.message || e),
        hint: "A 403 here usually means this Google Cloud project has not been granted Business Profile API access yet. That is an application Google reviews by hand, not a setting.",
      }, 502);
    }

    var { data: ownRaw, error: ownLE } = await supabase.from("google_listings")
      .select("id,store,listing_type,label,place_id,is_ours").eq("active", true);
    if (ownLE) return json({ success: false, error: ownLE.message }, 500);
    var ownListings = dedupeListings(ownRaw).listings.filter(function(l) { return l.is_ours !== false; });

    var report = [], totalInsert = 0, totalAdopt = 0, unreachable = [];
    for (var oi = 0; oi < ownListings.length; oi++) {
      var ol = ownListings[oi];
      var match = ol.place_id ? locs.byPlaceId[ol.place_id] : null;
      if (!match) {
        // Expected for the nine franchisor-owned department pages. Places
        // already covers those in full, so this is information, not a failure.
        unreachable.push({ listing: ol.label, store: ol.store, listing_type: ol.listing_type,
          why: ol.place_id ? "not in this account's locations (franchisor-owned, or not managed by us)" : "no place_id yet" });
        continue;
      }
      try {
        var got = await gbpAllReviews(match.account, match.location, token);
        var fresh = got.reviews.map(function(rv) { return normalizeReview(rv, ol.id); }).filter(Boolean);

        var { data: have, error: hE } = await supabase.from("google_review_items")
          .select("id,review_key,author,posted_at,text,rating").eq("listing_id", ol.id).limit(20000);
        if (hE) throw new Error("existing items: " + hE.message);

        var plan = reconcile(fresh, have || []);
        var sweep = sweepStatus(fresh.length, got.total, got.pages);

        if (!dryRun) {
          if (plan.inserts.length) {
            var { error: iE } = await supabase.from("google_review_items")
              .upsert(plan.inserts, { onConflict: "listing_id,review_key", ignoreDuplicates: true });
            if (iE) throw new Error("insert: " + iE.message);
          }
          // Adoptions are one-by-one on purpose: each rewrites a specific row
          // we already hold, and a bulk upsert keyed on review_key would
          // create the duplicate this whole path exists to avoid.
          for (var ai = 0; ai < plan.adopts.length; ai++) {
            var { error: aE } = await supabase.from("google_review_items")
              .update(plan.adopts[ai].row).eq("id", plan.adopts[ai].id);
            if (aE) throw new Error("adopt " + plan.adopts[ai].id + ": " + aE.message);
          }
        }
        totalInsert += plan.inserts.length;
        totalAdopt += plan.adopts.length;
        report.push({
          listing: ol.label, store: ol.store, listing_type: ol.listing_type,
          google_title: match.title,
          fetched: fresh.length, held_before: (have || []).length,
          new_reviews: plan.inserts.length,
          adopted_from_places_or_manual: plan.adopts.map(function(a) { return a.was; }),
          already_had: plan.unchanged,
          sweep: sweep,
        });
      } catch (e) {
        console.error("[google-tracking] sync_owned", ol.label, e.message);
        report.push({ listing: ol.label, store: ol.store, error: String(e.message || e) });
      }
    }

    var failed = report.filter(function(r) { return r.error; });
    return json({
      success: failed.length === 0,
      dry_run: dryRun,
      wrote: dryRun ? 0 : totalInsert,
      would_insert: totalInsert,
      would_adopt: totalAdopt,
      listings: report,
      not_reachable_by_this_account: unreachable,
      failures: failed,
      note: dryRun
        ? "DRY RUN — nothing was written. `would_adopt` are reviews we already hold under a Places or hand-entered key; adopting rewrites that row rather than adding a second one, which would be a second named credit."
        : "Reviews we already held under a Places or manual key were re-keyed in place, not duplicated.",
    }, failed.length ? 207 : 200);
  }

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

// ── recording a 1-star from the Business Profile inbox ─────────────────────
// The ONLY write on this route, and it exists because the deduction needs
// evidence. Places shows us about five reviews of a main page's several
// hundred, so a 1-star can be real and invisible here; without this the rule
// would read as "you get away with it if Google does not show us", and a store
// would be paid in full for a month a customer rated 1 star.
//
// It writes a `google_review_items` row with a `manual:` review_key. No
// migration: the table already carries exactly these columns, the unique index
// on (listing_id, review_key) means recording the same review twice cannot
// dock a store twice, and the sync only ever upserts, so a manual row is never
// cleaned away by a later poll. (All three verified against the live table.)
//
// `remove_one_star` deletes a manual row only. A Google-sourced review is not
// removable here by design -- the penalty must not be clearable by deleting
// the evidence.
export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" }, 500);
  var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
  if (!gate.authorized) return gate.response;

  var body = null;
  try { body = await request.json(); } catch (e) { return json({ success: false, error: "Body is not JSON" }, 400); }
  var action = body && body.action;
  var who = (function() { var w = gate.result || {}; return w.name || w.email || "unknown"; })();

  if (action === "record_one_star" || action === "record_review") {
    var store = String(body.store || "").trim().toLowerCase();
    var listingType = String(body.listing_type || "main").trim().toLowerCase();
    var postedAt = String(body.posted_at || "").trim();
    if (["fishers", "bloomington", "indianapolis"].indexOf(store) < 0) {
      return json({ success: false, error: "unknown store: " + store }, 400);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(postedAt)) {
      return json({ success: false, error: "posted_at must be YYYY-MM-DD (the date the review was left)" }, 400);
    }
    var stars = body.rating === undefined || body.rating === null || body.rating === "" ? 1 : Number(body.rating);
    if (!isFinite(stars) || stars < 1 || stars > 5 || Math.floor(stars) !== stars) {
      return json({ success: false, error: "rating must be a whole number of stars from 1 to 5" }, 400);
    }

    var { data: tl, error: tlErr } = await supabase.from("google_listings")
      .select("id,store,listing_type,label").eq("store", store).eq("listing_type", listingType).eq("active", true);
    if (tlErr) return json({ success: false, error: tlErr.message }, 500);
    var target = dedupeListings(tl).listings[0];
    if (!target) return json({ success: false, error: "no active listing for " + store + " / " + listingType }, 404);

    // The key is derived from what identifies the review to a person, so the
    // same review recorded twice collides on the unique index instead of
    // docking the store a second time.
    var slug = String(body.author || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    var row = {
      listing_id: target.id,
      review_key: "manual:" + postedAt + ":" + (slug || "anon"),
      rating: stars,
      author: body.author ? String(body.author).slice(0, 120) : null,
      // ⚠ `text` IS THE CREDIT FIELD. lib/review-credit.js scans it for
      // roster aliases, so whatever goes in here can pay somebody. This line
      // used to read "Recorded from the Business Profile inbox by " + who,
      // and "eric" is a deliberate alias for Aerick Long (customers write it
      // constantly) — so every review Eric recorded by hand would have
      // credited Aerick $10 for a review he was never named in. Confirmed
      // against lib/review-credit.js on 2026-11-05; nothing had been recorded
      // yet, so no money moved.
      // Only the CUSTOMER'S OWN WORDS belong in this column. A manual row is
      // identified by its `manual:` review_key, not by a sentence in the text.
      text: body.review_text ? String(body.review_text).slice(0, 2000) : null,
      posted_at: postedAt + "T12:00:00Z",
    };
    var { data, error } = await supabase.from("google_review_items").insert(row).select();
    if (error) {
      var dup = String(error.code || "") === "23505";
      // Loud: a write that cannot land must never answer 200.
      if (!dup) console.error("[google-tracking] record_one_star failed:", error.message);
      return json({
        success: false,
        already_recorded: dup,
        error: dup
          ? "That review is already recorded for " + target.label + " on " + postedAt +
            ", so it is already counted once. Recording it again would dock the store twice."
          : error.message,
      }, dup ? 409 : 500);
    }
    // Say straight away who this will credit. Recording a review is the one
    // path where a person types the words the money is computed from, so the
    // answer has to come back on the same screen rather than next morning.
    var { data: recRoster } = await supabase.from("employee_roster")
      .select("name,bonus_eligible").eq("active", true);
    var recCredits = row.text ? creditReview(row.text, recRoster || []) : [];
    return json({
      success: true,
      recorded: (data && data[0]) || row,
      listing: target.label,
      proposed_credits: recCredits,
      credit_note: !row.text
        ? "No review text was given, so this review credits nobody by name. Paste the customer's words to credit the person they named."
        : (recCredits.length
            ? "Names found: " + recCredits.map(function(c) { return c.name; }).join(", ") +
              (stars === 1 ? " — but a 1-star pays nobody." : "")
            : "No roster name appears in that review, so it counts toward the store only."),
    });
  }

  if (action === "remove_one_star" || action === "remove_review") {
    var id = Number(body.id);
    if (!isFinite(id) || id <= 0) return json({ success: false, error: "id is required" }, 400);
    var { data: ex, error: exErr } = await supabase.from("google_review_items")
      .select("id,review_key,rating").eq("id", id);
    if (exErr) return json({ success: false, error: exErr.message }, 500);
    if (!ex || !ex.length) return json({ success: false, error: "no such review row" }, 404);
    if (!/^manual:/.test(String(ex[0].review_key || ""))) {
      // Refused on purpose: a penalty that can be cleared by deleting Google's
      // own review is not a penalty.
      return json({
        success: false,
        error: "That review came from Google, not from a manual entry, so it cannot be removed here. Only a record somebody typed can be undone.",
      }, 403);
    }
    var { error: delErr } = await supabase.from("google_review_items").delete().eq("id", id);
    if (delErr) { console.error("[google-tracking] remove_one_star failed:", delErr.message); return json({ success: false, error: delErr.message }, 500); }
    return json({ success: true, removed: id, removed_by: who });
  }

  return json({ success: false, error: "Unknown action: " + String(action) }, 400);
}

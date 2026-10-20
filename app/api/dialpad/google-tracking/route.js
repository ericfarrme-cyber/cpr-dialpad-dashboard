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
    var { data: ls, error: lErr } = await supabase.from("google_listings").select("*").eq("active", true).order("store").order("listing_type");
    if (lErr) return json({ success: false, error: lErr.message }, 500);
    var { data: snaps, error: sErr } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,rating,total_reviews,source").order("captured_on", { ascending: false }).limit(5000);
    if (sErr) return json({ success: false, error: sErr.message }, 500);
    var latest = {};
    (snaps || []).forEach(function(s) { if (!latest[s.listing_id]) latest[s.listing_id] = s; });
    return json({
      success: true,
      listings: (ls || []).map(function(l) { return Object.assign({}, l, { latest: latest[l.id] || null }); }),
      needs_place_id: (ls || []).filter(function(l) { return !l.place_id; }).length,
    });
  }

  // ── what moved this month ─────────────────────────────────────────────────
  if (action === "tracking") {
    var today = indyToday(), mStart = monthStart(today);
    var { data: L, error: e1 } = await supabase.from("google_listings").select("*").eq("active", true);
    if (e1) return json({ success: false, error: e1.message }, 500);
    var { data: S, error: e2 } = await supabase.from("google_review_snapshots")
      .select("listing_id,captured_on,rating,total_reviews").order("captured_on", { ascending: true }).limit(20000);
    if (e2) return json({ success: false, error: e2.message }, 500);

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
      ever_captured: out.filter(function(r) { return r.captured_on; }).length,
      total_listings: out.length,
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
  // So `five_star_countable` is false and every derived five-star figure is
  // labelled an estimate. Nothing here computes a payable amount.
  if (action === "credits") {
    var cGate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
    if (!cGate.authorized) return cGate.response;

    var { data: cL, error: cE1 } = await supabase.from("google_listings").select("id,store,listing_type,label,is_ours");
    if (cE1) return json({ success: false, error: cE1.message }, 500);
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
      five_star_countable: false,
      five_star_blocker: "Places API returns a total and a one-decimal average, never a star breakdown. Star-sum uncertainty is 0.05 x review count (+/-32 on Fishers main, +/-44 on Indianapolis), so a 4 star cannot be told from a 5 star. Exact counts need the Business Profile Reviews API (owner OAuth) or a person reading the Business Profile inbox.",
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

    var { data: listings, error: lE } = await supabase.from("google_listings").select("*").eq("active", true);
    if (lE) return json({ success: false, error: lE.message }, 500);

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
        var { error: snapErr } = await supabase.from("google_review_snapshots").upsert({
          listing_id: l.id, captured_on: today2,
          rating: place.rating === undefined ? null : place.rating,
          total_reviews: place.userRatingCount === undefined ? null : place.userRatingCount,
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

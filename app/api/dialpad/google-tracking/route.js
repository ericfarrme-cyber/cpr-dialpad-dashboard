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
// GET  ?action=sync       capture today's reading for every listing (cron/admin)
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

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
async function findPlaceId(label, key) {
  var res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress" },
    body: JSON.stringify({ textQuery: label, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error("Places searchText " + res.status + ": " + (await res.text()).slice(0, 200));
  var j = await res.json();
  var p = (j.places || [])[0];
  return p ? { place_id: p.id, matched: (p.displayName && p.displayName.text) || null, address: p.formattedAddress || null } : null;
}

async function fetchPlace(placeId, key) {
  var res = await fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId), {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,googleMapsUri,reviews" },
  });
  if (!res.ok) throw new Error("Places details " + res.status + ": " + (await res.text()).slice(0, 200));
  return res.json();
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

    return json({
      success: true, month_start: mStart, today: today,
      stores: Object.values(stores),
      competitors: out.filter(function(r) { return !r.is_ours; }),
      // Surfaced, never silent: the sync cannot run for these.
      listings_without_place_id: out.filter(function(r) { return !r.has_place_id; }).length,
      ever_captured: out.filter(function(r) { return r.captured_on; }).length,
      total_listings: out.length,
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

    var { data: listings, error: lE } = await supabase.from("google_listings").select("*").eq("active", true);
    if (lE) return json({ success: false, error: lE.message }, 500);

    var today2 = indyToday();
    var wrote = 0, resolved = 0, newReviews = 0, failures = [];
    for (var i = 0; i < (listings || []).length; i++) {
      var l = listings[i];
      try {
        if (!l.place_id) {
          var found = await findPlaceId(l.label, key);
          if (!found) { failures.push({ listing: l.label, error: "no Places match for that name" }); continue; }
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

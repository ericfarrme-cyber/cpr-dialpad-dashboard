// Google Business Profile reviews — the pure half.
//
// ⚠ WHY THIS EXISTS. The Places API hands back a RELEVANCE SAMPLE of about
// five reviews per page and nothing else. Measured 2026-11-05: we hold 9 of
// Bloomington main's 564 reviews (1.6%), 9 of 652 at Fishers, 6 of 893 at
// Indianapolis — 1.95% of everything across our own pages — while the nine
// small department pages sit at or near 100% simply because a sample of five
// covers a page of three. Two real reviews naming Alec Wilcher were on the
// Bloomington main page and in neither our data nor his screen.
//
// So named credits, which are the per-person half of the review bonus, are
// near-blind on exactly the pages that carry 95% of the reviews. Eric,
// 2026-11-05: "There's no reason for us to manually find reviews for
// employees. They need to be automatically synced. That's the whole premise."
//
// The fix is a different Google API, not a different key. The Business
// Profile v4 `accounts.locations.reviews.list` returns EVERY review with its
// star rating, text, author and createTime, 50 to a page, for locations the
// account owns or manages — which is the three main pages (CONTEXT § 10ao).
// It authenticates as the business owner over OAuth, not with an API key.
//
// Everything in this file is pure: rows in, rows out, no network and no
// database. That is deliberate — the route half cannot be exercised until
// Google approves API access, so the logic that decides what gets written is
// kept where it can be tested today.

// v4 returns the star as an enum word, not a number.
export var STAR_WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export function starOf(review) {
  if (!review) return null;
  var w = String(review.starRating || "").trim().toUpperCase();
  if (Object.prototype.hasOwnProperty.call(STAR_WORDS, w)) return STAR_WORDS[w];
  // STAR_RATING_UNSPECIFIED, or a word Google adds later. Never guess a
  // rating: a wrong 1 docks a store and a wrong 5 pays somebody.
  return null;
}

// The day a review was posted, in UTC, as YYYY-MM-DD. Used only for matching
// against a hand-recorded row, which stores a date and a made-up noon time.
export function dayOf(ts) {
  var s = String(ts || "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

function nameKey(a) {
  return String(a || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ── normalising one v4 review into our row shape ──────────────────────────
// `reviewId` is v4's own opaque id. It is NOT the id Places uses: Places
// returns a resource name `places/<place>/reviews/<id>` and writes that whole
// string as the key. The two encodings differ, so keying GBP rows naively
// would insert a SECOND row for a review we already hold — and a second row
// is a second $10 credit. Hence `reconcile` below.
export function normalizeReview(rv, listingId) {
  if (!rv) return null;
  var id = rv.reviewId || (rv.name ? String(rv.name).split("/").pop() : null);
  if (!id) return null;
  return {
    listing_id: listingId,
    review_key: "gbp:" + id,
    rating: starOf(rv),
    author: (rv.reviewer && rv.reviewer.displayName) || null,
    text: (rv.comment === undefined || rv.comment === null) ? null : String(rv.comment),
    posted_at: rv.createTime || null,
    has_photo: false,   // v4 does not report photos on a review
  };
}

// ── deciding what to do with each one ─────────────────────────────────────
// `existing` is every google_review_items row we already hold for this
// listing, each with { id, review_key, author, posted_at, text, rating }.
//
// Three outcomes, and the two non-inserts are the point of the function:
//   insert  — we have never seen this review
//   adopt   — we hold it under a Places or manual key; take over that row
//             rather than adding a second one
//   same    — already keyed as this GBP review, nothing to do
//
// Matching is on AUTHOR + EXACT TIMESTAMP, because both APIs report the same
// createTime for the same review. A hand-recorded row is matched on author +
// DATE instead, since the recorder stores a date and a noon placeholder — a
// manual row that GBP later finds for real must be replaced, or Matt typing a
// review in and the sync finding it next week pays the same credit twice.
export function reconcile(fresh, existing) {
  var byKey = {}, byExact = {}, byDay = {};
  (existing || []).forEach(function(e) {
    byKey[e.review_key] = e;
    var n = nameKey(e.author);
    if (e.posted_at) {
      byExact[n + "|" + e.posted_at] = e;
      var d = dayOf(e.posted_at);
      if (d && /^manual:/.test(String(e.review_key || ""))) byDay[n + "|" + d] = e;
    }
  });

  var inserts = [], adopts = [], unchanged = 0;
  (fresh || []).forEach(function(r) {
    if (!r) return;
    if (byKey[r.review_key]) { unchanged++; return; }
    var n = nameKey(r.author);
    var hit = (r.posted_at && byExact[n + "|" + r.posted_at])
      || (r.posted_at && byDay[n + "|" + dayOf(r.posted_at)])
      || null;
    if (hit) {
      adopts.push({
        id: hit.id,
        was: hit.review_key,
        row: {
          review_key: r.review_key,
          rating: r.rating === null ? hit.rating : r.rating,
          author: r.author || hit.author,
          // GBP carries the real text. A review with no comment is a rating
          // with no words, so null is correct and must overwrite a manual
          // row's placeholder rather than being treated as "no update".
          text: r.text,
          posted_at: r.posted_at || hit.posted_at,
        },
      });
      return;
    }
    inserts.push(r);
  });

  return { inserts: inserts, adopts: adopts, unchanged: unchanged };
}

// ── did we actually get everything? ───────────────────────────────────────
// Google's own known-issues page says pages after the first "might not always
// return a completely consistent set of results", so a sweep can silently
// come up short. The location's own totalReviewCount is the check: if the
// sweep is short, say so rather than letting a missing review read as a
// review that was never left.
export function sweepStatus(fetched, totalReviewCount, pagesWalked) {
  var total = (totalReviewCount === null || totalReviewCount === undefined) ? null : Number(totalReviewCount);
  if (total === null || !isFinite(total)) {
    return { complete: null, fetched: fetched, expected: null, pages: pagesWalked,
      note: "Google did not report a total for this location, so the sweep cannot be checked." };
  }
  var short = total - fetched;
  return {
    complete: short <= 0,
    fetched: fetched,
    expected: total,
    missing: short > 0 ? short : 0,
    pages: pagesWalked,
    note: short > 0
      ? "Walked " + pagesWalked + " page(s) and got " + fetched + " of " + total +
        " reviews. Google's paging is documented as inconsistent after page 1; re-run before trusting a per-person count."
      : "Got all " + total + " reviews in " + pagesWalked + " page(s).",
  };
}

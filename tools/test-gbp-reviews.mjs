import { starOf, normalizeReview, reconcile, sweepStatus, dayOf } from "file:///C:/Users/ericf/cpr-dialpad-dashboard/lib/gbp-reviews.js";

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.log("  FAIL:", name, extra === undefined ? "" : JSON.stringify(extra)); }
}

// ── stars ────────────────────────────────────────────────────────────────
ok("FIVE -> 5", starOf({ starRating: "FIVE" }) === 5);
ok("ONE -> 1", starOf({ starRating: "ONE" }) === 1);
ok("lowercase tolerated", starOf({ starRating: "four" }) === 4);
ok("UNSPECIFIED -> null, never guessed", starOf({ starRating: "STAR_RATING_UNSPECIFIED" }) === null);
ok("unknown word -> null", starOf({ starRating: "SIX" }) === null);
ok("missing -> null", starOf({}) === null);
ok("null review -> null", starOf(null) === null);

// ── normalise ────────────────────────────────────────────────────────────
const rv = {
  reviewId: "AbFvOqF123",
  reviewer: { displayName: "Anusha Jahin" },
  starRating: "FIVE",
  comment: "Andrew and Alec were super helpful",
  createTime: "2026-11-04T18:55:12.123Z",
};
const n = normalizeReview(rv, 7);
ok("key is gbp-prefixed", n.review_key === "gbp:AbFvOqF123", n.review_key);
ok("author", n.author === "Anusha Jahin");
ok("rating", n.rating === 5);
ok("text", n.text === "Andrew and Alec were super helpful");
ok("posted_at", n.posted_at === "2026-11-04T18:55:12.123Z");
ok("listing carried", n.listing_id === 7);
ok("id falls back to resource name tail",
  normalizeReview({ name: "accounts/1/locations/2/reviews/ZZZ", createTime: "x" }, 1).review_key === "gbp:ZZZ");
ok("no id at all -> null", normalizeReview({ comment: "hi" }, 1) === null);
ok("rating-only review keeps null text", normalizeReview({ reviewId: "a", starRating: "FIVE" }, 1).text === null);

// ── dayOf ────────────────────────────────────────────────────────────────
ok("dayOf slices", dayOf("2026-11-04T18:55:12Z") === "2026-11-04");
ok("dayOf rejects junk", dayOf("nonsense") === null);
ok("dayOf null", dayOf(null) === null);

// ── reconcile: the one that protects the money ───────────────────────────
const existing = [
  // already ours under a Places key, same review as `rv`
  { id: 101, review_key: "places/CHIJ/reviews/Ch9abc", author: "Anusha Jahin",
    posted_at: "2026-11-04T18:55:12.123Z", text: "Andrew and Alec were super helpful", rating: 5 },
  // a review Matt typed in by hand, noon placeholder
  { id: 102, review_key: "manual:2026-11-02:ab-kollman", author: "AB Kollman",
    posted_at: "2026-11-02T12:00:00Z", text: "Alec & Andrew made it very easy", rating: 5 },
  // unrelated
  { id: 103, review_key: "places/CHIJ/reviews/Ch9zzz", author: "Someone Else",
    posted_at: "2026-10-01T10:00:00Z", text: "fine", rating: 4 },
];

const fresh = [
  normalizeReview(rv, 7),                                                            // dup of 101 by exact ts
  normalizeReview({ reviewId: "K2", reviewer: { displayName: "AB Kollman" }, starRating: "FIVE",
    comment: "Alec & Andrew made it very easy for me", createTime: "2026-11-02T09:13:44Z" }, 7),  // dup of 102 by DAY
  normalizeReview({ reviewId: "K3", reviewer: { displayName: "Ellie Carter" }, starRating: "FIVE",
    comment: "Andrew was great!", createTime: "2026-11-04T01:02:03Z" }, 7),           // genuinely new
];

const r = reconcile(fresh, existing);
ok("one genuine insert", r.inserts.length === 1, r.inserts.map(x => x.author));
ok("the insert is Ellie", r.inserts[0] && r.inserts[0].author === "Ellie Carter");
ok("two adoptions, not two duplicates", r.adopts.length === 2, r.adopts.map(a => a.was));
ok("places row adopted by id", r.adopts.some(a => a.id === 101 && a.row.review_key === "gbp:AbFvOqF123"));
ok("manual row adopted across the noon placeholder", r.adopts.some(a => a.id === 102 && a.row.review_key === "gbp:K2"));
ok("adoption keeps the real timestamp", r.adopts.find(a => a.id === 102).row.posted_at === "2026-11-02T09:13:44Z");
ok("unrelated row untouched", !r.adopts.some(a => a.id === 103));

// running it twice must be a no-op
const after = [
  { id: 101, review_key: "gbp:AbFvOqF123", author: "Anusha Jahin", posted_at: "2026-11-04T18:55:12.123Z", text: "x", rating: 5 },
  { id: 102, review_key: "gbp:K2", author: "AB Kollman", posted_at: "2026-11-02T09:13:44Z", text: "x", rating: 5 },
  { id: 104, review_key: "gbp:K3", author: "Ellie Carter", posted_at: "2026-11-04T01:02:03Z", text: "x", rating: 5 },
];
const r2 = reconcile(fresh, after);
ok("second run inserts nothing", r2.inserts.length === 0, r2.inserts);
ok("second run adopts nothing", r2.adopts.length === 0, r2.adopts);
ok("second run counts 3 unchanged", r2.unchanged === 3, r2.unchanged);

// name matching is whitespace/case tolerant but not fuzzy
const r3 = reconcile(
  [normalizeReview({ reviewId: "Q", reviewer: { displayName: "  anusha   JAHIN " }, starRating: "FIVE", createTime: "2026-11-04T18:55:12.123Z" }, 7)],
  existing);
ok("case/space tolerant match", r3.adopts.length === 1 && r3.inserts.length === 0);
const r4 = reconcile(
  [normalizeReview({ reviewId: "Q", reviewer: { displayName: "A. Jahin" }, starRating: "FIVE", createTime: "2026-11-04T18:55:12.123Z" }, 7)],
  existing);
ok("different name is NOT fuzzily merged", r4.inserts.length === 1 && r4.adopts.length === 0);

// an undated fresh review can never match anything
const r5 = reconcile([normalizeReview({ reviewId: "U", reviewer: { displayName: "Anusha Jahin" }, starRating: "FIVE" }, 7)], existing);
ok("undated review inserts rather than guessing a match", r5.inserts.length === 1);

ok("empty inputs are safe", (() => { const x = reconcile([], []); return x.inserts.length === 0 && x.adopts.length === 0; })());
ok("null inputs are safe", (() => { const x = reconcile(null, null); return x.inserts.length === 0 && x.adopts.length === 0; })());

// ── sweep status ─────────────────────────────────────────────────────────
ok("complete sweep", sweepStatus(564, 564, 12).complete === true);
ok("short sweep flagged", (() => { const s = sweepStatus(560, 564, 12); return s.complete === false && s.missing === 4; })());
ok("over-count is not 'missing'", sweepStatus(565, 564, 12).missing === 0);
ok("no total -> complete is null, not true", sweepStatus(10, null, 1).complete === null);
ok("no total says why", /cannot be checked/.test(sweepStatus(10, null, 1).note));
ok("zero reviews is complete", sweepStatus(0, 0, 1).complete === true);

console.log((fail === 0 ? "ALL PASS" : "FAILURES") + " — " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);

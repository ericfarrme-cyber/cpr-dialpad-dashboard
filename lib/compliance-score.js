// Ticket compliance scoring — the one place the role-split weights live.
//
// PAYROLL. These numbers feed ticket compliance → the scorecard's Compliance
// category (30% of an employee's overall score) → tier → streak bonuses. Any
// change here needs Eric's sign-off.
//
// WHY THIS FILE EXISTS: this maths was copy-pasted into four files —
// tickets/route.js, scorecard/route.js, flags/route.js and ComplianceTab.js.
// Four copies of a payroll formula is three chances for them to drift, and the
// scorecard copy is the one that pays people. They were verified identical
// before being replaced by this module.
//
// Compliance is recomputed AT READ TIME from the stored sub-scores, so a change
// in here is retroactive across every ticket ever graded — unlike a change to
// the grading prompt, which only affects tickets graded afterwards. That is why
// the secondary-contact rule below is dated rather than unconditional.

// ── Role-split weights ──────────────────────────────────────────────────────
// Intake role:  diagnostics 30, payment 20, contact 5   (payment N/A: 30 + 5)
// Repair role:  notes 25, pickup 20                     (payment N/A: 40 + 25)
var W_DIAG = 30, W_PAY = 20, W_CONTACT = 5;
var W_NOTES = 25, W_PICKUP = 20;
var W_NOTES_NA = 40, W_PICKUP_NA = 25;

// ── Secondary contact bonus (Eric, 2026-10-02) ──────────────────────────────
// "I think we just give three points or something like that to someone on the
// ticket grading if they add the secondary contact."
//
// A flat bonus on the INTAKE role score when the ticket carries a second phone
// number. Taken from `customer_phones_all`, which is stored on every row and is
// 100% populated — a fact in the data, not a judgement the grader has to make,
// so it needs no re-grading and cannot drift with prompt wording.
//
// ⚠ MEASURED IMPACT, September 2026, before choosing a number. Contact is only
// 5 of the 55 points in the intake score, and compliance is only 30% of the
// employee score, so a bonus here arrives heavily diluted:
//
//   bonus   at today's capture rate    if everyone captured every time
//   +3      +0.05 to +0.15 overall     +0.43 to +0.55
//   +10     +0.15 to +0.50             +1.43 to +1.84
//   +25     +0.29 to +1.01             +3.07 to +4.21
//
// Tiers sit 15 points apart (Silver 40, Gold 55, Platinum 70), and in September
// Aerick was 2.0 from Platinum. At +25 this rule could move a tier on contact
// collection alone, which pays real money; at +3 it is invisible. +10 is the
// band that is visible on a scorecard without being able to buy a tier.
//
// September capture rates, for reference: Aerick 27%, Andrew 20%, Matt 20%,
// Alyssa 18%, Luke 12%, Duncan 11%, Samuel 10%, Alec 9%.
export var SECONDARY_CONTACT_BONUS = 3;

// Dated, not a flag. Compliance is recomputed at read time, so an undated rule
// would silently restate every month already reported — including months whose
// tiers have been snapshotted and whose bonuses have been paid. Periods are
// "YYYY-MM" strings, so string comparison is date comparison.
export var SECONDARY_CONTACT_EFFECTIVE_PERIOD = "2026-10";

export function secondaryContactApplies(dateClosed) {
  if (!SECONDARY_CONTACT_BONUS) return false;
  if (!dateClosed) return false;
  return String(dateClosed).slice(0, 7) >= SECONDARY_CONTACT_EFFECTIVE_PERIOD;
}

// Count distinct phone numbers on a ticket. `customer_phones_all` is a JSON
// array of digit strings; it arrives as an array from PostgREST and as a string
// from anything that has been through JSON.stringify, so both are handled.
// Compared on the last 10 digits, which collapses "+1" and formatting variants
// rather than counting one number twice.
export function phoneNumberCount(phonesAll) {
  if (!phonesAll) return 0;
  var arr = phonesAll;
  if (!Array.isArray(arr)) {
    try { arr = JSON.parse(String(phonesAll)); } catch (e) { arr = String(phonesAll).split(/[,;|]/); }
  }
  if (!Array.isArray(arr)) return 0;
  var seen = {};
  arr.forEach(function (x) {
    var d = String(x == null ? "" : x).replace(/\D/g, "");
    if (d.length >= 10) seen[d.slice(-10)] = 1;
  });
  return Object.keys(seen).length;
}

export function hasSecondaryContact(t) {
  return phoneNumberCount(t && t.customer_phones_all) >= 2;
}

// Did this ticket actually earn the bonus? Both conditions, so a caller can
// show the reason rather than an unexplained couple of points.
export function secondaryContactBonusFor(t) {
  if (!t) return 0;
  if (!secondaryContactApplies(t.date_closed)) return 0;
  return hasSecondaryContact(t) ? SECONDARY_CONTACT_BONUS : 0;
}

// ── Scores ──────────────────────────────────────────────────────────────────
export function paymentIsNA(t) {
  if (t == null) return false;
  if (parseFloat(t.payment_score) !== 100) return false;
  var n = String(t.payment_notes || "").toLowerCase();
  return n.indexOf("not applicable") >= 0 || n.indexOf("n/a") >= 0 || n.indexOf("no parts") >= 0;
}

export function computeIntakeRoleScore(t) {
  if (!t) return null;
  var diag = t.diagnostics_score, pay = t.payment_score, contact = t.contact_score;
  if (diag == null && contact == null) return null;
  diag = diag == null ? 0 : parseFloat(diag);
  contact = contact == null ? 0 : parseFloat(contact);
  pay = pay == null ? 0 : parseFloat(pay);

  var score = paymentIsNA(t)
    ? (diag * W_DIAG + contact * W_CONTACT) / (W_DIAG + W_CONTACT)
    : (diag * W_DIAG + pay * W_PAY + contact * W_CONTACT) / (W_DIAG + W_PAY + W_CONTACT);

  // Capped at 100 so a ticket score can never exceed the scale every consumer
  // assumes. In practice the cap almost never binds: the best achievable score
  // without a second phone is 99.
  var bonus = secondaryContactBonusFor(t);
  if (bonus) score = Math.min(100, score + bonus);

  return Math.round(score);
}

export function computeRepairRoleScore(t) {
  if (!t) return null;
  var notes = t.notes_score, pickup = t.categorization_score;
  if (notes == null && pickup == null) return null;
  notes = notes == null ? 0 : parseFloat(notes);
  pickup = pickup == null ? 0 : parseFloat(pickup);
  if (paymentIsNA(t)) return Math.round((notes * W_NOTES_NA + pickup * W_PICKUP_NA) / (W_NOTES_NA + W_PICKUP_NA));
  return Math.round((notes * W_NOTES + pickup * W_PICKUP) / (W_NOTES + W_PICKUP));
}

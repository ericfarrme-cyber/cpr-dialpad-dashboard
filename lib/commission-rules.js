// Commission rules that change on a date. commission_config carries rates and
// an on/off flag, but a flag is not dated: flipping cleaning_rate off would
// also zero August, a month already paid. A rule with an effective period
// keeps history as it was paid and applies the change forward.
//
// PAYROLL — every constant here needs Eric's sign-off before it changes.

// Charge-port cleanings stopped paying commission after August 2026 (Eric,
// 2026-09-21: "just keep CLN" — the 10% on cleaning SALES stays). Periods are
// "YYYY-MM" strings, so string comparison is date comparison.
export var CLEANING_COMMISSION_LAST_PERIOD = "2026-08";

// The one person the non-phone repair bonus pays ($100 at $15,000/month of
// non-phone profit, +$50 per full $1,000 above). The Paycheck tab and the
// Bonus Ledger both read this, so they cannot name different people.
export var NON_PHONE_BONUS_EMPLOYEE = "Duncan Hitti";

export function cleaningCommissionApplies(period) {
  if (!period) return true;
  return String(period).slice(0, 7) <= CLEANING_COMMISSION_LAST_PERIOD;
}

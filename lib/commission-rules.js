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

export function cleaningCommissionApplies(period) {
  if (!period) return true;
  return String(period).slice(0, 7) <= CLEANING_COMMISSION_LAST_PERIOD;
}

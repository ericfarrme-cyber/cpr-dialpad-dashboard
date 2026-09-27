// What we take when a part goes on order.
//
// Eric, 2026-09-27: half the repair. Flat, regardless of part price.
//
// He first proposed "part price, or 50% of the repair, whichever is more" and
// then asked whether flat 50% was fairer. It is, and the reason is in the data
// rather than in the principle:
//
//  • Covering the part is the right instinct, but the sheet's part costs are
//    the ones we already agreed not to trust. Two active rows price the part
//    ABOVE the repair — iPhone 16 Pro OLED $230 on a $229.99 screen, 16 Pro
//    Max OLED $284 on $239.99 — and those two alone were 56% of the entire
//    measured gap between the two rules. A deposit computed from a wrong
//    number is wrong exactly where the sheet is wrong.
//  • What flat 50% gives up is small and it is in one place. Across 6 months,
//    assuming the worst (every job a part order, every one abandoned), the
//    under-coverage sits on non-consigned Samsung screens — S22 Ultra $94,
//    S23 Ultra $34, Note 20 Ultra $75 short. The sheet already flags those
//    rows; when there is real part-order data, that flag is where a second
//    rule belongs, not a formula over stale costs.
//  • And it is one sentence on the phone: half now, half at pickup. Median
//    deposit $90, 90th percentile $200 across the 629 bookable rows.
//
// "Repair price" is what the customer was quoted, not what the sheet says, so
// a discounted quote takes half of the discounted number. The part price is
// still reported when we know it, so a deposit that doesn't cover the part is
// visible rather than silent.

export var suggestDeposit = function(quoted, partPrice) {
  var q = parseFloat(quoted);
  if (!isFinite(q) || q <= 0) return null;
  var p = parseFloat(partPrice);
  var part = isFinite(p) && p > 0 ? p : null;
  var amount = Math.round(q * 50) / 100;
  return { amount: amount, part: part, under_part: part !== null && part > amount + 0.005 };
};

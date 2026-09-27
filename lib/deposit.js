// What we take when a part goes on order.
//
// Eric, 2026-09-27: "Let's start at part price for deposit or 50% repair
// price, whichever is more."
//
// Two cautions worth keeping in the code rather than in someone's head:
//
//  1. The sheet's part costs are stale on the screens — Eric, 2026-09-11:
//     "disregard those". Two active rows price the part ABOVE the repair
//     (iPhone 16 Pro Max OLED: $284 part on a $239.99 screen) and about a
//     dozen land above 70% of the job. So the deposit is capped at the price
//     the customer was actually quoted — a deposit larger than the repair
//     cannot be collected — and `capped` says when that happened, which is
//     also a list of the part costs worth fixing.
//  2. "Repair price" is what the customer was told, not what the sheet says.
//     A discounted quote takes half of the discounted number.

export var suggestDeposit = function(quoted, partPrice) {
  var q = parseFloat(quoted);
  if (!isFinite(q) || q <= 0) return null;
  var p = parseFloat(partPrice);
  var part = isFinite(p) && p > 0 ? p : null;
  var half = Math.round(q * 50) / 100;
  var raw = part !== null && part > half ? part : half;
  var basis = part !== null && part > half ? "part" : "half";
  var capped = raw > q;
  var amount = Math.round((capped ? q : raw) * 100) / 100;
  return { amount: amount, basis: basis, part: part, half: half, capped: capped };
};

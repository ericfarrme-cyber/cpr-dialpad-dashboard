// Does the place Google returned actually look like one of our shops?
//
// WHY THIS EXISTS: a Places text search will confidently hand back the wrong
// business. On the first real sync (2026-10-18) the query "CPR Indianapolis"
// matched a cardiopulmonary-resuscitation TRAINING company — 5.0 from 131
// reviews about BLS classes and instructors — and it was saved and snapshotted,
// because its place_id was perfectly valid and perfectly unique.
//
// The unique index on place_id caught six other bad matches that collapsed onto
// the main store. It could not catch this one, and this one is the dangerous
// shape: a real place, a clean id, a plausible rating, and nothing to tell
// anyone it is a different company. That number would have flowed into the TV
// tile and the review bonus.
//
// So a match is only accepted when the name reads like a repair shop AND the
// address names the town we expect. Anything else is reported with what it
// matched and never saved — an unresolved listing is a visible gap, a wrong one
// is a number nobody questions.

var SHOP_NAME = /(cell\s*phone\s*repair|phone\s*repair|computer\s*repair|console\s*repair|electronics\s*at\s*cpr|\bcpr\b)/i;

// Towns each store's listings can legitimately sit in.
var STORE_TOWNS = {
  fishers: /fishers|noblesville/i,
  bloomington: /bloomington/i,
  indianapolis: /indianapolis|indpls/i,
};

// "CPR" is ambiguous: it is our chain and it is also cardiopulmonary
// resuscitation. These phrases mean we matched a first-aid trainer, which is
// the single most likely wrong answer for any query containing the letters.
var NOT_US = /(\bBLS\b|\bACLS\b|\bPALS\b|first[\s-]?aid|resuscitat|life[\s-]?support|certification|training|heartsaver|aed\b|instructor)/i;

export function placeLooksLikeOurs(listing, matchedName, address) {
  var name = String(matchedName || "");
  var addr = String(address || "");

  if (!name) return { ok: false, why: "Google returned no name for that place" };

  if (NOT_US.test(name)) {
    return { ok: false, why: 'matched "' + name + '", which is a first-aid / CPR training provider, not a repair shop' };
  }
  if (!SHOP_NAME.test(name)) {
    return { ok: false, why: 'matched "' + name + '", which does not read as a phone or computer repair shop' };
  }

  // Competitor rows carry no store, so there is no town to check against.
  var town = listing && listing.store ? STORE_TOWNS[String(listing.store).toLowerCase()] : null;
  if (town && addr && !town.test(addr)) {
    return { ok: false, why: 'matched "' + name + '" at ' + addr + ', which is not in ' + listing.store };
  }

  return { ok: true };
}

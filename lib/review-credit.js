// Who does a Google review credit?
//
// WHY THIS IS NOT lib/roster-resolver.js: that resolver matches a machine field
// — a Dialpad transcript name, a RepairQ employee column — where a loose alias
// is a cheap win. This matches free customer prose, where the same looseness is
// a disaster. `employee_roster.aliases` carries "And" for Andrew McLelland, and
// on the first pass it matched the word "and" in 26 of 31 reviews.
//
// Aliases here were set by Eric on 2026-10-19, one at a time:
//   - "Eric" DOES credit Aerick Long. Customers write it constantly and in a
//     review about service it means the tech, not the owner.
//   - "Sam" DOES credit Samuel Tomey despite being three letters. Two real
//     Indianapolis reviews say exactly that and nothing else matches it.
//   - "And" does NOT credit Andrew McLelland. Only Andrew, Andy or Drew.
//
// A credit from here is a PROPOSAL. It never pays on its own — a person
// confirms it first. See the review bonus rules.

export var REVIEW_ALIASES = {
  "Aerick Long":      ["aerick", "eric", "erik", "arick"],
  "Alyssa Parent":    ["alyssa", "elyssa"],
  "Alec Wilcher":     ["alec", "wilcher"],
  "Andrew McLelland": ["andrew", "andy", "drew", "mclelland"],
  "Duncan Hitti":     ["duncan", "hitti"],
  "Luke Stirling":    ["luke", "lucas", "stirling"],
  "Matthew Slade":    ["matthew slade", "slade"],
  "Samuel Tomey":     ["sam", "samuel", "tomey"],
};

// Deliberately excluded, and why — so nobody "fixes" this by adding them back:
//   "and"    the English conjunction (Andrew)
//   "derek"  a different first name entirely (was on Aerick's transcript list)
//   "matt"   too close to "matter", "matte"; Matthew Slade is salaried anyway
//   "al"     "all", "also", "alarm" (Alec)
//   "luc"    "luck", "lucky" (Luke)
//   "ma"     everything (Mahmoud)
export var EXCLUDED_ALIASES = ["and", "derek", "matt", "al", "ali", "luc", "ma", "may"];

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Whole-word, case-insensitive. "Sam" must not fire inside "same" or "Samantha",
// which is the only reason a three-letter alias is safe at all.
function mentions(text, alias) {
  return new RegExp("\\b" + esc(alias) + "\\b", "i").test(String(text || ""));
}

// Returns every roster person the review names. `eligible` is the set of people
// who can actually be paid; anyone else is still credited (so the screen can say
// "Matt was named") but flagged, never quietly dropped.
export function creditReview(text, roster) {
  var out = [];
  (roster || []).forEach(function (p) {
    var name = typeof p === "string" ? p : p.name;
    var aliases = REVIEW_ALIASES[name];
    if (!aliases) return;
    var hit = aliases.filter(function (a) { return mentions(text, a); });
    if (!hit.length) return;
    out.push({
      name: name,
      matched: hit,
      payable: typeof p === "string" ? true : p.bonus_eligible !== false,
    });
  });
  return out;
}

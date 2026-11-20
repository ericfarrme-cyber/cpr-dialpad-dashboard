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
  // 2026-11-20 audit: "Aeric" (Fishers main, 11-08) and "Dunkin" (Indy
  // consoles, 11-19) are real customer spellings that paid nobody.
  "Aerick Long":      ["aerick", "eric", "erik", "arick", "aeric", "aerik", "erick"],
  "Alyssa Parent":    ["alyssa", "elyssa"],
  "Alec Wilcher":     ["alec", "wilcher"],
  "Andrew McLelland": ["andrew", "andy", "drew", "mclelland"],
  "Duncan Hitti":     ["duncan", "hitti", "dunkin", "dunken", "duncun", "dunkan"],
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

// ── spellings we have not seen yet ──────────────────────────────────────────
// A customer who writes "Dunkin" for Duncan names him as surely as one who
// spells it right, and the alias list only learns that after somebody notices.
// So any capitalised word close to an alias (same first letter, alias at least
// 5 letters, length within one, at most 2 letters different -- 1 for a 5-letter
// alias; "SAME" must not suggest Sam or Slade) is offered as "possibly ___?" on the review. It is
// a HINT for the person confirming credits, never a credit: it pays nobody
// until the spelling is added to REVIEW_ALIASES above.
function editDistance(a, b) {
  var m = a.length, n = b.length, d = [];
  for (var i = 0; i <= m; i++) { d[i] = [i]; }
  for (var j = 0; j <= n; j++) { d[0][j] = j; }
  for (i = 1; i <= m; i++) {
    for (j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}
export function possibleNames(text, alreadyCredited) {
  var done = {};
  (alreadyCredited || []).forEach(function(c) { done[c.name || c] = 1; });
  var words = String(text || "").match(/\b[A-Z][a-zA-Z]{3,}\b/g) || [];
  var out = [];
  Object.keys(REVIEW_ALIASES).forEach(function(name) {
    if (done[name]) return;
    var hit = null;
    words.forEach(function(w) {
      var lw = w.toLowerCase();
      if (EXCLUDED_ALIASES.indexOf(lw) >= 0) return;
      REVIEW_ALIASES[name].forEach(function(a) {
        if (hit || a.length < 5 || a.indexOf(" ") >= 0 || a[0] !== lw[0] || a === lw) return;
        if (Math.abs(a.length - lw.length) > 1) return;
        if (editDistance(a, lw) <= (a.length >= 6 ? 2 : 1)) hit = w;
      });
    });
    if (hit) out.push({ name: name, word: hit });
  });
  return out;
}

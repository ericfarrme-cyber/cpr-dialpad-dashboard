// ─────────────────────────────────────────────────────────────────────────────
// ROSTER NAME RESOLVER
//
// One conservative name→person resolver, built LIVE from employee_roster.
// Extracted from app/api/dialpad/call-leaders/route.js on 2026-09-10 so the
// employee-facing views can use the SAME rules. Two copies of a matcher that
// decides who gets credit for a call would eventually disagree, and the
// disagreement would be silent.
//
// The rules, unchanged from the original:
//   • Candidates per person: full name + first name + last name + roster aliases.
//   • Matching is WHOLE-STRING and case-insensitive. Never substring — substring
//     matching is what cross-attributes "Al" to Alyssa and "Duncan/Sam" to Duncan.
//   • Risky aliases are denylisted.
//   • Any alias that resolves to 2+ people is dropped entirely. Nobody gets the
//     credit; the call falls to Unknown. Silent false credit is worse than a gap.
// ─────────────────────────────────────────────────────────────────────────────

// Aliases too risky to credit automatically — generic first names that could be
// anyone, cross-person ambiguity, or transcription mis-hears.
//
// NOTE: "eric"/"derek" are intentionally NOT here. They are common transcriptions
// of "Aerick" and are handled as explicit roster aliases on Aerick Long's row.
// Keeping them off the hard denylist lets the roster decide; they credit nobody
// unless a roster row lists them, so there's no auto-credit risk.
export var RISKY_ALIASES = [
  "melissa", "duncan/sam", "fellis",
  "mood", "maud", "mau", "ma", "may", "bendy", "wendy",
];

// Build the alias→canonical resolver from roster rows.
// Returns { map, ambiguous }:
//   map[alias]       -> canonical full name
//   ambiguous[alias] -> true when 2+ people claimed it (dropped from map)
export function buildResolver(rosterRows) {
  var risky = {};
  RISKY_ALIASES.forEach(function(a) { risky[a] = true; });

  var map = {};
  var collide = {};

  (rosterRows || []).forEach(function(r) {
    if (!r || !r.name) return;
    if (r.active === false) return; // skip deactivated roster rows
    var name = String(r.name).trim();
    var parts = name.split(/\s+/);

    var cands = {};
    cands[name.toLowerCase()] = true;
    if (parts[0]) cands[parts[0].toLowerCase()] = true;
    if (parts.length > 1) cands[parts[parts.length - 1].toLowerCase()] = true;

    var aliases = Array.isArray(r.aliases) ? r.aliases : [];
    aliases.forEach(function(a) {
      if (a == null) return;
      var al = String(a).trim().toLowerCase();
      if (al && !risky[al]) cands[al] = true;
    });

    Object.keys(cands).forEach(function(c) {
      if (risky[c]) return;
      if (map[c] && map[c] !== name) collide[c] = true;
      map[c] = name;
    });
  });

  // Any alias that resolved to 2+ people is unsafe — drop it to Unknown.
  Object.keys(collide).forEach(function(c) { delete map[c]; });
  return { map: map, ambiguous: collide };
}

// Resolve a raw audit "employee" string to a canonical person, or null (Unknown).
export function resolveName(raw, map) {
  if (!raw) return null;
  var key = String(raw).trim().toLowerCase();
  if (!key || key === "unknown") return null;
  return map[key] || null;
}

// A looser resolver for RepairQ's people fields, which carry formats the audit
// transcripts never produce: "Last, First" and nickname-plus-surname.
//
// Still refuses to guess. Beyond an exact hit it will only accept a name when
// TWO independent tokens agree on the same person, which is what keeps it from
// repeating the substring mistake:
//
//   "Sam Tomey"        sam -> Samuel Tomey, tomey -> Samuel Tomey   ACCEPT
//   "McLelland, Andrew" flips to an exact full-name match           ACCEPT
//   "Alex Ferguson"    alex -> Alec Wilcher, ferguson -> nobody     REJECT
//   "Jordan Ross"      neither token is on the roster               REJECT
export function resolveNamePersonish(raw, map) {
  if (!raw) return null;
  var key = String(raw).trim().toLowerCase();
  if (!key || key === "unknown") return null;

  if (map[key]) return map[key];

  // "Last, First" -> "First Last"
  if (key.indexOf(",") >= 0) {
    var parts = key.split(",").map(function(p) { return p.trim(); }).filter(Boolean);
    if (parts.length === 2) {
      var flipped = parts[1] + " " + parts[0];
      if (map[flipped]) return map[flipped];
    }
  }

  // Two tokens must independently point at the same person.
  var tokens = key.replace(/,/g, " ").split(/\s+/).filter(function(t) { return t.length >= 3; });
  if (tokens.length >= 2) {
    var hits = {};
    tokens.forEach(function(t) { if (map[t]) hits[map[t]] = (hits[map[t]] || 0) + 1; });
    var names = Object.keys(hits);
    if (names.length === 1 && hits[names[0]] >= 2) return names[0];
  }
  return null;
}

// Is this a machine or a vendor rather than a person? These are legitimate rows
// in ticket_grades — "Assurant ServiceNetwork" alone owns hundreds of tickets —
// but they must never appear in an employee performance view.
export function isSystemActor(raw) {
  if (!raw) return false;
  return /assurant|service\s*network|servicenetwork|consigned inventory|\bapi\b|^n\/a$/i.test(String(raw).trim());
}

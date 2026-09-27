// What agents type into the Price Book is not what the sheet says.
//
// Mined from the reason line of 630 booked appointments — the closest record
// we have of the words a person uses while a customer is on the phone:
//
//   screen/scrn 137 · oled 103 · hdmi 98 · batt 95 · ps4/ps5 95 · "## pro" 90
//   s## 56 · cln 53 · diag 46 · "## pm" 41 · series s/x 30 · water 26
//   ip## 24 · bg 21 · lcd 19 · "charge port"/cp 13 · a## 11 · dt 8 · xr/xs 5
//
// Some of those already hit: "batt" is a prefix of "battery", "s23" is a token
// of "Galaxy S23", "oled" is a tier. The ones below are the ones that found
// nothing — "17 pm bg" matched no row at all before this file existed.
//
// Expansion is additive by construction: a term matches if the raw token
// matches OR every token of one of its expansions matches. Nothing that used
// to be found can stop being found.

export var tokenize = function(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9+"\s.-]/g, " ").split(/\s+/).filter(Boolean);
};

// Shorthand → the words the sheet actually uses. Multi-word expansions require
// every word, so "bg" only matches a row that says both "back" and "glass".
export var SHORTHAND = {
  pm: ["pro", "max"], promax: ["pro", "max"], ppm: ["pro", "max"],
  bg: ["back", "glass"], backglass: ["back", "glass"], rearglass: ["back", "glass"],
  cp: ["charge", "port"], chgport: ["charge", "port"], chargeport: ["charge", "port"],
  scrn: ["screen"], scr: ["screen"], glass: ["screen"], display: ["screen"],
  cln: ["cleaning"], clng: ["cleaning"],
  diag: ["diagnostic"], dx: ["diagnostic"],
  dt: ["data", "transfer"], xfer: ["transfer"],
  wd: ["water", "damage"], liquid: ["water"],
  batt: ["battery"], bat: ["battery"],
  cam: ["camera"], spkr: ["speaker"], mic: ["microphone"],
  mbp: ["macbook", "pro"], mba: ["macbook", "air"],
  zflip: ["z", "flip"], zfold: ["z", "fold"],
  sw: ["switch"], oem: ["oem"],
};

// Rules that need a number: "ip17" → iPhone 17, "s23u" → Galaxy S23 Ultra.
var RULES = [
  [/^ip(\d{1,2}[a-z]?)$/, function(m) { return ["iphone", m[1]]; }],
  [/^iph(\d{1,2}[a-z]?)$/, function(m) { return ["iphone", m[1]]; }],
  [/^s(\d{1,2})u$/, function(m) { return ["s" + m[1], "ultra"]; }],
  [/^s(\d{1,2})p$/, function(m) { return ["s" + m[1], "plus"]; }],
  [/^ps(\d)$/, function(m) { return ["playstation", m[1]]; }],
  [/^xb(x|s)$/, function(m) { return ["xbox", "series", m[1]]; }],
];

// Every reading of one typed word. The first is always the word itself.
export var expandTerm = function(t) {
  var alts = [[t]];
  if (SHORTHAND[t]) alts.push(SHORTHAND[t]);
  for (var i = 0; i < RULES.length; i++) {
    var m = t.match(RULES[i][0]);
    if (m) alts.push(RULES[i][1](m));
  }
  return alts;
};

// Does this row's text satisfy everything that was typed? `hay` is a list of
// lowercase tokens; a term is satisfied when some reading of it is fully present.
export var matchesQuery = function(hay, terms) {
  return terms.every(function(t) {
    return expandTerm(t).some(function(alt) {
      return alt.every(function(word) {
        return hay.some(function(h) { return h.indexOf(word) >= 0; });
      });
    });
  });
};

// Brand and product-line words that are not in the sheet's own text — "ps5"
// for "Play Station 5 (all models)", "samsung" for a Galaxy.
export var aliasesFor = function(canonical, device) {
  var out = [];
  var c = String(canonical || "");
  var m;
  if ((m = c.match(/^PlayStation (\d)/))) out.push("ps" + m[1], "playstation", "sony");
  if ((m = c.match(/^Xbox Series ([XS])/))) out.push("series" + m[1].toLowerCase(), "xbox" + m[1].toLowerCase(), "microsoft");
  if (/^Xbox/.test(c)) out.push("xbox", "microsoft");
  if (/^Galaxy/.test(c)) out.push("samsung", "galaxy");
  if (/^Nintendo/.test(c)) out.push("nintendo", "switch");
  if (/^iPhone|^iPad|^MacBook|^iMac/.test(c)) out.push("apple");
  if (/^Pixel/.test(c)) out.push("google", "pixel");
  if (/macbook/i.test(device)) out.push("mac", "laptop");
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE MODEL RESOLVER
//
// Calls and tickets name the same device differently. The AI writes the call's
// device_type from the transcript ("iPhone 14 Pro Max", "PS5", "Samsung S23
// Ultra"); RepairQ writes the ticket's device from its catalogue ("Apple iPhone
// 14 Pro Max", "Sony Playstation 5"). Comparing demand to repairs means both
// sides have to land on one canonical name.
//
// Measured 2026-09-10: 1,155 distinct call device_type values against 240 ticket
// device values. A naive strip-the-brand comparison matched only 109 of them.
//
// Rules, in the spirit of lib/roster-resolver.js:
//   • Conservative. A string that does not clearly name a model resolves to null
//     rather than being forced into the nearest bucket.
//   • Nothing is silently dropped. Unresolved values come back with a reason so
//     the UI can show them — "Not mentioned" (148 calls) is itself a coaching
//     signal about staff not capturing what the customer has.
//   • Multi-device strings ("iPhone SE, iPhone 14") resolve to several models.
// ─────────────────────────────────────────────────────────────────────────────

export var FAMILIES = ["phone", "console", "tablet", "computer", "wearable", "other"];

// Qualifiers that carry no model information. Stripped before matching so
// "iPhone 15 (base model)" and "iPhone 15" are the same thing.
var NOISE = [
  "base model", "model not specified", "model unspecified", "not specified",
  "generation unclear", "model unclear", "unspecified", "unknown model",
  "make/model not specified", "make/model not mentioned", "model not mentioned",
  "not mentioned", "unknown", "n/a",
];

var BRANDS = ["apple", "sony", "samsung", "microsoft", "google", "nintendo", "motorola", "lg", "oneplus", "lenovo", "hp", "dell", "asus", "acer"];

// Strings that name a category but not a model. Kept as "generic" so demand for
// "a laptop" is still visible without pretending we know which one.
var GENERIC = {
  "phone": "phone", "cell phone": "phone", "smartphone": "phone", "iphone": "phone",
  "android": "phone", "android phone": "phone", "samsung": "phone", "samsung galaxy": "phone",
  "laptop": "computer", "computer": "computer", "pc": "computer", "macbook": "computer", "mac": "computer",
  "tablet": "tablet", "ipad": "tablet",
  "console": "console", "game console": "console", "gaming console": "console",
  "playstation": "console", "xbox": "console", "nintendo": "console",
  "watch": "wearable", "apple watch": "wearable", "smartwatch": "wearable",
  "galaxy": "phone", "moto": "phone", "motorola": "phone", "pixel": "phone",
  "tv": "other", "ipod": "other",
};

function clean(raw) {
  var s = String(raw || "").toLowerCase();
  s = s.replace(/\(([^)]*)\)/g, " $1 ");          // unwrap parentheticals, keep contents
  s = s.replace(/[^a-z0-9+\/,&\s.-]/g, " ");
  NOISE.forEach(function(n) { s = s.split(n).join(" "); });
  s = s.replace(/\bx\s*\d+\b/g, " ");              // "(x2)" quantity markers
  s = s.replace(/\b5g\b|\bwi-?fi\b|\bcellular\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function stripBrands(s) {
  BRANDS.forEach(function(b) { s = s.replace(new RegExp("\\b" + b + "\\b", "g"), " "); });
  return s.replace(/\s+/g, " ").trim();
}

// ── model matchers, most specific first ──────────────────────────────────────
function matchIphone(s) {
  // iPhone 16E / 15 Pro Max / 13 Mini / SE / XR / XS Max / X
  var m = s.match(/\biphone\s*(\d{1,2}\s*e|\d{1,2}|se|xr|xs|x)\b\s*(pro\s*max|pro|plus|mini|max|air)?/);
  if (!m) return null;
  var num = m[1].replace(/\s+/g, "").toUpperCase();
  var variant = (m[2] || "").replace(/\s+/g, " ").trim();
  if (num === "SE") return "iPhone SE";
  if (num === "XR" || num === "XS" || num === "X") return "iPhone " + num + (variant === "max" ? " Max" : "");
  var vmap = { "pro max": " Pro Max", "pro": " Pro", "plus": " Plus", "mini": " Mini", "max": " Max", "air": " Air" };
  return "iPhone " + num + (vmap[variant.toLowerCase()] || "");
}

function matchGalaxy(s) {
  // Galaxy S23 Ultra / A16 / Note 20 Ultra / Z Flip 3 / Z Fold 4
  var z = s.match(/\b(?:galaxy\s*)?z\s*(flip|fold)\s*(\d{1,2})?/);
  if (z) return "Galaxy Z " + (z[1].charAt(0).toUpperCase() + z[1].slice(1)) + (z[2] ? " " + z[2] : "");
  var note = s.match(/\bnote\s*(\d{1,2})\s*(ultra|plus)?/);
  if (note) return "Galaxy Note " + note[1] + (note[2] ? " " + note[2].charAt(0).toUpperCase() + note[2].slice(1) : "");
  var m = s.match(/\b(?:galaxy\s*)?([sa])\s*(\d{1,3})([a-z])?\b\s*(ultra|plus|fe)?/);
  if (!m) return null;
  var suffix = m[4] ? " " + m[4].charAt(0).toUpperCase() + m[4].slice(1) : "";
  return "Galaxy " + m[1].toUpperCase() + m[2] + (m[3] || "") + suffix;
}

function matchConsole(s) {
  // "play station" with a space is how the price book writes it. Adding the
  // optional space only widens what matches — nothing that resolved before can
  // stop resolving.
  if (/\bps\s*5\b|\bplay\s*station\s*5\b/.test(s)) return /controller/.test(s) ? "PS5 Controller" : "PlayStation 5";
  if (/\bps\s*4\b|\bplay\s*station\s*4\b/.test(s)) return /controller/.test(s) ? "PS4 Controller" : "PlayStation 4";
  if (/\bps\s*3\b|\bplay\s*station\s*3\b/.test(s)) return "PlayStation 3";
  var xb = s.match(/\bxbox\s*(series\s*[xs]|one\s*[sx]?|360)\b/);
  if (xb) {
    var v = xb[1].replace(/\s+/g, " ").trim();
    if (/^series/.test(v)) return "Xbox Series " + v.slice(-1).toUpperCase();
    if (/^one/.test(v)) return "Xbox One" + (v.length > 3 ? " " + v.slice(-1).toUpperCase() : "");
    return "Xbox 360";
  }
  if (/\bswitch\b/.test(s)) return /\boled\b/.test(s) ? "Nintendo Switch OLED" : /\blite\b/.test(s) ? "Nintendo Switch Lite" : "Nintendo Switch";
  if (/\bwii\s*u\b/.test(s)) return "Nintendo Wii U";
  if (/\bwii\b/.test(s)) return "Nintendo Wii";
  if (/\b3ds\b/.test(s)) return "Nintendo 3DS";
  if (/\bdsi\b|\bnintendo ds\b|\bds lite\b/.test(s)) return "Nintendo DS";
  if (/\bgamecube\b/.test(s)) return "Nintendo GameCube";
  return null;
}

function matchIpad(s) {
  if (!/\bipad\b/.test(s)) return null;
  if (/\bpro\b/.test(s)) return "iPad Pro";
  if (/\bair\b/.test(s)) return "iPad Air";
  if (/\bmini\b/.test(s)) return "iPad Mini";
  var g = s.match(/\bipad\s*(\d{1,2})(?:\s*(?:th|st|nd|rd))?\b/);
  if (g) return "iPad " + g[1];
  return "iPad";
}

function matchMac(s) {
  if (/\bmacbook\s*pro\b/.test(s)) return "MacBook Pro";
  if (/\bmacbook\s*air\b/.test(s)) return "MacBook Air";
  if (/\bmacbook\b/.test(s)) return "MacBook";
  if (/\bimac\b/.test(s)) return "iMac";
  return null;
}

function matchMoto(s) {
  var m = s.match(/\bmoto\s*([gexz])\s*(stylus|power|play|plus)?\s*(\d{4})?/);
  if (!m) return null;
  var v = m[2] ? " " + m[2].charAt(0).toUpperCase() + m[2].slice(1) : "";
  return "Moto " + m[1].toUpperCase() + v + (m[3] ? " " + m[3] : "");
}

function matchPixel(s) {
  var m = s.match(/\bpixel\s*(\d{1,2})\s*(pro|a|xl)?/);
  if (!m) return null;
  return "Pixel " + m[1] + (m[2] ? " " + m[2].toUpperCase().replace("PRO", "Pro") : "");
}

function familyOf(canonical) {
  if (/^iPhone|^Galaxy|^Pixel|^Moto/.test(canonical)) return "phone";
  if (/^PlayStation|^Xbox|^Nintendo|Controller$/.test(canonical)) return "console";
  if (/^iPad/.test(canonical)) return "tablet";
  if (/^MacBook|^iMac/.test(canonical)) return "computer";
  if (/Watch/.test(canonical)) return "wearable";
  return "other";
}

// Resolve ONE device phrase. Returns {canonical, family, specified, reason}.
function resolveOne(phrase) {
  var s = clean(phrase);
  if (!s) return { canonical: null, family: null, specified: false, reason: "not_mentioned" };

  var stripped = stripBrands(s);
  // Stripping the brand can empty the string ("Samsung", "Motorola"). The
  // brand alone still says what KIND of device it is.
  if (!stripped) {
    if (/\b(samsung|motorola|google|oneplus|lg)\b/.test(s)) return { canonical: null, family: "phone", specified: false, reason: "generic" };
    if (/\b(sony|nintendo|microsoft)\b/.test(s)) return { canonical: null, family: "console", specified: false, reason: "generic" };
    if (/\b(dell|hp|lenovo|asus|acer)\b/.test(s)) return { canonical: null, family: "computer", specified: false, reason: "generic" };
    return { canonical: null, family: null, specified: false, reason: "not_mentioned" };
  }

  var hit = matchIphone(stripped) || matchConsole(stripped) || matchIpad(stripped)
    || matchMac(stripped) || matchGalaxy(stripped) || matchPixel(stripped) || matchMoto(stripped);
  if (hit) return { canonical: hit, family: familyOf(hit), specified: true, reason: null };

  if (/\bwatch\b/.test(stripped)) return { canonical: "Apple Watch", family: "wearable", specified: true, reason: null };

  // Category named but not a model.
  var key = stripped.replace(/\s+/g, " ").trim();
  if (GENERIC[key]) return { canonical: null, family: GENERIC[key], specified: false, reason: "generic" };
  for (var g in GENERIC) {
    if (new RegExp("\\b" + g.replace(/\//g, "\\/") + "\\b").test(key)) {
      return { canonical: null, family: GENERIC[g], specified: false, reason: "generic" };
    }
  }
  return { canonical: null, family: null, specified: false, reason: "unrecognised" };
}

// Public: a raw device string may name more than one device.
export function resolveModels(raw) {
  var text = String(raw || "").trim();
  if (!text) return [{ canonical: null, family: null, specified: false, reason: "not_mentioned" }];

  var lowered = text.toLowerCase();
  if (NOISE.indexOf(lowered) >= 0) {
    return [{ canonical: null, family: null, specified: false, reason: "not_mentioned" }];
  }

  // Split only on separators that genuinely divide devices. "iPhone 15 Pro Max"
  // must never be split, so spaces and hyphens are not separators.
  var parts = text.split(/\s*(?:,|;|\/|\band\b|&|\bor\b)\s*/i).filter(function(p) { return p && p.trim(); });
  var seen = {};
  var out = [];
  parts.forEach(function(p) {
    var r = resolveOne(p);
    var k = r.canonical || ("~" + r.reason + "~" + (r.family || ""));
    if (seen[k]) return;
    seen[k] = true;
    out.push(r);
  });

  // If splitting produced only unresolved fragments, try the whole string —
  // "Samsung Galaxy S23, Google Pixel" splits fine, but "PlayStation 5 / PS5"
  // is one device written two ways.
  var anySpecified = out.some(function(r) { return r.specified; });
  if (!anySpecified) {
    var whole = resolveOne(text);
    if (whole.specified) return [whole];
  }
  var specified = out.filter(function(r) { return r.specified; });
  return specified.length ? specified : [out[0]];
}

// Convenience for the ticket side, which names exactly one device.
export function resolveModel(raw) {
  return resolveModels(raw)[0];
}

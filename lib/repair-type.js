// ─────────────────────────────────────────────────────────────────────────────
// REPAIR TYPE CLASSIFIER
//
// A model on its own blends repairs that have nothing to do with each other.
// Measured 2026-09-10 on iPhone 15 alone: screens average $183.36, diagnostics
// $58.32, water damage $53.33. An "average price" across those is a number that
// describes no actual transaction.
//
// Two inputs, one taxonomy, so demand and pricing can be compared:
//
//   classifyCatalogItem()  RepairQ line items, e.g.
//                          "Apple iPhone 15 Screen Repair (OLED) - Non Original…"
//                          100% of repair lines carry one.
//
//   classifyInquiry()      the AI's one-line call summary, e.g.
//                          "Customer inquired about same-day screen repair…"
//                          100% present, 84% classify.
//
// Order matters — the first pattern to match wins, so the specific sits above
// the general. HDMI is first because a console HDMI job is the one repair most
// likely to also mention a screen.
// ─────────────────────────────────────────────────────────────────────────────

export var REPAIR_TYPES = [
  "HDMI port", "Screen", "Battery", "Charge port", "Back glass", "Camera",
  "Water damage", "Speaker / mic", "Button", "Drive", "Data transfer",
  "Software", "Board / solder", "Cleaning", "Diagnostic", "Accessory", "Other repair",
];

// Shared vocabulary. Each entry is [type, pattern].
var PATTERNS = [
  ["HDMI port", /\bhdmi\b/i],
  ["Back glass", /back\s*(glass|cover|housing)|rear\s*glass/i],
  ["Charge port", /charg(e|ing)?\s*port|dock\s*connector|usb-?c\s*port|lightning\s*port|(won'?t|not|isn'?t|won not)\s*charg|no\s*longer\s*charg|charging\s*(issue|problem)/i],
  ["Battery", /\bbatter/i],
  ["Screen", /\bscreen|touchscreen|touch\s*screen|\blcd\b|\boled\b|display|digitizer|cracked\s*glass|front\s*glass/i],
  ["Camera", /\bcamera\b|\blens\b/i],
  ["Water damage", /water\s*damage|liquid\s*damage|got\s*wet|spilled|corrosion|water\s*dam/i],
  ["Speaker / mic", /speaker|microphone|\bmic\b|earpiece|no\s*sound|audio\s*(issue|problem)/i],
  ["Button", /\bbutton\b|home\s*key|power\s*key|volume\s*key/i],
  ["Drive", /dis[ck]\s*drive|hard\s*drive|\bssd\b|\bhdd\b|won'?t\s*eject|disc\s*stuck/i],
  ["Data transfer", /data\s*(transfer|recovery|backup|migration)|transfer\s*data|recover\s*(a\s*)?(deleted|lost)|set\s*up\s*(a\s*)?new\s*phone/i],
  ["Software", /software|operating\s*system|virus|malware|boot\s*loop|(won'?t|not)\s*turn(ing)?\s*on|unlock|passcode|apple\s*id|icloud|factory\s*reset/i],
  ["Board / solder", /motherboard|logic\s*board|micro\s*solder|board\s*level|board\s*repair/i],
  ["Cleaning", /\bclean|tune\s*up|dust|overheat/i],
  ["Diagnostic", /diagnos|bench.*(fee|consultation)|consultation\s*fee/i],
];

// Catalog-only: RepairQ files cases and other retail under a repair category.
// They are real lines but they are not repairs, and averaging a $29.99 case into
// a screen price is exactly the blending this module exists to stop.
var CATALOG_ACCESSORY = /\bcase\b|screen\s*protector|tempered\s*glass|charger\b|cable\b|adapter\b|earbuds|headphone/i;
// "Repair - Other" and "Miscellaneous Repair" are a real bucket, not a failure.
var CATALOG_OTHER = /repair\s*-\s*other|miscellaneous\s*repair|\(other\)\s*repair|other\s*repair/i;

function firstMatch(text) {
  for (var i = 0; i < PATTERNS.length; i++) {
    if (PATTERNS[i][1].test(text)) return PATTERNS[i][0];
  }
  return null;
}

// RepairQ scrapes carry tabs, newlines and a trailing "details" blob.
export function cleanCatalogName(raw) {
  var s = String(raw || "").replace(/\s+/g, " ");
  var cut = s.toLowerCase().indexOf(" details");
  if (cut > 0) s = s.slice(0, cut);
  return s.trim();
}

// Returns { type, confident }. `confident` is false when we fell through to a
// catch-all, so the UI can be honest about which rows are a real classification.
export function classifyCatalogItem(raw) {
  var name = cleanCatalogName(raw);
  if (!name || name === "(not found on page)") return { type: null, confident: false };
  if (CATALOG_ACCESSORY.test(name)) return { type: "Accessory", confident: true };
  var hit = firstMatch(name);
  if (hit) return { type: hit, confident: true };
  if (CATALOG_OTHER.test(name)) return { type: "Other repair", confident: true };
  return { type: "Other repair", confident: false };
}

export function classifyInquiry(raw) {
  var text = String(raw || "").trim();
  if (text.length < 6) return { type: null, confident: false };
  var hit = firstMatch(text);
  if (hit) return { type: hit, confident: true };
  return { type: null, confident: false };
}

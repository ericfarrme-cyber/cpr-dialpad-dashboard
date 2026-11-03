// Each store can map to MULTIPLE Dialpad departments. A store's calls are the
// union of all its departments. `dialpadIds` is the source of truth (an array);
// `dialpadId` is kept as a back-compat alias equal to the first id.
//
// To add a department (e.g. "CPR Bloomington 2"), just add its department id to
// that store's `dialpadIds` array. Everything downstream (stats fetch, cron,
// answer rate) fans out over the array automatically.
export const STORES = {
  fishers: {
    name: "CPR Fishers", color: "#E03E3E", light: "#FDEAEA", icon: "F",
    dialpadIds: ["6742743981080576"],
    dialpadId: "6742743981080576",
  },
  bloomington: {
    name: "CPR Bloomington", color: "#1A9E8F", light: "#E6F7F5", icon: "B",
    // TODO: add the "CPR Bloomington 2" department id as a second entry here, e.g.
    // dialpadIds: ["4537318271467520", "PASTE_BLOOMINGTON_2_ID_HERE"],
    dialpadIds: ["4537318271467520"],
    dialpadId: "4537318271467520",
  },
  indianapolis: {
    name: "CPR Indianapolis", color: "#D4A017", light: "#FDF6E3", icon: "I",
    dialpadIds: ["5736761513590784"],
    dialpadId: "5736761513590784",
  },
};
export const STORE_KEYS = Object.keys(STORES);

// Helper: always returns an array of department ids for a store, tolerating
// either the new `dialpadIds` array or a legacy single `dialpadId`.
export function storeDeptIds(storeConfig) {
  if (!storeConfig) return [];
  if (Array.isArray(storeConfig.dialpadIds) && storeConfig.dialpadIds.length > 0) {
    return storeConfig.dialpadIds.filter(Boolean);
  }
  return storeConfig.dialpadId ? [storeConfig.dialpadId] : [];
}
export const TABS = [
  { id: "scorecard", label: "Store Scorecard", icon: "🏪", group: "overview" },
  { id: "overview", label: "Call Performance", icon: "📞", group: "calls" },
  { id: "sales", label: "Sales & Repairs", icon: "💰", group: "performance" },
  { id: "daily_profit", label: "Daily Profit", icon: "📈", group: "performance" },
  { id: "audit", label: "Phone Audit", icon: "🎯", group: "performance" },
  { id: "compliance", label: "Ticket Compliance", icon: "📋", group: "performance" },
  { id: "insights", label: "Insights", icon: "💡", group: "performance" },
  { id: "price_demand", label: "Price & Demand", icon: "🏷️", group: "performance" },
  { id: "employees", label: "Employees", icon: "👥", group: "team" },
  { id: "schedule", label: "Schedule", icon: "📅", group: "team" },
];
// The one place the model string lives. A dated model string hardcoded in
// twelve routes is what caused the June 2026 outage.
export const AI_MODEL = "claude-sonnet-4-6";

export const APP_NAME = "Focused Technologies";
export const APP_SUBTITLE = "CPR Store Operations Dashboard";
export const BRAND = {
  cyan: "#00D4FF",
  purple: "#7B2FFF",
  pink: "#FF2D95",
  gradient: "linear-gradient(135deg, #00D4FF, #7B2FFF)",
  gradientFull: "linear-gradient(135deg, #00D4FF, #7B2FFF, #FF2D95)",
};

// Which of our three stores is this string naming?
//
// Three copies of this had grown up independently — `normalizeStore` in
// call-leaders, `resolveStore` in demand-analysis, and a third in the
// inventory import — each with slightly different reach. This is the union of
// them: it accepts our own keys, RepairQ and Dialpad's "CPR Fishers", a
// WhenIWork location name, and the way people write Indy. Returns null rather
// than a guess, because a store that can't be identified must not be silently
// filed under one.
export function storeKeyFromName(s) {
  if (!s) return null;
  var v = String(s).toLowerCase().replace(/^cpr\s+/, "").trim();
  if (STORE_KEYS.indexOf(v) !== -1) return v;
  if (v.indexOf("fisher") >= 0) return "fishers";
  if (v.indexOf("bloom") >= 0) return "bloomington";
  if (v.indexOf("indian") >= 0 || v.indexOf("indy") >= 0 || v.indexOf("downtown") >= 0) return "indianapolis";
  return null;
}

// ── "that table does not exist yet" ─────────────────────────────────────────
// A migration in this repo is applied by hand (Eric pastes it; there is no DDL
// path from here), so there is always a window where the code is deployed and
// the table is not. A feature being unavailable in that window is fine. A
// feature taking a WORKING SCREEN DOWN with it is not -- the flash-sale read
// added to the price book would have 500'd /prices for every agent until the
// migration ran.
//
// So: a missing table degrades, anything else is loud. The distinction is the
// whole point -- "no sales exist" is TRUE when the table that would hold them
// does not exist, whereas a permission error or a typo must never be read that
// way. PostgREST answers PGRST205 for a table it cannot find in the schema
// cache; Postgres answers 42P01.
export function isMissingTable(err) {
  if (!err) return false;
  var code = String(err.code || "");
  if (code === "PGRST205" || code === "42P01") return true;
  var m = String(err.message || "").toLowerCase();
  return m.indexOf("does not exist") >= 0 && m.indexOf("relation") >= 0
    || m.indexOf("could not find the table") >= 0;
}

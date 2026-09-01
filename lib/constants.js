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
  { id: "employees", label: "Employees", icon: "👥", group: "team" },
  { id: "schedule", label: "Schedule", icon: "📅", group: "team" },
];
export const APP_NAME = "Focused Technologies";
export const APP_SUBTITLE = "CPR Store Operations Dashboard";
export const BRAND = {
  cyan: "#00D4FF",
  purple: "#7B2FFF",
  pink: "#FF2D95",
  gradient: "linear-gradient(135deg, #00D4FF, #7B2FFF)",
  gradientFull: "linear-gradient(135deg, #00D4FF, #7B2FFF, #FF2D95)",
};

export const STORES = {
  fishers: { name: "CPR Fishers", color: "#E03E3E", light: "#FDEAEA", icon: "F", dialpadId: "6742743981080576" },
  bloomington: { name: "CPR Bloomington", color: "#1A9E8F", light: "#E6F7F5", icon: "B", dialpadId: "4537318271467520" },
  indianapolis: { name: "CPR Indianapolis", color: "#D4A017", light: "#FDF6E3", icon: "I", dialpadId: "5736761513590784" },
};
export const STORE_KEYS = Object.keys(STORES);
export const TABS = [
  { id: "overview", label: "Call Performance", icon: "📞", group: "calls" },
  { id: "keywords", label: "Keyword Analysis", icon: "🔍", group: "calls" },
  { id: "missed", label: "Missed Calls", icon: "📵", group: "calls" },
  { id: "callbacks", label: "Callback Tracking", icon: "↩️", group: "calls" },
  { id: "voicemails", label: "Voicemails", icon: "📩", group: "calls" },
  { id: "problems", label: "Problem Calls", icon: "⚠️", group: "calls" },
  { id: "sales", label: "Sales & Repairs", icon: "💰", group: "performance" },
  { id: "audit", label: "Phone Audit", icon: "🎯", group: "performance" },
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

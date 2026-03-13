export const STORES = {
  fishers: { name: "CPR Fishers", color: "#E03E3E", light: "#FDEAEA", icon: "F", dialpadId: "6742743981080576" },
  bloomington: { name: "CPR Bloomington", color: "#1A9E8F", light: "#E6F7F5", icon: "B", dialpadId: "4537318271467520" },
  indianapolis: { name: "CPR Indianapolis", color: "#D4A017", light: "#FDF6E3", icon: "I", dialpadId: "5736761513590784" },
};
export const STORE_KEYS = Object.keys(STORES);
export const TABS = [
  { id: "overview", label: "Call Performance", icon: "📞" },
  { id: "keywords", label: "Keyword Analysis", icon: "🔍" },
  { id: "missed", label: "Missed Calls", icon: "📵" },
  { id: "callbacks", label: "Callback Tracking", icon: "↩️" },
  { id: "voicemails", label: "Voicemails", icon: "📩" },
  { id: "problems", label: "Problem Calls", icon: "⚠️" },
  { id: "audit", label: "Phone Audit", icon: "🎯" },
  { id: "employees", label: "Employees", icon: "👥" },
  { id: "schedule", label: "Schedule", icon: "📅" },
];

// ═══════════════════════════════════════════════════════════════
// Data Layer — fetches live Dialpad data via our API routes,
// transforms it into the shapes our dashboard components expect,
// and falls back to sample data if the API is unreachable.
// ═══════════════════════════════════════════════════════════════

import { STORES } from "./constants";

const STORE_KEYS = Object.keys(STORES);

// ── API Fetcher with polling ──

export async function fetchLiveStats() {
  try {
    // Step 1: Initiate the report
    const initRes = await fetch("/api/dialpad/stats?action=initiate");
    const initJson = await initRes.json();
    if (!initJson.success || !initJson.requestId) {
      console.error("Initiate failed:", initJson.error);
      return null;
    }

    // Step 2: Poll until ready (every 8 seconds, up to 10 attempts)
    const requestId = initJson.requestId;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      const pollRes = await fetch(
        `/api/dialpad/stats?action=poll&requestId=${requestId}`
      );
      const pollJson = await pollRes.json();
      if (pollJson.state === "completed" && pollJson.data) {
        return pollJson.data;
      }
      if (!pollJson.success && pollJson.error) {
        console.error("Poll error:", pollJson.error);
        return null;
      }
    }
    console.error("Polling timed out");
    return null;
  } catch (err) {
    console.error("Failed to fetch live stats:", err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Data Transformers — convert Dialpad CSV rows into dashboard format
// ═══════════════════════════════════════════════════════════════

// Map department names from Dialpad to our store keys
function getStoreKey(row) {
  const dept =
    (row["Department"] || row["Target Name"] || row["target_name"] || row["Group Name"] || "").toLowerCase();
  if (dept.includes("fishers")) return "fishers";
  if (dept.includes("bloomington")) return "bloomington";
  if (dept.includes("indianapolis") || dept.includes("indy")) return "indianapolis";
  return null;
}

/**
 * Transform raw call records into daily call volume data
 */
export function transformToDailyCalls(rows) {
  const dailyMap = {};

  rows.forEach((row) => {
    const storeKey = getStoreKey(row);
    if (!storeKey) return;

    const dateStr =
      row["Date"] || row["Call Date and Time"] || row["date"] || row["Started (UTC)"];
    if (!dateStr) return;

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    const dateKey = `${d.getMonth() + 1}/${d.getDate()}`;

    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = { date: dateKey };
      STORE_KEYS.forEach((k) => {
        dailyMap[dateKey][`${k}_total`] = 0;
        dailyMap[dateKey][`${k}_answered`] = 0;
      });
    }

    dailyMap[dateKey][`${storeKey}_total`]++;

    const status = (
      row["Status"] || row["Call Status"] || row["status"] || row["Disposition"] || ""
    ).toLowerCase();
    if (
      status.includes("answer") ||
      status.includes("connect") ||
      status.includes("completed") ||
      status.includes("accepted")
    ) {
      dailyMap[dateKey][`${storeKey}_answered`]++;
    }
  });

  return Object.values(dailyMap).sort((a, b) => {
    const [am, ad] = a.date.split("/").map(Number);
    const [bm, bd] = b.date.split("/").map(Number);
    return am !== bm ? am - bm : ad - bd;
  });
}

/**
 * Transform raw call records into hourly missed call data
 */
export function transformToHourlyMissed(rows) {
  const hourlyMap = {};
  for (let h = 9; h <= 20; h++) {
    const label = h <= 12 ? `${h}AM` : `${h - 12}PM`;
    hourlyMap[h] = { hour: label };
    STORE_KEYS.forEach((k) => {
      hourlyMap[h][k] = 0;
    });
  }

  rows.forEach((row) => {
    const storeKey = getStoreKey(row);
    if (!storeKey) return;

    const status = (
      row["Status"] || row["Call Status"] || row["status"] || row["Disposition"] || ""
    ).toLowerCase();
    if (
      !status.includes("miss") &&
      !status.includes("abandon") &&
      !status.includes("no answer") &&
      !status.includes("cancel")
    )
      return;

    const dateStr =
      row["Date"] || row["Call Date and Time"] || row["date"] || row["Started (UTC)"];
    if (!dateStr) return;

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    const hour = d.getHours();
    if (hourlyMap[hour]) {
      hourlyMap[hour][storeKey]++;
    }
  });

  return Object.values(hourlyMap);
}

/**
 * Transform raw call records into day-of-week missed call data
 */
export function transformToDOWMissed(rows) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowMap = days.map((day) => {
    const obj = { day };
    STORE_KEYS.forEach((k) => {
      obj[k] = 0;
    });
    return obj;
  });

  rows.forEach((row) => {
    const storeKey = getStoreKey(row);
    if (!storeKey) return;

    const status = (
      row["Status"] || row["Call Status"] || row["status"] || row["Disposition"] || ""
    ).toLowerCase();
    if (
      !status.includes("miss") &&
      !status.includes("abandon") &&
      !status.includes("no answer") &&
      !status.includes("cancel")
    )
      return;

    const dateStr =
      row["Date"] || row["Call Date and Time"] || row["date"] || row["Started (UTC)"];
    if (!dateStr) return;

    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    dowMap[d.getDay()][storeKey]++;
  });

  return dowMap;
}

/**
 * Build callback tracking data from call records
 */
export function transformToCallbackData(rows) {
  const storeRows = {};
  STORE_KEYS.forEach((k) => {
    storeRows[k] = { missed: [], outbound: [] };
  });

  rows.forEach((row) => {
    const storeKey = getStoreKey(row);
    if (!storeKey) return;

    const direction = (
      row["Direction"] || row["Call Direction"] || row["direction"] || ""
    ).toLowerCase();
    const status = (
      row["Status"] || row["Call Status"] || row["status"] || row["Disposition"] || ""
    ).toLowerCase();
    const phone =
      row["External Number"] ||
      row["Contact Phone"] ||
      row["Phone Number"] ||
      row["contact_number"] ||
      row["Caller Number"] ||
      "";
    const dateStr =
      row["Date"] || row["Call Date and Time"] || row["date"] || row["Started (UTC)"];

    if (
      direction.includes("inbound") &&
      (status.includes("miss") ||
        status.includes("abandon") ||
        status.includes("no answer") ||
        status.includes("cancel"))
    ) {
      storeRows[storeKey].missed.push({ phone, time: new Date(dateStr) });
    }
    if (direction.includes("outbound")) {
      storeRows[storeKey].outbound.push({ phone, time: new Date(dateStr) });
    }
  });

  return STORE_KEYS.map((storeKey) => {
    const { missed, outbound } = storeRows[storeKey];
    let within30 = 0,
      within60 = 0,
      later = 0,
      never = 0;

    missed.forEach((m) => {
      const callback = outbound.find(
        (ob) => ob.phone === m.phone && ob.time > m.time
      );
      if (!callback) {
        never++;
      } else {
        const diffMin = (callback.time - m.time) / 60000;
        if (diffMin <= 30) within30++;
        else if (diffMin <= 60) within60++;
        else later++;
      }
    });

    return {
      store: storeKey,
      missed: missed.length,
      calledBack: within30 + within60 + later,
      within30,
      within60,
      later,
      never,
    };
  });
}

/**
 * Build problem call data from call records
 */
export function transformToProblemCalls(rows) {
  const types = [
    { type: "Long Hold Time (>3min)", test: (row) => parseFloat(row["Hold Time"] || row["Wait Time"] || row["hold_duration"] || "0") > 180 },
    { type: "Negative Sentiment", test: (row) => (row["Sentiment"] || row["sentiment"] || "").toLowerCase().includes("negative") },
    { type: "Escalation Request", test: (row) => false },
    { type: "Repeat Caller (same issue)", test: (row) => false },
    { type: "Misquote / Wrong Info", test: (row) => false },
    { type: "Refund / Complaint", test: (row) => false },
  ];

  return types.map(({ type, test }) => {
    const result = { type };
    STORE_KEYS.forEach((k) => { result[k] = 0; });

    rows.forEach((row) => {
      const storeKey = getStoreKey(row);
      if (!storeKey) return;
      if (test(row)) result[storeKey]++;
    });

    return result;
  });
}

// ═══════════════════════════════════════════════════════════════
// Sample Data Fallback
// ═══════════════════════════════════════════════════════════════

export const SAMPLE_KEYWORDS = [
  { keyword: "screen repair",       category: "Service",    fishers: 142, bloomington: 118, indianapolis: 156 },
  { keyword: "battery replacement", category: "Service",    fishers: 98,  bloomington: 87,  indianapolis: 104 },
  { keyword: "water damage",        category: "Service",    fishers: 54,  bloomington: 41,  indianapolis: 62 },
  { keyword: "price / cost",        category: "Sales",      fishers: 189, bloomington: 167, indianapolis: 201 },
  { keyword: "warranty",            category: "Support",    fishers: 67,  bloomington: 52,  indianapolis: 71 },
  { keyword: "how long / wait time",category: "Operations", fishers: 134, bloomington: 112, indianapolis: 148 },
  { keyword: "appointment",         category: "Operations", fishers: 45,  bloomington: 38,  indianapolis: 52 },
  { keyword: "status / update",     category: "Support",    fishers: 113, bloomington: 96,  indianapolis: 121 },
  { keyword: "frustrated / upset",  category: "Problem",    fishers: 28,  bloomington: 34,  indianapolis: 22 },
  { keyword: "manager / escalation",category: "Problem",    fishers: 14,  bloomington: 19,  indianapolis: 11 },
  { keyword: "wrong part / misquote",category: "Problem",   fishers: 8,   bloomington: 12,  indianapolis: 6 },
  { keyword: "insurance claim",     category: "Sales",      fishers: 36,  bloomington: 29,  indianapolis: 42 },
  { keyword: "data recovery",       category: "Service",    fishers: 31,  bloomington: 24,  indianapolis: 28 },
  { keyword: "trade-in",            category: "Sales",      fishers: 22,  bloomington: 18,  indianapolis: 27 },
  { keyword: "refund / return",     category: "Problem",    fishers: 17,  bloomington: 21,  indianapolis: 13 },
];

export const SAMPLE_HOURLY_MISSED = Array.from({ length: 12 }, (_, i) => {
  const hour = i + 9;
  const label = hour <= 12 ? `${hour}AM` : `${hour - 12}PM`;
  const base = hour >= 11 && hour <= 14 ? 8 : hour >= 16 ? 6 : 3;
  const seed = (hour * 7 + 13) % 5;
  return { hour: label, fishers: base + seed, bloomington: base + ((seed + 2) % 5), indianapolis: base + ((seed + 4) % 4) };
});

export const SAMPLE_DAILY_CALLS = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2026, 1, 9 + i);
  const dow = d.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const base = isWeekend ? 18 : 42;
  const s = ((i * 13 + 7) % 10);
  return {
    date: `${d.getMonth() + 1}/${d.getDate()}`,
    fishers_total: base + s, fishers_answered: base - 4 + Math.min(s, 8),
    bloomington_total: base - 3 + s, bloomington_answered: base - 7 + Math.min(s, 7),
    indianapolis_total: base + 2 + s, indianapolis_answered: base - 2 + Math.min(s, 9),
  };
});

export const SAMPLE_CALLBACK_DATA = [
  { store: "fishers",      missed: 156, calledBack: 112, within30: 78, within60: 24, later: 10, never: 44 },
  { store: "bloomington",  missed: 184, calledBack: 118, within30: 62, within60: 32, later: 24, never: 66 },
  { store: "indianapolis", missed: 132, calledBack: 108, within30: 82, within60: 18, later: 8,  never: 24 },
];

export const SAMPLE_PROBLEM_CALLS = [
  { type: "Long Hold Time (>3min)",     fishers: 34, bloomington: 48, indianapolis: 26 },
  { type: "Negative Sentiment",         fishers: 28, bloomington: 34, indianapolis: 22 },
  { type: "Escalation Request",         fishers: 14, bloomington: 19, indianapolis: 11 },
  { type: "Repeat Caller (same issue)", fishers: 22, bloomington: 27, indianapolis: 18 },
  { type: "Misquote / Wrong Info",      fishers: 8,  bloomington: 12, indianapolis: 6 },
  { type: "Refund / Complaint",         fishers: 17, bloomington: 21, indianapolis: 13 },
];

export const SAMPLE_DOW_DATA = [
  { day: "Mon", fishers: 22, bloomington: 28, indianapolis: 18 },
  { day: "Tue", fishers: 18, bloomington: 24, indianapolis: 15 },
  { day: "Wed", fishers: 20, bloomington: 22, indianapolis: 17 },
  { day: "Thu", fishers: 19, bloomington: 26, indianapolis: 16 },
  { day: "Fri", fishers: 24, bloomington: 30, indianapolis: 20 },
  { day: "Sat", fishers: 32, bloomington: 38, indianapolis: 28 },
  { day: "Sun", fishers: 12, bloomington: 14, indianapolis: 10 },
];

// Orchestrates the always-on TV dashboard.
// - Rotates between Daily and Rankings screens every 30s
// - Fetches all data needed by both screens
// - Refreshes data every 60s (background heartbeat)
// - Failure mode: keep showing last good data + tiny "stale" indicator
// LIGHT THEME: white card panels on light gray page background.
"use client";

import { useState, useEffect, useRef } from "react";
import ScreenDaily from "@/components/tv/ScreenDaily";
import ScreenRankings from "@/components/tv/ScreenRankings";

var STORE_NAMES = { fishers: "Fishers", bloomington: "Bloomington", indianapolis: "Indianapolis" };
var ROTATION_MS = 30000;        // 30 sec per screen
var REFRESH_MS = 60000;         // 60 sec data refresh

// Build current period string YYYY-MM
function currentPeriod() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export default function TVDashboard(props) {
  var store = props.store;
  var storeName = STORE_NAMES[store] || store;

  // ── State ────────────────────────────────────────────────────────────
  var [screenIdx, setScreenIdx] = useState(0); // 0 = Daily, 1 = Rankings
  var [dailyCalls, setDailyCalls] = useState(null);
  var [appointments, setAppointments] = useState(null);
  var [scorecard, setScorecard] = useState(null);
  var [advancedRepairs, setAdvancedRepairs] = useState(null);
  var [advancedStoreStats, setAdvancedStoreStats] = useState(null);
  var [dataAge, setDataAge] = useState({ calls: null, appts: null, scores: null, advrep: null });
  var [error, setError] = useState(null);
  var [bootDone, setBootDone] = useState(false);

  // Use ref to keep load function stable across renders for setInterval
  var loadRef = useRef(null);

  // ── Data fetcher ─────────────────────────────────────────────────────
  // Each fetch gets its own 12-sec timeout via AbortController.
  // If a single endpoint is slow/hanging, it doesn't block the others.
  function fetchWithTimeout(url, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
    return fetch(url, { signal: controller.signal })
      .then(function(r) { clearTimeout(timer); return r.json(); })
      .catch(function(e) { clearTimeout(timer); throw e; });
  }

  loadRef.current = async function() {
    try {
      var period = currentPeriod();
      // Note: only fetch 15 days of call data. We only need:
      //   - today (Daily screen)
      //   - last 7 days (Rankings: This Week)
      //   - month-to-date (Rankings: This Month — up to 31 days but we cap at 15 to avoid large payloads;
      //     for the first 2 weeks of a month this is fine, for the last 2 weeks we'd undercount —
      //     so the smarter approach is "max(15, days-since-month-start + 2)")
      var d = new Date();
      var daysSinceMonthStart = d.getDate(); // 1..31
      var daysNeeded = Math.max(15, daysSinceMonthStart + 2);
      var results = await Promise.allSettled([
        fetchWithTimeout("/api/dialpad/stored?days=" + daysNeeded, 12000),
        fetchWithTimeout("/api/dialpad/appointments?action=today&store=" + store, 8000),
        fetchWithTimeout("/api/dialpad/scorecard?period=" + period, 12000),
        fetchWithTimeout("/api/advanced-repairs?action=public_leaderboard&period=" + period, 8000),
        fetchWithTimeout("/api/advanced-repairs?action=store_stats&store=" + store + "&period=" + period, 8000),
      ]);
      var nowTs = Date.now();
      var newAge = Object.assign({}, dataAge);
      if (results[0].status === "fulfilled" && results[0].value.success && results[0].value.data && results[0].value.data.dailyCalls) {
        setDailyCalls(results[0].value.data.dailyCalls);
        newAge.calls = nowTs;
      }
      if (results[1].status === "fulfilled" && results[1].value.success) {
        setAppointments(results[1].value.appointments || []);
        newAge.appts = nowTs;
      }
      if (results[2].status === "fulfilled" && results[2].value.success) {
        setScorecard(results[2].value);
        newAge.scores = nowTs;
      }
      if (results[3].status === "fulfilled" && results[3].value.success) {
        setAdvancedRepairs(results[3].value.leaderboard || []);
        newAge.advrep = nowTs;
      }
      if (results[4].status === "fulfilled" && results[4].value.success) {
        setAdvancedStoreStats(results[4].value);
      }
      setDataAge(newAge);
      // Count successes — if at least one fetch worked, we can show real data
      var successCount = results.filter(function(r) {
        return r.status === "fulfilled" && r.value && r.value.success;
      }).length;
      setError(successCount === 0 ? "All data sources timed out — retrying..." : null);
      setBootDone(true);
    } catch (e) {
      // This should rarely fire since Promise.allSettled never rejects.
      // But if currentPeriod() or something else throws, we still need to escape loading.
      setError(e.message || "Failed to load");
      setBootDone(true);
    }
  };

  // ── Initial load + heartbeat ─────────────────────────────────────────
  useEffect(function() {
    loadRef.current();
    var t = setInterval(function() { loadRef.current(); }, REFRESH_MS);
    return function() { clearInterval(t); };
  }, [store]);

  // ── Rotation timer ───────────────────────────────────────────────────
  useEffect(function() {
    var t = setInterval(function() {
      setScreenIdx(function(i) { return (i + 1) % 2; });
    }, ROTATION_MS);
    return function() { clearInterval(t); };
  }, []);

  // ── Loading state (first boot only) ──────────────────────────────────
  if (!bootDone && !dailyCalls && !appointments && !scorecard) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#6B7280", fontSize: 32 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📺</div>
          <div>Loading {storeName} dashboard...</div>
          <div style={{ fontSize: 14, marginTop: 12, color: "#9CA3AF" }}>Fetching call data, appointments, and rankings</div>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* ── Top bar: store name + clock + screen indicator ───────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "clamp(10px, 1.8vh, 20px) clamp(16px, 2.5vw, 40px)",
        borderBottom: "1px solid #E5E7EB",
        background: "#FFFFFF",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "clamp(10px, 1.5vw, 18px)" }}>
          <div style={{
            background: "linear-gradient(135deg, #00D4FF, #7B2FFF, #FF2D95)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            fontSize: "clamp(20px, 3.5vh, 36px)", fontWeight: 900, letterSpacing: 1,
          }}>
            CPR {storeName.toUpperCase()}
          </div>
          <div style={{ background: "#7B2FFF15", color: "#7B2FFF", padding: "5px 12px", borderRadius: 999, fontSize: "clamp(10px, 1.3vh, 13px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            {screenIdx === 0 ? "Daily Dash" : "Rankings"}
          </div>
        </div>
        <Clock />
      </div>

      {/* ── Main screen area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", background: "#F4F6FA" }}>
        {/* Daily screen */}
        <div style={Object.assign({}, screenStyle, {
          opacity: screenIdx === 0 ? 1 : 0,
          pointerEvents: screenIdx === 0 ? "auto" : "none",
        })}>
          <ScreenDaily store={store} storeName={storeName} dailyCalls={dailyCalls} appointments={appointments} advancedRepairs={advancedRepairs} advancedStoreStats={advancedStoreStats} />
        </div>
        {/* Rankings screen */}
        <div style={Object.assign({}, screenStyle, {
          opacity: screenIdx === 1 ? 1 : 0,
          pointerEvents: screenIdx === 1 ? "auto" : "none",
        })}>
          <ScreenRankings store={store} storeName={storeName} dailyCalls={dailyCalls} scorecard={scorecard} />
        </div>
      </div>

      {/* ── Bottom bar: page dots + freshness ─────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "clamp(8px, 1.3vh, 14px) clamp(16px, 2.5vw, 40px)",
        borderTop: "1px solid #E5E7EB",
        background: "#FFFFFF",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 56, height: 6, borderRadius: 3, background: screenIdx === 0 ? "#00D4FF" : "#E5E7EB", transition: "background 0.3s" }} />
          <div style={{ width: 56, height: 6, borderRadius: 3, background: screenIdx === 1 ? "#FF2D95" : "#E5E7EB", transition: "background 0.3s" }} />
        </div>
        <FreshnessIndicator dataAge={dataAge} error={error} />
      </div>
    </div>
  );
}

var screenStyle = {
  position: "absolute", inset: 0,
  padding: "clamp(14px, 2.5vh, 30px) clamp(16px, 2.5vw, 40px)",
  transition: "opacity 0.6s ease-in-out",
};

// ── Clock — self-contained, updates every second without re-rendering siblings ─
function Clock() {
  var [now, setNow] = useState(new Date());
  useEffect(function() {
    var t = setInterval(function() { setNow(new Date()); }, 1000);
    return function() { clearInterval(t); };
  }, []);
  var timeStr = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Indiana/Indianapolis" });
  var dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Indiana/Indianapolis" });
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: "clamp(22px, 3.8vh, 40px)", fontWeight: 800, color: "#1A2233", letterSpacing: 1, fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>{timeStr}</div>
      <div style={{ fontSize: "clamp(11px, 1.5vh, 16px)", color: "#6B7280", marginTop: 2 }}>{dateStr}</div>
    </div>
  );
}

// ── Freshness indicator: subtle gray "Updated X min ago" ──────────────
function FreshnessIndicator(props) {
  var [now, setNow] = useState(Date.now());
  // Update freshness label every 30s — no need for second-level precision
  useEffect(function() {
    var t = setInterval(function() { setNow(Date.now()); }, 30000);
    return function() { clearInterval(t); };
  }, []);
  var ages = props.dataAge;
  // Find the oldest "alive" data source — that's the freshness we report
  var ts = [ages.calls, ages.appts, ages.scores, ages.advrep].filter(function(x) { return x !== null; });
  if (ts.length === 0) {
    return <div style={{ color: "#9CA3AF", fontSize: 12 }}>Waiting for data...</div>;
  }
  var oldest = Math.min.apply(null, ts);
  var ageMs = now - oldest;
  var ageMin = Math.floor(ageMs / 60000);
  var label;
  if (ageMin < 1) label = "Updated just now";
  else if (ageMin === 1) label = "Updated 1 min ago";
  else label = "Updated " + ageMin + " min ago";
  return (
    <div style={{ color: props.error ? "#D97706" : "#9CA3AF", fontSize: 12 }}>
      {props.error ? "Connection issue · " : ""}{label}
    </div>
  );
}

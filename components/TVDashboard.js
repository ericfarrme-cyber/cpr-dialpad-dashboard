// Orchestrates the always-on TV dashboard.
// - Rotates between Daily and Rankings screens every 30s
// - Fetches all data needed by both screens
// - Refreshes data every 60s (background heartbeat)
// - Failure mode: keep showing last good data + tiny "stale" indicator
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
  var [dataAge, setDataAge] = useState({ calls: null, appts: null, scores: null, advrep: null });
  var [error, setError] = useState(null);
  var [bootDone, setBootDone] = useState(false);

  // Use ref to keep load function stable across renders for setInterval
  var loadRef = useRef(null);

  // ── Data fetcher ─────────────────────────────────────────────────────
  loadRef.current = async function() {
    try {
      var period = currentPeriod();
      var results = await Promise.allSettled([
        fetch("/api/dialpad/stored?days=35").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/appointments?action=today&store=" + store).then(function(r) { return r.json(); }),
        fetch("/api/dialpad/scorecard?period=" + period).then(function(r) { return r.json(); }),
        fetch("/api/advanced-repairs?action=leaderboard&period=" + period).then(function(r) { return r.json(); }),
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
      setDataAge(newAge);
      setError(null);
      setBootDone(true);
    } catch (e) {
      setError(e.message);
      // Don't blank the screen — keep showing last good data
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#8B8F98", fontSize: 32 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📺</div>
          <div>Loading {storeName} dashboard...</div>
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
        padding: "20px 40px",
        borderBottom: "1px solid #1E2028",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{
            background: "linear-gradient(135deg, #00D4FF, #7B2FFF, #FF2D95)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            fontSize: 36, fontWeight: 900, letterSpacing: 1,
          }}>
            CPR {storeName.toUpperCase()}
          </div>
          <div style={{ background: "#7B2FFF22", color: "#7B2FFF", padding: "5px 12px", borderRadius: 999, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            {screenIdx === 0 ? "Daily Dash" : "Rankings"}
          </div>
        </div>
        <Clock />
      </div>

      {/* ── Main screen area ─────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {/* Daily screen */}
        <div style={Object.assign({}, screenStyle, {
          opacity: screenIdx === 0 ? 1 : 0,
          pointerEvents: screenIdx === 0 ? "auto" : "none",
        })}>
          <ScreenDaily store={store} storeName={storeName} dailyCalls={dailyCalls} appointments={appointments} advancedRepairs={advancedRepairs} />
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
        padding: "14px 40px",
        borderTop: "1px solid #1E2028",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 56, height: 6, borderRadius: 3, background: screenIdx === 0 ? "#00D4FF" : "#1E2028", transition: "background 0.3s" }} />
          <div style={{ width: 56, height: 6, borderRadius: 3, background: screenIdx === 1 ? "#FF2D95" : "#1E2028", transition: "background 0.3s" }} />
        </div>
        <FreshnessIndicator dataAge={dataAge} error={error} />
      </div>
    </div>
  );
}

var screenStyle = {
  position: "absolute", inset: 0,
  padding: "30px 40px",
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
      <div style={{ fontSize: 40, fontWeight: 800, color: "#F0F1F3", letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{timeStr}</div>
      <div style={{ fontSize: 16, color: "#8B8F98", marginTop: 2 }}>{dateStr}</div>
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
    return <div style={{ color: "#6B6F78", fontSize: 12 }}>Waiting for data...</div>;
  }
  var oldest = Math.min.apply(null, ts);
  var ageMs = now - oldest;
  var ageMin = Math.floor(ageMs / 60000);
  var label;
  if (ageMin < 1) label = "Updated just now";
  else if (ageMin === 1) label = "Updated 1 min ago";
  else label = "Updated " + ageMin + " min ago";
  return (
    <div style={{ color: props.error ? "#FBBF24" : "#6B6F78", fontSize: 12 }}>
      {props.error ? "Connection issue · " : ""}{label}
    </div>
  );
}

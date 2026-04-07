'use client';

import { useState, useEffect, useMemo, useCallback } from "react";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);
var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
var FULL_DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

var WIW_LOCATION_MAP = {
  "cpr fishers": "fishers", "cpr bloomington": "bloomington",
  "cpr downtown": "indianapolis", "cpr indianapolis": "indianapolis", "cpr indy": "indianapolis",
};

function locationToStore(locName) {
  if (!locName) return null;
  var lower = locName.toLowerCase().trim();
  if (WIW_LOCATION_MAP[lower]) return WIW_LOCATION_MAP[lower];
  if (lower.includes("fishers")) return "fishers";
  if (lower.includes("bloomington")) return "bloomington";
  if (lower.includes("indianapolis") || lower.includes("indy") || lower.includes("downtown")) return "indianapolis";
  return null;
}

function fmtTime(d) { if (!d) return "--"; return new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function fmtDate(d) { return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function sc(v, g, y) { return v >= g ? "#4ADE80" : v >= y ? "#FBBF24" : "#EF4444"; }

function getWeekStart(date) {
  var d = new Date(date); d.setDate(d.getDate() - d.getDay() + 1); // Monday
  d.setHours(0,0,0,0); return d;
}

function getWeekEnd(d) { var e = new Date(d); e.setDate(e.getDate() + 6); return e; }

function severity_color(sev) {
  return sev === "CRITICAL" ? "#EF4444" : sev === "WATCH" ? "#FBBF24" : "#4ADE8033";
}
function severity_bg(sev) {
  return sev === "CRITICAL" ? "#EF444422" : sev === "WATCH" ? "#FBBF2418" : "transparent";
}

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════
export default function ScheduleTab({ selectedStore }) {
  var [subTab, setSubTab] = useState("week");
  var [loading, setLoading] = useState(true);
  var [wiwConnected, setWiwConnected] = useState(false);

  // Schedule data
  var [scheduleData, setScheduleData] = useState(null);
  var [storedShifts, setStoredShifts] = useState([]);
  var [weekOffset, setWeekOffset] = useState(0);

  // Demand intelligence
  var [demandPatterns, setDemandPatterns] = useState(null);
  var [coverageData, setCoverageData] = useState(null);
  var [floatEmployees, setFloatEmployees] = useState([]);
  var [demandLoading, setDemandLoading] = useState(false);
  var [showDemandOverlay, setShowDemandOverlay] = useState(true);
  var [optimizing, setOptimizing] = useState(false);
  var [optimization, setOptimization] = useState(null);

  // Store filter for weekly view
  var [weekStore, setWeekStore] = useState("all");

  // Profitability + scorecard for other sub-tabs
  var [profitData, setProfitData] = useState([]);
  var [scorecardData, setScorecardData] = useState(null);
  var [storedCallData, setStoredCallData] = useState(null);

  // Current week dates
  var currentWeekStart = useMemo(function() {
    var d = getWeekStart(new Date());
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  }, [weekOffset]);

  var weekDates = useMemo(function() {
    var dates = [];
    for (var i = 0; i < 7; i++) {
      var d = new Date(currentWeekStart);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }, [currentWeekStart]);

  var weekLabel = useMemo(function() {
    var end = getWeekEnd(currentWeekStart);
    var opts = { month: "short", day: "numeric", year: "numeric" };
    return "Week of " + currentWeekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " - " + end.toLocaleDateString("en-US", opts);
  }, [currentWeekStart]);

  var isCurrentWeek = weekOffset === 0;
  var isFutureWeek = weekOffset > 0;

  // ── Fetch stored shifts from Supabase ──
  useEffect(function() {
    var start = fmtDate(weekDates[0]);
    var endPlusOne = new Date(weekDates[6]); endPlusOne.setDate(endPlusOne.getDate() + 1);
    var end = fmtDate(endPlusOne);
    fetch("/api/wheniwork?action=stored-shifts&start=" + start + "&end=" + end)
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.shifts) setStoredShifts(d.shifts); })
      .catch(function() {})
      .finally(function() { setLoading(false); });
  }, [weekOffset]);

  // ── Fetch WhenIWork live schedule (includes future shifts) ──
  useEffect(function() {
    var start = fmtDate(weekDates[0]);
    var endPlusOne = new Date(weekDates[6]); endPlusOne.setDate(endPlusOne.getDate() + 1);
    var end = fmtDate(endPlusOne);
    fetch("/api/wheniwork?action=shifts&start=" + start + "&end=" + end)
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.shifts) { setScheduleData(d); setWiwConnected(true); } })
      .catch(function() {});
  }, [weekOffset]);

  // ── Fetch demand intelligence ──
  useEffect(function() {
    setDemandLoading(true);
    var weekOfStr = fmtDate(currentWeekStart);
    Promise.all([
      fetch("/api/dialpad/demand-analysis?action=hourly-demand&days=30").then(function(r) { return r.json(); }).catch(function() { return {}; }),
      fetch("/api/dialpad/demand-analysis?action=float-employees&days=60").then(function(r) { return r.json(); }).catch(function() { return {}; }),
      fetch("/api/dialpad/demand-analysis?action=coverage&weekOf=" + weekOfStr + "&days=30").then(function(r) { return r.json(); }).catch(function() { return {}; }),
    ]).then(function(results) {
      if (results[0].patterns) setDemandPatterns(results[0].patterns);
      if (results[1].employees) setFloatEmployees(results[1].employees);
      if (results[2].stores) setCoverageData(results[2]);
      setDemandLoading(false);
    });
  }, [weekOffset]);

  // ── Fetch supporting data (profitability, scorecard, calls) ──
  useEffect(function() {
    Promise.allSettled([
      fetch("/api/dialpad/profitability").then(function(r) { return r.json(); }),
      fetch("/api/dialpad/scorecard").then(function(r) { return r.json(); }),
      fetch("/api/dialpad/stored").then(function(r) { return r.json(); }),
    ]).then(function(results) {
      if (results[0].status === "fulfilled" && results[0].value.data) setProfitData(results[0].value.data);
      if (results[1].status === "fulfilled") setScorecardData(results[1].value);
      if (results[2].status === "fulfilled") setStoredCallData(results[2].value);
    });
  }, []);

  // ═══ Build weekly schedule grid — MERGE stored + live shifts ═══
  var weeklySchedule = useMemo(function() {
    var byEmployee = {};
    var seen = new Set(); // track employee+date to deduplicate

    function processShift(s) {
      var name = s.employee_name || s.user_name || "Unknown";
      var rawStore = s.store || s.location_name || "unknown";
      var store = locationToStore(rawStore) || rawStore;
      if (weekStore !== "all" && store !== weekStore) return;

      var dateStr = s.shift_date || (s.start_time ? new Date(s.start_time).toISOString().split("T")[0] : null);
      if (!dateStr) return;

      // Deduplicate by employee + date
      var key = name + "|" + dateStr;
      if (seen.has(key)) return;
      seen.add(key);

      if (!byEmployee[name]) {
        byEmployee[name] = { name: name, store: store, shifts: {}, totalHours: 0, stores: new Set() };
      }
      byEmployee[name].stores.add(store);

      var hours = parseFloat(s.hours) || 0;
      var startTime = s.start_time ? fmtTime(s.start_time) : "--";
      var startHour = s.start_time ? new Date(s.start_time).getHours() : null;
      var endHour = s.end_time ? new Date(s.end_time).getHours() : null;

      byEmployee[name].shifts[dateStr] = {
        start: startTime, hours: hours, store: store,
        startHour: startHour, endHour: endHour,
      };
      byEmployee[name].totalHours += hours;
    }

    // Process stored shifts first (priority — validated data)
    storedShifts.forEach(processShift);

    // Then add live WhenIWork shifts for any missing employee+date combos
    if (scheduleData?.shifts) {
      scheduleData.shifts.forEach(processShift);
    }

    return Object.values(byEmployee).sort(function(a, b) { return b.totalHours - a.totalHours; });
  }, [storedShifts, scheduleData, weekStore]);

  // ═══ Float employees for this view ═══
  var floatMap = useMemo(function() {
    var m = {};
    floatEmployees.forEach(function(e) { if (e.isFloat) m[e.name] = e; });
    return m;
  }, [floatEmployees]);

  // ═══ Coverage summary for week ═══
  var coverageSummary = useMemo(function() {
    if (!coverageData?.stores) return null;
    var storeKeys = weekStore === "all" ? STORE_KEYS : [weekStore];
    var totalGap = 0, critGap = 0, totalRisk = 0;
    storeKeys.forEach(function(sk) {
      var s = coverageData.stores[sk]?.summary;
      if (s) { totalGap += s.totalGapHours; critGap += s.criticalHours; totalRisk += s.revenueAtRisk; }
    });
    return { totalGapHours: totalGap, criticalHours: critGap, revenueAtRisk: totalRisk };
  }, [coverageData, weekStore]);

  // ═══ Hourly staffing for each day (for demand overlay) ═══
  var hourlyStaffing = useMemo(function() {
    // Build [dateStr][hour] = count of staff
    var map = {};
    weeklySchedule.forEach(function(emp) {
      Object.entries(emp.shifts).forEach(function(entry) {
        var dateStr = entry[0], shift = entry[1];
        if (!map[dateStr]) map[dateStr] = {};
        var sh = shift.startHour || 9;
        var eh = shift.endHour || (sh + shift.hours);
        for (var h = sh; h < eh && h <= 20; h++) {
          map[dateStr][h] = (map[dateStr][h] || 0) + 1;
        }
      });
    });
    return map;
  }, [weeklySchedule]);

  // ═══ AI Optimize ═══
  var handleOptimize = useCallback(function() {
    if (optimizing) return;
    setOptimizing(true);
    setOptimization(null);
    var nextWeek = new Date(currentWeekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    fetch("/api/dialpad/demand-analysis?action=optimize&weekOf=" + fmtDate(nextWeek) + "&days=30")
      .then(function(r) { return r.json(); })
      .then(function(d) { setOptimization(d.optimization || d); })
      .catch(function(e) { setOptimization({ error: e.message }); })
      .finally(function() { setOptimizing(false); });
  }, [currentWeekStart, optimizing]);

  // ═══ Hours by employee (for Hours Tracking) ═══
  var hoursByEmployee = useMemo(function() {
    var byEmp = {};
    storedShifts.forEach(function(s) {
      var name = s.employee_name || "Unknown";
      if (!byEmp[name]) byEmp[name] = { name: name, fishers: 0, bloomington: 0, indianapolis: 0, total: 0 };
      var h = parseFloat(s.hours) || 0;
      byEmp[name][s.store] = (byEmp[name][s.store] || 0) + h;
      byEmp[name].total += h;
    });
    return Object.values(byEmp).sort(function(a,b) { return b.total - a.total; });
  }, [storedShifts]);

  // ═══ Employee Productivity (from scorecard + shifts) ═══
  var productivity = useMemo(function() {
    if (!scorecardData) return [];
    var allEmps = [];
    STORE_KEYS.forEach(function(sk) {
      var storeData = scorecardData[sk];
      if (!storeData?.employees) return;
      storeData.employees.forEach(function(emp) {
        var name = emp.name;
        var hrs = hoursByEmployee.find(function(h) { return h.name === name; });
        var totalHrs = hrs ? hrs.total : 0;
        var repairs = (emp.repairs?.phoneRepairs || 0) + (emp.repairs?.otherRepairs || 0);
        var accyGP = emp.repairs?.accessoryGP || 0;
        var totalRev = repairs * 175 + accyGP; // $175 avg repair ticket
        allEmps.push({
          name: name, store: sk, hours: totalHrs,
          repairs: repairs, accyGP: accyGP, totalRev: totalRev,
          revPerHour: totalHrs > 0 ? Math.round(totalRev / totalHrs) : 0,
          repairsPerHour: totalHrs > 0 ? Math.round(repairs / totalHrs * 10) / 10 : 0,
          auditScore: emp.audit?.avgScore || 0,
          compliance: emp.compliance?.score || 0,
          score: emp.score || 0,
        });
      });
    });
    return allEmps.sort(function(a, b) { return b.revPerHour - a.revPerHour; });
  }, [scorecardData, hoursByEmployee]);

  // ═══ Labor Economics (from profitability data) ═══
  var laborEcon = useMemo(function() {
    if (!profitData.length) return null;
    // Get last completed month
    var now = new Date();
    var lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    var periodStr = lastMonth.getFullYear() + "-" + String(lastMonth.getMonth() + 1).padStart(2, "0");

    var results = {};
    STORE_KEYS.forEach(function(sk) {
      var record = profitData.find(function(r) { return r.store === sk && r.period === periodStr; });
      if (!record) return;
      var revenue = (record.phone_repair_revenue || 0) + (record.other_repair_revenue || 0) + (record.accessory_revenue || 0);
      var payroll = record.payroll || 0;
      var totalHours = record.labor_hours || 0;
      results[sk] = {
        period: periodStr, revenue: revenue, payroll: payroll, totalHours: totalHours,
        revPerHour: totalHours > 0 ? Math.round(revenue / totalHours) : 0,
        laborPct: revenue > 0 ? Math.round(payroll / revenue * 100) : 0,
        profitPerHour: totalHours > 0 ? Math.round((revenue - payroll) / totalHours) : 0,
      };
    });
    return results;
  }, [profitData]);

  // ═══ Staffing ROI model ═══
  var staffingROI = useMemo(function() {
    if (!storedCallData || !laborEcon) return null;
    var results = {};
    STORE_KEYS.forEach(function(sk) {
      var storeCall = storedCallData[sk];
      var econ = laborEcon[sk];
      if (!storeCall || !econ) return;
      var missed = storeCall.missedCalls || Math.max(0, (storeCall.totalCalls || 0) - (storeCall.answeredCalls || 0));
      var recoverableRev = Math.round(missed * 0.25 * 175);
      var fteCost = 2500; // ~$15/hr × 40hrs × 4.3wks
      var netROI = recoverableRev - fteCost;
      results[sk] = {
        missedCalls: missed, recoverableRevenue: recoverableRev, fteCost: fteCost, netROI: netROI,
        justified: netROI > 0, paybackPct: Math.round(recoverableRev / fteCost * 100),
      };
    });
    return results;
  }, [storedCallData, laborEcon]);

  // ═══ Live coverage (who's working now) ═══
  var liveCoverage = useMemo(function() {
    var now = new Date();
    var todayStr = fmtDate(now);
    var currentHour = now.getHours();
    var coverage = {};
    STORE_KEYS.forEach(function(sk) { coverage[sk] = { onShift: [], totalToday: 0 }; });

    storedShifts.forEach(function(s) {
      if (s.shift_date !== todayStr) return;
      if (!coverage[s.store]) return;
      coverage[s.store].totalToday++;
      var sh = s.start_time ? new Date(s.start_time).getHours() : 9;
      var eh = s.end_time ? new Date(s.end_time).getHours() : sh + (parseFloat(s.hours) || 8);
      if (currentHour >= sh && currentHour < eh) {
        coverage[s.store].onShift.push(s.employee_name);
      }
    });
    return coverage;
  }, [storedShifts]);

  // ═══ SUB TAB CONFIG ═══
  var SUB_TABS = [
    { id: "coverage", label: "Live Coverage", icon: "🟢" },
    { id: "reality", label: "Schedule vs Reality", icon: "🔍" },
    { id: "productivity", label: "Employee Productivity", icon: "🔥" },
    { id: "economics", label: "Labor Economics", icon: "💰" },
    { id: "week", label: "Weekly View", icon: "📅" },
    { id: "hours", label: "Hours Tracking", icon: "⏰" },
  ];

  // ═══ STYLES ═══
  var card = { background: "#1A1D23", borderRadius: 12, padding: 20, marginBottom: 16 };
  var miniCard = { background: "#12141A", borderRadius: 8, padding: 12, flex: 1 };
  var sectionTitle = { fontSize: 14, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 };
  var metricBig = { fontSize: 28, fontWeight: 800 };
  var metricLabel = { fontSize: 11, color: "#6B7280", marginTop: 2 };
  var badge = function(color) { return { fontSize: 10, padding: "2px 6px", borderRadius: 4, background: color + "22", color: color, fontWeight: 700 }; };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>Loading labor intelligence...</div>;

  return (
    <div>
      {/* WhenIWork Status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SUB_TABS.map(function(t) {
            return <button key={t.id} onClick={function() { setSubTab(t.id); }} style={{
              padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", whiteSpace: "nowrap",
              background: subTab === t.id ? "#7B2FFF22" : "#1A1D23", color: subTab === t.id ? "#7B2FFF" : "#9CA3AF",
              fontSize: 13, fontWeight: subTab === t.id ? 700 : 500, transition: "all 0.2s",
            }}>{t.icon} {t.label}</button>;
          })}
        </div>
        <div style={{ fontSize: 12, color: wiwConnected ? "#4ADE80" : "#6B7280" }}>
          {wiwConnected ? "● WhenIWork Connected" : "○ WhenIWork Disconnected"}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════ */}
      {/* LIVE COVERAGE */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "coverage" && (
        <div>
          <div style={sectionTitle}>LIVE STORE COVERAGE — {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {STORE_KEYS.map(function(sk) {
              var cov = liveCoverage[sk];
              return (
                <div key={sk} style={card}>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12, color: STORES[sk].color }}>{STORES[sk].name}</div>
                  <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                    <div><div style={{ ...metricBig, color: cov.onShift.length > 0 ? "#4ADE80" : "#EF4444" }}>{cov.onShift.length}</div><div style={metricLabel}>On Shift Now</div></div>
                    <div><div style={{ ...metricBig, color: "#9CA3AF" }}>{cov.totalToday}</div><div style={metricLabel}>Total Today</div></div>
                  </div>
                  {cov.onShift.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {cov.onShift.map(function(name) {
                        return <span key={name} style={{ fontSize: 12, padding: "4px 8px", background: "#4ADE8022", color: "#4ADE80", borderRadius: 6 }}>{name}{floatMap[name] ? " 🔀" : ""}</span>;
                      })}
                    </div>
                  ) : (
                    <div style={{ color: "#EF4444", fontSize: 13 }}>⚠ No one on shift</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Demand heatmap for today */}
          {demandPatterns && (
            <div style={card}>
              <div style={sectionTitle}>TODAY'S HOURLY DEMAND vs COVERAGE</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                {STORE_KEYS.map(function(sk) {
                  var today = FULL_DAYS[new Date().getDay()];
                  var dayPattern = demandPatterns[sk]?.[today] || {};
                  return (
                    <div key={sk} style={miniCard}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: STORES[sk].color, marginBottom: 8 }}>{STORES[sk].name}</div>
                      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 60 }}>
                        {[9,10,11,12,13,14,15,16,17,18,19].map(function(h) {
                          var d = dayPattern[h] || {};
                          var calls = d.avgCalls || 0;
                          var maxCalls = 10;
                          var height = Math.max(4, Math.min(60, (calls / maxCalls) * 60));
                          var staff = hourlyStaffing[fmtDate(new Date())]?.[h] || 0;
                          var color = staff >= (d.recommendedStaff || 1) ? "#4ADE80" : staff > 0 ? "#FBBF24" : "#EF4444";
                          return <div key={h} title={h + ":00 — " + calls + " calls, " + staff + " staff"} style={{ width: 16, height: height, background: color, borderRadius: 2, opacity: 0.8 }}/>;
                        })}
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#6B7280", marginTop: 4 }}>
                        <span>9AM</span><span>2PM</span><span>7PM</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* SCHEDULE VS REALITY */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "reality" && (
        <div style={card}>
          <div style={sectionTitle}>STAFFING LEVEL vs ANSWER RATE CORRELATION</div>
          <p style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 16 }}>
            Compares days with 1 staff vs 2+ staff against call answer rates. The data doesn't lie.
          </p>
          {STORE_KEYS.map(function(sk) {
            // Compute from stored shifts + call data
            var singleStaffDays = 0, singleStaffAnswerSum = 0;
            var multiStaffDays = 0, multiStaffAnswerSum = 0;

            weekDates.forEach(function(dt) {
              var dateStr = fmtDate(dt);
              var maxStaff = 0;
              storedShifts.forEach(function(s) { if (s.store === sk && s.shift_date === dateStr) maxStaff++; });
              // Get answer rate for this day from stored data
              var dayCall = storedCallData?.[sk]?.dailyCalls?.find(function(d) { return d.date === dateStr; });
              if (!dayCall || !maxStaff) return;
              var rate = dayCall.total > 0 ? Math.round(dayCall.answered / dayCall.total * 100) : 0;
              if (maxStaff <= 1) { singleStaffDays++; singleStaffAnswerSum += rate; }
              else { multiStaffDays++; multiStaffAnswerSum += rate; }
            });

            var singleRate = singleStaffDays > 0 ? Math.round(singleStaffAnswerSum / singleStaffDays) : 0;
            var multiRate = multiStaffDays > 0 ? Math.round(multiStaffAnswerSum / multiStaffDays) : 0;

            return (
              <div key={sk} style={{ display: "flex", gap: 16, marginBottom: 12, padding: 12, background: "#12141A", borderRadius: 8 }}>
                <div style={{ width: 120, fontWeight: 700, color: STORES[sk].color }}>{STORES[sk].name}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div><span style={{ fontSize: 20, fontWeight: 800, color: sc(singleRate, 80, 60) }}>{singleRate}%</span><span style={{ fontSize: 11, color: "#6B7280", marginLeft: 4 }}>1 staff ({singleStaffDays}d)</span></div>
                    <div style={{ fontSize: 20, color: "#6B7280" }}>→</div>
                    <div><span style={{ fontSize: 20, fontWeight: 800, color: sc(multiRate, 80, 60) }}>{multiRate}%</span><span style={{ fontSize: 11, color: "#6B7280", marginLeft: 4 }}>2+ staff ({multiStaffDays}d)</span></div>
                    {multiRate > singleRate && <span style={badge("#4ADE80")}>+{multiRate - singleRate}%</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* EMPLOYEE PRODUCTIVITY */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "productivity" && (
        <div>
          <div style={sectionTitle}>REVENUE PER LABOR HOUR — WHO EARNS THEIR KEEP</div>
          {/* Top 3 */}
          {productivity.length > 0 && (
            <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
              {productivity.slice(0, 3).map(function(emp, i) {
                var medals = ["🥇", "🥈", "🥉"];
                return (
                  <div key={emp.name} style={{ ...card, flex: 1, textAlign: "center" }}>
                    <div style={{ fontSize: 32 }}>{medals[i]}</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{emp.name}</div>
                    <div style={{ fontSize: 11, color: STORES[emp.store]?.color || "#6B7280" }}>{STORES[emp.store]?.name || emp.store}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: "#4ADE80", marginTop: 8 }}>${emp.revPerHour}/hr</div>
                    <div style={{ fontSize: 11, color: "#6B7280" }}>{emp.repairs} repairs in {Math.round(emp.hours)}h</div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Full table */}
          <div style={card}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: "1px solid #2A2D35" }}>
                {["#","Employee","Store","Score","Hours","Repairs","Accy GP","Rev/Hr","Rep/Hr","Audit","Compliance"].map(function(h) {
                  return <th key={h} style={{ padding: "8px 6px", textAlign: h === "Employee" || h === "Store" ? "left" : "right", color: "#6B7280", fontSize: 11 }}>{h}</th>;
                })}
              </tr></thead>
              <tbody>
                {productivity.map(function(emp, i) {
                  return (
                    <tr key={emp.name} style={{ borderBottom: "1px solid #1A1D23" }}>
                      <td style={{ padding: "8px 6px", textAlign: "right", color: "#6B7280" }}>{i + 1}</td>
                      <td style={{ padding: "8px 6px", fontWeight: 600 }}>{emp.name}{floatMap[emp.name] ? " 🔀" : ""}</td>
                      <td style={{ padding: "8px 6px", color: STORES[emp.store]?.color }}>{STORES[emp.store]?.name || emp.store}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700, color: sc(emp.score, 80, 60) }}>{emp.score}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right" }}>{Math.round(emp.hours)}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right" }}>{emp.repairs}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right" }}>${emp.accyGP.toLocaleString()}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right", fontWeight: 700, color: sc(emp.revPerHour, 40, 25) }}>${emp.revPerHour}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right" }}>{emp.repairsPerHour}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right", color: sc(emp.auditScore, 85, 70) }}>{emp.auditScore}</td>
                      <td style={{ padding: "8px 6px", textAlign: "right", color: sc(emp.compliance, 80, 60) }}>{emp.compliance}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {productivity.length >= 2 && (
              <div style={{ marginTop: 12, padding: 10, background: "#12141A", borderRadius: 8, fontSize: 12, color: "#9CA3AF" }}>
                💡 Top producer <strong style={{ color: "#4ADE80" }}>{productivity[0].name}</strong> generates <strong>${productivity[0].revPerHour}/hr</strong>.
                Lowest is <strong style={{ color: "#EF4444" }}>{productivity[productivity.length - 1].name}</strong> at <strong>${productivity[productivity.length - 1].revPerHour}/hr</strong>
                {productivity[0].revPerHour > 0 ? " — a " + Math.round((1 - productivity[productivity.length - 1].revPerHour / productivity[0].revPerHour) * 100) + "% gap." : "."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* LABOR ECONOMICS */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "economics" && (
        <div>
          <div style={sectionTitle}>LABOR ECONOMICS — LAST COMPLETED MONTH</div>
          {laborEcon ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 20 }}>
                {STORE_KEYS.map(function(sk) {
                  var e = laborEcon[sk];
                  if (!e) return <div key={sk} style={card}><div style={{ color: "#6B7280" }}>No data for {STORES[sk].name}</div></div>;
                  return (
                    <div key={sk} style={card}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: STORES[sk].color, marginBottom: 12 }}>{STORES[sk].name}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        <div><div style={{ ...metricBig, color: "#4ADE80", fontSize: 22 }}>${e.revPerHour}</div><div style={metricLabel}>Revenue/Man Hour</div></div>
                        <div><div style={{ ...metricBig, color: sc(100 - e.laborPct, 70, 60), fontSize: 22 }}>{e.laborPct}%</div><div style={metricLabel}>Labor % of Rev</div></div>
                        <div><div style={{ ...metricBig, color: e.profitPerHour > 0 ? "#4ADE80" : "#EF4444", fontSize: 22 }}>${e.profitPerHour}</div><div style={metricLabel}>Profit/Hour</div></div>
                        <div><div style={{ ...metricBig, fontSize: 22, color: "#9CA3AF" }}>{e.totalHours}h</div><div style={metricLabel}>Total Hours</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Staffing ROI */}
              {staffingROI && (
                <div style={card}>
                  <div style={sectionTitle}>🧠 STAFFING ROI — WHAT IF YOU ADDED 1 FTE?</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
                    {STORE_KEYS.map(function(sk) {
                      var r = staffingROI[sk];
                      if (!r) return null;
                      return (
                        <div key={sk} style={{ padding: 16, background: "#12141A", borderRadius: 8, borderLeft: "3px solid " + (r.justified ? "#4ADE80" : "#EF4444") }}>
                          <div style={{ fontWeight: 700, color: STORES[sk].color, marginBottom: 8 }}>{STORES[sk].name}</div>
                          <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 4 }}>{r.missedCalls} missed calls/mo</div>
                          <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 4 }}>× 25% conversion × $175 = <strong style={{ color: "#fff" }}>${r.recoverableRevenue.toLocaleString()}</strong> recoverable</div>
                          <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 8 }}>− ${r.fteCost.toLocaleString()} FTE cost = <strong style={{ color: r.netROI >= 0 ? "#4ADE80" : "#EF4444" }}>{r.netROI >= 0 ? "+" : ""}${r.netROI.toLocaleString()}</strong></div>
                          <div style={{ fontSize: 14, fontWeight: 800, color: r.justified ? "#4ADE80" : "#EF4444" }}>
                            {r.justified ? "✅ Hire — pays for itself" : "❌ Not justified yet"} ({r.paybackPct}%)
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={card}><div style={{ color: "#6B7280" }}>No profitability data available. Import via Profitability tab.</div></div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* WEEKLY VIEW — THE INTELLIGENCE HUB */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "week" && (
        <div>
          {/* Week nav + controls */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={function() { setWeekOffset(weekOffset - 1); }} style={{ background: "#1A1D23", border: "none", color: "#fff", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 16 }}>◀</button>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Weekly Schedule</div>
                <div style={{ fontSize: 12, color: "#6B7280" }}>{weekLabel}</div>
              </div>
              <button onClick={function() { setWeekOffset(weekOffset + 1); }} style={{ background: "#1A1D23", border: "none", color: "#fff", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 16 }}>▶</button>
              {weekOffset !== 0 && (
                <button onClick={function() { setWeekOffset(0); }} style={{ background: "#7B2FFF22", border: "none", color: "#7B2FFF", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>Today</button>
              )}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {/* Demand overlay toggle */}
              <button onClick={function() { setShowDemandOverlay(!showDemandOverlay); }} style={{
                padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
                background: showDemandOverlay ? "#FF2D9522" : "#1A1D23", color: showDemandOverlay ? "#FF2D95" : "#6B7280",
              }}>
                {showDemandOverlay ? "📊 Demand ON" : "📊 Demand OFF"}
              </button>

              {/* Store filter */}
              <div style={{ display: "flex", gap: 4 }}>
                {[{ key: "all", label: "All Stores" }].concat(STORE_KEYS.map(function(sk) { return { key: sk, label: STORES[sk].name }; })).map(function(s) {
                  return <button key={s.key} onClick={function() { setWeekStore(s.key); }} style={{
                    padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12,
                    background: weekStore === s.key ? "#00D4FF22" : "#1A1D23", color: weekStore === s.key ? "#00D4FF" : "#6B7280",
                  }}>{s.label}</button>;
                })}
              </div>

              {/* AI Optimize */}
              <button onClick={handleOptimize} disabled={optimizing} style={{
                padding: "6px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
                background: "linear-gradient(135deg, #7B2FFF, #FF2D95)", color: "#fff", opacity: optimizing ? 0.6 : 1,
              }}>
                {optimizing ? "🧠 Optimizing..." : "🧠 AI Optimize Next Week"}
              </button>
            </div>
          </div>

          {/* ── Coverage Alert Banner ── */}
          {coverageSummary && coverageSummary.criticalHours > 0 && (
            <div style={{ background: "#EF444422", border: "1px solid #EF444444", borderRadius: 8, padding: 12, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#EF4444" }}>⚠ {coverageSummary.criticalHours} CRITICAL gap hours</span>
                <span style={{ fontSize: 12, color: "#9CA3AF", marginLeft: 8 }}>({coverageSummary.totalGapHours} total understaffed hours this week)</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#EF4444" }}>
                ${coverageSummary.revenueAtRisk.toLocaleString()} revenue at risk
              </div>
            </div>
          )}

          {/* ── Float Employees Banner ── */}
          {floatEmployees.filter(function(e) { return e.isFloat; }).length > 0 && (
            <div style={{ background: "#7B2FFF12", border: "1px solid #7B2FFF33", borderRadius: 8, padding: 10, marginBottom: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#7B2FFF" }}>🔀 Float Employees:</span>
              {floatEmployees.filter(function(e) { return e.isFloat; }).map(function(e) {
                return <span key={e.name} style={{ fontSize: 11, padding: "3px 8px", background: "#7B2FFF22", color: "#C4B5FD", borderRadius: 4 }}>
                  {e.name} ({e.storeList.map(function(s) { return STORES[s]?.name?.[0] || s[0]; }).join("/")})
                </span>;
              })}
            </div>
          )}

          {/* ── DEMAND HEATMAP (above schedule) ── */}
          {showDemandOverlay && demandPatterns && (
            <div style={{ ...card, padding: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#FF2D95", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
                HOURLY DEMAND PATTERN (30-day avg) — Calls + Tickets by Hour
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "120px repeat(7, 1fr)", gap: 2 }}>
                <div style={{ fontSize: 10, color: "#6B7280", padding: 4 }}>STORE</div>
                {weekDates.map(function(dt, i) {
                  var isToday = fmtDate(dt) === fmtDate(new Date());
                  return <div key={i} style={{ fontSize: 10, color: isToday ? "#00D4FF" : "#6B7280", textAlign: "center", padding: 4, fontWeight: isToday ? 700 : 400 }}>{DAYS[dt.getDay()]} {dt.getDate()}</div>;
                })}

                {(weekStore === "all" ? STORE_KEYS : [weekStore]).map(function(sk) {
                  return [
                    <div key={sk + "-label"} style={{ fontSize: 11, color: STORES[sk].color, padding: "4px 4px", fontWeight: 600 }}>{STORES[sk].name}</div>,
                    ...weekDates.map(function(dt, di) {
                      var dow = FULL_DAYS[dt.getDay()];
                      var dayPattern = demandPatterns[sk]?.[dow] || {};
                      // Mini sparkline for this day
                      var maxDemand = 0;
                      for (var h = 9; h <= 19; h++) { maxDemand = Math.max(maxDemand, dayPattern[h]?.demandScore || 0); }
                      return (
                        <div key={sk + "-" + di} style={{ display: "flex", gap: 1, alignItems: "flex-end", height: 28, padding: "2px 4px", background: "#0A0C10", borderRadius: 4 }}>
                          {[9,10,11,12,13,14,15,16,17,18,19].map(function(h) {
                            var d = dayPattern[h] || {};
                            var score = d.demandScore || 0;
                            var height = maxDemand > 0 ? Math.max(2, (score / maxDemand) * 24) : 2;
                            var staff = hourlyStaffing[fmtDate(dt)]?.[h] || 0;
                            var needed = d.recommendedStaff || 1;
                            var color = staff >= needed ? "#4ADE8088" : staff > 0 ? "#FBBF24AA" : "#EF4444AA";
                            return <div key={h} title={STORES[sk].name + " " + dow + " " + h + ":00\nDemand: " + score + "\nStaff: " + staff + "/" + needed} style={{ flex: 1, height: height, background: color, borderRadius: 1 }}/>;
                          })}
                        </div>
                      );
                    })
                  ];
                })}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 10, color: "#6B7280" }}>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#4ADE80", borderRadius: 2, marginRight: 4 }}/>Adequately Staffed</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#FBBF24", borderRadius: 2, marginRight: 4 }}/>Understaffed</span>
                <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#EF4444", borderRadius: 2, marginRight: 4 }}/>No Coverage</span>
              </div>
            </div>
          )}

          {/* ── SCHEDULE GRID ── */}
          <div style={{ ...card, padding: 0, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #2A2D35" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left", color: "#6B7280", fontSize: 11, width: 150 }}>EMPLOYEE</th>
                  {weekDates.map(function(dt, i) {
                    var isToday = fmtDate(dt) === fmtDate(new Date());
                    return <th key={i} style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: isToday ? "#00D4FF" : "#6B7280", fontWeight: isToday ? 800 : 600 }}>
                      {DAYS[dt.getDay()]} {dt.getDate()}
                    </th>;
                  })}
                  <th style={{ padding: "10px 8px", textAlign: "right", color: "#6B7280", fontSize: 11 }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {weeklySchedule.map(function(emp) {
                  var isFloat = floatMap[emp.name];
                  var storeColors = {};
                  emp.stores.forEach(function(s) { storeColors[s] = STORES[s]?.color || "#6B7280"; });
                  var primaryColor = STORES[emp.store]?.color || "#6B7280";

                  return (
                    <tr key={emp.name} style={{ borderBottom: "1px solid #1A1D23" }}>
                      <td style={{ padding: "8px 12px" }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {emp.name}
                          {isFloat && <span style={{ marginLeft: 4, ...badge("#7B2FFF") }}>🔀 FLOAT</span>}
                        </div>
                        <div style={{ fontSize: 10, color: primaryColor }}>{STORES[emp.store]?.name || emp.store}</div>
                      </td>
                      {weekDates.map(function(dt, di) {
                        var dateStr = fmtDate(dt);
                        var shift = emp.shifts[dateStr];
                        if (!shift) return <td key={di} style={{ padding: "6px 4px", textAlign: "center" }}>
                          <div style={{ color: "#2A2D35", fontSize: 10 }}>—</div>
                        </td>;

                        var shiftStore = shift.store || emp.store;
                        var shiftColor = STORES[shiftStore]?.color || "#6B7280";

                        // Coverage check for this cell
                        var coverageInfo = coverageData?.stores?.[shiftStore]?.days?.[dateStr];
                        var hasGap = false;
                        if (coverageInfo) {
                          for (var h = shift.startHour || 9; h < (shift.endHour || 17); h++) {
                            if (coverageInfo.hours?.[h]?.severity === "CRITICAL") { hasGap = true; break; }
                          }
                        }

                        return (
                          <td key={di} style={{ padding: "4px 3px", textAlign: "center" }}>
                            <div style={{
                              background: shiftColor + "18",
                              borderRadius: 6,
                              padding: "6px 4px",
                              borderLeft: "3px solid " + shiftColor,
                              position: "relative",
                            }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: shiftColor }}>{shift.start}</div>
                              <div style={{ fontSize: 10, color: "#6B7280" }}>{shift.hours}h</div>
                              {shiftStore !== emp.store && (
                                <div style={{ fontSize: 9, color: STORES[shiftStore]?.color, fontWeight: 700 }}>→ {STORES[shiftStore]?.name?.[0]}</div>
                              )}
                              {hasGap && showDemandOverlay && (
                                <div style={{ position: "absolute", top: 2, right: 2, width: 6, height: 6, borderRadius: 3, background: "#EF4444" }} title="Critical gap during this shift"/>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ padding: "8px 8px", textAlign: "right", fontWeight: 700, color: emp.totalHours >= 40 ? "#FBBF24" : emp.totalHours >= 35 ? "#4ADE80" : "#9CA3AF" }}>
                        {emp.totalHours.toFixed(1)}h
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* ── Per-day staffing summary row ── */}
            {showDemandOverlay && (
              <div style={{ display: "grid", gridTemplateColumns: "150px repeat(7, 1fr) 60px", borderTop: "2px solid #2A2D35", padding: "8px 0" }}>
                <div style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700, color: "#FF2D95" }}>DAILY RISK</div>
                {weekDates.map(function(dt, i) {
                  var dateStr = fmtDate(dt);
                  var dow = FULL_DAYS[dt.getDay()];
                  var totalRisk = 0;
                  var storeKeys = weekStore === "all" ? STORE_KEYS : [weekStore];
                  storeKeys.forEach(function(sk) {
                    var dayData = coverageData?.stores?.[sk]?.days?.[dateStr];
                    if (!dayData) return;
                    Object.values(dayData.hours || {}).forEach(function(h) { totalRisk += h.revenueAtRisk || 0; });
                  });
                  return (
                    <div key={i} style={{ textAlign: "center", padding: "4px 4px" }}>
                      {totalRisk > 0 ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: totalRisk > 200 ? "#EF4444" : "#FBBF24" }}>
                          -${totalRisk}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: "#4ADE8066" }}>✓</span>
                      )}
                    </div>
                  );
                })}
                <div/>
              </div>
            )}
          </div>

          {/* ── AI OPTIMIZATION RESULTS ── */}
          {optimization && (
            <div style={{ ...card, borderLeft: "3px solid #7B2FFF" }}>
              <div style={sectionTitle}>🧠 AI-OPTIMIZED SCHEDULE — NEXT WEEK</div>
              {optimization.error ? (
                <div style={{ color: "#EF4444" }}>{optimization.error}</div>
              ) : (
                <>
                  {optimization.rationale && (
                    <div style={{ padding: 12, background: "#12141A", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#C4B5FD", lineHeight: 1.6 }}>
                      {optimization.rationale}
                    </div>
                  )}
                  {optimization.expectedMetrics && (
                    <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                      <div style={miniCard}><div style={{ fontSize: 20, fontWeight: 800, color: "#4ADE80" }}>{optimization.expectedMetrics.totalLaborHours}h</div><div style={metricLabel}>Total Labor</div></div>
                      <div style={miniCard}><div style={{ fontSize: 20, fontWeight: 800, color: "#00D4FF" }}>{optimization.expectedMetrics.coverageScore}%</div><div style={metricLabel}>Coverage Score</div></div>
                      <div style={miniCard}><div style={{ fontSize: 20, fontWeight: 800, color: "#7B2FFF" }}>{optimization.expectedMetrics.estimatedAnswerRate}%</div><div style={metricLabel}>Est. Answer Rate</div></div>
                    </div>
                  )}
                  {optimization.schedule && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ borderBottom: "1px solid #2A2D35" }}>
                        <th style={{ padding: 8, textAlign: "left", color: "#6B7280", fontSize: 10 }}>Employee</th>
                        {["Mon","Tue","Wed","Thu","Fri","Sat"].map(function(d) {
                          return <th key={d} style={{ padding: 8, textAlign: "center", color: "#6B7280", fontSize: 10 }}>{d}</th>;
                        })}
                      </tr></thead>
                      <tbody>
                        {optimization.schedule.map(function(row) {
                          return (
                            <tr key={row.employee} style={{ borderBottom: "1px solid #1A1D23" }}>
                              <td style={{ padding: "6px 8px", fontWeight: 600 }}>{row.employee}</td>
                              {["monday","tuesday","wednesday","thursday","friday","saturday"].map(function(day) {
                                var d = row[day];
                                if (!d) return <td key={day} style={{ padding: 4, textAlign: "center", color: "#2A2D35" }}>OFF</td>;
                                return (
                                  <td key={day} style={{ padding: 4, textAlign: "center" }}>
                                    <div style={{ background: (STORES[d.store]?.color || "#6B7280") + "18", borderRadius: 4, padding: "4px 2px" }}>
                                      <div style={{ fontSize: 10, color: STORES[d.store]?.color || "#6B7280", fontWeight: 700 }}>{STORES[d.store]?.name?.[0] || d.store}</div>
                                      <div style={{ fontSize: 10, color: "#9CA3AF" }}>{d.start}-{d.end}</div>
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════ */}
      {/* HOURS TRACKING */}
      {/* ══════════════════════════════════════════════════ */}
      {subTab === "hours" && (
        <div style={card}>
          <div style={sectionTitle}>HOURS TRACKING — THIS WEEK</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ borderBottom: "1px solid #2A2D35" }}>
              {["Employee","Fishers","Bloomington","Indianapolis","Total","Status"].map(function(h) {
                return <th key={h} style={{ padding: "8px 10px", textAlign: h === "Employee" ? "left" : "right", color: "#6B7280", fontSize: 11 }}>{h}</th>;
              })}
            </tr></thead>
            <tbody>
              {hoursByEmployee.map(function(emp) {
                var isOT = emp.total > 40;
                return (
                  <tr key={emp.name} style={{ borderBottom: "1px solid #1A1D23" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 600 }}>
                      {emp.name}
                      {floatMap[emp.name] && <span style={{ marginLeft: 4, ...badge("#7B2FFF") }}>🔀</span>}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: emp.fishers > 0 ? STORES.fishers.color : "#2A2D35" }}>{emp.fishers > 0 ? emp.fishers.toFixed(1) : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: emp.bloomington > 0 ? STORES.bloomington.color : "#2A2D35" }}>{emp.bloomington > 0 ? emp.bloomington.toFixed(1) : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", color: emp.indianapolis > 0 ? STORES.indianapolis.color : "#2A2D35" }}>{emp.indianapolis > 0 ? emp.indianapolis.toFixed(1) : "—"}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700, color: isOT ? "#EF4444" : emp.total >= 35 ? "#4ADE80" : "#FBBF24" }}>{emp.total.toFixed(1)}</td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      {isOT ? <span style={badge("#EF4444")}>⚠ OT +{(emp.total - 40).toFixed(1)}h</span> :
                       emp.total >= 35 ? <span style={badge("#4ADE80")}>Full</span> :
                       <span style={badge("#FBBF24")}>Under</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

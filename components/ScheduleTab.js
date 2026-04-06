'use client';

import { useState, useEffect, useMemo } from "react";
import { STORES } from "@/lib/constants";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

var STORE_KEYS = Object.keys(STORES);
var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

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
function sc(v, g, y) { return v >= g ? "#4ADE80" : v >= y ? "#FBBF24" : "#F87171"; }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload) return null;
  return (
    <div style={{ background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8,padding:"8px 12px" }}>
      <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>{label}</div>
      {payload.map(function(p, i) { return <div key={i} style={{ color:p.color,fontSize:11 }}>{p.name}: <strong>{p.value}</strong></div>; })}
    </div>
  );
}

export default function ScheduleTab({ storeFilter }) {
  var [wiwStatus, setWiwStatus] = useState(null);
  var [todayShifts, setTodayShifts] = useState([]);
  var [weekShifts, setWeekShifts] = useState({ shifts: [] });
  var [storedShifts, setStoredShifts] = useState([]);
  var [callData, setCallData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [subTab, setSubTab] = useState("coverage");
  var [scheduleStoreFilter, setScheduleStoreFilter] = useState("all");
  var [roster, setRoster] = useState([]);
  var [weekOffset, setWeekOffset] = useState(0);
  var [scorecardData, setScorecardData] = useState(null);
  var [profitData, setProfitData] = useState(null);
  var [auditData, setAuditData] = useState(null);

  function resolveEmployee(name) {
    if (!name || roster.length === 0) return name;
    var lower = name.toLowerCase();
    var match = roster.find(function(r) { return r.name.toLowerCase() === lower; });
    if (match) return match.name;
    var parts = lower.split(/\s+/);
    if (parts.length >= 2) {
      match = roster.find(function(r) { return r.name.toLowerCase().includes(parts[parts.length-1]) && parts[parts.length-1].length > 2; });
      if (match) return match.name;
    }
    return name;
  }

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        var now = new Date();
        var todayStr = fmtDate(now);
        var weekAgo = fmtDate(new Date(now.getTime() - 30*86400000));
        var weekAhead = fmtDate(new Date(now.getTime() + 14*86400000));
        var currentPeriod = now.getFullYear() + "-" + String(now.getMonth()+1).padStart(2,"0");

        var [rosterRes, statusRes, todayRes, weekRes, storedRes, callRes, scRes, profRes, auditRes] = await Promise.allSettled([
          fetch("/api/dialpad/roster").then(function(r){return r.json();}),
          fetch("/api/wheniwork?action=status").then(function(r){return r.json();}),
          fetch("/api/wheniwork?action=today&date=" + todayStr).then(function(r){return r.json();}),
          fetch("/api/wheniwork?action=shifts&start=" + weekAgo + "&end=" + weekAhead).then(function(r){return r.json();}),
          fetch("/api/wheniwork?action=stored-shifts&start=" + weekAgo + "&end=" + todayStr).then(function(r){return r.json();}),
          fetch("/api/dialpad/stored?days=30").then(function(r){return r.json();}),
          fetch("/api/dialpad/scorecard?period=" + currentPeriod).then(function(r){return r.json();}),
          fetch("/api/dialpad/profitability?action=get&period=" + currentPeriod).then(function(r){return r.json();}),
          fetch("/api/dialpad/audit?action=employees").then(function(r){return r.json();}),
        ]);

        if (rosterRes.status === "fulfilled" && rosterRes.value.success) setRoster(rosterRes.value.roster || []);
        if (statusRes.status === "fulfilled") setWiwStatus(statusRes.value);
        if (todayRes.status === "fulfilled" && todayRes.value.success) setTodayShifts(todayRes.value.shifts || []);
        if (weekRes.status === "fulfilled" && weekRes.value.success) setWeekShifts(weekRes.value);
        if (storedRes.status === "fulfilled" && storedRes.value.success) setStoredShifts(storedRes.value.shifts || []);
        if (callRes.status === "fulfilled" && callRes.value.success) setCallData(callRes.value.data || null);
        if (scRes.status === "fulfilled" && scRes.value.success) setScorecardData(scRes.value);
        if (profRes.status === "fulfilled" && profRes.value.success) setProfitData(profRes.value);
        if (auditRes.status === "fulfilled" && auditRes.value.success) setAuditData(auditRes.value);
      } catch(e) { console.error("Schedule load error:", e); }
      setLoading(false);
    }
    load();
  }, []);

  // Re-fetch shifts when week navigation changes
  useEffect(function() {
    if (weekOffset === 0) return; // initial load already handled
    async function loadWeek() {
      var start = fmtDate(weekDates[0]);
      var end = fmtDate(weekDates[6]);
      try {
        var res = await fetch("/api/wheniwork?action=shifts&start=" + start + "&end=" + end);
        var json = await res.json();
        if (json.success) setWeekShifts(json);
      } catch(e) { console.error(e); }
    }
    loadWeek();
  }, [weekOffset]);

  // ═══ TODAY'S SHIFTS BY STORE ═══
  var todayByStore = useMemo(function() {
    var groups = {}; STORE_KEYS.forEach(function(k) { groups[k] = []; });
    todayShifts.forEach(function(s) {
      var sk = locationToStore(s.location);
      if (sk && groups[sk]) groups[sk].push(Object.assign({}, s, { employee: resolveEmployee(s.employee) }));
    });
    return groups;
  }, [todayShifts, roster]);

  // ═══ HOURLY COVERAGE MODEL ═══
  var hourlyCoverage = useMemo(function() {
    if (!callData) return null;
    var hourly = callData.hourlyMissed || [];
    var result = [];
    for (var h = 8; h <= 20; h++) {
      var label = (h > 12 ? (h-12) : h) + (h >= 12 ? "PM" : "AM");
      var row = { hour: label, hourNum: h };
      STORE_KEYS.forEach(function(sk) {
        // Count staff on shift at this hour
        var staffCount = 0;
        (todayByStore[sk] || []).forEach(function(s) {
          var start = new Date(s.start_time).getHours();
          var end = new Date(s.end_time).getHours();
          if (h >= start && h < end) staffCount++;
        });
        row[sk + "_staff"] = staffCount;
        // Get historical missed calls for this hour
        var missedEntry = hourly.find(function(hm) {
          var hmHour = parseInt(hm.hour);
          if (isNaN(hmHour) && hm.hour) {
            var m = hm.hour.match(/(\d+)/);
            if (m) hmHour = parseInt(m[1]);
            if (hm.hour.includes("PM") && hmHour !== 12) hmHour += 12;
            if (hm.hour.includes("AM") && hmHour === 12) hmHour = 0;
          }
          return hmHour === h;
        });
        row[sk + "_missed"] = missedEntry ? (missedEntry[sk] || 0) : 0;
        // Coverage status
        row[sk + "_status"] = staffCount === 0 ? "none" : (row[sk + "_missed"] > 5 && staffCount < 2) ? "under" : "ok";
      });
      result.push(row);
    }
    return result;
  }, [callData, todayByStore]);

  // ═══ WEEKLY SCHEDULE GRID ═══
  var weekDates = useMemo(function() {
    var now = new Date();
    now.setDate(now.getDate() + weekOffset * 7);
    var day = now.getDay();
    var monday = new Date(now);
    monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
    var dates = [];
    for (var i = 0; i < 7; i++) { var d = new Date(monday); d.setDate(monday.getDate() + i); dates.push(d); }
    return dates;
  }, [weekOffset]);

  var weekGrid = useMemo(function() {
    if (!weekShifts.shifts || weekShifts.shifts.length === 0) return [];
    var byUser = {};
    weekShifts.shifts.forEach(function(s) {
      if (s.is_open) return;
      var name = resolveEmployee(s.employee || "Unknown");
      var storeKey = locationToStore(s.location) || "";
      if (scheduleStoreFilter !== "all" && storeKey !== scheduleStoreFilter) return;
      var userKey = name;
      if (!byUser[userKey]) byUser[userKey] = { name: name, store: storeKey, days: [null,null,null,null,null,null,null], totalHours: 0 };
      var shiftDate = new Date(s.start_time);
      var dayIdx = weekDates.findIndex(function(d) { return d.toDateString() === shiftDate.toDateString(); });
      if (dayIdx >= 0) {
        var hours = (new Date(s.end_time) - new Date(s.start_time)) / 3600000;
        byUser[userKey].days[dayIdx] = { start: s.start_time, end: s.end_time, hours: hours, store: storeKey, location: s.location };
        byUser[userKey].totalHours += hours;
        if (storeKey) byUser[userKey].store = storeKey;
      }
    });
    return Object.values(byUser).sort(function(a,b) { return b.totalHours - a.totalHours; });
  }, [weekShifts, roster, scheduleStoreFilter, weekDates]);

  // ═══ SCHEDULE VS REALITY (Last 7 days) ═══
  var scheduleVsReality = useMemo(function() {
    if (!callData || !callData.dailyCalls) return null;
    var daily = callData.dailyCalls;
    var result = [];
    daily.forEach(function(day) {
      var dateStr = day.date;
      var row = { date: dateStr };
      STORE_KEYS.forEach(function(sk) {
        var total = day[sk + "_total"] || 0;
        var answered = day[sk + "_answered"] || 0;
        var missed = Math.max(0, total - answered);
        var rate = total > 0 ? Math.round(answered / total * 100) : 0;
        // Count staff scheduled that day from stored shifts
        var staffOnDay = storedShifts.filter(function(s) {
          return s.store === sk && s.date === dateStr;
        });
        var staffCount = staffOnDay.length;
        var staffHours = staffOnDay.reduce(function(sum, s) { return sum + (parseFloat(s.hours) || 0); }, 0);
        row[sk + "_total"] = total;
        row[sk + "_answered"] = answered;
        row[sk + "_missed"] = missed;
        row[sk + "_rate"] = rate;
        row[sk + "_staff"] = staffCount;
        row[sk + "_staffHours"] = Math.round(staffHours * 10) / 10;
        row[sk + "_callsPerStaff"] = staffCount > 0 ? Math.round(total / staffCount * 10) / 10 : total;
      });
      result.push(row);
    });
    return result;
  }, [callData, storedShifts]);

  // ═══ STAFFING INSIGHT ═══
  var staffingInsight = useMemo(function() {
    if (!scheduleVsReality) return null;
    var insights = {};
    STORE_KEYS.forEach(function(sk) {
      var singleStaff = { days: 0, totalRate: 0 };
      var multiStaff = { days: 0, totalRate: 0 };
      scheduleVsReality.forEach(function(day) {
        if (day[sk + "_total"] === 0) return;
        if (day[sk + "_staff"] <= 1) {
          singleStaff.days++; singleStaff.totalRate += day[sk + "_rate"];
        } else {
          multiStaff.days++; multiStaff.totalRate += day[sk + "_rate"];
        }
      });
      // Use storePerf from stored route for accurate overall rates
      var storePerfEntry = callData && callData.storePerf ? callData.storePerf.find(function(sp) { return sp.store === sk; }) : null;
      insights[sk] = {
        singleRate: singleStaff.days > 0 ? Math.round(singleStaff.totalRate / singleStaff.days) : 0,
        singleDays: singleStaff.days,
        multiRate: multiStaff.days > 0 ? Math.round(multiStaff.totalRate / multiStaff.days) : 0,
        multiDays: multiStaff.days,
        overallRate: storePerfEntry ? storePerfEntry.answer_rate : 0,
        totalInbound: storePerfEntry ? storePerfEntry.total_calls : 0,
        missed: storePerfEntry ? storePerfEntry.missed : 0,
      };
    });
    return insights;
  }, [scheduleVsReality, callData]);

  // ═══ HOURS BY EMPLOYEE (from stored shifts) ═══
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

  // ═══ EMPLOYEE PRODUCTIVITY (Phase 2) ═══
  var employeeProductivity = useMemo(function() {
    if (!scorecardData || !scorecardData.employeeScores) return [];
    var employees = scorecardData.employeeScores || [];
    return employees.map(function(emp) {
      var name = emp.name;
      // Find hours from stored shifts
      var hoursEntry = hoursByEmployee.find(function(h) { return h.name.toLowerCase() === name.toLowerCase(); });
      var totalHours = hoursEntry ? hoursEntry.total : 0;

      // Repair data
      var repairs = emp.repairs || {};
      var phoneRepairs = repairs.phone_tickets || 0;
      var otherRepairs = repairs.other_tickets || 0;
      var totalRepairs = phoneRepairs + otherRepairs;
      var accyGP = repairs.accy_gp || 0;
      var repairRevenue = repairs.revenue || (totalRepairs * 120); // estimate if no revenue field

      // Audit data
      var audit = emp.audit || {};
      var auditScore = audit.score || 0;
      var apptRate = audit.appt_offered || 0;

      // Compliance
      var compliance = emp.compliance || {};
      var compScore = compliance.score || 0;

      // Revenue per labor hour
      var revPerHour = totalHours > 0 ? Math.round(repairRevenue / totalHours * 100) / 100 : 0;
      var repairsPerHour = totalHours > 0 ? Math.round(totalRepairs / totalHours * 100) / 100 : 0;

      return {
        name: name, store: emp.store, overall: emp.overall,
        totalHours: Math.round(totalHours * 10) / 10,
        phoneRepairs: phoneRepairs, otherRepairs: otherRepairs, totalRepairs: totalRepairs,
        accyGP: Math.round(accyGP * 100) / 100,
        repairRevenue: Math.round(repairRevenue * 100) / 100,
        auditScore: auditScore, apptRate: apptRate, compScore: compScore,
        revPerHour: revPerHour, repairsPerHour: repairsPerHour,
      };
    }).sort(function(a, b) { return b.revPerHour - a.revPerHour; });
  }, [scorecardData, hoursByEmployee]);

  // ═══ LABOR ECONOMICS (Phase 3) ═══
  var laborEconomics = useMemo(function() {
    var stores = {};
    STORE_KEYS.forEach(function(sk) {
      var store = STORES[sk];
      // Hours from stored shifts
      var storeHours = storedShifts.filter(function(s) { return s.store === sk; }).reduce(function(sum, s) { return sum + (parseFloat(s.hours) || 0); }, 0);

      // Revenue from profitability
      var profRecord = profitData && profitData.records ? profitData.records.find(function(r) { return r.store === sk; }) : null;
      var grossRev = profRecord ? (parseFloat(profRecord.repair_revenue) || 0) + (parseFloat(profRecord.accessory_revenue) || 0) + (parseFloat(profRecord.device_revenue) || 0) + (parseFloat(profRecord.services_revenue) || 0) + (parseFloat(profRecord.parts_revenue) || 0) : 0;
      var payroll = profRecord ? parseFloat(profRecord.payroll) || 0 : 0;

      // Call performance from storePerf
      var storeCallPerf = callData && callData.storePerf ? callData.storePerf.find(function(sp) { return sp.store === sk; }) : null;
      var answerRate = storeCallPerf ? storeCallPerf.answer_rate : 0;
      var missedCalls = storeCallPerf ? storeCallPerf.missed : 0;

      var revPerManHour = storeHours > 0 ? Math.round(grossRev / storeHours * 100) / 100 : 0;
      var laborPct = grossRev > 0 ? Math.round(payroll / grossRev * 1000) / 10 : 0;
      var profitPerManHour = storeHours > 0 && grossRev > 0 ? Math.round((grossRev - payroll) / storeHours * 100) / 100 : 0;

      // What would adding 1 FTE mean?
      var additionalHours = 160; // ~40hrs/week * 4 weeks
      var additionalCost = 2500; // ~$15/hr * 160hrs
      var missedCallRevenue = missedCalls * 0.25 * 150; // 25% conversion, $150 avg ticket
      var addFTENet = missedCallRevenue - additionalCost;

      stores[sk] = {
        name: store.name.replace("CPR ",""), color: store.color,
        hours: Math.round(storeHours * 10) / 10,
        grossRev: grossRev, payroll: payroll,
        revPerManHour: revPerManHour, profitPerManHour: profitPerManHour,
        laborPct: laborPct, answerRate: answerRate, missedCalls: missedCalls,
        addFTERevRecovery: Math.round(missedCallRevenue),
        addFTECost: additionalCost,
        addFTENet: Math.round(addFTENet),
      };
    });
    return stores;
  }, [storedShifts, profitData, callData]);

  // ═══ OPTIMAL SCHEDULE (Phase 3) ═══
  var optimalSchedule = useMemo(function() {
    if (!callData || !callData.hourlyMissed) return null;
    var hourly = callData.hourlyMissed || [];
    var result = {};
    STORE_KEYS.forEach(function(sk) {
      var hours = [];
      hourly.forEach(function(h) {
        var missed = h[sk] || 0;
        var hourNum = parseInt(h.hour);
        if (isNaN(hourNum) && h.hour) {
          var m = h.hour.match(/(\d+)/);
          if (m) hourNum = parseInt(m[1]);
          if (h.hour.includes("PM") && hourNum !== 12) hourNum += 12;
          if (h.hour.includes("AM") && hourNum === 12) hourNum = 0;
        }
        hours.push({ hour: h.hour, hourNum: hourNum, missed: missed });
      });

      // Determine recommended staffing: 2+ people if hourly missed > 3
      var recommendations = hours.map(function(h) {
        var recommended = h.missed > 5 ? 3 : h.missed > 2 ? 2 : 1;
        return { hour: h.hour, hourNum: h.hourNum, missed: h.missed, recommended: recommended };
      }).filter(function(h) { return h.hourNum >= 9 && h.hourNum <= 19; }); // Business hours only

      result[sk] = recommendations;
    });
    return result;
  }, [callData]);

  var SUB_TABS = [
    { id: "coverage", label: "Live Coverage", icon: "\uD83D\uDFE2" },
    { id: "reality", label: "Schedule vs Reality", icon: "\uD83D\uDD0D" },
    { id: "productivity", label: "Employee Productivity", icon: "\uD83D\uDCB0" },
    { id: "economics", label: "Labor Economics", icon: "\uD83D\uDCC8" },
    { id: "week", label: "Weekly View", icon: "\uD83D\uDCC5" },
    { id: "hours", label: "Hours Tracking", icon: "\u23F0" },
  ];

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading labor intelligence...</div>;

  return (
    <div>
      {/* WhenIWork Status */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
        <div style={{ display:"flex",gap:4 }}>
          {SUB_TABS.map(function(t) {
            return <button key={t.id} onClick={function(){setSubTab(t.id);}} style={{
              padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",whiteSpace:"nowrap",
              background:subTab===t.id?"#7B2FFF22":"#1A1D23",color:subTab===t.id?"#7B2FFF":"#8B8F98",
              fontSize:12,fontWeight:600
            }}>{t.icon+" "+t.label}</button>;
          })}
        </div>
        {wiwStatus && wiwStatus.authenticated && <span style={{ color:"#4ADE80",fontSize:11 }}>{"\u25CF"} WhenIWork Connected</span>}
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* LIVE COVERAGE DASHBOARD */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "coverage" && (
        <div>
          {/* Today's date */}
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:4 }}>Live Coverage Dashboard</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:20 }}>{new Date().toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric", year:"numeric" })}</div>

          {/* Per-store coverage cards */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:24 }}>
            {STORE_KEYS.map(function(sk) {
              var store = STORES[sk];
              var shifts = todayByStore[sk] || [];
              var now = new Date();
              var currentHour = now.getHours();
              var currentStaff = shifts.filter(function(s) {
                return new Date(s.start_time).getHours() <= currentHour && new Date(s.end_time).getHours() > currentHour;
              });
              // Check next 3 hours
              var upcoming = [];
              for (var h = 1; h <= 3; h++) {
                var futureHour = currentHour + h;
                if (futureHour > 20) break;
                var futureStaff = shifts.filter(function(s) {
                  return new Date(s.start_time).getHours() <= futureHour && new Date(s.end_time).getHours() > futureHour;
                });
                var hourLabel = (futureHour > 12 ? futureHour-12 : futureHour) + (futureHour >= 12 ? "PM" : "AM");
                var expectedMissed = hourlyCoverage ? (hourlyCoverage.find(function(hc) { return hc.hourNum === futureHour; }) || {})[sk+"_missed"] || 0 : 0;
                upcoming.push({ hour: hourLabel, staff: futureStaff.length, expectedCalls: expectedMissed > 0 ? Math.round(expectedMissed * 4) : 0, expectedMissed: expectedMissed });
              }

              var statusColor = currentStaff.length === 0 ? "#F87171" : currentStaff.length < 2 ? "#FBBF24" : "#4ADE80";
              var statusText = currentStaff.length === 0 ? "NO COVERAGE" : currentStaff.length < 2 ? "SINGLE COVERAGE" : "FULLY STAFFED";

              return (
                <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                    <div style={{ color:store.color,fontSize:14,fontWeight:700 }}>{store.name.replace("CPR ","")}</div>
                    <div style={{ padding:"3px 8px",borderRadius:4,background:statusColor+"18",color:statusColor,fontSize:9,fontWeight:700 }}>{statusText}</div>
                  </div>

                  {/* Current staff */}
                  <div style={{ marginBottom:14 }}>
                    <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase",marginBottom:6 }}>On Shift Now</div>
                    {currentStaff.length > 0 ? currentStaff.map(function(s, i) {
                      return <div key={i} style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1E2028" }}>
                        <span style={{ color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{s.employee}</span>
                        <span style={{ color:"#6B6F78",fontSize:10 }}>{fmtTime(s.start_time)} - {fmtTime(s.end_time)}</span>
                      </div>;
                    }) : <div style={{ color:"#F87171",fontSize:11 }}>No one on shift</div>}
                  </div>

                  {/* All today's shifts */}
                  <div style={{ marginBottom:14 }}>
                    <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase",marginBottom:4 }}>Full Day ({shifts.length} shifts)</div>
                    {shifts.map(function(s, i) {
                      var isNow = new Date(s.start_time).getHours() <= currentHour && new Date(s.end_time).getHours() > currentHour;
                      return <div key={i} style={{ display:"flex",justifyContent:"space-between",padding:"3px 0",color:isNow ? "#F0F1F3" : "#6B6F78",fontSize:11 }}>
                        <span style={{ fontWeight:isNow?600:400 }}>{isNow ? "\u25CF " : ""}{s.employee}</span>
                        <span>{fmtTime(s.start_time)}-{fmtTime(s.end_time)}</span>
                      </div>;
                    })}
                    {shifts.length === 0 && <div style={{ color:"#F87171",fontSize:10 }}>No shifts scheduled</div>}
                  </div>

                  {/* Next 3 hours forecast */}
                  {upcoming.length > 0 && (
                    <div>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase",marginBottom:4 }}>Next Hours Forecast</div>
                      {upcoming.map(function(u, i) {
                        var risk = u.staff === 0 ? "#F87171" : (u.expectedMissed > 3 && u.staff < 2) ? "#FBBF24" : "#4ADE80";
                        return <div key={i} style={{ display:"flex",justifyContent:"space-between",padding:"3px 0",alignItems:"center" }}>
                          <span style={{ color:"#C8CAD0",fontSize:11 }}>{u.hour}</span>
                          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                            <span style={{ color:"#6B6F78",fontSize:10 }}>{u.staff} staff</span>
                            <span style={{ width:8,height:8,borderRadius:"50%",background:risk }} />
                          </div>
                        </div>;
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hourly Coverage Heat Map */}
          {hourlyCoverage && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:4 }}>Hourly Coverage vs Historical Missed Calls</div>
              <div style={{ color:"#6B6F78",fontSize:11,marginBottom:14 }}>Staff count today vs 30-day average missed calls per hour</div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%",borderCollapse:"collapse",minWidth:600 }}>
                  <thead>
                    <tr>
                      <th style={{ padding:"6px 8px",textAlign:"left",color:"#8B8F98",fontSize:9,fontWeight:700 }}>HOUR</th>
                      {STORE_KEYS.map(function(sk) {
                        return [
                          <th key={sk+"s"} style={{ padding:"6px 4px",textAlign:"center",color:STORES[sk].color,fontSize:9,fontWeight:700 }}>{STORES[sk].name.replace("CPR ","").substring(0,5).toUpperCase()} STAFF</th>,
                          <th key={sk+"m"} style={{ padding:"6px 4px",textAlign:"center",color:"#F87171",fontSize:9,fontWeight:700 }}>MISSED</th>,
                        ];
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {hourlyCoverage.map(function(row) {
                      var isCurrentHour = row.hourNum === new Date().getHours();
                      return (
                        <tr key={row.hour} style={{ background:isCurrentHour ? "#7B2FFF08" : "transparent",borderBottom:"1px solid #1E2028" }}>
                          <td style={{ padding:"5px 8px",color:isCurrentHour ? "#7B2FFF" : "#C8CAD0",fontSize:11,fontWeight:isCurrentHour?700:400 }}>{isCurrentHour ? "\u25B6 " : ""}{row.hour}</td>
                          {STORE_KEYS.map(function(sk) {
                            var staff = row[sk+"_staff"];
                            var missed = row[sk+"_missed"];
                            var risk = staff === 0 && missed > 0 ? "#F87171" : staff < 2 && missed > 3 ? "#FBBF24" : "#4ADE80";
                            return [
                              <td key={sk+"s"} style={{ padding:"5px 4px",textAlign:"center",color:staff > 0 ? "#F0F1F3" : "#F87171",fontSize:12,fontWeight:600 }}>{staff}</td>,
                              <td key={sk+"m"} style={{ padding:"5px 4px",textAlign:"center" }}>
                                {missed > 0 ? <span style={{ padding:"2px 6px",borderRadius:4,background:risk+"18",color:risk,fontSize:10,fontWeight:600 }}>{missed}</span> : <span style={{ color:"#2A2D35",fontSize:10 }}>0</span>}
                              </td>,
                            ];
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* SCHEDULE VS REALITY */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "reality" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:4 }}>Schedule vs Reality</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:20 }}>Staffing levels correlated with call outcomes — insight cards use 30-day data</div>

          {/* Staffing insight cards */}
          {staffingInsight && (
            <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:20 }}>
              {STORE_KEYS.map(function(sk) {
                var store = STORES[sk];
                var ins = staffingInsight[sk];
                var delta = ins.multiRate - ins.singleRate;
                return (
                  <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
                    <div style={{ color:store.color,fontSize:13,fontWeight:700,marginBottom:12 }}>{store.name.replace("CPR ","")}</div>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10 }}>
                      <div style={{ background:"#12141A",borderRadius:8,padding:12,textAlign:"center" }}>
                        <div style={{ color:"#FBBF24",fontSize:9,fontWeight:700,textTransform:"uppercase",marginBottom:4 }}>1 Staff</div>
                        <div style={{ color:sc(ins.singleRate,85,70),fontSize:22,fontWeight:800 }}>{ins.singleRate}%</div>
                        <div style={{ color:"#6B6F78",fontSize:9 }}>answer rate</div>
                        <div style={{ color:"#6B6F78",fontSize:9 }}>{ins.singleDays} days</div>
                      </div>
                      <div style={{ background:"#12141A",borderRadius:8,padding:12,textAlign:"center" }}>
                        <div style={{ color:"#4ADE80",fontSize:9,fontWeight:700,textTransform:"uppercase",marginBottom:4 }}>2+ Staff</div>
                        <div style={{ color:sc(ins.multiRate,85,70),fontSize:22,fontWeight:800 }}>{ins.multiRate}%</div>
                        <div style={{ color:"#6B6F78",fontSize:9 }}>answer rate</div>
                        <div style={{ color:"#6B6F78",fontSize:9 }}>{ins.multiDays} days</div>
                      </div>
                    </div>
                    {delta > 0 && ins.singleDays > 0 && (
                      <div style={{ padding:"6px 10px",borderRadius:6,background:"#7B2FFF08",border:"1px solid #7B2FFF22",color:"#7B2FFF",fontSize:10,textAlign:"center" }}>
                        Adding a 2nd person improves answer rate by <strong>+{delta}%</strong>
                      </div>
                    )}
                    {ins.overallRate > 0 && (
                      <div style={{ marginTop:8,padding:"6px 10px",borderRadius:6,background:"#12141A",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                        <span style={{ color:"#8B8F98",fontSize:9 }}>30-day overall</span>
                        <span style={{ color:sc(ins.overallRate,85,70),fontSize:13,fontWeight:700 }}>{ins.overallRate}% <span style={{ color:"#F87171",fontSize:9,fontWeight:400 }}>({ins.missed} missed of {ins.totalInbound})</span></span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Daily breakdown table */}
          {scheduleVsReality && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>Daily Breakdown <span style={{ color:"#6B6F78",fontSize:11,fontWeight:400 }}>— last 7 days</span></div>
              <div style={{ overflowX:"auto" }}>
                <table style={{ width:"100%",borderCollapse:"collapse",minWidth:800 }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #2A2D35" }}>
                      <th style={{ padding:"8px",textAlign:"left",color:"#8B8F98",fontSize:9,fontWeight:700 }}>DATE</th>
                      {STORE_KEYS.map(function(sk) {
                        return [
                          <th key={sk+"st"} style={{ padding:"8px 4px",textAlign:"center",color:STORES[sk].color,fontSize:9,fontWeight:700 }}>STAFF</th>,
                          <th key={sk+"c"} style={{ padding:"8px 4px",textAlign:"center",color:"#8B8F98",fontSize:9,fontWeight:700 }}>CALLS</th>,
                          <th key={sk+"m"} style={{ padding:"8px 4px",textAlign:"center",color:"#F87171",fontSize:9,fontWeight:700 }}>MISS</th>,
                          <th key={sk+"r"} style={{ padding:"8px 4px",textAlign:"center",color:"#8B8F98",fontSize:9,fontWeight:700 }}>RATE</th>,
                        ];
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleVsReality.slice(-7).map(function(day) {
                      return (
                        <tr key={day.date} style={{ borderBottom:"1px solid #1E2028" }}>
                          <td style={{ padding:"6px 8px",color:"#C8CAD0",fontSize:11,fontWeight:600 }}>{day.date}</td>
                          {STORE_KEYS.map(function(sk) {
                            var staff = day[sk+"_staff"];
                            var total = day[sk+"_total"];
                            var missed = day[sk+"_missed"];
                            var rate = day[sk+"_rate"];
                            return [
                              <td key={sk+"st"} style={{ padding:"6px 4px",textAlign:"center",color:staff > 1 ? "#4ADE80" : staff === 1 ? "#FBBF24" : "#F87171",fontSize:12,fontWeight:700 }}>{staff}</td>,
                              <td key={sk+"c"} style={{ padding:"6px 4px",textAlign:"center",color:"#C8CAD0",fontSize:11 }}>{total}</td>,
                              <td key={sk+"m"} style={{ padding:"6px 4px",textAlign:"center",color:missed > 0 ? "#F87171" : "#4ADE80",fontSize:11,fontWeight:600 }}>{missed}</td>,
                              <td key={sk+"r"} style={{ padding:"6px 4px",textAlign:"center" }}>
                                <span style={{ padding:"2px 6px",borderRadius:4,background:sc(rate,85,70)+"18",color:sc(rate,85,70),fontSize:10,fontWeight:600 }}>{rate}%</span>
                              </td>,
                            ];
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* EMPLOYEE PRODUCTIVITY (Phase 2) */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "productivity" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:4 }}>Employee Productivity</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:20 }}>Revenue generation, repair output, and labor efficiency per employee</div>

          {employeeProductivity.length > 0 ? (
            <div>
              {/* Top performers cards */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20 }}>
                {employeeProductivity.slice(0, 3).map(function(emp, i) {
                  var medals = ["\uD83E\uDD47","\uD83E\uDD48","\uD83E\uDD49"];
                  var storeColor = STORES[emp.store] ? STORES[emp.store].color : "#8B8F98";
                  return (
                    <div key={emp.name} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+storeColor+"33" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                        <div>
                          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{medals[i]} {emp.name}</div>
                          <div style={{ color:storeColor,fontSize:10 }}>{STORES[emp.store]?STORES[emp.store].name.replace("CPR ",""):emp.store}</div>
                        </div>
                        <div style={{ padding:"4px 10px",borderRadius:6,background:"#4ADE8018",color:"#4ADE80",fontSize:16,fontWeight:800 }}>{emp.overall}/100</div>
                      </div>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                        <div style={{ background:"#12141A",borderRadius:6,padding:10,textAlign:"center" }}>
                          <div style={{ color:"#4ADE80",fontSize:18,fontWeight:700 }}>{"$"+emp.revPerHour}</div>
                          <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Rev/Hour</div>
                        </div>
                        <div style={{ background:"#12141A",borderRadius:6,padding:10,textAlign:"center" }}>
                          <div style={{ color:"#00D4FF",fontSize:18,fontWeight:700 }}>{emp.repairsPerHour}</div>
                          <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Repairs/Hour</div>
                        </div>
                        <div style={{ background:"#12141A",borderRadius:6,padding:10,textAlign:"center" }}>
                          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700 }}>{emp.totalRepairs}</div>
                          <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Total Repairs</div>
                        </div>
                        <div style={{ background:"#12141A",borderRadius:6,padding:10,textAlign:"center" }}>
                          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700 }}>{emp.totalHours}h</div>
                          <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Hours Worked</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Full table */}
              <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
                <table style={{ width:"100%",borderCollapse:"collapse" }}>
                  <thead>
                    <tr style={{ borderBottom:"2px solid #2A2D35" }}>
                      {["Employee","Store","Score","Hours","Repairs","Accy GP","Rev/Hour","Repairs/Hr","Audit","Appt %","Compliance"].map(function(h,i) {
                        return <th key={i} style={{ padding:"10px 8px",textAlign:i < 2 ? "left" : "center",color:"#8B8F98",fontSize:9,fontWeight:700,textTransform:"uppercase" }}>{h}</th>;
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {employeeProductivity.map(function(emp) {
                      var storeColor = STORES[emp.store] ? STORES[emp.store].color : "#8B8F98";
                      return (
                        <tr key={emp.name} style={{ borderBottom:"1px solid #1E2028" }}>
                          <td style={{ padding:"8px",color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{emp.name}</td>
                          <td style={{ padding:"8px",color:storeColor,fontSize:11 }}>{STORES[emp.store]?STORES[emp.store].name.replace("CPR ",""):emp.store}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:sc(emp.overall,70,40),fontSize:13,fontWeight:700 }}>{emp.overall}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#F0F1F3",fontSize:12 }}>{emp.totalHours}h</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{emp.totalRepairs} <span style={{ color:"#6B6F78",fontSize:9 }}>({emp.phoneRepairs}📱 {emp.otherRepairs}🔧)</span></td>
                          <td style={{ padding:"8px",textAlign:"center",color:emp.accyGP > 200 ? "#4ADE80" : emp.accyGP > 50 ? "#FBBF24" : "#F87171",fontSize:12,fontWeight:600 }}>{"$"+emp.accyGP}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:emp.revPerHour > 30 ? "#4ADE80" : emp.revPerHour > 15 ? "#FBBF24" : "#F87171",fontSize:13,fontWeight:700 }}>{"$"+emp.revPerHour}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:"#00D4FF",fontSize:12,fontWeight:600 }}>{emp.repairsPerHour}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:sc(emp.auditScore,70,40),fontSize:12 }}>{emp.auditScore}</td>
                          <td style={{ padding:"8px",textAlign:"center",color:sc(emp.apptRate,70,40),fontSize:12 }}>{emp.apptRate}%</td>
                          <td style={{ padding:"8px",textAlign:"center",color:sc(emp.compScore,70,40),fontSize:12 }}>{emp.compScore}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Insight */}
              {employeeProductivity.length >= 2 && (
                <div style={{ marginTop:16,padding:"12px 16px",borderRadius:8,background:"#7B2FFF08",border:"1px solid #7B2FFF22" }}>
                  <div style={{ color:"#7B2FFF",fontSize:10,fontWeight:700,marginBottom:4 }}>{"\uD83D\uDCA1"} PRODUCTIVITY INSIGHT</div>
                  <div style={{ color:"#C8CAD0",fontSize:12 }}>
                    Top producer <strong style={{ color:"#4ADE80" }}>{employeeProductivity[0].name}</strong> generates <strong>{"$"+employeeProductivity[0].revPerHour}/hr</strong>.
                    {employeeProductivity[employeeProductivity.length-1].revPerHour > 0 && (
                      <span> Lowest is <strong style={{ color:"#FBBF24" }}>{employeeProductivity[employeeProductivity.length-1].name}</strong> at <strong>{"$"+employeeProductivity[employeeProductivity.length-1].revPerHour}/hr</strong> — a <strong style={{ color:"#F87171" }}>{Math.round(((employeeProductivity[0].revPerHour - employeeProductivity[employeeProductivity.length-1].revPerHour) / employeeProductivity[0].revPerHour) * 100)}%</strong> gap.</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78" }}>No scorecard data available for this month</div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* LABOR ECONOMICS (Phase 3) */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "economics" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:4 }}>Labor Economics</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:20 }}>Revenue efficiency, labor cost ratios, and staffing ROI analysis</div>

          {/* Store economics cards */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:20 }}>
            {STORE_KEYS.map(function(sk) {
              var econ = laborEconomics[sk];
              if (!econ) return null;
              var laborTarget = 30; // 30% target
              var laborStatus = econ.laborPct > 0 ? (econ.laborPct <= laborTarget ? "#4ADE80" : econ.laborPct <= 40 ? "#FBBF24" : "#F87171") : "#6B6F78";
              return (
                <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+econ.color+"33" }}>
                  <div style={{ color:econ.color,fontSize:14,fontWeight:700,marginBottom:14 }}>{econ.name}</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12 }}>
                    <div style={{ background:"#12141A",borderRadius:8,padding:12,textAlign:"center" }}>
                      <div style={{ color:"#4ADE80",fontSize:20,fontWeight:800 }}>{"$"+econ.revPerManHour}</div>
                      <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Revenue/Hour</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:8,padding:12,textAlign:"center" }}>
                      <div style={{ color:laborStatus,fontSize:20,fontWeight:800 }}>{econ.laborPct > 0 ? econ.laborPct+"%" : "—"}</div>
                      <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Labor % of Rev</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:8,padding:12,textAlign:"center" }}>
                      <div style={{ color:"#F0F1F3",fontSize:20,fontWeight:700 }}>{econ.hours}h</div>
                      <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Total Hours</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:8,padding:12,textAlign:"center" }}>
                      <div style={{ color:"#00D4FF",fontSize:20,fontWeight:700 }}>{"$"+econ.profitPerManHour}</div>
                      <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Profit/Hour</div>
                    </div>
                  </div>
                  {econ.grossRev > 0 && (
                    <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",borderTop:"1px solid #2A2D35" }}>
                      <span style={{ color:"#8B8F98",fontSize:9 }}>Revenue</span>
                      <span style={{ color:"#4ADE80",fontSize:11,fontWeight:600 }}>{"$"+econ.grossRev.toLocaleString()}</span>
                    </div>
                  )}
                  {econ.payroll > 0 && (
                    <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 0" }}>
                      <span style={{ color:"#8B8F98",fontSize:9 }}>Payroll</span>
                      <span style={{ color:"#F87171",fontSize:11,fontWeight:600 }}>{"$"+econ.payroll.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add FTE Analysis */}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:4 }}>{"\uD83E\uDDE0"} Staffing ROI — What If You Added 1 FTE?</div>
            <div style={{ color:"#6B6F78",fontSize:11,marginBottom:14 }}>Based on missed calls × 25% conversion × $150 avg ticket vs ~$2,500/mo labor cost</div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14 }}>
              {STORE_KEYS.map(function(sk) {
                var econ = laborEconomics[sk];
                if (!econ) return null;
                var positive = econ.addFTENet > 0;
                return (
                  <div key={sk} style={{ background:"#12141A",borderRadius:10,padding:16,border:"1px solid "+(positive?"#4ADE80":"#F87171")+"22" }}>
                    <div style={{ color:econ.color,fontSize:12,fontWeight:700,marginBottom:10 }}>{econ.name}</div>
                    <div style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1E2028" }}>
                      <span style={{ color:"#8B8F98",fontSize:10 }}>Missed calls/month</span>
                      <span style={{ color:"#F87171",fontSize:12,fontWeight:600 }}>{econ.missedCalls}</span>
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1E2028" }}>
                      <span style={{ color:"#8B8F98",fontSize:10 }}>Revenue recoverable</span>
                      <span style={{ color:"#4ADE80",fontSize:12,fontWeight:600 }}>{"$"+econ.addFTERevRecovery.toLocaleString()}</span>
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1E2028" }}>
                      <span style={{ color:"#8B8F98",fontSize:10 }}>FTE cost</span>
                      <span style={{ color:"#F87171",fontSize:12,fontWeight:600 }}>{"$"+econ.addFTECost.toLocaleString()}</span>
                    </div>
                    <div style={{ display:"flex",justifyContent:"space-between",padding:"6px 0",marginTop:4 }}>
                      <span style={{ color:"#F0F1F3",fontSize:11,fontWeight:700 }}>Net ROI</span>
                      <span style={{ color:positive?"#4ADE80":"#F87171",fontSize:14,fontWeight:800 }}>{(positive?"+":"")+"$"+econ.addFTENet.toLocaleString()}</span>
                    </div>
                    <div style={{ marginTop:8,padding:"6px 10px",borderRadius:6,background:positive?"#4ADE8008":"#F8717108",border:"1px solid "+(positive?"#4ADE8022":"#F8717122"),textAlign:"center" }}>
                      <span style={{ color:positive?"#4ADE80":"#F87171",fontSize:10,fontWeight:600 }}>{positive ? "\u2705 Hire — pays for itself" : "\u274C Not justified yet"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Optimal Schedule Recommendations */}
          {optimalSchedule && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:4 }}>{"\uD83D\uDCC5"} Optimal Staffing Recommendations</div>
              <div style={{ color:"#6B6F78",fontSize:11,marginBottom:14 }}>Based on 30-day call patterns — recommended minimum staff per hour</div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14 }}>
                {STORE_KEYS.map(function(sk) {
                  var recs = optimalSchedule[sk] || [];
                  return (
                    <div key={sk} style={{ background:"#12141A",borderRadius:10,padding:14 }}>
                      <div style={{ color:STORES[sk].color,fontSize:12,fontWeight:700,marginBottom:8 }}>{STORES[sk].name.replace("CPR ","")}</div>
                      {recs.map(function(r) {
                        var bg = r.recommended >= 3 ? "#F8717112" : r.recommended >= 2 ? "#FBBF2412" : "#4ADE8012";
                        var color = r.recommended >= 3 ? "#F87171" : r.recommended >= 2 ? "#FBBF24" : "#4ADE80";
                        return (
                          <div key={r.hour} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:"1px solid #1A1D23" }}>
                            <span style={{ color:"#C8CAD0",fontSize:10 }}>{r.hour}</span>
                            <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                              {r.missed > 0 && <span style={{ color:"#F87171",fontSize:9 }}>{r.missed} missed</span>}
                              <span style={{ padding:"2px 8px",borderRadius:4,background:bg,color:color,fontSize:10,fontWeight:700 }}>{r.recommended} staff</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* WEEKLY VIEW */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "week" && (
        <div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
            <div style={{ display:"flex",alignItems:"center",gap:12 }}>
              <button onClick={function(){setWeekOffset(weekOffset-1);}} style={{ padding:"6px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#8B8F98",fontSize:14,cursor:"pointer" }}>{"\u25C0"}</button>
              <div>
                <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700 }}>Weekly Schedule</div>
                <div style={{ color:"#6B6F78",fontSize:12 }}>Week of {weekDates[0].toLocaleDateString(undefined,{month:"short",day:"numeric"})} - {weekDates[6].toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</div>
              </div>
              <button onClick={function(){setWeekOffset(weekOffset+1);}} style={{ padding:"6px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#8B8F98",fontSize:14,cursor:"pointer" }}>{"\u25B6"}</button>
              {weekOffset !== 0 && <button onClick={function(){setWeekOffset(0);}} style={{ padding:"4px 10px",borderRadius:6,border:"none",background:"#7B2FFF22",color:"#7B2FFF",fontSize:11,fontWeight:600,cursor:"pointer" }}>Today</button>}
            </div>
            <div style={{ display:"flex",gap:6 }}>
              {[{id:"all",label:"All Stores"}].concat(STORE_KEYS.map(function(k){return{id:k,label:STORES[k].name.replace("CPR ","")}})).map(function(f) {
                return <button key={f.id} onClick={function(){setScheduleStoreFilter(f.id);}} style={{
                  padding:"6px 12px",borderRadius:6,border:"none",cursor:"pointer",
                  background:scheduleStoreFilter===f.id?"#7B2FFF22":"#12141A",color:scheduleStoreFilter===f.id?"#7B2FFF":"#8B8F98",fontSize:11,fontWeight:600
                }}>{f.label}</button>;
              })}
            </div>
          </div>

          <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
            <table style={{ width:"100%",borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"2px solid #2A2D35" }}>
                  <th style={{ padding:"10px 12px",textAlign:"left",color:"#8B8F98",fontSize:10,fontWeight:700,width:140 }}>EMPLOYEE</th>
                  {weekDates.map(function(d, i) {
                    var isToday = d.toDateString() === new Date().toDateString();
                    return <th key={i} style={{ padding:"10px 6px",textAlign:"center",color:isToday?"#7B2FFF":"#8B8F98",fontSize:10,fontWeight:700 }}>
                      {DAYS[d.getDay()]} {d.getDate()}
                    </th>;
                  })}
                  <th style={{ padding:"10px 8px",textAlign:"right",color:"#8B8F98",fontSize:10,fontWeight:700 }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {weekGrid.map(function(emp) {
                  var storeColor = STORES[emp.store] ? STORES[emp.store].color : "#6B6F78";
                  return (
                    <tr key={emp.name} style={{ borderBottom:"1px solid #1E2028" }}>
                      <td style={{ padding:"8px 12px" }}>
                        <div style={{ color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{emp.name}</div>
                        <div style={{ color:storeColor,fontSize:9 }}>{emp.store ? STORES[emp.store].name.replace("CPR ","") : ""}</div>
                      </td>
                      {emp.days.map(function(day, i) {
                        if (!day) return <td key={i} style={{ padding:"6px",textAlign:"center",color:"#2A2D35",fontSize:10 }}>—</td>;
                        var dayStore = STORES[day.store];
                        var dayColor = dayStore ? dayStore.color : "#6B6F78";
                        return <td key={i} style={{ padding:"4px" }}>
                          <div style={{ background:dayColor+"12",borderRadius:6,padding:"6px 4px",textAlign:"center",border:"1px solid "+dayColor+"22" }}>
                            <div style={{ color:dayColor,fontSize:10,fontWeight:600 }}>{fmtTime(day.start)}</div>
                            <div style={{ color:"#6B6F78",fontSize:8 }}>{day.hours.toFixed(1)}h</div>
                          </div>
                        </td>;
                      })}
                      <td style={{ padding:"8px",textAlign:"right",color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.totalHours.toFixed(1)}h</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* HOURS TRACKING */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "hours" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:4 }}>Hours Tracking</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:20 }}>From stored shift data (last 7 days synced)</div>

          {/* Store hour summary */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:20 }}>
            {STORE_KEYS.map(function(sk) {
              var store = STORES[sk];
              var totalH = hoursByEmployee.reduce(function(s, e) { return s + (e[sk] || 0); }, 0);
              return (
                <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:20,textAlign:"center",border:"1px solid "+store.color+"33" }}>
                  <div style={{ color:store.color,fontSize:13,fontWeight:700,marginBottom:6 }}>{store.name.replace("CPR ","")}</div>
                  <div style={{ color:"#F0F1F3",fontSize:28,fontWeight:800 }}>{Math.round(totalH * 10) / 10}h</div>
                  <div style={{ color:"#6B6F78",fontSize:10 }}>total scheduled</div>
                </div>
              );
            })}
          </div>

          {/* Employee hours table */}
          {hoursByEmployee.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #2A2D35" }}>
                    <th style={{ padding:"10px 14px",textAlign:"left",color:"#8B8F98",fontSize:10,fontWeight:700 }}>EMPLOYEE</th>
                    {STORE_KEYS.map(function(sk) {
                      return <th key={sk} style={{ padding:"10px 8px",textAlign:"center",color:STORES[sk].color,fontSize:10,fontWeight:700 }}>{STORES[sk].name.replace("CPR ","").substring(0,5).toUpperCase()}</th>;
                    })}
                    <th style={{ padding:"10px 14px",textAlign:"right",color:"#8B8F98",fontSize:10,fontWeight:700 }}>TOTAL</th>
                    <th style={{ padding:"10px 14px",textAlign:"right",color:"#8B8F98",fontSize:10,fontWeight:700 }}>40H STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursByEmployee.map(function(emp) {
                    var overtime = emp.total > 40;
                    var nearOT = emp.total > 35 && emp.total <= 40;
                    return (
                      <tr key={emp.name} style={{ borderBottom:"1px solid #1E2028" }}>
                        <td style={{ padding:"8px 14px",color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{emp.name}</td>
                        {STORE_KEYS.map(function(sk) {
                          var h = Math.round((emp[sk] || 0) * 10) / 10;
                          return <td key={sk} style={{ padding:"8px",textAlign:"center",color:h > 0 ? "#F0F1F3" : "#2A2D35",fontSize:12 }}>{h > 0 ? h + "h" : "—"}</td>;
                        })}
                        <td style={{ padding:"8px 14px",textAlign:"right",color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{Math.round(emp.total * 10) / 10}h</td>
                        <td style={{ padding:"8px 14px",textAlign:"right" }}>
                          {overtime ? <span style={{ padding:"2px 8px",borderRadius:4,background:"#F8717118",color:"#F87171",fontSize:10,fontWeight:600 }}>OT +{Math.round((emp.total - 40) * 10) / 10}h</span> :
                           nearOT ? <span style={{ padding:"2px 8px",borderRadius:4,background:"#FBBF2418",color:"#FBBF24",fontSize:10,fontWeight:600 }}>Near OT</span> :
                           <span style={{ padding:"2px 8px",borderRadius:4,background:"#4ADE8018",color:"#4ADE80",fontSize:10,fontWeight:600 }}>OK</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

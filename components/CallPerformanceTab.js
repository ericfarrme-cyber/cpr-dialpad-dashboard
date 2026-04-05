'use client';

import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  PolarRadiusAxis, AreaChart, Area
} from "recharts";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);
var AVG_TICKET = 150;
var CONV_RATE = 0.25;

function sc(v, g, y) { return v >= g ? "#4ADE80" : v >= y ? "#FBBF24" : "#F87171"; }

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8,padding:"10px 14px",zIndex:9999 }}>
      <div style={{ color:"#8B8F98",fontSize:11,marginBottom:6 }}>{label}</div>
      {payload.map(function(p, i) {
        return <div key={i} style={{ display:"flex",alignItems:"center",gap:8,marginTop:3 }}>
          <span style={{ width:8,height:8,borderRadius:"50%",background:p.color }} />
          <span style={{ color:"#C8CAD0",fontSize:12 }}>{p.name}: <strong style={{ color:"#F0F1F3" }}>{p.value}</strong></span>
        </div>;
      })}
    </div>
  );
}

export default function CallPerformanceTab({ storeFilter, overviewStats, dailyCalls, hourlyMissed, dowData, callbackData, problemCalls }) {
  var [subTab, setSubTab] = useState("executive");
  var [scheduleData, setScheduleData] = useState(null);
  var [employeeData, setEmployeeData] = useState(null);
  var [repeatCallers, setRepeatCallers] = useState(null);

  // Fetch additional data
  useEffect(function() {
    Promise.allSettled([
      fetch("/api/wheniwork?action=shifts&start=" + new Date(Date.now() - 7*86400000).toISOString().split("T")[0] + "&end=" + new Date(Date.now() + 1*86400000).toISOString().split("T")[0]).then(function(r){return r.json();}),
      fetch("/api/dialpad/audit?action=employees").then(function(r){return r.json();}),
      fetch("/api/dialpad/repeat-callers?days=7").then(function(r){return r.json();}),
    ]).then(function(results) {
      if (results[0].status === "fulfilled" && results[0].value.success) setScheduleData(results[0].value);
      if (results[1].status === "fulfilled" && results[1].value.success) setEmployeeData(results[1].value);
      if (results[2].status === "fulfilled" && results[2].value.success) setRepeatCallers(results[2].value);
    });
  }, []);

  // ═══ COMPUTED METRICS ═══
  var totals = overviewStats.totals;
  var totalCalls = totals.answered + totals.missed;
  var answerRate = totalCalls > 0 ? (totals.answered / totalCalls * 100) : 0;
  var missedRevenue = Math.round(totals.missed * CONV_RATE * AVG_TICKET);

  // Yesterday's data (last entry in dailyCalls)
  var yesterday = useMemo(function() {
    if (!dailyCalls || dailyCalls.length < 2) return null;
    var yd = dailyCalls[dailyCalls.length - 1];
    var dayBefore = dailyCalls[dailyCalls.length - 2];
    if (!yd) return null;
    var res = { date: yd.date, stores: {} };
    var totalY = 0, answeredY = 0, totalDB = 0, answeredDB = 0;
    STORE_KEYS.forEach(function(sk) {
      var t = yd[sk + "_total"] || 0;
      var a = yd[sk + "_answered"] || 0;
      var m = yd[sk + "_missed"] || (t - a);
      var tdb = dayBefore ? (dayBefore[sk + "_total"] || 0) : 0;
      var adb = dayBefore ? (dayBefore[sk + "_answered"] || 0) : 0;
      res.stores[sk] = { total: t, answered: a, missed: m, prevTotal: tdb, prevAnswered: adb };
      totalY += t; answeredY += a;
      totalDB += tdb; answeredDB += adb;
    });
    res.total = totalY; res.answered = answeredY; res.missed = totalY - answeredY;
    res.rate = totalY > 0 ? Math.round(answeredY / totalY * 100) : 0;
    res.prevRate = totalDB > 0 ? Math.round(answeredDB / totalDB * 100) : 0;
    res.revenueLost = Math.round(res.missed * CONV_RATE * AVG_TICKET);
    return res;
  }, [dailyCalls]);

  // 7-day rolling stats per store
  var weeklyTrend = useMemo(function() {
    if (!dailyCalls || dailyCalls.length < 7) return null;
    var last7 = dailyCalls.slice(-7);
    var prev7 = dailyCalls.length >= 14 ? dailyCalls.slice(-14, -7) : null;
    var stores = {};
    STORE_KEYS.forEach(function(sk) {
      var t7 = 0, a7 = 0, pt = 0, pa = 0;
      last7.forEach(function(d) { t7 += d[sk + "_total"] || 0; a7 += d[sk + "_answered"] || 0; });
      if (prev7) prev7.forEach(function(d) { pt += d[sk + "_total"] || 0; pa += d[sk + "_answered"] || 0; });
      var rate = t7 > 0 ? Math.round(a7 / t7 * 100) : 0;
      var prevRate = pt > 0 ? Math.round(pa / pt * 100) : 0;
      stores[sk] = { total: t7, answered: a7, missed: t7 - a7, rate: rate, prevRate: prevRate, trend: rate - prevRate };
    });
    return stores;
  }, [dailyCalls]);

  // Peak miss hours
  var peakMissHours = useMemo(function() {
    if (!hourlyMissed) return [];
    return hourlyMissed.map(function(h) {
      var total = STORE_KEYS.reduce(function(s, k) { return s + (h[k] || 0); }, 0);
      return { hour: h.hour, total: total, fishers: h.fishers || 0, bloomington: h.bloomington || 0, indianapolis: h.indianapolis || 0 };
    }).filter(function(h) { return h.total > 0; }).sort(function(a, b) { return b.total - a.total; });
  }, [hourlyMissed]);

  // DOW worst days
  var worstDays = useMemo(function() {
    if (!dowData) return [];
    return dowData.map(function(d) {
      var total = STORE_KEYS.reduce(function(s, k) { return s + (d[k] || 0); }, 0);
      return Object.assign({}, d, { total: total });
    }).sort(function(a, b) { return b.total - a.total; });
  }, [dowData]);

  // Predicted today's volume
  var prediction = useMemo(function() {
    if (!dailyCalls || dailyCalls.length < 14) return null;
    var todayDow = new Date().getDay();
    var dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    var todayName = dayNames[todayDow];
    // Get same DOW from last 4 weeks
    var sameDow = dailyCalls.filter(function(d, i) { return i % 7 === (dailyCalls.length - 1) % 7; }).slice(-4);
    if (sameDow.length === 0) return null;
    var avgTotal = Math.round(sameDow.reduce(function(s, d) {
      return s + STORE_KEYS.reduce(function(ss, k) { return ss + (d[k + "_total"] || 0); }, 0);
    }, 0) / sameDow.length);
    var avgMissed = Math.round(sameDow.reduce(function(s, d) {
      return s + STORE_KEYS.reduce(function(ss, k) { return ss + (d[k + "_missed"] || Math.max(0, (d[k + "_total"] || 0) - (d[k + "_answered"] || 0))); }, 0);
    }, 0) / sameDow.length);
    return { day: todayName, expectedCalls: avgTotal, expectedMissed: avgMissed };
  }, [dailyCalls]);

  var SUB_TABS = [
    { id: "executive", label: "Executive Summary", icon: "\uD83C\uDFAF" },
    { id: "yesterday", label: "Yesterday's Ops", icon: "\uD83D\uDCCB" },
    { id: "trends", label: "7-Day Trends", icon: "\uD83D\uDCC8" },
    { id: "callbacks", label: "Callbacks", icon: "\uD83D\uDCDE" },
    { id: "employees", label: "Employee Perf", icon: "\uD83D\uDC65" },
    { id: "actions", label: "Action Items", icon: "\u26A1" },
  ];

  return (
    <div>
      {/* Sub-tab nav */}
      <div style={{ display:"flex",gap:4,marginBottom:24,overflowX:"auto" }}>
        {SUB_TABS.map(function(t) {
          return <button key={t.id} onClick={function(){setSubTab(t.id);}} style={{
            padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",whiteSpace:"nowrap",
            background:subTab===t.id?"#7B2FFF22":"#1A1D23",color:subTab===t.id?"#7B2FFF":"#8B8F98",
            fontSize:12,fontWeight:600
          }}>{t.icon + " " + t.label}</button>;
        })}
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* EXECUTIVE SUMMARY */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "executive" && (
        <div>
          {/* Revenue Impact Banner */}
          <div style={{ background:"linear-gradient(135deg,#F8717108,#FF2D9508)",borderRadius:14,padding:24,marginBottom:20,border:"1px solid #F8717122" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ color:"#F87171",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:4 }}>{"\uD83D\uDCB0"} Revenue Impact (30 Days)</div>
                <div style={{ color:"#F0F1F3",fontSize:32,fontWeight:800 }}>{"$" + missedRevenue.toLocaleString()}</div>
                <div style={{ color:"#8B8F98",fontSize:11,marginTop:2 }}>{totals.missed} missed calls × {Math.round(CONV_RATE*100)}% conversion × ${AVG_TICKET} avg ticket</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Answer Rate</div>
                <div style={{ color:sc(answerRate, 85, 70),fontSize:42,fontWeight:800 }}>{answerRate.toFixed(1)}%</div>
              </div>
            </div>
          </div>

          {/* Store Rankings */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:20 }}>
            {STORE_KEYS.map(function(sk) {
              var s = overviewStats.storeStats[sk];
              var store = STORES[sk];
              var realTotal = s.answered + s.missed;
              var rate = realTotal > 0 ? (s.answered / realTotal * 100) : 0;
              var cb = callbackData ? callbackData.find(function(c) { return c.store === sk; }) : null;
              var cbRate = cb && cb.missed > 0 ? Math.round(((cb.calledBack || cb.within30 + cb.within60 + cb.later || 0) / cb.missed) * 100) : 0;
              var storeMissedRev = Math.round(s.missed * CONV_RATE * AVG_TICKET);
              return (
                <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
                    <div style={{ width:10,height:10,borderRadius:"50%",background:store.color }} />
                    <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{store.name.replace("CPR ","")}</div>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12 }}>
                    <div><div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Answer Rate</div><div style={{ color:sc(rate,85,70),fontSize:22,fontWeight:800 }}>{rate.toFixed(0)}%</div></div>
                    <div><div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Callback Rate</div><div style={{ color:sc(cbRate,80,50),fontSize:22,fontWeight:800 }}>{cbRate}%</div></div>
                    <div><div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Missed</div><div style={{ color:"#F87171",fontSize:18,fontWeight:700 }}>{s.missed}</div></div>
                    <div><div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Revenue Lost</div><div style={{ color:"#FF2D95",fontSize:18,fontWeight:700 }}>{"$"+storeMissedRev.toLocaleString()}</div></div>
                  </div>
                  <div style={{ background:"#12141A",borderRadius:4,height:6,overflow:"hidden" }}>
                    <div style={{ width:rate+"%",height:"100%",borderRadius:4,background:store.color }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Red Alert Flags */}
          {(function() {
            var alerts = [];
            STORE_KEYS.forEach(function(sk) {
              var s = overviewStats.storeStats[sk];
              if (s.missed > 15 * 30 / 30) alerts.push({ type: "high_miss", store: STORES[sk].name, missed: s.missed, color: "#F87171" });
            });
            if (peakMissHours.length > 0 && peakMissHours[0].total > 10) {
              alerts.push({ type: "peak_hour", hour: peakMissHours[0].hour, total: peakMissHours[0].total, color: "#FBBF24" });
            }
            if (callbackData) callbackData.forEach(function(cb) {
              var cbRate = cb.missed > 0 ? ((cb.calledBack || 0) / cb.missed * 100) : 100;
              if (cbRate < 50 && cb.missed > 5) alerts.push({ type: "low_callback", store: STORES[cb.store] ? STORES[cb.store].name : cb.store, rate: Math.round(cbRate), never: cb.never || 0, color: "#FF2D95" });
            });
            if (alerts.length === 0) return null;
            return (
              <div style={{ background:"#F8717108",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #F8717122" }}>
                <div style={{ color:"#F87171",fontSize:12,fontWeight:700,marginBottom:10 }}>{"\uD83D\uDEA8"} RED ALERT FLAGS</div>
                {alerts.map(function(a, i) {
                  var msg = a.type === "high_miss" ? a.store + ": " + a.missed + " missed calls this period" :
                    a.type === "peak_hour" ? "Peak miss hour: " + a.hour + " (" + a.total + " missed calls)" :
                    a.store + ": Only " + a.rate + "% callback rate — " + a.never + " calls never returned";
                  return <div key={i} style={{ display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:i < alerts.length - 1 ? "1px solid #2A2D35" : "none" }}>
                    <span style={{ width:8,height:8,borderRadius:"50%",background:a.color }} />
                    <span style={{ color:"#C8CAD0",fontSize:12 }}>{msg}</span>
                  </div>;
                })}
              </div>
            );
          })()}

          {/* Daily Call Chart */}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,height:320,marginBottom:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Daily Call Volume — Answered vs Missed</div>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={dailyCalls}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
                <XAxis dataKey="date" tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} interval={4} />
                <YAxis tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize:10 }} />
                {STORE_KEYS.map(function(key) { return (storeFilter==="all"||storeFilter===key) ? <Bar key={key+"_a"} stackId={key} dataKey={key+"_answered"} name={STORES[key].name.replace("CPR ","")+" Answered"} fill={STORES[key].color} /> : null; })}
                {STORE_KEYS.map(function(key) { return (storeFilter==="all"||storeFilter===key) ? <Bar key={key+"_m"} stackId={key} dataKey={key+"_missed"} name={STORES[key].name.replace("CPR ","")+" Missed"} fill="#F87171" radius={[2,2,0,0]} /> : null; })}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Prediction */}
          {prediction && (
            <div style={{ background:"#7B2FFF08",borderRadius:12,padding:20,border:"1px solid #7B2FFF22" }}>
              <div style={{ color:"#7B2FFF",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6 }}>{"\uD83D\uDD2E"} Predictive Intelligence</div>
              <div style={{ color:"#F0F1F3",fontSize:13 }}>Based on the last 30 days, <strong>{prediction.day}s</strong> average <strong style={{ color:"#F87171" }}>{prediction.expectedMissed}</strong> missed calls out of <strong>{prediction.expectedCalls}</strong> total. {"That's ~$" + Math.round(prediction.expectedMissed * CONV_RATE * AVG_TICKET).toLocaleString() + " at risk today."}</div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* YESTERDAY'S OPS */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "yesterday" && (
        <div>
          {yesterday ? (
            <div>
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:20 }}>
                <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700 }}>Yesterday: {yesterday.date}</div>
                <div style={{ padding:"4px 10px",borderRadius:6,background:sc(yesterday.rate,85,70)+"18",color:sc(yesterday.rate,85,70),fontSize:12,fontWeight:700 }}>
                  {yesterday.rate}% answer rate
                  {yesterday.prevRate > 0 && <span style={{ marginLeft:6,color:yesterday.rate >= yesterday.prevRate ? "#4ADE80" : "#F87171" }}>{yesterday.rate >= yesterday.prevRate ? "\u25B2" : "\u25BC"}{Math.abs(yesterday.rate - yesterday.prevRate)}%</span>}
                </div>
              </div>

              {/* Per-store yesterday cards */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:20 }}>
                {STORE_KEYS.map(function(sk) {
                  var s = yesterday.stores[sk];
                  if (!s) return null;
                  var store = STORES[sk];
                  var rate = s.total > 0 ? Math.round(s.answered / s.total * 100) : 0;
                  var prevRate = s.prevTotal > 0 ? Math.round(s.prevAnswered / s.prevTotal * 100) : 0;
                  return (
                    <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:18 }}>
                      <div style={{ color:store.color,fontSize:13,fontWeight:700,marginBottom:10 }}>{store.name.replace("CPR ","")}</div>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
                        <div><div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Total</div><div style={{ color:"#F0F1F3",fontSize:20,fontWeight:700 }}>{s.total}</div></div>
                        <div><div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Answered</div><div style={{ color:"#4ADE80",fontSize:20,fontWeight:700 }}>{s.answered}</div></div>
                        <div><div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Missed</div><div style={{ color:"#F87171",fontSize:20,fontWeight:700 }}>{s.missed}</div></div>
                      </div>
                      <div style={{ marginTop:10,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                        <span style={{ color:sc(rate,85,70),fontSize:18,fontWeight:800 }}>{rate}%</span>
                        {prevRate > 0 && <span style={{ color:rate >= prevRate ? "#4ADE80" : "#F87171",fontSize:11 }}>{rate >= prevRate ? "\u25B2" : "\u25BC"} vs prior day</span>}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Revenue impact */}
              <div style={{ background:"#F8717108",borderRadius:12,padding:16,marginBottom:20,border:"1px solid #F8717122",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                <div style={{ color:"#F87171",fontSize:12 }}>{"\uD83D\uDCB0"} Yesterday's missed call revenue impact:</div>
                <div style={{ color:"#F87171",fontSize:22,fontWeight:800 }}>{"$" + yesterday.revenueLost.toLocaleString()}</div>
              </div>

              {/* Peak hour analysis */}
              <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
                <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>Peak Miss Hours — Staffing Adjustment Intel</div>
                <div style={{ height:250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyMissed}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
                      <XAxis dataKey="hour" tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} />
                      <YAxis tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} axisLine={false} />
                      <Tooltip content={<CustomTooltip />} />
                      {STORE_KEYS.map(function(k) {
                        return (storeFilter==="all"||storeFilter===k) ? <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[4,4,0,0]} barSize={14} /> : null;
                      })}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {peakMissHours.length > 0 && (
                  <div style={{ marginTop:12,padding:12,background:"#12141A",borderRadius:8 }}>
                    <div style={{ color:"#FBBF24",fontSize:10,fontWeight:700,marginBottom:4 }}>{"\u26A0\uFE0F"} TOP PROBLEM HOURS</div>
                    {peakMissHours.slice(0, 3).map(function(h, i) {
                      return <div key={i} style={{ color:"#C8CAD0",fontSize:12,padding:"3px 0" }}>
                        <strong style={{ color:"#F87171" }}>{h.hour}</strong>: {h.total} missed (F:{h.fishers} B:{h.bloomington} I:{h.indianapolis})
                      </div>;
                    })}
                  </div>
                )}
              </div>

              {/* DOW pattern */}
              <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
                <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>Day-of-Week Pattern</div>
                <div style={{ height:250 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={dowData}>
                      <PolarGrid stroke="#2A2D35" />
                      <PolarAngleAxis dataKey="day" tick={{ fill:"#8B8F98",fontSize:11 }} />
                      <PolarRadiusAxis tick={{ fill:"#6B6F78",fontSize:9 }} axisLine={false} />
                      {STORE_KEYS.map(function(k) {
                        return (storeFilter==="all"||storeFilter===k) ? <Radar key={k} name={STORES[k].name.replace("CPR ","")} dataKey={k} stroke={STORES[k].color} fill={STORES[k].color} fillOpacity={0.15} strokeWidth={2} /> : null;
                      })}
                      <Legend iconType="circle" iconSize={8} />
                      <Tooltip content={<CustomTooltip />} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                {worstDays.length > 0 && (
                  <div style={{ marginTop:12,padding:12,background:"#12141A",borderRadius:8 }}>
                    <div style={{ color:"#FF2D95",fontSize:10,fontWeight:700,marginBottom:4 }}>{"\uD83D\uDCC5"} WORST DAYS FOR MISSED CALLS</div>
                    {worstDays.slice(0, 3).map(function(d, i) {
                      return <div key={i} style={{ color:"#C8CAD0",fontSize:12,padding:"3px 0" }}>
                        <strong style={{ color:"#F87171" }}>{d.day}</strong>: {d.total} missed
                      </div>;
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78" }}>No daily data available yet</div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* 7-DAY TRENDS */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "trends" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:20 }}>7-Day Rolling Performance</div>

          {/* Use overviewStats for accurate per-store data */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:20 }}>
            {STORE_KEYS.map(function(sk) {
              var s = overviewStats.storeStats[sk];
              var store = STORES[sk];
              var realTotal = s.answered + s.missed;
              var rate = realTotal > 0 ? Math.round(s.answered / realTotal * 100) : 0;
              var wt = weeklyTrend ? weeklyTrend[sk] : null;
              var trendDelta = wt ? wt.trend : 0;
              var trendUp = trendDelta >= 0;
              // Use overviewStats for accurate numbers, weeklyTrend for delta only
              return (
                <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
                  <div style={{ color:store.color,fontSize:13,fontWeight:700,marginBottom:12 }}>{store.name.replace("CPR ","")}</div>
                  <div style={{ display:"flex",alignItems:"baseline",gap:8,marginBottom:8 }}>
                    <span style={{ color:sc(rate,85,70),fontSize:32,fontWeight:800 }}>{rate}%</span>
                    {trendDelta !== 0 && <span style={{ color:trendUp?"#4ADE80":"#F87171",fontSize:13,fontWeight:600 }}>{trendUp?"\u25B2":"\u25BC"}{Math.abs(trendDelta)}%</span>}
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6 }}>
                    <div style={{ background:"#12141A",borderRadius:6,padding:"6px 8px",textAlign:"center" }}>
                      <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{realTotal}</div>
                      <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Total</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:6,padding:"6px 8px",textAlign:"center" }}>
                      <div style={{ color:"#4ADE80",fontSize:16,fontWeight:700 }}>{s.answered}</div>
                      <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Answered</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:6,padding:"6px 8px",textAlign:"center" }}>
                      <div style={{ color:"#F87171",fontSize:16,fontWeight:700 }}>{s.missed}</div>
                      <div style={{ color:"#6B6F78",fontSize:8,textTransform:"uppercase" }}>Missed</div>
                    </div>
                  </div>
                  <div style={{ marginTop:10,color:"#FF2D95",fontSize:11 }}>{"$" + Math.round(s.missed * CONV_RATE * AVG_TICKET).toLocaleString() + " revenue at risk"}</div>
                </div>
              );
            })}
          </div>

          {/* Staffing gap analysis */}
          {peakMissHours.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
              <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>{"\uD83D\uDC65"} Staffing Gap Analysis — Hours With Consistent Misses</div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:10 }}>
                {peakMissHours.slice(0, 8).map(function(h) {
                  var severity = h.total > 20 ? "#F87171" : h.total > 10 ? "#FBBF24" : "#8B8F98";
                  return (
                    <div key={h.hour} style={{ background:"#12141A",borderRadius:8,padding:14,textAlign:"center",border:"1px solid "+severity+"22" }}>
                      <div style={{ color:severity,fontSize:20,fontWeight:800 }}>{h.total}</div>
                      <div style={{ color:"#C8CAD0",fontSize:12,fontWeight:600 }}>{h.hour}</div>
                      <div style={{ color:"#6B6F78",fontSize:9,marginTop:4 }}>
                        {STORE_KEYS.map(function(k) { return h[k] > 0 ? STORES[k].name.replace("CPR ","").charAt(0) + ":" + h[k] : null; }).filter(Boolean).join(" ")}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Repeat callers */}
          {repeatCallers && repeatCallers.callers && repeatCallers.callers.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>{"\uD83D\uDD01"} Repeat Callers (Last 7 Days)</div>
              <div style={{ color:"#6B6F78",fontSize:11,marginBottom:12 }}>Customers calling multiple times may indicate unresolved issues</div>
              {repeatCallers.callers.slice(0, 10).map(function(c, i) {
                return <div key={i} style={{ padding:"8px 0",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div>
                    <span style={{ color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{c.phone}</span>
                    {c.customer_name && <span style={{ color:"#8B8F98",fontSize:11,marginLeft:8 }}>{c.customer_name}</span>}
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                    <span style={{ color:c.call_count >= 5 ? "#F87171" : "#FBBF24",fontSize:14,fontWeight:700 }}>{c.call_count} calls</span>
                    <span style={{ color:"#6B6F78",fontSize:10 }}>{c.store}</span>
                  </div>
                </div>;
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* CALLBACKS */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "callbacks" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:20 }}>Callback Accountability</div>
          {callbackData && callbackData.length > 0 ? (
            <div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat("+callbackData.length+",1fr)",gap:14,marginBottom:20 }}>
                {callbackData.map(function(cb) {
                  var store = STORES[cb.store];
                  if (!store) return null;
                  var totalCB = (cb.within30 || 0) + (cb.within60 || 0) + (cb.later || 0);
                  var rate = cb.missed > 0 ? Math.round(totalCB / cb.missed * 100) : 0;
                  return (
                    <div key={cb.store} style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
                      <div style={{ color:store.color,fontSize:14,fontWeight:700,marginBottom:14 }}>{store.name.replace("CPR ","")}</div>
                      <div style={{ textAlign:"center",marginBottom:14 }}>
                        <div style={{ color:sc(rate,80,50),fontSize:42,fontWeight:800 }}>{rate}%</div>
                        <div style={{ color:"#6B6F78",fontSize:11 }}>callback rate</div>
                      </div>
                      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:8 }}>
                        <div style={{ background:"#12141A",borderRadius:6,padding:10,textAlign:"center" }}>
                          <div style={{ color:"#F87171",fontSize:18,fontWeight:700 }}>{cb.missed}</div>
                          <div style={{ color:"#6B6F78",fontSize:9,textTransform:"uppercase" }}>Missed</div>
                        </div>
                        <div style={{ background:"#12141A",borderRadius:6,padding:10,textAlign:"center" }}>
                          <div style={{ color:"#4ADE80",fontSize:18,fontWeight:700 }}>{totalCB}</div>
                          <div style={{ color:"#6B6F78",fontSize:9,textTransform:"uppercase" }}>Called Back</div>
                        </div>
                      </div>
                      <div style={{ marginTop:12 }}>
                        <div style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1E2028" }}>
                          <span style={{ color:"#4ADE80",fontSize:10 }}>Within 30 min</span>
                          <span style={{ color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{cb.within30 || 0}</span>
                        </div>
                        <div style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1E2028" }}>
                          <span style={{ color:"#FBBF24",fontSize:10 }}>Within 1 hour</span>
                          <span style={{ color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{cb.within60 || 0}</span>
                        </div>
                        <div style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1E2028" }}>
                          <span style={{ color:"#8B8F98",fontSize:10 }}>Later</span>
                          <span style={{ color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{cb.later || 0}</span>
                        </div>
                        <div style={{ display:"flex",justifyContent:"space-between",padding:"4px 0" }}>
                          <span style={{ color:"#F87171",fontSize:10,fontWeight:700 }}>Never called back</span>
                          <span style={{ color:"#F87171",fontSize:12,fontWeight:700 }}>{cb.never || 0}</span>
                        </div>
                      </div>
                      {(cb.never || 0) > 0 && (
                        <div style={{ marginTop:10,padding:"6px 10px",borderRadius:6,background:"#F8717112",border:"1px solid #F8717122",textAlign:"center" }}>
                          <div style={{ color:"#F87171",fontSize:10,fontWeight:600 }}>{"\u26A0\uFE0F $" + Math.round((cb.never || 0) * CONV_RATE * AVG_TICKET).toLocaleString() + " in lost revenue"}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78" }}>No callback data available</div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* EMPLOYEE PERFORMANCE */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "employees" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:20 }}>Employee Call Performance</div>
          {employeeData && employeeData.employees && employeeData.employees.length > 0 ? (
            <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"2px solid #2A2D35" }}>
                    {["Employee","Store","Audits","Avg Score","Appt %","Warranty %","Discount %"].map(function(h,i) {
                      return <th key={i} style={{ padding:"12px 14px",textAlign:i < 2 ? "left" : "center",color:"#8B8F98",fontSize:10,textTransform:"uppercase",fontWeight:700 }}>{h}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {employeeData.employees.filter(function(e) {
                    return (e.name || e.employee) && (e.total_audits || 0) >= 1;
                  }).sort(function(a, b) { return (b.total_audits || 0) - (a.total_audits || 0); }).map(function(e) {
                    var empName = e.name || e.employee || "Unknown";
                    var avgScore = (e.avg_score || 0);
                    // Smart rate handling: if > 1, already a percentage; if <= 1, it's a decimal
                    var apptRate = (e.appt_rate || 0) > 1 ? Math.round(e.appt_rate) : Math.round((e.appt_rate || 0) * 100);
                    var warrantyRate = (e.warranty_rate || 0) > 1 ? Math.round(e.warranty_rate) : Math.round((e.warranty_rate || 0) * 100);
                    var discountRate = (e.discount_rate || 0) > 1 ? Math.round(e.discount_rate) : Math.round((e.discount_rate || 0) * 100);
                    var storeKey = e.store || "";
                    return (
                      <tr key={empName + storeKey} style={{ borderBottom:"1px solid #1E2028" }}>
                        <td style={{ padding:"10px 14px",color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{empName}</td>
                        <td style={{ padding:"10px 14px",color:STORES[storeKey]?STORES[storeKey].color:"#8B8F98",fontSize:12 }}>{STORES[storeKey]?STORES[storeKey].name.replace("CPR ",""):storeKey}</td>
                        <td style={{ padding:"10px 14px",textAlign:"center",color:"#F0F1F3",fontSize:13 }}>{e.total_audits || 0}</td>
                        <td style={{ padding:"10px 14px",textAlign:"center",color:sc(avgScore/4*100,80,60),fontSize:14,fontWeight:700 }}>{avgScore.toFixed(1)}/4</td>
                        <td style={{ padding:"10px 14px",textAlign:"center",color:sc(apptRate,70,40),fontSize:13,fontWeight:600 }}>{apptRate}%</td>
                        <td style={{ padding:"10px 14px",textAlign:"center",color:sc(warrantyRate,60,30),fontSize:13,fontWeight:600 }}>{warrantyRate}%</td>
                        <td style={{ padding:"10px 14px",textAlign:"center",color:sc(discountRate,60,30),fontSize:13,fontWeight:600 }}>{discountRate}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78" }}>Loading employee data...</div>
          )}

          {/* Schedule correlation */}
          {scheduleData && scheduleData.shifts && scheduleData.shifts.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginTop:20 }}>
              <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>{"\uD83D\uDCC5"} Schedule vs Peak Miss Times</div>
              <div style={{ color:"#6B6F78",fontSize:11,marginBottom:12 }}>Cross-reference who was on shift during high-miss hours</div>
              {peakMissHours.slice(0, 3).map(function(h) {
                var hourNum = parseInt(h.hour);
                if (isNaN(hourNum) && h.hour) {
                  var m = h.hour.match(/(\d+)/);
                  if (m) hourNum = parseInt(m[1]);
                  if (h.hour.includes("PM") && hourNum !== 12) hourNum += 12;
                }
                var onShift = scheduleData.shifts.filter(function(s) {
                  if (!s.start_time || !s.end_time) return false;
                  var start = new Date(s.start_time).getHours();
                  var end = new Date(s.end_time).getHours();
                  return hourNum >= start && hourNum < end;
                });
                return (
                  <div key={h.hour} style={{ padding:"10px 0",borderBottom:"1px solid #1E2028" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                      <span style={{ color:"#F87171",fontSize:12,fontWeight:600 }}>{h.hour} — {h.total} missed calls</span>
                      <span style={{ color:"#8B8F98",fontSize:10 }}>{onShift.length} employees on shift</span>
                    </div>
                    {onShift.length > 0 && (
                      <div style={{ color:"#C8CAD0",fontSize:11 }}>
                        On shift: {onShift.map(function(s) { return s.employee + " (" + (s.location || "") + ")"; }).join(", ")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════ */}
      {/* ACTION ITEMS */}
      {/* ═══════════════════════════════════════════ */}
      {subTab === "actions" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:700,marginBottom:20 }}>Today's Action Dashboard</div>

          {/* Priority: Unreturned calls */}
          <div style={{ background:"#F8717108",borderRadius:12,padding:20,marginBottom:16,border:"1px solid #F8717122" }}>
            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
              <span style={{ width:12,height:12,borderRadius:"50%",background:"#F87171" }} />
              <span style={{ color:"#F87171",fontSize:13,fontWeight:700 }}>PRIORITY — Unreturned Missed Calls</span>
            </div>
            {callbackData && callbackData.some(function(cb) { return (cb.never || 0) > 0; }) ? (
              callbackData.filter(function(cb) { return (cb.never || 0) > 0; }).map(function(cb) {
                var store = STORES[cb.store];
                return (
                  <div key={cb.store} style={{ padding:"8px 12px",background:"#12141A",borderRadius:8,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <span style={{ color:store?store.color:"#8B8F98",fontSize:12,fontWeight:600 }}>{store?store.name.replace("CPR ",""):cb.store}</span>
                    <span style={{ color:"#F87171",fontSize:13,fontWeight:700 }}>{cb.never} calls never returned — {"$" + Math.round(cb.never * CONV_RATE * AVG_TICKET).toLocaleString() + " at risk"}</span>
                  </div>
                );
              })
            ) : (
              <div style={{ color:"#4ADE80",fontSize:12 }}>{"\u2705"} All missed calls have been returned!</div>
            )}
          </div>

          {/* Watch: Employee trends */}
          <div style={{ background:"#FBBF2408",borderRadius:12,padding:20,marginBottom:16,border:"1px solid #FBBF2422" }}>
            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
              <span style={{ width:12,height:12,borderRadius:"50%",background:"#FBBF24" }} />
              <span style={{ color:"#FBBF24",fontSize:13,fontWeight:700 }}>WATCH — Employee Performance Flags</span>
            </div>
            {employeeData && employeeData.employees ? (
              <div>
                {(function() {
                  // Consolidate flags per employee, require minimum 5 audits
                  var flags = [];
                  employeeData.employees.filter(function(e) {
                    return (e.name || e.employee) && (e.total_audits || 0) >= 5;
                  }).forEach(function(e) {
                    var empName = e.name || e.employee;
                    var issues = [];
                    var apptRate = (e.appt_rate || 0) > 1 ? e.appt_rate : (e.appt_rate || 0) * 100;
                    var warrantyRate = (e.warranty_rate || 0) > 1 ? e.warranty_rate : (e.warranty_rate || 0) * 100;
                    var avgScore = e.avg_score || 0;
                    if (apptRate < 40) issues.push("appt booking " + Math.round(apptRate) + "%");
                    if (warrantyRate < 30) issues.push("warranty mention " + Math.round(warrantyRate) + "%");
                    if (avgScore < 2.0) issues.push("avg score " + avgScore.toFixed(1) + "/4");
                    if (issues.length > 0) flags.push({ name: empName, store: e.store, audits: e.total_audits, issues: issues });
                  });
                  if (flags.length === 0) return <div style={{ color:"#4ADE80",fontSize:12 }}>{"\u2705"} All employees with 5+ audits meeting thresholds</div>;
                  return flags.slice(0, 8).map(function(f, i) {
                    return <div key={i} style={{ padding:"8px 0",borderBottom:i < flags.length - 1 ? "1px solid #1E2028" : "none" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                        <span style={{ color:"#FBBF24",fontSize:12,fontWeight:700 }}>{f.name}</span>
                        <span style={{ color:"#6B6F78",fontSize:10 }}>{STORES[f.store] ? STORES[f.store].name.replace("CPR ","") : f.store} — {f.audits} audits</span>
                      </div>
                      <div style={{ color:"#C8CAD0",fontSize:11,marginTop:2 }}>Needs work on: {f.issues.join(" · ")}</div>
                    </div>;
                  });
                })()}
              </div>
            ) : (
              <div style={{ color:"#6B6F78",fontSize:12 }}>Loading employee data...</div>
            )}
          </div>

          {/* Optimize: Schedule adjustments */}
          <div style={{ background:"#4ADE8008",borderRadius:12,padding:20,marginBottom:16,border:"1px solid #4ADE8022" }}>
            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
              <span style={{ width:12,height:12,borderRadius:"50%",background:"#4ADE80" }} />
              <span style={{ color:"#4ADE80",fontSize:13,fontWeight:700 }}>OPTIMIZE — Schedule Adjustments</span>
            </div>
            {peakMissHours.length > 0 ? (
              peakMissHours.slice(0, 3).map(function(h) {
                var worst = STORE_KEYS.reduce(function(best, sk) { return (h[sk] || 0) > (h[best] || 0) ? sk : best; }, STORE_KEYS[0]);
                return <div key={h.hour} style={{ padding:"6px 0",borderBottom:"1px solid #1E2028",color:"#C8CAD0",fontSize:12 }}>
                  Add coverage at <strong style={{ color:"#4ADE80" }}>{h.hour}</strong> — {h.total} missed, worst at <strong style={{ color:STORES[worst].color }}>{STORES[worst].name.replace("CPR ","")}</strong> ({h[worst]} missed)
                </div>;
              })
            ) : (
              <div style={{ color:"#4ADE80",fontSize:12 }}>{"\u2705"} No significant coverage gaps detected</div>
            )}
          </div>

          {/* Key metric */}
          <div style={{ background:"linear-gradient(135deg,#7B2FFF08,#00D4FF08)",borderRadius:12,padding:24,border:"1px solid #7B2FFF22",textAlign:"center" }}>
            <div style={{ color:"#7B2FFF",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:8 }}>Key Metric</div>
            <div style={{ color:"#F0F1F3",fontSize:16,lineHeight:1.6 }}>
              {"This period we missed "}
              <strong style={{ color:"#F87171",fontSize:20 }}>{totals.missed}</strong>
              {" calls — that's approximately "}
              <strong style={{ color:"#FF2D95",fontSize:20 }}>{"$" + missedRevenue.toLocaleString()}</strong>
              {" in potential revenue."}
            </div>
            {prediction && (
              <div style={{ color:"#8B8F98",fontSize:12,marginTop:8 }}>
                {"Today (" + prediction.day + ") expect ~" + prediction.expectedCalls + " calls with ~" + prediction.expectedMissed + " missed based on historical patterns."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

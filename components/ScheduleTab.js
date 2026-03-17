'use client';

import { useState, useEffect, useMemo } from "react";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);
var DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Map WhenIWork location names to store keys
var WIW_LOCATION_MAP = {
  "cpr fishers": "fishers",
  "cpr bloomington": "bloomington",
  "cpr downtown": "indianapolis",
  "cpr indianapolis": "indianapolis",
  "cpr indy": "indianapolis",
  "cpr zionsville": "zionsville",
};

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background:"#1A1D23",borderRadius:12,padding:"18px 20px",borderLeft:"3px solid "+accent,minWidth:0 }}>
      <div style={{ color:"#8B8F98",fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:"'JetBrains Mono',monospace" }}>{label}</div>
      <div style={{ color:"#F0F1F3",fontSize:28,fontWeight:700,marginTop:4 }}>{value}</div>
      {sub && <div style={{ color:"#6B6F78",fontSize:12,marginTop:2 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, subtitle, icon }) {
  return (
    <div style={{ marginBottom:16,display:"flex",alignItems:"center",gap:10 }}>
      <span style={{ fontSize:20 }}>{icon}</span>
      <div>
        <h2 style={{ color:"#F0F1F3",fontSize:17,fontWeight:700,margin:0 }}>{title}</h2>
        {subtitle && <p style={{ color:"#6B6F78",fontSize:12,margin:"2px 0 0" }}>{subtitle}</p>}
      </div>
    </div>
  );
}

function formatTime(dateStr) {
  if (!dateStr) return "--";
  var d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getWeekDates() {
  var now = new Date();
  var day = now.getDay();
  var monday = new Date(now);
  monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1));
  var dates = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

export default function ScheduleTab({ storeFilter }) {
  var [wiwStatus, setWiwStatus] = useState(null);
  var [todayShifts, setTodayShifts] = useState([]);
  var [weekShifts, setWeekShifts] = useState({ shifts: [], users: {}, locations: {}, positions: {} });
  var [loading, setLoading] = useState(true);
  var [view, setView] = useState("today");
  var [weekOffset, setWeekOffset] = useState(0);
  var [scheduleStoreFilter, setScheduleStoreFilter] = useState("all");
  var [roster, setRoster] = useState([]);

  // Resolve WIW location name to store key
  function locationToStore(locName) {
    if (!locName) return null;
    var lower = locName.toLowerCase().trim();
    // Direct map first
    if (WIW_LOCATION_MAP[lower]) return WIW_LOCATION_MAP[lower];
    // Fuzzy match against store names
    for (var i = 0; i < STORE_KEYS.length; i++) {
      var storeName = STORES[STORE_KEYS[i]].name.replace("CPR ", "").toLowerCase();
      if (lower.includes(storeName) || storeName.includes(lower.replace("cpr ", ""))) return STORE_KEYS[i];
    }
    return null;
  }

  // Resolve WIW employee name against roster
  function resolveEmployee(firstName, lastName) {
    var full = ((firstName || "") + " " + (lastName || "")).trim();
    if (!full || roster.length === 0) return full;
    var lower = full.toLowerCase();
    // Exact match
    var match = roster.find(function(r) { return r.name.toLowerCase() === lower; });
    if (match) return match.name;
    // Last name match
    var last = (lastName || "").toLowerCase();
    if (last.length >= 3) {
      match = roster.find(function(r) { return r.name.toLowerCase().includes(last); });
      if (match) return match.name;
    }
    // First name match
    var first = (firstName || "").toLowerCase();
    if (first.length >= 3) {
      match = roster.find(function(r) { return r.name.toLowerCase().includes(first); });
      if (match) return match.name;
    }
    return full;
  }

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        // Load roster for name matching
        var rosterRes = await fetch("/api/dialpad/roster");
        var rosterJson = await rosterRes.json();
        if (rosterJson.success) setRoster(rosterJson.roster || []);

        // Check WhenIWork status
        var statusRes = await fetch("/api/wheniwork?action=status");
        var statusJson = await statusRes.json();
        setWiwStatus(statusJson);

        if (statusJson.success && statusJson.authenticated) {
          // Load today's shifts — send local date to avoid timezone issues
          var localToday = new Date();
          var todayStr = localToday.getFullYear() + "-" + String(localToday.getMonth()+1).padStart(2,"0") + "-" + String(localToday.getDate()).padStart(2,"0");
          var todayRes = await fetch("/api/wheniwork?action=today&date=" + todayStr);
          var todayJson = await todayRes.json();
          if (todayJson.success) setTodayShifts(todayJson.shifts || []);

          // Load week shifts
          var weekDates = getWeekDates();
          var start = weekDates[0].toISOString().split("T")[0];
          var end = weekDates[6].toISOString().split("T")[0];
          var weekRes = await fetch("/api/wheniwork?action=shifts&start=" + start + "&end=" + end);
          var weekJson = await weekRes.json();
          if (weekJson.success) setWeekShifts(weekJson);
        }
      } catch(e) { console.error("Schedule load error:", e); }
      setLoading(false);
    }
    load();
  }, [weekOffset]);

  // Group today's shifts by store
  var todayByStore = useMemo(function() {
    var groups = {};
    STORE_KEYS.forEach(function(k) { groups[k] = []; });
    todayShifts.forEach(function(s) {
      var storeKey = locationToStore(s.location);
      if (storeKey && groups[storeKey]) {
        var resolved = Object.assign({}, s, { employee: resolveEmployee(null, null) });
        // Parse first/last from the employee field if it's "First Last"
        var parts = (s.employee || "").split(/\s+/);
        resolved.employee = resolveEmployee(parts[0], parts.slice(1).join(" "));
        groups[storeKey].push(resolved);
      }
    });
    return groups;
  }, [todayShifts, roster]);

  // Build weekly grid data
  var weekGrid = useMemo(function() {
    if (!weekShifts.shifts || weekShifts.shifts.length === 0) return [];
    var weekDates = getWeekDates();
    var byUser = {};
    weekShifts.shifts.forEach(function(s) {
      if (s.is_open) return;
      var user = weekShifts.users[s.user_id];
      var firstName = user ? user.first_name : "";
      var lastName = user ? user.last_name : "";
      var name = resolveEmployee(firstName, lastName) || "Unknown";
      var storeKey = locationToStore(s.location) || "";

      // Apply store filter
      if (scheduleStoreFilter !== "all" && storeKey !== scheduleStoreFilter) return;

      var userKey = name + "|" + storeKey;
      if (!byUser[userKey]) byUser[userKey] = { name: name, store: storeKey, days: [null,null,null,null,null,null,null], totalHours: 0 };
      var shiftDate = new Date(s.start_time);
      var dayIdx = weekDates.findIndex(function(d) {
        return d.toDateString() === shiftDate.toDateString();
      });
      if (dayIdx >= 0) {
        var hours = (new Date(s.end_time) - new Date(s.start_time)) / 3600000;
        byUser[userKey].days[dayIdx] = { start: s.start_time, end: s.end_time, hours: hours, store: storeKey };
        byUser[userKey].totalHours += hours;
      }
    });
    return Object.values(byUser).sort(function(a,b){ return b.totalHours - a.totalHours; });
  }, [weekShifts, roster, scheduleStoreFilter]);

  var totalWeekHours = weekGrid.reduce(function(s,e){ return s + e.totalHours; }, 0);

  var SUBTABS = [
    { id: "today", label: "Today", icon: "\u2600\ufe0f" },
    { id: "week", label: "Weekly View", icon: "\ud83d\udcc5" },
    { id: "hours", label: "Hours Tracking", icon: "\u23f0" },
  ];

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading schedule...</div>;

  // Not connected state
  if (!wiwStatus || !wiwStatus.success || !wiwStatus.authenticated) {
    return (
      <div>
        <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",border:"1px solid #FBBF2433" }}>
          <div style={{ fontSize:48,marginBottom:16 }}>{"\ud83d\udcc5"}</div>
          <div style={{ color:"#F0F1F3",fontSize:20,fontWeight:700,marginBottom:8 }}>Connect WhenIWork</div>
          <div style={{ color:"#6B6F78",fontSize:14,marginBottom:24,maxWidth:500,margin:"0 auto 24px" }}>
            The Schedule tab needs WhenIWork API access to display shifts, weekly schedules, and hours tracking across your stores.
          </div>

          <div style={{ background:"#12141A",borderRadius:12,padding:24,maxWidth:480,margin:"0 auto",textAlign:"left" }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:16 }}>Setup Steps:</div>
            {[
              { n: "1", t: "Get WhenIWork API Key", d: "Log in as admin, go to Settings > Integrations or email WhenIWork support requesting a developer key." },
              { n: "2", t: "Add Vercel Environment Variables", d: "WHENIWORK_KEY, WHENIWORK_EMAIL, WHENIWORK_PASSWORD" },
              { n: "3", t: "Deploy & Refresh", d: "After adding env vars, redeploy on Vercel and refresh this page." },
            ].map(function(step) {
              return (
                <div key={step.n} style={{ display:"flex",gap:12,marginBottom:16 }}>
                  <div style={{ width:28,height:28,borderRadius:8,background:"#7C8AFF22",color:"#7C8AFF",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:13,flexShrink:0 }}>{step.n}</div>
                  <div>
                    <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{step.t}</div>
                    <div style={{ color:"#6B6F78",fontSize:12,marginTop:2 }}>{step.d}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {wiwStatus && wiwStatus.error && (
            <div style={{ marginTop:16,padding:"8px 16px",borderRadius:8,background:"#F8717112",border:"1px solid #F8717133",color:"#F87171",fontSize:12,maxWidth:480,margin:"16px auto 0" }}>
              {wiwStatus.error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Connected state
  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
        <div style={{ display:"flex",gap:4 }}>
          {SUBTABS.map(function(v) {
            return <button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7C8AFF22":"#1A1D23",color:view===v.id?"#7C8AFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
          })}
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:6 }}>
          <span style={{ width:8,height:8,borderRadius:"50%",background:"#4ADE80" }}></span>
          <span style={{ color:"#4ADE80",fontSize:11 }}>WhenIWork Connected</span>
        </div>
      </div>

      {/* Store filter for weekly/hours views */}
      {(view === "week" || view === "hours") && (
        <div style={{ display:"flex",gap:4,marginBottom:16 }}>
          <button onClick={function(){setScheduleStoreFilter("all");}}
            style={{ padding:"6px 12px",borderRadius:6,border:"none",cursor:"pointer",background:scheduleStoreFilter==="all"?"#7C8AFF22":"#1A1D23",color:scheduleStoreFilter==="all"?"#7C8AFF":"#8B8F98",fontSize:11,fontWeight:600 }}>
            All Stores
          </button>
          {STORE_KEYS.map(function(key) {
            var store = STORES[key];
            return (
              <button key={key} onClick={function(){setScheduleStoreFilter(key);}}
                style={{ padding:"6px 12px",borderRadius:6,border:"none",cursor:"pointer",background:scheduleStoreFilter===key?store.color+"22":"#1A1D23",color:scheduleStoreFilter===key?store.color:"#8B8F98",fontSize:11,fontWeight:600 }}>
                {store.name.replace("CPR ","")}
              </button>
            );
          })}
        </div>
      )}

      {/* TODAY */}
      {view === "today" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:28 }}>
            {STORE_KEYS.map(function(key) {
              var store = STORES[key];
              var shifts = todayByStore[key] || [];
              return (
                <StatCard key={key} label={store.name.replace("CPR ","")} value={shifts.length} accent={store.color} sub={shifts.length === 1 ? "employee today" : "employees today"} />
              );
            })}
          </div>

          <SectionHeader title={"Today's Schedule"} subtitle={new Date().toLocaleDateString([],{weekday:"long",month:"long",day:"numeric"})} icon={"\u2600\ufe0f"} />

          <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:16 }}>
            {STORE_KEYS.map(function(key) {
              var store = STORES[key];
              var shifts = todayByStore[key] || [];
              return (
                <div key={key} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:16 }}>
                    <div style={{ width:32,height:32,borderRadius:8,background:store.color+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store.color,fontWeight:800 }}>{store.icon}</div>
                    <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{store.name}</div>
                  </div>
                  {shifts.length > 0 ? shifts.map(function(s, i) {
                    return (
                      <div key={i} style={{ padding:"10px 0",borderBottom:i<shifts.length-1?"1px solid #2A2D35":"none" }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                          <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{s.employee}</div>
                          <div style={{ color:"#8B8F98",fontSize:11 }}>{s.position}</div>
                        </div>
                        <div style={{ color:store.color,fontSize:12,marginTop:4 }}>
                          {formatTime(s.start_time) + " - " + formatTime(s.end_time)}
                        </div>
                        {s.notes && <div style={{ color:"#6B6F78",fontSize:10,marginTop:2 }}>{s.notes}</div>}
                      </div>
                    );
                  }) : (
                    <div style={{ color:"#6B6F78",fontSize:12,textAlign:"center",padding:20 }}>No shifts today</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* WEEKLY VIEW */}
      {view === "week" && (
        <div>
          <SectionHeader title="Weekly Schedule" subtitle={"Week of " + getWeekDates()[0].toLocaleDateString([],{month:"short",day:"numeric"}) + " - " + getWeekDates()[6].toLocaleDateString([],{month:"short",day:"numeric"})} icon={"\ud83d\udcc5"} />

          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,overflowX:"auto" }}>
            <table style={{ width:"100%",borderCollapse:"collapse",minWidth:700 }}>
              <thead>
                <tr style={{ borderBottom:"1px solid #2A2D35" }}>
                  <th style={{ textAlign:"left",padding:"10px 12px",color:"#8B8F98",fontSize:10,textTransform:"uppercase",width:120 }}>Employee</th>
                  {getWeekDates().map(function(d, i) {
                    var isToday = d.toDateString() === new Date().toDateString();
                    return <th key={i} style={{ textAlign:"center",padding:"10px 6px",color:isToday?"#7C8AFF":"#6B6F78",fontSize:10,textTransform:"uppercase",background:isToday?"#7C8AFF08":"transparent",borderRadius:isToday?"6px 6px 0 0":"0" }}>
                      {DAYS[d.getDay()]+" "+d.getDate()}
                    </th>;
                  })}
                  <th style={{ textAlign:"right",padding:"10px 12px",color:"#8B8F98",fontSize:10 }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {weekGrid.map(function(emp, i) {
                  var empStore = STORES[emp.store];
                  return (
                    <tr key={i} style={{ borderBottom:"1px solid #1E2028" }}>
                      <td style={{ padding:"10px 12px",fontSize:13,fontWeight:600 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                          {empStore && <span style={{ width:6,height:6,borderRadius:"50%",background:empStore.color,flexShrink:0 }}></span>}
                          <span style={{ color:"#F0F1F3" }}>{emp.name}</span>
                        </div>
                      </td>
                      {emp.days.map(function(shift, j) {
                        var isToday = getWeekDates()[j].toDateString() === new Date().toDateString();
                        if (!shift) return <td key={j} style={{ textAlign:"center",padding:"8px 4px",color:"#2A2D35",fontSize:11,background:isToday?"#7C8AFF04":"transparent" }}>—</td>;
                        return (
                          <td key={j} style={{ textAlign:"center",padding:"8px 4px",background:isToday?"#7C8AFF04":"transparent" }}>
                            <div style={{ padding:"4px 6px",borderRadius:6,background:"#7C8AFF12",border:"1px solid #7C8AFF22" }}>
                              <div style={{ color:"#C8CAD0",fontSize:10 }}>{formatTime(shift.start)}</div>
                              <div style={{ color:"#6B6F78",fontSize:9 }}>{shift.hours.toFixed(1)+"h"}</div>
                            </div>
                          </td>
                        );
                      })}
                      <td style={{ textAlign:"right",padding:"10px 12px",color:"#F0F1F3",fontSize:13,fontWeight:700 }}>{emp.totalHours.toFixed(1)}h</td>
                    </tr>
                  );
                })}
                {weekGrid.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign:"center",padding:30,color:"#6B6F78",fontSize:13 }}>No shifts this week</td></tr>
                )}
              </tbody>
              {weekGrid.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop:"2px solid #2A2D35" }}>
                    <td style={{ padding:"10px 12px",color:"#8B8F98",fontSize:12,fontWeight:700 }}>Total</td>
                    {getWeekDates().map(function(d, j) {
                      var dayTotal = weekGrid.reduce(function(s,e){ return s + (e.days[j] ? e.days[j].hours : 0); }, 0);
                      return <td key={j} style={{ textAlign:"center",padding:"10px 4px",color:dayTotal>0?"#C8CAD0":"#2A2D35",fontSize:12,fontWeight:600 }}>{dayTotal > 0 ? dayTotal.toFixed(1)+"h" : "—"}</td>;
                    })}
                    <td style={{ textAlign:"right",padding:"10px 12px",color:"#7C8AFF",fontSize:14,fontWeight:800 }}>{totalWeekHours.toFixed(1)}h</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* HOURS TRACKING */}
      {view === "hours" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:28 }}>
            <StatCard label="Total Week Hours" value={totalWeekHours.toFixed(1)+"h"} accent="#7C8AFF" sub={weekGrid.length+" employees scheduled"} />
            <StatCard label="Avg Hours/Employee" value={weekGrid.length>0?(totalWeekHours/weekGrid.length).toFixed(1)+"h":"—"} accent="#C084FC" />
            <StatCard label="Positions Covered" value={weekShifts.positions ? Object.keys(weekShifts.positions).length : 0} accent="#4ADE80" />
          </div>

          <SectionHeader title="Hours by Employee" subtitle="This week" icon={"\u23f0"} />
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            {weekGrid.length > 0 ? weekGrid.map(function(emp, i) {
              var pct = totalWeekHours > 0 ? (emp.totalHours / 40 * 100) : 0;
              var barColor = emp.totalHours >= 40 ? "#F87171" : emp.totalHours >= 30 ? "#FBBF24" : "#4ADE80";
              var empStore = STORES[emp.store];
              return (
                <div key={i} style={{ padding:"12px 0",borderBottom:i<weekGrid.length-1?"1px solid #1E2028":"none" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                      {empStore && <span style={{ width:6,height:6,borderRadius:"50%",background:empStore.color,flexShrink:0 }}></span>}
                      <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{emp.name}</span>
                      {empStore && <span style={{ color:empStore.color,fontSize:10,opacity:0.7 }}>{empStore.name.replace("CPR ","")}</span>}
                    </div>
                    <div style={{ color:barColor,fontSize:14,fontWeight:700 }}>{emp.totalHours.toFixed(1)}h</div>
                  </div>
                  <div style={{ background:"#12141A",borderRadius:4,height:8,overflow:"hidden" }}>
                    <div style={{ width:Math.min(pct, 100)+"%",height:"100%",background:barColor,borderRadius:4,transition:"width 0.3s" }}></div>
                  </div>
                  <div style={{ display:"flex",justifyContent:"space-between",marginTop:4 }}>
                    <div style={{ color:"#6B6F78",fontSize:10 }}>
                      {emp.days.filter(function(d){return d!==null;}).length} shifts this week
                    </div>
                    <div style={{ color:"#6B6F78",fontSize:10 }}>of 40h target</div>
                  </div>
                </div>
              );
            }) : (
              <div style={{ color:"#6B6F78",fontSize:13,textAlign:"center",padding:30 }}>No schedule data available</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

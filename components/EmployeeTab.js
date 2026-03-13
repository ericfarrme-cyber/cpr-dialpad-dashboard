'use client';

import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

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

export default function EmployeeTab({ storeFilter }) {
  var [employees, setEmployees] = useState([]);
  var [roster, setRoster] = useState([]);
  var [unmatched, setUnmatched] = useState([]);
  var [loading, setLoading] = useState(true);
  var [expandedEmp, setExpandedEmp] = useState(null);
  var [view, setView] = useState("profiles");
  var [rosterForm, setRosterForm] = useState({ name: "", store: "fishers", aliases: "", role: "Technician" });

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        var sp = storeFilter !== "all" ? "&store=" + storeFilter : "";

        // Load employee profiles from consolidated API
        try {
          var empRes = await fetch("/api/employees?action=profiles" + sp);
          var empJson = await empRes.json();
          if (empJson.success) setEmployees(empJson.employees || []);
        } catch(e) {
          // Fallback: try roster + audit separately
          try {
            var cR = await fetch("/api/dialpad/roster?action=consolidated" + sp).then(function(r){return r.json();});
            if (cR.success && cR.employees) setEmployees(cR.employees.map(function(e) {
              return { name: e.employee, store: e.store, role: e.role || "—", total_audits: e.total_calls || 0, avg_score: e.avg_score || 0,
                opportunity_calls: e.opportunity_calls || 0, current_calls: e.current_calls || 0,
                week_hours_scheduled: null, recent_audits: e.recent_audits || [] };
            }));
          } catch(e2) { /* ok */ }
        }

        // Load roster
        try {
          var rR = await fetch("/api/dialpad/roster?action=list").then(function(r){return r.json();});
          if (rR.success) setRoster(rR.employees || []);
        } catch(e) { /* ok */ }

        // Load unmatched names
        try {
          var uR = await fetch("/api/dialpad/roster?action=unmatched").then(function(r){return r.json();});
          if (uR.success) setUnmatched(uR.unmatched || []);
        } catch(e) { /* ok */ }
      } catch(e) { console.error("Employee load error:", e); }
      setLoading(false);
    }
    load();
  }, [storeFilter]);

  var totalEmployees = employees.length;
  var avgScore = totalEmployees > 0 ? (employees.reduce(function(s,e){ return s + (e.avg_score || 0); }, 0) / totalEmployees).toFixed(2) : "--";
  var totalAudits = employees.reduce(function(s,e){ return s + (e.total_audits || 0); }, 0);
  var scheduleConnected = employees.some(function(e){ return e.week_hours_scheduled !== null; });

  var chartData = useMemo(function() {
    return employees.filter(function(e){ return (e.total_audits || 0) > 0; }).slice(0, 10).map(function(e) {
      return { name: e.name || e.employee, score: e.avg_score || 0, calls: e.total_audits || e.total_calls || 0 };
    });
  }, [employees]);

  var addEmployee = async function() {
    if (!rosterForm.name) return;
    try {
      var res = await fetch("/api/dialpad/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", name: rosterForm.name, store: rosterForm.store, aliases: rosterForm.aliases, role: rosterForm.role })
      });
      var json = await res.json();
      if (json.success && json.employee) {
        setRoster(function(prev) {
          return prev.filter(function(r) { return !(r.name === rosterForm.name && r.store === rosterForm.store); }).concat([json.employee]);
        });
        setRosterForm({ name: "", store: rosterForm.store, aliases: "", role: "Technician" });
      }
    } catch(e) { console.error(e); }
  };

  var deleteEmployee = async function(id) {
    try {
      await fetch("/api/dialpad/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: id })
      });
      setRoster(function(prev) { return prev.filter(function(r) { return r.id !== id; }); });
    } catch(e) { console.error(e); }
  };

  var SUBTABS = [
    { id: "profiles", label: "Team Overview", icon: "\ud83d\udc65" },
    { id: "roster", label: "Manage Roster", icon: "\ud83d\udcdd" },
  ];

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading employee data...</div>;

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display:"flex",gap:4,marginBottom:20 }}>
        {SUBTABS.map(function(v) {
          return <button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7C8AFF22":"#1A1D23",color:view===v.id?"#7C8AFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
        })}
      </div>

      {/* ═══ TEAM OVERVIEW ═══ */}
      {view === "profiles" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28 }}>
            <StatCard label="Team Size" value={totalEmployees} accent="#7C8AFF" sub={roster.length + " on roster"} />
            <StatCard label="Avg Score" value={avgScore + " / 4"} accent={parseFloat(avgScore)>=3?"#4ADE80":parseFloat(avgScore)>=2?"#FBBF24":"#F87171"} />
            <StatCard label="Total Audits" value={totalAudits} accent="#C084FC" sub="last 30 days" />
            <StatCard label="Schedule" value={scheduleConnected ? "Connected" : "Not Connected"} accent={scheduleConnected?"#4ADE80":"#FBBF24"} sub={scheduleConnected?"WhenIWork linked":"Set up in Schedule tab"} />
          </div>

          {chartData.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
              <SectionHeader title="Audit Score Leaderboard" subtitle="Top performers by average score" icon={"\ud83c\udfc6"} />
              <div style={{ height:250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
                    <XAxis type="number" domain={[0, 4]} tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{fill:"#C8CAD0",fontSize:12}} width={100} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8}} labelStyle={{color:"#8B8F98"}} />
                    <Bar dataKey="score" name="Avg Score" fill="#7C8AFF" radius={[0,6,6,0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <SectionHeader title="Employee Profiles" subtitle={totalEmployees + " team members"} icon={"\ud83d\udc64"} />
          <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:16 }}>
            {employees.map(function(emp) {
              var empName = emp.name || emp.employee;
              var store = STORES[emp.store];
              var sc = (emp.avg_score||0)>=3?"#4ADE80":(emp.avg_score||0)>=2?"#FBBF24":"#F87171";
              var isExpanded = expandedEmp === empName;
              var audits = emp.total_audits || emp.total_calls || 0;

              return (
                <div key={empName+"__"+emp.store} onClick={function(){setExpandedEmp(isExpanded?null:empName);}}
                  style={{ background:"#1A1D23",borderRadius:12,padding:20,cursor:"pointer",border:"1px solid "+(isExpanded?"#7C8AFF33":"#1E2028"),transition:"border-color 0.2s" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                      <div style={{ width:40,height:40,borderRadius:10,background:(store?store.color:"#7C8AFF")+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store?store.color:"#7C8AFF",fontWeight:800,fontSize:16 }}>
                        {empName.charAt(0)}
                      </div>
                      <div>
                        <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{empName}</div>
                        <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:2 }}>
                          <span style={{ width:7,height:7,borderRadius:"50%",background:store?store.color:"#8B8F98" }}></span>
                          <span style={{ color:store?store.color:"#8B8F98",fontSize:11 }}>{store?store.name.replace("CPR ",""):emp.store}</span>
                          <span style={{ color:"#6B6F78",fontSize:11 }}>{emp.role || "—"}</span>
                        </div>
                      </div>
                    </div>
                    {audits > 0 && (
                      <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:18,fontWeight:800 }}>
                        {(emp.avg_score||0).toFixed(2)}
                      </div>
                    )}
                  </div>

                  <div style={{ display:"grid",gridTemplateColumns:emp.week_hours_scheduled!==null?"1fr 1fr 1fr 1fr":"1fr 1fr 1fr",gap:8 }}>
                    <div style={{ background:"#12141A",borderRadius:8,padding:"8px 10px",textAlign:"center" }}>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Audits</div>
                      <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{audits}</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:8,padding:"8px 10px",textAlign:"center" }}>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Opp</div>
                      <div style={{ color:"#7C8AFF",fontSize:16,fontWeight:700 }}>{emp.opportunity_calls||0}</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:8,padding:"8px 10px",textAlign:"center" }}>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Current</div>
                      <div style={{ color:"#FBBF24",fontSize:16,fontWeight:700 }}>{emp.current_calls||0}</div>
                    </div>
                    {emp.week_hours_scheduled !== null && (
                      <div style={{ background:"#12141A",borderRadius:8,padding:"8px 10px",textAlign:"center" }}>
                        <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Week Hrs</div>
                        <div style={{ color:"#4ADE80",fontSize:16,fontWeight:700 }}>{emp.week_hours_scheduled}h</div>
                      </div>
                    )}
                  </div>

                  {isExpanded && emp.recent_audits && emp.recent_audits.length > 0 && (
                    <div style={{ marginTop:14,paddingTop:14,borderTop:"1px solid #2A2D35" }}>
                      <div style={{ color:"#8B8F98",fontSize:10,marginBottom:8,textTransform:"uppercase" }}>Recent Audits</div>
                      {emp.recent_audits.slice(0,5).map(function(a, j) {
                        var asc = parseFloat(a.score||0)>=3?"#4ADE80":parseFloat(a.score||0)>=2?"#FBBF24":"#F87171";
                        var d = new Date(a.created_at || a.date || a.date_started);
                        return (
                          <div key={j} style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:j<4?"1px solid #1E2028":"none" }}>
                            <div>
                              <div style={{ color:"#C8CAD0",fontSize:12 }}>{a.inquiry || "—"}</div>
                              <div style={{ color:"#6B6F78",fontSize:10 }}>{d.toLocaleDateString()+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>
                            </div>
                            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                              <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,background:(a.call_type==="opportunity"?"#7C8AFF":"#FBBF24")+"18",color:a.call_type==="opportunity"?"#7C8AFF":"#FBBF24" }}>
                                {a.call_type==="opportunity"?"Opp":"Curr"}
                              </span>
                              <span style={{ color:asc,fontWeight:700,fontSize:13 }}>{parseFloat(a.score||0).toFixed(2)}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {isExpanded && emp.next_shift && (
                    <div style={{ marginTop:10,padding:"8px 12px",borderRadius:8,background:"#4ADE8012",border:"1px solid #4ADE8022" }}>
                      <div style={{ color:"#4ADE80",fontSize:11,fontWeight:600 }}>Next Shift: {new Date(emp.next_shift).toLocaleString([],{weekday:"short",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</div>
                    </div>
                  )}

                  {audits === 0 && !isExpanded && (
                    <div style={{ color:"#6B6F78",fontSize:11,marginTop:8,fontStyle:"italic" }}>No audits yet</div>
                  )}
                </div>
              );
            })}
          </div>

          {employees.length === 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center" }}>
              <div style={{ fontSize:32,marginBottom:12 }}>{"\ud83d\udc65"}</div>
              <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700,marginBottom:8 }}>No employees found</div>
              <div style={{ color:"#6B6F78",fontSize:13 }}>Switch to the Manage Roster tab to add your team, then run audits to see scores here.</div>
            </div>
          )}
        </div>
      )}

      {/* ═══ MANAGE ROSTER ═══ */}
      {view === "roster" && (
        <div>
          <SectionHeader title="Employee Roster" subtitle="Add your real employee names so transcript aliases get consolidated" icon={"\ud83d\udcdd"} />

          {/* Add employee form */}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Add Employee</div>
            <div style={{ display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end" }}>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Full Name</div>
                <input value={rosterForm.name} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{name:e.target.value});});}}
                  placeholder="e.g. Mahmoud" style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,width:160,outline:"none" }} />
              </div>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Store</div>
                <select value={rosterForm.store} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{store:e.target.value});});}}
                  style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none" }}>
                  {STORE_KEYS.map(function(k){return <option key={k} value={k}>{STORES[k].name}</option>;})}
                </select>
              </div>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Aliases (comma-separated)</div>
                <input value={rosterForm.aliases} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{aliases:e.target.value});});}}
                  placeholder="e.g. Mau, Ma, Mah" style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,width:220,outline:"none" }} />
              </div>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Role</div>
                <select value={rosterForm.role} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{role:e.target.value});});}}
                  style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none" }}>
                  {["Manager","Lead Tech","Technician","Front Desk"].map(function(r){return <option key={r} value={r}>{r}</option>;})}
                </select>
              </div>
              <button onClick={addEmployee} style={{ padding:"8px 18px",borderRadius:6,border:"none",cursor:"pointer",background:"#7C8AFF",color:"#FFF",fontSize:12,fontWeight:700,height:36 }}>Add</button>
            </div>
          </div>

          {/* Unmatched names */}
          {unmatched.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #FBBF2433" }}>
              <div style={{ color:"#FBBF24",fontSize:14,fontWeight:700,marginBottom:8 }}>Unmatched Names ({unmatched.length})</div>
              <div style={{ color:"#6B6F78",fontSize:12,marginBottom:12 }}>These transcript names have no roster match. Click to add as alias.</div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {unmatched.map(function(u, i) {
                  return <button key={i} onClick={function(){setRosterForm(function(p){return Object.assign({},p,{aliases:p.aliases?p.aliases+", "+u.name:u.name,store:u.store});});}}
                    style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#C8CAD0",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ width:7,height:7,borderRadius:"50%",background:STORES[u.store]?STORES[u.store].color:"#8B8F98" }}></span>
                    {'"'+u.name+'" ('+u.count+'x, '+(STORES[u.store]?STORES[u.store].name.replace("CPR ",""):u.store)+')'}
                  </button>;
                })}
              </div>
            </div>
          )}

          {/* Current roster table */}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Current Roster ({roster.length} employees)</div>
            {roster.length > 0 ? (
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid #2A2D35" }}>
                    {["Name","Store","Role","Aliases",""].map(function(h,i){
                      return <th key={i} style={{ textAlign:"left",padding:"8px 12px",color:"#6B6F78",fontSize:10,textTransform:"uppercase" }}>{h}</th>;
                    })}
                  </tr>
                </thead>
                <tbody>
                  {roster.map(function(emp) {
                    var store = STORES[emp.store];
                    return (
                      <tr key={emp.id} style={{ borderBottom:"1px solid #1E2028" }}>
                        <td style={{ padding:"12px",color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.name}</td>
                        <td style={{ padding:"12px" }}>
                          <span style={{ display:"inline-flex",alignItems:"center",gap:6,color:store?store.color:"#8B8F98",fontSize:12 }}>
                            <span style={{ width:7,height:7,borderRadius:"50%",background:store?store.color:"#8B8F98" }}></span>
                            {store?store.name.replace("CPR ",""):emp.store}
                          </span>
                        </td>
                        <td style={{ padding:"12px",color:"#C8CAD0",fontSize:12 }}>{emp.role}</td>
                        <td style={{ padding:"12px" }}>
                          <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
                            {(emp.aliases||[]).map(function(a,j){
                              return <span key={j} style={{ padding:"2px 8px",borderRadius:4,background:"#2A2D35",color:"#8B8F98",fontSize:11 }}>{a}</span>;
                            })}
                          </div>
                        </td>
                        <td style={{ padding:"12px" }}>
                          <button onClick={function(e){e.stopPropagation();deleteEmployee(emp.id);}}
                            style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>Remove</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>
                No employees added yet. Add your team above — the system will automatically match transcript names to real names.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

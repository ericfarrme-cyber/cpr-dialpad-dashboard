'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis
} from "recharts";
import { STORES, TABS } from "@/lib/constants";
import {
  fetchLiveStats,
  transformToDailyCalls, transformToHourlyMissed,
  transformToDOWMissed, transformToCallbackData, transformToProblemCalls,
  SAMPLE_KEYWORDS, SAMPLE_HOURLY_MISSED, SAMPLE_DAILY_CALLS,
  SAMPLE_CALLBACK_DATA, SAMPLE_PROBLEM_CALLS, SAMPLE_DOW_DATA
} from "@/lib/data";

const STORE_KEYS = Object.keys(STORES);

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

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8,padding:"10px 14px" }}>
      <div style={{ color:"#8B8F98",fontSize:11,marginBottom:6 }}>{label}</div>
      {payload.map(function(p, i) {
        return (
          <div key={i} style={{ display:"flex",alignItems:"center",gap:8,marginTop:3 }}>
            <span style={{ width:8,height:8,borderRadius:"50%",background:p.color }} />
            <span style={{ color:"#C8CAD0",fontSize:12 }}>{p.name}: <strong style={{ color:"#F0F1F3" }}>{p.value}</strong></span>
          </div>
        );
      })}
    </div>
  );
}

function StoreToggle({ selected, onChange }) {
  return (
    <div style={{ display:"flex",gap:6,background:"#12141A",borderRadius:10,padding:4,flexWrap:"wrap" }}>
      <button onClick={function(){onChange("all");}} style={{ padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",background:selected==="all"?"#2A2D35":"transparent",color:selected==="all"?"#F0F1F3":"#6B6F78",fontSize:13,fontWeight:600,fontFamily:"'Space Grotesk',sans-serif" }}>All Stores</button>
      {Object.entries(STORES).map(function([key,s]) {
        return (
          <button key={key} onClick={function(){onChange(key);}} style={{ padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",background:selected===key?s.color+"22":"transparent",color:selected===key?s.color:"#6B6F78",fontSize:13,fontWeight:600,fontFamily:"'Space Grotesk',sans-serif",display:"flex",alignItems:"center",gap:6 }}>
            <span style={{ width:8,height:8,borderRadius:"50%",background:s.color,display:"inline-block" }} />
            {s.name.replace("CPR ","")}
          </button>
        );
      })}
    </div>
  );
}

function DataBanner({ isLive, isLoading, isStored, lastSync, onRefresh, onLiveRefresh }) {
  var bgColor = isStored ? "#7C8AFF12" : isLive ? "#4ADE8012" : "#FBBF2412";
  var borderColor = isStored ? "#7C8AFF33" : isLive ? "#4ADE8033" : "#FBBF2433";
  var dotColor = isStored ? "#7C8AFF" : isLive ? "#4ADE80" : "#FBBF24";
  var statusText = isLoading ? "Fetching live data..." : isStored ? ("Stored data - Synced " + (lastSync ? new Date(lastSync).toLocaleString() : "unknown")) : isLive ? "Live data from Dialpad API" : "Sample data";
  return (
    <div style={{ margin:"0 0 20px",padding:"10px 16px",borderRadius:8,background:bgColor,border:"1px solid "+borderColor,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8 }}>
      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
        <span style={{ width:8,height:8,borderRadius:"50%",background:dotColor,animation:isLoading?"pulse 1.5s infinite":"none" }} />
        <span style={{ color:"#C8CAD0",fontSize:12 }}>{statusText}</span>
      </div>
      <div style={{ display:"flex",gap:6 }}>
        {!isLoading && (
          <>
            <button onClick={onRefresh} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:11,cursor:"pointer" }}>Reload</button>
            <button onClick={onLiveRefresh} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #7C8AFF44",background:"#7C8AFF18",color:"#7C8AFF",fontSize:11,cursor:"pointer" }}>Live Refresh</button>
          </>
        )}
      </div>
    </div>
  );
}

function AISummary({ type, dashboardData }) {
  var [summary, setSummary] = useState(null);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState(null);
  var generate = async function() {
    setLoading(true); setError(null);
    try {
      var res = await fetch("/api/dialpad/summary", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ type:type, dashboardData:dashboardData }) });
      var json = await res.json();
      if (json.success) setSummary(json.summary); else setError(json.error);
    } catch(e) { setError(e.message); }
    setLoading(false);
  };
  return (
    <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #C084FC33" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:summary?16:0 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:20 }}>{"🤖"}</span>
          <div>
            <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{"AI " + (type === "audit" ? "Coaching Report" : "Executive Summary")}</div>
            <div style={{ color:"#6B6F78",fontSize:11 }}>Powered by Claude</div>
          </div>
        </div>
        <button onClick={generate} disabled={loading} style={{ padding:"8px 18px",borderRadius:8,border:"none",cursor:loading?"default":"pointer",background:loading?"#C084FC22":"linear-gradient(135deg,#7C8AFF,#C084FC)",color:loading?"#C084FC":"#FFF",fontSize:12,fontWeight:700,animation:loading?"pulse 1.5s infinite":"none" }}>{loading?"Generating...":summary?"Refresh":"Generate Insights"}</button>
      </div>
      {error && <div style={{ padding:"8px 12px",borderRadius:6,background:"#F8717122",color:"#F87171",fontSize:12,marginTop:12 }}>{error}</div>}
      {summary && <div style={{ color:"#C8CAD0",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap",marginTop:8 }}>{summary}</div>}
    </div>
  );
}

function OverviewTab({ storeFilter, overviewStats, dailyCalls }) {
  return (
    <div>
      <AISummary type="overview" dashboardData={{ overviewStats:overviewStats }} />
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28 }}>
        <StatCard label="Total Calls (30d)" value={overviewStats.totals.total.toLocaleString()} accent="#7C8AFF" />
        <StatCard label="Answer Rate" value={((overviewStats.totals.answered/overviewStats.totals.total)*100||0).toFixed(1)+"%"} accent="#4ADE80" sub={overviewStats.totals.answered.toLocaleString()+" answered"} />
        <StatCard label="Missed Calls" value={overviewStats.totals.missed.toLocaleString()} accent="#F87171" />
        <StatCard label="Avg Calls / Day" value={Math.round(overviewStats.totals.total/30)} accent="#C084FC" sub="across all stores" />
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:28 }}>
        {Object.entries(STORES).map(function([key,store]) {
          var s = overviewStats.storeStats[key];
          var rate = ((s.answered/s.total)*100||0).toFixed(1);
          return (
            <div key={key} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
                <div style={{ width:36,height:36,borderRadius:10,background:store.color+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store.color,fontWeight:800,fontSize:16 }}>{store.icon}</div>
                <div>
                  <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{store.name}</div>
                  <div style={{ color:"#6B6F78",fontSize:11 }}>{s.total} total calls</div>
                </div>
              </div>
              <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10 }}>
                <div><div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Answered</div><div style={{ color:"#4ADE80",fontSize:20,fontWeight:700 }}>{s.answered}</div></div>
                <div><div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Missed</div><div style={{ color:"#F87171",fontSize:20,fontWeight:700 }}>{s.missed}</div></div>
                <div><div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Rate</div><div style={{ color:store.color,fontSize:20,fontWeight:700 }}>{rate}%</div></div>
              </div>
              <div style={{ marginTop:12,background:"#12141A",borderRadius:6,height:8,overflow:"hidden" }}><div style={{ width:rate+"%",height:"100%",background:store.color,borderRadius:6 }} /></div>
            </div>
          );
        })}
      </div>
      <SectionHeader title="Daily Call Volume" subtitle="Last 30 days" icon="📊" />
      <div style={{ background:"#1A1D23",borderRadius:12,padding:20,height:300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dailyCalls}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
            <XAxis dataKey="date" tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} interval={4} />
            <YAxis tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            {STORE_KEYS.map(function(key) { return (storeFilter==="all"||storeFilter===key) ? <Area key={key} type="monotone" dataKey={key+"_total"} name={STORES[key].name+" Total"} stroke={STORES[key].color} fill={STORES[key].color+"18"} strokeWidth={2} dot={false} /> : null; })}
            {STORE_KEYS.map(function(key) { return (storeFilter==="all"||storeFilter===key) ? <Area key={key+"_a"} type="monotone" dataKey={key+"_answered"} name={STORES[key].name+" Answered"} stroke={STORES[key].color} fill={STORES[key].color+"08"} strokeWidth={1} strokeDasharray="4 4" dot={false} /> : null; })}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KeywordsTab({ keywords }) {
  var [cat, setCat] = useState("All");
  var categories = ["All"].concat([...new Set(keywords.map(function(k){return k.category;}))]);
  var filtered = useMemo(function() { var kw = keywords; if(cat!=="All") kw=kw.filter(function(k){return k.category===cat;}); return [...kw].sort(function(a,b){return STORE_KEYS.reduce(function(s,k){return s+(b[k]||0);},0)-STORE_KEYS.reduce(function(s,k){return s+(a[k]||0);},0);}); }, [cat, keywords]);
  var catColors = { Service:"#7C8AFF",Sales:"#4ADE80",Support:"#FBBF24",Operations:"#C084FC",Problem:"#F87171" };
  return (
    <div>
      <div style={{ display:"flex",gap:6,marginBottom:20,flexWrap:"wrap" }}>
        {categories.map(function(c){ return <button key={c} onClick={function(){setCat(c);}} style={{ padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",background:cat===c?"#7C8AFF22":"#1A1D23",color:cat===c?"#7C8AFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{c}</button>; })}
      </div>
      <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
        <SectionHeader title="Keyword Frequency" icon="🏷️" />
        <table style={{ width:"100%",borderCollapse:"collapse" }}>
          <thead><tr style={{ borderBottom:"1px solid #2A2D35" }}><th style={{ textAlign:"left",padding:"8px 10px",color:"#6B6F78",fontSize:10 }}>Keyword</th>{STORE_KEYS.map(function(k){return <th key={k} style={{ textAlign:"right",padding:"8px 6px",color:STORES[k].color,fontSize:10 }}>{STORES[k].icon}</th>;})}<th style={{ textAlign:"right",padding:"8px 10px",color:"#8B8F98",fontSize:10 }}>Total</th></tr></thead>
          <tbody>{filtered.map(function(k,i){ var total=STORE_KEYS.reduce(function(s,sk){return s+(k[sk]||0);},0); return <tr key={i} style={{ borderBottom:"1px solid #1E2028" }}><td style={{ padding:"10px",color:"#E8E9EC",fontSize:13,fontWeight:600 }}>{k.keyword}</td>{STORE_KEYS.map(function(sk){return <td key={sk} style={{ textAlign:"right",padding:"10px 6px",color:"#C8CAD0",fontSize:13 }}>{k[sk]||0}</td>;})}<td style={{ textAlign:"right",padding:"10px",color:"#F0F1F3",fontSize:13,fontWeight:700 }}>{total}</td></tr>; })}</tbody>
        </table>
      </div>
    </div>
  );
}

function MissedTab({ storeFilter, overviewStats, hourlyMissed, dowData }) {
  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:28 }}>
        {Object.entries(STORES).map(function([key,store]){ var s=overviewStats.storeStats[key]; return <StatCard key={key} label={store.name+" Missed"} value={s.missed} accent={store.color} sub={s.total?((s.missed/s.total)*100).toFixed(1)+"% miss rate":""} />; })}
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:20 }}>
        <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
          <SectionHeader title="Missed by Hour" icon="🕐" />
          <div style={{ height:280 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={hourlyMissed}><CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" /><XAxis dataKey="hour" tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} /><YAxis tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false} /><Tooltip content={<CustomTooltip />} />{STORE_KEYS.map(function(k){return(storeFilter==="all"||storeFilter===k)?<Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[4,4,0,0]} barSize={14} />:null;})}</BarChart></ResponsiveContainer></div>
        </div>
        <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
          <SectionHeader title="Missed by Day" icon="📅" />
          <div style={{ height:280 }}><ResponsiveContainer width="100%" height="100%"><RadarChart data={dowData} cx="50%" cy="50%" outerRadius={100}><PolarGrid stroke="#2A2D35" /><PolarAngleAxis dataKey="day" tick={{fill:"#8B8F98",fontSize:11}} /><PolarRadiusAxis tick={{fill:"#6B6F78",fontSize:9}} axisLine={false} />{STORE_KEYS.map(function(k){return(storeFilter==="all"||storeFilter===k)?<Radar key={k} name={STORES[k].name.replace("CPR ","")} dataKey={k} stroke={STORES[k].color} fill={STORES[k].color} fillOpacity={0.15} strokeWidth={2} />:null;})}<Legend iconType="circle" iconSize={8} /><Tooltip content={<CustomTooltip />} /></RadarChart></ResponsiveContainer></div>
        </div>
      </div>
    </div>
  );
}

function CallbacksTab({ callbackData }) {
  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:28 }}>
        {callbackData.map(function(cb){ var store=STORES[cb.store]; if(!store) return null; var rate=cb.missed>0?((cb.calledBack/cb.missed)*100).toFixed(1):"0.0"; return (
          <div key={cb.store} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}><div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{store.name}</div><div style={{ padding:"4px 10px",borderRadius:6,background:parseFloat(rate)>=80?"#4ADE8022":"#F8717122",color:parseFloat(rate)>=80?"#4ADE80":"#F87171",fontSize:14,fontWeight:700 }}>{rate}%</div></div>
            {[{l:"Within 30 min",v:cb.within30,c:"#4ADE80"},{l:"30-60 min",v:cb.within60,c:"#FBBF24"},{l:"60+ min",v:cb.later,c:"#FB923C"},{l:"Never",v:cb.never,c:"#F87171"}].map(function(item,i){ return (
              <div key={i} style={{ marginTop:10 }}><div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}><span style={{ color:"#8B8F98",fontSize:11 }}>{item.l}</span><span style={{ color:item.c,fontSize:12,fontWeight:700 }}>{item.v}</span></div><div style={{ background:"#12141A",borderRadius:4,height:6,overflow:"hidden" }}><div style={{ width:cb.missed>0?(item.v/cb.missed*100)+"%":"0%",height:"100%",background:item.c,borderRadius:4 }} /></div></div>
            ); })}
          </div>
        ); })}
      </div>
    </div>
  );
}

function ProblemsTab({ overviewStats, problemCalls }) {
  var tp = problemCalls.reduce(function(s,p){return s+STORE_KEYS.reduce(function(ss,k){return ss+(p[k]||0);},0);},0);
  return (
    <div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:28 }}>
        <StatCard label="Problem Calls" value={tp} accent="#F87171" />
        <StatCard label="% of All Calls" value={overviewStats.totals.total>0?((tp/overviewStats.totals.total)*100).toFixed(1)+"%":"0%"} accent="#FB923C" />
        <StatCard label="Top Issue" value={problemCalls[0]?problemCalls[0].type:"N/A"} accent="#C084FC" />
      </div>
      <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
        <SectionHeader title="Problem Call Types" icon="🔥" />
        <div style={{ height:300 }}><ResponsiveContainer width="100%" height="100%"><BarChart data={problemCalls} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} /><XAxis type="number" tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="type" tick={{fill:"#8B8F98",fontSize:10}} width={140} tickLine={false} axisLine={false} /><Tooltip content={<CustomTooltip />} />{STORE_KEYS.map(function(k){return <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[0,4,4,0]} barSize={10} />;})}</BarChart></ResponsiveContainer></div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// AUDIT TAB
// ═══════════════════════════════════════════
function AuditTab({ rawCallData, storeFilter }) {
  var [audits, setAudits] = useState([]);
  var [employees, setEmployees] = useState([]);
  var [storePerf, setStorePerf] = useState([]);
  var [auditingId, setAuditingId] = useState(null);
  var [batchRunning, setBatchRunning] = useState(false);
  var [batchProgress, setBatchProgress] = useState({ done:0, total:0 });
  var batchAbort = useRef(false);
  var [error, setError] = useState(null);
  var [loading, setLoading] = useState(true);
  var [auditView, setAuditView] = useState("overview");
  var [callTypeFilter, setCallTypeFilter] = useState("all");
  var [expandedEmp, setExpandedEmp] = useState(null);
  var [repeatCallers, setRepeatCallers] = useState(null);
  var [repeatLoading, setRepeatLoading] = useState(false);
  var [roster, setRoster] = useState([]);
  var [unmatched, setUnmatched] = useState([]);
  var [rosterForm, setRosterForm] = useState({ name:"", store:"fishers", aliases:"", role:"Technician" });

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        var sp = storeFilter !== "all" ? "&store="+storeFilter : "";
        var aR = await fetch("/api/dialpad/audit?limit=200&days=30"+sp).then(function(r){return r.json();});
        var sR = await fetch("/api/dialpad/audit?action=stores").then(function(r){return r.json();});
        if (aR.success) setAudits(aR.audits || []);
        if (sR.success) setStorePerf(sR.stores || []);
        
        try {
          var rR = await fetch("/api/dialpad/roster?action=list").then(function(r){return r.json();});
          if (rR.success) setRoster(rR.employees || []);
        } catch(e) { /* roster API may not exist yet */ }

        try {
          var cR = await fetch("/api/dialpad/roster?action=consolidated"+sp).then(function(r){return r.json();});
          if (cR.success && cR.employees && cR.employees.length > 0) { setEmployees(cR.employees); }
          else {
            var eR = await fetch("/api/dialpad/audit?action=employees"+sp).then(function(r){return r.json();});
            if (eR.success) setEmployees(eR.employees || []);
          }
        } catch(e) {
          var eR2 = await fetch("/api/dialpad/audit?action=employees"+sp).then(function(r){return r.json();});
          if (eR2.success) setEmployees(eR2.employees || []);
        }

        try {
          var uR = await fetch("/api/dialpad/roster?action=unmatched").then(function(r){return r.json();});
          if (uR.success) setUnmatched(uR.unmatched || []);
        } catch(e) { /* ok */ }
      } catch(e) { console.error("Load error:", e); }
      setLoading(false);
    }
    load();
  }, [storeFilter]);

  var filteredAudits = useMemo(function(){ return callTypeFilter==="all" ? audits : audits.filter(function(a){return a.call_type===callTypeFilter;}); }, [audits, callTypeFilter]);

  var recordedCalls = useMemo(function() {
    var ids = new Set(audits.map(function(a){return a.call_id;}));
    return rawCallData.filter(function(r){return r.target_type==="department"&&r.was_recorded==="true"&&r.direction==="inbound";})
      .filter(function(r){return storeFilter==="all"||r._storeKey===storeFilter;})
      .filter(function(r){return !ids.has(r.call_id);})
      .sort(function(a,b){return new Date(b.date_started)-new Date(a.date_started);}).slice(0,50);
  }, [rawCallData, storeFilter, audits]);

  // Consolidate store perf - merge duplicates
  var consolidatedStores = useMemo(function() {
    var map = {};
    storePerf.forEach(function(sp) {
      if (!STORES[sp.store]) return;
      if (!map[sp.store]) { map[sp.store] = Object.assign({}, sp); }
      else {
        var c = map[sp.store];
        var tw = (c.total_audits||0) + (sp.total_audits||0);
        if (tw > 0) c.avg_score = ((c.avg_score||0)*(c.total_audits||0) + (sp.avg_score||0)*(sp.total_audits||0)) / tw;
        c.total_audits = tw;
        c.opportunity_calls = (c.opportunity_calls||0) + (sp.opportunity_calls||0);
        c.current_calls = (c.current_calls||0) + (sp.current_calls||0);
      }
    });
    return Object.values(map);
  }, [storePerf]);

  var runAudit = async function(call) {
    setAuditingId(call.call_id); setError(null);
    try {
      var res = await fetch("/api/dialpad/audit", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ callId:call.call_id, callInfo:{direction:call.direction,external_number:call.external_number,date_started:call.date_started,name:call.name,_storeKey:call._storeKey,talk_duration:call.talk_duration} }) });
      var json = await res.json();
      if (json.success && json.audit) {
        var a = json.audit;
        var cr = a.criteria || {};
        var flat = Object.assign({}, a, {
          call_id: call.call_id, date_started: call.date_started, store: a.store, phone: call.external_number,
          appt_offered: (cr.appointment_offered && cr.appointment_offered.pass) || false,
          appt_notes: (cr.appointment_offered && cr.appointment_offered.notes) || "",
          discount_mentioned: (cr.discount_mentioned && cr.discount_mentioned.pass) || false,
          discount_notes: (cr.discount_mentioned && cr.discount_mentioned.notes) || "",
          warranty_mentioned: (cr.warranty_mentioned && cr.warranty_mentioned.pass) || false,
          warranty_notes: (cr.warranty_mentioned && cr.warranty_mentioned.notes) || "",
          faster_turnaround: (cr.faster_turnaround && cr.faster_turnaround.pass) || false,
          turnaround_notes: (cr.faster_turnaround && cr.faster_turnaround.notes) || "",
          status_update_given: (cr.status_update_given && cr.status_update_given.pass) || false,
          status_notes: (cr.status_update_given && cr.status_update_given.notes) || "",
          eta_communicated: (cr.eta_communicated && cr.eta_communicated.pass) || false,
          eta_notes: (cr.eta_communicated && cr.eta_communicated.notes) || "",
          professional_tone: (cr.professional_tone && cr.professional_tone.pass) || false,
          tone_notes: (cr.professional_tone && cr.professional_tone.notes) || "",
          next_steps_explained: (cr.next_steps_explained && cr.next_steps_explained.pass) || false,
          next_steps_notes: (cr.next_steps_explained && cr.next_steps_explained.notes) || "",
        });
        setAudits(function(prev){return [flat].concat(prev);});
        return true;
      } else { if(!json.alreadyAudited) setError(json.error||"Audit failed"); return false; }
    } catch(e) { setError(e.message); return false; }
    finally { setAuditingId(null); }
  };

  var runBatch = async function() {
    setBatchRunning(true); batchAbort.current=false; var list=recordedCalls.slice(); setBatchProgress({done:0,total:list.length});
    for(var i=0;i<list.length;i++) { if(batchAbort.current)break; setAuditingId(list[i].call_id); await runAudit(list[i]); setBatchProgress({done:i+1,total:list.length}); if(i<list.length-1) await new Promise(function(r){setTimeout(r,1500);}); }
    setAuditingId(null); setBatchRunning(false);
  };

  var loadRepeatCallers = async function() {
    setRepeatLoading(true);
    try {
      var sp = storeFilter !== "all" ? "&store="+storeFilter : "";
      var res = await fetch("/api/dialpad/repeat-callers?days=7"+sp);
      var json = await res.json();
      if (json.success) setRepeatCallers(json);
    } catch(e) { console.error(e); }
    setRepeatLoading(false);
  };

  var getEmpAudits = function(name) {
    // Find all aliases for this employee from the roster
    var aliases = [name.toLowerCase()];
    roster.forEach(function(r) {
      if (r.name.toLowerCase() === name.toLowerCase()) {
        (r.aliases || []).forEach(function(a) { aliases.push(a.toLowerCase()); });
      }
    });
    return audits.filter(function(a) {
      if (!a.employee) return false;
      var empLower = a.employee.toLowerCase();
      // Direct match on name or any alias
      if (aliases.indexOf(empLower) >= 0) return true;
      // Prefix match: transcript "Ma" matches roster "Mahmoud"
      for (var i = 0; i < aliases.length; i++) {
        if (aliases[i].startsWith(empLower) && empLower.length >= 2) return true;
        if (empLower.startsWith(aliases[i]) && aliases[i].length >= 2) return true;
      }
      return false;
    });
  };

  var total = filteredAudits.length;
  var avgScore = total>0?(filteredAudits.reduce(function(s,a){return s+parseFloat(a.score||0);},0)/total).toFixed(2):"--";
  var oppCount = audits.filter(function(a){return a.call_type==="opportunity";}).length;
  var currCount = audits.filter(function(a){return a.call_type==="current_customer";}).length;
  var nsCount = audits.filter(function(a){return a.call_type==="non_scorable";}).length;

  function CriteriaGrid({ audit }) {
    if (audit.call_type === "non_scorable") {
      return <div style={{ padding:"8px 12px",borderRadius:6,background:"#6B6F7812",color:"#6B6F78",fontSize:12 }}>Non-scorable call (wrong number, disconnected, or insufficient transcript)</div>;
    }
    var isOpp = audit.call_type !== "current_customer";
    var items = isOpp
      ? [{k:"appt_offered",l:"Appt",n:"appt_notes"},{k:"discount_mentioned",l:"Discount",n:"discount_notes"},{k:"warranty_mentioned",l:"Warranty",n:"warranty_notes"},{k:"faster_turnaround",l:"Fast Turn.",n:"turnaround_notes"}]
      : [{k:"status_update_given",l:"Status",n:"status_notes"},{k:"eta_communicated",l:"ETA",n:"eta_notes"},{k:"professional_tone",l:"Tone",n:"tone_notes"},{k:"next_steps_explained",l:"Next Steps",n:"next_steps_notes"}];
    return (
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6 }}>
        {items.map(function(item) {
          var pass = audit[item.k];
          return (
            <div key={item.k} style={{ padding:"6px 8px",borderRadius:6,background:pass?"#4ADE8012":"#F8717112",border:"1px solid "+(pass?"#4ADE8033":"#F8717133") }}>
              <div style={{ display:"flex",justifyContent:"space-between" }}><span style={{ color:"#8B8F98",fontSize:10 }}>{item.l}</span><span style={{ color:pass?"#4ADE80":"#F87171",fontSize:10,fontWeight:700 }}>{pass?"PASS":"FAIL"}</span></div>
              <div style={{ color:"#6B6F78",fontSize:9,marginTop:2 }}>{audit[item.n]||""}</div>
            </div>
          );
        })}
      </div>
    );
  }

  var SUBTABS = [
    {id:"overview",label:"Overview",icon:"📊"},
    {id:"employees",label:"Employee Scores",icon:"👤"},
    {id:"roster",label:"Roster",icon:"📝"},
    {id:"dropped",label:"Dropped Balls",icon:"🚨"},
    {id:"calls",label:"Audit Calls",icon:"🎙️"},
    {id:"history",label:"Audit History",icon:"📋"},
  ];

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading audit data...</div>;

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8 }}>
        <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>
          {SUBTABS.map(function(v) {
            return <button key={v.id} onClick={function(){setAuditView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:auditView===v.id?"#7C8AFF22":"#1A1D23",color:auditView===v.id?"#7C8AFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
          })}
        </div>
        {(auditView==="overview"||auditView==="history") && (
          <div style={{ display:"flex",gap:4 }}>
            {["all","opportunity","current_customer"].map(function(f){ var label=f==="all"?"All":f==="opportunity"?"Opportunity":"Current"; return <button key={f} onClick={function(){setCallTypeFilter(f);}} style={{ padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",background:callTypeFilter===f?"#2A2D35":"transparent",color:callTypeFilter===f?"#F0F1F3":"#6B6F78",fontSize:11,fontWeight:600 }}>{label}</button>; })}
          </div>
        )}
      </div>

      {/* OVERVIEW */}
      {auditView==="overview" && (
        <div>
          <AISummary type="audit" />
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28 }}>
            <StatCard label="Calls Audited" value={total} accent="#7C8AFF" sub={oppCount+" opportunity, "+currCount+" current"} />
            <StatCard label="Avg Score" value={avgScore+" / 4"} accent={parseFloat(avgScore)>=3?"#4ADE80":parseFloat(avgScore)>=2?"#FBBF24":"#F87171"} />
            <StatCard label="Unaudited" value={recordedCalls.length} accent="#C084FC" sub="recorded calls available" />
            <StatCard label="Employees" value={employees.length} accent="#FB923C" />
          </div>
          {consolidatedStores.length > 0 && (
            <div style={{ display:"grid",gridTemplateColumns:"repeat("+Math.min(consolidatedStores.length,3)+",1fr)",gap:14,marginBottom:20 }}>
              {consolidatedStores.map(function(sp) {
                var store = STORES[sp.store]; if(!store) return null;
                var sc = (sp.avg_score||0)>=3?"#4ADE80":(sp.avg_score||0)>=2?"#FBBF24":"#F87171";
                return (
                  <div key={sp.store} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                        <div style={{ width:32,height:32,borderRadius:8,background:store.color+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store.color,fontWeight:800 }}>{store.icon}</div>
                        <div>
                          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{store.name}</div>
                          <div style={{ color:"#6B6F78",fontSize:11 }}>{sp.total_audits||0} audited, {sp.opportunity_calls||0} opp, {sp.current_calls||0} curr</div>
                        </div>
                      </div>
                      <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:18,fontWeight:800 }}>{parseFloat(sp.avg_score||0).toFixed(2)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* EMPLOYEES */}
      {auditView==="employees" && (
        <div>
          <SectionHeader title="Employee Leaderboard" subtitle="Click to expand" icon="🏆" />
          {employees.length > 0 ? (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              {employees.map(function(emp, i) {
                var store = STORES[emp.store];
                var sc = (emp.avg_score||0)>=3?"#4ADE80":(emp.avg_score||0)>=2?"#FBBF24":"#F87171";
                var medal = i===0?"\uD83E\uDD47":i===1?"\uD83E\uDD48":i===2?"\uD83E\uDD49":"#"+(i+1);
                var empKey = emp.employee+"__"+emp.store;
                var isExpanded = expandedEmp === empKey;
                var empAudits = isExpanded ? getEmpAudits(emp.employee) : [];
                var empOpp = empAudits.filter(function(a){return a.call_type==="opportunity";});
                var empCurr = empAudits.filter(function(a){return a.call_type==="current_customer";});
                return (
                  <div key={empKey} style={{ borderBottom:"1px solid #1E2028" }}>
                    <div onClick={function(){setExpandedEmp(isExpanded?null:empKey);}} style={{ padding:"14px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",background:isExpanded?"#12141A":"transparent" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:16 }}>
                        <span style={{ fontSize:18,width:28,textAlign:"center" }}>{medal}</span>
                        <div style={{ minWidth:120 }}>
                          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.employee}</div>
                          <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>{(emp.stores||[emp.store]).map(function(s){var st=STORES[s];return st?<span key={s} style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:st.color }}><span style={{width:6,height:6,borderRadius:"50%",background:st.color}} />{st.name.replace("CPR ","")}</span>:null;})}</div>
                        </div>
                        <div style={{ textAlign:"center",minWidth:40 }}><div style={{ color:"#8B8F98",fontSize:9 }}>CALLS</div><div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{emp.total_calls}</div></div>
                        <div style={{ textAlign:"center",minWidth:80 }}><div style={{ color:"#8B8F98",fontSize:9 }}>SPLIT</div><div style={{ fontSize:11 }}><span style={{ color:"#7C8AFF" }}>{emp.opportunity_calls||0} opp</span>{" "}<span style={{ color:"#FBBF24" }}>{emp.current_calls||0} curr</span></div></div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                        <div style={{ textAlign:"center" }}><div style={{ color:"#8B8F98",fontSize:9 }}>APPT</div><div style={{ color:parseFloat(emp.appt_rate||0)>=70?"#4ADE80":"#F87171",fontSize:13,fontWeight:700 }}>{parseFloat(emp.appt_rate||0).toFixed(0)}%</div></div>
                        <div style={{ textAlign:"center" }}><div style={{ color:"#8B8F98",fontSize:9 }}>WARR</div><div style={{ color:parseFloat(emp.warranty_rate||0)>=70?"#4ADE80":"#F87171",fontSize:13,fontWeight:700 }}>{parseFloat(emp.warranty_rate||0).toFixed(0)}%</div></div>
                        <div style={{ padding:"5px 14px",borderRadius:8,background:sc+"22",color:sc,fontSize:16,fontWeight:800 }}>{parseFloat(emp.avg_score||0).toFixed(2)}</div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div style={{ padding:"0 12px 20px 56px" }}>
                        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:8 }}>
                          <div style={{ background:"#0F1117",borderRadius:10,padding:16,border:"1px solid #7C8AFF22" }}>
                            <div style={{ color:"#7C8AFF",fontSize:12,fontWeight:700,marginBottom:10 }}>{"Opportunity Calls ("+empOpp.length+")"}</div>
                            {empOpp.length>0 ? (
                              <div>
                                {[{l:"Appt Offered",r:emp.appt_rate},{l:"Discount",r:emp.discount_rate},{l:"Warranty",r:emp.warranty_rate},{l:"Fast Turn.",r:emp.turnaround_rate}].map(function(item,j){
                                  return <div key={j} style={{ marginBottom:8 }}><div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}><span style={{ color:"#C8CAD0",fontSize:11 }}>{item.l}</span><span style={{ color:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",fontSize:12,fontWeight:700 }}>{parseFloat(item.r||0).toFixed(0)}%</span></div><div style={{ background:"#1A1D23",borderRadius:3,height:5,overflow:"hidden" }}><div style={{ width:(item.r||0)+"%",height:"100%",background:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",borderRadius:3 }} /></div></div>;
                                })}
                                <div style={{ marginTop:12,borderTop:"1px solid #1E2028",paddingTop:10,color:"#8B8F98",fontSize:10 }}>Recent:</div>
                                {empOpp.slice(0,3).map(function(a,j){ return <div key={j} style={{ fontSize:11,color:"#C8CAD0",marginBottom:4 }}><span style={{ color:parseFloat(a.score)>=3?"#4ADE80":"#F87171",fontWeight:700 }}>{parseFloat(a.score).toFixed(2)}</span>{" - "+(a.inquiry||"N/A")}</div>; })}
                              </div>
                            ) : <div style={{ color:"#6B6F78",fontSize:11 }}>No opportunity calls yet</div>}
                          </div>
                          <div style={{ background:"#0F1117",borderRadius:10,padding:16,border:"1px solid #FBBF2422" }}>
                            <div style={{ color:"#FBBF24",fontSize:12,fontWeight:700,marginBottom:10 }}>{"Current Customer ("+empCurr.length+")"}</div>
                            {empCurr.length>0 ? (
                              <div>
                                {[{l:"Status Update",r:emp.status_rate},{l:"ETA Given",r:emp.eta_rate},{l:"Prof. Tone",r:emp.tone_rate},{l:"Next Steps",r:emp.next_steps_rate}].map(function(item,j){
                                  return <div key={j} style={{ marginBottom:8 }}><div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}><span style={{ color:"#C8CAD0",fontSize:11 }}>{item.l}</span><span style={{ color:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",fontSize:12,fontWeight:700 }}>{parseFloat(item.r||0).toFixed(0)}%</span></div><div style={{ background:"#1A1D23",borderRadius:3,height:5,overflow:"hidden" }}><div style={{ width:(item.r||0)+"%",height:"100%",background:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",borderRadius:3 }} /></div></div>;
                                })}
                                <div style={{ marginTop:12,borderTop:"1px solid #1E2028",paddingTop:10,color:"#8B8F98",fontSize:10 }}>Recent:</div>
                                {empCurr.slice(0,3).map(function(a,j){ return <div key={j} style={{ fontSize:11,color:"#C8CAD0",marginBottom:4 }}><span style={{ color:parseFloat(a.score)>=3?"#4ADE80":"#F87171",fontWeight:700 }}>{parseFloat(a.score).toFixed(2)}</span>{" - "+(a.inquiry||"N/A")}{a.device_type&&a.device_type!=="Not mentioned"?" ("+a.device_type+")":""}</div>; })}
                              </div>
                            ) : <div style={{ color:"#6B6F78",fontSize:11 }}>No current customer calls yet</div>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78" }}>No employee data yet. Run Audit All first.</div>}
        </div>
      )}

      {/* ROSTER */}
      {auditView==="roster" && (
        <div>
          <SectionHeader title="Employee Roster" subtitle="Map transcript names to real employees" icon="📝" />
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Add Employee</div>
            <div style={{ display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end" }}>
              <div><div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Full Name</div><input value={rosterForm.name} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{name:e.target.value});});}} placeholder="e.g. Mahmoud" style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,width:160,outline:"none" }} /></div>
              <div><div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Store</div><select value={rosterForm.store} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{store:e.target.value});});}} style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none" }}>{STORE_KEYS.map(function(k){return <option key={k} value={k}>{STORES[k].name}</option>;})}</select></div>
              <div><div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Aliases (comma-separated)</div><input value={rosterForm.aliases} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{aliases:e.target.value});});}} placeholder="e.g. Mau, Ma, Mah" style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,width:220,outline:"none" }} /></div>
              <div><div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Role</div><select value={rosterForm.role} onChange={function(e){setRosterForm(function(p){return Object.assign({},p,{role:e.target.value});});}} style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none" }}>{["Manager","Lead Tech","Technician","Front Desk"].map(function(r){return <option key={r} value={r}>{r}</option>;})}</select></div>
              <button onClick={async function(){
                if(!rosterForm.name) return;
                var res = await fetch("/api/dialpad/roster",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"add",name:rosterForm.name,store:rosterForm.store,aliases:rosterForm.aliases,role:rosterForm.role})});
                var json = await res.json();
                if(json.success && json.employee) { setRoster(function(prev){return prev.filter(function(r){return !(r.name===rosterForm.name&&r.store===rosterForm.store);}).concat([json.employee]);}); setRosterForm({name:"",store:rosterForm.store,aliases:"",role:"Technician"}); }
              }} style={{ padding:"8px 18px",borderRadius:6,border:"none",cursor:"pointer",background:"#7C8AFF",color:"#FFF",fontSize:12,fontWeight:700,height:36 }}>Add</button>
            </div>
          </div>

          {unmatched.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #FBBF2433" }}>
              <div style={{ color:"#FBBF24",fontSize:14,fontWeight:700,marginBottom:8 }}>Unmatched Names ({unmatched.length})</div>
              <div style={{ color:"#6B6F78",fontSize:12,marginBottom:12 }}>These transcript names have no roster match. Click to add as alias.</div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {unmatched.map(function(u, i) {
                  return <button key={i} onClick={function(){setRosterForm(function(p){return Object.assign({},p,{aliases:p.aliases?p.aliases+", "+u.name:u.name,store:u.store});});}} style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#C8CAD0",fontSize:12,cursor:"pointer" }}>{'"'+u.name+'" ('+u.count+'x, '+(STORES[u.store]?STORES[u.store].name.replace("CPR ",""):u.store)+')'}</button>;
                })}
              </div>
            </div>
          )}

          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Current Roster ({roster.length})</div>
            {roster.length > 0 ? (
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead><tr style={{ borderBottom:"1px solid #2A2D35" }}>{["Name","Store","Role","Aliases",""].map(function(h,i){return <th key={i} style={{ textAlign:"left",padding:"8px 12px",color:"#6B6F78",fontSize:10 }}>{h}</th>;})}</tr></thead>
                <tbody>{roster.map(function(emp) {
                  var store = STORES[emp.store];
                  return (
                    <tr key={emp.id} style={{ borderBottom:"1px solid #1E2028" }}>
                      <td style={{ padding:"12px",color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.name}</td>
                      <td style={{ padding:"12px",color:store?store.color:"#8B8F98",fontSize:12 }}>{store?store.name.replace("CPR ",""):emp.store}</td>
                      <td style={{ padding:"12px",color:"#C8CAD0",fontSize:12 }}>{emp.role}</td>
                      <td style={{ padding:"12px" }}><div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>{(emp.aliases||[]).map(function(a,j){return <span key={j} style={{ padding:"2px 8px",borderRadius:4,background:"#2A2D35",color:"#8B8F98",fontSize:11 }}>{a}</span>;})}</div></td>
                      <td style={{ padding:"12px" }}><button onClick={async function(){ await fetch("/api/dialpad/roster",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"delete",id:emp.id})}); setRoster(function(prev){return prev.filter(function(r){return r.id!==emp.id;});}); }} style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>Remove</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            ) : <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No employees added. Add your team above.</div>}
          </div>
        </div>
      )}

      {/* DROPPED BALLS */}
      {auditView==="dropped" && (
        <div>
          <SectionHeader title="Dropped Ball Tracker" subtitle="Customers who called multiple times" icon="🚨" />
          {!repeatCallers ? (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center" }}>
              <div style={{ fontSize:32,marginBottom:12 }}>{"🚨"}</div>
              <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700,marginBottom:8 }}>Detect repeat callers</div>
              <div style={{ color:"#6B6F78",fontSize:13,marginBottom:16 }}>Scans the last 7 days for customers who called the same store multiple times.</div>
              <button onClick={loadRepeatCallers} disabled={repeatLoading} style={{ padding:"10px 24px",borderRadius:8,border:"none",cursor:repeatLoading?"default":"pointer",background:repeatLoading?"#F8717122":"linear-gradient(135deg,#F87171,#FB923C)",color:repeatLoading?"#F87171":"#FFF",fontSize:13,fontWeight:700,animation:repeatLoading?"pulse 1.5s infinite":"none" }}>{repeatLoading?"Scanning...":"Scan for Dropped Balls"}</button>
            </div>
          ) : (
            <div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:20 }}>
                <StatCard label="Repeat Callers" value={repeatCallers.summary?repeatCallers.summary.total_repeat_callers:0} accent="#F87171" />
                <StatCard label="High Severity" value={repeatCallers.summary?repeatCallers.summary.high_severity:0} accent="#F87171" sub="3+ calls, no callback" />
                <StatCard label="Never Called Back" value={repeatCallers.summary?repeatCallers.summary.never_called_back:0} accent="#FB923C" />
              </div>
              <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
                  <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>Flagged Customers</div>
                  <button onClick={loadRepeatCallers} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:11,cursor:"pointer" }}>Rescan</button>
                </div>
                <div style={{ maxHeight:500,overflowY:"auto" }}>
                  {(repeatCallers.repeatCallers||[]).map(function(rc, i) {
                    var store = STORES[rc.store];
                    var sevColor = rc.severity==="high"?"#F87171":rc.severity==="medium"?"#FBBF24":"#6B6F78";
                    return (
                      <div key={i} style={{ padding:"14px 0",borderBottom:"1px solid #2A2D35" }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                          <div>
                            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                              <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,background:sevColor+"22",color:sevColor,textTransform:"uppercase" }}>{rc.severity}</span>
                              <span style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{rc.customer_name!=="Unknown"?rc.customer_name:rc.phone}</span>
                            </div>
                            <div style={{ fontSize:11,color:"#8B8F98" }}>
                              <span style={{ color:store?store.color:"#8B8F98" }}>{store?store.name:rc.store}</span>
                              {rc.device_type!=="Unknown" && (" | "+rc.device_type)}
                              {" | "+rc.time_span_hours+"h span"}
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ color:"#F0F1F3",fontSize:20,fontWeight:800 }}>{rc.total_calls}x</div>
                            <div style={{ fontSize:10,color:rc.we_called_back?"#4ADE80":"#F87171" }}>{rc.we_called_back?"Called back":"Never called back"}</div>
                          </div>
                        </div>
                        <div style={{ marginTop:10,paddingLeft:8,borderLeft:"2px solid #2A2D35" }}>
                          {rc.calls.slice(0,5).map(function(c, j) {
                            return (
                              <div key={j} style={{ display:"flex",alignItems:"center",gap:8,padding:"4px 0",fontSize:11 }}>
                                <span style={{ width:6,height:6,borderRadius:"50%",background:c.answered?"#4ADE80":"#F87171",flexShrink:0 }} />
                                <span style={{ color:"#6B6F78",minWidth:120 }}>{new Date(c.date).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                                <span style={{ color:c.answered?"#C8CAD0":"#F87171" }}>{c.answered?"Answered":"Missed"}</span>
                                {c.employee && <span style={{ color:"#8B8F98" }}>{"- "+c.employee}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {(repeatCallers.repeatCallers||[]).length===0 && <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No repeat callers detected!</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AUDIT CALLS */}
      {auditView==="calls" && (
        <div>
          {error && <div style={{ padding:"8px 12px",borderRadius:6,background:"#F8717122",color:"#F87171",fontSize:12,marginBottom:12 }}>{error}</div>}
          {batchRunning && (
            <div style={{ background:"#1A1D23",borderRadius:8,padding:"12px 16px",marginBottom:16,border:"1px solid #7C8AFF33" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                <span style={{ color:"#C8CAD0",fontSize:13,fontWeight:600 }}>{"Batch: "+batchProgress.done+" / "+batchProgress.total}</span>
                <button onClick={function(){batchAbort.current=true;}} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #F8717144",background:"#F8717118",color:"#F87171",fontSize:11,cursor:"pointer" }}>Stop</button>
              </div>
              <div style={{ background:"#12141A",borderRadius:4,height:8,overflow:"hidden" }}><div style={{ width:(batchProgress.total>0?(batchProgress.done/batchProgress.total*100):0)+"%",height:"100%",background:"#7C8AFF",borderRadius:4 }} /></div>
            </div>
          )}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <SectionHeader title="Recorded Calls" subtitle={recordedCalls.length+" unaudited"} icon="🎙️" />
              {recordedCalls.length>0 && !batchRunning && (
                <button onClick={runBatch} style={{ padding:"8px 20px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#7C8AFF,#C084FC)",color:"#FFF",fontSize:13,fontWeight:700 }}>{"Audit All ("+recordedCalls.length+")"}</button>
              )}
            </div>
            <div style={{ maxHeight:600,overflowY:"auto" }}>
              {recordedCalls.map(function(call, i) {
                var isA = auditingId===call.call_id;
                var d = new Date(call.date_started);
                var store = STORES[call._storeKey];
                return (
                  <div key={i} style={{ padding:"12px 0",borderBottom:"1px solid #2A2D35",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}><span style={{ width:8,height:8,borderRadius:"50%",background:store?store.color:"#8B8F98" }} /><span style={{ color:"#E8E9EC",fontSize:13,fontWeight:600 }}>{call.external_number}</span><span style={{ color:"#6B6F78",fontSize:11 }}>{"-> "+call.name}</span></div>
                      <div style={{ color:"#6B6F78",fontSize:11,marginTop:2 }}>{d.toLocaleDateString()+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}{call.talk_duration?" | "+parseFloat(call.talk_duration).toFixed(1)+" min":""}</div>
                    </div>
                    <button onClick={function(){if(!isA&&!batchRunning) runAudit(call);}} disabled={isA||batchRunning} style={{ padding:"6px 14px",borderRadius:6,border:"none",cursor:isA||batchRunning?"default":"pointer",background:isA?"#7C8AFF22":"#7C8AFF",color:isA?"#7C8AFF":"#FFF",fontSize:12,fontWeight:600,animation:isA?"pulse 1.5s infinite":"none" }}>{isA?"Scoring...":"Audit"}</button>
                  </div>
                );
              })}
              {recordedCalls.length===0 && <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>All calls audited!</div>}
            </div>
          </div>
        </div>
      )}

      {/* HISTORY */}
      {auditView==="history" && (
        <div>
          <SectionHeader title="Audit History" subtitle={filteredAudits.length+" calls"} icon="📋" />
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,maxHeight:600,overflowY:"auto" }}>
            {filteredAudits.map(function(audit, i) {
              var score = parseFloat(audit.score||0);
              var sc = score>=3?"#4ADE80":score>=2?"#FBBF24":"#F87171";
              var store = STORES[audit.store];
              var d = new Date(audit.date_started||audit.date);
              var typeBg = audit.call_type==="opportunity"?"#7C8AFF":audit.call_type==="current_customer"?"#FBBF24":"#6B6F78";
              return (
                <div key={audit.call_id||i} style={{ padding:16,borderBottom:"1px solid #2A2D35" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
                        <span style={{ color:"#E8E9EC",fontSize:13,fontWeight:700 }}>{audit.employee||"Unknown"}{" - "+audit.phone}</span>
                        <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:typeBg+"18",color:typeBg }}>{audit.call_type==="current_customer"?"Current Customer":audit.call_type==="non_scorable"?"Non-Scorable":"Opportunity"}</span>
                      </div>
                      <div style={{ color:"#6B6F78",fontSize:11 }}>
                        {d.toLocaleDateString()+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+" | "}
                        <span style={{ color:store?store.color:"#8B8F98" }}>{store?store.name:audit.store}</span>
                        {audit.customer_name&&audit.customer_name!=="Unknown"?" | Customer: "+audit.customer_name:""}
                        {audit.device_type&&audit.device_type!=="Not mentioned"?" | "+audit.device_type:""}
                      </div>
                    </div>
                    <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:16,fontWeight:800 }}>{score.toFixed(2)+" / 4"}</div>
                  </div>
                  <div style={{ color:"#C8CAD0",fontSize:12,marginBottom:8 }}><strong>Inquiry:</strong> {audit.inquiry||"-"}<br /><strong>Outcome:</strong> {audit.outcome||"-"}</div>
                  <CriteriaGrid audit={audit} />
                </div>
              );
            })}
            {filteredAudits.length===0 && <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No history yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════
export default function DialpadDashboard() {
  var [activeTab, setActiveTab] = useState("overview");
  var [storeFilter, setStoreFilter] = useState("all");
  var [isLive, setIsLive] = useState(false);
  var [isStored, setIsStored] = useState(false);
  var [isLoading, setIsLoading] = useState(false);
  var [lastSync, setLastSync] = useState(null);
  var [rawCallData, setRawCallData] = useState([]);
  var [dailyCalls, setDailyCalls] = useState(SAMPLE_DAILY_CALLS);
  var [hourlyMissed, setHourlyMissed] = useState(SAMPLE_HOURLY_MISSED);
  var [dowData, setDowData] = useState(SAMPLE_DOW_DATA);
  var [callbackData, setCallbackData] = useState(SAMPLE_CALLBACK_DATA);
  var [keywords, setKeywords] = useState(SAMPLE_KEYWORDS);
  var [problemCalls, setProblemCalls] = useState(SAMPLE_PROBLEM_CALLS);

  var loadStoredData = useCallback(async function() {
    try {
      var res = await fetch("/api/dialpad/stored?days=30");
      var json = await res.json();
      if (json.success && json.hasData) {
        var d = json.data;
        if(d.dailyCalls&&d.dailyCalls.length>0) setDailyCalls(d.dailyCalls);
        if(d.hourlyMissed&&d.hourlyMissed.length>0) setHourlyMissed(d.hourlyMissed);
        if(d.dowData&&d.dowData.length>0) setDowData(d.dowData);
        if(d.callbackData&&d.callbackData.length>0) setCallbackData(d.callbackData);
        if(d.problemCalls&&d.problemCalls.length>0) setProblemCalls(d.problemCalls);
        setIsStored(true); setLastSync(json.lastSync);
        return true;
      }
    } catch(e) { console.error(e); }
    return false;
  }, []);

  var loadLiveData = useCallback(async function() {
    setIsLoading(true);
    try {
      var data = await fetchLiveStats();
      if (data && data.length > 0) {
        setRawCallData(data);
        var daily = transformToDailyCalls(data); if(daily.length>0) setDailyCalls(daily);
        var hourly = transformToHourlyMissed(data); if(hourly.some(function(h){return STORE_KEYS.some(function(k){return h[k]>0;});})) setHourlyMissed(hourly);
        var dow = transformToDOWMissed(data); if(dow.some(function(d){return STORE_KEYS.some(function(k){return d[k]>0;});})) setDowData(dow);
        var cbs = transformToCallbackData(data); if(cbs.some(function(c){return c.missed>0;})) setCallbackData(cbs);
        var probs = transformToProblemCalls(data); if(probs.some(function(p){return STORE_KEYS.some(function(k){return p[k]>0;});})) setProblemCalls(probs);
        setIsLive(true); setIsStored(false);
      }
    } catch(e) { console.error(e); }
    setIsLoading(false);
  }, []);

  useEffect(function() {
    async function init() { var has = await loadStoredData(); if(!has) await loadLiveData(); }
    init();
  }, [loadStoredData, loadLiveData]);

  var overviewStats = useMemo(function() {
    var totals = {total:0,answered:0,missed:0};
    var storeStats = {};
    STORE_KEYS.forEach(function(s){storeStats[s]={total:0,answered:0,missed:0};});
    dailyCalls.forEach(function(d) {
      STORE_KEYS.forEach(function(s) {
        var t = d[s+"_total"]||0;
        var a = d[s+"_answered"]||0;
        var m = d[s+"_missed"]!==undefined ? d[s+"_missed"] : (t-a);
        storeStats[s].total += t; storeStats[s].answered += a; storeStats[s].missed += m;
        totals.total += t; totals.answered += a; totals.missed += m;
      });
    });
    return {totals:totals, storeStats:storeStats};
  }, [dailyCalls]);

  return (
    <div style={{ background:"#0F1117",minHeight:"100vh",color:"#F0F1F3",fontFamily:"'Space Grotesk',-apple-system,sans-serif" }}>
      <style>{"@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }"}</style>
      <div style={{ background:"#12141A",borderBottom:"1px solid #1E2028",padding:"16px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12 }}>
        <div style={{ display:"flex",alignItems:"center",gap:14 }}>
          <div style={{ width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#7C8AFF,#C084FC)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>{"📞"}</div>
          <div><h1 style={{ margin:0,fontSize:19,fontWeight:800 }}>Dialpad Analytics</h1><p style={{ margin:0,color:"#6B6F78",fontSize:12 }}>CPR Store Call Intelligence</p></div>
        </div>
        <StoreToggle selected={storeFilter} onChange={setStoreFilter} />
      </div>
      <div style={{ background:"#12141A",borderBottom:"1px solid #1E2028",padding:"0 28px",display:"flex",gap:0,overflowX:"auto" }}>
        {TABS.map(function(tab) {
          return <button key={tab.id} onClick={function(){setActiveTab(tab.id);}} style={{ padding:"14px 20px",border:"none",cursor:"pointer",background:"transparent",color:activeTab===tab.id?"#F0F1F3":"#6B6F78",fontSize:13,fontWeight:600,borderBottom:activeTab===tab.id?"2px solid #7C8AFF":"2px solid transparent",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",fontFamily:"'Space Grotesk',sans-serif" }}><span style={{ fontSize:14 }}>{tab.icon}</span>{tab.label}</button>;
        })}
      </div>
      <div style={{ padding:28 }}>
        <DataBanner isLive={isLive} isLoading={isLoading} isStored={isStored} lastSync={lastSync} onRefresh={loadStoredData} onLiveRefresh={loadLiveData} />
        {activeTab==="overview" && <OverviewTab storeFilter={storeFilter} overviewStats={overviewStats} dailyCalls={dailyCalls} />}
        {activeTab==="keywords" && <KeywordsTab keywords={keywords} />}
        {activeTab==="missed" && <MissedTab storeFilter={storeFilter} overviewStats={overviewStats} hourlyMissed={hourlyMissed} dowData={dowData} />}
        {activeTab==="callbacks" && <CallbacksTab callbackData={callbackData} />}
        {activeTab==="problems" && <ProblemsTab overviewStats={overviewStats} problemCalls={problemCalls} />}
        {activeTab==="audit" && <AuditTab rawCallData={rawCallData} storeFilter={storeFilter} />}
      </div>
      <div style={{ padding:"16px 28px",borderTop:"1px solid #1E2028",color:"#4A4D55",fontSize:11,textAlign:"center" }}>
        {isStored ? "Stored data" : isLive ? "Live data" : "Sample data"} | Focused Technologies LLC
      </div>
    </div>
  );
}

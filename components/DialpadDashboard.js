'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, AreaChart, Area, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis
} from "recharts";
import { STORES, TABS, APP_NAME, APP_SUBTITLE } from "@/lib/constants";
import { useAuth } from "@/components/AuthProvider";
import ScheduleTab from "@/components/ScheduleTab";
import EmployeeTab from "@/components/EmployeeTab";
import VoicemailTab from "@/components/VoicemailTab";
import SalesTab from "@/components/SalesTab";
import ScorecardTab from "@/components/ScorecardTab";
import ComplianceTab from "@/components/ComplianceTab";
import InsightsTab from "@/components/InsightsTab";
import AdminTab from "@/components/AdminTab";
import AIAssistant from "@/components/AIAssistant";
import ProfitabilityTab from "@/components/ProfitabilityTab";
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
  var bgColor = isStored ? "#7B2FFF12" : isLive ? "#4ADE8012" : "#FBBF2412";
  var borderColor = isStored ? "#7B2FFF33" : isLive ? "#4ADE8033" : "#FBBF2433";
  var dotColor = isStored ? "#7B2FFF" : isLive ? "#4ADE80" : "#FBBF24";
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
            <button onClick={onLiveRefresh} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #7B2FFF44",background:"#7B2FFF18",color:"#7B2FFF",fontSize:11,cursor:"pointer" }}>Live Refresh</button>
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
    <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #00D4FF33" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:summary?16:0 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:20 }}>{"🤖"}</span>
          <div>
            <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{"AI " + (type === "audit" ? "Coaching Report" : "Executive Summary")}</div>
            <div style={{ color:"#6B6F78",fontSize:11 }}>Powered by Claude</div>
          </div>
        </div>
        <button onClick={generate} disabled={loading} style={{ padding:"8px 18px",borderRadius:8,border:"none",cursor:loading?"default":"pointer",background:loading?"#00D4FF22":"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:loading?"#00D4FF":"#FFF",fontSize:12,fontWeight:700,animation:loading?"pulse 1.5s infinite":"none" }}>{loading?"Generating...":summary?"Refresh":"Generate Insights"}</button>
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
        <StatCard label="Total Calls (30d)" value={(overviewStats.totals.answered+overviewStats.totals.missed).toLocaleString()} accent="#7B2FFF" />
        <StatCard label="Answer Rate" value={((overviewStats.totals.answered+overviewStats.totals.missed)>0?((overviewStats.totals.answered/(overviewStats.totals.answered+overviewStats.totals.missed))*100).toFixed(1):"0")+"%"} accent="#4ADE80" sub={overviewStats.totals.answered.toLocaleString()+" answered"} />
        <StatCard label="Missed Calls" value={overviewStats.totals.missed.toLocaleString()} accent="#F87171" />
        <StatCard label="Avg Calls / Day" value={Math.round((overviewStats.totals.answered+overviewStats.totals.missed)/30)} accent="#00D4FF" sub="across all stores" />
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"repeat("+STORE_KEYS.length+",1fr)",gap:14,marginBottom:28 }}>
        {Object.entries(STORES).map(function([key,store]) {
          var s = overviewStats.storeStats[key];
          var realTotal = s.answered + s.missed;
          var rate = realTotal > 0 ? ((s.answered/realTotal)*100).toFixed(1) : "0.0";
          return (
            <div key={key} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
              <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}>
                <div style={{ width:36,height:36,borderRadius:10,background:store.color+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store.color,fontWeight:800,fontSize:16 }}>{store.icon}</div>
                <div>
                  <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{store.name}</div>
                  <div style={{ color:"#6B6F78",fontSize:11 }}>{realTotal} total calls</div>
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
  var catColors = { Service:"#7B2FFF",Sales:"#4ADE80",Support:"#FBBF24",Operations:"#00D4FF",Problem:"#F87171" };
  return (
    <div>
      <div style={{ display:"flex",gap:6,marginBottom:20,flexWrap:"wrap" }}>
        {categories.map(function(c){ return <button key={c} onClick={function(){setCat(c);}} style={{ padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",background:cat===c?"#7B2FFF22":"#1A1D23",color:cat===c?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{c}</button>; })}
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
        {Object.entries(STORES).map(function([key,store]){ var s=overviewStats.storeStats[key]; var rt=s.answered+s.missed; return <StatCard key={key} label={store.name+" Missed"} value={s.missed} accent={store.color} sub={rt?((s.missed/rt)*100).toFixed(1)+"% miss rate":""} />; })}
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
        <StatCard label="% of All Calls" value={(overviewStats.totals.answered+overviewStats.totals.missed)>0?((tp/(overviewStats.totals.answered+overviewStats.totals.missed))*100).toFixed(1)+"%":"0%"} accent="#FB923C" />
        <StatCard label="Top Issue" value={problemCalls[0]?problemCalls[0].type:"N/A"} accent="#00D4FF" />
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
  var [linkingName, setLinkingName] = useState(null);
  var [actionMsg, setActionMsg] = useState(null);
  var [reviewAudits, setReviewAudits] = useState([]);
  var [reviewLoading, setReviewLoading] = useState(false);
  var [reauditRunning, setReauditRunning] = useState(false);
  var [expandedTranscript, setExpandedTranscript] = useState(null);

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        var sp = storeFilter !== "all" ? "&store="+storeFilter : "";
        var aR = await fetch("/api/dialpad/audit?limit=1000&days=30"+sp).then(function(r){return r.json();});
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

  var isOnRoster = function(empName) {
    var lower = empName.toLowerCase();
    return roster.some(function(r) {
      if (r.name.toLowerCase() === lower) return true;
      if ((r.aliases || []).some(function(a){ return a.toLowerCase() === lower; })) return true;
      return false;
    });
  };

  var linkToEmployee = async function(strayName, rosterEmpId, rosterEmp) {
    try {
      var newAliases = (rosterEmp.aliases || []).concat([strayName]);
      var res = await fetch("/api/dialpad/roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: rosterEmpId, aliases: newAliases })
      });
      var json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: '"' + strayName + '" linked to ' + rosterEmp.name + ' — reload to see merged data' });
        setLinkingName(null);
        // Refresh roster
        try {
          var rR = await fetch("/api/dialpad/roster?action=list").then(function(r){return r.json();});
          if (rR.success) setRoster(rR.employees || []);
        } catch(e) {}
        setTimeout(function(){ setActionMsg(null); }, 5000);
      }
    } catch(e) { setActionMsg({ type: "error", text: "Failed: " + e.message }); }
  };

  var deleteAudits = async function(empName, empStore) {
    if (!confirm('Delete all audits for "' + empName + '"? This cannot be undone.')) return;
    try {
      var res = await fetch("/api/dialpad/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_by_employee", employee: empName, store: empStore })
      });
      var json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: 'Deleted audits for "' + empName + '"' });
        setAudits(function(prev){ return prev.filter(function(a){ return a.employee !== empName; }); });
        setEmployees(function(prev){ return prev.filter(function(e){ return e.employee !== empName; }); });
        setTimeout(function(){ setActionMsg(null); }, 5000);
      } else {
        setActionMsg({ type: "error", text: json.error || "Delete failed" });
      }
    } catch(e) { setActionMsg({ type: "error", text: "Failed: " + e.message }); }
  };

  var total = filteredAudits.length;

  var loadReviewAudits = async function() {
    setReviewLoading(true);
    try {
      var res = await fetch("/api/dialpad/audit?action=low_confidence&threshold=70&limit=50");
      var json = await res.json();
      if (json.success) setReviewAudits(json.audits || []);
    } catch(e) { console.error(e); }
    setReviewLoading(false);
  };

  var excludeCall = async function(callId, reason) {
    try {
      var res = await fetch("/api/dialpad/audit", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "exclude", callId: callId, reason: reason || "Manually excluded by manager" }) });
      var json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: "Call excluded from scoring" });
        setAudits(function(prev) { return prev.map(function(a) { return a.call_id === callId ? Object.assign({}, a, { excluded: true, exclude_reason: reason }) : a; }); });
        setReviewAudits(function(prev) { return prev.filter(function(a) { return a.call_id !== callId; }); });
        setTimeout(function() { setActionMsg(null); }, 4000);
      }
    } catch(e) { setActionMsg({ type: "error", text: e.message }); }
  };

  var overrideCall = async function(callId, callType, notes) {
    try {
      var res = await fetch("/api/dialpad/audit", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "override", callId: callId, callType: callType, notes: notes || "" }) });
      var json = await res.json();
      if (json.success) {
        setActionMsg({ type: "success", text: "Audit overridden — reclassified as " + callType });
        if (callType === "non_scorable") {
          setAudits(function(prev) { return prev.map(function(a) { return a.call_id === callId ? Object.assign({}, a, { call_type: "non_scorable", score: 0, excluded: true }) : a; }); });
        }
        setReviewAudits(function(prev) { return prev.filter(function(a) { return a.call_id !== callId; }); });
        setTimeout(function() { setActionMsg(null); }, 4000);
      }
    } catch(e) { setActionMsg({ type: "error", text: e.message }); }
  };

  var reauditCall = async function(callId, callInfo) {
    setAuditingId(callId);
    try {
      var res = await fetch("/api/dialpad/audit", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: callId, callInfo: callInfo, forceReaudit: true }) });
      var json = await res.json();
      if (json.success && json.audit) {
        setActionMsg({ type: "success", text: "Re-audited: " + (json.audit.call_type) + " — " + (json.audit.score || 0) + " pts (confidence: " + (json.audit.confidence || "?") + ")" });
        setAudits(function(prev) { return prev.map(function(a) { return a.call_id === callId ? Object.assign({}, a, json.audit) : a; }); });
        setTimeout(function() { setActionMsg(null); }, 5000);
      } else {
        setActionMsg({ type: "error", text: json.error || "Re-audit failed" });
      }
    } catch(e) { setActionMsg({ type: "error", text: e.message }); }
    setAuditingId(null);
  };

  var triggerFullReaudit = async function() {
    // Triple confirmation
    if (!confirm("⚠️ RE-AUDIT ALL CALLS\n\nThis will DELETE all existing audit scores and re-score every call with the updated prompt.\n\nAre you sure?")) return;
    if (!confirm("SECOND CONFIRMATION\n\nAll current employee scores will be wiped. New scores will appear over the next 5-10 minutes as the system re-processes each call.\n\nProceed?")) return;
    var typed = prompt("FINAL CONFIRMATION\n\nType REAUDIT to confirm:");
    if (typed !== "REAUDIT") {
      setActionMsg({ type: "error", text: "Re-audit cancelled — you must type REAUDIT exactly" });
      setTimeout(function(){ setActionMsg(null); }, 4000);
      return;
    }

    setReauditRunning(true);
    setActionMsg({ type: "success", text: "Clearing all audits..." });
    try {
      var res = await fetch("/api/dialpad/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "trigger_reaudit", confirm: "REAUDIT_ALL" })
      });
      var json = await res.json();
      if (json.success) {
        setAudits([]);
        setEmployees([]);
        setActionMsg({ type: "success", text: "✅ All audits cleared. Re-audit cron triggered — new scores will appear over the next 5-10 minutes. Refresh the page periodically." });
      } else {
        setActionMsg({ type: "error", text: json.error || "Re-audit failed" });
        setReauditRunning(false);
      }
    } catch(e) {
      setActionMsg({ type: "error", text: "Error: " + e.message });
      setReauditRunning(false);
    }
    // Don't clear reauditRunning — keep the indicator until user refreshes
  };

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
    {id:"dropped",label:"Dropped Balls",icon:"🚨"},
    {id:"review",label:"Needs Review",icon:"⚠️"},
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
            return <button key={v.id} onClick={function(){setAuditView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:auditView===v.id?"#7B2FFF22":"#1A1D23",color:auditView===v.id?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
          })}
        </div>
        {(auditView==="overview"||auditView==="history") && (
          <div style={{ display:"flex",gap:4 }}>
            {["all","opportunity","current_customer"].map(function(f){ var label=f==="all"?"All":f==="opportunity"?"Opportunity":"Current"; return <button key={f} onClick={function(){setCallTypeFilter(f);}} style={{ padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",background:callTypeFilter===f?"#2A2D35":"transparent",color:callTypeFilter===f?"#F0F1F3":"#6B6F78",fontSize:11,fontWeight:600 }}>{label}</button>; })}
          </div>
        )}
      </div>

      {/* Global action message */}
      {actionMsg && auditView !== "review" && auditView !== "history" && (
        <div style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,background:actionMsg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(actionMsg.type==="success"?"#4ADE8033":"#F8717133"),color:actionMsg.type==="success"?"#4ADE80":"#F87171",fontSize:13 }}>
          {actionMsg.text}
        </div>
      )}

      {/* OVERVIEW */}
      {auditView==="overview" && (
        <div>
          <AISummary type="audit" />
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28 }}>
            <StatCard label="Calls Audited" value={total} accent="#7B2FFF" sub={oppCount+" opportunity, "+currCount+" current"} />
            <StatCard label="Avg Score" value={avgScore+" / 4"} accent={parseFloat(avgScore)>=3?"#4ADE80":parseFloat(avgScore)>=2?"#FBBF24":"#F87171"} />
            <StatCard label="Unaudited" value={recordedCalls.length} accent="#00D4FF" sub="recorded calls available" />
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

          {/* Re-Audit Panel */}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginTop:20,border:"1px solid #F8717122" }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
              <div>
                <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>Re-Audit All Calls</div>
                <div style={{ color:"#6B6F78",fontSize:12,marginTop:2 }}>Clear all existing scores and re-audit every call with the latest prompt. Takes 5-10 minutes.</div>
              </div>
              {reauditRunning ? (
                <div style={{ padding:"8px 20px",borderRadius:6,background:"#FBBF2422",color:"#FBBF24",fontSize:12,fontWeight:700 }}>
                  Re-audit in progress... refresh to see results
                </div>
              ) : (
                <button onClick={triggerFullReaudit}
                  style={{ padding:"8px 20px",borderRadius:6,border:"1px solid #F87171",background:"#F8717122",color:"#F87171",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap" }}>
                  Re-Audit All
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EMPLOYEES */}
      {auditView==="employees" && (
        <div>
          <SectionHeader title="Employee Leaderboard" subtitle="Click to expand" icon="🏆" />
          {actionMsg && (
            <div style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,background:actionMsg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(actionMsg.type==="success"?"#4ADE8033":"#F8717133"),color:actionMsg.type==="success"?"#4ADE80":"#F87171",fontSize:13 }}>
              {actionMsg.text}
            </div>
          )}
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
                var isStray = !isOnRoster(emp.employee);
                var isLinkingThis = linkingName === empKey;
                return (
                  <div key={empKey} style={{ borderBottom:"1px solid #1E2028" }}>
                    <div onClick={function(){if(!isLinkingThis)setExpandedEmp(isExpanded?null:empKey);}} style={{ padding:"14px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",background:isExpanded?"#12141A":"transparent" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:16 }}>
                        <span style={{ fontSize:18,width:28,textAlign:"center" }}>{medal}</span>
                        <div style={{ minWidth:120 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                            <span style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.employee}</span>
                            {isStray && <span style={{ padding:"1px 6px",borderRadius:4,background:"#FBBF2418",color:"#FBBF24",fontSize:9,fontWeight:600 }}>unmatched</span>}
                          </div>
                          <div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>{(emp.stores||[emp.store]).map(function(s){var st=STORES[s];return st?<span key={s} style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:10,color:st.color }}><span style={{width:6,height:6,borderRadius:"50%",background:st.color}} />{st.name.replace("CPR ","")}</span>:null;})}</div>
                        </div>
                        <div style={{ textAlign:"center",minWidth:40 }}><div style={{ color:"#8B8F98",fontSize:9 }}>CALLS</div><div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{emp.total_calls}</div></div>
                        <div style={{ textAlign:"center",minWidth:80 }}><div style={{ color:"#8B8F98",fontSize:9 }}>SPLIT</div><div style={{ fontSize:11 }}><span style={{ color:"#7B2FFF" }}>{emp.opportunity_calls||0} opp</span>{" "}<span style={{ color:"#FBBF24" }}>{emp.current_calls||0} curr</span></div></div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                        {isStray && (
                          <div style={{ display:"flex",gap:4 }}>
                            <button onClick={function(e){e.stopPropagation(); setLinkingName(isLinkingThis?null:empKey);}}
                              style={{ padding:"4px 10px",borderRadius:6,border:"1px solid #7B2FFF33",background:isLinkingThis?"#7B2FFF22":"transparent",color:"#7B2FFF",fontSize:10,cursor:"pointer",fontWeight:600,whiteSpace:"nowrap" }}>
                              {isLinkingThis ? "Cancel" : "Link"}
                            </button>
                            <button onClick={function(e){e.stopPropagation(); deleteAudits(emp.employee, emp.store);}}
                              style={{ padding:"4px 10px",borderRadius:6,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer",fontWeight:600,whiteSpace:"nowrap" }}>
                              Delete
                            </button>
                          </div>
                        )}
                        <div style={{ textAlign:"center" }}><div style={{ color:"#8B8F98",fontSize:9 }}>APPT</div><div style={{ color:parseFloat(emp.appt_rate||0)>=70?"#4ADE80":"#F87171",fontSize:13,fontWeight:700 }}>{parseFloat(emp.appt_rate||0).toFixed(0)}%</div></div>
                        <div style={{ textAlign:"center" }}><div style={{ color:"#8B8F98",fontSize:9 }}>WARR</div><div style={{ color:parseFloat(emp.warranty_rate||0)>=70?"#4ADE80":"#F87171",fontSize:13,fontWeight:700 }}>{parseFloat(emp.warranty_rate||0).toFixed(0)}%</div></div>
                        <div style={{ padding:"5px 14px",borderRadius:8,background:sc+"22",color:sc,fontSize:16,fontWeight:800 }}>{parseFloat(emp.avg_score||0).toFixed(2)}</div>
                      </div>
                    </div>
                    {/* Link dropdown */}
                    {isLinkingThis && (
                      <div style={{ padding:"12px 12px 12px 56px" }}>
                        <div style={{ padding:12,background:"#12141A",borderRadius:8,border:"1px solid #7B2FFF22" }}>
                          <div style={{ color:"#8B8F98",fontSize:11,marginBottom:8 }}>Link "{emp.employee}" as an alias of:</div>
                          <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
                            {roster.map(function(r) {
                              var st = STORES[r.store];
                              return (
                                <button key={r.id} onClick={function(e){e.stopPropagation(); linkToEmployee(emp.employee, r.id, r);}}
                                  style={{ padding:"6px 14px",borderRadius:6,border:"1px solid #2A2D35",background:"#1A1D23",color:"#F0F1F3",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6 }}>
                                  <span style={{ width:6,height:6,borderRadius:"50%",background:st?st.color:"#8B8F98" }}></span>
                                  <span style={{ fontWeight:700 }}>{r.name}</span>
                                  <span style={{ color:st?st.color:"#6B6F78",fontSize:10 }}>{st?st.name.replace("CPR ",""):r.store}</span>
                                </button>
                              );
                            })}
                          </div>
                          {roster.length === 0 && <div style={{ color:"#6B6F78",fontSize:12 }}>No roster employees yet. Add them in the Employees tab first.</div>}
                        </div>
                      </div>
                    )}
                    {isExpanded && (
                      <div style={{ padding:"0 12px 20px 56px" }}>
                        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:8 }}>
                          <div style={{ background:"#0F1117",borderRadius:10,padding:16,border:"1px solid #7B2FFF22" }}>
                            <div style={{ color:"#7B2FFF",fontSize:12,fontWeight:700,marginBottom:10 }}>{"Opportunity Calls ("+empOpp.length+")"}</div>
                            {empOpp.length>0 ? (
                              <div>
                                {[{l:"Appt Offered",r:emp.appt_rate,pts:1.25},{l:"Discount",r:emp.discount_rate,pts:0.92},{l:"Warranty",r:emp.warranty_rate,pts:0.92},{l:"Fast Turn.",r:emp.turnaround_rate,pts:0.92}].map(function(item,j){
                                  var earned = (parseFloat(item.r||0)/100*item.pts).toFixed(2);
                                  return <div key={j} style={{ marginBottom:8 }}><div style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3 }}><span style={{ color:"#C8CAD0",fontSize:11 }}>{item.l}<span style={{ color:"#6B6F78",fontSize:9,marginLeft:4 }}>{item.pts} pts</span></span><span style={{ display:"flex",alignItems:"baseline",gap:6 }}><span style={{ color:"#8B8F98",fontSize:10 }}>{earned+" / "+item.pts}</span><span style={{ color:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",fontSize:12,fontWeight:700 }}>{parseFloat(item.r||0).toFixed(0)}%</span></span></div><div style={{ background:"#1A1D23",borderRadius:3,height:5,overflow:"hidden" }}><div style={{ width:(item.r||0)+"%",height:"100%",background:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",borderRadius:3 }} /></div></div>;
                                })}
                                <div style={{ marginTop:10,padding:"8px 10px",borderRadius:6,background:"#7B2FFF0A",border:"1px solid #7B2FFF18",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                                  <span style={{ color:"#8B8F98",fontSize:11 }}>Weighted Avg</span>
                                  <span style={{ color:((parseFloat(emp.appt_rate||0)/100*1.25)+(parseFloat(emp.discount_rate||0)/100*0.92)+(parseFloat(emp.warranty_rate||0)/100*0.92)+(parseFloat(emp.turnaround_rate||0)/100*0.92))>=3?"#4ADE80":((parseFloat(emp.appt_rate||0)/100*1.25)+(parseFloat(emp.discount_rate||0)/100*0.92)+(parseFloat(emp.warranty_rate||0)/100*0.92)+(parseFloat(emp.turnaround_rate||0)/100*0.92))>=2?"#FBBF24":"#F87171",fontSize:14,fontWeight:800 }}>
                                    {((parseFloat(emp.appt_rate||0)/100*1.25)+(parseFloat(emp.discount_rate||0)/100*0.92)+(parseFloat(emp.warranty_rate||0)/100*0.92)+(parseFloat(emp.turnaround_rate||0)/100*0.92)).toFixed(2)+" / 4.01"}
                                  </span>
                                </div>
                                <div style={{ marginTop:12,borderTop:"1px solid #1E2028",paddingTop:10,color:"#8B8F98",fontSize:10 }}>Recent:</div>
                                {empOpp.slice(0,3).map(function(a,j){ return <div key={j} style={{ fontSize:11,color:"#C8CAD0",marginBottom:4 }}><span style={{ color:parseFloat(a.score)>=3?"#4ADE80":"#F87171",fontWeight:700 }}>{parseFloat(a.score).toFixed(2)}</span>{" - "+(a.inquiry||"N/A")}</div>; })}
                              </div>
                            ) : <div style={{ color:"#6B6F78",fontSize:11 }}>No opportunity calls yet</div>}
                          </div>
                          <div style={{ background:"#0F1117",borderRadius:10,padding:16,border:"1px solid #FBBF2422" }}>
                            <div style={{ color:"#FBBF24",fontSize:12,fontWeight:700,marginBottom:10 }}>{"Current Customer ("+empCurr.length+")"}</div>
                            {empCurr.length>0 ? (
                              <div>
                                {[{l:"Status Update",r:emp.status_rate,pts:1.00},{l:"ETA Given",r:emp.eta_rate,pts:1.00},{l:"Prof. Tone",r:emp.tone_rate,pts:1.00},{l:"Next Steps",r:emp.next_steps_rate,pts:1.00}].map(function(item,j){
                                  var earned = (parseFloat(item.r||0)/100*item.pts).toFixed(2);
                                  return <div key={j} style={{ marginBottom:8 }}><div style={{ display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3 }}><span style={{ color:"#C8CAD0",fontSize:11 }}>{item.l}<span style={{ color:"#6B6F78",fontSize:9,marginLeft:4 }}>{item.pts.toFixed(2)} pts</span></span><span style={{ display:"flex",alignItems:"baseline",gap:6 }}><span style={{ color:"#8B8F98",fontSize:10 }}>{earned+" / "+item.pts.toFixed(2)}</span><span style={{ color:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",fontSize:12,fontWeight:700 }}>{parseFloat(item.r||0).toFixed(0)}%</span></span></div><div style={{ background:"#1A1D23",borderRadius:3,height:5,overflow:"hidden" }}><div style={{ width:(item.r||0)+"%",height:"100%",background:parseFloat(item.r||0)>=70?"#4ADE80":"#F87171",borderRadius:3 }} /></div></div>;
                                })}
                                <div style={{ marginTop:10,padding:"8px 10px",borderRadius:6,background:"#FBBF240A",border:"1px solid #FBBF2418",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                                  <span style={{ color:"#8B8F98",fontSize:11 }}>Weighted Avg</span>
                                  <span style={{ color:((parseFloat(emp.status_rate||0)/100)+(parseFloat(emp.eta_rate||0)/100)+(parseFloat(emp.tone_rate||0)/100)+(parseFloat(emp.next_steps_rate||0)/100))>=3?"#4ADE80":((parseFloat(emp.status_rate||0)/100)+(parseFloat(emp.eta_rate||0)/100)+(parseFloat(emp.tone_rate||0)/100)+(parseFloat(emp.next_steps_rate||0)/100))>=2?"#FBBF24":"#F87171",fontSize:14,fontWeight:800 }}>
                                    {((parseFloat(emp.status_rate||0)/100*1)+(parseFloat(emp.eta_rate||0)/100*1)+(parseFloat(emp.tone_rate||0)/100*1)+(parseFloat(emp.next_steps_rate||0)/100*1)).toFixed(2)+" / 4.00"}
                                  </span>
                                </div>
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
            <div style={{ background:"#1A1D23",borderRadius:8,padding:"12px 16px",marginBottom:16,border:"1px solid #7B2FFF33" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                <span style={{ color:"#C8CAD0",fontSize:13,fontWeight:600 }}>{"Batch: "+batchProgress.done+" / "+batchProgress.total}</span>
                <button onClick={function(){batchAbort.current=true;}} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #F8717144",background:"#F8717118",color:"#F87171",fontSize:11,cursor:"pointer" }}>Stop</button>
              </div>
              <div style={{ background:"#12141A",borderRadius:4,height:8,overflow:"hidden" }}><div style={{ width:(batchProgress.total>0?(batchProgress.done/batchProgress.total*100):0)+"%",height:"100%",background:"#7B2FFF",borderRadius:4 }} /></div>
            </div>
          )}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <SectionHeader title="Recorded Calls" subtitle={recordedCalls.length+" unaudited"} icon="🎙️" />
              {recordedCalls.length>0 && !batchRunning && (
                <button onClick={runBatch} style={{ padding:"8px 20px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:13,fontWeight:700 }}>{"Audit All ("+recordedCalls.length+")"}</button>
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
                    <button onClick={function(){if(!isA&&!batchRunning) runAudit(call);}} disabled={isA||batchRunning} style={{ padding:"6px 14px",borderRadius:6,border:"none",cursor:isA||batchRunning?"default":"pointer",background:isA?"#7B2FFF22":"#7B2FFF",color:isA?"#7B2FFF":"#FFF",fontSize:12,fontWeight:600,animation:isA?"pulse 1.5s infinite":"none" }}>{isA?"Scoring...":"Audit"}</button>
                  </div>
                );
              })}
              {recordedCalls.length===0 && <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>All calls audited!</div>}
            </div>
          </div>
        </div>
      )}

      {/* NEEDS REVIEW */}
      {auditView==="review" && (
        <div>
          <SectionHeader title="Needs Review" subtitle="Low-confidence audits that may be misclassified" icon="⚠️" />
          {actionMsg && (
            <div style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,background:actionMsg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(actionMsg.type==="success"?"#4ADE8033":"#F8717133"),color:actionMsg.type==="success"?"#4ADE80":"#F87171",fontSize:13 }}>
              {actionMsg.text}
            </div>
          )}
          {!reviewLoading && reviewAudits.length===0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:30,textAlign:"center" }}>
              <div style={{ color:"#6B6F78",fontSize:13,marginBottom:12 }}>No low-confidence audits loaded yet.</div>
              <button onClick={loadReviewAudits} style={{ padding:"8px 20px",borderRadius:6,border:"none",background:"#7B2FFF",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>Load Audits Needing Review</button>
            </div>
          )}
          {reviewLoading && <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading...</div>}
          {reviewAudits.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,maxHeight:700,overflowY:"auto" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
                <div style={{ color:"#8B8F98",fontSize:12 }}>{reviewAudits.length} audits with confidence &lt; 70</div>
                <button onClick={loadReviewAudits} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:11,cursor:"pointer" }}>Refresh</button>
              </div>
              {reviewAudits.map(function(audit, i) {
                var score = parseFloat(audit.score||0);
                var sc = score>=3?"#4ADE80":score>=2?"#FBBF24":"#F87171";
                var store = STORES[audit.store];
                var d = new Date(audit.date_started||audit.date);
                var conf = audit.confidence || 0;
                var confColor = conf >= 70 ? "#4ADE80" : conf >= 50 ? "#FBBF24" : "#F87171";
                var typeBg = audit.call_type==="opportunity"?"#7B2FFF":audit.call_type==="current_customer"?"#FBBF24":"#6B6F78";
                return (
                  <div key={audit.call_id||i} style={{ padding:16,borderBottom:"1px solid #2A2D35" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8 }}>
                      <div>
                        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
                          <span style={{ color:"#E8E9EC",fontSize:13,fontWeight:700 }}>{audit.employee||"Unknown"}</span>
                          <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:typeBg+"18",color:typeBg }}>{audit.call_type==="current_customer"?"Current":audit.call_type==="non_scorable"?"Non-Scorable":"Opportunity"}</span>
                          <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,background:confColor+"18",color:confColor }}>{"Conf: "+conf+"%"}</span>
                        </div>
                        <div style={{ color:"#6B6F78",fontSize:11 }}>
                          {d.toLocaleDateString()+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+" | "}
                          <span style={{ color:store?store.color:"#8B8F98" }}>{store?store.name:audit.store}</span>
                          {" | "+audit.phone}
                        </div>
                        {audit.confidence_reason && <div style={{ color:"#FBBF24",fontSize:11,marginTop:4,fontStyle:"italic" }}>{audit.confidence_reason}</div>}
                      </div>
                      <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:16,fontWeight:800 }}>{score.toFixed(2)}</div>
                    </div>
                    <div style={{ color:"#C8CAD0",fontSize:12,marginBottom:8 }}><strong>Inquiry:</strong> {audit.inquiry||"-"}</div>
                    {audit.transcript_preview && (
                      <div style={{ marginBottom:10 }}>
                        <button onClick={function(){setExpandedTranscript(expandedTranscript===audit.call_id?null:audit.call_id);}}
                          style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",gap:4 }}>
                          <span style={{ transform:expandedTranscript===audit.call_id?"rotate(90deg)":"rotate(0deg)",transition:"transform 0.2s",display:"inline-block" }}>▶</span>
                          {expandedTranscript===audit.call_id?"Hide Transcript":"View Transcript"}
                        </button>
                        {expandedTranscript===audit.call_id && (
                          <div style={{ marginTop:6,padding:12,background:"#12141A",borderRadius:8,border:"1px solid #2A2D35",maxHeight:300,overflowY:"auto",fontFamily:"monospace",fontSize:11,color:"#C8CAD0",whiteSpace:"pre-wrap",lineHeight:1.5 }}>
                            {audit.transcript_preview}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
                      <button onClick={function(){excludeCall(audit.call_id,"Low confidence — excluded by manager");}}
                        style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:11,cursor:"pointer",fontWeight:600 }}>
                        Exclude from Scoring
                      </button>
                      <button onClick={function(){overrideCall(audit.call_id,"non_scorable","Manager review: not a real customer call");}}
                        style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #6B6F7833",background:"transparent",color:"#6B6F78",fontSize:11,cursor:"pointer",fontWeight:600 }}>
                        Mark Non-Scorable
                      </button>
                      <button onClick={function(){overrideCall(audit.call_id,"opportunity","Manager review: reclassified as opportunity");}}
                        style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #7B2FFF33",background:"transparent",color:"#7B2FFF",fontSize:11,cursor:"pointer",fontWeight:600 }}>
                        → Opportunity
                      </button>
                      <button onClick={function(){overrideCall(audit.call_id,"current_customer","Manager review: reclassified as current customer");}}
                        style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #FBBF2433",background:"transparent",color:"#FBBF24",fontSize:11,cursor:"pointer",fontWeight:600 }}>
                        → Current Customer
                      </button>
                      <button onClick={function(){reauditCall(audit.call_id, { direction:audit.direction, external_number:audit.phone, date_started:audit.date_started, name:audit.store_name, _storeKey:audit.store, talk_duration:audit.talk_duration });}}
                        disabled={auditingId===audit.call_id}
                        style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #00D4FF33",background:"transparent",color:auditingId===audit.call_id?"#6B6F78":"#00D4FF",fontSize:11,cursor:auditingId===audit.call_id?"wait":"pointer",fontWeight:600 }}>
                        {auditingId===audit.call_id?"Re-auditing...":"Re-Audit"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* HISTORY */}
      {auditView==="history" && (
        <div>
          <SectionHeader title="Audit History" subtitle={filteredAudits.length+" calls"} icon="📋" />
          {actionMsg && (
            <div style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,background:actionMsg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(actionMsg.type==="success"?"#4ADE8033":"#F8717133"),color:actionMsg.type==="success"?"#4ADE80":"#F87171",fontSize:13 }}>
              {actionMsg.text}
            </div>
          )}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,maxHeight:600,overflowY:"auto" }}>
            {filteredAudits.map(function(audit, i) {
              var score = parseFloat(audit.score||0);
              var sc = score>=3?"#4ADE80":score>=2?"#FBBF24":"#F87171";
              var store = STORES[audit.store];
              var d = new Date(audit.date_started||audit.date);
              var typeBg = audit.call_type==="opportunity"?"#7B2FFF":audit.call_type==="current_customer"?"#FBBF24":"#6B6F78";
              var conf = audit.confidence || 0;
              var confColor = conf >= 70 ? "#4ADE80" : conf >= 50 ? "#FBBF24" : "#F87171";
              var isExcluded = audit.excluded;
              return (
                <div key={audit.call_id||i} style={{ padding:16,borderBottom:"1px solid #2A2D35",opacity:isExcluded?0.5:1 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
                        <span style={{ color:"#E8E9EC",fontSize:13,fontWeight:700 }}>{audit.employee||"Unknown"}{" - "+audit.phone}</span>
                        <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:typeBg+"18",color:typeBg }}>{audit.call_type==="current_customer"?"Current Customer":audit.call_type==="non_scorable"?"Non-Scorable":"Opportunity"}</span>
                        {conf > 0 && <span style={{ padding:"2px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:confColor+"18",color:confColor }}>{conf+"%"}</span>}
                        {isExcluded && <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:"#F8717118",color:"#F87171" }}>EXCLUDED</span>}
                        {audit.manager_override && <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,background:"#00D4FF18",color:"#00D4FF" }}>OVERRIDE</span>}
                      </div>
                      <div style={{ color:"#6B6F78",fontSize:11 }}>
                        {d.toLocaleDateString()+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+" | "}
                        <span style={{ color:store?store.color:"#8B8F98" }}>{store?store.name:audit.store}</span>
                        {audit.customer_name&&audit.customer_name!=="Unknown"?" | Customer: "+audit.customer_name:""}
                        {audit.device_type&&audit.device_type!=="Not mentioned"?" | "+audit.device_type:""}
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      {!isExcluded && audit.call_type !== "non_scorable" && (
                        <button onClick={function(e){e.stopPropagation(); excludeCall(audit.call_id, "Manually excluded");}}
                          style={{ padding:"3px 8px",borderRadius:4,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:9,cursor:"pointer" }}>Exclude</button>
                      )}
                      <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:16,fontWeight:800 }}>{score.toFixed(2)+" / 4"}</div>
                    </div>
                  </div>
                  <div style={{ color:"#C8CAD0",fontSize:12,marginBottom:8 }}><strong>Inquiry:</strong> {audit.inquiry||"-"}<br /><strong>Outcome:</strong> {audit.outcome||"-"}</div>
                  <CriteriaGrid audit={audit} />
                  {audit.transcript_preview && (
                    <div style={{ marginTop:8 }}>
                      <button onClick={function(){setExpandedTranscript(expandedTranscript===audit.call_id?null:audit.call_id);}}
                        style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",gap:4 }}>
                        <span style={{ transform:expandedTranscript===audit.call_id?"rotate(90deg)":"rotate(0deg)",transition:"transform 0.2s",display:"inline-block" }}>▶</span>
                        {expandedTranscript===audit.call_id?"Hide Transcript":"View Transcript"}
                      </button>
                      {expandedTranscript===audit.call_id && (
                        <div style={{ marginTop:6,padding:12,background:"#12141A",borderRadius:8,border:"1px solid #2A2D35",maxHeight:300,overflowY:"auto",fontFamily:"monospace",fontSize:11,color:"#C8CAD0",whiteSpace:"pre-wrap",lineHeight:1.5 }}>
                          {audit.transcript_preview}
                        </div>
                      )}
                    </div>
                  )}
                  {audit.exclude_reason && <div style={{ color:"#F87171",fontSize:10,marginTop:6,fontStyle:"italic" }}>Excluded: {audit.exclude_reason}</div>}
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
  var auth = useAuth();
  var [activeTab, setActiveTab] = useState("scorecard");
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

  // Preview mode — admin can simulate other roles
  var [previewRole, setPreviewRole] = useState(null); // null = no preview, "manager", "employee"
  var [previewEmployee, setPreviewEmployee] = useState(""); // employee name for employee preview
  var [previewStore, setPreviewStore] = useState(""); // store for employee preview
  var [rosterList, setRosterList] = useState([]);
  var [aiOpen, setAiOpen] = useState(false);

  // Effective role = preview role if set, otherwise actual role
  var effectiveRole = previewRole || (auth ? auth.role : "employee");
  var isAdmin = auth && auth.role === "admin";
  var isPreviewing = previewRole !== null;

  // Load roster for employee preview picker
  useEffect(function() {
    if (isAdmin) {
      fetch("/api/dialpad/roster").then(function(r){return r.json();}).then(function(json) {
        if (json.success) setRosterList(json.roster || []);
      }).catch(function(){});
    }
  }, [isAdmin]);

  // Tab visibility by role
  var ADMIN_TABS = TABS.map(function(t){return t.id;});
  var MANAGER_TABS = TABS.map(function(t){return t.id;});
  var EMPLOYEE_TABS = ["scorecard", "schedule", "compliance", "sales"];

  var visibleTabIds = effectiveRole === "employee" ? EMPLOYEE_TABS : effectiveRole === "manager" ? MANAGER_TABS : ADMIN_TABS;
  var visibleTabs = TABS.filter(function(t) { return visibleTabIds.indexOf(t.id) >= 0; });

  // Reset to first visible tab if current tab is hidden
  useEffect(function() {
    if (visibleTabIds.indexOf(activeTab) < 0 && visibleTabs.length > 0) {
      setActiveTab(visibleTabs[0].id);
    }
  }, [effectiveRole]);

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
          <svg width="38" height="38" viewBox="46 56 148 148" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="hg1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#00D4FF"/><stop offset="100%" stopColor="#7B2FFF"/></linearGradient>
              <linearGradient id="hg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#7B2FFF"/><stop offset="100%" stopColor="#FF2D95"/></linearGradient>
              <linearGradient id="hg3" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#00D4FF"/><stop offset="50%" stopColor="#7B2FFF"/><stop offset="100%" stopColor="#FF2D95"/></linearGradient>
            </defs>
            <circle cx="120" cy="130" r="62" fill="none" stroke="url(#hg1)" strokeWidth="2.5" opacity="0.7"/>
            <circle cx="120" cy="130" r="44" fill="none" stroke="url(#hg3)" strokeWidth="2" opacity="0.85"/>
            <circle cx="120" cy="130" r="26" fill="none" stroke="url(#hg2)" strokeWidth="2" opacity="0.95"/>
            <circle cx="120" cy="130" r="7" fill="url(#hg3)"/><circle cx="120" cy="130" r="3.5" fill="#FFF" opacity="0.95"/>
            <line x1="120" y1="56" x2="120" y2="90" stroke="url(#hg1)" strokeWidth="1.8" strokeLinecap="round" opacity="0.8"/>
            <line x1="120" y1="170" x2="120" y2="204" stroke="url(#hg2)" strokeWidth="1.8" strokeLinecap="round" opacity="0.8"/>
            <line x1="46" y1="130" x2="80" y2="130" stroke="url(#hg1)" strokeWidth="1.8" strokeLinecap="round" opacity="0.8"/>
            <line x1="160" y1="130" x2="194" y2="130" stroke="url(#hg2)" strokeWidth="1.8" strokeLinecap="round" opacity="0.8"/>
          </svg>
          <div><h1 style={{ margin:0,fontSize:19,fontWeight:800 }}>{APP_NAME || "Focused Technologies"}</h1><p style={{ margin:0,color:"#6B6F78",fontSize:12 }}>{APP_SUBTITLE || "CPR Store Operations Dashboard"}</p></div>
        </div>
        <StoreToggle selected={storeFilter} onChange={setStoreFilter} />
        {auth && (
          <div style={{ display:"flex",alignItems:"center",gap:10,marginLeft:12 }}>
            <div style={{ textAlign:"right" }}>
              <div style={{ color:"#F0F1F3",fontSize:11,fontWeight:600 }}>{auth.userInfo ? auth.userInfo.name || auth.user.email : ""}</div>
              <div style={{ color:"#6B6F78",fontSize:9,textTransform:"capitalize" }}>{auth.role || ""}</div>
            </div>
            <button onClick={auth.signOut}
              style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:10,cursor:"pointer",whiteSpace:"nowrap" }}>
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Preview banner — admin only */}
      {isAdmin && (
        <div style={{ background:isPreviewing?"#FF2D9515":"#12141A",borderBottom:"1px solid "+(isPreviewing?"#FF2D9533":"#1E2028"),padding:"8px 28px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap" }}>
          <span style={{ color:"#8B8F98",fontSize:11,fontWeight:600 }}>View as:</span>
          {[
            { id: null, label: "Admin (You)" },
            { id: "manager", label: "Manager" },
            { id: "employee", label: "Employee" },
          ].map(function(p) {
            var isActive = previewRole === p.id;
            return <button key={p.id || "admin"} onClick={function(){
              setPreviewRole(p.id);
              if (!p.id) { setPreviewEmployee(""); setPreviewStore(""); }
            }} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid "+(isActive?"#FF2D9555":"#2A2D35"),background:isActive?"#FF2D9518":"transparent",color:isActive?"#FF2D95":"#8B8F98",fontSize:10,fontWeight:600,cursor:"pointer" }}>{p.label}</button>;
          })}
          {previewRole === "employee" && (
            <select value={previewEmployee} onChange={function(e){
              setPreviewEmployee(e.target.value);
              var emp = rosterList.find(function(r){return r.name === e.target.value;});
              if (emp) setPreviewStore(emp.store);
            }} style={{ padding:"4px 8px",borderRadius:6,border:"1px solid #2A2D35",background:"#1A1D23",color:"#F0F1F3",fontSize:10 }}>
              <option value="">Select employee...</option>
              {rosterList.filter(function(r){return r.active;}).map(function(r) {
                return <option key={r.name} value={r.name}>{r.name + " (" + (r.store || "all") + ")"}</option>;
              })}
            </select>
          )}
          {isPreviewing && (
            <span style={{ color:"#FF2D95",fontSize:10,fontStyle:"italic" }}>
              {previewRole === "employee" && previewEmployee ? "Viewing as: " + previewEmployee : "Previewing " + previewRole + " view"}
            </span>
          )}
        </div>
      )}

      <div style={{ background:"#12141A",borderBottom:"1px solid #1E2028",padding:"0 28px",display:"flex",gap:0,overflowX:"auto" }}>
        {visibleTabs.map(function(tab) {
          return <button key={tab.id} onClick={function(){setActiveTab(tab.id);}} style={{ padding:"14px 20px",border:"none",cursor:"pointer",background:"transparent",color:activeTab===tab.id?"#F0F1F3":"#6B6F78",fontSize:13,fontWeight:600,borderBottom:activeTab===tab.id?"2px solid #7B2FFF":"2px solid transparent",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",fontFamily:"'Space Grotesk',sans-serif" }}><span style={{ fontSize:14 }}>{tab.icon}</span>{tab.label}</button>;
        })}
        <a href="/appointments" style={{ padding:"14px 20px",border:"none",cursor:"pointer",background:"transparent",color:"#4ADE80",fontSize:13,fontWeight:700,borderBottom:"2px solid transparent",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",fontFamily:"'Space Grotesk',sans-serif",textDecoration:"none",marginLeft:"auto" }}><span style={{ fontSize:14 }}>{"\uD83D\uDCC5"}</span>Appointments & Reviews</a>
        {isAdmin && !isPreviewing && (<>
          <button onClick={function(){setActiveTab("profitability");}} style={{ padding:"14px 20px",border:"none",cursor:"pointer",background:"transparent",color:activeTab==="profitability"?"#4ADE80":"#6B6F78",fontSize:13,fontWeight:600,borderBottom:activeTab==="profitability"?"2px solid #4ADE80":"2px solid transparent",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",fontFamily:"'Space Grotesk',sans-serif" }}><span style={{ fontSize:14 }}>{"\uD83D\uDCB0"}</span>Profitability</button>
          <button onClick={function(){setActiveTab("admin");}} style={{ padding:"14px 20px",border:"none",cursor:"pointer",background:"transparent",color:activeTab==="admin"?"#FF2D95":"#6B6F78",fontSize:13,fontWeight:600,borderBottom:activeTab==="admin"?"2px solid #FF2D95":"2px solid transparent",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",fontFamily:"'Space Grotesk',sans-serif" }}><span style={{ fontSize:14 }}>{"\u2699\uFE0F"}</span>Admin</button>
        </>)}
      </div>
      <div style={{ padding:28 }}>
        <DataBanner isLive={isLive} isLoading={isLoading} isStored={isStored} lastSync={lastSync} onRefresh={loadStoredData} onLiveRefresh={loadLiveData} />
        {activeTab==="scorecard" && <ScorecardTab storeFilter={storeFilter} viewAs={effectiveRole} viewEmployee={previewEmployee} />}
        {activeTab==="overview" && <OverviewTab storeFilter={storeFilter} overviewStats={overviewStats} dailyCalls={dailyCalls} />}
        {activeTab==="keywords" && <KeywordsTab keywords={keywords} />}
        {activeTab==="missed" && <MissedTab storeFilter={storeFilter} overviewStats={overviewStats} hourlyMissed={hourlyMissed} dowData={dowData} />}
        {activeTab==="callbacks" && <CallbacksTab callbackData={callbackData} />}
        {activeTab==="problems" && <ProblemsTab overviewStats={overviewStats} problemCalls={problemCalls} />}
        {activeTab==="audit" && <AuditTab rawCallData={rawCallData} storeFilter={storeFilter} />}
        {activeTab==="sales" && <SalesTab viewAs={effectiveRole} viewEmployee={previewEmployee} />}
        {activeTab==="compliance" && <ComplianceTab storeFilter={storeFilter} viewAs={effectiveRole} viewEmployee={previewEmployee} />}
        {activeTab==="insights" && <InsightsTab storeFilter={storeFilter} />}
        {activeTab==="employees" && <EmployeeTab storeFilter={storeFilter} />}
        {activeTab==="voicemails" && <VoicemailTab storeFilter={storeFilter} />}
        {activeTab==="schedule" && <ScheduleTab storeFilter={storeFilter} />}
        {activeTab==="profitability" && <ProfitabilityTab />}
        {activeTab==="admin" && <AdminTab onPreview={function(role, name, store){
          setPreviewRole(role === "admin" ? null : role);
          setPreviewEmployee(role === "employee" ? name : "");
          setPreviewStore(store || "");
          setActiveTab("scorecard");
        }} />}
      </div>
      <div style={{ padding:"16px 28px",borderTop:"1px solid #1E2028",color:"#4A4D55",fontSize:11,textAlign:"center" }}>
        {isStored ? "Stored data" : isLive ? "Live data" : "Sample data"} | {APP_NAME || "Focused Technologies"}
      </div>

      {/* AI Assistant floating button */}
      {!aiOpen && (
        <button onClick={function(){setAiOpen(true);}}
          style={{ position:"fixed",bottom:24,right:24,width:56,height:56,borderRadius:16,border:"none",background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:24,cursor:"pointer",boxShadow:"0 4px 20px rgba(123,47,255,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999,transition:"transform 0.2s" }}
          onMouseEnter={function(e){e.target.style.transform="scale(1.1)";}}
          onMouseLeave={function(e){e.target.style.transform="scale(1)";}}>
          {"\u2728"}
        </button>
      )}

      {/* AI Assistant panel */}
      <AIAssistant isOpen={aiOpen} onClose={function(){setAiOpen(false);}} />
    </div>
  );
}

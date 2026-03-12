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
const StatCard = ({ label, value, sub, accent }) => (<div style={{ background:"#1A1D23",borderRadius:12,padding:"18px 20px",borderLeft:`3px solid ${accent}`,minWidth:0 }}><div style={{ color:"#8B8F98",fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:"'JetBrains Mono',monospace" }}>{label}</div><div style={{ color:"#F0F1F3",fontSize:28,fontWeight:700,marginTop:4 }}>{value}</div>{sub&&<div style={{ color:"#6B6F78",fontSize:12,marginTop:2 }}>{sub}</div>}</div>);
const SectionHeader = ({ title, subtitle, icon }) => (<div style={{ marginBottom:16,display:"flex",alignItems:"center",gap:10 }}><span style={{ fontSize:20 }}>{icon}</span><div><h2 style={{ color:"#F0F1F3",fontSize:17,fontWeight:700,margin:0 }}>{title}</h2>{subtitle&&<p style={{ color:"#6B6F78",fontSize:12,margin:"2px 0 0" }}>{subtitle}</p>}</div></div>);
const CustomTooltip = ({ active, payload, label }) => { if (!active||!payload?.length) return null; return (<div style={{ background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8,padding:"10px 14px" }}><div style={{ color:"#8B8F98",fontSize:11,marginBottom:6 }}>{label}</div>{payload.map((p,i)=>(<div key={i} style={{ display:"flex",alignItems:"center",gap:8,marginTop:3 }}><span style={{ width:8,height:8,borderRadius:"50%",background:p.color }}/><span style={{ color:"#C8CAD0",fontSize:12 }}>{p.name}: <strong style={{ color:"#F0F1F3" }}>{p.value}</strong></span></div>))}</div>); };

const StoreToggle = ({ selected, onChange }) => (<div style={{ display:"flex",gap:6,background:"#12141A",borderRadius:10,padding:4,flexWrap:"wrap" }}><button onClick={()=>onChange("all")} style={{ padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",background:selected==="all"?"#2A2D35":"transparent",color:selected==="all"?"#F0F1F3":"#6B6F78",fontSize:13,fontWeight:600,fontFamily:"'Space Grotesk',sans-serif" }}>All Stores</button>{Object.entries(STORES).map(([key,s])=>(<button key={key} onClick={()=>onChange(key)} style={{ padding:"7px 16px",borderRadius:8,border:"none",cursor:"pointer",background:selected===key?s.color+"22":"transparent",color:selected===key?s.color:"#6B6F78",fontSize:13,fontWeight:600,fontFamily:"'Space Grotesk',sans-serif",display:"flex",alignItems:"center",gap:6 }}><span style={{ width:8,height:8,borderRadius:"50%",background:s.color,display:"inline-block" }}/>{s.name.replace("CPR ","")}</button>))}</div>);

const DataBanner = ({ isLive, isLoading, isStored, lastSync, onRefresh, onLiveRefresh }) => (<div style={{ margin:"0 0 20px",padding:"10px 16px",borderRadius:8,background:isStored?"#7C8AFF12":isLive?"#4ADE8012":"#FBBF2412",border:`1px solid ${isStored?"#7C8AFF33":isLive?"#4ADE8033":"#FBBF2433"}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8 }}><div style={{ display:"flex",alignItems:"center",gap:8 }}><span style={{ width:8,height:8,borderRadius:"50%",background:isStored?"#7C8AFF":isLive?"#4ADE80":"#FBBF24",animation:isLoading?"pulse 1.5s infinite":"none" }}/><span style={{ color:"#C8CAD0",fontSize:12 }}>{isLoading?"Fetching live data...":isStored?`Stored data · Synced ${lastSync?new Date(lastSync).toLocaleString():"unknown"}`:isLive?"Live data from Dialpad API":"Sample data"}</span></div><div style={{ display:"flex",gap:6 }}>{!isLoading&&(<><button onClick={onRefresh} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:11,cursor:"pointer" }}>↻ Reload</button><button onClick={onLiveRefresh} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #7C8AFF44",background:"#7C8AFF18",color:"#7C8AFF",fontSize:11,cursor:"pointer" }}>⚡ Live Refresh</button></>)}</div></div>);

// ── AI Summary Component ──
function AISummary({ type, dashboardData }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/dialpad/summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, dashboardData }),
      });
      const json = await res.json();
      if (json.success) setSummary(json.summary);
      else setError(json.error);
    } catch (err) { setError(err.message); }
    setLoading(false);
  };

  return (
    <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #C084FC33" }}>
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:summary?16:0 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <span style={{ fontSize:20 }}>🤖</span>
          <div><div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>AI {type === "audit" ? "Coaching Report" : "Executive Summary"}</div>
          <div style={{ color:"#6B6F78",fontSize:11 }}>Powered by Claude · Analyzes your live data</div></div>
        </div>
        <button onClick={generate} disabled={loading} style={{
          padding:"8px 18px",borderRadius:8,border:"none",cursor:loading?"default":"pointer",
          background:loading?"#C084FC22":"linear-gradient(135deg,#7C8AFF,#C084FC)",
          color:loading?"#C084FC":"#FFF",fontSize:12,fontWeight:700,
          animation:loading?"pulse 1.5s infinite":"none",
        }}>{loading?"Generating...":summary?"↻ Refresh":"Generate Insights"}</button>
      </div>
      {error && <div style={{ padding:"8px 12px",borderRadius:6,background:"#F8717122",color:"#F87171",fontSize:12,marginTop:12 }}>{error}</div>}
      {summary && (
        <div style={{ color:"#C8CAD0",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap" }}>
          {summary.split("\n\n").map((para,i) => (
            <p key={i} style={{ margin:"0 0 12px" }}>{para}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── OVERVIEW TAB ──
function OverviewTab({ storeFilter, overviewStats, dailyCalls }) {
  return (
    <div>
      <AISummary type="overview" dashboardData={{ overviewStats }} />
      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28 }}>
        <StatCard label="Total Calls (30d)" value={overviewStats.totals.total.toLocaleString()} accent="#7C8AFF"/>
        <StatCard label="Answer Rate" value={`${((overviewStats.totals.answered/overviewStats.totals.total)*100||0).toFixed(1)}%`} accent="#4ADE80" sub={`${overviewStats.totals.answered.toLocaleString()} answered`}/>
        <StatCard label="Missed Calls" value={overviewStats.totals.missed.toLocaleString()} accent="#F87171"/>
        <StatCard label="Avg Calls / Day" value={Math.round(overviewStats.totals.total/30)} accent="#C084FC" sub="across all stores"/>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:`repeat(${STORE_KEYS.length},1fr)`,gap:14,marginBottom:28 }}>
        {Object.entries(STORES).map(([key,store])=>{const s=overviewStats.storeStats[key];const rate=((s.answered/s.total)*100||0).toFixed(1);return(<div key={key} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:`1px solid ${store.color}33` }}><div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:14 }}><div style={{ width:36,height:36,borderRadius:10,background:store.color+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store.color,fontWeight:800,fontSize:16 }}>{store.icon}</div><div><div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{store.name}</div><div style={{ color:"#6B6F78",fontSize:11 }}>{s.total} total calls</div></div></div><div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10 }}><div><div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Answered</div><div style={{ color:"#4ADE80",fontSize:20,fontWeight:700 }}>{s.answered}</div></div><div><div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Missed</div><div style={{ color:"#F87171",fontSize:20,fontWeight:700 }}>{s.missed}</div></div><div><div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Rate</div><div style={{ color:store.color,fontSize:20,fontWeight:700 }}>{rate}%</div></div></div><div style={{ marginTop:12,background:"#12141A",borderRadius:6,height:8,overflow:"hidden" }}><div style={{ width:`${rate}%`,height:"100%",background:store.color,borderRadius:6 }}/></div></div>);})}
      </div>
      <SectionHeader title="Daily Call Volume" subtitle="Last 30 days — total vs answered" icon="📊"/>
      <div style={{ background:"#1A1D23",borderRadius:12,padding:20,height:300 }}>
        <ResponsiveContainer width="100%" height="100%"><AreaChart data={dailyCalls}><CartesianGrid strokeDasharray="3 3" stroke="#2A2D35"/><XAxis dataKey="date" tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} interval={4}/><YAxis tick={{ fill:"#6B6F78",fontSize:10 }} tickLine={false} axisLine={false}/><Tooltip content={<CustomTooltip/>}/>{STORE_KEYS.map(k=>(storeFilter==="all"||storeFilter===k)?<Area key={k} type="monotone" dataKey={`${k}_total`} name={`${STORES[k].name} Total`} stroke={STORES[k].color} fill={STORES[k].color+"18"} strokeWidth={2} dot={false}/>:null)}{STORE_KEYS.map(k=>(storeFilter==="all"||storeFilter===k)?<Area key={`${k}_a`} type="monotone" dataKey={`${k}_answered`} name={`${STORES[k].name} Answered`} stroke={STORES[k].color} fill={STORES[k].color+"08"} strokeWidth={1} strokeDasharray="4 4" dot={false}/>:null)}</AreaChart></ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Unchanged tabs (Keywords, Missed, Callbacks, Problems) ──
function KeywordsTab({ keywords }) { const [cat,setCat]=useState("All"); const categories=["All",...new Set(keywords.map(k=>k.category))]; const filtered=useMemo(()=>{let kw=keywords;if(cat!=="All")kw=kw.filter(k=>k.category===cat);return[...kw].sort((a,b)=>STORE_KEYS.reduce((s,k)=>s+(b[k]||0),0)-STORE_KEYS.reduce((s,k)=>s+(a[k]||0),0));},[cat,keywords]); const cc={Service:"#7C8AFF",Sales:"#4ADE80",Support:"#FBBF24",Operations:"#C084FC",Problem:"#F87171"}; return(<div><div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>{categories.map(c=><button key={c} onClick={()=>setCat(c)} style={{padding:"6px 14px",borderRadius:8,border:"none",cursor:"pointer",background:cat===c?"#7C8AFF22":"#1A1D23",color:cat===c?"#7C8AFF":"#8B8F98",fontSize:12,fontWeight:600}}>{c}</button>)}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}><div style={{background:"#1A1D23",borderRadius:12,padding:20}}><SectionHeader title="Keyword Frequency" subtitle="Mentions via Dialpad AI" icon="🏷️"/><div style={{maxHeight:420,overflowY:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr style={{borderBottom:"1px solid #2A2D35"}}><th style={{textAlign:"left",padding:"8px 10px",color:"#6B6F78",fontSize:10}}>Keyword</th><th style={{textAlign:"left",padding:"8px 6px",color:"#6B6F78",fontSize:10}}>Cat</th>{STORE_KEYS.map(k=><th key={k} style={{textAlign:"right",padding:"8px 6px",color:STORES[k].color,fontSize:10}}>{STORES[k].icon}</th>)}<th style={{textAlign:"right",padding:"8px 10px",color:"#8B8F98",fontSize:10}}>Total</th></tr></thead><tbody>{filtered.map((k,i)=>{const total=STORE_KEYS.reduce((s,sk)=>s+(k[sk]||0),0);return(<tr key={i} style={{borderBottom:"1px solid #1E2028"}}><td style={{padding:"10px 10px",color:"#E8E9EC",fontSize:13,fontWeight:600}}>{k.keyword}</td><td style={{padding:"10px 6px"}}><span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:(cc[k.category]||"#8B8F98")+"18",color:cc[k.category]||"#8B8F98",fontWeight:600}}>{k.category}</span></td>{STORE_KEYS.map(sk=><td key={sk} style={{textAlign:"right",padding:"10px 6px",color:"#C8CAD0",fontSize:13}}>{k[sk]||0}</td>)}<td style={{textAlign:"right",padding:"10px 10px",color:"#F0F1F3",fontSize:13,fontWeight:700}}>{total}</td></tr>);})}</tbody></table></div></div><div><div style={{background:"#1A1D23",borderRadius:12,padding:20}}><SectionHeader title="Top Keywords by Store" icon="📊"/><div style={{height:320}}><ResponsiveContainer width="100%" height="100%"><BarChart data={filtered.slice(0,8)} layout="vertical" barGap={2}><CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false}/><XAxis type="number" tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false}/><YAxis type="category" dataKey="keyword" tick={{fill:"#8B8F98",fontSize:10}} width={110} tickLine={false} axisLine={false}/><Tooltip content={<CustomTooltip/>}/>{STORE_KEYS.map(k=><Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[0,4,4,0]} barSize={8}/>)}</BarChart></ResponsiveContainer></div></div></div></div></div>); }

function MissedTab({ storeFilter, overviewStats, hourlyMissed, dowData }) { return(<div><div style={{display:"grid",gridTemplateColumns:`repeat(${STORE_KEYS.length},1fr)`,gap:14,marginBottom:28}}>{Object.entries(STORES).map(([key,store])=>{const s=overviewStats.storeStats[key];return<StatCard key={key} label={`${store.name} Missed`} value={s.missed} accent={store.color} sub={s.total?`${((s.missed/s.total)*100).toFixed(1)}% miss rate`:""}/>;})}</div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}><div style={{background:"#1A1D23",borderRadius:12,padding:20}}><SectionHeader title="Missed Calls by Hour" icon="🕐"/><div style={{height:280}}><ResponsiveContainer width="100%" height="100%"><BarChart data={hourlyMissed} barGap={1}><CartesianGrid strokeDasharray="3 3" stroke="#2A2D35"/><XAxis dataKey="hour" tick={{fill:"#6B6F78",fontSize:10}} tickLine={false}/><YAxis tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false}/><Tooltip content={<CustomTooltip/>}/>{STORE_KEYS.map(k=>(storeFilter==="all"||storeFilter===k)?<Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[4,4,0,0]} barSize={14}/>:null)}</BarChart></ResponsiveContainer></div></div><div style={{background:"#1A1D23",borderRadius:12,padding:20}}><SectionHeader title="Missed Calls by Day of Week" icon="📅"/><div style={{height:280}}><ResponsiveContainer width="100%" height="100%"><RadarChart data={dowData} cx="50%" cy="50%" outerRadius={100}><PolarGrid stroke="#2A2D35"/><PolarAngleAxis dataKey="day" tick={{fill:"#8B8F98",fontSize:11}}/><PolarRadiusAxis tick={{fill:"#6B6F78",fontSize:9}} axisLine={false}/>{STORE_KEYS.map(k=>(storeFilter==="all"||storeFilter===k)?<Radar key={k} name={STORES[k].name.replace("CPR ","")} dataKey={k} stroke={STORES[k].color} fill={STORES[k].color} fillOpacity={0.15} strokeWidth={2}/>:null)}<Legend iconType="circle" iconSize={8} wrapperStyle={{fontSize:11,color:"#8B8F98"}}/><Tooltip content={<CustomTooltip/>}/></RadarChart></ResponsiveContainer></div></div></div></div>); }

function CallbacksTab({ callbackData }) { return(<div><div style={{display:"grid",gridTemplateColumns:`repeat(${STORE_KEYS.length},1fr)`,gap:14,marginBottom:28}}>{callbackData.map(cb=>{const store=STORES[cb.store];if(!store)return null;const rate=cb.missed>0?((cb.calledBack/cb.missed)*100).toFixed(1):"0.0";return(<div key={cb.store} style={{background:"#1A1D23",borderRadius:12,padding:20,border:`1px solid ${store.color}33`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{color:"#F0F1F3",fontSize:15,fontWeight:700}}>{store.name}</div><div style={{padding:"4px 10px",borderRadius:6,background:parseFloat(rate)>=80?"#4ADE8022":"#F8717122",color:parseFloat(rate)>=80?"#4ADE80":"#F87171",fontSize:14,fontWeight:700}}>{rate}%</div></div>{[{l:"Within 30 min",v:cb.within30,c:"#4ADE80"},{l:"30-60 min",v:cb.within60,c:"#FBBF24"},{l:"60+ min",v:cb.later,c:"#FB923C"},{l:"Never called back",v:cb.never,c:"#F87171"}].map((item,i)=>(<div key={i} style={{marginTop:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{color:"#8B8F98",fontSize:11}}>{item.l}</span><span style={{color:item.c,fontSize:12,fontWeight:700}}>{item.v}</span></div><div style={{background:"#12141A",borderRadius:4,height:6,overflow:"hidden"}}><div style={{width:cb.missed>0?`${(item.v/cb.missed)*100}%`:"0%",height:"100%",background:item.c,borderRadius:4}}/></div></div>))}</div>);})}</div></div>); }

function ProblemsTab({ overviewStats, problemCalls }) { const tp=problemCalls.reduce((s,p)=>s+STORE_KEYS.reduce((ss,k)=>ss+(p[k]||0),0),0); return(<div><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28}}><StatCard label="Total Problem Calls" value={tp} accent="#F87171" sub="last 7 days"/><StatCard label="% of All Calls" value={overviewStats.totals.total>0?`${((tp/overviewStats.totals.total)*100).toFixed(1)}%`:"0%"} accent="#FB923C"/><StatCard label="Top Issue" value={problemCalls[0]?.type?.split(" (")[0]||"N/A"} accent="#C084FC"/></div><div style={{background:"#1A1D23",borderRadius:12,padding:20}}><SectionHeader title="Problem Call Types" icon="🔥"/><div style={{height:300}}><ResponsiveContainer width="100%" height="100%"><BarChart data={problemCalls} layout="vertical" barGap={2}><CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false}/><XAxis type="number" tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false}/><YAxis type="category" dataKey="type" tick={{fill:"#8B8F98",fontSize:10}} width={140} tickLine={false} axisLine={false}/><Tooltip content={<CustomTooltip/>}/>{STORE_KEYS.map(k=><Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[0,4,4,0]} barSize={10}/>)}</BarChart></ResponsiveContainer></div></div></div>); }

// ═══════════════════════════════════════════
// AUDIT TAB — Dual call types + AI insights
// ═══════════════════════════════════════════
function AuditTab({ rawCallData, storeFilter }) {
  const [audits, setAudits] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [storePerf, setStorePerf] = useState([]);
  const [auditingId, setAuditingId] = useState(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done:0, total:0 });
  const batchAbort = useRef(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auditView, setAuditView] = useState("overview");
  const [callTypeFilter, setCallTypeFilter] = useState("all");
  const [expandedEmp, setExpandedEmp] = useState(null);
  const [repeatCallers, setRepeatCallers] = useState(null);
  const [repeatLoading, setRepeatLoading] = useState(false);
  const [roster, setRoster] = useState([]);
  const [unmatched, setUnmatched] = useState([]);
  const [rosterForm, setRosterForm] = useState({ name:"", store:"fishers", aliases:"", role:"Technician" });

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const sp = storeFilter !== "all" ? `&store=${storeFilter}` : "";
        const [aR, sR, rR] = await Promise.all([
          fetch(`/api/dialpad/audit?limit=200&days=30${sp}`).then(r=>r.json()),
          fetch(`/api/dialpad/audit?action=stores`).then(r=>r.json()),
          fetch(`/api/dialpad/roster?action=list`).then(r=>r.json()).catch(()=>({success:false})),
        ]);
        if (aR.success) setAudits(aR.audits || []);
        if (sR.success) setStorePerf(sR.stores || []);
        if (rR.success) setRoster(rR.employees || []);

        // Try consolidated (roster-aware) employee data first, fall back to raw
        const cR = await fetch(`/api/dialpad/roster?action=consolidated${sp}`).then(r=>r.json()).catch(()=>({success:false}));
        if (cR.success && cR.employees?.length > 0) {
          setEmployees(cR.employees);
        } else {
          const eR = await fetch(`/api/dialpad/audit?action=employees${sp}`).then(r=>r.json());
          if (eR.success) setEmployees(eR.employees || []);
        }

        // Load unmatched names
        const uR = await fetch("/api/dialpad/roster?action=unmatched").then(r=>r.json()).catch(()=>({success:false}));
        if (uR.success) setUnmatched(uR.unmatched || []);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, [storeFilter]);

  const filteredAudits = useMemo(() => callTypeFilter === "all" ? audits : audits.filter(a => a.call_type === callTypeFilter), [audits, callTypeFilter]);

  const recordedCalls = useMemo(() => {
    const ids = new Set(audits.map(a => a.call_id));
    return rawCallData.filter(r => r.target_type==="department"&&r.was_recorded==="true"&&r.direction==="inbound")
      .filter(r => storeFilter==="all"||r._storeKey===storeFilter).filter(r => !ids.has(r.call_id))
      .sort((a,b) => new Date(b.date_started)-new Date(a.date_started)).slice(0, 50);
  }, [rawCallData, storeFilter, audits]);

  const runAudit = async (call) => {
    setAuditingId(call.call_id); setError(null);
    try {
      const res = await fetch("/api/dialpad/audit", { method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ callId:call.call_id, callInfo:{direction:call.direction,external_number:call.external_number,date_started:call.date_started,name:call.name,_storeKey:call._storeKey,talk_duration:call.talk_duration} }) });
      const json = await res.json();
      if (json.success && json.audit) {
            const a = json.audit;
            const c = a.criteria || {};
            // Flatten criteria into Supabase-style flat fields so the display works immediately
            const flat = {
              ...a,
              call_id: call.call_id,
              date_started: call.date_started,
              store: a.store,
              phone: call.external_number,
              // Opportunity criteria
              appt_offered: c.appointment_offered?.pass || false,
              appt_notes: c.appointment_offered?.notes || "",
              discount_mentioned: c.discount_mentioned?.pass || false,
              discount_notes: c.discount_mentioned?.notes || "",
              warranty_mentioned: c.warranty_mentioned?.pass || false,
              warranty_notes: c.warranty_mentioned?.notes || "",
              faster_turnaround: c.faster_turnaround?.pass || false,
              turnaround_notes: c.faster_turnaround?.notes || "",
              // Current customer criteria
              status_update_given: c.status_update_given?.pass || false,
              status_notes: c.status_update_given?.notes || "",
              eta_communicated: c.eta_communicated?.pass || false,
              eta_notes: c.eta_communicated?.notes || "",
              professional_tone: c.professional_tone?.pass || false,
              tone_notes: c.professional_tone?.notes || "",
              next_steps_explained: c.next_steps_explained?.pass || false,
              next_steps_notes: c.next_steps_explained?.notes || "",
            };
            setAudits(prev => [flat, ...prev]);
            return true;
          }
      else { if(!json.alreadyAudited) setError(json.error||"Audit failed"); return false; }
    } catch(e) { setError(e.message); return false; } finally { setAuditingId(null); }
  };

  const runBatch = async () => {
    setBatchRunning(true); batchAbort.current=false; const list=[...recordedCalls]; setBatchProgress({done:0,total:list.length});
    for(let i=0;i<list.length;i++) { if(batchAbort.current)break; setAuditingId(list[i].call_id); await runAudit(list[i]); setBatchProgress({done:i+1,total:list.length}); if(i<list.length-1) await new Promise(r=>setTimeout(r,1500)); }
    setAuditingId(null); setBatchRunning(false);
  };

  const total = filteredAudits.length;
  const avgScore = total>0?(filteredAudits.reduce((s,a)=>s+parseFloat(a.score||0),0)/total).toFixed(2):"—";
  const oppCount = audits.filter(a=>a.call_type==="opportunity").length;
  const currCount = audits.filter(a=>a.call_type==="current_customer").length;

  // Get audits for a specific employee
  const getEmpAudits = (empName, empStore) => audits.filter(a => a.employee === empName && a.store === empStore);

  // Load repeat callers (dropped ball detection)
  const loadRepeatCallers = async () => {
    setRepeatLoading(true);
    try {
      const sp = storeFilter !== "all" ? `&store=${storeFilter}` : "";
      const res = await fetch(`/api/dialpad/repeat-callers?days=7${sp}`);
      const json = await res.json();
      if (json.success) setRepeatCallers(json);
    } catch (e) { console.error(e); }
    setRepeatLoading(false);
  };

  // Criteria renderer based on call type
  const CriteriaGrid = ({ audit }) => {
    const isOpp = audit.call_type !== "current_customer";
    const criteria = isOpp
      ? [{key:"appt_offered",label:"Appt",notes:"appt_notes"},{key:"discount_mentioned",label:"Discount",notes:"discount_notes"},{key:"warranty_mentioned",label:"Warranty",notes:"warranty_notes"},{key:"faster_turnaround",label:"Fast Turn.",notes:"turnaround_notes"}]
      : [{key:"status_update_given",label:"Status",notes:"status_notes"},{key:"eta_communicated",label:"ETA",notes:"eta_notes"},{key:"professional_tone",label:"Tone",notes:"tone_notes"},{key:"next_steps_explained",label:"Next Steps",notes:"next_steps_notes"}];
    return (
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6 }}>
        {criteria.map(({key,label,notes})=>(
          <div key={key} style={{ padding:"6px 8px",borderRadius:6,background:audit[key]?"#4ADE8012":"#F8717112",border:`1px solid ${audit[key]?"#4ADE8033":"#F8717133"}` }}>
            <div style={{ display:"flex",justifyContent:"space-between" }}><span style={{ color:"#8B8F98",fontSize:10 }}>{label}</span><span style={{ color:audit[key]?"#4ADE80":"#F87171",fontSize:10,fontWeight:700 }}>{audit[key]?"PASS":"FAIL"}</span></div>
            <div style={{ color:"#6B6F78",fontSize:9,marginTop:2 }}>{audit[notes]||""}</div>
          </div>
        ))}
      </div>
    );
  };

  const CallTypeBadge = ({ type }) => (
    <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:600,
      background:type==="opportunity"?"#7C8AFF18":"#FBBF2418",
      color:type==="opportunity"?"#7C8AFF":"#FBBF24" }}>
      {type==="opportunity"?"Opportunity":"Current Customer"}
    </span>
  );

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading audit data...</div>;

  return (
    <div>
      {/* Sub-nav + call type filter */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8 }}>
        <div style={{ display:"flex",gap:6 }}>
          {[{id:"overview",label:"Overview",icon:"📊"},{id:"employees",label:"Employee Scores",icon:"👤"},{id:"roster",label:"Roster",icon:"📝"},{id:"dropped",label:"Dropped Balls",icon:"🚨"},{id:"calls",label:"Audit Calls",icon:"🎙️"},{id:"history",label:"Audit History",icon:"📋"}].map(v=>(
            <button key={v.id} onClick={()=>setAuditView(v.id)} style={{ padding:"8px 16px",borderRadius:8,border:"none",cursor:"pointer",background:auditView===v.id?"#7C8AFF22":"#1A1D23",color:auditView===v.id?"#7C8AFF":"#8B8F98",fontSize:12,fontWeight:600,display:"flex",alignItems:"center",gap:6 }}>{v.icon} {v.label}</button>
          ))}
        </div>
        {(auditView==="overview"||auditView==="history")&&(
          <div style={{ display:"flex",gap:4 }}>
            {[{id:"all",label:"All"},{id:"opportunity",label:"Opportunity"},{id:"current_customer",label:"Current"}].map(f=>(
              <button key={f.id} onClick={()=>setCallTypeFilter(f.id)} style={{ padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",background:callTypeFilter===f.id?"#2A2D35":"transparent",color:callTypeFilter===f.id?"#F0F1F3":"#6B6F78",fontSize:11,fontWeight:600 }}>{f.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* OVERVIEW */}
      {auditView==="overview"&&(
        <div>
          <AISummary type="audit"/>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28 }}>
            <StatCard label="Calls Audited" value={total} accent="#7C8AFF" sub={`${oppCount} opportunity · ${currCount} current`}/>
            <StatCard label="Avg Score" value={`${avgScore} / 4`} accent={parseFloat(avgScore)>=3?"#4ADE80":parseFloat(avgScore)>=2?"#FBBF24":"#F87171"}/>
            <StatCard label="Unaudited" value={recordedCalls.length} accent="#C084FC" sub="recorded calls available"/>
            <StatCard label="Employees Found" value={employees.length} accent="#FB923C"/>
          </div>
          {storePerf.length>0&&(()=>{
            // Consolidate duplicate store rows
            const consolidated = {};
            storePerf.forEach(sp => {
              if (!consolidated[sp.store]) { consolidated[sp.store] = { ...sp }; }
              else {
                const c = consolidated[sp.store];
                const totalW = c.total_audits + sp.total_audits;
                c.avg_score = totalW > 0 ? ((c.avg_score * c.total_audits + sp.avg_score * sp.total_audits) / totalW) : 0;
                c.total_audits = totalW;
                c.opportunity_calls = (c.opportunity_calls||0) + (sp.opportunity_calls||0);
                c.current_calls = (c.current_calls||0) + (sp.current_calls||0);
              }
            });
            const stores = Object.values(consolidated).filter(sp => STORES[sp.store]);
            return (
            <div style={{ display:"grid",gridTemplateColumns:`repeat(${Math.min(stores.length,3)},1fr)`,gap:14,marginBottom:20 }}>
              {stores.map(sp=>{const store=STORES[sp.store];const sc=sp.avg_score>=3?"#4ADE80":sp.avg_score>=2?"#FBBF24":"#F87171";return(
                <div key={sp.store} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:`1px solid ${store.color}33` }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}><div style={{ width:32,height:32,borderRadius:8,background:store.color+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store.color,fontWeight:800,fontSize:14 }}>{store.icon}</div><div><div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{store.name}</div><div style={{ color:"#6B6F78",fontSize:11 }}>{sp.total_audits} audited · {sp.opportunity_calls||0} opp · {sp.current_calls||0} curr</div></div></div>
                    <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:18,fontWeight:800 }}>{parseFloat(sp.avg_score).toFixed(2)}</div>
                  </div>
                </div>
              );})}
            </div>
            );
          })()}
        </div>
      )}

      {/* EMPLOYEES — expandable rows */}
      {auditView==="employees"&&(
        <div>
          <SectionHeader title="Employee Leaderboard" subtitle="Click an employee to expand detailed analysis" icon="🏆"/>
          {employees.length>0?(
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              {employees.map((emp,i)=>{
                const store=STORES[emp.store];const sc=emp.avg_score>=3?"#4ADE80":emp.avg_score>=2?"#FBBF24":"#F87171";
                const medal=i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`;
                const isExpanded=expandedEmp===`${emp.employee}__${emp.store}`;
                const empAudits=isExpanded?getEmpAudits(emp.employee,emp.store):[];
                const empOpp=empAudits.filter(a=>a.call_type==="opportunity");
                const empCurr=empAudits.filter(a=>a.call_type==="current_customer");
                return(
                  <div key={`${emp.employee}-${emp.store}`} style={{ borderBottom:"1px solid #1E2028" }}>
                    {/* Main row — clickable */}
                    <div onClick={()=>setExpandedEmp(isExpanded?null:`${emp.employee}__${emp.store}`)}
                      style={{ padding:"14px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",borderRadius:8,
                        background:isExpanded?"#12141A":"transparent",transition:"background 0.2s" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:16,flex:1 }}>
                        <span style={{ fontSize:18,width:28,textAlign:"center" }}>{medal}</span>
                        <div style={{ minWidth:120 }}>
                          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.employee}</div>
                          <div style={{ display:"flex",alignItems:"center",gap:6,marginTop:2 }}>
                            <span style={{ width:7,height:7,borderRadius:"50%",background:store?.color }}/>
                            <span style={{ color:store?.color||"#8B8F98",fontSize:11 }}>{store?.name?.replace("CPR ","")||emp.store}</span>
                          </div>
                        </div>
                        <div style={{ textAlign:"center",minWidth:50 }}>
                          <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Calls</div>
                          <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{emp.total_calls}</div>
                        </div>
                        <div style={{ textAlign:"center",minWidth:80 }}>
                          <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Type Split</div>
                          <div style={{ fontSize:11 }}><span style={{ color:"#7C8AFF" }}>{emp.opportunity_calls||0} opp</span> · <span style={{ color:"#FBBF24" }}>{emp.current_calls||0} curr</span></div>
                        </div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:16 }}>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:9 }}>APPT</div>
                          <div style={{ color:parseFloat(emp.appt_rate)>=70?"#4ADE80":parseFloat(emp.appt_rate)>=40?"#FBBF24":"#F87171",fontSize:13,fontWeight:700 }}>{parseFloat(emp.appt_rate||0).toFixed(0)}%</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:9 }}>WARR</div>
                          <div style={{ color:parseFloat(emp.warranty_rate)>=70?"#4ADE80":parseFloat(emp.warranty_rate)>=40?"#FBBF24":"#F87171",fontSize:13,fontWeight:700 }}>{parseFloat(emp.warranty_rate||0).toFixed(0)}%</div>
                        </div>
                        <div style={{ padding:"5px 14px",borderRadius:8,background:sc+"22",color:sc,fontSize:16,fontWeight:800 }}>{parseFloat(emp.avg_score).toFixed(2)}</div>
                        <span style={{ color:"#6B6F78",fontSize:14,transition:"transform 0.2s",transform:isExpanded?"rotate(180deg)":"rotate(0)" }}>▼</span>
                      </div>
                    </div>
                    {/* Expanded detail */}
                    {isExpanded&&(
                      <div style={{ padding:"0 12px 20px 56px" }}>
                        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginTop:8 }}>
                          {/* Opportunity breakdown */}
                          <div style={{ background:"#0F1117",borderRadius:10,padding:16,border:"1px solid #7C8AFF22" }}>
                            <div style={{ color:"#7C8AFF",fontSize:12,fontWeight:700,marginBottom:10 }}>Opportunity Calls ({empOpp.length})</div>
                            {empOpp.length>0?(
                              <div>
                                {[{label:"Appt Offered",rate:emp.appt_rate,pts:"1.25"},{label:"Discount",rate:emp.discount_rate,pts:"0.92"},{label:"Warranty",rate:emp.warranty_rate,pts:"0.92"},{label:"Fast Turn.",rate:emp.turnaround_rate,pts:"0.92"}].map((item,j)=>(
                                  <div key={j} style={{ marginBottom:8 }}>
                                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                                      <span style={{ color:"#C8CAD0",fontSize:11 }}>{item.label} <span style={{ color:"#6B6F78" }}>({item.pts}pts)</span></span>
                                      <span style={{ color:parseFloat(item.rate)>=70?"#4ADE80":parseFloat(item.rate)>=40?"#FBBF24":"#F87171",fontSize:12,fontWeight:700 }}>{parseFloat(item.rate||0).toFixed(0)}%</span>
                                    </div>
                                    <div style={{ background:"#1A1D23",borderRadius:3,height:5,overflow:"hidden" }}><div style={{ width:`${item.rate||0}%`,height:"100%",background:parseFloat(item.rate)>=70?"#4ADE80":parseFloat(item.rate)>=40?"#FBBF24":"#F87171",borderRadius:3 }}/></div>
                                  </div>
                                ))}
                                <div style={{ marginTop:12,borderTop:"1px solid #1E2028",paddingTop:10 }}>
                                  <div style={{ color:"#8B8F98",fontSize:10,marginBottom:6 }}>Recent calls:</div>
                                  {empOpp.slice(0,3).map((a,j)=>(
                                    <div key={j} style={{ fontSize:11,color:"#C8CAD0",marginBottom:4,padding:"4px 0",borderBottom:"1px solid #1A1D2366" }}>
                                      <span style={{ color:parseFloat(a.score)>=3?"#4ADE80":parseFloat(a.score)>=2?"#FBBF24":"#F87171",fontWeight:700 }}>{parseFloat(a.score).toFixed(2)}</span> — {a.inquiry||"No inquiry"} <span style={{ color:"#6B6F78" }}>({new Date(a.date_started||a.date).toLocaleDateString()})</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ):<div style={{ color:"#6B6F78",fontSize:11 }}>No opportunity calls audited yet</div>}
                          </div>
                          {/* Current customer breakdown */}
                          <div style={{ background:"#0F1117",borderRadius:10,padding:16,border:"1px solid #FBBF2422" }}>
                            <div style={{ color:"#FBBF24",fontSize:12,fontWeight:700,marginBottom:10 }}>Current Customer Calls ({empCurr.length})</div>
                            {empCurr.length>0?(
                              <div>
                                {[{label:"Status Update",rate:emp.status_rate,pts:"1.00"},{label:"ETA Given",rate:emp.eta_rate,pts:"1.00"},{label:"Prof. Tone",rate:emp.tone_rate,pts:"1.00"},{label:"Next Steps",rate:emp.next_steps_rate,pts:"1.00"}].map((item,j)=>(
                                  <div key={j} style={{ marginBottom:8 }}>
                                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                                      <span style={{ color:"#C8CAD0",fontSize:11 }}>{item.label} <span style={{ color:"#6B6F78" }}>({item.pts}pts)</span></span>
                                      <span style={{ color:parseFloat(item.rate)>=70?"#4ADE80":parseFloat(item.rate)>=40?"#FBBF24":"#F87171",fontSize:12,fontWeight:700 }}>{parseFloat(item.rate||0).toFixed(0)}%</span>
                                    </div>
                                    <div style={{ background:"#1A1D23",borderRadius:3,height:5,overflow:"hidden" }}><div style={{ width:`${item.rate||0}%`,height:"100%",background:parseFloat(item.rate)>=70?"#4ADE80":parseFloat(item.rate)>=40?"#FBBF24":"#F87171",borderRadius:3 }}/></div>
                                  </div>
                                ))}
                                <div style={{ marginTop:12,borderTop:"1px solid #1E2028",paddingTop:10 }}>
                                  <div style={{ color:"#8B8F98",fontSize:10,marginBottom:6 }}>Recent calls:</div>
                                  {empCurr.slice(0,3).map((a,j)=>(
                                    <div key={j} style={{ fontSize:11,color:"#C8CAD0",marginBottom:4,padding:"4px 0",borderBottom:"1px solid #1A1D2366" }}>
                                      <span style={{ color:parseFloat(a.score)>=3?"#4ADE80":parseFloat(a.score)>=2?"#FBBF24":"#F87171",fontWeight:700 }}>{parseFloat(a.score).toFixed(2)}</span> — {a.inquiry||"No inquiry"} {a.device_type&&a.device_type!=="Not mentioned"?`(${a.device_type})`:""} <span style={{ color:"#6B6F78" }}>({new Date(a.date_started||a.date).toLocaleDateString()})</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ):<div style={{ color:"#6B6F78",fontSize:11 }}>No current customer calls audited yet. These will appear as the cron classifies new calls.</div>}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ):<div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78" }}>No employee data yet. Run "Audit All" to build the leaderboard.</div>}
        </div>
      )}

      {/* ROSTER — employee name management */}
      {auditView==="roster"&&(
        <div>
          <SectionHeader title="Employee Roster" subtitle="Add your real employee names so transcript aliases get consolidated" icon="📝"/>
          {/* Add employee form */}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Add Employee</div>
            <div style={{ display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end" }}>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Full Name</div>
                <input value={rosterForm.name} onChange={e=>setRosterForm(p=>({...p,name:e.target.value}))}
                  placeholder="e.g. Mahmoud" style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,width:160,outline:"none" }}/>
              </div>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Store</div>
                <select value={rosterForm.store} onChange={e=>setRosterForm(p=>({...p,store:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none" }}>
                  {STORE_KEYS.map(k=><option key={k} value={k}>{STORES[k].name}</option>)}
                </select>
              </div>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Aliases (comma-separated)</div>
                <input value={rosterForm.aliases} onChange={e=>setRosterForm(p=>({...p,aliases:e.target.value}))}
                  placeholder="e.g. Mau, Ma, Mah" style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,width:220,outline:"none" }}/>
              </div>
              <div>
                <div style={{ color:"#8B8F98",fontSize:10,marginBottom:4 }}>Role</div>
                <select value={rosterForm.role} onChange={e=>setRosterForm(p=>({...p,role:e.target.value}))}
                  style={{ padding:"8px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none" }}>
                  {["Manager","Lead Tech","Technician","Front Desk"].map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <button onClick={async()=>{
                if(!rosterForm.name) return;
                const res = await fetch("/api/dialpad/roster",{method:"POST",headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({action:"add",...rosterForm})});
                const json = await res.json();
                if(json.success) {
                  setRoster(prev=>[...prev.filter(r=>!(r.name===rosterForm.name&&r.store===rosterForm.store)),json.employee]);
                  setRosterForm({name:"",store:rosterForm.store,aliases:"",role:"Technician"});
                }
              }} style={{ padding:"8px 18px",borderRadius:6,border:"none",cursor:"pointer",background:"#7C8AFF",color:"#FFF",fontSize:12,fontWeight:700,height:36 }}>Add</button>
            </div>
          </div>

          {/* Unmatched names */}
          {unmatched.length>0&&(
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #FBBF2433" }}>
              <div style={{ color:"#FBBF24",fontSize:14,fontWeight:700,marginBottom:8 }}>⚠ Unmatched Transcript Names ({unmatched.length})</div>
              <div style={{ color:"#6B6F78",fontSize:12,marginBottom:12 }}>These names appear in transcripts but don't match any roster entry. Add the employee above with appropriate aliases.</div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {unmatched.map((u,i)=>(
                  <button key={i} onClick={()=>setRosterForm(p=>({...p,aliases:p.aliases?`${p.aliases}, ${u.name}`:u.name,store:u.store}))}
                    style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#C8CAD0",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:6 }}>
                    <span style={{ width:7,height:7,borderRadius:"50%",background:STORES[u.store]?.color||"#8B8F98" }}/>
                    "{u.name}" <span style={{ color:"#6B6F78" }}>({u.count}x · {STORES[u.store]?.name?.replace("CPR ","")||u.store})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current roster */}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Current Roster ({roster.length} employees)</div>
            {roster.length>0?(
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead><tr style={{ borderBottom:"1px solid #2A2D35" }}>
                  {["Name","Store","Role","Aliases",""].map((h,i)=><th key={i} style={{ textAlign:"left",padding:"8px 12px",color:"#6B6F78",fontSize:10,textTransform:"uppercase" }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {roster.map(emp=>{const store=STORES[emp.store];return(
                    <tr key={emp.id} style={{ borderBottom:"1px solid #1E2028" }}>
                      <td style={{ padding:"12px",color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.name}</td>
                      <td style={{ padding:"12px" }}><span style={{ display:"inline-flex",alignItems:"center",gap:6,color:store?.color||"#8B8F98",fontSize:12 }}><span style={{ width:7,height:7,borderRadius:"50%",background:store?.color }}/>{store?.name?.replace("CPR ","")||emp.store}</span></td>
                      <td style={{ padding:"12px",color:"#C8CAD0",fontSize:12 }}>{emp.role}</td>
                      <td style={{ padding:"12px" }}><div style={{ display:"flex",gap:4,flexWrap:"wrap" }}>{(emp.aliases||[]).map((a,j)=><span key={j} style={{ padding:"2px 8px",borderRadius:4,background:"#2A2D35",color:"#8B8F98",fontSize:11 }}>{a}</span>)}</div></td>
                      <td style={{ padding:"12px" }}><button onClick={async()=>{
                        await fetch("/api/dialpad/roster",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"delete",id:emp.id})});
                        setRoster(prev=>prev.filter(r=>r.id!==emp.id));
                      }} style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>Remove</button></td>
                    </tr>
                  );})}
                </tbody>
              </table>
            ):<div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No employees added yet. Add your team above — the system will automatically match transcript names to real names.</div>}
          </div>
        </div>
      )}

      {/* DROPPED BALLS — repeat caller detection */}
      {auditView==="dropped"&&(
        <div>
          <SectionHeader title="Dropped Ball Tracker" subtitle="Customers who called multiple times — we may have missed proactive updates" icon="🚨"/>
          {!repeatCallers&&(
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center" }}>
              <div style={{ fontSize:32,marginBottom:12 }}>🚨</div>
              <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700,marginBottom:8 }}>Detect repeat callers</div>
              <div style={{ color:"#6B6F78",fontSize:13,marginBottom:16 }}>Scans the last 7 days for customers who called the same store multiple times. Flags cases where we likely didn't call them with a proactive update.</div>
              <button onClick={loadRepeatCallers} disabled={repeatLoading} style={{
                padding:"10px 24px",borderRadius:8,border:"none",cursor:repeatLoading?"default":"pointer",
                background:repeatLoading?"#F8717122":"linear-gradient(135deg,#F87171,#FB923C)",
                color:repeatLoading?"#F87171":"#FFF",fontSize:13,fontWeight:700,
                animation:repeatLoading?"pulse 1.5s infinite":"none",
              }}>{repeatLoading?"Scanning...":"🔍 Scan for Dropped Balls"}</button>
            </div>
          )}
          {repeatCallers&&(
            <div>
              {/* Summary stats */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20 }}>
                <StatCard label="Repeat Callers" value={repeatCallers.summary?.total_repeat_callers||0} accent="#F87171" sub="last 7 days"/>
                <StatCard label="High Severity" value={repeatCallers.summary?.high_severity||0} accent="#F87171" sub="3+ calls, no outbound"/>
                <StatCard label="Medium Severity" value={repeatCallers.summary?.medium_severity||0} accent="#FBBF24"/>
                <StatCard label="Never Called Back" value={repeatCallers.summary?.never_called_back||0} accent="#FB923C" sub="no proactive outreach"/>
              </div>
              {/* Store breakdown */}
              <div style={{ display:"grid",gridTemplateColumns:`repeat(${STORE_KEYS.length},1fr)`,gap:14,marginBottom:20 }}>
                {STORE_KEYS.map(sk=>{const store=STORES[sk];const sd=repeatCallers.summary?.by_store?.[sk]||{count:0,high:0};return(
                  <div key={sk} style={{ background:"#1A1D23",borderRadius:10,padding:16,border:`1px solid ${store.color}33`,display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <span style={{ width:8,height:8,borderRadius:"50%",background:store.color }}/>
                      <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{store.name}</span>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{sd.count}</div>
                      {sd.high>0&&<div style={{ color:"#F87171",fontSize:10 }}>{sd.high} high</div>}
                    </div>
                  </div>
                );})}
              </div>
              {/* Repeat caller list */}
              <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
                  <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>Flagged Customers</div>
                  <button onClick={loadRepeatCallers} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:11,cursor:"pointer" }}>↻ Rescan</button>
                </div>
                <div style={{ maxHeight:500,overflowY:"auto" }}>
                  {(repeatCallers.repeatCallers||[]).map((rc,i)=>{
                    const store=STORES[rc.store];
                    const sevColor=rc.severity==="high"?"#F87171":rc.severity==="medium"?"#FBBF24":"#6B6F78";
                    return(
                      <div key={i} style={{ padding:"14px 0",borderBottom:"1px solid #2A2D35" }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                          <div>
                            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                              <span style={{ padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,background:sevColor+"22",color:sevColor,textTransform:"uppercase" }}>{rc.severity}</span>
                              <span style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{rc.customer_name!=="Unknown"?rc.customer_name:rc.phone}</span>
                              {rc.customer_name!=="Unknown"&&<span style={{ color:"#6B6F78",fontSize:11 }}>{rc.phone}</span>}
                            </div>
                            <div style={{ display:"flex",alignItems:"center",gap:8,fontSize:11,color:"#8B8F98" }}>
                              <span style={{ width:7,height:7,borderRadius:"50%",background:store?.color }}/>
                              <span style={{ color:store?.color }}>{store?.name||rc.store}</span>
                              {rc.device_type!=="Unknown"&&<span>· {rc.device_type}</span>}
                              <span>· {rc.time_span_hours}h span</span>
                            </div>
                          </div>
                          <div style={{ textAlign:"right" }}>
                            <div style={{ color:"#F0F1F3",fontSize:20,fontWeight:800 }}>{rc.total_calls}x</div>
                            <div style={{ fontSize:10,color:rc.we_called_back?"#4ADE80":"#F87171" }}>{rc.we_called_back?`We called back (${rc.outbound_calls}x)`:"Never called back"}</div>
                          </div>
                        </div>
                        {/* Timeline of calls */}
                        <div style={{ marginTop:10,paddingLeft:8,borderLeft:"2px solid #2A2D35" }}>
                          {rc.calls.slice(0,5).map((c,j)=>(
                            <div key={j} style={{ display:"flex",alignItems:"center",gap:8,padding:"4px 0",fontSize:11 }}>
                              <span style={{ width:6,height:6,borderRadius:"50%",background:c.answered?"#4ADE80":c.missed?"#F87171":"#FBBF24",flexShrink:0 }}/>
                              <span style={{ color:"#6B6F78",minWidth:120 }}>{new Date(c.date).toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                              <span style={{ color:c.answered?"#C8CAD0":"#F87171" }}>{c.answered?"Answered":"Missed"}</span>
                              {c.employee&&<span style={{ color:"#8B8F98" }}>— {c.employee}</span>}
                              {c.inquiry&&<span style={{ color:"#6B6F78",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:250 }}>"{c.inquiry}"</span>}
                            </div>
                          ))}
                          {rc.calls.length>5&&<div style={{ color:"#6B6F78",fontSize:10,padding:"4px 0" }}>+{rc.calls.length-5} more calls</div>}
                        </div>
                      </div>
                    );
                  })}
                  {(repeatCallers.repeatCallers||[]).length===0&&<div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No repeat callers detected — great job! 🎉</div>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AUDIT CALLS */}
      {auditView==="calls"&&(
        <div>
          {error&&<div style={{ padding:"8px 12px",borderRadius:6,background:"#F8717122",color:"#F87171",fontSize:12,marginBottom:12 }}>{error}</div>}
          {batchRunning&&(
            <div style={{ background:"#1A1D23",borderRadius:8,padding:"12px 16px",marginBottom:16,border:"1px solid #7C8AFF33" }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                <span style={{ color:"#C8CAD0",fontSize:13,fontWeight:600 }}>Batch Audit: {batchProgress.done} / {batchProgress.total}</span>
                <button onClick={()=>{batchAbort.current=true;}} style={{ padding:"4px 12px",borderRadius:6,border:"1px solid #F8717144",background:"#F8717118",color:"#F87171",fontSize:11,cursor:"pointer" }}>Stop</button>
              </div>
              <div style={{ background:"#12141A",borderRadius:4,height:8,overflow:"hidden" }}><div style={{ width:`${batchProgress.total>0?(batchProgress.done/batchProgress.total)*100:0}%`,height:"100%",background:"#7C8AFF",borderRadius:4,transition:"width 0.3s" }}/></div>
            </div>
          )}
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <SectionHeader title="Recorded Calls — Ready to Audit" subtitle={`${recordedCalls.length} unaudited calls`} icon="🎙️"/>
              {recordedCalls.length>0&&!batchRunning&&(
                <button onClick={runBatch} style={{ padding:"8px 20px",borderRadius:8,border:"none",cursor:"pointer",background:"linear-gradient(135deg,#7C8AFF,#C084FC)",color:"#FFF",fontSize:13,fontWeight:700,boxShadow:"0 4px 12px rgba(124,138,255,0.3)" }}>🎯 Audit All ({recordedCalls.length})</button>
              )}
            </div>
            <div style={{ maxHeight:600,overflowY:"auto" }}>
              {recordedCalls.map((call,i)=>{const isA=auditingId===call.call_id;const d=new Date(call.date_started);const store=STORES[call._storeKey];return(
                <div key={i} style={{ padding:"12px 0",borderBottom:"1px solid #2A2D35",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                  <div><div style={{ display:"flex",alignItems:"center",gap:8 }}><span style={{ width:8,height:8,borderRadius:"50%",background:store?.color||"#8B8F98" }}/><span style={{ color:"#E8E9EC",fontSize:13,fontWeight:600 }}>{call.external_number}</span><span style={{ color:"#6B6F78",fontSize:11 }}>→ {call.name}</span></div><div style={{ color:"#6B6F78",fontSize:11,marginTop:2 }}>{d.toLocaleDateString()} {d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {call.talk_duration?`${parseFloat(call.talk_duration).toFixed(1)} min`:""}</div></div>
                  <button onClick={()=>!isA&&!batchRunning&&runAudit(call)} disabled={isA||batchRunning} style={{ padding:"6px 14px",borderRadius:6,border:"none",cursor:isA||batchRunning?"default":"pointer",background:isA?"#7C8AFF22":"#7C8AFF",color:isA?"#7C8AFF":"#FFF",fontSize:12,fontWeight:600,animation:isA?"pulse 1.5s infinite":"none" }}>{isA?"Scoring...":"Audit"}</button>
                </div>
              );})}
              {recordedCalls.length===0&&<div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>All recorded calls have been audited!</div>}
            </div>
          </div>
        </div>
      )}

      {/* HISTORY */}
      {auditView==="history"&&(
        <div>
          <SectionHeader title="Audit History" subtitle={`${filteredAudits.length} calls scored`} icon="📋"/>
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            <div style={{ maxHeight:600,overflowY:"auto" }}>
              {filteredAudits.map((audit,i)=>{const score=parseFloat(audit.score||0);const sc=score>=3?"#4ADE80":score>=2?"#FBBF24":"#F87171";const store=STORES[audit.store];const d=new Date(audit.date_started||audit.date);return(
                <div key={audit.call_id||i} style={{ padding:16,borderBottom:"1px solid #2A2D35" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
                        <span style={{ color:"#E8E9EC",fontSize:13,fontWeight:700 }}>{audit.employee||"Unknown"} — {audit.phone}</span>
                        <CallTypeBadge type={audit.call_type||"opportunity"}/>
                      </div>
                      <div style={{ color:"#6B6F78",fontSize:11 }}>
                        {d.toLocaleDateString()} {d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · <span style={{ color:store?.color }}>{store?.name||audit.store}</span>
                        {audit.customer_name&&audit.customer_name!=="Unknown"&&<span> · Customer: {audit.customer_name}</span>}
                        {audit.device_type&&audit.device_type!=="Not mentioned"&&<span> · {audit.device_type}</span>}
                      </div>
                    </div>
                    <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:16,fontWeight:800 }}>{score.toFixed(2)} / 4</div>
                  </div>
                  <div style={{ color:"#C8CAD0",fontSize:12,marginBottom:8 }}><strong>Inquiry:</strong> {audit.inquiry||"—"}<br/><strong>Outcome:</strong> {audit.outcome||"—"}</div>
                  <CriteriaGrid audit={audit}/>
                </div>
              );})}
              {filteredAudits.length===0&&<div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No audit history yet.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════
export default function DialpadDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [storeFilter, setStoreFilter] = useState("all");
  const [isLive, setIsLive] = useState(false);
  const [isStored, setIsStored] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [rawCallData, setRawCallData] = useState([]);
  const [dailyCalls, setDailyCalls] = useState(SAMPLE_DAILY_CALLS);
  const [hourlyMissed, setHourlyMissed] = useState(SAMPLE_HOURLY_MISSED);
  const [dowData, setDowData] = useState(SAMPLE_DOW_DATA);
  const [callbackData, setCallbackData] = useState(SAMPLE_CALLBACK_DATA);
  const [keywords, setKeywords] = useState(SAMPLE_KEYWORDS);
  const [problemCalls, setProblemCalls] = useState(SAMPLE_PROBLEM_CALLS);

  const loadStoredData = useCallback(async () => {
    try {
      const res = await fetch("/api/dialpad/stored?days=30"); const json = await res.json();
      if (json.success && json.hasData) {
        const d = json.data;
        if(d.dailyCalls?.length>0)setDailyCalls(d.dailyCalls); if(d.hourlyMissed?.length>0)setHourlyMissed(d.hourlyMissed);
        if(d.dowData?.length>0)setDowData(d.dowData); if(d.callbackData?.length>0)setCallbackData(d.callbackData);
        if(d.problemCalls?.length>0)setProblemCalls(d.problemCalls);
        setIsStored(true); setLastSync(json.lastSync); return true;
      }
    } catch(e) { console.error(e); } return false;
  }, []);

  const loadLiveData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchLiveStats();
      if (data&&data.length>0) {
        setRawCallData(data);
        const daily=transformToDailyCalls(data);if(daily.length>0)setDailyCalls(daily);
        const hourly=transformToHourlyMissed(data);if(hourly.some(h=>STORE_KEYS.some(k=>h[k]>0)))setHourlyMissed(hourly);
        const dow=transformToDOWMissed(data);if(dow.some(d=>STORE_KEYS.some(k=>d[k]>0)))setDowData(dow);
        const cbs=transformToCallbackData(data);if(cbs.some(c=>c.missed>0))setCallbackData(cbs);
        const probs=transformToProblemCalls(data);if(probs.some(p=>STORE_KEYS.some(k=>p[k]>0)))setProblemCalls(probs);
        setIsLive(true); setIsStored(false);
      }
    } catch(e) { console.error(e); }
    setIsLoading(false);
  }, []);

  useEffect(() => { async function init() { const has = await loadStoredData(); if(!has) await loadLiveData(); } init(); }, [loadStoredData, loadLiveData]);

  const overviewStats = useMemo(() => {
    const totals={total:0,answered:0,missed:0}; const storeStats={};
    STORE_KEYS.forEach(s=>{storeStats[s]={total:0,answered:0,missed:0};});
    dailyCalls.forEach(d=>{STORE_KEYS.forEach(s=>{
      const t=d[`${s}_total`]||0;const a=d[`${s}_answered`]||0;const m=d[`${s}_missed`]!==undefined?d[`${s}_missed`]:(t-a);
      storeStats[s].total+=t;storeStats[s].answered+=a;storeStats[s].missed+=m;
      totals.total+=t;totals.answered+=a;totals.missed+=m;
    });});
    return {totals,storeStats};
  }, [dailyCalls]);

  return (
    <div style={{ background:"#0F1117",minHeight:"100vh",color:"#F0F1F3",fontFamily:"'Space Grotesk',-apple-system,sans-serif" }}>
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
      <div style={{ background:"#12141A",borderBottom:"1px solid #1E2028",padding:"16px 28px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12 }}>
        <div style={{ display:"flex",alignItems:"center",gap:14 }}><div style={{ width:38,height:38,borderRadius:10,background:"linear-gradient(135deg,#7C8AFF,#C084FC)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18 }}>📞</div><div><h1 style={{ margin:0,fontSize:19,fontWeight:800,letterSpacing:"-0.02em" }}>Dialpad Analytics</h1><p style={{ margin:0,color:"#6B6F78",fontSize:12 }}>CPR Store Call Intelligence · Last 30 Days</p></div></div>
        <StoreToggle selected={storeFilter} onChange={setStoreFilter}/>
      </div>
      <div style={{ background:"#12141A",borderBottom:"1px solid #1E2028",padding:"0 28px",display:"flex",gap:0,overflowX:"auto" }}>
        {TABS.map(tab=>(<button key={tab.id} onClick={()=>setActiveTab(tab.id)} style={{ padding:"14px 20px",border:"none",cursor:"pointer",background:"transparent",color:activeTab===tab.id?"#F0F1F3":"#6B6F78",fontSize:13,fontWeight:600,borderBottom:activeTab===tab.id?"2px solid #7C8AFF":"2px solid transparent",display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",fontFamily:"'Space Grotesk',sans-serif" }}><span style={{ fontSize:14 }}>{tab.icon}</span>{tab.label}</button>))}
      </div>
      <div style={{ padding:28 }}>
        <DataBanner isLive={isLive} isLoading={isLoading} isStored={isStored} lastSync={lastSync} onRefresh={loadStoredData} onLiveRefresh={loadLiveData}/>
        {activeTab==="overview"&&<OverviewTab storeFilter={storeFilter} overviewStats={overviewStats} dailyCalls={dailyCalls}/>}
        {activeTab==="keywords"&&<KeywordsTab keywords={keywords}/>}
        {activeTab==="missed"&&<MissedTab storeFilter={storeFilter} overviewStats={overviewStats} hourlyMissed={hourlyMissed} dowData={dowData}/>}
        {activeTab==="callbacks"&&<CallbacksTab callbackData={callbackData}/>}
        {activeTab==="problems"&&<ProblemsTab overviewStats={overviewStats} problemCalls={problemCalls}/>}
        {activeTab==="audit"&&<AuditTab rawCallData={rawCallData} storeFilter={storeFilter}/>}
      </div>
      <div style={{ padding:"16px 28px",borderTop:"1px solid #1E2028",color:"#4A4D55",fontSize:11,textAlign:"center",fontFamily:"'JetBrains Mono',monospace" }}>
        {isStored?`Stored data · Synced ${lastSync?new Date(lastSync).toLocaleString():"—"}`:isLive?"Live data from Dialpad API":"Sample data"} · Focused Technologies LLC
      </div>
    </div>
  );
}

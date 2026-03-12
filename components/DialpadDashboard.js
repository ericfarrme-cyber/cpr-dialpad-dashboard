'use client';

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, CartesianGrid,
  AreaChart, Area, Legend, RadarChart, Radar, PolarGrid,
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

// ── Shared UI Components ──

const StatCard = ({ label, value, sub, accent, trend }) => (
  <div style={{
    background: "#1A1D23", borderRadius: 12, padding: "18px 20px",
    borderLeft: `3px solid ${accent}`, minWidth: 0,
  }}>
    <div style={{ color: "#8B8F98", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
    <div style={{ color: "#F0F1F3", fontSize: 28, fontWeight: 700, marginTop: 4 }}>
      {value}
      {trend !== undefined && trend !== null && <span style={{ fontSize: 12, marginLeft: 8, color: trend > 0 ? "#4ADE80" : "#F87171" }}>{trend > 0 ? "▲" : "▼"} {Math.abs(trend)}%</span>}
    </div>
    {sub && <div style={{ color: "#6B6F78", fontSize: 12, marginTop: 2 }}>{sub}</div>}
  </div>
);

const StoreToggle = ({ selected, onChange }) => (
  <div style={{ display: "flex", gap: 6, background: "#12141A", borderRadius: 10, padding: 4, flexWrap: "wrap" }}>
    <button onClick={() => onChange("all")} style={{
      padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
      background: selected === "all" ? "#2A2D35" : "transparent",
      color: selected === "all" ? "#F0F1F3" : "#6B6F78",
      fontSize: 13, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
    }}>All Stores</button>
    {Object.entries(STORES).map(([key, s]) => (
      <button key={key} onClick={() => onChange(key)} style={{
        padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer",
        background: selected === key ? s.color + "22" : "transparent",
        color: selected === key ? s.color : "#6B6F78",
        fontSize: 13, fontWeight: 600, fontFamily: "'Space Grotesk', sans-serif",
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block" }} />
        {s.name.replace("CPR ", "")}
      </button>
    ))}
  </div>
);

const SectionHeader = ({ title, subtitle, icon }) => (
  <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
    <span style={{ fontSize: 20 }}>{icon}</span>
    <div>
      <h2 style={{ color: "#F0F1F3", fontSize: 17, fontWeight: 700, margin: 0 }}>{title}</h2>
      {subtitle && <p style={{ color: "#6B6F78", fontSize: 12, margin: "2px 0 0" }}>{subtitle}</p>}
    </div>
  </div>
);

const DataBanner = ({ isLive, isLoading, onRefresh }) => (
  <div style={{
    margin: "0 0 20px", padding: "10px 16px", borderRadius: 8,
    background: isLive ? "#4ADE8012" : "#FBBF2412",
    border: `1px solid ${isLive ? "#4ADE8033" : "#FBBF2433"}`,
    display: "flex", justifyContent: "space-between", alignItems: "center",
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: isLive ? "#4ADE80" : "#FBBF24",
        animation: isLoading ? "pulse 1.5s infinite" : "none",
      }} />
      <span style={{ color: "#C8CAD0", fontSize: 12 }}>
        {isLoading ? "Fetching live data from Dialpad (this may take up to 60 seconds)..." : isLive ? "Live data from Dialpad API" : "Sample data — add DIALPAD_API_KEY to Vercel env vars for live data"}
      </span>
    </div>
    {!isLoading && (
      <button onClick={onRefresh} style={{
        padding: "4px 12px", borderRadius: 6, border: "1px solid #2A2D35",
        background: "transparent", color: "#8B8F98", fontSize: 11,
        cursor: "pointer", fontFamily: "'Space Grotesk', sans-serif",
      }}>↻ Refresh</button>
    )}
  </div>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "#1E2028", border: "1px solid #2A2D35", borderRadius: 8,
      padding: "10px 14px", boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    }}>
      <div style={{ color: "#8B8F98", fontSize: 11, marginBottom: 6, fontFamily: "'JetBrains Mono', monospace" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
          <span style={{ color: "#C8CAD0", fontSize: 12 }}>{p.name}: <strong style={{ color: "#F0F1F3" }}>{p.value}</strong></span>
        </div>
      ))}
    </div>
  );
};

// ── Tab Renderers (Overview, Keywords, Missed, Callbacks, Problems) ──

function OverviewTab({ storeFilter, overviewStats, dailyCalls }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Calls (30d)" value={overviewStats.totals.total.toLocaleString()} accent="#7C8AFF" />
        <StatCard label="Answer Rate" value={`${((overviewStats.totals.answered / overviewStats.totals.total) * 100 || 0).toFixed(1)}%`} accent="#4ADE80" sub={`${overviewStats.totals.answered.toLocaleString()} answered`} />
        <StatCard label="Missed Calls" value={(overviewStats.totals.total - overviewStats.totals.answered).toLocaleString()} accent="#F87171" />
        <StatCard label="Avg Calls / Day" value={Math.round(overviewStats.totals.total / 30)} accent="#C084FC" sub="across all stores" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STORE_KEYS.length}, 1fr)`, gap: 14, marginBottom: 28 }}>
        {Object.entries(STORES).map(([key, store]) => {
          const s = overviewStats.storeStats[key];
          const rate = ((s.answered / s.total) * 100 || 0).toFixed(1);
          return (
            <div key={key} style={{ background: "#1A1D23", borderRadius: 12, padding: 20, border: `1px solid ${store.color}33` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: store.color + "22", display: "flex", alignItems: "center", justifyContent: "center", color: store.color, fontWeight: 800, fontSize: 16 }}>{store.icon}</div>
                <div>
                  <div style={{ color: "#F0F1F3", fontSize: 15, fontWeight: 700 }}>{store.name}</div>
                  <div style={{ color: "#6B6F78", fontSize: 11 }}>{s.total} total calls</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div><div style={{ color: "#8B8F98", fontSize: 10, textTransform: "uppercase" }}>Answered</div><div style={{ color: "#4ADE80", fontSize: 20, fontWeight: 700 }}>{s.answered}</div></div>
                <div><div style={{ color: "#8B8F98", fontSize: 10, textTransform: "uppercase" }}>Missed</div><div style={{ color: "#F87171", fontSize: 20, fontWeight: 700 }}>{s.total - s.answered}</div></div>
                <div><div style={{ color: "#8B8F98", fontSize: 10, textTransform: "uppercase" }}>Rate</div><div style={{ color: store.color, fontSize: 20, fontWeight: 700 }}>{rate}%</div></div>
              </div>
              <div style={{ marginTop: 12, background: "#12141A", borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div style={{ width: `${rate}%`, height: "100%", background: store.color, borderRadius: 6 }} />
              </div>
            </div>
          );
        })}
      </div>
      <SectionHeader title="Daily Call Volume" subtitle="Last 30 days — total vs answered" icon="📊" />
      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={dailyCalls}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
            <XAxis dataKey="date" tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} interval={4} />
            <YAxis tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            {STORE_KEYS.map((key) => (storeFilter === "all" || storeFilter === key) ? <Area key={key} type="monotone" dataKey={`${key}_total`} name={`${STORES[key].name} Total`} stroke={STORES[key].color} fill={STORES[key].color + "18"} strokeWidth={2} dot={false} /> : null)}
            {STORE_KEYS.map((key) => (storeFilter === "all" || storeFilter === key) ? <Area key={`${key}_a`} type="monotone" dataKey={`${key}_answered`} name={`${STORES[key].name} Answered`} stroke={STORES[key].color} fill={STORES[key].color + "08"} strokeWidth={1} strokeDasharray="4 4" dot={false} /> : null)}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KeywordsTab({ keywords }) {
  const [cat, setCat] = useState("All");
  const categories = ["All", ...new Set(keywords.map(k => k.category))];
  const filtered = useMemo(() => {
    let kw = keywords;
    if (cat !== "All") kw = kw.filter(k => k.category === cat);
    return [...kw].sort((a, b) => STORE_KEYS.reduce((s, k) => s + (b[k]||0), 0) - STORE_KEYS.reduce((s, k) => s + (a[k]||0), 0));
  }, [cat, keywords]);
  const catColors = { Service: "#7C8AFF", Sales: "#4ADE80", Support: "#FBBF24", Operations: "#C084FC", Problem: "#F87171" };
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {categories.map(c => <button key={c} onClick={() => setCat(c)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", background: cat === c ? "#7C8AFF22" : "#1A1D23", color: cat === c ? "#7C8AFF" : "#8B8F98", fontSize: 12, fontWeight: 600 }}>{c}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
          <SectionHeader title="Keyword Frequency" subtitle="Mentions detected via Dialpad AI" icon="🏷️" />
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid #2A2D35" }}>
                <th style={{ textAlign: "left", padding: "8px 10px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Keyword</th>
                <th style={{ textAlign: "left", padding: "8px 6px", color: "#6B6F78", fontSize: 10 }}>Cat</th>
                {STORE_KEYS.map(k => <th key={k} style={{ textAlign: "right", padding: "8px 6px", color: STORES[k].color, fontSize: 10 }}>{STORES[k].icon}</th>)}
                <th style={{ textAlign: "right", padding: "8px 10px", color: "#8B8F98", fontSize: 10 }}>Total</th>
              </tr></thead>
              <tbody>{filtered.map((k, i) => {
                const total = STORE_KEYS.reduce((s, sk) => s + (k[sk]||0), 0);
                return (<tr key={i} style={{ borderBottom: "1px solid #1E2028" }}>
                  <td style={{ padding: "10px 10px", color: "#E8E9EC", fontSize: 13, fontWeight: 600 }}>{k.keyword}</td>
                  <td style={{ padding: "10px 6px" }}><span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: (catColors[k.category]||"#8B8F98")+"18", color: catColors[k.category]||"#8B8F98", fontWeight: 600 }}>{k.category}</span></td>
                  {STORE_KEYS.map(sk => <td key={sk} style={{ textAlign: "right", padding: "10px 6px", color: "#C8CAD0", fontSize: 13 }}>{k[sk]||0}</td>)}
                  <td style={{ textAlign: "right", padding: "10px 10px", color: "#F0F1F3", fontSize: 13, fontWeight: 700 }}>{total}</td>
                </tr>);
              })}</tbody>
            </table>
          </div>
        </div>
        <div>
          <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
            <SectionHeader title="Top Keywords by Store" icon="📊" />
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filtered.slice(0, 8)} layout="vertical" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="keyword" tick={{ fill: "#8B8F98", fontSize: 10 }} width={110} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  {STORE_KEYS.map(k => <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[0,4,4,0]} barSize={8} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MissedTab({ storeFilter, overviewStats, hourlyMissed, dowData, callbackData }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STORE_KEYS.length}, 1fr)`, gap: 14, marginBottom: 28 }}>
        {Object.entries(STORES).map(([key, store]) => {
          const cb = callbackData.find(c => c.store === key) || { missed: 0 };
          return <StatCard key={key} label={`${store.name} Missed`} value={cb.missed} accent={store.color}
            sub={overviewStats.storeStats[key].total ? `${((cb.missed / overviewStats.storeStats[key].total) * 100).toFixed(1)}% miss rate` : ""} />;
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
          <SectionHeader title="Missed Calls by Hour" icon="🕐" />
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyMissed} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
                <XAxis dataKey="hour" tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                {STORE_KEYS.map(k => (storeFilter==="all"||storeFilter===k) ? <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[4,4,0,0]} barSize={14} /> : null)}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
          <SectionHeader title="Missed Calls by Day of Week" icon="📅" />
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={dowData} cx="50%" cy="50%" outerRadius={100}>
                <PolarGrid stroke="#2A2D35" />
                <PolarAngleAxis dataKey="day" tick={{ fill: "#8B8F98", fontSize: 11 }} />
                <PolarRadiusAxis tick={{ fill: "#6B6F78", fontSize: 9 }} axisLine={false} />
                {STORE_KEYS.map(k => (storeFilter==="all"||storeFilter===k) ? <Radar key={k} name={STORES[k].name.replace("CPR ","")} dataKey={k} stroke={STORES[k].color} fill={STORES[k].color} fillOpacity={0.15} strokeWidth={2} /> : null)}
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#8B8F98" }} />
                <Tooltip content={<CustomTooltip />} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function CallbacksTab({ callbackData }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${STORE_KEYS.length}, 1fr)`, gap: 14, marginBottom: 28 }}>
        {callbackData.map(cb => {
          const store = STORES[cb.store]; if (!store) return null;
          const rate = cb.missed > 0 ? ((cb.calledBack / cb.missed) * 100).toFixed(1) : "0.0";
          return (
            <div key={cb.store} style={{ background: "#1A1D23", borderRadius: 12, padding: 20, border: `1px solid ${store.color}33` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ color: "#F0F1F3", fontSize: 15, fontWeight: 700 }}>{store.name}</div>
                <div style={{ padding: "4px 10px", borderRadius: 6, background: parseFloat(rate)>=80?"#4ADE8022":parseFloat(rate)>=60?"#FBBF2422":"#F8717122", color: parseFloat(rate)>=80?"#4ADE80":parseFloat(rate)>=60?"#FBBF24":"#F87171", fontSize: 14, fontWeight: 700 }}>{rate}%</div>
              </div>
              {[{label:"Within 30 min",value:cb.within30,color:"#4ADE80"},{label:"30–60 min",value:cb.within60,color:"#FBBF24"},{label:"60+ min",value:cb.later,color:"#FB923C"},{label:"Never called back",value:cb.never,color:"#F87171"}].map((item,i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "#8B8F98", fontSize: 11 }}>{item.label}</span>
                    <span style={{ color: item.color, fontSize: 12, fontWeight: 700 }}>{item.value}</span>
                  </div>
                  <div style={{ background: "#12141A", borderRadius: 4, height: 6, overflow: "hidden" }}>
                    <div style={{ width: cb.missed>0?`${(item.value/cb.missed)*100}%`:"0%", height: "100%", background: item.color, borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
        <SectionHeader title="Callback Performance Comparison" icon="⏱️" />
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={callbackData.map(cb => ({ store: (STORES[cb.store]?.name||cb.store).replace("CPR ",""), "< 30 min": cb.within30, "30–60 min": cb.within60, "60+ min": cb.later, "Never": cb.never }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
              <XAxis dataKey="store" tick={{ fill: "#8B8F98", fontSize: 12 }} tickLine={false} />
              <YAxis tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="< 30 min" stackId="a" fill="#4ADE80" />
              <Bar dataKey="30–60 min" stackId="a" fill="#FBBF24" />
              <Bar dataKey="60+ min" stackId="a" fill="#FB923C" />
              <Bar dataKey="Never" stackId="a" fill="#F87171" radius={[4,4,0,0]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ProblemsTab({ overviewStats, problemCalls }) {
  const totalProblems = problemCalls.reduce((sum, p) => sum + STORE_KEYS.reduce((s, k) => s + (p[k]||0), 0), 0);
  const worstStore = STORE_KEYS.reduce((worst, k) => { const t = problemCalls.reduce((s,p)=>s+(p[k]||0),0); return t>worst.total?{key:k,total:t}:worst; }, {key:"",total:0});
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Problem Calls" value={totalProblems} accent="#F87171" sub="last 7 days" />
        <StatCard label="% of All Calls" value={overviewStats.totals.total>0?`${((totalProblems/overviewStats.totals.total)*100).toFixed(1)}%`:"0%"} accent="#FB923C" />
        <StatCard label="Top Issue" value={problemCalls[0]?.type?.split(" (")[0]||"N/A"} accent="#C084FC" />
        <StatCard label="Worst Store" value={STORES[worstStore.key]?.name.replace("CPR ","")||"N/A"} accent={STORES[worstStore.key]?.color||"#8B8F98"} sub={`${worstStore.total} problem calls`} />
      </div>
      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
        <SectionHeader title="Problem Call Types" icon="🔥" />
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={problemCalls} layout="vertical" barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="type" tick={{ fill: "#8B8F98", fontSize: 10 }} width={140} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              {STORE_KEYS.map(k => <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[0,4,4,0]} barSize={10} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AUDIT TAB — Persistent Phone Call Quality Scoring
// ═══════════════════════════════════════════════════════════════

function AuditTab({ rawCallData, storeFilter }) {
  const [audits, setAudits] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [storePerf, setStorePerf] = useState([]);
  const [auditingId, setAuditingId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [auditView, setAuditView] = useState("overview"); // overview | calls | employee

  // Load persisted audit data from Supabase
  useEffect(() => {
    async function loadAuditData() {
      setLoading(true);
      try {
        const storeParam = storeFilter !== "all" ? `&store=${storeFilter}` : "";
        const [auditsRes, employeesRes, storesRes] = await Promise.all([
          fetch(`/api/dialpad/audit?limit=200&days=30${storeParam}`).then(r => r.json()),
          fetch(`/api/dialpad/audit?action=employees${storeParam}`).then(r => r.json()),
          fetch(`/api/dialpad/audit?action=stores`).then(r => r.json()),
        ]);
        if (auditsRes.success) setAudits(auditsRes.audits || []);
        if (employeesRes.success) setEmployees(employeesRes.employees || []);
        if (storesRes.success) setStorePerf(storesRes.stores || []);
      } catch (err) {
        console.error("Failed to load audit data:", err);
      }
      setLoading(false);
    }
    loadAuditData();
  }, [storeFilter]);

  // Recorded calls available for manual audit
  const recordedCalls = useMemo(() => {
    const auditedIds = new Set(audits.map(a => a.call_id));
    return rawCallData
      .filter(r => r.target_type === "department" && r.was_recorded === "true" && r.direction === "inbound")
      .filter(r => storeFilter === "all" || r._storeKey === storeFilter)
      .filter(r => !auditedIds.has(r.call_id))
      .sort((a, b) => new Date(b.date_started) - new Date(a.date_started))
      .slice(0, 30);
  }, [rawCallData, storeFilter, audits]);

  const runAudit = async (call) => {
    setAuditingId(call.call_id);
    setError(null);
    try {
      const res = await fetch("/api/dialpad/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callId: call.call_id,
          callInfo: { direction: call.direction, external_number: call.external_number, date_started: call.date_started, name: call.name, _storeKey: call._storeKey, talk_duration: call.talk_duration },
        }),
      });
      const json = await res.json();
      if (json.success && json.audit) {
        // Add to local state immediately
        setAudits(prev => [{
          ...json.audit,
          call_id: call.call_id,
          date_started: call.date_started,
          store: json.audit.store,
          phone: call.external_number,
        }, ...prev]);
      } else {
        setError(json.error || "Audit failed");
      }
    } catch (err) {
      setError(err.message);
    }
    setAuditingId(null);
  };

  // Computed stats
  const totalAudits = audits.length;
  const avgScore = totalAudits > 0 ? (audits.reduce((s, a) => s + parseFloat(a.score || 0), 0) / totalAudits).toFixed(2) : "—";
  const criteriaRates = totalAudits > 0 ? {
    appt: ((audits.filter(a => a.appt_offered).length / totalAudits) * 100).toFixed(0),
    disc: ((audits.filter(a => a.discount_mentioned).length / totalAudits) * 100).toFixed(0),
    warr: ((audits.filter(a => a.warranty_mentioned).length / totalAudits) * 100).toFixed(0),
    turn: ((audits.filter(a => a.faster_turnaround).length / totalAudits) * 100).toFixed(0),
  } : null;

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>
        <div style={{ fontSize: 24, marginBottom: 8, animation: "pulse 1.5s infinite" }}>🎯</div>
        Loading audit data...
      </div>
    );
  }

  return (
    <div>
      {/* Sub-navigation */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {[
          { id: "overview", label: "Overview", icon: "📊" },
          { id: "employees", label: "Employee Scores", icon: "👤" },
          { id: "calls", label: "Audit Calls", icon: "🎙️" },
          { id: "history", label: "Audit History", icon: "📋" },
        ].map(v => (
          <button key={v.id} onClick={() => setAuditView(v.id)} style={{
            padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer",
            background: auditView === v.id ? "#7C8AFF22" : "#1A1D23",
            color: auditView === v.id ? "#7C8AFF" : "#8B8F98",
            fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
          }}>{v.icon} {v.label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {auditView === "overview" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
            <StatCard label="Calls Audited" value={totalAudits} accent="#7C8AFF" sub="last 30 days" />
            <StatCard label="Avg Score" value={`${avgScore} / 4`} accent={parseFloat(avgScore) >= 3 ? "#4ADE80" : parseFloat(avgScore) >= 2 ? "#FBBF24" : "#F87171"} />
            <StatCard label="Unaudited Recorded" value={recordedCalls.length} accent="#C084FC" sub="available to score" />
            <StatCard label="Best Criteria" value={criteriaRates ? (parseInt(criteriaRates.appt) >= parseInt(criteriaRates.disc) && parseInt(criteriaRates.appt) >= parseInt(criteriaRates.warr) && parseInt(criteriaRates.appt) >= parseInt(criteriaRates.turn) ? "Appt Offer" : parseInt(criteriaRates.warr) >= parseInt(criteriaRates.disc) && parseInt(criteriaRates.warr) >= parseInt(criteriaRates.turn) ? "Warranty" : parseInt(criteriaRates.disc) >= parseInt(criteriaRates.turn) ? "Discount" : "Fast Turn.") : "—"} accent="#4ADE80" />
          </div>

          {/* Criteria pass rates */}
          {criteriaRates && (
            <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <SectionHeader title="Criteria Pass Rates" subtitle="Across all audited calls" icon="📋" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                {[
                  { label: "Appointment Offered", rate: criteriaRates.appt, pts: "1.25 pts" },
                  { label: "Discount Mentioned", rate: criteriaRates.disc, pts: "0.92 pts" },
                  { label: "Lifetime Warranty", rate: criteriaRates.warr, pts: "0.92 pts" },
                  { label: "Faster Turnaround", rate: criteriaRates.turn, pts: "0.92 pts" },
                ].map((item, i) => (
                  <div key={i}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ color: "#C8CAD0", fontSize: 12 }}>{item.label}</span>
                      <span style={{ color: parseInt(item.rate)>=70?"#4ADE80":parseInt(item.rate)>=40?"#FBBF24":"#F87171", fontSize: 13, fontWeight: 700 }}>{item.rate}%</span>
                    </div>
                    <div style={{ background: "#12141A", borderRadius: 4, height: 8, overflow: "hidden" }}>
                      <div style={{ width: `${item.rate}%`, height: "100%", borderRadius: 4, background: parseInt(item.rate)>=70?"#4ADE80":parseInt(item.rate)>=40?"#FBBF24":"#F87171" }} />
                    </div>
                    <div style={{ color: "#6B6F78", fontSize: 10, marginTop: 4 }}>{item.pts}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Store performance cards */}
          {storePerf.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${storePerf.length}, 1fr)`, gap: 14 }}>
              {storePerf.map(sp => {
                const store = STORES[sp.store];
                if (!store) return null;
                const scoreColor = sp.avg_score >= 3 ? "#4ADE80" : sp.avg_score >= 2 ? "#FBBF24" : "#F87171";
                return (
                  <div key={sp.store} style={{ background: "#1A1D23", borderRadius: 12, padding: 20, border: `1px solid ${store.color}33` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: store.color + "22", display: "flex", alignItems: "center", justifyContent: "center", color: store.color, fontWeight: 800, fontSize: 14 }}>{store.icon}</div>
                        <div>
                          <div style={{ color: "#F0F1F3", fontSize: 14, fontWeight: 700 }}>{store.name}</div>
                          <div style={{ color: "#6B6F78", fontSize: 11 }}>{sp.total_audits} audited</div>
                        </div>
                      </div>
                      <div style={{ padding: "6px 12px", borderRadius: 8, background: scoreColor + "22", color: scoreColor, fontSize: 18, fontWeight: 800 }}>
                        {parseFloat(sp.avg_score).toFixed(2)}
                      </div>
                    </div>
                    {[
                      { label: "Appt Offered", rate: sp.appt_rate },
                      { label: "Discount", rate: sp.discount_rate },
                      { label: "Warranty", rate: sp.warranty_rate },
                      { label: "Fast Turn.", rate: sp.turnaround_rate },
                    ].map((item, i) => (
                      <div key={i} style={{ marginTop: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ color: "#8B8F98", fontSize: 11 }}>{item.label}</span>
                          <span style={{ color: parseFloat(item.rate)>=70?"#4ADE80":parseFloat(item.rate)>=40?"#FBBF24":"#F87171", fontSize: 11, fontWeight: 700 }}>{parseFloat(item.rate).toFixed(0)}%</span>
                        </div>
                        <div style={{ background: "#12141A", borderRadius: 4, height: 6, overflow: "hidden" }}>
                          <div style={{ width: `${item.rate}%`, height: "100%", background: parseFloat(item.rate)>=70?"#4ADE80":parseFloat(item.rate)>=40?"#FBBF24":"#F87171", borderRadius: 4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {totalAudits === 0 && (
            <div style={{ background: "#1A1D23", borderRadius: 12, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
              <div style={{ color: "#F0F1F3", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No audits yet</div>
              <div style={{ color: "#6B6F78", fontSize: 13 }}>Go to "Audit Calls" to score your first call, or wait for the hourly auto-audit to run.</div>
            </div>
          )}
        </div>
      )}

      {/* ── EMPLOYEE SCORES ── */}
      {auditView === "employees" && (
        <div>
          <SectionHeader title="Employee Leaderboard" subtitle="Ranked by average audit score" icon="🏆" />
          {employees.length > 0 ? (
            <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid #2A2D35" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Rank</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Employee</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Store</th>
                  <th style={{ textAlign: "center", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Calls</th>
                  <th style={{ textAlign: "center", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Avg Score</th>
                  <th style={{ textAlign: "center", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Appt %</th>
                  <th style={{ textAlign: "center", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Disc %</th>
                  <th style={{ textAlign: "center", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Warr %</th>
                  <th style={{ textAlign: "center", padding: "10px 12px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Turn %</th>
                </tr></thead>
                <tbody>
                  {employees.sort((a, b) => b.avg_score - a.avg_score).map((emp, i) => {
                    const store = STORES[emp.store];
                    const scoreColor = emp.avg_score >= 3 ? "#4ADE80" : emp.avg_score >= 2 ? "#FBBF24" : "#F87171";
                    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
                    return (
                      <tr key={`${emp.employee}-${emp.store}`} style={{ borderBottom: "1px solid #1E2028" }}>
                        <td style={{ padding: "12px", fontSize: 16 }}>{medal}</td>
                        <td style={{ padding: "12px", color: "#F0F1F3", fontSize: 14, fontWeight: 700 }}>{emp.employee}</td>
                        <td style={{ padding: "12px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: store?.color || "#8B8F98", fontSize: 12, fontWeight: 600 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: store?.color }} />
                            {store?.name?.replace("CPR ", "") || emp.store}
                          </span>
                        </td>
                        <td style={{ textAlign: "center", padding: "12px", color: "#C8CAD0", fontSize: 13 }}>{emp.total_calls}</td>
                        <td style={{ textAlign: "center", padding: "12px" }}>
                          <span style={{ padding: "4px 10px", borderRadius: 6, background: scoreColor + "22", color: scoreColor, fontSize: 14, fontWeight: 800 }}>
                            {parseFloat(emp.avg_score).toFixed(2)}
                          </span>
                        </td>
                        {["appt_rate", "discount_rate", "warranty_rate", "turnaround_rate"].map(key => {
                          const val = parseFloat(emp[key]);
                          return (
                            <td key={key} style={{ textAlign: "center", padding: "12px", color: val >= 70 ? "#4ADE80" : val >= 40 ? "#FBBF24" : "#F87171", fontSize: 13, fontWeight: 600 }}>
                              {val.toFixed(0)}%
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ background: "#1A1D23", borderRadius: 12, padding: 40, textAlign: "center", color: "#6B6F78" }}>
              No employee data yet. Audit some calls to build the leaderboard.
            </div>
          )}

          {/* Employee score chart */}
          {employees.length > 0 && (
            <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginTop: 20 }}>
              <SectionHeader title="Score Comparison" icon="📊" />
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={employees.sort((a,b) => b.avg_score - a.avg_score).slice(0,10).map(e => ({
                    name: e.employee, score: parseFloat(e.avg_score),
                    appt: parseFloat(e.appt_rate), discount: parseFloat(e.discount_rate),
                    warranty: parseFloat(e.warranty_rate), turnaround: parseFloat(e.turnaround_rate),
                  }))} layout="vertical" barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
                    <XAxis type="number" domain={[0, 4]} tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fill: "#C8CAD0", fontSize: 12 }} width={100} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="score" name="Avg Score" fill="#7C8AFF" radius={[0,6,6,0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── AUDIT CALLS (manual) ── */}
      {auditView === "calls" && (
        <div>
          {error && <div style={{ padding: "8px 12px", borderRadius: 6, background: "#F8717122", color: "#F87171", fontSize: 12, marginBottom: 12 }}>{error}</div>}
          <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
            <SectionHeader title="Recorded Calls — Ready to Audit" subtitle={`${recordedCalls.length} unaudited calls available`} icon="🎙️" />
            <div style={{ maxHeight: 600, overflowY: "auto" }}>
              {recordedCalls.map((call, i) => {
                const isAuditing = auditingId === call.call_id;
                const d = new Date(call.date_started);
                const store = STORES[call._storeKey];
                return (
                  <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid #2A2D35", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: store?.color || "#8B8F98" }} />
                        <span style={{ color: "#E8E9EC", fontSize: 13, fontWeight: 600 }}>{call.external_number}</span>
                        <span style={{ color: "#6B6F78", fontSize: 11 }}>→ {call.name}</span>
                      </div>
                      <div style={{ color: "#6B6F78", fontSize: 11, marginTop: 2 }}>
                        {d.toLocaleDateString()} {d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · {call.talk_duration ? `${parseFloat(call.talk_duration).toFixed(1)} min` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => !isAuditing && runAudit(call)}
                      disabled={isAuditing}
                      style={{
                        padding: "6px 14px", borderRadius: 6, border: "none",
                        cursor: isAuditing ? "default" : "pointer",
                        background: isAuditing ? "#7C8AFF22" : "#7C8AFF",
                        color: isAuditing ? "#7C8AFF" : "#FFF",
                        fontSize: 12, fontWeight: 600,
                        animation: isAuditing ? "pulse 1.5s infinite" : "none",
                      }}
                    >
                      {isAuditing ? "Scoring..." : "Audit"}
                    </button>
                  </div>
                );
              })}
              {recordedCalls.length === 0 && (
                <div style={{ color: "#6B6F78", fontSize: 13, padding: 20, textAlign: "center" }}>
                  All recorded calls have been audited! New calls will be auto-scored every hour.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── AUDIT HISTORY ── */}
      {auditView === "history" && (
        <div>
          <SectionHeader title="Audit History" subtitle={`${audits.length} calls scored`} icon="📋" />
          <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
            <div style={{ maxHeight: 600, overflowY: "auto" }}>
              {audits.map((audit, i) => {
                const score = parseFloat(audit.score || 0);
                const scoreColor = score >= 3 ? "#4ADE80" : score >= 2 ? "#FBBF24" : "#F87171";
                const store = STORES[audit.store];
                const d = new Date(audit.date_started || audit.date);
                return (
                  <div key={audit.call_id || i} style={{ padding: 16, borderBottom: "1px solid #2A2D35" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <div>
                        <div style={{ color: "#E8E9EC", fontSize: 13, fontWeight: 700 }}>
                          {audit.employee || "Unknown"} — {audit.phone}
                        </div>
                        <div style={{ color: "#6B6F78", fontSize: 11 }}>
                          {d.toLocaleDateString()} {d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · <span style={{ color: store?.color }}>{store?.name || audit.store}</span>
                        </div>
                      </div>
                      <div style={{ padding: "6px 12px", borderRadius: 8, background: scoreColor + "22", color: scoreColor, fontSize: 16, fontWeight: 800 }}>
                        {score.toFixed(2)} / 4
                      </div>
                    </div>
                    <div style={{ color: "#C8CAD0", fontSize: 12, marginBottom: 8 }}>
                      <strong>Inquiry:</strong> {audit.inquiry || "—"}<br />
                      <strong>Outcome:</strong> {audit.outcome || "—"}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
                      {[
                        { key: "appt_offered", label: "Appt", notes: "appt_notes" },
                        { key: "discount_mentioned", label: "Discount", notes: "discount_notes" },
                        { key: "warranty_mentioned", label: "Warranty", notes: "warranty_notes" },
                        { key: "faster_turnaround", label: "Fast Turn.", notes: "turnaround_notes" },
                      ].map(({ key, label, notes }) => (
                        <div key={key} style={{ padding: "6px 8px", borderRadius: 6, background: audit[key] ? "#4ADE8012" : "#F8717112", border: `1px solid ${audit[key] ? "#4ADE8033" : "#F8717133"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ color: "#8B8F98", fontSize: 10 }}>{label}</span>
                            <span style={{ color: audit[key] ? "#4ADE80" : "#F87171", fontSize: 10, fontWeight: 700 }}>{audit[key] ? "PASS" : "FAIL"}</span>
                          </div>
                          <div style={{ color: "#6B6F78", fontSize: 9, marginTop: 2 }}>{audit[notes] || ""}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {audits.length === 0 && (
                <div style={{ color: "#6B6F78", fontSize: 13, padding: 20, textAlign: "center" }}>
                  No audit history yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ──

export default function DialpadDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [storeFilter, setStoreFilter] = useState("all");
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rawCallData, setRawCallData] = useState([]);

  const [dailyCalls, setDailyCalls] = useState(SAMPLE_DAILY_CALLS);
  const [hourlyMissed, setHourlyMissed] = useState(SAMPLE_HOURLY_MISSED);
  const [dowData, setDowData] = useState(SAMPLE_DOW_DATA);
  const [callbackData, setCallbackData] = useState(SAMPLE_CALLBACK_DATA);
  const [keywords, setKeywords] = useState(SAMPLE_KEYWORDS);
  const [problemCalls, setProblemCalls] = useState(SAMPLE_PROBLEM_CALLS);

  const loadLiveData = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchLiveStats();
      if (data && data.length > 0) {
        console.log("Live data received:", data.length, "records");
        setRawCallData(data);
        const daily = transformToDailyCalls(data);
        if (daily.length > 0) setDailyCalls(daily);
        const hourly = transformToHourlyMissed(data);
        if (hourly.some(h => STORE_KEYS.some(k => h[k] > 0))) setHourlyMissed(hourly);
        const dow = transformToDOWMissed(data);
        if (dow.some(d => STORE_KEYS.some(k => d[k] > 0))) setDowData(dow);
        const callbacks = transformToCallbackData(data);
        if (callbacks.some(c => c.missed > 0)) setCallbackData(callbacks);
        const problems = transformToProblemCalls(data);
        if (problems.some(p => STORE_KEYS.some(k => p[k] > 0))) setProblemCalls(problems);
        setIsLive(true);
      }
    } catch (err) { console.error("Failed to load live data:", err); }
    setIsLoading(false);
  }, []);

  useEffect(() => { loadLiveData(); }, [loadLiveData]);

  const overviewStats = useMemo(() => {
    const totals = { total: 0, answered: 0 }; const storeStats = {};
    STORE_KEYS.forEach(s => { storeStats[s] = { total: 0, answered: 0 }; });
    dailyCalls.forEach(d => { STORE_KEYS.forEach(s => {
      storeStats[s].total += d[`${s}_total`]||0; storeStats[s].answered += d[`${s}_answered`]||0;
      totals.total += d[`${s}_total`]||0; totals.answered += d[`${s}_answered`]||0;
    }); });
    return { totals, storeStats };
  }, [dailyCalls]);

  return (
    <div style={{ background: "#0F1117", minHeight: "100vh", color: "#F0F1F3", fontFamily: "'Space Grotesk', -apple-system, sans-serif" }}>
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
      <div style={{ background: "#12141A", borderBottom: "1px solid #1E2028", padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg, #7C8AFF, #C084FC)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📞</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>Dialpad Analytics</h1>
            <p style={{ margin: 0, color: "#6B6F78", fontSize: 12 }}>CPR Store Call Intelligence · Last 30 Days</p>
          </div>
        </div>
        <StoreToggle selected={storeFilter} onChange={setStoreFilter} />
      </div>
      <div style={{ background: "#12141A", borderBottom: "1px solid #1E2028", padding: "0 28px", display: "flex", gap: 0, overflowX: "auto" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: "14px 20px", border: "none", cursor: "pointer", background: "transparent",
            color: activeTab === tab.id ? "#F0F1F3" : "#6B6F78", fontSize: 13, fontWeight: 600,
            borderBottom: activeTab === tab.id ? "2px solid #7C8AFF" : "2px solid transparent",
            display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", fontFamily: "'Space Grotesk', sans-serif",
          }}><span style={{ fontSize: 14 }}>{tab.icon}</span>{tab.label}</button>
        ))}
      </div>
      <div style={{ padding: 28 }}>
        <DataBanner isLive={isLive} isLoading={isLoading} onRefresh={loadLiveData} />
        {activeTab === "overview"  && <OverviewTab storeFilter={storeFilter} overviewStats={overviewStats} dailyCalls={dailyCalls} />}
        {activeTab === "keywords"  && <KeywordsTab keywords={keywords} />}
        {activeTab === "missed"    && <MissedTab storeFilter={storeFilter} overviewStats={overviewStats} hourlyMissed={hourlyMissed} dowData={dowData} callbackData={callbackData} />}
        {activeTab === "callbacks" && <CallbacksTab callbackData={callbackData} />}
        {activeTab === "problems"  && <ProblemsTab overviewStats={overviewStats} problemCalls={problemCalls} />}
        {activeTab === "audit"     && <AuditTab rawCallData={rawCallData} storeFilter={storeFilter} />}
      </div>
      <div style={{ padding: "16px 28px", borderTop: "1px solid #1E2028", color: "#4A4D55", fontSize: 11, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
        {isLive ? "Live data from Dialpad API" : "Sample data"} · Focused Technologies LLC
      </div>
    </div>
  );
}

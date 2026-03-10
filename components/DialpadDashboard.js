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

const InsightBox = ({ color, title, children }) => (
  <div style={{
    marginTop: 20, background: color + "18", borderRadius: 12, padding: 16,
    border: `1px solid ${color}33`, display: "flex", gap: 12, alignItems: "flex-start",
  }}>
    <span style={{ fontSize: 20 }}>💡</span>
    <div>
      <div style={{ color, fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      <div style={{ color: "#C8CAD0", fontSize: 13, lineHeight: 1.5 }}>{children}</div>
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

// ── Tab Renderers ──

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
                <div style={{
                  width: 36, height: 36, borderRadius: 10, background: store.color + "22",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: store.color, fontWeight: 800, fontSize: 16,
                }}>{store.icon}</div>
                <div>
                  <div style={{ color: "#F0F1F3", fontSize: 15, fontWeight: 700 }}>{store.name}</div>
                  <div style={{ color: "#6B6F78", fontSize: 11 }}>{s.total} total calls</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ color: "#8B8F98", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Answered</div>
                  <div style={{ color: "#4ADE80", fontSize: 20, fontWeight: 700 }}>{s.answered}</div>
                </div>
                <div>
                  <div style={{ color: "#8B8F98", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Missed</div>
                  <div style={{ color: "#F87171", fontSize: 20, fontWeight: 700 }}>{s.total - s.answered}</div>
                </div>
                <div>
                  <div style={{ color: "#8B8F98", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>Rate</div>
                  <div style={{ color: store.color, fontSize: 20, fontWeight: 700 }}>{rate}%</div>
                </div>
              </div>
              <div style={{ marginTop: 12, background: "#12141A", borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div style={{ width: `${rate}%`, height: "100%", background: store.color, borderRadius: 6, transition: "width 0.6s ease" }} />
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
            {STORE_KEYS.map((key) => (storeFilter === "all" || storeFilter === key) ? (
              <Area key={key} type="monotone" dataKey={`${key}_total`} name={`${STORES[key].name} Total`} stroke={STORES[key].color} fill={STORES[key].color + "18"} strokeWidth={2} dot={false} />
            ) : null)}
            {STORE_KEYS.map((key) => (storeFilter === "all" || storeFilter === key) ? (
              <Area key={`${key}_a`} type="monotone" dataKey={`${key}_answered`} name={`${STORES[key].name} Answered`} stroke={STORES[key].color} fill={STORES[key].color + "08"} strokeWidth={1} strokeDasharray="4 4" dot={false} />
            ) : null)}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function KeywordsTab({ keywords }) {
  const [keywordCategory, setKeywordCategory] = useState("All");
  const categories = ["All", ...new Set(keywords.map(k => k.category))];

  const filtered = useMemo(() => {
    let kw = keywords;
    if (keywordCategory !== "All") kw = kw.filter(k => k.category === keywordCategory);
    return [...kw].sort((a, b) => {
      const totalA = STORE_KEYS.reduce((s, k) => s + (a[k] || 0), 0);
      const totalB = STORE_KEYS.reduce((s, k) => s + (b[k] || 0), 0);
      return totalB - totalA;
    });
  }, [keywordCategory, keywords]);

  const catColors = { Service: "#7C8AFF", Sales: "#4ADE80", Support: "#FBBF24", Operations: "#C084FC", Problem: "#F87171" };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {categories.map(c => (
          <button key={c} onClick={() => setKeywordCategory(c)} style={{
            padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
            background: keywordCategory === c ? "#7C8AFF22" : "#1A1D23",
            color: keywordCategory === c ? "#7C8AFF" : "#8B8F98", fontSize: 12, fontWeight: 600,
          }}>{c}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
          <SectionHeader title="Keyword Frequency" subtitle="Mentions detected via Dialpad AI" icon="🏷️" />
          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #2A2D35" }}>
                  <th style={{ textAlign: "left", padding: "8px 10px", color: "#6B6F78", fontSize: 10, textTransform: "uppercase" }}>Keyword</th>
                  <th style={{ textAlign: "left", padding: "8px 6px", color: "#6B6F78", fontSize: 10 }}>Cat</th>
                  {STORE_KEYS.map((k) => (
                    <th key={k} style={{ textAlign: "right", padding: "8px 6px", color: STORES[k].color, fontSize: 10 }}>{STORES[k].icon}</th>
                  ))}
                  <th style={{ textAlign: "right", padding: "8px 10px", color: "#8B8F98", fontSize: 10 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k, i) => {
                  const total = STORE_KEYS.reduce((s, sk) => s + (k[sk] || 0), 0);
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #1E2028" }}>
                      <td style={{ padding: "10px 10px", color: "#E8E9EC", fontSize: 13, fontWeight: 600 }}>{k.keyword}</td>
                      <td style={{ padding: "10px 6px" }}>
                        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: (catColors[k.category] || "#8B8F98") + "18", color: catColors[k.category] || "#8B8F98", fontWeight: 600 }}>{k.category}</span>
                      </td>
                      {STORE_KEYS.map((sk) => (
                        <td key={sk} style={{ textAlign: "right", padding: "10px 6px", color: "#C8CAD0", fontSize: 13 }}>{k[sk] || 0}</td>
                      ))}
                      <td style={{ textAlign: "right", padding: "10px 10px", color: "#F0F1F3", fontSize: 13, fontWeight: 700 }}>{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <SectionHeader title="Top Keywords by Store" icon="📊" />
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filtered.slice(0, 8)} layout="vertical" barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="keyword" tick={{ fill: "#8B8F98", fontSize: 10 }} width={110} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  {STORE_KEYS.map((k) => (
                    <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[0, 4, 4, 0]} barSize={8} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
            <SectionHeader title="Category Breakdown" icon="🎯" />
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={(() => {
                      const cats = {};
                      filtered.forEach(k => { const t = STORE_KEYS.reduce((s, sk) => s + (k[sk] || 0), 0); cats[k.category] = (cats[k.category] || 0) + t; });
                      return Object.entries(cats).map(([name, value]) => ({ name, value }));
                    })()}
                    cx="50%" cy="50%" outerRadius={60} innerRadius={30} paddingAngle={3} dataKey="value"
                  >
                    {(() => {
                      const cats = {};
                      filtered.forEach(k => { const t = STORE_KEYS.reduce((s, sk) => s + (k[sk] || 0), 0); cats[k.category] = (cats[k.category] || 0) + t; });
                      return Object.entries(cats).map(([name], i) => <Cell key={i} fill={catColors[name] || "#8B8F98"} />);
                    })()}
                  </Pie>
                  <Tooltip />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#8B8F98" }} />
                </PieChart>
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
          return (
            <StatCard key={key} label={`${store.name} Missed`} value={cb.missed} accent={store.color}
              sub={overviewStats.storeStats[key].total ? `${((cb.missed / overviewStats.storeStats[key].total) * 100).toFixed(1)}% miss rate` : ""} />
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
          <SectionHeader title="Missed Calls by Hour" subtitle="When are we losing the most calls?" icon="🕐" />
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyMissed} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
                <XAxis dataKey="hour" tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                {STORE_KEYS.map((k) => (storeFilter === "all" || storeFilter === k) ? (
                  <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[4, 4, 0, 0]} barSize={14} />
                ) : null)}
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
                {STORE_KEYS.map((k) => (storeFilter === "all" || storeFilter === k) ? (
                  <Radar key={k} name={STORES[k].name.replace("CPR ","")} dataKey={k} stroke={STORES[k].color} fill={STORES[k].color} fillOpacity={0.15} strokeWidth={2} />
                ) : null)}
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
          const store = STORES[cb.store];
          if (!store) return null;
          const rate = cb.missed > 0 ? ((cb.calledBack / cb.missed) * 100).toFixed(1) : "0.0";
          return (
            <div key={cb.store} style={{ background: "#1A1D23", borderRadius: 12, padding: 20, border: `1px solid ${store.color}33` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ color: "#F0F1F3", fontSize: 15, fontWeight: 700 }}>{store.name}</div>
                <div style={{
                  padding: "4px 10px", borderRadius: 6,
                  background: parseFloat(rate) >= 80 ? "#4ADE8022" : parseFloat(rate) >= 60 ? "#FBBF2422" : "#F8717122",
                  color: parseFloat(rate) >= 80 ? "#4ADE80" : parseFloat(rate) >= 60 ? "#FBBF24" : "#F87171",
                  fontSize: 14, fontWeight: 700,
                }}>{rate}% callback rate</div>
              </div>
              {[
                { label: "Within 30 min", value: cb.within30, color: "#4ADE80" },
                { label: "30–60 min",     value: cb.within60, color: "#FBBF24" },
                { label: "60+ min",       value: cb.later,    color: "#FB923C" },
                { label: "Never called back", value: cb.never, color: "#F87171" },
              ].map((item, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "#8B8F98", fontSize: 11 }}>{item.label}</span>
                    <span style={{ color: item.color, fontSize: 12, fontWeight: 700 }}>{item.value}</span>
                  </div>
                  <div style={{ background: "#12141A", borderRadius: 4, height: 6, overflow: "hidden" }}>
                    <div style={{ width: cb.missed > 0 ? `${(item.value / cb.missed) * 100}%` : "0%", height: "100%", background: item.color, borderRadius: 4 }} />
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
            <BarChart data={callbackData.map(cb => ({
              store: (STORES[cb.store]?.name || cb.store).replace("CPR ", ""),
              "< 30 min": cb.within30, "30–60 min": cb.within60,
              "60+ min": cb.later, "Never": cb.never,
            }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
              <XAxis dataKey="store" tick={{ fill: "#8B8F98", fontSize: 12 }} tickLine={false} />
              <YAxis tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="< 30 min" stackId="a" fill="#4ADE80" />
              <Bar dataKey="30–60 min" stackId="a" fill="#FBBF24" />
              <Bar dataKey="60+ min" stackId="a" fill="#FB923C" />
              <Bar dataKey="Never" stackId="a" fill="#F87171" radius={[4, 4, 0, 0]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function ProblemsTab({ overviewStats, problemCalls }) {
  const totalProblems = problemCalls.reduce((sum, p) => sum + STORE_KEYS.reduce((s, k) => s + (p[k] || 0), 0), 0);
  const worstStore = STORE_KEYS.reduce((worst, k) => {
    const total = problemCalls.reduce((s, p) => s + (p[k] || 0), 0);
    return total > worst.total ? { key: k, total } : worst;
  }, { key: "", total: 0 });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 28 }}>
        <StatCard label="Total Problem Calls" value={totalProblems} accent="#F87171" sub="last 30 days" />
        <StatCard label="% of All Calls" value={overviewStats.totals.total > 0 ? `${((totalProblems / overviewStats.totals.total) * 100).toFixed(1)}%` : "0%"} accent="#FB923C" />
        <StatCard label="Top Issue" value={problemCalls[0]?.type?.split(" (")[0] || "N/A"} accent="#C084FC" />
        <StatCard label="Worst Store" value={STORES[worstStore.key]?.name.replace("CPR ", "") || "N/A"} accent={STORES[worstStore.key]?.color || "#8B8F98"} sub={`${worstStore.total} problem calls`} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
          <SectionHeader title="Problem Call Types" icon="🔥" />
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={problemCalls} layout="vertical" barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#6B6F78", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="type" tick={{ fill: "#8B8F98", fontSize: 10 }} width={140} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                {STORE_KEYS.map((k) => (
                  <Bar key={k} dataKey={k} name={STORES[k].name.replace("CPR ","")} fill={STORES[k].color} radius={[0, 4, 4, 0]} barSize={10} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20 }}>
          <SectionHeader title="Problem Call Breakdown" icon="📋" />
          <div style={{ maxHeight: 340, overflowY: "auto" }}>
            {problemCalls.map((p, i) => {
              const total = STORE_KEYS.reduce((s, k) => s + (p[k] || 0), 0);
              const max = Math.max(...STORE_KEYS.map(k => p[k] || 0));
              return (
                <div key={i} style={{ padding: "14px 0", borderBottom: i < problemCalls.length - 1 ? "1px solid #2A2D35" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ color: "#E8E9EC", fontSize: 13, fontWeight: 600 }}>{p.type}</span>
                    <span style={{ color: "#F87171", fontSize: 13, fontWeight: 700 }}>{total} total</span>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {Object.entries(STORES).map(([key, store]) => (
                      <div key={key} style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ color: store.color, fontSize: 10, fontWeight: 600 }}>{store.icon}</span>
                          <span style={{ color: (p[key] || 0) === max ? "#F87171" : "#8B8F98", fontSize: 11, fontWeight: (p[key] || 0) === max ? 700 : 400 }}>{p[key] || 0}</span>
                        </div>
                        <div style={{ background: "#12141A", borderRadius: 3, height: 4, overflow: "hidden" }}>
                          <div style={{ width: max > 0 ? `${((p[key] || 0) / max) * 100}%` : "0%", height: "100%", background: (p[key] || 0) === max ? "#F87171" : store.color, borderRadius: 3 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ──

export default function DialpadDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [storeFilter, setStoreFilter] = useState("all");
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Data state — starts with sample data
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
        console.log("Sample record keys:", Object.keys(data[0]));
        console.log("Sample record:", data[0]);

        const daily = transformToDailyCalls(data);
        if (daily.length > 0) setDailyCalls(daily);

        const hourly = transformToHourlyMissed(data);
        if (hourly.some((h) => STORE_KEYS.some((k) => h[k] > 0))) setHourlyMissed(hourly);

        const dow = transformToDOWMissed(data);
        if (dow.some((d) => STORE_KEYS.some((k) => d[k] > 0))) setDowData(dow);

        const callbacks = transformToCallbackData(data);
        if (callbacks.some((c) => c.missed > 0)) setCallbackData(callbacks);

        const problems = transformToProblemCalls(data);
        if (problems.some((p) => STORE_KEYS.some((k) => p[k] > 0))) setProblemCalls(problems);

        setIsLive(true);
      }
    } catch (err) {
      console.error("Failed to load live data:", err);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadLiveData();
  }, [loadLiveData]);

  const overviewStats = useMemo(() => {
    const totals = { total: 0, answered: 0 };
    const storeStats = {};
    STORE_KEYS.forEach((s) => {
      storeStats[s] = { total: 0, answered: 0 };
    });
    dailyCalls.forEach((d) => {
      STORE_KEYS.forEach((s) => {
        storeStats[s].total += d[`${s}_total`] || 0;
        storeStats[s].answered += d[`${s}_answered`] || 0;
        totals.total += d[`${s}_total`] || 0;
        totals.answered += d[`${s}_answered`] || 0;
      });
    });
    return { totals, storeStats };
  }, [dailyCalls]);

  return (
    <div style={{ background: "#0F1117", minHeight: "100vh", color: "#F0F1F3", fontFamily: "'Space Grotesk', -apple-system, sans-serif" }}>
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
      {/* Header */}
      <div style={{ background: "#12141A", borderBottom: "1px solid #1E2028", padding: "16px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: "linear-gradient(135deg, #7C8AFF, #C084FC)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>📞</div>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em" }}>Dialpad Analytics</h1>
            <p style={{ margin: 0, color: "#6B6F78", fontSize: 12 }}>CPR Store Call Intelligence · Last 30 Days</p>
          </div>
        </div>
        <StoreToggle selected={storeFilter} onChange={setStoreFilter} />
      </div>
      {/* Tabs */}
      <div style={{ background: "#12141A", borderBottom: "1px solid #1E2028", padding: "0 28px", display: "flex", gap: 0, overflowX: "auto" }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: "14px 20px", border: "none", cursor: "pointer", background: "transparent",
            color: activeTab === tab.id ? "#F0F1F3" : "#6B6F78",
            fontSize: 13, fontWeight: 600,
            borderBottom: activeTab === tab.id ? "2px solid #7C8AFF" : "2px solid transparent",
            display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            <span style={{ fontSize: 14 }}>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>
      {/* Content */}
      <div style={{ padding: 28 }}>
        <DataBanner isLive={isLive} isLoading={isLoading} onRefresh={loadLiveData} />
        {activeTab === "overview"  && <OverviewTab storeFilter={storeFilter} overviewStats={overviewStats} dailyCalls={dailyCalls} />}
        {activeTab === "keywords"  && <KeywordsTab keywords={keywords} />}
        {activeTab === "missed"    && <MissedTab storeFilter={storeFilter} overviewStats={overviewStats} hourlyMissed={hourlyMissed} dowData={dowData} callbackData={callbackData} />}
        {activeTab === "callbacks" && <CallbacksTab callbackData={callbackData} />}
        {activeTab === "problems"  && <ProblemsTab overviewStats={overviewStats} problemCalls={problemCalls} />}
      </div>
      {/* Footer */}
      <div style={{ padding: "16px 28px", borderTop: "1px solid #1E2028", color: "#4A4D55", fontSize: 11, textAlign: "center", fontFamily: "'JetBrains Mono', monospace" }}>
        {isLive ? "Live data from Dialpad API" : "Sample data"} · Focused Technologies LLC
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

function scoreColor(s) { return s >= 80 ? "#4ADE80" : s >= 60 ? "#FBBF24" : s >= 40 ? "#FB923C" : "#F87171"; }
function scoreGrade(s) { return s >= 93 ? "A+" : s >= 90 ? "A" : s >= 87 ? "A-" : s >= 83 ? "B+" : s >= 80 ? "B" : s >= 77 ? "B-" : s >= 73 ? "C+" : s >= 70 ? "C" : s >= 67 ? "C-" : s >= 60 ? "D" : "F"; }
function fmt(n) { return "$" + parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

function ScoreRing({ score, size, strokeWidth, label, sublabel, color }) {
  var r = (size - strokeWidth) / 2;
  var circ = 2 * Math.PI * r;
  var offset = circ - (score / 100) * circ;
  var sc = color || scoreColor(score);
  return (
    <div style={{ textAlign: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1E2028" strokeWidth={strokeWidth} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={sc} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{ marginTop: -(size/2 + 14), position: "relative", zIndex: 1 }}>
        <div style={{ color: sc, fontSize: size > 100 ? 36 : 22, fontWeight: 800, lineHeight: 1 }}>{score}</div>
        <div style={{ color: "#8B8F98", fontSize: size > 100 ? 12 : 9, marginTop: 2 }}>{scoreGrade(score)}</div>
      </div>
      {label && <div style={{ color: "#F0F1F3", fontSize: 13, fontWeight: 700, marginTop: size > 100 ? 20 : 12 }}>{label}</div>}
      {sublabel && <div style={{ color: "#6B6F78", fontSize: 11, marginTop: 2 }}>{sublabel}</div>}
    </div>
  );
}

function CategoryBar({ label, score, weight, icon, details, expanded, onToggle }) {
  var sc = scoreColor(score);
  var weightPct = Math.round(weight * 100);
  return (
    <div style={{ background: "#1A1D23", borderRadius: 10, padding: 16, cursor: "pointer" }} onClick={onToggle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>{icon}</span>
          <div>
            <span style={{ color: "#F0F1F3", fontSize: 13, fontWeight: 700 }}>{label}</span>
            <span style={{ color: "#6B6F78", fontSize: 10, marginLeft: 8 }}>{weightPct}% weight</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: sc, fontSize: 20, fontWeight: 800 }}>{score}</span>
          <span style={{ color: "#6B6F78", fontSize: 11 }}>/100</span>
        </div>
      </div>
      <div style={{ background: "#12141A", borderRadius: 4, height: 6, overflow: "hidden" }}>
        <div style={{ width: score + "%", height: "100%", background: sc, borderRadius: 4, transition: "width 0.8s ease" }} />
      </div>
      {expanded && details && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #2A2D35", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {details.map(function(d, i) {
            return (
              <div key={i} style={{ background: "#12141A", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ color: "#8B8F98", fontSize: 9, textTransform: "uppercase" }}>{d.label}</div>
                <div style={{ color: d.color || "#F0F1F3", fontSize: 15, fontWeight: 700, marginTop: 2 }}>{d.value}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ScorecardTab({ storeFilter }) {
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [expandedCat, setExpandedCat] = useState(null);

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        var res = await fetch("/api/dialpad/scorecard?days=30");
        var json = await res.json();
        if (json.success) setData(json);
      } catch (e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>Calculating store scores...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>No scorecard data available.</div>;

  var ranked = data.ranked || [];
  var storeScores = data.scores || {};

  // Radar chart data
  var radarData = [
    { category: "Repairs", fullMark: 100 },
    { category: "Audit", fullMark: 100 },
    { category: "Calls", fullMark: 100 },
    { category: "Experience", fullMark: 100 },
  ];
  STORE_KEYS.forEach(function(sk) {
    var s = storeScores[sk];
    if (s) {
      radarData[0][sk] = s.categories.revenue.score;
      radarData[1][sk] = s.categories.audit.score;
      radarData[2][sk] = s.categories.calls.score;
      radarData[3][sk] = s.categories.experience.score;
    }
  });

  var filteredStores = storeFilter && storeFilter !== "all" ? [storeFilter] : STORE_KEYS;

  return (
    <div>
      {/* Overall Scores */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + Math.min(ranked.length, 3) + ",1fr)", gap: 20, marginBottom: 28 }}>
        {ranked.map(function(s, i) {
          var store = STORES[s.store];
          if (!store) return null;
          var medal = i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : "\uD83E\uDD49";
          return (
            <div key={s.store} style={{ background: "#1A1D23", borderRadius: 16, padding: 28, border: "2px solid " + (i === 0 ? store.color + "44" : "#1E2028"), textAlign: "center", position: "relative" }}>
              {i === 0 && <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#0F1117", padding: "2px 12px", borderRadius: 8, border: "1px solid " + store.color + "44" }}>
                <span style={{ color: store.color, fontSize: 11, fontWeight: 700 }}>TOP PERFORMER</span>
              </div>}
              <span style={{ fontSize: 28, display: "block", marginBottom: 8 }}>{medal}</span>
              <ScoreRing score={s.overall} size={140} strokeWidth={8} />
              <div style={{ color: store.color, fontSize: 18, fontWeight: 800, marginTop: 16 }}>{store.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 16 }}>
                {[
                  { label: "Repairs", score: s.categories.revenue.score, icon: "🔧" },
                  { label: "Audit", score: s.categories.audit.score, icon: "🎯" },
                  { label: "Calls", score: s.categories.calls.score, icon: "📞" },
                  { label: "CX", score: s.categories.experience.score, icon: "⭐" },
                ].map(function(cat) {
                  var c = scoreColor(cat.score);
                  return (
                    <div key={cat.label} style={{ background: "#12141A", borderRadius: 8, padding: "8px 4px" }}>
                      <div style={{ fontSize: 12 }}>{cat.icon}</div>
                      <div style={{ color: c, fontSize: 14, fontWeight: 800 }}>{cat.score}</div>
                      <div style={{ color: "#6B6F78", fontSize: 8, textTransform: "uppercase" }}>{cat.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Radar Comparison */}
      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>{"📊"}</span>
          <div>
            <h2 style={{ color: "#F0F1F3", fontSize: 17, fontWeight: 700, margin: 0 }}>Store Comparison</h2>
            <p style={{ color: "#6B6F78", fontSize: 12, margin: "2px 0 0" }}>Category scores across all stores</p>
          </div>
        </div>
        <div style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData}>
              <PolarGrid stroke="#2A2D35" />
              <PolarAngleAxis dataKey="category" tick={{ fill: "#8B8F98", fontSize: 12 }} />
              <PolarRadiusAxis tick={{ fill: "#6B6F78", fontSize: 9 }} domain={[0, 100]} axisLine={false} />
              {STORE_KEYS.map(function(sk) {
                var store = STORES[sk];
                return (storeFilter === "all" || storeFilter === sk) ? (
                  <Radar key={sk} name={store.name.replace("CPR ", "")} dataKey={sk}
                    stroke={store.color} fill={store.color} fillOpacity={0.12} strokeWidth={2} />
                ) : null;
              })}
              <Tooltip contentStyle={{ background: "#1E2028", border: "1px solid #2A2D35", borderRadius: 8 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 8 }}>
          {STORE_KEYS.map(function(sk) {
            var store = STORES[sk];
            return (
              <div key={sk} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: store.color }} />
                <span style={{ color: "#8B8F98", fontSize: 11 }}>{store.name.replace("CPR ", "")}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-Store Category Breakdowns */}
      {filteredStores.map(function(sk) {
        var s = storeScores[sk];
        if (!s) return null;
        var store = STORES[sk];
        var cats = s.categories;
        return (
          <div key={sk} style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: store.color + "22", display: "flex", alignItems: "center", justifyContent: "center", color: store.color, fontWeight: 800, fontSize: 13 }}>{store.icon}</div>
              <div style={{ color: "#F0F1F3", fontSize: 16, fontWeight: 700 }}>{store.name}</div>
              <div style={{ padding: "3px 10px", borderRadius: 6, background: scoreColor(s.overall) + "22", color: scoreColor(s.overall), fontSize: 14, fontWeight: 800 }}>{s.overall}/100</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <CategoryBar label="Repairs & Production" score={cats.revenue.score} weight={cats.revenue.weight} icon="🔧"
                expanded={expandedCat === sk + "_revenue"} onToggle={function() { setExpandedCat(expandedCat === sk + "_revenue" ? null : sk + "_revenue"); }}
                details={[
                  { label: "Repair Tickets", value: cats.revenue.details.repair_tickets + " / " + cats.revenue.details.repair_target, color: cats.revenue.details.repair_tickets >= cats.revenue.details.repair_target ? "#4ADE80" : "#FBBF24" },
                  { label: "Accessory GP", value: fmt(cats.revenue.details.accy_gp), color: cats.revenue.details.accy_gp >= cats.revenue.details.accy_gp_target ? "#4ADE80" : "#FBBF24" },
                  { label: "Cleanings", value: cats.revenue.details.clean_count + " / " + cats.revenue.details.clean_target },
                ]} />
              <CategoryBar label="Phone Audit" score={cats.audit.score} weight={cats.audit.weight} icon="🎯"
                expanded={expandedCat === sk + "_audit"} onToggle={function() { setExpandedCat(expandedCat === sk + "_audit" ? null : sk + "_audit"); }}
                details={[
                  { label: "Avg Score", value: cats.audit.details.avg_score_pct + "%", color: scoreColor(cats.audit.details.avg_score_pct) },
                  { label: "Appt Rate", value: cats.audit.details.appt_rate + "%", color: cats.audit.details.appt_rate >= 70 ? "#4ADE80" : "#F87171" },
                  { label: "Warranty Rate", value: cats.audit.details.warranty_rate + "%", color: cats.audit.details.warranty_rate >= 70 ? "#4ADE80" : "#F87171" },
                ]} />
              <CategoryBar label="Call Handling" score={cats.calls.score} weight={cats.calls.weight} icon="📞"
                expanded={expandedCat === sk + "_calls"} onToggle={function() { setExpandedCat(expandedCat === sk + "_calls" ? null : sk + "_calls"); }}
                details={[
                  { label: "Answer Rate", value: cats.calls.details.answer_rate + "%", color: cats.calls.details.answer_rate >= 80 ? "#4ADE80" : "#F87171" },
                  { label: "Callback Rate", value: cats.calls.details.callback_rate + "%", color: cats.calls.details.callback_rate >= 80 ? "#4ADE80" : "#FBBF24" },
                  { label: "VM Return", value: cats.calls.details.vm_return_rate + "%" },
                ]} />
              <CategoryBar label="Customer Experience" score={cats.experience.score} weight={cats.experience.weight} icon="⭐"
                expanded={expandedCat === sk + "_exp"} onToggle={function() { setExpandedCat(expandedCat === sk + "_exp" ? null : sk + "_exp"); }}
                details={[
                  { label: "Miss Rate", value: cats.experience.details.miss_rate + "%", color: cats.experience.details.miss_rate <= 15 ? "#4ADE80" : "#F87171" },
                  { label: "Urgent VMs", value: cats.experience.details.urgent_vms, color: cats.experience.details.urgent_vms === 0 ? "#4ADE80" : "#F87171" },
                  { label: "Total Calls", value: cats.experience.details.total_calls },
                ]} />
            </div>
          </div>
        );
      })}

      {/* Scoring Methodology */}
      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginTop: 8 }}>
        <div style={{ color: "#6B6F78", fontSize: 11 }}>
          <strong style={{ color: "#8B8F98" }}>Scoring methodology:</strong> Repairs & Production (35% — repair ticket qty, accessory GP, cleanings) + Phone Audit Quality (30%) + Call Handling (20%) + Customer Experience (15%) = Overall Score. Each category is scored 0-100 against monthly targets. Click any category to see details.
        </div>
      </div>
    </div>
  );
}

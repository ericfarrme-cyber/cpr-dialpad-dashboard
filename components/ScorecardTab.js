'use client';

import { useState, useEffect } from "react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

function scoreColor(s) { return s >= 80 ? "#4ADE80" : s >= 60 ? "#FBBF24" : s >= 40 ? "#FB923C" : "#F87171"; }
function scoreGrade(s) { return s >= 93 ? "A+" : s >= 90 ? "A" : s >= 87 ? "A-" : s >= 83 ? "B+" : s >= 80 ? "B" : s >= 77 ? "B-" : s >= 73 ? "C+" : s >= 70 ? "C" : s >= 67 ? "C-" : s >= 60 ? "D" : "F"; }
function fmt(n) { return "$" + parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

function ScoreRing({ score, size, strokeWidth, color }) {
  var r = (size - strokeWidth) / 2;
  var circ = 2 * Math.PI * r;
  var offset = circ - (score / 100) * circ;
  var sc = color || scoreColor(score);
  return (
    <div style={{ position: "relative", width: size, height: size, display: "inline-block" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1E2028" strokeWidth={strokeWidth} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={sc} strokeWidth={strokeWidth}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{ position: "absolute", top: 0, left: 0, width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: sc, fontSize: size > 100 ? 32 : size > 60 ? 18 : 14, fontWeight: 800, lineHeight: 1 }}>{score}</div>
        <div style={{ color: "#8B8F98", fontSize: size > 100 ? 11 : 8, marginTop: 2 }}>{scoreGrade(score)}</div>
      </div>
    </div>
  );
}

function MiniBar({ value, max, color }) {
  var pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ background: "#12141A", borderRadius: 3, height: 4, overflow: "hidden", marginTop: 3 }}>
      <div style={{ width: pct + "%", height: "100%", background: color || scoreColor(pct), borderRadius: 3 }} />
    </div>
  );
}

export default function ScorecardTab({ storeFilter }) {
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [expandedEmp, setExpandedEmp] = useState(null);

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

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>Calculating scores...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>No scorecard data available.</div>;

  var empScores = data.employeeScores || [];
  var ranked = data.ranked || [];
  var storeScores = data.scores || {};

  var filteredEmps = storeFilter && storeFilter !== "all"
    ? empScores.filter(function(e) { return e.store === storeFilter; })
    : empScores;

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

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>{"\uD83C\uDFC6"}</span>
        <div>
          <h2 style={{ color: "#F0F1F3", fontSize: 17, fontWeight: 700, margin: 0 }}>Employee Scorecard</h2>
          <p style={{ color: "#6B6F78", fontSize: 12, margin: "2px 0 0" }}>Scored on Repairs & Production (50%) + Phone Audit Quality (50%)</p>
        </div>
      </div>

      {filteredEmps.length > 0 ? (
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginBottom: 28 }}>
          {filteredEmps.map(function(emp, i) {
            var sc = scoreColor(emp.overall);
            var medal = i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : i === 2 ? "\uD83E\uDD49" : "#" + (i + 1);
            var store = STORES[emp.store];
            var isExpanded = expandedEmp === emp.name;
            return (
              <div key={emp.name} style={{ borderBottom: "1px solid #1E2028" }}>
                <div onClick={function() { setExpandedEmp(isExpanded ? null : emp.name); }}
                  style={{ padding: "14px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", background: isExpanded ? "#12141A" : "transparent" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <span style={{ fontSize: 18, width: 28, textAlign: "center" }}>{medal}</span>
                    <ScoreRing score={emp.overall} size={48} strokeWidth={4} />
                    <div style={{ minWidth: 120 }}>
                      <div style={{ color: "#F0F1F3", fontSize: 14, fontWeight: 700 }}>{emp.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {store && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: store.color }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: store.color }} />
                          {store.name.replace("CPR ", "")}
                        </span>}
                        {emp.role && <span style={{ color: "#6B6F78", fontSize: 10 }}>{emp.role}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: "#8B8F98", fontSize: 9, textTransform: "uppercase" }}>Repairs</div>
                      <div style={{ color: scoreColor(emp.repairs.score), fontSize: 14, fontWeight: 700 }}>{emp.repairs.score}</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: "#8B8F98", fontSize: 9, textTransform: "uppercase" }}>Audit</div>
                      <div style={{ color: scoreColor(emp.audit.score), fontSize: 14, fontWeight: 700 }}>{emp.audit.score}</div>
                    </div>
                    <div style={{ padding: "6px 14px", borderRadius: 8, background: sc + "22", color: sc, fontSize: 18, fontWeight: 800 }}>
                      {emp.overall}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: "0 12px 20px 56px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 8 }}>
                      <div style={{ background: "#0F1117", borderRadius: 10, padding: 16, border: "1px solid #7B2FFF22" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ color: "#7B2FFF", fontSize: 12, fontWeight: 700 }}>{"\uD83D\uDD27 Repairs & Production"}</div>
                          <div style={{ color: scoreColor(emp.repairs.score), fontSize: 16, fontWeight: 800 }}>{emp.repairs.score + "/100"}</div>
                        </div>
                        {[
                          { label: "Phone Repairs", value: emp.repairs.phone_tickets, target: 20, weight: "25%" },
                          { label: "Other Repairs", value: emp.repairs.other_tickets },
                          { label: "Accessory GP", value: fmt(emp.repairs.accy_gp), raw: emp.repairs.accy_gp, target: 200, weight: "50%", isMoney: true },
                          { label: "Cleanings", value: emp.repairs.clean_count, target: 4, weight: "25%" },
                        ].map(function(item, j) {
                          var pctOfTarget = item.target ? ((item.isMoney ? item.raw : item.value) / item.target) * 100 : null;
                          return (
                            <div key={j} style={{ marginBottom: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                                <span style={{ color: "#C8CAD0", fontSize: 11 }}>
                                  {item.label}
                                  {item.weight && <span style={{ color: "#6B6F78", fontSize: 9, marginLeft: 4 }}>{item.weight}</span>}
                                </span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: pctOfTarget !== null ? (pctOfTarget >= 100 ? "#4ADE80" : pctOfTarget >= 60 ? "#FBBF24" : "#F87171") : "#F0F1F3" }}>
                                  {item.isMoney ? item.value : item.value}
                                  {item.target && <span style={{ color: "#6B6F78", fontSize: 10, fontWeight: 400 }}>{" / " + (item.isMoney ? fmt(item.target) : item.target)}</span>}
                                </span>
                              </div>
                              {item.target && <MiniBar value={item.isMoney ? item.raw : item.value} max={item.target} />}
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ background: "#0F1117", borderRadius: 10, padding: 16, border: "1px solid #00D4FF22" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ color: "#00D4FF", fontSize: 12, fontWeight: 700 }}>{"\uD83C\uDFAF Phone Audit Quality"}</div>
                          <div style={{ color: scoreColor(emp.audit.score), fontSize: 16, fontWeight: 800 }}>{emp.audit.score + "/100"}</div>
                        </div>
                        {emp.audit.total_audits > 0 ? (
                          <div>
                            {[
                              { label: "Avg Audit Score", value: emp.audit.avg_pct + "%", pct: emp.audit.avg_pct, weight: "50%" },
                              { label: "Appt Offered Rate", value: emp.audit.appt_rate + "%", pct: emp.audit.appt_rate, weight: "25%" },
                              { label: "Warranty Mentioned", value: emp.audit.warranty_rate + "%", pct: emp.audit.warranty_rate, weight: "25%" },
                            ].map(function(item, j) {
                              return (
                                <div key={j} style={{ marginBottom: 8 }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 2 }}>
                                    <span style={{ color: "#C8CAD0", fontSize: 11 }}>
                                      {item.label}
                                      <span style={{ color: "#6B6F78", fontSize: 9, marginLeft: 4 }}>{item.weight}</span>
                                    </span>
                                    <span style={{ color: scoreColor(item.pct), fontSize: 13, fontWeight: 700 }}>{item.value}</span>
                                  </div>
                                  <MiniBar value={item.pct} max={100} />
                                </div>
                              );
                            })}
                            <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, background: "#12141A", display: "flex", justifyContent: "space-between" }}>
                              <span style={{ color: "#8B8F98", fontSize: 10 }}>{emp.audit.total_audits + " audits (" + emp.audit.opp_audits + " opportunity)"}</span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: "#6B6F78", fontSize: 11, padding: 12, textAlign: "center" }}>No audits yet</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: "#1A1D23", borderRadius: 12, padding: 40, textAlign: "center", marginBottom: 28 }}>
          <div style={{ color: "#6B6F78", fontSize: 13 }}>No employee data yet. Import sales data and run audits to see scores.</div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>{"\uD83C\uDFEA"}</span>
        <div>
          <h2 style={{ color: "#F0F1F3", fontSize: 17, fontWeight: 700, margin: 0 }}>Store Performance</h2>
          <p style={{ color: "#6B6F78", fontSize: 12, margin: "2px 0 0" }}>Overall store grades including call handling and customer experience</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(" + Math.min(ranked.length, 3) + ",1fr)", gap: 16, marginBottom: 20 }}>
        {ranked.map(function(s, i) {
          var store = STORES[s.store];
          if (!store) return null;
          var medal = i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : "\uD83E\uDD49";
          return (
            <div key={s.store} style={{ background: "#1A1D23", borderRadius: 14, padding: 20, border: i === 0 ? "2px solid " + store.color + "33" : "1px solid #1E2028", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 22 }}>{medal}</span>
                <ScoreRing score={s.overall} size={80} strokeWidth={5} />
              </div>
              <div style={{ color: store.color, fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{store.name}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4 }}>
                {[
                  { label: "Repairs", score: s.categories.revenue.score },
                  { label: "Audit", score: s.categories.audit.score },
                  { label: "Calls", score: s.categories.calls.score },
                  { label: "CX", score: s.categories.experience.score },
                ].map(function(cat) {
                  return (
                    <div key={cat.label} style={{ background: "#12141A", borderRadius: 6, padding: "6px 2px" }}>
                      <div style={{ color: scoreColor(cat.score), fontSize: 13, fontWeight: 700 }}>{cat.score}</div>
                      <div style={{ color: "#6B6F78", fontSize: 8, textTransform: "uppercase" }}>{cat.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ color: "#F0F1F3", fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Store Comparison</div>
        <div style={{ height: 280 }}>
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
            return <div key={sk} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: store.color }} />
              <span style={{ color: "#8B8F98", fontSize: 11 }}>{store.name.replace("CPR ", "")}</span>
            </div>;
          })}
        </div>
      </div>

      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 16 }}>
        <div style={{ color: "#6B6F78", fontSize: 11 }}>
          <strong style={{ color: "#8B8F98" }}>Employee scoring:</strong> Repairs & Production (50% — accessory GP 50%, repair qty 25%, cleanings 25%) + Phone Audit Quality (50% — avg score 50%, appt offered 25%, warranty mentioned 25%).
          <strong style={{ color: "#8B8F98", marginLeft: 8 }}>Store scoring:</strong> Repairs (35%) + Audit (30%) + Call Handling (20%) + Customer Experience (15%).
        </div>
      </div>
    </div>
  );
}

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

export default function ScorecardTab({ storeFilter, viewAs, viewEmployee }) {
  var isEmployeeView = viewAs === "employee" && viewEmployee;
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [expandedEmp, setExpandedEmp] = useState(null);
  var [view, setView] = useState("scores");
  var [editingKey, setEditingKey] = useState(null);
  var [editVal, setEditVal] = useState("");
  var [configMsg, setConfigMsg] = useState(null);

  // Period selector — generate last 12 months
  var now = new Date();
  var periodOptions = [];
  for (var mi = 0; mi < 12; mi++) {
    var d = new Date(now.getFullYear(), now.getMonth() - mi, 1);
    var pVal = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    var pLabel = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    periodOptions.push({ value: pVal, label: pLabel });
  }
  var currentPeriod = periodOptions[0].value;
  var [selectedPeriod, setSelectedPeriod] = useState(currentPeriod);

  var loadScorecard = async function() {
    setLoading(true);
    try {
      var url = "/api/dialpad/scorecard?period=" + selectedPeriod;
      var res = await fetch(url);
      var json = await res.json();
      if (json.success) setData(json);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(function() { loadScorecard(); }, [selectedPeriod]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>Calculating scores...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>No scorecard data available.</div>;

  var empScores = data.employeeScores || [];
  var ranked = data.ranked || [];
  var storeScores = data.scores || {};
  var configMap = data.configMap || {};

  var updateConfig = async function(key, value) {
    try {
      var res = await fetch("/api/dialpad/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_commission", key: key, value: value })
      });
      var json = await res.json();
      if (json.success) {
        setEditingKey(null);
        setConfigMsg({ type: "success", text: "Updated — reload scores to see changes" });
        setTimeout(function() { setConfigMsg(null); }, 4000);
      }
    } catch(e) { setConfigMsg({ type: "error", text: e.message }); }
  };

  var filteredEmps = storeFilter && storeFilter !== "all"
    ? empScores.filter(function(e) { return e.store === storeFilter; })
    : empScores;

  // Employee view: only show their own data
  if (isEmployeeView) {
    filteredEmps = empScores.filter(function(e) {
      return e.name.toLowerCase() === viewEmployee.toLowerCase();
    });
  }

  var scorecardSubtabs = isEmployeeView || viewAs === "employee"
    ? [{id:"scores",label:isEmployeeView?"My Scores":"Scores",icon:"\uD83C\uDFC6"}]
    : [{id:"scores",label:"Scores",icon:"\uD83C\uDFC6"},{id:"config",label:"Scoring Config",icon:"\u2699\uFE0F"}];

  var radarData = [
    { category: "Repairs", fullMark: 100 },
    { category: "Audit", fullMark: 100 },
    { category: "Calls", fullMark: 100 },
    { category: "Experience", fullMark: 100 },
    { category: "Compliance", fullMark: 100 },
  ];
  STORE_KEYS.forEach(function(sk) {
    var s = storeScores[sk];
    if (s) {
      radarData[0][sk] = s.categories.revenue.score;
      radarData[1][sk] = s.categories.audit.score;
      radarData[2][sk] = s.categories.calls.score;
      radarData[3][sk] = s.categories.experience.score;
      radarData[4][sk] = s.categories.compliance ? s.categories.compliance.score : 0;
    }
  });

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {scorecardSubtabs.map(function(v) {
            return <button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7B2FFF22":"#1A1D23",color:view===v.id?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
          })}
        </div>
        {view === "scores" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#6B6F78", fontSize: 11 }}>{"\uD83D\uDCC5"}</span>
            <select value={selectedPeriod} onChange={function(e) { setSelectedPeriod(e.target.value); }}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #2A2D35", background: "#12141A", color: selectedPeriod === currentPeriod ? "#8B8F98" : "#FBBF24", fontSize: 12, fontWeight: 600, cursor: "pointer", outline: "none" }}>
              {periodOptions.map(function(p) {
                return <option key={p.value} value={p.value}>{p.label}</option>;
              })}
            </select>
            {selectedPeriod !== currentPeriod && (
              <button onClick={function() { setSelectedPeriod(currentPeriod); }}
                style={{ padding: "4px 10px", borderRadius: 5, border: "1px solid #7B2FFF33", background: "#7B2FFF11", color: "#7B2FFF", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
                Current
              </button>
            )}
          </div>
        )}
      </div>

      {/* ═══ CONFIG VIEW ═══ */}
      {view === "config" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 20 }}>{"\u2699\uFE0F"}</span>
            <div>
              <h2 style={{ color: "#F0F1F3", fontSize: 17, fontWeight: 700, margin: 0 }}>Scoring Configuration</h2>
              <p style={{ color: "#6B6F78", fontSize: 12, margin: "2px 0 0" }}>Adjust weights and targets. Weights within each group should sum to 100%.</p>
            </div>
          </div>

          {configMsg && (
            <div style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,background:configMsg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(configMsg.type==="success"?"#4ADE8033":"#F8717133"),color:configMsg.type==="success"?"#4ADE80":"#F87171",fontSize:13 }}>
              {configMsg.text}
            </div>
          )}

          {[
            { title: "Employee Weights", subtitle: "Main category weights (should sum to 100%)", items: [
              { key: "emp_weight_repairs", label: "Repairs & Production", pct: true },
              { key: "emp_weight_audit", label: "Phone Audit Quality", pct: true },
              { key: "emp_weight_compliance", label: "Ticket Compliance", pct: true },
            ]},
            { title: "Repair Sub-Weights", subtitle: "Within Repairs category (should sum to 100%)", items: [
              { key: "emp_repair_sub_qty", label: "Repair Ticket Qty", pct: true },
              { key: "emp_repair_sub_accy", label: "Accessory GP", pct: true },
              { key: "emp_repair_sub_clean", label: "Cleanings", pct: true },
            ]},
            { title: "Audit Sub-Weights", subtitle: "Within Audit category (should sum to 100%)", items: [
              { key: "emp_audit_sub_score", label: "Avg Audit Score", pct: true },
              { key: "emp_audit_sub_appt", label: "Appt Offered Rate", pct: true },
              { key: "emp_audit_sub_warranty", label: "Warranty Mentioned", pct: true },
            ]},
            { title: "Employee Targets", subtitle: "Monthly targets per employee", items: [
              { key: "emp_target_repairs", label: "Repairs / Month" },
              { key: "emp_target_accy_gp", label: "Accessory GP / Month", dollar: true },
              { key: "emp_target_cleans", label: "Cleanings / Month" },
            ]},
            { title: "Store Weights", subtitle: "Store-level category weights (should sum to 100%)", items: [
              { key: "store_weight_repairs", label: "Repairs & Production", pct: true },
              { key: "store_weight_audit", label: "Phone Audit Quality", pct: true },
              { key: "store_weight_calls", label: "Call Handling", pct: true },
              { key: "store_weight_cx", label: "Customer Experience", pct: true },
              { key: "store_weight_compliance", label: "Ticket Compliance", pct: true },
            ]},
            { title: "Store Targets", subtitle: "Monthly targets per store", items: [
              { key: "store_target_repairs", label: "Repairs / Month" },
              { key: "store_target_accy_gp", label: "Accessory GP / Month", dollar: true },
              { key: "store_target_cleans", label: "Cleanings / Month" },
            ]},
          ].map(function(group) {
            var groupSum = group.items.filter(function(i){return i.pct;}).reduce(function(s, i) {
              return s + (configMap[i.key] !== undefined ? configMap[i.key] : 0);
            }, 0);
            var sumPct = Math.round(groupSum * 100);
            var hasPctItems = group.items.some(function(i){return i.pct;});
            return (
              <div key={group.title} style={{ background: "#1A1D23", borderRadius: 12, padding: 20, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div>
                    <div style={{ color: "#F0F1F3", fontSize: 14, fontWeight: 700 }}>{group.title}</div>
                    <div style={{ color: "#6B6F78", fontSize: 11 }}>{group.subtitle}</div>
                  </div>
                  {hasPctItems && (
                    <div style={{ padding: "3px 10px", borderRadius: 6, background: sumPct === 100 ? "#4ADE8022" : "#F8717122", color: sumPct === 100 ? "#4ADE80" : "#F87171", fontSize: 12, fontWeight: 700 }}>
                      {sumPct + "%"}
                    </div>
                  )}
                </div>
                {group.items.map(function(item) {
                  var val = configMap[item.key];
                  var isEditing = editingKey === item.key;
                  var displayVal = item.pct ? Math.round((val || 0) * 100) + "%" : item.dollar ? "$" + parseFloat(val || 0).toFixed(0) : parseFloat(val || 0).toFixed(0);
                  return (
                    <div key={item.key} style={{ padding: "10px 0", borderBottom: "1px solid #2A2D35", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#C8CAD0", fontSize: 13 }}>{item.label}</span>
                      {isEditing ? (
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input value={editVal} onChange={function(e){setEditVal(e.target.value);}}
                            style={{ width: 70, padding: "5px 8px", borderRadius: 6, border: "1px solid #7B2FFF44", background: "#12141A", color: "#F0F1F3", fontSize: 14, fontWeight: 700, textAlign: "right" }}
                            autoFocus />
                          <button onClick={function(){
                            var v = parseFloat(editVal);
                            if (item.pct) v = v / 100;
                            updateConfig(item.key, v);
                            configMap[item.key] = v;
                          }} style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#4ADE80", color: "#000", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Save</button>
                          <button onClick={function(){setEditingKey(null);}} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #2A2D35", background: "transparent", color: "#8B8F98", fontSize: 11, cursor: "pointer" }}>Cancel</button>
                        </div>
                      ) : (
                        <button onClick={function(){
                          setEditingKey(item.key);
                          setEditVal(item.pct ? Math.round((val || 0) * 100).toString() : parseFloat(val || 0).toFixed(0));
                        }} style={{ padding: "5px 14px", borderRadius: 6, border: "1px solid #2A2D35", background: "#12141A", color: "#FBBF24", fontSize: 15, fontWeight: 800, cursor: "pointer", minWidth: 70, textAlign: "center" }}>
                          {displayVal}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          <button onClick={function(){ loadScorecard(); setView("scores"); }}
            style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #00D4FF, #7B2FFF)", color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            Recalculate Scores
          </button>
        </div>
      )}

      {/* ═══ SCORES VIEW ═══ */}
      {view === "scores" && (<div>

      {selectedPeriod !== currentPeriod && (
        <div style={{ background: "#FBBF2410", border: "1px solid #FBBF2433", borderRadius: 10, padding: "10px 16px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>{"\uD83D\uDCC6"}</span>
            <span style={{ color: "#FBBF24", fontSize: 12, fontWeight: 600 }}>
              {"Viewing: " + periodOptions.find(function(p) { return p.value === selectedPeriod; }).label}
            </span>
          </div>
          <button onClick={function() { setSelectedPeriod(currentPeriod); }}
            style={{ padding: "4px 12px", borderRadius: 5, border: "none", background: "#FBBF24", color: "#000", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
            Back to Current
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>{"\uD83C\uDFC6"}</span>
        <div>
          <h2 style={{ color: "#F0F1F3", fontSize: 17, fontWeight: 700, margin: 0 }}>{isEmployeeView ? "My Scorecard" : "Employee Scorecard"}</h2>
          <p style={{ color: "#6B6F78", fontSize: 12, margin: "2px 0 0" }}>Scored on Repairs (35%) + Phone Audit (35%) + Ticket Compliance (30%)</p>
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
                    <div style={{ textAlign: "center" }}>
                      <div style={{ color: "#8B8F98", fontSize: 9, textTransform: "uppercase" }}>Compliance</div>
                      <div style={{ color: emp.compliance && emp.compliance.tickets_graded > 0 ? scoreColor(emp.compliance.score) : "#6B6F78", fontSize: 14, fontWeight: 700 }}>{emp.compliance && emp.compliance.tickets_graded > 0 ? emp.compliance.score : "—"}</div>
                    </div>
                    <div style={{ padding: "6px 14px", borderRadius: 8, background: sc + "22", color: sc, fontSize: 18, fontWeight: 800 }}>
                      {emp.overall}
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ padding: "0 12px 20px 56px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginTop: 8 }}>
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

                      {/* Compliance */}
                      <div style={{ background: "#0F1117", borderRadius: 10, padding: 16, border: "1px solid #FF2D9522" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <div style={{ color: "#FF2D95", fontSize: 12, fontWeight: 700 }}>{"\uD83D\uDCCB Ticket Compliance"}</div>
                          <div style={{ color: emp.compliance && emp.compliance.tickets_graded > 0 ? scoreColor(emp.compliance.score) : "#6B6F78", fontSize: 16, fontWeight: 800 }}>{emp.compliance && emp.compliance.tickets_graded > 0 ? emp.compliance.score + "/100" : "—"}</div>
                        </div>
                        {emp.compliance && emp.compliance.tickets_graded > 0 ? (
                          <div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ color: "#C8CAD0", fontSize: 11 }}>Tickets Graded</span>
                              <span style={{ color: "#F0F1F3", fontSize: 13, fontWeight: 700 }}>{emp.compliance.tickets_graded}</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                              <span style={{ color: "#C8CAD0", fontSize: 11 }}>Avg Score</span>
                              <span style={{ color: scoreColor(emp.compliance.score), fontSize: 13, fontWeight: 700 }}>{emp.compliance.score + "%"}</span>
                            </div>
                            <MiniBar value={emp.compliance.score} max={100} />
                          </div>
                        ) : (
                          <div style={{ color: "#6B6F78", fontSize: 11, padding: 12, textAlign: "center" }}>No tickets graded yet</div>
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

      {!isEmployeeView && (<div>
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 4 }}>
                {[
                  { label: "Repairs", score: s.categories.revenue.score },
                  { label: "Audit", score: s.categories.audit.score },
                  { label: "Calls", score: s.categories.calls.score },
                  { label: "CX", score: s.categories.experience.score },
                  { label: "Comply", score: s.categories.compliance ? s.categories.compliance.score : 0 },
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
      </div>)}

      {!isEmployeeView && viewAs !== "employee" && (
      <div style={{ background: "#1A1D23", borderRadius: 12, padding: 16 }}>
        <div style={{ color: "#6B6F78", fontSize: 11 }}>
          <strong style={{ color: "#8B8F98" }}>Employee scoring:</strong> Repairs ({Math.round((configMap.emp_weight_repairs||0.35)*100)}%) + Phone Audit ({Math.round((configMap.emp_weight_audit||0.35)*100)}%) + Ticket Compliance ({Math.round((configMap.emp_weight_compliance||0.30)*100)}%).
          <strong style={{ color: "#8B8F98", marginLeft: 8 }}>Store scoring:</strong> Repairs ({Math.round((configMap.store_weight_repairs||0.25)*100)}%) + Audit ({Math.round((configMap.store_weight_audit||0.20)*100)}%) + Calls ({Math.round((configMap.store_weight_calls||0.15)*100)}%) + CX ({Math.round((configMap.store_weight_cx||0.10)*100)}%) + Compliance ({Math.round((configMap.store_weight_compliance||0.20)*100)}%).
          <button onClick={function(){setView("config");}} style={{ marginLeft:8,color:"#7B2FFF",background:"none",border:"none",cursor:"pointer",fontSize:11,textDecoration:"underline" }}>Edit weights</button>
        </div>
      </div>
      )}
      </div>)}
    </div>
  );
}

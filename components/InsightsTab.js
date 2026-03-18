'use client';

import { useState, useEffect } from "react";
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { STORES } from "@/lib/constants";

function scoreColor(s) { return s >= 80 ? "#4ADE80" : s >= 60 ? "#FBBF24" : s >= 40 ? "#FB923C" : "#F87171"; }

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background:"#1A1D23",borderRadius:12,padding:"18px 20px",borderLeft:"3px solid "+accent,minWidth:0 }}>
      <div style={{ color:"#8B8F98",fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em" }}>{label}</div>
      <div style={{ color:"#F0F1F3",fontSize:28,fontWeight:700,marginTop:4 }}>{value}</div>
      {sub && <div style={{ color:"#6B6F78",fontSize:12,marginTop:2 }}>{sub}</div>}
    </div>
  );
}

export default function InsightsTab({ storeFilter }) {
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [view, setView] = useState("overview");
  var [journeyData, setJourneyData] = useState(null);
  var [journeyLoading, setJourneyLoading] = useState(false);
  var [selectedJourney, setSelectedJourney] = useState(null);
  var [journeyDetail, setJourneyDetail] = useState(null);
  var [detailLoading, setDetailLoading] = useState(false);
  var [journeySort, setJourneySort] = useState("flags");

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        var res = await fetch("/api/dialpad/insights?days=30");
        var json = await res.json();
        if (json.success) setData(json);
      } catch(e) { console.error(e); }
      setLoading(false);
    }
    load();
  }, []);

  var loadJourneys = async function() {
    if (journeyData) return;
    setJourneyLoading(true);
    try {
      var sp = storeFilter && storeFilter !== "all" ? "&store=" + storeFilter : "";
      var res = await fetch("/api/dialpad/customer-journey?action=journeys&days=30" + sp);
      var json = await res.json();
      if (json.success) setJourneyData(json);
    } catch(e) { console.error(e); }
    setJourneyLoading(false);
  };

  var loadJourneyDetail = async function(phone) {
    setSelectedJourney(phone);
    setDetailLoading(true);
    try {
      var res = await fetch("/api/dialpad/customer-journey?action=lookup&phone=" + phone);
      var json = await res.json();
      if (json.success) setJourneyDetail(json);
    } catch(e) { console.error(e); }
    setDetailLoading(false);
  };

  var SUBTABS = [
    { id: "overview", label: "Overview", icon: "\uD83D\uDCA1" },
    { id: "journey", label: "Customer Journey", icon: "\uD83D\uDCCD" },
    { id: "devices", label: "Device Patterns", icon: "\uD83D\uDCF1" },
    { id: "employees", label: "Employee Correlation", icon: "\uD83D\uDC64" },
    { id: "callbacks", label: "Post-Repair Callbacks", icon: "\u260E\uFE0F" },
  ];

  if (loading) return (<div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Analyzing patterns across all data...</div>);
  if (!data) return (<div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>No insights data available.</div>);

  var summary = data.summary || {};
  var callbacks = data.callbacks || [];
  var devices = data.devicePatterns || [];
  var employees = data.employeeCorrelation || [];

  if (storeFilter && storeFilter !== "all") {
    callbacks = callbacks.filter(function(c) { return c.store === storeFilter; });
    employees = employees.filter(function(e) { return e.store === storeFilter; });
  }

  var scatterData = employees.filter(function(e) { return e.avg_audit !== null && e.avg_compliance !== null; }).map(function(e) {
    return { name: e.name, x: e.avg_audit, y: e.avg_compliance, callbacks: e.callback_rate, store: e.store };
  });

  return (
    <div>
      <div style={{ display:"flex",gap:4,marginBottom:20 }}>
        {SUBTABS.map(function(v) {
          return (<button key={v.id} onClick={function(){setView(v.id); if(v.id==="journey") loadJourneys();}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7B2FFF22":"#1A1D23",color:view===v.id?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>);
        })}
      </div>

      {view === "overview" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24 }}>
            <StatCard label="Tickets Analyzed" value={summary.totalTickets || 0} accent="#7B2FFF" />
            <StatCard label="Post-Repair Callbacks" value={summary.totalCallbacks || 0} accent={summary.totalCallbacks > 5 ? "#F87171" : "#4ADE80"} sub={summary.callbackRate + "% callback rate"} />
            <StatCard label="Avg Compliance" value={(summary.avgCompliance || 0) + "/100"} accent={scoreColor(summary.avgCompliance || 0)} />
            <StatCard label="Device Types" value={devices.length} accent="#00D4FF" sub="with 2+ tickets" />
          </div>

          {callbacks.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #F8717122" }}>
              <div style={{ color:"#F87171",fontSize:14,fontWeight:700,marginBottom:12 }}>{"\u26A0\uFE0F Recent Post-Repair Callbacks"}</div>
              {callbacks.slice(0, 5).map(function(cb) {
                var store = STORES[cb.store];
                return (
                  <div key={cb.ticket_number} style={{ padding:"10px 0",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div>
                      <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:700 }}>{"#" + cb.ticket_number}</span>
                      <span style={{ color:"#6B6F78",fontSize:11,marginLeft:8 }}>{cb.customer_name}</span>
                      {store && <span style={{ color:store.color,fontSize:10,marginLeft:8 }}>{store.name.replace("CPR ","")}</span>}
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <div style={{ color:"#F87171",fontSize:13,fontWeight:700 }}>{cb.callback_count + " callback" + (cb.callback_count > 1 ? "s" : "")}</div>
                      <div style={{ color:"#6B6F78",fontSize:10 }}>{cb.days_after + " days after close"}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {employees.filter(function(e){return e.coaching.length > 0;}).length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              <div style={{ color:"#FBBF24",fontSize:14,fontWeight:700,marginBottom:12 }}>{"\uD83C\uDFAF Coaching Opportunities"}</div>
              {employees.filter(function(e){return e.coaching.length > 0;}).map(function(emp) {
                var store = STORES[emp.store];
                return (
                  <div key={emp.name} style={{ padding:"10px 0",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div>
                      <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:700 }}>{emp.name}</span>
                      {store && <span style={{ color:store.color,fontSize:10,marginLeft:8 }}>{store.name.replace("CPR ","")}</span>}
                      <div style={{ marginTop:4 }}>
                        {emp.coaching.map(function(c, i) {
                          var isGood = c.includes("Top performer");
                          return (<span key={i} style={{ display:"inline-block",padding:"2px 8px",borderRadius:4,background:isGood?"#4ADE8018":"#FBBF2418",color:isGood?"#4ADE80":"#FBBF24",fontSize:10,marginRight:4,marginBottom:2 }}>{c}</span>);
                        })}
                      </div>
                    </div>
                    <div style={{ display:"flex",gap:12,textAlign:"center" }}>
                      <div>
                        <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Audit</div>
                        <div style={{ color:emp.avg_audit !== null ? scoreColor(emp.avg_audit) : "#6B6F78",fontSize:14,fontWeight:700 }}>{emp.avg_audit !== null ? emp.avg_audit : "\u2014"}</div>
                      </div>
                      <div>
                        <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Compliance</div>
                        <div style={{ color:emp.avg_compliance !== null ? scoreColor(emp.avg_compliance) : "#6B6F78",fontSize:14,fontWeight:700 }}>{emp.avg_compliance !== null ? emp.avg_compliance : "\u2014"}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ CUSTOMER JOURNEY ═══ */}
      {view === "journey" && (
        <div>
          {journeyLoading ? (
            <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Cross-referencing calls and tickets by phone number...</div>
          ) : journeyData ? (
            <div>
              {/* Stats row */}
              <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20 }}>
                <StatCard label="Customers Matched" value={journeyData.stats.total_customers_cross_referenced} accent="#7B2FFF" sub={"calls \u2194 tickets linked"} />
                <StatCard label="Avg CX Score" value={journeyData.stats.avg_cx_score !== null ? journeyData.stats.avg_cx_score + "/100" : "\u2014"} accent={scoreColor(journeyData.stats.avg_cx_score || 0)} />
                <StatCard label="Flagged Customers" value={journeyData.stats.total_flagged} accent={journeyData.stats.total_flagged > 0 ? "#F87171" : "#4ADE80"} sub="need attention" />
                <StatCard label="Data Points" value={journeyData.stats.total_calls_analyzed + journeyData.stats.total_tickets_analyzed} accent="#00D4FF" sub={journeyData.stats.total_calls_analyzed + " calls + " + journeyData.stats.total_tickets_analyzed + " tickets"} />
              </div>

              {/* Detail panel */}
              {selectedJourney && (
                <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #7B2FFF33" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
                    <div>
                      <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{journeyDetail ? journeyDetail.customer_name || "Unknown Customer" : "Loading..."}</div>
                      <div style={{ color:"#8B8F98",fontSize:12 }}>{selectedJourney.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}</div>
                    </div>
                    <button onClick={function(){ setSelectedJourney(null); setJourneyDetail(null); }}
                      style={{ padding:"6px 14px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:11,cursor:"pointer" }}>Close</button>
                  </div>

                  {detailLoading ? (
                    <div style={{ padding:20,textAlign:"center",color:"#6B6F78" }}>Loading timeline...</div>
                  ) : journeyDetail ? (
                    <div>
                      {/* CX Summary */}
                      <div style={{ display:"flex",gap:16,marginBottom:16,padding:12,background:"#12141A",borderRadius:8 }}>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>CX Score</div>
                          <div style={{ color:scoreColor(journeyDetail.cx_score || 0),fontSize:24,fontWeight:800 }}>{journeyDetail.cx_score !== null ? journeyDetail.cx_score : "\u2014"}</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Calls</div>
                          <div style={{ color:"#F0F1F3",fontSize:24,fontWeight:800 }}>{journeyDetail.total_calls}</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Tickets</div>
                          <div style={{ color:"#F0F1F3",fontSize:24,fontWeight:800 }}>{journeyDetail.total_tickets}</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Avg Call</div>
                          <div style={{ color:journeyDetail.avg_call_score !== null ? scoreColor(journeyDetail.avg_call_score / 4 * 100) : "#6B6F78",fontSize:24,fontWeight:800 }}>{journeyDetail.avg_call_score !== null ? journeyDetail.avg_call_score.toFixed(1) + "/4" : "\u2014"}</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Avg Ticket</div>
                          <div style={{ color:journeyDetail.avg_ticket_score !== null ? scoreColor(journeyDetail.avg_ticket_score) : "#6B6F78",fontSize:24,fontWeight:800 }}>{journeyDetail.avg_ticket_score !== null ? journeyDetail.avg_ticket_score : "\u2014"}</div>
                        </div>
                      </div>

                      {/* Timeline */}
                      <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase",marginBottom:8,letterSpacing:"0.05em" }}>Timeline</div>
                      <div style={{ maxHeight:400,overflowY:"auto" }}>
                        {journeyDetail.timeline.map(function(event, i) {
                          var isCall = event.type === "call";
                          var color = isCall ? "#00D4FF" : "#7B2FFF";
                          var icon = isCall ? "\uD83D\uDCDE" : "\uD83C\uDFAB";
                          var d = new Date(event.date);
                          var store = STORES[event.store];
                          return (
                            <div key={i} style={{ display:"flex",gap:12,padding:"10px 0",borderBottom:"1px solid #1E2028" }}>
                              <div style={{ display:"flex",flexDirection:"column",alignItems:"center",minWidth:24 }}>
                                <span style={{ fontSize:14 }}>{icon}</span>
                                {i < journeyDetail.timeline.length - 1 && <div style={{ width:1,flex:1,background:"#2A2D35",marginTop:4 }} />}
                              </div>
                              <div style={{ flex:1 }}>
                                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                                    {isCall ? (
                                      <span style={{ color:color,fontSize:11,fontWeight:700 }}>Phone Call</span>
                                    ) : (
                                      <a href={"https://cpr.repairq.io/ticket/" + event.ticket_number} target="_blank" rel="noopener noreferrer"
                                        onClick={function(e){e.stopPropagation();}}
                                        style={{ color:color,fontSize:11,fontWeight:700,textDecoration:"none",borderBottom:"1px dashed " + color }}>{"Ticket #" + event.ticket_number}</a>
                                    )}
                                    {isCall && event.call_type && <span style={{ padding:"1px 6px",borderRadius:3,fontSize:9,fontWeight:600,background:event.call_type==="opportunity"?"#7B2FFF18":"#FBBF2418",color:event.call_type==="opportunity"?"#7B2FFF":"#FBBF24" }}>{event.call_type==="current_customer"?"Current":"Opportunity"}</span>}
                                    {store && <span style={{ color:store.color,fontSize:9 }}>{store.name.replace("CPR ","")}</span>}
                                  </div>
                                  <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                                    {isCall ? (
                                      <span style={{ color:scoreColor(event.score/4*100),fontSize:13,fontWeight:800 }}>{event.score.toFixed(1)}/4</span>
                                    ) : (
                                      <span style={{ color:scoreColor(event.score),fontSize:13,fontWeight:800 }}>{event.score}/100</span>
                                    )}
                                  </div>
                                </div>
                                <div style={{ color:"#6B6F78",fontSize:10,marginTop:2 }}>
                                  {d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}
                                  {event.employee && <span style={{ marginLeft:8 }}>{event.employee}</span>}
                                </div>
                                {event.detail && <div style={{ color:"#8B8F98",fontSize:11,marginTop:4 }}>{isCall ? "Inquiry: " : "Device: "}{event.detail}</div>}
                                {isCall && event.outcome && <div style={{ color:"#8B8F98",fontSize:11 }}>Outcome: {event.outcome}</div>}
                              </div>
                            </div>
                          );
                        })}
                        {journeyDetail.timeline.length === 0 && <div style={{ padding:20,textAlign:"center",color:"#6B6F78",fontSize:12 }}>No events found</div>}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Sort controls */}
              <div style={{ display:"flex",gap:4,marginBottom:12 }}>
                {[
                  { id:"flags",label:"Flagged First" },
                  { id:"cx",label:"Lowest CX" },
                  { id:"recent",label:"Most Recent" },
                  { id:"calls",label:"Most Calls" },
                ].map(function(s) {
                  return <button key={s.id} onClick={function(){setJourneySort(s.id);}} style={{ padding:"5px 10px",borderRadius:6,border:"none",cursor:"pointer",background:journeySort===s.id?"#7B2FFF22":"#1A1D23",color:journeySort===s.id?"#7B2FFF":"#8B8F98",fontSize:10,fontWeight:600 }}>{s.label}</button>;
                })}
              </div>

              {/* Customer list */}
              <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
                {(function() {
                  var sorted = (journeyData.journeys || []).slice();
                  if (journeySort === "cx") sorted.sort(function(a,b){ return (a.cx_score||999) - (b.cx_score||999); });
                  else if (journeySort === "recent") sorted.sort(function(a,b){ return new Date(b.latest_date) - new Date(a.latest_date); });
                  else if (journeySort === "calls") sorted.sort(function(a,b){ return b.total_calls - a.total_calls; });
                  return sorted;
                })().map(function(j) {
                  var cxColor = scoreColor(j.cx_score || 0);
                  var isSelected = selectedJourney === j.phone;
                  return (
                    <div key={j.phone} onClick={function(){ loadJourneyDetail(j.phone); }}
                      style={{ padding:"14px 20px",borderBottom:"1px solid #1E2028",cursor:"pointer",background:isSelected?"#7B2FFF08":"transparent",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div>
                        <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:2 }}>
                          <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:700 }}>{j.customer_name || "Unknown"}</span>
                          <span style={{ color:"#6B6F78",fontSize:11 }}>{j.phone.replace(/(\d{3})(\d{3})(\d{4})/, "($1) $2-$3")}</span>
                          {j.stores.map(function(sk) {
                            var st = STORES[sk];
                            return st ? <span key={sk} style={{ width:6,height:6,borderRadius:"50%",background:st.color }} /> : null;
                          })}
                        </div>
                        {j.flags.length > 0 && (
                          <div style={{ display:"flex",gap:4,marginTop:4,flexWrap:"wrap" }}>
                            {j.flags.map(function(f, fi) {
                              return <span key={fi} style={{ padding:"2px 6px",borderRadius:4,background:"#F8717118",border:"1px solid #F8717133",color:"#F87171",fontSize:9,fontWeight:600 }}>{"\u26A0\uFE0F " + f}</span>;
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ display:"flex",gap:14,alignItems:"center" }}>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>CX</div>
                          <div style={{ color:cxColor,fontSize:16,fontWeight:800 }}>{j.cx_score !== null ? j.cx_score : "\u2014"}</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Calls</div>
                          <div style={{ color:"#00D4FF",fontSize:14,fontWeight:700 }}>{j.total_calls}</div>
                        </div>
                        <div style={{ textAlign:"center" }}>
                          <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Tickets</div>
                          <div style={{ color:"#7B2FFF",fontSize:14,fontWeight:700 }}>{j.total_tickets}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {(journeyData.journeys || []).length === 0 && (
                  <div style={{ padding:40,textAlign:"center",color:"#6B6F78",fontSize:13 }}>No cross-referenced customers found yet. Grade more tickets and audit more calls to enable journey tracking.</div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Failed to load journey data.</div>
          )}
        </div>
      )}

      {view === "devices" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:4 }}>Device and Repair Patterns</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:16 }}>Sorted by callback rate</div>
          {devices.length > 0 ? (
            <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
              <table style={{ width:"100%",borderCollapse:"collapse" }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid #2A2D35" }}>
                    {["Device / Type","Tickets","Avg Score","Callbacks","Callback Rate","Low Scores"].map(function(h,i){
                      return (<th key={i} style={{ textAlign:i===0?"left":"right",padding:"10px 14px",color:"#6B6F78",fontSize:10,textTransform:"uppercase" }}>{h}</th>);
                    })}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(function(d,i) {
                    var hasIssue = d.callback_rate > 15 || d.low_score_rate > 30;
                    return (
                      <tr key={i} style={{ borderBottom:"1px solid #1E2028",background:hasIssue?"#F8717108":"transparent" }}>
                        <td style={{ padding:"12px 14px" }}>
                          <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{d.device}</div>
                          <div style={{ color:"#6B6F78",fontSize:10 }}>{d.type}</div>
                        </td>
                        <td style={{ padding:"12px 14px",textAlign:"right",color:"#F0F1F3",fontSize:13 }}>{d.tickets}</td>
                        <td style={{ padding:"12px 14px",textAlign:"right",color:scoreColor(d.avg_score),fontSize:13,fontWeight:700 }}>{d.avg_score}</td>
                        <td style={{ padding:"12px 14px",textAlign:"right",color:d.callbacks > 0?"#F87171":"#4ADE80",fontSize:13,fontWeight:700 }}>{d.callbacks}</td>
                        <td style={{ padding:"12px 14px",textAlign:"right",color:d.callback_rate > 15?"#F87171":"#4ADE80",fontSize:13,fontWeight:700 }}>{d.callback_rate + "%"}</td>
                        <td style={{ padding:"12px 14px",textAlign:"right",color:d.low_score_rate > 30?"#F87171":"#8B8F98",fontSize:13 }}>{d.low_scores + " (" + d.low_score_rate + "%)"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78",fontSize:13 }}>Need more graded tickets to show patterns.</div>
          )}
        </div>
      )}

      {view === "employees" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:4 }}>Employee Quality Correlation</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:16 }}>Phone audit score vs ticket compliance</div>

          {scatterData.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
              <div style={{ height:320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" />
                    <XAxis type="number" dataKey="x" domain={[0,100]} name="Audit Score" tick={{fill:"#6B6F78",fontSize:10}} />
                    <YAxis type="number" dataKey="y" domain={[0,100]} name="Compliance Score" tick={{fill:"#6B6F78",fontSize:10}} />
                    <Tooltip content={function(props) {
                      var payload = props.payload && props.payload[0] ? props.payload[0].payload : null;
                      if (!payload) return null;
                      return (<div style={{background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8,padding:10}}>
                        <div style={{color:"#F0F1F3",fontWeight:700,fontSize:13}}>{payload.name}</div>
                        <div style={{color:"#8B8F98",fontSize:11}}>{"Audit: " + payload.x + " | Compliance: " + payload.y}</div>
                        <div style={{color:"#8B8F98",fontSize:11}}>{"Callback rate: " + payload.callbacks + "%"}</div>
                      </div>);
                    }} />
                    <Scatter data={scatterData} fill="#7B2FFF">
                      {scatterData.map(function(entry, i) {
                        var store = STORES[entry.store];
                        return (<Cell key={i} fill={store ? store.color : "#7B2FFF"} />);
                      })}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display:"flex",justifyContent:"center",gap:16,marginTop:8 }}>
                {Object.keys(STORES).map(function(sk) {
                  var store = STORES[sk];
                  return (<div key={sk} style={{ display:"flex",alignItems:"center",gap:4 }}>
                    <span style={{ width:8,height:8,borderRadius:"50%",background:store.color }} />
                    <span style={{ color:"#8B8F98",fontSize:10 }}>{store.name.replace("CPR ","")}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            {employees.map(function(emp) {
              var store = STORES[emp.store];
              return (
                <div key={emp.name} style={{ padding:"14px 0",borderBottom:"1px solid #1E2028" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                    <div>
                      <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                        <span style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.name}</span>
                        {store && <span style={{ color:store.color,fontSize:10 }}>{store.name.replace("CPR ","")}</span>}
                        {emp.role && <span style={{ color:"#6B6F78",fontSize:10 }}>{emp.role}</span>}
                      </div>
                      {emp.coaching.length > 0 && (
                        <div style={{ marginTop:6 }}>
                          {emp.coaching.map(function(c,i) {
                            var isGood = c.includes("Top performer");
                            return (<span key={i} style={{ display:"inline-block",padding:"2px 8px",borderRadius:4,background:isGood?"#4ADE8018":"#FBBF2418",color:isGood?"#4ADE80":"#FBBF24",fontSize:10,marginRight:4 }}>{c}</span>);
                          })}
                        </div>
                      )}
                    </div>
                    <div style={{ display:"flex",gap:14,textAlign:"center" }}>
                      <div>
                        <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Audit</div>
                        <div style={{ color:emp.avg_audit !== null ? scoreColor(emp.avg_audit) : "#6B6F78",fontSize:16,fontWeight:800 }}>{emp.avg_audit !== null ? emp.avg_audit : "\u2014"}</div>
                      </div>
                      <div>
                        <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Compliance</div>
                        <div style={{ color:emp.avg_compliance !== null ? scoreColor(emp.avg_compliance) : "#6B6F78",fontSize:16,fontWeight:800 }}>{emp.avg_compliance !== null ? emp.avg_compliance : "\u2014"}</div>
                      </div>
                      <div>
                        <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Repairs</div>
                        <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:800 }}>{emp.repair_count}</div>
                      </div>
                      <div>
                        <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>Callbacks</div>
                        <div style={{ color:emp.callback_rate > 15 ? "#F87171" : "#4ADE80",fontSize:16,fontWeight:800 }}>{emp.callback_rate + "%"}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "callbacks" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:4 }}>Post-Repair Callbacks</div>
          <div style={{ color:"#6B6F78",fontSize:12,marginBottom:16 }}>Customers who called back 1-14 days after ticket closed</div>
          {callbacks.length > 0 ? (
            <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
              {callbacks.map(function(cb) {
                var store = STORES[cb.store];
                return (
                  <div key={cb.ticket_number} style={{ padding:"16px 20px",borderBottom:"1px solid #1E2028" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                      <div>
                        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                          <span style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{"#" + cb.ticket_number}</span>
                          <span style={{ color:"#6B6F78",fontSize:12 }}>{cb.customer_name}</span>
                          {store && <span style={{ color:store.color,fontSize:10 }}>{store.name.replace("CPR ","")}</span>}
                        </div>
                        <div style={{ color:"#8B8F98",fontSize:11,marginTop:4 }}>
                          {cb.device && <span>{cb.device}</span>}
                          {cb.employee_repaired && <span style={{ marginLeft:8 }}>{"Repaired by: " + cb.employee_repaired}</span>}
                        </div>
                      </div>
                      <div style={{ textAlign:"right" }}>
                        <div style={{ color:"#F87171",fontSize:16,fontWeight:800 }}>{cb.callback_count + " callback" + (cb.callback_count > 1 ? "s" : "")}</div>
                        <div style={{ color:"#6B6F78",fontSize:11 }}>{"First: " + cb.days_after + " days after close"}</div>
                        <div style={{ color:"#6B6F78",fontSize:10 }}>{"Ticket score: " + cb.overall_score + "/100"}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78",fontSize:13 }}>No post-repair callbacks detected. Grade more tickets with the Chrome extension to enable callback tracking.</div>
          )}
        </div>
      )}
    </div>
  );
}

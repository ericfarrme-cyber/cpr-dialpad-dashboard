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

  var SUBTABS = [
    { id: "overview", label: "Overview", icon: "\uD83D\uDCA1" },
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
          return (<button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7B2FFF22":"#1A1D23",color:view===v.id?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>);
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

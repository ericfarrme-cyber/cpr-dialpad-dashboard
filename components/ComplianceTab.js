'use client';

import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

function scoreColor(s) { return s >= 80 ? "#4ADE80" : s >= 60 ? "#FBBF24" : s >= 40 ? "#FB923C" : "#F87171"; }
function fmt(n) { return "$" + parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background:"#1A1D23",borderRadius:12,padding:"18px 20px",borderLeft:"3px solid "+accent,minWidth:0 }}>
      <div style={{ color:"#8B8F98",fontSize:11,textTransform:"uppercase",letterSpacing:"0.08em" }}>{label}</div>
      <div style={{ color:"#F0F1F3",fontSize:28,fontWeight:700,marginTop:4 }}>{value}</div>
      {sub && <div style={{ color:"#6B6F78",fontSize:12,marginTop:2 }}>{sub}</div>}
    </div>
  );
}

export default function ComplianceTab({ storeFilter }) {
  var [view, setView] = useState("overview");
  var [stats, setStats] = useState(null);
  var [tickets, setTickets] = useState([]);
  var [loading, setLoading] = useState(true);
  var [expandedTicket, setExpandedTicket] = useState(null);

  var loadData = async function() {
    setLoading(true);
    try {
      var sp = storeFilter && storeFilter !== "all" ? "&store=" + storeFilter : "";
      var [statsRes, ticketsRes] = await Promise.all([
        fetch("/api/dialpad/tickets?action=stats" + sp).then(function(r) { return r.json(); }),
        fetch("/api/dialpad/tickets?action=list" + sp + "&limit=200").then(function(r) { return r.json(); }),
      ]);
      if (statsRes.success) setStats(statsRes.stats);
      if (ticketsRes.success) setTickets(ticketsRes.tickets || []);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(function() { loadData(); }, [storeFilter]);

  var SUBTABS = [
    { id: "overview", label: "Overview", icon: "\uD83D\uDCCA" },
    { id: "tickets", label: "All Tickets", icon: "\uD83C\uDFAB" },
    { id: "employees", label: "By Employee", icon: "\uD83D\uDC64" },
  ];

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading compliance data...</div>;

  var empChartData = stats && stats.empStats ? stats.empStats.slice(0, 15) : [];
  var storeChartData = stats && stats.storeStats ? stats.storeStats.map(function(s) {
    var store = STORES[s.store];
    return { name: store ? store.name.replace("CPR ", "") : s.store, score: s.avg_score, count: s.count, color: store ? store.color : "#8B8F98" };
  }) : [];

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display:"flex",gap:4,marginBottom:20 }}>
        {SUBTABS.map(function(v) {
          return <button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7B2FFF22":"#1A1D23",color:view===v.id?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
        })}
      </div>

      {/* ═══ OVERVIEW ═══ */}
      {view === "overview" && (
        <div>
          {stats && stats.total > 0 ? (
            <div>
              <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:24 }}>
                <StatCard label="Tickets Graded" value={stats.total} accent="#7B2FFF" />
                <StatCard label="Avg Score" value={stats.avgOverall + "/100"} accent={scoreColor(stats.avgOverall)} />
                <StatCard label="Diagnostics" value={stats.avgDiag + "%"} accent={scoreColor(stats.avgDiag)} />
                <StatCard label="Notes Quality" value={stats.avgNotes + "%"} accent={scoreColor(stats.avgNotes)} />
              </div>

              {/* Store comparison */}
              {storeChartData.length > 0 && (
                <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
                  <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Compliance by Store</div>
                  <div style={{ display:"grid",gridTemplateColumns:"repeat("+storeChartData.length+",1fr)",gap:16 }}>
                    {storeChartData.map(function(s) {
                      var c = scoreColor(s.score);
                      return (
                        <div key={s.name} style={{ textAlign:"center",background:"#12141A",borderRadius:10,padding:16 }}>
                          <div style={{ color:s.color,fontSize:14,fontWeight:700,marginBottom:8 }}>{s.name}</div>
                          <div style={{ color:c,fontSize:32,fontWeight:800 }}>{s.score}</div>
                          <div style={{ color:"#6B6F78",fontSize:11 }}>{s.count} tickets</div>
                          <div style={{ background:"#1A1D23",borderRadius:4,height:6,overflow:"hidden",marginTop:8 }}>
                            <div style={{ width:s.score+"%",height:"100%",background:c,borderRadius:4 }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Employee chart */}
              {empChartData.length > 0 && (
                <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
                  <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Compliance by Employee</div>
                  <div style={{ height:Math.max(200, empChartData.length * 36) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={empChartData} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
                        <XAxis type="number" domain={[0,100]} tick={{fill:"#6B6F78",fontSize:10}} />
                        <YAxis type="category" dataKey="name" tick={{fill:"#C8CAD0",fontSize:11}} width={120} />
                        <Tooltip contentStyle={{background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8}} formatter={function(v){return v+"/100";}} />
                        <Bar dataKey="avg_score" name="Compliance Score" barSize={16} radius={[0,4,4,0]}>
                          {empChartData.map(function(entry, i) {
                            return <rect key={i} fill={scoreColor(entry.avg_score)} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center" }}>
              <div style={{ fontSize:32,marginBottom:12 }}>{"\uD83D\uDD27"}</div>
              <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700,marginBottom:8 }}>No tickets graded yet</div>
              <div style={{ color:"#6B6F78",fontSize:13 }}>Use the Chrome extension on RepairQ to grade tickets. Results will appear here.</div>
            </div>
          )}
        </div>
      )}

      {/* ═══ ALL TICKETS ═══ */}
      {view === "tickets" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Graded Tickets ({tickets.length})</div>
          {tickets.length > 0 ? (
            <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
              {tickets.map(function(t) {
                var sc = scoreColor(t.overall_score);
                var isExpanded = expandedTicket === t.id;
                var store = STORES[t.store];
                return (
                  <div key={t.id} style={{ borderBottom:"1px solid #1E2028" }}>
                    <div onClick={function(){ setExpandedTicket(isExpanded ? null : t.id); }}
                      style={{ padding:"14px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",background:isExpanded?"#12141A":"transparent" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:14 }}>
                        <div style={{ padding:"4px 10px",borderRadius:6,background:sc+"22",color:sc,fontSize:16,fontWeight:800,minWidth:50,textAlign:"center" }}>{t.overall_score}</div>
                        <div>
                          <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:700 }}>{"#" + t.ticket_number}</div>
                          <div style={{ color:"#6B6F78",fontSize:11 }}>
                            {t.ticket_type || "—"}
                            {store && <span style={{ marginLeft:8,color:store.color }}>{store.name.replace("CPR ","")}</span>}
                            {t.employee_repaired && <span style={{ marginLeft:8 }}>{t.employee_repaired}</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display:"flex",gap:12,alignItems:"center" }}>
                        {[
                          { label:"Diag", score:t.diagnostics_score },
                          { label:"Notes", score:t.notes_score },
                          { label:"Pay", score:t.payment_score },
                        ].map(function(cat) {
                          return (
                            <div key={cat.label} style={{ textAlign:"center" }}>
                              <div style={{ color:"#8B8F98",fontSize:8,textTransform:"uppercase" }}>{cat.label}</div>
                              <div style={{ color:scoreColor(cat.score),fontSize:13,fontWeight:700 }}>{cat.score}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ padding:"0 20px 20px",background:"#12141A" }}>
                        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12 }}>
                          {[
                            { label:"Diagnostics",score:t.diagnostics_score,notes:t.diagnostics_notes,color:"#7B2FFF" },
                            { label:"Ticket Notes",score:t.notes_score,notes:t.notes_detail,color:"#00D4FF" },
                            { label:"Payment/Down Payment",score:t.payment_score,notes:t.payment_notes + (t.categorization_notes ? " — " + t.categorization_notes : ""),color:"#FBBF24" },
                          ].map(function(cat) {
                            return (
                              <div key={cat.label} style={{ background:"#0F1117",borderRadius:8,padding:14,border:"1px solid "+cat.color+"22" }}>
                                <div style={{ display:"flex",justifyContent:"space-between",marginBottom:6 }}>
                                  <span style={{ color:cat.color,fontSize:11,fontWeight:700 }}>{cat.label}</span>
                                  <span style={{ color:scoreColor(cat.score),fontSize:14,fontWeight:800 }}>{cat.score}</span>
                                </div>
                                <div style={{ color:"#8B8F98",fontSize:11,lineHeight:1.4 }}>{cat.notes || "—"}</div>
                              </div>
                            );
                          })}
                        </div>
                        <div style={{ display:"flex",gap:12,marginBottom:8 }}>
                          <span style={{ fontSize:12 }}>{t.notes_outcome_documented ? "\u2705" : "\u274C"} Repair outcome documented</span>
                          <span style={{ fontSize:12 }}>{t.notes_customer_contacted ? "\u2705" : "\u274C"} Customer contacted</span>
                        </div>
                        {t.device && <div style={{ color:"#6B6F78",fontSize:11 }}>Device: {t.device}</div>}
                        {t.customer_name && <div style={{ color:"#6B6F78",fontSize:11 }}>Customer: {t.customer_name}</div>}
                        {t.date_closed && <div style={{ color:"#6B6F78",fontSize:11 }}>Closed: {new Date(t.date_closed).toLocaleDateString()}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78",fontSize:13 }}>No graded tickets yet.</div>
          )}
        </div>
      )}

      {/* ═══ BY EMPLOYEE ═══ */}
      {view === "employees" && (
        <div>
          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Employee Compliance Scores</div>
          {stats && stats.empStats && stats.empStats.length > 0 ? (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              {stats.empStats.map(function(emp, i) {
                var sc = scoreColor(emp.avg_score);
                var medal = i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : i === 2 ? "\uD83E\uDD49" : "#" + (i+1);
                return (
                  <div key={emp.name} style={{ padding:"12px 0",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                      <span style={{ fontSize:16,width:28,textAlign:"center" }}>{medal}</span>
                      <div>
                        <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.name}</div>
                        <div style={{ color:"#6B6F78",fontSize:11 }}>{emp.count} tickets graded</div>
                      </div>
                    </div>
                    <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                      <div style={{ background:"#12141A",borderRadius:4,height:6,width:100,overflow:"hidden" }}>
                        <div style={{ width:emp.avg_score+"%",height:"100%",background:sc,borderRadius:4 }} />
                      </div>
                      <div style={{ color:sc,fontSize:18,fontWeight:800,minWidth:50,textAlign:"right" }}>{emp.avg_score}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center",color:"#6B6F78",fontSize:13 }}>No employee data yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

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

function formatPhone(phone) {
  if (!phone) return "Unknown";
  var d = phone.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length === 10) return "(" + d.slice(0,3) + ") " + d.slice(3,6) + "-" + d.slice(6);
  return phone;
}

function timeAgo(minutes) {
  if (minutes < 60) return minutes + "m ago";
  if (minutes < 1440) return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m ago";
  return Math.floor(minutes / 1440) + "d ago";
}

function callbackTime(minutes) {
  if (!minutes && minutes !== 0) return "—";
  if (minutes < 60) return minutes + " min";
  if (minutes < 1440) return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
  return Math.floor(minutes / 1440) + "d " + Math.floor((minutes % 1440) / 60) + "h";
}

export default function VoicemailTab({ storeFilter }) {
  var [voicemails, setVoicemails] = useState([]);
  var [summary, setSummary] = useState(null);
  var [loading, setLoading] = useState(true);
  var [view, setView] = useState("dashboard");
  var [statusFilter, setStatusFilter] = useState("all");

  useEffect(function() {
    async function load() {
      setLoading(true);
      try {
        var sp = storeFilter !== "all" ? "&store=" + storeFilter : "";
        var res = await fetch("/api/dialpad/voicemails?days=30" + sp);
        var json = await res.json();
        if (json.success) {
          setVoicemails(json.voicemails || []);
          setSummary(json.summary || null);
        }
      } catch(e) { console.error("Voicemail load error:", e); }
      setLoading(false);
    }
    load();
  }, [storeFilter]);

  var filtered = useMemo(function() {
    if (statusFilter === "all") return voicemails;
    if (statusFilter === "urgent") return voicemails.filter(function(v) { return v.urgent; });
    if (statusFilter === "unreturned") return voicemails.filter(function(v) { return v.status === "unreturned"; });
    if (statusFilter === "returned") return voicemails.filter(function(v) { return v.status !== "unreturned"; });
    return voicemails;
  }, [voicemails, statusFilter]);

  var storeChartData = useMemo(function() {
    if (!summary) return [];
    return STORE_KEYS.map(function(sk) {
      var s = summary.by_store[sk] || {};
      var store = STORES[sk];
      return { name: store ? store.name.replace("CPR ", "") : sk, returned: s.returned || 0, unreturned: s.unreturned || 0, rate: s.rate || 0, color: store ? store.color : "#8B8F98" };
    }).filter(function(d) { return d.returned + d.unreturned > 0; });
  }, [summary]);

  var SUBTABS = [
    { id: "dashboard", label: "Dashboard", icon: "\uD83D\uDCCA" },
    { id: "list", label: "All Voicemails", icon: "\uD83D\uDCDE" },
  ];

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading voicemail data...</div>;

  var returnRate = summary ? (summary.total > 0 ? ((summary.returned / summary.total) * 100).toFixed(1) : "0") : "—";

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8 }}>
        <div style={{ display:"flex",gap:4 }}>
          {SUBTABS.map(function(v) {
            return <button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7C8AFF22":"#1A1D23",color:view===v.id?"#7C8AFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
          })}
        </div>
        <div style={{ display:"flex",gap:4 }}>
          {[{k:"all",l:"All"},{k:"urgent",l:"Urgent"},{k:"unreturned",l:"Unreturned"},{k:"returned",l:"Returned"}].map(function(f) {
            return <button key={f.k} onClick={function(){setStatusFilter(f.k);}} style={{ padding:"5px 12px",borderRadius:6,border:"none",cursor:"pointer",background:statusFilter===f.k?"#2A2D35":"transparent",color:statusFilter===f.k?"#F0F1F3":"#6B6F78",fontSize:11,fontWeight:600 }}>{f.l}{f.k==="urgent"&&summary&&summary.urgent>0?" ("+summary.urgent+")":""}</button>;
          })}
        </div>
      </div>

      {/* ═══ DASHBOARD ═══ */}
      {view === "dashboard" && summary && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14,marginBottom:28 }}>
            <StatCard label="Total Voicemails" value={summary.total} accent="#7C8AFF" sub="last 30 days" />
            <StatCard label="Return Rate" value={returnRate+"%"} accent={parseFloat(returnRate)>=80?"#4ADE80":parseFloat(returnRate)>=60?"#FBBF24":"#F87171"} sub={summary.returned+" of "+summary.total+" returned"} />
            <StatCard label="Unreturned" value={summary.unreturned} accent="#F87171" sub={summary.urgent+" urgent (1hr+)"} />
            <StatCard label="Avg Callback" value={summary.avg_callback_min > 0 ? callbackTime(summary.avg_callback_min) : "—"} accent="#C084FC" sub="time to return" />
            <StatCard label="Urgent" value={summary.urgent} accent={summary.urgent>0?"#F87171":"#4ADE80"} sub="unreturned > 1 hour" />
          </div>

          {/* Per-store breakdown */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat("+Math.min(STORE_KEYS.length,3)+",1fr)",gap:14,marginBottom:20 }}>
            {STORE_KEYS.map(function(sk) {
              var s = (summary.by_store[sk]) || {};
              var store = STORES[sk];
              if (!store) return null;
              var rate = s.total > 0 ? ((s.returned / s.total) * 100).toFixed(1) : "0";
              var sc = parseFloat(rate) >= 80 ? "#4ADE80" : parseFloat(rate) >= 60 ? "#FBBF24" : "#F87171";
              return (
                <div key={sk} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+store.color+"33" }}>
                  <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                      <div style={{ width:32,height:32,borderRadius:8,background:store.color+"22",display:"flex",alignItems:"center",justifyContent:"center",color:store.color,fontWeight:800 }}>{store.icon}</div>
                      <div>
                        <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{store.name}</div>
                        <div style={{ color:"#6B6F78",fontSize:11 }}>{s.total || 0} voicemails</div>
                      </div>
                    </div>
                    <div style={{ padding:"6px 12px",borderRadius:8,background:sc+"22",color:sc,fontSize:18,fontWeight:800 }}>{rate}%</div>
                  </div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8 }}>
                    <div style={{ background:"#12141A",borderRadius:8,padding:"8px 10px",textAlign:"center" }}>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Returned</div>
                      <div style={{ color:"#4ADE80",fontSize:16,fontWeight:700 }}>{s.returned || 0}</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:8,padding:"8px 10px",textAlign:"center" }}>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Unreturned</div>
                      <div style={{ color:"#F87171",fontSize:16,fontWeight:700 }}>{s.unreturned || 0}</div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:8,padding:"8px 10px",textAlign:"center" }}>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Urgent</div>
                      <div style={{ color:s.urgent > 0 ? "#F87171" : "#4ADE80",fontSize:16,fontWeight:700 }}>{s.urgent || 0}</div>
                    </div>
                  </div>
                  <div style={{ marginTop:12,background:"#12141A",borderRadius:6,height:8,overflow:"hidden" }}>
                    <div style={{ width:rate+"%",height:"100%",background:sc,borderRadius:6 }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Urgent voicemails */}
          {summary.urgent > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20,border:"1px solid #F8717133" }}>
              <SectionHeader title={"Urgent — Unreturned > 1 Hour ("+summary.urgent+")"} subtitle="These need immediate attention" icon={"\uD83D\uDEA8"} />
              <div style={{ maxHeight:300,overflowY:"auto" }}>
                {voicemails.filter(function(v) { return v.urgent; }).map(function(vm, i) {
                  var store = STORES[vm.store];
                  var d = new Date(vm.date);
                  return (
                    <div key={vm.call_id || i} style={{ padding:"12px 0",borderBottom:"1px solid #2A2D35",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                        <div style={{ width:36,height:36,borderRadius:8,background:"#F8717122",display:"flex",alignItems:"center",justifyContent:"center",color:"#F87171",fontSize:16 }}>{"\uD83D\uDCF1"}</div>
                        <div>
                          <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{formatPhone(vm.phone)}</div>
                          <div style={{ display:"flex",gap:8,alignItems:"center" }}>
                            <span style={{ color:store?store.color:"#8B8F98",fontSize:11 }}>{store?store.name.replace("CPR ",""):vm.store}</span>
                            <span style={{ color:"#6B6F78",fontSize:11 }}>{d.toLocaleDateString()+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                        <span style={{ color:"#F87171",fontSize:12,fontWeight:700 }}>{timeAgo(vm.age_minutes)}</span>
                        <a href={"tel:"+vm.phone} style={{ padding:"6px 14px",borderRadius:6,background:"#4ADE8022",color:"#4ADE80",fontSize:11,fontWeight:700,textDecoration:"none",cursor:"pointer" }}>Call Back</a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Return rate chart */}
          {storeChartData.length > 0 && (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
              <SectionHeader title="VM Return Rate by Store" subtitle="Percentage of voicemails returned" icon={"\uD83D\uDCCA"} />
              <div style={{ height:200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={storeChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" vertical={false} />
                    <XAxis dataKey="name" tick={{fill:"#8B8F98",fontSize:11}} tickLine={false} axisLine={false} />
                    <YAxis tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false} domain={[0,100]} tickFormatter={function(v){return v+"%";}} />
                    <Tooltip contentStyle={{background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8}} formatter={function(v){return v+"%";}} />
                    <Bar dataKey="rate" name="Return Rate" radius={[6,6,0,0]} barSize={40}>
                      {storeChartData.map(function(entry, i) {
                        var c = entry.rate >= 80 ? "#4ADE80" : entry.rate >= 60 ? "#FBBF24" : "#F87171";
                        return <Cell key={i} fill={c} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ ALL VOICEMAILS LIST ═══ */}
      {view === "list" && (
        <div>
          <SectionHeader title={"Voicemails ("+filtered.length+")"} subtitle="All voicemails with callback status" icon={"\uD83D\uDCDE"} />
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20,maxHeight:700,overflowY:"auto" }}>
            {/* Header */}
            <div style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1.5fr 80px",gap:8,padding:"0 0 10px",borderBottom:"1px solid #2A2D35" }}>
              {["Caller","Store","Left At","Callback","Status"].map(function(h,i) {
                return <div key={i} style={{ color:"#6B6F78",fontSize:10,textTransform:"uppercase",fontWeight:600 }}>{h}</div>;
              })}
            </div>

            {filtered.map(function(vm, i) {
              var store = STORES[vm.store];
              var d = new Date(vm.date);
              var statusConfig = {
                unreturned: { label: "Unreturned", color: "#F87171", bg: "#F8717112" },
                returned_fast: { label: "< 30 min", color: "#4ADE80", bg: "#4ADE8012" },
                returned_ok: { label: "< 1 hr", color: "#FBBF24", bg: "#FBBF2412" },
                returned_late: { label: "> 1 hr", color: "#FB923C", bg: "#FB923C12" },
              };
              var sc = statusConfig[vm.status] || statusConfig.unreturned;

              return (
                <div key={vm.call_id || i} style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1.5fr 80px",gap:8,padding:"12px 0",borderBottom:"1px solid #1E2028",alignItems:"center",opacity:vm.status==="unreturned"?1:0.85 }}>
                  <div>
                    <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{formatPhone(vm.phone)}</div>
                    {vm.urgent && <span style={{ color:"#F87171",fontSize:9,fontWeight:700 }}>URGENT — {timeAgo(vm.age_minutes)}</span>}
                  </div>
                  <div>
                    <span style={{ display:"inline-flex",alignItems:"center",gap:4,fontSize:11,color:store?store.color:"#8B8F98" }}>
                      <span style={{ width:6,height:6,borderRadius:"50%",background:store?store.color:"#8B8F98" }} />
                      {store?store.name.replace("CPR ",""):vm.store}
                    </span>
                  </div>
                  <div style={{ color:"#C8CAD0",fontSize:11 }}>
                    {d.toLocaleDateString([],{month:"short",day:"numeric"})+" "+d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                  </div>
                  <div>
                    {vm.callback_date ? (
                      <div>
                        <div style={{ color:"#C8CAD0",fontSize:11 }}>
                          {new Date(vm.callback_date).toLocaleDateString([],{month:"short",day:"numeric"})+" "+new Date(vm.callback_date).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                        </div>
                        <div style={{ color:"#8B8F98",fontSize:10 }}>
                          {"Returned in "+callbackTime(vm.callback_minutes)}
                          {vm.callback_store && vm.callback_store !== vm.store ? " (from "+(STORES[vm.callback_store]?STORES[vm.callback_store].name.replace("CPR ",""):vm.callback_store)+")" : ""}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                        <span style={{ color:"#F87171",fontSize:11 }}>Not returned</span>
                        <a href={"tel:"+vm.phone} style={{ padding:"3px 8px",borderRadius:4,background:"#4ADE8018",color:"#4ADE80",fontSize:10,fontWeight:600,textDecoration:"none" }}>Call</a>
                      </div>
                    )}
                  </div>
                  <div>
                    <span style={{ padding:"3px 10px",borderRadius:6,fontSize:10,fontWeight:700,background:sc.bg,color:sc.color }}>{sc.label}</span>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>
                {statusFilter !== "all" ? "No voicemails match this filter." : "No voicemails found in the last 30 days."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

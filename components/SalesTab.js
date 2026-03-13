'use client';

import { useState, useEffect, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

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

function fmt(n) { return "$" + parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function SalesTab() {
  var [view, setView] = useState("leaderboard");
  var [loading, setLoading] = useState(true);
  var currentPeriod = useMemo(function() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  }, []);

  var [period, setPeriod] = useState(function() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  });
  var [periods, setPeriods] = useState([]);
  var [phones, setPhones] = useState([]);
  var [others, setOthers] = useState([]);
  var [accessories, setAccessories] = useState([]);
  var [cleanings, setCleanings] = useState([]);
  var [rates, setRates] = useState({});
  var [config, setConfig] = useState([]);
  var [uploadMsg, setUploadMsg] = useState(null);
  var [uploading, setUploading] = useState(false);
  var [editingRate, setEditingRate] = useState(null);
  var [editValue, setEditValue] = useState("");
  var [importPeriod, setImportPeriod] = useState(function() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  });

  var loadData = async function(p) {
    setLoading(true);
    try {
      var url = "/api/dialpad/sales?action=performance" + (p ? "&period=" + p : "");
      var res = await fetch(url);
      var json = await res.json();
      if (json.success) {
        setPhones(json.phones || []);
        setOthers(json.others || []);
        setAccessories(json.accessories || []);
        setCleanings(json.cleanings || []);
        setRates(json.rates || {});
        setPeriod(p || json.period);
        var ap = json.available_periods || [];
        // Always include current month and requested month in dropdown
        if (ap.indexOf(currentPeriod) < 0) ap = [currentPeriod].concat(ap);
        if (p && ap.indexOf(p) < 0) ap.push(p);
        ap.sort().reverse();
        setPeriods(ap);
      }
    } catch(e) { console.error(e); }

    try {
      var cRes = await fetch("/api/dialpad/sales?action=commission_config");
      var cJson = await cRes.json();
      if (cJson.success) setConfig(cJson.config || []);
    } catch(e) {}

    setLoading(false);
  };

  useEffect(function() { loadData(currentPeriod); }, []);

  // Build unified employee performance
  var employees = useMemo(function() {
    var map = {};
    function ensure(name) {
      if (!name) return null;
      if (!map[name]) map[name] = { name: name, phone_tickets: 0, phone_total: 0, phone_avg: 0, other_count: 0, other_total: 0, accy_count: 0, accy_total: 0, accy_gp: 0, clean_count: 0, clean_total: 0 };
      return map[name];
    }
    phones.forEach(function(r) { var e = ensure(r.employee); if (e) { e.phone_tickets = r.repair_tickets || 0; e.phone_total = parseFloat(r.repair_total) || 0; e.phone_avg = parseFloat(r.avg_repair) || 0; } });
    others.forEach(function(r) { var e = ensure(r.employee); if (e) { e.other_count = r.repair_count || 0; e.other_total = parseFloat(r.repair_total) || 0; } });
    accessories.forEach(function(r) { var e = ensure(r.employee); if (e) { e.accy_count = r.accy_count || 0; e.accy_total = parseFloat(r.accy_total) || 0; e.accy_gp = parseFloat(r.accy_gp) || 0; } });
    cleanings.forEach(function(r) { var e = ensure(r.employee); if (e) { e.clean_count = r.clean_count || 0; e.clean_total = parseFloat(r.clean_total) || 0; } });

    return Object.values(map).map(function(e) {
      e.total_revenue = e.phone_total + e.other_total + e.accy_total + e.clean_total;
      e.total_tickets = e.phone_tickets + e.other_count + e.accy_count + e.clean_count;
      // Commission calculation — respect enabled flags from config
      var configMap = {};
      (config || []).forEach(function(c) { configMap[c.config_key] = c; });
      var isEnabled = function(key) { return configMap[key] ? configMap[key].enabled !== false : true; };

      e.comm_phone = isEnabled("phone_repair_standard") ? e.phone_tickets * (rates.phone_repair_standard || 1) : 0;
      e.comm_other = isEnabled("other_repair_rate") ? e.other_count * (rates.other_repair_rate || 2.5) : 0;
      e.comm_accy = isEnabled("accessory_gp_rate") ? e.accy_gp * (rates.accessory_gp_rate || 0.15) : 0;
      e.comm_clean = isEnabled("cleaning_rate") ? e.clean_total * (rates.cleaning_rate || 0.10) : 0;
      e.total_commission = e.comm_phone + e.comm_other + e.comm_accy + e.comm_clean;
      return e;
    }).sort(function(a, b) { return b.total_revenue - a.total_revenue; });
  }, [phones, others, accessories, cleanings, rates, config]);

  var totals = useMemo(function() {
    return employees.reduce(function(t, e) {
      t.revenue += e.total_revenue; t.tickets += e.total_tickets; t.commission += e.total_commission;
      t.phone_tickets += e.phone_tickets; t.phone_total += e.phone_total;
      t.other_count += e.other_count; t.accy_count += e.accy_count; t.clean_count += e.clean_count;
      return t;
    }, { revenue: 0, tickets: 0, commission: 0, phone_tickets: 0, phone_total: 0, other_count: 0, accy_count: 0, clean_count: 0 });
  }, [employees]);

  var uploadCSV = async function(file, type) {
    setUploading(true); setUploadMsg(null);
    try {
      var fd = new FormData();
      fd.append("file", file);
      fd.append("type", type);
      fd.append("period", importPeriod || currentPeriod);
      var res = await fetch("/api/dialpad/sales", { method: "POST", body: fd });
      var json = await res.json();
      if (json.success) {
        setUploadMsg({ type: "success", text: "Uploaded " + json.saved + " rows for " + type.replace("_", " ") + " (" + json.period + ")" });
        // Sync leaderboard period to what was just uploaded
        var uploadedPeriod = importPeriod || currentPeriod;
        setPeriod(uploadedPeriod);
        await loadData(uploadedPeriod);
      } else {
        setUploadMsg({ type: "error", text: json.error || "Upload failed" });
      }
    } catch(e) { setUploadMsg({ type: "error", text: e.message }); }
    setUploading(false);
    setTimeout(function() { setUploadMsg(null); }, 5000);
  };

  var updateRate = async function(key, value) {
    try {
      var res = await fetch("/api/dialpad/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_commission", key: key, value: value })
      });
      var json = await res.json();
      if (json.success) {
        setRates(function(prev) { var n = Object.assign({}, prev); n[key] = parseFloat(value); return n; });
        setConfig(function(prev) { return prev.map(function(c) { return c.config_key === key ? Object.assign({}, c, { config_value: value }) : c; }); });
        setEditingRate(null);
        setUploadMsg({ type: "success", text: "Commission rate updated" });
        setTimeout(function() { setUploadMsg(null); }, 3000);
      }
    } catch(e) { setUploadMsg({ type: "error", text: e.message }); }
  };

  var toggleRate = async function(key, currentEnabled) {
    try {
      var res = await fetch("/api/dialpad/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle_commission", key: key, enabled: !currentEnabled })
      });
      var json = await res.json();
      if (json.success) {
        setConfig(function(prev) { return prev.map(function(c) { return c.config_key === key ? Object.assign({}, c, { enabled: !currentEnabled }) : c; }); });
      }
    } catch(e) { console.error(e); }
  };

  var deletePeriod = async function(p) {
    var label = new Date(p + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (!confirm("⚠️ DELETE ALL DATA FOR " + label.toUpperCase() + "\n\nThis will permanently delete all phone repairs, other repairs, accessory sales, and cleaning data for this period.\n\nAre you sure?")) return;
    if (!confirm("SECOND CONFIRMATION\n\nAll " + label + " sales and commission data will be erased. This cannot be undone.\n\nProceed?")) return;
    try {
      var res = await fetch("/api/dialpad/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_period", period: p })
      });
      var json = await res.json();
      if (json.success) {
        setUploadMsg({ type: "success", text: "Deleted all data for " + label });
        setPhones([]); setOthers([]); setAccessories([]); setCleanings([]);
        setPeriods(function(prev) { return prev.filter(function(pp) { return pp !== p; }); });
        setTimeout(function() { setUploadMsg(null); }, 5000);
      } else {
        setUploadMsg({ type: "error", text: json.error || "Delete failed" });
      }
    } catch(e) { setUploadMsg({ type: "error", text: e.message }); }
  };

  var SUBTABS = [
    { id: "leaderboard", label: "Leaderboard", icon: "🏆" },
    { id: "upload", label: "Import Data", icon: "📤" },
    { id: "commissions", label: "Commission Config", icon: "⚙️" },
  ];

  if (loading) return <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading sales data...</div>;

  var periodLabel = period ? new Date(period + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "No data";

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8 }}>
        <div style={{ display:"flex",gap:4 }}>
          {SUBTABS.map(function(v) {
            return <button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7B2FFF22":"#1A1D23",color:view===v.id?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.icon+" "+v.label}</button>;
          })}
        </div>
        {periods.length > 0 && (
          <div style={{ display:"flex",gap:6,alignItems:"center" }}>
            <select value={period} onChange={function(e) { setPeriod(e.target.value); loadData(e.target.value); }}
              style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12 }}>
              {periods.map(function(p) {
                var label = new Date(p + "-01").toLocaleDateString(undefined, { month: "long", year: "numeric" });
                return <option key={p} value={p}>{label}</option>;
              })}
            </select>
            <button onClick={function(){ deletePeriod(period); }}
              style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:11,cursor:"pointer",fontWeight:600,whiteSpace:"nowrap" }}>
              Delete Period
            </button>
          </div>
        )}
      </div>

      {uploadMsg && (
        <div style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,background:uploadMsg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(uploadMsg.type==="success"?"#4ADE8033":"#F8717133"),color:uploadMsg.type==="success"?"#4ADE80":"#F87171",fontSize:13 }}>
          {uploadMsg.text}
        </div>
      )}

      {/* ═══ LEADERBOARD ═══ */}
      {view === "leaderboard" && (
        <div>
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:28 }}>
            <StatCard label="Total Revenue" value={fmt(totals.revenue)} accent="#4ADE80" sub={totals.tickets + " total tickets"} />
            <StatCard label="Phone Repairs" value={totals.phone_tickets} accent="#7B2FFF" sub={fmt(totals.phone_total) + " revenue"} />
            <StatCard label="Accessories" value={totals.accy_count} accent="#00D4FF" />
            <StatCard label="Total Commissions" value={fmt(totals.commission)} accent="#FBBF24" sub={employees.length + " employees"} />
          </div>

          {employees.length > 0 ? (
            <div>
              {/* Revenue chart */}
              <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
                <SectionHeader title="Revenue by Employee" subtitle={periodLabel} icon="💰" />
                <div style={{ height:Math.max(200, employees.length * 40) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={employees} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A2D35" horizontal={false} />
                      <XAxis type="number" tick={{fill:"#6B6F78",fontSize:10}} tickLine={false} axisLine={false} tickFormatter={function(v){return "$"+v.toLocaleString();}} />
                      <YAxis type="category" dataKey="name" tick={{fill:"#C8CAD0",fontSize:11}} width={130} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{background:"#1E2028",border:"1px solid #2A2D35",borderRadius:8}} formatter={function(v){return "$"+parseFloat(v).toLocaleString(undefined,{minimumFractionDigits:2});}} />
                      <Bar dataKey="phone_total" name="Phone Repairs" fill="#7B2FFF" stackId="rev" barSize={18} />
                      <Bar dataKey="other_total" name="Other Repairs" fill="#00D4FF" stackId="rev" />
                      <Bar dataKey="accy_total" name="Accessories" fill="#4ADE80" stackId="rev" />
                      <Bar dataKey="clean_total" name="Cleanings" fill="#FBBF24" stackId="rev" radius={[0,4,4,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Employee table */}
              <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
                <SectionHeader title="Employee Performance" subtitle={periodLabel + " — MTD"} icon="🏆" />
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%",borderCollapse:"collapse",minWidth:900 }}>
                    <thead>
                      <tr style={{ borderBottom:"1px solid #2A2D35" }}>
                        {["#","Employee","Phone Repairs","Other Repairs","Accessories","Cleanings","Total Revenue","Commission"].map(function(h,i) {
                          return <th key={i} style={{ textAlign:i<=1?"left":"right",padding:"10px 12px",color:"#6B6F78",fontSize:10,textTransform:"uppercase" }}>{h}</th>;
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map(function(emp, i) {
                        var medal = i===0?"\uD83E\uDD47":i===1?"\uD83E\uDD48":i===2?"\uD83E\uDD49":"#"+(i+1);
                        return (
                          <tr key={emp.name} style={{ borderBottom:"1px solid #1E2028" }}>
                            <td style={{ padding:"12px",fontSize:16,textAlign:"center",width:40 }}>{medal}</td>
                            <td style={{ padding:"12px",color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{emp.name}</td>
                            <td style={{ padding:"12px",textAlign:"right" }}>
                              <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{emp.phone_tickets}</div>
                              <div style={{ color:"#6B6F78",fontSize:10 }}>{fmt(emp.phone_total)}</div>
                            </td>
                            <td style={{ padding:"12px",textAlign:"right" }}>
                              <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{emp.other_count}</div>
                              <div style={{ color:"#6B6F78",fontSize:10 }}>{fmt(emp.other_total)}</div>
                            </td>
                            <td style={{ padding:"12px",textAlign:"right" }}>
                              <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{emp.accy_count}</div>
                              <div style={{ color:"#6B6F78",fontSize:10 }}>{fmt(emp.accy_gp) + " GP"}</div>
                            </td>
                            <td style={{ padding:"12px",textAlign:"right" }}>
                              <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{emp.clean_count}</div>
                              <div style={{ color:"#6B6F78",fontSize:10 }}>{fmt(emp.clean_total)}</div>
                            </td>
                            <td style={{ padding:"12px",textAlign:"right" }}>
                              <div style={{ color:"#4ADE80",fontSize:15,fontWeight:800 }}>{fmt(emp.total_revenue)}</div>
                            </td>
                            <td style={{ padding:"12px",textAlign:"right" }}>
                              <div style={{ color:"#FBBF24",fontSize:15,fontWeight:800 }}>{fmt(emp.total_commission)}</div>
                              <div style={{ color:"#6B6F78",fontSize:9 }}>
                                {fmt(emp.comm_phone)+" rep | "+fmt(emp.comm_accy)+" acc | "+fmt(emp.comm_clean)+" cln"}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Totals row */}
                      <tr style={{ borderTop:"2px solid #2A2D35",background:"#12141A" }}>
                        <td colSpan={2} style={{ padding:"12px",color:"#8B8F98",fontSize:12,fontWeight:700 }}>TOTALS</td>
                        <td style={{ padding:"12px",textAlign:"right",color:"#F0F1F3",fontWeight:700 }}>{totals.phone_tickets}</td>
                        <td style={{ padding:"12px",textAlign:"right",color:"#F0F1F3",fontWeight:700 }}>{totals.other_count}</td>
                        <td style={{ padding:"12px",textAlign:"right",color:"#F0F1F3",fontWeight:700 }}>{totals.accy_count}</td>
                        <td style={{ padding:"12px",textAlign:"right",color:"#F0F1F3",fontWeight:700 }}>{totals.clean_count}</td>
                        <td style={{ padding:"12px",textAlign:"right",color:"#4ADE80",fontSize:15,fontWeight:800 }}>{fmt(totals.revenue)}</td>
                        <td style={{ padding:"12px",textAlign:"right",color:"#FBBF24",fontSize:15,fontWeight:800 }}>{fmt(totals.commission)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ background:"#1A1D23",borderRadius:12,padding:40,textAlign:"center" }}>
              <div style={{ fontSize:32,marginBottom:12 }}>{"💰"}</div>
              <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700,marginBottom:8 }}>No sales data yet</div>
              <div style={{ color:"#6B6F78",fontSize:13,marginBottom:16 }}>Import your RepairQ CSV files to see employee performance and commissions.</div>
              <button onClick={function(){setView("upload");}} style={{ padding:"8px 20px",borderRadius:6,border:"none",background:"#7B2FFF",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>Import Data</button>
            </div>
          )}
        </div>
      )}

      {/* ═══ UPLOAD ═══ */}
      {view === "upload" && (
        <div>
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20 }}>
            <SectionHeader title="Import RepairQ Data" subtitle="" icon="📤" />
            <div style={{ display:"flex",alignItems:"center",gap:8 }}>
              <span style={{ color:"#8B8F98",fontSize:12 }}>Importing for:</span>
              <input type="month" value={importPeriod}
                onChange={function(e) { setImportPeriod(e.target.value); }}
                style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,fontWeight:700,cursor:"pointer" }} />
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
            {[
              { type: "phone_repairs", label: "Phone Repairs", desc: "phone_repairs.csv — Employee, Repair Tkts, Repair Total, Average Repair", icon: "📱", color: "#7B2FFF" },
              { type: "other_repairs", label: "Other Repairs", desc: "other_repairs.csv — Employee, # Repairs, Repair Total, Avg", icon: "🔧", color: "#00D4FF" },
              { type: "accessories", label: "Accessory Sales", desc: "accessory_sales.csv — Employee, Accy Total, Accy GP, Accy Count", icon: "🛍️", color: "#4ADE80" },
              { type: "cleanings", label: "Charge Port Cleanings", desc: "charge_port_cleanings.csv — Employee, # Cleans, Cleans Total", icon: "🔌", color: "#FBBF24" },
            ].map(function(item) {
              return (
                <div key={item.type} style={{ background:"#1A1D23",borderRadius:12,padding:20,border:"1px solid "+item.color+"22" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:12 }}>
                    <span style={{ fontSize:20 }}>{item.icon}</span>
                    <div>
                      <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{item.label}</div>
                      <div style={{ color:"#6B6F78",fontSize:10 }}>{item.desc}</div>
                    </div>
                  </div>
                  <label style={{ display:"block",padding:"12px 16px",borderRadius:8,border:"2px dashed "+item.color+"33",background:item.color+"08",textAlign:"center",cursor:"pointer" }}>
                    <input type="file" accept=".csv" style={{ display:"none" }}
                      onChange={function(e) { if (e.target.files[0]) uploadCSV(e.target.files[0], item.type); }}
                      disabled={uploading} />
                    <span style={{ color:item.color,fontSize:12,fontWeight:600 }}>{uploading ? "Uploading..." : "Choose CSV File"}</span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ COMMISSION CONFIG ═══ */}
      {view === "commissions" && (
        <div>
          <SectionHeader title="Commission Rates" subtitle="Click a rate to edit it" icon="⚙️" />
          <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
            {config.map(function(c) {
              var isEditing = editingRate === c.config_key;
              var isPercent = c.config_key.includes("gp_rate") || c.config_key === "cleaning_rate";
              var displayValue = isPercent ? (parseFloat(c.config_value) * 100).toFixed(0) + "%" : "$" + parseFloat(c.config_value).toFixed(2);
              var isOn = c.enabled !== false;
              return (
                <div key={c.config_key} style={{ padding:"14px 0",borderBottom:"1px solid #2A2D35",display:"flex",justifyContent:"space-between",alignItems:"center",opacity:isOn?1:0.4 }}>
                  <div style={{ display:"flex",alignItems:"center",gap:12 }}>
                    <div onClick={function(){ toggleRate(c.config_key, isOn); }}
                      style={{ width:40,height:22,borderRadius:11,background:isOn?"#4ADE80":"#2A2D35",cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0 }}>
                      <div style={{ width:16,height:16,borderRadius:8,background:"#FFF",position:"absolute",top:3,left:isOn?21:3,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }} />
                    </div>
                    <div>
                      <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:600 }}>{c.label}</div>
                      <div style={{ color:"#6B6F78",fontSize:11 }}>{c.description}</div>
                    </div>
                  </div>
                  {isEditing ? (
                    <div style={{ display:"flex",gap:6,alignItems:"center" }}>
                      <input value={editValue} onChange={function(e){setEditValue(e.target.value);}}
                        style={{ width:80,padding:"6px 10px",borderRadius:6,border:"1px solid #7B2FFF44",background:"#12141A",color:"#F0F1F3",fontSize:14,fontWeight:700,textAlign:"right" }}
                        autoFocus />
                      <button onClick={function(){
                        var val = parseFloat(editValue);
                        if (isPercent) val = val / 100;
                        updateRate(c.config_key, val);
                      }} style={{ padding:"6px 12px",borderRadius:6,border:"none",background:"#4ADE80",color:"#000",fontSize:11,fontWeight:700,cursor:"pointer" }}>Save</button>
                      <button onClick={function(){setEditingRate(null);}} style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:11,cursor:"pointer" }}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={function(){
                      if (!isOn) return;
                      setEditingRate(c.config_key);
                      setEditValue(isPercent ? (parseFloat(c.config_value) * 100).toFixed(0) : parseFloat(c.config_value).toFixed(2));
                    }} style={{ padding:"6px 16px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:isOn?"#FBBF24":"#6B6F78",fontSize:16,fontWeight:800,cursor:isOn?"pointer":"default",minWidth:80,textAlign:"center" }}>
                      {displayValue}
                    </button>
                  )}
                </div>
              );
            })}
            {config.length === 0 && <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No commission config found. Run the SQL migration first.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

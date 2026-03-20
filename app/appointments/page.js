'use client';

import { useState, useEffect, useMemo } from "react";
import AuthProvider, { useAuth } from "@/components/AuthProvider";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

function normPhone(p) { return p ? String(p).replace(/\D/g, "").slice(-10) : ""; }
function fmtPhone(p) { var n = normPhone(p); return n.length === 10 ? "(" + n.slice(0,3) + ") " + n.slice(3,6) + "-" + n.slice(6) : p; }
function scoreColor(s) { return s >= 80 ? "#4ADE80" : s >= 60 ? "#FBBF24" : s >= 40 ? "#FB923C" : "#F87171"; }

function AppointmentApp() {
  var auth = useAuth();
  var [store, setStore] = useState("fishers");
  var [view, setView] = useState("today");
  var [appointments, setAppointments] = useState([]);
  var [stats, setStats] = useState(null);
  var [loading, setLoading] = useState(true);
  var [showForm, setShowForm] = useState(false);
  var [editingId, setEditingId] = useState(null);
  var [msg, setMsg] = useState(null);
  var [matchedCall, setMatchedCall] = useState(null);
  var [roster, setRoster] = useState([]);

  var emptyForm = { customer_name: "", customer_phone: "", date_of_appt: new Date().toISOString().split("T")[0], appt_time: "", reason: "", price_quoted: "", scheduled_by: "", did_arrive: "", notes: "" };
  var [form, setForm] = useState(emptyForm);
  var fileInputRef = useState(null);
  var [importing, setImporting] = useState(false);

  var loadData = async function() {
    setLoading(true);
    try {
      var [apptRes, statsRes, rosterRes] = await Promise.all([
        fetch("/api/dialpad/appointments?action=" + (view === "today" ? "today" : "list") + "&store=" + store + "&days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=stats&store=" + store + "&days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/roster").then(function(r){return r.json();}),
      ]);
      if (apptRes.success) setAppointments(apptRes.appointments || []);
      if (statsRes.success) setStats(statsRes);
      if (rosterRes.success) setRoster((rosterRes.roster || []).filter(function(r){return r.active;}));
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(function() { loadData(); }, [store, view]);

  var saveAppointment = async function() {
    if (!form.customer_name) { setMsg({ type:"error", text:"Customer name required" }); return; }
    try {
      var payload = Object.assign({}, form, { store: store, action: editingId ? "update" : "add" });
      if (editingId) payload.id = editingId;
      var res = await fetch("/api/dialpad/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: editingId ? "Updated" : "Appointment added" });
        setShowForm(false);
        setEditingId(null);
        setForm(emptyForm);
        setMatchedCall(null);
        loadData();
      } else {
        setMsg({ type: "error", text: json.error });
      }
    } catch(e) { setMsg({ type: "error", text: e.message }); }
    setTimeout(function(){ setMsg(null); }, 4000);
  };

  var deleteAppt = async function(id) {
    if (!confirm("Delete this appointment?")) return;
    var res = await fetch("/api/dialpad/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: id }) });
    var json = await res.json();
    if (json.success) loadData();
  };

  var updateArrival = async function(id, arrived) {
    var res = await fetch("/api/dialpad/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", id: id, did_arrive: arrived }) });
    var json = await res.json();
    if (json.success) loadData();
  };

  var markFollowUpDone = async function(id, notes) {
    var res = await fetch("/api/dialpad/appointments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", id: id, follow_up_done: true, follow_up_notes: notes || "Called back" }) });
    var json = await res.json();
    if (json.success) loadData();
  };

  // Auto-match phone number to recent calls
  var checkPhone = async function(phone) {
    var n = normPhone(phone);
    if (n.length !== 10) { setMatchedCall(null); return; }
    try {
      var res = await fetch("/api/dialpad/appointments?action=match_call&phone=" + n);
      var json = await res.json();
      if (json.success && json.calls && json.calls.length > 0) {
        setMatchedCall(json.calls[0]);
      } else {
        setMatchedCall(null);
      }
    } catch(e) { setMatchedCall(null); }
  };

  var startEdit = function(appt) {
    setForm({
      customer_name: appt.customer_name || "",
      customer_phone: appt.customer_phone || "",
      date_of_appt: appt.date_of_appt || "",
      appt_time: appt.appt_time || "",
      reason: appt.reason || "",
      price_quoted: appt.price_quoted || "",
      scheduled_by: appt.scheduled_by || "",
      did_arrive: appt.did_arrive || "",
      notes: appt.notes || "",
    });
    setEditingId(appt.id);
    setShowForm(true);
  };

  var storeEmployees = roster.filter(function(r) { return !store || store === "all" || (r.store || "").toLowerCase() === store.toLowerCase(); });
  if (storeEmployees.length === 0) storeEmployees = roster;
  var s = stats ? stats.stats : {};
  var followUps = appointments.filter(function(a) { return a.follow_up_needed && !a.follow_up_done; });

  var handleImport = async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    setImporting(true);
    setMsg(null);
    try {
      var buffer = await file.arrayBuffer();

      // Load SheetJS — try multiple CDN sources
      if (!window.XLSX) {
        var urls = [
          "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
          "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js",
        ];
        for (var ui = 0; ui < urls.length; ui++) {
          try {
            await new Promise(function(resolve, reject) {
              var s = document.createElement("script");
              s.src = urls[ui]; s.onload = resolve; s.onerror = reject;
              document.head.appendChild(s);
            });
            if (window.XLSX) break;
          } catch(le) { console.warn("CDN failed:", urls[ui]); }
        }
        if (!window.XLSX) {
          setMsg({ type: "error", text: "Failed to load Excel parser. Try refreshing." });
          setImporting(false); e.target.value = ""; return;
        }
      }

      var XLSX = window.XLSX;
      var wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
      console.log("[Import] Sheets:", wb.SheetNames);

      function cleanStr(v) {
        if (v === null || v === undefined) return "";
        var s = String(v).trim();
        if (s === "NaN" || s === "undefined" || s === "null" || s === "nan") return "";
        return s;
      }
      function fmtDate(d) {
        if (!d) return "";
        if (d instanceof Date) { try { return d.toISOString().split("T")[0]; } catch(e) { return ""; } }
        var s = cleanStr(d);
        if (!s) return "";
        if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.split("T")[0].split(" ")[0];
        var m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m) { var y = parseInt(m[3]); if (y < 100) y += 2000; return y + "-" + String(m[1]).padStart(2,"0") + "-" + String(m[2]).padStart(2,"0"); }
        return "";
      }

      var allRows = [];
      wb.SheetNames.forEach(function(sheetName) {
        var ws = wb.Sheets[sheetName];
        var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
        console.log("[Import] Sheet:", sheetName, "rows:", data.length);
        if (data.length < 2) return;

        // Find header row — count how many known keywords match in each row
        var headerIdx = -1;
        var headerKeywords = ["customer", "name", "phone", "date set", "date of", "time", "reason", "quotes", "scheduled", "arrive", "appt"];
        var bestMatch = 0;
        for (var ri = 0; ri < Math.min(data.length, 15); ri++) {
          var row = data[ri];
          if (!row) continue;
          var matchCount = 0;
          for (var ci = 0; ci < Math.min(row.length, 15); ci++) {
            var cellVal = String(row[ci] || "").toLowerCase().trim();
            if (!cellVal || cellVal.length > 60) continue; // skip data cells
            for (var ki = 0; ki < headerKeywords.length; ki++) {
              if (cellVal.includes(headerKeywords[ki])) { matchCount++; break; }
            }
          }
          if (matchCount > bestMatch) { bestMatch = matchCount; headerIdx = ri; }
        }
        console.log("[Import] Header at row:", headerIdx, "with", bestMatch, "keyword matches");
        if (headerIdx < 0 || bestMatch < 2) return;

        // Map columns
        var col = {};
        var headers = data[headerIdx];
        for (var ci = 0; ci < headers.length; ci++) {
          var h = String(headers[ci] || "").toLowerCase().trim();
          if (h.includes("customer name") || h === "name") col.name = ci;
          else if (h.includes("phone")) col.phone = ci;
          else if (h.includes("date set")) col.date_set = ci;
          else if (h.includes("date of")) col.date_appt = ci;
          else if ((h.includes("appt") && h.includes("time")) || (h === "time")) col.time = ci;
          else if (h.includes("reason") || h.includes("quotes")) col.reason = ci;
          else if (h.includes("scheduled") || h.includes("your name")) col.scheduled_by = ci;
          else if (h.includes("arrive")) col.arrived = ci;
        }
        // If first column not mapped, assume it's customer name
        if (col.name === undefined && headers.length >= 5) col.name = 0;
        // Positional fallbacks for standard 9-column layout
        if (headers.length >= 9) {
          if (col.phone === undefined) col.phone = 1;
          if (col.date_set === undefined) col.date_set = 2;
          if (col.date_appt === undefined) col.date_appt = 3;
          if (col.time === undefined) col.time = 4;
          if (col.reason === undefined) col.reason = 5;
          if (col.scheduled_by === undefined) col.scheduled_by = 6;
          if (col.arrived === undefined) col.arrived = 7;
          if (col.notes === undefined) col.notes = 8;
        }
        // Notes = last column called "notes" that isn't reason
        for (var ci = 0; ci < headers.length; ci++) {
          var h = String(headers[ci] || "").toLowerCase().trim();
          if (h === "notes" && ci !== col.reason) col.notes = ci;
        }
        console.log("[Import] Columns:", JSON.stringify(col));

        for (var ri = headerIdx + 1; ri < data.length; ri++) {
          var row = data[ri];
          if (!row) continue;
          var name = col.name !== undefined ? cleanStr(row[col.name]) : "";
          if (!name || name.toLowerCase() === "customer name") continue;

          var timeVal = col.time !== undefined ? cleanStr(row[col.time]) : "";
          if (timeVal.match(/^\d{2}:\d{2}:\d{2}$/)) timeVal = timeVal.slice(0, 5);
          if (timeVal && !isNaN(parseFloat(timeVal)) && parseFloat(timeVal) < 1) {
            var mins = Math.round(parseFloat(timeVal) * 1440);
            timeVal = String(Math.floor(mins/60)).padStart(2,"0") + ":" + String(mins%60).padStart(2,"0");
          }

          var phone = col.phone !== undefined ? cleanStr(row[col.phone]).replace(/\.0$/, "") : "";

          allRows.push({
            customer_name: name,
            customer_phone: phone,
            date_set: fmtDate(col.date_set !== undefined ? row[col.date_set] : ""),
            date_of_appt: fmtDate(col.date_appt !== undefined ? row[col.date_appt] : ""),
            appt_time: timeVal,
            reason: col.reason !== undefined ? cleanStr(row[col.reason]) : "",
            price_quoted: "",
            scheduled_by: col.scheduled_by !== undefined ? cleanStr(row[col.scheduled_by]) : "",
            did_arrive: col.arrived !== undefined ? cleanStr(row[col.arrived]) : "",
            notes: col.notes !== undefined ? cleanStr(row[col.notes]) : "",
          });
        }
        console.log("[Import] Total rows parsed:", allRows.length);
      });

      if (allRows.length === 0) {
        setMsg({ type: "error", text: "No appointment rows found. Open browser console (F12) for debug info." });
        setImporting(false); e.target.value = ""; return;
      }

      var totalImported = 0;
      for (var bi = 0; bi < allRows.length; bi += 100) {
        var batch = allRows.slice(bi, bi + 100);
        var res = await fetch("/api/dialpad/appointments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bulk_import", store: store, rows: batch }),
        });
        var json = await res.json();
        if (json.success) totalImported += json.imported;
        else console.error("[Import] Batch error:", json.error);
      }

      setMsg({ type: "success", text: "Imported " + totalImported + " appointments from " + file.name });
      loadData();
    } catch(err) {
      console.error("[Import] Error:", err);
      setMsg({ type: "error", text: "Import failed: " + err.message + " — check browser console (F12) for details" });
    }
    setImporting(false);
    e.target.value = "";
  };

  var handleClearStore = async function() {
    var storeName = STORES[store] ? STORES[store].name : store;
    if (!confirm("\u26A0\uFE0F WARNING: Delete ALL appointments for " + storeName + "?\n\nThis cannot be undone.")) return;
    if (!confirm("SECOND CONFIRMATION\n\nAll appointment data for " + storeName + " will be permanently erased.\n\nType the store name to continue...")) return;
    var confirmInput = prompt("Type DELETE-ALL-" + store.toUpperCase() + " to confirm:");
    if (confirmInput !== "DELETE-ALL-" + store.toUpperCase()) {
      setMsg({ type: "error", text: "Confirmation code didn't match. Cancelled." });
      return;
    }
    try {
      var res = await fetch("/api/dialpad/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_store", store: store, confirm: confirmInput }),
      });
      var json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: "All appointments for " + storeName + " cleared" });
        loadData();
      } else {
        setMsg({ type: "error", text: json.error });
      }
    } catch(e) { setMsg({ type: "error", text: e.message }); }
  };

  return (
    <div style={{ background:"#0F1117",minHeight:"100vh",color:"#F0F1F3",fontFamily:"'Space Grotesk',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ background:"#12141A",borderBottom:"1px solid #1E2028",padding:"16px 28px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div style={{ display:"flex",alignItems:"center",gap:14 }}>
          <div style={{ width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#00D4FF,#7B2FFF)",display:"flex",alignItems:"center",justifyContent:"center" }}>
            <span style={{ color:"#FFF",fontSize:18,fontWeight:900 }}>FT</span>
          </div>
          <div>
            <h1 style={{ margin:0,fontSize:18,fontWeight:800 }}>Appointment Tracker</h1>
            <p style={{ margin:0,color:"#6B6F78",fontSize:11 }}>Focused Technologies — CPR Stores</p>
          </div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          {/* Store selector */}
          {STORE_KEYS.map(function(k) {
            var st = STORES[k];
            return <button key={k} onClick={function(){setStore(k);}} style={{ padding:"6px 14px",borderRadius:6,border:"none",cursor:"pointer",background:store===k?st.color+"22":"#1A1D23",color:store===k?st.color:"#8B8F98",fontSize:11,fontWeight:600 }}>{st.name.replace("CPR ","")}</button>;
          })}
          <a href="/" style={{ marginLeft:12,padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",color:"#8B8F98",fontSize:10,textDecoration:"none" }}>Dashboard</a>
          {auth && <button onClick={auth.signOut} style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:10,cursor:"pointer" }}>Sign Out</button>}
        </div>
      </div>

      <div style={{ padding:28,maxWidth:1200,margin:"0 auto" }}>
        {/* Stats */}
        {stats && (
          <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14,marginBottom:24 }}>
            <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #7B2FFF" }}>
              <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Total Appts</div>
              <div style={{ color:"#F0F1F3",fontSize:26,fontWeight:700 }}>{s.total || 0}</div>
              <div style={{ color:"#6B6F78",fontSize:10 }}>Last 30 days</div>
            </div>
            <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #4ADE80" }}>
              <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Show Rate</div>
              <div style={{ color:scoreColor(s.showRate || 0),fontSize:26,fontWeight:700 }}>{s.showRate || 0}%</div>
              <div style={{ color:"#6B6F78",fontSize:10 }}>{s.arrived || 0} arrived / {s.total || 0}</div>
            </div>
            <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #F87171" }}>
              <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>No-Shows</div>
              <div style={{ color:"#F87171",fontSize:26,fontWeight:700 }}>{s.noShow || 0}</div>
              <div style={{ color:"#6B6F78",fontSize:10 }}>{s.total > 0 ? Math.round((s.noShow / s.total) * 100) : 0}% no-show rate</div>
            </div>
            <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #FBBF24" }}>
              <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Need Follow-Up</div>
              <div style={{ color:s.needFollowUp > 0 ? "#FBBF24" : "#4ADE80",fontSize:26,fontWeight:700 }}>{s.needFollowUp || 0}</div>
              <div style={{ color:"#6B6F78",fontSize:10 }}>No-shows to call back</div>
            </div>
            <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #00D4FF" }}>
              <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Pending</div>
              <div style={{ color:"#00D4FF",fontSize:26,fontWeight:700 }}>{s.pending || 0}</div>
              <div style={{ color:"#6B6F78",fontSize:10 }}>Awaiting arrival</div>
            </div>
          </div>
        )}

        {/* Action bar */}
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
          <div style={{ display:"flex",gap:4 }}>
            {[{id:"today",label:"Today"},{id:"list",label:"All Appointments"},{id:"followup",label:"Follow-Ups"},{id:"analytics",label:"Analytics"}].map(function(v) {
              return <button key={v.id} onClick={function(){setView(v.id);}} style={{ padding:"8px 14px",borderRadius:8,border:"none",cursor:"pointer",background:view===v.id?"#7B2FFF22":"#1A1D23",color:view===v.id?"#7B2FFF":"#8B8F98",fontSize:12,fontWeight:600 }}>{v.label}</button>;
            })}
          </div>
          <div style={{ display:"flex",gap:8 }}>
            {/* Import button */}
            <label style={{ padding:"8px 14px",borderRadius:8,border:"1px solid #2A2D35",background:"#1A1D23",color:"#8B8F98",fontSize:12,fontWeight:600,cursor:importing?"wait":"pointer",display:"flex",alignItems:"center",gap:4 }}>
              {importing ? "Importing..." : "\uD83D\uDCE4 Import Excel"}
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} disabled={importing} style={{ display:"none" }} />
            </label>
            {/* Clear button */}
            <button onClick={handleClearStore}
              style={{ padding:"8px 14px",borderRadius:8,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:12,fontWeight:600,cursor:"pointer" }}>
              Clear Store Data
            </button>
            {/* New appointment */}
            <button onClick={function(){setShowForm(!showForm);setEditingId(null);setForm(emptyForm);setMatchedCall(null);}}
              style={{ padding:"8px 18px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>
              {showForm ? "Cancel" : "+ New Appointment"}
            </button>
          </div>
        </div>

        {msg && <div style={{ padding:"10px 16px",borderRadius:8,marginBottom:16,background:msg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(msg.type==="success"?"#4ADE8033":"#F8717133"),color:msg.type==="success"?"#4ADE80":"#F87171",fontSize:12 }}>{msg.text}</div>}

        {/* Add/Edit Form */}
        {showForm && (
          <div style={{ background:"#1A1D23",borderRadius:12,padding:24,marginBottom:20,border:"1px solid #7B2FFF33" }}>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:16 }}>{editingId ? "Edit Appointment" : "New Appointment"}</div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12 }}>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Customer Name *</label>
                <input value={form.customer_name} onChange={function(e){setForm(Object.assign({},form,{customer_name:e.target.value}));}}
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
              </div>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Phone Number</label>
                <input value={form.customer_phone} onChange={function(e){setForm(Object.assign({},form,{customer_phone:e.target.value}));}}
                  onBlur={function(e){checkPhone(e.target.value);}}
                  placeholder="(317) 555-1234"
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
              </div>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Scheduled By</label>
                <input list="emp-list" value={form.scheduled_by} onChange={function(e){setForm(Object.assign({},form,{scheduled_by:e.target.value}));}}
                  placeholder="Type or select..."
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
                <datalist id="emp-list">
                  {storeEmployees.map(function(r){ return <option key={r.name} value={r.name} />; })}
                </datalist>
              </div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12 }}>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Date of Appointment</label>
                <input type="date" value={form.date_of_appt} onChange={function(e){setForm(Object.assign({},form,{date_of_appt:e.target.value}));}}
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
              </div>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Appointment Time</label>
                <input type="time" value={form.appt_time} onChange={function(e){setForm(Object.assign({},form,{appt_time:e.target.value}));}}
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
              </div>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Price Quoted</label>
                <input value={form.price_quoted} onChange={function(e){setForm(Object.assign({},form,{price_quoted:e.target.value}));}}
                  placeholder="$150"
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
              </div>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Did They Arrive?</label>
                <select value={form.did_arrive} onChange={function(e){setForm(Object.assign({},form,{did_arrive:e.target.value}));}}
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }}>
                  <option value="">Pending...</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                  <option value="No/VM">No — Left Voicemail</option>
                  <option value="Rescheduled">Rescheduled</option>
                </select>
              </div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16 }}>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Reason / Quote / Service</label>
                <input value={form.reason} onChange={function(e){setForm(Object.assign({},form,{reason:e.target.value}));}}
                  placeholder="iPhone 14 screen repair, $180 OLED"
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
              </div>
              <div>
                <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Notes</label>
                <input value={form.notes} onChange={function(e){setForm(Object.assign({},form,{notes:e.target.value}));}}
                  placeholder="Additional notes..."
                  style={{ width:"100%",padding:"9px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:13,outline:"none",boxSizing:"border-box" }} />
              </div>
            </div>

            {/* Matched call alert */}
            {matchedCall && (
              <div style={{ padding:12,borderRadius:8,background:"#00D4FF08",border:"1px solid #00D4FF33",marginBottom:12 }}>
                <div style={{ color:"#00D4FF",fontSize:11,fontWeight:700,marginBottom:4 }}>{"\uD83D\uDCDE"} Matching call found!</div>
                <div style={{ color:"#C8CAD0",fontSize:11 }}>
                  Employee: {matchedCall.employee} | Score: {parseFloat(matchedCall.score||0).toFixed(1)}/4 | {matchedCall.call_type}
                  {matchedCall.inquiry && <span style={{ display:"block",color:"#8B8F98",fontSize:10,marginTop:2 }}>Inquiry: {matchedCall.inquiry}</span>}
                  <span style={{ display:"flex",gap:6,marginTop:4 }}>
                    <span style={{ fontSize:10 }}>{matchedCall.appt_offered ? "\u2705" : "\u274C"} Appt offered</span>
                    <span style={{ fontSize:10 }}>{matchedCall.discount_mentioned ? "\u2705" : "\u274C"} Discount</span>
                    <span style={{ fontSize:10 }}>{matchedCall.warranty_mentioned ? "\u2705" : "\u274C"} Warranty</span>
                  </span>
                </div>
              </div>
            )}

            <button onClick={saveAppointment}
              style={{ padding:"10px 24px",borderRadius:8,border:"none",background:"#7B2FFF",color:"#FFF",fontSize:13,fontWeight:700,cursor:"pointer" }}>
              {editingId ? "Save Changes" : "Add Appointment"}
            </button>
          </div>
        )}

        {loading ? <div style={{ padding:40,textAlign:"center",color:"#6B6F78" }}>Loading...</div> : (
          <div>
            {/* Today / List view */}
            {(view === "today" || view === "list") && (
              <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
                {appointments.length > 0 ? appointments.map(function(a) {
                  var arrived = a.did_arrive && a.did_arrive.toLowerCase() === "yes";
                  var noShow = a.did_arrive && (a.did_arrive.toLowerCase() === "no" || a.did_arrive.toLowerCase().includes("no"));
                  var pending = !a.did_arrive || a.did_arrive === "";
                  var statusColor = arrived ? "#4ADE80" : noShow ? "#F87171" : "#FBBF24";
                  var statusText = arrived ? "Arrived" : noShow ? "No-Show" : a.did_arrive === "Rescheduled" ? "Rescheduled" : "Pending";
                  return (
                    <div key={a.id} style={{ padding:"14px 20px",borderBottom:"1px solid #1E2028" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4 }}>
                            <span style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{a.customer_name || "—"}</span>
                            {a.customer_phone && <span style={{ color:"#6B6F78",fontSize:11 }}>{fmtPhone(a.customer_phone)}</span>}
                            <span style={{ padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,background:statusColor+"18",color:statusColor }}>{statusText}</span>
                          </div>
                          <div style={{ color:"#8B8F98",fontSize:12,marginBottom:2 }}>{a.reason || "—"}</div>
                          <div style={{ color:"#6B6F78",fontSize:10 }}>
                            {a.date_of_appt && new Date(a.date_of_appt + "T12:00:00").toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"})}
                            {a.appt_time && " at " + a.appt_time}
                            {a.scheduled_by && " — booked by " + a.scheduled_by}
                            {a.price_quoted && " — " + a.price_quoted}
                          </div>
                          {a.notes && <div style={{ color:"#6B6F78",fontSize:10,marginTop:2,fontStyle:"italic" }}>{a.notes}</div>}
                        </div>
                        <div style={{ display:"flex",gap:4,flexShrink:0 }}>
                          {pending && (
                            <>
                              <button onClick={function(){updateArrival(a.id, "Yes");}} style={{ padding:"5px 10px",borderRadius:4,border:"1px solid #4ADE8033",background:"transparent",color:"#4ADE80",fontSize:10,cursor:"pointer" }}>Arrived</button>
                              <button onClick={function(){updateArrival(a.id, "No");}} style={{ padding:"5px 10px",borderRadius:4,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>No-Show</button>
                            </>
                          )}
                          <button onClick={function(){startEdit(a);}} style={{ padding:"5px 10px",borderRadius:4,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:10,cursor:"pointer" }}>Edit</button>
                          <button onClick={function(){deleteAppt(a.id);}} style={{ padding:"5px 10px",borderRadius:4,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>Del</button>
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ padding:40,textAlign:"center",color:"#6B6F78",fontSize:13 }}>{view === "today" ? "No appointments scheduled for today" : "No appointments found"}</div>
                )}
              </div>
            )}

            {/* Follow-up view */}
            {view === "followup" && (
              <div>
                <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>No-Show Follow-Ups ({followUps.length})</div>
                <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
                  {followUps.length > 0 ? followUps.map(function(a) {
                    return (
                      <div key={a.id} style={{ padding:"14px 20px",borderBottom:"1px solid #1E2028" }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                          <div>
                            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>{a.customer_name}</div>
                            <div style={{ color:"#6B6F78",fontSize:11 }}>{fmtPhone(a.customer_phone)} — {a.reason}</div>
                            <div style={{ color:"#F87171",fontSize:10,marginTop:2 }}>No-show on {a.date_of_appt && new Date(a.date_of_appt + "T12:00:00").toLocaleDateString()}{a.appt_time ? " at " + a.appt_time : ""}</div>
                          </div>
                          <div style={{ display:"flex",gap:6 }}>
                            <button onClick={function(){
                              var notes = prompt("Follow-up notes (what happened when you called?):");
                              if (notes !== null) markFollowUpDone(a.id, notes);
                            }} style={{ padding:"6px 14px",borderRadius:6,border:"none",background:"#4ADE80",color:"#000",fontSize:11,fontWeight:700,cursor:"pointer" }}>
                              Mark Called Back
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div style={{ padding:40,textAlign:"center",color:"#4ADE80",fontSize:13 }}>{"\u2705"} All follow-ups complete!</div>
                  )}
                </div>
              </div>
            )}

            {/* Analytics view */}
            {view === "analytics" && stats && (
              <div>
                {/* By employee */}
                {stats.empStats && stats.empStats.length > 0 && (
                  <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:20 }}>
                    <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Show Rate by Employee</div>
                    {stats.empStats.map(function(e) {
                      var barColor = e.show_rate >= 70 ? "#4ADE80" : e.show_rate >= 50 ? "#FBBF24" : "#F87171";
                      return (
                        <div key={e.name} style={{ padding:"10px 0",borderBottom:"1px solid #1E2028" }}>
                          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                            <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{e.name}</span>
                            <span style={{ color:barColor,fontSize:13,fontWeight:700 }}>{e.show_rate}% ({e.arrived}/{e.total})</span>
                          </div>
                          <div style={{ background:"#12141A",borderRadius:4,height:6,overflow:"hidden" }}>
                            <div style={{ width:e.show_rate+"%",height:"100%",background:barColor,borderRadius:4 }} />
                          </div>
                          <div style={{ color:"#6B6F78",fontSize:10,marginTop:2 }}>{e.no_show} no-shows</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* By store */}
                {stats.storeStats && stats.storeStats.length > 0 && (
                  <div style={{ background:"#1A1D23",borderRadius:12,padding:20 }}>
                    <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:12 }}>Show Rate by Store</div>
                    <div style={{ display:"grid",gridTemplateColumns:"repeat("+stats.storeStats.length+",1fr)",gap:16 }}>
                      {stats.storeStats.map(function(s) {
                        var st = STORES[s.store];
                        var barColor = s.show_rate >= 70 ? "#4ADE80" : s.show_rate >= 50 ? "#FBBF24" : "#F87171";
                        return (
                          <div key={s.store} style={{ textAlign:"center",padding:16,background:"#12141A",borderRadius:10 }}>
                            <div style={{ color:st?st.color:"#8B8F98",fontSize:14,fontWeight:700,marginBottom:6 }}>{st?st.name.replace("CPR ",""):s.store}</div>
                            <div style={{ color:barColor,fontSize:28,fontWeight:800 }}>{s.show_rate}%</div>
                            <div style={{ color:"#6B6F78",fontSize:11 }}>{s.arrived} arrived / {s.total} total</div>
                            <div style={{ color:"#F87171",fontSize:10 }}>{s.no_show} no-shows</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AppointmentsPage() {
  return (
    <AuthProvider>
      <AppointmentApp />
    </AuthProvider>
  );
}

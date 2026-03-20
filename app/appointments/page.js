'use client';

import { useState, useEffect, useMemo } from "react";
import AuthProvider, { useAuth } from "@/components/AuthProvider";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

function normPhone(p) { return p ? String(p).replace(/\D/g, "").slice(-10) : ""; }
function fmtPhone(p) { var n = normPhone(p); return n.length === 10 ? "(" + n.slice(0,3) + ") " + n.slice(3,6) + "-" + n.slice(6) : p; }

// ═══ LEVEL SYSTEM ═══
var LEVELS = [
  { name: "Bronze", min: 0, max: 39, color: "#CD7F32", emoji: "\uD83E\uDD49", bg: "#CD7F3215" },
  { name: "Silver", min: 40, max: 59, color: "#C0C0C0", emoji: "\uD83E\uDD48", bg: "#C0C0C015" },
  { name: "Gold", min: 60, max: 79, color: "#FFD700", emoji: "\uD83E\uDD47", bg: "#FFD70015" },
  { name: "Platinum", min: 80, max: 89, color: "#00D4FF", emoji: "\uD83D\uDC8E", bg: "#00D4FF15" },
  { name: "Diamond", min: 90, max: 100, color: "#E0B0FF", emoji: "\u2B50", bg: "#E0B0FF15" },
];
function getLevel(score) {
  for (var i = LEVELS.length - 1; i >= 0; i--) {
    if (score >= LEVELS[i].min) return LEVELS[i];
  }
  return LEVELS[0];
}
function getNextLevel(score) {
  for (var i = 0; i < LEVELS.length; i++) {
    if (score < LEVELS[i].max + 1) {
      return i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
    }
  }
  return null;
}

function extractPrice(text) {
  if (!text) return 0;
  var matches = text.match(/\$(\d+)/g);
  if (matches && matches.length > 0) return parseInt(matches[0].replace("$", "")) || 0;
  return 0;
}

// ═══ SCORE RING COMPONENT ═══
function ScoreRing({ score, size, label }) {
  var sz = size || 120;
  var r = (sz - 12) / 2;
  var circ = 2 * Math.PI * r;
  var pct = Math.min(score, 100) / 100;
  var level = getLevel(score);
  return (
    <div style={{ position:"relative",width:sz,height:sz }}>
      <svg width={sz} height={sz} viewBox={"0 0 "+sz+" "+sz}>
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke="#1E2028" strokeWidth="8" />
        <circle cx={sz/2} cy={sz/2} r={r} fill="none" stroke={level.color} strokeWidth="8"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" transform={"rotate(-90 "+sz/2+" "+sz/2+")"} style={{ transition:"stroke-dashoffset 1s ease" }} />
      </svg>
      <div style={{ position:"absolute",top:0,left:0,right:0,bottom:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center" }}>
        <div style={{ fontSize:sz*0.28,fontWeight:800,color:level.color }}>{score}</div>
        {label && <div style={{ fontSize:sz*0.09,color:"#8B8F98",textTransform:"uppercase",letterSpacing:"0.05em" }}>{label}</div>}
      </div>
    </div>
  );
}

// ═══ MAIN APP ═══
function StoreDashboard() {
  var auth = useAuth();
  var [store, setStore] = useState("fishers");
  var [section, setSection] = useState("overview");
  var [loading, setLoading] = useState(true);

  // Data states
  var [scorecard, setScorecard] = useState(null);
  var [apptStats, setApptStats] = useState(null);
  var [appointments, setAppointments] = useState([]);
  var [ticketStats, setTicketStats] = useState(null);
  var [roster, setRoster] = useState([]);
  var [salesData, setSalesData] = useState(null);
  var [weeklyGoal, setWeeklyGoal] = useState(null);
  var [salesData, setSalesData] = useState(null);

  // Appointment form states
  var [showForm, setShowForm] = useState(false);
  var [editingId, setEditingId] = useState(null);
  var emptyForm = { customer_name:"",customer_phone:"",date_of_appt:new Date().toISOString().split("T")[0],appt_time:"",reason:"",price_quoted:"",scheduled_by:"",did_arrive:"",notes:"" };
  var [form, setForm] = useState(emptyForm);
  var [msg, setMsg] = useState(null);
  var [matchedCall, setMatchedCall] = useState(null);
  var [repeatInfo, setRepeatInfo] = useState(null);
  var [searchQuery, setSearchQuery] = useState("");
  var [importing, setImporting] = useState(false);
  var [apptView, setApptView] = useState("today");

  // ═══ DATA LOADING ═══
  var loadData = async function() {
    setLoading(true);
    try {
      var [scRes, apptStRes, apptRes, tixRes, rostRes, salesRes, goalRes] = await Promise.allSettled([
        fetch("/api/dialpad/scorecard?days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=stats&store=" + store + "&days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=" + (apptView === "today" ? "today" : "list") + "&store=" + store).then(function(r){return r.json();}),
        fetch("/api/dialpad/tickets?action=stats&store=" + store).then(function(r){return r.json();}),
        fetch("/api/dialpad/roster").then(function(r){return r.json();}),
        fetch("/api/dialpad/sales?action=performance").then(function(r){return r.json();}),
        fetch("/api/dialpad/weekly-goal?store=" + store).then(function(r){return r.json();}),
      ]);
      if (scRes.status === "fulfilled" && scRes.value.success) setScorecard(scRes.value);
      if (apptStRes.status === "fulfilled" && apptStRes.value.success) setApptStats(apptStRes.value);
      if (apptRes.status === "fulfilled" && apptRes.value.success) setAppointments(apptRes.value.appointments || []);
      if (tixRes.status === "fulfilled" && tixRes.value.success) setTicketStats(tixRes.value.stats);
      if (rostRes.status === "fulfilled" && rostRes.value.success) setRoster((rostRes.value.roster || []).filter(function(r){return r.active;}));
      if (salesRes.status === "fulfilled" && salesRes.value.success) setSalesData(salesRes.value);
      if (goalRes.status === "fulfilled" && goalRes.value.success) setWeeklyGoal(goalRes.value.goal);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(function() { loadData(); }, [store, apptView]);

  // ═══ COMPUTED DATA ═══
  var storeScore = scorecard && scorecard.scores && scorecard.scores[store] ? scorecard.scores[store] : null;
  var storeOverall = storeScore ? storeScore.overall : 0;
  var storeLevel = getLevel(storeOverall);
  var nextLevel = getNextLevel(storeOverall);

  var storeEmployees = (scorecard ? scorecard.employeeScores || [] : []).filter(function(e) { return e.store === store; });

  var as = apptStats ? apptStats.stats : {};

  // Sales data by employee
  var salesByEmployee = useMemo(function() {
    if (!salesData) return {};
    var map = {};
    function ensure(name) { if (!name) return null; if (!map[name]) map[name] = { repairs: 0, repair_revenue: 0, accy_count: 0, accy_gp: 0, clean_count: 0, total_revenue: 0 }; return map[name]; }
    (salesData.phones || []).forEach(function(r) { var e = ensure(r.employee); if (e) { e.repairs += r.repair_tickets || 0; e.repair_revenue += parseFloat(r.repair_total) || 0; } });
    (salesData.others || []).forEach(function(r) { var e = ensure(r.employee); if (e) { e.repairs += r.repair_count || 0; e.repair_revenue += parseFloat(r.repair_total) || 0; } });
    (salesData.accessories || []).forEach(function(r) { var e = ensure(r.employee); if (e) { e.accy_count += r.accy_count || 0; e.accy_gp += parseFloat(r.accy_gp) || 0; } });
    (salesData.cleanings || []).forEach(function(r) { var e = ensure(r.employee); if (e) { e.clean_count += r.clean_count || 0; } });
    Object.values(map).forEach(function(e) { e.total_revenue = e.repair_revenue + e.accy_gp; });
    return map;
  }, [salesData]);

  var storeSalesTotals = useMemo(function() {
    var totals = { repairs: 0, accy_gp: 0, accy_count: 0, clean_count: 0, revenue: 0 };
    // Include ALL employees for this store — from roster AND scorecard
    var storeNames = {};
    storeEmployees.forEach(function(emp) { storeNames[emp.name] = true; });
    roster.filter(function(r) { return (r.store || "").toLowerCase() === store.toLowerCase(); }).forEach(function(r) { storeNames[r.name] = true; });
    Object.keys(storeNames).forEach(function(name) {
      var s = salesByEmployee[name];
      if (s) { totals.repairs += s.repairs; totals.accy_gp += s.accy_gp; totals.accy_count += s.accy_count; totals.clean_count += s.clean_count; totals.revenue += s.total_revenue; }
    });
    return totals;
  }, [salesByEmployee, storeEmployees, roster, store]);

  var revenueLost = useMemo(function() {
    var noShows = appointments.filter(function(a) {
      return a.did_arrive && (a.did_arrive.toLowerCase() === "no" || a.did_arrive.toLowerCase().includes("no"));
    });
    var total = 0;
    noShows.forEach(function(a) { total += extractPrice(a.reason) || extractPrice(a.price_quoted); });
    return { amount: total, count: noShows.length };
  }, [appointments]);

  // Generate team wins
  var teamWins = useMemo(function() {
    var wins = [];
    storeEmployees.forEach(function(e) {
      var lvl = getLevel(e.overall);
      if (e.overall >= 60) wins.push({ emoji: lvl.emoji, text: e.name + " reached " + lvl.name + " level! (" + e.overall + " pts)", color: lvl.color });
      if (e.categories) {
        if (e.categories.audit && e.categories.audit.score >= 70) wins.push({ emoji: "\uD83D\uDCDE", text: e.name + " — strong phone audit score (" + e.categories.audit.score + ")", color: "#7B2FFF" });
        if (e.categories.compliance && e.categories.compliance.score >= 75) wins.push({ emoji: "\uD83C\uDFAB", text: e.name + " — excellent ticket compliance (" + e.categories.compliance.score + ")", color: "#00D4FF" });
      }
    });
    if (apptStats && apptStats.empStats) {
      apptStats.empStats.forEach(function(e) {
        if (e.show_rate >= 75 && e.total >= 5) wins.push({ emoji: "\uD83C\uDFAF", text: e.name + " — " + e.show_rate + "% appointment show rate!", color: "#4ADE80" });
      });
    }
    // Production wins
    storeEmployees.forEach(function(e) {
      var sd = salesByEmployee[e.name];
      if (sd) {
        if (sd.repairs >= 15) wins.push({ emoji: "\uD83D\uDD27", text: e.name + " \u2014 " + sd.repairs + " repairs this month!", color: "#7B2FFF" });
        if (sd.accy_gp >= 200) wins.push({ emoji: "\uD83D\uDCB0", text: e.name + " \u2014 $" + Math.round(sd.accy_gp) + " in accessory GP!", color: "#00D4FF" });
      }
    });
    return wins.slice(0, 10);
  }, [storeEmployees, apptStats, salesByEmployee]);

  var filteredAppointments = appointments;
  if (searchQuery.trim()) {
    var q = searchQuery.toLowerCase().trim();
    filteredAppointments = appointments.filter(function(a) {
      return (a.customer_name||"").toLowerCase().includes(q) || (a.customer_phone||"").includes(q) ||
        normPhone(a.customer_phone).includes(normPhone(q)) || (a.reason||"").toLowerCase().includes(q) ||
        (a.scheduled_by||"").toLowerCase().includes(q) || (a.notes||"").toLowerCase().includes(q);
    });
  }
  var followUps = appointments.filter(function(a) { return a.follow_up_needed && !a.follow_up_done; });
  var rosterFiltered = roster.filter(function(r) { return (r.store||"").toLowerCase() === store.toLowerCase(); });
  if (rosterFiltered.length === 0) rosterFiltered = roster;

  // ═══ APPOINTMENT HANDLERS ═══
  var saveAppointment = async function() {
    if (!form.customer_name) { setMsg({ type:"error",text:"Customer name required" }); return; }
    var payload = Object.assign({}, form, { store: store, action: editingId ? "update" : "add" });
    if (editingId) payload.id = editingId;
    var res = await fetch("/api/dialpad/appointments", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
    var json = await res.json();
    if (json.success) { setMsg({type:"success",text:editingId?"Updated":"Appointment added"}); setShowForm(false); setEditingId(null); setForm(emptyForm); setMatchedCall(null); setRepeatInfo(null); loadData(); }
    else setMsg({type:"error",text:json.error});
    setTimeout(function(){setMsg(null);}, 4000);
  };
  var deleteAppt = async function(id) { if (!confirm("Delete?")) return; await fetch("/api/dialpad/appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"delete",id:id})}); loadData(); };
  var updateArrival = async function(id, val) { await fetch("/api/dialpad/appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update",id:id,did_arrive:val})}); loadData(); };
  var markFollowUpDone = async function(id, notes) { await fetch("/api/dialpad/appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update",id:id,follow_up_done:true,follow_up_notes:notes||"Called back"})}); loadData(); };
  var startEdit = function(appt) { setForm({customer_name:appt.customer_name||"",customer_phone:appt.customer_phone||"",date_of_appt:appt.date_of_appt||"",appt_time:appt.appt_time||"",reason:appt.reason||"",price_quoted:appt.price_quoted||"",scheduled_by:appt.scheduled_by||"",did_arrive:appt.did_arrive||"",notes:appt.notes||""}); setEditingId(appt.id); setShowForm(true); };
  var checkPhone = async function(phone) { var n = normPhone(phone); if (n.length !== 10) { setMatchedCall(null); return; } try { var r = await fetch("/api/dialpad/appointments?action=match_call&phone="+n); var j = await r.json(); setMatchedCall(j.success && j.calls && j.calls.length > 0 ? j.calls[0] : null); } catch(e) { setMatchedCall(null); } };
  var checkRepeatCustomer = async function(phone) { var n = normPhone(phone); if (n.length !== 10) { setRepeatInfo(null); return; } try { var r = await fetch("/api/dialpad/appointments?action=list&days=365"); var j = await r.json(); if (j.success) { var m = (j.appointments||[]).filter(function(a){return normPhone(a.customer_phone)===n;}); if (m.length > 0) { var arr = m.filter(function(a){return a.did_arrive&&a.did_arrive.toLowerCase()==="yes";}); var ns = m.filter(function(a){return a.did_arrive&&a.did_arrive.toLowerCase().includes("no");}); setRepeatInfo({total:m.length,arrived:arr.length,noShow:ns.length,lastVisit:m[0].date_of_appt,lastReason:m[0].reason,name:m[0].customer_name}); } else setRepeatInfo(null); } } catch(e) { setRepeatInfo(null); } };

  var handleImport = async function(e) {
    var file = e.target.files[0]; if (!file) return;
    setImporting(true); setMsg(null);
    try {
      var buffer = await file.arrayBuffer();
      if (!window.XLSX) { var urls=["https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js","https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js"]; for(var ui=0;ui<urls.length;ui++){try{await new Promise(function(res,rej){var s=document.createElement("script");s.src=urls[ui];s.onload=res;s.onerror=rej;document.head.appendChild(s);});if(window.XLSX)break;}catch(le){}} if(!window.XLSX){setMsg({type:"error",text:"Failed to load Excel parser"});setImporting(false);e.target.value="";return;}}
      var XLSX=window.XLSX; var wb=XLSX.read(new Uint8Array(buffer),{type:"array",cellDates:true});
      function cleanStr(v){if(v===null||v===undefined)return"";var s=String(v).trim();return(s==="NaN"||s==="undefined"||s==="null"||s==="nan")?"":s;}
      function fmtDate(d){if(!d)return"";if(d instanceof Date){try{return d.toISOString().split("T")[0];}catch(e){return"";}}var s=cleanStr(d);if(!s)return"";if(s.match(/^\d{4}-\d{2}-\d{2}/))return s.split("T")[0].split(" ")[0];var m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);if(m){var y=parseInt(m[3]);if(y<100)y+=2000;return y+"-"+String(m[1]).padStart(2,"0")+"-"+String(m[2]).padStart(2,"0");}return"";}
      var allRows=[];
      wb.SheetNames.forEach(function(sn){var ws=wb.Sheets[sn];var data=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:false});if(data.length<2)return;var hi=-1;for(var ri=0;ri<Math.min(data.length,10);ri++){var row=data[ri];if(!row)continue;for(var ci=0;ci<row.length;ci++){if(String(row[ci]||"").toLowerCase().trim()==="customer name"){hi=ri;break;}}if(hi>=0)break;}if(hi<0)return;var col={};var hdr=data[hi];for(var ci=0;ci<hdr.length;ci++){var h=String(hdr[ci]||"").toLowerCase().trim();if(h.includes("customer name"))col.name=ci;else if(h.includes("phone"))col.phone=ci;else if(h.includes("date set"))col.date_set=ci;else if(h.includes("date of"))col.date_appt=ci;else if(h.includes("time")&&!h.includes("date"))col.time=ci;else if(h.includes("reason")||h.includes("quotes"))col.reason=ci;else if(h.includes("scheduled")||h.includes("your name"))col.scheduled_by=ci;else if(h.includes("arrive"))col.arrived=ci;}for(var ci=0;ci<hdr.length;ci++){var h=String(hdr[ci]||"").toLowerCase().trim();if(h==="notes"&&ci!==col.reason)col.notes=ci;}
      for(var ri=hi+1;ri<data.length;ri++){var row=data[ri];if(!row)continue;var name=col.name!==undefined?cleanStr(row[col.name]):"";if(!name||name.toLowerCase()==="customer name")continue;var tv=col.time!==undefined?cleanStr(row[col.time]):"";if(tv.match(/^\d{2}:\d{2}:\d{2}$/))tv=tv.slice(0,5);if(tv&&!isNaN(parseFloat(tv))&&parseFloat(tv)<1){var mins=Math.round(parseFloat(tv)*1440);tv=String(Math.floor(mins/60)).padStart(2,"0")+":"+String(mins%60).padStart(2,"0");}var ph=col.phone!==undefined?cleanStr(row[col.phone]).replace(/\.0$/,""):"";allRows.push({customer_name:name,customer_phone:ph,date_set:fmtDate(col.date_set!==undefined?row[col.date_set]:""),date_of_appt:fmtDate(col.date_appt!==undefined?row[col.date_appt]:""),appt_time:tv,reason:col.reason!==undefined?cleanStr(row[col.reason]):"",price_quoted:"",scheduled_by:col.scheduled_by!==undefined?cleanStr(row[col.scheduled_by]):"",did_arrive:col.arrived!==undefined?cleanStr(row[col.arrived]):"",notes:col.notes!==undefined?cleanStr(row[col.notes]):""});}});
      if(allRows.length===0){setMsg({type:"error",text:"No appointment data found"});setImporting(false);e.target.value="";return;}
      var total=0;for(var bi=0;bi<allRows.length;bi+=100){var batch=allRows.slice(bi,bi+100);var res=await fetch("/api/dialpad/appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"bulk_import",store:store,rows:batch})});var json=await res.json();if(json.success)total+=json.imported;}
      setMsg({type:"success",text:"Imported "+total+" appointments from "+file.name});loadData();
    }catch(err){setMsg({type:"error",text:"Import failed: "+err.message});}
    setImporting(false);e.target.value="";
  };

  var handleClearStore = async function() {
    var sn=STORES[store]?STORES[store].name:store;if(!confirm("\u26A0\uFE0F Delete ALL appointments for "+sn+"?"))return;var code=prompt("Type DELETE-ALL-"+store.toUpperCase()+" to confirm:");if(code!=="DELETE-ALL-"+store.toUpperCase()){setMsg({type:"error",text:"Cancelled"});return;}
    var res=await fetch("/api/dialpad/appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"clear_store",store:store,confirm:code})});var json=await res.json();if(json.success){setMsg({type:"success",text:"Cleared"});loadData();}else setMsg({type:"error",text:json.error});
  };

  var storeName = STORES[store] ? STORES[store].name : store;
  var storeColor = STORES[store] ? STORES[store].color : "#7B2FFF";

  // ═══ RENDER ═══
  return (
    <div style={{ background:"#0F1117",minHeight:"100vh",color:"#F0F1F3",fontFamily:"'Space Grotesk',-apple-system,sans-serif" }}>
      {/* Header */}
      <div style={{ background:"#12141A",borderBottom:"1px solid #1E2028",padding:"16px 28px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
        <div style={{ display:"flex",alignItems:"center",gap:14 }}>
          <div style={{ width:36,height:36,borderRadius:10,background:"linear-gradient(135deg,#00D4FF,#7B2FFF)",display:"flex",alignItems:"center",justifyContent:"center" }}>
            <span style={{ color:"#FFF",fontSize:18,fontWeight:900 }}>FT</span>
          </div>
          <div>
            <h1 style={{ margin:0,fontSize:18,fontWeight:800 }}>{storeName}</h1>
            <p style={{ margin:0,color:"#6B6F78",fontSize:11 }}>Focused Technologies — Store Dashboard</p>
          </div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          {STORE_KEYS.map(function(k) { var st=STORES[k]; return <button key={k} onClick={function(){setStore(k);}} style={{ padding:"6px 14px",borderRadius:6,border:"none",cursor:"pointer",background:store===k?st.color+"22":"#1A1D23",color:store===k?st.color:"#8B8F98",fontSize:11,fontWeight:600 }}>{st.name.replace("CPR ","")}</button>; })}
          <a href="/" style={{ marginLeft:12,padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",color:"#8B8F98",fontSize:10,textDecoration:"none" }}>Dashboard</a>
          {auth && <button onClick={auth.signOut} style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:10,cursor:"pointer" }}>Sign Out</button>}
        </div>
      </div>

      {loading ? <div style={{ padding:60,textAlign:"center",color:"#6B6F78" }}>Loading store data...</div> : (
      <div style={{ padding:28,maxWidth:1300,margin:"0 auto" }}>

        {/* Section nav */}
        <div style={{ display:"flex",gap:4,marginBottom:24 }}>
          {[{id:"overview",label:"\uD83C\uDFEA Store Overview"},{id:"appointments",label:"\uD83D\uDCC5 Appointments"},{id:"analytics",label:"\uD83D\uDCCA Analytics"}].map(function(v) {
            return <button key={v.id} onClick={function(){setSection(v.id);}} style={{ padding:"10px 18px",borderRadius:8,border:"none",cursor:"pointer",background:section===v.id?"#7B2FFF22":"#1A1D23",color:section===v.id?"#7B2FFF":"#8B8F98",fontSize:13,fontWeight:600 }}>{v.label}</button>;
          })}
        </div>

        {/* ═══ OVERVIEW SECTION ═══ */}
        {section === "overview" && (
          <div>
            {/* Store hero card */}
            <div style={{ background:"#1A1D23",borderRadius:16,padding:28,marginBottom:24,border:"1px solid "+storeColor+"22",display:"flex",alignItems:"center",gap:32 }}>
              <ScoreRing score={storeOverall} size={130} label="overall" />
              <div style={{ flex:1 }}>
                <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:8 }}>
                  <span style={{ fontSize:32 }}>{storeLevel.emoji}</span>
                  <div>
                    <div style={{ color:storeLevel.color,fontSize:22,fontWeight:800 }}>{storeLevel.name} Level</div>
                    <div style={{ color:"#8B8F98",fontSize:12 }}>{storeName} — {storeOverall} points</div>
                  </div>
                </div>
                {nextLevel ? (
                  <div style={{ marginTop:8 }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                      <span style={{ color:"#8B8F98",fontSize:11 }}>Next: {nextLevel.emoji} {nextLevel.name}</span>
                      <span style={{ color:nextLevel.color,fontSize:11,fontWeight:700 }}>{nextLevel.min - storeOverall} points to go</span>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:6,height:10,overflow:"hidden" }}>
                      <div style={{ width:Math.min(100,((storeOverall - getLevel(storeOverall).min) / (nextLevel.min - getLevel(storeOverall).min)) * 100)+"%",height:"100%",background:"linear-gradient(90deg,"+storeLevel.color+","+nextLevel.color+")",borderRadius:6,transition:"width 1s ease" }} />
                    </div>
                  </div>
                ) : (
                  <div style={{ color:"#E0B0FF",fontSize:12,marginTop:8,fontWeight:600 }}>{"\u2B50"} Maximum level achieved!</div>
                )}
                {storeScore && storeScore.categories && (
                  <div style={{ display:"flex",gap:12,marginTop:14 }}>
                    {[{k:"revenue",label:"Repairs"},{k:"audit",label:"Phone Audit"},{k:"calls",label:"Calls"},{k:"experience",label:"CX"},{k:"compliance",label:"Compliance"}].map(function(c) {
                      var val = storeScore.categories[c.k] ? storeScore.categories[c.k].score : 0;
                      var lvl = getLevel(val);
                      return <div key={c.k} style={{ background:"#12141A",borderRadius:8,padding:"8px 12px",textAlign:"center",flex:1 }}>
                        <div style={{ color:lvl.color,fontSize:16,fontWeight:700 }}>{val}</div>
                        <div style={{ color:"#6B6F78",fontSize:9,textTransform:"uppercase" }}>{c.label}</div>
                      </div>;
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Weekly Goal */}
            {weeklyGoal && (
              <div style={{ background:"linear-gradient(135deg,#7B2FFF08,#00D4FF08)",borderRadius:16,padding:28,marginBottom:24,border:"1px solid #7B2FFF22",position:"relative",overflow:"hidden" }}>
                <div style={{ display:"flex",gap:24,alignItems:"flex-start",position:"relative" }}>
                  <div style={{ width:64,height:64,borderRadius:16,background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                    <span style={{ fontSize:28 }}>{"\uD83C\uDFAF"}</span>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex",alignItems:"center",gap:10,marginBottom:6 }}>
                      <div style={{ color:"#7B2FFF",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em" }}>This Week{"\u2019"}s Goal</div>
                      <div style={{ color:"#6B6F78",fontSize:9 }}>Week of {weeklyGoal.week_start && new Date(weeklyGoal.week_start + "T12:00:00").toLocaleDateString([], {month:"short", day:"numeric"})}</div>
                    </div>
                    <div style={{ color:"#F0F1F3",fontSize:20,fontWeight:800,marginBottom:8 }}>{weeklyGoal.goal_title}</div>
                    <div style={{ color:"#C8CAD0",fontSize:13,lineHeight:1.6,marginBottom:12 }}>{weeklyGoal.goal_description}</div>
                    {weeklyGoal.metric_baseline > 0 && weeklyGoal.metric_target > 0 && (
                      <div style={{ marginBottom:14 }}>
                        <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}>
                          <span style={{ color:"#8B8F98",fontSize:11 }}>Current: <strong style={{ color:"#F87171" }}>{weeklyGoal.metric_baseline}</strong></span>
                          <span style={{ color:"#8B8F98",fontSize:11 }}>Target: <strong style={{ color:"#4ADE80" }}>{weeklyGoal.metric_target}</strong></span>
                        </div>
                        <div style={{ background:"#12141A",borderRadius:6,height:10,overflow:"hidden" }}>
                          <div style={{ width:Math.min(100, (weeklyGoal.metric_baseline / weeklyGoal.metric_target) * 100) + "%",height:"100%",background:"linear-gradient(90deg,#F87171,#FBBF24,#4ADE80)",borderRadius:6,transition:"width 1s ease" }} />
                        </div>
                      </div>
                    )}
                    <div style={{ background:"#12141A",borderRadius:10,padding:14 }}>
                      <div style={{ color:"#FBBF24",fontSize:10,fontWeight:700,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.05em" }}>Coaching Tip</div>
                      <div style={{ color:"#C8CAD0",fontSize:12,lineHeight:1.6 }}>{weeklyGoal.coaching_tip}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Quick stats row */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:14,marginBottom:24 }}>
              <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #4ADE80" }}>
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Show Rate</div>
                <div style={{ color:as.showRate>=65?"#4ADE80":as.showRate>=50?"#FBBF24":"#F87171",fontSize:26,fontWeight:700 }}>{as.showRate || 0}%</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{as.arrived||0} of {as.total||0} showed up</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #7B2FFF" }}>
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>{"\uD83D\uDD27"} Repairs</div>
                <div style={{ color:"#7B2FFF",fontSize:26,fontWeight:700 }}>{storeSalesTotals.repairs}</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>This month</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #00D4FF" }}>
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>{"\uD83D\uDCB0"} Accessory GP</div>
                <div style={{ color:"#00D4FF",fontSize:26,fontWeight:700 }}>{"$" + storeSalesTotals.accy_gp.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{storeSalesTotals.accy_count} items sold</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #FF2D95" }}>
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Revenue Lost</div>
                <div style={{ color:"#FF2D95",fontSize:26,fontWeight:700 }}>${revenueLost.amount.toLocaleString()}</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{revenueLost.count} no-shows</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #FBBF24" }}>
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Follow-Ups</div>
                <div style={{ color:as.needFollowUp>0?"#FBBF24":"#4ADE80",fontSize:26,fontWeight:700 }}>{as.needFollowUp || 0}</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>No-shows to call</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #7B2FFF" }}>
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Ticket Compliance</div>
                <div style={{ color:"#7B2FFF",fontSize:26,fontWeight:700 }}>{ticketStats ? ticketStats.avgOverall || 0 : "—"}</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>Avg ticket score</div>
              </div>
            </div>

            {/* Team Performance */}
            {storeEmployees.length > 0 && (
              <div style={{ background:"#1A1D23",borderRadius:14,padding:24,marginBottom:24 }}>
                <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700,marginBottom:16 }}>Team Performance</div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat("+Math.min(storeEmployees.length, 4)+",1fr)",gap:14 }}>
                  {storeEmployees.sort(function(a,b){return b.overall-a.overall;}).map(function(emp) {
                    var lvl = getLevel(emp.overall);
                    var nl = getNextLevel(emp.overall);
                    return (
                      <div key={emp.name} style={{ background:"#12141A",borderRadius:12,padding:18,textAlign:"center",border:"1px solid "+lvl.color+"22" }}>
                        <div style={{ fontSize:24,marginBottom:4 }}>{lvl.emoji}</div>
                        <ScoreRing score={emp.overall} size={80} />
                        <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginTop:8 }}>{emp.name}</div>
                        <div style={{ color:lvl.color,fontSize:11,fontWeight:600,marginBottom:6 }}>{lvl.name}</div>
                        {nl && (
                          <div>
                            <div style={{ background:"#1A1D23",borderRadius:4,height:4,overflow:"hidden",margin:"4px 0" }}>
                              <div style={{ width:Math.min(100,((emp.overall - lvl.min) / (nl.min - lvl.min)) * 100)+"%",height:"100%",background:lvl.color,borderRadius:4 }} />
                            </div>
                            <div style={{ color:"#6B6F78",fontSize:9 }}>{nl.min - emp.overall} pts to {nl.name}</div>
                          </div>
                        )}
                        {emp.categories && (
                          <div style={{ display:"grid",gridTemplateColumns:"repeat("+[{k:"repairs"},{k:"audit"},{k:"calls"},{k:"experience"},{k:"compliance"}].filter(function(c){return emp.categories[c.k] && emp.categories[c.k].score !== undefined;}).length+",1fr)",gap:3,marginTop:8 }}>
                            {[{k:"repairs",l:"Repairs"},{k:"audit",l:"Audit"},{k:"calls",l:"Calls"},{k:"experience",l:"CX"},{k:"compliance",l:"Comply"}].filter(function(c){return emp.categories[c.k] && emp.categories[c.k].score !== undefined;}).map(function(c) {
                              var v = emp.categories[c.k].score;
                              return <div key={c.k} style={{ background:"#1A1D23",borderRadius:4,padding:"4px 0",textAlign:"center" }}>
                                <div style={{ color:getLevel(v).color,fontSize:11,fontWeight:700 }}>{v}</div>
                                <div style={{ color:"#6B6F78",fontSize:6,textTransform:"uppercase",letterSpacing:"0.03em" }}>{c.l}</div>
                              </div>;
                            })}
                          </div>
                        )}
                        {(function() {
                          var sd = salesByEmployee[emp.name];
                          if (!sd) return null;
                          return (
                            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginTop:4 }}>
                              <div style={{ background:"#1A1D23",borderRadius:4,padding:"4px 0",textAlign:"center" }}>
                                <div style={{ color:"#7B2FFF",fontSize:12,fontWeight:700 }}>{sd.repairs}</div>
                                <div style={{ color:"#6B6F78",fontSize:6,textTransform:"uppercase" }}>Repair Qty</div>
                              </div>
                              <div style={{ background:"#1A1D23",borderRadius:4,padding:"4px 0",textAlign:"center" }}>
                                <div style={{ color:"#00D4FF",fontSize:12,fontWeight:700 }}>{"$" + sd.accy_gp.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                                <div style={{ color:"#6B6F78",fontSize:6,textTransform:"uppercase" }}>Accy GP</div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Team Wins */}
            {teamWins.length > 0 && (
              <div style={{ background:"#1A1D23",borderRadius:14,padding:24,marginBottom:24 }}>
                <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700,marginBottom:14 }}>{"\uD83C\uDFC6"} Team Wins</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
                  {teamWins.map(function(w, i) {
                    return <div key={i} style={{ background:"#12141A",borderRadius:8,padding:"10px 14px",display:"flex",alignItems:"center",gap:10,border:"1px solid "+w.color+"15" }}>
                      <span style={{ fontSize:18 }}>{w.emoji}</span>
                      <span style={{ color:"#C8CAD0",fontSize:12 }}>{w.text}</span>
                    </div>;
                  })}
                </div>
              </div>
            )}

            {/* Today's appointments preview */}
            <div style={{ background:"#1A1D23",borderRadius:14,padding:24 }}>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>{"\uD83D\uDCC5"} Today's Appointments</div>
                <button onClick={function(){setSection("appointments");}} style={{ padding:"6px 14px",borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#7B2FFF",fontSize:11,cursor:"pointer",fontWeight:600 }}>View All</button>
              </div>
              {appointments.filter(function(a){var t=new Date().toISOString().split("T")[0];return a.date_of_appt===t;}).length > 0 ? (
                appointments.filter(function(a){var t=new Date().toISOString().split("T")[0];return a.date_of_appt===t;}).slice(0,5).map(function(a) {
                  var arrived=a.did_arrive&&a.did_arrive.toLowerCase()==="yes";var noShow=a.did_arrive&&a.did_arrive.toLowerCase().includes("no");var statusColor=arrived?"#4ADE80":noShow?"#F87171":"#FBBF24";var statusText=arrived?"Arrived":noShow?"No-Show":"Pending";
                  return <div key={a.id} style={{ padding:"10px 0",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div>
                      <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{a.customer_name}</span>
                      <span style={{ color:"#6B6F78",fontSize:11,marginLeft:8 }}>{a.appt_time} — {a.reason}</span>
                    </div>
                    <span style={{ padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:700,background:statusColor+"18",color:statusColor }}>{statusText}</span>
                  </div>;
                })
              ) : (
                <div style={{ color:"#6B6F78",fontSize:13,padding:20,textAlign:"center" }}>No appointments today</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ APPOINTMENTS SECTION ═══ */}
        {section === "appointments" && (
          <div>
            {/* Stats row */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:14,marginBottom:20 }}>
              {[{l:"Total",v:as.total||0,c:"#7B2FFF"},{l:"Show Rate",v:(as.showRate||0)+"%",c:as.showRate>=65?"#4ADE80":"#FBBF24"},{l:"No-Shows",v:as.noShow||0,c:"#F87171"},{l:"Revenue Lost",v:"$"+revenueLost.amount.toLocaleString(),c:"#FF2D95"},{l:"Follow-Ups",v:as.needFollowUp||0,c:as.needFollowUp>0?"#FBBF24":"#4ADE80"},{l:"Pending",v:as.pending||0,c:"#00D4FF"}].map(function(s,i) {
                return <div key={i} style={{ background:"#1A1D23",borderRadius:10,padding:"12px 14px",borderLeft:"3px solid "+s.c }}>
                  <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>{s.l}</div>
                  <div style={{ color:s.c,fontSize:22,fontWeight:700 }}>{s.v}</div>
                </div>;
              })}
            </div>

            {/* Action bar */}
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
              <div style={{ display:"flex",gap:4 }}>
                {[{id:"today",label:"Today"},{id:"list",label:"All"},{id:"followup",label:"Follow-Ups"}].map(function(v) {
                  return <button key={v.id} onClick={function(){setApptView(v.id);}} style={{ padding:"7px 14px",borderRadius:6,border:"none",cursor:"pointer",background:apptView===v.id?"#7B2FFF22":"#1A1D23",color:apptView===v.id?"#7B2FFF":"#8B8F98",fontSize:11,fontWeight:600 }}>{v.label}</button>;
                })}
              </div>
              <div style={{ display:"flex",gap:6 }}>
                <label style={{ padding:"7px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#1A1D23",color:"#8B8F98",fontSize:11,cursor:importing?"wait":"pointer" }}>
                  {importing?"Importing...":"\uD83D\uDCE4 Import"}<input type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} disabled={importing} style={{ display:"none" }} />
                </label>
                <button onClick={handleClearStore} style={{ padding:"7px 12px",borderRadius:6,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:11,cursor:"pointer" }}>Clear</button>
                <button onClick={function(){setShowForm(!showForm);setEditingId(null);setForm(emptyForm);setMatchedCall(null);setRepeatInfo(null);}} style={{ padding:"7px 14px",borderRadius:6,border:"none",background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:11,fontWeight:700,cursor:"pointer" }}>{showForm?"Cancel":"+ New"}</button>
              </div>
            </div>

            {/* Search */}
            <input type="text" value={searchQuery} onChange={function(e){setSearchQuery(e.target.value);}} placeholder={"\uD83D\uDD0D Search name, phone, reason..."} style={{ width:"100%",padding:"9px 14px",borderRadius:8,border:"1px solid #2A2D35",background:"#1A1D23",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box",marginBottom:12 }} />

            {msg && <div style={{ padding:"8px 14px",borderRadius:8,marginBottom:12,background:msg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(msg.type==="success"?"#4ADE8033":"#F8717133"),color:msg.type==="success"?"#4ADE80":"#F87171",fontSize:12 }}>{msg.text}</div>}

            {/* New appointment form */}
            {showForm && (
              <div style={{ background:"#1A1D23",borderRadius:12,padding:20,marginBottom:16,border:"1px solid #7B2FFF33" }}>
                <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:700,marginBottom:12 }}>{editingId ? "Edit" : "New Appointment"}</div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10 }}>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Customer Name *</label><input value={form.customer_name} onChange={function(e){setForm(Object.assign({},form,{customer_name:e.target.value}));}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Phone</label><input value={form.customer_phone} onChange={function(e){setForm(Object.assign({},form,{customer_phone:e.target.value}));}} onBlur={function(e){checkPhone(e.target.value);checkRepeatCustomer(e.target.value);}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Scheduled By</label><input list="emp-list" value={form.scheduled_by} onChange={function(e){setForm(Object.assign({},form,{scheduled_by:e.target.value}));}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /><datalist id="emp-list">{rosterFiltered.map(function(r){return <option key={r.name} value={r.name}/>;})}</datalist></div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10 }}>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Date</label><input type="date" value={form.date_of_appt} onChange={function(e){setForm(Object.assign({},form,{date_of_appt:e.target.value}));}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Time</label><input type="time" value={form.appt_time} onChange={function(e){setForm(Object.assign({},form,{appt_time:e.target.value}));}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Price</label><input value={form.price_quoted} onChange={function(e){setForm(Object.assign({},form,{price_quoted:e.target.value}));}} placeholder="$150" style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Arrived?</label><select value={form.did_arrive} onChange={function(e){setForm(Object.assign({},form,{did_arrive:e.target.value}));}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }}><option value="">Pending</option><option value="Yes">Yes</option><option value="No">No</option><option value="No/VM">No/VM</option><option value="Rescheduled">Rescheduled</option></select></div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12 }}>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Reason / Quote</label><input value={form.reason} onChange={function(e){setForm(Object.assign({},form,{reason:e.target.value}));}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Notes</label><input value={form.notes} onChange={function(e){setForm(Object.assign({},form,{notes:e.target.value}));}} style={{ width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" }} /></div>
                </div>
                {matchedCall && <div style={{ padding:10,borderRadius:6,background:"#00D4FF08",border:"1px solid #00D4FF33",marginBottom:8,fontSize:11,color:"#C8CAD0" }}>{"\uD83D\uDCDE"} <strong style={{color:"#00D4FF"}}>Call match:</strong> {matchedCall.employee} scored {parseFloat(matchedCall.score||0).toFixed(1)}/4 | {matchedCall.appt_offered?"\u2705":"\u274C"} Appt | {matchedCall.discount_mentioned?"\u2705":"\u274C"} Discount</div>}
                {repeatInfo && <div style={{ padding:10,borderRadius:6,background:repeatInfo.noShow>0?"#FBBF2408":"#4ADE8008",border:"1px solid "+(repeatInfo.noShow>0?"#FBBF2433":"#4ADE8033"),marginBottom:8,fontSize:11,color:"#C8CAD0" }}>{"\uD83D\uDD01"} <strong style={{color:repeatInfo.noShow>0?"#FBBF24":"#4ADE80"}}>Repeat customer:</strong> {repeatInfo.total} prev appts, {repeatInfo.arrived} arrived, {repeatInfo.noShow} no-shows{repeatInfo.noShow>0?" — \u26A0\uFE0F confirm day-of":""}</div>}
                <button onClick={saveAppointment} style={{ padding:"8px 20px",borderRadius:6,border:"none",background:"#7B2FFF",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>{editingId?"Save":"Add Appointment"}</button>
              </div>
            )}

            {/* Appointment list */}
            <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
              {apptView === "followup" ? (
                followUps.length > 0 ? followUps.map(function(a) {
                  return <div key={a.id} style={{ padding:"12px 18px",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                    <div><div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{a.customer_name} <span style={{ color:"#6B6F78",fontSize:11 }}>{fmtPhone(a.customer_phone)}</span></div><div style={{ color:"#F87171",fontSize:10 }}>No-show {a.date_of_appt} — {a.reason}</div></div>
                    <button onClick={function(){var n=prompt("Follow-up notes:");if(n!==null)markFollowUpDone(a.id,n);}} style={{ padding:"5px 12px",borderRadius:4,border:"none",background:"#4ADE80",color:"#000",fontSize:10,fontWeight:700,cursor:"pointer" }}>Called Back</button>
                  </div>;
                }) : <div style={{ padding:30,textAlign:"center",color:"#4ADE80",fontSize:12 }}>{"\u2705"} All follow-ups done!</div>
              ) : (
                filteredAppointments.length > 0 ? filteredAppointments.map(function(a) {
                  var arrived=a.did_arrive&&a.did_arrive.toLowerCase()==="yes";var noShow=a.did_arrive&&a.did_arrive.toLowerCase().includes("no");var pending=!a.did_arrive||a.did_arrive==="";var sc=arrived?"#4ADE80":noShow?"#F87171":"#FBBF24";var st=arrived?"Arrived":noShow?"No-Show":a.did_arrive==="Rescheduled"?"Resched":"Pending";
                  return <div key={a.id} style={{ padding:"12px 18px",borderBottom:"1px solid #1E2028" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:3 }}>
                          <span style={{ color:"#F0F1F3",fontSize:13,fontWeight:700 }}>{a.customer_name}</span>
                          {a.customer_phone && <span style={{ color:"#6B6F78",fontSize:10 }}>{fmtPhone(a.customer_phone)}</span>}
                          <span style={{ padding:"1px 6px",borderRadius:3,fontSize:8,fontWeight:700,background:sc+"18",color:sc }}>{st}</span>
                        </div>
                        <div style={{ color:"#8B8F98",fontSize:11 }}>{a.reason}</div>
                        <div style={{ color:"#6B6F78",fontSize:9,marginTop:2 }}>{a.date_of_appt&&new Date(a.date_of_appt+"T12:00:00").toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})}{a.appt_time?" at "+a.appt_time:""}{a.scheduled_by?" — "+a.scheduled_by:""}</div>
                      </div>
                      <div style={{ display:"flex",gap:3 }}>
                        {pending && <><button onClick={function(){updateArrival(a.id,"Yes");}} style={{ padding:"4px 8px",borderRadius:3,border:"1px solid #4ADE8033",background:"transparent",color:"#4ADE80",fontSize:9,cursor:"pointer" }}>Arrived</button><button onClick={function(){updateArrival(a.id,"No");}} style={{ padding:"4px 8px",borderRadius:3,border:"1px solid #F8717133",background:"transparent",color:"#F87171",fontSize:9,cursor:"pointer" }}>No-Show</button></>}
                        <button onClick={function(){startEdit(a);}} style={{ padding:"4px 8px",borderRadius:3,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:9,cursor:"pointer" }}>Edit</button>
                        <button onClick={function(){deleteAppt(a.id);}} style={{ padding:"4px 8px",borderRadius:3,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:9,cursor:"pointer" }}>Del</button>
                      </div>
                    </div>
                  </div>;
                }) : <div style={{ padding:30,textAlign:"center",color:"#6B6F78",fontSize:12 }}>{searchQuery?"No results for \""+searchQuery+"\"":apptView==="today"?"No appointments today":"No appointments"}</div>
              )}
            </div>
          </div>
        )}

        {/* ═══ ANALYTICS SECTION ═══ */}
        {section === "analytics" && apptStats && (
          <div>
            {apptStats.empStats && apptStats.empStats.length > 0 && (
              <div style={{ background:"#1A1D23",borderRadius:14,padding:24,marginBottom:20 }}>
                <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700,marginBottom:14 }}>Show Rate by Employee</div>
                {apptStats.empStats.map(function(e) {
                  var bc = e.show_rate >= 70 ? "#4ADE80" : e.show_rate >= 50 ? "#FBBF24" : "#F87171";
                  return <div key={e.name} style={{ padding:"10px 0",borderBottom:"1px solid #1E2028" }}>
                    <div style={{ display:"flex",justifyContent:"space-between",marginBottom:4 }}><span style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{e.name}</span><span style={{ color:bc,fontSize:13,fontWeight:700 }}>{e.show_rate}% ({e.arrived}/{e.total})</span></div>
                    <div style={{ background:"#12141A",borderRadius:4,height:6,overflow:"hidden" }}><div style={{ width:e.show_rate+"%",height:"100%",background:bc,borderRadius:4 }} /></div>
                    <div style={{ color:"#6B6F78",fontSize:10,marginTop:2 }}>{e.no_show} no-shows</div>
                  </div>;
                })}
              </div>
            )}
            {apptStats.storeStats && apptStats.storeStats.length > 0 && (
              <div style={{ background:"#1A1D23",borderRadius:14,padding:24 }}>
                <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700,marginBottom:14 }}>Show Rate by Store</div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat("+apptStats.storeStats.length+",1fr)",gap:16 }}>
                  {apptStats.storeStats.map(function(ss) {
                    var st=STORES[ss.store]; var bc=ss.show_rate>=70?"#4ADE80":ss.show_rate>=50?"#FBBF24":"#F87171";
                    return <div key={ss.store} style={{ textAlign:"center",padding:16,background:"#12141A",borderRadius:10 }}>
                      <div style={{ color:st?st.color:"#8B8F98",fontSize:14,fontWeight:700,marginBottom:6 }}>{st?st.name.replace("CPR ",""):ss.store}</div>
                      <div style={{ color:bc,fontSize:28,fontWeight:800 }}>{ss.show_rate}%</div>
                      <div style={{ color:"#6B6F78",fontSize:11 }}>{ss.arrived}/{ss.total} arrived</div>
                    </div>;
                  })}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
      )}
    </div>
  );
}

export default function AppointmentsPage() {
  return <AuthProvider><StoreDashboard /></AuthProvider>;
}

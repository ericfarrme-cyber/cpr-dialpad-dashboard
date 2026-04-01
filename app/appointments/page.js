'use client';

import { useState, useEffect, useMemo } from "react";
import AuthProvider, { useAuth } from "@/components/AuthProvider";
import ErrorBoundary from "@/components/ErrorBoundary";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);
var GOOGLE_LINKS = {
  fishers: "https://share.google/boLKmW7TWqLQMaUsY",
  bloomington: "https://share.google/0XO2eEVlRVWHrUpGC",
  indianapolis: "https://share.google/uNhlR2bdbFSjbF360",
};

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
  var str = String(text).trim();
  // Try parsing as plain number first (e.g. "150", "149.99")
  var plain = parseFloat(str.replace(/[$,]/g, ""));
  if (!isNaN(plain) && plain > 0) return plain;
  // Try extracting $XX pattern from text
  var matches = str.match(/\$[\d,]+(?:\.\d{2})?/g);
  if (matches && matches.length > 0) return parseFloat(matches[0].replace(/[$,]/g, "")) || 0;
  // Try any number in the string
  var numMatch = str.match(/(\d+(?:\.\d{2})?)/);
  if (numMatch) return parseFloat(numMatch[1]) || 0;
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

// ═══ MINI SPARKLINE ═══
function Sparkline({ data, color, width, height }) {
  var w = width || 80, h = height || 24;
  if (!data || data.length < 2) return null;
  var max = Math.max.apply(null, data);
  var min = Math.min.apply(null, data);
  var range = max - min || 1;
  var pts = data.map(function(v, i) {
    return (i / (data.length - 1)) * w + "," + (h - ((v - min) / range) * (h - 4) - 2);
  }).join(" ");
  return (
    <svg width={w} height={h} style={{ display:"block" }}>
      <polyline points={pts} fill="none" stroke={color || "#7B2FFF"} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
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
  var [allAppointments, setAllAppointments] = useState([]);
  var [ticketStats, setTicketStats] = useState(null);
  var [roster, setRoster] = useState([]);
  var [salesData, setSalesData] = useState(null);
  var [weeklyGoal, setWeeklyGoal] = useState(null);

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
  var [expandedEmp, setExpandedEmp] = useState(null);

  // Period selector for historical scorecard data
  var periodOptions = [];
  var nowDate = new Date();
  for (var mi = 0; mi < 12; mi++) {
    var pd = new Date(nowDate.getFullYear(), nowDate.getMonth() - mi, 1);
    var pVal = pd.getFullYear() + "-" + String(pd.getMonth() + 1).padStart(2, "0");
    var pLabel = pd.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    periodOptions.push({ value: pVal, label: pLabel });
  }
  var currentPeriod = periodOptions[0].value;
  var [selectedPeriod, setSelectedPeriod] = useState(currentPeriod);

  // Review + GBP states
  var [reviewData, setReviewData] = useState(null);
  var [reviewForm, setReviewForm] = useState({ total_reviews: "", photo_reviews: "", employee_count: "", notes: "" });
  var [reviewSaving, setReviewSaving] = useState(false);
  var [gbpReport, setGbpReport] = useState(null);
  var [gbpHistory, setGbpHistory] = useState([]);
  var [reviewSubTab, setReviewSubTab] = useState("performance");
  var [showGbpForm, setShowGbpForm] = useState(false);
  var [gbpSaving, setGbpSaving] = useState(false);
  var [gbpImporting, setGbpImporting] = useState(false);

  var emptyGbpForm = {
    period_start: "", period_end: "",
    customer_calls: "", profile_views: "", website_visits: "", direction_requests: "", competitors_outranked: "",
    received_reviews: "", posts_published: "", photos_published: "", review_responses: "", offers_published: "",
    keywords: [{ keyword: "", position: "", position_change: "" }],
    competitors: [{ name: "", actions: "", impact: "" }],
    notes: "",
  };
  var [gbpForm, setGbpForm] = useState(emptyGbpForm);

  // ═══ DATA LOADING ═══
  var loadData = async function() {
    setLoading(true);
    try {
      var [scRes, apptStRes, apptRes, tixRes, rostRes, salesRes, goalRes, revRes, allApptRes] = await Promise.allSettled([
        fetch("/api/dialpad/scorecard?period=" + selectedPeriod).then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=stats&store=" + store + "&days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=" + (apptView === "today" ? "today" : "list") + "&store=" + store).then(function(r){return r.json();}),
        fetch("/api/dialpad/tickets?action=stats&store=" + store).then(function(r){return r.json();}),
        fetch("/api/dialpad/roster").then(function(r){return r.json();}),
        fetch("/api/dialpad/sales?action=performance").then(function(r){return r.json();}),
        fetch("/api/dialpad/weekly-goal?store=" + store).then(function(r){return r.json();}),
        fetch("/api/dialpad/google-reviews?store=" + store).then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=list&store=" + store + "&days=365").then(function(r){return r.json();}),
      ]);
      if (scRes.status === "fulfilled" && scRes.value.success) setScorecard(scRes.value);
      if (apptStRes.status === "fulfilled" && apptStRes.value.success) setApptStats(apptStRes.value);
      if (apptRes.status === "fulfilled" && apptRes.value.success) setAppointments(apptRes.value.appointments || []);
      if (tixRes.status === "fulfilled" && tixRes.value.success) setTicketStats(tixRes.value.stats);
      if (rostRes.status === "fulfilled" && rostRes.value.success) setRoster((rostRes.value.roster || []).filter(function(r){return r.active;}));
      if (salesRes.status === "fulfilled" && salesRes.value.success) setSalesData(salesRes.value);
      if (goalRes.status === "fulfilled" && goalRes.value.success) setWeeklyGoal(goalRes.value.goal);
      if (revRes.status === "fulfilled" && revRes.value.success) {
        setReviewData(revRes.value);
        var rd = revRes.value.current;
        if (rd) setReviewForm({ total_reviews: rd.total_reviews || "", photo_reviews: rd.photo_reviews || "", employee_count: rd.employee_count || "", notes: rd.notes || "" });
        setGbpReport(revRes.value.latestReport || null);
        setGbpHistory(revRes.value.reportHistory || []);
      }
      if (allApptRes.status === "fulfilled" && allApptRes.value.success) setAllAppointments(allApptRes.value.appointments || []);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  // Auto-verify arrived appointments against ticket data
  var runVerification = async function() {
    try {
      var res = await fetch("/api/dialpad/verify-conversions?store=" + store + "&days=30");
      var json = await res.json();
      if (json.success && json.verified > 0) {
        console.log("Auto-verified " + json.verified + " conversions");
        // Reload to show updated statuses
        loadData();
      }
    } catch(e) { console.error("Verification error:", e); }
  };

  useEffect(function() { loadData(); }, [store, apptView, selectedPeriod]);
  // Run verification after initial load (delayed so it doesn't compete)
  useEffect(function() {
    var timer = setTimeout(function() { runVerification(); verifyFollowUps(); }, 3000);
    return function() { clearTimeout(timer); };
  }, [store]);

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
    storeEmployees.forEach(function(emp) {
      if (emp.repairs) {
        totals.repairs += (emp.repairs.phone_tickets || 0) + (emp.repairs.other_tickets || 0);
        totals.accy_gp += emp.repairs.accy_gp || 0;
        totals.accy_count += emp.repairs.accy_count || 0;
        totals.clean_count += emp.repairs.clean_count || 0;
      }
    });
    return totals;
  }, [storeEmployees]);

  var revenueLost = useMemo(function() {
    var noShows = appointments.filter(function(a) {
      return a.did_arrive && (a.did_arrive.toLowerCase() === "no" || a.did_arrive.toLowerCase().includes("no"));
    });
    var total = 0;
    noShows.forEach(function(a) { total += extractPrice(a.price_quoted) || extractPrice(a.reason); });
    return { amount: total, count: noShows.length };
  }, [appointments]);

  // Converted appointments KPI
  var convertedStats = useMemo(function() {
    // Filter by selected period
    var recent = allAppointments.filter(function(a) {
      return a.date_of_appt && a.date_of_appt.substring(0, 7) === selectedPeriod;
    });
    var converted = recent.filter(function(a) { return a.did_arrive && a.did_arrive.toLowerCase() === "converted"; });
    var arrivedTotal = recent.filter(function(a) { return a.did_arrive && (a.did_arrive.toLowerCase() === "yes" || a.did_arrive.toLowerCase() === "converted"); });

    // Days with at least one appointment (to avoid dividing by empty days)
    var daysWithAppts = {};
    recent.forEach(function(a) { if (a.date_of_appt) daysWithAppts[a.date_of_appt] = true; });
    var activeDays = Math.max(Object.keys(daysWithAppts).length, 1);

    var perDay = converted.length / activeDays;
    var conversionRate = arrivedTotal.length > 0 ? (converted.length / arrivedTotal.length) * 100 : 0;

    // Daily trend for chart
    var dailyMap = {};
    recent.forEach(function(a) {
      if (!a.date_of_appt) return;
      if (!dailyMap[a.date_of_appt]) dailyMap[a.date_of_appt] = { date: a.date_of_appt, converted: 0, arrived: 0, noShow: 0, total: 0 };
      dailyMap[a.date_of_appt].total++;
      if (a.did_arrive && a.did_arrive.toLowerCase() === "converted") dailyMap[a.date_of_appt].converted++;
      else if (a.did_arrive && (a.did_arrive.toLowerCase() === "yes")) dailyMap[a.date_of_appt].arrived++;
      else if (a.did_arrive && (a.did_arrive.toLowerCase() === "no" || a.did_arrive.toLowerCase().includes("no"))) dailyMap[a.date_of_appt].noShow++;
    });
    var dailyTrend = Object.values(dailyMap).sort(function(a, b) { return a.date > b.date ? 1 : -1; });

    return {
      total: converted.length,
      perDay: perDay,
      conversionRate: conversionRate,
      arrivedTotal: arrivedTotal.length,
      activeDays: activeDays,
      dailyTrend: dailyTrend,
    };
  }, [allAppointments, selectedPeriod]);

  // Booking rate: appointments booked vs total inbound calls
  var bookingRate = useMemo(function() {
    var totalInbound = storeScore && storeScore.categories && storeScore.categories.calls
      ? storeScore.categories.calls.details.total_inbound || 0 : 0;
    var periodApptCount = allAppointments.filter(function(a) {
      return a.date_of_appt && a.date_of_appt.substring(0, 7) === selectedPeriod;
    }).length;
    if (totalInbound === 0) return { rate: 0, appts: periodApptCount, calls: 0 };
    return { rate: Math.min(Math.round((periodApptCount / totalInbound) * 100), 100), appts: periodApptCount, calls: totalInbound };
  }, [storeScore, allAppointments, selectedPeriod]);

  // Generate team wins
  var teamWins = useMemo(function() {
    var wins = [];
    storeEmployees.forEach(function(e) {
      var lvl = getLevel(e.overall);
      if (e.overall >= 60) wins.push({ emoji: lvl.emoji, text: e.name + " reached " + lvl.name + " level! (" + e.overall + " pts)", color: lvl.color });
      if (e.audit && e.audit.score >= 70) wins.push({ emoji: "\uD83D\uDCDE", text: e.name + " — strong phone audit score (" + e.audit.score + ")", color: "#7B2FFF" });
      if (e.compliance && e.compliance.score >= 75) wins.push({ emoji: "\uD83C\uDFAB", text: e.name + " — excellent ticket compliance (" + e.compliance.score + ")", color: "#00D4FF" });
    });
    if (apptStats && apptStats.empStats) {
      apptStats.empStats.forEach(function(e) {
        if (e.show_rate >= 75 && e.total >= 5) wins.push({ emoji: "\uD83C\uDFAF", text: e.name + " — " + e.show_rate + "% appointment show rate!", color: "#4ADE80" });
      });
    }
    storeEmployees.forEach(function(e) {
      var totalRepairs = e.repairs ? (e.repairs.phone_tickets || 0) + (e.repairs.other_tickets || 0) : 0;
      var accyGP = e.repairs ? e.repairs.accy_gp || 0 : 0;
      if (totalRepairs >= 15) wins.push({ emoji: "\uD83D\uDD27", text: e.name + " \u2014 " + totalRepairs + " repairs this month!", color: "#7B2FFF" });
      if (accyGP >= 200) wins.push({ emoji: "\uD83D\uDCB0", text: e.name + " \u2014 $" + Math.round(accyGP) + " in accessory GP!", color: "#00D4FF" });
    });
    return wins.slice(0, 10);
  }, [storeEmployees, apptStats]);

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
  var markFollowUpDone = async function(id, notes) { await fetch("/api/dialpad/appointments",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"update",id:id,follow_up_notes:"pending_verification|"+(notes||"Called back")+"|"+new Date().toISOString()})}); loadData(); };

  // Verify follow-ups against Dialpad outbound call data
  var verifyFollowUps = async function() {
    var pending = (allAppointments || []).filter(function(a) {
      return a.follow_up_needed && !a.follow_up_done && (a.follow_up_notes || "").startsWith("pending_verification");
    });
    if (pending.length === 0) return;
    try {
      var res = await fetch("/api/dialpad/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_followups", store: store })
      });
      var json = await res.json();
      if (json.success && json.verified > 0) {
        console.log("Verified " + json.verified + " follow-ups via Dialpad");
        loadData();
      }
    } catch(e) { console.error("Follow-up verification error:", e); }
  };
  var startEdit = function(appt) { setForm({customer_name:appt.customer_name||"",customer_phone:appt.customer_phone||"",date_of_appt:appt.date_of_appt||"",appt_time:appt.appt_time||"",reason:appt.reason||"",price_quoted:appt.price_quoted||"",scheduled_by:appt.scheduled_by||"",did_arrive:appt.did_arrive||"",notes:appt.notes||""}); setEditingId(appt.id); setShowForm(true); };
  var checkPhone = async function(phone) { var n = normPhone(phone); if (n.length !== 10) { setMatchedCall(null); return; } try { var r = await fetch("/api/dialpad/appointments?action=match_call&phone="+n); var j = await r.json(); setMatchedCall(j.success && j.calls && j.calls.length > 0 ? j.calls[0] : null); } catch(e) { setMatchedCall(null); } };
  var checkRepeatCustomer = async function(phone) { var n = normPhone(phone); if (n.length !== 10) { setRepeatInfo(null); return; } try { var r = await fetch("/api/dialpad/appointments?action=list&days=365"); var j = await r.json(); if (j.success) { var m = (j.appointments||[]).filter(function(a){return normPhone(a.customer_phone)===n;}); if (m.length > 0) { var arr = m.filter(function(a){return a.did_arrive&&(a.did_arrive.toLowerCase()==="yes"||a.did_arrive.toLowerCase()==="converted");}); var ns = m.filter(function(a){return a.did_arrive&&a.did_arrive.toLowerCase().includes("no");}); setRepeatInfo({total:m.length,arrived:arr.length,noShow:ns.length,lastVisit:m[0].date_of_appt,lastReason:m[0].reason,name:m[0].customer_name}); } else setRepeatInfo(null); } } catch(e) { setRepeatInfo(null); } };

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

  // Review bonus calculations
  var reviewCalc = useMemo(function() {
    var total = parseInt(reviewForm.total_reviews) || 0;
    var photos = parseInt(reviewForm.photo_reviews) || 0;
    var empCount = parseInt(reviewForm.employee_count) || storeEmployees.length || 1;
    var bonusReviews = Math.max(0, total - 10);
    var bonusPerEmployee = (bonusReviews * 5) + (photos * 5);
    var totalBonus = bonusPerEmployee * empCount;
    var hitMinimum = total >= 10;
    return { total: total, photos: photos, empCount: empCount, bonusReviews: bonusReviews, bonusPerEmployee: bonusPerEmployee, totalBonus: totalBonus, hitMinimum: hitMinimum };
  }, [reviewForm, storeEmployees]);

  var saveReview = async function() {
    setReviewSaving(true);
    try {
      var period = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");
      var res = await fetch("/api/dialpad/google-reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save", store: store, period: period,
          total_reviews: parseInt(reviewForm.total_reviews) || 0,
          photo_reviews: parseInt(reviewForm.photo_reviews) || 0,
          employee_count: parseInt(reviewForm.employee_count) || storeEmployees.length || 1,
          notes: reviewForm.notes || "",
        }),
      });
      var json = await res.json();
      if (json.success) { setMsg({ type: "success", text: "Reviews saved" }); loadData(); }
      else setMsg({ type: "error", text: json.error });
    } catch(e) { setMsg({ type: "error", text: e.message }); }
    setReviewSaving(false);
    setTimeout(function() { setMsg(null); }, 3000);
  };

  // ═══ GBP REPORT HANDLERS ═══
  var addGbpKeyword = function() {
    setGbpForm(Object.assign({}, gbpForm, { keywords: gbpForm.keywords.concat([{ keyword: "", position: "", position_change: "" }]) }));
  };
  var removeGbpKeyword = function(idx) {
    setGbpForm(Object.assign({}, gbpForm, { keywords: gbpForm.keywords.filter(function(_, i) { return i !== idx; }) }));
  };
  var updateGbpKeyword = function(idx, field, val) {
    var kw = gbpForm.keywords.map(function(k, i) { if (i === idx) { var u = Object.assign({}, k); u[field] = val; return u; } return k; });
    setGbpForm(Object.assign({}, gbpForm, { keywords: kw }));
  };
  var addGbpCompetitor = function() {
    setGbpForm(Object.assign({}, gbpForm, { competitors: gbpForm.competitors.concat([{ name: "", actions: "", impact: "" }]) }));
  };
  var removeGbpCompetitor = function(idx) {
    setGbpForm(Object.assign({}, gbpForm, { competitors: gbpForm.competitors.filter(function(_, i) { return i !== idx; }) }));
  };
  var updateGbpCompetitor = function(idx, field, val) {
    var comps = gbpForm.competitors.map(function(c, i) { if (i === idx) { var u = Object.assign({}, c); u[field] = val; return u; } return c; });
    setGbpForm(Object.assign({}, gbpForm, { competitors: comps }));
  };

  var saveGbpReport = async function() {
    if (!gbpForm.period_start || !gbpForm.period_end) { setMsg({ type: "error", text: "Report dates required" }); return; }
    setGbpSaving(true);
    try {
      var cleanKeywords = gbpForm.keywords.filter(function(k) { return k.keyword.trim(); });
      var cleanComps = gbpForm.competitors.filter(function(c) { return c.name.trim(); });
      var res = await fetch("/api/dialpad/google-reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_report",
          store: store,
          period_start: gbpForm.period_start,
          period_end: gbpForm.period_end,
          customer_calls: gbpForm.customer_calls,
          profile_views: gbpForm.profile_views,
          website_visits: gbpForm.website_visits,
          direction_requests: gbpForm.direction_requests,
          competitors_outranked: gbpForm.competitors_outranked,
          received_reviews: gbpForm.received_reviews,
          posts_published: gbpForm.posts_published,
          photos_published: gbpForm.photos_published,
          review_responses: gbpForm.review_responses,
          offers_published: gbpForm.offers_published,
          keywords: cleanKeywords,
          competitors: cleanComps,
          notes: gbpForm.notes,
        }),
      });
      var json = await res.json();
      if (json.success) {
        setMsg({ type: "success", text: "GBP Report saved" });
        setShowGbpForm(false);
        setGbpForm(emptyGbpForm);
        loadData();
      } else setMsg({ type: "error", text: json.error });
    } catch(e) { setMsg({ type: "error", text: e.message }); }
    setGbpSaving(false);
    setTimeout(function() { setMsg(null); }, 3000);
  };

  var deleteGbpReport = async function(id) {
    if (!confirm("Delete this GBP report?")) return;
    try {
      var res = await fetch("/api/dialpad/google-reviews", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_report", id: id }),
      });
      var json = await res.json();
      if (json.success) { setMsg({ type: "success", text: "Report deleted" }); loadData(); }
      else setMsg({ type: "error", text: json.error });
    } catch(e) { setMsg({ type: "error", text: e.message }); }
    setTimeout(function() { setMsg(null); }, 3000);
  };

  // ═══ GBP PDF IMPORT ═══
  var handleGbpImport = async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    setGbpImporting(true);
    setMsg({ type: "success", text: "Reading report PDF..." });

    try {
      var buffer = await file.arrayBuffer();
      var bytes = new Uint8Array(buffer);
      var binary = "";
      for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      var base64 = btoa(binary);

      var mediaType = file.type || "application/pdf";
      if (file.name.toLowerCase().endsWith(".pdf")) mediaType = "application/pdf";
      else if (file.name.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)) mediaType = "image/" + file.name.split(".").pop().toLowerCase().replace("jpg", "jpeg");

      setMsg({ type: "success", text: "Extracting data with AI..." });

      var res = await fetch("/api/dialpad/extract-gbp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages: [{ data: base64, media_type: mediaType }],
        }),
      });

      var json = await res.json();
      if (!json.success) {
        setMsg({ type: "error", text: "Extraction failed: " + (json.error || "Unknown error") });
        setGbpImporting(false);
        return;
      }

      var d = json.data;

      // Build keywords array
      var keywords = (d.keywords || []).map(function(kw) {
        return {
          keyword: kw.keyword || "",
          position: String(kw.position || ""),
          position_change: String(kw.position_change || "0"),
        };
      });
      if (keywords.length === 0) keywords = [{ keyword: "", position: "", position_change: "" }];

      // Build competitors array
      var competitors = (d.competitors || []).map(function(c) {
        return {
          name: c.name || "",
          actions: c.actions || "",
          impact: c.impact || "",
        };
      });
      if (competitors.length === 0) competitors = [{ name: "", actions: "", impact: "" }];

      setGbpForm({
        period_start: d.period_start || "",
        period_end: d.period_end || "",
        customer_calls: String(d.customer_calls || 0),
        profile_views: String(d.profile_views || 0),
        website_visits: String(d.website_visits || 0),
        direction_requests: String(d.direction_requests || 0),
        competitors_outranked: String(d.competitors_outranked || 0),
        received_reviews: String(d.received_reviews || 0),
        posts_published: String(d.posts_published || 0),
        photos_published: String(d.photos_published || 0),
        review_responses: String(d.review_responses || 0),
        offers_published: String(d.offers_published || 0),
        keywords: keywords,
        competitors: competitors,
        notes: d.notes || "",
      });

      setShowGbpForm(true);
      setMsg({ type: "success", text: "Report data extracted! Review and save." });

    } catch (err) {
      setMsg({ type: "error", text: "Import failed: " + err.message });
    }
    setGbpImporting(false);
    setTimeout(function() { setMsg(null); }, 5000);
  };

  // Computed: GBP trends from history
  var gbpTrends = useMemo(function() {
    if (!gbpHistory || gbpHistory.length < 2) return null;
    var sorted = gbpHistory.slice().sort(function(a, b) { return a.period_start > b.period_start ? 1 : -1; });
    return {
      calls: sorted.map(function(r) { return r.customer_calls || 0; }),
      views: sorted.map(function(r) { return r.profile_views || 0; }),
      visits: sorted.map(function(r) { return r.website_visits || 0; }),
      directions: sorted.map(function(r) { return r.direction_requests || 0; }),
    };
  }, [gbpHistory]);

  // ═══ SHARED INPUT STYLE ═══
  var inputStyle = { width:"100%",padding:"8px 10px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:"#F0F1F3",fontSize:12,outline:"none",boxSizing:"border-box" };
  var inputStyleCenter = Object.assign({}, inputStyle, { textAlign: "center", fontSize: 14, fontWeight: 700, padding: "10px 12px", borderRadius: 8 });

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
          {[{id:"overview",label:"\uD83C\uDFEA Store Overview"},{id:"appointments",label:"\uD83D\uDCC5 Appointments"},{id:"reviews",label:"\u2B50 Reviews & SEO"},{id:"analytics",label:"\uD83D\uDCCA Analytics"}].map(function(v) {
            return <button key={v.id} onClick={function(){setSection(v.id);}} style={{ padding:"10px 18px",borderRadius:8,border:"none",cursor:"pointer",background:section===v.id?"#7B2FFF22":"#1A1D23",color:section===v.id?"#7B2FFF":"#8B8F98",fontSize:13,fontWeight:600 }}>{v.label}</button>;
          })}
        </div>

        {/* ═══ OVERVIEW SECTION ═══ */}
        {section === "overview" && (
          <div>
            {/* Period selector */}
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16 }}>
              <div style={{ display:"flex",alignItems:"center",gap:8 }}>
                <span style={{ color:"#6B6F78",fontSize:13 }}>{"\uD83D\uDCC5"}</span>
                <select value={selectedPeriod} onChange={function(e){setSelectedPeriod(e.target.value);}}
                  style={{ padding:"7px 14px",borderRadius:8,border:"1px solid #2A2D35",background:"#12141A",color:selectedPeriod===currentPeriod?"#8B8F98":"#FBBF24",fontSize:12,fontWeight:600,cursor:"pointer",outline:"none" }}>
                  {periodOptions.map(function(p){
                    return <option key={p.value} value={p.value}>{p.label}</option>;
                  })}
                </select>
                {selectedPeriod !== currentPeriod && (
                  <button onClick={function(){setSelectedPeriod(currentPeriod);}}
                    style={{ padding:"5px 12px",borderRadius:6,border:"1px solid #7B2FFF33",background:"#7B2FFF11",color:"#7B2FFF",fontSize:10,fontWeight:600,cursor:"pointer" }}>
                    Current Month
                  </button>
                )}
              </div>
              {selectedPeriod !== currentPeriod && (
                <div style={{ background:"#FBBF2410",border:"1px solid #FBBF2433",borderRadius:8,padding:"6px 14px",display:"flex",alignItems:"center",gap:6 }}>
                  <span style={{ fontSize:12 }}>{"\uD83D\uDCC6"}</span>
                  <span style={{ color:"#FBBF24",fontSize:11,fontWeight:600 }}>
                    {"Viewing: " + periodOptions.find(function(p){return p.value===selectedPeriod;}).label}
                  </span>
                </div>
              )}
            </div>

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
                <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>{"\uD83D\uDCDE"} Booking Rate</div>
                <div style={{ color:bookingRate.rate>=15?"#4ADE80":bookingRate.rate>=8?"#FBBF24":"#FF2D95",fontSize:26,fontWeight:700 }}>{bookingRate.rate}%</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{bookingRate.appts} appts / {bookingRate.calls} calls</div>
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
                <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700,marginBottom:16 }}>Team Performance <span style={{ color:"#6B6F78",fontSize:11,fontWeight:400 }}>— tap a name to see details</span></div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat("+Math.min(storeEmployees.length, 4)+",1fr)",gap:14 }}>
                  {storeEmployees.sort(function(a,b){return b.overall-a.overall;}).map(function(emp) {
                    var lvl = getLevel(emp.overall);
                    var nl = getNextLevel(emp.overall);
                    var isExpanded = expandedEmp === emp.name;
                    return (
                      <div key={emp.name} onClick={function(){setExpandedEmp(isExpanded ? null : emp.name);}}
                        style={{ background:isExpanded?"#1A1D23":"#12141A",borderRadius:12,padding:18,textAlign:"center",border:"1px solid "+(isExpanded?lvl.color+"55":lvl.color+"22"),cursor:"pointer",transition:"border-color 0.2s" }}>
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
                        {[{k:"repairs"},{k:"audit"},{k:"compliance"}].some(function(c){return emp[c.k] && emp[c.k].score !== undefined;}) && (
                          <div style={{ display:"grid",gridTemplateColumns:"repeat("+[{k:"repairs"},{k:"audit"},{k:"calls"},{k:"experience"},{k:"compliance"}].filter(function(c){return emp[c.k] && emp[c.k].score !== undefined;}).length+",1fr)",gap:3,marginTop:8 }}>
                            {[{k:"repairs",l:"Repairs"},{k:"audit",l:"Audit"},{k:"calls",l:"Calls"},{k:"experience",l:"CX"},{k:"compliance",l:"Comply"}].filter(function(c){return emp[c.k] && emp[c.k].score !== undefined;}).map(function(c) {
                              var v = emp[c.k].score;
                              return <div key={c.k} style={{ background:"#1A1D23",borderRadius:4,padding:"4px 0",textAlign:"center" }}>
                                <div style={{ color:getLevel(v).color,fontSize:11,fontWeight:700 }}>{v}</div>
                                <div style={{ color:"#6B6F78",fontSize:6,textTransform:"uppercase",letterSpacing:"0.03em" }}>{c.l}</div>
                              </div>;
                            })}
                          </div>
                        )}
                        {(function() {
                          var repairTotal = emp.repairs ? (emp.repairs.phone_tickets || 0) + (emp.repairs.other_tickets || 0) : 0;
                          var accyGP = emp.repairs ? emp.repairs.accy_gp || 0 : 0;
                          if (repairTotal === 0 && accyGP === 0) return null;
                          return (
                            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:3,marginTop:4 }}>
                              <div style={{ background:"#1A1D23",borderRadius:4,padding:"4px 0",textAlign:"center" }}>
                                <div style={{ color:"#7B2FFF",fontSize:12,fontWeight:700 }}>{repairTotal}</div>
                                <div style={{ color:"#6B6F78",fontSize:6,textTransform:"uppercase" }}>Repair Qty</div>
                              </div>
                              <div style={{ background:"#1A1D23",borderRadius:4,padding:"4px 0",textAlign:"center" }}>
                                <div style={{ color:"#00D4FF",fontSize:12,fontWeight:700 }}>{"$" + accyGP.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
                                <div style={{ color:"#6B6F78",fontSize:6,textTransform:"uppercase" }}>Accy GP</div>
                              </div>
                            </div>
                          );
                        })()}
                        <div style={{ color:isExpanded?lvl.color:"#6B6F78",fontSize:9,marginTop:6 }}>{isExpanded ? "\u25B2 Hide Details" : "\u25BC View Details"}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Expanded detail panel */}
                {expandedEmp && (function() {
                  var emp = storeEmployees.find(function(e){return e.name === expandedEmp;});
                  if (!emp) return null;
                  var lvl = getLevel(emp.overall);
                  var empAppt = apptStats && apptStats.empStats ? apptStats.empStats.find(function(e){return e.name === emp.name;}) : null;

                  // Use scorecard data for repairs (period-aware)
                  var repairQty = emp.repairs ? (emp.repairs.phone_tickets || 0) + (emp.repairs.other_tickets || 0) : 0;
                  var accyGP = emp.repairs ? emp.repairs.accy_gp || 0 : 0;
                  var accyCount = emp.repairs ? emp.repairs.accy_count || 0 : 0;
                  var cleanCount = emp.repairs ? emp.repairs.clean_count || 0 : 0;

                  // Audit details
                  var auditScore = emp.audit ? emp.audit.score || 0 : 0;
                  var avgAuditPct = emp.audit ? emp.audit.avg_pct || 0 : 0;
                  var apptRate = emp.audit ? emp.audit.appt_rate || 0 : 0;
                  var warrantyRate = emp.audit ? emp.audit.warranty_rate || 0 : 0;
                  var totalAudits = emp.audit ? emp.audit.total_audits || 0 : 0;
                  var oppAudits = emp.audit ? emp.audit.opp_audits || 0 : 0;

                  // Compliance details
                  var compScore = emp.compliance ? emp.compliance.score || 0 : 0;
                  var ticketsGraded = emp.compliance ? emp.compliance.tickets_graded || 0 : 0;

                  // Generate coaching tips based on weakest areas
                  var auditTips = [];
                  if (totalAudits > 0) {
                    if (apptRate < 70) auditTips.push({ text: "Offer appointments on " + Math.round(100 - apptRate) + "% more calls — ask every customer", priority: "high" });
                    if (warrantyRate < 60) auditTips.push({ text: "Mention warranty/protection plans — currently at " + warrantyRate + "% of calls", priority: warrantyRate < 40 ? "high" : "med" });
                    if (avgAuditPct < 70) auditTips.push({ text: "Focus on greeting, diagnosis, and closing — avg score is " + avgAuditPct + "%", priority: "high" });
                    if (avgAuditPct >= 80 && apptRate >= 70 && warrantyRate >= 60) auditTips.push({ text: "Strong phone skills! Keep it up.", priority: "good" });
                  }
                  var compTips = [];
                  if (ticketsGraded > 0) {
                    if (compScore < 60) compTips.push({ text: "Ticket quality needs improvement — ensure diagnostics, notes, and payment are complete", priority: "high" });
                    else if (compScore < 80) compTips.push({ text: "Good start — double-check notes include repair outcome + customer notification", priority: "med" });
                    else compTips.push({ text: "Excellent ticket documentation!", priority: "good" });
                  }

                  var catDetails = [
                    { key: "repairs", label: "Repairs & Production", icon: "\uD83D\uDD27", color: "#7B2FFF",
                      details: [
                        { label: "Phone Repairs", value: emp.repairs ? emp.repairs.phone_tickets || 0 : 0 },
                        { label: "Other Repairs", value: emp.repairs ? emp.repairs.other_tickets || 0 : 0 },
                        { label: "Total Repairs", value: repairQty, highlight: true },
                        { label: "Accessory GP", value: "$" + accyGP.toLocaleString(undefined,{maximumFractionDigits:0}) },
                        { label: "Accessory Items", value: accyCount, suffix: " sold" },
                        { label: "Cleanings", value: cleanCount },
                      ] },
                    { key: "audit", label: "Phone Audit Quality", icon: "\uD83D\uDCDE", color: "#FBBF24",
                      details: [
                        { label: "Overall Audit Score", value: auditScore + "/100", highlight: true },
                        { label: "Avg Call Score", value: avgAuditPct + "%" },
                        { label: "Appt Offered Rate", value: apptRate + "%", warn: apptRate < 70 },
                        { label: "Warranty Mentioned", value: warrantyRate + "%", warn: warrantyRate < 60 },
                        { label: "Calls Audited", value: totalAudits },
                        { label: "Opportunity Calls", value: oppAudits },
                      ],
                      tips: auditTips },
                    { key: "compliance", label: "Ticket Compliance", icon: "\uD83C\uDFAB", color: "#00D4FF",
                      details: [
                        { label: "Compliance Score", value: compScore + "/100", highlight: true },
                        { label: "Tickets Graded", value: ticketsGraded },
                      ],
                      tips: compTips },
                  ];

                  if (empAppt) {
                    catDetails.push({
                      key: "appointments", label: "Appointments", icon: "\uD83D\uDCC5", color: "#4ADE80",
                      details: [
                        { label: "Total Booked", value: empAppt.total },
                        { label: "Showed Up", value: empAppt.arrived },
                        { label: "No-Shows", value: empAppt.no_show },
                        { label: "Show Rate", value: empAppt.show_rate + "%", highlight: true },
                      ]
                    });
                  }

                  return (
                    <div style={{ marginTop:16,background:"#12141A",borderRadius:12,padding:20,border:"1px solid "+lvl.color+"22" }}>
                      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:16 }}>
                        <span style={{ fontSize:22 }}>{lvl.emoji}</span>
                        <div>
                          <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:800 }}>{emp.name}</div>
                          <div style={{ color:lvl.color,fontSize:12,fontWeight:600 }}>{lvl.name} Level — {emp.overall} points</div>
                        </div>
                      </div>
                      <div style={{ display:"grid",gridTemplateColumns:"repeat("+Math.min(catDetails.length,4)+",1fr)",gap:12 }}>
                        {catDetails.map(function(cat) {
                          var score = emp[cat.key] ? emp[cat.key].score : null;
                          var catLvl = score !== null ? getLevel(score) : null;
                          return (
                            <div key={cat.key} style={{ background:"#1A1D23",borderRadius:10,padding:14,border:"1px solid "+cat.color+"15" }}>
                              <div style={{ display:"flex",alignItems:"center",gap:6,marginBottom:10 }}>
                                <span style={{ fontSize:16 }}>{cat.icon}</span>
                                <div style={{ color:cat.color,fontSize:11,fontWeight:700 }}>{cat.label}</div>
                              </div>
                              {score !== null && (
                                <div style={{ marginBottom:10 }}>
                                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:3 }}>
                                    <span style={{ color:catLvl.color,fontSize:18,fontWeight:800 }}>{score}</span>
                                    <span style={{ color:catLvl.color,fontSize:10,fontWeight:600 }}>{catLvl.name}</span>
                                  </div>
                                  <div style={{ background:"#12141A",borderRadius:4,height:5,overflow:"hidden" }}>
                                    <div style={{ width:score+"%",height:"100%",background:catLvl.color,borderRadius:4 }} />
                                  </div>
                                </div>
                              )}
                              {cat.details.map(function(d, di) {
                                return (
                                  <div key={di} style={{ display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:di < cat.details.length - 1 ? "1px solid #1E2028" : "none" }}>
                                    <span style={{ color:"#8B8F98",fontSize:10 }}>{d.label}</span>
                                    <span style={{ color:d.warn ? "#F87171" : d.highlight ? "#F0F1F3" : "#C8CAD0",fontSize:d.highlight ? 12 : 11,fontWeight:d.highlight ? 700 : 600 }}>{d.value}{d.suffix || ""}</span>
                                  </div>
                                );
                              })}
                              {cat.tips && cat.tips.length > 0 && (
                                <div style={{ marginTop:10,padding:"8px 10px",borderRadius:6,background:"#0F1117",border:"1px solid #2A2D35" }}>
                                  <div style={{ color:"#FBBF24",fontSize:8,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4 }}>{"\uD83D\uDCA1"} Coaching</div>
                                  {cat.tips.map(function(tip, ti) {
                                    var tipColor = tip.priority === "high" ? "#F87171" : tip.priority === "good" ? "#4ADE80" : "#FBBF24";
                                    return (
                                      <div key={ti} style={{ display:"flex",alignItems:"flex-start",gap:5,marginBottom:ti < cat.tips.length - 1 ? 4 : 0 }}>
                                        <span style={{ color:tipColor,fontSize:8,marginTop:2 }}>{tip.priority === "good" ? "\u2713" : "\u25CF"}</span>
                                        <span style={{ color:"#C8CAD0",fontSize:9,lineHeight:1.4 }}>{tip.text}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
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
                  var arrived=a.did_arrive&&(a.did_arrive.toLowerCase()==="yes"||a.did_arrive.toLowerCase()==="converted");var noShow=a.did_arrive&&(a.did_arrive.toLowerCase()==="no"||a.did_arrive.toLowerCase().includes("no"));var isConverted=a.did_arrive&&a.did_arrive.toLowerCase()==="converted";var statusColor=isConverted?"#4ADE80":arrived?"#FBBF24":noShow?"#F87171":"#FBBF24";var statusText=isConverted?"Converted":arrived?"Arrived":noShow?"No-Show":"Pending";
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
            {/* Period selector */}
            <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:14 }}>
              <span style={{ color:"#6B6F78",fontSize:11 }}>{"\uD83D\uDCC5"}</span>
              <select value={selectedPeriod} onChange={function(e){setSelectedPeriod(e.target.value);}}
                style={{ padding:"6px 12px",borderRadius:6,border:"1px solid #2A2D35",background:"#12141A",color:selectedPeriod===currentPeriod?"#8B8F98":"#FBBF24",fontSize:12,fontWeight:600,cursor:"pointer",outline:"none" }}>
                {periodOptions.map(function(p){
                  return <option key={p.value} value={p.value}>{p.label}</option>;
                })}
              </select>
              {selectedPeriod !== currentPeriod && (
                <button onClick={function(){setSelectedPeriod(currentPeriod);}}
                  style={{ padding:"4px 10px",borderRadius:5,border:"1px solid #7B2FFF33",background:"#7B2FFF11",color:"#7B2FFF",fontSize:10,fontWeight:600,cursor:"pointer" }}>
                  Current
                </button>
              )}
              {selectedPeriod !== currentPeriod && (
                <span style={{ color:"#FBBF24",fontSize:10,fontWeight:600 }}>
                  {"\uD83D\uDCC6 Viewing: " + periodOptions.find(function(p){return p.value===selectedPeriod;}).label}
                </span>
              )}
            </div>

            {/* Stats row */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:14 }}>
              <div style={{ background:"#1A1D23",borderRadius:10,padding:"14px 16px",borderLeft:"3px solid #4ADE80" }}>
                <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Converted / Day</div>
                <div style={{ color:"#4ADE80",fontSize:28,fontWeight:800 }}>{convertedStats.perDay.toFixed(1)}</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{convertedStats.total} converted in {convertedStats.activeDays} days</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:10,padding:"14px 16px",borderLeft:"3px solid #7B2FFF" }}>
                <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Conversion Rate</div>
                <div style={{ color:convertedStats.conversionRate>=60?"#4ADE80":convertedStats.conversionRate>=40?"#FBBF24":"#F87171",fontSize:28,fontWeight:800 }}>{convertedStats.conversionRate.toFixed(0)}%</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{convertedStats.total} of {convertedStats.arrivedTotal} who arrived</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:10,padding:"14px 16px",borderLeft:"3px solid #FBBF24" }}>
                <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Show Rate</div>
                <div style={{ color:as.showRate>=65?"#4ADE80":as.showRate>=50?"#FBBF24":"#F87171",fontSize:28,fontWeight:800 }}>{as.showRate||0}%</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{as.arrived||0} of {as.total||0} showed</div>
              </div>
              <div style={{ background:"#1A1D23",borderRadius:10,padding:"14px 16px",borderLeft:"3px solid #F87171" }}>
                <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>No-Shows</div>
                <div style={{ color:"#F87171",fontSize:28,fontWeight:800 }}>{as.noShow||0}</div>
                <div style={{ color:"#6B6F78",fontSize:10 }}>{as.needFollowUp||0} need follow-up</div>
              </div>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20 }}>
              {[{l:"Total Appts",v:bookingRate.appts,c:"#7B2FFF"},{l:"Booking Rate",v:bookingRate.rate+"%",c:bookingRate.rate>=15?"#4ADE80":bookingRate.rate>=8?"#FBBF24":"#FF2D95",sub:bookingRate.appts+" of "+bookingRate.calls+" calls"},{l:"Follow-Ups",v:as.needFollowUp||0,c:as.needFollowUp>0?"#FBBF24":"#4ADE80"},{l:"Pending",v:as.pending||0,c:"#00D4FF"}].map(function(s,i) {
                return <div key={i} style={{ background:"#1A1D23",borderRadius:10,padding:"12px 14px",borderLeft:"3px solid "+s.c }}>
                  <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>{s.l}</div>
                  <div style={{ color:s.c,fontSize:22,fontWeight:700 }}>{s.v}</div>
                  {s.sub && <div style={{ color:"#6B6F78",fontSize:9 }}>{s.sub}</div>}
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
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Customer Name *</label><input value={form.customer_name} onChange={function(e){setForm(Object.assign({},form,{customer_name:e.target.value}));}} style={inputStyle} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Phone</label><input value={form.customer_phone} onChange={function(e){setForm(Object.assign({},form,{customer_phone:e.target.value}));}} onBlur={function(e){checkPhone(e.target.value);checkRepeatCustomer(e.target.value);}} placeholder="(317) 555-1234" style={inputStyle} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Scheduled By</label><input list="emp-list" value={form.scheduled_by} onChange={function(e){setForm(Object.assign({},form,{scheduled_by:e.target.value}));}} style={inputStyle} /><datalist id="emp-list">{rosterFiltered.map(function(r){return <option key={r.name} value={r.name}/>;})}</datalist></div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10 }}>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Date</label><input type="date" value={form.date_of_appt} onChange={function(e){setForm(Object.assign({},form,{date_of_appt:e.target.value}));}} style={inputStyle} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Time</label><input type="time" value={form.appt_time} onChange={function(e){setForm(Object.assign({},form,{appt_time:e.target.value}));}} style={inputStyle} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Price</label><input value={form.price_quoted} onChange={function(e){setForm(Object.assign({},form,{price_quoted:e.target.value}));}} placeholder="$150" style={inputStyle} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Arrived?</label><select value={form.did_arrive} onChange={function(e){setForm(Object.assign({},form,{did_arrive:e.target.value}));}} style={inputStyle}><option value="">Pending</option><option value="Converted">Converted (Arrived + Sale)</option><option value="Yes">Arrived (No Sale)</option><option value="No">No-Show</option><option value="No/VM">No/VM</option><option value="Rescheduled">Rescheduled</option></select></div>
                </div>
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12 }}>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Reason / Quote</label><input value={form.reason} onChange={function(e){setForm(Object.assign({},form,{reason:e.target.value}));}} style={inputStyle} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:2 }}>Notes</label><input value={form.notes} onChange={function(e){setForm(Object.assign({},form,{notes:e.target.value}));}} style={inputStyle} /></div>
                </div>
                {matchedCall && <div style={{ padding:10,borderRadius:6,background:"#00D4FF08",border:"1px solid #00D4FF33",marginBottom:8,fontSize:11,color:"#C8CAD0" }}>{"\uD83D\uDCDE"} <strong style={{color:"#00D4FF"}}>Call match:</strong> {matchedCall.employee} scored {parseFloat(matchedCall.score||0).toFixed(1)}/4 | {matchedCall.appt_offered?"\u2705":"\u274C"} Appt | {matchedCall.discount_mentioned?"\u2705":"\u274C"} Discount</div>}
                {repeatInfo && <div style={{ padding:10,borderRadius:6,background:repeatInfo.noShow>0?"#FBBF2408":"#4ADE8008",border:"1px solid "+(repeatInfo.noShow>0?"#FBBF2433":"#4ADE8033"),marginBottom:8,fontSize:11,color:"#C8CAD0" }}>{"\uD83D\uDD01"} <strong style={{color:repeatInfo.noShow>0?"#FBBF24":"#4ADE80"}}>Repeat customer:</strong> {repeatInfo.total} prev appts, {repeatInfo.arrived} arrived, {repeatInfo.noShow} no-shows{repeatInfo.noShow>0?" — \u26A0\uFE0F confirm day-of":""}</div>}
                <button onClick={saveAppointment} style={{ padding:"8px 20px",borderRadius:6,border:"none",background:"#7B2FFF",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>{editingId?"Save":"Add Appointment"}</button>
              </div>
            )}

            {/* Appointment list */}
            <div style={{ background:"#1A1D23",borderRadius:12,overflow:"hidden" }}>
              {apptView === "followup" ? (
                followUps.length > 0 ? (
                  <div>
                    {/* Pending Verification section */}
                    {(function() {
                      var pendingVerify = followUps.filter(function(a) { return (a.follow_up_notes || "").startsWith("pending_verification"); });
                      var needsCallback = followUps.filter(function(a) { return !(a.follow_up_notes || "").startsWith("pending_verification"); });
                      return (
                        <div>
                          {pendingVerify.length > 0 && (
                            <div>
                              <div style={{ padding:"10px 18px",background:"#FBBF2408",borderBottom:"1px solid #FBBF2422" }}>
                                <span style={{ color:"#FBBF24",fontSize:10,fontWeight:700 }}>{"\u23F3"} PENDING VERIFICATION ({pendingVerify.length})</span>
                                <span style={{ color:"#6B6F78",fontSize:9,marginLeft:8 }}>Waiting for Dialpad call confirmation</span>
                              </div>
                              {pendingVerify.map(function(a) {
                                var parts = (a.follow_up_notes || "").split("|");
                                var markedNote = parts[1] || "";
                                var markedTime = parts[2] ? new Date(parts[2]).toLocaleDateString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "";
                                return <div key={a.id} style={{ padding:"12px 18px",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                                  <div>
                                    <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{a.customer_name} <span style={{ color:"#6B6F78",fontSize:11 }}>{fmtPhone(a.customer_phone)}</span></div>
                                    <div style={{ color:"#FBBF24",fontSize:10 }}>No-show {a.date_of_appt} — {a.reason}</div>
                                    {markedTime && <div style={{ color:"#6B6F78",fontSize:9,marginTop:2 }}>Marked: {markedTime}{markedNote ? " — " + markedNote : ""}</div>}
                                  </div>
                                  <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                                    <span style={{ padding:"4px 10px",borderRadius:4,background:"#FBBF2418",color:"#FBBF24",fontSize:9,fontWeight:700 }}>{"\u23F3"} Verifying...</span>
                                    <button onClick={function(){verifyFollowUps();}} style={{ padding:"4px 8px",borderRadius:4,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:8,cursor:"pointer" }}>Recheck</button>
                                  </div>
                                </div>;
                              })}
                            </div>
                          )}
                          {needsCallback.length > 0 && (
                            <div>
                              {pendingVerify.length > 0 && (
                                <div style={{ padding:"10px 18px",background:"#F8717108",borderBottom:"1px solid #F8717122" }}>
                                  <span style={{ color:"#F87171",fontSize:10,fontWeight:700 }}>{"\uD83D\uDCDE"} NEEDS CALLBACK ({needsCallback.length})</span>
                                </div>
                              )}
                              {needsCallback.map(function(a) {
                                return <div key={a.id} style={{ padding:"12px 18px",borderBottom:"1px solid #1E2028",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                                  <div>
                                    <div style={{ color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{a.customer_name} <span style={{ color:"#6B6F78",fontSize:11 }}>{fmtPhone(a.customer_phone)}</span></div>
                                    <div style={{ color:"#F87171",fontSize:10 }}>No-show {a.date_of_appt} — {a.reason}</div>
                                  </div>
                                  <button onClick={function(){var n=prompt("Follow-up notes (optional):");if(n!==null)markFollowUpDone(a.id,n);}} style={{ padding:"5px 12px",borderRadius:4,border:"none",background:"#4ADE80",color:"#000",fontSize:10,fontWeight:700,cursor:"pointer" }}>Called Back</button>
                                </div>;
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ) : <div style={{ padding:30,textAlign:"center",color:"#4ADE80",fontSize:12 }}>{"\u2705"} All follow-ups done!</div>
              ) : (
                filteredAppointments.length > 0 ? filteredAppointments.map(function(a) {
                  var arrived=a.did_arrive&&(a.did_arrive.toLowerCase()==="yes"||a.did_arrive.toLowerCase()==="converted");var noShow=a.did_arrive&&(a.did_arrive.toLowerCase()==="no"||a.did_arrive.toLowerCase().includes("no"));var isConverted=a.did_arrive&&a.did_arrive.toLowerCase()==="converted";var pending=!a.did_arrive||a.did_arrive==="";var sc=isConverted?"#4ADE80":arrived?"#FBBF24":noShow?"#F87171":"#FBBF24";var st=isConverted?"Converted":arrived?"Arrived":noShow?"No-Show":a.did_arrive==="Rescheduled"?"Resched":"Pending";
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

        {/* ═══ REVIEWS & SEO SECTION ═══ */}
        {section === "reviews" && (
          <div>
            {/* Header with Google link */}
            <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
              <div style={{ color:"#F0F1F3",fontSize:18,fontWeight:800 }}>{"\u2B50"} Google Reviews & SEO — {storeName}</div>
              <div style={{ display:"flex",gap:8 }}>
                <label style={{ padding:"8px 16px",borderRadius:8,border:"none",background:gbpImporting?"#6B6F78":"linear-gradient(135deg,#4ADE80,#00D4FF)",color:gbpImporting?"#FFF":"#000",fontSize:12,fontWeight:700,cursor:gbpImporting?"wait":"pointer",display:"flex",alignItems:"center",gap:6 }}>
                  {gbpImporting ? "Extracting..." : "\uD83D\uDCE4 Import PDF"}
                  <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleGbpImport} disabled={gbpImporting} style={{ display:"none" }} />
                </label>
                <button onClick={function(){ setShowGbpForm(!showGbpForm); if (!showGbpForm) setGbpForm(emptyGbpForm); }}
                  style={{ padding:"8px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>
                  {showGbpForm ? "Cancel" : "+ Manual Entry"}
                </button>
                {GOOGLE_LINKS[store] && (
                  <a href={GOOGLE_LINKS[store]} target="_blank" rel="noopener noreferrer"
                    style={{ padding:"8px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#FBBF24,#FB923C)",color:"#000",fontSize:12,fontWeight:700,textDecoration:"none",display:"flex",alignItems:"center",gap:6 }}>
                    {"\u2B50"} Open Google Listing
                  </a>
                )}
              </div>
            </div>

            {msg && <div style={{ padding:"8px 14px",borderRadius:8,marginBottom:12,background:msg.type==="success"?"#4ADE8012":"#F8717112",border:"1px solid "+(msg.type==="success"?"#4ADE8033":"#F8717133"),color:msg.type==="success"?"#4ADE80":"#F87171",fontSize:12 }}>{msg.text}</div>}

            {/* Sub-tabs */}
            <div style={{ display:"flex",gap:4,marginBottom:20 }}>
              {[{id:"performance",label:"\uD83D\uDCCA Performance"},{id:"keywords",label:"\uD83D\uDD0D Keywords"},{id:"commission",label:"\uD83D\uDCB0 Commission"},{id:"reports",label:"\uD83D\uDCC4 Report History"}].map(function(t) {
                return <button key={t.id} onClick={function(){setReviewSubTab(t.id);}} style={{ padding:"8px 14px",borderRadius:6,border:"none",cursor:"pointer",background:reviewSubTab===t.id?"#FBBF2422":"#1A1D23",color:reviewSubTab===t.id?"#FBBF24":"#8B8F98",fontSize:12,fontWeight:600 }}>{t.label}</button>;
              })}
            </div>

            {/* ═══ GBP REPORT ENTRY FORM ═══ */}
            {showGbpForm && (
              <div style={{ background:"#1A1D23",borderRadius:14,padding:24,marginBottom:20,border:"1px solid #7B2FFF33" }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16 }}>
                  <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700 }}>{"\uD83D\uDCCB"} {gbpForm.period_start ? "Review Extracted Data" : "Enter Weekly GBP Report"}</div>
                  {gbpForm.period_start && <div style={{ color:"#4ADE80",fontSize:11,fontWeight:600 }}>{"\u2705"} Auto-filled from PDF — verify and save</div>}
                </div>

                {/* Period */}
                <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16 }}>
                  <div><label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Report Start Date *</label><input type="date" value={gbpForm.period_start} onChange={function(e){setGbpForm(Object.assign({},gbpForm,{period_start:e.target.value}));}} style={inputStyle} /></div>
                  <div><label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Report End Date *</label><input type="date" value={gbpForm.period_end} onChange={function(e){setGbpForm(Object.assign({},gbpForm,{period_end:e.target.value}));}} style={inputStyle} /></div>
                </div>

                {/* Statistics */}
                <div style={{ color:"#FBBF24",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8 }}>Statistics</div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16 }}>
                  {[{k:"customer_calls",l:"Customer Calls"},{k:"profile_views",l:"Profile Views"},{k:"website_visits",l:"Website Visits"},{k:"direction_requests",l:"Direction Requests"},{k:"competitors_outranked",l:"Competitors Outranked"}].map(function(f) {
                    return <div key={f.k}><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:3 }}>{f.l}</label><input type="number" value={gbpForm[f.k]} onChange={function(e){var u={};u[f.k]=e.target.value;setGbpForm(Object.assign({},gbpForm,u));}} placeholder="0" style={inputStyleCenter} /></div>;
                  })}
                </div>

                {/* Content Activity */}
                <div style={{ color:"#00D4FF",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:8 }}>Content Activity</div>
                <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16 }}>
                  {[{k:"received_reviews",l:"New Reviews"},{k:"posts_published",l:"Posts Published"},{k:"photos_published",l:"Photos Published"},{k:"review_responses",l:"Review Responses"},{k:"offers_published",l:"Offers Published"}].map(function(f) {
                    return <div key={f.k}><label style={{ color:"#8B8F98",fontSize:9,display:"block",marginBottom:3 }}>{f.l}</label><input type="number" value={gbpForm[f.k]} onChange={function(e){var u={};u[f.k]=e.target.value;setGbpForm(Object.assign({},gbpForm,u));}} placeholder="0" style={inputStyleCenter} /></div>;
                  })}
                </div>

                {/* Keywords */}
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                  <div style={{ color:"#4ADE80",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em" }}>Keyword Rankings</div>
                  <button onClick={addGbpKeyword} style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #4ADE8033",background:"transparent",color:"#4ADE80",fontSize:10,cursor:"pointer",fontWeight:600 }}>+ Keyword</button>
                </div>
                {gbpForm.keywords.map(function(kw, ki) {
                  return <div key={ki} style={{ display:"grid",gridTemplateColumns:"2fr 1fr 1fr auto",gap:8,marginBottom:6 }}>
                    <input value={kw.keyword} onChange={function(e){updateGbpKeyword(ki,"keyword",e.target.value);}} placeholder="e.g. phone repair bloomington" style={inputStyle} />
                    <input type="number" value={kw.position} onChange={function(e){updateGbpKeyword(ki,"position",e.target.value);}} placeholder="Position" style={Object.assign({},inputStyle,{textAlign:"center"})} />
                    <input type="number" value={kw.position_change} onChange={function(e){updateGbpKeyword(ki,"position_change",e.target.value);}} placeholder="+/- Change" style={Object.assign({},inputStyle,{textAlign:"center"})} />
                    <button onClick={function(){removeGbpKeyword(ki);}} style={{ padding:"6px 8px",borderRadius:4,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>{"\u2715"}</button>
                  </div>;
                })}

                {/* Competitors */}
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:16,marginBottom:8 }}>
                  <div style={{ color:"#FF2D95",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em" }}>Competitor Activity</div>
                  <button onClick={addGbpCompetitor} style={{ padding:"4px 10px",borderRadius:4,border:"1px solid #FF2D9533",background:"transparent",color:"#FF2D95",fontSize:10,cursor:"pointer",fontWeight:600 }}>+ Competitor</button>
                </div>
                {gbpForm.competitors.map(function(comp, ci) {
                  return <div key={ci} style={{ background:"#12141A",borderRadius:8,padding:12,marginBottom:8,border:"1px solid #1E2028" }}>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginBottom:6 }}>
                      <input value={comp.name} onChange={function(e){updateGbpCompetitor(ci,"name",e.target.value);}} placeholder="Competitor name" style={inputStyle} />
                      <button onClick={function(){removeGbpCompetitor(ci);}} style={{ padding:"6px 8px",borderRadius:4,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:10,cursor:"pointer" }}>{"\u2715"}</button>
                    </div>
                    <input value={comp.actions} onChange={function(e){updateGbpCompetitor(ci,"actions",e.target.value);}} placeholder="Actions taken (e.g. Increased reviews from 560 to 565)" style={Object.assign({},inputStyle,{marginBottom:4})} />
                    <input value={comp.impact} onChange={function(e){updateGbpCompetitor(ci,"impact",e.target.value);}} placeholder="Impact (e.g. Moved from position 3 to 2)" style={inputStyle} />
                  </div>;
                })}

                {/* Notes + Save */}
                <div style={{ marginTop:12 }}>
                  <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Notes</label>
                  <input value={gbpForm.notes} onChange={function(e){setGbpForm(Object.assign({},gbpForm,{notes:e.target.value}));}} placeholder="Optional notes about this report period..." style={Object.assign({},inputStyle,{marginBottom:12})} />
                </div>
                <button onClick={saveGbpReport} disabled={gbpSaving}
                  style={{ padding:"10px 24px",borderRadius:8,border:"none",background:gbpSaving?"#6B6F78":"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:13,fontWeight:700,cursor:gbpSaving?"wait":"pointer" }}>
                  {gbpSaving ? "Saving..." : "Save GBP Report"}
                </button>
              </div>
            )}

            {/* ═══ PERFORMANCE SUB-TAB ═══ */}
            {reviewSubTab === "performance" && (
              <div>
                {/* GBP Stats Cards */}
                {gbpReport ? (
                  <div>
                    <div style={{ color:"#8B8F98",fontSize:11,marginBottom:10 }}>
                      Latest report: {new Date(gbpReport.period_start + "T12:00:00").toLocaleDateString([], {month:"short",day:"numeric"})} — {new Date(gbpReport.period_end + "T12:00:00").toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"})}
                    </div>
                    <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14,marginBottom:24 }}>
                      {[
                        {l:"Customer Calls",v:gbpReport.customer_calls||0,c:"#FBBF24",icon:"\uD83D\uDCDE",trend:gbpTrends?gbpTrends.calls:null},
                        {l:"Profile Views",v:gbpReport.profile_views||0,c:"#7B2FFF",icon:"\uD83D\uDC41",trend:gbpTrends?gbpTrends.views:null},
                        {l:"Website Visits",v:gbpReport.website_visits||0,c:"#00D4FF",icon:"\uD83C\uDF10",trend:gbpTrends?gbpTrends.visits:null},
                        {l:"Direction Requests",v:gbpReport.direction_requests||0,c:"#4ADE80",icon:"\uD83D\uDDFA\uFE0F",trend:gbpTrends?gbpTrends.directions:null},
                        {l:"New Reviews",v:gbpReport.received_reviews||0,c:"#FF2D95",icon:"\u2B50"},
                      ].map(function(s,i) {
                        return <div key={i} style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid "+s.c }}>
                          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                            <div>
                              <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>{s.l}</div>
                              <div style={{ color:s.c,fontSize:28,fontWeight:700 }}>{s.v.toLocaleString()}</div>
                            </div>
                            <span style={{ fontSize:18 }}>{s.icon}</span>
                          </div>
                          {s.trend && s.trend.length >= 2 && <div style={{ marginTop:6 }}><Sparkline data={s.trend} color={s.c} width={100} height={20} /></div>}
                        </div>;
                      })}
                    </div>

                    {/* Content activity */}
                    <div style={{ background:"#1A1D23",borderRadius:14,padding:20,marginBottom:20 }}>
                      <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>{"\uD83D\uDCC4"} Content Activity This Week</div>
                      <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12 }}>
                        {[
                          {l:"Posts Published",v:gbpReport.posts_published||0,c:"#7B2FFF"},
                          {l:"Photos Published",v:gbpReport.photos_published||0,c:"#00D4FF"},
                          {l:"Review Responses",v:gbpReport.review_responses||0,c:"#4ADE80"},
                          {l:"Offers Published",v:gbpReport.offers_published||0,c:"#FBBF24"},
                        ].map(function(s,i) {
                          return <div key={i} style={{ background:"#12141A",borderRadius:10,padding:14,textAlign:"center" }}>
                            <div style={{ color:s.v>0?s.c:"#6B6F78",fontSize:24,fontWeight:800 }}>{s.v}</div>
                            <div style={{ color:"#8B8F98",fontSize:10 }}>{s.l}</div>
                          </div>;
                        })}
                      </div>
                    </div>

                    {/* Competitors */}
                    {gbpReport.competitors && gbpReport.competitors.length > 0 && (
                      <div style={{ background:"#1A1D23",borderRadius:14,padding:20 }}>
                        <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>{"\uD83C\uDFC1"} Competitor Activity</div>
                        {gbpReport.competitors.map(function(comp, ci) {
                          return <div key={ci} style={{ background:"#12141A",borderRadius:10,padding:14,marginBottom:ci<gbpReport.competitors.length-1?10:0,border:"1px solid #FF2D9512" }}>
                            <div style={{ color:"#FF2D95",fontSize:13,fontWeight:700,marginBottom:4 }}>{comp.name}</div>
                            {comp.actions && <div style={{ color:"#C8CAD0",fontSize:11,lineHeight:1.5,marginBottom:4 }}>{comp.actions}</div>}
                            {comp.impact && <div style={{ color:"#8B8F98",fontSize:10,fontStyle:"italic" }}>{comp.impact}</div>}
                          </div>;
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ background:"#1A1D23",borderRadius:14,padding:40,textAlign:"center" }}>
                    <div style={{ fontSize:32,marginBottom:8 }}>{"\uD83D\uDCCA"}</div>
                    <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700,marginBottom:6 }}>No GBP Reports Yet</div>
                    <div style={{ color:"#8B8F98",fontSize:12,marginBottom:16 }}>Import a PDF report or enter data manually to start tracking</div>
                    <div style={{ display:"flex",gap:8,justifyContent:"center" }}>
                      <label style={{ padding:"8px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4ADE80,#00D4FF)",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer" }}>
                        {"\uD83D\uDCE4"} Import PDF
                        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleGbpImport} disabled={gbpImporting} style={{ display:"none" }} />
                      </label>
                      <button onClick={function(){ setShowGbpForm(true); }} style={{ padding:"8px 16px",borderRadius:8,border:"1px solid #7B2FFF33",background:"transparent",color:"#7B2FFF",fontSize:12,fontWeight:700,cursor:"pointer" }}>+ Manual Entry</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ═══ KEYWORDS SUB-TAB ═══ */}
            {reviewSubTab === "keywords" && (
              <div>
                {gbpReport && gbpReport.keywords && gbpReport.keywords.length > 0 ? (
                  <div>
                    <div style={{ color:"#8B8F98",fontSize:11,marginBottom:12 }}>
                      Rankings from {new Date(gbpReport.period_start + "T12:00:00").toLocaleDateString([], {month:"short",day:"numeric"})} — {new Date(gbpReport.period_end + "T12:00:00").toLocaleDateString([], {month:"short",day:"numeric",year:"numeric"})}
                    </div>
                    <div style={{ background:"#1A1D23",borderRadius:14,overflow:"hidden",marginBottom:20 }}>
                      <table style={{ width:"100%",borderCollapse:"collapse" }}>
                        <thead>
                          <tr style={{ borderBottom:"1px solid #2A2D35" }}>
                            <th style={{ padding:"12px 18px",textAlign:"left",color:"#8B8F98",fontSize:10,textTransform:"uppercase",fontWeight:700 }}>Keyword</th>
                            <th style={{ padding:"12px 18px",textAlign:"center",color:"#8B8F98",fontSize:10,textTransform:"uppercase",fontWeight:700 }}>Position</th>
                            <th style={{ padding:"12px 18px",textAlign:"center",color:"#8B8F98",fontSize:10,textTransform:"uppercase",fontWeight:700 }}>Change</th>
                            <th style={{ padding:"12px 18px",textAlign:"center",color:"#8B8F98",fontSize:10,textTransform:"uppercase",fontWeight:700 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gbpReport.keywords.sort(function(a,b){return (parseInt(a.position)||99)-(parseInt(b.position)||99);}).map(function(kw, ki) {
                            var pos = parseInt(kw.position) || 0;
                            var change = parseInt(kw.position_change) || 0;
                            var posColor = pos <= 1 ? "#4ADE80" : pos <= 3 ? "#FBBF24" : pos <= 5 ? "#FB923C" : "#F87171";
                            var changeColor = change > 0 ? "#4ADE80" : change < 0 ? "#F87171" : "#6B6F78";
                            var changeText = change > 0 ? "+"+change : change < 0 ? String(change) : "—";
                            return (
                              <tr key={ki} style={{ borderBottom:"1px solid #1E2028" }}>
                                <td style={{ padding:"12px 18px",color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{kw.keyword}</td>
                                <td style={{ padding:"12px 18px",textAlign:"center" }}>
                                  <span style={{ display:"inline-block",background:posColor+"18",color:posColor,padding:"3px 10px",borderRadius:6,fontSize:14,fontWeight:800,minWidth:28 }}>#{pos}</span>
                                </td>
                                <td style={{ padding:"12px 18px",textAlign:"center",color:changeColor,fontSize:13,fontWeight:700 }}>{changeText}</td>
                                <td style={{ padding:"12px 18px",textAlign:"center" }}>
                                  {pos === 1 && <span style={{ color:"#4ADE80",fontSize:11,fontWeight:700 }}>{"\uD83D\uDC51"} #1</span>}
                                  {pos > 1 && pos <= 3 && <span style={{ color:"#FBBF24",fontSize:11 }}>Top 3</span>}
                                  {pos > 3 && pos <= 5 && <span style={{ color:"#FB923C",fontSize:11 }}>Top 5</span>}
                                  {pos > 5 && <span style={{ color:"#F87171",fontSize:11 }}>Needs work</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Keyword history comparison across reports */}
                    {gbpHistory && gbpHistory.length >= 2 && (
                      <div style={{ background:"#1A1D23",borderRadius:14,padding:20 }}>
                        <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>{"\uD83D\uDCC8"} Keyword Trends Over Time</div>
                        <div style={{ color:"#8B8F98",fontSize:11,marginBottom:12 }}>Position tracking across report periods (lower is better)</div>
                        {(function() {
                          // Collect all unique keywords across history
                          var allKw = {};
                          gbpHistory.forEach(function(rpt) {
                            (rpt.keywords || []).forEach(function(kw) {
                              if (kw.keyword && !allKw[kw.keyword]) allKw[kw.keyword] = [];
                            });
                          });
                          // Fill in position data per period
                          var sortedHistory = gbpHistory.slice().sort(function(a,b){return a.period_start > b.period_start ? 1 : -1;});
                          Object.keys(allKw).forEach(function(kwName) {
                            sortedHistory.forEach(function(rpt) {
                              var found = (rpt.keywords || []).find(function(k){return k.keyword === kwName;});
                              allKw[kwName].push(found ? (parseInt(found.position) || null) : null);
                            });
                          });
                          var kwColors = ["#FBBF24","#7B2FFF","#00D4FF","#4ADE80","#FF2D95","#FB923C","#F87171","#E0B0FF"];
                          return Object.keys(allKw).map(function(kwName, ki) {
                            var positions = allKw[kwName];
                            var color = kwColors[ki % kwColors.length];
                            var latest = null; var prev = null;
                            for (var i = positions.length - 1; i >= 0; i--) { if (positions[i] !== null) { if (latest === null) latest = positions[i]; else if (prev === null) prev = positions[i]; } }
                            var delta = (prev !== null && latest !== null) ? prev - latest : 0; // positive = improved
                            return (
                              <div key={kwName} style={{ display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:ki<Object.keys(allKw).length-1?"1px solid #1E2028":"none" }}>
                                <div style={{ flex:1,color:"#C8CAD0",fontSize:12 }}>{kwName}</div>
                                <div style={{ display:"flex",gap:4 }}>
                                  {positions.map(function(p, pi) {
                                    return <div key={pi} style={{ width:28,height:28,borderRadius:6,background:p!==null?(p<=3?color+"22":"#12141A"):"#12141A",display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid "+(p!==null?color+"33":"#1E2028") }}>
                                      <span style={{ color:p!==null?color:"#3A3D45",fontSize:10,fontWeight:700 }}>{p!==null?p:"—"}</span>
                                    </div>;
                                  })}
                                </div>
                                <div style={{ width:50,textAlign:"right",color:delta>0?"#4ADE80":delta<0?"#F87171":"#6B6F78",fontSize:11,fontWeight:700 }}>
                                  {delta > 0 ? "\u2191"+delta : delta < 0 ? "\u2193"+Math.abs(delta) : "—"}
                                </div>
                              </div>
                            );
                          });
                        })()}
                        <div style={{ display:"flex",gap:8,marginTop:10,color:"#6B6F78",fontSize:9 }}>
                          {gbpHistory.slice().sort(function(a,b){return a.period_start > b.period_start ? 1 : -1;}).map(function(rpt, ri) {
                            return <div key={ri} style={{ flex:0,minWidth:28,textAlign:"center" }}>{new Date(rpt.period_start+"T12:00:00").toLocaleDateString([],{month:"numeric",day:"numeric"})}</div>;
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ background:"#1A1D23",borderRadius:14,padding:40,textAlign:"center" }}>
                    <div style={{ fontSize:32,marginBottom:8 }}>{"\uD83D\uDD0D"}</div>
                    <div style={{ color:"#F0F1F3",fontSize:15,fontWeight:700,marginBottom:6 }}>No Keyword Data Yet</div>
                    <div style={{ color:"#8B8F98",fontSize:12,marginBottom:16 }}>Import a GBP report PDF to start tracking SEO keyword positions</div>
                    <label style={{ padding:"8px 16px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#4ADE80,#00D4FF)",color:"#000",fontSize:12,fontWeight:700,cursor:"pointer",display:"inline-block" }}>
                      {"\uD83D\uDCE4"} Import PDF
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={handleGbpImport} disabled={gbpImporting} style={{ display:"none" }} />
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* ═══ COMMISSION SUB-TAB ═══ */}
            {reviewSubTab === "commission" && (
              <div>
                {/* Bonus summary cards */}
                <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14,marginBottom:24 }}>
                  <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #FBBF24" }}>
                    <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Total Reviews</div>
                    <div style={{ color:reviewCalc.hitMinimum?"#4ADE80":"#F87171",fontSize:28,fontWeight:700 }}>{reviewCalc.total}</div>
                    <div style={{ color:"#6B6F78",fontSize:10 }}>{reviewCalc.hitMinimum ? "\u2705 Minimum met" : (10 - reviewCalc.total) + " more to hit minimum"}</div>
                  </div>
                  <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #7B2FFF" }}>
                    <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Photo Reviews</div>
                    <div style={{ color:"#7B2FFF",fontSize:28,fontWeight:700 }}>{reviewCalc.photos}</div>
                    <div style={{ color:"#6B6F78",fontSize:10 }}>$5 each per employee</div>
                  </div>
                  <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #00D4FF" }}>
                    <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Bonus Reviews</div>
                    <div style={{ color:"#00D4FF",fontSize:28,fontWeight:700 }}>{reviewCalc.bonusReviews}</div>
                    <div style={{ color:"#6B6F78",fontSize:10 }}>Reviews above 10 minimum</div>
                  </div>
                  <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #4ADE80" }}>
                    <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Per Employee Bonus</div>
                    <div style={{ color:"#4ADE80",fontSize:28,fontWeight:700 }}>{"$" + reviewCalc.bonusPerEmployee}</div>
                    <div style={{ color:"#6B6F78",fontSize:10 }}>{reviewCalc.bonusReviews > 0 ? reviewCalc.bonusReviews + " bonus x $5" : ""}{reviewCalc.bonusReviews > 0 && reviewCalc.photos > 0 ? " + " : ""}{reviewCalc.photos > 0 ? reviewCalc.photos + " photo x $5" : ""}{reviewCalc.bonusPerEmployee === 0 ? "No bonus yet" : ""}</div>
                  </div>
                  <div style={{ background:"#1A1D23",borderRadius:12,padding:"16px 18px",borderLeft:"3px solid #FF2D95" }}>
                    <div style={{ color:"#8B8F98",fontSize:10,textTransform:"uppercase" }}>Total Store Bonus</div>
                    <div style={{ color:"#FF2D95",fontSize:28,fontWeight:700 }}>{"$" + reviewCalc.totalBonus}</div>
                    <div style={{ color:"#6B6F78",fontSize:10 }}>{"$" + reviewCalc.bonusPerEmployee + " x " + reviewCalc.empCount + " employees"}</div>
                  </div>
                </div>

                {/* How it works */}
                <div style={{ background:"#1A1D23",borderRadius:14,padding:20,marginBottom:20,border:"1px solid #FBBF2422" }}>
                  <div style={{ color:"#FBBF24",fontSize:12,fontWeight:700,marginBottom:10 }}>{"\uD83D\uDCCB"} How Review Bonuses Work</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:16 }}>
                    <div>
                      <div style={{ color:"#C8CAD0",fontSize:12,lineHeight:1.6 }}>
                        <div style={{ marginBottom:6 }}><strong style={{ color:"#F0F1F3" }}>Minimum:</strong> 10 new reviews per store per month</div>
                        <div style={{ marginBottom:6 }}><strong style={{ color:"#4ADE80" }}>Quantity Bonus:</strong> After 10 reviews, each additional review = <strong>$5 per employee</strong></div>
                        <div><strong style={{ color:"#7B2FFF" }}>Photo Bonus:</strong> Every review with a photo = <strong>$5 per employee</strong> (regardless of total count)</div>
                      </div>
                    </div>
                    <div style={{ background:"#12141A",borderRadius:10,padding:14 }}>
                      <div style={{ color:"#8B8F98",fontSize:10,fontWeight:700,textTransform:"uppercase",marginBottom:6 }}>Example</div>
                      <div style={{ color:"#C8CAD0",fontSize:11,lineHeight:1.7 }}>
                        15 reviews (3 with photos), 4 employees:<br/>
                        Bonus reviews: 15 - 10 = <strong style={{ color:"#00D4FF" }}>5 x $5 = $25</strong><br/>
                        Photo reviews: <strong style={{ color:"#7B2FFF" }}>3 x $5 = $15</strong><br/>
                        Per employee: <strong style={{ color:"#4ADE80" }}>$40</strong><br/>
                        Total store cost: <strong style={{ color:"#FF2D95" }}>$40 x 4 = $160</strong>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Entry form */}
                <div style={{ background:"#1A1D23",borderRadius:14,padding:24,marginBottom:20 }}>
                  <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:16 }}>Update This Month's Numbers</div>
                  <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12 }}>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Total New Reviews *</label>
                      <input type="number" value={reviewForm.total_reviews} onChange={function(e){setReviewForm(Object.assign({},reviewForm,{total_reviews:e.target.value}));}}
                        placeholder="0" style={inputStyleCenter} />
                    </div>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Reviews with Photos *</label>
                      <input type="number" value={reviewForm.photo_reviews} onChange={function(e){setReviewForm(Object.assign({},reviewForm,{photo_reviews:e.target.value}));}}
                        placeholder="0" style={inputStyleCenter} />
                    </div>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Employees This Month</label>
                      <input type="number" value={reviewForm.employee_count} onChange={function(e){setReviewForm(Object.assign({},reviewForm,{employee_count:e.target.value}));}}
                        placeholder={String(storeEmployees.length || 3)} style={inputStyleCenter} />
                    </div>
                    <div>
                      <label style={{ color:"#8B8F98",fontSize:10,display:"block",marginBottom:3 }}>Notes</label>
                      <input type="text" value={reviewForm.notes} onChange={function(e){setReviewForm(Object.assign({},reviewForm,{notes:e.target.value}));}}
                        placeholder="Optional notes..." style={Object.assign({},inputStyle,{padding:"10px 12px"})} />
                    </div>
                  </div>
                  <button onClick={saveReview} disabled={reviewSaving}
                    style={{ padding:"10px 24px",borderRadius:8,border:"none",background:reviewSaving?"#6B6F78":"linear-gradient(135deg,#FBBF24,#FB923C)",color:"#000",fontSize:13,fontWeight:700,cursor:reviewSaving?"wait":"pointer" }}>
                    {reviewSaving ? "Saving..." : "Save Review Data"}
                  </button>
                </div>

                {/* Commission History */}
                {reviewData && reviewData.history && reviewData.history.length > 0 && (
                  <div style={{ background:"#1A1D23",borderRadius:14,padding:24 }}>
                    <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700,marginBottom:14 }}>Commission History</div>
                    <table style={{ width:"100%",borderCollapse:"collapse" }}>
                      <thead>
                        <tr style={{ borderBottom:"1px solid #2A2D35" }}>
                          {["Month","Reviews","Photos","Bonus Reviews","Per Employee","Total Bonus"].map(function(h,i) {
                            return <th key={i} style={{ padding:"8px 12px",textAlign:i===0?"left":"right",color:"#8B8F98",fontSize:10,textTransform:"uppercase",fontWeight:700 }}>{h}</th>;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {reviewData.history.map(function(r) {
                          var bonus = Math.max(0, r.total_reviews - 10);
                          var perEmp = (bonus * 5) + (r.photo_reviews * 5);
                          var total = perEmp * (r.employee_count || 1);
                          var hit = r.total_reviews >= 10;
                          var label = new Date(parseInt(r.period.split("-")[0]), parseInt(r.period.split("-")[1]) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
                          return (
                            <tr key={r.period} style={{ borderBottom:"1px solid #1E2028" }}>
                              <td style={{ padding:"10px 12px",color:"#F0F1F3",fontSize:13,fontWeight:600 }}>{label}</td>
                              <td style={{ padding:"10px 12px",textAlign:"right",color:hit?"#4ADE80":"#F87171",fontSize:13,fontWeight:700 }}>{r.total_reviews}</td>
                              <td style={{ padding:"10px 12px",textAlign:"right",color:"#7B2FFF",fontSize:13,fontWeight:600 }}>{r.photo_reviews}</td>
                              <td style={{ padding:"10px 12px",textAlign:"right",color:"#00D4FF",fontSize:13 }}>{bonus}</td>
                              <td style={{ padding:"10px 12px",textAlign:"right",color:"#4ADE80",fontSize:13,fontWeight:700 }}>{"$" + perEmp}</td>
                              <td style={{ padding:"10px 12px",textAlign:"right",color:"#FF2D95",fontSize:14,fontWeight:800 }}>{"$" + total}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ═══ REPORT HISTORY SUB-TAB ═══ */}
            {reviewSubTab === "reports" && (
              <div>
                {gbpHistory && gbpHistory.length > 0 ? (
                  <div style={{ background:"#1A1D23",borderRadius:14,overflow:"hidden" }}>
                    <table style={{ width:"100%",borderCollapse:"collapse" }}>
                      <thead>
                        <tr style={{ borderBottom:"1px solid #2A2D35" }}>
                          {["Period","Calls","Views","Visits","Directions","Reviews","Posts","Photos","Actions"].map(function(h,i) {
                            return <th key={i} style={{ padding:"12px 14px",textAlign:i===0?"left":i===8?"center":"right",color:"#8B8F98",fontSize:10,textTransform:"uppercase",fontWeight:700 }}>{h}</th>;
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {gbpHistory.map(function(rpt) {
                          var dateLabel = new Date(rpt.period_start+"T12:00:00").toLocaleDateString([],{month:"short",day:"numeric"}) + " — " + new Date(rpt.period_end+"T12:00:00").toLocaleDateString([],{month:"short",day:"numeric"});
                          return (
                            <tr key={rpt.id} style={{ borderBottom:"1px solid #1E2028" }}>
                              <td style={{ padding:"10px 14px",color:"#F0F1F3",fontSize:12,fontWeight:600 }}>{dateLabel}</td>
                              <td style={{ padding:"10px 14px",textAlign:"right",color:"#FBBF24",fontSize:13,fontWeight:700 }}>{rpt.customer_calls||0}</td>
                              <td style={{ padding:"10px 14px",textAlign:"right",color:"#7B2FFF",fontSize:13 }}>{rpt.profile_views||0}</td>
                              <td style={{ padding:"10px 14px",textAlign:"right",color:"#00D4FF",fontSize:13 }}>{rpt.website_visits||0}</td>
                              <td style={{ padding:"10px 14px",textAlign:"right",color:"#4ADE80",fontSize:13 }}>{rpt.direction_requests||0}</td>
                              <td style={{ padding:"10px 14px",textAlign:"right",color:"#FF2D95",fontSize:13,fontWeight:700 }}>+{rpt.received_reviews||0}</td>
                              <td style={{ padding:"10px 14px",textAlign:"right",color:"#8B8F98",fontSize:12 }}>{rpt.posts_published||0}</td>
                              <td style={{ padding:"10px 14px",textAlign:"right",color:"#8B8F98",fontSize:12 }}>{rpt.photos_published||0}</td>
                              <td style={{ padding:"10px 14px",textAlign:"center" }}>
                                <button onClick={function(){deleteGbpReport(rpt.id);}} style={{ padding:"3px 8px",borderRadius:4,border:"1px solid #F8717122",background:"transparent",color:"#F87171",fontSize:9,cursor:"pointer" }}>Del</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ background:"#1A1D23",borderRadius:14,padding:40,textAlign:"center" }}>
                    <div style={{ color:"#6B6F78",fontSize:13 }}>No GBP reports saved yet. Import a PDF or use manual entry to get started.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ═══ ANALYTICS SECTION ═══ */}
        {section === "analytics" && (
          <div>
            {/* Daily Conversion Trend */}
            {convertedStats.dailyTrend.length > 0 && (
              <div style={{ background:"#1A1D23",borderRadius:14,padding:24,marginBottom:20 }}>
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14 }}>
                  <div>
                    <div style={{ color:"#F0F1F3",fontSize:16,fontWeight:700 }}>Daily Converted Appointments</div>
                    <div style={{ color:"#6B6F78",fontSize:11 }}>Last 30 days — customers who arrived and made a purchase</div>
                  </div>
                  <div style={{ display:"flex",gap:12,alignItems:"center" }}>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ color:"#4ADE80",fontSize:22,fontWeight:800 }}>{convertedStats.perDay.toFixed(1)}</div>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Per Day Avg</div>
                    </div>
                    <div style={{ textAlign:"center" }}>
                      <div style={{ color:"#7B2FFF",fontSize:22,fontWeight:800 }}>{convertedStats.conversionRate.toFixed(0)}%</div>
                      <div style={{ color:"#8B8F98",fontSize:9,textTransform:"uppercase" }}>Conv Rate</div>
                    </div>
                  </div>
                </div>
                <div style={{ display:"flex",gap:4,alignItems:"flex-end",height:140 }}>
                  {convertedStats.dailyTrend.map(function(d, i) {
                    var maxVal = Math.max.apply(null, convertedStats.dailyTrend.map(function(x){return x.total || 1;}));
                    var barH = maxVal > 0 ? (d.total / maxVal) * 120 : 0;
                    var convH = d.total > 0 ? (d.converted / d.total) * barH : 0;
                    var arrH = d.total > 0 ? (d.arrived / d.total) * barH : 0;
                    var nsH = barH - convH - arrH;
                    var dayLabel = new Date(d.date + "T12:00:00").toLocaleDateString([], {month:"numeric",day:"numeric"});
                    var isWeekend = [0,6].indexOf(new Date(d.date + "T12:00:00").getDay()) >= 0;
                    return (
                      <div key={i} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2,minWidth:0 }}>
                        <div style={{ display:"flex",flexDirection:"column",width:"100%",maxWidth:28,borderRadius:"4px 4px 0 0",overflow:"hidden" }}>
                          {nsH > 0 && <div style={{ height:Math.max(nsH, 2),background:"#F87171",width:"100%" }} />}
                          {arrH > 0 && <div style={{ height:Math.max(arrH, 2),background:"#FBBF24",width:"100%" }} />}
                          {convH > 0 && <div style={{ height:Math.max(convH, 2),background:"#4ADE80",width:"100%" }} />}
                          {d.total === 0 && <div style={{ height:2,background:"#2A2D35",width:"100%" }} />}
                        </div>
                        <div style={{ color:isWeekend?"#3A3D45":"#6B6F78",fontSize:7,textAlign:"center",whiteSpace:"nowrap",overflow:"hidden" }}>{i % 3 === 0 || convertedStats.dailyTrend.length <= 15 ? dayLabel : ""}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:"flex",gap:16,marginTop:12,justifyContent:"center" }}>
                  <div style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:10,height:10,borderRadius:2,background:"#4ADE80" }} /><span style={{ color:"#8B8F98",fontSize:10 }}>Converted</span></div>
                  <div style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:10,height:10,borderRadius:2,background:"#FBBF24" }} /><span style={{ color:"#8B8F98",fontSize:10 }}>Arrived (No Sale)</span></div>
                  <div style={{ display:"flex",alignItems:"center",gap:4 }}><span style={{ width:10,height:10,borderRadius:2,background:"#F87171" }} /><span style={{ color:"#8B8F98",fontSize:10 }}>No-Show</span></div>
                </div>
              </div>
            )}

            {apptStats && apptStats.empStats && apptStats.empStats.length > 0 && (
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
            {apptStats && apptStats.storeStats && apptStats.storeStats.length > 0 && (
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
  return <ErrorBoundary><AuthProvider><StoreDashboard /></AuthProvider></ErrorBoundary>;
}

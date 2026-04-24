'use client';

import { useState, useEffect, useMemo } from "react";

var LEVEL_THRESHOLDS = [
  { name: "Bronze", min: 0, color: "#CD7F32", icon: "\uD83E\uDD49" },
  { name: "Silver", min: 30, color: "#C0C0C0", icon: "\uD83E\uDD48" },
  { name: "Gold", min: 50, color: "#FFD700", icon: "\uD83E\uDD47" },
  { name: "Platinum", min: 70, color: "#E0B0FF", icon: "\uD83D\uDC8E" },
  { name: "Diamond", min: 90, color: "#00D4FF", icon: "\u2B50" },
];

function getLevel(score) {
  for (var i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= LEVEL_THRESHOLDS[i].min) return LEVEL_THRESHOLDS[i];
  }
  return LEVEL_THRESHOLDS[0];
}

function getNextLevel(score) {
  for (var i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (score < LEVEL_THRESHOLDS[i].min) return LEVEL_THRESHOLDS[i];
  }
  return null;
}

function fmt(n) { return "$" + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function sc(v, g, w) { return v >= g ? "#4ADE80" : v >= w ? "#FBBF24" : "#F87171"; }

// Fuzzy name matching — handles "Alyssa Parent" vs "Parent, Alyssa" vs "Alyssa"
function matchName(empName, candidateName) {
  if (!empName || !candidateName) return false;
  var a = empName.toLowerCase().trim();
  var b = candidateName.toLowerCase().trim();
  if (a === b) return true;
  // Check if one contains the other
  if (a.includes(b) || b.includes(a)) return true;
  // Split into parts and check first/last name crossover
  var aParts = a.replace(",", " ").split(/\s+/).filter(Boolean);
  var bParts = b.replace(",", " ").split(/\s+/).filter(Boolean);
  // Check if first name matches
  if (aParts.length > 0 && bParts.length > 0 && aParts[0] === bParts[0]) return true;
  // Check "Last, First" vs "First Last"
  if (aParts.length >= 2 && bParts.length >= 2) {
    if (aParts[0] === bParts[1] && aParts[1] === bParts[0]) return true;
  }
  return false;
}

export default function MyPerformanceTab({ auth, store }) {
  var [subTab, setSubTab] = useState("dashboard");
  var [loading, setLoading] = useState(true);
  var [loadErrors, setLoadErrors] = useState({});
  var [empScore, setEmpScore] = useState(null);
  var [salesData, setSalesData] = useState(null);
  var [commConfig, setCommConfig] = useState({ rates: {}, config: {} });
  var [shifts, setShifts] = useState([]);
  var [tickets, setTickets] = useState([]);
  var [weeklyGoal, setWeeklyGoal] = useState(null);
  var [storeScore, setStoreScore] = useState(null);
  var [allEmployees, setAllEmployees] = useState([]);
  var [auditData, setAuditData] = useState([]);
  var [reviewData, setReviewData] = useState(null);
  var [coachingInsight, setCoachingInsight] = useState(null);
  var [coachingLoading, setCoachingLoading] = useState(false);
  var [coachingError, setCoachingError] = useState(null);
  var [scheduleWeek, setScheduleWeek] = useState("this");
  var [ticketPeriod, setTicketPeriod] = useState("mtd");

  var empName = auth?.userInfo?.name || "";
  var empStore = store || auth?.userInfo?.store || "";

  useEffect(function() {
    if (!empName) return;
    loadData();
  }, [empName, empStore]);

  var loadData = async function() {
    setLoading(true);
    setLoadErrors({});
    var errors = {};
    try {
      var now = new Date();
      var shiftEnd = new Date(); shiftEnd.setDate(shiftEnd.getDate() + 14); // include next 2 weeks
      var shiftEndStr = shiftEnd.toISOString().split("T")[0];
      var shiftStartDate = new Date(); shiftStartDate.setDate(shiftStartDate.getDate() - 90);
      var shiftStart = shiftStartDate.toISOString().split("T")[0];

      var results = await Promise.allSettled([
        fetch("/api/dialpad/scorecard").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/sales?action=performance").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/sales?action=commission_config").then(function(r) { return r.json(); }),
        fetch("/api/wheniwork?action=stored-shifts&start=" + shiftStart + "&end=" + shiftEndStr).then(function(r) { return r.json(); }),
        fetch("/api/dialpad/tickets?action=employee_tickets&employee=" + encodeURIComponent(empName) + "&days=90").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/weekly-goal?store=" + empStore).then(function(r) { return r.json(); }),
        fetch("/api/dialpad/audit?employee=" + encodeURIComponent(empName) + "&limit=100&daysBack=30").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/google-reviews?store=" + empStore).then(function(r) { return r.json(); }),
      ]);

      // Scorecard — find this employee with fuzzy matching
      if (results[0].status === "fulfilled" && results[0].value) {
        var scData = results[0].value;
        var emps = scData.employeeScores || [];
        setAllEmployees(emps);
        var me = emps.find(function(e) { return matchName(empName, e.name); });
        if (me) setEmpScore(me);
        if (scData.scores && scData.scores[empStore]) setStoreScore(scData.scores[empStore]);
      } else { errors.scorecard = true; }

      if (results[1].status === "fulfilled") setSalesData(results[1].value); else errors.sales = true;
      if (results[2].status === "fulfilled" && results[2].value.rates) setCommConfig(results[2].value);

      if (results[3].status === "fulfilled" && results[3].value.shifts) {
        var myShifts = results[3].value.shifts.filter(function(s) {
          return matchName(empName, s.employee_name);
        });
        setShifts(myShifts);
      } else { errors.shifts = true; }

      if (results[4].status === "fulfilled" && results[4].value.tickets) setTickets(results[4].value.tickets); else errors.tickets = true;
      if (results[5].status === "fulfilled" && results[5].value.goal) setWeeklyGoal(results[5].value.goal);
      if (results[6].status === "fulfilled" && results[6].value.audits) setAuditData(results[6].value.audits); else errors.calls = true;
      if (results[7].status === "fulfilled") setReviewData(results[7].value); else errors.reviews = true;
    } catch(e) { console.error("MyPerformanceTab load error:", e); errors.general = true; }
    setLoadErrors(errors);
    setLoading(false);
  };

  // ═══ COMPUTED DATA ═══

  // Commission calculation (mirrors SalesTab logic)
  var commission = useMemo(function() {
    if (!salesData || !empName) return null;
    var rates = commConfig.rates || {};
    var config = commConfig.config || {};
    function isEnabled(key) { return config[key] !== false; }

    var findEmp = function(arr) {
      return (arr || []).find(function(e) { return matchName(empName, e.employee); });
    };

    var phone = findEmp(salesData.phones);
    var other = findEmp(salesData.others);
    var accy = findEmp(salesData.accessories);
    var clean = findEmp(salesData.cleanings);
    var clnSales = findEmp(salesData.cleaningSales);

    var phoneTickets = phone ? phone.repair_tickets || 0 : 0;
    var phoneTotal = phone ? phone.repair_total || 0 : 0;
    var otherCount = other ? other.repair_count || 0 : 0;
    var otherTotal = other ? other.repair_total || 0 : 0;
    var accyGP = accy ? accy.accy_gp || 0 : 0;
    var accyCount = accy ? accy.accy_count || 0 : 0;
    var cleanTotal = clean ? clean.clean_total || 0 : 0;
    var cleanCount = clean ? clean.clean_count || 0 : 0;
    var csDiscounted = clnSales ? clnSales.discounted_sales || clnSales.gross_sales || 0 : 0;

    var commPhone = isEnabled("phone_repair_standard") ? phoneTickets * (rates.phone_repair_standard || 1) : 0;
    var commOther = isEnabled("other_repair_rate") ? otherCount * (rates.other_repair_rate || 2.5) : 0;
    var commAccy = isEnabled("accessory_gp_rate") ? accyGP * (rates.accessory_gp_rate || 0.15) : 0;
    var commClean = isEnabled("cleaning_rate") ? cleanTotal * (rates.cleaning_rate || 0.10) : 0;
    var commCS = isEnabled("cleaning_sales_rate") ? csDiscounted * (rates.cleaning_sales_rate || 0.10) : 0;
    var total = commPhone + commOther + commAccy + commClean + commCS;
    var hasData = phoneTickets > 0 || otherCount > 0 || accyCount > 0 || cleanCount > 0 || csDiscounted > 0;

    return {
      phoneTickets: phoneTickets, phoneTotal: phoneTotal, commPhone: commPhone,
      otherCount: otherCount, otherTotal: otherTotal, commOther: commOther,
      accyGP: accyGP, accyCount: accyCount, commAccy: commAccy,
      cleanCount: cleanCount, cleanTotal: cleanTotal, commClean: commClean,
      csDiscounted: csDiscounted, commCS: commCS,
      total: total, totalRevenue: phoneTotal + otherTotal + accyGP + cleanTotal + csDiscounted,
      rates: rates, hasData: hasData,
    };
  }, [salesData, commConfig, empName]);

  // Shifts this month
  var monthShifts = useMemo(function() {
    var now = new Date();
    var monthStart = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
    return shifts.filter(function(s) {
      var d = s.shift_date || s.date || "";
      return d >= monthStart;
    });
  }, [shifts]);

  var totalHoursMonth = useMemo(function() {
    return Math.round(monthShifts.reduce(function(s, sh) { return s + (parseFloat(sh.hours) || 0); }, 0) * 10) / 10;
  }, [monthShifts]);

  // This week's shifts (Monday start)
  function getWeekBounds(offset) {
    var now = new Date();
    var dayOfWeek = now.getDay(); // 0=Sun
    var mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // adjust to Monday
    var weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() + mondayOffset + (offset * 7));
    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return {
      start: weekStart.toISOString().split("T")[0],
      end: weekEnd.toISOString().split("T")[0],
      label: weekStart.toLocaleDateString([], { month: "short", day: "numeric" }) + " - " + new Date(weekEnd.getTime() - 86400000).toLocaleDateString([], { month: "short", day: "numeric" }),
    };
  }

  var thisWeekBounds = useMemo(function() { return getWeekBounds(0); }, []);
  var nextWeekBounds = useMemo(function() { return getWeekBounds(1); }, []);
  var activeWeekBounds = scheduleWeek === "next" ? nextWeekBounds : thisWeekBounds;

  var weekShifts = useMemo(function() {
    return shifts.filter(function(s) {
      var d = s.shift_date || s.date || "";
      return d >= activeWeekBounds.start && d < activeWeekBounds.end;
    }).sort(function(a, b) { return (a.shift_date || a.date || "").localeCompare(b.shift_date || b.date || ""); });
  }, [shifts, activeWeekBounds]);

  var weekHours = useMemo(function() {
    return Math.round(weekShifts.reduce(function(s, sh) { return s + (parseFloat(sh.hours) || 0); }, 0) * 10) / 10;
  }, [weekShifts]);

  // Peer ranking
  var myRank = useMemo(function() {
    if (!empScore || !allEmployees.length) return null;
    var sorted = allEmployees.filter(function(e) { return e.hasData; }).sort(function(a, b) { return (b.overall || 0) - (a.overall || 0); });
    var idx = sorted.findIndex(function(e) { return matchName(empName, e.name); });
    return idx >= 0 ? { rank: idx + 1, total: sorted.length } : null;
  }, [empScore, allEmployees, empName]);

  // Call audit stats
  var callStats = useMemo(function() {
    if (!auditData || auditData.length === 0) return null;
    var total = auditData.length;
    var totalScore = 0;
    var apptOffered = 0;
    var warrantyMentioned = 0;
    var pricingGiven = 0;
    var turnaroundGiven = 0;
    var categories = {};

    auditData.forEach(function(a) {
      totalScore += a.overall_score || 0;
      if (a.appointment_offered) apptOffered++;
      if (a.warranty_mentioned) warrantyMentioned++;
      if (a.pricing_given || (a.criteria && a.criteria.pricing)) pricingGiven++;
      if (a.turnaround_given || (a.criteria && a.criteria.turnaround)) turnaroundGiven++;
      var cat = a.call_type || a.category || "unknown";
      if (!categories[cat]) categories[cat] = 0;
      categories[cat]++;
    });

    return {
      total: total,
      avgScore: Math.round(totalScore / total),
      apptOfferedRate: Math.round(apptOffered / total * 100),
      warrantyRate: Math.round(warrantyMentioned / total * 100),
      pricingRate: Math.round(pricingGiven / total * 100),
      turnaroundRate: Math.round(turnaroundGiven / total * 100),
      categories: categories,
      recent: auditData.slice(0, 10),
    };
  }, [auditData]);

  // Review bonus calculation
  var reviewBonus = useMemo(function() {
    if (!reviewData || !reviewData.current) return null;
    var data = reviewData.current;
    var totalReviews = data.total_reviews || 0;
    var photoReviews = data.photo_reviews || 0;
    var employeeCount = data.employee_count || 1;
    var minimum = 10;

    // $5/employee per review above 10, $5/employee per photo review
    var aboveMin = Math.max(0, totalReviews - minimum);
    var reviewPayout = aboveMin * 5 * employeeCount;
    var photoPayout = photoReviews * 5 * employeeCount;
    var perEmployee = employeeCount > 0 ? Math.round((reviewPayout + photoPayout) / employeeCount * 100) / 100 : 0;

    return {
      totalReviews: totalReviews,
      photoReviews: photoReviews,
      aboveMin: aboveMin,
      minimum: minimum,
      reviewPayout: reviewPayout,
      photoPayout: photoPayout,
      totalPayout: reviewPayout + photoPayout,
      perEmployee: perEmployee,
      employeeCount: employeeCount,
      history: reviewData.history || [],
    };
  }, [reviewData]);

  // AI Coaching generator
  var generateCoaching = async function() {
    if (!empScore) return;
    setCoachingLoading(true);
    try {
      var context = "Employee: " + empName + " at CPR " + empStore + "\n";
      context += "Overall Score: " + (empScore.overall || 0) + "/100\n";
      context += "Repairs: " + (empScore.repairs?.total_repairs || 0) + " (score: " + (empScore.repairs?.score || 0) + ")\n";
      context += "Phone Audit: " + (empScore.audit?.avg_pct || 0) + "% avg (score: " + (empScore.audit?.score || 0) + ")\n";
      context += "Compliance: " + (empScore.compliance?.score || 0) + " (" + (empScore.compliance?.total_tickets || 0) + " tickets graded)\n";
      context += "Hours This Month: " + totalHoursMonth + "\n";
      if (commission) context += "Commission: $" + commission.total.toFixed(2) + " (" + commission.phoneTickets + " phone repairs, " + commission.accyCount + " accessories)\n";
      if (callStats) context += "Call Audit: " + callStats.avgScore + "/100 avg, " + callStats.total + " calls audited, appt offered " + callStats.apptOfferedRate + "%\n";
      if (tickets.length > 0) {
        var lowTickets = tickets.filter(function(t) { return t.overall_score < 50; }).slice(0, 3);
        if (lowTickets.length > 0) {
          context += "Low-scoring tickets: " + lowTickets.map(function(t) { return "#" + t.ticket_number + " (" + t.overall_score + " - " + (t.device || "unknown device") + ")"; }).join(", ") + "\n";
        }
      }
      context += "Level: " + level.name + ", " + (nextLevel ? (nextLevel.min - overallScore) + " points to " + nextLevel.name : "MAX LEVEL") + "\n";
      if (myRank) context += "Ranked #" + myRank.rank + " of " + myRank.total + " employees\n";

      var res = await fetch("/api/dialpad/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Generate a personalized weekly coaching plan for this CPR Cell Phone Repair employee. Be specific with actionable items based on their actual data. Focus on the 2-3 highest-impact improvements. Use an encouraging but direct tone. Include specific numbers from their data. Format with clear sections: WINS THIS PERIOD, FOCUS AREAS, ACTION ITEMS (3 specific things to do this week), and GOAL (one measurable target for next week). Keep it under 300 words.\n\nEmployee Data:\n" + context }],
        }),
      });
      var json = await res.json();
      if (json.reply) {
        setCoachingInsight(json.reply);
        setCoachingError(null);
      } else {
        setCoachingError("Could not generate coaching plan. Please try again.");
      }
    } catch(e) {
      console.error("Coaching generation error:", e);
      setCoachingError("Failed to connect to AI coach: " + e.message);
    }
    setCoachingLoading(false);
  };

  // ═══ STYLES ═══
  var card = { background: "var(--bg-card)", borderRadius: 14, padding: 20, border: "1px solid var(--border)" };
  var cardInner = { background: "var(--bg-card-inner)", borderRadius: 10, padding: 16, border: "1px solid var(--border)" };
  var metricLabel = { color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 };
  var metricBig = { fontWeight: 800 };

  var tabs = [
    { id: "dashboard", label: "Dashboard", icon: "\uD83C\uDFAF" },
    { id: "paycheck", label: "Paycheck", icon: "\uD83D\uDCB0" },
    { id: "scorecard", label: "Scorecard", icon: "\uD83D\uDCCA" },
    { id: "schedule", label: "Schedule", icon: "\uD83D\uDCC5" },
    { id: "tickets", label: "My Tickets", icon: "\uD83C\uDFAB" },
    { id: "calls", label: "My Calls", icon: "\uD83D\uDCDE" },
    { id: "reviews", label: "Reviews", icon: "\u2B50" },
    { id: "coaching", label: "Coaching", icon: "\uD83D\uDE80" },
  ];

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading your performance data...</div>;
  }

  var level = empScore ? getLevel(empScore.overall || 0) : getLevel(0);
  var nextLevel = empScore ? getNextLevel(empScore.overall || 0) : null;
  var overallScore = empScore ? empScore.overall || 0 : 0;

  return (
    <div>
      {/* Sub-tab nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {tabs.map(function(t) {
          var active = subTab === t.id;
          var hasError = loadErrors[t.id === "paycheck" ? "sales" : t.id === "scorecard" ? "scorecard" : t.id];
          return <button key={t.id} onClick={function() { setSubTab(t.id); }}
            style={{ padding: "8px 14px", borderRadius: 8, border: active ? "1px solid #7B2FFF" : hasError ? "1px solid #F8717133" : "1px solid var(--border)", background: active ? "#7B2FFF18" : "transparent", color: active ? "#7B2FFF" : "var(--text-secondary)", fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            {t.icon} {t.label}
          </button>;
        })}
        <button onClick={loadData} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
          {"\u21BB"} Refresh
        </button>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ DASHBOARD ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "dashboard" && (
        <div>
          {/* Hero card */}
          <div style={{ ...card, marginBottom: 20, background: "linear-gradient(135deg, var(--bg-card) 0%, #7B2FFF08 100%)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              {/* Score ring */}
              <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0 }}>
                <svg viewBox="0 0 120 120" style={{ width: 120, height: 120, transform: "rotate(-90deg)" }}>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8" />
                  <circle cx="60" cy="60" r="52" fill="none" stroke={level.color} strokeWidth="8"
                    strokeDasharray={2 * Math.PI * 52} strokeDashoffset={2 * Math.PI * 52 * (1 - overallScore / 100)}
                    strokeLinecap="round" />
                </svg>
                <div style={{ position: "absolute", top: 0, left: 0, width: 120, height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: level.color }}>{overallScore}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" }}>Overall</div>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Welcome back</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4 }}>{empName}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 20 }}>{level.icon}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: level.color }}>{level.name} Level</span>
                  {myRank && <span style={{ fontSize: 12, color: "var(--text-secondary)", marginLeft: 8 }}>Ranked #{myRank.rank} of {myRank.total}</span>}
                </div>
                {nextLevel && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
                      <span>Next: {nextLevel.icon} {nextLevel.name}</span>
                      <span style={{ color: nextLevel.color, fontWeight: 700 }}>{nextLevel.min - overallScore} points to go</span>
                    </div>
                    <div style={{ background: "var(--bg-card-inner)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                      <div style={{ width: Math.min(100, (overallScore - level.min) / (nextLevel.min - level.min) * 100) + "%", height: "100%", borderRadius: 4, background: "linear-gradient(90deg, " + level.color + ", " + nextLevel.color + ")" }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Category scores */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Repairs", score: empScore?.repairs?.score || 0, detail: (empScore?.repairs?.total_repairs || 0) + " repairs" },
              { label: "Phone Audit", score: empScore?.audit?.avg_pct || empScore?.audit?.score || 0, detail: (empScore?.audit?.opp_audits || 0) + " audited" },
              { label: "Calls", score: empScore?.calls?.score || storeScore?.categories?.calls?.score || 0, detail: "Store avg" },
              { label: "CX", score: storeScore?.categories?.cx?.score || 0, detail: "Store avg" },
              { label: "Compliance", score: empScore?.compliance?.score || 0, detail: (empScore?.compliance?.total_tickets || 0) + " tickets" },
            ].map(function(cat) {
              return (
                <div key={cat.label} style={cardInner}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: sc(cat.score, 70, 50) }}>{Math.round(cat.score)}</div>
                    <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 600, marginTop: 2 }}>{cat.label}</div>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{cat.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick stats row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <div style={cardInner}>
              <div style={metricLabel}>Hours This Month</div>
              <div style={{ ...metricBig, fontSize: 22, color: totalHoursMonth > 160 ? "#F87171" : "var(--text-primary)" }}>{totalHoursMonth}h</div>
              {weekHours > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{weekHours}h this week</div>}
            </div>
            <div style={cardInner}>
              <div style={metricLabel}>Repairs This Month</div>
              <div style={{ ...metricBig, fontSize: 22, color: "#00D4FF" }}>{empScore?.repairs?.total_repairs || 0}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{empScore?.repairs?.phone_tickets || 0} phone / {empScore?.repairs?.other_tickets || 0} other</div>
            </div>
            <div style={cardInner}>
              <div style={metricLabel}>Accessory GP</div>
              <div style={{ ...metricBig, fontSize: 22, color: "#4ADE80" }}>{fmt(empScore?.repairs?.accy_gp || 0)}</div>
            </div>
            <div style={cardInner}>
              <div style={metricLabel}>Commission (est.)</div>
              <div style={{ ...metricBig, fontSize: 22, color: "#FBBF24" }}>{commission ? fmt(commission.total) : "$0.00"}</div>
            </div>
          </div>

          {/* Weekly Goal */}
          {weeklyGoal && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg, #FF2D95, #7B2FFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{"\uD83C\uDFAF"}</div>
                <div>
                  <div style={{ fontSize: 10, color: "#FF2D95", fontWeight: 700, textTransform: "uppercase" }}>This Week's Goal</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>{weeklyGoal.title || "Weekly Challenge"}</div>
                </div>
              </div>
              <div style={{ color: "var(--text-body)", fontSize: 13, lineHeight: 1.6 }}>{weeklyGoal.description || weeklyGoal.body || ""}</div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ PAYCHECK (COMMISSIONS) ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "paycheck" && (
        <div>
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Estimated Commission This Period</div>
                <div style={{ fontSize: 42, fontWeight: 900, color: "#FBBF24" }}>{commission ? fmt(commission.total) : "$0.00"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Total Revenue Generated</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#00D4FF" }}>{commission ? fmt(commission.totalRevenue) : "$0.00"}</div>
              </div>
            </div>

            {/* Commission breakdown */}
            {commission && commission.hasData && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>Breakdown</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "var(--text-muted)", fontSize: 10 }}>Category</th>
                    <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>Qty</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-muted)", fontSize: 10 }}>Revenue / GP</th>
                    <th style={{ padding: "8px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>Rate</th>
                    <th style={{ padding: "8px 12px", textAlign: "right", color: "var(--text-muted)", fontSize: 10 }}>Commission</th>
                  </tr></thead>
                  <tbody>
                    {[
                      { cat: "Phone Repairs", qty: commission.phoneTickets, rev: commission.phoneTotal, rate: fmt(commission.rates.phone_repair_standard || 1) + "/ea", comm: commission.commPhone },
                      { cat: "Other Repairs", qty: commission.otherCount, rev: commission.otherTotal, rate: fmt(commission.rates.other_repair_rate || 2.5) + "/ea", comm: commission.commOther },
                      { cat: "Accessory GP", qty: commission.accyCount, rev: commission.accyGP, rate: Math.round((commission.rates.accessory_gp_rate || 0.15) * 100) + "%", comm: commission.commAccy },
                      { cat: "Cleanings", qty: commission.cleanCount, rev: commission.cleanTotal, rate: Math.round((commission.rates.cleaning_rate || 0.10) * 100) + "%", comm: commission.commClean },
                      { cat: "CLN Sales", qty: "—", rev: commission.csDiscounted, rate: Math.round((commission.rates.cleaning_sales_rate || 0.10) * 100) + "%", comm: commission.commCS },
                    ].map(function(row) {
                      return (
                        <tr key={row.cat} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "10px 12px", color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>{row.cat}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>{row.qty}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-body)", fontSize: 13 }}>{fmt(row.rev)}</td>
                          <td style={{ padding: "10px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 11 }}>{row.rate}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: row.comm > 0 ? "#FBBF24" : "var(--text-muted)", fontSize: 14, fontWeight: 700 }}>{fmt(row.comm)}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: "var(--bg-card-inner)" }}>
                      <td colSpan={4} style={{ padding: "12px", color: "var(--text-primary)", fontSize: 14, fontWeight: 800 }}>Total Commission</td>
                      <td style={{ padding: "12px", textAlign: "right", color: "#FBBF24", fontSize: 18, fontWeight: 900 }}>{fmt(commission.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {(!commission || !commission.hasData) && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                {loadErrors.sales ? "Failed to load sales data. Tap Refresh to retry." : "Sales data hasn't been imported for this period yet. Your commission will appear here once data is uploaded."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ SCORECARD (DEEP DIVE) ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "scorecard" && (
        <div>
          {empScore ? (
            <div>
              {/* Category cards */}
              {[
                { label: "Repairs", score: empScore.repairs?.score || 0, color: "#00D4FF", details: [
                  { k: "Phone Repairs", v: empScore.repairs?.phone_tickets || 0 },
                  { k: "Other Repairs", v: empScore.repairs?.other_tickets || 0 },
                  { k: "Total Repairs", v: empScore.repairs?.total_repairs || 0 },
                  { k: "Accessory GP", v: fmt(empScore.repairs?.accy_gp || 0) },
                  { k: "Cleanings", v: empScore.repairs?.clean_count || 0 },
                ] },
                { label: "Phone Audit", score: empScore.audit?.avg_pct || empScore.audit?.score || 0, color: "#7B2FFF", details: [
                  { k: "Opportunity Audits", v: empScore.audit?.opp_audits || 0 },
                  { k: "Avg Score", v: (empScore.audit?.avg_pct || 0) + "%" },
                ] },
                { label: "Compliance", score: empScore.compliance?.score || 0, color: "#FF2D95", details: [
                  { k: "Tickets Graded", v: empScore.compliance?.total_tickets || 0 },
                  { k: "Avg Ticket Score", v: Math.round(empScore.compliance?.avg_score || 0) },
                  { k: "Diagnostics Avg", v: Math.round(empScore.compliance?.avg_diagnostics || 0) },
                  { k: "Notes Avg", v: Math.round(empScore.compliance?.avg_notes || 0) },
                  { k: "Payment Avg", v: Math.round(empScore.compliance?.avg_payment || 0) },
                ] },
              ].map(function(cat) {
                return (
                  <div key={cat.label} style={{ ...card, marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{cat.label}</div>
                      <div style={{ padding: "4px 12px", borderRadius: 6, background: cat.color + "18", color: cat.color, fontSize: 18, fontWeight: 800 }}>{Math.round(cat.score)}/100</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
                      {cat.details.map(function(d) {
                        return (
                          <div key={d.k} style={cardInner}>
                            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>{d.k}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>{d.v}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* Peer comparison — same store shown by name, other stores anonymized */}
              <div style={{ ...card, marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Peer Comparison</div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--text-muted)", fontSize: 10 }}>#</th>
                    <th style={{ padding: "6px 10px", textAlign: "left", color: "var(--text-muted)", fontSize: 10 }}>Employee</th>
                    <th style={{ padding: "6px 10px", textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>Overall</th>
                    <th style={{ padding: "6px 10px", textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>Repairs</th>
                    <th style={{ padding: "6px 10px", textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>Audit</th>
                    <th style={{ padding: "6px 10px", textAlign: "center", color: "var(--text-muted)", fontSize: 10 }}>Compliance</th>
                  </tr></thead>
                  <tbody>
                    {allEmployees.filter(function(e) { return e.hasData; }).sort(function(a, b) { return (b.overall || 0) - (a.overall || 0); }).map(function(e, i) {
                      var isMe = matchName(empName, e.name);
                      var sameStore = e.store === empStore;
                      var displayName = isMe ? e.name + " (you)" : sameStore ? e.name : "Employee at " + (e.store ? "CPR " + e.store.charAt(0).toUpperCase() + e.store.slice(1) : "other");
                      return (
                        <tr key={e.name || i} style={{ borderBottom: "1px solid var(--border)", background: isMe ? "#7B2FFF12" : "transparent" }}>
                          <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>{i + 1}</td>
                          <td style={{ padding: "8px 10px", color: isMe ? "#7B2FFF" : sameStore ? "var(--text-primary)" : "var(--text-muted)", fontSize: 13, fontWeight: isMe ? 700 : 500, fontStyle: sameStore ? "normal" : "italic" }}>{displayName}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: sc(e.overall || 0, 70, 50), fontSize: 14, fontWeight: 700 }}>{e.overall || 0}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>{sameStore || isMe ? e.repairs?.total_repairs || 0 : "—"}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>{sameStore || isMe ? e.audit?.avg_pct || e.audit?.score || 0 : "—"}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>{sameStore || isMe ? e.compliance?.score || 0 : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>No scorecard data available for your account.</div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ SCHEDULE ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "schedule" && (
        <div>
          {/* Hours summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            <div style={card}>
              <div style={metricLabel}>This Week</div>
              <div style={{ ...metricBig, fontSize: 28, color: weekHours > 40 ? "#F87171" : "var(--text-primary)" }}>{weekHours}h</div>
              {weekHours > 40 && <div style={{ fontSize: 10, color: "#F87171", fontWeight: 600, marginTop: 4 }}>OT Alert: {Math.round((weekHours - 40) * 10) / 10}h overtime</div>}
            </div>
            <div style={card}>
              <div style={metricLabel}>This Month</div>
              <div style={{ ...metricBig, fontSize: 28, color: "var(--text-primary)" }}>{totalHoursMonth}h</div>
            </div>
            <div style={card}>
              <div style={metricLabel}>Shifts This Week</div>
              <div style={{ ...metricBig, fontSize: 28, color: "#00D4FF" }}>{weekShifts.length}</div>
            </div>
          </div>

          {/* Week schedule with toggle */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>Schedule — {activeWeekBounds.label}</div>
              <div style={{ display: "flex", gap: 2, background: "var(--bg-card-inner)", borderRadius: 8, padding: 2 }}>
                <button onClick={function(){setScheduleWeek("this");}} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  background: scheduleWeek === "this" ? "#7B2FFF" : "transparent", color: scheduleWeek === "this" ? "#fff" : "var(--text-muted)",
                }}>This Week</button>
                <button onClick={function(){setScheduleWeek("next");}} style={{
                  padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                  background: scheduleWeek === "next" ? "#FF2D95" : "transparent", color: scheduleWeek === "next" ? "#fff" : "var(--text-muted)",
                }}>Next Week</button>
              </div>
            </div>
            {weekShifts.length > 0 ? (
              <div>
                {weekShifts.map(function(s, i) {
                  var d = s.shift_date || s.date || "";
                  var dayName = d ? new Date(d + "T12:00:00").toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) : "";
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: i < weekShifts.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <div>
                        <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 600 }}>{dayName}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{s.start_time || ""} - {s.end_time || ""}</div>
                      </div>
                      <div style={{ color: "var(--text-secondary)", fontSize: 14, fontWeight: 700 }}>{parseFloat(s.hours || 0).toFixed(1)}h</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                {loadErrors.shifts ? "Failed to load schedule. Tap Refresh to retry." : "No shifts scheduled for " + (scheduleWeek === "next" ? "next week" : "this week") + "."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ MY TICKETS ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "tickets" && (
        <div>
          {/* Period toggle */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 2, background: "var(--bg-card)", borderRadius: 8, padding: 2 }}>
              {[
                { id: "mtd", label: "This Month" },
                { id: "30", label: "30 Days" },
                { id: "60", label: "60 Days" },
                { id: "90", label: "All" },
              ].map(function(p) {
                return <button key={p.id} onClick={function(){setTicketPeriod(p.id);}} style={{
                  padding: "5px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700,
                  background: ticketPeriod === p.id ? "#7B2FFF" : "transparent", color: ticketPeriod === p.id ? "#fff" : "var(--text-muted)",
                }}>{p.label}</button>;
              })}
            </div>
          </div>

          {(function() {
            var now = new Date();
            var filteredTickets = tickets;
            if (ticketPeriod === "mtd") {
              var mtdStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
              filteredTickets = tickets.filter(function(t) { return t.date_closed && t.date_closed.substring(0, 7) === mtdStr; });
            } else if (ticketPeriod !== "90") {
              var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - parseInt(ticketPeriod));
              var cutoffStr = cutoff.toISOString();
              filteredTickets = tickets.filter(function(t) { return t.date_closed && t.date_closed >= cutoffStr; });
            }

            var avgScore = filteredTickets.length > 0 ? Math.round(filteredTickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / filteredTickets.length) : 0;
            var withTA = filteredTickets.filter(function(t) { return t.turnaround_hours > 0; });
            var avgTA = withTA.length > 0 ? Math.round(withTA.reduce(function(s, t) { return s + t.turnaround_hours; }, 0) / withTA.length * 10) / 10 : 0;
            var withGPM = filteredTickets.filter(function(t) { return t.gpm_pct > 0; });
            var avgGPM = withGPM.length > 0 ? Math.round(withGPM.reduce(function(s, t) { return s + t.gpm_pct; }, 0) / withGPM.length) : 0;

            return (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <div style={card}>
              <div style={metricLabel}>Tickets Graded</div>
              <div style={{ ...metricBig, fontSize: 28, color: "var(--text-primary)" }}>{filteredTickets.length}</div>
            </div>
            <div style={card}>
              <div style={metricLabel}>Avg Score</div>
              <div style={{ ...metricBig, fontSize: 28, color: sc(avgScore, 70, 50) }}>{avgScore}</div>
            </div>
            <div style={card}>
              <div style={metricLabel}>Avg Turnaround</div>
              <div style={{ ...metricBig, fontSize: 28, color: "#00D4FF" }}>{avgTA > 0 ? avgTA + "h" : "\u2014"}</div>
            </div>
            <div style={card}>
              <div style={metricLabel}>Avg GPM</div>
              <div style={{ ...metricBig, fontSize: 28, color: "#4ADE80" }}>{avgGPM > 0 ? avgGPM + "%" : "\u2014"}</div>
            </div>
          </div>

          {/* Ticket list */}
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Recent Tickets</div>
            {filteredTickets.length > 0 ? (
              <div style={{ maxHeight: 500, overflow: "auto" }}>
                {filteredTickets.slice(0, 50).map(function(t) {
                  var scoreColor = sc(t.overall_score || 0, 70, 50);
                  return (
                    <div key={t.ticket_number} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>#{t.ticket_number}</span>
                          {t.ticket_type && <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: t.ticket_type === "Sale" ? "#FBBF2418" : t.ticket_type === "Claim" ? "#00D4FF18" : "#4ADE8018", color: t.ticket_type === "Sale" ? "#FBBF24" : t.ticket_type === "Claim" ? "#00D4FF" : "#4ADE80" }}>{t.ticket_type}</span>}
                          {t.device_category && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{t.device_category}</span>}
                        </div>
                        <div style={{ color: "var(--text-body)", fontSize: 12, marginTop: 2 }}>{t.device || t.customer_name || ""}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 1 }}>{t.date_closed ? new Date(t.date_closed).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}{t.turnaround_hours > 0 ? " \u00B7 " + t.turnaround_hours + "h turnaround" : ""}{t.gross_profit > 0 ? " \u00B7 " + fmt(t.gross_profit) + " profit" : ""}</div>
                      </div>
                      <div style={{ padding: "4px 10px", borderRadius: 6, background: scoreColor + "18", color: scoreColor, fontSize: 14, fontWeight: 800, minWidth: 45, textAlign: "center" }}>{t.overall_score || 0}</div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                {loadErrors.tickets ? "Failed to load tickets. Tap Refresh to retry." : "No tickets found for this period."}
              </div>
            )}
          </div>
            </>);
          })()}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ MY CALLS ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "calls" && (
        <div>
          {callStats ? (
            <div>
              {/* Call summary cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                <div style={card}>
                  <div style={metricLabel}>Calls Audited</div>
                  <div style={{ ...metricBig, fontSize: 28, color: "var(--text-primary)" }}>{callStats.total}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>Last 30 days</div>
                </div>
                <div style={card}>
                  <div style={metricLabel}>Avg Audit Score</div>
                  <div style={{ ...metricBig, fontSize: 28, color: sc(callStats.avgScore, 80, 60) }}>{callStats.avgScore}</div>
                </div>
                <div style={card}>
                  <div style={metricLabel}>Appt Offered</div>
                  <div style={{ ...metricBig, fontSize: 28, color: sc(callStats.apptOfferedRate, 80, 50) }}>{callStats.apptOfferedRate}%</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>of opportunity calls</div>
                </div>
                <div style={card}>
                  <div style={metricLabel}>Warranty Mentioned</div>
                  <div style={{ ...metricBig, fontSize: 28, color: sc(callStats.warrantyRate, 80, 50) }}>{callStats.warrantyRate}%</div>
                </div>
              </div>

              {/* Call criteria breakdown */}
              <div style={{ ...card, marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Call Quality Breakdown</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { label: "Pricing Given", rate: callStats.pricingRate, target: 90, tip: "Quote a price range on every call" },
                    { label: "Turnaround Given", rate: callStats.turnaroundRate, target: 90, tip: "Tell them how long the repair takes" },
                    { label: "Appointment Offered", rate: callStats.apptOfferedRate, target: 80, tip: "Ask to book an appointment" },
                    { label: "Warranty Mentioned", rate: callStats.warrantyRate, target: 70, tip: "Mention your repair warranty" },
                  ].map(function(item) {
                    var color = sc(item.rate, item.target - 10, item.target - 30);
                    return (
                      <div key={item.label} style={cardInner}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                          <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                          <span style={{ color: color, fontSize: 18, fontWeight: 800 }}>{item.rate}%</span>
                        </div>
                        <div style={{ background: "var(--bg-card)", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 6 }}>
                          <div style={{ width: item.rate + "%", height: "100%", borderRadius: 4, background: color }} />
                        </div>
                        {item.rate < item.target && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{item.tip}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Recent audits */}
              <div style={card}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Recent Call Audits</div>
                {callStats.recent.map(function(audit, i) {
                  var asc = sc(audit.overall_score || 0, 80, 60);
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < callStats.recent.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "var(--text-primary)", fontSize: 13 }}>{audit.caller_name || audit.phone_number || "Unknown Caller"}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
                          {audit.date ? new Date(audit.date).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                          {audit.call_type ? " \u00B7 " + audit.call_type : ""}
                          {audit.appointment_offered ? " \u00B7 Appt offered" : ""}
                        </div>
                      </div>
                      <div style={{ padding: "4px 10px", borderRadius: 6, background: asc + "18", color: asc, fontSize: 14, fontWeight: 800 }}>{audit.overall_score || 0}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ ...card, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{"\uD83D\uDCDE"}</div>
              <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No Call Audits Yet</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                {loadErrors.calls ? "Failed to load call data. Tap Refresh to retry." : "Your call audits will appear here once calls are reviewed. Keep answering the phone with a great greeting!"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ MY REVIEWS ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "reviews" && (
        <div>
          {reviewBonus ? (
            <div>
              {/* Review bonus summary */}
              <div style={{ ...card, marginBottom: 20, background: "linear-gradient(135deg, var(--bg-card) 0%, #FBBF2408 100%)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Per Employee Bonus This Month</div>
                    <div style={{ fontSize: 42, fontWeight: 900, color: "#FBBF24" }}>{fmt(reviewBonus.perEmployee)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Store Total Payout</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#4ADE80" }}>{fmt(reviewBonus.totalPayout)}</div>
                  </div>
                </div>

                {/* Progress to minimum */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>
                    <span>Reviews: {reviewBonus.totalReviews}</span>
                    <span>Minimum: {reviewBonus.minimum}</span>
                  </div>
                  <div style={{ background: "var(--bg-card-inner)", borderRadius: 4, height: 8, overflow: "hidden" }}>
                    <div style={{ width: Math.min(100, reviewBonus.totalReviews / reviewBonus.minimum * 100) + "%", height: "100%", borderRadius: 4, background: reviewBonus.totalReviews >= reviewBonus.minimum ? "#4ADE80" : "#FBBF24" }} />
                  </div>
                  {reviewBonus.totalReviews < reviewBonus.minimum && (
                    <div style={{ fontSize: 11, color: "#FBBF24", marginTop: 4 }}>{reviewBonus.minimum - reviewBonus.totalReviews} more reviews needed to unlock bonuses</div>
                  )}
                </div>

                {/* Breakdown */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
                  <div style={cardInner}>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Reviews Above Min</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: reviewBonus.aboveMin > 0 ? "#4ADE80" : "var(--text-muted)" }}>{reviewBonus.aboveMin}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>x $5/employee = {fmt(reviewBonus.reviewPayout)}</div>
                  </div>
                  <div style={cardInner}>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Photo Reviews</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: reviewBonus.photoReviews > 0 ? "#FF2D95" : "var(--text-muted)" }}>{reviewBonus.photoReviews}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>x $5/employee = {fmt(reviewBonus.photoPayout)}</div>
                  </div>
                  <div style={cardInner}>
                    <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Team Size</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)" }}>{reviewBonus.employeeCount}</div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>employees sharing bonus</div>
                  </div>
                </div>
              </div>

              {/* How to earn more */}
              <div style={{ ...card, marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>How to Earn More Review Bonuses</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[
                    { icon: "\u2B50", title: "Ask Every Customer", tip: "After completing a repair, ask: 'Would you mind leaving us a quick Google review? It really helps us out.'" },
                    { icon: "\uD83D\uDCF8", title: "Request Photos", tip: "Photo reviews are worth $5 each regardless of minimum. Ask: 'If you could include a photo, that would be amazing!'" },
                    { icon: "\uD83D\uDCF1", title: "Make It Easy", tip: "Have a QR code at the counter or text them the direct review link right after the repair." },
                    { icon: "\uD83D\uDCAC", title: "Timing Matters", tip: "Ask for the review while the customer is still happy — right when they see their fixed device working perfectly." },
                  ].map(function(item) {
                    return (
                      <div key={item.title} style={cardInner}>
                        <div style={{ fontSize: 20, marginBottom: 6 }}>{item.icon}</div>
                        <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{item.title}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>{item.tip}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Review history trend */}
              {reviewBonus.history && reviewBonus.history.length > 1 && (
                <div style={card}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>Monthly Review History</div>
                  {reviewBonus.history.slice(0, 6).map(function(h) {
                    return (
                      <div key={h.period} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                        <span style={{ color: "var(--text-primary)", fontSize: 13 }}>{h.period}</span>
                        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                          <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>{h.total_reviews || 0} reviews</span>
                          <span style={{ color: "#FF2D95", fontSize: 12 }}>{h.photo_reviews || 0} photos</span>
                          <span style={{ color: "#FBBF24", fontSize: 13, fontWeight: 700, minWidth: 60, textAlign: "right" }}>
                            {(function() {
                              var above = Math.max(0, (h.total_reviews || 0) - 10);
                              var bonus = above * 5 + (h.photo_reviews || 0) * 5;
                              return fmt(bonus / Math.max(h.employee_count || 1, 1));
                            })()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div style={{ ...card, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{"\u2B50"}</div>
              <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Review Data Not Available</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Google review tracking hasn't been set up for your store yet.</div>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ COACHING (AI-POWERED) ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "coaching" && (
        <div>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #FF2D95, #7B2FFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{"\uD83D\uDE80"}</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>AI Performance Coach</div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Personalized insights based on your actual performance data</div>
                </div>
              </div>
              <button onClick={generateCoaching} disabled={coachingLoading || !empScore}
                style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: coachingLoading ? "var(--bg-card-inner)" : "linear-gradient(135deg, #FF2D95, #7B2FFF)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: coachingLoading ? "wait" : "pointer" }}>
                {coachingLoading ? "Analyzing..." : coachingInsight ? "Refresh Coaching" : "Generate My Plan"}
              </button>
            </div>

            {/* Quick data-driven insights (always visible) */}
            {empScore && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase" }}>Your Data At a Glance</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {(function() {
                    var areas = [
                      { name: "Repairs", score: empScore.repairs?.score || 0, color: "#00D4FF" },
                      { name: "Phone Audit", score: empScore.audit?.avg_pct || empScore.audit?.score || 0, color: "#7B2FFF" },
                      { name: "Compliance", score: empScore.compliance?.score || 0, color: "#FF2D95" },
                    ].sort(function(a, b) { return a.score - b.score; });

                    return areas.map(function(area) {
                      var isWeakest = area === areas[0];
                      var isStrongest = area === areas[areas.length - 1];
                      return (
                        <div key={area.name} style={{ ...cardInner, borderLeft: "3px solid " + (isWeakest ? "#F87171" : isStrongest ? "#4ADE80" : area.color) }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{area.name}</span>
                            <span style={{ fontSize: 16, fontWeight: 800, color: sc(area.score, 70, 50) }}>{Math.round(area.score)}</span>
                          </div>
                          {isWeakest && <div style={{ fontSize: 9, color: "#F87171", fontWeight: 600 }}>Biggest opportunity</div>}
                          {isStrongest && <div style={{ fontSize: 9, color: "#4ADE80", fontWeight: 600 }}>Your strength</div>}
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* Level progress */}
                {nextLevel && (
                  <div style={{ ...cardInner, marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>{level.icon} {level.name} → {nextLevel.icon} {nextLevel.name}</span>
                      <span style={{ color: nextLevel.color, fontSize: 13, fontWeight: 800 }}>{nextLevel.min - overallScore} pts needed</span>
                    </div>
                    <div style={{ background: "var(--bg-card)", borderRadius: 4, height: 6, overflow: "hidden", marginTop: 6 }}>
                      <div style={{ width: Math.min(100, (overallScore - level.min) / (nextLevel.min - level.min) * 100) + "%", height: "100%", borderRadius: 4, background: "linear-gradient(90deg, " + level.color + ", " + nextLevel.color + ")" }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* AI-generated coaching plan */}
            {coachingInsight && (
              <div style={{ ...cardInner, borderLeft: "3px solid #7B2FFF" }}>
                <div style={{ fontSize: 10, color: "#7B2FFF", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>Your Personalized Coaching Plan</div>
                <div style={{ color: "var(--text-body)", fontSize: 13, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{coachingInsight}</div>
              </div>
            )}

            {!coachingInsight && !coachingLoading && (
              <div style={{ ...cardInner, textAlign: "center", padding: 30 }}>
                <div style={{ fontSize: 30, marginBottom: 10 }}>{"\uD83D\uDE80"}</div>
                <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Ready for Your Weekly Game Plan?</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 16 }}>Our AI coach analyzes your repairs, calls, tickets, and scores to create a personalized improvement plan just for you.</div>
                <button onClick={generateCoaching} disabled={!empScore}
                  style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: "linear-gradient(135deg, #FF2D95, #7B2FFF)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: empScore ? "pointer" : "not-allowed" }}>
                  Generate My Coaching Plan
                </button>
              </div>
            )}

            {coachingLoading && (
              <div style={{ ...cardInner, textAlign: "center", padding: 30 }}>
                <div style={{ width: 30, height: 30, margin: "0 auto 12px", border: "3px solid #7B2FFF", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>Analyzing your performance data and generating insights...</div>
                <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
              </div>
            )}

            {coachingError && !coachingLoading && (
              <div style={{ ...cardInner, borderLeft: "3px solid #F87171", marginTop: 12 }}>
                <div style={{ color: "#F87171", fontSize: 12, fontWeight: 600 }}>{coachingError}</div>
              </div>
            )}
          </div>

          {/* Static coaching tips based on data (always visible below AI section) */}
          {empScore && (
            <div style={{ ...card, marginTop: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Quick Reference — Scoring Criteria</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { title: "Diagnostics (Ticket)", items: ["Document the issue clearly", "Include quoted price", "Include turnaround time"], weight: "35-45%" },
                  { title: "Repair Notes (Ticket)", items: ["Describe what was done", "Document outcome", "Note customer was contacted"], weight: "40-55%" },
                  { title: "Phone Audit", items: ["Greet professionally", "Identify device + issue", "Quote price + turnaround", "Offer appointment"], weight: "35% of overall" },
                  { title: "Repairs Score", items: ["Phone repairs (25%)", "Accessory GP (50%)", "Cleanings (25%)"], weight: "35% of overall" },
                ].map(function(section) {
                  return (
                    <div key={section.title} style={cardInner}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700 }}>{section.title}</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{section.weight}</span>
                      </div>
                      {section.items.map(function(item) {
                        return <div key={item} style={{ color: "var(--text-secondary)", fontSize: 11, padding: "3px 0", paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>{item}</div>;
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

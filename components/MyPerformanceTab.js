'use client';

import { useState, useEffect, useMemo } from "react";

var LEVEL_THRESHOLDS = [
  { name: "Bronze", min: 0, color: "#CD7F32", icon: "\uD83E\uDD49" },
  { name: "Silver", min: 40, color: "#C0C0C0", icon: "\uD83E\uDD48" },
  { name: "Gold", min: 55, color: "#FFD700", icon: "\uD83E\uDD47" },
  { name: "Platinum", min: 70, color: "#E0B0FF", icon: "\uD83D\uDC8E" },
  { name: "Diamond", min: 85, color: "#00D4FF", icon: "\u2B50" },
];

// ── Tier-based commission multipliers + Diamond PTO benefit ──
// Defaults below; can be overridden via commission_config table keys:
//   tier_gold_multiplier, tier_platinum_multiplier, tier_diamond_multiplier, tier_diamond_pto_per_month
var TIER_DEFAULTS = {
  Bronze:   { multiplier: 1.00, ptoPerMonth: 0 },
  Silver:   { multiplier: 1.00, ptoPerMonth: 0 },
  Gold:     { multiplier: 1.25, ptoPerMonth: 0 },
  Platinum: { multiplier: 1.50, ptoPerMonth: 0 },
  Diamond:  { multiplier: 1.50, ptoPerMonth: 1 },
};

function getTierBenefits(score, rates) {
  var lvl = getLevel(score || 0);
  var def = TIER_DEFAULTS[lvl.name] || TIER_DEFAULTS.Bronze;
  rates = rates || {};
  var mKey = "tier_" + lvl.name.toLowerCase() + "_multiplier";
  var pKey = "tier_" + lvl.name.toLowerCase() + "_pto_per_month";
  return {
    tier: lvl.name,
    color: lvl.color,
    icon: lvl.icon,
    multiplier: rates[mKey] != null ? rates[mKey] : def.multiplier,
    ptoPerMonth: rates[pKey] != null ? rates[pKey] : def.ptoPerMonth,
  };
}

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

// ── Roster validation: only count employees resolved to a known store ──
var KNOWN_STORES = ["fishers", "bloomington", "indianapolis"];
function isRosterMember(e) {
  if (!e || !e.hasData) return false;
  if (!e.store) return false;
  return KNOWN_STORES.indexOf(String(e.store).toLowerCase()) >= 0;
}

// ── Eastern-time shift formatter ── outputs e.g. "9:00a-4:00p"
function formatShiftTime(startISO, endISO) {
  function fmt(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso);
      var s = d.toLocaleTimeString("en-US", {
        timeZone: "America/Indiana/Indianapolis",
        hour: "numeric", minute: "2-digit", hour12: true,
      });
      // "9:00 AM" -> "9:00a", "12:30 PM" -> "12:30p"
      s = s.replace(":00 AM", "a").replace(":00 PM", "p")
           .replace(" AM", "a").replace(" PM", "p")
           .replace(/\s+/g, "");
      return s;
    } catch(e) { return ""; }
  }
  var s1 = fmt(startISO);
  var s2 = fmt(endISO);
  if (!s1 && !s2) return "";
  return s1 + "-" + s2;
}

// ── Audit row normalizer ── handles legacy field names + criteria JSONB ──
function normalizeAudit(a) {
  if (!a) return a;
  var maxScore = a.max_score != null ? parseFloat(a.max_score) : 4;
  var rawScore = a.score != null ? parseFloat(a.score) : 0;
  var derivedPct = maxScore > 0 ? Math.round((rawScore / maxScore) * 100) : 0;
  // The audit_results table stores criteria as flat boolean columns (not JSONB).
  // Different call types use different columns:
  //   opportunity:      appt_offered, discount_mentioned, warranty_mentioned, faster_turnaround
  //   current_customer: status_update_given, eta_communicated, professional_tone, next_steps_explained
  return Object.assign({}, a, {
    overall_score: derivedPct,
    overall_pct: derivedPct,
    // Opportunity-call criteria
    appt_offered: a.appt_offered === true,
    discount_mentioned: a.discount_mentioned === true,
    warranty_mentioned: a.warranty_mentioned === true,
    faster_turnaround: a.faster_turnaround === true,
    // Current-customer-call criteria
    status_update_given: a.status_update_given === true,
    eta_communicated: a.eta_communicated === true,
    professional_tone: a.professional_tone === true,
    next_steps_explained: a.next_steps_explained === true,
    // Convenience aliases for older code paths
    appointment_offered: a.appt_offered === true,
    caller_name: a.customer_name || "",
    phone_number: a.phone || "",
  });
}

// ── Reusable info tooltip for metric cards ──
function MetricTooltip(props) {
  var [open, setOpen] = useState(false);
  var title = props.title || "";
  var what = props.what || "";
  var source = props.source || "";
  var howTo = props.howTo || "";
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={function(e){ e.stopPropagation(); setOpen(!open); }}
        aria-label={"What is " + title + "?"}
        style={{
          width: 16, height: 16, borderRadius: "50%", border: "none",
          background: open ? "#7B2FFF" : "var(--bg-card-inner)",
          color: open ? "#fff" : "var(--text-muted)",
          fontSize: 10, fontWeight: 800, cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
      >?</button>
      {open && (
        <>
          <div onClick={function(){ setOpen(false); }} style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 99,
          }} />
          <div style={{
            position: "absolute", top: 22, right: -8, zIndex: 100,
            width: 280, background: "var(--bg-card)", border: "1px solid #7B2FFF44",
            borderRadius: 10, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            textAlign: "left",
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#7B2FFF", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</div>
            {what && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3, fontWeight: 700 }}>What this measures</div>
                <div style={{ fontSize: 12, color: "var(--text-body)", lineHeight: 1.5 }}>{what}</div>
              </div>
            )}
            {source && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 3, fontWeight: 700 }}>Where it comes from</div>
                <div style={{ fontSize: 12, color: "var(--text-body)", lineHeight: 1.5 }}>{source}</div>
              </div>
            )}
            {howTo && (
              <div>
                <div style={{ fontSize: 9, color: "#4ADE80", textTransform: "uppercase", marginBottom: 3, fontWeight: 700 }}>How to improve</div>
                <div style={{ fontSize: 12, color: "var(--text-body)", lineHeight: 1.5 }}>{howTo}</div>
              </div>
            )}
          </div>
        </>
      )}
    </span>
  );
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
  var [streakData, setStreakData] = useState(null);
  var [expandedCall, setExpandedCall] = useState(null);
  var [expandedTicket, setExpandedTicket] = useState(null);
  var [coachingInsight, setCoachingInsight] = useState(null);
  var [coachingLoading, setCoachingLoading] = useState(false);
  var [coachingError, setCoachingError] = useState(null);
  var [scheduleWeek, setScheduleWeek] = useState("this");
  var [ticketPeriod, setTicketPeriod] = useState("mtd");
  var [viewAsEmployee, setViewAsEmployee] = useState("");

  var isAdmin = auth?.userInfo?.role === "admin";
  var empName = viewAsEmployee || auth?.userInfo?.name || "";
  var empStore = store || auth?.userInfo?.store || "";

  useEffect(function() {
    if (!empName) return;
    setCoachingInsight(null);
    setCoachingError(null);
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
        // Query audits by store (not employee name) — names are inconsistent in audit table.
        // We filter client-side with matchName so we catch "Alyssa", "Parent, Alyssa", etc.
        fetch("/api/dialpad/audit?store=" + encodeURIComponent(empStore) + "&limit=300&days=30").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/google-reviews?store=" + empStore).then(function(r) { return r.json(); }),
        fetch("/api/dialpad/tier-history?action=streaks&employee=" + encodeURIComponent(empName) + "&store=" + encodeURIComponent(empStore)).then(function(r) { return r.json(); }),
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
      if (results[6].status === "fulfilled" && results[6].value.audits) {
        // Filter to this employee with fuzzy name match, exclude excluded/non-scorable, normalize fields
        var raw = results[6].value.audits || [];
        var mine = raw.filter(function(a) {
          if (a.excluded) return false;
          if (a.call_type === "non_scorable") return false;
          return matchName(empName, a.employee || "");
        }).map(normalizeAudit);
        // Sort newest first
        mine.sort(function(x, y) {
          var dx = new Date(x.date || 0).getTime();
          var dy = new Date(y.date || 0).getTime();
          return dy - dx;
        });
        setAuditData(mine);
      } else { errors.calls = true; }
      if (results[7].status === "fulfilled") setReviewData(results[7].value); else errors.reviews = true;
      if (results[8] && results[8].status === "fulfilled" && results[8].value.success) setStreakData(results[8].value);
    } catch(e) { console.error("MyPerformanceTab load error:", e); errors.general = true; }
    setLoadErrors(errors);
    setLoading(false);
  };

  // ═══ COMPUTED DATA ═══

  // Commission calculation (mirrors SalesTab logic) — now with tier multiplier
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
    var baseTotal = commPhone + commOther + commAccy + commClean + commCS;
    var hasData = phoneTickets > 0 || otherCount > 0 || accyCount > 0 || cleanCount > 0 || csDiscounted > 0;

    // Tier multiplier — derived from current overall scorecard score
    var currentScore = empScore?.overall || 0;
    var tierInfo = getTierBenefits(currentScore, rates);
    var tierBonus = baseTotal * (tierInfo.multiplier - 1);
    var totalWithTier = baseTotal * tierInfo.multiplier;

    return {
      phoneTickets: phoneTickets, phoneTotal: phoneTotal, commPhone: commPhone,
      otherCount: otherCount, otherTotal: otherTotal, commOther: commOther,
      accyGP: accyGP, accyCount: accyCount, commAccy: commAccy,
      cleanCount: cleanCount, cleanTotal: cleanTotal, commClean: commClean,
      csDiscounted: csDiscounted, commCS: commCS,
      baseTotal: baseTotal,
      tier: tierInfo.tier, tierMultiplier: tierInfo.multiplier, tierBonus: tierBonus,
      tierColor: tierInfo.color, tierIcon: tierInfo.icon, ptoPerMonth: tierInfo.ptoPerMonth,
      total: totalWithTier, // Keep `total` as the headline number — now includes multiplier
      totalRevenue: phoneTotal + otherTotal + accyGP + cleanTotal + csDiscounted,
      rates: rates, hasData: hasData,
    };
  }, [salesData, commConfig, empName, empScore]);

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

  // Peer ranking — only count employees resolved to a known store roster
  var myRank = useMemo(function() {
    if (!empScore || !allEmployees.length) return null;
    var sorted = allEmployees.filter(isRosterMember).sort(function(a, b) { return (b.overall || 0) - (a.overall || 0); });
    var idx = sorted.findIndex(function(e) { return matchName(empName, e.name); });
    return idx >= 0 ? { rank: idx + 1, total: sorted.length } : null;
  }, [empScore, allEmployees, empName]);

  // Call audit stats — split by call_type since opportunity & current_customer
  // calls use entirely different rubrics. Aggregating across both produces
  // nonsense (e.g. "0% pricing given" when pricing isn't even a criterion).
  var callStats = useMemo(function() {
    if (!auditData || auditData.length === 0) return null;
    var total = auditData.length;
    var totalScore = 0;

    // Opportunity-only counters
    var oppCalls = 0, apptOffered = 0, discountMentioned = 0, warrantyMentioned = 0, fasterTurnaround = 0;
    // Current-customer-only counters
    var ccCalls = 0, statusGiven = 0, etaGiven = 0, professional = 0, nextSteps = 0;

    var categories = {};

    auditData.forEach(function(a) {
      totalScore += a.overall_score || 0;
      var cat = a.call_type || "unknown";
      if (!categories[cat]) categories[cat] = 0;
      categories[cat]++;

      if (cat === "opportunity") {
        oppCalls++;
        if (a.appt_offered) apptOffered++;
        if (a.discount_mentioned) discountMentioned++;
        if (a.warranty_mentioned) warrantyMentioned++;
        if (a.faster_turnaround) fasterTurnaround++;
      } else if (cat === "current_customer") {
        ccCalls++;
        if (a.status_update_given) statusGiven++;
        if (a.eta_communicated) etaGiven++;
        if (a.professional_tone) professional++;
        if (a.next_steps_explained) nextSteps++;
      }
    });

    function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; }

    return {
      total: total,
      avgScore: Math.round(totalScore / total),
      categories: categories,
      // Opportunity rates (denominator = oppCalls)
      oppCalls: oppCalls,
      apptOfferedRate: pct(apptOffered, oppCalls),
      discountRate: pct(discountMentioned, oppCalls),
      warrantyRate: pct(warrantyMentioned, oppCalls),
      fasterTurnaroundRate: pct(fasterTurnaround, oppCalls),
      // Current-customer rates (denominator = ccCalls)
      ccCalls: ccCalls,
      statusRate: pct(statusGiven, ccCalls),
      etaRate: pct(etaGiven, ccCalls),
      professionalRate: pct(professional, ccCalls),
      nextStepsRate: pct(nextSteps, ccCalls),
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
      // ── Build dense, evidence-grounded context ──
      var lines = [];
      lines.push("EMPLOYEE: " + empName + " at CPR " + empStore);
      lines.push("OVERALL SCORE: " + Math.round(empScore.overall || 0) + "/100");

      // Tier + multiplier (the dollar lever)
      var tierInfo = commission ? {
        tier: commission.tier,
        multiplier: commission.tierMultiplier,
        baseMonthly: commission.baseTotal,
      } : null;
      if (tierInfo) {
        lines.push("CURRENT TIER: " + tierInfo.tier + " (" + tierInfo.multiplier + "x multiplier)");
        lines.push("BASE MONTHLY COMMISSION: $" + tierInfo.baseMonthly.toFixed(2));
      }
      // Next tier dollar value
      if (nextLevel && tierInfo) {
        var nextMult = (nextLevel.name === "Gold" ? 1.25 : nextLevel.name === "Platinum" ? 1.50 : nextLevel.name === "Diamond" ? 1.50 : 1.00);
        var nextMonthly = tierInfo.baseMonthly * nextMult;
        var deltaMonthly = nextMonthly - (tierInfo.baseMonthly * tierInfo.multiplier);
        var deltaAnnual = deltaMonthly * 12;
        lines.push("NEXT TIER: " + nextLevel.name + " at " + nextLevel.min + " pts (" + (nextLevel.min - Math.round(empScore.overall || 0)) + " pts away)");
        lines.push("NEXT TIER DOLLAR VALUE: +$" + deltaMonthly.toFixed(0) + "/month, +$" + deltaAnnual.toFixed(0) + "/year vs current tier");
        if (nextLevel.name === "Diamond") lines.push("  Diamond also adds 1 PTO day/month (12 PTO days/year)");
      }

      // Peer context — named, ranked
      if (myRank && allEmployees.length > 0) {
        lines.push("RANK: #" + myRank.rank + " of " + myRank.total + " employees with full data");
        var rosterPeers = allEmployees.filter(isRosterMember).sort(function(a,b){return (b.overall||0)-(a.overall||0);});
        var meIdx = rosterPeers.findIndex(function(e){ return matchName(empName, e.name); });
        // Find named peer just above (or top performer if at #1)
        var peerComp = null;
        if (meIdx > 0) {
          peerComp = rosterPeers[meIdx - 1];
        } else if (meIdx === 0 && rosterPeers.length > 1) {
          peerComp = rosterPeers[1]; // person right behind them
        }
        if (peerComp && peerComp.name) {
          lines.push("CLOSEST PEER: " + peerComp.name + " (" + Math.round(peerComp.overall) + " overall, " + Math.round(peerComp.repairs||0) + " repairs / " + Math.round(peerComp.audit||0) + " audit / " + Math.round(peerComp.compliance||0) + " compliance)");
        }
      }

      // Repair production
      lines.push("");
      lines.push("REPAIRS: " + (empScore.repairs?.total_repairs || 0) + " total (score " + (empScore.repairs?.score || 0) + ")");
      lines.push("ACCESSORY GP: $" + (empScore.repairs?.accy_gp || 0).toFixed(2));

      // Call audit — split by type with real numbers
      lines.push("");
      lines.push("CALL AUDIT (last 30 days):");
      if (callStats) {
        lines.push("  Total: " + callStats.total + " calls (" + callStats.oppCalls + " opportunity, " + callStats.ccCalls + " repeat customer)");
        lines.push("  Average score: " + callStats.avgScore + "/100");
        if (callStats.oppCalls > 0) {
          lines.push("  OPPORTUNITY CALL CRITERIA (rate / " + callStats.oppCalls + " calls):");
          lines.push("    - Appointment offered: " + (callStats.apptOfferedRate || 0) + "%");
          lines.push("    - Discount mentioned: " + (callStats.discountRate || 0) + "%");
          lines.push("    - Lifetime warranty mentioned: " + (callStats.warrantyRate || 0) + "%");
          lines.push("    - Faster-with-appointment pitch: " + (callStats.fasterTurnaroundRate || 0) + "%");
        }
        if (callStats.ccCalls > 0) {
          lines.push("  REPEAT CUSTOMER CRITERIA (rate / " + callStats.ccCalls + " calls):");
          lines.push("    - Clear status update: " + (callStats.statusRate || 0) + "%");
          lines.push("    - ETA communicated: " + (callStats.etaRate || 0) + "%");
          lines.push("    - Professional tone: " + (callStats.professionalRate || 0) + "%");
          lines.push("    - Next steps explained: " + (callStats.nextStepsRate || 0) + "%");
        }
      }

      // Per-call evidence — actual zero-score opportunity calls (most teachable)
      var zeroCalls = (auditData || []).filter(function(a) {
        return a.call_type === "opportunity" && (a.score === 0 || parseFloat(a.score) === 0);
      }).slice(0, 4);
      if (zeroCalls.length > 0) {
        lines.push("");
        lines.push("ZERO-SCORE OPPORTUNITY CALLS (all 4 criteria missed) — cite using the EXACT markdown link format shown:");
        zeroCalls.forEach(function(a) {
          var cid = a.call_id || "?";
          // Internal anchor — clicking jumps to My Calls tab and expands this call
          var anchor = "#call:" + cid;
          lines.push("  - [Call " + String(cid).slice(-6) + "](" + anchor + "): " + (a.inquiry || "no inquiry") + " | Outcome: " + (a.outcome || "?"));
        });
      }
      // High-scoring calls — what's working
      var topCalls = (auditData || []).filter(function(a) {
        return a.call_type === "opportunity" && parseFloat(a.score) >= 3;
      }).slice(0, 2);
      if (topCalls.length > 0) {
        lines.push("");
        lines.push("HIGH-SCORE OPPORTUNITY CALLS (most criteria met) — cite using the EXACT markdown link format shown:");
        topCalls.forEach(function(a) {
          var cid = a.call_id || "?";
          var anchor = "#call:" + cid;
          var hits = [];
          if (a.appt_offered) hits.push("appt");
          if (a.discount_mentioned) hits.push("discount");
          if (a.warranty_mentioned) hits.push("warranty");
          if (a.faster_turnaround) hits.push("faster");
          lines.push("  - [Call " + String(cid).slice(-6) + "](" + anchor + ") (hit: " + hits.join(",") + "): " + (a.inquiry || "?"));
        });
      }

      // Compliance / tickets — external RepairQ link
      lines.push("");
      lines.push("COMPLIANCE: " + (empScore.compliance?.score || 0) + "/100 across " + (empScore.compliance?.total_tickets || 0) + " tickets");
      var lowTix = (tickets || []).filter(function(t) { return t.ticket_type !== "Sale" && t.overall_score != null && t.overall_score < 60; }).slice(0, 3);
      if (lowTix.length > 0) {
        lines.push("LOW-SCORING TICKETS — cite using the EXACT markdown link format shown:");
        lowTix.forEach(function(t) {
          var url = "https://cpr.repairq.io/admin/tickets/" + t.ticket_number;
          lines.push("  - [Ticket #" + t.ticket_number + "](" + url + ") (" + t.overall_score + ") " + (t.device || "?") + " | Intake " + (t.diagnostics_score || 0) + ", Repair Notes " + (t.notes_score || 0) + ", Pickup " + (t.categorization_score || 0) + ", Payment " + (t.payment_score || 0) + ", Contact " + (t.contact_score || 0) + " (all 0-100)");
        });
      }

      var context = lines.join("\n");

      // ── New prompt: evidence-grounded, no flattery, ranked by impact ──
      var promptText = [
        "You are coaching a retail technician at CPR Cell Phone Repair. Output a coaching plan in markdown with EXACTLY these four sections, no others:",
        "",
        "## 🎯 Biggest Unlock",
        "ONE specific behavior change with the highest dollar impact. Cite actual call/ticket references using the EXACT markdown link format shown in the data — calls use `[Call XXXXXX](#call:FULL_ID)` (internal — keeps the employee inside the dashboard), tickets use `[Ticket #XXXX](https://cpr.repairq.io/...)` (external RepairQ link). Quantify: what % does this move? What does that mean for their tier?",
        "",
        "## 📜 The One Sentence",
        "ONE specific sentence (in quotes) the employee can say verbatim on every relevant call/intake to fix the unlock. Must cover multiple rubric criteria at once. Make it short enough to memorize.",
        "",
        "## 💰 Tier Dollars",
        "Connect the unlock to specific dollars. Use the NEXT TIER DOLLAR VALUE from the data. Format: 'Move to [tier] = +$X/month, +$Y/year, every year you sustain it.' If they're at Platinum, show Diamond. If Diamond, show streak bonus impact.",
        "",
        "## 📅 This Week's Goal",
        "ONE measurable target with a specific number, not a range. e.g. 'Hit 60% appointment-offer rate on opportunity calls by Friday.' No multi-part goals.",
        "",
        "RULES:",
        "- NO 'wins this period' section, NO 'outstanding work' opener, NO motivational closer.",
        "- NEVER invent peer behaviors. Use ONLY the CLOSEST PEER stats provided. If you don't have peer data, skip peer comparison.",
        "- ALWAYS cite call/ticket references using the EXACT markdown link syntax shown — calls use `(#call:...)` so the dashboard can route the click internally; tickets use the full RepairQ URL.",
        "- 'Study X' / 'review Y guides' are forbidden — every action must be a thing they say or do during a call/intake, executable in <30 seconds.",
        "- Total length: 200 words max. Density over warmth.",
        "",
        "EMPLOYEE DATA:",
        context,
      ].join("\n");

      var res = await fetch("/api/dialpad/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: promptText }],
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
      {/* Admin: employee selector */}
      {isAdmin && allEmployees.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, padding: "10px 16px", background: "var(--bg-card)", borderRadius: 10, border: "1px solid #7B2FFF33" }}>
          <span style={{ fontSize: 12, color: "#7B2FFF", fontWeight: 700 }}>{"\uD83D\uDC41"} View as:</span>
          <select value={viewAsEmployee} onChange={function(e) { setViewAsEmployee(e.target.value); }}
            style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-card-inner)", color: "var(--text-primary)", fontSize: 13, cursor: "pointer", maxWidth: 250 }}>
            <option value="">Myself ({auth?.userInfo?.name || ""})</option>
            {allEmployees.filter(function(e) { return e.hasData && e.name; }).sort(function(a, b) { return (a.name || "").localeCompare(b.name || ""); }).map(function(e) {
              return <option key={e.name} value={e.name}>{e.name} — {e.store ? "CPR " + e.store.charAt(0).toUpperCase() + e.store.slice(1) : ""} ({e.overall || 0}pts)</option>;
            })}
          </select>
          {viewAsEmployee && <button onClick={function() { setViewAsEmployee(""); }}
            style={{ padding: "4px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: 10, cursor: "pointer" }}>Back to mine</button>}
        </div>
      )}

      {/* Viewing banner */}
      {viewAsEmployee && (
        <div style={{ padding: "8px 14px", background: "#7B2FFF12", border: "1px solid #7B2FFF33", borderRadius: 8, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#7B2FFF" }}>Viewing as <strong>{viewAsEmployee}</strong> — this is exactly what they see when logged in</span>
        </div>
      )}

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
              { label: "Repairs", score: empScore?.repairs?.score || 0, detail: (empScore?.repairs?.total_repairs || 0) + " repairs",
                what: "Your repair performance score, based on phone repairs, other repairs, accessory gross profit, and cleanings.",
                source: "Calculated from phone_repairs and accessory sales imported from RepairQ each month.",
                howTo: "Close more tickets, attach accessories (cases, screen protectors, chargers), and offer cleanings on every repair." },
              { label: "Phone Audit", score: empScore?.audit?.avg_pct || empScore?.audit?.score || 0, detail: (empScore?.audit?.opp_audits || 0) + " audited",
                what: "Average score of your audited phone calls. Higher means stronger call handling.",
                source: "Pulled from Dialpad transcripts that the AI auditor scored against the call rubric.",
                howTo: "On every opportunity call, quote a price range, give a turnaround estimate, mention the warranty, and offer to book an appointment." },
              { label: "Calls", score: empScore?.calls?.score || storeScore?.categories?.calls?.score || 0, detail: empScore?.calls?.score ? "Your score" : "Store avg",
                what: "Score for answering inbound calls quickly and consistently. Right now this shows your store's average — individual call attribution to employees is in development.",
                source: "Dialpad call records: answered vs. missed, ring time, and answer rate at the store level.",
                howTo: "Pick up the phone within 3 rings whenever you're not actively with a customer. Missed calls hurt the whole team." },
              { label: "CX", score: storeScore?.categories?.cx?.score || 0, detail: "Store avg",
                what: "Customer experience score for your store, driven by Google review volume, ratings, and photo reviews.",
                source: "Google Business Profile data imported from weekly GBP reports.",
                howTo: "Ask every happy customer for a Google review at checkout — especially ones who'll add a photo of their repair." },
              { label: "Compliance", score: empScore?.compliance?.score || 0, detail: (empScore?.compliance?.total_tickets || 0) + " tickets",
                what: "How thoroughly you document your tickets. Audited on Diagnostics, Notes, and Payment criteria.",
                source: "Each closed ticket is graded by the AI auditor against the compliance rubric in RepairQ.",
                howTo: "On intake: document the issue, quote a price, and note turnaround. On completion: log the repair outcome and that you notified the customer. If parts were ordered, take payment within 2 hours of intake." },
            ].map(function(cat) {
              return (
                <div key={cat.label} style={{ ...cardInner, position: "relative" }}>
                  <div style={{ position: "absolute", top: 8, right: 8 }}>
                    <MetricTooltip title={cat.label} what={cat.what} source={cat.source} howTo={cat.howTo} />
                  </div>
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
            <div style={{ ...cardInner, position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 8 }}>
                <MetricTooltip title="Hours This Month"
                  what="Total scheduled hours from your shifts this calendar month."
                  source="Pulled from WhenIWork shifts that have been synced to your roster profile."
                  howTo="If hours look wrong, check that your WhenIWork name matches your roster. Talk to your manager if you need shifts adjusted." />
              </div>
              <div style={metricLabel}>Hours This Month</div>
              <div style={{ ...metricBig, fontSize: 22, color: totalHoursMonth > 160 ? "#F87171" : "var(--text-primary)" }}>{totalHoursMonth}h</div>
              {weekHours > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{weekHours}h this week</div>}
            </div>
            <div style={{ ...cardInner, position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 8 }}>
                <MetricTooltip title="Repairs This Month"
                  what="Count of repair tickets you closed this month, split into phone repairs and other device types (laptops, tablets, game consoles, etc.)."
                  source="phone_repairs table imported from RepairQ Sales Staff Summary CSVs."
                  howTo="Phone repairs pay the highest commission. Push to close 5+ phone tickets per shift on busy days." />
              </div>
              <div style={metricLabel}>Repairs This Month</div>
              <div style={{ ...metricBig, fontSize: 22, color: "#00D4FF" }}>{empScore?.repairs?.total_repairs || 0}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{empScore?.repairs?.phone_tickets || 0} phone / {empScore?.repairs?.other_tickets || 0} other</div>
            </div>
            <div style={{ ...cardInner, position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 8 }}>
                <MetricTooltip title="Accessory GP"
                  what="Gross profit on accessories you sold this month — cases, screen protectors, chargers, cables. This is the profit margin, not the sale price."
                  source="Calculated from RepairQ accessory sales: revenue minus cost."
                  howTo="Attach a case + screen protector to every phone repair. The combo bundle pays the highest commission and protects the customer's investment." />
              </div>
              <div style={metricLabel}>Accessory GP</div>
              <div style={{ ...metricBig, fontSize: 22, color: "#4ADE80" }}>{fmt(empScore?.repairs?.accy_gp || 0)}</div>
            </div>
            <div style={{ ...cardInner, position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 8 }}>
                <MetricTooltip title="Commission Estimate"
                  what="Estimated commission earnings this month, with your tier multiplier already applied. Final paycheck commission is calculated on payday by your manager."
                  source="Calculated from your repair count, accessory GP, cleanings, and other sales using the configured commission rates, then multiplied by your current tier (Gold 1.25x / Platinum 1.50x / Diamond 1.50x)."
                  howTo="See the Paycheck tab for a full breakdown by category, the tier bonus line, and the What-If Projector showing annual impact." />
              </div>
              <div style={metricLabel}>Commission (est.)</div>
              <div style={{ ...metricBig, fontSize: 22, color: "#FBBF24" }}>{commission ? fmt(commission.total) : "$0.00"}</div>
              {commission && commission.hasData && commission.tierMultiplier > 1 && (
                <div style={{ fontSize: 10, color: commission.tierColor, fontWeight: 700, marginTop: 2 }}>{commission.tierMultiplier}x {commission.tier} tier</div>
              )}
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

          {/* Streaks + Performance Trend */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            {/* Streaks */}
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>Streaks & Milestones</div>
              {(function() {
                // Compute streaks from ticket data
                var repairTickets = tickets.filter(function(t) { return t.ticket_type !== "Sale"; });
                var highScoreStreak = 0;
                var currentStreak = 0;
                repairTickets.sort(function(a, b) { return (b.date_closed || "").localeCompare(a.date_closed || ""); });
                for (var si = 0; si < repairTickets.length; si++) {
                  if ((repairTickets[si].overall_score || 0) >= 70) { currentStreak++; } else break;
                }
                highScoreStreak = currentStreak;

                // Perfect tickets (90+)
                var perfectCount = repairTickets.filter(function(t) { return t.overall_score >= 90; }).length;
                // Consecutive days worked
                var workDays = {};
                monthShifts.forEach(function(s) { workDays[s.shift_date || s.date] = true; });
                var sortedDays = Object.keys(workDays).sort().reverse();
                var dayStreak = 0;
                for (var di = 0; di < sortedDays.length; di++) {
                  if (di === 0) { dayStreak = 1; continue; }
                  var prev = new Date(sortedDays[di - 1] + "T12:00:00");
                  var curr = new Date(sortedDays[di] + "T12:00:00");
                  var diff = (prev - curr) / (1000 * 60 * 60 * 24);
                  if (diff <= 2) dayStreak++; else break; // allow weekends
                }

                var streaks = [
                  { icon: "\uD83D\uDD25", label: "Quality Streak", value: highScoreStreak + " tickets", sub: "consecutive 70+ scores", color: highScoreStreak >= 5 ? "#4ADE80" : highScoreStreak >= 3 ? "#FBBF24" : "var(--text-muted)" },
                  { icon: "\u2B50", label: "Perfect Tickets", value: perfectCount, sub: "scored 90+", color: perfectCount > 0 ? "#FFD700" : "var(--text-muted)" },
                  { icon: "\uD83D\uDCAA", label: "Work Streak", value: dayStreak + " days", sub: "consecutive days", color: dayStreak >= 5 ? "#00D4FF" : "var(--text-muted)" },
                  { icon: "\uD83C\uDFAF", label: "Repairs This Month", value: empScore?.repairs?.total_repairs || 0, sub: totalHoursMonth > 0 ? (Math.round((empScore?.repairs?.total_repairs || 0) / totalHoursMonth * 80) / 10) + " per day avg" : "", color: "#00D4FF" },
                ];

                return streaks.map(function(s) {
                  return (
                    <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ fontSize: 18 }}>{s.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}>{s.label}</div>
                        <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{s.sub}</div>
                      </div>
                      <div style={{ color: s.color, fontSize: 16, fontWeight: 800 }}>{s.value}</div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Performance Trend Mini Chart */}
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>How Am I Trending?</div>
              {(function() {
                // Group tickets by week for trend
                var repairTickets = tickets.filter(function(t) { return t.ticket_type !== "Sale" && t.overall_score > 0 && t.date_closed; });
                if (repairTickets.length < 3) return <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 20, textAlign: "center" }}>Need more graded tickets to show trends</div>;

                var weekBuckets = {};
                repairTickets.forEach(function(t) {
                  var d = new Date(t.date_closed);
                  var weekStart = new Date(d);
                  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                  var key = weekStart.toISOString().split("T")[0];
                  if (!weekBuckets[key]) weekBuckets[key] = { scores: [], count: 0 };
                  weekBuckets[key].scores.push(t.overall_score);
                  weekBuckets[key].count++;
                });

                var weeks = Object.keys(weekBuckets).sort().slice(-8); // last 8 weeks
                var dataPoints = weeks.map(function(w) {
                  var b = weekBuckets[w];
                  return { week: w, avg: Math.round(b.scores.reduce(function(s, v) { return s + v; }, 0) / b.scores.length), count: b.count };
                });

                if (dataPoints.length < 2) return <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 20, textAlign: "center" }}>Need more weeks of data</div>;

                var maxAvg = Math.max.apply(null, dataPoints.map(function(d) { return d.avg; }));
                var minAvg = Math.min.apply(null, dataPoints.map(function(d) { return d.avg; }));
                var range = Math.max(maxAvg - minAvg, 20);
                var chartH = 100;
                var chartW = 260;
                var stepX = chartW / (dataPoints.length - 1);

                var points = dataPoints.map(function(d, i) {
                  var x = i * stepX;
                  var y = chartH - ((d.avg - minAvg) / range) * (chartH - 10);
                  return { x: x, y: y, avg: d.avg, count: d.count, week: d.week };
                });

                var pathD = "M " + points.map(function(p) { return p.x + " " + p.y; }).join(" L ");
                var trend = dataPoints[dataPoints.length - 1].avg - dataPoints[0].avg;
                var trendColor = trend >= 0 ? "#4ADE80" : "#F87171";

                return (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Avg ticket score by week</span>
                      <span style={{ fontSize: 12, color: trendColor, fontWeight: 700 }}>{trend >= 0 ? "\u2191" : "\u2193"} {Math.abs(trend)} pts</span>
                    </div>
                    <svg viewBox={"-10 -5 " + (chartW + 20) + " " + (chartH + 20)} style={{ width: "100%", height: 120 }}>
                      <path d={pathD} fill="none" stroke={trendColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      {points.map(function(p, i) {
                        return <g key={i}>
                          <circle cx={p.x} cy={p.y} r="4" fill={trendColor} />
                          <text x={p.x} y={p.y - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="8">{p.avg}</text>
                          <text x={p.x} y={chartH + 12} textAnchor="middle" fill="var(--text-muted)" fontSize="7">
                            {new Date(p.week + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}
                          </text>
                        </g>;
                      })}
                    </svg>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ PAYCHECK (COMMISSIONS) ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "paycheck" && (
        <div>
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Estimated Commission This Period</div>
                <div style={{ fontSize: 42, fontWeight: 900, color: "#FBBF24" }}>{commission ? fmt(commission.total) : "$0.00"}</div>
                {commission && commission.hasData && commission.tierMultiplier > 1 && (
                  <div style={{ fontSize: 11, color: "#4ADE80", fontWeight: 700, marginTop: 4 }}>
                    {"\u2728"} Includes {commission.tierMultiplier}x {commission.tier} multiplier (+{fmt(commission.tierBonus)})
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 4 }}>Total Revenue Generated</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "#00D4FF" }}>{commission ? fmt(commission.totalRevenue) : "$0.00"}</div>
              </div>
            </div>

            {/* Tier status callout — shows the multiplier they're earning + path to next tier */}
            {commission && commission.hasData && (
              <div style={{
                padding: 16, borderRadius: 12, marginBottom: 20,
                background: "linear-gradient(135deg, " + commission.tierColor + "12, " + commission.tierColor + "06)",
                border: "1px solid " + commission.tierColor + "40",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ fontSize: 32 }}>{commission.tierIcon}</div>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>Current Tier</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: commission.tierColor }}>{commission.tier} Level</div>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        Score: {Math.round(empScore?.overall || 0)} pts &middot; Multiplier: <strong style={{ color: commission.tierColor }}>{commission.tierMultiplier}x</strong>
                        {commission.ptoPerMonth > 0 && <span style={{ color: "#00D4FF", fontWeight: 700 }}> &middot; +{commission.ptoPerMonth} PTO day/mo</span>}
                      </div>
                    </div>
                  </div>
                  {nextLevel && (
                    <div style={{ textAlign: "right", minWidth: 200 }}>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 2 }}>Next: {nextLevel.icon} {nextLevel.name}</div>
                      {(function() {
                        var nextMult = (TIER_DEFAULTS[nextLevel.name] || {}).multiplier || 1;
                        var deltaPerMonth = commission.baseTotal * (nextMult - commission.tierMultiplier);
                        return (
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: nextLevel.color }}>+{fmt(deltaPerMonth)}/mo</div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{nextLevel.min - (empScore?.overall || 0)} pts to {nextLevel.name} ({nextMult}x)</div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}

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
                      { cat: "CLN Sales", qty: "\u2014", rev: commission.csDiscounted, rate: Math.round((commission.rates.cleaning_sales_rate || 0.10) * 100) + "%", comm: commission.commCS },
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
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <td colSpan={4} style={{ padding: "10px 12px", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>Base Commission</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-secondary)", fontSize: 14, fontWeight: 700 }}>{fmt(commission.baseTotal)}</td>
                    </tr>
                    {commission.tierMultiplier > 1 ? (
                      <tr style={{ borderBottom: "1px solid var(--border)", background: commission.tierColor + "08" }}>
                        <td colSpan={4} style={{ padding: "10px 12px", color: commission.tierColor, fontSize: 13, fontWeight: 700 }}>
                          {commission.tierIcon} {commission.tier} Tier Bonus ({commission.tierMultiplier}x multiplier)
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: commission.tierColor, fontSize: 14, fontWeight: 800 }}>+{fmt(commission.tierBonus)}</td>
                      </tr>
                    ) : (
                      <tr style={{ borderBottom: "1px solid var(--border)" }}>
                        <td colSpan={4} style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: 12, fontStyle: "italic" }}>
                          {"\uD83D\uDD12"} Tier multiplier unlocks at Gold (55+ pts) &mdash; {Math.max(0, 55 - (empScore?.overall || 0))} pts to go
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "var(--text-muted)", fontSize: 13 }}>$0.00</td>
                      </tr>
                    )}
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

          {/* Annual Tier Earnings Projection — the headline view */}
          {commission && commission.hasData && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{"\uD83D\uDCB0"} Annual Earnings by Tier</div>
              <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 16 }}>What sustaining each tier all year is worth — based on your current monthly base of {fmt(commission.baseTotal)}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                {[
                  { tier: "Silver", color: "#C0C0C0", icon: "\uD83E\uDD48", note: "Base rate (no multiplier)" },
                  { tier: "Gold", color: "#FFD700", icon: "\uD83E\uDD47", note: "1.25x multiplier" },
                  { tier: "Platinum", color: "#E0B0FF", icon: "\uD83D\uDC8E", note: "1.50x multiplier" },
                  { tier: "Diamond", color: "#00D4FF", icon: "\u2B50", note: "1.50x + 12 PTO days/yr" },
                ].map(function(t) {
                  var def = TIER_DEFAULTS[t.tier];
                  var monthly = commission.baseTotal * def.multiplier;
                  var annual = monthly * 12;
                  var deltaVsBase = (commission.baseTotal * def.multiplier - commission.baseTotal) * 12;
                  var isCurrent = commission.tier === t.tier;
                  return (
                    <div key={t.tier} style={{
                      ...cardInner, position: "relative",
                      border: isCurrent ? "2px solid " + t.color : "1px solid var(--border)",
                      background: isCurrent ? t.color + "10" : "var(--bg-card-inner)",
                    }}>
                      {isCurrent && <div style={{ position: "absolute", top: -8, left: 12, background: t.color, color: "#000", fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 4, textTransform: "uppercase" }}>You are here</div>}
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                        <span style={{ fontSize: 18 }}>{t.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: t.color }}>{t.tier}</span>
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#FBBF24" }}>{fmt(annual)}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>per year &middot; {fmt(monthly)}/mo</div>
                      {deltaVsBase > 0 && (
                        <div style={{ fontSize: 10, color: "#4ADE80", fontWeight: 700, marginTop: 6 }}>+{fmt(deltaVsBase)}/yr vs. Silver</div>
                      )}
                      <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4, fontStyle: "italic" }}>{t.note}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 16, padding: 12, background: "#7B2FFF08", borderRadius: 8, border: "1px solid #7B2FFF22", fontSize: 11, color: "var(--text-body)", lineHeight: 1.5 }}>
                {"\uD83D\uDCA1"} <strong style={{ color: "#7B2FFF" }}>Streak bonuses on top:</strong> 3 consecutive months at Gold or higher = <strong>$100 cash</strong>. 3 consecutive at Platinum or higher = <strong>1 PTO day</strong>. 6 Diamond months in a calendar year = <strong>permanent wall plaque</strong>.
              </div>
            </div>
          )}

          {/* Streak Progress — live tracking from tier history */}
          {streakData && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{"\uD83D\uDD25"} Streak Progress</div>
              <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 16 }}>Earn bonuses for consecutive months at Gold, Platinum, or Diamond</div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 16 }}>
                {[
                  { name: "Gold", color: "#FFD700", icon: "\uD83E\uDD47", count: streakData.streaks.gold, target: 3, reward: "$100 cash", recurring: true },
                  { name: "Platinum", color: "#E0B0FF", icon: "\uD83D\uDC8E", count: streakData.streaks.platinum, target: 3, reward: "1 PTO day", recurring: true },
                  { name: "Diamond Plaque", color: "#00D4FF", icon: "\u2B50", count: streakData.diamond_plaque.diamond_months, target: 6, reward: "Wall plaque", recurring: false, year: streakData.diamond_plaque.this_year },
                ].map(function(s) {
                  var progress = Math.min(100, (s.count / s.target) * 100);
                  var inStreak = s.count % s.target;
                  var earned = s.recurring ? Math.floor(s.count / s.target) : (s.count >= s.target ? 1 : 0);
                  var displayCount = s.recurring ? inStreak : s.count;
                  return (
                    <div key={s.name} style={{
                      ...cardInner,
                      border: "1px solid " + (s.count > 0 ? s.color + "55" : "var(--border)"),
                      background: s.count >= s.target ? s.color + "10" : "var(--bg-card-inner)",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 16 }}>{s.icon}</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: s.color }}>{s.name}</span>
                        </div>
                        {earned > 0 && s.recurring && <span style={{ fontSize: 10, fontWeight: 700, color: "#4ADE80" }}>{earned}x earned</span>}
                        {earned > 0 && !s.recurring && <span style={{ fontSize: 10, fontWeight: 700, color: "#4ADE80" }}>{"\u2705"} Earned</span>}
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text-primary)" }}>
                        {s.recurring ? displayCount : s.count} <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 500 }}>/ {s.target}</span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        {s.recurring
                          ? (inStreak === 0 && s.count > 0 ? "Bonus earned! Keep it going for the next one." : (s.target - displayCount) + " more month" + ((s.target - displayCount) === 1 ? "" : "s") + " for next bonus")
                          : (s.count >= s.target ? "Plaque earned for " + s.year : (s.target - s.count) + " more Diamond months in " + s.year)}
                      </div>
                      <div style={{ marginTop: 8, background: "var(--bg-card)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{ width: progress + "%", height: "100%", borderRadius: 4, background: s.color, transition: "width 0.3s" }} />
                      </div>
                      <div style={{ fontSize: 10, color: s.color, marginTop: 6, fontWeight: 700 }}>Reward: {s.reward}{s.recurring ? " every " + s.target + " months" : ""}</div>
                    </div>
                  );
                })}
              </div>

              {/* Last 6 months tier strip */}
              {streakData.history && streakData.history.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: 8 }}>Last 6 months</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {streakData.history.slice(0, 6).reverse().map(function(h, idx) {
                      var t = TIER_DEFAULTS[h.tier] ? h.tier : "Bronze";
                      var color = (LEVEL_THRESHOLDS.find(function(L) { return L.name === t; }) || {}).color || "#999";
                      var icon = (LEVEL_THRESHOLDS.find(function(L) { return L.name === t; }) || {}).icon || "";
                      var monthLabel = h.period ? new Date(h.period + "-15T12:00:00").toLocaleDateString([], { month: "short", year: "2-digit" }) : "";
                      return (
                        <div key={idx} style={{
                          flex: 1, minWidth: 80, padding: "10px 8px", borderRadius: 8, textAlign: "center",
                          background: color + "12", border: "1px solid " + color + "33",
                        }}>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>{monthLabel}</div>
                          <div style={{ fontSize: 18, marginTop: 2 }}>{icon}</div>
                          <div style={{ fontSize: 11, fontWeight: 800, color: color, marginTop: 2 }}>{h.tier}</div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 1 }}>{h.overall_score} pts</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {(!streakData.history || streakData.history.length === 0) && (
                <div style={{ padding: 12, background: "var(--bg-card-inner)", borderRadius: 8, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
                  No tier history yet. Your streak starts building this month.
                </div>
              )}
            </div>
          )}

          {/* What If? Commission Projector — annual framing */}
          {commission && commission.hasData && (
            <div style={{ ...card, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{"\uD83D\uDCC8"} What If? Commission Projector</div>
              <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 16 }}>Annual impact of pushing your numbers up &mdash; multiplier baked in at your current {commission.tierMultiplier}x tier</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                {[
                  { label: "+3 Phone Repairs / wk", weeklyExtra: 3 * (commission.rates.phone_repair_standard || 1), detail: "About 12 more repairs a month" },
                  { label: "+5 Phone Repairs / wk", weeklyExtra: 5 * (commission.rates.phone_repair_standard || 1), detail: "Push to 5 more per week" },
                  { label: "+$100 Accessory GP / wk", weeklyExtra: 100 * (commission.rates.accessory_gp_rate || 0.15), detail: "Upsell cases + screen protectors" },
                  { label: "+5 Cleanings / wk", weeklyExtra: 5 * 25 * (commission.rates.cleaning_rate || 0.10), detail: "5 cleanings at $25 avg" },
                  { label: "+10 Phone Repairs / wk", weeklyExtra: 10 * (commission.rates.phone_repair_standard || 1), detail: "Strong push" },
                  { label: "All of the above", weeklyExtra: 10 * (commission.rates.phone_repair_standard || 1) + 100 * (commission.rates.accessory_gp_rate || 0.15) + 5 * 25 * (commission.rates.cleaning_rate || 0.10), detail: "Maximum effort scenario" },
                ].map(function(scenario) {
                  // Scale weekly extra to annual, apply tier multiplier
                  var annualExtra = scenario.weeklyExtra * 52 * commission.tierMultiplier;
                  var weeklyExtraWithMult = scenario.weeklyExtra * commission.tierMultiplier;
                  return (
                    <div key={scenario.label} style={cardInner}>
                      <div style={{ fontSize: 11, color: "#7B2FFF", fontWeight: 700, marginBottom: 4 }}>{scenario.label}</div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: "#FBBF24" }}>+{fmt(annualExtra)}</div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>per year</div>
                      <div style={{ fontSize: 10, color: "#4ADE80", marginTop: 6, fontWeight: 700 }}>+{fmt(weeklyExtraWithMult)}/wk &middot; +{fmt(weeklyExtraWithMult * 4.33)}/mo</div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 4 }}>{scenario.detail}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
                    {allEmployees.filter(isRosterMember).sort(function(a, b) { return (b.overall || 0) - (a.overall || 0); }).map(function(e, i) {
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

              {/* Compliance Drill-Down moved to My Tickets tab — click any ticket there to see per-criterion scoring */}
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
            <div style={{ ...card, position: "relative" }}>
              <div style={{ position: "absolute", top: 12, right: 12 }}>
                <MetricTooltip title="This Week"
                  what="Total hours scheduled for the current week (Monday through Sunday)."
                  source="WhenIWork shifts assigned to you, synced nightly to the dashboard."
                  howTo="Pick up extra shifts to grow your paycheck, or pass on a shift in WhenIWork if you can't make it." />
              </div>
              <div style={metricLabel}>This Week</div>
              <div style={{ ...metricBig, fontSize: 28, color: weekHours > 40 ? "#F87171" : "var(--text-primary)" }}>{weekHours}h</div>
              {weekHours > 40 && <div style={{ fontSize: 10, color: "#F87171", fontWeight: 600, marginTop: 4 }}>OT Alert: {Math.round((weekHours - 40) * 10) / 10}h overtime</div>}
            </div>
            <div style={{ ...card, position: "relative" }}>
              <div style={{ position: "absolute", top: 12, right: 12 }}>
                <MetricTooltip title="This Month"
                  what="Total scheduled hours for the current calendar month."
                  source="WhenIWork shift data summed across all dates in this month."
                  howTo="Track your month-to-date pace. If you're under target, ask your manager about open shifts." />
              </div>
              <div style={metricLabel}>This Month</div>
              <div style={{ ...metricBig, fontSize: 28, color: "var(--text-primary)" }}>{totalHoursMonth}h</div>
            </div>
            <div style={{ ...card, position: "relative" }}>
              <div style={{ position: "absolute", top: 12, right: 12 }}>
                <MetricTooltip title="Shifts This Week"
                  what="Number of separate shifts scheduled for you this week."
                  source="WhenIWork shifts on your roster."
                  howTo="Two short shifts vs one long shift can mean different productivity — ask about consolidating if your scores are slipping mid-shift." />
              </div>
              <div style={metricLabel}>Shifts This Week</div>
              <div style={{ ...metricBig, fontSize: 28, color: "#00D4FF" }}>{weekShifts.length}</div>
            </div>
          </div>

          {/* Week schedule — day cards */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{"\uD83D\uDCC5"} Schedule — {activeWeekBounds.label}</div>
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
            {loadErrors.shifts ? (
              <div style={{ padding: 20, textAlign: "center", color: "#F87171", fontSize: 13 }}>Failed to load schedule. Tap Refresh to retry.</div>
            ) : (() => {
              // Build 7 cards for the active week (Monday → Sunday)
              var todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Indiana/Indianapolis" }); // YYYY-MM-DD
              var startDate = new Date(activeWeekBounds.start + "T12:00:00");
              var DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
              var dayCards = [];
              for (var i = 0; i < 7; i++) {
                var dt = new Date(startDate);
                dt.setDate(dt.getDate() + i);
                var iso = dt.toISOString().split("T")[0];
                var shift = weekShifts.find(function(s) {
                  return (s.shift_date || s.date || "") === iso;
                });
                var isToday = iso === todayStr;
                dayCards.push({
                  iso: iso, dayLabel: DAYS[i],
                  dateNum: dt.getDate(), monthLabel: dt.toLocaleDateString([], { month: "short" }),
                  shift: shift, isToday: isToday,
                });
              }
              return (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
                  {dayCards.map(function(d) {
                    var hasShift = !!d.shift;
                    var timeRange = hasShift ? formatShiftTime(d.shift.start_time, d.shift.end_time) : "";
                    var hours = hasShift ? parseFloat(d.shift.hours || 0).toFixed(1) : "";
                    var bg = d.isToday ? "linear-gradient(135deg, #7B2FFF18, #00D4FF12)" : hasShift ? "var(--bg-card-inner)" : "transparent";
                    var border = d.isToday ? "2px solid #7B2FFF" : hasShift ? "1px solid var(--border)" : "1px dashed var(--border)";
                    return (
                      <div key={d.iso} style={{
                        background: bg, border: border, borderRadius: 10, padding: "12px 8px",
                        textAlign: "center", minHeight: 110,
                        display: "flex", flexDirection: "column", justifyContent: "space-between",
                        position: "relative",
                      }}>
                        {d.isToday && <div style={{ position: "absolute", top: -8, left: "50%", transform: "translateX(-50%)", background: "#7B2FFF", color: "#fff", fontSize: 8, fontWeight: 800, padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Today</div>}
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: hasShift ? "var(--text-secondary)" : "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.dayLabel}</div>
                          <div style={{ fontSize: 20, fontWeight: 800, color: hasShift ? "var(--text-primary)" : "var(--text-muted)", marginTop: 2 }}>{d.dateNum}</div>
                        </div>
                        {hasShift ? (
                          <div style={{ marginTop: 6 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#00D4FF" }}>{timeRange}</div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{hours}h</div>
                          </div>
                        ) : (
                          <div style={{ fontSize: 11, color: "var(--text-faint)", fontStyle: "italic", marginTop: 6 }}>Off</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {weekShifts.length === 0 && !loadErrors.shifts && (
              <div style={{ marginTop: 14, padding: 12, textAlign: "center", color: "var(--text-muted)", fontSize: 12, background: "var(--bg-card-inner)", borderRadius: 8 }}>
                No shifts scheduled for {scheduleWeek === "next" ? "next week" : "this week"}. If this looks wrong, ask your manager to check your WhenIWork roster.
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

          {/* Device Breakdown + Fastest/Slowest + Repair Roles */}
          {filteredTickets.length > 3 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 20 }}>

              {/* Device Category Breakdown */}
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>Device Breakdown</div>
                {(function() {
                  var cats = {};
                  filteredTickets.forEach(function(t) {
                    var cat = t.device_category || "unknown";
                    if (!cats[cat]) cats[cat] = { count: 0, totalTA: 0, taCount: 0 };
                    cats[cat].count++;
                    if (t.turnaround_hours > 0) { cats[cat].totalTA += t.turnaround_hours; cats[cat].taCount++; }
                  });
                  var catIcons = { phone: "\uD83D\uDCF1", tablet: "\uD83D\uDCF1", laptop: "\uD83D\uDCBB", computer: "\uD83D\uDDA5", game_console: "\uD83C\uDFAE", watch: "\u231A", audio: "\uD83C\uDFA7", other: "\uD83D\uDD27" };
                  return Object.entries(cats).sort(function(a, b) { return b[1].count - a[1].count; }).map(function(entry) {
                    var cat = entry[0], data = entry[1];
                    var avgTA = data.taCount > 0 ? Math.round(data.totalTA / data.taCount * 10) / 10 : 0;
                    return (
                      <div key={cat} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 14 }}>{catIcons[cat] || "\uD83D\uDD27"}</span>
                          <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 500 }}>{cat.replace("_", " ")}</span>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ color: "#00D4FF", fontSize: 14, fontWeight: 700 }}>{data.count}</span>
                          {avgTA > 0 && <span style={{ color: "var(--text-muted)", fontSize: 10, marginLeft: 6 }}>{avgTA}h avg</span>}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              {/* Fastest & Slowest Repairs */}
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>Turnaround Records</div>
                {(function() {
                  var withTA = filteredTickets.filter(function(t) { return t.turnaround_hours > 0 && t.ticket_type !== "Sale"; });
                  if (withTA.length < 2) return <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Need more repair data</div>;
                  var sorted = withTA.sort(function(a, b) { return a.turnaround_hours - b.turnaround_hours; });
                  var fastest = sorted.slice(0, 3);
                  var slowest = sorted.slice(-3).reverse();
                  return (
                    <div>
                      <div style={{ fontSize: 10, color: "#4ADE80", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Fastest</div>
                      {fastest.map(function(t) {
                        return (
                          <div key={t.ticket_number + "f"} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11 }}>
                            <span style={{ color: "var(--text-body)" }}>{(t.device || "#" + t.ticket_number).substring(0, 30)}</span>
                            <span style={{ color: "#4ADE80", fontWeight: 700 }}>{t.turnaround_hours}h</span>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 10, color: "#F87171", fontWeight: 700, textTransform: "uppercase", marginTop: 10, marginBottom: 6 }}>Slowest</div>
                      {slowest.map(function(t) {
                        return (
                          <div key={t.ticket_number + "s"} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 11 }}>
                            <span style={{ color: "var(--text-body)" }}>{(t.device || "#" + t.ticket_number).substring(0, 30)}</span>
                            <span style={{ color: "#F87171", fontWeight: 700 }}>{t.turnaround_hours}h</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Repair Role Stats — repaired by vs added by */}
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 12 }}>Your Role on Tickets</div>
                {(function() {
                  var repairedCount = 0;
                  var addedCount = 0;
                  var bothCount = 0;
                  filteredTickets.forEach(function(t) {
                    var isRepairer = matchName(empName, t.employee_repaired || "");
                    var isAdder = matchName(empName, t.employee_added || "");
                    if (isRepairer && isAdder) bothCount++;
                    else if (isRepairer) repairedCount++;
                    else if (isAdder) addedCount++;
                  });
                  var total = repairedCount + addedCount + bothCount;
                  if (total === 0) return <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Role data not yet captured</div>;

                  return (
                    <div>
                      {[
                        { label: "Checked In + Repaired", count: bothCount, color: "#4ADE80", desc: "Full ticket ownership" },
                        { label: "Repaired Only", count: repairedCount, color: "#00D4FF", desc: "Someone else checked in" },
                        { label: "Added Only", count: addedCount, color: "#FBBF24", desc: "Someone else repaired" },
                      ].map(function(role) {
                        var pct = total > 0 ? Math.round(role.count / total * 100) : 0;
                        return (
                          <div key={role.label} style={{ marginBottom: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
                              <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{role.label}</span>
                              <span style={{ color: role.color, fontWeight: 700 }}>{role.count} ({pct}%)</span>
                            </div>
                            <div style={{ background: "var(--bg-card-inner)", borderRadius: 3, height: 5, overflow: "hidden" }}>
                              <div style={{ width: pct + "%", height: "100%", borderRadius: 3, background: role.color }} />
                            </div>
                            <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{role.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Ticket list */}
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>Recent Tickets</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16 }}>Click any ticket to see exactly where you gained or lost points.</div>
            {filteredTickets.length > 0 ? (
              <div style={{ maxHeight: 600, overflow: "auto" }}>
                {filteredTickets.slice(0, 50).map(function(t) {
                  var scoreColor = sc(t.overall_score || 0, 70, 50);
                  var isExpanded = expandedTicket === t.ticket_number;
                  var isSale = t.ticket_type === "Sale";
                  // All score columns are 0-100 percentages (set by the AI grader).
                  // overall_score is a weighted blend:
                  //   If payment applies: Intake 30% + Repair Notes 25% + Pickup 20% + Payment 20% + Contact 5%
                  //   If payment N/A:     Intake 30% + Repair Notes 40% + Pickup 25% +              Contact 5%
                  // Source: app/api/dialpad/tickets/route.js GRADE_PROMPT.
                  var paymentNA = t.payment_score === 100 && (t.payment_notes || "").toLowerCase().indexOf("not applicable") >= 0;
                  // Heuristic — if payment_notes wasn't returned, treat 100 with N/A wording as default applies
                  return (
                    <div key={t.ticket_number} style={{ borderBottom: "1px solid var(--border)" }}>
                      <div onClick={function(){ if (isSale) return; setExpandedTicket(isExpanded ? null : t.ticket_number); }}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", cursor: isSale ? "default" : "pointer" }}>
                        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                          {!isSale && <span style={{ fontSize: 11, color: "var(--text-muted)", width: 12 }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>}
                          {isSale && <span style={{ width: 12 }} />}
                          <div style={{ flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <a href={"https://cpr.repairq.io/admin/tickets/" + t.ticket_number} target="_blank" rel="noopener" onClick={function(e){e.stopPropagation();}} style={{ color: "#00D4FF", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>#{t.ticket_number}</a>
                              {t.ticket_type && <span style={{ padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, background: isSale ? "#FBBF2418" : t.ticket_type === "Claim" ? "#00D4FF18" : "#4ADE8018", color: isSale ? "#FBBF24" : t.ticket_type === "Claim" ? "#00D4FF" : "#4ADE80" }}>{t.ticket_type}</span>}
                              {t.device_category && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{t.device_category}</span>}
                            </div>
                            <div style={{ color: "var(--text-body)", fontSize: 12, marginTop: 2 }}>{t.device || t.customer_name || ""}</div>
                            <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 1 }}>{t.date_closed ? new Date(t.date_closed).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}{t.turnaround_hours > 0 ? " \u00B7 " + t.turnaround_hours + "h turnaround" : ""}{t.gross_profit > 0 ? " \u00B7 " + fmt(t.gross_profit) + " profit" : ""}</div>
                          </div>
                        </div>
                        <div style={{ padding: "4px 10px", borderRadius: 6, background: isSale ? "var(--bg-card-inner)" : scoreColor + "18", color: isSale ? "var(--text-muted)" : scoreColor, fontSize: 14, fontWeight: 800, minWidth: 45, textAlign: "center" }}>
                          {isSale ? "\u2014" : (t.overall_score || 0)}
                        </div>
                      </div>

                      {/* Expanded ticket detail — five categories, 0-100 scale, weights shown */}
                      {isExpanded && !isSale && (
                        <div style={{ padding: "14px 22px 18px", background: "var(--bg-card-inner)", borderRadius: 8, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>Compliance Score Breakdown</div>
                            <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Each score is 0–100 &middot; weighted into your overall</div>
                          </div>
                          {[
                            { label: "Intake / Diagnostics", val: t.diagnostics_score, weight: 30, notes: t.diagnostics_notes, what: "Issue documented, price quoted, turnaround estimate, history noted, liquid/warranty checks, planned service." },
                            { label: "Repair Notes", val: t.notes_score, weight: paymentNA ? 40 : 25, notes: t.notes_detail || t.notes_notes, what: "Pre-test, service performed, findings, communication, and post-test all documented in the repair notes." },
                            { label: "Pickup", val: t.categorization_score, weight: paymentNA ? 25 : 20, notes: t.categorization_notes, what: "Customer was contacted when ready, informed of pickup window, and the timing was logged." },
                            { label: "Payment", val: t.payment_score, weight: paymentNA ? null : 20, notes: t.payment_notes, what: paymentNA ? "Not applicable — no parts ordered or insurance claim. Auto-100." : "If parts were ordered, the down payment was collected at intake (within ~2 hrs).", skipIfNA: true },
                            { label: "Contact Info", val: t.contact_score, weight: 5, notes: t.contact_notes, what: "Full name, phone, real email; bonus for an alternate phone number." },
                          ].filter(function(s) {
                            if (s.skipIfNA && paymentNA) return false;
                            return s.val != null;
                          }).map(function(s) {
                            var color = sc(s.val || 0, 75, 50);
                            return (
                              <div key={s.label} style={{ marginBottom: 10, padding: "10px 12px", borderRadius: 6, background: "var(--bg-card)", borderLeft: "3px solid " + color }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                  <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 700 }}>
                                    {s.label}
                                    {s.weight != null && <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 500, marginLeft: 6 }}>({s.weight}% of overall)</span>}
                                  </span>
                                  <span style={{ color: color, fontSize: 16, fontWeight: 800 }}>{s.val}<span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 500 }}>/100</span></span>
                                </div>
                                <div style={{ background: "var(--bg-card-inner)", borderRadius: 3, height: 5, overflow: "hidden", marginBottom: 5 }}>
                                  <div style={{ width: (s.val || 0) + "%", height: "100%", borderRadius: 3, background: color }} />
                                </div>
                                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>{s.what}</div>
                                {s.notes && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 5, lineHeight: 1.4, fontStyle: "italic" }}>"{s.notes}"</div>}
                              </div>
                            );
                          })}
                          {paymentNA && (
                            <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "var(--bg-card)", fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>
                              Payment criterion N/A — auto-100. Repair Notes & Pickup carry slightly more weight on this ticket (40% / 25% instead of 25% / 20%).
                            </div>
                          )}

                          {/* Financials */}
                          {(t.total_collected != null || t.total_cost != null || t.gross_profit != null || t.payment_method) && (
                            <div style={{ marginTop: 14, padding: 10, background: "var(--bg-card)", borderRadius: 6 }}>
                              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Ticket Financials</div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
                                {t.total_collected != null && (
                                  <div><div style={{ fontSize: 9, color: "var(--text-muted)" }}>Total Collected</div><div style={{ fontSize: 13, fontWeight: 700, color: "#00D4FF" }}>{fmt(t.total_collected)}</div></div>
                                )}
                                {t.total_cost != null && (
                                  <div><div style={{ fontSize: 9, color: "var(--text-muted)" }}>Cost of Parts</div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-secondary)" }}>{fmt(t.total_cost)}</div></div>
                                )}
                                {t.gross_profit != null && (
                                  <div><div style={{ fontSize: 9, color: "var(--text-muted)" }}>Gross Profit</div><div style={{ fontSize: 13, fontWeight: 700, color: "#4ADE80" }}>{fmt(t.gross_profit)}</div></div>
                                )}
                                {t.discount_amount > 0 && (
                                  <div><div style={{ fontSize: 9, color: "var(--text-muted)" }}>Discount</div><div style={{ fontSize: 13, fontWeight: 700, color: "#FBBF24" }}>-{fmt(t.discount_amount)}</div></div>
                                )}
                                {t.payment_method && (
                                  <div><div style={{ fontSize: 9, color: "var(--text-muted)" }}>Payment Method</div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{t.payment_method}</div></div>
                                )}
                                {t.turnaround_hours > 0 && (
                                  <div><div style={{ fontSize: 9, color: "var(--text-muted)" }}>Turnaround</div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>{t.turnaround_hours}h</div></div>
                                )}
                              </div>
                            </div>
                          )}

                          <div style={{ marginTop: 12, fontSize: 11, color: "var(--text-muted)" }}>
                            <a href={"https://cpr.repairq.io/admin/tickets/" + t.ticket_number} target="_blank" rel="noopener" style={{ color: "#00D4FF", textDecoration: "none" }}>Open ticket #{t.ticket_number} in RepairQ \u2197</a>
                          </div>
                        </div>
                      )}
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
              {/* Call summary cards — denominators clearly labeled */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
                <div style={{ ...card, position: "relative" }}>
                  <div style={{ position: "absolute", top: 12, right: 12 }}>
                    <MetricTooltip title="Calls Audited"
                      what="Total inbound calls you took in the last 30 days that were scored by the AI auditor."
                      source="Dialpad transcripts run through the AI audit pipeline. Excludes inter-store calls, vendor calls, hangups, and other non-scorable audio."
                      howTo="Pick up the phone — every call you take is a chance to score." />
                  </div>
                  <div style={metricLabel}>Calls Audited</div>
                  <div style={{ ...metricBig, fontSize: 28, color: "var(--text-primary)" }}>{callStats.total}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                    {callStats.oppCalls} opportunity &middot; {callStats.ccCalls} repeat customer
                  </div>
                </div>
                <div style={{ ...card, position: "relative" }}>
                  <div style={{ position: "absolute", top: 12, right: 12 }}>
                    <MetricTooltip title="Avg Audit Score"
                      what="Your average score across all audited calls, on a 0–100 scale."
                      source="Each call gets scored against its rubric (opportunity calls: 4 criteria, repeat customer calls: 4 different criteria). Score is converted to a percentage."
                      howTo="Both rubrics are graded fairly — opportunity calls reward sales effort (offer the appointment, mention the warranty), repeat customer calls reward service quality (clear status, ETA, professionalism)." />
                  </div>
                  <div style={metricLabel}>Avg Audit Score</div>
                  <div style={{ ...metricBig, fontSize: 28, color: sc(callStats.avgScore, 80, 60) }}>{callStats.avgScore}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>across both call types</div>
                </div>
                <div style={{ ...card, position: "relative" }}>
                  <div style={{ position: "absolute", top: 12, right: 12 }}>
                    <MetricTooltip title="Appointment Offered"
                      what="Percentage of opportunity calls (new customers asking about a repair) where you offered to schedule them an appointment."
                      source={"Calculated only on " + callStats.oppCalls + " opportunity calls. Repeat customer calls are excluded since the appointment criterion doesn't apply to them."}
                      howTo="On every call where someone's asking about a NEW repair, end with: 'Want me to book you in today? I have an opening at [time].' One sentence, every time." />
                  </div>
                  <div style={metricLabel}>Appt Offered</div>
                  <div style={{ ...metricBig, fontSize: 28, color: callStats.apptOfferedRate == null ? "var(--text-muted)" : sc(callStats.apptOfferedRate, 80, 50) }}>
                    {callStats.apptOfferedRate == null ? "\u2014" : callStats.apptOfferedRate + "%"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                    {callStats.oppCalls > 0 ? "of " + callStats.oppCalls + " opportunity calls" : "no opportunity calls yet"}
                  </div>
                </div>
                <div style={{ ...card, position: "relative" }}>
                  <div style={{ position: "absolute", top: 12, right: 12 }}>
                    <MetricTooltip title="Warranty Mentioned"
                      what="Percentage of opportunity calls where you mentioned CPR's lifetime warranty."
                      source={"Calculated only on " + callStats.oppCalls + " opportunity calls."}
                      howTo="Add this line after every quote: 'And our repair carries a lifetime warranty on the part — if anything goes wrong, bring it back, no charge.' Converts skeptics, every time." />
                  </div>
                  <div style={metricLabel}>Warranty Mentioned</div>
                  <div style={{ ...metricBig, fontSize: 28, color: callStats.warrantyRate == null ? "var(--text-muted)" : sc(callStats.warrantyRate, 70, 40) }}>
                    {callStats.warrantyRate == null ? "\u2014" : callStats.warrantyRate + "%"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                    {callStats.oppCalls > 0 ? "of " + callStats.oppCalls + " opportunity calls" : "no opportunity calls yet"}
                  </div>
                </div>
              </div>

              {/* Opportunity calls breakdown */}
              {callStats.oppCalls > 0 && (
                <div style={{ ...card, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{"\uD83D\uDCDE"} Opportunity Call Rubric</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>For new customers asking about a repair ({callStats.oppCalls} calls)</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[
                      { label: "Appointment Offered", rate: callStats.apptOfferedRate, target: 80, tip: "Offer to schedule on every call: 'Want me to book you in today?'" },
                      { label: "Discount for Scheduling", rate: callStats.discountRate, target: 60, tip: "Mention any deal/discount tied to booking the appointment" },
                      { label: "Lifetime Warranty Mentioned", rate: callStats.warrantyRate, target: 70, tip: "Reference 'lifetime warranty' or 'warranty for life' explicitly" },
                      { label: "Faster w/ Appointment", rate: callStats.fasterTurnaroundRate, target: 60, tip: "Tell them booking = priority service: 'we can have it ready faster if you schedule'" },
                    ].map(function(item) {
                      var color = sc(item.rate || 0, item.target - 10, item.target - 30);
                      return (
                        <div key={item.label} style={cardInner}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                            <span style={{ color: color, fontSize: 18, fontWeight: 800 }}>{item.rate == null ? "\u2014" : item.rate + "%"}</span>
                          </div>
                          <div style={{ background: "var(--bg-card)", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 6 }}>
                            <div style={{ width: (item.rate || 0) + "%", height: "100%", borderRadius: 4, background: color }} />
                          </div>
                          {(item.rate || 0) < item.target && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{item.tip}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Current customer calls breakdown */}
              {callStats.ccCalls > 0 && (
                <div style={{ ...card, marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{"\uD83D\uDD04"} Repeat Customer Call Rubric</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>For customers calling about an existing repair ({callStats.ccCalls} calls)</div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {[
                      { label: "Clear Status Update", rate: callStats.statusRate, target: 85, tip: "Don't say 'let me check' — actually communicate where the repair stands" },
                      { label: "ETA Communicated", rate: callStats.etaRate, target: 80, tip: "Give a specific time: 'about an hour' or 'ready by 3pm', not 'soon'" },
                      { label: "Professional & Empathetic", rate: callStats.professionalRate, target: 90, tip: "Patient and courteous, even if the customer is frustrated" },
                      { label: "Next Steps Explained", rate: callStats.nextStepsRate, target: 85, tip: "Tell them what happens next: 'We'll call when ready' or 'Come in after 3pm'" },
                    ].map(function(item) {
                      var color = sc(item.rate || 0, item.target - 10, item.target - 30);
                      return (
                        <div key={item.label} style={cardInner}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                            <span style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                            <span style={{ color: color, fontSize: 18, fontWeight: 800 }}>{item.rate == null ? "\u2014" : item.rate + "%"}</span>
                          </div>
                          <div style={{ background: "var(--bg-card)", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 6 }}>
                            <div style={{ width: (item.rate || 0) + "%", height: "100%", borderRadius: 4, background: color }} />
                          </div>
                          {(item.rate || 0) < item.target && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{item.tip}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recent audits — click to expand */}
              <div style={card}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>Recent Call Audits</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16 }}>Click any call to see the AI's per-criterion notes — exactly where points were earned or lost.</div>
                {callStats.recent.map(function(audit, i) {
                  var asc = sc(audit.overall_score || 0, 80, 60);
                  var isExpanded = expandedCall === (audit.call_id || i);
                  var isOpp = audit.call_type === "opportunity";
                  var isCC = audit.call_type === "current_customer";

                  return (
                    <div key={audit.call_id || i} data-call-anchor={audit.call_id || ""} style={{ borderBottom: i < callStats.recent.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <div onClick={function(){ setExpandedCall(isExpanded ? null : (audit.call_id || i)); }}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", cursor: "pointer" }}>
                        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", width: 12 }}>{isExpanded ? "\u25BC" : "\u25B6"}</span>
                          <div>
                            <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>{audit.caller_name || audit.phone_number || "Unknown Caller"}</div>
                            <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
                              {audit.date_started ? new Date(audit.date_started).toLocaleDateString([], { month: "short", day: "numeric" }) : ""}
                              {audit.call_type ? " \u00B7 " + (isOpp ? "Opportunity" : isCC ? "Repeat Customer" : audit.call_type) : ""}
                              {audit.device_type && audit.device_type !== "Not mentioned" ? " \u00B7 " + audit.device_type : ""}
                            </div>
                          </div>
                        </div>
                        <div style={{ padding: "4px 10px", borderRadius: 6, background: asc + "18", color: asc, fontSize: 14, fontWeight: 800 }}>
                          {audit.overall_score || 0}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div style={{ padding: "12px 22px 16px", background: "var(--bg-card-inner)", borderRadius: 8, marginBottom: 8 }}>
                          {audit.inquiry && (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: 3 }}>Inquiry</div>
                              <div style={{ fontSize: 12, color: "var(--text-body)" }}>{audit.inquiry}</div>
                            </div>
                          )}
                          {audit.outcome && (
                            <div style={{ marginBottom: 10 }}>
                              <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: 3 }}>Outcome</div>
                              <div style={{ fontSize: 12, color: "var(--text-body)" }}>{audit.outcome}</div>
                            </div>
                          )}

                          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>Scoring Criteria</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
                            {(isOpp ? [
                              { label: "Appointment Offered", passed: audit.appt_offered, notes: audit.appt_notes },
                              { label: "Discount for Scheduling", passed: audit.discount_mentioned, notes: audit.discount_notes },
                              { label: "Lifetime Warranty Mentioned", passed: audit.warranty_mentioned, notes: audit.warranty_notes },
                              { label: "Faster w/ Appointment", passed: audit.faster_turnaround, notes: audit.turnaround_notes },
                            ] : isCC ? [
                              { label: "Clear Status Update", passed: audit.status_update_given, notes: audit.status_notes },
                              { label: "ETA Communicated", passed: audit.eta_communicated, notes: audit.eta_notes },
                              { label: "Professional & Empathetic", passed: audit.professional_tone, notes: audit.tone_notes },
                              { label: "Next Steps Explained", passed: audit.next_steps_explained, notes: audit.next_steps_notes },
                            ] : []).map(function(crit, ci) {
                              return (
                                <div key={ci} style={{
                                  padding: "8px 12px", borderRadius: 6,
                                  background: crit.passed ? "#4ADE8010" : "#F8717110",
                                  borderLeft: "3px solid " + (crit.passed ? "#4ADE80" : "#F87171"),
                                }}>
                                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                    <span style={{ fontSize: 14, color: crit.passed ? "#4ADE80" : "#F87171", fontWeight: 800 }}>{crit.passed ? "\u2713" : "\u2715"}</span>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{crit.label}</div>
                                      {crit.notes && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.4, fontStyle: "italic" }}>"{crit.notes}"</div>}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {audit.confidence != null && (
                            <div style={{ marginTop: 12, padding: 8, background: "var(--bg-card)", borderRadius: 6, fontSize: 11, color: "var(--text-muted)" }}>
                              <strong>Confidence:</strong> {audit.confidence}/100
                              {audit.confidence_reason && <span> &mdash; {audit.confidence_reason}</span>}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ ...card, padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>{"\uD83D\uDCDE"}</div>
              <div style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No Call Audits Yet</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 480, margin: "0 auto", lineHeight: 1.5 }}>
                {loadErrors.calls
                  ? "Failed to load call data. Tap Refresh to retry."
                  : "Call audits show up here once the AI has reviewed your inbound calls. New audits typically appear within a few hours of taking the call. If you've taken calls recently and nothing is appearing, check with your manager — your name in Dialpad may not match your roster name."}
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
                <div style={{ color: "var(--text-body)", fontSize: 13, lineHeight: 1.75 }}>
                  {(function() {
                    // Inline parser for **bold** and [text](url) links.
                    // Internal links use #call:CALL_ID — clicking jumps to My Calls and expands.
                    function inline(str, lineKey) {
                      var nodes = [];
                      var rest = str;
                      var i = 0;
                      while (rest.length > 0) {
                        var linkM = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/);
                        var boldM = !linkM ? rest.match(/^\*\*([^*]+)\*\*/) : null;
                        if (linkM) {
                          var label = linkM[1], target = linkM[2];
                          if (target.indexOf("#call:") === 0) {
                            var callId = target.substring(6);
                            nodes.push(
                              <button key={lineKey + "-" + (i++)}
                                onClick={function(){ setSubTab("calls"); setExpandedCall(callId); setTimeout(function(){
                                  var el = document.querySelector("[data-call-anchor='" + callId + "']");
                                  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
                                }, 150); }}
                                style={{ display: "inline", padding: "1px 6px", borderRadius: 4, border: "1px solid #00D4FF55", background: "#00D4FF14", color: "#00D4FF", fontSize: 12, fontWeight: 700, cursor: "pointer", margin: "0 1px" }}>
                                {"\uD83D\uDCDE "}{label}
                              </button>
                            );
                          } else {
                            nodes.push(
                              <a key={lineKey + "-" + (i++)} href={target} target="_blank" rel="noopener"
                                style={{ display: "inline", padding: "1px 6px", borderRadius: 4, border: "1px solid #FBBF2455", background: "#FBBF2414", color: "#FBBF24", fontSize: 12, fontWeight: 700, textDecoration: "none", margin: "0 1px" }}>
                                {"\uD83C\uDFAB "}{label}{" \u2197"}
                              </a>
                            );
                          }
                          rest = rest.substring(linkM[0].length);
                        } else if (boldM) {
                          nodes.push(<strong key={lineKey + "-" + (i++)} style={{ color: "var(--text-primary)" }}>{boldM[1]}</strong>);
                          rest = rest.substring(boldM[0].length);
                        } else {
                          // Take everything up to the next [ or **
                          var nextSpecial = rest.search(/\[|\*\*/);
                          if (nextSpecial < 0) { nodes.push(<span key={lineKey + "-" + (i++)}>{rest}</span>); break; }
                          if (nextSpecial === 0) { nodes.push(<span key={lineKey + "-" + (i++)}>{rest.charAt(0)}</span>); rest = rest.substring(1); }
                          else { nodes.push(<span key={lineKey + "-" + (i++)}>{rest.substring(0, nextSpecial)}</span>); rest = rest.substring(nextSpecial); }
                        }
                      }
                      return nodes;
                    }

                    var lines = String(coachingInsight).split("\n");
                    return lines.map(function(line, idx) {
                      var trimmed = line.trim();
                      if (!trimmed) return <div key={"l" + idx} style={{ height: 8 }} />;
                      if (trimmed.indexOf("## ") === 0) {
                        return <div key={"l" + idx} style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)", marginTop: 14, marginBottom: 6 }}>{inline(trimmed.substring(3), "l" + idx)}</div>;
                      }
                      if (trimmed.indexOf("# ") === 0) {
                        return <div key={"l" + idx} style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", marginTop: 12, marginBottom: 6 }}>{inline(trimmed.substring(2), "l" + idx)}</div>;
                      }
                      return <div key={"l" + idx} style={{ marginBottom: 4 }}>{inline(line, "l" + idx)}</div>;
                    });
                  })()}
                </div>
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--text-muted)" }}>
                  {"\uD83D\uDCA1"} Click any <span style={{ color: "#00D4FF", fontWeight: 700 }}>📞 Call</span> link to jump to that audit on the My Calls tab. <span style={{ color: "#FBBF24", fontWeight: 700 }}>🎫 Ticket</span> links open RepairQ.
                </div>
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

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

export default function MyPerformanceTab({ auth, store }) {
  var [subTab, setSubTab] = useState("dashboard");
  var [loading, setLoading] = useState(true);
  var [empScore, setEmpScore] = useState(null);
  var [salesData, setSalesData] = useState(null);
  var [commConfig, setCommConfig] = useState({ rates: {}, config: {} });
  var [shifts, setShifts] = useState([]);
  var [tickets, setTickets] = useState([]);
  var [weeklyGoal, setWeeklyGoal] = useState(null);
  var [storeScore, setStoreScore] = useState(null);
  var [allEmployees, setAllEmployees] = useState([]);
  var [callData, setCallData] = useState(null);

  var empName = auth?.userInfo?.name || "";
  var empStore = store || auth?.userInfo?.store || "";

  useEffect(function() {
    if (!empName) return;
    loadData();
  }, [empName, empStore]);

  var loadData = async function() {
    setLoading(true);
    try {
      var now = new Date();
      var monthStart = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01";
      var shiftEnd = now.toISOString().split("T")[0];
      // Go back 90 days for shifts
      var shiftStartDate = new Date(); shiftStartDate.setDate(shiftStartDate.getDate() - 90);
      var shiftStart = shiftStartDate.toISOString().split("T")[0];

      var results = await Promise.allSettled([
        fetch("/api/dialpad/scorecard").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/sales?action=performance").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/sales?action=commission_config").then(function(r) { return r.json(); }),
        fetch("/api/wheniwork?action=stored-shifts&start=" + shiftStart + "&end=" + shiftEnd).then(function(r) { return r.json(); }),
        fetch("/api/dialpad/tickets?action=employee_tickets&employee=" + encodeURIComponent(empName) + "&days=60").then(function(r) { return r.json(); }),
        fetch("/api/dialpad/weekly-goal?store=" + empStore).then(function(r) { return r.json(); }),
        fetch("/api/dialpad/stored").then(function(r) { return r.json(); }),
      ]);

      // Scorecard — find this employee
      if (results[0].status === "fulfilled" && results[0].value) {
        var scData = results[0].value;
        var emps = scData.employeeScores || [];
        setAllEmployees(emps);
        var me = emps.find(function(e) { return e.name && e.name.toLowerCase() === empName.toLowerCase(); });
        if (me) setEmpScore(me);
        // Store score
        if (scData.scores && scData.scores[empStore]) setStoreScore(scData.scores[empStore]);
      }

      if (results[1].status === "fulfilled") setSalesData(results[1].value);
      if (results[2].status === "fulfilled" && results[2].value.rates) setCommConfig(results[2].value);

      // Shifts — filter to this employee
      if (results[3].status === "fulfilled" && results[3].value.shifts) {
        var myShifts = results[3].value.shifts.filter(function(s) {
          return s.employee_name && s.employee_name.toLowerCase() === empName.toLowerCase();
        });
        setShifts(myShifts);
      }

      if (results[4].status === "fulfilled" && results[4].value.tickets) setTickets(results[4].value.tickets);
      if (results[5].status === "fulfilled" && results[5].value.goal) setWeeklyGoal(results[5].value.goal);
      if (results[6].status === "fulfilled") setCallData(results[6].value);
    } catch(e) { console.error("MyPerformanceTab load error:", e); }
    setLoading(false);
  };

  // ═══ COMPUTED DATA ═══

  // Commission calculation (mirrors SalesTab logic)
  var commission = useMemo(function() {
    if (!salesData || !empName) return null;
    var rates = commConfig.rates || {};
    var config = commConfig.config || {};
    function isEnabled(key) { return config[key] !== false; }

    // Find employee in each sales array
    var findEmp = function(arr) {
      return (arr || []).find(function(e) { return e.employee && e.employee.toLowerCase() === empName.toLowerCase(); });
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

    return {
      phoneTickets: phoneTickets, phoneTotal: phoneTotal, commPhone: commPhone,
      otherCount: otherCount, otherTotal: otherTotal, commOther: commOther,
      accyGP: accyGP, accyCount: accyCount, commAccy: commAccy,
      cleanCount: cleanCount, cleanTotal: cleanTotal, commClean: commClean,
      csDiscounted: csDiscounted, commCS: commCS,
      total: total, totalRevenue: phoneTotal + otherTotal + accyGP + cleanTotal + csDiscounted,
      rates: rates,
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

  // This week's shifts
  var weekShifts = useMemo(function() {
    var now = new Date();
    var weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    var weekStartStr = weekStart.toISOString().split("T")[0];
    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    var weekEndStr = weekEnd.toISOString().split("T")[0];
    return shifts.filter(function(s) {
      var d = s.shift_date || s.date || "";
      return d >= weekStartStr && d < weekEndStr;
    }).sort(function(a, b) { return (a.shift_date || a.date || "").localeCompare(b.shift_date || b.date || ""); });
  }, [shifts]);

  var weekHours = useMemo(function() {
    return Math.round(weekShifts.reduce(function(s, sh) { return s + (parseFloat(sh.hours) || 0); }, 0) * 10) / 10;
  }, [weekShifts]);

  // Peer ranking
  var myRank = useMemo(function() {
    if (!empScore || !allEmployees.length) return null;
    var sorted = allEmployees.filter(function(e) { return e.hasData; }).sort(function(a, b) { return (b.overall || 0) - (a.overall || 0); });
    var idx = sorted.findIndex(function(e) { return e.name && e.name.toLowerCase() === empName.toLowerCase(); });
    return idx >= 0 ? { rank: idx + 1, total: sorted.length } : null;
  }, [empScore, allEmployees, empName]);

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
    { id: "coaching", label: "Coaching", icon: "\uD83C\uDFAF" },
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
      <div style={{ display: "flex", gap: 4, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(function(t) {
          var active = subTab === t.id;
          return <button key={t.id} onClick={function() { setSubTab(t.id); }}
            style={{ padding: "8px 14px", borderRadius: 8, border: active ? "1px solid #7B2FFF" : "1px solid var(--border)", background: active ? "#7B2FFF18" : "transparent", color: active ? "#7B2FFF" : "var(--text-secondary)", fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            {t.icon} {t.label}
          </button>;
        })}
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
            {commission && (
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

            {!commission && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Sales data not yet imported for this period.</div>
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

              {/* Peer comparison */}
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
                      var isMe = e.name && e.name.toLowerCase() === empName.toLowerCase();
                      return (
                        <tr key={e.name} style={{ borderBottom: "1px solid var(--border)", background: isMe ? "#7B2FFF12" : "transparent" }}>
                          <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>{i + 1}</td>
                          <td style={{ padding: "8px 10px", color: isMe ? "#7B2FFF" : "var(--text-primary)", fontSize: 13, fontWeight: isMe ? 700 : 500 }}>{isMe ? e.name + " (you)" : e.name}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: sc(e.overall || 0, 70, 50), fontSize: 14, fontWeight: 700 }}>{e.overall || 0}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>{e.repairs?.total_repairs || 0}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>{e.audit?.avg_pct || e.audit?.score || 0}</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", color: "var(--text-secondary)", fontSize: 12 }}>{e.compliance?.score || 0}</td>
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

          {/* This week's shifts */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>This Week's Schedule</div>
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
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No shifts scheduled this week.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ MY TICKETS ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "tickets" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
            <div style={card}>
              <div style={metricLabel}>Tickets Graded</div>
              <div style={{ ...metricBig, fontSize: 28, color: "var(--text-primary)" }}>{tickets.length}</div>
            </div>
            <div style={card}>
              <div style={metricLabel}>Avg Score</div>
              <div style={{ ...metricBig, fontSize: 28, color: sc(tickets.length > 0 ? Math.round(tickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / tickets.length) : 0, 70, 50) }}>
                {tickets.length > 0 ? Math.round(tickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / tickets.length) : 0}
              </div>
            </div>
            <div style={card}>
              <div style={metricLabel}>Avg Turnaround</div>
              <div style={{ ...metricBig, fontSize: 28, color: "#00D4FF" }}>
                {(function() {
                  var withTA = tickets.filter(function(t) { return t.turnaround_hours > 0; });
                  return withTA.length > 0 ? (Math.round(withTA.reduce(function(s, t) { return s + t.turnaround_hours; }, 0) / withTA.length * 10) / 10) + "h" : "—";
                })()}
              </div>
            </div>
            <div style={card}>
              <div style={metricLabel}>Avg GPM</div>
              <div style={{ ...metricBig, fontSize: 28, color: "#4ADE80" }}>
                {(function() {
                  var withGPM = tickets.filter(function(t) { return t.gpm_pct > 0; });
                  return withGPM.length > 0 ? Math.round(withGPM.reduce(function(s, t) { return s + t.gpm_pct; }, 0) / withGPM.length) + "%" : "—";
                })()}
              </div>
            </div>
          </div>

          {/* Ticket list */}
          <div style={card}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>Recent Tickets</div>
            {tickets.length > 0 ? (
              <div style={{ maxHeight: 500, overflow: "auto" }}>
                {tickets.slice(0, 50).map(function(t) {
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
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>No ticket data available yet.</div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══ COACHING ═══ */}
      {/* ═══════════════════════════════════════════════ */}
      {subTab === "coaching" && (
        <div>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #FF2D95, #7B2FFF)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{"\uD83C\uDFAF"}</div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>Your Growth Path</div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Personalized coaching based on your performance data</div>
              </div>
            </div>

            {empScore && (
              <div>
                {/* Identify weakest area */}
                {(function() {
                  var areas = [
                    { name: "Repairs", score: empScore.repairs?.score || 0, tip: "Focus on upselling accessories with every repair. Each accessory adds to your GP and commission. Target: offer a screen protector or case with every screen repair." },
                    { name: "Phone Audit", score: empScore.audit?.avg_pct || empScore.audit?.score || 0, tip: "When answering calls, follow the script: greet, identify the device & issue, quote a price, give turnaround time, and offer to book an appointment. Every missed element costs points." },
                    { name: "Compliance", score: empScore.compliance?.score || 0, tip: "Before closing any ticket, check: (1) Is the issue + price + turnaround documented in diagnostics? (2) Did you add repair notes describing what was done? (3) Was the customer notified about completion?" },
                  ];
                  var weakest = areas.sort(function(a, b) { return a.score - b.score; })[0];
                  var strongest = areas.sort(function(a, b) { return b.score - a.score; })[0];

                  return (
                    <div>
                      <div style={{ ...cardInner, marginBottom: 12, borderLeft: "3px solid #F87171" }}>
                        <div style={{ fontSize: 10, color: "#F87171", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Focus Area: {weakest.name} ({weakest.score}/100)</div>
                        <div style={{ color: "var(--text-body)", fontSize: 13, lineHeight: 1.6 }}>{weakest.tip}</div>
                      </div>
                      <div style={{ ...cardInner, borderLeft: "3px solid #4ADE80" }}>
                        <div style={{ fontSize: 10, color: "#4ADE80", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Your Strength: {strongest.name} ({strongest.score}/100)</div>
                        <div style={{ color: "var(--text-body)", fontSize: 13, lineHeight: 1.6 }}>Keep it up! You're performing well in {strongest.name}. Share your approach with teammates to help the whole store improve.</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {!empScore && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Performance data needed to generate coaching recommendations.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

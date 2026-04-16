'use client';

import { useState, useEffect, useMemo } from "react";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);
var fmt = function(v) { var n = parseFloat(v) || 0; var neg = n < 0; return (neg ? "(" : "") + "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (neg ? ")" : ""); };
var fmtPct = function(v) { return ((parseFloat(v) || 0) * 100).toFixed(1) + "%"; };
var pctColor = function(v) { var p = parseFloat(v) || 0; return p >= 0.6 ? "#4ADE80" : p >= 0.4 ? "#FBBF24" : p >= 0 ? "#FB923C" : "#F87171"; };
var profitColor = function(v) { return parseFloat(v) >= 0 ? "#4ADE80" : "#F87171"; };

// ═══ COMPUTE FUNCTION ═══
function compute(r) {
  if (!r) r = {};
  var g = function(k) { return parseFloat(r[k]) || 0; };

  // Revenue by category
  var accyRev = g("accessory_revenue"), accyCogs = g("accessory_cogs");
  var devRev = g("device_revenue"), devCogs = g("device_cogs");
  var repRev = g("repair_revenue"), repCogs = g("repair_cogs");
  var partsRev = g("parts_revenue"), partsCogs = g("parts_cogs");
  var svcRev = g("services_revenue"), svcCogs = g("services_cogs");
  var promoRev = g("promotions_revenue"), promoCogs = g("promotions_cogs");

  var grossRev = accyRev + devRev + repRev + partsRev + svcRev + promoRev;
  var totalCogs = accyCogs + devCogs + repCogs + partsCogs + svcCogs + promoCogs;
  var grossProfit = grossRev - totalCogs;
  var gpm = grossRev > 0 ? grossProfit / grossRev : 0;

  // Expenses
  var rent = g("rent");
  var payroll = g("payroll");
  var corporateOverhead = g("corporate_overhead");
  var internet = g("internet_security"), electric = g("electric"), gas = g("gas_parking"), voip = g("voip");
  var utilities = internet + electric + gas + voip;
  var mktDigital = g("marketing_digital"), mktLocal = g("marketing_local");
  var marketing = mktDigital + mktLocal;
  var storeBudget = g("store_budget");
  var damaged = g("damaged"), shrinkage = g("shrinkage"), voided = g("voided");
  var controllables = damaged + shrinkage + voided;
  var kbb = g("kbb_charges"), tips = g("tips"), lcd = g("lcd_credits"), ccFee = g("cc_fee_diff");
  var otherExpenses = kbb + tips + lcd + ccFee + storeBudget;
  var totalExpenses = rent + payroll + corporateOverhead + utilities + marketing + storeBudget + controllables + kbb + tips + lcd + ccFee;

  // Fees
  var royaltyRate = g("royalty_rate") || 0.05;
  var royalties = grossRev * royaltyRate;
  var adFee = g("cpr_ad_fee") || 285;
  var techFee = g("cpr_tech_fee") || 95;
  var totalFees = royalties + adFee + techFee;

  var profitLessFees = grossProfit - totalFees;
  var netProfit = profitLessFees - totalExpenses;
  var netMargin = grossRev > 0 ? netProfit / grossRev : 0;

  // Labor
  var hours = g("hours_worked");
  var revPerHour = hours > 0 ? grossRev / hours : 0;
  var profPerHour = hours > 0 ? grossProfit / hours : 0;

  return {
    accyRev: accyRev, accyCogs: accyCogs, accyProfit: accyRev - accyCogs, accyGpm: accyRev > 0 ? (accyRev - accyCogs) / accyRev : 0,
    devRev: devRev, devCogs: devCogs, repRev: repRev, repCogs: repCogs,
    partsRev: partsRev, partsCogs: partsCogs, svcRev: svcRev, svcCogs: svcCogs,
    promoRev: promoRev, promoCogs: promoCogs,
    repProfit: repRev - repCogs, repGpm: repRev > 0 ? (repRev - repCogs) / repRev : 0,
    grossRev: grossRev, totalCogs: totalCogs, grossProfit: grossProfit, gpm: gpm,
    rent: rent, payroll: payroll, corporateOverhead: corporateOverhead, utilities: utilities, marketing: marketing,
    controllables: controllables, otherExpenses: otherExpenses, totalExpenses: totalExpenses,
    royalties: royalties, adFee: adFee, techFee: techFee, totalFees: totalFees,
    profitLessFees: profitLessFees, netProfit: netProfit, netMargin: netMargin,
    hours: hours, revPerHour: revPerHour, profPerHour: profPerHour,
    storeBudget: storeBudget, kbb: kbb, tips: tips, lcd: lcd, ccFee: ccFee,
    damaged: damaged, shrinkage: shrinkage, voided: voided,
  };
}

// ═══ MAIN COMPONENT ═══
export default function ProfitabilityTab() {
  var [period, setPeriod] = useState(function() {
    var now = new Date(); return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  });
  var [periods, setPeriods] = useState([]);
  var [records, setRecords] = useState({});
  var [loading, setLoading] = useState(true);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState(null);
  var [editStore, setEditStore] = useState(null);
  var [payrollResult, setPayrollResult] = useState(null);
  var [payrollImporting, setPayrollImporting] = useState(false);

  var loadData = async function() {
    setLoading(true);
    try {
      var [recRes, perRes] = await Promise.all([
        fetch("/api/dialpad/profitability?action=get&period=" + period).then(function(r){return r.json();}),
        fetch("/api/dialpad/profitability?action=periods").then(function(r){return r.json();}),
      ]);
      if (recRes.success) {
        var map = {};
        (recRes.records || []).forEach(function(r) { map[r.store] = r; });
        setRecords(map);
      }
      if (perRes.success) {
        var p = perRes.periods || [];
        if (p.indexOf(period) < 0) p = [period].concat(p);
        p.sort().reverse();
        setPeriods(p);
      }
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  useEffect(function() { loadData(); }, [period]);

  var saveStore = async function(store, data) {
    setSaving(true);
    try {
      var payload = Object.assign({ action: "save", period: period, store: store }, data);
      var res = await fetch("/api/dialpad/profitability", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var json = await res.json();
      if (json.success) { setMsg({ type: "success", text: STORES[store].name + " saved" }); loadData(); }
      else setMsg({ type: "error", text: json.error });
    } catch(e) { setMsg({ type: "error", text: e.message }); }
    setSaving(false);
    setTimeout(function() { setMsg(null); }, 3000);
  };

  var copyForward = async function() {
    var prevMonth = new Date(parseInt(period.split("-")[0]), parseInt(period.split("-")[1]) - 2, 1);
    var prevPeriod = prevMonth.getFullYear() + "-" + String(prevMonth.getMonth() + 1).padStart(2, "0");
    var prevLabel = prevMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (!confirm("Copy expenses from " + prevLabel + "?\n\nRevenue fields will be zeroed — only fixed expenses carry forward.")) return;
    var res = await fetch("/api/dialpad/profitability", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "copy_forward", from_period: prevPeriod, to_period: period }),
    });
    var json = await res.json();
    if (json.success) { setMsg({ type: "success", text: "Copied from " + prevLabel }); loadData(); }
    else setMsg({ type: "error", text: json.error || "Nothing to copy" });
  };

  var handlePayrollImport = async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    setPayrollImporting(true); setPayrollResult(null);
    try {
      var fd = new FormData(); fd.append("file", file);
      var res = await fetch("/api/dialpad/extract-payroll", { method: "POST", body: fd });
      var json = await res.json();
      if (json.success) {
        setPayrollResult(json);
        setMsg({ type: "success", text: "Payroll parsed: $" + (json.totals.distributed_total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 }) + " distributed across stores." });
      } else {
        setMsg({ type: "error", text: json.error || "Payroll import failed" });
      }
    } catch (err) { setMsg({ type: "error", text: err.message }); }
    setPayrollImporting(false); e.target.value = "";
  };

  var applyPayroll = async function() {
    if (!payrollResult || !payrollResult.distribution) return;
    setSaving(true);
    var d = payrollResult.distribution;
    // Split corporate overhead evenly across stores
    var corporatePerStore = d.corporate > 0 ? Math.round(d.corporate / STORE_KEYS.length * 100) / 100 : 0;
    // Save payroll + corporate overhead to each store
    for (var i = 0; i < STORE_KEYS.length; i++) {
      var sk = STORE_KEYS[i];
      var existing = records[sk] || {};
      var payload = Object.assign({ action: "save", period: period, store: sk }, existing, {
        payroll: d[sk] || 0,
        corporate_overhead: corporatePerStore,
      });
      await fetch("/api/dialpad/profitability", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    setMsg({ type: "success", text: "Payroll applied — Fishers: $" + (d.fishers || 0).toLocaleString() + " | Bloomington: $" + (d.bloomington || 0).toLocaleString() + " | Indianapolis: $" + (d.indianapolis || 0).toLocaleString() + (d.corporate > 0 ? " | Corporate OH: $" + d.corporate.toLocaleString() + " ($" + corporatePerStore.toLocaleString() + "/store)" : "") });
    setPayrollResult(null);
    loadData();
    setSaving(false);
  };

  // Computed data per store
  var sd = {};
  STORE_KEYS.forEach(function(k) { sd[k] = compute(records[k]); });

  // Company totals
  var co = useMemo(function() {
    var t = {};
    var keys = Object.keys(sd[STORE_KEYS[0]] || {});
    keys.forEach(function(k) { t[k] = 0; STORE_KEYS.forEach(function(sk) { t[k] += (sd[sk] || {})[k] || 0; }); });
    // Recalculate ratios
    t.gpm = t.grossRev > 0 ? t.grossProfit / t.grossRev : 0;
    t.netMargin = t.grossRev > 0 ? t.netProfit / t.grossRev : 0;
    t.repGpm = t.repRev > 0 ? t.repProfit / t.repRev : 0;
    t.accyGpm = t.accyRev > 0 ? t.accyProfit / t.accyRev : 0;
    t.revPerHour = t.hours > 0 ? t.grossRev / t.hours : 0;
    t.profPerHour = t.hours > 0 ? t.grossProfit / t.hours : 0;
    return t;
  }, [records, period]);

  var periodLabel = period ? new Date(parseInt(period.split("-")[0]), parseInt(period.split("-")[1]) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>Loading...</div>;

  // ═══ TABLE HELPERS ═══
  var cs = { padding: "7px 12px", fontSize: 12, borderBottom: "1px solid #1E2028" };
  var hc = Object.assign({}, cs, { color: "#8B8F98", fontSize: 10, textTransform: "uppercase", fontWeight: 700 });

  function Row(props) {
    var label = props.label;
    var values = props.values; // array of numbers for each store + company
    var color = props.color || "#F0F1F3";
    var bold = props.bold;
    var indent = props.indent;
    var isPct = props.isPct;
    var bg = props.bg || "transparent";
    var borderTop = props.borderTop;
    return (
      <tr style={{ background: bg, borderTop: borderTop || "none" }}>
        <td style={Object.assign({}, cs, { color: indent ? "#8B8F98" : color, fontWeight: bold ? 800 : indent ? 400 : 600, paddingLeft: indent ? 28 : 12, fontSize: bold ? 13 : 12 })}>{label}</td>
        {values.map(function(v, i) {
          var c = isPct ? pctColor(v) : (typeof color === "function" ? color(v) : color);
          return <td key={i} style={Object.assign({}, cs, { textAlign: "right", color: c, fontWeight: bold ? 800 : 600, fontSize: bold ? 13 : 12 })}>{isPct ? fmtPct(v) : fmt(v)}</td>;
        })}
      </tr>
    );
  }

  function SectionRow(props) {
    return (
      <tr><td colSpan={STORE_KEYS.length + 2} style={{ padding: "14px 12px 6px", fontSize: 11, color: props.color || "#7B2FFF", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", borderBottom: "1px solid " + (props.color || "#7B2FFF") + "22", background: (props.color || "#7B2FFF") + "06" }}>{props.label}</td></tr>
    );
  }

  function vals(key) {
    var arr = STORE_KEYS.map(function(k) { return sd[k][key] || 0; });
    arr.push(co[key] || 0);
    return arr;
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select value={period} onChange={function(e) { setPeriod(e.target.value); }}
            style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #2A2D35", background: "#1A1D23", color: "#F0F1F3", fontSize: 13 }}>
            {periods.map(function(p) {
              var label = new Date(parseInt(p.split("-")[0]), parseInt(p.split("-")[1]) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
              return <option key={p} value={p}>{label}</option>;
            })}
          </select>
          <span style={{ color: "#F0F1F3", fontSize: 18, fontWeight: 800 }}>Profit & Loss</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #00D4FF33", background: "#00D4FF08", color: "#00D4FF", fontSize: 11, cursor: payrollImporting ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {payrollImporting ? "Processing payroll..." : "\uD83D\uDCCB Import Payroll PDF"}
            <input type="file" accept=".pdf" onChange={handlePayrollImport} disabled={payrollImporting} style={{ display: "none" }} />
          </label>
          <button onClick={copyForward} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #2A2D35", background: "#1A1D23", color: "#8B8F98", fontSize: 11, cursor: "pointer" }}>
            Copy Last Month's Expenses
          </button>
        </div>
      </div>

      {msg && <div style={{ padding: "8px 14px", borderRadius: 8, marginBottom: 16, background: msg.type === "success" ? "#4ADE8012" : "#F8717112", border: "1px solid " + (msg.type === "success" ? "#4ADE8033" : "#F8717133"), color: msg.type === "success" ? "#4ADE80" : "#F87171", fontSize: 12 }}>{msg.text}</div>}

      {/* Payroll Distribution Preview */}
      {payrollResult && payrollResult.distribution && (
        <div style={{ background: "#1A1D23", borderRadius: 14, padding: 24, marginBottom: 20, border: "1px solid #00D4FF33" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ color: "#00D4FF", fontSize: 14, fontWeight: 800 }}>{"\uD83D\uDCCB"} Payroll Distribution Preview</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={function() { setPayrollResult(null); }}
                style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #2A2D35", background: "transparent", color: "#8B8F98", fontSize: 11, cursor: "pointer" }}>Cancel</button>
              <button onClick={applyPayroll} disabled={saving}
                style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "#00D4FF", color: "#12141A", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                {saving ? "Applying..." : "Apply to All Stores"}
              </button>
            </div>
          </div>

          {payrollResult.pay_period && (
            <div style={{ color: "#6B6F78", fontSize: 10, marginBottom: 12 }}>Pay Period: {payrollResult.pay_period.start} to {payrollResult.pay_period.end} | {payrollResult.shifts_found} schedule shifts matched</div>
          )}

          {/* Store distribution summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 16 }}>
            {STORE_KEYS.map(function(sk) {
              var st = STORES[sk];
              return (
                <div key={sk} style={{ background: "#12141A", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid " + st.color + "22" }}>
                  <div style={{ color: st.color, fontSize: 11, fontWeight: 700, marginBottom: 4 }}>{st.name.replace("CPR ", "")}</div>
                  <div style={{ color: "#F0F1F3", fontSize: 20, fontWeight: 800 }}>{"$" + (payrollResult.distribution[sk] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              );
            })}
            {payrollResult.distribution.corporate > 0 && (
              <div style={{ background: "#12141A", borderRadius: 8, padding: 14, textAlign: "center", border: "1px solid #7B2FFF22" }}>
                <div style={{ color: "#7B2FFF", fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Corporate</div>
                <div style={{ color: "#F0F1F3", fontSize: 20, fontWeight: 800 }}>{"$" + payrollResult.distribution.corporate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            )}
          </div>

          {/* Employee breakdown */}
          <div style={{ background: "#12141A", borderRadius: 8, padding: 14 }}>
            <div style={{ color: "#8B8F98", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Employee Breakdown</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #2A2D35" }}>
                  {["Employee", "Hours", "Total Expense", "Method", "Fishers", "Bloom.", "Indy", "Corp."].map(function(h, i) {
                    return <th key={i} style={{ padding: "4px 6px", textAlign: i < 1 ? "left" : "right", color: "#6B6F78", fontSize: 9, fontWeight: 700 }}>{h}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {payrollResult.employees.map(function(e, i) {
                  var methodColor = e.method === "schedule" ? "#4ADE80" : e.method === "area_manager" ? "#7B2FFF" : e.method === "roster" ? "#00D4FF" : "#FBBF24";
                  var methodLabel = e.method === "schedule" ? "Schedule" : e.method === "area_manager" ? "Area Mgr" : e.method === "roster" ? "Roster" : "Unassigned";
                  return (
                    <tr key={i} style={{ borderBottom: "1px solid #1E2028" }}>
                      <td style={{ padding: "4px 6px", color: "#F0F1F3", fontSize: 11, fontWeight: 600 }}>{e.name}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: "#8B8F98", fontSize: 11 }}>{e.hours}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: "#F0F1F3", fontSize: 11, fontWeight: 600 }}>{"$" + e.total_expense.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}><span style={{ padding: "2px 6px", borderRadius: 4, background: methodColor + "18", color: methodColor, fontSize: 9, fontWeight: 600 }}>{methodLabel}</span></td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: e.fishers > 0 ? "#F0F1F3" : "#2A2D35", fontSize: 10 }}>{e.fishers > 0 ? "$" + e.fishers.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: e.bloomington > 0 ? "#F0F1F3" : "#2A2D35", fontSize: 10 }}>{e.bloomington > 0 ? "$" + e.bloomington.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: e.indianapolis > 0 ? "#F0F1F3" : "#2A2D35", fontSize: 10 }}>{e.indianapolis > 0 ? "$" + e.indianapolis.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", color: e.corporate > 0 ? "#7B2FFF" : "#2A2D35", fontSize: 10 }}>{e.corporate > 0 ? "$" + e.corporate.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Unassigned warning */}
          {payrollResult.unassigned && payrollResult.unassigned.length > 0 && (
            <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6, background: "#FBBF2412", border: "1px solid #FBBF2433", color: "#FBBF24", fontSize: 11 }}>
              {"\u26A0\uFE0F"} {payrollResult.unassigned.length} employee(s) could not be matched to a store schedule. Assign them manually or check WhenIWork data.
            </div>
          )}
        </div>
      )}

      {/* Store entry buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {STORE_KEYS.map(function(k) {
          var st = STORES[k];
          var hasData = records[k] && ((parseFloat(records[k].repair_revenue) || 0) > 0 || (parseFloat(records[k].rent) || 0) > 0);
          return <button key={k} onClick={function() { setEditStore(editStore === k ? null : k); }}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid " + (editStore === k ? st.color + "55" : hasData ? "#4ADE8033" : "#2A2D35"), background: editStore === k ? st.color + "12" : "transparent", color: editStore === k ? st.color : hasData ? "#4ADE80" : "#8B8F98", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {hasData && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80" }} />}
            {st.name.replace("CPR ", "")} {editStore === k ? "(editing)" : ""}
          </button>;
        })}
      </div>

      {/* Edit form */}
      {editStore && (
        <StoreForm store={editStore} data={records[editStore] || {}} period={period}
          onSave={function(data) { saveStore(editStore, data); }} saving={saving} />
      )}

      {/* ═══ P&L STATEMENT ═══ */}
      <div style={{ background: "#1A1D23", borderRadius: 14, overflow: "hidden", marginTop: editStore ? 20 : 0 }}>
        <div style={{ padding: "16px 16px 8px", borderBottom: "1px solid #2A2D35" }}>
          <div style={{ color: "#F0F1F3", fontSize: 15, fontWeight: 800 }}>{periodLabel} — Profit & Loss Statement</div>
          <div style={{ color: "#6B6F78", fontSize: 10, marginTop: 2 }}>Focused Technologies — All Stores</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={Object.assign({}, hc, { textAlign: "left", width: 220 })}></th>
              {STORE_KEYS.map(function(k) {
                return <th key={k} style={Object.assign({}, hc, { textAlign: "right", color: STORES[k].color })}>{STORES[k].name.replace("CPR ", "")}</th>;
              })}
              <th style={Object.assign({}, hc, { textAlign: "right", color: "#F0F1F3" })}>Company</th>
            </tr>
          </thead>
          <tbody>
            {/* ── REVENUE ── */}
            <SectionRow label="Revenue" />
            <Row label="Repair Revenue" values={vals("repRev")} indent />
            <Row label="Accessory Revenue" values={vals("accyRev")} indent />
            <Row label="Device Revenue" values={vals("devRev")} indent />
            <Row label="Parts Revenue" values={vals("partsRev")} indent />
            <Row label="Services Revenue" values={vals("svcRev")} indent />
            {co.promoRev > 0 && <Row label="Promotions Revenue" values={vals("promoRev")} indent />}
            <Row label="Gross Revenue" values={vals("grossRev")} bold bg="#12141A" />

            {/* ── COGS ── */}
            <SectionRow label="Cost of Goods Sold" color="#FB923C" />
            <Row label="Repair COGS" values={vals("repCogs")} indent color="#FB923C" />
            <Row label="Accessory COGS" values={vals("accyCogs")} indent color="#FB923C" />
            <Row label="Other COGS" values={STORE_KEYS.map(function(k) { return sd[k].devCogs + sd[k].partsCogs + sd[k].svcCogs + sd[k].promoCogs; }).concat([co.devCogs + co.partsCogs + co.svcCogs + co.promoCogs])} indent color="#FB923C" />
            <Row label="Total COGS" values={vals("totalCogs")} bold bg="#12141A" color="#FB923C" />

            {/* ── GROSS PROFIT ── */}
            <Row label="Gross Profit" values={vals("grossProfit")} bold bg="#4ADE8008" color={profitColor} borderTop="2px solid #4ADE8033" />
            <Row label="Gross Margin" values={vals("gpm")} isPct bg="#4ADE8008" />

            {/* ── KEY MARGINS ── */}
            <SectionRow label="Category Margins" color="#00D4FF" />
            <Row label="Repair GPM" values={vals("repGpm")} isPct indent />
            <Row label="Accessory GPM" values={vals("accyGpm")} isPct indent />

            {/* ── OPERATING EXPENSES ── */}
            <SectionRow label="Operating Expenses" color="#F87171" />
            <Row label="Rent" values={vals("rent")} indent color="#F87171" />
            <Row label="Payroll" values={vals("payroll")} indent color="#F87171" />
            <Row label="Corporate Overhead" values={vals("corporateOverhead")} indent color="#7B2FFF" />
            <Row label="Utilities" values={vals("utilities")} indent color="#F87171" />
            <Row label="Marketing" values={vals("marketing")} indent color="#F87171" />
            <Row label="Store Controllables" values={vals("controllables")} indent color="#F87171" />
            <Row label="Other" values={vals("otherExpenses")} indent color="#F87171" />
            <Row label="Total Operating Expenses" values={vals("totalExpenses")} bold bg="#12141A" color="#F87171" />

            {/* ── FEES & ROYALTIES ── */}
            <SectionRow label="Fees & Royalties" color="#FB923C" />
            <Row label="Royalties (5%)" values={vals("royalties")} indent color="#FB923C" />
            <Row label="CPR National Ad Fee" values={vals("adFee")} indent color="#FB923C" />
            <Row label="CPR Tech Fee" values={vals("techFee")} indent color="#FB923C" />
            <Row label="Total Fees" values={vals("totalFees")} bold bg="#12141A" color="#FB923C" />

            {/* ── NET PROFIT ── */}
            <Row label="Profit Less Fees" values={vals("profitLessFees")} color={profitColor} bg="#1E202833" />
            <tr style={{ background: "linear-gradient(90deg, #7B2FFF08, #00D4FF08)", borderTop: "2px solid #7B2FFF44" }}>
              <td style={Object.assign({}, cs, { fontWeight: 900, fontSize: 15, color: "#F0F1F3", padding: "12px" })}>NET PROFIT</td>
              {STORE_KEYS.map(function(k) {
                return <td key={k} style={Object.assign({}, cs, { textAlign: "right", fontWeight: 900, fontSize: 15, color: profitColor(sd[k].netProfit), padding: "12px" })}>{fmt(sd[k].netProfit)}</td>;
              })}
              <td style={Object.assign({}, cs, { textAlign: "right", fontWeight: 900, fontSize: 15, color: profitColor(co.netProfit), padding: "12px" })}>{fmt(co.netProfit)}</td>
            </tr>
            <Row label="Net Margin" values={vals("netMargin")} isPct bg="#7B2FFF06" />

            {/* ── LABOR ── */}
            <SectionRow label="Labor Benchmarks" color="#00D4FF" />
            <Row label="Hours Worked" values={vals("hours")} indent color="#8B8F98" />
            <Row label="Revenue / Man Hour" values={vals("revPerHour")} indent />
            <Row label="Profit / Man Hour" values={vals("profPerHour")} indent />
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══ STORE ENTRY FORM ═══
function StoreForm({ store, data, period, onSave, saving }) {
  var [form, setForm] = useState({});
  var [extracting, setExtracting] = useState(false);
  var [extractMsg, setExtractMsg] = useState(null);
  var [extractedRows, setExtractedRows] = useState(null);

  useEffect(function() { setForm(Object.assign({}, data)); }, [store, data]);

  var set = function(key, val) { setForm(function(prev) { var n = Object.assign({}, prev); n[key] = val; return n; }); };

  // Recompute category sums from rows
  var recomputeFromRows = function(rows) {
    var cats = { accessory_revenue:0, accessory_cogs:0, device_revenue:0, device_cogs:0, repair_revenue:0, repair_cogs:0, parts_revenue:0, parts_cogs:0, services_revenue:0, services_cogs:0, promotions_revenue:0, promotions_cogs:0 };
    rows.forEach(function(row) {
      var item = (row.item || "").toLowerCase().trim();
      var ns = parseFloat(row.net_sales) || 0;
      var cogs = parseFloat(row.cogs) || 0;
      if (item.startsWith("accessory")) { cats.accessory_revenue += ns; cats.accessory_cogs += cogs; }
      else if (item.startsWith("repair")) { cats.repair_revenue += ns; cats.repair_cogs += cogs; }
      else if (item.startsWith("device")) { cats.device_revenue += ns; cats.device_cogs += cogs; }
      else if (item.startsWith("part")) { cats.parts_revenue += ns; cats.parts_cogs += cogs; }
      else if (item.startsWith("service")) { cats.services_revenue += ns; cats.services_cogs += cogs; }
      else if (item.startsWith("promotion")) { cats.promotions_revenue += ns; cats.promotions_cogs += cogs; }
    });
    Object.keys(cats).forEach(function(k) { cats[k] = Math.round(cats[k] * 100) / 100; });
    return cats;
  };

  var applyRows = function(rows) {
    var cats = recomputeFromRows(rows);
    var newForm = Object.assign({}, form);
    Object.keys(cats).forEach(function(k) { newForm[k] = cats[k]; });
    setForm(newForm);
    setExtractedRows(null);
    setExtractMsg({ type: "success", text: "\u2705 Applied! Review the revenue/COGS fields below and save." });
  };

  var updateRow = function(idx, field, val) {
    setExtractedRows(function(prev) {
      var next = prev.map(function(r, i) {
        if (i !== idx) return r;
        var updated = Object.assign({}, r);
        updated[field] = parseFloat(val) || 0;
        return updated;
      });
      return next;
    });
  };

  var handleExtractFromImage = async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    setExtracting(true); setExtractMsg(null); setExtractedRows(null);
    try {
      var fd = new FormData(); fd.append("image", file);
      var res = await fetch("/api/dialpad/extract-profitability", { method: "POST", body: fd });
      var json = await res.json();
      if (json.success && json.rows && json.rows.length > 0) {
        setExtractedRows(json.rows);
        var v = json.verification || {};
        setExtractMsg({ type: "info", text: v.rows_extracted + " rows extracted. Review each row below against your RepairQ report, correct any misreads, then click Apply." });
      } else if (json.success && json.data) {
        // Fallback if no rows returned
        var newForm = Object.assign({}, form);
        Object.keys(json.data).forEach(function(k) { if (json.data[k] !== undefined) newForm[k] = json.data[k]; });
        setForm(newForm);
        setExtractMsg({ type: "warning", text: "Extracted but no row detail available. Review numbers carefully." });
      } else { setExtractMsg({ type: "error", text: json.error || "Failed" }); }
    } catch(err) { setExtractMsg({ type: "error", text: err.message }); }
    setExtracting(false); e.target.value = "";
  };

  var storeName = STORES[store] ? STORES[store].name : store;
  var storeColor = STORES[store] ? STORES[store].color : "#7B2FFF";
  var inputStyle = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #2A2D35", background: "#12141A", color: "#F0F1F3", fontSize: 12, outline: "none", boxSizing: "border-box", textAlign: "right" };
  var labelStyle = { color: "#8B8F98", fontSize: 9, display: "block", marginBottom: 2 };

  function field(label, key) {
    return (<div>
      <label style={labelStyle}>{label}</label>
      <input type="number" step="0.01" value={form[key] || ""} onChange={function(e) { set(key, e.target.value); }} placeholder="0.00" style={inputStyle} />
    </div>);
  }

  return (
    <div style={{ background: "#1A1D23", borderRadius: 14, padding: 24, border: "1px solid " + storeColor + "33" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ color: storeColor, fontSize: 16, fontWeight: 800 }}>{storeName} — {period}</div>
        <button onClick={function() { onSave(form); }} disabled={saving}
          style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: saving ? "#6B6F78" : "#7B2FFF", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Revenue */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ color: "#7B2FFF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Revenue & COGS (from RepairQ)</div>
          <label style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #7B2FFF33", background: "#7B2FFF12", color: "#7B2FFF", fontSize: 11, fontWeight: 600, cursor: extracting ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {extracting ? "Reading screenshot..." : "\uD83D\uDCF7 Import from Screenshot"}
            <input type="file" accept="image/*" onChange={handleExtractFromImage} disabled={extracting} style={{ display: "none" }} />
          </label>
        </div>
        {extractMsg && <div style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 8, background: extractMsg.type === "success" ? "#4ADE8012" : extractMsg.type === "warning" ? "#FBBF2412" : extractMsg.type === "info" ? "#7B2FFF12" : "#F8717112", border: "1px solid " + (extractMsg.type === "success" ? "#4ADE8033" : extractMsg.type === "warning" ? "#FBBF2433" : extractMsg.type === "info" ? "#7B2FFF33" : "#F8717133"), color: extractMsg.type === "success" ? "#4ADE80" : extractMsg.type === "warning" ? "#FBBF24" : extractMsg.type === "info" ? "#7B2FFF" : "#F87171", fontSize: 11 }}>{extractMsg.text}</div>}

        {/* Row review table */}
        {extractedRows && extractedRows.length > 0 && (
          <div style={{ marginBottom: 16, background: "#12141A", borderRadius: 10, padding: 16, border: "1px solid #7B2FFF22" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ color: "#7B2FFF", fontSize: 11, fontWeight: 700 }}>{"\uD83D\uDD0D"} VERIFY EXTRACTED ROWS — Fix any misreads, then Apply</div>
              <button onClick={function() { applyRows(extractedRows); }}
                style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "#7B2FFF", color: "#FFF", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                Apply to Form
              </button>
            </div>
            <div style={{ color: "#6B6F78", fontSize: 9, marginBottom: 8 }}>Tip: Use PNG screenshots instead of JPG for better accuracy. Compare each row against your RepairQ report.</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #2A2D35" }}>
                  <th style={{ padding: "6px 8px", textAlign: "left", color: "#8B8F98", fontSize: 9, fontWeight: 700 }}>ITEM TYPE</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", color: "#8B8F98", fontSize: 9, fontWeight: 700 }}>NET SALES</th>
                  <th style={{ padding: "6px 8px", textAlign: "right", color: "#8B8F98", fontSize: 9, fontWeight: 700 }}>COGS</th>
                </tr>
              </thead>
              <tbody>
                {extractedRows.map(function(row, idx) {
                  return (
                    <tr key={idx} style={{ borderBottom: "1px solid #1E2028" }}>
                      <td style={{ padding: "4px 8px", color: "#C8CAD0", fontSize: 11 }}>{row.item}</td>
                      <td style={{ padding: "4px 4px" }}>
                        <input type="number" step="0.01" value={row.net_sales} onChange={function(e) { updateRow(idx, "net_sales", e.target.value); }}
                          style={{ width: "100%", padding: "4px 6px", borderRadius: 4, border: "1px solid #2A2D35", background: "#1A1D23", color: "#4ADE80", fontSize: 11, textAlign: "right", outline: "none", boxSizing: "border-box" }} />
                      </td>
                      <td style={{ padding: "4px 4px" }}>
                        <input type="number" step="0.01" value={row.cogs} onChange={function(e) { updateRow(idx, "cogs", e.target.value); }}
                          style={{ width: "100%", padding: "4px 6px", borderRadius: 4, border: "1px solid #2A2D35", background: "#1A1D23", color: "#F87171", fontSize: 11, textAlign: "right", outline: "none", boxSizing: "border-box" }} />
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ borderTop: "2px solid #7B2FFF44" }}>
                  <td style={{ padding: "6px 8px", color: "#F0F1F3", fontSize: 11, fontWeight: 700 }}>Computed Total</td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "#4ADE80", fontSize: 11, fontWeight: 700 }}>
                    {"$" + extractedRows.reduce(function(s, r) { return s + (parseFloat(r.net_sales) || 0); }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: "6px 8px", textAlign: "right", color: "#F87171", fontSize: 11, fontWeight: 700 }}>
                    {"$" + extractedRows.reduce(function(s, r) { return s + (parseFloat(r.cogs) || 0); }, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
          {[
            { l: "Accessory Revenue", k: "accessory_revenue" }, { l: "Accessory COGS", k: "accessory_cogs" },
            { l: "Repair Revenue", k: "repair_revenue" }, { l: "Repair COGS", k: "repair_cogs" },
            { l: "Device Revenue", k: "device_revenue" }, { l: "Device COGS", k: "device_cogs" },
            { l: "Parts Revenue", k: "parts_revenue" }, { l: "Parts COGS", k: "parts_cogs" },
            { l: "Services Revenue", k: "services_revenue" }, { l: "Services COGS", k: "services_cogs" },
            { l: "Promotions Revenue", k: "promotions_revenue" }, { l: "Promotions COGS", k: "promotions_cogs" },
          ].map(function(f) { return <div key={f.k}>{field(f.l, f.k)}</div>; })}
        </div>
      </div>

      {/* Expenses */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: "#F87171", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.08em" }}>Expenses</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
          {[
            { l: "Rent", k: "rent" }, { l: "Payroll", k: "payroll" }, { l: "Corporate OH", k: "corporate_overhead" },
            { l: "Internet/Security/Dialpad", k: "internet_security" }, { l: "Electric", k: "electric" },
            { l: "Gas/Parking", k: "gas_parking" }, { l: "VOIP", k: "voip" },
            { l: "Marketing Digital", k: "marketing_digital" }, { l: "Marketing Local", k: "marketing_local" },
            { l: "Store Budget", k: "store_budget" }, { l: "Damaged", k: "damaged" },
            { l: "Shrinkage", k: "shrinkage" }, { l: "Voided", k: "voided" },
            { l: "KBB Charges", k: "kbb_charges" }, { l: "Tips", k: "tips" },
            { l: "LCD Credits", k: "lcd_credits" }, { l: "CC Fee Diff", k: "cc_fee_diff" },
          ].map(function(f) { return <div key={f.k}>{field(f.l, f.k)}</div>; })}
        </div>
      </div>

      {/* Labor */}
      <div>
        <div style={{ color: "#00D4FF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.08em" }}>Labor</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {field("Hours Worked", "hours_worked")}
          {field("Revenue/Hour Goal", "revenue_per_hour_goal")}
          {field("Profit/Hour Goal", "profit_per_hour_goal")}
        </div>
      </div>
    </div>
  );
}

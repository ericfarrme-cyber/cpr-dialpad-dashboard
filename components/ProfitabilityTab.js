'use client';

import { useState, useEffect, useMemo } from "react";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);
var fmt = function(v) { return "$" + (parseFloat(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var fmtPct = function(v) { return ((parseFloat(v) || 0) * 100).toFixed(1) + "%"; };
var pctColor = function(v) { var p = parseFloat(v) || 0; return p >= 0.6 ? "#4ADE80" : p >= 0.4 ? "#FBBF24" : p >= 0 ? "#FB923C" : "#F87171"; };
var profitColor = function(v) { return parseFloat(v) >= 0 ? "#4ADE80" : "#F87171"; };

export default function ProfitabilityTab() {
  var [period, setPeriod] = useState(function() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  });
  var [periods, setPeriods] = useState([]);
  var [records, setRecords] = useState({});
  var [loading, setLoading] = useState(true);
  var [saving, setSaving] = useState(false);
  var [msg, setMsg] = useState(null);
  var [editStore, setEditStore] = useState(null);

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
      if (json.success) {
        setMsg({ type: "success", text: STORES[store].name + " saved" });
        loadData();
      } else {
        setMsg({ type: "error", text: json.error });
      }
    } catch(e) { setMsg({ type: "error", text: e.message }); }
    setSaving(false);
    setTimeout(function() { setMsg(null); }, 3000);
  };

  var copyForward = async function() {
    var prevMonth = new Date(parseInt(period.split("-")[0]), parseInt(period.split("-")[1]) - 2, 1);
    var prevPeriod = prevMonth.getFullYear() + "-" + String(prevMonth.getMonth() + 1).padStart(2, "0");
    var prevLabel = prevMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    if (!confirm("Copy expenses from " + prevLabel + " to this month?\n\nRevenue fields will be zeroed out — only fixed expenses carry forward.")) return;
    var res = await fetch("/api/dialpad/profitability", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "copy_forward", from_period: prevPeriod, to_period: period }),
    });
    var json = await res.json();
    if (json.success) { setMsg({ type: "success", text: "Copied expenses from " + prevLabel }); loadData(); }
    else setMsg({ type: "error", text: json.error || "Nothing to copy" });
  };

  // Compute totals
  var compute = function(r) {
    if (!r) r = {};
    var accyRev = parseFloat(r.accessory_revenue) || 0;
    var accyCogs = parseFloat(r.accessory_cogs) || 0;
    var devRev = parseFloat(r.device_revenue) || 0;
    var devCogs = parseFloat(r.device_cogs) || 0;
    var repRev = parseFloat(r.repair_revenue) || 0;
    var repCogs = parseFloat(r.repair_cogs) || 0;
    var partsRev = parseFloat(r.parts_revenue) || 0;
    var partsCogs = parseFloat(r.parts_cogs) || 0;
    var svcRev = parseFloat(r.services_revenue) || 0;
    var svcCogs = parseFloat(r.services_cogs) || 0;
    var promoRev = parseFloat(r.promotions_revenue) || 0;
    var promoCogs = parseFloat(r.promotions_cogs) || 0;

    var grossRev = accyRev + devRev + repRev + partsRev + svcRev + promoRev;
    var totalCogs = accyCogs + devCogs + repCogs + partsCogs + svcCogs + promoCogs;
    var grossProfit = grossRev - totalCogs;
    var gpm = grossRev > 0 ? grossProfit / grossRev : 0;

    // Expenses
    var rent = parseFloat(r.rent) || 0;
    var payroll = parseFloat(r.payroll) || 0;
    var internet = parseFloat(r.internet_security) || 0;
    var electric = parseFloat(r.electric) || 0;
    var gas = parseFloat(r.gas_parking) || 0;
    var voip = parseFloat(r.voip) || 0;
    var utilities = internet + electric + gas + voip;
    var mktDigital = parseFloat(r.marketing_digital) || 0;
    var mktLocal = parseFloat(r.marketing_local) || 0;
    var marketing = mktDigital + mktLocal;
    var storeBudget = parseFloat(r.store_budget) || 0;
    var damaged = parseFloat(r.damaged) || 0;
    var shrinkage = parseFloat(r.shrinkage) || 0;
    var voided = parseFloat(r.voided) || 0;
    var controllables = damaged + shrinkage + voided;
    var kbb = parseFloat(r.kbb_charges) || 0;
    var tips = parseFloat(r.tips) || 0;
    var lcd = parseFloat(r.lcd_credits) || 0;
    var ccFee = parseFloat(r.cc_fee_diff) || 0;
    var totalExpenses = rent + payroll + utilities + marketing + storeBudget + controllables + kbb + tips + lcd + ccFee;

    // Fees
    var royaltyRate = parseFloat(r.royalty_rate) || 0.05;
    var royalties = grossRev * royaltyRate;
    var adFee = parseFloat(r.cpr_ad_fee) || 285;
    var techFee = parseFloat(r.cpr_tech_fee) || 95;
    var totalFees = royalties + adFee + techFee + ccFee;
    var profitLessFees = grossProfit - royalties - adFee - techFee;
    var netProfit = profitLessFees - totalExpenses;

    // Labor
    var hours = parseFloat(r.hours_worked) || 0;
    var revPerHour = hours > 0 ? grossRev / hours : 0;
    var profPerHour = hours > 0 ? grossProfit / hours : 0;

    return {
      grossRev: grossRev, totalCogs: totalCogs, grossProfit: grossProfit, gpm: gpm,
      accyProfit: accyRev - accyCogs, accyGpm: accyRev > 0 ? (accyRev - accyCogs) / accyRev : 0,
      devProfit: devRev - devCogs, devGpm: devRev > 0 ? (devRev - devCogs) / devRev : 0,
      repProfit: repRev - repCogs, repGpm: repRev > 0 ? (repRev - repCogs) / repRev : 0,
      partsProfit: partsRev - partsCogs, partsGpm: partsRev > 0 ? (partsRev - partsCogs) / partsRev : 0,
      svcProfit: svcRev - svcCogs,
      rent: rent, payroll: payroll, utilities: utilities, marketing: marketing,
      storeBudget: storeBudget, controllables: controllables, totalExpenses: totalExpenses,
      royalties: royalties, adFee: adFee, techFee: techFee, totalFees: totalFees,
      profitLessFees: profitLessFees, netProfit: netProfit,
      hours: hours, revPerHour: revPerHour, profPerHour: profPerHour,
      kbb: kbb, tips: tips, lcd: lcd, ccFee: ccFee,
    };
  };

  var storeData = {};
  STORE_KEYS.forEach(function(k) { storeData[k] = compute(records[k]); });

  // Company totals
  var companyTotals = useMemo(function() {
    var t = {};
    var keys = Object.keys(storeData.fishers || {});
    keys.forEach(function(k) {
      if (k.includes("gpm") || k.includes("Gpm") || k === "revPerHour" || k === "profPerHour") return;
      t[k] = 0;
      STORE_KEYS.forEach(function(sk) { t[k] += (storeData[sk] || {})[k] || 0; });
    });
    t.gpm = t.grossRev > 0 ? t.grossProfit / t.grossRev : 0;
    t.revPerHour = t.hours > 0 ? t.grossRev / t.hours : 0;
    t.profPerHour = t.hours > 0 ? t.grossProfit / t.hours : 0;
    return t;
  }, [records, period]);

  var periodLabel = period ? new Date(parseInt(period.split("-")[0]), parseInt(period.split("-")[1]) - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : "";

  var cellStyle = { padding: "8px 10px", fontSize: 12, borderBottom: "1px solid #1E2028" };
  var headerCell = Object.assign({}, cellStyle, { color: "#8B8F98", fontSize: 10, textTransform: "uppercase", fontWeight: 700 });
  var labelCell = Object.assign({}, cellStyle, { color: "#C8CAD0", fontWeight: 600 });
  var numCell = function(v, color) { return Object.assign({}, cellStyle, { textAlign: "right", color: color || "#F0F1F3", fontWeight: 600 }); };
  var sectionHeader = function(text) {
    return { padding: "12px 10px 6px", fontSize: 11, color: "#7B2FFF", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid #7B2FFF22", background: "#7B2FFF06" };
  };

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>Loading profitability data...</div>;

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
          <span style={{ color: "#F0F1F3", fontSize: 16, fontWeight: 800 }}>{periodLabel} Profitability</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={copyForward} style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #2A2D35", background: "#1A1D23", color: "#8B8F98", fontSize: 11, cursor: "pointer" }}>
            Copy Last Month's Expenses
          </button>
        </div>
      </div>

      {msg && <div style={{ padding: "8px 14px", borderRadius: 8, marginBottom: 16, background: msg.type === "success" ? "#4ADE8012" : "#F8717112", border: "1px solid " + (msg.type === "success" ? "#4ADE8033" : "#F8717133"), color: msg.type === "success" ? "#4ADE80" : "#F87171", fontSize: 12 }}>{msg.text}</div>}

      {/* Store entry buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {STORE_KEYS.map(function(k) {
          var st = STORES[k];
          var hasData = records[k] && (records[k].repair_revenue > 0 || records[k].rent > 0);
          return <button key={k} onClick={function() { setEditStore(editStore === k ? null : k); }}
            style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid " + (editStore === k ? st.color + "55" : hasData ? "#4ADE8033" : "#2A2D35"), background: editStore === k ? st.color + "12" : "transparent", color: editStore === k ? st.color : hasData ? "#4ADE80" : "#8B8F98", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {hasData && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80" }} />}
            {st.name.replace("CPR ", "")} {editStore === k ? "(editing)" : ""}
          </button>;
        })}
      </div>

      {/* Edit form for selected store */}
      {editStore && (
        <StoreForm
          store={editStore}
          data={records[editStore] || {}}
          period={period}
          onSave={function(data) { saveStore(editStore, data); }}
          saving={saving}
        />
      )}

      {/* Summary table */}
      <div style={{ background: "#1A1D23", borderRadius: 14, overflow: "hidden", marginTop: editStore ? 20 : 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={Object.assign({}, headerCell, { textAlign: "left", width: 200 })}>Category</th>
              {STORE_KEYS.map(function(k) {
                return <th key={k} style={Object.assign({}, headerCell, { textAlign: "right", color: STORES[k].color })}>{STORES[k].name.replace("CPR ", "")}</th>;
              })}
              <th style={Object.assign({}, headerCell, { textAlign: "right", color: "#F0F1F3" })}>Company</th>
            </tr>
          </thead>
          <tbody>
            {/* Revenue */}
            <tr><td colSpan={STORE_KEYS.length + 2} style={sectionHeader()}>Revenue & Gross Profit</td></tr>
            {[
              { label: "Accessory Revenue", key: "accessory_revenue" },
              { label: "Accessory Profit", computed: "accyProfit" },
              { label: "Accessory GPM", computed: "accyGpm", isPct: true },
              { label: "Repair Revenue", key: "repair_revenue" },
              { label: "Repair Profit", computed: "repProfit" },
              { label: "Repair GPM", computed: "repGpm", isPct: true },
              { label: "Device Revenue", key: "device_revenue" },
              { label: "Parts Revenue", key: "parts_revenue" },
              { label: "Services Revenue", key: "services_revenue" },
            ].map(function(row) {
              return (
                <tr key={row.label}>
                  <td style={labelCell}>{row.label}</td>
                  {STORE_KEYS.map(function(k) {
                    var val = row.computed ? storeData[k][row.computed] : parseFloat((records[k] || {})[row.key]) || 0;
                    var color = row.isPct ? pctColor(val) : row.computed && row.computed.includes("Profit") ? profitColor(val) : "#F0F1F3";
                    return <td key={k} style={numCell(val, color)}>{row.isPct ? fmtPct(val) : fmt(val)}</td>;
                  })}
                  <td style={numCell(0, "#F0F1F3")}>
                    {row.isPct ? fmtPct(companyTotals[row.computed] || 0) : fmt(row.computed ? companyTotals[row.computed] || 0 : STORE_KEYS.reduce(function(s, k) { return s + (parseFloat((records[k] || {})[row.key]) || 0); }, 0))}
                  </td>
                </tr>
              );
            })}

            {/* Gross totals */}
            <tr style={{ background: "#12141A" }}>
              <td style={Object.assign({}, labelCell, { fontWeight: 800, color: "#F0F1F3" })}>Gross Revenue</td>
              {STORE_KEYS.map(function(k) { return <td key={k} style={numCell(0, "#F0F1F3")}><strong>{fmt(storeData[k].grossRev)}</strong></td>; })}
              <td style={numCell(0, "#F0F1F3")}><strong>{fmt(companyTotals.grossRev)}</strong></td>
            </tr>
            <tr style={{ background: "#12141A" }}>
              <td style={Object.assign({}, labelCell, { fontWeight: 800, color: "#4ADE80" })}>Gross Profit</td>
              {STORE_KEYS.map(function(k) { return <td key={k} style={numCell(0, profitColor(storeData[k].grossProfit))}><strong>{fmt(storeData[k].grossProfit)}</strong></td>; })}
              <td style={numCell(0, profitColor(companyTotals.grossProfit))}><strong>{fmt(companyTotals.grossProfit)}</strong></td>
            </tr>
            <tr style={{ background: "#12141A" }}>
              <td style={Object.assign({}, labelCell, { fontWeight: 800 })}>GPM</td>
              {STORE_KEYS.map(function(k) { return <td key={k} style={numCell(0, pctColor(storeData[k].gpm))}><strong>{fmtPct(storeData[k].gpm)}</strong></td>; })}
              <td style={numCell(0, pctColor(companyTotals.gpm))}><strong>{fmtPct(companyTotals.gpm)}</strong></td>
            </tr>

            {/* Expenses */}
            <tr><td colSpan={STORE_KEYS.length + 2} style={sectionHeader()}>Expenses</td></tr>
            {[
              { label: "Rent", key: "rent" },
              { label: "Payroll", key: "payroll" },
              { label: "Utilities", computed: "utilities" },
              { label: "Marketing", computed: "marketing" },
              { label: "Store Budget", key: "store_budget" },
              { label: "Controllables", computed: "controllables" },
              { label: "KBB Charges", key: "kbb_charges" },
              { label: "Tips", key: "tips" },
              { label: "LCD Credits", key: "lcd_credits" },
              { label: "CC Fee Diff", key: "cc_fee_diff" },
            ].map(function(row) {
              return (
                <tr key={row.label}>
                  <td style={labelCell}>{row.label}</td>
                  {STORE_KEYS.map(function(k) {
                    var val = row.computed ? storeData[k][row.computed] : parseFloat((records[k] || {})[row.key]) || 0;
                    return <td key={k} style={numCell(val, "#F87171")}>{fmt(val)}</td>;
                  })}
                  <td style={numCell(0, "#F87171")}>{fmt(row.computed ? companyTotals[row.computed] || 0 : STORE_KEYS.reduce(function(s, k) { return s + (parseFloat((records[k] || {})[row.key]) || 0); }, 0))}</td>
                </tr>
              );
            })}
            <tr style={{ background: "#12141A" }}>
              <td style={Object.assign({}, labelCell, { fontWeight: 800, color: "#F87171" })}>Total Expenses</td>
              {STORE_KEYS.map(function(k) { return <td key={k} style={numCell(0, "#F87171")}><strong>{fmt(storeData[k].totalExpenses)}</strong></td>; })}
              <td style={numCell(0, "#F87171")}><strong>{fmt(companyTotals.totalExpenses)}</strong></td>
            </tr>

            {/* Fees & Net Profit */}
            <tr><td colSpan={STORE_KEYS.length + 2} style={sectionHeader()}>Fees, Royalties & Net Profit</td></tr>
            {[
              { label: "Royalties (5%)", computed: "royalties" },
              { label: "CPR National Ad Fee", computed: "adFee" },
              { label: "CPR Tech Fee", computed: "techFee" },
            ].map(function(row) {
              return (
                <tr key={row.label}>
                  <td style={labelCell}>{row.label}</td>
                  {STORE_KEYS.map(function(k) { return <td key={k} style={numCell(0, "#FB923C")}>{fmt(storeData[k][row.computed])}</td>; })}
                  <td style={numCell(0, "#FB923C")}>{fmt(companyTotals[row.computed])}</td>
                </tr>
              );
            })}
            <tr style={{ background: "#12141A" }}>
              <td style={Object.assign({}, labelCell, { fontWeight: 800 })}>Profit Less Fees</td>
              {STORE_KEYS.map(function(k) { return <td key={k} style={numCell(0, profitColor(storeData[k].profitLessFees))}><strong>{fmt(storeData[k].profitLessFees)}</strong></td>; })}
              <td style={numCell(0, profitColor(companyTotals.profitLessFees))}><strong>{fmt(companyTotals.profitLessFees)}</strong></td>
            </tr>
            <tr style={{ background: "#7B2FFF08", borderTop: "2px solid #7B2FFF33" }}>
              <td style={Object.assign({}, labelCell, { fontWeight: 900, fontSize: 14, color: "#F0F1F3" })}>NET PROFIT</td>
              {STORE_KEYS.map(function(k) {
                return <td key={k} style={Object.assign({}, numCell(0), { fontSize: 14, fontWeight: 900, color: profitColor(storeData[k].netProfit) })}>{fmt(storeData[k].netProfit)}</td>;
              })}
              <td style={Object.assign({}, numCell(0), { fontSize: 14, fontWeight: 900, color: profitColor(companyTotals.netProfit) })}>{fmt(companyTotals.netProfit)}</td>
            </tr>

            {/* Labor */}
            <tr><td colSpan={STORE_KEYS.length + 2} style={sectionHeader()}>Labor Benchmarks</td></tr>
            <tr>
              <td style={labelCell}>Hours Worked</td>
              {STORE_KEYS.map(function(k) { return <td key={k} style={numCell(0, "#8B8F98")}>{(storeData[k].hours || 0).toLocaleString()}</td>; })}
              <td style={numCell(0, "#8B8F98")}>{companyTotals.hours.toLocaleString()}</td>
            </tr>
            <tr>
              <td style={labelCell}>Revenue / Man Hour</td>
              {STORE_KEYS.map(function(k) {
                var goal = parseFloat((records[k] || {}).revenue_per_hour_goal) || 100;
                var actual = storeData[k].revPerHour;
                return <td key={k} style={numCell(0, actual >= goal ? "#4ADE80" : "#FBBF24")}>{fmt(actual)}</td>;
              })}
              <td style={numCell(0, "#F0F1F3")}>{fmt(companyTotals.revPerHour)}</td>
            </tr>
            <tr>
              <td style={labelCell}>Profit / Man Hour</td>
              {STORE_KEYS.map(function(k) {
                var goal = parseFloat((records[k] || {}).profit_per_hour_goal) || 45;
                var actual = storeData[k].profPerHour;
                return <td key={k} style={numCell(0, actual >= goal ? "#4ADE80" : "#FBBF24")}>{fmt(actual)}</td>;
              })}
              <td style={numCell(0, "#F0F1F3")}>{fmt(companyTotals.profPerHour)}</td>
            </tr>
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

  useEffect(function() {
    setForm(Object.assign({}, data));
  }, [store, data]);

  var set = function(key, val) {
    setForm(function(prev) { var n = Object.assign({}, prev); n[key] = val; return n; });
  };

  var handleSave = function() {
    onSave(form);
  };

  var handleExtractFromImage = async function(e) {
    var file = e.target.files[0];
    if (!file) return;
    setExtracting(true);
    setExtractMsg(null);
    try {
      var fd = new FormData();
      fd.append("image", file);
      var res = await fetch("/api/dialpad/extract-profitability", { method: "POST", body: fd });
      var json = await res.json();
      if (json.success && json.data) {
        var d = json.data;
        var newForm = Object.assign({}, form);
        Object.keys(d).forEach(function(k) {
          if (d[k] !== undefined && d[k] !== null) newForm[k] = d[k];
        });
        setForm(newForm);
        var totalRev = (parseFloat(d.accessory_revenue)||0) + (parseFloat(d.repair_revenue)||0) + (parseFloat(d.device_revenue)||0) + (parseFloat(d.parts_revenue)||0) + (parseFloat(d.services_revenue)||0);
        setExtractMsg({ type: "success", text: "Extracted revenue data — $" + totalRev.toLocaleString(undefined,{maximumFractionDigits:2}) + " total. Review and save." });
      } else {
        setExtractMsg({ type: "error", text: json.error || "Failed to extract data" });
      }
    } catch(err) {
      setExtractMsg({ type: "error", text: "Extraction failed: " + err.message });
    }
    setExtracting(false);
    e.target.value = "";
  };

  var storeName = STORES[store] ? STORES[store].name : store;
  var storeColor = STORES[store] ? STORES[store].color : "#7B2FFF";

  var inputStyle = { width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #2A2D35", background: "#12141A", color: "#F0F1F3", fontSize: 12, outline: "none", boxSizing: "border-box", textAlign: "right" };
  var labelStyle = { color: "#8B8F98", fontSize: 9, display: "block", marginBottom: 2 };

  function field(label, key) {
    return (
      <div>
        <label style={labelStyle}>{label}</label>
        <input type="number" step="0.01" value={form[key] || ""} onChange={function(e) { set(key, e.target.value); }}
          placeholder="0.00" style={inputStyle} />
      </div>
    );
  }

  return (
    <div style={{ background: "#1A1D23", borderRadius: 14, padding: 24, border: "1px solid " + storeColor + "33" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ color: storeColor, fontSize: 16, fontWeight: 800 }}>{storeName} — {period}</div>
        <button onClick={handleSave} disabled={saving}
          style={{ padding: "8px 20px", borderRadius: 6, border: "none", background: saving ? "#6B6F78" : "#7B2FFF", color: "#FFF", fontSize: 12, fontWeight: 700, cursor: saving ? "wait" : "pointer" }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {/* Revenue from RepairQ */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ color: "#7B2FFF", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>Revenue (from RepairQ Profitability Report)</div>
          <label style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #7B2FFF33", background: "#7B2FFF12", color: "#7B2FFF", fontSize: 11, fontWeight: 600, cursor: extracting ? "wait" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {extracting ? "Reading screenshot..." : "\uD83D\uDCF7 Import from Screenshot"}
            <input type="file" accept="image/*" onChange={handleExtractFromImage} disabled={extracting} style={{ display: "none" }} />
          </label>
        </div>
        {extractMsg && <div style={{ padding: "8px 12px", borderRadius: 6, marginBottom: 8, background: extractMsg.type === "success" ? "#4ADE8012" : "#F8717112", border: "1px solid " + (extractMsg.type === "success" ? "#4ADE8033" : "#F8717133"), color: extractMsg.type === "success" ? "#4ADE80" : "#F87171", fontSize: 11 }}>{extractMsg.text}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "Accessory Revenue", key: "accessory_revenue" },
            { label: "Accessory COGS", key: "accessory_cogs" },
            { label: "Repair Revenue", key: "repair_revenue" },
            { label: "Repair COGS", key: "repair_cogs" },
            { label: "Device Revenue", key: "device_revenue" },
            { label: "Device COGS", key: "device_cogs" },
            { label: "Parts Revenue", key: "parts_revenue" },
            { label: "Parts COGS", key: "parts_cogs" },
            { label: "Services Revenue", key: "services_revenue" },
            { label: "Services COGS", key: "services_cogs" },
            { label: "Promotions Revenue", key: "promotions_revenue" },
            { label: "Promotions COGS", key: "promotions_cogs" },
          ].map(function(f) { return <div key={f.key}>{field(f.label, f.key)}</div>; })}
        </div>
      </div>

      {/* Expenses */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: "#F87171", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.08em" }}>Expenses (carry forward monthly)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "Rent", key: "rent" },
            { label: "Payroll", key: "payroll" },
            { label: "Internet/Security/Dialpad", key: "internet_security" },
            { label: "Electric", key: "electric" },
            { label: "Gas/Parking", key: "gas_parking" },
            { label: "VOIP", key: "voip" },
            { label: "Marketing Digital", key: "marketing_digital" },
            { label: "Marketing Local", key: "marketing_local" },
            { label: "Store Budget", key: "store_budget" },
            { label: "Damaged", key: "damaged" },
            { label: "Shrinkage", key: "shrinkage" },
            { label: "Voided", key: "voided" },
            { label: "KBB Charges", key: "kbb_charges" },
            { label: "Tips", key: "tips" },
            { label: "LCD Credits", key: "lcd_credits" },
            { label: "CC Fee Difference", key: "cc_fee_diff" },
          ].map(function(f) { return <div key={f.key}>{field(f.label, f.key)}</div>; })}
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

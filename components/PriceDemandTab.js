// Price & Demand — what customers call about, what we charge, and how much of it
// turns into work. From the 2026-09-10 meeting: Matt's "out of the two hundred
// iPhone 17 calls you got fifteen repairs", and Eric's "what is the influence of
// a difference of twenty dollars on a repair."
"use client";
import { useState, useEffect, useMemo, useRef } from "react";

var FAMILY_LABEL = { all: "All", phone: "Phones", console: "Consoles", tablet: "Tablets", computer: "Computers", wearable: "Wearables", other: "Other" };
var FAMILY_ORDER = ["all", "phone", "console", "tablet", "computer", "wearable", "other"];

var money = function(n) {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
var money2 = function(n) {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
var pct = function(n) { return n === null || n === undefined ? "—" : Number(n).toFixed(1) + "%"; };
var monthLabel = function(m) {
  var p = String(m).split("-");
  return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleString(undefined, { month: "short" });
};

// Conversion is the number everyone will look at first, so it gets a colour
// scale rather than a single accent — good and bad must be readable at a glance.
function convColor(v, avg) {
  if (v === null || v === undefined) return "var(--text-muted)";
  if (avg && v >= avg * 1.25) return "var(--green)";
  if (avg && v <= avg * 0.6) return "var(--red)";
  if (avg && v <= avg * 0.85) return "var(--orange)";
  return "var(--text-body)";
}

function Stat({ label, value, sub, tone, delay }) {
  var [shown, setShown] = useState(false);
  useEffect(function() { var t = setTimeout(function() { setShown(true); }, delay || 0); return function() { clearTimeout(t); }; }, [delay]);
  return (
    <div style={{
      flex: "1 1 190px", minWidth: 180, background: "var(--bg-card-inner)", border: "1px solid var(--border-light)",
      borderRadius: 12, padding: "15px 17px",
      opacity: shown ? 1 : 0, transform: shown ? "translateY(0)" : "translateY(8px)",
      transition: "opacity .45s ease, transform .45s cubic-bezier(.22,1,.36,1)",
    }}>
      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{ color: tone || "var(--text-primary)", fontSize: 26, fontWeight: 800, marginTop: 5, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Chip({ active, onClick, children, count }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 13px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontWeight: 700,
      border: "1px solid " + (active ? "var(--purple)" : "var(--border)"),
      background: active ? "#7B2FFF1A" : "transparent",
      color: active ? "var(--purple)" : "var(--text-secondary)",
      transition: "all .18s ease", display: "inline-flex", alignItems: "center", gap: 6,
    }}>
      {children}
      {count !== undefined && <span style={{ opacity: 0.65, fontWeight: 600 }}>{count}</span>}
    </button>
  );
}

// Little inline bar. Width animates from 0 so the table "fills in" on load and
// re-fills whenever the filter changes.
function Bar({ value, max, color, height }) {
  var [w, setW] = useState(0);
  useEffect(function() {
    var t = setTimeout(function() { setW(max > 0 ? Math.max(2, (value / max) * 100) : 0); }, 20);
    return function() { clearTimeout(t); };
  }, [value, max]);
  return (
    <div style={{ background: "var(--border-light)", borderRadius: 3, height: height || 6, overflow: "hidden" }}>
      <div style={{ width: w + "%", height: "100%", background: color, borderRadius: 3, transition: "width .7s cubic-bezier(.22,1,.36,1)" }} />
    </div>
  );
}

// Monthly calls-vs-repairs and list-vs-actual price, drawn by hand so the colours
// come from style props (var() does not resolve in SVG presentation attributes).
function ModelTrend({ months }) {
  var pts = (months || []).filter(function(m) { return m.calls || m.repairs; });
  if (pts.length < 2) return <div style={{ color: "var(--text-muted)", fontSize: 11 }}>Not enough months to trend yet.</div>;
  var W = 520, H = 120, padL = 30, padB = 20, padT = 10;
  var maxV = Math.max.apply(null, pts.map(function(m) { return Math.max(m.calls, m.repairs); })) || 1;
  var bw = (W - padL) / pts.length;
  return (
    <svg viewBox={"0 0 " + W + " " + H} width="100%" style={{ display: "block", maxWidth: 560 }}>
      {pts.map(function(m, i) {
        var x = padL + i * bw;
        var hc = ((H - padB - padT) * m.calls) / maxV;
        var hr = ((H - padB - padT) * m.repairs) / maxV;
        return (
          <g key={m.month}>
            <rect x={x + bw * 0.18} y={H - padB - hc} width={bw * 0.28} height={hc} rx="2"
              style={{ fill: "var(--cyan)", opacity: 0.85 }}>
              <animate attributeName="height" from="0" to={hc} dur="0.6s" fill="freeze" />
              <animate attributeName="y" from={H - padB} to={H - padB - hc} dur="0.6s" fill="freeze" />
            </rect>
            <rect x={x + bw * 0.5} y={H - padB - hr} width={bw * 0.28} height={hr} rx="2"
              style={{ fill: "var(--green)", opacity: 0.85 }}>
              <animate attributeName="height" from="0" to={hr} dur="0.6s" begin="0.08s" fill="freeze" />
              <animate attributeName="y" from={H - padB} to={H - padB - hr} dur="0.6s" begin="0.08s" fill="freeze" />
            </rect>
            <text x={x + bw * 0.48} y={H - 6} textAnchor="middle" fontSize="9" style={{ fill: "var(--text-muted)" }}>{monthLabel(m.month)}</text>
          </g>
        );
      })}
      <line x1={padL} x2={W} y1={H - padB} y2={H - padB} style={{ stroke: "var(--border)" }} strokeWidth="1" />
      <text x={0} y={padT + 8} fontSize="9" style={{ fill: "var(--text-muted)" }}>{maxV}</text>
    </svg>
  );
}

function Funnel({ calls, appt, converted }) {
  var rows = [
    { label: "Opportunity calls", v: calls, color: "var(--cyan)" },
    { label: "Appointment offered", v: appt, color: "var(--purple)" },
    { label: "Became a repair", v: converted, color: "var(--green)" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {rows.map(function(r, i) {
        return (
          <div key={r.label}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>{r.label}</span>
              <span style={{ color: "var(--text-primary)", fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {r.v}{i > 0 && calls > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {((r.v / calls) * 100).toFixed(0)}%</span>}
              </span>
            </div>
            <Bar value={r.v} max={calls} color={r.color} height={8} />
          </div>
        );
      })}
    </div>
  );
}

export default function PriceDemandTab({ storeFilter }) {
  var [data, setData] = useState(null);
  var [error, setError] = useState(null);
  var [months, setMonths] = useState(6);
  var [family, setFamily] = useState("all");
  var [repairType, setRepairType] = useState("all");
  var [sortBy, setSortBy] = useState("calls");
  var [open, setOpen] = useState(null);
  var [openTiers, setOpenTiers] = useState({}); // "model|type" -> true, the Screen row dropped open to OEM / OLED / LCD
  var [search, setSearch] = useState("");
  var [limit, setLimit] = useState(20);
  var [refreshing, setRefreshing] = useState(false);
  var reqId = useRef(0);

  useEffect(function() {
    var id = ++reqId.current;
    setError(null); setRefreshing(true);
    // No type param: the payload carries every repair type, so that filter is
    // applied in the browser and never costs a round trip.
    var sp = "?months=" + months + (storeFilter && storeFilter !== "all" ? "&store=" + encodeURIComponent(storeFilter) : "");
    fetch("/api/dialpad/price-demand" + sp)
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (id !== reqId.current) return; // a newer request won
        if (!j || !j.success) { setError((j && j.error) || "request failed"); setRefreshing(false); return; }
        setData(j); setRefreshing(false);
      })
      .catch(function(e) { if (id === reqId.current) { setError(e.message); setRefreshing(false); } });
  }, [months, storeFilter]);

  useEffect(function() { setOpen(null); setLimit(20); }, [family, sortBy, storeFilter, months, repairType]);

  // Project a model row onto the selected repair type. With no filter the
  // model-level figures stand; with one, every number describes that repair.
  function project(r) {
    if (repairType === "all") return r;
    var t = (r.types || []).filter(function(x) { return x.type === repairType; })[0];
    if (!t) return null;
    return {
      model: r.model, family: r.family, months: r.months, types: r.types,
      calls: t.calls, appt_offered: t.appt_offered, appt_offered_rate: t.appt_offered_rate,
      converted: t.converted, conversion_rate: t.conversion_rate,
      converted_same_model: 0,
      repairs: t.repairs, revenue: null,
      // Cost sits on the ticket, not the line, so profit cannot honestly be
      // split per repair type. Shown as blank rather than guessed.
      profit: null, avg_profit: null,
      priced_lines: t.priced_lines, avg_list: t.avg_list, avg_discount: t.avg_discount,
      avg_actual: t.avg_actual, discount_pct: t.discount_pct,
      full_price: t.full_price, discounted: t.discounted, discounted_share: t.discounted_share,
      price_type: t.priced_lines ? t.type : null, price_type_lines: t.priced_lines, type_count: 1,
      insurance_lines: r.insurance_lines || 0,
    };
  }

  var famCounts = useMemo(function() {
    if (!data) return {};
    var m = { all: data.models.length };
    data.models.forEach(function(r) { m[r.family] = (m[r.family] || 0) + 1; });
    return m;
  }, [data]);

  var rows = useMemo(function() {
    if (!data) return [];
    var out = data.models.map(project).filter(Boolean);
    if (repairType !== "all") out = out.filter(function(r) { return r.calls > 0 || r.priced_lines > 0; });
    if (family !== "all") out = out.filter(function(r) { return r.family === family; });
    var q = search.trim().toLowerCase();
    if (q) out = out.filter(function(r) { return r.model.toLowerCase().indexOf(q) >= 0; });
    out.sort(function(a, b) {
      if (sortBy === "calls") return b.calls - a.calls;
      if (sortBy === "conversion") return (b.conversion_rate || 0) - (a.conversion_rate || 0);
      if (sortBy === "discount") return (b.discount_pct || 0) - (a.discount_pct || 0);
      if (sortBy === "price") return (b.avg_actual || 0) - (a.avg_actual || 0);
      if (sortBy === "profit") return (b.profit || 0) - (a.profit || 0);
      return 0;
    });
    return out;
  }, [data, family, sortBy, search, repairType]);

  if (error) {
    return <div style={{ background: "var(--bg-card)", border: "1px solid var(--red)", borderRadius: 12, padding: 24, color: "var(--red)", fontSize: 13 }}>
      Couldn&apos;t load price &amp; demand — {error}
    </div>;
  }
  if (!data) {
    return <div style={{ padding: 60, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
      Reading calls, tickets and line items…
    </div>;
  }

  var t = data.totals;
  var convRate = t.opportunity_calls ? (data.models.reduce(function(s, r) { return s + r.converted; }, 0) / t.opportunity_calls) * 100 : 0;
  var maxCalls = rows.length ? rows[0].calls : 1;
  var maxCallsAny = Math.max.apply(null, rows.map(function(r) { return r.calls; }).concat([1]));
  var coveragePct = data.coverage.total ? (data.coverage.resolved / data.coverage.total) * 100 : 0;
  var unspecApptRate = data.unspecified.calls ? (data.unspecified.appt_offered / data.unspecified.calls) * 100 : 0;

  var th = { padding: "9px 10px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", textAlign: "left", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" };
  var td = { padding: "10px 10px", fontSize: 12.5, borderBottom: "1px solid var(--border-light)", color: "var(--text-body)" };

  return (
    <div>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ color: "var(--text-primary)", fontSize: 17, fontWeight: 800, letterSpacing: "-0.01em" }}>Price &amp; Demand</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 3 }}>
            What customers call about, what we charge, and how much of it turns into work · since {data.since}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {refreshing && (
            <span style={{ color: "var(--text-muted)", fontSize: 10.5, marginRight: 4, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--cyan)", animation: "pdPulse 1s ease-in-out infinite" }} />
              updating
            </span>
          )}
          {[3, 6, 12].map(function(m) {
            return <Chip key={m} active={months === m} onClick={function() { setMonths(m); }}>{m} mo</Chip>;
          })}
        </div>
      </div>

      {/* ── headline ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 11, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat label="Opportunity calls" value={t.opportunity_calls.toLocaleString()} sub={t.models + " models identified"} delay={0} />
        <Stat label="Appointment offered" value={pct(t.appt_offered_rate)} sub={t.appt_offered.toLocaleString() + " of " + t.opportunity_calls.toLocaleString()} tone={t.appt_offered_rate >= 70 ? "var(--green)" : "var(--yellow)"} delay={60} />
        <Stat label="Became a repair" value={pct(convRate)} sub={"within " + data.window_days + " days, matched by phone"} tone="var(--cyan)" delay={120} />
        <Stat label="Repairs closed" value={t.repairs.toLocaleString()} sub={t.priced_lines.toLocaleString() + " priced repair lines"} delay={180} />
      </div>

      {/* ── honesty line: this view rests on 77% of calls ──────────────────── */}
      <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 9, padding: "10px 13px", marginBottom: 16, color: "var(--text-muted)", fontSize: 11.5, lineHeight: 1.55 }}>
        <strong style={{ color: "var(--text-body)" }}>{coveragePct.toFixed(0)}% of opportunity calls name a model</strong> we can match to a repair.
        The rest are {data.coverage.generic} that name only a category, {data.coverage.not_mentioned} where no device was mentioned,
        and {data.coverage.unrecognised} we couldn&apos;t place. Conversion is a phone-number match within {data.window_days} days —
        it proves the customer came in, not that this call is why.
      </div>

      {/* ── what customers want: demand share by repair, beside its price ──── */}
      {data.repair_types && data.repair_types.length > 0 && (
        <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ color: "var(--text-primary)", fontSize: 13.5, fontWeight: 800 }}>What customers ask for</div>
            <div style={{ color: "var(--text-muted)", fontSize: 10.5 }}>share of calls · and what that repair actually sells for</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {data.repair_types.slice(0, 9).map(function(rt) {
              var top = data.repair_types[0].call_share || 1;
              var on = repairType === rt.type;
              return (
                <div key={rt.type} onClick={function() { setRepairType(on ? "all" : rt.type); }}
                  style={{ display: "grid", gridTemplateColumns: "128px 1fr 62px 150px", gap: 10, alignItems: "center", cursor: "pointer", padding: "3px 6px", borderRadius: 6, background: on ? "#7B2FFF14" : "transparent", transition: "background .15s ease" }}>
                  <span style={{ color: on ? "var(--purple)" : "var(--text-body)", fontSize: 11.5, fontWeight: on ? 800 : 600, whiteSpace: "nowrap" }}>{rt.type}</span>
                  <Bar value={rt.call_share || 0} max={top} color={on ? "var(--purple)" : "var(--cyan)"} height={9} />
                  <span style={{ color: "var(--text-primary)", fontSize: 11.5, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{pct(rt.call_share)}</span>
                  <span style={{ color: "var(--text-muted)", fontSize: 10.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {rt.priced_lines ? money(rt.avg_list) + " → " + money(rt.avg_actual) + " · " + pct(rt.discount_pct) + " off" : rt.calls + " calls · no jobs closed"}
                  </span>
                </div>
              );
            })}
          </div>
          {data.call_type_unclassified > 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 10 }}>
              {data.call_type_unclassified} calls did not describe a repair clearly enough to type.
            </div>
          )}
        </div>
      )}

      {/* ── controls ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FAMILY_ORDER.filter(function(f) { return f === "all" || famCounts[f]; }).map(function(f) {
            return <Chip key={f} active={family === f} onClick={function() { setFamily(f); }} count={famCounts[f]}>{FAMILY_LABEL[f]}</Chip>;
          })}
        </div>
        {data.repair_types && data.repair_types.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>Repair</span>
            <Chip active={repairType === "all"} onClick={function() { setRepairType("all"); }}>All</Chip>
            {data.repair_types.slice(0, 6).map(function(rt) {
              return <Chip key={rt.type} active={repairType === rt.type} onClick={function() { setRepairType(rt.type); }}>{rt.type}</Chip>;
            })}
          </div>
        )}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>Sort</span>
          {[["calls", "Demand"], ["conversion", "Conversion"], ["discount", "Discount"], ["price", "Price"], ["profit", "Profit"]].map(function(s) {
            return <Chip key={s[0]} active={sortBy === s[0]} onClick={function() { setSortBy(s[0]); }}>{s[1]}</Chip>;
          })}
        </div>
        <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Find a model…"
          style={{ marginLeft: "auto", padding: "7px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12, minWidth: 180 }} />
      </div>

      {/* ── model table ────────────────────────────────────────────────────── */}
      <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 12, overflowX: "auto",
        opacity: refreshing ? 0.55 : 1, transition: "opacity .25s ease" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead><tr>
            <th style={th}>Model</th>
            <th style={{ ...th, width: 150 }}>Demand</th>
            <th style={{ ...th, textAlign: "right" }}>Appt&nbsp;offered</th>
            <th style={{ ...th, textAlign: "right" }}>Converted</th>
            <th style={th}>Priced repair</th>
            <th style={{ ...th, textAlign: "right" }}>List</th>
            <th style={{ ...th, textAlign: "right" }}>Actual</th>
            <th style={{ ...th, textAlign: "right" }}>Discount</th>
            <th style={{ ...th, textAlign: "right" }}>Repairs</th>
            <th style={{ ...th, textAlign: "right" }}>Profit</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, limit).map(function(r, i) {
              var isOpen = open === r.model;
              return (
                <>
                  <tr key={r.model}
                    onClick={function() { setOpen(isOpen ? null : r.model); }}
                    style={{ cursor: "pointer", background: isOpen ? "#7B2FFF12" : "transparent", transition: "background .15s ease" }}>
                    <td style={{ ...td, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-block", width: 14, color: "var(--text-muted)", fontSize: 10, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .2s ease" }}>▶</span>
                      {r.model}
                    </td>
                    <td style={td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 12, minWidth: 30, color: "var(--text-primary)", fontWeight: 700 }}>{r.calls}</span>
                        <div style={{ flex: 1 }}><Bar value={r.calls} max={maxCallsAny} color="var(--cyan)" /></div>
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.appt_offered_rate >= 70 ? "var(--green)" : r.appt_offered_rate < 50 ? "var(--orange)" : "var(--text-body)" }}>{pct(r.appt_offered_rate)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700, color: convColor(r.conversion_rate, convRate) }}>{pct(r.conversion_rate)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {r.price_type ? (
                        <span style={{ color: "var(--text-body)", fontSize: 11.5 }}>
                          {r.price_type}
                          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{" \u00d7" + r.price_type_lines}</span>
                          {r.type_count > 1 && <span style={{ color: "var(--text-muted)", fontSize: 9.5 }}>{" +" + (r.type_count - 1)}</span>}
                        </span>
                      ) : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>{money(r.avg_list)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-primary)", fontWeight: 600 }}>{money(r.avg_actual)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.discount_pct >= 15 ? "var(--orange)" : "var(--text-body)" }}>{pct(r.discount_pct)}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.repairs}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.profit > 0 ? "var(--green)" : "var(--text-muted)" }}>{r.profit === null ? "\u2014" : money(r.profit)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={r.model + "-detail"}>
                      <td colSpan={10} style={{ padding: 0, borderBottom: "1px solid var(--border-light)", background: "var(--bg-card)" }}>
                        <div style={{ padding: "18px 20px", display: "flex", gap: 28, flexWrap: "wrap", animation: "pdExpand .28s cubic-bezier(.22,1,.36,1)" }}>
                          <div style={{ flex: "1 1 240px", minWidth: 230 }}>
                            <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Call → repair</div>
                            <Funnel calls={r.calls} appt={r.appt_offered} converted={r.converted} />
                            {r.converted_same_model < r.converted && (
                              <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 9 }}>
                                {r.converted_same_model} of those {r.converted} came in for this same model.
                              </div>
                            )}
                          </div>
                          <div style={{ flex: "2 1 340px", minWidth: 330 }}>
                            <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Pricing by repair</div>
                            {r.priced_lines ? (
                              <div>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                                  <thead><tr>
                                    <th style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 9.5, textTransform: "uppercase", fontWeight: 700, padding: "0 6px 6px 0" }}>Repair</th>
                                    <th style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 9.5, textTransform: "uppercase", fontWeight: 700, padding: "0 6px 6px" }}>Calls</th>
                                    <th style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 9.5, textTransform: "uppercase", fontWeight: 700, padding: "0 6px 6px" }}>Jobs</th>
                                    <th style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 9.5, textTransform: "uppercase", fontWeight: 700, padding: "0 6px 6px" }}>List</th>
                                    <th style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 9.5, textTransform: "uppercase", fontWeight: 700, padding: "0 0 6px 6px" }}>Selling at</th>
                                  </tr></thead>
                                  <tbody>
                                    {r.types.filter(function(x) { return x.priced_lines > 0 || x.calls > 0; }).map(function(x) {
                                      // A screen is not one price: OEM, OLED and LCD are different jobs.
                                      // The Screen row drops open to show them; other types have no tiers.
                                      var tiers = (x.tiers || []).filter(function(t) { return t.priced_lines > 0; });
                                      var tk = r.model + "|" + x.type;
                                      var canDrop = tiers.length > 0;
                                      var dropped = canDrop && !!openTiers[tk];
                                      var rowsOut = [
                                        <tr key={x.type} onClick={canDrop ? function(e) { e.stopPropagation(); setOpenTiers(function(p) { var n = Object.assign({}, p); if (n[tk]) delete n[tk]; else n[tk] = true; return n; }); } : undefined}
                                          style={{ cursor: canDrop ? "pointer" : "default", background: dropped ? "#7B2FFF0D" : "transparent", transition: "background .15s ease" }}
                                          title={canDrop ? "Show OEM / OLED / LCD" : undefined}>
                                          <td style={{ padding: "4px 6px 4px 0", color: "var(--text-body)", whiteSpace: "nowrap" }}>
                                            {canDrop && <span style={{ display: "inline-block", width: 12, color: "var(--purple)", fontSize: 9, transform: dropped ? "rotate(90deg)" : "none", transition: "transform .18s ease" }}>▶</span>}
                                            {x.type}
                                            {canDrop && !dropped && <span style={{ color: "var(--text-muted)", fontSize: 9.5, marginLeft: 5 }}>{tiers.map(function(t) { return t.tier; }).join(" · ")}</span>}
                                          </td>
                                          <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{x.calls || "—"}</td>
                                          <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{x.priced_lines || "—"}</td>
                                          <td style={{ padding: "4px 6px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{x.avg_list === null ? "—" : money2(x.avg_list)}</td>
                                          <td style={{ padding: "4px 0 4px 6px", textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                                            {x.avg_actual === null ? "—" : money2(x.avg_actual)}
                                            {x.discount_pct > 0 && <div style={{ color: "var(--orange)", fontSize: 9.5, fontWeight: 500 }}>{pct(x.discount_pct)} off</div>}
                                          </td>
                                        </tr>
                                      ];
                                      if (dropped) tiers.forEach(function(t) {
                                        rowsOut.push(
                                          <tr key={x.type + "|" + t.tier} style={{ background: "#7B2FFF0D", animation: "pdRow .18s ease both" }}>
                                            <td style={{ padding: "3px 6px 3px 18px", color: "var(--purple)", fontWeight: 700, fontSize: 10.5, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                                              {t.tier}
                                              <span style={{ color: "var(--text-muted)", fontWeight: 500, letterSpacing: 0, marginLeft: 6 }}>{t.full_price} of {t.priced_lines} at full price</span>
                                            </td>
                                            <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-faint)" }}>—</td>
                                            <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{t.priced_lines}</td>
                                            <td style={{ padding: "3px 6px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{money2(t.avg_list)}</td>
                                            <td style={{ padding: "3px 0 3px 6px", textAlign: "right", color: "var(--text-primary)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                                              {money2(t.avg_actual)}
                                              {t.discount_pct > 0 && <div style={{ color: "var(--orange)", fontSize: 9.5, fontWeight: 500 }}>{pct(t.discount_pct)} off</div>}
                                            </td>
                                          </tr>
                                        );
                                      });
                                      return rowsOut;
                                    })}
                                  </tbody>
                                </table>
                                <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 8 }}>
                                  A row with calls but no jobs is demand walking away · avg profit {money2(r.avg_profit)} per ticket{r.insurance_lines ? " · " + r.insurance_lines + " insurance claim" + (r.insurance_lines === 1 ? "" : "s") + " left out of pricing" : ""}
                                </div>
                              </div>
                            ) : (
                              <div style={{ color: "var(--text-muted)", fontSize: 11.5 }}>
                                No priced repair lines for this model in the window — {r.calls} calls but nothing closed.
                              </div>
                            )}
                          </div>
                          <div style={{ flex: "2 1 300px", minWidth: 280 }}>
                            <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
                              Monthly · <span style={{ color: "var(--cyan)" }}>calls</span> vs <span style={{ color: "var(--green)" }}>repairs</span>
                            </div>
                            <ModelTrend months={r.months} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: "center", padding: 34, color: "var(--text-muted)" }}>No models match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      {rows.length > limit && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={function() { setLimit(limit + 30); }}
            style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Show {Math.min(30, rows.length - limit)} more ({rows.length - limit} left)
          </button>
        </div>
      )}

      {/* ── the coaching bucket Eric asked to keep visible ──────────────────── */}
      <div style={{ marginTop: 22, background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 12, padding: 18 }}>
        <div style={{ color: "var(--text-primary)", fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>Calls where we never learned the device</div>
        <div style={{ color: "var(--text-muted)", fontSize: 11.5, marginBottom: 14, lineHeight: 1.55 }}>
          {data.unspecified.calls.toLocaleString()} opportunity calls named no model, or only a category.
          An appointment was offered on <strong style={{ color: unspecApptRate < t.appt_offered_rate ? "var(--orange)" : "var(--green)" }}>{pct(unspecApptRate)}</strong> of
          them against {pct(t.appt_offered_rate)} overall — the call that never establishes what the customer has is also the call that doesn&apos;t get booked.
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {data.generic_by_family.map(function(g) {
            return (
              <div key={g.family} style={{ flex: "1 1 150px", minWidth: 145, background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 9, padding: "11px 13px" }}>
                <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{FAMILY_LABEL[g.family] || g.family} · category only</div>
                <div style={{ color: "var(--text-primary)", fontSize: 19, fontWeight: 800, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{g.calls}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 2 }}>{pct(g.calls ? (g.appt_offered / g.calls) * 100 : 0)} offered an appointment</div>
              </div>
            );
          })}
          <div style={{ flex: "1 1 150px", minWidth: 145, background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 9, padding: "11px 13px" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>No device mentioned</div>
            <div style={{ color: "var(--orange)", fontSize: 19, fontWeight: 800, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{data.coverage.not_mentioned}</div>
            <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 2 }}>nothing captured at all</div>
          </div>
        </div>
      </div>

      <style>{"@keyframes pdExpand { from { opacity:0; transform:translateY(-6px) } to { opacity:1; transform:translateY(0) } } @keyframes pdPulse { 0%,100% { opacity:1 } 50% { opacity:.25 } } @keyframes pdRow { from { opacity:0; transform:translateX(-4px) } to { opacity:1; transform:translateX(0) } }"}</style>
    </div>
  );
}

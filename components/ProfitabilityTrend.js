// Monthly profitability trend — the six-month shape of the business, sitting above
// the single-month statement. Reuses compute() from ProfitabilityTab so the chart
// and the table are guaranteed to be the same arithmetic.
"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { STORES } from "@/lib/constants";
import { compute } from "@/components/ProfitabilityTab";

var STORE_KEYS = Object.keys(STORES);

// Metrics are all one scale each — never two y-axes on one chart.
var METRICS = [
  { key: "netProfit", label: "Net Profit", kind: "money" },
  { key: "grossProfit", label: "Gross Profit", kind: "money" },
  { key: "grossRev", label: "Revenue", kind: "money" },
  { key: "netMargin", label: "Net Margin", kind: "pct" },
];

function money(n) {
  var v = parseFloat(n) || 0;
  var neg = v < 0;
  var a = Math.abs(v);
  var s = a >= 1000 ? "$" + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k" : "$" + a.toFixed(0);
  return neg ? "-" + s : s;
}
function moneyFull(n) {
  var v = parseFloat(n) || 0;
  var neg = v < 0;
  return (neg ? "-" : "") + "$" + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function pct(n) { return ((parseFloat(n) || 0) * 100).toFixed(1) + "%"; }

function monthLabel(period) {
  var parts = String(period).split("-");
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  return d.toLocaleString(undefined, { month: "short" });
}
function monthLong(period) {
  var parts = String(period).split("-");
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

// Nice-ish axis ticks spanning min..max, always including zero.
function ticks(min, max) {
  var lo = Math.min(0, min), hi = Math.max(0, max);
  if (hi === lo) return [0];
  var raw = (hi - lo) / 4;
  var mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw))));
  var step = Math.ceil(raw / mag) * mag;
  // Round the TOP up to a whole step as well as the bottom down. Stopping at the
  // last tick below the max leaves the tallest bar drawn above the plot area.
  var loT = Math.floor(lo / step) * step;
  var hiT = Math.ceil(hi / step) * step;
  if (hiT === loT) hiT = loT + step;
  var out = [];
  for (var t = loT; t <= hiT + step * 0.001; t += step) out.push(Math.round(t * 1e6) / 1e6);
  return out;
}

export default function ProfitabilityTrend({ period, onSelectPeriod }) {
  var [rows, setRows] = useState(null);
  var [error, setError] = useState(null);
  var [metric, setMetric] = useState("netProfit");
  var [hidden, setHidden] = useState({});
  var [hover, setHover] = useState(null);
  var [mounted, setMounted] = useState(false);
  var wrapRef = useRef(null);

  useEffect(function() {
    var live = true;
    fetch("/api/dialpad/profitability?action=history&store=all")
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (!live) return;
        // Loud, not silent: an empty chart with no explanation is how bad data hides.
        if (!j || !j.success) { setError((j && j.error) || "history request failed"); setRows([]); return; }
        setRows(j.records || []);
      })
      .catch(function(e) { if (live) { setError(e.message); setRows([]); } });
    return function() { live = false; };
  }, []);

  // Let the first paint land at zero height, then animate to full.
  // Deliberately a timer, not requestAnimationFrame: rAF does not fire while the
  // tab is in the background, which left every bar stuck at height 0 for anyone
  // who opened the dashboard in a background tab.
  useEffect(function() {
    if (rows === null) return;
    var id = setTimeout(function() { setMounted(true); }, 20);
    return function() { clearTimeout(id); };
  }, [rows]);

  var data = useMemo(function() {
    if (!rows || !rows.length) return [];
    var byPeriod = {};
    rows.forEach(function(r) {
      if (!byPeriod[r.period]) byPeriod[r.period] = {};
      byPeriod[r.period][r.store] = compute(r);
    });
    return Object.keys(byPeriod).sort().map(function(p) {
      var stores = byPeriod[p];
      var company = { netProfit: 0, grossProfit: 0, grossRev: 0 };
      STORE_KEYS.forEach(function(k) {
        if (!stores[k]) return;
        company.netProfit += stores[k].netProfit;
        company.grossProfit += stores[k].grossProfit;
        company.grossRev += stores[k].grossRev;
      });
      company.netMargin = company.grossRev > 0 ? company.netProfit / company.grossRev : 0;
      return { period: p, stores: stores, company: company };
    });
  }, [rows]);

  var activeKeys = STORE_KEYS.filter(function(k) { return !hidden[k]; });
  var m = METRICS.filter(function(x) { return x.key === metric; })[0];
  var isPct = m.kind === "pct";

  // ── scale ────────────────────────────────────────────────────────────────
  var W = 920, H = 300, padL = 62, padR = 18, padT = 24, padB = 42;
  var plotW = W - padL - padR, plotH = H - padT - padB;

  var vals = [];
  data.forEach(function(d) {
    activeKeys.forEach(function(k) { if (d.stores[k]) vals.push(d.stores[k][metric] || 0); });
  });
  var vMin = vals.length ? Math.min.apply(null, vals) : 0;
  var vMax = vals.length ? Math.max.apply(null, vals) : 0;
  var tk = ticks(vMin, vMax);
  var yLo = tk[0], yHi = tk[tk.length - 1];
  var span = (yHi - yLo) || 1;
  var y = function(v) { return padT + plotH - ((v - yLo) / span) * plotH; };
  var zeroY = y(0);

  var groupW = data.length ? plotW / data.length : plotW;
  var barW = Math.min(26, Math.max(8, (groupW - 18) / Math.max(1, activeKeys.length)));

  // ── states ───────────────────────────────────────────────────────────────
  if (rows === null) {
    return <div style={shell}><div style={{ color: "#6B6F78", fontSize: 12, padding: "48px 0", textAlign: "center" }}>Loading trend…</div></div>;
  }
  if (error) {
    return <div style={shell}>
      <div style={{ color: "#F87171", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
        Couldn&apos;t load the trend — {error}
      </div>
    </div>;
  }
  if (!data.length) {
    return <div style={shell}>
      <div style={{ color: "#6B6F78", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
        No saved months yet. Enter a month below and it&apos;ll appear here.
      </div>
    </div>;
  }

  var latest = data[data.length - 1];
  var prior = data.length > 1 ? data[data.length - 2] : null;
  var latestV = latest.company[metric] || 0;
  var priorV = prior ? (prior.company[metric] || 0) : null;
  var delta = priorV === null ? null : latestV - priorV;
  var best = data.reduce(function(a, b) { return (b.company[metric] || 0) > (a.company[metric] || 0) ? b : a; }, data[0]);

  var hoverD = hover !== null ? data[hover] : null;

  return (
    <div style={shell} ref={wrapRef}>
      {/* ── header: title, KPIs, metric toggle ───────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ color: "#F0F1F3", fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>Monthly Trend</div>
          <div style={{ color: "#6B6F78", fontSize: 11, marginTop: 3 }}>
            {data.length} months · {monthLong(data[0].period)} – {monthLong(latest.period)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {METRICS.map(function(x) {
            var on = x.key === metric;
            return <button key={x.key} onClick={function() { setMetric(x.key); }}
              style={{
                padding: "6px 13px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
                border: "1px solid " + (on ? "#7B2FFF66" : "#2A2D35"),
                background: on ? "linear-gradient(135deg, #7B2FFF22, #00D4FF14)" : "transparent",
                color: on ? "#C9B6FF" : "#8B8F98", transition: "all .18s ease",
              }}>{x.label}</button>;
          })}
        </div>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #1E2028" }}>
        <Kpi label={monthLabel(latest.period) + " (latest)"} value={isPct ? pct(latestV) : moneyFull(latestV)}
          tone={latestV >= 0 ? "#4ADE80" : "#F87171"} />
        {delta !== null && (
          <Kpi label={"vs " + monthLabel(prior.period)}
            value={(delta >= 0 ? "▲ " : "▼ ") + (isPct ? pct(Math.abs(delta)) : moneyFull(Math.abs(delta)))}
            tone={delta >= 0 ? "#4ADE80" : "#F87171"} />
        )}
        <Kpi label={"Best month"} value={monthLabel(best.period) + " · " + (isPct ? pct(best.company[metric]) : moneyFull(best.company[metric]))} tone="#00D4FF" />
      </div>

      {/* ── chart ─────────────────────────────────────────────────────────── */}
      <div style={{ position: "relative", width: "100%", overflowX: "auto" }}>
        <svg viewBox={"0 0 " + W + " " + H} width="100%" style={{ display: "block", minWidth: 560 }}
          onMouseLeave={function() { setHover(null); }}>
          <defs>
            {STORE_KEYS.map(function(k) {
              return (
                <linearGradient key={k} id={"gr-" + k} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={STORES[k].color} stopOpacity="0.95" />
                  <stop offset="100%" stopColor={STORES[k].color} stopOpacity="0.55" />
                </linearGradient>
              );
            })}
          </defs>

          {/* gridlines — recessive */}
          {tk.map(function(t) {
            var isZero = t === 0;
            return (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)}
                  stroke={isZero ? "#3A3E48" : "#1C1F26"} strokeWidth={isZero ? 1.5 : 1} />
                <text x={padL - 10} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#5A5E68"
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {isPct ? pct(t) : money(t)}
                </text>
              </g>
            );
          })}

          {/* month groups */}
          {data.map(function(d, gi) {
            var gx = padL + gi * groupW;
            var isHover = hover === gi;
            var isCurrent = d.period === period;
            var totalW = activeKeys.length * barW + (activeKeys.length - 1) * 4;
            var startX = gx + (groupW - totalW) / 2;
            return (
              <g key={d.period}
                onMouseEnter={function() { setHover(gi); }}
                onClick={function() { if (onSelectPeriod) onSelectPeriod(d.period); }}
                style={{ cursor: onSelectPeriod ? "pointer" : "default" }}>
                {/* generous hit target + hover wash */}
                <rect x={gx} y={padT} width={groupW} height={plotH}
                  fill={isHover ? "#FFFFFF06" : "transparent"} />
                {isCurrent && (
                  <rect x={gx + 1} y={padT} width={groupW - 2} height={plotH}
                    fill="none" stroke="#7B2FFF33" strokeWidth="1" rx="4" />
                )}
                {activeKeys.map(function(k, bi) {
                  var s = d.stores[k];
                  if (!s) return null; // no row for this store/month — draw nothing, never a false zero
                  var v = s[metric] || 0;
                  var yv = y(v);
                  var top = Math.min(yv, zeroY), h = Math.abs(zeroY - yv);
                  var bx = startX + bi * (barW + 4);
                  return (
                    <rect key={k} x={bx}
                      y={mounted ? top : zeroY}
                      width={barW}
                      height={mounted ? Math.max(h, v === 0 ? 0 : 1.5) : 0}
                      rx="3"
                      fill={"url(#gr-" + k + ")"}
                      opacity={hover === null || isHover ? 1 : 0.32}
                      style={{
                        transition: "y .62s cubic-bezier(.22,1,.36,1) " + (gi * 45 + bi * 30) + "ms, height .62s cubic-bezier(.22,1,.36,1) " + (gi * 45 + bi * 30) + "ms, opacity .18s ease",
                      }} />
                  );
                })}
                {/* month label */}
                <text x={gx + groupW / 2} y={H - 22} textAnchor="middle" fontSize="11"
                  fontWeight={isCurrent ? 800 : 600} fill={isCurrent ? "#C9B6FF" : isHover ? "#C9CDD4" : "#6B6F78"}>
                  {monthLabel(d.period)}
                </text>
                {/* company total, direct-labelled — selective, not on every mark */}
                <text x={gx + groupW / 2} y={H - 8} textAnchor="middle" fontSize="9.5" fill={isHover ? "#8B8F98" : "#4A4E57"}
                  style={{ fontVariantNumeric: "tabular-nums" }}>
                  {isPct ? pct(d.company[metric]) : money(d.company[metric])}
                </text>
              </g>
            );
          })}
        </svg>

        {/* ── tooltip ─────────────────────────────────────────────────────── */}
        {hoverD && (
          <div style={{
            position: "absolute", top: 8,
            left: "calc(" + ((padL + (hover + 0.5) * groupW) / W) * 100 + "% )",
            transform: "translateX(-50%)", pointerEvents: "none",
            background: "#12141Aee", border: "1px solid #2A2D35", borderRadius: 10,
            padding: "10px 12px", minWidth: 172, backdropFilter: "blur(6px)",
            boxShadow: "0 10px 30px rgba(0,0,0,.45)", zIndex: 3,
          }}>
            <div style={{ color: "#F0F1F3", fontSize: 11, fontWeight: 800, marginBottom: 7 }}>{monthLong(hoverD.period)}</div>
            {STORE_KEYS.map(function(k) {
              if (hidden[k]) return null;
              var s = hoverD.stores[k];
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 4 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#8B8F98", fontSize: 10.5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: STORES[k].color, flexShrink: 0 }} />
                    {STORES[k].name.replace("CPR ", "")}
                  </span>
                  <span style={{ color: s ? "#E8EAED" : "#5A5E68", fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {s ? (isPct ? pct(s[metric]) : moneyFull(s[metric])) : "no data"}
                  </span>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginTop: 7, paddingTop: 6, borderTop: "1px solid #2A2D35" }}>
              <span style={{ color: "#6B6F78", fontSize: 10.5, fontWeight: 700 }}>Company</span>
              <span style={{ color: (hoverD.company[metric] || 0) >= 0 ? "#4ADE80" : "#F87171", fontSize: 10.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {isPct ? pct(hoverD.company[metric]) : moneyFull(hoverD.company[metric])}
              </span>
            </div>
            {onSelectPeriod && <div style={{ color: "#4A4E57", fontSize: 9, marginTop: 7 }}>click to open this month</div>}
          </div>
        )}
      </div>

      {/* ── legend — always present, doubles as a filter ───────────────────── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {STORE_KEYS.map(function(k) {
          var off = !!hidden[k];
          return (
            <button key={k}
              onClick={function() { setHidden(function(p) { var n = Object.assign({}, p); n[k] = !p[k]; return n; }); }}
              title={off ? "Show " + STORES[k].name : "Hide " + STORES[k].name}
              style={{
                display: "flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 999,
                border: "1px solid " + (off ? "#24272F" : STORES[k].color + "44"),
                background: off ? "transparent" : STORES[k].color + "10",
                color: off ? "#5A5E68" : "#C9CDD4", fontSize: 11, fontWeight: 600, cursor: "pointer",
                transition: "all .18s ease",
              }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: off ? "#3A3E48" : STORES[k].color }} />
              {STORES[k].name.replace("CPR ", "")}
            </button>
          );
        })}
        <span style={{ color: "#4A4E57", fontSize: 10, alignSelf: "center", marginLeft: 4 }}>
          click a store to isolate · full figures in the statement below
        </span>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div>
      <div style={{ color: "#6B6F78", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div>
      <div style={{ color: tone || "#F0F1F3", fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

var shell = {
  background: "#1A1D23",
  borderRadius: 14,
  padding: 20,
  border: "1px solid #24272F",
  marginBottom: 20,
};

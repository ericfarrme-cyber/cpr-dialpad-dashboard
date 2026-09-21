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
  // Area manager profit share: rate × company net profit above an annual
  // threshold, calendar year. The terms live in commission_config rows
  // (am_profit_share_rate / am_profit_share_threshold), never in this repo.
  var [share, setShare] = useState(null);
  useEffect(function() {
    var live = true;
    fetch("/api/dialpad/sales?action=commission_config").then(function(r) { return r.json(); }).then(function(j) {
      if (!live || !j || !j.success) return;
      var byKey = {};
      (j.config || []).forEach(function(c) { byKey[c.config_key] = c; });
      var rate = byKey.am_profit_share_rate, thr = byKey.am_profit_share_threshold;
      if (rate && thr && rate.enabled !== false) setShare({ rate: parseFloat(rate.config_value), threshold: parseFloat(thr.config_value) });
    }).catch(function() { /* the card simply does not render */ });
    return function() { live = false; };
  }, []);

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

  // Year to date, per store. Scoped to the year of the newest saved month rather
  // than the wall clock, so the figure always describes the data actually on
  // screen — in January a clock-based year would show three empty stores.
  var ytd = useMemo(function() {
    if (!data.length) return null;
    var year = String(data[data.length - 1].period).slice(0, 4);
    var months = data.filter(function(d) { return String(d.period).slice(0, 4) === year; });
    var per = {};
    STORE_KEYS.forEach(function(k) { per[k] = { netProfit: 0, grossProfit: 0, grossRev: 0, months: 0 }; });
    var comp = { netProfit: 0, grossProfit: 0, grossRev: 0 };
    months.forEach(function(d) {
      STORE_KEYS.forEach(function(k) {
        var s = d.stores[k];
        if (!s) return;
        per[k].netProfit += s.netProfit; per[k].grossProfit += s.grossProfit; per[k].grossRev += s.grossRev; per[k].months++;
        comp.netProfit += s.netProfit; comp.grossProfit += s.grossProfit; comp.grossRev += s.grossRev;
      });
    });
    // A margin is a ratio, never a sum of monthly ratios.
    STORE_KEYS.forEach(function(k) { per[k].netMargin = per[k].grossRev > 0 ? per[k].netProfit / per[k].grossRev : 0; });
    comp.netMargin = comp.grossRev > 0 ? comp.netProfit / comp.grossRev : 0;
    // Which months of the year are missing — January and February 2026 were
    // never entered, so a YTD that quietly omits them would read as truth.
    var have = {};
    months.forEach(function(d) { have[String(d.period).slice(5, 7)] = true; });
    var lastSaved = parseInt(String(months[months.length - 1].period).slice(5, 7), 10);
    var missing = [];
    for (var mi = 1; mi <= lastSaved; mi++) { var mm = String(mi).padStart(2, "0"); if (!have[mm]) missing.push(year + "-" + mm); }
    return { year: year, per: per, company: comp, monthCount: months.length, missing: missing, lastSaved: lastSaved };
  }, [data]);

  // Profit share so far this year, and where the year is heading at the
  // current average. Both stated with what they leave out.
  var shareCalc = useMemo(function() {
    if (!ytd || !share || !isFinite(share.rate) || !isFinite(share.threshold)) return null;
    var profit = ytd.company.netProfit;
    var excess = Math.max(0, profit - share.threshold);
    var avg = ytd.monthCount ? profit / ytd.monthCount : 0;
    var projected = avg * 12;
    return {
      profit: profit, excess: excess, earned: excess * share.rate,
      gap: share.threshold - profit,
      projected: projected, projectedShare: Math.max(0, projected - share.threshold) * share.rate,
      monthsLeft: 12 - ytd.lastSaved,
    };
  }, [ytd, share]);

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
    return <div style={shell}><div style={{ color: "var(--text-muted)", fontSize: 12, padding: "48px 0", textAlign: "center" }}>Loading trend…</div></div>;
  }
  if (error) {
    return <div style={shell}>
      <div style={{ color: "var(--red)", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
        Couldn&apos;t load the trend — {error}
      </div>
    </div>;
  }
  if (!data.length) {
    return <div style={shell}>
      <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "32px 0", textAlign: "center" }}>
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
          <div style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800, letterSpacing: "-0.01em" }}>Monthly Trend</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>
            {data.length} months · {monthLong(data[0].period)} – {monthLong(latest.period)}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {METRICS.map(function(x) {
            var on = x.key === metric;
            return <button key={x.key} onClick={function() { setMetric(x.key); }}
              style={{
                padding: "6px 13px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
                border: "1px solid " + (on ? "#7B2FFF66" : "var(--border)"),
                background: on ? "linear-gradient(135deg, #7B2FFF22, #00D4FF14)" : "transparent",
                color: on ? "var(--purple)" : "var(--text-secondary)", transition: "all .18s ease",
              }}>{x.label}</button>;
          })}
        </div>
      </div>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--border-light)" }}>
        <Kpi label={monthLabel(latest.period) + " (latest)"} value={isPct ? pct(latestV) : moneyFull(latestV)}
          tone={latestV >= 0 ? "var(--green)" : "var(--red)"} />
        {delta !== null && (
          <Kpi label={"vs " + monthLabel(prior.period)}
            value={(delta >= 0 ? "▲ " : "▼ ") + (isPct ? pct(Math.abs(delta)) : moneyFull(Math.abs(delta)))}
            tone={delta >= 0 ? "var(--green)" : "var(--red)"} />
        )}
        <Kpi label={"Best month"} value={monthLabel(best.period) + " · " + (isPct ? pct(best.company[metric]) : moneyFull(best.company[metric]))} tone="var(--cyan)" />
      </div>

      {/* ── Year to date, per store ───────────────────────────────────────── */}
      {ytd && (
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 16, paddingBottom: 14, borderBottom: "1px solid var(--border-light)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {ytd.year} YTD {m.label}
            <div style={{ color: "var(--text-faint)", fontSize: 9, fontWeight: 500, textTransform: "none", letterSpacing: 0, marginTop: 2 }}>
              {ytd.monthCount} month{ytd.monthCount === 1 ? "" : "s"} saved
            </div>
          </div>
          {STORE_KEYS.map(function(k) {
            var v = ytd.per[k][metric] || 0;
            var dim = !!hidden[k];
            return (
              <div key={k} style={{ opacity: dim ? 0.35 : 1, transition: "opacity .18s ease" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: STORES[k].color }} />
                  <span style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 600 }}>{STORES[k].name.replace("CPR ", "")}</span>
                </div>
                <div style={{ color: v >= 0 ? "var(--text-body)" : "var(--red)", fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                  {isPct ? pct(v) : moneyFull(v)}
                </div>
              </div>
            );
          })}
          <div style={{ paddingLeft: 18, borderLeft: "1px solid var(--border)" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, marginBottom: 2 }}>Company</div>
            <div style={{ color: (ytd.company[metric] || 0) >= 0 ? "var(--green)" : "var(--red)", fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
              {isPct ? pct(ytd.company[metric]) : moneyFull(ytd.company[metric])}
            </div>
          </div>
        </div>
      )}

      {/* ── Area manager profit share ─────────────────────────────────────── */}
      {ytd && shareCalc && (
        <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginBottom: 16, padding: "12px 14px", borderRadius: 10, border: "1px solid " + (shareCalc.excess > 0 ? "#4ADE8055" : "var(--border-light)"), background: "var(--bg-card-inner)" }}>
          <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Area manager profit share · {ytd.year}
            <div style={{ color: "var(--text-faint)", fontSize: 9, fontWeight: 500, textTransform: "none", letterSpacing: 0, marginTop: 2 }}>
              {Math.round(share.rate * 100)}% of company net profit above {moneyFull(share.threshold)} · calendar year
            </div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 600, marginBottom: 2 }}>Net profit YTD</div>
            <div style={{ color: shareCalc.profit >= 0 ? "var(--text-body)" : "var(--red)", fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{moneyFull(shareCalc.profit)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 600, marginBottom: 2 }}>{shareCalc.excess > 0 ? "Above threshold" : "To the threshold"}</div>
            <div style={{ color: shareCalc.excess > 0 ? "var(--green)" : "var(--text-body)", fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{moneyFull(shareCalc.excess > 0 ? shareCalc.excess : shareCalc.gap)}</div>
          </div>
          <div style={{ paddingLeft: 18, borderLeft: "1px solid var(--border)" }}>
            <div style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 600, marginBottom: 2 }}>Share earned so far</div>
            <div style={{ color: shareCalc.earned > 0 ? "var(--green)" : "var(--text-muted)", fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{moneyFull(shareCalc.earned)}</div>
          </div>
          <div>
            <div style={{ color: "var(--text-secondary)", fontSize: 10, fontWeight: 600, marginBottom: 2 }}>On pace for</div>
            <div style={{ color: "var(--text-body)", fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{moneyFull(shareCalc.projected)} <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: 11 }}>→ share {moneyFull(shareCalc.projectedShare)}</span></div>
            <div style={{ color: "var(--text-faint)", fontSize: 9, marginTop: 1 }}>{ytd.monthCount}-month average × 12 · {shareCalc.monthsLeft} month{shareCalc.monthsLeft === 1 ? "" : "s"} still to come</div>
          </div>
          {ytd.missing.length > 0 && (
            <div style={{ flexBasis: "100%", color: "var(--yellow)", fontSize: 11, marginTop: 2 }}>
              {ytd.missing.map(monthLabel).join(" and ")} {ytd.missing.length === 1 ? "is" : "are"} not entered yet — YTD and the pace above leave {ytd.missing.length === 1 ? "that month" : "those months"} out. Enter them below and this updates.
            </div>
          )}
        </div>
      )}

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
                  strokeWidth={isZero ? 1.5 : 1} style={{ stroke: isZero ? "var(--border-heavy)" : "var(--border-light)" }} />
                <text x={padL - 10} y={y(t) + 3.5} textAnchor="end" fontSize="10"
                  style={{ fill: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
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
                  fill="currentColor" opacity={isHover ? 0.05 : 0} style={{ color: "var(--text-primary)" }} />
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
                  fontWeight={isCurrent ? 800 : 600} style={{ fill: isCurrent ? "var(--purple)" : isHover ? "var(--text-body)" : "var(--text-muted)" }}>
                  {monthLabel(d.period)}
                </text>
                {/* company total, direct-labelled — selective, not on every mark */}
                <text x={gx + groupW / 2} y={H - 8} textAnchor="middle" fontSize="9.5"
                  style={{ fill: isHover ? "var(--text-secondary)" : "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
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
            background: "#12141Aee", border: "1px solid var(--border)", borderRadius: 10,
            padding: "10px 12px", minWidth: 172, backdropFilter: "blur(6px)",
            boxShadow: "0 10px 30px rgba(0,0,0,.45)", zIndex: 3,
          }}>
            <div style={{ color: "var(--text-primary)", fontSize: 11, fontWeight: 800, marginBottom: 7 }}>{monthLong(hoverD.period)}</div>
            {STORE_KEYS.map(function(k) {
              if (hidden[k]) return null;
              var s = hoverD.stores[k];
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 4 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: 10.5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: STORES[k].color, flexShrink: 0 }} />
                    {STORES[k].name.replace("CPR ", "")}
                  </span>
                  <span style={{ color: s ? "var(--text-body)" : "var(--text-faint)", fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {s ? (isPct ? pct(s[metric]) : moneyFull(s[metric])) : "no data"}
                  </span>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginTop: 7, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
              <span style={{ color: "var(--text-muted)", fontSize: 10.5, fontWeight: 700 }}>Company</span>
              <span style={{ color: (hoverD.company[metric] || 0) >= 0 ? "var(--green)" : "var(--red)", fontSize: 10.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                {isPct ? pct(hoverD.company[metric]) : moneyFull(hoverD.company[metric])}
              </span>
            </div>
            {onSelectPeriod && <div style={{ color: "var(--text-faint)", fontSize: 9, marginTop: 7 }}>click to open this month</div>}
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
                border: "1px solid " + (off ? "var(--border)" : STORES[k].color + "44"),
                background: off ? "transparent" : STORES[k].color + "10",
                color: off ? "var(--text-faint)" : "var(--text-body)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                transition: "all .18s ease",
              }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: off ? "var(--border-heavy)" : STORES[k].color }} />
              {STORES[k].name.replace("CPR ", "")}
            </button>
          );
        })}
        <span style={{ color: "var(--text-faint)", fontSize: 10, alignSelf: "center", marginLeft: 4 }}>
          click a store to isolate · full figures in the statement below
        </span>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }) {
  return (
    <div>
      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{label}</div>
      <div style={{ color: tone || "var(--text-primary)", fontSize: 17, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

var shell = {
  background: "var(--bg-card)",
  borderRadius: 14,
  padding: 20,
  border: "1px solid var(--border)",
  marginBottom: 20,
};

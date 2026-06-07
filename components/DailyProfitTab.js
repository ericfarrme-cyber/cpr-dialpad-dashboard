"use client";

import { useState, useEffect, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, Area, AreaChart,
} from "recharts";
import { STORES, STORE_KEYS } from "@/lib/constants";

// ── Palette ─────────────────────────────────────────────────────────
var BG_CARD = "#1A1D23";
var BG_INSET = "#12141A";
var BORDER = "#2A2D35";
var TEXT = "#F0F1F3";
var TEXT_MUTED = "#8B8F98";
var TEXT_DIM = "#6B6F78";
var GREEN = "#4ADE80";

function storeColor(s) { return (STORES[s] && STORES[s].color) || "#7B2FFF"; }
function storeShort(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : "—"; }
function fmtUSD(n) {
  var v = Math.round((n || 0) * 100) / 100;
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUSD0(n) { return "$" + Math.round(n || 0).toLocaleString(); }
function fmtDateShort(ymd) {
  if (!ymd) return "";
  var p = ymd.split("-");
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  return (d.getMonth() + 1) + "/" + d.getDate();
}

var WINDOWS = [
  { id: "month", label: "This Month" },
  { id: "30", label: "30 Days" },
  { id: "90", label: "90 Days" },
];

var DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function DailyProfitTab() {
  var [win, setWin] = useState("90");
  var [smoothed, setSmoothed] = useState(true);
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);

  function currentMonth() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  useEffect(function() {
    var cancelled = false;
    setLoading(true);
    setError(null);
    var url = win === "month"
      ? "/api/dialpad/daily-profit?month=" + currentMonth()
      : "/api/dialpad/daily-profit?window=" + win;
    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (cancelled) return;
        if (json.success) setData(json);
        else setError(json.error || "Failed to load");
        setLoading(false);
      })
      .catch(function(e) { if (!cancelled) { setError(e.message); setLoading(false); } });
    return function() { cancelled = true; };
  }, [win]);

  // Merge per-store series into one array keyed by date for the multi-line chart.
  var chartData = useMemo(function() {
    if (!data) return [];
    var byDate = {};
    (data.dates || []).forEach(function(d) { byDate[d] = { date: d }; });
    (data.stores || []).forEach(function(s) {
      (s.series || []).forEach(function(pt) {
        if (!byDate[pt.date]) byDate[pt.date] = { date: pt.date };
        byDate[pt.date][s.store + "_gp"] = pt.gp;
        byDate[pt.date][s.store + "_avg"] = pt.gp_avg7;
      });
    });
    return (data.dates || []).map(function(d) { return byDate[d]; });
  }, [data]);

  var combined = data ? data.combined : null;

  return (
    <div style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>{"\uD83D\uDCC8"}</span>
            <h2 style={{ margin: 0, color: TEXT, fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }}>Daily Profit</h2>
          </div>
          <div style={{ color: TEXT_MUTED, fontSize: 12, marginTop: 4, maxWidth: 640 }}>
            Gross profit by store, by day closed. {data && data.note ? data.note : "Captured (graded) tickets only — not a full store P&L."}
          </div>
        </div>
        {/* Window switcher */}
        <div style={{ display: "flex", gap: 6, background: BG_INSET, padding: 4, borderRadius: 10, border: "1px solid " + BORDER }}>
          {WINDOWS.map(function(w) {
            var on = win === w.id;
            return (
              <button key={w.id} onClick={function() { setWin(w.id); }}
                style={{ padding: "7px 14px", borderRadius: 7, border: "none", cursor: "pointer",
                  background: on ? "#7B2FFF22" : "transparent", color: on ? "#A78BFA" : TEXT_DIM,
                  fontSize: 12, fontWeight: 700, fontFamily: "inherit", transition: "all .15s" }}>
                {w.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && (
        <div style={{ padding: 60, textAlign: "center", color: TEXT_DIM, fontSize: 14 }}>
          <div style={{ display: "inline-block", width: 28, height: 28, border: "3px solid " + BORDER, borderTopColor: "#7B2FFF", borderRadius: "50%", animation: "dpspin 0.8s linear infinite" }} />
          <div style={{ marginTop: 12 }}>Crunching the numbers…</div>
          <style>{"@keyframes dpspin{to{transform:rotate(360deg)}}"}</style>
        </div>
      )}

      {error && !loading && (
        <div style={{ padding: 20, borderRadius: 10, background: "#DC262611", border: "1px solid #DC262644", color: "#FCA5A5", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <div>
          {/* ── Combined summary strip ── */}
          {combined && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 18 }}>
              <SummaryCard label="Total Gross Profit" value={fmtUSD0(combined.gp)} accent={GREEN} big />
              <SummaryCard label="Revenue" value={fmtUSD0(combined.revenue)} accent="#00D4FF" />
              <SummaryCard label="Margin" value={(combined.gpm_pct || 0).toFixed(1) + "%"} accent="#A78BFA" />
              <SummaryCard label="Tickets" value={(combined.tickets || 0).toLocaleString()} accent="#FBBF24" />
              <SummaryCard label="Avg GP / Ticket" value={fmtUSD(combined.avg_gp_per_ticket)} accent="#FF2D95" />
            </div>
          )}

          {/* ── Hero: multi-line trend ── */}
          <div style={{ background: BG_CARD, borderRadius: 14, border: "1px solid " + BORDER, padding: 20, marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
              <div style={{ color: TEXT, fontSize: 14, fontWeight: 700 }}>
                Daily Gross Profit Trend
                <span style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 500, marginLeft: 8 }}>
                  {smoothed ? "line: 7-day rolling average · hover for actual" : "raw daily"}
                </span>
              </div>
              <button onClick={function() { setSmoothed(!smoothed); }}
                style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid " + BORDER, cursor: "pointer",
                  background: BG_INSET, color: smoothed ? "#A78BFA" : TEXT_DIM, fontSize: 11, fontWeight: 700, fontFamily: "inherit" }}>
                {smoothed ? "\u2728 Smoothed" : "Raw"}
              </button>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDateShort} tick={{ fill: TEXT_DIM, fontSize: 10 }} tickLine={false} axisLine={{ stroke: BORDER }} minTickGap={28} />
                <YAxis tickFormatter={function(v) { return "$" + (v >= 1000 ? (v / 1000).toFixed(1) + "k" : v); }} tick={{ fill: TEXT_DIM, fontSize: 10 }} tickLine={false} axisLine={false} width={52} />
                <Tooltip content={<TrendTooltip smoothed={smoothed} />} />
                <Legend content={<StoreLegend />} />
                {STORE_KEYS.map(function(s) {
                  return (
                    <Line key={s} type="monotone"
                      dataKey={smoothed ? s + "_avg" : s + "_gp"}
                      name={storeShort(s)}
                      stroke={storeColor(s)} strokeWidth={2.5} dot={false}
                      activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* ── Per-store analysis cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, marginBottom: 18 }}>
            {(data.stores || []).map(function(s) {
              return <StoreCard key={s.store} s={s} />;
            })}
          </div>

          {/* ── Day-of-week rhythm ── */}
          <div style={{ background: BG_CARD, borderRadius: 14, border: "1px solid " + BORDER, padding: 20, marginBottom: 18 }}>
            <div style={{ color: TEXT, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Which Days Earn</div>
            <div style={{ color: TEXT_DIM, fontSize: 11, marginBottom: 16 }}>Average gross profit per active day, by weekday — reveals your strongest and slowest days.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
              {(data.stores || []).map(function(s) {
                var maxAvg = Math.max.apply(null, s.dow.map(function(d) { return d.avg_gp; }).concat([1]));
                return (
                  <div key={s.store}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: storeColor(s.store) }} />
                      <span style={{ color: TEXT, fontSize: 12, fontWeight: 700 }}>{storeShort(s.store)}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {s.dow.map(function(d, i) {
                        var w = maxAvg > 0 ? (d.avg_gp / maxAvg) * 100 : 0;
                        return (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 28, color: TEXT_DIM, fontSize: 10, fontWeight: 600 }}>{DOW_LABELS[i]}</span>
                            <div style={{ flex: 1, height: 14, background: BG_INSET, borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ width: w + "%", height: "100%", background: storeColor(s.store), opacity: 0.85, borderRadius: 4, transition: "width .4s" }} />
                            </div>
                            <span style={{ width: 54, textAlign: "right", color: d.avg_gp > 0 ? TEXT_MUTED : TEXT_DIM, fontSize: 10, fontVariantNumeric: "tabular-nums" }}>{fmtUSD0(d.avg_gp)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Calendar heatmaps ── */}
          <div style={{ background: BG_CARD, borderRadius: 14, border: "1px solid " + BORDER, padding: 20 }}>
            <div style={{ color: TEXT, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Profit Calendar</div>
            <div style={{ color: TEXT_DIM, fontSize: 11, marginBottom: 16 }}>Each square is a day. Brighter = more gross profit. Empty squares are days with no captured tickets.</div>
            {(data.stores || []).map(function(s) {
              return <Heatmap key={s.store} s={s} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Summary card ────────────────────────────────────────────────────
function SummaryCard(props) {
  return (
    <div style={{ background: BG_CARD, borderRadius: 12, border: "1px solid " + BORDER, padding: 16, borderTop: "3px solid " + props.accent }}>
      <div style={{ color: TEXT_DIM, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>{props.label}</div>
      <div style={{ color: props.accent, fontSize: props.big ? 28 : 22, fontWeight: 900, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}

// ── Per-store analysis card ─────────────────────────────────────────
function StoreCard(props) {
  var s = props.s;
  var t = s.totals;
  var c = storeColor(s.store);
  return (
    <div style={{ background: BG_CARD, borderRadius: 14, border: "1px solid " + c + "44", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: c }} />
        <span style={{ color: TEXT, fontSize: 15, fontWeight: 800 }}>{storeShort(s.store)}</span>
        <span style={{ marginLeft: "auto", color: c, fontSize: 22, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{fmtUSD0(t.gp)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Metric label="Margin" value={(t.gpm_pct || 0).toFixed(1) + "%"} />
        <Metric label="Tickets" value={(t.tickets || 0).toLocaleString()} />
        <Metric label="Avg GP / Ticket" value={fmtUSD(t.avg_gp_per_ticket)} />
        <Metric label="Avg / Active Day" value={fmtUSD0(t.avg_gp_per_active_day)} />
      </div>
      {t.best_day && t.best_day.gp > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid " + BORDER, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: TEXT_DIM, fontSize: 11 }}>Best day</span>
          <span style={{ color: GREEN, fontSize: 13, fontWeight: 700 }}>{fmtDateShort(t.best_day.date)} · {fmtUSD0(t.best_day.gp)}</span>
        </div>
      )}
    </div>
  );
}

function Metric(props) {
  return (
    <div>
      <div style={{ color: TEXT_DIM, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>{props.label}</div>
      <div style={{ color: TEXT, fontSize: 16, fontWeight: 700, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}

// ── Calendar heatmap (week columns, weekday rows) ───────────────────
function Heatmap(props) {
  var s = props.s;
  var c = storeColor(s.store);
  var series = s.series || [];
  if (series.length === 0) return null;
  var maxGp = Math.max.apply(null, series.map(function(p) { return p.gp; }).concat([1]));

  // Build week columns. Each column = a calendar week (Sun..Sat). Pad the first
  // week so the first day lands on its correct weekday row.
  var first = series[0].date.split("-");
  var firstDow = new Date(parseInt(first[0], 10), parseInt(first[1], 10) - 1, parseInt(first[2], 10)).getDay();
  var cells = [];
  for (var i = 0; i < firstDow; i++) cells.push(null);
  series.forEach(function(p) { cells.push(p); });
  var weeks = [];
  for (var w = 0; w < cells.length; w += 7) weeks.push(cells.slice(w, w + 7));

  function cellColor(gp) {
    if (gp <= 0) return BG_INSET;
    var ratio = Math.min(1, gp / maxGp);
    // intensity ramp on the store color
    var alpha = 0.20 + ratio * 0.80;
    return hexA(c, alpha);
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />
        <span style={{ color: TEXT, fontSize: 12, fontWeight: 700 }}>{storeShort(s.store)}</span>
        <span style={{ color: TEXT_DIM, fontSize: 10, marginLeft: 4 }}>peak {fmtUSD0(maxGp)}/day</span>
      </div>
      <div style={{ display: "flex", gap: 3, overflowX: "auto", paddingBottom: 4 }}>
        {weeks.map(function(week, wi) {
          return (
            <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[0, 1, 2, 3, 4, 5, 6].map(function(di) {
                var cell = week[di];
                if (!cell) return <div key={di} style={{ width: 13, height: 13 }} />;
                var title = fmtDateShort(cell.date) + " · " + fmtUSD0(cell.gp) + " · " + cell.tickets + " tix";
                return (
                  <div key={di} title={title}
                    style={{ width: 13, height: 13, borderRadius: 3, background: cellColor(cell.gp),
                      border: "1px solid " + (cell.gp > 0 ? "transparent" : BORDER) }} />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// hex + alpha -> rgba
function hexA(hex, a) {
  var h = hex.replace("#", "");
  var r = parseInt(h.substring(0, 2), 16);
  var g = parseInt(h.substring(2, 4), 16);
  var b = parseInt(h.substring(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + a.toFixed(2) + ")";
}

// ── Custom chart tooltip ────────────────────────────────────────────
function TrendTooltip(props) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  // The merged row for this date is on every payload entry's .payload. Read the
  // RAW daily GP per store from it, so the tooltip always reports the actual
  // profit for the hovered day — never the rolling average, even in Smoothed
  // mode (the smoothed line is for trend shape; the tooltip is for truth).
  var row = props.payload[0] && props.payload[0].payload ? props.payload[0].payload : {};
  return (
    <div style={{ background: "#0E1014", border: "1px solid " + BORDER, borderRadius: 8, padding: "10px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
      <div style={{ color: TEXT, fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{fmtDateShort(props.label)}</div>
      <div style={{ color: TEXT_DIM, fontSize: 9, marginBottom: 6 }}>{props.smoothed ? "actual GP (line shows 7-day avg)" : "actual GP"}</div>
      {props.payload.map(function(p, i) {
        // Each line's dataKey is "<store>_gp" or "<store>_avg"; strip to store key.
        var key = String(p.dataKey || "").replace(/_avg$|_gp$/, "");
        var rawVal = row[key + "_gp"];
        var avgVal = row[key + "_avg"];
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
            <span style={{ color: TEXT_MUTED, fontSize: 11, minWidth: 70 }}>{p.name}</span>
            <span style={{ color: TEXT, fontSize: 11, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtUSD(rawVal != null ? rawVal : p.value)}</span>
            {props.smoothed && avgVal != null && (
              <span style={{ color: TEXT_DIM, fontSize: 9, fontVariantNumeric: "tabular-nums" }}>avg {fmtUSD0(avgVal)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StoreLegend(props) {
  if (!props.payload) return null;
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 18, marginTop: 8 }}>
      {props.payload.map(function(e, i) {
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: e.color }} />
            <span style={{ color: TEXT_MUTED, fontSize: 11, fontWeight: 600 }}>{e.value}</span>
          </div>
        );
      })}
    </div>
  );
}

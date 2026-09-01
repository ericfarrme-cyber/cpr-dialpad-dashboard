// Advanced Repair Traffic summary — non-phone repair volume, mix and profit.
"use client";

import { useEffect, useState } from "react";

// Brand (CLAUDE.md): dark, Space Grotesk, cyan / purple / pink.
var CYAN = "#00D4FF";
var GOLD = "#FBBF24";
var GREEN = "#4ADE80";
var INK = "#F0F1F3";
var INK2 = "#B6BCC6";
var MUTED = "#6B6F78";
var SURFACE = "#1A1D23";
var SURFACE2 = "#22262E";
var LINE = "#2C313A";

// Categorical set for the four buckets, validated against the dark surface:
// lightness band, chroma floor, CVD ΔE 11.0, normal-vision ΔE 26.3, contrast — all pass.
var BUCKETS = [
  { key: "consoles",  label: "Consoles",  color: "#2E9DB5" },
  { key: "tablets",   label: "Tablets",   color: "#7B2FFF" },
  { key: "computers", label: "Computers", color: "#FF2D95" },
  { key: "misc",      label: "Misc",      color: "#B5862A" },
];

var STORES = [
  { key: "fishers",      label: "Fishers",      color: "#E03E3E" },
  { key: "bloomington",  label: "Bloomington",  color: "#1A9E8F" },
  { key: "indianapolis", label: "Indianapolis", color: "#D4A017" },
];

// Months whose device_category coverage is too low to trust are SHOWN but greyed
// and labelled, never hidden — a missing month reads as a quiet zero, and this
// codebase's rule is to surface what was dropped rather than drop it silently.
// Flip to true to hide them instead.
var HIDE_INCOMPLETE_MONTHS = false;

function money(n) {
  var v = parseFloat(n || 0);
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money0(n) {
  var v = parseFloat(n || 0);
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function monthLabel(ym) {
  var p = String(ym).split("-");
  var names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return names[parseInt(p[1], 10) - 1] + " " + p[0].slice(2);
}

var mono = "'IBM Plex Mono', ui-monospace, monospace";
var display = "'Space Grotesk', sans-serif";

export default function AdvancedRepairTrafficSummary({ store }) {
  var [data, setData] = useState(null);
  var [err, setErr] = useState("");
  var [loading, setLoading] = useState(true);

  useEffect(function () {
    var cancelled = false;
    setLoading(true);
    setErr("");
    var url = "/api/dialpad/advanced-repair-traffic?months=6" +
      (store && store !== "all" ? "&store=" + encodeURIComponent(store) : "");
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (cancelled) return;
        if (!j.success) { setErr(j.error || "Failed to load"); setData(null); }
        else setData(j);
        setLoading(false);
      })
      .catch(function (e) {
        if (cancelled) return;
        setErr(e.message); setLoading(false);
      });
    return function () { cancelled = true; };
  }, [store]);

  if (loading) return <div style={{ padding: 20, color: MUTED, fontSize: 13 }}>Loading advanced repair traffic…</div>;
  if (err) {
    return (
      <div style={{ padding: 14, background: "rgba(248,113,113,.1)", border: "1px solid rgba(248,113,113,.35)",
                    borderRadius: 10, color: "#F87171", fontSize: 13, marginBottom: 20 }}>
        Advanced repair traffic failed to load: {err}
      </div>
    );
  }
  if (!data || !data.months || data.months.length === 0) return null;

  var months = data.months.filter(function (m) { return HIDE_INCOMPLETE_MONTHS ? m.complete : true; });
  var complete = months.filter(function (m) { return m.complete; });
  var latest = complete.length ? complete[complete.length - 1] : months[months.length - 1];
  var first = complete.length ? complete[0] : null;

  function delta(now, then) {
    if (!then || !then.tickets) return null;
    var pct = Math.round(((now - then) / then) * 100);
    return (pct >= 0 ? "+" : "") + pct + "%";
  }

  var maxTickets = Math.max.apply(null, months.map(function (m) { return m.complete ? m.tickets : 0 }).concat([1]));
  var chartH = 150;

  var kpis = [
    { label: "Advanced repairs", value: String(latest.tickets), sub: first ? delta(latest.tickets, first.tickets) + " vs " + monthLabel(first.month) : "", color: BUCKETS[0].color },
    { label: "Share of repair traffic", value: (latest.share_of_repair_traffic != null ? latest.share_of_repair_traffic + "%" : "—"), sub: first && first.share_of_repair_traffic != null ? "from " + first.share_of_repair_traffic + "%" : "", color: CYAN },
    { label: "Revenue", value: money0(latest.revenue), sub: first ? delta(latest.revenue, first.revenue) + " vs " + monthLabel(first.month) : "", color: BUCKETS[1].color },
    { label: "Gross profit", value: money0(latest.profit), sub: first ? delta(latest.profit, first.profit) + " vs " + monthLabel(first.month) : "", color: GREEN },
  ];

  return (
    <div style={{ marginBottom: 28 }}>
      {/* ── header ─────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ fontFamily: display, fontSize: 17, fontWeight: 700, color: INK, margin: 0, letterSpacing: "-.01em" }}>
          Advanced Repair Traffic
        </h2>
        <span style={{ fontFamily: mono, fontSize: 11, color: MUTED }}>
          {monthLabel(latest.month)} · repair + claim · sales excluded
        </span>
      </div>
      <p style={{ color: MUTED, fontSize: 12, margin: "0 0 16px" }}>
        Non-phone work closed per month, from RepairQ. Separate from the commission table below.
      </p>

      {/* ── KPI row ────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginBottom: 18 }}>
        {kpis.map(function (k) {
          return (
            <div key={k.label} style={{ background: SURFACE, border: "1px solid " + LINE, borderTop: "3px solid " + k.color,
                                        borderRadius: 11, padding: "14px 16px" }}>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".11em", textTransform: "uppercase", color: MUTED }}>{k.label}</div>
              <div style={{ fontFamily: display, fontSize: 27, fontWeight: 700, color: INK, letterSpacing: "-.03em",
                            margin: "5px 0 2px", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
              <div style={{ fontFamily: mono, fontSize: 11, color: GREEN }}>{k.sub}</div>
            </div>
          );
        })}
      </div>

      {/* ── traffic by category ────────────────────────────────── */}
      <div style={{ background: SURFACE, border: "1px solid " + LINE, borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
        <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color: INK, marginBottom: 2 }}>Traffic by category</div>
        <div style={{ fontSize: 11.5, color: MUTED, marginBottom: 18 }}>Advanced repair tickets closed per month.</div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 22, height: chartH + 22, paddingTop: 22 }}>
          {months.map(function (m) {
            if (!m.complete) {
              return (
                <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end",
                                            height: "100%", position: "relative", opacity: .45 }}>
                  <div style={{ position: "absolute", top: -20, left: 0, right: 0, textAlign: "center",
                                fontFamily: mono, fontSize: 10, color: GOLD }}>incomplete</div>
                  <div style={{ height: 26, border: "1px dashed " + LINE, borderRadius: 4, background: SURFACE2 }} />
                </div>
              );
            }
            return (
              <div key={m.month} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end",
                                          gap: 2, height: "100%", position: "relative" }}>
                <div style={{ position: "absolute", top: -20, left: 0, right: 0, textAlign: "center",
                              fontFamily: mono, fontSize: 11.5, color: INK, fontVariantNumeric: "tabular-nums" }}>{m.tickets}</div>
                {BUCKETS.slice().reverse().map(function (b, i) {
                  var t = (m.buckets[b.key] || {}).tickets || 0;
                  if (!t) return null;
                  var h = Math.max(2, (t / maxTickets) * chartH);
                  var isTop = i === BUCKETS.length - 1;
                  return <div key={b.key} title={b.label + ": " + t + " tickets"}
                              style={{ height: h, background: b.color, borderRadius: isTop ? "4px 4px 2px 2px" : 2 }} />;
                })}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 7 }}>
          {months.map(function (m) {
            return <div key={m.month} style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: 11,
                                               color: m.complete ? MUTED : GOLD }}>{monthLabel(m.month)}</div>;
          })}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, fontSize: 12, color: INK2 }}>
          {BUCKETS.map(function (b) {
            return (
              <span key={b.key}>
                <i style={{ width: 10, height: 10, borderRadius: 3, background: b.color, display: "inline-block", marginRight: 6, verticalAlign: -1 }} />
                {b.label}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── category detail ───────────────────────────────────── */}
      <div style={{ background: SURFACE, border: "1px solid " + LINE, borderRadius: 12, padding: "16px 18px", marginBottom: 14, overflowX: "auto" }}>
        <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color: INK, marginBottom: 12 }}>
          {monthLabel(latest.month)} detail
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 520 }}>
          <thead><tr>{["Category", "Tickets", "Profit", "Avg / ticket", "Turnaround"].map(function (h, i) {
            return <th key={h} style={{ textAlign: i === 0 ? "left" : "right", fontFamily: mono, fontSize: 10,
                                        letterSpacing: ".11em", textTransform: "uppercase", color: MUTED, fontWeight: 500,
                                        padding: "0 8px 8px", borderBottom: "1px solid " + LINE }}>{h}</th>;
          })}</tr></thead>
          <tbody>
            {BUCKETS.map(function (b) {
              var v = latest.buckets[b.key] || { tickets: 0, profit: 0, avg_per_ticket: 0, avg_turnaround_hours: null };
              return (
                <tr key={b.key}>
                  <td style={{ padding: "9px 8px", borderBottom: "1px solid #23272F", color: INK, fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: b.color, display: "inline-block", marginRight: 9 }} />
                    {b.label}
                  </td>
                  {[String(v.tickets), money(v.profit), money(v.avg_per_ticket),
                    v.avg_turnaround_hours != null ? Math.round(v.avg_turnaround_hours) + " h" : "—"].map(function (cell, i) {
                    return <td key={i} style={{ padding: "9px 8px", borderBottom: "1px solid #23272F", color: INK2,
                                                textAlign: "right", fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>{cell}</td>;
                  })}
                </tr>
              );
            })}
            {/* Always visible, even at zero — never silently drop uncategorised work. */}
            <tr>
              <td style={{ padding: "9px 8px", color: MUTED, fontStyle: "italic" }}>Uncategorised</td>
              <td style={{ padding: "9px 8px", color: latest.uncategorised > 0 ? GOLD : MUTED, textAlign: "right", fontFamily: mono }}>{latest.uncategorised}</td>
              <td colSpan={3} style={{ padding: "9px 8px", color: MUTED, textAlign: "right", fontSize: 11.5 }}>
                {latest.uncategorised > 0 ? "excluded from the totals above" : "none"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── stores + techs ────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 14 }}>
        <div style={{ background: SURFACE, border: "1px solid " + LINE, borderRadius: 12, padding: "16px 18px", overflowX: "auto" }}>
          <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color: INK, marginBottom: 2 }}>By store</div>
          <div style={{ fontSize: 11, color: GOLD, marginBottom: 12 }}>
            Provisional — attribution was corrected 2026-08-31 and applies to tickets graded after that. Combined totals are exact.
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {STORES.map(function (s) {
                var v = latest.stores[s.key] || { tickets: 0, profit: 0 };
                var pct = latest.profit > 0 ? (v.profit / latest.profit) * 100 : 0;
                return (
                  <tr key={s.key}>
                    <td style={{ padding: "9px 8px 9px 0", color: INK, fontWeight: 600 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color, display: "inline-block", marginRight: 9 }} />
                      {s.label}
                    </td>
                    <td style={{ padding: "9px 8px", color: INK2, textAlign: "right", fontFamily: mono }}>{v.tickets}</td>
                    <td style={{ padding: "9px 8px", color: INK2, textAlign: "right", fontFamily: mono }}>{money(v.profit)}</td>
                    <td style={{ padding: "9px 0 9px 8px", width: 96 }}>
                      <div style={{ height: 6, borderRadius: 3, background: SURFACE2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: pct + "%", background: s.color, borderRadius: 3 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ background: SURFACE, border: "1px solid " + LINE, borderRadius: 12, padding: "16px 18px", overflowX: "auto" }}>
          <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color: INK, marginBottom: 2 }}>Closed by</div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>{monthLabel(data.technicians_month || latest.month)}</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {(data.technicians || []).slice(0, 8).map(function (t) {
                return (
                  <tr key={t.employee}>
                    <td style={{ padding: "8px 8px 8px 0", color: t.employee === "Unattributed" ? MUTED : INK,
                                 fontWeight: t.employee === "Unattributed" ? 400 : 600,
                                 fontStyle: t.employee === "Unattributed" ? "italic" : "normal" }}>{t.employee}</td>
                    <td style={{ padding: "8px", color: INK2, textAlign: "right", fontFamily: mono }}>{t.tickets}</td>
                    <td style={{ padding: "8px 0 8px 8px", color: INK2, textAlign: "right", fontFamily: mono }}>{money(t.profit)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── bonus ─────────────────────────────────────────────── */}
      <div style={{ background: SURFACE, border: "1px solid " + LINE, borderRadius: 12, padding: "16px 18px",
                    display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 22, alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: display, fontSize: 14, fontWeight: 700, color: INK, marginBottom: 8 }}>
            Non-phone bonus — {monthLabel(latest.month)}
          </div>
          <div style={{ fontFamily: display, fontSize: 30, fontWeight: 700, color: INK, letterSpacing: "-.03em",
                        fontVariantNumeric: "tabular-nums" }}>{money(latest.profit)}</div>
          <div style={{ marginTop: 8 }}>
            <span style={{ display: "inline-block", borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 700,
                           background: latest.bonus.cleared ? "rgba(74,222,128,.14)" : "rgba(107,111,120,.16)",
                           color: latest.bonus.cleared ? GREEN : MUTED,
                           border: "1px solid " + (latest.bonus.cleared ? "rgba(74,222,128,.32)" : LINE) }}>
              {latest.bonus.cleared
                ? "● Cleared — " + money(latest.bonus.over) + " over"
                : money(Math.abs(latest.bonus.over)) + " short of " + money0(latest.bonus.threshold)}
            </span>
          </div>
          <div style={{ position: "relative", height: 11, background: SURFACE2, borderRadius: 6, marginTop: 14 }}>
            <div style={{ position: "absolute", inset: "0 auto 0 0", borderRadius: 6,
                          width: Math.min(100, (latest.profit / (latest.bonus.threshold * 1.15)) * 100) + "%",
                          background: "linear-gradient(90deg,#00D4FF,#7B2FFF)" }} />
            <div style={{ position: "absolute", top: -5, bottom: -5, width: 2, background: GOLD, left: (1 / 1.15) * 100 + "%" }} />
          </div>
        </div>
        <div style={{ borderLeft: "1px solid " + LINE, paddingLeft: 20 }}>
          {[["Base at " + money0(latest.bonus.threshold), latest.bonus.cleared ? money(100) : money(0)],
            ["$50 per $1,000 above", money(Math.max(0, latest.bonus.amount - (latest.bonus.cleared ? 100 : 0)))],
            ["Remainder carried", money(latest.bonus.unpaid_remainder)]].map(function (r) {
            return (
              <div key={r[0]} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", color: INK2 }}>
                <span>{r[0]}</span><span style={{ fontFamily: mono, color: INK }}>{r[1]}</span>
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid " + LINE, marginTop: 6,
                        paddingTop: 9, fontSize: 13, fontWeight: 700, color: INK }}>
            <span>{monthLabel(latest.month)} bonus</span>
            <span style={{ fontFamily: display, fontSize: 19, color: GREEN }}>{money(latest.bonus.amount)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

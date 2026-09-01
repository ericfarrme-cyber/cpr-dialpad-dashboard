// Morning brief — yesterday at a glance, for whoever opens the dashboard first.
"use client";

import { useEffect, useState } from "react";

var CYAN = "#00D4FF";
var GREEN = "#4ADE80";
var GOLD = "#FBBF24";
var RED = "#F87171";
var INK = "#F0F1F3";
var INK2 = "#AEB4BE";
var MUTED = "#6B6F78";
var SURFACE = "#181B21";
var RAISED = "#1F232B";
var LINE = "#282D36";

var STORES = [
  { key: "fishers", label: "Fishers", color: "#E03E3E" },
  { key: "bloomington", label: "Bloomington", color: "#1A9E8F" },
  { key: "indianapolis", label: "Indianapolis", color: "#D4A017" },
];

var MONO = "'IBM Plex Mono', ui-monospace, monospace";
var DISPLAY = "'Space Grotesk', sans-serif";
var DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
// Indiana-local, so "yesterday" flips at local midnight rather than UTC.
function indyNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
}
function ymd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function money(n) {
  return "$" + parseFloat(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money0(n) {
  return "$" + parseFloat(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export default function MorningBrief() {
  var [state, setState] = useState({ loading: true });
  var [open, setOpen] = useState(true);

  // Collapse is remembered per day, so dismissing it in the morning keeps it
  // dismissed until tomorrow's brief is a different brief.
  var todayKey = ymd(indyNow());
  useEffect(function () {
    try {
      if (window.localStorage.getItem("cpr_brief_collapsed") === todayKey) setOpen(false);
    } catch (e) { /* private mode — just leave it open */ }
  }, [todayKey]);
  function toggle() {
    var next = !open;
    setOpen(next);
    try {
      if (!next) window.localStorage.setItem("cpr_brief_collapsed", todayKey);
      else window.localStorage.removeItem("cpr_brief_collapsed");
    } catch (e) { /* ignore */ }
  }

  useEffect(function () {
    var cancelled = false;
    var y = indyNow(); y.setDate(y.getDate() - 1);
    var yKey = ymd(y);

    Promise.allSettled([
      fetch("/api/dialpad/daily-profit?window=10").then(function (r) { return r.json(); }),
      fetch("/api/dialpad/stored").then(function (r) { return r.json(); }),
      fetch("/api/dialpad/appointments?action=stats&days=2").then(function (r) { return r.json(); }),
      fetch("/api/dialpad/flags?action=active").then(function (r) { return r.json(); }),
    ]).then(function (res) {
      if (cancelled) return;
      var out = { loading: false, date: yKey, stores: {}, missing: [] };

      // Profit — per store, for yesterday only.
      var dp = res[0].status === "fulfilled" ? res[0].value : null;
      if (dp && dp.success) {
        (dp.stores || []).forEach(function (s) {
          var row = (s.series || []).find(function (p) { return p.date === yKey; });
          out.stores[s.store] = Object.assign(out.stores[s.store] || {}, {
            gp: row ? row.gp : null, tickets: row ? row.tickets : null,
            avg7: row ? row.gp_avg7 : null,
          });
        });
      } else out.missing.push("profit");

      // Calls — answered / missed for yesterday.
      var st = res[1].status === "fulfilled" ? res[1].value : null;
      var daily = st && st.data ? (st.data.dailyCalls || []) : [];
      var dayRow = daily.find(function (d) { return d.date === yKey; });
      if (dayRow) {
        STORES.forEach(function (s) {
          var a = dayRow[s.key + "_answered"] || 0;
          var m = dayRow[s.key + "_missed"] || 0;
          out.stores[s.key] = Object.assign(out.stores[s.key] || {}, {
            answered: a, missed: m,
            rate: (a + m) > 0 ? (a / (a + m)) * 100 : null,
            afterHours: dayRow[s.key + "_after_hours_missed"] || 0,
          });
        });
      } else out.missing.push("calls");

      var ap = res[2].status === "fulfilled" ? res[2].value : null;
      out.appts = ap && ap.success ? ap.stats : null;
      if (!out.appts) out.missing.push("appointments");

      var fl = res[3].status === "fulfilled" ? res[3].value : null;
      out.flags = fl && fl.success ? fl : null;

      setState(out);
    });
    return function () { cancelled = true; };
  }, []);

  if (state.loading) {
    return (
      <div style={{ background: SURFACE, border: "1px solid " + LINE, borderRadius: 14, padding: 18, marginBottom: 22, color: MUTED, fontSize: 13 }}>
        Building this morning's brief…
      </div>
    );
  }

  var y = indyNow(); y.setDate(y.getDate() - 1);
  var dayName = DAYS[y.getDay()] + ", " + MON[y.getMonth()] + " " + y.getDate();
  var hour = indyNow().getHours();
  var greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  var totalGp = 0, totalTix = 0, totalAns = 0, totalMissed = 0, haveProfit = false;
  STORES.forEach(function (s) {
    var v = state.stores[s.key] || {};
    if (v.gp != null) { totalGp += v.gp; haveProfit = true; }
    if (v.tickets != null) totalTix += v.tickets;
    if (v.answered != null) totalAns += v.answered;
    if (v.missed != null) totalMissed += v.missed;
  });
  var totalRate = (totalAns + totalMissed) > 0 ? (totalAns / (totalAns + totalMissed)) * 100 : null;
  var regressions = state.flags && state.flags.grouped ? state.flags.grouped.regression || [] : [];
  var wins = state.flags && state.flags.grouped ? state.flags.grouped.win || [] : [];

  // Flag headlines usually begin with the employee's own name, which reads as a
  // stutter next to the bolded name: "Samuel Tomey — Samuel Tomey has 3 repair
  // tickets...". Drop the prefix when it repeats.
  function flagText(f) {
    var t = (f.headline || f.metric_label || "").trim();
    var who = (f.employee_name || "").trim();
    if (who && t.toLowerCase().indexOf(who.toLowerCase()) === 0) {
      t = t.slice(who.length).replace(/^[\s:,—-]+/, "");
    }
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  function rateColor(r) { return r == null ? MUTED : r >= 90 ? GREEN : r >= 80 ? GOLD : RED; }

  return (
    <div style={{ background: "linear-gradient(180deg,#1B1F27,#181B21)", border: "1px solid " + LINE,
                  borderRadius: 14, marginBottom: 22, overflow: "hidden" }}>
      <style>{`.mb-row:hover{background:rgba(255,255,255,.035)}`}</style>

      {/* header */}
      <div onClick={toggle} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    gap: 12, padding: "15px 20px", cursor: "pointer", borderBottom: open ? "1px solid " + LINE : "none" }}>
        <div>
          <div style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, color: INK, letterSpacing: "-.01em" }}>
            {greeting}
          </div>
          <div style={{ color: MUTED, fontSize: 12, marginTop: 3 }}>
            Yesterday — {dayName}
            {haveProfit && <span> · {money0(totalGp)} profit · {totalTix} tickets{totalRate != null ? " · " + totalRate.toFixed(0) + "% answered" : ""}</span>}
          </div>
        </div>
        <span style={{ color: MUTED, fontSize: 12, fontFamily: MONO, whiteSpace: "nowrap" }}>
          {open ? "hide ▲" : "show ▼"}
        </span>
      </div>

      {open && (
        <div style={{ padding: "16px 20px 18px" }}>
          {/* per store */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 10, marginBottom: 14 }}>
            {STORES.map(function (s) {
              var v = state.stores[s.key] || {};
              var trend = (v.gp != null && v.avg7 != null) ? v.gp - v.avg7 : null;
              return (
                <div key={s.key} style={{ background: RAISED, border: "1px solid " + LINE, borderRadius: 11,
                                          padding: "12px 14px", borderTop: "3px solid " + s.color }}>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".11em", textTransform: "uppercase", color: MUTED }}>{s.label}</div>
                  <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color: INK, letterSpacing: "-.03em",
                                margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>
                    {v.gp != null ? money(v.gp) : "—"}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: trend == null ? MUTED : (trend >= 0 ? GREEN : RED) }}>
                    {trend == null ? "no profit data" : (trend >= 0 ? "▲ " : "▼ ") + money(Math.abs(trend)) + " vs 7-day avg"}
                  </div>
                  <div style={{ display: "flex", gap: 12, marginTop: 9, paddingTop: 9, borderTop: "1px solid " + LINE,
                                fontFamily: MONO, fontSize: 11, color: INK2 }}>
                    <span>{v.tickets != null ? v.tickets + " tix" : "—"}</span>
                    <span style={{ color: rateColor(v.rate) }}>
                      {v.rate != null ? v.rate.toFixed(0) + "% ans" : "—"}
                    </span>
                    <span style={{ color: v.missed > 0 ? GOLD : MUTED }}>
                      {v.missed != null ? v.missed + " missed" : "—"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* appointments + flags */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 10, alignItems: "start" }}>
            <div style={{ background: RAISED, border: "1px solid " + LINE, borderRadius: 11, padding: "12px 14px" }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".11em", textTransform: "uppercase", color: MUTED, marginBottom: 9 }}>
                Appointments · last 2 days
              </div>
              {state.appts ? (
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  {[["Scheduled", state.appts.total, INK], ["Arrived", state.appts.arrived, CYAN],
                    ["Converted", state.appts.converted, GREEN], ["No-show", state.appts.noShow, state.appts.noShow > 0 ? RED : MUTED]].map(function (m) {
                    return (
                      <div key={m[0]}>
                        <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: m[2], fontVariantNumeric: "tabular-nums" }}>{m[1]}</div>
                        <div style={{ fontSize: 11, color: MUTED }}>{m[0]}</div>
                      </div>
                    );
                  })}
                </div>
              ) : <div style={{ color: MUTED, fontSize: 12 }}>No appointment data.</div>}
              {state.appts && state.appts.needFollowUp > 0 && (
                <div style={{ marginTop: 10, fontSize: 11.5, color: GOLD }}>
                  {state.appts.needFollowUp} need follow-up
                </div>
              )}
            </div>

            <div style={{ background: RAISED, border: "1px solid " + LINE, borderRadius: 11, padding: "12px 14px" }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".11em", textTransform: "uppercase", color: MUTED, marginBottom: 9 }}>
                Coaching flags {state.flags ? "· " + state.flags.total + " active" : ""}
              </div>
              {regressions.length === 0 && wins.length === 0 && (
                <div style={{ color: MUTED, fontSize: 12 }}>Nothing flagged. Quiet morning.</div>
              )}
              {regressions.slice(0, 3).map(function (f) {
                return (
                  <div key={f.id} className="mb-row" style={{ display: "flex", gap: 9, alignItems: "baseline",
                                padding: "5px 6px", margin: "0 -6px", borderRadius: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: RED, flexShrink: 0, marginTop: 5 }} />
                    <span style={{ color: INK2, fontSize: 12.5, lineHeight: 1.45 }}>
                      <b style={{ color: INK }}>{f.employee_name || f.store}</b> — {flagText(f)}
                    </span>
                  </div>
                );
              })}
              {wins.slice(0, 2).map(function (f) {
                return (
                  <div key={f.id} className="mb-row" style={{ display: "flex", gap: 9, alignItems: "baseline",
                                padding: "5px 6px", margin: "0 -6px", borderRadius: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN, flexShrink: 0, marginTop: 5 }} />
                    <span style={{ color: INK2, fontSize: 12.5, lineHeight: 1.45 }}>
                      <b style={{ color: INK }}>{f.employee_name || f.store}</b> — {flagText(f)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Say what is missing rather than showing a confident blank. */}
          {(state.missing.length > 0) && (
            <div style={{ marginTop: 12, fontSize: 11.5, color: GOLD }}>
              No {state.missing.join(" or ")} data for {dayName} — those figures are blank rather than zero.
            </div>
          )}
          <div style={{ marginTop: 10, fontSize: 11, color: MUTED }}>
            Shrinkage MTD isn’t here yet — the inventory import hasn’t been built.
          </div>
        </div>
      )}
    </div>
  );
}

// Morning brief — yesterday at a glance, for whoever opens the dashboard first.
"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";

var CYAN = "var(--cyan)";
var GREEN = "var(--green)";
var GOLD = "var(--yellow)";
var RED = "var(--red)";
var INK = "var(--text-primary)";
var INK2 = "var(--text-body)";
var MUTED = "var(--text-muted)";
var SURFACE = "var(--bg-card-inner)";
var RAISED = "var(--bg-card-inner)";
var LINE = "var(--border)";

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

// A holiday is coming and nobody has said what the stores are doing. Asking
// now is the whole point: Dialpad tags a call closed from the department
// schedule, so an early close entered after the fact cannot retag anything —
// on Labor Day that left 10 missed calls counting against the stores, six at
// Fishers, which was the difference between 79.2% and 80.9% for September.
function HolidayHoursPrompt({ holiday, onSaved, saved, af }) {
  var [choice, setChoice] = useState(null); // "early" | "closed" | "normal"
  var [time, setTime] = useState("16:00");
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState(null);
  var when = holiday.days_away === 0 ? "today" : holiday.days_away === 1 ? "tomorrow" : "in " + holiday.days_away + " days";

  async function save(body) {
    setBusy(true); setErr(null);
    try {
      var res = await af("/api/dialpad/store-hours", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action: "set", date: holiday.date, stores: holiday.missing_stores, reason: holiday.name }, body)),
      });
      var j = await res.json();
      if (!j.success) throw new Error(j.error || "not saved");
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (saved) {
    return (
      <div style={{ background: RAISED, border: "1px solid " + GREEN, borderRadius: 11, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: GREEN }}>
        {holiday.name} hours saved — missed calls outside them will not count against the stores.
      </div>
    );
  }
  return (
    <div style={{ background: RAISED, border: "1px solid " + GOLD, borderRadius: 11, padding: "12px 14px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 13.5, fontWeight: 700, color: INK }}>{holiday.name} is {when}</span>
        <span style={{ fontSize: 11.5, color: MUTED }}>
          What are {holiday.missing_stores.length === 3 ? "the stores" : holiday.missing_stores.join(" and ")} doing? Set it now — after the day, missed calls already counted.
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        {[["early", "Closing early"], ["closed", "Closed all day"], ["normal", "Normal hours"]].map(function (c) {
          var on = choice === c[0];
          return (
            <button key={c[0]} onClick={function () { setChoice(c[0]); }} disabled={busy}
              style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid " + (on ? GOLD : LINE), background: on ? "#FBBF2418" : "transparent", color: on ? GOLD : INK2, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>{c[1]}</button>
          );
        })}
        {choice === "early" && (
          <>
            <input type="time" value={time} onChange={function (e) { setTime(e.target.value); }} step={900}
              style={{ padding: "5px 8px", borderRadius: 7, border: "1px solid " + LINE, background: "var(--bg-input)", color: INK, fontSize: 12 }} />
            <button disabled={busy} onClick={function () { save({ closes_at: time }); }}
              style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: GOLD, color: "#0B0D11", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>{busy ? "Saving…" : "Save"}</button>
          </>
        )}
        {choice === "closed" && (
          <button disabled={busy} onClick={function () { save({ closed_all_day: true }); }}
            style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: GOLD, color: "#0B0D11", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>{busy ? "Saving…" : "Save — closed all day"}</button>
        )}
        {choice === "normal" && (
          <span style={{ fontSize: 11.5, color: MUTED }}>Nothing to record — normal hours are what Dialpad already has.</span>
        )}
      </div>
      {err && <div style={{ fontSize: 11.5, color: RED, marginTop: 8, fontWeight: 700 }}>Not saved — {err}</div>}
    </div>
  );
}

export default function MorningBrief() {
  var [state, setState] = useState({ loading: true });
  var [open, setOpen] = useState(true);
  var [allDiscounts, setAllDiscounts] = useState(false);
  var [hoursSaved, setHoursSaved] = useState(null);
  var auth = useAuth();
  // Recording hours changes an answer rate, so the write carries the session.
  var af = auth && auth.authFetch ? auth.authFetch : fetch;

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
      fetch("/api/dialpad/discounts?date=" + yKey).then(function (r) { return r.json(); }),
      fetch("/api/dialpad/appointments?action=book_source&days=7").then(function (r) { return r.json(); }),
      fetch("/api/dialpad/store-hours?days=21").then(function (r) { return r.json(); }),
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

      // Discounts — every repair line rung under list yesterday, and which of
      // those went under what that repair usually sells for.
      var dc = res[4].status === "fulfilled" ? res[4].value : null;
      out.discounts = dc && dc.success ? dc : null;
      if (!out.discounts) out.missing.push("discount");

      // Where appointments came from this week — a booking typed by hand
      // carries no quote, no reason and no ticket link.
      var bsr = res[5].status === "fulfilled" ? res[5].value : null;
      out.bookSource = bsr && bsr.success ? bsr : null;

      // Holidays with no hours recorded yet. Asked BEFORE the day, because
      // afterwards Dialpad cannot retag the calls and the missed ones count.
      var sh = res[6].status === "fulfilled" ? res[6].value : null;
      out.storeHours = sh && sh.success ? sh : null;

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
    <div style={{ background: "linear-gradient(180deg,var(--bg-card-inner),var(--bg-card-inner))", border: "1px solid " + LINE,
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
          {/* holiday hours prompt — before the day, not after */}
          {state.storeHours && state.storeHours.holidays.filter(function (h) { return h.needs_hours; }).map(function (h) {
            return <HolidayHoursPrompt key={h.date} holiday={h} af={af} onSaved={function () { setHoursSaved(h.date); }} saved={hoursSaved === h.date} />;
          })}

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
              {state.bookSource && state.bookSource.stores.length > 0 && (
                <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid " + LINE }}>
                  <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase", color: MUTED, marginBottom: 5 }}>
                    Booked from the Price Book · last {state.bookSource.days} days
                  </div>
                  {state.bookSource.stores.map(function (s) {
                    var label = (STORES.find(function (x) { return x.key === s.store; }) || {}).label || s.store;
                    var tone = s.share >= 60 ? GREEN : s.share > 0 ? GOLD : RED;
                    return (
                      <div key={s.store} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11.5, padding: "2px 0" }}>
                        <span style={{ color: INK2 }}>{label}</span>
                        <span style={{ fontFamily: MONO, color: tone }}>
                          {s.price_book} of {s.total}
                          {s.price_book === 0 && s.top_manual ? <span style={{ color: MUTED }}> · all by hand ({s.top_manual})</span> : null}
                        </span>
                      </div>
                    );
                  })}
                  <div style={{ fontSize: 10.5, color: MUTED, marginTop: 5, lineHeight: 1.45 }}>
                    Booked by hand means no quote, no discount reason and no ticket link.
                  </div>
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

          {/* discounts — what was rung under list, and under what it usually sells for */}
          {state.discounts && (
            <div style={{ background: RAISED, border: "1px solid " + LINE, borderRadius: 11, padding: "12px 14px", marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 9 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: ".11em", textTransform: "uppercase", color: MUTED }}>
                  Discounts · {state.discounts.repair_lines} repair line{state.discounts.repair_lines === 1 ? "" : "s"} yesterday
                </div>
                {state.discounts.discounted > 0 && <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{money(state.discounts.discount_total)} given away</span>}
              </div>
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                {[["Discounted", state.discounts.discounted, state.discounts.discounted > 0 ? GOLD : MUTED],
                  ["Below average", state.discounts.below_avg, state.discounts.below_avg > 0 ? RED : MUTED]].map(function (m) {
                  return (
                    <div key={m[0]}>
                      <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: m[2], fontVariantNumeric: "tabular-nums" }}>{m[1]}</div>
                      <div style={{ fontSize: 11, color: MUTED }}>{m[0]}</div>
                    </div>
                  );
                })}
                <div style={{ alignSelf: "end", fontSize: 11, color: MUTED, maxWidth: 360, lineHeight: 1.4 }}>
                  “Below average” is under what that model + repair + tier sold for over {state.discounts.baseline_months} months — the same number the booking floor uses.
                </div>
              </div>
              {state.discounts.lines.length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid " + LINE }}>
                  {(allDiscounts ? state.discounts.lines : state.discounts.lines.slice(0, 6)).map(function (l, i) {
                    var gap = l.avg_collected !== null ? l.collected - l.avg_collected : null;
                    return (
                      <div key={l.ticket_number + "-" + i} className="mb-row" style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 6px", margin: "0 -6px", borderRadius: 6, fontSize: 12, flexWrap: "wrap" }}>
                        <a href={"https://cpr.repairq.io/ticket/" + l.ticket_number} target="_blank" rel="noreferrer"
                          style={{ fontFamily: MONO, color: CYAN, textDecoration: "none", whiteSpace: "nowrap" }}>#{l.ticket_number}</a>
                        <span style={{ color: INK2, flex: "1 1 220px" }}>
                          {l.model || l.device} · {l.repair}{l.tier ? " · " + l.tier : ""}
                          {l.employee && <span style={{ color: MUTED }}> — {l.employee}</span>}
                        </span>
                        <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED, whiteSpace: "nowrap" }}>{money(l.list)} → <b style={{ color: INK }}>{money(l.collected)}</b></span>
                        <span style={{ fontFamily: MONO, fontSize: 11, whiteSpace: "nowrap", color: l.below_avg === true ? RED : l.below_avg === false ? GREEN : MUTED }}>
                          {l.avg_collected === null ? "no baseline" : (gap < 0 ? "▼ " : "▲ ") + money(Math.abs(gap)) + " vs avg " + money(l.avg_collected)}
                        </span>
                      </div>
                    );
                  })}
                  {state.discounts.lines.length > 6 && (
                    <div onClick={function () { setAllDiscounts(!allDiscounts); }} style={{ cursor: "pointer", fontFamily: MONO, fontSize: 11, color: CYAN, padding: "6px 0 0" }}>
                      {allDiscounts ? "show fewer ▲" : "show all " + state.discounts.lines.length + " ▼"}
                    </div>
                  )}
                </div>
              )}
              {state.discounts.lines.length === 0 && <div style={{ marginTop: 8, color: GREEN, fontSize: 12 }}>Nothing rung under list yesterday.</div>}
            </div>
          )}

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

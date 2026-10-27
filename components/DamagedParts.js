// Damaged & defective parts — Eric, 2026-10-23: "the rule should attribute it
// to the person who repaired it."
//
// The rule is applied where the data can carry it and refused where it cannot,
// which is the whole design of this screen:
//
//   DEFECTIVE  repaired_by is filled on 17 of 17. Attributed to the technician,
//              exactly as Eric asked — but the PART leads, because thirteen of
//              the seventeen are the same aftermarket grade. A per-person list
//              on its own would read as a competence ranking of what is
//              currently a supplier problem.
//
//   DAMAGED    repaired_by is filled on 7 of 38, and 31 of 38 are accessories —
//              screen protectors spoiled out of a ten-pack, 24 of them at
//              Fishers. There is no repairer on a box of screen protectors, so
//              these are reported by store and never by person.
//
// There is no dollar value on any of these lines (see the route). The screen
// says so rather than showing a zero, and points at where the money does live.
//
// Lives inside Ticket Compliance, same as Zero / Negative Profit — Eric's
// standing preference for fewer tabs with more on each. Read-only.
"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/components/AuthProvider";

var REPAIRQ_TICKET = "https://cpr.repairq.io/ticket/";
var STORE_LABEL = { fishers: "Fishers", bloomington: "Bloomington", indianapolis: "Indianapolis" };
var STORE_COLOR = { fishers: "#E03E3E", bloomington: "#1A9E8F", indianapolis: "#D4A017" };

function monthLabel(m) {
  if (!m) return "No date";
  var p = String(m).split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, 1);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 10, padding: "14px 16px", flex: "1 1 180px", minWidth: 180 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{ color: color || "var(--text-primary)", fontSize: 24, fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}

// A ranked list with a proportional bar. The bar is scaled to the largest row,
// so "one line dominates" is visible before anyone reads a number.
// Scale to the MAX, never to rows[0]: the by-month lists are ordered by month,
// not by count, so the first row is whatever May happened to be. Scaling to it
// gave Oct (5 lines against May's 1) a bar 500% of its track, which escaped the
// card and widened the page. The track clips as well, so no future list can
// overflow even if the arithmetic is wrong again.
function Ranked({ rows, max, color, empty, note, onPick, picked }) {
  if (!rows || rows.length === 0) return <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "10px 0" }}>{empty}</div>;
  var top = max || rows.reduce(function(a, r) { return Math.max(a, r.lines || 0); }, 0) || 1;
  return (
    <div>
      {note && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 7, lineHeight: 1.45 }}>{note}</div>}
      {rows.map(function(r, bi) {
        var on = picked === r.name;
        return (
          <div key={r.name} className={onPick ? "ddp-hit" : undefined} onClick={onPick ? function() { onPick(on ? null : r.name); } : undefined}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 7, cursor: onPick ? "pointer" : "default",
                     background: on ? "#7B2FFF14" : "transparent" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: "var(--text-primary)", fontWeight: on ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.name}
                {r.on_roster === false && <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 7 }}>no longer on the roster</span>}
              </div>
              <div style={{ height: 4, borderRadius: 2, background: "var(--border-light)", marginTop: 4, overflow: "hidden" }}>
                <div className="ddp-bar" style={{ height: 4, borderRadius: 2, width: Math.min(100, Math.max(4, (r.lines / top) * 100)) + "%", background: color, animationDelay: Math.min(bi, 8) * 45 + "ms" }} />
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: color, fontVariantNumeric: "tabular-nums", minWidth: 26, textAlign: "right" }}>{r.lines}</div>
          </div>
        );
      })}
    </div>
  );
}

function Panel({ title, children, right }) {
  return (
    <div className="ddp-panel" style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 12, padding: "16px 18px", flex: "1 1 300px", minWidth: 290 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)" }}>{title}</span>
        {right && <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{right}</span>}
      </div>
      {children}
    </div>
  );
}

function Rows({ rows, showPerson }) {
  if (!rows.length) return <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "12px 0" }}>Nothing in this window.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            <th style={{ textAlign: "left", padding: "7px 10px" }}>Ticket</th>
            <th style={{ textAlign: "left", padding: "7px 10px" }}>Closed</th>
            <th style={{ textAlign: "left", padding: "7px 10px" }}>Store</th>
            {showPerson && <th style={{ textAlign: "left", padding: "7px 10px" }}>Repaired by</th>}
            <th style={{ textAlign: "left", padding: "7px 10px" }}>Line</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(function(r, i) {
            return (
              <tr key={r.ticket_number + "|" + i} className="ddp-row ddp-hit" style={{ borderTop: "1px solid var(--border-light)", animationDelay: Math.min(i, 16) * 18 + "ms" }}>
                <td style={{ padding: "7px 10px" }}>
                  <a href={REPAIRQ_TICKET + r.ticket_number} target="_blank" rel="noreferrer"
                    style={{ color: "var(--cyan)", textDecoration: "none", fontVariantNumeric: "tabular-nums" }}>{r.ticket_number}</a>
                </td>
                <td style={{ padding: "7px 10px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{String(r.date_closed || "").slice(0, 10) || "—"}</td>
                <td style={{ padding: "7px 10px", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: STORE_COLOR[r.store] || "var(--text-faint)", marginRight: 6 }} />
                  <span style={{ color: "var(--text-secondary)" }}>{STORE_LABEL[r.store] || r.store || "—"}</span>
                </td>
                {showPerson && (
                  <td style={{ padding: "7px 10px", color: r.repaired_by ? "var(--text-primary)" : "var(--text-faint)", whiteSpace: "nowrap" }}>
                    {r.repaired_by || "not recorded"}
                    {r.repaired_by && !r.on_roster && <span style={{ fontSize: 10, color: "var(--text-faint)" }}> · former</span>}
                  </td>
                )}
                <td style={{ padding: "7px 10px", color: "var(--text-secondary)" }}>
                  {r.item}
                  {r.waived && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--yellow)", marginLeft: 7 }}>CHARGE WAIVED</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DamagedParts({ storeFilter }) {
  var auth = useAuth();
  var [data, setData] = useState(null);
  var [error, setError] = useState(null);
  var [loading, setLoading] = useState(true);
  var [months, setMonths] = useState(6);
  var [pickPerson, setPickPerson] = useState(null);
  var [pickGrade, setPickGrade] = useState(null);

  useEffect(function() {
    var alive = true;
    setLoading(true); setError(null);
    var af = auth && auth.authFetch ? auth.authFetch : fetch;
    var url = "/api/dialpad/damaged-parts?months=" + months + "&store=" + encodeURIComponent(storeFilter || "all");
    af(url).then(function(r) { return r.json(); }).then(function(j) {
      if (!alive) return;
      if (!j || !j.success) { setError((j && j.error) || "request failed"); setData(null); }
      else setData(j);
      setLoading(false);
    }).catch(function(e) { if (alive) { setError(e.message); setLoading(false); } });
    return function() { alive = false; };
  }, [storeFilter, months, auth]);

  var defRows = useMemo(function() {
    if (!data) return [];
    return data.defective.rows.filter(function(r) {
      if (pickPerson && r.repaired_by !== pickPerson) return false;
      if (pickGrade && String(r.grade || "").toLowerCase() !== String(pickGrade).toLowerCase()) return false;
      return true;
    });
  }, [data, pickPerson, pickGrade]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Loading damaged &amp; defective parts…</div>;
  // Loud, never a silent zero — this is the June 2026 rule.
  if (error) return (
    <div style={{ padding: "18px 20px", borderRadius: 10, border: "1px solid var(--red)", background: "#E03E3E12", color: "var(--text-primary)", fontSize: 13 }}>
      <strong>Couldn&rsquo;t read damaged parts.</strong> {error}
      <div style={{ color: "var(--text-muted)", fontSize: 11.5, marginTop: 5 }}>This is not “no damage” — the screen could not read it.</div>
    </div>
  );
  if (!data) return null;

  var d = data.defective, g = data.damaged;
  var topGrade = d.by_grade && d.by_grade[0];
  var topStore = g.by_store && g.by_store[0];

  return (
    <div>
      {/* Restrained on purpose: the bars grow because "one line dominates" is
          the finding, so letting it draw itself is the point rather than
          decoration. Nothing here delays a number being readable. The global
          prefers-reduced-motion rule in globals.css switches all of it off. */}
      <style>{`
        @keyframes ddpUp { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        @keyframes ddpGrow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
        @keyframes ddpRow { from { opacity: 0 } to { opacity: 1 } }
        .ddp-panel { animation: ddpUp .42s cubic-bezier(.22,1,.36,1) both }
        .ddp-bar { transform-origin: left center; animation: ddpGrow .55s cubic-bezier(.22,1,.36,1) both }
        .ddp-row { animation: ddpRow .3s ease both }
        .ddp-hit { transition: background .15s ease }
        .ddp-hit:hover { background: var(--bg-hover) }
      `}</style>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        {[3, 6, 12].map(function(m) {
          return (
            <button key={m} onClick={function() { setMonths(m); setPickPerson(null); setPickGrade(null); }}
              style={{ padding: "6px 13px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap",
                       border: "1px solid " + (months === m ? "var(--purple)" : "var(--border)"),
                       background: months === m ? "#7B2FFF1A" : "transparent",
                       color: months === m ? "var(--purple)" : "var(--text-secondary)" }}>{m} months</button>
          );
        })}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-faint)" }}>
          {data.meta.lines_scanned.toLocaleString()} line items read · {data.meta.lines_matched} damaged or defective
          {data.meta.balances ? "" : " · ⚠ counts do not reconcile"}
        </span>
      </div>

      {/* The money question, answered before anyone asks it. */}
      {data.priced_lines === 0 && (
        <div style={{ padding: "11px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-card-inner)", marginBottom: 16, fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--text-primary)" }}>These are counts, not dollars.</strong>{" "}
          RepairQ sends every one of these lines at $0 with no cost field, so there is no value to total.
          The money is on the P&amp;L, in the damage and shrinkage lines fed by the inventory usage report.
        </div>
      )}

      {/* ═══ DEFECTIVE ═══ */}
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 3 }}>Defective parts</div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        A part that failed in a repair. Every one carries the technician who fitted it
        {d.unattributed > 0 ? <span> — except {d.unattributed}, which carry no repairer and are listed as “not recorded” rather than attributed to the ticket owner</span> : <span> ({d.lines} of {d.lines}), so Eric’s rule applies cleanly</span>}.
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat label="Defective lines" value={d.lines} sub={months + " months, " + (d.by_month.length) + " of them with at least one"} color="var(--orange)" />
        {topGrade && (
          <Stat label="One part grade leads" value={topGrade.lines + " of " + d.lines}
            sub={topGrade.name + " — this looks like a supplier question before it is a technician question"} color="var(--red)" />
        )}
        <Stat label="People involved" value={d.by_person.length}
          sub={d.by_person.length > 1 ? "Spread across the bench, which is what a part problem looks like" : "A single person — worth a closer look"} />
        {/* The supplier taking the part back changes what a defect costs: the
            bench time and the customer coming back, not the part itself. */}
        <Stat label="Going back to the supplier" value={(d.rma_total || 0) + " of " + d.lines}
          sub={Object.keys(d.rma || {}).length
            ? Object.keys(d.rma).map(function(k) { return d.rma[k] + " " + k.toLowerCase(); }).join(" · ") + " — the part is recovered, the bench time is not"
            : "No RMA recorded on any of them"}
          color={(d.rma_total || 0) === d.lines ? "var(--green)" : "var(--text-primary)"} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <Panel title="By part grade" right={pickGrade ? "filtered" : "click to filter"}>
          <Ranked rows={d.by_grade} color="var(--red)" empty="No grade recorded on any line."
            note="The text RepairQ puts in brackets after the part name."
            onPick={setPickGrade} picked={pickGrade} />
        </Panel>
        <Panel title="By technician" right={pickPerson ? "filtered" : "click to filter"}>
          <Ranked rows={d.by_person} color="var(--orange)" empty="No repairer recorded on any defective line."
            note="Attributed to repaired_by, never to whoever opened the ticket."
            onPick={setPickPerson} picked={pickPerson} />
        </Panel>
        <Panel title="By month">
          <Ranked rows={d.by_month.map(function(m) { return { name: monthLabel(m.month), lines: m.lines }; })}
            color="var(--purple)" empty="Nothing in this window." />
        </Panel>
      </div>

      {(pickPerson || pickGrade) && (
        <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginBottom: 8 }}>
          Showing {defRows.length} of {d.lines}
          {pickPerson && <span> · {pickPerson}</span>}
          {pickGrade && <span> · {pickGrade}</span>}
          <button onClick={function() { setPickPerson(null); setPickGrade(null); }}
            style={{ marginLeft: 10, background: "transparent", border: "none", color: "var(--purple)", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>clear</button>
        </div>
      )}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 12, padding: "6px 4px", marginBottom: 26 }}>
        <Rows rows={defRows} showPerson={true} />
      </div>

      {/* ═══ DAMAGED ═══ */}
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", marginBottom: 3 }}>Damaged stock</div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Written off without being fitted. Only {g.with_repairer} of {g.lines} carry a repairer at all, and{" "}
        {(g.by_category.filter(function(c) { return c.name === "accessory"; })[0] || { lines: 0 }).lines} of {g.lines} are accessories —
        a screen protector spoiled out of a ten-pack has no technician, so this half is reported by store.
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Stat label="Damaged lines" value={g.lines} sub={months + " months"} color="var(--yellow)" />
        {topStore && <Stat label="Most of it is one store" value={topStore.lines + " of " + g.lines} sub={STORE_LABEL[topStore.name] || topStore.name} />}
        <Stat label="With a repairer on the line" value={g.with_repairer + " of " + g.lines}
          sub="Too few to attribute this half to anybody" color={g.with_repairer > g.lines / 2 ? "var(--green)" : "var(--text-muted)"} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <Panel title="By store">
          <Ranked rows={g.by_store.map(function(s) { return { name: STORE_LABEL[s.name] || s.name, lines: s.lines }; })}
            color="var(--yellow)" empty="Nothing in this window." />
        </Panel>
        <Panel title="By category">
          <Ranked rows={g.by_category} color="var(--cyan)" empty="Nothing in this window." />
        </Panel>
        <Panel title="What gets damaged" right="top 8">
          <Ranked rows={g.by_item.slice(0, 8)} color="var(--text-secondary)" empty="Nothing in this window." />
        </Panel>
      </div>

      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 12, padding: "6px 4px" }}>
        <Rows rows={g.rows} showPerson={true} />
      </div>
    </div>
  );
}

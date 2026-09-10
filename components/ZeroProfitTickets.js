// Zero / negative profit tickets — Matt's ask from the 2026-09-10 meeting:
// "a section that we can put like tickets that are zero or negative profit...
// sort by like a month or by employee."
//
// Lives inside Ticket Compliance rather than its own tab (Eric: fewer tabs, more
// on each tab). Read-only.
"use client";
import { useState, useEffect, useMemo } from "react";

// Same base the Chrome extension navigates to (extension/popup.js).
var REPAIRQ_TICKET = "https://cpr.repairq.io/ticket/";

var money = function(n) {
  var v = parseFloat(n) || 0;
  var neg = v < 0;
  return (neg ? "-" : "") + "$" + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
var monthLabel = function(m) {
  if (!m) return "No close date";
  var p = String(m).split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, 1);
  return d.toLocaleString(undefined, { month: "short", year: "numeric" });
};

// Each bucket means something different and gets a different colour, because
// only two of the three are anyone's fault.
var BUCKETS = {
  loss: { label: "Loss", color: "var(--red)", desc: "Money out the door" },
  zero: { label: "Zero", color: "var(--yellow)", desc: "Parts used, nothing earned" },
  suspect: { label: "Not captured", color: "var(--text-muted)", desc: "Stored $0 but the line items disagree — a scraping gap, not a loss" },
};

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 10, padding: "14px 16px", flex: "1 1 170px", minWidth: 170 }}>
      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
      <div style={{ color: color || "var(--text-primary)", fontSize: 24, fontWeight: 800, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Chip({ active, onClick, children, dot }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontSize: 11, fontWeight: 600,
      border: "1px solid " + (active ? "var(--purple)" : "var(--border)"),
      background: active ? "#7B2FFF18" : "transparent",
      color: active ? "var(--purple)" : "var(--text-secondary)",
      display: "inline-flex", alignItems: "center", gap: 6, transition: "all .15s ease",
    }}>
      {dot && <span style={{ width: 7, height: 7, borderRadius: 2, background: dot }} />}
      {children}
    </button>
  );
}

export default function ZeroProfitTickets({ storeFilter }) {
  var [data, setData] = useState(null);
  var [error, setError] = useState(null);
  var [groupBy, setGroupBy] = useState("employee");
  var [bucketFilter, setBucketFilter] = useState("actionable"); // actionable = loss + zero
  var [typeFilter, setTypeFilter] = useState("all");
  var [pick, setPick] = useState(null); // { kind, key } from clicking a group row
  var [search, setSearch] = useState("");
  var [limit, setLimit] = useState(40);

  useEffect(function() {
    var live = true;
    setData(null); setError(null);
    var sp = storeFilter && storeFilter !== "all" ? "?store=" + encodeURIComponent(storeFilter) : "";
    fetch("/api/dialpad/zero-profit" + sp)
      .then(function(r) { return r.json(); })
      .then(function(j) {
        if (!live) return;
        if (!j || !j.success) { setError((j && j.error) || "request failed"); return; }
        setData(j);
      })
      .catch(function(e) { if (live) setError(e.message); });
    return function() { live = false; };
  }, [storeFilter]);

  // Clearing the drill-down when the grouping changes — a month key means
  // nothing once you are grouped by employee.
  useEffect(function() { setPick(null); setLimit(40); }, [groupBy, bucketFilter, typeFilter, storeFilter]);

  var groups = useMemo(function() {
    if (!data) return [];
    return groupBy === "employee" ? data.by_employee : groupBy === "month" ? data.by_month : data.by_store;
  }, [data, groupBy]);

  var rows = useMemo(function() {
    if (!data) return [];
    var out = data.rows.slice();
    if (bucketFilter === "actionable") out = out.filter(function(r) { return r.bucket !== "suspect"; });
    else if (bucketFilter !== "all") out = out.filter(function(r) { return r.bucket === bucketFilter; });
    if (typeFilter !== "all") out = out.filter(function(r) { return (r.ticket_type || "") === typeFilter; });
    if (pick) {
      out = out.filter(function(r) {
        var v = pick.kind === "employee" ? r.employee : pick.kind === "month" ? r.month : r.store;
        return (v || "(unattributed)") === pick.key;
      });
    }
    var q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(function(r) {
        return String(r.ticket_number || "").toLowerCase().indexOf(q) >= 0
          || String(r.employee || "").toLowerCase().indexOf(q) >= 0
          || String(r.device || "").toLowerCase().indexOf(q) >= 0;
      });
    }
    return out;
  }, [data, bucketFilter, typeFilter, pick, search]);

  if (error) {
    return <div style={{ background: "var(--bg-card)", border: "1px solid var(--red)", borderRadius: 12, padding: 24, color: "var(--red)", fontSize: 13 }}>
      Couldn&apos;t load zero-profit tickets — {error}
    </div>;
  }
  if (!data) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading zero-profit tickets…</div>;
  }

  var t = data.totals;
  var types = ["all"].concat(Object.keys(data.rows.reduce(function(m, r) { if (r.ticket_type) m[r.ticket_type] = 1; return m; }, {})).sort());
  var th = { padding: "8px 10px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", textAlign: "left", borderBottom: "1px solid var(--border)" };
  var td = { padding: "8px 10px", fontSize: 12, borderBottom: "1px solid var(--border-light)", color: "var(--text-body)" };

  return (
    <div>
      {/* ── headline ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <Stat label="Real losses" value={t.loss_count} sub={money(t.lost_dollars) + " total"} color="var(--red)" />
        <Stat label="Zero profit" value={t.zero_count} sub="parts used, nothing earned" color="var(--yellow)" />
        <Stat label="Not captured" value={t.suspect_count} sub={"hiding " + money(t.suspect_hidden_profit) + " of profit"} color="var(--text-secondary)" />
        {t.unclosed_count > 0 && (
          <Stat label="Not closed" value={t.unclosed_count} sub="never booked — excluded from revenue" color="var(--orange)" />
        )}
      </div>

      {/* The distinction that keeps this list trustworthy. */}
      <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 8, padding: "10px 13px", marginBottom: 16, color: "var(--text-muted)", fontSize: 11.5, lineHeight: 1.55 }}>
        <strong style={{ color: "var(--text-body)" }}>Not every $0 ticket is a lost ticket.</strong>{" "}
        {t.suspect_count} of these store $0 but their line items say otherwise — {money(t.suspect_hidden_profit)} of
        real profit was never captured by the grader, and {money(Math.abs(t.suspect_hidden_loss))} of loss was rounded up to zero.
        Those sit in <em>Not captured</em> and are excluded from the totals below, so nobody gets chased for a scraping gap.
      </div>

      {/* ── controls ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>Group by</span>
          {["employee", "month", "store"].map(function(g) {
            return <Chip key={g} active={groupBy === g} onClick={function() { setGroupBy(g); }}>{g.charAt(0).toUpperCase() + g.slice(1)}</Chip>;
          })}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>Show</span>
          <Chip active={bucketFilter === "actionable"} onClick={function() { setBucketFilter("actionable"); }}>Losses + zero</Chip>
          <Chip active={bucketFilter === "loss"} onClick={function() { setBucketFilter("loss"); }} dot="var(--red)">Losses</Chip>
          <Chip active={bucketFilter === "zero"} onClick={function() { setBucketFilter("zero"); }} dot="var(--yellow)">Zero</Chip>
          <Chip active={bucketFilter === "suspect"} onClick={function() { setBucketFilter("suspect"); }} dot="var(--text-muted)">Not captured</Chip>
        </div>
        {types.length > 2 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>Type</span>
            {types.map(function(ty) {
              return <Chip key={ty} active={typeFilter === ty} onClick={function() { setTypeFilter(ty); }}>{ty === "all" ? "All" : ty}</Chip>;
            })}
          </div>
        )}
        <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Ticket #, employee, device…"
          style={{ marginLeft: "auto", padding: "7px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12, minWidth: 210 }} />
      </div>

      {/* ── group summary ────────────────────────────────────────────────── */}
      <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 10, overflow: "hidden", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={th}>{groupBy === "employee" ? "Employee" : groupBy === "month" ? "Month" : "Store"}</th>
            <th style={{ ...th, textAlign: "right" }}>Tickets</th>
            <th style={{ ...th, textAlign: "right" }}>Losses</th>
            <th style={{ ...th, textAlign: "right" }}>Zero</th>
            <th style={{ ...th, textAlign: "right" }}>Lost</th>
          </tr></thead>
          <tbody>
            {groups.map(function(g) {
              var active = pick && pick.kind === groupBy && pick.key === g.key;
              return (
                <tr key={g.key}
                  onClick={function() { setPick(active ? null : { kind: groupBy, key: g.key }); }}
                  style={{ cursor: "pointer", background: active ? "#7B2FFF14" : "transparent" }}>
                  <td style={{ ...td, color: "var(--text-primary)", fontWeight: active ? 700 : 600 }}>
                    {groupBy === "month" ? monthLabel(g.key) : g.key}
                    {active && <span style={{ color: "var(--purple)", fontSize: 10, marginLeft: 8 }}>filtering ↓</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{g.tickets}</td>
                  <td style={{ ...td, textAlign: "right", color: "var(--red)", fontVariantNumeric: "tabular-nums" }}>{g.losses}</td>
                  <td style={{ ...td, textAlign: "right", color: "var(--yellow)", fontVariantNumeric: "tabular-nums" }}>{g.zeros}</td>
                  <td style={{ ...td, textAlign: "right", color: "var(--red)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(g.lost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── ticket list ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 600 }}>
          {rows.length} ticket{rows.length === 1 ? "" : "s"}
          {pick && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {pick.kind === "month" ? monthLabel(pick.key) : pick.key}</span>}
        </div>
        {pick && <button onClick={function() { setPick(null); }} style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", borderRadius: 6, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}>Clear filter</button>}
      </div>

      <div style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 10, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead><tr>
            <th style={th}>Ticket</th>
            <th style={th}>Closed</th>
            <th style={th}>Store</th>
            <th style={th}>Employee</th>
            <th style={th}>Type</th>
            <th style={th}>Device</th>
            <th style={{ ...th, textAlign: "right" }}>Sales</th>
            <th style={{ ...th, textAlign: "right" }}>Cost</th>
            <th style={{ ...th, textAlign: "right" }}>Profit</th>
          </tr></thead>
          <tbody>
            {rows.slice(0, limit).map(function(r) {
              var b = BUCKETS[r.bucket];
              return (
                <tr key={r.ticket_number + "-" + r.bucket}>
                  <td style={{ ...td, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: b.color, marginRight: 7 }} />
                    {/* Straight through to the ticket in RepairQ — the next thing
                        anyone wants after seeing a bad number is the ticket itself. */}
                    <a href={REPAIRQ_TICKET + r.ticket_number} target="_blank" rel="noopener noreferrer"
                      title={b.label + " — " + b.desc}
                      style={{ color: "var(--text-primary)", textDecoration: "underline", textDecorationColor: "var(--border-heavy)", textUnderlineOffset: "3px" }}>
                      {r.ticket_number}
                    </a>
                  </td>
                  <td style={{ ...td, color: r.closed ? "var(--text-muted)" : "var(--orange)", fontSize: 11 }}>
                    {r.closed ? String(r.date_closed).slice(0, 10) : "not closed"}
                  </td>
                  <td style={{ ...td, fontSize: 11, textTransform: "capitalize" }}>{r.store}</td>
                  <td style={{ ...td, fontSize: 11.5 }}>
                    {r.employee || <span style={{ color: "var(--text-muted)" }}>unattributed</span>}
                    {r.employee_source === "added" && <span title="No repair tech recorded — this is who created the ticket" style={{ color: "var(--text-muted)", fontSize: 9, marginLeft: 5 }}>intake</span>}
                  </td>
                  <td style={{ ...td, fontSize: 11, color: "var(--text-muted)" }}>{r.ticket_type || "—"}</td>
                  <td style={{ ...td, fontSize: 11, color: "var(--text-muted)" }}>{r.device_category || r.device || "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.gross_sales)}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(r.total_cost)}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: r.bucket === "loss" ? "var(--red)" : r.bucket === "zero" ? "var(--yellow)" : "var(--text-muted)" }}>
                    {money(r.gross_profit)}
                    {r.bucket === "suspect" && <div style={{ fontSize: 9, fontWeight: 400, color: "var(--text-muted)" }}>lines say {money(r.implied_profit)}</div>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, textAlign: "center", color: "var(--text-muted)", padding: 30 }}>Nothing matches these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length > limit && (
        <div style={{ textAlign: "center", marginTop: 12 }}>
          <button onClick={function() { setLimit(limit + 60); }}
            style={{ background: "var(--bg-card-inner)", border: "1px solid var(--border)", color: "var(--text-secondary)", borderRadius: 8, padding: "8px 18px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Show {Math.min(60, rows.length - limit)} more ({rows.length - limit} left)
          </button>
        </div>
      )}
    </div>
  );
}

"use client";
import { useState, useEffect, useMemo } from "react";
import { STORES } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────
// LeaderboardTab — Gross Profit Leaderboard (admin-only)
// Displays per-employee GP, hours, and GP/hour rankings.
// Period selector mirrors Scorecard; default is current month-to-date.
// Sortable columns; default sort = GP/hour descending (the headline metric).
// ─────────────────────────────────────────────────────────────────

var card = { background: "#0F1117", borderRadius: 12, padding: 20, border: "1px solid #1E2028" };
var cardInner = { background: "#12141A", borderRadius: 8, padding: 14 };

// Build last 12 months as period options (current month first)
function buildPeriodOptions() {
  var opts = [];
  var now = new Date();
  for (var i = 0; i < 12; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    opts.push({
      value: y + "-" + m,
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }) + (i === 0 ? " (current)" : ""),
    });
  }
  return opts;
}

var SORT_FIELDS = [
  { key: "gp_per_hour", label: "GP / Hour", default: true },
  { key: "total_gp", label: "Total GP" },
  { key: "avg_gp_per_ticket", label: "Avg GP / Ticket" },
  { key: "ticket_count", label: "Tickets" },
  { key: "hours", label: "Hours" },
  { key: "gpm_pct", label: "GPM %" },
];

export default function LeaderboardTab() {
  var periodOpts = useMemo(buildPeriodOptions, []);
  var [period, setPeriod] = useState(periodOpts[0].value);
  var [storeFilter, setStoreFilter] = useState("all");
  var [sortField, setSortField] = useState("gp_per_hour");
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [data, setData] = useState(null);

  useEffect(function() {
    setLoading(true); setError(null);
    fetch("/api/dialpad/tickets?action=gp_leaderboard&period=" + encodeURIComponent(period))
      .then(function(r) { return r.json(); })
      .then(function(json) {
        if (!json.success) { setError(json.error || "Unknown error"); setLoading(false); return; }
        setData(json);
        setLoading(false);
      })
      .catch(function(e) { setError(String(e && e.message || e)); setLoading(false); });
  }, [period]);

  // Apply store filter + sort client-side (no extra API call needed)
  var displayRows = useMemo(function() {
    if (!data || !data.rows) return [];
    var rows = data.rows.slice();
    if (storeFilter !== "all") rows = rows.filter(function(r) { return r.store === storeFilter; });
    rows.sort(function(a, b) { return (b[sortField] || 0) - (a[sortField] || 0); });
    rows.forEach(function(r, i) { r.display_rank = i + 1; });
    return rows;
  }, [data, storeFilter, sortField]);

  function fmtCurrency(n) {
    if (n == null) return "—";
    return "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtNum(n, decimals) {
    if (n == null) return "—";
    return (Math.round(n * Math.pow(10, decimals || 0)) / Math.pow(10, decimals || 0)).toLocaleString();
  }

  var isCurrentPeriod = period === periodOpts[0].value;

  return (
    <div style={{ padding: 24, color: "#F0F1F3" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{"\uD83D\uDCB0"} Gross Profit Leaderboard</div>
          <div style={{ color: "#8B8F98", fontSize: 12, marginTop: 4, maxWidth: 700 }}>
            Per-employee GP earned and labor productivity. Repair tickets credit the repair tech;
            sale tickets credit whoever rang them up. Hours come from WhenIWork shifts. Default sort is GP per hour worked.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={storeFilter} onChange={function(e) { setStoreFilter(e.target.value); }}
            style={{ padding: "6px 12px", borderRadius: 6, background: "#12141A", color: "#F0F1F3", border: "1px solid #2A2D36", fontSize: 12 }}>
            <option value="all">All Stores</option>
            {Object.keys(STORES).map(function(k) { return <option key={k} value={k}>{STORES[k].name}</option>; })}
          </select>
          <select value={sortField} onChange={function(e) { setSortField(e.target.value); }}
            style={{ padding: "6px 12px", borderRadius: 6, background: "#12141A", color: "#F0F1F3", border: "1px solid #2A2D36", fontSize: 12 }}>
            {SORT_FIELDS.map(function(s) { return <option key={s.key} value={s.key}>Sort: {s.label}</option>; })}
          </select>
          <select value={period} onChange={function(e) { setPeriod(e.target.value); }}
            style={{ padding: "6px 12px", borderRadius: 6, background: isCurrentPeriod ? "#12141A" : "#FBBF2415", color: "#F0F1F3", border: "1px solid " + (isCurrentPeriod ? "#2A2D36" : "#FBBF24"), fontSize: 12 }}>
            {periodOpts.map(function(p) { return <option key={p.value} value={p.value}>{p.label}</option>; })}
          </select>
        </div>
      </div>

      {/* Period banner if historical */}
      {!isCurrentPeriod && (
        <div style={Object.assign({}, cardInner, { borderLeft: "3px solid #FBBF24", marginBottom: 16, fontSize: 12, color: "#FBBF24" })}>
          {"\uD83D\uDCC5"} Viewing historical period. Hours and tickets are scoped to this calendar month only.
        </div>
      )}

      {error && (
        <div style={Object.assign({}, cardInner, { borderLeft: "3px solid #F87171", marginBottom: 16, color: "#F87171", fontSize: 12 })}>
          {"\u2717"} {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8B8F98", textAlign: "center", padding: 40 }}>Loading leaderboard…</div>
      ) : !data || displayRows.length === 0 ? (
        <div style={Object.assign({}, card, { textAlign: "center", padding: 60 })}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{"\uD83D\uDCCA"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No data for this period yet</div>
          <div style={{ color: "#8B8F98", fontSize: 12 }}>
            {storeFilter !== "all"
              ? "No tickets or hours for this store in this period. Try All Stores."
              : "No graded tickets in this period yet. Check the Ticket Compliance tab to see what's been graded."}
          </div>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            <SummaryCard label="Total GP" value={fmtCurrency(data.summary.total_gp)} color="#4ADE80" />
            <SummaryCard label="Total Hours" value={fmtNum(data.summary.total_hours, 1) + "h"} color="#00D4FF" />
            <SummaryCard label="Tickets" value={fmtNum(data.summary.total_tickets)} color="#7B2FFF" />
            <SummaryCard label="Avg GP / Hour" value={fmtCurrency(data.summary.avg_gp_per_hour)} color="#FF2D95" />
            <SummaryCard label="Avg GP / Ticket" value={fmtCurrency(data.summary.avg_gp_per_ticket)} color="#FBBF24" />
          </div>

          {/* Leaderboard table */}
          <div style={Object.assign({}, card, { padding: 0, overflow: "hidden" })}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#12141A" }}>
                  <Th>#</Th>
                  <Th>Employee</Th>
                  <Th>Store</Th>
                  <Th align="right">Hours</Th>
                  <Th align="right">Tickets</Th>
                  <Th align="right">Total GP</Th>
                  <Th align="right">Avg GP/Tx</Th>
                  <Th align="right" highlight={sortField === "gp_per_hour"}>GP/Hour</Th>
                  <Th align="right">GPM %</Th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map(function(r, idx) {
                  var store = STORES[r.store];
                  var top3 = idx < 3;
                  var medal = idx === 0 ? "\uD83E\uDD47" : idx === 1 ? "\uD83E\uDD48" : idx === 2 ? "\uD83E\uDD49" : null;
                  return (
                    <tr key={r.employee} style={{ borderTop: "1px solid #1E2028", background: top3 ? "#7B2FFF08" : "transparent" }}>
                      <Td>
                        {medal ? <span style={{ fontSize: 16 }}>{medal}</span> : <span style={{ color: "#6B6F78", fontSize: 11 }}>{r.display_rank}</span>}
                      </Td>
                      <Td>
                        <div style={{ fontWeight: 700, color: top3 ? "#F0F1F3" : "#F0F1F3" }}>{r.employee}</div>
                        {r.role && <div style={{ fontSize: 9, color: "#6B6F78", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{r.role}</div>}
                      </Td>
                      <Td>
                        {store ? <span style={{ color: store.color, fontSize: 11, fontWeight: 600 }}>{store.name.replace("CPR ", "")}</span> : <span style={{ color: "#6B6F78", fontSize: 11 }}>—</span>}
                      </Td>
                      <Td align="right" muted>{fmtNum(r.hours, 1)}h</Td>
                      <Td align="right" muted>
                        {r.ticket_count}
                        {r.repair_tickets > 0 && r.sale_tickets > 0 && (
                          <div style={{ fontSize: 9, color: "#6B6F78", marginTop: 2 }}>
                            {r.repair_tickets}r / {r.sale_tickets}s
                          </div>
                        )}
                      </Td>
                      <Td align="right" bold>{fmtCurrency(r.total_gp)}</Td>
                      <Td align="right" muted>{fmtCurrency(r.avg_gp_per_ticket)}</Td>
                      <Td align="right" highlight={sortField === "gp_per_hour"}>
                        <span style={{ color: r.gp_per_hour >= data.summary.avg_gp_per_hour ? "#4ADE80" : "#FB923C", fontWeight: 800 }}>
                          {fmtCurrency(r.gp_per_hour)}
                        </span>
                      </Td>
                      <Td align="right" muted>{fmtNum(r.gpm_pct, 1)}%</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footnote */}
          <div style={{ marginTop: 16, fontSize: 10, color: "#6B6F78", textAlign: "center", lineHeight: 1.6 }}>
            <div>{"\u2014"} Repair tickets credit the repair tech; sale tickets credit who rang them up. Multi-role tickets credit the repair tech.</div>
            <div>{"\u2014"} Hours come from WhenIWork stored shifts. Employees with no shifts in this period don't show GP/hour.</div>
            <div>{"\u2014"} Green GP/Hour = above average; orange = below average.</div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard(props) {
  return (
    <div style={Object.assign({}, cardInner, { borderTop: "3px solid " + (props.color || "#7B2FFF") })}>
      <div style={{ fontSize: 9, color: "#8B8F98", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{props.label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: props.color || "#F0F1F3", marginTop: 6 }}>{props.value}</div>
    </div>
  );
}

function Th(props) {
  return (
    <th style={{
      padding: "12px 14px",
      textAlign: props.align || "left",
      fontSize: 10,
      color: props.highlight ? "#FF2D95" : "#8B8F98",
      fontWeight: 700,
      textTransform: "uppercase",
      letterSpacing: "0.05em",
      borderBottom: "1px solid #1E2028",
    }}>
      {props.children}
    </th>
  );
}

function Td(props) {
  return (
    <td style={{
      padding: "10px 14px",
      textAlign: props.align || "left",
      color: props.muted ? "#8B8F98" : "#F0F1F3",
      fontWeight: props.bold ? 700 : 400,
      background: props.highlight ? "#FF2D9508" : "transparent",
    }}>
      {props.children}
    </td>
  );
}

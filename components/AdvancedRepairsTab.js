'use client';

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

// Hardcoded brand palette — matches ScorecardTab and other DialpadDashboard tabs
var CYAN = "#00D4FF";
var PURPLE = "#7B2FFF";
var PINK = "#FF2D95";
var GOLD = "#FBBF24";
var GREEN = "#4ADE80";
var RED = "#F87171";

var STATUSES = [
  { value: "open", label: "Open", color: "#6B6F78" },
  { value: "in_transit", label: "In Transit", color: CYAN },
  { value: "repaired", label: "Repaired", color: PURPLE },
  { value: "closed", label: "Closed (Paid)", color: GREEN },
  { value: "nonrepairable", label: "Nonrepairable", color: RED },
];
var STORES = ["fishers", "bloomington", "indianapolis"];

function fmt(n) {
  var v = parseFloat(n || 0);
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(s) {
  if (!s) return "";
  try {
    return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Indiana/Indianapolis" });
  } catch (e) { return String(s).slice(0, 10); }
}

function storeLabel(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusBadge(status) {
  var s = STATUSES.find(function(x) { return x.value === status; }) || { value: status, label: status, color: "#6B6F78" };
  return (
    <span style={{ background: s.color + "22", color: s.color, padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {s.label}
    </span>
  );
}

export default function AdvancedRepairsTab() {
  var auth = useAuth();
  var actor = {
    name: auth?.userInfo?.name || "",
    email: auth?.userInfo?.email || "",
    role: auth?.userInfo?.role || "admin", // this tab is admin-gated by the parent
  };
  var [repairs, setRepairs] = useState([]);
  var [commissions, setCommissions] = useState(null);
  var [loading, setLoading] = useState(true);
  var [msg, setMsg] = useState(null);
  var [editing, setEditing] = useState(null);
  var [statusFilter, setStatusFilter] = useState("");
  var [storeFilter, setStoreFilter] = useState("");
  var [search, setSearch] = useState("");

  // Period selector — last 12 months
  var now = new Date();
  var periodOptions = [];
  for (var mi = 0; mi < 12; mi++) {
    var d = new Date(now.getFullYear(), now.getMonth() - mi, 1);
    var pVal = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    var pLabel = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    periodOptions.push({ value: pVal, label: pLabel });
  }
  var currentPeriod = periodOptions[0].value;
  var [period, setPeriod] = useState(currentPeriod);

  var load = async function() {
    setLoading(true);
    try {
      var url = "/api/advanced-repairs?action=list&period=" + period;
      if (statusFilter) url += "&status=" + statusFilter;
      if (storeFilter) url += "&store=" + storeFilter;
      var res = await fetch(url);
      var json = await res.json();
      if (json.success) setRepairs(json.repairs || []);
      else setMsg({ type: "error", text: json.error || "Failed to load" });

      var r2 = await fetch("/api/advanced-repairs?action=commissions&period=" + period);
      var d2 = await r2.json();
      if (d2.success) setCommissions(d2);
    } catch (e) {
      setMsg({ type: "error", text: e.message });
    }
    setLoading(false);
  };

  useEffect(function() { load(); }, [period, statusFilter, storeFilter]);

  var reconcileOne = async function(id) {
    setMsg(null);
    try {
      var res = await fetch("/api/advanced-repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile", id: id }),
      });
      var d = await res.json();
      if (d.success) {
        if (d.reconciled) {
          var successMsg;
          if (d.note) {
            // RepairQ had the ticket but couldn't improve our data — show the explanation
            successMsg = { type: "info", text: d.note };
          } else {
            successMsg = { type: "success", text: "Reconciled from RepairQ. Profit: " + fmt(d.source.profit) };
          }
          setMsg(successMsg);
        } else {
          setMsg({ type: "info", text: d.message || "No match found yet." });
        }
        load();
      } else {
        setMsg({ type: "error", text: d.error });
      }
    } catch (e) { setMsg({ type: "error", text: e.message }); }
  };

  var [syncing, setSyncing] = useState(false);
  var syncAll = async function() {
    setMsg(null);
    setSyncing(true);
    try {
      var res = await fetch("/api/advanced-repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile_all" }),
      });
      var d = await res.json();
      if (d.success) {
        var s = d.summary || {};
        var parts = [];
        if (s.auto_closed) parts.push(s.auto_closed + " closed");
        if (s.reconciled) parts.push(s.reconciled + " updated from RepairQ");
        if (s.no_match) parts.push(s.no_match + " awaiting RepairQ match");
        var txt = "Synced " + (s.scanned || 0) + " open repair" + ((s.scanned === 1) ? "" : "s") + (parts.length ? ": " + parts.join(", ") : " — nothing to update") + ".";
        setMsg({ type: (s.auto_closed ? "success" : "info"), text: txt });
        load();
      } else {
        setMsg({ type: "error", text: d.error || "Sync failed" });
      }
    } catch (e) { setMsg({ type: "error", text: e.message }); }
    setSyncing(false);
  };

  var exportCSV = function() {
    var headers = ["Ticket #", "Date Created", "Customer", "Device/Repair", "Origin", "Current Loc", "Repaired By", "Status", "Price", "Profit", "Bench Fee", "Date Closed", "Notes"];
    var rows = filtered.map(function(r) {
      return [
        r.ticket_number, r.ticket_created_date || "", r.customer_name, r.device_repair,
        storeLabel(r.origin_store), storeLabel(r.current_location), r.repaired_by, r.status,
        r.price, r.profit, r.bench_fee ? "Yes" : "No", r.date_closed || "", (r.notes || "").replace(/\n/g, " "),
      ];
    });
    var csv = [headers].concat(rows).map(function(row) {
      return row.map(function(c) { return '"' + String(c == null ? "" : c).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "advanced-repairs-" + period + ".csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  var filtered = repairs.filter(function(r) {
    if (!search) return true;
    var s = search.toLowerCase();
    return (r.ticket_number || "").toLowerCase().includes(s) ||
           (r.customer_name || "").toLowerCase().includes(s) ||
           (r.device_repair || "").toLowerCase().includes(s) ||
           (r.repaired_by || "").toLowerCase().includes(s) ||
           (r.notes || "").toLowerCase().includes(s);
  });
  var openRepairs = filtered.filter(function(r) { return r.status === "open" || r.status === "in_transit" || r.status === "repaired"; });
  var doneRepairs = filtered.filter(function(r) { return r.status === "closed" || r.status === "nonrepairable"; });

  if (loading && !repairs.length) {
    return <div style={{ padding: 40, textAlign: "center", color: "#6B6F78" }}>Loading advanced repairs...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "#F0F1F3", fontWeight: 700 }}>{"\uD83D\uDD27"} Advanced Repairs</h2>
          <div style={{ color: "#6B6F78", fontSize: 12, marginTop: 4 }}>
            High-skill soldering & board-level repairs. Commission paid monthly on closed tickets only.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={function() { setEditing("new"); }}
            style={{ background: PINK, color: "#fff", border: "none", padding: "9px 18px", borderRadius: 6, fontWeight: 700, cursor: "pointer", fontSize: 12 }}>
            + Log Advanced Repair
          </button>
          <button onClick={syncAll} disabled={syncing}
            style={{ background: syncing ? "#1A1D23" : "#12141A", color: syncing ? "#6B6F78" : "#00D4FF", border: "1px solid #00D4FF44", padding: "9px 16px", borderRadius: 6, fontWeight: 600, cursor: syncing ? "default" : "pointer", fontSize: 12 }}>
            {syncing ? "Syncing\u2026" : "\uD83D\uDD04 Sync All from RepairQ"}
          </button>
          <button onClick={exportCSV}
            style={{ background: "#12141A", color: "#F0F1F3", border: "1px solid #1E2028", padding: "9px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer", fontSize: 12 }}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={{ color: "#6B6F78", fontSize: 10, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Period</label>
          <select value={period} onChange={function(e) { setPeriod(e.target.value); }}
            style={{ background: "#12141A", color: "#F0F1F3", border: "1px solid #1E2028", padding: "7px 10px", borderRadius: 5, fontSize: 12 }}>
            {periodOptions.map(function(p) { return <option key={p.value} value={p.value}>{p.label}</option>; })}
          </select>
        </div>
        <div>
          <label style={{ color: "#6B6F78", fontSize: 10, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Store</label>
          <select value={storeFilter} onChange={function(e) { setStoreFilter(e.target.value); }}
            style={{ background: "#12141A", color: "#F0F1F3", border: "1px solid #1E2028", padding: "7px 10px", borderRadius: 5, fontSize: 12 }}>
            <option value="">All Stores</option>
            {STORES.map(function(s) { return <option key={s} value={s}>{storeLabel(s)}</option>; })}
          </select>
        </div>
        <div>
          <label style={{ color: "#6B6F78", fontSize: 10, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Status</label>
          <select value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }}
            style={{ background: "#12141A", color: "#F0F1F3", border: "1px solid #1E2028", padding: "7px 10px", borderRadius: 5, fontSize: 12 }}>
            <option value="">All Statuses</option>
            {STATUSES.map(function(s) { return <option key={s.value} value={s.value}>{s.label}</option>; })}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ color: "#6B6F78", fontSize: 10, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Search</label>
          <input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Ticket #, customer, device..."
            style={{ width: "100%", background: "#12141A", color: "#F0F1F3", border: "1px solid #1E2028", padding: "7px 10px", borderRadius: 5, fontSize: 12, boxSizing: "border-box" }} />
        </div>
      </div>

      {msg && (
        <div style={{
          padding: 12, borderRadius: 6, marginBottom: 16, fontSize: 13,
          background: msg.type === "error" ? RED + "22" : msg.type === "success" ? GREEN + "22" : CYAN + "22",
          color: msg.type === "error" ? RED : msg.type === "success" ? GREEN : CYAN,
        }}>
          {msg.text}
          <button onClick={function() { setMsg(null); }} style={{ float: "right", background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Commission summary */}
      {commissions && (
        <div style={{ background: "#0F1116", borderRadius: 10, padding: 18, marginBottom: 20, border: "1px solid #1E2028" }}>
          <div style={{ color: GOLD, fontSize: 11, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: 1 }}>
            {"\uD83D\uDCB0"} Commission Summary — {periodOptions.find(function(p) { return p.value === period; })?.label || period}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
            <SummaryCard label="Closed Repairs" value={commissions.total_repairs} color={GREEN} />
            <SummaryCard label="Gross Profit Generated" value={fmt(commissions.total_profit)} color={CYAN} />
            <SummaryCard label="Total Commission Owed" value={fmt(commissions.total_commission)} color={PINK} />
            <SummaryCard label="Per-Store P&L Hit" value={
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <div>Fishers: {fmt(commissions.by_store.fishers)}</div>
                <div>Bloom: {fmt(commissions.by_store.bloomington)}</div>
                <div>Indy: {fmt(commissions.by_store.indianapolis)}</div>
              </div>
            } color={GOLD} />
          </div>
          {commissions.by_employee && commissions.by_employee.length > 0 && (
            <div style={{ background: "#12141A", borderRadius: 6, padding: 12 }}>
              <div style={{ color: "#6B6F78", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                Per-Employee Breakdown
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ color: "#6B6F78", fontSize: 10 }}>
                    <th style={{ textAlign: "left", padding: 6 }}>EMPLOYEE</th>
                    <th style={{ textAlign: "right", padding: 6 }}>PRIMARY (#)</th>
                    <th style={{ textAlign: "right", padding: 6 }}>PRIMARY $</th>
                    <th style={{ textAlign: "right", padding: 6 }}>OVERHEAD (#)</th>
                    <th style={{ textAlign: "right", padding: 6 }}>OVERHEAD $</th>
                    <th style={{ textAlign: "right", padding: 6, color: GREEN }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {commissions.by_employee.map(function(e) {
                    return (
                      <tr key={e.employee} style={{ borderTop: "1px solid #1E2028" }}>
                        <td style={{ padding: 6, fontWeight: 600, color: "#F0F1F3" }}>{e.employee}</td>
                        <td style={{ padding: 6, textAlign: "right", color: "#6B6F78" }}>{e.primary_count}</td>
                        <td style={{ padding: 6, textAlign: "right", color: "#F0F1F3" }}>{fmt(e.primary_amount)}</td>
                        <td style={{ padding: 6, textAlign: "right", color: "#6B6F78" }}>{e.overhead_count}</td>
                        <td style={{ padding: 6, textAlign: "right", color: "#F0F1F3" }}>{fmt(e.overhead_amount)}</td>
                        <td style={{ padding: 6, textAlign: "right", color: GREEN, fontWeight: 700 }}>{fmt(e.total_amount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!loading && openRepairs.length > 0 && (
        <RepairsTable title={"\uD83D\uDD04 Active (" + openRepairs.length + ")"} repairs={openRepairs} onEdit={setEditing} onReconcile={reconcileOne} />
      )}
      {!loading && doneRepairs.length > 0 && (
        <RepairsTable title={"\u2705 Closed / Nonrepairable (" + doneRepairs.length + ")"} repairs={doneRepairs} onEdit={setEditing} onReconcile={reconcileOne} />
      )}
      {!loading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "#6B6F78", background: "#0F1116", borderRadius: 10, border: "1px dashed #1E2028" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>{"\uD83D\uDD27"}</div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No advanced repairs for this period</div>
          <div style={{ fontSize: 12 }}>Click "Log Advanced Repair" to add one.</div>
        </div>
      )}

      {editing && (
        <RepairFormModal
          repair={editing === "new" ? null : editing}
          actor={actor}
          onClose={function() { setEditing(null); }}
          onSaved={function() { setEditing(null); load(); }}
          onMessage={setMsg}
        />
      )}
    </div>
  );
}

function SummaryCard(props) {
  return (
    <div style={{ background: "#12141A", borderRadius: 6, padding: 14 }}>
      <div style={{ color: "#6B6F78", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{props.label}</div>
      <div style={{ color: props.color || "#F0F1F3", fontSize: 20, fontWeight: 700 }}>{props.value}</div>
    </div>
  );
}

function RepairsTable(props) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ color: "#F0F1F3", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{props.title}</div>
      <div style={{ background: "#0F1116", borderRadius: 10, border: "1px solid #1E2028", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#12141A", color: "#6B6F78", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
              <th style={{ textAlign: "left", padding: "9px 10px" }}>Ticket</th>
              <th style={{ textAlign: "left", padding: "9px 10px" }}>Customer</th>
              <th style={{ textAlign: "left", padding: "9px 10px" }}>Device/Repair</th>
              <th style={{ textAlign: "left", padding: "9px 10px" }}>Origin</th>
              <th style={{ textAlign: "left", padding: "9px 10px" }}>Repaired By</th>
              <th style={{ textAlign: "left", padding: "9px 10px" }}>Status</th>
              <th style={{ textAlign: "right", padding: "9px 10px" }}>Price</th>
              <th style={{ textAlign: "right", padding: "9px 10px" }}>Profit</th>
              <th style={{ textAlign: "right", padding: "9px 10px" }}>Commission</th>
              <th style={{ textAlign: "right", padding: "9px 10px" }}></th>
            </tr>
          </thead>
          <tbody>
            {props.repairs.map(function(r) {
              var commTotal = (r.commissions || []).reduce(function(s, c) { return s + c.amount; }, 0);
              return (
                <tr key={r.id} style={{ borderTop: "1px solid #1E2028" }}>
                  <td style={{ padding: "9px 10px" }}>
                    {r.ticket_url ? (
                      <a href={r.ticket_url} target="_blank" rel="noreferrer" style={{ color: CYAN, textDecoration: "none", fontWeight: 600 }}>#{r.ticket_number}</a>
                    ) : (
                      <span style={{ color: "#F0F1F3", fontWeight: 600 }}>#{r.ticket_number}</span>
                    )}
                    <div style={{ color: "#6B6F78", fontSize: 10, marginTop: 2 }}>{fmtDate(r.ticket_created_date)}</div>
                  </td>
                  <td style={{ padding: "9px 10px", color: "#F0F1F3" }}>{r.customer_name || "—"}</td>
                  <td style={{ padding: "9px 10px", color: "#F0F1F3" }}>{r.device_repair || "—"}</td>
                  <td style={{ padding: "9px 10px", color: "#6B6F78", fontSize: 11 }}>
                    {storeLabel(r.origin_store)}
                    {r.current_location && r.current_location !== r.origin_store && (
                      <div style={{ color: CYAN, fontSize: 10 }}>→ {storeLabel(r.current_location)}</div>
                    )}
                  </td>
                  <td style={{ padding: "9px 10px", color: r.repaired_by === "Duncan" ? PURPLE : "#F0F1F3", fontWeight: r.repaired_by ? 600 : 400 }}>
                    {r.repaired_by || <span style={{ color: "#6B6F78", fontStyle: "italic" }}>unassigned</span>}
                  </td>
                  <td style={{ padding: "9px 10px" }}>{statusBadge(r.status)}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: "#F0F1F3" }}>{fmt(r.price)}</td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: parseFloat(r.profit) > 0 ? GREEN : RED, fontWeight: 600 }}>
                    {fmt(r.profit)}
                    {r.reconciled_from_ticket && <div style={{ color: CYAN, fontSize: 9, fontWeight: 400 }}>✓ RepairQ</div>}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "right", color: commTotal > 0 ? GOLD : "#6B6F78", fontWeight: 600 }}>
                    {commTotal > 0 ? fmt(commTotal) : "—"}
                  </td>
                  <td style={{ padding: "9px 10px", textAlign: "right" }}>
                    <button onClick={function() { props.onEdit(r); }} disabled={r.commission_locked}
                      style={{ background: "#12141A", color: r.commission_locked ? "#6B6F78" : CYAN, border: "1px solid #1E2028", padding: "4px 9px", borderRadius: 4, fontSize: 10, cursor: r.commission_locked ? "not-allowed" : "pointer", marginRight: 4 }}>
                      {r.commission_locked ? "🔒" : "Edit"}
                    </button>
                    {!r.reconciled_from_ticket && r.ticket_number && (
                      <button onClick={function() { props.onReconcile(r.id); }}
                        style={{ background: "#12141A", color: PURPLE, border: "1px solid #1E2028", padding: "4px 9px", borderRadius: 4, fontSize: 10, cursor: "pointer" }}>
                        Sync
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RepairFormModal(props) {
  var isNew = !props.repair;
  var [form, setForm] = useState(isNew ? {
    ticket_number: "", ticket_url: "",
    ticket_created_date: new Date().toISOString().slice(0, 10),
    customer_name: "", device_repair: "",
    origin_store: "fishers", current_location: "fishers",
    bench_fee: false, intake_employee: "", repaired_by: "",
    last_transported_by: "", last_transport_date: "",
    status: "open", estimated_completion: "",
    date_completed: "", date_closed: "",
    customer_picked_up_at_origin: true,
    price: 0, profit: 0, notes: "",
  } : Object.assign({}, props.repair));
  var [saving, setSaving] = useState(false);

  var update = function(k, v) {
    setForm(function(f) { var n = Object.assign({}, f); n[k] = v; return n; });
  };

  var save = async function() {
    setSaving(true);
    try {
      var payload = Object.assign({}, form, { action: isNew ? "create" : "update", actor: props.actor });
      if (payload.ticket_number && !payload.ticket_url) {
        payload.ticket_url = "https://cpr.repairq.io/ticket/" + payload.ticket_number;
      }
      ["ticket_created_date", "last_transport_date", "estimated_completion", "date_completed", "date_closed"].forEach(function(k) {
        if (payload[k] === "") payload[k] = null;
      });
      var r = await fetch("/api/advanced-repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      var d = await r.json();
      if (d.success) {
        props.onMessage({ type: "success", text: isNew ? "Repair logged." : "Repair updated." });
        props.onSaved();
      } else {
        props.onMessage({ type: "error", text: d.error || "Save failed" });
      }
    } catch (e) { props.onMessage({ type: "error", text: e.message }); }
    setSaving(false);
  };

  var del = async function() {
    if (!confirm("Delete this repair? Cannot be undone.")) return;
    setSaving(true);
    try {
      var r = await fetch("/api/advanced-repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: form.id, actor: props.actor }),
      });
      var d = await r.json();
      if (d.success) {
        props.onMessage({ type: "success", text: "Deleted." });
        props.onSaved();
      } else { props.onMessage({ type: "error", text: d.error }); }
    } catch (e) { props.onMessage({ type: "error", text: e.message }); }
    setSaving(false);
  };

  return (
    <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, paddingBottom: 40, overflowY: "auto" }}>
      <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "#0F1116", borderRadius: 12, border: "1px solid #1E2028", width: "100%", maxWidth: 720, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, color: "#F0F1F3", fontSize: 17 }}>{isNew ? "Log Advanced Repair" : "Edit Repair"}</h3>
          <button onClick={props.onClose} style={{ background: "none", border: "none", color: "#6B6F78", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field label="Ticket Number*" hint="RepairQ ticket #"><input value={form.ticket_number} onChange={function(e) { update("ticket_number", e.target.value); }} placeholder="e.g. 15863995" style={inputStyle()} /></Field>
          <Field label="Ticket URL (optional)"><input value={form.ticket_url} onChange={function(e) { update("ticket_url", e.target.value); }} placeholder="auto-filled from ticket #" style={inputStyle()} /></Field>
          <Field label="Customer Name"><input value={form.customer_name} onChange={function(e) { update("customer_name", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Device & Repair*"><input value={form.device_repair} onChange={function(e) { update("device_repair", e.target.value); }} placeholder="e.g. PS5 HDMI port" style={inputStyle()} /></Field>
          <Field label="Origin Store*">
            <select value={form.origin_store} onChange={function(e) { update("origin_store", e.target.value); }} style={inputStyle()}>
              {["fishers", "bloomington", "indianapolis"].map(function(s) { return <option key={s} value={s}>{storeLabel(s)}</option>; })}
            </select>
          </Field>
          <Field label="Current Location">
            <select value={form.current_location || ""} onChange={function(e) { update("current_location", e.target.value); }} style={inputStyle()}>
              {["fishers", "bloomington", "indianapolis"].map(function(s) { return <option key={s} value={s}>{storeLabel(s)}</option>; })}
            </select>
          </Field>
          <Field label="Intake Date*"><input type="date" value={form.ticket_created_date || ""} onChange={function(e) { update("ticket_created_date", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Bench Fee?">
            <select value={form.bench_fee ? "yes" : "no"} onChange={function(e) { update("bench_fee", e.target.value === "yes"); }} style={inputStyle()}>
              <option value="no">No</option><option value="yes">Yes</option>
            </select>
          </Field>
          <Field label="Intake Employee"><input value={form.intake_employee} onChange={function(e) { update("intake_employee", e.target.value); }} placeholder="who logged this" style={inputStyle()} /></Field>
          <Field label="Repaired By" hint="Set when work is done"><input value={form.repaired_by} onChange={function(e) { update("repaired_by", e.target.value); }} placeholder="e.g. Duncan, Luke" style={inputStyle()} /></Field>
          <Field label="Status*">
            <select value={form.status} onChange={function(e) { update("status", e.target.value); }} style={inputStyle()}>
              {STATUSES.map(function(s) { return <option key={s.value} value={s.value}>{s.label}</option>; })}
            </select>
          </Field>
          <Field label="Estimated Completion"><input type="date" value={form.estimated_completion || ""} onChange={function(e) { update("estimated_completion", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Date Completed" hint="When repair finished"><input type="date" value={form.date_completed || ""} onChange={function(e) { update("date_completed", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Date Closed" hint="Customer paid + picked up — triggers commission"><input type="date" value={form.date_closed || ""} onChange={function(e) { update("date_closed", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Price" hint="Final or estimated"><input type="number" step="0.01" value={form.price} onChange={function(e) { update("price", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Profit (GP)" hint="Used for commission math"><input type="number" step="0.01" value={form.profit} onChange={function(e) { update("profit", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Last Transported By"><input value={form.last_transported_by || ""} onChange={function(e) { update("last_transported_by", e.target.value); }} style={inputStyle()} /></Field>
          <Field label="Last Transport Date"><input type="date" value={form.last_transport_date || ""} onChange={function(e) { update("last_transport_date", e.target.value); }} style={inputStyle()} /></Field>
          <div style={{ gridColumn: "1 / -1" }}>
            <Field label="Notes"><textarea value={form.notes || ""} onChange={function(e) { update("notes", e.target.value); }} rows={3} style={Object.assign({}, inputStyle(), { fontFamily: "inherit", resize: "vertical" })} /></Field>
          </div>
        </div>

        {form.status === "closed" && parseFloat(form.profit) > 0 && form.repaired_by && (
          <div style={{ marginTop: 14, padding: 12, background: GOLD + "11", border: "1px solid " + GOLD + "33", borderRadius: 6 }}>
            <div style={{ color: GOLD, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>{"\uD83D\uDCB0"} Commission Preview</div>
            <CommissionPreview profit={parseFloat(form.profit)} repairedBy={form.repaired_by} />
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, paddingTop: 14, borderTop: "1px solid #1E2028" }}>
          <div>
            {!isNew && !form.commission_locked && (
              <button onClick={del} disabled={saving} style={{ background: "transparent", color: RED, border: "1px solid " + RED, padding: "8px 14px", borderRadius: 5, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Delete</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={props.onClose} disabled={saving} style={{ background: "#12141A", color: "#F0F1F3", border: "1px solid #1E2028", padding: "8px 16px", borderRadius: 5, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>Cancel</button>
            <button onClick={save} disabled={saving || !form.ticket_number || !form.origin_store}
              style={{ background: PINK, color: "#fff", border: "none", padding: "8px 20px", borderRadius: 5, fontSize: 12, cursor: "pointer", fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving..." : (isNew ? "Log Repair" : "Save Changes")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommissionPreview(props) {
  var profit = props.profit;
  var isDuncan = (props.repairedBy || "").trim().toLowerCase() === "duncan";
  var primaryRate = isDuncan ? 0.10 : 0.07;
  var primary = Math.round(profit * primaryRate * 100) / 100;
  var overhead = isDuncan ? 0 : Math.round(profit * 0.03 * 100) / 100;
  return (
    <div style={{ fontSize: 11, color: "#F0F1F3", lineHeight: 1.8 }}>
      <div>{props.repairedBy} (primary, {(primaryRate * 100).toFixed(0)}%): <strong>{fmt(primary)}</strong></div>
      {!isDuncan && <div>Duncan (overhead, 3%): <strong>{fmt(overhead)}</strong></div>}
      <div style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid " + GOLD + "33", fontWeight: 700, color: GOLD }}>
        Total commission expense to Origin Store: {fmt(primary + overhead)}
      </div>
    </div>
  );
}

function Field(props) {
  return (
    <div>
      <label style={{ display: "block", color: "#6B6F78", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{props.label}</label>
      {props.children}
      {props.hint && <div style={{ color: "#6B6F78", fontSize: 10, marginTop: 4 }}>{props.hint}</div>}
    </div>
  );
}

function inputStyle() {
  return {
    width: "100%", background: "#12141A", color: "#F0F1F3",
    border: "1px solid #1E2028", padding: "7px 10px", borderRadius: 5,
    fontSize: 12, boxSizing: "border-box",
  };
}

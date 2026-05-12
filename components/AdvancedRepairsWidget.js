"use client";
import { useState, useEffect } from "react";

// Fuzzy name match — handles "Duncan Hitti" vs "Duncan" vs "Hitti, Duncan"
function namesMatch(a, b) {
  if (!a || !b) return false;
  var x = String(a).toLowerCase().trim();
  var y = String(b).toLowerCase().trim();
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  var xParts = x.replace(",", " ").split(/\s+/).filter(Boolean);
  var yParts = y.replace(",", " ").split(/\s+/).filter(Boolean);
  if (xParts.length > 0 && yParts.length > 0 && xParts[0] === yParts[0]) return true;
  if (xParts.length >= 2 && yParts.length >= 2) {
    if (xParts[0] === yParts[1] && xParts[1] === yParts[0]) return true;
  }
  return false;
}

function fmt(n) {
  return "$" + parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShort(n) {
  var v = parseFloat(n || 0);
  if (v >= 1000) return "$" + (v / 1000).toFixed(1) + "k";
  return "$" + Math.round(v);
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

// Props:
//   store: the store this /appointments page is for (e.g. "fishers")
//   employee: optional — the logged-in employee's name. If supplied, shows "your stake" panel.
//   auth: optional — full auth object { userInfo: { name, email, role } }. If supplied,
//         enables the "+ Log Advanced Repair" button and lets the widget identify
//         the actor for ownership checks. Falls back to employee-only mode when omitted.
export default function AdvancedRepairsWidget(props) {
  var store = props.store;
  var employee = props.employee;
  var auth = props.auth;
  var [leaderboard, setLeaderboard] = useState([]);
  var [openRepairs, setOpenRepairs] = useState([]);
  var [myCommission, setMyCommission] = useState(null);
  var [loading, setLoading] = useState(true);
  var [showForm, setShowForm] = useState(false);
  var [editingRepair, setEditingRepair] = useState(null);
  var [msg, setMsg] = useState(null);

  var load = async function() {
    setLoading(true);
    try {
      var calls = [
        fetch("/api/advanced-repairs?action=leaderboard").then(function(r) { return r.json(); }),
        fetch("/api/advanced-repairs?action=open_at_store&store=" + store).then(function(r) { return r.json(); }),
      ];
      if (employee) {
        calls.push(fetch("/api/advanced-repairs?action=my_commission&employee=" + encodeURIComponent(employee)).then(function(r) { return r.json(); }));
      }
      var results = await Promise.all(calls);
      if (results[0] && results[0].success) setLeaderboard(results[0].leaderboard || []);
      if (results[1] && results[1].success) setOpenRepairs(results[1].repairs || []);
      if (employee && results[2] && results[2].success) setMyCommission(results[2]);
    } catch (e) { /* fail silent — supplemental widget */ }
    setLoading(false);
  };

  useEffect(function() {
    if (store) load();
  }, [store, employee]);

  // Show the widget even when empty if the employee is logged in (they need the "Log" button).
  // Hide it only when there's nothing to show AND nobody can interact with it.
  if (!loading && leaderboard.length === 0 && openRepairs.length === 0 && !myCommission && !employee) return null;

  var myRank = -1;
  if (employee) {
    for (var i = 0; i < leaderboard.length; i++) {
      if (namesMatch(leaderboard[i].employee, employee)) {
        myRank = i + 1;
        break;
      }
    }
  }
  var topEarner = leaderboard.length > 0 ? leaderboard[0] : null;

  // Determine if user can click rows to edit (admins) or just view (employees see only their own as editable).
  var actor = {
    name: auth?.userInfo?.name || employee || "",
    email: auth?.userInfo?.email || "",
    role: auth?.userInfo?.role || "",
  };
  var canLog = !!(employee && store);
  var isAdmin = actor.role === "admin";

  // Helper: can the current user edit a given repair (matches API logic)?
  var canEdit = function(r) {
    if (isAdmin) return true;
    if (!r || r.commission_locked) return false;
    var candidates = [actor.name, actor.email].filter(Boolean);
    for (var ci = 0; ci < candidates.length; ci++) {
      if (namesMatch(r.created_by, candidates[ci])) return true;
      if (namesMatch(r.intake_employee, candidates[ci])) return true;
    }
    return false;
  };

  return (
    <div style={{ background: "var(--bg-card)", borderRadius: 14, padding: 20, marginTop: 24, border: "1px solid var(--border)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20 }}>{"\uD83D\uDD27"}</span>
            <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 17, fontWeight: 700 }}>Advanced Repairs</h3>
            <span style={{ background: "#FBBF2422", color: "#FBBF24", padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Bonus Program
            </span>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            Soldering & board-level repairs. Earn a percentage of gross profit on every advanced repair you complete. Get trained, get paid.
          </div>
        </div>
        {canLog && (
          <button onClick={function() { setEditingRepair(null); setShowForm(true); }}
            style={{ background: "linear-gradient(135deg, #FBBF24, #FF2D95)", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
            + Log Advanced Repair
          </button>
        )}
      </div>

      {/* Status message */}
      {msg && (
        <div style={{
          padding: 10, borderRadius: 6, marginBottom: 14, fontSize: 12,
          background: msg.type === "error" ? "#F8717122" : msg.type === "success" ? "#4ADE8022" : "#00D4FF22",
          color: msg.type === "error" ? "#F87171" : msg.type === "success" ? "#4ADE80" : "#00D4FF",
        }}>
          {msg.text}
          <button onClick={function() { setMsg(null); }} style={{ float: "right", background: "none", border: "none", color: "inherit", cursor: "pointer", fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* "Your stake" panel — only for logged-in employees */}
      {employee && myCommission && (
        <div style={{
          background: myCommission.total_amount > 0 ? "linear-gradient(135deg, #FBBF2422 0%, #FF2D9522 100%)" : "var(--bg-card-inner)",
          borderRadius: 10,
          padding: 16,
          marginBottom: 14,
          border: "1px solid " + (myCommission.total_amount > 0 ? "#FBBF2444" : "var(--border)"),
        }}>
          <div style={{ color: myCommission.total_amount > 0 ? "#FBBF24" : "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Your Advanced Repair Earnings This Month
          </div>
          {myCommission.total_amount > 0 ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
              <div style={{ color: "var(--text-primary)", fontSize: 30, fontWeight: 800, fontFamily: "ui-monospace, monospace" }}>
                {fmt(myCommission.total_amount)}
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{myCommission.primary_repairs}</span> repair{myCommission.primary_repairs === 1 ? "" : "s"} completed
                {myCommission.overhead_amount > 0 && (
                  <span> · <span style={{ color: "#7B2FFF", fontWeight: 600 }}>{fmt(myCommission.overhead_amount)}</span> from supporting others</span>
                )}
              </div>
              {myRank > 0 && (
                <div style={{ marginLeft: "auto", background: myRank === 1 ? "#FBBF24" : myRank <= 3 ? "#00D4FF" : "var(--text-muted)", color: "#0F1116", padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
                  {myRank === 1 ? "🏆 #1" : myRank === 2 ? "🥈 #2" : myRank === 3 ? "🥉 #3" : "#" + myRank}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ color: "var(--text-primary)", fontSize: 14, marginBottom: 6 }}>
                You haven't earned any advanced repair commission this month.
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                {topEarner ? (
                  <span>Top earner this month: <strong style={{ color: "var(--text-primary)" }}>{topEarner.employee}</strong> ({fmt(topEarner.commission)}). Talk to Duncan about getting trained — earn a percentage of gross profit on every advanced repair, on top of your normal commission.</span>
                ) : (
                  <span>No one's earned yet this month — be the first. Talk to Duncan about training.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Leaderboard */}
        <div style={{ background: "var(--bg-card-inner)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
          <div style={{ color: "#FBBF24", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{"\uD83C\uDFC6"} This Month's Leaderboard</span>
            <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 600 }}>{leaderboard.length} earning</span>
          </div>
          {leaderboard.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "16px 0", textAlign: "center" }}>
              No closed advanced repairs yet this month.
            </div>
          ) : (
            <div>
              {leaderboard.slice(0, 6).map(function(row, idx) {
                var isYou = employee && namesMatch(row.employee, employee);
                return (
                  <div key={row.employee} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 4px", borderTop: idx === 0 ? "none" : "1px solid var(--border)",
                    background: isYou ? "#FBBF2411" : "transparent",
                    borderRadius: isYou ? 6 : 0, paddingLeft: isYou ? 8 : 4,
                  }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: "50%",
                      background: idx === 0 ? "#FBBF24" : idx === 1 ? "#C0C0C0" : idx === 2 ? "#CD7F32" : "var(--bg-card)",
                      color: idx <= 2 ? "#0F1116" : "var(--text-primary)",
                      fontSize: 12, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>{idx + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600 }}>
                        {row.employee}
                        {isYou && <span style={{ color: "#FBBF24", fontSize: 10, marginLeft: 6, fontWeight: 700 }}>YOU</span>}
                      </div>
                      <div style={{ color: "var(--text-muted)", fontSize: 10 }}>
                        {row.repairs} repair{row.repairs === 1 ? "" : "s"} · {fmt(row.profit)} GP
                      </div>
                    </div>
                    <div style={{ color: "#4ADE80", fontWeight: 700, fontSize: 14, fontFamily: "ui-monospace, monospace" }}>
                      {fmtShort(row.commission)}
                    </div>
                  </div>
                );
              })}
              {leaderboard.length > 6 && (
                <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 10, paddingTop: 8 }}>
                  +{leaderboard.length - 6} more earners
                </div>
              )}
            </div>
          )}
        </div>

        {/* Open at this store */}
        <div style={{ background: "var(--bg-card-inner)", borderRadius: 10, padding: 14, border: "1px solid var(--border)" }}>
          <div style={{ color: "#00D4FF", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{"\uD83D\uDD04"} Open at {storeLabel(store)}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 600 }}>{openRepairs.length} active</span>
          </div>
          {openRepairs.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: 12, padding: "16px 0", textAlign: "center" }}>
              No active advanced repairs at this store.
            </div>
          ) : (
            <div>
              {openRepairs.slice(0, 6).map(function(r, idx) {
                var statusColor = r.status === "open" ? "var(--text-muted)" : r.status === "in_transit" ? "#00D4FF" : "#7B2FFF";
                var editable = canEdit(r);
                return (
                  <div key={r.id}
                    onClick={editable ? function() { setEditingRepair(r); setShowForm(true); } : undefined}
                    style={{
                      padding: "8px 4px", borderTop: idx === 0 ? "none" : "1px solid var(--border)",
                      cursor: editable ? "pointer" : "default",
                      borderRadius: editable ? 4 : 0,
                    }}
                    title={editable ? "Click to edit" : ""}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ background: statusColor + "22", color: statusColor, padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>
                        {r.status === "in_transit" ? "Transit" : r.status === "repaired" ? "Done" : "Open"}
                      </span>
                      <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600, flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {r.device_repair || "—"}
                      </div>
                      {editable && <span style={{ color: "var(--text-muted)", fontSize: 10 }}>✏️</span>}
                      <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{fmtDate(r.ticket_created_date)}</div>
                    </div>
                    <div style={{ color: "var(--text-muted)", fontSize: 11, paddingLeft: 4 }}>
                      {r.customer_name || "Unknown"}
                      {r.current_location && r.current_location !== r.origin_store && (
                        <span style={{ color: "#00D4FF" }}> · at {storeLabel(r.current_location)}</span>
                      )}
                      {r.repaired_by && <span> · {r.repaired_by}</span>}
                    </div>
                  </div>
                );
              })}
              {openRepairs.length > 6 && (
                <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 10, paddingTop: 8 }}>
                  +{openRepairs.length - 6} more
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11, textAlign: "center" }}>
        {"\uD83D\uDCA1"} These are high-profit repairs (avg <span style={{ color: "#4ADE80", fontWeight: 700 }}>80%+ margin</span>). Bonus paid monthly when ticket closes. Want training? Ask Duncan.
      </div>

      {/* Quick form modal */}
      {showForm && (
        <QuickRepairForm
          repair={editingRepair}
          store={store}
          actor={actor}
          onClose={function() { setShowForm(false); setEditingRepair(null); }}
          onSaved={function(savedMsg) {
            setShowForm(false);
            setEditingRepair(null);
            setMsg({ type: "success", text: savedMsg });
            load();
          }}
          onError={function(errText) {
            setMsg({ type: "error", text: errText });
          }}
        />
      )}
    </div>
  );
}

// ─── Quick form modal — 8 fields for intake employees ─────────────────────
function QuickRepairForm(props) {
  var isNew = !props.repair;
  var [form, setForm] = useState(isNew ? {
    ticket_number: "",
    customer_name: "",
    device_repair: "",
    bench_fee: false,
    notes: "",
    // Hidden fields auto-set
    ticket_created_date: new Date().toISOString().slice(0, 10),
    origin_store: props.store,
    current_location: props.store,
    intake_employee: props.actor.name || "",
    status: "open",
    price: 0,
    profit: 0,
  } : Object.assign({}, props.repair));
  var [saving, setSaving] = useState(false);
  var [showAdvanced, setShowAdvanced] = useState(!isNew); // show extra fields when editing
  var [lookupHint, setLookupHint] = useState(null);

  var update = function(k, v) {
    setForm(function(f) { var n = Object.assign({}, f); n[k] = v; return n; });
  };

  // Lookup customer + device from ticket_grades when ticket number is entered
  var doLookup = async function() {
    var tn = (form.ticket_number || "").trim();
    if (!tn) return;
    try {
      var r = await fetch("/api/advanced-repairs?action=lookup&ticket_number=" + encodeURIComponent(tn));
      var d = await r.json();
      if (d.success && d.found) {
        var updates = {};
        var hints = [];
        if (d.customer_name && !form.customer_name) { updates.customer_name = d.customer_name; hints.push("customer"); }
        if (d.device && !form.device_repair) { updates.device_repair = d.device; hints.push("device"); }
        if (Object.keys(updates).length > 0) {
          setForm(function(f) { return Object.assign({}, f, updates); });
          setLookupHint("✓ Auto-filled " + hints.join(" + ") + " from RepairQ");
          setTimeout(function() { setLookupHint(null); }, 3000);
        } else {
          setLookupHint("✓ Ticket found in RepairQ");
          setTimeout(function() { setLookupHint(null); }, 2000);
        }
      }
    } catch (e) { /* silent */ }
  };

  var save = async function() {
    if (!form.ticket_number) { props.onError("Ticket number is required."); return; }
    if (!form.device_repair) { props.onError("Device/repair description is required."); return; }
    setSaving(true);
    try {
      var payload = Object.assign({}, form, {
        action: isNew ? "create" : "update",
        actor: props.actor,
        created_by: isNew ? (props.actor.email || props.actor.name) : form.created_by,
        updated_by: props.actor.email || props.actor.name,
      });
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
        props.onSaved(isNew ? "Advanced repair logged. Duncan and the team can now see it." : "Repair updated.");
      } else {
        props.onError(d.error || "Save failed");
      }
    } catch (e) { props.onError(e.message); }
    setSaving(false);
  };

  var del = async function() {
    if (!confirm("Delete this advanced repair entry? Cannot be undone.")) return;
    setSaving(true);
    try {
      var r = await fetch("/api/advanced-repairs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: form.id, actor: props.actor }),
      });
      var d = await r.json();
      if (d.success) {
        props.onSaved("Repair entry deleted.");
      } else {
        props.onError(d.error || "Delete failed");
      }
    } catch (e) { props.onError(e.message); }
    setSaving(false);
  };

  var inputSt = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-card-inner)",
    color: "var(--text-primary)",
    fontSize: 13,
    boxSizing: "border-box",
  };
  var labelSt = {
    display: "block",
    color: "var(--text-muted)",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  };

  return (
    <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 40, paddingBottom: 40, overflowY: "auto" }}>
      <div onClick={function(e) { e.stopPropagation(); }} style={{ background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)", width: "100%", maxWidth: 560, padding: 24, margin: "0 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 17, fontWeight: 700 }}>
            {"\uD83D\uDD27"} {isNew ? "Log Advanced Repair" : "Edit Advanced Repair"}
          </h3>
          <button onClick={props.onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        {isNew && (
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 18 }}>
            Use this when a customer brings in a device needing soldering or board-level work. Duncan and the team will see it immediately.
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {/* Ticket # — with lookup */}
          <div>
            <label style={labelSt}>RepairQ Ticket Number*</label>
            <input
              value={form.ticket_number}
              onChange={function(e) { update("ticket_number", e.target.value); }}
              onBlur={doLookup}
              placeholder="e.g. 15863995"
              style={inputSt}
              autoFocus={isNew}
            />
            {lookupHint && <div style={{ color: "#4ADE80", fontSize: 11, marginTop: 4 }}>{lookupHint}</div>}
            {isNew && !lookupHint && <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 4 }}>Paste from the URL after creating the RepairQ ticket. We'll auto-fill customer and device if we know them.</div>}
          </div>

          <div>
            <label style={labelSt}>Customer Name</label>
            <input value={form.customer_name} onChange={function(e) { update("customer_name", e.target.value); }} placeholder="optional" style={inputSt} />
          </div>

          <div>
            <label style={labelSt}>Device & Repair*</label>
            <input value={form.device_repair} onChange={function(e) { update("device_repair", e.target.value); }} placeholder="e.g. PS5 HDMI port, iPad charging port" style={inputSt} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={labelSt}>Origin Store</label>
              <select value={form.origin_store} onChange={function(e) { update("origin_store", e.target.value); }} style={inputSt}>
                <option value="fishers">Fishers</option>
                <option value="bloomington">Bloomington</option>
                <option value="indianapolis">Indianapolis</option>
              </select>
            </div>
            <div>
              <label style={labelSt}>Bench Fee Collected?</label>
              <select value={form.bench_fee ? "yes" : "no"} onChange={function(e) { update("bench_fee", e.target.value === "yes"); }} style={inputSt}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
          </div>

          <div>
            <label style={labelSt}>Notes</label>
            <textarea value={form.notes || ""} onChange={function(e) { update("notes", e.target.value); }} placeholder="Anything Duncan or the team should know (symptoms, customer preferences, etc.)" rows={3} style={Object.assign({}, inputSt, { fontFamily: "inherit", resize: "vertical" })} />
          </div>

          {/* Toggle for advanced fields */}
          <button onClick={function() { setShowAdvanced(!showAdvanced); }}
            type="button"
            style={{ background: "transparent", border: "none", color: "#7B2FFF", fontSize: 11, cursor: "pointer", padding: 0, textAlign: "left", textDecoration: "underline" }}>
            {showAdvanced ? "Hide advanced fields" : "Show advanced fields (status, repaired by, profit, dates)"}
          </button>

          {showAdvanced && (
            <div style={{ display: "grid", gap: 12, padding: 14, background: "var(--bg-card-inner)", borderRadius: 8, border: "1px solid var(--border)" }}>
              <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2 }}>
                These fields are normally filled in by Duncan or an admin after the repair is complete. Only edit if you know.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelSt}>Status</label>
                  <select value={form.status} onChange={function(e) { update("status", e.target.value); }} style={inputSt}>
                    <option value="open">Open</option>
                    <option value="in_transit">In Transit</option>
                    <option value="repaired">Repaired (awaiting pickup)</option>
                    <option value="closed">Closed (paid + picked up)</option>
                    <option value="nonrepairable">Nonrepairable</option>
                  </select>
                </div>
                <div>
                  <label style={labelSt}>Current Location</label>
                  <select value={form.current_location || form.origin_store} onChange={function(e) { update("current_location", e.target.value); }} style={inputSt}>
                    <option value="fishers">Fishers</option>
                    <option value="bloomington">Bloomington</option>
                    <option value="indianapolis">Indianapolis</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelSt}>Repaired By</label>
                <input value={form.repaired_by || ""} onChange={function(e) { update("repaired_by", e.target.value); }} placeholder="e.g. Duncan, Luke — set when work is done" style={inputSt} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelSt}>Price</label>
                  <input type="number" step="0.01" value={form.price || 0} onChange={function(e) { update("price", e.target.value); }} style={inputSt} />
                </div>
                <div>
                  <label style={labelSt}>Profit (GP)</label>
                  <input type="number" step="0.01" value={form.profit || 0} onChange={function(e) { update("profit", e.target.value); }} style={inputSt} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelSt}>Date Completed</label>
                  <input type="date" value={form.date_completed || ""} onChange={function(e) { update("date_completed", e.target.value); }} style={inputSt} />
                </div>
                <div>
                  <label style={labelSt}>Date Closed</label>
                  <input type="date" value={form.date_closed || ""} onChange={function(e) { update("date_closed", e.target.value); }} style={inputSt} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div>
            {!isNew && !form.commission_locked && (
              <button onClick={del} disabled={saving}
                style={{ background: "transparent", color: "#F87171", border: "1px solid #F87171", padding: "8px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                Delete
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={props.onClose} disabled={saving}
              style={{ background: "var(--bg-card-inner)", color: "var(--text-primary)", border: "1px solid var(--border)", padding: "8px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
              Cancel
            </button>
            <button onClick={save} disabled={saving || !form.ticket_number || !form.device_repair}
              style={{ background: "linear-gradient(135deg, #FBBF24, #FF2D95)", color: "#fff", border: "none", padding: "8px 22px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving..." : (isNew ? "Log Repair" : "Save Changes")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

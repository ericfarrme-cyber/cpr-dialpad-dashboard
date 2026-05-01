"use client";
import { useState, useEffect } from "react";
import { STORES } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────
// CoachingTab — Performance Command Center (admin/manager only)
// Three sections:  🚨 Needs Attention · 🌟 Recognize Today · ⚡ Active Now
// Each flag has: dismiss · push to MyPerformance (notes) · post to #wins (only for win flags) · mark as 1:1
// ─────────────────────────────────────────────────────────────────

var card = { background: "#0F1117", borderRadius: 12, padding: 20, border: "1px solid #1E2028" };
var cardInner = { background: "#12141A", borderRadius: 8, padding: 14 };
var btnBase = { padding: "6px 12px", borderRadius: 6, border: "1px solid #2A2D36", background: "transparent", color: "#F0F1F3", fontSize: 11, fontWeight: 600, cursor: "pointer" };

var SECTIONS = [
  { id: "regression", title: "🚨 Needs Attention", subtitle: "Coach now — performance issues that hurt this period's results", color: "#F87171" },
  { id: "win", title: "🌟 Recognize Today", subtitle: "Catch them doing it right — give the feedback while it's fresh", color: "#4ADE80" },
  { id: "opportunity", title: "⚡ Active Now", subtitle: "On shift today and below baseline — intervention possible", color: "#FBBF24" },
];

export default function CoachingTab() {
  var [loading, setLoading] = useState(true);
  var [flags, setFlags] = useState({ regression: [], win: [], opportunity: [] });
  var [storeFilter, setStoreFilter] = useState("all");
  var [computing, setComputing] = useState(false);
  var [computeResult, setComputeResult] = useState(null);
  var [activeModal, setActiveModal] = useState(null); // { flag, drafting, draft, deliveryMethod, sending, error }

  function loadFlags() {
    setLoading(true);
    var url = "/api/dialpad/flags?action=active" + (storeFilter !== "all" ? "&store=" + storeFilter : "");
    fetch(url).then(function(r) { return r.json(); }).then(function(json) {
      if (json.success) setFlags(json.grouped || { regression: [], win: [], opportunity: [] });
      setLoading(false);
    }).catch(function() { setLoading(false); });
  }

  useEffect(loadFlags, [storeFilter]);

  async function runDetection() {
    setComputing(true);
    setComputeResult(null);
    try {
      var res = await fetch("/api/dialpad/flags?action=compute", { method: "POST", body: JSON.stringify({}) });
      var json = await res.json();
      setComputeResult(json);
      loadFlags();
    } catch(e) {
      setComputeResult({ success: false, error: String(e && e.message || e) });
    }
    setComputing(false);
  }

  async function dismissFlag(flag) {
    if (!confirm("Dismiss this flag? It won't reappear today.")) return;
    await fetch("/api/dialpad/flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss", flag_id: flag.id }) });
    loadFlags();
  }

  async function markActed(flag, via, note) {
    await fetch("/api/dialpad/flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "acted", flag_id: flag.id, via: via, note: note }) });
    loadFlags();
  }

  async function openCoachModal(flag) {
    setActiveModal({ flag: flag, drafting: true, draft: null, deliveryMethod: flag.flag_type === "win" ? "slack" : "note", sending: false, error: null });
    try {
      var res = await fetch("/api/dialpad/flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "draft_message", flag_id: flag.id }) });
      var json = await res.json();
      if (json.success) {
        setActiveModal(function(m) { return Object.assign({}, m, { drafting: false, draft: json.draft }); });
      } else {
        setActiveModal(function(m) { return Object.assign({}, m, { drafting: false, error: json.error || "Draft failed" }); });
      }
    } catch(e) {
      setActiveModal(function(m) { return Object.assign({}, m, { drafting: false, error: String(e && e.message || e) }); });
    }
  }

  async function sendCoachMessage() {
    if (!activeModal || !activeModal.draft) return;
    setActiveModal(function(m) { return Object.assign({}, m, { sending: true, error: null }); });
    try {
      var endpoint, payload;
      if (activeModal.deliveryMethod === "slack") {
        endpoint = "send_slack";
        payload = { action: "send_slack", flag_id: activeModal.flag.id, message: activeModal.draft };
      } else if (activeModal.deliveryMethod === "note") {
        endpoint = "send_note";
        payload = { action: "send_note", flag_id: activeModal.flag.id, employee: activeModal.flag.employee_name, store: activeModal.flag.store, category: activeModal.flag.category, message: activeModal.draft, from_admin: "Eric" };
      } else if (activeModal.deliveryMethod === "1on1") {
        endpoint = "acted";
        payload = { action: "acted", flag_id: activeModal.flag.id, via: "1on1", note: "Saved for next 1:1 — message: " + activeModal.draft.substring(0, 200) };
      } else {
        endpoint = "acted";
        payload = { action: "acted", flag_id: activeModal.flag.id, via: "manual", note: activeModal.draft.substring(0, 200) };
      }
      var res = await fetch("/api/dialpad/flags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      var json = await res.json();
      if (!json.success) {
        setActiveModal(function(m) { return Object.assign({}, m, { sending: false, error: json.error || "Send failed" }); });
        return;
      }
      setActiveModal(null);
      loadFlags();
    } catch(e) {
      setActiveModal(function(m) { return Object.assign({}, m, { sending: false, error: String(e && e.message || e) }); });
    }
  }

  function copyDraft() {
    if (!activeModal || !activeModal.draft) return;
    navigator.clipboard.writeText(activeModal.draft).then(function() {
      // Quick visual confirm
      setActiveModal(function(m) { return Object.assign({}, m, { copied: true }); });
      setTimeout(function() { setActiveModal(function(m) { return m ? Object.assign({}, m, { copied: false }) : m; }); }, 1500);
    });
  }

  var totalFlags = flags.regression.length + flags.win.length + flags.opportunity.length;

  return (
    <div style={{ padding: 24, color: "#F0F1F3" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{"\uD83C\uDFAF"} Coaching</div>
          <div style={{ color: "#8B8F98", fontSize: 12, marginTop: 4 }}>
            Performance flags surfaced from real employee data. Triage now — wins go public, coaching stays private.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={storeFilter} onChange={function(e) { setStoreFilter(e.target.value); }}
            style={{ padding: "6px 12px", borderRadius: 6, background: "#12141A", color: "#F0F1F3", border: "1px solid #2A2D36", fontSize: 12 }}>
            <option value="all">All Stores</option>
            {Object.keys(STORES).map(function(k) { return <option key={k} value={k}>{STORES[k].name}</option>; })}
          </select>
          <button onClick={runDetection} disabled={computing}
            style={Object.assign({}, btnBase, { background: "linear-gradient(135deg, #7B2FFF, #FF2D95)", border: "none", color: "#fff", cursor: computing ? "wait" : "pointer", opacity: computing ? 0.6 : 1 })}>
            {computing ? "Running…" : "\u26A1 Run Detection"}
          </button>
        </div>
      </div>

      {/* Compute result toast */}
      {computeResult && (
        <div style={Object.assign({}, cardInner, { borderLeft: "3px solid " + (computeResult.success ? "#4ADE80" : "#F87171"), marginBottom: 16, fontSize: 12 })}>
          {computeResult.success ? (
            <span style={{ color: "#4ADE80" }}>{"\u2713"} Detection ran in {Math.round((computeResult.duration_ms || 0) / 100) / 10}s — analyzed {computeResult.tickets_analyzed} tickets, {computeResult.audits_analyzed} audits across {computeResult.employees_evaluated} employees. Found {computeResult.candidates_evaluated} candidate flag{computeResult.candidates_evaluated === 1 ? "" : "s"}, persisted {computeResult.saved} new.</span>
          ) : (
            <span style={{ color: "#F87171" }}>{"\u2717"} {computeResult.error}</span>
          )}
        </div>
      )}

      {/* Total summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        {SECTIONS.map(function(s) {
          var n = flags[s.id].length;
          return (
            <div key={s.id} style={Object.assign({}, card, { borderTop: "3px solid " + s.color, padding: 14 })}>
              <div style={{ color: "#8B8F98", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.title}</div>
              <div style={{ color: s.color, fontSize: 28, fontWeight: 800, marginTop: 4 }}>{n}</div>
              <div style={{ color: "#6B6F78", fontSize: 10 }}>{n === 1 ? "active flag" : "active flags"}</div>
            </div>
          );
        })}
      </div>

      {loading ? (
        <div style={{ color: "#8B8F98", textAlign: "center", padding: 40 }}>Loading flags…</div>
      ) : totalFlags === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: 60 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{"\uD83D\uDC4C"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#F0F1F3", marginBottom: 6 }}>All clear</div>
          <div style={{ color: "#8B8F98", fontSize: 12 }}>No active flags right now. Click <strong>Run Detection</strong> to refresh, or wait for the cron to fire.</div>
        </div>
      ) : (
        SECTIONS.map(function(s) {
          var sectionFlags = flags[s.id];
          if (sectionFlags.length === 0) return null;
          return (
            <div key={s.id} style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.title}</div>
                <div style={{ fontSize: 11, color: "#8B8F98" }}>{s.subtitle}</div>
                <div style={{ marginLeft: "auto", fontSize: 11, color: "#6B6F78" }}>{sectionFlags.length} active</div>
              </div>
              {sectionFlags.map(function(flag) {
                return <FlagCard key={flag.id} flag={flag} onDismiss={dismissFlag} onCoach={openCoachModal} />;
              })}
            </div>
          );
        })
      )}

      {/* ─── Coach Modal ─── */}
      {activeModal && (
        <div onClick={function() { if (!activeModal.sending) setActiveModal(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div onClick={function(e) { e.stopPropagation(); }}
            style={{ background: "#0F1117", borderRadius: 12, maxWidth: 600, width: "100%", border: "1px solid #2A2D36", overflow: "hidden", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 20, borderBottom: "1px solid #1E2028" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#F0F1F3" }}>
                {activeModal.flag.flag_type === "win" ? "\uD83C\uDF89 Send Recognition" : "\uD83D\uDCAC Send Coaching"}
              </div>
              <div style={{ color: "#8B8F98", fontSize: 12, marginTop: 4 }}>
                <strong style={{ color: "#F0F1F3" }}>{activeModal.flag.employee_name}</strong>
                {activeModal.flag.store ? <span> · {STORES[activeModal.flag.store] ? STORES[activeModal.flag.store].name : activeModal.flag.store}</span> : null}
              </div>
              <div style={{ color: "#6B6F78", fontSize: 11, marginTop: 6, fontStyle: "italic" }}>
                {activeModal.flag.headline}
              </div>
            </div>

            <div style={{ padding: 20, flex: 1, overflowY: "auto" }}>
              {activeModal.drafting ? (
                <div style={{ color: "#8B8F98", textAlign: "center", padding: 40, fontSize: 13 }}>
                  Drafting your message…
                </div>
              ) : activeModal.error ? (
                <div style={{ color: "#F87171", padding: 14, background: "#F8717111", borderRadius: 6, fontSize: 12 }}>{activeModal.error}</div>
              ) : (
                <div>
                  <label style={{ display: "block", color: "#8B8F98", fontSize: 11, fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Message (edit before sending)</label>
                  <textarea value={activeModal.draft || ""} onChange={function(e) { setActiveModal(function(m) { return Object.assign({}, m, { draft: e.target.value }); }); }}
                    rows={6}
                    style={{ width: "100%", padding: 12, borderRadius: 6, background: "#12141A", color: "#F0F1F3", border: "1px solid #2A2D36", fontSize: 13, fontFamily: "inherit", resize: "vertical", lineHeight: 1.5 }} />

                  <div style={{ marginTop: 16 }}>
                    <label style={{ display: "block", color: "#8B8F98", fontSize: 11, fontWeight: 700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Delivery Method</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {activeModal.flag.flag_type === "win" && (
                        <label style={radioRow(activeModal.deliveryMethod === "slack")}>
                          <input type="radio" name="delivery" value="slack" checked={activeModal.deliveryMethod === "slack"}
                            onChange={function() { setActiveModal(function(m) { return Object.assign({}, m, { deliveryMethod: "slack" }); }); }}
                            style={{ marginRight: 10 }} />
                          <span><strong style={{ color: "#4ADE80" }}>Post to #wins</strong> — public team-wide recognition</span>
                        </label>
                      )}
                      <label style={radioRow(activeModal.deliveryMethod === "note")}>
                        <input type="radio" name="delivery" value="note" checked={activeModal.deliveryMethod === "note"}
                          onChange={function() { setActiveModal(function(m) { return Object.assign({}, m, { deliveryMethod: "note" }); }); }}
                          style={{ marginRight: 10 }} />
                        <span><strong style={{ color: "#7B2FFF" }}>Push to their MyPerformance</strong> — private, they see it next login with an obvious badge</span>
                      </label>
                      <label style={radioRow(activeModal.deliveryMethod === "1on1")}>
                        <input type="radio" name="delivery" value="1on1" checked={activeModal.deliveryMethod === "1on1"}
                          onChange={function() { setActiveModal(function(m) { return Object.assign({}, m, { deliveryMethod: "1on1" }); }); }}
                          style={{ marginRight: 10 }} />
                        <span><strong style={{ color: "#FBBF24" }}>Save for 1:1</strong> — marks the flag as acted on, saves the message for your reference</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: 16, borderTop: "1px solid #1E2028", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <button onClick={copyDraft} disabled={!activeModal.draft || activeModal.sending}
                style={Object.assign({}, btnBase, { opacity: activeModal.draft ? 1 : 0.4 })}>
                {activeModal.copied ? "\u2713 Copied" : "\uD83D\uDCCB Copy text"}
              </button>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={function() { setActiveModal(null); }} disabled={activeModal.sending} style={btnBase}>Cancel</button>
                <button onClick={sendCoachMessage} disabled={!activeModal.draft || activeModal.sending}
                  style={Object.assign({}, btnBase, { background: "linear-gradient(135deg, #7B2FFF, #FF2D95)", border: "none", color: "#fff", opacity: activeModal.draft && !activeModal.sending ? 1 : 0.5 })}>
                  {activeModal.sending ? "Sending…"
                    : activeModal.deliveryMethod === "slack" ? "Post to #wins"
                    : activeModal.deliveryMethod === "note" ? "Send to MyPerformance"
                    : "Save for 1:1"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function radioRow(checked) {
  return {
    display: "flex", alignItems: "center", padding: "10px 12px", borderRadius: 6,
    background: checked ? "#7B2FFF15" : "#12141A",
    border: "1px solid " + (checked ? "#7B2FFF55" : "#2A2D36"),
    cursor: "pointer", fontSize: 12, color: "#F0F1F3", lineHeight: 1.4,
  };
}

function FlagCard(props) {
  var flag = props.flag;
  var store = STORES[flag.store];
  var sevColor = flag.severity >= 5 ? "#F87171" : flag.severity >= 4 ? "#FB923C" : flag.severity >= 3 ? "#FBBF24" : "#8B8F98";
  var ev = flag.evidence || {};
  return (
    <div style={Object.assign({}, card, { marginBottom: 10, padding: 16 })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: sevColor }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: "#F0F1F3" }}>{flag.employee_name}</span>
            {store && <span style={{ fontSize: 11, color: store.color, fontWeight: 600 }}>· {store.name.replace("CPR ", "")}</span>}
          </div>
          <div style={{ fontSize: 13, color: "#F0F1F3", marginBottom: 6, lineHeight: 1.4 }}>{flag.headline}</div>
          {(flag.metric_current != null && flag.metric_baseline != null) && (
            <div style={{ fontSize: 11, color: "#8B8F98", marginBottom: 4 }}>
              {flag.metric_label}: <strong style={{ color: "#F0F1F3" }}>{flag.metric_current}</strong>
              {flag.metric_baseline > 0 && <span> · baseline {flag.metric_baseline}</span>}
              {flag.delta != null && <span style={{ color: flag.delta < 0 ? "#F87171" : "#4ADE80", marginLeft: 6, fontWeight: 700 }}>({flag.delta > 0 ? "+" : ""}{flag.delta})</span>}
            </div>
          )}

          {/* Surface specific gaps when present (notes_streak rule) so the manager sees what's actually wrong before clicking Coach */}
          {ev.top_gaps && ev.top_gaps.length > 0 && (
            <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 6, background: "#FB923C18", borderLeft: "3px solid #FB923C" }}>
              <div style={{ fontSize: 10, color: "#FB923C", fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 4 }}>{"\u26A0"} Specific gaps</div>
              <div style={{ fontSize: 11, color: "#F0F1F3", lineHeight: 1.4 }}>
                {ev.top_gaps.map(function(g, i) {
                  return <span key={g}>{i > 0 ? " · " : ""}{g}</span>;
                })}
              </div>
            </div>
          )}

          {/* Per-ticket evidence with gaps */}
          {ev.ticket_details && ev.ticket_details.length > 0 ? (
            <div style={{ fontSize: 10, color: "#8B8F98", marginTop: 8 }}>
              {ev.ticket_details.slice(0, 4).map(function(td) {
                return (
                  <div key={td.ticket_number} style={{ padding: "4px 0", display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <a href={"https://cpr.repairq.io/ticket/" + td.ticket_number} target="_blank" rel="noopener noreferrer" style={{ color: "#00D4FF", textDecoration: "none", fontWeight: 700 }}>#{td.ticket_number}</a>
                    {td.notes_score != null && <span style={{ color: td.notes_score < 30 ? "#F87171" : td.notes_score < 50 ? "#FB923C" : "#FBBF24", fontWeight: 700 }}>notes {td.notes_score}/100</span>}
                    {td.gaps && td.gaps.length > 0 && <span style={{ color: "#6B6F78", fontStyle: "italic" }}>missing: {td.gaps.join(", ")}</span>}
                  </div>
                );
              })}
              {ev.ticket_details.length > 4 && <div style={{ marginTop: 4, color: "#6B6F78" }}>+ {ev.ticket_details.length - 4} more</div>}
            </div>
          ) : ev.ticket_numbers && ev.ticket_numbers.length > 0 ? (
            <div style={{ fontSize: 10, color: "#6B6F78", marginTop: 6 }}>
              Tickets: {ev.ticket_numbers.map(function(tn, i) {
                return <span key={tn}>{i > 0 ? ", " : ""}<a href={"https://cpr.repairq.io/ticket/" + tn} target="_blank" rel="noopener noreferrer" style={{ color: "#00D4FF", textDecoration: "none" }}>#{tn}</a></span>;
              })}
            </div>
          ) : null}

          {ev.attribution_note && (
            <div style={{ fontSize: 9, color: "#6B6F78", marginTop: 6, fontStyle: "italic" }}>{ev.attribution_note}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <button onClick={function() { props.onCoach(flag); }}
            style={Object.assign({}, btnBase, { background: "linear-gradient(135deg, #7B2FFF, #FF2D95)", border: "none", color: "#fff", whiteSpace: "nowrap" })}>
            {flag.flag_type === "win" ? "Recognize" : "Coach"}
          </button>
          <button onClick={function() { props.onDismiss(flag); }} style={btnBase}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}

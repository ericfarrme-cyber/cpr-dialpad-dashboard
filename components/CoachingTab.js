"use client";
import { useState, useEffect } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
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
  var [detailFlag, setDetailFlag] = useState(null);    // flag being viewed in detail modal

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
            <span style={{ color: "#4ADE80" }}>{"\u2713"} Detection ran in {Math.round((computeResult.duration_ms || 0) / 100) / 10}s — analyzed {computeResult.tickets_analyzed} tickets, {computeResult.audits_analyzed} audits across {computeResult.employees_evaluated} employees. Found {computeResult.candidates_evaluated} candidate flag{computeResult.candidates_evaluated === 1 ? "" : "s"}: {computeResult.saved || 0} new, {computeResult.updated || 0} refreshed{computeResult.skipped > 0 ? ", " + computeResult.skipped + " skipped (already actioned)" : ""}.</span>
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
                return <FlagCard key={flag.id} flag={flag} onDismiss={dismissFlag} onCoach={openCoachModal} onOpen={setDetailFlag} />;
              })}
            </div>
          );
        })
      )}

      {/* ─── Detail Modal ─── */}
      {detailFlag && (
        <DetailModal
          flag={detailFlag}
          onClose={function() { setDetailFlag(null); }}
          onCoach={function(f) { setDetailFlag(null); openCoachModal(f); }}
          onDismiss={function(f) { setDetailFlag(null); dismissFlag(f); }}
          onMark1on1={function(f) { setDetailFlag(null); markActed(f, "1on1", "Marked for 1:1 from detail view"); }}
        />
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
    <div onClick={function() { if (props.onOpen) props.onOpen(flag); }}
      style={Object.assign({}, card, { marginBottom: 10, padding: 16, cursor: "pointer", transition: "border-color 120ms" })}
      onMouseEnter={function(e) { e.currentTarget.style.borderColor = "#7B2FFF55"; }}
      onMouseLeave={function(e) { e.currentTarget.style.borderColor = "#1E2028"; }}>
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
                    <a href={"https://cpr.repairq.io/ticket/" + td.ticket_number} target="_blank" rel="noopener noreferrer" onClick={function(e) { e.stopPropagation(); }} style={{ color: "#00D4FF", textDecoration: "none", fontWeight: 700 }}>#{td.ticket_number}</a>
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
                return <span key={tn}>{i > 0 ? ", " : ""}<a href={"https://cpr.repairq.io/ticket/" + tn} target="_blank" rel="noopener noreferrer" onClick={function(e) { e.stopPropagation(); }} style={{ color: "#00D4FF", textDecoration: "none" }}>#{tn}</a></span>;
              })}
            </div>
          ) : null}

          {ev.attribution_note && (
            <div style={{ fontSize: 9, color: "#6B6F78", marginTop: 6, fontStyle: "italic" }}>{ev.attribution_note}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
          <button onClick={function(e) { e.stopPropagation(); props.onCoach(flag); }}
            style={Object.assign({}, btnBase, { background: "linear-gradient(135deg, #7B2FFF, #FF2D95)", border: "none", color: "#fff", whiteSpace: "nowrap" })}>
            {flag.flag_type === "win" ? "Recognize" : "Coach"}
          </button>
          <button onClick={function(e) { e.stopPropagation(); props.onDismiss(flag); }} style={btnBase}>Dismiss</button>
          <div style={{ fontSize: 9, color: "#6B6F78", textAlign: "center", marginTop: 2 }}>Click for details</div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// DetailModal — full-screen flag detail with rule-specific evidence views
// ─────────────────────────────────────────────────────────────────
function DetailModal(props) {
  var flag = props.flag;
  var ev = flag.evidence || {};
  var store = STORES[flag.store];
  var sevColor = flag.severity >= 5 ? "#F87171" : flag.severity >= 4 ? "#FB923C" : flag.severity >= 3 ? "#FBBF24" : "#8B8F98";
  var isWin = flag.flag_type === "win";
  var typeColor = isWin ? "#4ADE80" : flag.flag_type === "opportunity" ? "#FBBF24" : "#F87171";
  var typeLabel = isWin ? "Recognize" : flag.flag_type === "opportunity" ? "Active Now" : "Needs Attention";

  function fmtDate(s) {
    if (!s) return "";
    try { return new Date(s).toLocaleDateString([], { month: "short", day: "numeric" }); } catch(e) { return s; }
  }
  function fmtDateTime(s) {
    if (!s) return "";
    try { return new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch(e) { return s; }
  }

  return (
    <div onClick={props.onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div onClick={function(e) { e.stopPropagation(); }}
        style={{ background: "#0F1117", borderRadius: 12, maxWidth: 760, width: "100%", border: "1px solid #2A2D36", overflow: "hidden", maxHeight: "92vh", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #1E2028", borderTop: "3px solid " + typeColor }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 9, color: typeColor, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 4, background: typeColor + "22" }}>{typeLabel}</span>
            <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: sevColor }} />
            <span style={{ fontSize: 10, color: "#8B8F98", textTransform: "uppercase", letterSpacing: "0.05em" }}>severity {flag.severity || 3}/5</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "#6B6F78" }}>Detected {fmtDateTime(flag.created_at)}</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#F0F1F3", marginBottom: 4 }}>{flag.employee_name}</div>
          {store && <div style={{ fontSize: 12, color: store.color, fontWeight: 600, marginBottom: 10 }}>{store.name}</div>}
          <div style={{ fontSize: 14, color: "#F0F1F3", lineHeight: 1.5 }}>{flag.headline}</div>
        </div>

        {/* Body — rule-specific evidence */}
        <div style={{ padding: 24, flex: 1, overflowY: "auto" }}>

          {/* Metric snapshot — common to all rules */}
          {(flag.metric_current != null || flag.metric_baseline != null) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 24 }}>
              <Stat label={flag.metric_label || "Current"} value={flag.metric_current != null ? flag.metric_current : "\u2014"} color="#F0F1F3" />
              <Stat label="Baseline" value={flag.metric_baseline != null && flag.metric_baseline > 0 ? flag.metric_baseline : "\u2014"} color="#8B8F98" />
              {flag.delta != null && <Stat label="Delta" value={(flag.delta > 0 ? "+" : "") + flag.delta} color={flag.delta < 0 ? "#F87171" : "#4ADE80"} />}
            </div>
          )}

          {/* ─── UNIVERSAL: Trend sparkline (4-week) ─── */}
          {ev.sparkline && ev.sparkline.data && ev.sparkline.data.length > 0 && (
            <Section title={"Trend \u2014 " + (ev.sparkline.metric_label || "")}>
              <Sparkline data={ev.sparkline.data} unit={ev.sparkline.unit || ""} lowerIsBetter={!!ev.sparkline.lower_is_better} highlightLast={true} />
            </Section>
          )}

          {/* ─── UNIVERSAL: Peer comparison ─── */}
          {ev.peer_compare && ev.peer_compare.employee_value != null && (
            <Section title="Peer Context">
              <PeerCompare data={ev.peer_compare} employeeName={flag.employee_name} storeName={store ? store.name.replace("CPR ", "") : "store"} />
            </Section>
          )}

          {/* ─── UNIVERSAL: Dollar stake (only when projection is meaningful) ─── */}
          {ev.dollar_stake && (ev.dollar_stake.tier_changed || ev.dollar_stake.delta_per_month > 0) && (
            <Section title={flag.flag_type === "win" ? "What This Tier Is Worth" : "What's At Stake"}>
              <DollarStake stake={ev.dollar_stake} employeeName={flag.employee_name} isWin={flag.flag_type === "win"} />
            </Section>
          )}

          {/* ─── Rule-specific evidence renders ─── */}

          {/* notes_streak: per-ticket gaps */}
          {flag.rule_key === "notes_streak" && (
            <div>
              {ev.top_gaps && ev.top_gaps.length > 0 && (
                <Section title="What's Missing">
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {ev.all_gaps && ev.all_gaps.length > 0 ? ev.all_gaps.map(function(g) {
                      return (
                        <div key={g.gap} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#FB923C12", borderLeft: "3px solid #FB923C", borderRadius: 4 }}>
                          <span style={{ color: "#F0F1F3", fontSize: 12 }}>{g.gap}</span>
                          <span style={{ color: "#FB923C", fontSize: 11, fontWeight: 700 }}>{g.count} ticket{g.count === 1 ? "" : "s"}</span>
                        </div>
                      );
                    }) : ev.top_gaps.map(function(g) {
                      return <div key={g} style={{ padding: "8px 12px", background: "#FB923C12", borderLeft: "3px solid #FB923C", borderRadius: 4, color: "#F0F1F3", fontSize: 12 }}>{g}</div>;
                    })}
                  </div>
                </Section>
              )}
              {ev.ticket_details && ev.ticket_details.length > 0 && (
                <Section title={"Affected Tickets (" + ev.ticket_details.length + ")"}>
                  <Table headers={["Ticket", "Notes Score", "What's Missing", "Detail"]}>
                    {ev.ticket_details.map(function(td) {
                      return (
                        <tr key={td.ticket_number}>
                          <Td><TicketLink num={td.ticket_number} /></Td>
                          <Td><ScorePill score={td.notes_score} /></Td>
                          <Td>{td.gaps && td.gaps.length > 0 ? td.gaps.join(", ") : "—"}</Td>
                          <Td muted>{td.detail || "—"}</Td>
                        </tr>
                      );
                    })}
                  </Table>
                </Section>
              )}
              {ev.attribution_note && (
                <div style={{ marginTop: 16, padding: 12, background: "#7B2FFF11", borderLeft: "3px solid #7B2FFF", borderRadius: 4, fontSize: 11, color: "#8B8F98" }}>
                  <strong style={{ color: "#7B2FFF" }}>Attribution:</strong> {ev.attribution_note}
                </div>
              )}
            </div>
          )}

          {/* compliance_regression: recent ticket sample */}
          {flag.rule_key === "compliance_regression" && (
            <div>
              <Section title="Recent Tickets (last 7 days)">
                {ev.recent_ticket_details && ev.recent_ticket_details.length > 0 ? (
                  <Table headers={["Ticket", "Date", "Overall", "Notes", "Diag", "Pickup"]}>
                    {ev.recent_ticket_details.map(function(td) {
                      return (
                        <tr key={td.ticket_number}>
                          <Td><TicketLink num={td.ticket_number} /></Td>
                          <Td muted>{fmtDate(td.date_closed)}</Td>
                          <Td><ScorePill score={td.overall_score} /></Td>
                          <Td><ScorePill score={td.notes_score} /></Td>
                          <Td><ScorePill score={td.diagnostics_score} /></Td>
                          <Td><ScorePill score={td.categorization_score} /></Td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : <Empty>No ticket detail available</Empty>}
              </Section>
            </div>
          )}

          {/* appt_collapse: per-call breakdown */}
          {flag.rule_key === "appt_collapse" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <Stat label="This Week" value={ev.offers_current + " / " + ev.opps_current_week} sub={"appointment offers"} color="#F87171" />
                <Stat label="Prior Week" value={ev.offers_prior + " / " + ev.opps_prior_week} sub={"appointment offers"} color="#4ADE80" />
              </div>
              <Section title="This Week's Opportunity Calls">
                {ev.call_breakdown && ev.call_breakdown.length > 0 ? (
                  <Table headers={["Date", "Appt Offered?", "Warranty Mentioned?"]}>
                    {ev.call_breakdown.map(function(c, i) {
                      return (
                        <tr key={i}>
                          <Td muted>{fmtDateTime(c.date)}</Td>
                          <Td>{c.offered ? <span style={{ color: "#4ADE80", fontWeight: 700 }}>{"\u2713 Yes"}</span> : <span style={{ color: "#F87171", fontWeight: 700 }}>{"\u2717 No"}</span>}</Td>
                          <Td>{c.warranty_mentioned ? <span style={{ color: "#4ADE80" }}>{"\u2713"}</span> : <span style={{ color: "#6B6F78" }}>{"\u2014"}</span>}</Td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : <Empty>No call detail available</Empty>}
              </Section>
            </div>
          )}

          {/* active_shift_dip: today's calls */}
          {flag.rule_key === "active_shift_dip" && (
            <div>
              <div style={{ padding: "10px 14px", background: "#FBBF2412", borderLeft: "3px solid #FBBF24", borderRadius: 4, marginBottom: 16, fontSize: 12, color: "#F0F1F3" }}>
                {"\u26A1"} <strong style={{ color: "#FBBF24" }}>{flag.employee_name} is on shift right now.</strong> Coach today, while the calls are still happening.
              </div>
              <Section title="Today's Calls So Far">
                {ev.today_calls && ev.today_calls.length > 0 ? (
                  <Table headers={["Time", "Type", "Score", "Appt Offered?", "Warranty?"]}>
                    {ev.today_calls.map(function(c, i) {
                      return (
                        <tr key={i}>
                          <Td muted>{fmtDateTime(c.date)}</Td>
                          <Td>{c.call_type}</Td>
                          <Td><ScorePill score={c.score} /></Td>
                          <Td>{c.appt_offered ? <span style={{ color: "#4ADE80" }}>{"\u2713"}</span> : <span style={{ color: "#F87171" }}>{"\u2717"}</span>}</Td>
                          <Td>{c.warranty_mentioned ? <span style={{ color: "#4ADE80" }}>{"\u2713"}</span> : <span style={{ color: "#6B6F78" }}>{"\u2014"}</span>}</Td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : <Empty>No calls graded yet today</Empty>}
              </Section>
            </div>
          )}

          {/* turnaround_improvement: before/after sample */}
          {flag.rule_key === "turnaround_improvement" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
                <Stat label="Last 14 Days Avg" value={ev.avg_recent_hours + "h"} sub={ev.recent_window_tix + " " + ev.device_category + " tickets"} color="#4ADE80" />
                <Stat label="Prior 14 Days" value={ev.avg_prior_hours + "h"} sub={ev.prior_window_tix + " tickets"} color="#8B8F98" />
                <Stat label="Improvement" value={ev.pct_improvement + "% faster"} color="#4ADE80" />
              </div>
              {ev.sample_recent && ev.sample_recent.length > 0 && (
                <Section title={"\uD83D\uDD25 Fastest Recent " + ev.device_category + " Repairs"}>
                  <Table headers={["Ticket", "Date", "Turnaround"]}>
                    {ev.sample_recent.map(function(t) {
                      return <tr key={t.ticket_number}><Td><TicketLink num={t.ticket_number} /></Td><Td muted>{fmtDate(t.date_closed)}</Td><Td><span style={{ color: "#4ADE80", fontWeight: 700 }}>{t.hours}h</span></Td></tr>;
                    })}
                  </Table>
                </Section>
              )}
              {ev.sample_prior && ev.sample_prior.length > 0 && (
                <Section title="For Comparison: Slower Prior Repairs">
                  <Table headers={["Ticket", "Date", "Turnaround"]}>
                    {ev.sample_prior.map(function(t) {
                      return <tr key={t.ticket_number}><Td><TicketLink num={t.ticket_number} /></Td><Td muted>{fmtDate(t.date_closed)}</Td><Td><span style={{ color: "#FB923C" }}>{t.hours}h</span></Td></tr>;
                    })}
                  </Table>
                </Section>
              )}
            </div>
          )}

          {/* appt_streak: the consecutive calls */}
          {flag.rule_key === "appt_streak" && (
            <div>
              <div style={{ padding: "12px 14px", background: "#4ADE8012", borderLeft: "3px solid #4ADE80", borderRadius: 4, marginBottom: 16, fontSize: 13, color: "#F0F1F3" }}>
                {"\uD83C\uDFAF"} <strong style={{ color: "#4ADE80" }}>{ev.streak_length} calls in a row</strong> with appointment offered. That's the kind of consistency worth calling out.
              </div>
              <Section title="The Streak">
                {ev.streak_calls && ev.streak_calls.length > 0 ? (
                  <Table headers={["#", "Date", "Score", "Warranty Mentioned?"]}>
                    {ev.streak_calls.map(function(c, i) {
                      return (
                        <tr key={i}>
                          <Td><strong style={{ color: "#4ADE80" }}>{i + 1}</strong></Td>
                          <Td muted>{fmtDateTime(c.date)}</Td>
                          <Td><ScorePill score={c.score} /></Td>
                          <Td>{c.warranty_mentioned ? <span style={{ color: "#4ADE80" }}>{"\u2713"}</span> : <span style={{ color: "#6B6F78" }}>{"\u2014"}</span>}</Td>
                        </tr>
                      );
                    })}
                  </Table>
                ) : <Empty>Detail not captured</Empty>}
              </Section>
            </div>
          )}

          {/* notes_excellence: the streak tickets */}
          {flag.rule_key === "notes_excellence" && (
            <div>
              <div style={{ padding: "12px 14px", background: "#4ADE8012", borderLeft: "3px solid #4ADE80", borderRadius: 4, marginBottom: 16, fontSize: 13, color: "#F0F1F3" }}>
                {"\u2728"} <strong style={{ color: "#4ADE80" }}>{ev.streak_length} consecutive tickets</strong> with notes scoring 90+ (avg {ev.avg_streak_score}/100). This is the documentation discipline you want everyone copying.
              </div>
              <Section title="The Streak Tickets">
                {ev.ticket_details && ev.ticket_details.length > 0 ? (
                  <Table headers={["Ticket", "Date", "Device", "Notes Score"]}>
                    {ev.ticket_details.map(function(td) {
                      return <tr key={td.ticket_number}><Td><TicketLink num={td.ticket_number} /></Td><Td muted>{fmtDate(td.date_closed)}</Td><Td muted>{td.device_category || "—"}</Td><Td><ScorePill score={td.notes_score} /></Td></tr>;
                    })}
                  </Table>
                ) : <Empty>Detail not captured</Empty>}
              </Section>
            </div>
          )}

          {/* tier_crossover */}
          {flag.rule_key === "tier_crossover" && (
            <div>
              <div style={{ padding: "16px 18px", background: "linear-gradient(90deg, #4ADE8015, #00D4FF15)", borderRadius: 8, marginBottom: 16, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#8B8F98", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tier Movement · {ev.period}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#F0F1F3", marginTop: 6 }}>
                  {ev.from_tier} {"\u2192"} <span style={{ color: "#4ADE80" }}>{ev.to_tier}</span>
                </div>
                {flag.metric_current != null && (
                  <div style={{ fontSize: 12, color: "#8B8F98", marginTop: 4 }}>
                    Score: {flag.metric_baseline} {"\u2192"} <strong style={{ color: "#F0F1F3" }}>{flag.metric_current}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Fallback for any rules we haven't custom-rendered */}
          {["notes_streak", "compliance_regression", "appt_collapse", "active_shift_dip", "turnaround_improvement", "appt_streak", "notes_excellence", "tier_crossover"].indexOf(flag.rule_key) < 0 && (
            <Section title="Evidence">
              <pre style={{ fontSize: 11, color: "#8B8F98", background: "#12141A", padding: 12, borderRadius: 6, overflow: "auto", maxHeight: 300 }}>{JSON.stringify(ev, null, 2)}</pre>
            </Section>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: 16, borderTop: "1px solid #1E2028", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button onClick={props.onClose} style={btnBase}>Close</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={function() { props.onMark1on1(flag); }} style={Object.assign({}, btnBase, { color: "#FBBF24", borderColor: "#FBBF2455" })}>
              {"\uD83D\uDDD3"} Save for 1:1
            </button>
            <button onClick={function() { props.onDismiss(flag); }} style={btnBase}>Dismiss</button>
            <button onClick={function() { props.onCoach(flag); }}
              style={Object.assign({}, btnBase, { background: "linear-gradient(135deg, #7B2FFF, #FF2D95)", border: "none", color: "#fff", fontWeight: 700 })}>
              {isWin ? "\uD83C\uDF89 Recognize" : "\uD83D\uDCAC Coach"} {"\u2192"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small reusable presentational components for the detail modal ──
function Section(props) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, color: "#8B8F98", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{props.title}</div>
      {props.children}
    </div>
  );
}
function Stat(props) {
  return (
    <div style={{ background: "#12141A", borderRadius: 8, padding: 14, border: "1px solid #1E2028" }}>
      <div style={{ fontSize: 9, color: "#8B8F98", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{props.label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: props.color || "#F0F1F3" }}>{props.value}</div>
      {props.sub && <div style={{ fontSize: 10, color: "#6B6F78", marginTop: 2 }}>{props.sub}</div>}
    </div>
  );
}
function Table(props) {
  return (
    <div style={{ background: "#12141A", borderRadius: 8, overflow: "hidden", border: "1px solid #1E2028" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#0F1117" }}>
            {props.headers.map(function(h, i) {
              return <th key={i} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, color: "#8B8F98", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>;
            })}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}
function Td(props) {
  return <td style={{ padding: "8px 12px", borderTop: "1px solid #1E2028", color: props.muted ? "#8B8F98" : "#F0F1F3" }}>{props.children}</td>;
}
function ScorePill(props) {
  if (props.score == null) return <span style={{ color: "#6B6F78" }}>{"\u2014"}</span>;
  var c = props.score >= 80 ? "#4ADE80" : props.score >= 60 ? "#FBBF24" : props.score >= 40 ? "#FB923C" : "#F87171";
  return <span style={{ color: c, fontWeight: 700 }}>{props.score}</span>;
}
function TicketLink(props) {
  return <a href={"https://cpr.repairq.io/ticket/" + props.num} target="_blank" rel="noopener noreferrer" style={{ color: "#00D4FF", textDecoration: "none", fontWeight: 700 }}>#{props.num}</a>;
}
function Empty(props) {
  return <div style={{ padding: 16, color: "#6B6F78", fontSize: 12, textAlign: "center", background: "#12141A", borderRadius: 6 }}>{props.children}</div>;
}

// ─── Sparkline: 4-week weekly trend chart with last-week highlighted ───
function Sparkline(props) {
  var data = (props.data || []).map(function(d) {
    return { label: d.label, value: d.value, count: d.count };
  });
  var unit = props.unit || "";
  var lowerBetter = !!props.lowerIsBetter;
  // Compute last data point for highlight emphasis
  var lastIdx = data.length - 1;
  var lastVal = data[lastIdx] ? data[lastIdx].value : null;
  var lastValColor = "#7B2FFF";
  if (data.length >= 2 && lastVal != null) {
    var priorIdx = lastIdx - 1; var priorVal = null;
    while (priorIdx >= 0) { if (data[priorIdx].value != null) { priorVal = data[priorIdx].value; break; } priorIdx--; }
    if (priorVal != null) {
      var improving = lowerBetter ? lastVal < priorVal : lastVal > priorVal;
      lastValColor = improving ? "#4ADE80" : "#F87171";
    }
  }
  // recharts doesn't render nulls great; replace with undefined to make Line skip them
  var chartData = data.map(function(d) { return { label: d.label, value: d.value, count: d.count }; });
  return (
    <div style={{ background: "#12141A", borderRadius: 8, padding: "16px 12px", border: "1px solid #1E2028" }}>
      <div style={{ width: "100%", height: 110 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 5 }}>
            <YAxis hide={true} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#6B6F78" }} axisLine={{ stroke: "#1E2028" }} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "#0F1117", border: "1px solid #2A2D36", borderRadius: 6, fontSize: 11 }}
              labelStyle={{ color: "#8B8F98" }}
              itemStyle={{ color: "#F0F1F3" }}
              formatter={function(v, n, p) { return [v == null ? "no data" : v + unit + (p && p.payload && p.payload.count != null ? " (n=" + p.payload.count + ")" : ""), ""]; }}
            />
            <Line type="monotone" dataKey="value" stroke="#7B2FFF" strokeWidth={2}
              dot={function(d) {
                var isLast = d.index === lastIdx;
                return <circle cx={d.cx} cy={d.cy} r={isLast ? 5 : 3} fill={isLast ? lastValColor : "#7B2FFF"} stroke={isLast ? lastValColor : "none"} strokeWidth={isLast ? 2 : 0} key={"dot-" + d.index} />;
              }}
              connectNulls={true}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Below the chart: explicit current value with arrow trend */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingTop: 6, borderTop: "1px solid #1E2028", fontSize: 11, color: "#8B8F98" }}>
        <span>This week: <strong style={{ color: lastValColor, fontSize: 13 }}>{lastVal != null ? lastVal + unit : "no data"}</strong></span>
        {data.length >= 2 && data[0] && data[0].value != null && lastVal != null && (
          <span>4-week change: <strong style={{ color: lastValColor }}>
            {(function() {
              var first = data[0].value; var diff = lastVal - first;
              var direction = (lowerBetter ? diff < 0 : diff > 0) ? "\u2197" : (lowerBetter ? diff > 0 : diff < 0) ? "\u2198" : "\u2192";
              return direction + " " + (diff > 0 ? "+" : "") + Math.round(diff * 10) / 10 + unit;
            })()}
          </strong></span>
        )}
      </div>
    </div>
  );
}

// ─── PeerCompare: single-row callout with employee vs store-avg vs role-avg ───
function PeerCompare(props) {
  var d = props.data || {};
  var lowerBetter = !!d.lower_is_better;
  var unit = d.unit || "";
  var empVal = d.employee_value;
  var storeVal = d.store_avg;
  var roleVal = d.role_avg;
  // Color the employee value based on whether it's outperforming or underperforming peers
  var compareTarget = storeVal != null ? storeVal : roleVal;
  var empColor = "#F0F1F3";
  if (compareTarget != null && empVal != null) {
    var better = lowerBetter ? empVal < compareTarget : empVal > compareTarget;
    var equal = Math.abs(empVal - compareTarget) < (lowerBetter ? 0.5 : 3);
    empColor = equal ? "#FBBF24" : (better ? "#4ADE80" : "#F87171");
  }
  return (
    <div style={{ background: "#12141A", borderRadius: 8, padding: 14, border: "1px solid #1E2028" }}>
      <div style={{ fontSize: 10, color: "#6B6F78", marginBottom: 10 }}>{d.metric_label || "Comparison"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <PeerCell label={props.employeeName} value={empVal} unit={unit} color={empColor} bold={true} />
        <PeerCell label={props.storeName + " avg"} value={storeVal} unit={unit} color="#8B8F98" />
        <PeerCell label={(d.role_label || "All techs") + " avg"} value={roleVal} unit={unit} color="#8B8F98" />
      </div>
      {compareTarget != null && empVal != null && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1E2028", fontSize: 11, color: "#8B8F98", textAlign: "center" }}>
          {(function() {
            var diff = empVal - compareTarget;
            var absDiff = Math.abs(Math.round(diff * 10) / 10);
            if (absDiff < (lowerBetter ? 0.5 : 3)) return "On par with peers";
            var better = lowerBetter ? diff < 0 : diff > 0;
            return better
              ? <span><strong style={{ color: "#4ADE80" }}>{absDiff + unit} {lowerBetter ? "faster" : "above"}</strong> peer average</span>
              : <span><strong style={{ color: "#F87171" }}>{absDiff + unit} {lowerBetter ? "slower" : "below"}</strong> peer average</span>;
          })()}
        </div>
      )}
    </div>
  );
}
function PeerCell(props) {
  return (
    <div style={{ textAlign: "center", padding: "8px 4px" }}>
      <div style={{ fontSize: 9, color: "#6B6F78", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.label}</div>
      <div style={{ fontSize: props.bold ? 22 : 18, fontWeight: props.bold ? 800 : 600, color: props.color || "#F0F1F3" }}>
        {props.value != null ? props.value + (props.unit || "") : "\u2014"}
      </div>
    </div>
  );
}

// ─── DollarStake: shows tier impact + monthly $ delta ───
function DollarStake(props) {
  var s = props.stake || {};
  var isWin = !!props.isWin;
  var tierColors = { "Bronze": "#CD7F32", "Silver": "#C0C0C0", "Gold": "#FBBF24", "Platinum": "#00D4FF", "Diamond": "#FF2D95" };
  var fromColor = tierColors[s.current_tier] || "#8B8F98";
  var toColor = tierColors[s.projected_tier] || "#8B8F98";
  var delta = s.delta_per_month || 0;
  return (
    <div style={{ background: "linear-gradient(135deg, #7B2FFF11, #FF2D9511)", borderRadius: 8, padding: 16, border: "1px solid #7B2FFF33" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: "#8B8F98", marginBottom: 6 }}>
            {isWin
              ? "By staying at this level, " + props.employeeName + " keeps:"
              : "If " + props.employeeName + " makes the change suggested above, projected impact:"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: fromColor }}>{s.current_tier || "?"}</span>
            <span style={{ fontSize: 16, color: "#6B6F78" }}>{"\u2192"}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: toColor }}>{s.projected_tier || "?"}</span>
            <span style={{ fontSize: 11, color: "#6B6F78" }}>({s.current_overall} {"\u2192"} {s.projected_overall} pts)</span>
          </div>
          {s.lift_source && (
            <div style={{ fontSize: 10, color: "#6B6F78", fontStyle: "italic" }}>{"\u2014"} based on {s.lift_source}</div>
          )}
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 9, color: "#6B6F78", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Per Month</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: delta > 0 ? "#4ADE80" : "#8B8F98" }}>
            {delta > 0 ? "+$" + delta : "$0"}
          </div>
          <div style={{ fontSize: 10, color: "#6B6F78", marginTop: 2 }}>commission impact</div>
        </div>
      </div>
      {s.diamond_bonus_added && (
        <div style={{ marginTop: 10, padding: "6px 10px", background: "#FF2D9511", borderLeft: "3px solid #FF2D95", borderRadius: 4, fontSize: 11, color: "#FF2D95", fontWeight: 700 }}>
          {"\u2728"} Plus 1 PTO day per month at Diamond tier
        </div>
      )}
    </div>
  );
}

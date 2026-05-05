"use client";
import { useState, useEffect, useMemo } from "react";
import { STORES } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────
// CallQualityTab — Calibration / Observation view for qualitative call grading
//
// Purpose: show the AI-generated tone/clarity/empathy scores alongside the
// existing structural score, so we can sanity-check the AI's grading before
// integrating it into employee scoring.
//
// THIS DOES NOT AFFECT EMPLOYEE SCORECARDS. Read-only view of existing data.
// ─────────────────────────────────────────────────────────────────

var card = { background: "#0F1117", borderRadius: 12, padding: 20, border: "1px solid #1E2028" };
var cardInner = { background: "#12141A", borderRadius: 8, padding: 14 };
var btnBase = { padding: "6px 12px", borderRadius: 6, border: "1px solid #2A2D36", background: "transparent", color: "#F0F1F3", fontSize: 11, fontWeight: 600, cursor: "pointer" };

export default function CallQualityTab() {
  var [audits, setAudits] = useState([]);
  var [loading, setLoading] = useState(true);
  var [error, setError] = useState(null);
  var [storeFilter, setStoreFilter] = useState("all");
  var [employeeFilter, setEmployeeFilter] = useState("all");
  var [showOnlyGraded, setShowOnlyGraded] = useState(true);
  var [expandedId, setExpandedId] = useState(null);
  var [sortField, setSortField] = useState("date_started");
  var [sortDir, setSortDir] = useState("desc");

  useEffect(function() {
    setLoading(true); setError(null);
    // Pull recent audits — 200 should cover several weeks of grading
    fetch("/api/dialpad/audit?limit=200&days=30").then(function(r) { return r.json(); }).then(function(json) {
      if (!json.success) { setError(json.error || "Unknown error"); setLoading(false); return; }
      setAudits(json.audits || []);
      setLoading(false);
    }).catch(function(e) { setError(String(e && e.message || e)); setLoading(false); });
  }, []);

  // Apply filters + sort
  var filteredAudits = useMemo(function() {
    var rows = audits.slice();
    if (storeFilter !== "all") rows = rows.filter(function(a) { return a.store === storeFilter; });
    if (employeeFilter !== "all") rows = rows.filter(function(a) { return a.employee === employeeFilter; });
    if (showOnlyGraded) rows = rows.filter(function(a) { return a.tone_score != null || a.clarity_score != null || a.empathy_score != null; });
    rows.sort(function(a, b) {
      var av = a[sortField], bv = b[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sortField === "date_started") return sortDir === "desc" ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return rows;
  }, [audits, storeFilter, employeeFilter, showOnlyGraded, sortField, sortDir]);

  // Build employee dropdown options from data
  var employeeOptions = useMemo(function() {
    var names = {};
    audits.forEach(function(a) { if (a.employee) names[a.employee] = true; });
    return Object.keys(names).sort();
  }, [audits]);

  // Aggregate stats — only on graded subset
  var stats = useMemo(function() {
    var graded = audits.filter(function(a) { return a.tone_score != null && !a.excluded; });
    if (graded.length === 0) return null;
    function avg(arr, k) { var s = 0, n = 0; arr.forEach(function(r) { if (r[k] != null) { s += r[k]; n++; } }); return n > 0 ? Math.round((s / n) * 10) / 10 : null; }
    function dist(arr, k) {
      var d = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      arr.forEach(function(r) { if (r[k] != null && d[r[k]] != null) d[r[k]] += 1; });
      return d;
    }
    return {
      count: graded.length,
      tone_avg: avg(graded, "tone_score"),
      clarity_avg: avg(graded, "clarity_score"),
      empathy_avg: avg(graded, "empathy_score"),
      tone_dist: dist(graded, "tone_score"),
      clarity_dist: dist(graded, "clarity_score"),
      empathy_dist: dist(graded, "empathy_score"),
    };
  }, [audits]);

  function toggleSort(field) {
    if (sortField === field) setSortDir(sortDir === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  }

  function fmtDate(s) {
    if (!s) return "—";
    try { return new Date(s).toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch(e) { return String(s).substring(0, 10); }
  }

  return (
    <div style={{ padding: 24, color: "#F0F1F3" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{"\uD83C\uDFA7"} Call Quality Insights</div>
          <div style={{ color: "#8B8F98", fontSize: 12, marginTop: 4, maxWidth: 720, lineHeight: 1.5 }}>
            AI-graded tone, clarity, and empathy scores for each call.
            <strong style={{ color: "#FBBF24" }}> Calibration mode</strong> — these scores do NOT affect employee scorecards or tier rankings.
            Use this view to sanity-check the AI's grading against actual recordings before we decide whether to fold them into scoring.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={storeFilter} onChange={function(e) { setStoreFilter(e.target.value); }}
            style={{ padding: "6px 12px", borderRadius: 6, background: "#12141A", color: "#F0F1F3", border: "1px solid #2A2D36", fontSize: 12 }}>
            <option value="all">All Stores</option>
            {Object.keys(STORES).map(function(k) { return <option key={k} value={k}>{STORES[k].name}</option>; })}
          </select>
          <select value={employeeFilter} onChange={function(e) { setEmployeeFilter(e.target.value); }}
            style={{ padding: "6px 12px", borderRadius: 6, background: "#12141A", color: "#F0F1F3", border: "1px solid #2A2D36", fontSize: 12 }}>
            <option value="all">All Employees</option>
            {employeeOptions.map(function(n) { return <option key={n} value={n}>{n}</option>; })}
          </select>
          <button onClick={function() { setShowOnlyGraded(!showOnlyGraded); }}
            style={Object.assign({}, btnBase, showOnlyGraded ? { background: "#7B2FFF22", color: "#7B2FFF", borderColor: "#7B2FFF55" } : {})}>
            {showOnlyGraded ? "\u2713" : "\u00B7"} Graded only
          </button>
        </div>
      </div>

      {error && (
        <div style={Object.assign({}, cardInner, { borderLeft: "3px solid #F87171", marginBottom: 16, color: "#F87171", fontSize: 12 })}>
          {"\u2717"} {error}
        </div>
      )}

      {/* Stats summary — what's the distribution of qualitative scores so far */}
      {stats && stats.count > 0 && (
        <div style={Object.assign({}, card, { marginBottom: 16 })}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{"\uD83D\uDCCA"} Distribution Across {stats.count} Graded Call{stats.count === 1 ? "" : "s"}</div>
              <div style={{ fontSize: 11, color: "#8B8F98", marginTop: 2 }}>
                If everything is clustered at 3 or 4, the AI may be hedging — in that case we tighten the prompt.
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <DimensionCard label="Tone" avg={stats.tone_avg} dist={stats.tone_dist} color="#FF2D95" />
            <DimensionCard label="Clarity" avg={stats.clarity_avg} dist={stats.clarity_dist} color="#00D4FF" />
            <DimensionCard label="Empathy" avg={stats.empathy_avg} dist={stats.empathy_dist} color="#7B2FFF" />
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredAudits.length === 0 && (
        <div style={Object.assign({}, card, { textAlign: "center", padding: 60 })}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>{"\u23F3"}</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>No graded calls yet</div>
          <div style={{ color: "#8B8F98", fontSize: 12, maxWidth: 500, marginLeft: "auto", marginRight: "auto" }}>
            {showOnlyGraded
              ? "No calls in the last 30 days have qualitative grades yet. Once new calls come in via the audit cron with the updated prompt, they'll appear here. You can toggle off \"Graded only\" to see all recent audits."
              : "No calls match the current filter."}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8B8F98", textAlign: "center", padding: 40 }}>Loading audits…</div>
      ) : filteredAudits.length > 0 ? (
        <div style={Object.assign({}, card, { padding: 0, overflow: "hidden" })}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#12141A" }}>
                <Th sortable onClick={function() { toggleSort("date_started"); }} active={sortField === "date_started"} dir={sortDir}>Date</Th>
                <Th>Employee</Th>
                <Th>Store</Th>
                <Th>Call Type</Th>
                <Th align="right" sortable onClick={function() { toggleSort("score"); }} active={sortField === "score"} dir={sortDir}>Score</Th>
                <Th align="right" sortable onClick={function() { toggleSort("tone_score"); }} active={sortField === "tone_score"} dir={sortDir} highlight>Tone</Th>
                <Th align="right" sortable onClick={function() { toggleSort("clarity_score"); }} active={sortField === "clarity_score"} dir={sortDir} highlight>Clarity</Th>
                <Th align="right" sortable onClick={function() { toggleSort("empathy_score"); }} active={sortField === "empathy_score"} dir={sortDir} highlight>Empathy</Th>
                <Th>Qualitative Notes</Th>
              </tr>
            </thead>
            <tbody>
              {filteredAudits.map(function(a) {
                var store = STORES[a.store];
                var expanded = expandedId === a.id;
                return (
                  <>
                    <tr key={a.id} onClick={function() { setExpandedId(expanded ? null : a.id); }}
                      style={{
                        borderTop: "1px solid #1E2028",
                        cursor: "pointer",
                        background: expanded ? "#7B2FFF08" : (a.excluded ? "#F8717108" : "transparent"),
                        opacity: a.excluded ? 0.6 : 1,
                      }}>
                      <Td muted>{fmtDate(a.date_started)}</Td>
                      <Td bold>{a.employee || "Unknown"}</Td>
                      <Td>{store ? <span style={{ color: store.color, fontSize: 11, fontWeight: 600 }}>{store.name.replace("CPR ", "")}</span> : <span style={{ color: "#6B6F78" }}>—</span>}</Td>
                      <Td>
                        {a.call_type === "opportunity" && <Tag color="#00D4FF">Opportunity</Tag>}
                        {a.call_type === "current_customer" && <Tag color="#7B2FFF">Current</Tag>}
                        {a.call_type === "non_scorable" && <Tag color="#6B6F78">Non-scorable</Tag>}
                      </Td>
                      <Td align="right" muted>{a.max_score > 0 ? <span style={{ color: a.score / a.max_score >= 0.75 ? "#4ADE80" : a.score / a.max_score >= 0.5 ? "#FBBF24" : "#F87171", fontWeight: 700 }}>{a.score}/{a.max_score}</span> : "—"}</Td>
                      <Td align="right"><QualitativePill score={a.tone_score} /></Td>
                      <Td align="right"><QualitativePill score={a.clarity_score} /></Td>
                      <Td align="right"><QualitativePill score={a.empathy_score} /></Td>
                      <Td muted style={{ maxWidth: 280 }}>
                        <div style={{ fontSize: 11, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.qualitative_notes || (a.tone_score != null ? "—" : <span style={{ color: "#6B6F78" }}>not graded</span>)}
                        </div>
                      </Td>
                    </tr>
                    {expanded && (
                      <tr key={a.id + "-expand"} style={{ background: "#12141A" }}>
                        <td colSpan={9} style={{ padding: "16px 18px", borderTop: "1px solid #1E2028" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 12 }}>
                            <div>
                              <div style={{ fontSize: 10, color: "#6B6F78", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Inquiry</div>
                              <div style={{ fontSize: 12, color: "#F0F1F3" }}>{a.inquiry || "—"}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: "#6B6F78", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Outcome</div>
                              <div style={{ fontSize: 12, color: "#F0F1F3" }}>{a.outcome || "—"}</div>
                            </div>
                          </div>
                          {a.qualitative_notes && (
                            <div style={Object.assign({}, cardInner, { borderLeft: "3px solid #FF2D95", marginBottom: 12 })}>
                              <div style={{ fontSize: 10, color: "#FF2D95", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Qualitative observation</div>
                              <div style={{ fontSize: 12, color: "#F0F1F3", fontStyle: "italic" }}>"{a.qualitative_notes}"</div>
                            </div>
                          )}
                          {a.transcript_preview && (
                            <div>
                              <div style={{ fontSize: 10, color: "#6B6F78", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Transcript preview</div>
                              <div style={{ fontSize: 11, color: "#8B8F98", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto", padding: 10, background: "#0F1117", borderRadius: 4 }}>
                                {a.transcript_preview}
                              </div>
                            </div>
                          )}
                          {a.confidence != null && (
                            <div style={{ fontSize: 10, color: "#6B6F78", marginTop: 8, fontStyle: "italic" }}>
                              AI confidence: {a.confidence}/100 · {a.confidence_reason || ""}
                            </div>
                          )}
                          {a.excluded && (
                            <div style={{ fontSize: 10, color: "#F87171", marginTop: 4, fontStyle: "italic" }}>
                              Excluded from scoring: {a.exclude_reason || "no reason given"}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Footnote */}
      {filteredAudits.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 10, color: "#6B6F78", textAlign: "center", lineHeight: 1.6 }}>
          <div>{"\u2014"} Click any row to expand and see the qualitative observation, transcript preview, and AI confidence.</div>
          <div>{"\u2014"} Tone / Clarity / Empathy are 1-5 scales. Pre-deployment audits will show as ungraded.</div>
        </div>
      )}
    </div>
  );
}

// ─── Components ───
function Th(props) {
  return (
    <th onClick={props.onClick}
      style={{
        padding: "12px 14px", textAlign: props.align || "left",
        fontSize: 10, color: props.highlight ? "#FF2D95" : (props.active ? "#7B2FFF" : "#8B8F98"),
        fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
        borderBottom: "1px solid #1E2028", cursor: props.sortable ? "pointer" : "default", userSelect: "none",
      }}>
      {props.children}
      {props.active && <span style={{ marginLeft: 4 }}>{props.dir === "desc" ? "\u2193" : "\u2191"}</span>}
    </th>
  );
}
function Td(props) {
  return (
    <td style={Object.assign({
      padding: "10px 14px", textAlign: props.align || "left",
      color: props.muted ? "#8B8F98" : "#F0F1F3", fontWeight: props.bold ? 700 : 400,
    }, props.style || {})}>
      {props.children}
    </td>
  );
}
function Tag(props) {
  return (
    <span style={{
      fontSize: 9, padding: "2px 8px", borderRadius: 10,
      background: props.color + "22", color: props.color,
      fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
    }}>{props.children}</span>
  );
}
function QualitativePill(props) {
  if (props.score == null) return <span style={{ color: "#6B6F78", fontSize: 11 }}>{"\u2014"}</span>;
  var c = props.score >= 5 ? "#4ADE80" : props.score >= 4 ? "#A3E635" : props.score >= 3 ? "#FBBF24" : props.score >= 2 ? "#FB923C" : "#F87171";
  return (
    <span style={{
      display: "inline-block", minWidth: 24, padding: "2px 8px", borderRadius: 10,
      background: c + "22", color: c, fontWeight: 800, fontSize: 12, textAlign: "center",
    }}>{props.score}</span>
  );
}
function DimensionCard(props) {
  var dist = props.dist || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  var max = Math.max(dist[1], dist[2], dist[3], dist[4], dist[5], 1);
  return (
    <div style={Object.assign({}, cardInner, { borderTop: "3px solid " + props.color })}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: "#8B8F98", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{props.label}</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: props.color }}>{props.avg != null ? props.avg : "—"}</div>
      </div>
      {/* Distribution bars */}
      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 40 }}>
        {[1, 2, 3, 4, 5].map(function(score) {
          var count = dist[score] || 0;
          var height = max > 0 ? (count / max) * 100 : 0;
          return (
            <div key={score} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <div title={score + ": " + count + " calls"}
                style={{
                  width: "100%", height: Math.max(2, height) + "%",
                  background: props.color, opacity: 0.3 + (score * 0.14),
                  borderRadius: "2px 2px 0 0",
                }} />
              <div style={{ fontSize: 9, color: "#6B6F78" }}>{score}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: "#6B6F78", marginTop: 4, textAlign: "center" }}>
        {dist[1] + dist[2]} low · {dist[3]} neutral · {dist[4] + dist[5]} high
      </div>
    </div>
  );
}

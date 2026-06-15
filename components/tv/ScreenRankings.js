// Rankings screen — store leaderboard + employee category rankings.
// LIGHT THEME: white panels, soft shadows, dark slate text, vivid accents.
// Layout:
//   ┌──────────────────────────┬────────────────────────────────────────┐
//   │  STORE RANKINGS          │  EMPLOYEE RANKINGS (this store)         │
//   │  THIS WEEK               │  Accessory GP | Repairs | Cleanings |   │
//   │  1. Indy   312 calls     │                Ticket Score             │
//   │  2. Fish   245           │  Top 3 employees per category          │
//   │  3. Bloom  201           │  + company #1 footer                    │
//   │                          │                                          │
//   │  THIS MONTH              │                                          │
//   │  1. Indy  1247           │                                          │
//   │  2. Fish  954            │                                          │
//   │  3. Bloom 823            │                                          │
//   └──────────────────────────┴────────────────────────────────────────┘
"use client";

var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];
var STORE_LABELS = { fishers: "Fishers", bloomington: "Bloomington", indianapolis: "Indianapolis" };
var STORE_COLORS = { fishers: "#7B2FFF", bloomington: "#FF2D95", indianapolis: "#D97706" };

// Accent for the "Calls Handled" (audited) card — distinct from the four
// category accents (amber / cyan / green / pink).
var CALLS_COLOR = "#2563EB";

function fmtMoney(n) {
  var v = parseFloat(n || 0);
  return "$" + Math.round(v).toLocaleString();
}

// Returns a Monday-start ISO week start date string (YYYY-MM-DD) for current week
function startOfWeekYMD() {
  var d = new Date();
  var dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  var daysSinceMonday = (dow + 6) % 7; // Sunday → 6, Monday → 0
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function startOfMonthYMD() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
}

// Sum total + answered calls per store across a date range from dailyCalls array
// Returns: { fishers: {total, answered}, bloomington: {...}, indianapolis: {...} }
function sumCalls(dailyCalls, startYMD) {
  var out = {
    fishers: { total: 0, answered: 0 },
    bloomington: { total: 0, answered: 0 },
    indianapolis: { total: 0, answered: 0 },
  };
  if (!dailyCalls) return out;
  dailyCalls.forEach(function(d) {
    if (!d.date) return;
    var ymd = String(d.date).slice(0, 10);
    if (ymd < startYMD) return;
    STORE_KEYS.forEach(function(sk) {
      out[sk].total += d[sk + "_total"] || 0;
      out[sk].answered += d[sk + "_answered"] || 0;
    });
  });
  return out;
}

// Minimum total calls required for a store to be ranked by answer rate.
// Below this threshold, the store is ranked by raw answered count (avoids
// "5 calls, 100% answered" outranking "200 calls, 91% answered").
var MIN_CALLS_FOR_RATE_RANK = 20;

export default function ScreenRankings(props) {
  var store = props.store;
  var storeName = props.storeName;
  var dailyCalls = props.dailyCalls || [];
  var scorecard = props.scorecard || null;

  // ── Store rankings ───────────────────────────────────────────────
  var weekStart = startOfWeekYMD();
  var monthStart = startOfMonthYMD();
  var weekStats = sumCalls(dailyCalls, weekStart);
  var monthStats = sumCalls(dailyCalls, monthStart);

  // Compute rows with rate, then rank by rate.
  // Stores below minimum call threshold get ranked last regardless of rate —
  // prevents "1 call, 100%" outranking real performance.
  var buildRanking = function(stats) {
    var arr = STORE_KEYS.map(function(sk) {
      var s = stats[sk];
      var rate = s.total > 0 ? (s.answered / s.total) * 100 : null;
      var qualified = s.total >= MIN_CALLS_FOR_RATE_RANK;
      return {
        store: sk,
        total: s.total,
        answered: s.answered,
        rate: rate,
        qualified: qualified,
      };
    });
    arr.sort(function(a, b) {
      if (a.qualified && !b.qualified) return -1;
      if (!a.qualified && b.qualified) return 1;
      if (a.qualified && b.qualified) return (b.rate || 0) - (a.rate || 0);
      return (b.total || 0) - (a.total || 0); // both unqualified — sort by volume
    });
    return arr;
  };
  var weekRanked = buildRanking(weekStats);
  var monthRanked = buildRanking(monthStats);

  // ── Employee rankings ─────────────────────────────────────────────
  var empScores = (scorecard && scorecard.employeeScores) || [];

  // ── Calls Handled (audited) — from the call-leaders endpoint ──────
  var callLeaders = props.callLeaders || null;
  var clStore = (callLeaders && callLeaders.byStore && callLeaders.byStore[store]) || { leaders: [], unknown: 0 };
  var clLeaders = clStore.leaders || [];
  var clUnknown = clStore.unknown || 0;
  var clCompanyTop = (callLeaders && callLeaders.companyTop) || null;

  // Filter to this store
  var thisStoreEmps = empScores.filter(function(e) { return e.store === store; });

  // Build per-category rankings — top 3 this store + #1 company-wide
  var categories = [
    { key: "accy_gp", label: "Accessory GP", color: "#D97706", icon: "💰", fmt: fmtMoney, get: function(e) { return (e.repairs && e.repairs.accy_gp) || 0; } },
    { key: "repair_count", label: "Repairs", color: "#0891B2", icon: "🔧", fmt: function(v) { return v.toString(); }, get: function(e) { var r = e.repairs || {}; return (r.phone_tickets || 0) + (r.other_tickets || 0); } },
    { key: "cleanings", label: "Cleanings", color: "#10B981", icon: "✨", fmt: function(v) { return v.toString(); }, get: function(e) { return (e.repairs && e.repairs.clean_count) || 0; } },
    { key: "ticket_score", label: "Ticket Score", color: "#DB2777", icon: "📋", fmt: function(v) { return v.toString(); }, get: function(e) { return (e.compliance && e.compliance.tickets_graded > 0) ? (e.compliance.score || 0) : null; } },
  ];

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "5fr 7fr", gap: "clamp(12px, 2vh, 24px)" }}>
      {/* ─── LEFT: Store rankings (stacked: this week + this month) ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 1.5vh, 16px)", minHeight: 0 }}>
        <StoreRankPanel title="🏪 Stores · This Week" subtitle="Answer rate" ranked={weekRanked} highlightStore={store} />
        <StoreRankPanel title="🏪 Stores · This Month" subtitle="Answer rate" ranked={monthRanked} highlightStore={store} />
      </div>

      {/* ─── RIGHT: Employee rankings (4 categories side by side) ─── */}
      <div style={{
        background: "#FFFFFF",
        borderRadius: 16,
        padding: "clamp(14px, 2.2vh, 24px)",
        border: "1px solid #E5E7EB",
        borderTop: "3px solid #00D4FF",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        minHeight: 0,
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "clamp(10px, 1.8vh, 18px)" }}>
          <div style={{ color: "#1A2233", fontSize: "clamp(18px, 2.8vh, 26px)", fontWeight: 800 }}>
            🏆 {storeName} Employees
          </div>
          <div style={{ color: "#6B7280", fontSize: "clamp(11px, 1.5vh, 13px)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            This Month
          </div>
        </div>

        {thisStoreEmps.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: "clamp(16px, 2.2vh, 22px)", fontStyle: "italic" }}>
            No employee data for this period yet
          </div>
        ) : (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "clamp(8px, 1.2vw, 14px)", overflow: "hidden", minHeight: 0 }}>
            {categories.map(function(cat) {
              // Local ranking — top 3 at this store for this category
              var localRanked = thisStoreEmps
                .map(function(e) { return { name: e.name, value: cat.get(e) }; })
                .filter(function(x) { return x.value !== null && x.value !== undefined; })
                .sort(function(a, b) { return (b.value || 0) - (a.value || 0); });
              // Company #1 across all stores
              var globalRanked = empScores
                .map(function(e) { return { name: e.name, value: cat.get(e), store: e.store }; })
                .filter(function(x) { return x.value !== null && x.value !== undefined; })
                .sort(function(a, b) { return (b.value || 0) - (a.value || 0); });
              var companyTop = globalRanked.length > 0 ? globalRanked[0] : null;
              return (
                <div key={cat.key} style={{ background: "#F9FAFB", borderRadius: 10, padding: "clamp(8px, 1.5vh, 14px)", display: "flex", flexDirection: "column", borderTop: "2px solid " + cat.color, border: "1px solid #E5E7EB", overflow: "hidden", minHeight: 0 }}>
                  {/* Category header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "clamp(6px, 1.2vh, 12px)" }}>
                    <div style={{ fontSize: "clamp(14px, 1.8vh, 18px)" }}>{cat.icon}</div>
                    <div style={{ color: cat.color, fontSize: "clamp(10px, 1.4vh, 13px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{cat.label}</div>
                  </div>

                  {/* Top 3 at this store */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(4px, 1vh, 8px)", minHeight: 0, overflow: "hidden" }}>
                    {[0, 1, 2].map(function(idx) {
                      var emp = localRanked[idx];
                      var medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                      var nameColor = idx === 0 ? "#1A2233" : "#6B7280";
                      var valColor = idx === 0 ? cat.color : "#9CA3AF";
                      return (
                        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontSize: "clamp(14px, 1.8vh, 18px)" }}>{emp ? medal : ""}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "clamp(12px, 1.7vh, 15px)", fontWeight: 700, color: nameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {emp ? emp.name.split(" ")[0] : "—"}
                            </div>
                            <div style={{ fontSize: idx === 0 ? "clamp(16px, 2.5vh, 22px)" : "clamp(12px, 1.8vh, 16px)", fontWeight: 800, color: valColor, fontVariantNumeric: "tabular-nums" }}>
                              {emp ? cat.fmt(emp.value) : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Company #1 footer */}
                  {companyTop && (
                    <div style={{ marginTop: "clamp(8px, 1.4vh, 12px)", paddingTop: "clamp(6px, 1.2vh, 10px)", borderTop: "1px solid #E5E7EB" }}>
                      <div style={{ color: "#9CA3AF", fontSize: "clamp(8px, 1.1vh, 9px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Company #1</div>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                        <div style={{ fontSize: "clamp(11px, 1.5vh, 13px)", fontWeight: 700, color: STORE_COLORS[companyTop.store] || "#1A2233", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {companyTop.name.split(" ")[0]}
                        </div>
                        <div style={{ fontSize: "clamp(11px, 1.6vh, 14px)", fontWeight: 800, color: cat.color, fontVariantNumeric: "tabular-nums" }}>{cat.fmt(companyTop.value)}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* ─── 5th card: Calls Handled (audited) — own data source ─── */}
            <div key="calls_handled" style={{ background: "#F9FAFB", borderRadius: 10, padding: "clamp(8px, 1.5vh, 14px)", display: "flex", flexDirection: "column", borderTop: "2px solid " + CALLS_COLOR, border: "1px solid #E5E7EB", overflow: "hidden", minHeight: 0 }}>
              {/* Category header (single row — keeps medals aligned with siblings) */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "clamp(6px, 1.2vh, 12px)" }}>
                <div style={{ fontSize: "clamp(14px, 1.8vh, 18px)" }}>📞</div>
                <div style={{ color: CALLS_COLOR, fontSize: "clamp(10px, 1.4vh, 13px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  Calls Handled
                </div>
                <div style={{ color: "#9CA3AF", fontSize: "clamp(8px, 1.1vh, 10px)", fontWeight: 600, fontStyle: "italic" }}>audited</div>
              </div>

              {/* Top 3 at this store */}
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(4px, 1vh, 8px)", minHeight: 0, overflow: "hidden" }}>
                {[0, 1, 2].map(function(idx) {
                  var emp = clLeaders[idx];
                  var medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                  var nameColor = idx === 0 ? "#1A2233" : "#6B7280";
                  var valColor = idx === 0 ? CALLS_COLOR : "#9CA3AF";
                  return (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: "clamp(14px, 1.8vh, 18px)" }}>{emp ? medal : ""}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "clamp(12px, 1.7vh, 15px)", fontWeight: 700, color: nameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {emp ? emp.name.split(" ")[0] : "—"}
                        </div>
                        <div style={{ fontSize: idx === 0 ? "clamp(16px, 2.5vh, 22px)" : "clamp(12px, 1.8vh, 16px)", fontWeight: 800, color: valColor, fontVariantNumeric: "tabular-nums" }}>
                          {emp ? emp.calls.toString() : ""}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Unknown coaching flag (Option B) — muted amber nudge, not a ranked row */}
              {clUnknown > 0 && (
                <div style={{ marginTop: "clamp(6px, 1.2vh, 10px)", display: "flex", alignItems: "center", gap: 6, padding: "clamp(5px, 1vh, 8px) clamp(6px, 1vh, 9px)", background: "#FEF3C7", borderRadius: 8 }}>
                  <div style={{ fontSize: "clamp(11px, 1.5vh, 14px)", color: "#B45309" }}>⚠️</div>
                  <div style={{ fontSize: "clamp(9px, 1.3vh, 12px)", fontWeight: 700, color: "#B45309", lineHeight: 1.2 }}>
                    {clUnknown} calls — no name said
                  </div>
                </div>
              )}

              {/* Company #1 footer (matches sibling cards) */}
              {clCompanyTop && (
                <div style={{ marginTop: "clamp(8px, 1.4vh, 12px)", paddingTop: "clamp(6px, 1.2vh, 10px)", borderTop: "1px solid #E5E7EB" }}>
                  <div style={{ color: "#9CA3AF", fontSize: "clamp(8px, 1.1vh, 9px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Company #1</div>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                    <div style={{ fontSize: "clamp(11px, 1.5vh, 13px)", fontWeight: 700, color: STORE_COLORS[clCompanyTop.store] || "#1A2233", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {clCompanyTop.name.split(" ")[0]}
                    </div>
                    <div style={{ fontSize: "clamp(11px, 1.6vh, 14px)", fontWeight: 800, color: CALLS_COLOR, fontVariantNumeric: "tabular-nums" }}>{clCompanyTop.calls.toString()}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Store ranking panel (shared between week + month) ──────────────
function StoreRankPanel(props) {
  return (
    <div style={{
      flex: 1,
      background: "#FFFFFF",
      borderRadius: 16,
      padding: "clamp(14px, 2.2vh, 24px)",
      border: "1px solid #E5E7EB",
      borderTop: "3px solid #7B2FFF",
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      minHeight: 0,
    }}>
      <div style={{ marginBottom: "clamp(8px, 1.5vh, 14px)" }}>
        <div style={{ fontSize: "clamp(16px, 2.4vh, 22px)", fontWeight: 800, color: "#1A2233" }}>{props.title}</div>
        <div style={{ color: "#9CA3AF", fontSize: "clamp(11px, 1.5vh, 13px)", marginTop: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{props.subtitle}</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "clamp(6px, 1.2vh, 10px)", minHeight: 0 }}>
        {props.ranked.map(function(row, idx) {
          var isUs = row.store === props.highlightStore;
          var medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
          var rowBg = isUs ? (STORE_COLORS[row.store] || "#7B2FFF") + "10" : "#F9FAFB";
          var rowBorder = isUs ? "2px solid " + (STORE_COLORS[row.store] || "#7B2FFF") : "1px solid #E5E7EB";
          var nameColor = isUs ? STORE_COLORS[row.store] : (idx === 0 ? "#1A2233" : "#6B7280");
          // Color the rate using the same green/amber/red thresholds as the Daily screen
          var rateColor;
          if (!row.qualified || row.rate === null) rateColor = "#9CA3AF"; // gray for not-enough-data
          else if (row.rate >= 85) rateColor = "#10B981";
          else if (row.rate >= 70) rateColor = "#D97706";
          else rateColor = "#DC2626";
          return (
            <div key={row.store} style={{
              display: "flex", alignItems: "center", gap: "clamp(8px, 1.5vw, 14px)",
              padding: "clamp(8px, 1.5vh, 12px) clamp(10px, 1.5vw, 18px)",
              background: rowBg,
              border: rowBorder,
              borderRadius: 10,
              flex: 1,
              minHeight: 0,
            }}>
              <div style={{ fontSize: "clamp(22px, 4vh, 36px)", flexShrink: 0 }}>{medal}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "clamp(16px, 2.8vh, 26px)", fontWeight: 800, color: nameColor, display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {STORE_LABELS[row.store]}
                  {isUs && <span style={{ background: STORE_COLORS[row.store], color: "#FFFFFF", padding: "3px 9px", borderRadius: 999, fontSize: "clamp(9px, 1.2vh, 11px)", fontWeight: 800, letterSpacing: 1, flexShrink: 0 }}>YOU</span>}
                </div>
                <div style={{ fontSize: "clamp(11px, 1.5vh, 14px)", color: "#9CA3AF", marginTop: 2, fontWeight: 600 }}>
                  {row.answered} of {row.total} answered
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                {row.rate === null || !row.qualified ? (
                  <div>
                    <div style={{ fontSize: "clamp(22px, 4vh, 36px)", fontWeight: 900, color: "#9CA3AF", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>—</div>
                    <div style={{ fontSize: "clamp(9px, 1.2vh, 11px)", color: "#9CA3AF", marginTop: 2, fontWeight: 600 }}>Low volume</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "baseline", gap: 2, justifyContent: "flex-end", lineHeight: 1 }}>
                    <div style={{ fontSize: "clamp(26px, 4.5vh, 42px)", fontWeight: 900, color: rateColor, fontVariantNumeric: "tabular-nums" }}>{Math.round(row.rate)}</div>
                    <div style={{ fontSize: "clamp(14px, 2.2vh, 22px)", fontWeight: 700, color: rateColor }}>%</div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

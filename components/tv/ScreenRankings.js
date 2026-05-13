// Rankings screen — store leaderboard + employee category rankings.
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
var STORE_COLORS = { fishers: "#7B2FFF", bloomington: "#FF2D95", indianapolis: "#FBBF24" };

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

// Sum answered calls per store across a date range from dailyCalls array
function sumAnswered(dailyCalls, startYMD) {
  var out = { fishers: 0, bloomington: 0, indianapolis: 0 };
  if (!dailyCalls) return out;
  dailyCalls.forEach(function(d) {
    if (!d.date) return;
    var ymd = String(d.date).slice(0, 10);
    if (ymd < startYMD) return;
    STORE_KEYS.forEach(function(sk) {
      out[sk] += d[sk + "_answered"] || 0;
    });
  });
  return out;
}

export default function ScreenRankings(props) {
  var store = props.store;
  var storeName = props.storeName;
  var dailyCalls = props.dailyCalls || [];
  var scorecard = props.scorecard || null;

  // ── Store rankings ───────────────────────────────────────────────
  var weekStart = startOfWeekYMD();
  var monthStart = startOfMonthYMD();
  var weekStats = sumAnswered(dailyCalls, weekStart);
  var monthStats = sumAnswered(dailyCalls, monthStart);

  var rankStores = function(stats) {
    var arr = STORE_KEYS.map(function(sk) { return { store: sk, value: stats[sk] }; });
    arr.sort(function(a, b) { return b.value - a.value; });
    return arr;
  };
  var weekRanked = rankStores(weekStats);
  var monthRanked = rankStores(monthStats);

  // ── Employee rankings ─────────────────────────────────────────────
  var empScores = (scorecard && scorecard.employeeScores) || [];

  // Filter to this store
  var thisStoreEmps = empScores.filter(function(e) { return e.store === store; });

  // Build per-category rankings — top 3 this store + #1 company-wide
  var categories = [
    { key: "accy_gp", label: "Accessory GP", color: "#FBBF24", icon: "💰", fmt: fmtMoney, get: function(e) { return (e.repairs && e.repairs.accy_gp) || 0; } },
    { key: "repair_count", label: "Repairs", color: "#00D4FF", icon: "🔧", fmt: function(v) { return v.toString(); }, get: function(e) { var r = e.repairs || {}; return (r.phone_tickets || 0) + (r.other_tickets || 0); } },
    { key: "cleanings", label: "Cleanings", color: "#4ADE80", icon: "✨", fmt: function(v) { return v.toString(); }, get: function(e) { return (e.repairs && e.repairs.clean_count) || 0; } },
    { key: "ticket_score", label: "Ticket Score", color: "#FF2D95", icon: "📋", fmt: function(v) { return v.toString(); }, get: function(e) { return (e.compliance && e.compliance.tickets_graded > 0) ? (e.compliance.score || 0) : null; } },
  ];

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "5fr 7fr", gap: 24 }}>
      {/* ─── LEFT: Store rankings (stacked: this week + this month) ─── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <StoreRankPanel title="🏪 Stores · This Week" subtitle="Calls answered" ranked={weekRanked} highlightStore={store} />
        <StoreRankPanel title="🏪 Stores · This Month" subtitle="Calls answered" ranked={monthRanked} highlightStore={store} />
      </div>

      {/* ─── RIGHT: Employee rankings (4 categories side by side) ─── */}
      <div style={{
        background: "linear-gradient(135deg, #0F1116, #14171E)",
        borderRadius: 16,
        padding: 24,
        border: "1px solid #1E2028",
        borderTop: "3px solid #00D4FF",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ color: "#F0F1F3", fontSize: 26, fontWeight: 800 }}>
            🏆 {storeName} Employees
          </div>
          <div style={{ color: "#8B8F98", fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
            This Month
          </div>
        </div>

        {thisStoreEmps.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6F78", fontSize: 22, fontStyle: "italic" }}>
            No employee data for this period yet
          </div>
        ) : (
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, overflow: "hidden" }}>
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
                <div key={cat.key} style={{ background: "#0A0C10", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", borderTop: "2px solid " + cat.color }}>
                  {/* Category header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 18 }}>{cat.icon}</div>
                    <div style={{ color: cat.color, fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>{cat.label}</div>
                  </div>

                  {/* Top 3 at this store */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    {[0, 1, 2].map(function(idx) {
                      var emp = localRanked[idx];
                      var medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
                      var nameColor = idx === 0 ? "#F0F1F3" : "#8B8F98";
                      var valColor = idx === 0 ? cat.color : "#6B6F78";
                      return (
                        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontSize: 18 }}>{emp ? medal : ""}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: nameColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {emp ? emp.name.split(" ")[0] : "—"}
                            </div>
                            <div style={{ fontSize: idx === 0 ? 22 : 16, fontWeight: 800, color: valColor, fontVariantNumeric: "tabular-nums" }}>
                              {emp ? cat.fmt(emp.value) : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Company #1 footer */}
                  {companyTop && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #1E2028" }}>
                      <div style={{ color: "#6B6F78", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Company #1</div>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: STORE_COLORS[companyTop.store] || "#F0F1F3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {companyTop.name.split(" ")[0]}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: cat.color, fontVariantNumeric: "tabular-nums" }}>{cat.fmt(companyTop.value)}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
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
      background: "linear-gradient(135deg, #0F1116, #14171E)",
      borderRadius: 16,
      padding: 24,
      border: "1px solid #1E2028",
      borderTop: "3px solid #7B2FFF",
      display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#F0F1F3" }}>{props.title}</div>
        <div style={{ color: "#6B6F78", fontSize: 13, marginTop: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{props.subtitle}</div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
        {props.ranked.map(function(row, idx) {
          var isUs = row.store === props.highlightStore;
          var medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉";
          var rowBg = isUs ? (STORE_COLORS[row.store] || "#7B2FFF") + "22" : "#0A0C10";
          var rowBorder = isUs ? "2px solid " + (STORE_COLORS[row.store] || "#7B2FFF") : "1px solid #1E2028";
          var nameColor = isUs ? STORE_COLORS[row.store] : (idx === 0 ? "#F0F1F3" : "#8B8F98");
          return (
            <div key={row.store} style={{
              display: "flex", alignItems: "center", gap: 14,
              padding: "12px 18px",
              background: rowBg,
              border: rowBorder,
              borderRadius: 10,
              flex: 1,
            }}>
              <div style={{ fontSize: 36 }}>{medal}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 26, fontWeight: 800, color: nameColor, display: "flex", alignItems: "center", gap: 10 }}>
                  {STORE_LABELS[row.store]}
                  {isUs && <span style={{ background: STORE_COLORS[row.store], color: "#0A0C10", padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>YOU</span>}
                </div>
              </div>
              <div style={{ fontSize: 42, fontWeight: 900, color: idx === 0 ? "#F0F1F3" : "#8B8F98", fontVariantNumeric: "tabular-nums" }}>{row.value}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

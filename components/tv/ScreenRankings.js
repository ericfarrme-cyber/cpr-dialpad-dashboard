// Daily Dash — big visible KPIs for today.
// Layout (1920x1080 landscape):
//   ┌──────────────────────────┬──────────────────────────┐
//   │  CALLS TODAY (big number) │  ANSWER RATE TODAY (big) │
//   │  [answered] / [missed]    │  [color-coded]           │
//   ├──────────────────────────┼──────────────────────────┤
//   │  NEXT APPOINTMENTS        │  ACTIVE ADVANCED REPAIRS │
//   │  (next 3-4 upcoming)      │  (count + names)         │
//   └──────────────────────────┴──────────────────────────┘
"use client";

function pad2(n) { return n < 10 ? "0" + n : "" + n; }
function todayDateLocalYMD() {
  // Returns YYYY-MM-DD in Indianapolis tz
  var d = new Date();
  var parts = d.toLocaleDateString("en-CA", { timeZone: "America/Indiana/Indianapolis" });
  return parts; // en-CA returns YYYY-MM-DD
}

function fmtTimeRaw(timeStr) {
  // Accepts "14:30" or "14:30:00" or "2:30 PM" — best effort
  if (!timeStr) return "";
  // If already has AM/PM, return as is
  if (/AM|PM/i.test(timeStr)) return timeStr.toUpperCase();
  // Try HH:MM
  var m = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return timeStr;
  var h = parseInt(m[1]);
  var min = m[2];
  var ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h = h - 12;
  return h + ":" + min + " " + ampm;
}

export default function ScreenDaily(props) {
  var store = props.store;
  var storeName = props.storeName;
  var dailyCalls = props.dailyCalls || [];
  var appointments = props.appointments || [];
  var advancedRepairs = props.advancedRepairs || [];

  // ── Today's call stats — find last entry in dailyCalls ─────────────
  var today = dailyCalls.length > 0 ? dailyCalls[dailyCalls.length - 1] : null;
  var totalCalls = 0, answered = 0, missed = 0;
  if (today) {
    totalCalls = today[store + "_total"] || 0;
    answered = today[store + "_answered"] || 0;
    missed = Math.max(0, totalCalls - answered);
  }
  var answerRate = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : null;

  // Color the answer rate
  var rateColor = "#8B8F98";
  if (answerRate !== null) {
    if (answerRate >= 85) rateColor = "#4ADE80";
    else if (answerRate >= 70) rateColor = "#FBBF24";
    else rateColor = "#F87171";
  }

  // ── Next appointments today (filter to upcoming, sorted by time) ───
  var todayY = todayDateLocalYMD();
  var upcomingAppts = appointments
    .filter(function(a) {
      // Only today, only upcoming (no did_arrive set yet, or empty)
      if (!a.date_of_appt) return false;
      var ymd = String(a.date_of_appt).slice(0, 10);
      if (ymd !== todayY) return false;
      // Skip arrived/no-show
      if (a.did_arrive && a.did_arrive.toLowerCase() === "no") return false;
      return true;
    })
    .sort(function(a, b) {
      var ta = a.appt_time || a.time_of_appt || "23:59";
      var tb = b.appt_time || b.time_of_appt || "23:59";
      return String(ta).localeCompare(String(tb));
    })
    .slice(0, 4);

  // ── Open advanced repairs (well, we have leaderboard not list — derive count from store match) ───
  // ScreenDaily gets the leaderboard which has earners. We don't have a direct
  // "open at this store" count here. So we just show top earners as motivation.
  // Top advanced repair earner for THIS store, for motivation:
  var topAdvRepEarner = null;
  // We have leaderboard from /api/advanced-repairs?action=leaderboard which is global.
  // To know who's THIS store specifically requires an additional query — we'll just
  // show the company top earner and how many advanced repairs this month.
  var totalAdvancedRepairsClosedThisMonth = 0;
  advancedRepairs.forEach(function(r) { totalAdvancedRepairsClosedThisMonth += r.repairs || 0; });

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 24 }}>
      {/* ─── TOP LEFT: Calls today ─── */}
      <Panel accent="#00D4FF">
        <PanelLabel color="#00D4FF">📞 Calls Today</PanelLabel>
        <BigNumber value={totalCalls} color="#F0F1F3" />
        <div style={{ display: "flex", gap: 36, marginTop: 20 }}>
          <Stat label="Answered" value={answered} color="#4ADE80" />
          <Stat label="Missed" value={missed} color={missed > 0 ? "#F87171" : "#8B8F98"} />
        </div>
      </Panel>

      {/* ─── TOP RIGHT: Answer Rate ─── */}
      <Panel accent={rateColor}>
        <PanelLabel color={rateColor}>🎯 Answer Rate Today</PanelLabel>
        {answerRate === null ? (
          <div style={{ fontSize: 96, fontWeight: 900, color: "#6B6F78" }}>—</div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ fontSize: 180, fontWeight: 900, color: rateColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{answerRate}</div>
            <div style={{ fontSize: 64, fontWeight: 700, color: rateColor }}>%</div>
          </div>
        )}
        <div style={{ marginTop: 16, fontSize: 18, color: "#8B8F98" }}>
          {answerRate === null ? "Waiting for today's call data..." :
            answerRate >= 85 ? "Crushing it 🔥" :
            answerRate >= 70 ? "Solid — keep pushing" :
            "Pick up the phones! 📞"}
        </div>
      </Panel>

      {/* ─── BOTTOM LEFT: Next Appointments ─── */}
      <Panel accent="#7B2FFF">
        <PanelLabel color="#7B2FFF">📅 Next Up Today</PanelLabel>
        {upcomingAppts.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6F78", fontSize: 24, fontStyle: "italic" }}>
            No more appointments today
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
            {upcomingAppts.map(function(a, i) {
              var t = fmtTimeRaw(a.appt_time || a.time_of_appt);
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 18,
                  padding: "14px 18px",
                  background: i === 0 ? "#7B2FFF18" : "#0F1116",
                  borderLeft: i === 0 ? "4px solid #7B2FFF" : "4px solid #1E2028",
                  borderRadius: 8,
                }}>
                  <div style={{ minWidth: 100, fontSize: 26, fontWeight: 800, color: i === 0 ? "#7B2FFF" : "#F0F1F3", fontVariantNumeric: "tabular-nums" }}>{t}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#F0F1F3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.customer_name || "Walk-in"}</div>
                    <div style={{ fontSize: 16, color: "#8B8F98", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.reason || "Repair appointment"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ─── BOTTOM RIGHT: Advanced Repairs ─── */}
      <Panel accent="#FBBF24">
        <PanelLabel color="#FBBF24">🔧 Advanced Repairs This Month</PanelLabel>
        <BigNumber value={totalAdvancedRepairsClosedThisMonth} color="#F0F1F3" suffix=" closed" />
        {advancedRepairs.length > 0 ? (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 14, color: "#FBBF24", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Top Earner This Month</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#F0F1F3" }}>{advancedRepairs[0].employee}</div>
              <div style={{ fontSize: 18, color: "#8B8F98" }}>{advancedRepairs[0].repairs} repair{advancedRepairs[0].repairs === 1 ? "" : "s"}</div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 20, fontSize: 18, color: "#8B8F98", fontStyle: "italic" }}>
            No closed advanced repairs yet this month — be the first!
          </div>
        )}
      </Panel>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────
function Panel(props) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #0F1116, #14171E)",
      borderRadius: 16,
      padding: 28,
      border: "1px solid #1E2028",
      borderTop: "3px solid " + props.accent,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}>
      {props.children}
    </div>
  );
}

function PanelLabel(props) {
  return (
    <div style={{ color: props.color || "#8B8F98", fontSize: 18, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginBottom: 16 }}>
      {props.children}
    </div>
  );
}

function BigNumber(props) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <div style={{ fontSize: 140, fontWeight: 900, color: props.color || "#F0F1F3", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
      {props.suffix && <div style={{ fontSize: 28, fontWeight: 700, color: "#8B8F98" }}>{props.suffix}</div>}
    </div>
  );
}

function Stat(props) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 600, color: "#8B8F98", textTransform: "uppercase", letterSpacing: 1 }}>{props.label}</div>
      <div style={{ fontSize: 48, fontWeight: 800, color: props.color || "#F0F1F3", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}

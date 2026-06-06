// Daily Dash — big visible KPIs for today.
// LIGHT THEME: white panels, soft shadows, dark slate text, vivid accents.
// Layout (1920x1080 landscape):
//   ┌──────────────────────────┬──────────────────────────┐
//   │  CALLS TODAY (big number) │  ANSWER RATE TODAY (big) │
//   │  [answered] / [missed]    │  [color-coded]           │
//   ├──────────────────────────┼──────────────────────────┤
//   │  NEXT APPOINTMENTS        │  ADVANCED REPAIRS        │
//   │  (next 3-4 upcoming)      │  (count + top earner)    │
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
  var advancedStoreStats = props.advancedStoreStats || null;

  // ── Today's call stats — find last entry in dailyCalls ─────────────
  var today = dailyCalls.length > 0 ? dailyCalls[dailyCalls.length - 1] : null;
  var totalCalls = 0, answered = 0, missed = 0, afterHoursMissed = 0;
  if (today) {
    totalCalls = today[store + "_total"] || 0;
    answered = today[store + "_answered"] || 0;
    missed = Math.max(0, totalCalls - answered);
    afterHoursMissed = today[store + "_after_hours_missed"] || 0;
  }
  var answerRate = totalCalls > 0 ? Math.round((answered / totalCalls) * 100) : null;

  // Color the answer rate — deeper hues for light backgrounds
  var rateColor = "#9CA3AF";
  if (answerRate !== null) {
    if (answerRate >= 85) rateColor = "#10B981";       // emerald — good
    else if (answerRate >= 70) rateColor = "#D97706";  // amber — okay
    else rateColor = "#DC2626";                         // red — bad
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

  // ── Open advanced repairs counts ───────────────────────────────────
  var totalAdvancedRepairsClosedThisMonth = 0;
  advancedRepairs.forEach(function(r) { totalAdvancedRepairsClosedThisMonth += r.repairs || 0; });

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: "clamp(12px, 2vh, 24px)" }}>
      {/* ─── TOP LEFT: Calls today ─── */}
      <Panel accent="#00D4FF">
        <PanelLabel color="#00D4FF">📞 Calls Today</PanelLabel>
        <BigNumber value={totalCalls} color="#1A2233" />
        <div style={{ display: "flex", gap: "clamp(20px, 3vw, 36px)", marginTop: "clamp(10px, 2vh, 20px)" }}>
          <Stat label="Answered" value={answered} color="#10B981" />
          <Stat label="Missed" value={missed} color={missed > 0 ? "#DC2626" : "#9CA3AF"} />
          {afterHoursMissed > 0 ? (
            <Stat label="After-hours" value={afterHoursMissed} color="#9CA3AF" />
          ) : null}
        </div>
      </Panel>

      {/* ─── TOP RIGHT: Answer Rate ─── */}
      <Panel accent={rateColor}>
        <PanelLabel color={rateColor}>🎯 Answer Rate Today</PanelLabel>
        {answerRate === null ? (
          <div style={{ fontSize: "clamp(48px, 10vh, 96px)", fontWeight: 900, color: "#9CA3AF" }}>—</div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, lineHeight: 1 }}>
            <div style={{ fontSize: "clamp(80px, 18vh, 180px)", fontWeight: 900, color: rateColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{answerRate}</div>
            <div style={{ fontSize: "clamp(32px, 6vh, 64px)", fontWeight: 700, color: rateColor }}>%</div>
          </div>
        )}
        <div style={{ marginTop: "clamp(8px, 1.5vh, 16px)", fontSize: "clamp(14px, 1.8vh, 18px)", color: "#6B7280" }}>
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
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: "clamp(16px, 2.5vh, 24px)", fontStyle: "italic" }}>
            No more appointments today
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "clamp(6px, 1.2vh, 14px)", marginTop: "clamp(6px, 1vh, 12px)", overflow: "hidden", flex: 1 }}>
            {upcomingAppts.map(function(a, i) {
              var t = fmtTimeRaw(a.appt_time || a.time_of_appt);
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: "clamp(8px, 1.5vw, 18px)",
                  padding: "clamp(8px, 1.5vh, 14px) clamp(10px, 1.5vw, 18px)",
                  background: i === 0 ? "#7B2FFF10" : "#F4F6FA",
                  borderLeft: i === 0 ? "4px solid #7B2FFF" : "4px solid #E5E7EB",
                  borderRadius: 8,
                  flexShrink: 0,
                }}>
                  <div style={{ minWidth: "clamp(72px, 8vw, 100px)", fontSize: "clamp(16px, 2.6vh, 26px)", fontWeight: 800, color: i === 0 ? "#7B2FFF" : "#1A2233", fontVariantNumeric: "tabular-nums" }}>{t}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "clamp(14px, 2.2vh, 22px)", fontWeight: 700, color: "#1A2233", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.customer_name || "Walk-in"}</div>
                    <div style={{ fontSize: "clamp(12px, 1.7vh, 16px)", color: "#6B7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.reason || "Repair appointment"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ─── BOTTOM RIGHT: Advanced Repairs ─── */}
      <Panel accent="#D97706">
        <PanelLabel color="#D97706">🔧 Advanced Repairs This Month</PanelLabel>
        <div style={{ display: "flex", alignItems: "baseline", gap: "clamp(12px, 2vw, 24px)", flexWrap: "wrap", lineHeight: 1 }}>
          <BigNumber value={totalAdvancedRepairsClosedThisMonth} color="#1A2233" suffix=" closed" />
          {advancedStoreStats && advancedStoreStats.avg_turnaround_days !== null && advancedStoreStats.avg_turnaround_days !== undefined && (
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, color: "#7B2FFF" }}>
              <div style={{ fontSize: "clamp(16px, 2.6vh, 28px)" }}>{"\u23F1"}</div>
              <div style={{ fontSize: "clamp(28px, 5vh, 56px)", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{advancedStoreStats.avg_turnaround_days}</div>
              <div style={{ fontSize: "clamp(12px, 1.8vh, 18px)", fontWeight: 600, color: "#6B7280" }}>day{advancedStoreStats.avg_turnaround_days === 1 ? "" : "s"} avg turnaround</div>
            </div>
          )}
        </div>
        {advancedRepairs.length > 0 ? (
          <div style={{ marginTop: "clamp(8px, 1.5vh, 16px)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: "clamp(11px, 1.5vh, 14px)", color: "#D97706", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>Top Earner This Month</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: "clamp(20px, 3.2vh, 32px)", fontWeight: 800, color: "#1A2233" }}>{advancedRepairs[0].employee}</div>
              <div style={{ fontSize: "clamp(13px, 1.8vh, 18px)", color: "#6B7280" }}>{advancedRepairs[0].repairs} repair{advancedRepairs[0].repairs === 1 ? "" : "s"}</div>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: "clamp(12px, 2vh, 20px)", fontSize: "clamp(14px, 1.8vh, 18px)", color: "#9CA3AF", fontStyle: "italic" }}>
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
      background: "#FFFFFF",
      borderRadius: 16,
      padding: "clamp(16px, 2.5vh, 28px)",
      border: "1px solid #E5E7EB",
      borderTop: "3px solid " + props.accent,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      minHeight: 0, // critical: lets flexbox respect parent height
    }}>
      {props.children}
    </div>
  );
}

function PanelLabel(props) {
  return (
    <div style={{ color: props.color || "#6B7280", fontSize: "clamp(13px, 1.7vh, 18px)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 2, marginBottom: "clamp(8px, 1.5vh, 16px)" }}>
      {props.children}
    </div>
  );
}

function BigNumber(props) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, lineHeight: 1 }}>
      <div style={{ fontSize: "clamp(60px, 14vh, 140px)", fontWeight: 900, color: props.color || "#1A2233", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
      {props.suffix && <div style={{ fontSize: "clamp(16px, 2.6vh, 28px)", fontWeight: 700, color: "#6B7280" }}>{props.suffix}</div>}
    </div>
  );
}

function Stat(props) {
  return (
    <div>
      <div style={{ fontSize: "clamp(12px, 1.5vh, 16px)", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: 1 }}>{props.label}</div>
      <div style={{ fontSize: "clamp(28px, 4.5vh, 48px)", fontWeight: 800, color: props.color || "#1A2233", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{props.value}</div>
    </div>
  );
}

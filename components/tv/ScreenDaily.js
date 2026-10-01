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
  var bonusData = props.bonusData || null;
  // Reviews month-to-date, front and centre (Eric, 2026-09-28). Shows the real
  // state when there is one and says what is missing when there isn't — a
  // zero here would read as "we got no reviews", which is a different claim.
  var reviews = props.reviews || null;
  var revStore = reviews && reviews.stores ? reviews.stores.find(function(s) { return s.store === store; }) : null;
  var revGained = revStore ? revStore.gained_this_month : null;
  var revRating = revStore ? revStore.main_rating : null;
  var revTotal = revStore ? revStore.main_total : null;
  var revWaiting = !reviews ? "Review tracking isn’t reporting"
    : !revStore ? "No listing set up for this store"
    : revTotal === null ? "Never captured — run the sync"
    : revGained === null ? "Counting from next month"
    : null;
  // 15 five-stars a month is the aim Eric has always set.
  var REV_TARGET = 15;

  // ── Month answer-rate bonus for THIS store ─────────────────────────
  // bonusData is calendar-month scoped (separate from today's rate above).
  // Tiers: >=90% $100, >=85% $75, >=80% $50, else $0. Highest tier only.
  var bonusStore = null;
  if (bonusData && bonusData.stores) {
    bonusStore = bonusData.stores.find(function(s) { return s.store === store; }) || null;
  }
  var monthRate = bonusStore && bonusStore.answer_rate !== null && bonusStore.answer_rate !== undefined ? bonusStore.answer_rate : null;
  var monthBonus = bonusStore ? (bonusStore.per_employee_bonus || 0) : 0;
  // Next threshold to chase (for the "X% away from $Y" nudge).
  var bonusTiers = (bonusData && bonusData.tiers) ? bonusData.tiers : [{ min: 90, amount: 100 }, { min: 85, amount: 75 }, { min: 80, amount: 50 }];
  var nextTier = null;
  if (monthRate !== null) {
    // tiers are stored high->low; find the lowest tier still above current rate
    var ascending = bonusTiers.slice().sort(function(a, b) { return a.min - b.min; });
    for (var ti = 0; ti < ascending.length; ti++) {
      if (monthRate < ascending[ti].min) { nextTier = ascending[ti]; break; }
    }
  }

  // ── Today's call stats — match by ACTUAL DATE, not array position ──
  // The last entry of dailyCalls is whatever day most recently synced. After an
  // outage or backfill that can be YESTERDAY — which made the TV show yesterday's
  // totals under "Calls Today". Select the entry whose date IS today
  // (Indianapolis tz); if today hasn't synced yet, show the honest zero/"waiting"
  // state instead of impersonating another day.
  var todayYMD = todayDateLocalYMD();
  var today = null;
  for (var di = dailyCalls.length - 1; di >= 0; di--) {
    if (String(dailyCalls[di].date).slice(0, 10) === todayYMD) { today = dailyCalls[di]; break; }
  }
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
  var todayY = todayYMD;
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

        {/* ── Reviews this month ── */}
        <div style={{ marginTop: "clamp(10px, 2vh, 18px)", paddingTop: "clamp(10px, 1.5vh, 16px)", borderTop: "1px solid #E5E7EB" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: "clamp(11px, 1.4vh, 14px)", color: "#F59E0B", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
              {"⭐ Reviews This Month"}
            </div>
            <div style={{ fontSize: "clamp(11px, 1.4vh, 14px)", color: "#9CA3AF" }}>
              {revRating !== null && revTotal !== null ? revRating + " ★ · " + revTotal + " all time" : ""}
            </div>
          </div>
          {revWaiting ? (
            <div style={{ marginTop: 8, fontSize: "clamp(12px, 1.6vh, 16px)", color: "#9CA3AF" }}>{revWaiting}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
                <div style={{ fontSize: "clamp(34px, 7vh, 64px)", fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: "tabular-nums",
                              color: revGained >= REV_TARGET ? "#10B981" : revGained >= 10 ? "#F59E0B" : "#DC2626" }}>
                  {revGained}
                </div>
                <div style={{ fontSize: "clamp(12px, 1.6vh, 16px)", color: "#6B7280", fontWeight: 600 }}>of {REV_TARGET}</div>
              </div>
              <div style={{ height: 8, borderRadius: 5, background: "#F1F3F6", overflow: "hidden", marginTop: 7 }}>
                <div style={{ height: "100%", borderRadius: 5, transition: "width .8s cubic-bezier(.22,.9,.3,1)",
                              width: Math.min(100, (revGained / REV_TARGET) * 100) + "%",
                              background: revGained >= REV_TARGET ? "#10B981" : revGained >= 10 ? "#F59E0B" : "#DC2626" }} />
              </div>
              <div style={{ marginTop: 6, fontSize: "clamp(12px, 1.6vh, 16px)", color: "#6B7280" }}>
                {revGained >= REV_TARGET ? "Target hit — nice work ⭐"
                  : revGained >= 10 ? (REV_TARGET - revGained) + " more to hit the target"
                  : (10 - revGained) + " more just to clear the floor"}
              </div>
            </>
          )}
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

        {/* ── Monthly answer-rate bonus indicator ── */}
        {bonusStore && (
          <div style={{ marginTop: "clamp(10px, 2vh, 18px)", paddingTop: "clamp(10px, 1.5vh, 16px)", borderTop: "1px solid #E5E7EB" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div style={{ fontSize: "clamp(11px, 1.4vh, 14px)", color: "#7B2FFF", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
                {"\uD83D\uDCB5 This Month's Bonus"}
              </div>
              <div style={{ fontSize: "clamp(11px, 1.4vh, 14px)", color: "#9CA3AF" }}>
                {monthRate !== null ? monthRate.toFixed(0) + "% open-hours rate" : "no data yet"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6, paddingBottom: 4, overflow: "visible" }}>
              <div style={{ fontSize: "clamp(34px, 7vh, 64px)", fontWeight: 900, color: monthBonus > 0 ? "#10B981" : "#9CA3AF", lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
                {"$" + monthBonus}
              </div>
              <div style={{ fontSize: "clamp(12px, 1.6vh, 16px)", color: "#6B7280", fontWeight: 600 }}>/ person</div>
            </div>
            <div style={{ marginTop: 6, fontSize: "clamp(12px, 1.6vh, 16px)", color: "#6B7280" }}>
              {monthBonus === 0 && nextTier
                ? "Hit " + nextTier.min + "% \u2192 $" + nextTier.amount + " each"
                : nextTier
                  ? "Reach " + nextTier.min + "% \u2192 bump to $" + nextTier.amount + " each"
                  : monthBonus > 0
                    ? "Top tier locked in \uD83D\uDD25"
                    : "Hit 80% \u2192 $50 each"}
            </div>
            <BonusTrack rate={monthRate} tiers={bonusTiers} />
          </div>
        )}
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
                  {/* What they were quoted. Matt, 2026-10-01: the panel showed
                      device, repair and turnaround but not the price, which is
                      the one thing the tech needs before the customer walks in.
                      quoted_price is what was actually said; price_quoted is the
                      older free-text field, so fall back to it for hand-typed
                      rows. Silent when neither exists rather than showing $0. */}
                  {(function() {
                    var q = a.quoted_price !== null && a.quoted_price !== undefined && a.quoted_price !== ""
                      ? parseFloat(a.quoted_price)
                      : parseFloat(String(a.price_quoted || "").replace(/[^0-9.]/g, ""));
                    if (!isFinite(q) || q <= 0) return null;
                    var sheet = parseFloat(a.sheet_price);
                    var under = isFinite(sheet) && q < sheet - 0.005;
                    return (
                      <div style={{ textAlign: "right", flexShrink: 0, minWidth: "clamp(78px, 9vw, 120px)" }}>
                        <div style={{ fontSize: "clamp(16px, 2.6vh, 26px)", fontWeight: 800, fontVariantNumeric: "tabular-nums",
                                      color: under ? "#D97706" : "#10B981" }}>
                          {"$" + q.toFixed(2)}
                        </div>
                        {under && (
                          <div style={{ fontSize: "clamp(10px, 1.3vh, 13px)", color: "#D97706", fontWeight: 600 }}>
                            {"−$" + (sheet - q).toFixed(2) + " off"}
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
function BonusTrack(props) {
  var rate = props.rate;
  // Track spans 70%..95% so the 80/85/90 thresholds sit nicely in view.
  var lo = 70, hi = 95;
  var clamp = function(v) { return Math.max(0, Math.min(100, v)); };
  var pct = rate === null || rate === undefined ? 0 : clamp(((rate - lo) / (hi - lo)) * 100);
  var marks = (props.tiers || []).slice().sort(function(a, b) { return a.min - b.min; });
  var fillColor = rate >= 90 ? "#10B981" : rate >= 85 ? "#059669" : rate >= 80 ? "#7B2FFF" : "#9CA3AF";
  return (
    <div style={{ marginTop: "clamp(8px, 1.5vh, 14px)" }}>
      <div style={{ position: "relative", background: "#F0F1F3", borderRadius: 6, height: "clamp(8px, 1.4vh, 12px)", overflow: "hidden" }}>
        <div style={{ width: pct + "%", height: "100%", borderRadius: 6, background: fillColor, transition: "width 0.4s ease" }} />
      </div>
      <div style={{ position: "relative", height: "clamp(16px, 2.2vh, 22px)", marginTop: 2 }}>
        {marks.map(function(m, i) {
          var left = ((m.min - lo) / (hi - lo)) * 100;
          var hit = rate !== null && rate !== undefined && rate >= m.min;
          return (
            <div key={i} style={{ position: "absolute", left: left + "%", transform: "translateX(-50%)", textAlign: "center" }}>
              <div style={{ fontSize: "clamp(9px, 1.2vh, 12px)", fontWeight: 700, color: hit ? "#10B981" : "#9CA3AF", whiteSpace: "nowrap" }}>
                {m.min + "%"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

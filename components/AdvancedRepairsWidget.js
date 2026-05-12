"use client";
import { useState, useEffect } from "react";

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
export default function AdvancedRepairsWidget(props) {
  var store = props.store;
  var employee = props.employee;
  var [leaderboard, setLeaderboard] = useState([]);
  var [openRepairs, setOpenRepairs] = useState([]);
  var [myCommission, setMyCommission] = useState(null);
  var [loading, setLoading] = useState(true);

  useEffect(function() {
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
    if (store) load();
  }, [store, employee]);

  if (!loading && leaderboard.length === 0 && openRepairs.length === 0 && !myCommission) return null;

  var myRank = -1;
  if (employee) {
    for (var i = 0; i < leaderboard.length; i++) {
      if ((leaderboard[i].employee || "").toLowerCase() === employee.toLowerCase()) {
        myRank = i + 1;
        break;
      }
    }
  }
  var topEarner = leaderboard.length > 0 ? leaderboard[0] : null;

  return (
    <div style={{ background: "var(--bg-card)", borderRadius: 14, padding: 20, marginTop: 24, border: "1px solid var(--border)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 20 }}>{"\uD83D\uDD27"}</span>
            <h3 style={{ margin: 0, color: "var(--text-primary)", fontSize: 17, fontWeight: 700 }}>Advanced Repairs</h3>
            <span style={{ background: "#FBBF2422", color: "#FBBF24", padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Bonus Program
            </span>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            Soldering & board-level repairs. 7% GP bonus for everyone, 10% for Duncan. Get trained, get paid.
          </div>
        </div>
      </div>

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
                  <span>Top earner this month: <strong style={{ color: "var(--text-primary)" }}>{topEarner.employee}</strong> ({fmt(topEarner.commission)}). Talk to Duncan about getting trained — these are 7-10% GP bonuses on top of your normal commission.</span>
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
                var isYou = employee && (row.employee || "").toLowerCase() === employee.toLowerCase();
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
                return (
                  <div key={r.id} style={{ padding: "8px 4px", borderTop: idx === 0 ? "none" : "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ background: statusColor + "22", color: statusColor, padding: "2px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>
                        {r.status === "in_transit" ? "Transit" : r.status === "repaired" ? "Done" : "Open"}
                      </span>
                      <div style={{ color: "var(--text-primary)", fontSize: 13, fontWeight: 600, flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {r.device_repair || "—"}
                      </div>
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
    </div>
  );
}

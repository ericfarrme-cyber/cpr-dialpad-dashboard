// Bonus Ledger — what each person is owed, where their streak stands, what has
// been paid. Eric, 2026-10-01: "I don't want to miss payment on somebody's
// streak or miss a PTO day for someone."
//
// Three states, deliberately distinct, and the distinction is the whole point:
//   PAID        a ledger row exists and carries a payment date
//   OWED        a ledger row exists and does not
//   UNRECORDED  no ledger row at all — nobody wrote down whether it was paid
// Answer-rate bonuses have been handed out for months with nothing recording
// it, so showing those as "owed" would invent a debt. They show as unrecorded
// until Eric settles them once, and after that the ledger is the record.
//
// Reads app/api/dialpad/bonuses. Admin and manager can look; only admin can
// mark anything paid (enforced in the route — the UI gate is cosmetic).
"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";

var STORE_COLOR = {
  fishers: "#E03E3E",
  bloomington: "#1A9E8F",
  indianapolis: "#D4A017",
};

// Tier colours. Gold and Platinum are the two that pay, so they are the two
// that read as metal; Silver and Bronze stay recessive on purpose.
var TIER_COLOR = {
  Diamond: "#7DD3FC",
  Platinum: "#E0B0FF",
  Gold: "#FBBF24",
  Silver: "var(--text-secondary)",
  Bronze: "var(--text-muted)",
};

var STATE_META = {
  paid: { label: "Paid", color: "var(--green)" },
  unpaid: { label: "Owed", color: "var(--red)" },
  unrecorded: { label: "Not recorded", color: "var(--orange)" },
  none: { label: "No bonus", color: "var(--text-muted)" },
  // Earned on the numbers, withheld by bonus_eligible. Shown, never hidden -
  // a payable that disappears is how money goes missing in either direction.
  blocked: { label: "Not eligible", color: "var(--text-muted)" },
  // The running month. On pace, not owed, and deliberately not payable:
  // the answer rate keeps moving until the month closes.
  in_progress: { label: "On pace", color: "var(--cyan)" },
};

var PROGRAM_STATUS = {
  ok: { color: "var(--green)", label: "Computed" },
  partial: { color: "var(--yellow)", label: "Partial" },
  no_data: { color: "var(--orange)", label: "No data" },
  not_built: { color: "var(--text-muted)", label: "Not built" },
  // Computed, but nobody reached the bar this year. Different from no data.
  none_earned: { color: "var(--text-muted)", label: "None earned" },
  annual: { color: "var(--cyan)", label: "Annual" },
  error: { color: "var(--red)", label: "Failed" },
};

// Translucency helper. `"var(--red)" + "12"` is NOT a colour — concatenating a
// hex alpha onto a CSS variable produces a string the browser drops silently,
// which is how a tinted card ends up with no tint at all. color-mix works for
// both a literal hex and a var() token.
function tint(c, pct) { return "color-mix(in srgb, " + c + " " + pct + "%, transparent)"; }

function money(n) {
  var v = Number(n) || 0;
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function money0(n) {
  var v = Number(n) || 0;
  return "$" + Math.round(v).toLocaleString();
}
function initials(name) {
  var p = String(name || "").trim().split(/\s+/);
  return ((p[0] || "")[0] || "") + ((p[1] || "")[0] || "");
}
function shortMonth(period) {
  var p = String(period).split("-");
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(p[1], 10) - 1] || p[1];
}

// ── Count-up, reduced-motion aware ──────────────────────────────────────────
function useCountUp(target, ms) {
  var [v, setV] = useState(0);
  var raf = useRef(null);
  useEffect(function() {
    var reduced = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var goal = Number(target) || 0;
    if (reduced) { setV(goal); return; }
    var start = null, from = 0, dur = ms || 650;
    var step = function(t) {
      if (start === null) start = t;
      var k = Math.min(1, (t - start) / dur);
      // easeOutCubic — lands rather than stops
      var e = 1 - Math.pow(1 - k, 3);
      setV(from + (goal - from) * e);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return function() { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, ms]);
  return v;
}

// ── Pieces ──────────────────────────────────────────────────────────────────
function HeroNumber({ label, value, sub, color, pto, emphasis }) {
  var shown = useCountUp(value, 700);
  return (
    <div style={{
      flex: "1 1 200px", minWidth: 190, padding: "18px 20px", borderRadius: 14,
      background: emphasis ? "linear-gradient(135deg, " + tint(color, 11) + ", " + tint(color, 3) + ")" : "var(--bg-card-inner)",
      border: "1px solid " + (emphasis ? tint(color, 33) : "var(--border-light)"),
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ color: "var(--text-muted)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ color: color, fontSize: 32, fontWeight: 800, marginTop: 6, fontVariantNumeric: "tabular-nums", lineHeight: 1.05 }}>
        {money0(shown)}
        {pto > 0 && (
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-body)", marginLeft: 8 }}>
            + {pto} PTO day{pto === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {sub && <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

function TierBadge({ tier, score }) {
  if (!tier) return <span style={{ color: "var(--text-muted)", fontSize: 11 }}>no score this month</span>;
  var c = TIER_COLOR[tier] || "var(--text-muted)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 999,
      background: tint(c, 12), border: "1px solid " + tint(c, 33), color: c, fontSize: 11, fontWeight: 800,
      letterSpacing: "0.03em",
    }}>
      {tier}
      {score != null && <span style={{ color: "var(--text-body)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{score}</span>}
    </span>
  );
}

function monthsBetween(a, b) {
  var pa = String(a).split("-"), pb = String(b).split("-");
  return (parseInt(pb[0], 10) - parseInt(pa[0], 10)) * 12 + (parseInt(pb[1], 10) - parseInt(pa[1], 10));
}

// A pill, preceded by a visible break when the previous month is not the month
// before it. A missing month breaks a streak, so it has to look broken.
function GapAware({ gap, title, style, children }) {
  return (
    <>
      {gap && (
        <div title="no score that month — the streak breaks here" style={{
          width: 10, alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text-faint)", fontSize: 13, fontWeight: 800, letterSpacing: "-1px",
        }}>{"\u22EF"}</div>
      )}
      <div title={title} style={style}>{children}</div>
    </>
  );
}

// The streak rail: one pill per month the person has a score for, oldest left.
// Reading left to right is reading the streak, which is what the award counts.
function StreakRail({ timeline, upTo }) {
  var rows = (timeline || []).slice(-9);
  if (!rows.length) return null;
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end", flexWrap: "nowrap", overflowX: "auto", paddingBottom: 2 }}>
      {rows.map(function(r, i) {
        var c = TIER_COLOR[r.tier] || "var(--text-muted)";
        var isNow = r.period === upTo;
        var pays = r.tier === "Gold" || r.tier === "Platinum" || r.tier === "Diamond";
        var prev = i > 0 ? rows[i - 1] : null;
        var gap = prev && monthsBetween(prev.period, r.period) > 1;
        return (
          <GapAware key={r.period + r.store} gap={gap} title={r.period + " · " + r.store + " · " + r.tier + " " + r.score}
            style={{
              minWidth: 34, textAlign: "center", borderRadius: 7, padding: "5px 4px 4px",
              background: pays ? tint(c, 13) : "var(--bg-card-inner)",
              border: "1px solid " + (isNow ? tint(c, 67) : pays ? tint(c, 27) : "var(--border-light)"),
              animation: "brPill 420ms ease-out both", animationDelay: (i * 45) + "ms",
            }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: "var(--text-muted)", letterSpacing: "0.04em" }}>{shortMonth(r.period)}</div>
            <div style={{ fontSize: 11, fontWeight: 800, color: pays ? c : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{r.score}</div>
          </GapAware>
        );
      })}
    </div>
  );
}

// Progress toward the next award. The meter is three segments because the award
// is three months — a continuous bar would hide where the run actually is.
function RunMeter({ title, prog, color, unit }) {
  var filled = prog.months_into_run === 0 && prog.months > 0 ? 3 : prog.months_into_run;
  var closing = prog.months_to_next === 1;
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 4 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>{title}</span>
        <span style={{ color: color, fontSize: 11, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{prog.months} mo</span>
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        {[0, 1, 2].map(function(i) {
          var on = i < filled;
          return <div key={i} style={{
            height: 6, flex: 1, borderRadius: 3,
            background: on ? color : "var(--border-light)",
            boxShadow: on ? "0 0 6px " + tint(color, 40) : "none",
            transition: "background 400ms ease, box-shadow 400ms ease",
            transitionDelay: (i * 90) + "ms",
          }} />;
        })}
      </div>
      <div style={{ fontSize: 10, marginTop: 5, color: closing ? color : "var(--text-muted)", fontWeight: closing ? 800 : 600 }}>
        {prog.months === 0
          ? "3 months to the first " + unit
          : closing
            ? "★ one more month earns " + unit
            : prog.months_to_next + " more months → " + unit}
        {prog.completed_runs > 0 && (
          <span style={{ color: "var(--text-muted)", fontWeight: 600 }}> · {prog.completed_runs} earned so far</span>
        )}
      </div>
    </div>
  );
}

function StatePill({ state }) {
  var m = STATE_META[state] || STATE_META.none;
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800, whiteSpace: "nowrap",
      color: m.color, background: tint(m.color, 11), border: "1px solid " + tint(m.color, 27),
    }}>{m.label}</span>
  );
}

function ItemRow({ item, canPay, busy, onPay, onUnpay, onRecord }) {
  var amountText = item.plaques > 0
    ? "Wall plaque"
    : item.pto_days > 0
      ? item.pto_days + " PTO day" + (item.pto_days === 1 ? "" : "s")
      : money(item.amount);
  var payable = item.amount > 0 || item.pto_days > 0 || item.plaques > 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 9,
      background: "var(--bg-card-inner)", border: "1px solid var(--border-light)",
      borderLeft: "3px solid " + ((STATE_META[item.state] || STATE_META.none).color),
      flexWrap: "wrap",
    }}>
      <div style={{ flex: "1 1 220px", minWidth: 180 }}>
        <div style={{ color: "var(--text-primary)", fontSize: 12.5, fontWeight: 700 }}>{item.label}</div>
        <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 2 }}>{item.basis}</div>
        {item.paid_at && (
          <div style={{ color: "var(--green)", fontSize: 10, marginTop: 2 }}>paid {String(item.paid_at).slice(0, 10)}</div>
        )}
        {item.would_have_been && (
          <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 2 }}>would have been {item.would_have_been}</div>
        )}
      </div>
      <div style={{ color: item.state === "paid" ? "var(--text-muted)" : "var(--text-primary)", fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 86, textAlign: "right", textDecoration: item.state === "paid" ? "line-through" : "none" }}>
        {payable ? amountText : "—"}
      </div>
      <StatePill state={item.state} />
      {canPay && payable && item.state !== "in_progress" && item.state !== "blocked" && (
        item.state === "paid" ? (
          <button onClick={onUnpay} disabled={busy} style={btn("ghost", busy)}>Undo</button>
        ) : item.state === "unpaid" ? (
          <button onClick={onPay} disabled={busy} style={btn("pay", busy)}>Mark paid</button>
        ) : (
          <button onClick={onRecord} disabled={busy} style={btn("record", busy)}>Record as paid</button>
        )
      )}
    </div>
  );
}

// Per-repair commission and the tier multiplier. Bonus money, but it arrives
// inside the regular paycheck rather than as a separate payment, so it lives in
// its own block that can never be added into the owed figure.
function PaycheckBlock({ pay }) {
  if (!pay || pay.status !== "ok" || !pay.items || !pay.items.length) {
    return (
      <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 2px" }}>
        {pay && pay.status === "error" ? "Commission could not be read for this month." : "No per-repair commission this month."}
      </div>
    );
  }
  return (
    <div style={{ borderRadius: 10, border: "1px solid var(--border-light)", overflow: "hidden", opacity: pay.not_commissioned ? 0.62 : 1 }}>
      <div style={{
        padding: "7px 12px", background: "var(--bg-card-inner)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
      }}>
        <span style={{ color: "var(--text-muted)", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {pay.not_commissioned ? "Work done — not commissioned" : "Already in the paycheck"}
        </span>
        <span style={{ color: pay.not_commissioned ? "var(--text-muted)" : "var(--text-body)", fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {pay.not_commissioned
            ? "salaried" + (pay.would_have_been ? " (" + money(pay.would_have_been) + " if commissioned)" : "")
            : money(pay.total)}
        </span>
      </div>
      <div style={{ display: "grid" }}>
        {pay.items.map(function(it) {
          return (
            <div key={it.key} style={{
              display: "flex", alignItems: "baseline", gap: 10, padding: "6px 12px", flexWrap: "wrap",
              borderTop: "1px solid var(--border-light)",
            }}>
              <span style={{ color: "var(--text-body)", fontSize: 11.5, flex: "1 1 170px" }}>{it.label}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 10.5, flex: "1 1 150px", fontVariantNumeric: "tabular-nums" }}>
                {it.qty_label} {"·"} {it.rate_label}
              </span>
              <span style={{
                color: it.amount > 0 ? "var(--text-primary)" : "var(--text-muted)",
                fontSize: 11.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 70, textAlign: "right",
                textDecoration: pay.not_commissioned ? "line-through" : "none",
              }}>
                {money(pay.not_commissioned ? (it.would_have_been || 0) : it.amount)}
              </span>
              {it.note && !pay.not_commissioned && <div style={{ flexBasis: "100%", color: "var(--orange)", fontSize: 10 }}>{it.note}</div>}
            </div>
          );
        })}
        {!pay.not_commissioned && <div style={{
          display: "flex", alignItems: "baseline", gap: 10, padding: "6px 12px", flexWrap: "wrap",
          borderTop: "1px solid var(--border-light)",
          background: pay.tier_bonus > 0 ? tint(TIER_COLOR[pay.tier] || "var(--text-muted)", 7) : "transparent",
        }}>
          <span style={{ color: "var(--text-body)", fontSize: 11.5, fontWeight: 700, flex: "1 1 170px" }}>Tier multiplier</span>
          <span style={{ color: "var(--text-muted)", fontSize: 10.5, flex: "1 1 150px" }}>
            {pay.tier ? pay.tier + " " + "\u00d7" + pay.multiplier + " on " + money(pay.base) : "no tier this month"}
          </span>
          <span style={{ color: pay.tier_bonus > 0 ? (TIER_COLOR[pay.tier] || "var(--text-primary)") : "var(--text-muted)", fontSize: 11.5, fontWeight: 800, fontVariantNumeric: "tabular-nums", minWidth: 70, textAlign: "right" }}>
            {money(pay.tier_bonus)}
          </span>
        </div>}
      </div>
      {pay.advanced && pay.advanced.items && pay.advanced.items.length > 0 && pay.advanced.items.map(function(it) {
        return (
          <div key={it.key} style={{
            display: "flex", alignItems: "baseline", gap: 10, padding: "6px 12px", flexWrap: "wrap",
            borderTop: "1px solid var(--border-light)", background: tint("var(--cyan)", 6),
          }}>
            <span style={{ color: "var(--text-body)", fontSize: 11.5, flex: "1 1 170px" }}>{it.label}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 10.5, flex: "1 1 150px", fontVariantNumeric: "tabular-nums" }}>
              {it.qty_label} {"·"} {it.rate_label}
            </span>
            <span style={{
              color: "var(--cyan)", fontSize: 11.5, fontWeight: 800, fontVariantNumeric: "tabular-nums",
              minWidth: 70, textAlign: "right",
              textDecoration: pay.not_commissioned ? "line-through" : "none",
            }}>
              {money(pay.not_commissioned ? (it.would_have_been || 0) : it.amount)}
            </span>
          </div>
        );
      })}

      {pay.advanced && pay.advanced.locked === true && pay.advanced.total > 0 && (
        <div style={{ padding: "6px 12px", borderTop: "1px solid var(--border-light)", color: "var(--green)", fontSize: 10.5 }}>
          Advanced-repair commission for this month is locked {"—"} that is this programme{"\u2019"}s record of having been paid.
        </div>
      )}
      {pay.advanced && pay.advanced.locked === false && pay.advanced.total > 0 && (
        <div style={{ padding: "6px 12px", borderTop: "1px solid var(--border-light)", color: "var(--orange)", fontSize: 10.5 }}>
          The month is not locked, so nothing here has been recorded as paid.
        </div>
      )}

      {pay.disagrees_with_snapshot && (
        <div style={{ padding: "7px 12px", borderTop: "1px solid var(--border-light)", background: tint("var(--orange)", 7), color: "var(--orange)", fontSize: 10.5, lineHeight: 1.45 }}>
          The tier snapshot recorded {money(pay.disagrees_with_snapshot.stored)} of base commission for this month;
          these rates give {money(pay.disagrees_with_snapshot.live)}. Something changed since the snapshot ran
          {pay.cleanings_ended ? " (charge-port cleanings stopped paying after August 2026, which the snapshot does not apply)" : ""}.
        </div>
      )}
    </div>
  );
}

function btn(kind, busy) {
  var base = {
    padding: "5px 11px", borderRadius: 7, fontSize: 11, fontWeight: 800, cursor: busy ? "wait" : "pointer",
    fontFamily: "'Space Grotesk',sans-serif", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1,
    transition: "transform 120ms ease, filter 120ms ease",
  };
  if (kind === "pay") return Object.assign(base, { background: "var(--green)", color: "#07210F", border: "1px solid var(--green)" });
  if (kind === "record") return Object.assign(base, { background: "transparent", color: "var(--orange)", border: "1px solid var(--orange)" });
  if (kind === "primary") return Object.assign(base, { background: "var(--purple)", color: "#fff", border: "1px solid var(--purple)" });
  return Object.assign(base, { background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" });
}

// ── Person card ─────────────────────────────────────────────────────────────
function PersonCard({ p, period, index, canPay, onAction, busyKey }) {
  var live = !!p.in_progress_view;
  // Eric, 2026-10-02: the corner is everything owed to this person for the
  // month, commission included. The split sits right under it so it stays
  // obvious which part he hands over and which part rides the paycheck.
  var handOut = p.totals.hand_out_cash != null
    ? p.totals.hand_out_cash
    : p.totals.owed_cash + p.totals.unrecorded_cash + (live ? (p.totals.in_progress_cash || 0) : 0);
  var owes = p.totals.total_to_pay != null ? p.totals.total_to_pay : handOut;
  var owesPto = p.totals.owed_pto + p.totals.unrecorded_pto + (live ? (p.totals.in_progress_pto || 0) : 0);
  var [open, setOpen] = useState(owes > 0 || owesPto > 0);
  var sc = STORE_COLOR[p.store] || "var(--purple)";
  var closing = p.streak.gold.months_to_next === 1 || p.streak.platinum.months_to_next === 1;

  return (
    <div style={{
      background: "var(--bg-card)", borderRadius: 14, border: "1px solid var(--border)",
      borderLeft: "4px solid " + sc, overflow: "hidden",
      animation: "brCard 440ms cubic-bezier(.2,.8,.2,1) both", animationDelay: Math.min(index * 55, 440) + "ms",
    }}>
      <div onClick={function() { setOpen(!open); }} style={{
        display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", cursor: "pointer", flexWrap: "wrap",
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 11, flexShrink: 0,
          background: tint(sc, 13), border: "1px solid " + tint(sc, 33), color: sc,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800, letterSpacing: "0.02em",
        }}>{initials(p.name)}</div>

        <div style={{ flex: "1 1 240px", minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800 }}>{p.name}</span>
            <TierBadge tier={p.tier} score={p.score} />
            {!p.bonus_eligible && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "2px 8px" }}>
                salaried · no per-repair bonus
              </span>
            )}
            {p.off_roster && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--orange)", border: tint("var(--orange)", 40), borderRadius: 999, padding: "2px 8px" }}>
                off roster
              </span>
            )}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>
            <span style={{ textTransform: "capitalize" }}>{p.store || "no store"}</span>
            {p.commission && (p.bonus_eligible
              ? <span>{" · " + money(p.totals.paycheck_total || 0) + " in the paycheck"}</span>
              : <span>{" · salaried — no per-repair commission"}</span>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right", minWidth: 150 }}>
          <div style={{
            fontSize: 21, fontWeight: 800, fontVariantNumeric: "tabular-nums",
            color: owes > 0 || owesPto > 0 ? (live ? "var(--cyan)" : "var(--red)") : "var(--text-muted)",
          }}>
            {money(owes)}
            {owesPto > 0 && <span style={{ fontSize: 13, marginLeft: 6, color: "#E0B0FF" }}>+{owesPto} PTO</span>}
          </div>
          <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 2, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {live ? "on pace this month" : "total for this month"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
            {money(handOut)} handed out {"·"} {money(p.totals.paycheck_total || 0)} commission
          </div>
          {p.totals.paid_cash > 0 && (
            <div style={{ fontSize: 10, color: "var(--green)", marginTop: 2 }}>{money(p.totals.paid_cash)} already marked paid</div>
          )}
        </div>

        <div style={{
          color: "var(--text-muted)", fontSize: 13, transition: "transform 240ms ease",
          transform: open ? "rotate(90deg)" : "none",
        }}>{"▶"}</div>
      </div>

      {/* Streak band — always visible; it is the thing that gets missed. */}
      <div style={{
        display: "flex", gap: 18, alignItems: "flex-start", padding: "0 16px 14px", flexWrap: "wrap",
        background: closing ? "linear-gradient(90deg, transparent, " + (TIER_COLOR[p.tier] || "var(--purple)") + "10)" : "transparent",
      }}>
        <StreakRail timeline={p.timeline} upTo={p.streak.as_of || period} />
        <RunMeter title="Gold run" prog={p.streak.gold} color={TIER_COLOR.Gold} unit="$100" />
        <RunMeter title="Platinum run" prog={p.streak.platinum} color={TIER_COLOR.Platinum} unit="1 PTO day" />
        {p.streak.as_of_is_stale && (
          <div style={{ fontSize: 10, color: "var(--orange)", alignSelf: "center", maxWidth: 200, lineHeight: 1.4 }}>
            Streak quoted as of {p.streak.as_of} {"—"} no tier snapshot for this month yet.
          </div>
        )}
        {p.streak.store_scoped_differs && (
          <div style={{
            flex: "1 1 240px", minWidth: 220, fontSize: 10.5, lineHeight: 1.45, padding: "7px 10px", borderRadius: 8,
            color: "var(--orange)", background: tint("var(--orange)", 7), border: "1px solid " + tint("var(--orange)", 27),
          }}>
            Changed store. Counted as one person the run is <b>{p.streak.gold.months} months</b>; counted
            within {p.store} alone it is <b>{p.streak.gold_months_this_store}</b>. The snapshot route counts
            per store, so a transfer restarts it there. Which one pays is your call.
          </div>
        )}
      </div>

      {/* Items */}
      <div style={{
        display: "grid", gridTemplateRows: open ? "1fr" : "0fr",
        transition: "grid-template-rows 280ms cubic-bezier(.2,.8,.2,1)",
      }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ padding: "0 16px 16px", display: "grid", gap: 7 }}>
            <div style={{ color: "var(--text-muted)", fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 2 }}>
              Handed out separately
            </div>
            {p.items.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 11.5, padding: "4px 2px" }}>
                Nothing from the hand-out programmes this month.
              </div>
            ) : p.items.map(function(it, i) {
              var key = p.name + "|" + it.event_type;
              return <ItemRow key={key + i} item={it} canPay={canPay} busy={busyKey === key}
                onPay={function(e) { e.stopPropagation(); onAction("mark_paid", p, it); }}
                onUnpay={function(e) { e.stopPropagation(); onAction("unmark_paid", p, it); }}
                onRecord={function(e) { e.stopPropagation(); onAction("record_payment", p, it); }} />;
            })}

            <PaycheckBlock pay={p.paycheck} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export default function BonusesTab() {
  var auth = useAuth();
  var af = auth && auth.authFetch ? auth.authFetch : fetch;
  var role = auth && auth.userInfo ? auth.userInfo.role : null;
  var canPay = role === "admin";

  // Local development only. The route accepts `as_admin=1` on its read actions
  // outside production so the screen can be checked against real data without
  // a Google session; `process.env.NODE_ENV` is inlined at build time, so this
  // string is not in the production bundle at all. Writes are never bypassed.
  var DEV = process.env.NODE_ENV !== "production" ? "&as_admin=1" : "";

  var [period, setPeriod] = useState(null);
  var [data, setData] = useState(null);
  var [loading, setLoading] = useState(true);
  var [err, setErr] = useState(null);
  var [busyKey, setBusyKey] = useState(null);
  var [view, setView] = useState("month"); // month | outstanding
  var [out, setOut] = useState(null);
  var [outLoading, setOutLoading] = useState(false);
  var [showNote, setShowNote] = useState(false);
  var [copied, setCopied] = useState(false);
  var [toast, setToast] = useState(null);
  var [settleThrough, setSettleThrough] = useState("");
  var [settling, setSettling] = useState(false);

  var load = function(p) {
    setLoading(true); setErr(null);
    var url = "/api/dialpad/bonuses?action=statement" + (p ? "&period=" + encodeURIComponent(p) : "") + DEV;
    af(url).then(function(r) { return r.json(); }).then(function(j) {
      if (!j.success) { setErr(j.error || "Failed to load"); setLoading(false); return; }
      setData(j);
      setPeriod(j.period);
      setLoading(false);
    }).catch(function(e) { setErr(e.message); setLoading(false); });
  };

  useEffect(function() { load(null); }, []);

  var loadOutstanding = function() {
    setOutLoading(true);
    af("/api/dialpad/bonuses?action=outstanding&months=10" + DEV).then(function(r) { return r.json(); }).then(function(j) {
      setOut(j.success ? j : null);
      if (!j.success) setErr(j.error || "Outstanding view failed");
      setOutLoading(false);
    }).catch(function(e) { setErr(e.message); setOutLoading(false); });
  };

  var act = function(action, person, item, periodOverride) {
    var key = person.name + "|" + item.event_type;
    setBusyKey(key);
    var body;
    if (action === "record_payment") {
      body = {
        action: "record_payment", employee: person.name,
        // The answer-rate bonus is earned where the hours were logged, which is
        // not always the person's roster store. The item knows; prefer it.
        store: item.store || item.assigned_store || person.store, period: periodOverride || period,
        event_type: item.event_type, amount: item.pto_days > 0 ? item.pto_days : item.amount,
        unit: item.unit || "cash",
      };
    } else {
      body = { action: action, ledger_id: item.ledger_id };
    }
    af("/api/dialpad/bonuses", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }).then(function(r) { return r.json(); }).then(function(j) {
      setBusyKey(null);
      if (!j.success) { setToast({ bad: true, text: j.error || "Failed" }); return; }
      setToast({ bad: false, text: action === "unmark_paid" ? "Payment un-marked" : person.name + " · marked paid" });
      load(period);
      if (view === "outstanding") loadOutstanding();
    }).catch(function(e) { setBusyKey(null); setToast({ bad: true, text: e.message }); });
  };

  useEffect(function() {
    if (!toast) return;
    var t = setTimeout(function() { setToast(null); }, 3200);
    return function() { clearTimeout(t); };
  }, [toast]);

  var watch = useMemo(function() {
    if (!data) return [];
    return data.people.filter(function(p) {
      return p.bonus_eligible && p.has_month
        && (p.streak.gold.months_to_next === 1 || p.streak.platinum.months_to_next === 1);
    });
  }, [data]);

  if (loading && !data) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading the bonus ledger{"…"}</div>;
  }
  if (err && !data) {
    return (
      <div style={{ padding: 24, background: tint("var(--red)", 7), border: "1px solid " + tint("var(--red)", 33), borderRadius: 12, color: "var(--red)", fontSize: 13 }}>
        <b>Could not load the bonus ledger.</b><div style={{ marginTop: 6, color: "var(--text-body)" }}>{err}</div>
      </div>
    );
  }

  var t = data.totals;
  var outstandingCash = t.owed_cash + t.unrecorded_cash;
  var outstandingPto = t.owed_pto + t.unrecorded_pto;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <style>{`
        @keyframes brCard { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes brPill { from { opacity: 0; transform: translateY(5px) scale(.94); } to { opacity: 1; transform: none; } }
        @keyframes brGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,.34); } 50% { box-shadow: 0 0 0 7px rgba(251,191,36,0); } }
        @keyframes brToast { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        .br-chip { transition: background 160ms ease, color 160ms ease, border-color 160ms ease; }
        .br-chip:hover { border-color: var(--border-heavy) !important; }
        @media (prefers-reduced-motion: reduce) {
          [style*="brCard"], [style*="brPill"] { animation: none !important; }
        }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, color: "var(--text-primary)", fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em" }}>Bonus Ledger</h2>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4, maxWidth: 700, lineHeight: 1.55 }}>
            Every bonus programme, per person. The figure beside each name is{" "}
            <b style={{ color: "var(--text-body)" }}>everything owed to them for the month</b> {"—"} the bonuses
            you hand over plus the commission that rides their paycheck, split out underneath.
            <br />
            On the hand-out lines, <b style={{ color: "var(--red)" }}>Owed</b> means recorded and unpaid;{" "}
            <b style={{ color: "var(--orange)" }}>Not recorded</b> means nobody wrote down whether it was paid {"—"} not
            that it is unpaid.
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button className="br-chip" onClick={function() { setView("month"); }} style={{
            padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
            fontFamily: "'Space Grotesk',sans-serif",
            background: view === "month" ? "var(--purple)" : "transparent",
            color: view === "month" ? "#fff" : "var(--text-muted)",
            border: "1px solid " + (view === "month" ? "var(--purple)" : "var(--border)"),
          }}>This month</button>
          <button className="br-chip" onClick={function() { setView("outstanding"); if (!out) loadOutstanding(); }} style={{
            padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
            fontFamily: "'Space Grotesk',sans-serif",
            background: view === "outstanding" ? "var(--purple)" : "transparent",
            color: view === "outstanding" ? "#fff" : "var(--text-muted)",
            border: "1px solid " + (view === "outstanding" ? "var(--purple)" : "var(--border)"),
          }}>Everything outstanding</button>
          <button className="br-chip" onClick={function() { setShowNote(!showNote); }} style={btn("ghost", false)}>
            {showNote ? "Hide the note" : "The monthly note"}
          </button>
        </div>
      </div>

      {view === "month" && (
        <>
          {/* Month selector */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {(data.periods_available || []).slice(0, 10).map(function(p) {
              var on = p === period;
              return (
                <button key={p} className="br-chip" onClick={function() { load(p); }} style={{
                  padding: "6px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 800, cursor: "pointer",
                  fontFamily: "'Space Grotesk',sans-serif", fontVariantNumeric: "tabular-nums",
                  background: on ? tint("var(--cyan)", 12) : "transparent",
                  color: on ? "var(--cyan)" : "var(--text-muted)",
                  border: "1px solid " + (on ? tint("var(--cyan)", 40) : "var(--border)"),
                }}>{shortMonth(p)} {p.slice(2, 4)}</button>
              );
            })}
            {data.is_current_month && (
              <span style={{ fontSize: 10.5, color: "var(--orange)", marginLeft: 4 }}>
                {data.period_label} is still running {"—"} these are projections, not payables
              </span>
            )}
          </div>

          {/* Hero */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <HeroNumber
              label={(data.is_current_month ? "On pace · " : "Total to pay · ") + data.period_label}
              value={data.totals.total_to_pay || 0}
              pto={(data.totals.owed_pto || 0) + (data.totals.unrecorded_pto || 0) + (data.is_current_month ? (data.totals.in_progress_pto || 0) : 0)}
              color={data.is_current_month ? "var(--cyan)" : "var(--red)"} emphasis
              sub={(data.is_current_month
                ? "The month is still running, so this is a projection. "
                : "") + money(data.totals.hand_out_cash || 0) + " handed out + " + money(data.totals.paycheck_total || 0) + " commission across the team."} />
            <HeroNumber label="Recorded unpaid" value={t.owed_cash} pto={t.owed_pto} color="var(--red)"
              sub="A ledger row exists and has no payment date" />
            <HeroNumber label="No payment recorded" value={t.unrecorded_cash} pto={t.unrecorded_pto} color="var(--orange)"
              sub="Computed and earned, but nothing says whether it was paid" />
            <HeroNumber label="Marked paid" value={t.paid_cash} pto={t.paid_pto} color="var(--green)"
              sub="Settled in the ledger" />
            <HeroNumber label="Commission" value={t.paycheck_total || 0} color="var(--text-body)"
              sub={"Per-repair " + money(t.paycheck_base || 0) + " + tier multiplier " + money(t.paycheck_tier || 0)
                + (t.paycheck_advanced ? " + advanced repairs " + money(t.paycheck_advanced) : "")} />
          </div>

          {/* Streak watch — the guardrail */}
          {watch.length > 0 && (
            <div style={{
              padding: "14px 16px", borderRadius: 14,
              background: "linear-gradient(135deg, " + TIER_COLOR.Gold + "16, transparent 70%)",
              border: "1px solid " + tint(TIER_COLOR.Gold, 33),
              animation: "brGlow 2.6s ease-in-out 3",
            }}>
              <div style={{ color: TIER_COLOR.Gold, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                One month from an award
              </div>
              <div style={{ display: "grid", gap: 6, marginTop: 9 }}>
                {watch.map(function(p) {
                  return (
                    <div key={p.name} style={{ fontSize: 12.5, color: "var(--text-body)" }}>
                      <b style={{ color: "var(--text-primary)" }}>{p.name}</b>
                      {p.streak.gold.months_to_next === 1 && (
                        <span> {"—"} {p.streak.gold.months} months at Gold or better; one more completes a run and earns <b style={{ color: TIER_COLOR.Gold }}>$100</b></span>
                      )}
                      {p.streak.platinum.months_to_next === 1 && (
                        <span> {"—"} {p.streak.platinum.months} months at Platinum; one more earns <b style={{ color: TIER_COLOR.Platinum }}>a PTO day</b></span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Programs */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(data.programs || []).map(function(pr) {
              var m = PROGRAM_STATUS[pr.status] || PROGRAM_STATUS.ok;
              return (
                <div key={pr.key} style={{
                  flex: "1 1 240px", minWidth: 230, padding: "12px 14px", borderRadius: 11,
                  background: "var(--bg-card)", border: "1px solid var(--border)",
                  borderTop: "3px solid " + m.color,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: "var(--text-primary)", fontSize: 12.5, fontWeight: 800 }}>{pr.label}</span>
                    <span style={{ color: m.color, fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>{m.label}</span>
                  </div>
                  <div style={{ color: "var(--text-muted)", fontSize: 10.5, marginTop: 6, lineHeight: 1.45 }}>{pr.detail}</div>
                </div>
              );
            })}
          </div>

          {/* The note */}
          {showNote && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: "var(--text-primary)", fontSize: 13.5, fontWeight: 800 }}>The monthly note</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>
                    What you owe for {data.period_label}, in one block you can paste anywhere.
                  </div>
                </div>
                <button onClick={function() {
                  try {
                    navigator.clipboard.writeText(data.statement || "");
                    setCopied(true); setTimeout(function() { setCopied(false); }, 1800);
                  } catch (e) { setToast({ bad: true, text: "Clipboard refused — select the text instead" }); }
                }} style={btn(copied ? "pay" : "primary", false)}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <pre style={{
                marginTop: 12, marginBottom: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
                background: "var(--bg-card-inner)", border: "1px solid var(--border-light)", borderRadius: 10,
                padding: 14, color: "var(--text-body)", fontSize: 12, lineHeight: 1.6,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}>{data.statement}</pre>
            </div>
          )}

          {/* People */}
          <div style={{ display: "grid", gap: 10 }}>
            {data.people.map(function(p, i) {
              return <PersonCard key={p.name} p={Object.assign({}, p, { in_progress_view: data.is_current_month })} period={period} index={i} canPay={canPay} busyKey={busyKey}
                onAction={function(a, person, item) { act(a, person, item); }} />;
            })}
          </div>
        </>
      )}

      {view === "outstanding" && (
        <div style={{ display: "grid", gap: 12 }}>
          {outLoading && <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Reading every month{"…"} the answer rate is recomputed per month, so this takes a moment.</div>}
          {!outLoading && out && (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <HeroNumber label="Owed, all months" value={out.totals.owed_cash} pto={out.totals.owed_pto} color="var(--red)" emphasis
                  sub={"Across " + (out.periods_scanned || []).length + " months"} />
                <HeroNumber label="No payment recorded" value={out.totals.unrecorded_cash} pto={out.totals.unrecorded_pto} color="var(--orange)"
                  sub="Earned; nothing says whether it was paid" />
              </div>

              {canPay && out.totals.unrecorded_cash > 0 && (
                <div style={{
                  padding: "13px 15px", borderRadius: 12, background: tint("var(--orange)", 8),
                  border: "1px solid " + tint("var(--orange)", 33),
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                }}>
                  <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                    <div style={{ color: "var(--orange)", fontSize: 12.5, fontWeight: 800 }}>Close the backlog</div>
                    <div style={{ color: "var(--text-body)", fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
                      The answer-rate bonus has never had a payment record, so every month before
                      this one reads as {"“"}not recorded{"”"}. If those were paid at the time,
                      settle them in one go {"—"} they are stamped as a bulk reconciliation, not as
                      individually verified, and anything after the chosen month is untouched.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={settleThrough || ""} onChange={function(e) { setSettleThrough(e.target.value); }} style={{
                      padding: "6px 9px", borderRadius: 7, fontSize: 11.5, fontWeight: 700,
                      background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)",
                      fontFamily: "'Space Grotesk',sans-serif",
                    }}>
                      <option value="">through{"…"}</option>
                      {(out.periods_scanned || []).filter(function(x) { return x < (data ? data.periods_available[0] : "9999"); }).map(function(x) {
                        return <option key={x} value={x}>{x}</option>;
                      })}
                    </select>
                    <button disabled={!settleThrough || settling} onClick={function() {
                      var n = (out.rows || []).filter(function(r) { return r.state === "unrecorded" && r.period <= settleThrough; }).length;
                      if (!window.confirm("Mark " + n + " item" + (n === 1 ? "" : "s") + " through " + settleThrough + " as paid?" + String.fromCharCode(10, 10) + "This writes a payment record for each. It does not move money.")) return;
                      setSettling(true);
                      af("/api/dialpad/bonuses", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "settle_through", period: settleThrough }) })
                        .then(function(r) { return r.json(); }).then(function(j) {
                          setSettling(false);
                          if (!j.success && !j.settled) { setToast({ bad: true, text: j.error || "Failed" }); return; }
                          setToast({ bad: !!j.failed, text: j.settled + " items settled" + (j.failed ? ", " + j.failed + " failed" : "") });
                          loadOutstanding(); load(period);
                        }).catch(function(e) { setSettling(false); setToast({ bad: true, text: e.message }); });
                    }} style={btn("record", settling)}>{settling ? "Settling…" : "Settle"}</button>
                  </div>
                </div>
              )}

              {(out.answer_rate_errors || []).length > 0 && (
                <div style={{ padding: "12px 14px", borderRadius: 11, background: tint("var(--red)", 7), border: "1px solid " + tint("var(--red)", 33), color: "var(--red)", fontSize: 12 }}>
                  <b>Some months could not be computed, so this list may be incomplete:</b>
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--text-body)" }}>
                    {out.answer_rate_errors.map(function(e) { return <li key={e.period}>{e.period}: {e.reason}</li>; })}
                  </ul>
                </div>
              )}

              {(out.by_person || []).length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--green)", fontSize: 13, fontWeight: 700 }}>
                  Nothing outstanding across the last {(out.periods_scanned || []).length} months.
                </div>
              ) : (out.by_person || []).map(function(g, gi) {
                return (
                  <div key={g.employee} style={{
                    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 13,
                    borderLeft: "4px solid " + (STORE_COLOR[g.store] || "var(--purple)"), padding: 14,
                    animation: "brCard 420ms cubic-bezier(.2,.8,.2,1) both", animationDelay: Math.min(gi * 55, 400) + "ms",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 10,
                          background: tint((STORE_COLOR[g.store] || "var(--purple)"), 13),
                          border: "1px solid " + tint((STORE_COLOR[g.store] || "var(--purple)"), 33),
                          color: STORE_COLOR[g.store] || "var(--purple)",
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800,
                        }}>{initials(g.employee)}</div>
                        <div>
                          <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 800 }}>{g.employee}</div>
                          <div style={{ color: "var(--text-muted)", fontSize: 10.5, textTransform: "capitalize" }}>{g.store || "no store"}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "var(--red)", fontVariantNumeric: "tabular-nums" }}>
                          {money(g.owed_cash + g.unrecorded_cash)}
                          {(g.owed_pto + g.unrecorded_pto) > 0 && <span style={{ fontSize: 12, color: "#E0B0FF", marginLeft: 6 }}>+{g.owed_pto + g.unrecorded_pto} PTO</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{g.rows.length} item{g.rows.length === 1 ? "" : "s"}</div>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6, marginTop: 11 }}>
                      {g.rows.map(function(r, ri) {
                        var key = r.employee + "|" + r.event_type;
                        return (
                          <div key={r.period + r.event_type + ri} style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 9,
                            background: "var(--bg-card-inner)", border: "1px solid var(--border-light)",
                            borderLeft: "3px solid " + (STATE_META[r.state] || STATE_META.none).color, flexWrap: "wrap",
                          }}>
                            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--cyan)", minWidth: 62, fontVariantNumeric: "tabular-nums" }}>{r.period}</span>
                            <div style={{ flex: "1 1 200px", minWidth: 170 }}>
                              <div style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 700 }}>{r.label}</div>
                              <div style={{ color: "var(--text-muted)", fontSize: 10 }}>{r.basis}</div>
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", minWidth: 80, textAlign: "right" }}>
                              {r.pto_days > 0 ? r.pto_days + " PTO" : money(r.amount)}
                            </span>
                            <StatePill state={r.state} />
                            {canPay && (
                              <button disabled={busyKey === key} onClick={function() {
                                act(r.state === "unrecorded" ? "record_payment" : "mark_paid",
                                  { name: r.employee, store: r.store },
                                  { event_type: r.event_type, ledger_id: r.ledger_id, amount: r.amount, pto_days: r.pto_days, unit: r.unit, store: r.store },
                                  r.period);
                              }} style={btn(r.state === "unrecorded" ? "record" : "pay", busyKey === key)}>
                                {r.state === "unrecorded" ? "Record as paid" : "Mark paid"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {!canPay && (
        <div style={{ color: "var(--text-muted)", fontSize: 11, textAlign: "center", padding: "4px 0 10px" }}>
          You can read the ledger. Marking a bonus paid is admin-only.
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 60,
          padding: "11px 18px", borderRadius: 11, fontSize: 12.5, fontWeight: 700,
          background: toast.bad ? "var(--red)" : "var(--green)", color: toast.bad ? "#fff" : "#07210F",
          boxShadow: "0 8px 28px rgba(0,0,0,.35)", animation: "brToast 240ms ease-out both",
          maxWidth: "88vw",
        }}>{toast.text}</div>
      )}
    </div>
  );
}

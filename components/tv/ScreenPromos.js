// Promotions screen — what this store is running right now, and what Matt has
// told them.
//
// The fourth screen in the rotation. Two jobs on one board:
//   - the sale, big enough to read from the counter while a customer is on the
//     phone, with the listed price struck through beside it
//   - Matt's messages, which is the thing the other three screens cannot do:
//     every number on them is computed, and sometimes what a shop needs on the
//     wall is a sentence.
//
// LIGHT THEME, matching ScreenDaily / ScreenRankings / ScreenReviews. (The
// mock-up for this screen was drawn dark; the real board is white panels on a
// light ground, and matching the three screens it rotates with matters more
// than matching the mock.)
//
// ⚠ EXPLICIT HEIGHTS, not implicit ones. The Daily Dash spent a fortnight
// clipping ~115px off both of its top panels at 1080p because a hero sized to
// fill a card on its own had things added underneath it (CONTEXT 10as). The
// sale hero here is deliberately sized against the panel it lives in, and the
// message list scrolls nothing — it shows what fits and says how many it did
// not.
"use client";

var STORE_LABELS = { fishers: "Fishers", bloomington: "Bloomington", indianapolis: "Indianapolis" };
var STORE_COLORS = { fishers: "#7B2FFF", bloomington: "#FF2D95", indianapolis: "#D97706" };

var GOLD = "#F59E0B";
var GREEN = "#059669";
var SLATE = "#1E293B";
var MUTED = "#64748B";
var FAINT = "#94A3B8";
var LINE = "#E2E8F0";

var KIND_LABELS = { heads_up: "Heads up", this_week: "This week", reminder: "Reminder", win: "Nice work" };
var KIND_COLORS = { heads_up: "#0EA5E9", this_week: "#7B2FFF", reminder: "#64748B", win: "#059669" };

// How many messages fit without the panel clipping them. Measured against the
// real 1080p board rather than guessed, and the count that did not fit travels
// so a cut list never reads as a complete one.
var MAX_MESSAGES = 3;

function panel(extra) {
  return Object.assign({
    background: "#FFFFFF",
    borderRadius: 18,
    boxShadow: "0 1px 3px rgba(15,23,42,0.08), 0 8px 24px rgba(15,23,42,0.05)",
    padding: "22px 26px",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
  }, extra || {});
}

function Title(props) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 14, flex: "none" }}>
      <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", textTransform: "uppercase", color: props.color || MUTED }}>
        {props.children}
      </span>
      {props.right ? <span style={{ fontSize: 14, color: FAINT, fontWeight: 600 }}>{props.right}</span> : null}
    </div>
  );
}

function Empty(props) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      color: FAINT, fontSize: 18, fontWeight: 600, textAlign: "center", padding: "20px 10px", gap: 8 }}>
      {props.children}
    </div>
  );
}

function money(n) {
  if (n === null || n === undefined) return "—";
  return "$" + Number(n).toFixed(2).replace(/\.00$/, "");
}

function dayLabel(ymd) {
  if (!ymd) return "";
  var d = new Date(ymd + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

export default function ScreenPromos(props) {
  var store = props.store;
  var board = props.promos;
  var accent = STORE_COLORS[store] || "#7B2FFF";

  // Never a confident empty board off a failed fetch. The June 2026 lesson:
  // "nothing running" and "could not read what is running" look identical on a
  // wall unless the screen says which one it is.
  if (!board || !board.success) {
    return (
      <div style={panel({ flex: 1, justifyContent: "center", alignItems: "center" })}>
        <div style={{ fontSize: 26, fontWeight: 700, color: MUTED, textAlign: "center" }}>
          Promotions aren&rsquo;t reporting
        </div>
        <div style={{ fontSize: 16, color: FAINT, marginTop: 10 }}>
          This is not &ldquo;nothing is running&rdquo; — the screen could not read it.
        </div>
      </div>
    );
  }

  var sales = board.sales || [];
  var messages = board.messages || [];
  var lead = sales[0] || null;
  var others = sales.slice(1);
  var shown = messages.slice(0, MAX_MESSAGES);
  var hidden = messages.length - shown.length;

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 20, minHeight: 0 }}>

      {/* ── left: the sale ── */}
      <div style={panel({ borderLeft: "6px solid " + (lead ? GOLD : LINE) })}>
        <Title color={lead ? GOLD : MUTED} right={lead ? (STORE_LABELS[store] || store) + " only" : null}>
          {lead ? "Running now" : "No sale running"}
        </Title>

        {!lead ? (
          <Empty>
            <div>Nothing on sale here today.</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: FAINT }}>Quote the sheet.</div>
          </Empty>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.1, color: SLATE, letterSpacing: "-0.5px" }}>
              {lead.device}
            </div>
            <div style={{ fontSize: 26, fontWeight: 600, color: MUTED, marginTop: 4 }}>
              {lead.repair}{lead.tier ? " · " + lead.tier : ""}
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 18 }}>
              {lead.listed_price !== null && lead.off > 0 ? (
                <span style={{ fontSize: 34, fontWeight: 700, color: FAINT, textDecoration: "line-through",
                  fontVariantNumeric: "tabular-nums" }}>{money(lead.listed_price)}</span>
              ) : null}
              <span style={{ fontSize: 76, fontWeight: 800, color: GOLD, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                {money(lead.sale_price)}
              </span>
            </div>

            <div style={{ fontSize: 20, fontWeight: 600, color: SLATE, marginTop: 10 }}>
              {lead.turnaround ? lead.turnaround : "Standard turnaround"}
              {lead.off > 0 ? <span style={{ color: GREEN, marginLeft: 12 }}>{money(lead.off)} off</span> : null}
            </div>

            <div style={{ height: 1, background: LINE, margin: "18px 0 14px" }} />

            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: MUTED, fontWeight: 700 }}>Ends</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: SLATE, marginTop: 3 }}>{dayLabel(lead.ends_on)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: MUTED, fontWeight: 700 }}>Days left</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: lead.days_left === 0 ? GOLD : SLATE, marginTop: 3 }}>
                  {lead.days_left === null ? "—" : lead.days_left === 0 ? "last day" : lead.days_left}
                </div>
              </div>
              {lead.label ? (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: MUTED, fontWeight: 700 }}>Why</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: SLATE, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {lead.label}
                  </div>
                </div>
              ) : null}
            </div>

            {/* More than one sale on at once: named, never dropped. */}
            {others.length ? (
              <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid " + LINE }}>
                <div style={{ fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: MUTED, fontWeight: 700, marginBottom: 6 }}>
                  Also on
                </div>
                {others.slice(0, 3).map(function(s) {
                  return (
                    <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 17, padding: "3px 0" }}>
                      <span style={{ color: SLATE, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.device + " · " + s.repair}
                      </span>
                      <span style={{ color: GOLD, fontWeight: 800, flex: "none", fontVariantNumeric: "tabular-nums" }}>{money(s.sale_price)}</span>
                    </div>
                  );
                })}
                {others.length > 3 ? (
                  <div style={{ fontSize: 13, color: FAINT, marginTop: 4 }}>
                    and {others.length - 3} more on the Price Book
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: "auto", fontSize: 15, color: FAINT, lineHeight: 1.5 }}>
                Every other repair is the sheet price. The sale is this one line.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── right: Matt's messages ── */}
      <div style={panel()}>
        <Title color={accent} right={messages.length ? messages.length + (messages.length === 1 ? " note" : " notes") : null}>
          From Matt
        </Title>

        {shown.length === 0 ? (
          <Empty>
            <div>Nothing posted.</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: FAINT }}>Messages show here the moment Matt writes one.</div>
          </Empty>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minHeight: 0, overflow: "hidden" }}>
            {shown.map(function(m) {
              var c = KIND_COLORS[m.kind] || MUTED;
              return (
                <div key={m.id} style={{
                  background: "#F8FAFC", borderRadius: 12, borderLeft: "4px solid " + c,
                  padding: "14px 16px", flex: "none",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: c }}>
                      {KIND_LABELS[m.kind] || m.kind}
                    </span>
                    {m.pinned ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: GOLD, letterSpacing: ".06em", textTransform: "uppercase" }}>pinned</span>
                    ) : null}
                    {m.all_stores ? (
                      <span style={{ fontSize: 11, fontWeight: 700, color: FAINT, letterSpacing: ".06em", textTransform: "uppercase" }}>all stores</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 21, fontWeight: 600, color: SLATE, lineHeight: 1.35, marginTop: 6 }}>
                    {m.body}
                  </div>
                  <div style={{ fontSize: 12.5, color: FAINT, marginTop: 7 }}>
                    {(m.created_by || "the office") + (m.created_at ? " · " + dayLabel(String(m.created_at).slice(0, 10)) : "")}
                  </div>
                </div>
              );
            })}
            {hidden > 0 ? (
              <div style={{ fontSize: 13.5, color: FAINT, fontWeight: 600, flex: "none" }}>
                {hidden} more {hidden === 1 ? "note" : "notes"} not shown — the newest {MAX_MESSAGES} fit on the wall.
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

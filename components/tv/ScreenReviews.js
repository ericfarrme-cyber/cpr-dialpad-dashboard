// Reviews screen — who got named, and which pages are still worth $20.
//
// Eric, 2026-10-23: "most named employee in reviews ... for the three stores,
// and then most named employee for the particular store", and the reason it
// belongs on a wall rather than in the dashboard: "a lot of it depends on not
// what we see on the back end but what they see every day."
//
// Matt, same call, on why the money alone will not do it: "it's on me and on
// Duncan as well to make that a constant topic of conversation ... How many
// repairs did you do? What is your audit score? How many calls did you pick
// up? It should be there."
//
// LIGHT THEME to match ScreenDaily / ScreenRankings: white panels, soft
// shadows, dark slate text.
//
// Layout:
//   ┌───────────────────────────────┬──────────────────────────────────────┐
//   │  THIS STORE — named in a review │  WORTH $20 RIGHT NOW                 │
//   │  1. Aerick Long          5    │  Indy · consoles      0 reviews      │
//   │  2. Alyssa Parent        1    │  Fishers · computers  1 review       │
//   ├───────────────────────────────┤  …                                   │
//   │  ALL THREE STORES — NOVEMBER  ├──────────────────────────────────────┤
//   │  1. Aerick Long          5    │  REVIEWS THIS MONTH, BY STORE        │
//   │  2. Samuel Tomey         3    │  Fishers 4 · Bloomington 5 · Indy 5  │
//   └───────────────────────────────┴──────────────────────────────────────┘
"use client";

var STORE_LABELS = { fishers: "Fishers", bloomington: "Bloomington", indianapolis: "Indianapolis" };
var STORE_COLORS = { fishers: "#7B2FFF", bloomington: "#FF2D95", indianapolis: "#D97706" };
var TYPE_LABELS = { main: "Main store", consoles: "Consoles", computers: "Computers", electronics: "Electronics" };

var MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

var GOLD = "#F59E0B";
var GREEN = "#059669";
var SLATE = "#1E293B";
var MUTED = "#64748B";
var FAINT = "#94A3B8";
var LINE = "#E2E8F0";

function panel(extra) {
  return Object.assign({
    background: "#FFFFFF",
    borderRadius: 18,
    boxShadow: "0 1px 3px rgba(15,23,42,0.08), 0 8px 24px rgba(15,23,42,0.05)",
    padding: "22px 26px",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  }, extra || {});
}

function Title(props) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
      <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: ".13em", textTransform: "uppercase", color: props.color || MUTED }}>
        {props.children}
      </span>
      {props.right ? <span style={{ fontSize: 14, color: FAINT, fontWeight: 600 }}>{props.right}</span> : null}
    </div>
  );
}

// One row of a leaderboard. Rank 1 is bigger and gold — a wall display has to
// read from across the room, so the winner should be obvious without counting.
function Row(props) {
  var top = props.rank === 1;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: top ? "11px 0" : "8px 0",
      borderBottom: props.last ? "none" : "1px solid " + LINE,
    }}>
      <span style={{
        width: 30, textAlign: "center", fontSize: top ? 22 : 17, fontWeight: 800,
        color: top ? GOLD : FAINT, fontVariantNumeric: "tabular-nums",
      }}>{props.rank}</span>
      <span style={{ flex: 1, fontSize: top ? 26 : 21, fontWeight: top ? 800 : 600, color: SLATE, minWidth: 0,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {props.name}
        {props.note ? <span style={{ fontSize: 13, fontWeight: 600, color: FAINT, marginLeft: 9 }}>{props.note}</span> : null}
      </span>
      <span style={{ fontSize: top ? 30 : 23, fontWeight: 800, color: top ? GOLD : SLATE, fontVariantNumeric: "tabular-nums" }}>
        {props.count}
      </span>
    </div>
  );
}

function Empty(props) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
      color: FAINT, fontSize: 18, fontWeight: 600, textAlign: "center", padding: "20px 10px" }}>
      {props.children}
    </div>
  );
}

export default function ScreenReviews(props) {
  var store = props.store;
  var leaders = props.reviewLeaders;
  var tracking = props.reviews;      // same payload ScreenDaily already gets
  var accent = STORE_COLORS[store] || "#7B2FFF";

  // Never render a confident zero off a failed fetch. If the read did not come
  // back, the screen says so — the whole lesson of June 2026.
  if (!leaders || !leaders.success) {
    return (
      <div style={panel({ flex: 1, justifyContent: "center", alignItems: "center" })}>
        <div style={{ fontSize: 26, fontWeight: 700, color: MUTED, textAlign: "center" }}>
          Review tracking isn&rsquo;t reporting
        </div>
        <div style={{ fontSize: 16, color: FAINT, marginTop: 10 }}>
          This is not zero reviews — the screen could not read them.
        </div>
      </div>
    );
  }

  // THE MONTH LEADS, and the heading always says which window it drew.
  //
  // Eric, 2026-11-02, looking at this board: "Does this reset and track
  // monthly?" Half of it did — "Reviews this month" is a real subtraction,
  // but these two leaderboards were an all-time tally sitting next to it, so
  // Samuel Tomey ranked second company-wide on work from June. The named
  // bonus pays per month, so the month is the number on the wall.
  //
  // The fall-back is deliberate: a month is a small number and on the 1st it
  // is empty, so rather than hang a board of zeros the panel shows all-time
  // and SAYS SO in the heading. A list under a heading that implies the wrong
  // window is the "Closed by" defect again (CONTEXT 10ac).
  var monthName = MONTHS[Number(String(leaders.period || "").slice(5, 7)) - 1] || "this month";
  var mineMonth = (leaders.by_store && leaders.by_store[store]) || [];
  var companyMonth = leaders.company || [];
  var mineAll = (leaders.by_store_all_time && leaders.by_store_all_time[store]) || [];
  var companyAll = leaders.company_all_time || [];
  var mine = mineMonth.length ? mineMonth : mineAll;
  var company = companyMonth.length ? companyMonth : companyAll;
  var mineIsMonth = mineMonth.length > 0;
  var companyIsMonth = companyMonth.length > 0;
  // Capped at 7 so the panel does not overflow at TV scale. The full count
  // travels with it and the heading says so when it is cut: a truncated list
  // under a heading that reads as complete is how "Closed by" came to look
  // like a claim that Sam does no non-phone work (CONTEXT 10ac). There are
  // nine department pages and all nine are under ten reviews today, so this
  // list IS cut.
  var thinAll = leaders.thin_pages || [];
  var thin = thinAll.slice(0, 7);
  var bonus = leaders.named_bonus || { main: 10, thin: 20 };

  // Reviews gained this month per store, from the tracking payload the TV
  // already loads. A null gain means no pre-month baseline, not zero.
  var gained = {};
  ((tracking && tracking.stores) || []).forEach(function(s) { gained[s.store] = s.gained_this_month; });

  return (
    <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 20, minHeight: 0 }}>

      {/* ── left: the two leaderboards ── */}
      <div style={{ display: "grid", gridTemplateRows: "1fr 1fr", gap: 20, minHeight: 0 }}>

        <div style={panel()}>
          <Title color={accent} right={"$" + bonus.main + " each · $" + bonus.thin + " on a new page"}>
            {(STORE_LABELS[store] || store) + (mineIsMonth ? " — named in " + monthName : " — named, all time")}
          </Title>
          {mine.length === 0 ? (
            <Empty>Nobody here has been named yet.<br />First one on the board owns this screen.</Empty>
          ) : (
            <div style={{ flex: 1, overflow: "hidden" }}>
              {mine.slice(0, 5).map(function(r, i) {
                return <Row key={r.name} rank={i + 1} name={r.name} count={r.count}
                  note={r.payable ? null : "salaried"} last={i === Math.min(mine.length, 5) - 1} />;
              })}
            </div>
          )}
        </div>

        <div style={panel()}>
          <Title right={companyIsMonth ? null : "nobody named yet in " + monthName}>
            {companyIsMonth ? "All three stores — " + monthName : "All three stores — all time"}
          </Title>
          {company.length === 0 ? (
            <Empty>No named reviews captured yet.</Empty>
          ) : (
            <div style={{ flex: 1, overflow: "hidden" }}>
              {company.slice(0, 5).map(function(r, i) {
                return <Row key={r.name} rank={i + 1} name={r.name} count={r.count}
                  note={r.payable ? null : "salaried"} last={i === Math.min(company.length, 5) - 1} />;
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── right: the money, and the month ── */}
      <div style={{ display: "grid", gridTemplateRows: "1.35fr 1fr", gap: 20, minHeight: 0 }}>

        <div style={panel()}>
          <Title color={GREEN} right={"$" + bonus.thin + " a named review"}>
            {thinAll.length > thin.length
              ? "The emptiest " + thin.length + " of " + thinAll.length + " pages worth $" + bonus.thin
              : "Pages still worth $" + bonus.thin}
          </Title>
          {thin.length === 0 ? (
            <Empty>Every page is past ten reviews. That took some doing.</Empty>
          ) : (
            <div style={{ flex: 1, overflow: "hidden" }}>
              {thin.map(function(p, i) {
                return (
                  <div key={p.store + p.listing_type} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "9px 0", borderBottom: i === thin.length - 1 ? "none" : "1px solid " + LINE,
                  }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "none",
                      background: STORE_COLORS[p.store] || FAINT }} />
                    <span style={{ flex: 1, fontSize: 19, fontWeight: 600, color: SLATE, minWidth: 0,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {(STORE_LABELS[p.store] || p.store) + " · " + (TYPE_LABELS[p.listing_type] || p.listing_type)}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 700,
                      color: p.total_reviews === 0 ? GREEN : MUTED, fontVariantNumeric: "tabular-nums" }}>
                      {p.total_reviews === 0 ? "none yet" : p.total_reviews}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={panel()}>
          <Title right={monthName}>Reviews this month</Title>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-around", gap: 10 }}>
            {["fishers", "bloomington", "indianapolis"].map(function(s) {
              var g = gained[s];
              return (
                <div key={s} style={{ textAlign: "center", flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 46, fontWeight: 800, lineHeight: 1,
                    color: s === store ? (STORE_COLORS[s] || SLATE) : SLATE,
                    fontVariantNumeric: "tabular-nums", opacity: g == null ? .35 : 1 }}>
                    {g == null ? "—" : g}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: MUTED, marginTop: 8,
                    letterSpacing: ".04em", textTransform: "uppercase" }}>
                    {STORE_LABELS[s] || s}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12.5, color: FAINT, textAlign: "center", marginTop: 6 }}>
            Ten reviews starts the bonus — every review counts. Ask every customer.
          </div>
        </div>
      </div>
    </div>
  );
}

// Promotions — flash sales and what the stores are told.
//
// Eric asked whether this should be its own tab and said he could not think of
// a better place for it. It is, and both halves live here for one reason: they
// are the same question. "What is Indianapolis running this week, and does
// everyone there know?" One screen answers it; two would guarantee a sale
// nobody announced.
//
// ── WHAT THIS SCREEN WILL AND WILL NOT CLAIM ────────────────────────────────
// A sale's effect is measured as appointments booked against that sheet row at
// that store DURING the window, against the same number of days immediately
// before it. That is demand, and it is exact.
//
// It does NOT claim profit. The sheet's part costs are the stale ones Eric
// said to disregard, and no console row carries one at all — so the money a
// sale gives up is stated as revenue and nothing is said about margin. The
// route's `measurement` string says the same thing, from the server.
//
// It also does not claim causation. A reading comes back as "N booked during,
// M in the same days before", with "too early to read" under four decided
// bookings — the same restraint as the quote evidence in the booking panel.
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/components/AuthProvider";

var STORES = ["fishers", "bloomington", "indianapolis"];
var STORE_LABELS = { fishers: "Fishers", bloomington: "Bloomington", indianapolis: "Indianapolis" };
var STORE_COLORS = { fishers: "#E03E3E", bloomington: "#1A9E8F", indianapolis: "#D4A017" };
var KIND_LABELS = { heads_up: "Heads up", this_week: "This week", reminder: "Reminder", win: "Nice work" };

function money(n) {
  if (n === null || n === undefined || !isFinite(Number(n))) return "—";
  return "$" + Number(n).toFixed(2).replace(/\.00$/, "");
}
function card(extra) {
  return Object.assign({
    background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 10,
    padding: "15px 17px",
  }, extra || {});
}
function todayISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Indiana/Indianapolis" });
}
function plusDays(ymd, n) {
  var d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function H2(props) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "26px 0 11px" }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.01em" }}>{props.children}</h2>
      {props.note ? <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{props.note}</span> : null}
    </div>
  );
}

function Chip(props) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
      border: "1px solid " + (props.color || "var(--border)"), color: props.color || "var(--text-secondary)",
      whiteSpace: "nowrap",
    }}>{props.children}</span>
  );
}

var input = {
  width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)",
  background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 13, boxSizing: "border-box",
  fontFamily: "'Space Grotesk', sans-serif",
};
var label = {
  fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase",
  letterSpacing: "0.06em", marginBottom: 4, display: "block",
};
function btn(tone, on) {
  return {
    fontSize: 12, fontWeight: 700, padding: "7px 13px", borderRadius: 8, cursor: "pointer",
    fontFamily: "'Space Grotesk', sans-serif",
    background: on ? tone + "22" : "var(--bg-card-inner)",
    color: on ? tone : "var(--text-secondary)",
    border: "1px solid " + (on ? tone : "var(--border)"),
  };
}

// ── one sale, with what happened ────────────────────────────────────────────
function SaleCard(props) {
  var s = props.sale;
  var edge = s.state === "live" ? "var(--yellow)" : s.state === "upcoming" ? "var(--cyan)" : "var(--border-heavy)";
  return (
    <div style={card({ borderLeft: "3px solid " + edge, display: "grid", gap: 9 })}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>
            {s.device} <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>· {s.repair}{s.tier ? " · " + s.tier : ""}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {s.starts_on} to {s.ends_on} · {s.days} day{s.days === 1 ? "" : "s"}
            {s.created_by ? " · started by " + s.created_by : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: "var(--yellow)", fontVariantNumeric: "tabular-nums" }}>
            {s.listed_price !== null && s.off > 0 ? (
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", textDecoration: "line-through", marginRight: 6 }}>{money(s.listed_price)}</span>
            ) : null}
            {money(s.sale_price)}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
            {s.off > 0 ? money(s.off) + " off" + (s.off_pct ? " · " + s.off_pct + "%" : "") : "same as the sheet"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Chip color={STORE_COLORS[s.store]}>{STORE_LABELS[s.store] || s.store}</Chip>
        {s.state === "live" ? <Chip color="var(--yellow)">live{s.days_left === 0 ? " · last day" : s.days_left !== null ? " · " + s.days_left + " days left" : ""}</Chip> : null}
        {s.state === "upcoming" ? <Chip color="var(--cyan)">starts {s.starts_on}</Chip> : null}
        {s.state === "finished" ? <Chip>finished</Chip> : null}
        {s.state === "ended" ? <Chip>ended early{s.ended_by ? " by " + s.ended_by : ""}</Chip> : null}
        {s.label ? <span style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{s.label}</span> : null}
      </div>

      {/* The reading is computed on the server from the two windows, so this
          sentence cannot drift from the numbers beside it. */}
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        {s.reading}
        {s.during && s.during.booked > 0 && s.revenue_given_up ? (
          <span style={{ color: "var(--text-muted)" }}> {money(s.revenue_given_up)} of revenue given up so far — margin not computable, the sheet{"’"}s part costs are stale.</span>
        ) : null}
      </div>

      {props.onEnd && (s.state === "live" || s.state === "upcoming") ? (
        <div>
          <button onClick={function() { props.onEnd(s); }} style={btn("var(--text-secondary)", false)}>
            End it now
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function PromotionsTab() {
  var auth = useAuth();
  var af = auth && auth.authFetch ? auth.authFetch : fetch;
  var role = auth && auth.userInfo ? auth.userInfo.role : null;

  var [data, setData] = useState(null);
  var [rows, setRows] = useState([]);
  var [loading, setLoading] = useState(true);
  var [err, setErr] = useState(null);
  var [busy, setBusy] = useState(false);
  var [notice, setNotice] = useState(null);

  var today = todayISO();

  var load = useCallback(async function() {
    setErr(null);
    try {
      var r = await af("/api/dialpad/promotions?action=list");
      var j = await r.json();
      if (!j.success) throw new Error(j.error || "could not load promotions");
      setData(j);
      var r2 = await af("/api/dialpad/promotions?action=rows");
      var j2 = await r2.json();
      if (j2.success) setRows(j2.rows || []);
    } catch (e) {
      // Shown, never swallowed. An empty promotions screen and a failed read
      // look identical otherwise.
      setErr(e.message);
    }
    setLoading(false);
  }, [af]);

  useEffect(function() { load(); }, [load]);

  // ── the sale form ─────────────────────────────────────────────────────────
  var [sf, setSf] = useState({
    device: "", key: "", price: "", starts_on: today, ends_on: plusDays(today, 13),
    stores: [], label: "", note: "",
  });
  function sset(k, v) { setSf(function(p) { var n = Object.assign({}, p); n[k] = v; return n; }); }

  var devices = useMemo(function() {
    var seen = {}, out = [];
    rows.forEach(function(r) { if (!seen[r.device]) { seen[r.device] = 1; out.push(r.device); } });
    return out;
  }, [rows]);

  var deviceRows = useMemo(function() {
    return rows.filter(function(r) { return r.device === sf.device; });
  }, [rows, sf.device]);

  var chosen = useMemo(function() {
    return deviceRows.filter(function(r) { return String(r.id) === String(sf.key); })[0] || null;
  }, [deviceRows, sf.key]);

  var priceNum = parseFloat(sf.price);
  var priceOk = isFinite(priceNum) && priceNum >= 0;
  var listed = chosen ? Number(chosen.set_price) : null;
  var off = priceOk && listed !== null && isFinite(listed) ? Math.round((listed - priceNum) * 100) / 100 : null;

  async function startSale() {
    setNotice(null); setErr(null);
    if (!chosen) { setErr("Pick a device and a repair"); return; }
    if (!priceOk) { setErr("Set a sale price"); return; }
    if (!sf.stores.length) { setErr("Pick at least one store — a sale is per store"); return; }
    if (!sf.ends_on) { setErr("A sale needs an end date. Without one it is a price change, which belongs in the Price Book."); return; }
    setBusy(true);
    try {
      var r = await af("/api/dialpad/promotions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start_sale", repair_price_id: chosen.id, sale_price: priceNum,
          starts_on: sf.starts_on, ends_on: sf.ends_on, stores: sf.stores,
          label: sf.label, note: sf.note,
        }),
      });
      var j = await r.json();
      if (!j.success) throw new Error(j.error);
      setNotice("Sale started at " + sf.stores.map(function(s) { return STORE_LABELS[s]; }).join(", ")
        + (j.ledger_written ? "" : " — but its history line did not write, so Price & Demand will not show it"));
      setSf({ device: "", key: "", price: "", starts_on: today, ends_on: plusDays(today, 13), stores: [], label: "", note: "" });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function endSale(s) {
    setBusy(true); setErr(null); setNotice(null);
    try {
      var r = await af("/api/dialpad/promotions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end_sale", id: s.id }),
      });
      var j = await r.json();
      if (!j.success) throw new Error(j.error);
      setNotice("Ended. It stays in the history — what the store charged is a fact, not a draft.");
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  // ── the message form ──────────────────────────────────────────────────────
  var [mf, setMf] = useState({ body: "", kind: "heads_up", store: "", all: true, pinned: false, ends_on: "" });
  function mset(k, v) { setMf(function(p) { var n = Object.assign({}, p); n[k] = v; return n; }); }

  async function postMessage() {
    setNotice(null); setErr(null);
    if (!mf.body.trim()) { setErr("A message needs some words"); return; }
    if (!mf.all && !mf.store) { setErr("Pick a store, or all stores"); return; }
    setBusy(true);
    try {
      var r = await af("/api/dialpad/promotions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "post_message", body: mf.body.trim(), kind: mf.kind,
          all_stores: mf.all, store: mf.all ? null : mf.store,
          pinned: mf.pinned, ends_on: mf.ends_on || null,
        }),
      });
      var j = await r.json();
      if (!j.success) throw new Error(j.error);
      setNotice("Posted. It is on the board within a minute.");
      setMf({ body: "", kind: "heads_up", store: "", all: true, pinned: false, ends_on: "" });
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function msgAction(action, id, extra) {
    setBusy(true); setErr(null);
    try {
      var r = await af("/api/dialpad/promotions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action: action, id: id }, extra || {})),
      });
      var j = await r.json();
      if (!j.success) throw new Error(j.error);
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  if (loading) {
    return <div style={{ padding: 30, color: "var(--text-muted)", fontSize: 13 }}>Loading promotions…</div>;
  }
  if (!data && err) {
    return (
      <div style={card({ margin: 20, borderLeft: "3px solid var(--red)" })}>
        <div style={{ fontWeight: 800, color: "var(--red)", fontSize: 14 }}>Promotions could not load</div>
        <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}>{err}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
          If this says a table does not exist, <code>sql/migration_promotions.sql</code> has not been run yet.
        </div>
      </div>
    );
  }

  var live = (data && data.live) || [];
  var upcoming = (data && data.upcoming) || [];
  var past = (data && data.past) || [];
  var messages = (data && data.messages) || [];
  var showing = messages.filter(function(m) { return m.showing; });

  return (
    <div style={{ padding: "4px 2px 40px" }}>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>Promotions</h1>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
          What each store is running, and what its people are told. Both show on the shop TV.
        </div>
      </div>

      {/* The migration is pasted by hand, so the window between the deploy and
          the paste is real. The screen says what to do rather than rendering
          an empty board that looks like it is working. */}
      {data && data.not_configured ? (
        <div style={card({ marginTop: 12, borderLeft: "3px solid var(--orange)" })}>
          <div style={{ fontWeight: 800, color: "var(--orange)", fontSize: 13.5 }}>Not set up yet</div>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4, lineHeight: 1.5 }}>
            {data.note} Until then nothing can be posted and every store quotes the sheet — which is
            what the Price Book and the shop TV are both showing.
          </div>
        </div>
      ) : null}

      {err ? (
        <div style={card({ marginTop: 12, borderLeft: "3px solid var(--red)", fontSize: 12.5, color: "var(--red)" })}>{err}</div>
      ) : null}
      {notice ? (
        <div style={card({ marginTop: 12, borderLeft: "3px solid var(--green)", fontSize: 12.5, color: "var(--text-secondary)" })}>{notice}</div>
      ) : null}

      {/* ── live and upcoming ── */}
      <H2 note={live.length ? live.length + " running" : "nothing running right now"}>Sales</H2>
      {live.length === 0 && upcoming.length === 0 ? (
        <div style={card({ fontSize: 13, color: "var(--text-secondary)" })}>
          No sale is running or scheduled. Every store is quoting the sheet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 9 }}>
          {live.map(function(s) { return <SaleCard key={s.id} sale={s} onEnd={endSale} />; })}
          {upcoming.map(function(s) { return <SaleCard key={s.id} sale={s} onEnd={endSale} />; })}
        </div>
      )}

      {/* ── start one ── */}
      <H2 note="per store, with an end date — a sale without one is a price change">Start a sale</H2>
      <div style={card({ display: "grid", gap: 12 })}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>Device</span>
            <input list="promo-devices" value={sf.device} placeholder="Play Station 5 (all models)"
              onChange={function(e) { sset("device", e.target.value); sset("key", ""); sset("price", ""); }} style={input} />
            <datalist id="promo-devices">
              {devices.map(function(d) { return <option key={d} value={d} />; })}
            </datalist>
          </div>
          <div>
            <span style={label}>Repair</span>
            <select value={sf.key} onChange={function(e) {
              sset("key", e.target.value);
              var r = deviceRows.filter(function(x) { return String(x.id) === String(e.target.value); })[0];
              // Pre-filled with the listed price, so a sale is typed as a
              // change FROM something rather than into an empty box.
              if (r && r.set_price !== null) sset("price", String(r.set_price));
            }} style={input} disabled={!deviceRows.length}>
              <option value="">{deviceRows.length ? "pick one" : "pick a device first"}</option>
              {deviceRows.map(function(r) {
                return <option key={r.id} value={r.id}>
                  {r.repair + (r.tier ? " · " + r.tier : "") + (r.set_price !== null ? " — " + money(r.set_price) : "") + (r.turnaround ? " · " + r.turnaround : "")}
                </option>;
              })}
            </select>
          </div>
          <div>
            <span style={label}>Sale price</span>
            <input value={sf.price} onChange={function(e) { sset("price", e.target.value); }} inputMode="decimal"
              placeholder={listed !== null ? String(listed) : "price"} style={input} />
            {off !== null ? (
              <div style={{ fontSize: 11, marginTop: 3, color: off > 0 ? "var(--green)" : off < 0 ? "var(--orange)" : "var(--text-muted)" }}>
                {off > 0 ? money(off) + " off " + money(listed)
                  : off < 0 ? money(-off) + " ABOVE the listed " + money(listed) + " — that is not a sale"
                  : "the same as the listed price"}
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>Starts</span>
            <input type="date" value={sf.starts_on} onChange={function(e) { sset("starts_on", e.target.value); }} style={input} />
          </div>
          <div>
            <span style={label}>Ends</span>
            <input type="date" value={sf.ends_on} onChange={function(e) { sset("ends_on", e.target.value); }} style={input} />
          </div>
          <div>
            <span style={label}>Why (shows on the TV)</span>
            <input value={sf.label} onChange={function(e) { sset("label", e.target.value); }} placeholder="Slow week · same-day push" style={input} />
          </div>
        </div>

        <div>
          <span style={label}>Stores</span>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {STORES.map(function(st) {
              var on = sf.stores.indexOf(st) >= 0;
              return (
                <button key={st} onClick={function() {
                  sset("stores", on ? sf.stores.filter(function(x) { return x !== st; }) : sf.stores.concat([st]));
                }} style={btn(STORE_COLORS[st], on)}>{STORE_LABELS[st]}</button>
              );
            })}
            <button onClick={function() { sset("stores", sf.stores.length === STORES.length ? [] : STORES.slice()); }}
              style={btn("var(--purple)", sf.stores.length === STORES.length)}>All three</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.5 }}>
            A sale is per store, so a company-wide one is three rows. That is deliberate: ending it early
            at one store then needs no special case.
          </div>
        </div>

        <div>
          <button onClick={startSale} disabled={busy} style={Object.assign(btn("var(--yellow)", true), { opacity: busy ? .5 : 1, padding: "9px 16px", fontSize: 13 })}>
            {busy ? "Working…" : "Start the sale"}
          </button>
          <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 10 }}>
            Agents see the sale price on the row with the listed price struck through, and a quote at it is
            not recorded as their discount.
          </span>
        </div>
      </div>

      {/* ── messages ── */}
      <H2 note={showing.length ? showing.length + " on the board" : "nothing on the board"}>Messages</H2>

      <div style={card({ borderLeft: "3px solid var(--orange)", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: 10 })}>
        <strong style={{ color: "var(--orange)" }}>Treat these as public.</strong> The board hangs unsigned-in
        in a public part of the shop and reads them through an open endpoint, the same as the rankings and
        reviews screens. Nothing private, nothing about one person{"’"}s pay, nothing you would not want a
        customer to read over a technician{"’"}s shoulder.
      </div>

      <div style={card({ display: "grid", gap: 11, marginBottom: 12 })}>
        <div>
          <span style={label}>Message</span>
          <textarea value={mf.body} onChange={function(e) { mset("body", e.target.value); }} rows={2}
            maxLength={400} placeholder="Say it in one sentence — it has to read from across the shop."
            style={Object.assign({}, input, { resize: "vertical", lineHeight: 1.45 })} />
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>{mf.body.length} / 400</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <div>
            <span style={label}>Kind</span>
            <select value={mf.kind} onChange={function(e) { mset("kind", e.target.value); }} style={input}>
              {((data && data.kinds) || ["heads_up"]).map(function(k) {
                return <option key={k} value={k}>{KIND_LABELS[k] || k}</option>;
              })}
            </select>
          </div>
          <div>
            <span style={label}>Where</span>
            <select value={mf.all ? "all" : mf.store} onChange={function(e) {
              if (e.target.value === "all") { mset("all", true); mset("store", ""); }
              else { mset("all", false); mset("store", e.target.value); }
            }} style={input}>
              <option value="all">All three stores</option>
              {STORES.map(function(st) { return <option key={st} value={st}>{STORE_LABELS[st]}</option>; })}
            </select>
          </div>
          <div>
            <span style={label}>Take it down on (optional)</span>
            <input type="date" value={mf.ends_on} onChange={function(e) { mset("ends_on", e.target.value); }} style={input} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={function() { mset("pinned", !mf.pinned); }} style={btn("var(--yellow)", mf.pinned)}>
            {mf.pinned ? "Pinned" : "Pin it"}
          </button>
          <button onClick={postMessage} disabled={busy} style={Object.assign(btn("var(--cyan)", true), { opacity: busy ? .5 : 1, padding: "9px 16px", fontSize: 13 })}>
            {busy ? "Working…" : "Post it"}
          </button>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            The newest three fit on the wall; the rest are counted, not hidden.
          </span>
        </div>
      </div>

      {messages.length === 0 ? (
        <div style={card({ fontSize: 13, color: "var(--text-secondary)" })}>
          Nothing has been posted yet. The board shows the sale and says so.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {messages.map(function(m) {
            return (
              <div key={m.id} style={card({
                display: "grid", gap: 7, padding: "12px 15px",
                opacity: m.active === false ? .45 : m.showing ? 1 : .7,
                borderLeft: "3px solid " + (m.showing ? "var(--cyan)" : "var(--border-heavy)"),
              })}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <Chip color="var(--cyan)">{KIND_LABELS[m.kind] || m.kind}</Chip>
                  <Chip color={m.all_stores ? "var(--purple)" : STORE_COLORS[m.store]}>
                    {m.all_stores ? "All stores" : (STORE_LABELS[m.store] || m.store)}
                  </Chip>
                  {m.pinned ? <Chip color="var(--yellow)">pinned</Chip> : null}
                  {m.active === false ? <Chip>removed</Chip> : m.showing ? null : <Chip>not showing</Chip>}
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                    {(m.created_by || "—") + (m.created_at ? " · " + String(m.created_at).slice(0, 10) : "")}
                    {m.ends_on ? " · until " + m.ends_on : ""}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text-primary)", lineHeight: 1.45 }}>{m.body}</div>
                {m.active !== false ? (
                  <div style={{ display: "flex", gap: 7 }}>
                    <button onClick={function() { msgAction("pin_message", m.id, { pinned: !m.pinned }); }} style={btn("var(--yellow)", false)}>
                      {m.pinned ? "Unpin" : "Pin"}
                    </button>
                    <button onClick={function() { msgAction("remove_message", m.id); }} style={btn("var(--text-secondary)", false)}>
                      Take it down
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* ── past sales ── */}
      {past.length ? (
        <>
          <H2 note="what each one did to bookings">Sales that have run</H2>
          <div style={{ display: "grid", gap: 9 }}>
            {past.slice(0, 20).map(function(s) { return <SaleCard key={s.id} sale={s} />; })}
          </div>
          {past.length > 20 ? (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
              Showing the 20 most recent of {past.length}.
            </div>
          ) : null}
        </>
      ) : null}

      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 20, lineHeight: 1.6, maxWidth: 760 }}>
        <strong style={{ color: "var(--text-secondary)" }}>How a sale is measured.</strong>{" "}
        {(data && data.measurement) || ""} A sale also writes a line to the price history, so there is one
        record of every price the stores have charged — filed as a sale rather than as a price change, so it
        does not silence the Price Book{"’"}s register comparison or get drawn as a permanent change.
        {role !== "admin" ? " You are signed in as a manager, which is enough to run all of this." : ""}
      </div>
    </div>
  );
}

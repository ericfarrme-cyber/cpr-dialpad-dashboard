// Review tracking — twelve Google pages across three stores, Carmel watched.
//
// WHAT THIS DOES NOT DO: it does not pay anybody, and it does not write a
// ledger row. The review bonus is designed but NOT approved and NOT computable
// from this data source, so every five-star figure here is labelled an estimate
// and the tier line says "not payable". See docs/CONTEXT.md § 10al.
//
// THE BLOCKER, stated on the screen rather than hidden: Eric's rule is that
// only 5★ reviews count. The Places API returns a review TOTAL and an AVERAGE
// rounded to one decimal — never a breakdown by star — and the average cannot
// be used to recover one, because the star-sum uncertainty is 0.05 × n, i.e.
// ±32 stars on Fishers main and ±44 on Indianapolis. Exact five-star counts
// need the Business Profile Reviews API (owner OAuth) or a person reading the
// Business Profile inbox.
//
// Reviews gained is always a subtraction between two snapshots, computed by the
// route, never a stored figure — so it cannot drift from what Google says.
"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

var STORE_COLOR = { fishers: "var(--red)", bloomington: "var(--cyan)", indianapolis: "var(--yellow)" };
var TYPE_LABEL = { main: "Main store", consoles: "Consoles", computers: "Computers", electronics: "Electronics" };
var TIERS = [{ at: 10, pays: 50 }, { at: 15, pays: 75 }, { at: 20, pays: 100 }];
var FLOOR = 10;

function cap(s) { return String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1); }
function tint(c, pct) { return "color-mix(in srgb, " + c + " " + pct + "%, transparent)"; }

function card(extra) {
  return Object.assign({
    background: "var(--bg-card)", border: "1px solid var(--border)",
    borderRadius: 14, padding: "17px 19px",
  }, extra || {});
}
var mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: "tabular-nums" };

function H2(props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 13px" }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--text-muted)" }}>
        {props.children}
      </span>
      {props.note ? (
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-secondary)", background: "var(--bg-card-inner)",
          border: "1px solid var(--border)", borderRadius: 20, padding: "2px 9px" }}>{props.note}</span>
      ) : null}
      <span style={{ flex: 1, height: 1, background: "var(--border)", minWidth: 20 }} />
    </div>
  );
}

function Chip(props) {
  var c = props.color || "var(--text-muted)";
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
      color: c, border: "1px solid " + tint(c, 45), background: tint(c, 11),
      padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>{props.children}</span>
  );
}

export default function ReviewsTab() {
  var authCtx = useAuth();
  var af = authCtx && authCtx.authFetch ? authCtx.authFetch : fetch;
  var [tracking, setTracking] = useState(null);
  var [credits, setCredits] = useState(null);
  var [err, setErr] = useState(null);
  var [loading, setLoading] = useState(true);
  var [acted, setActed] = useState({});
  var [copied, setCopied] = useState(null);
  var [openPanel, setOpenPanel] = useState(null);
  var [entry, setEntry] = useState({});     // store -> { five, bad }
  var [saving, setSaving] = useState(null);
  var [saveMsg, setSaveMsg] = useState(null);

  useEffect(function() {
    var alive = true;
    Promise.allSettled([
      af("/api/dialpad/google-tracking?action=tracking").then(function(r) { return r.json(); }),
      af("/api/dialpad/google-tracking?action=credits").then(function(r) { return r.json(); }),
    ]).then(function(res) {
      if (!alive) return;
      // Loud, not silent: a failed read says so instead of rendering zeroes.
      var problems = [];
      if (res[0].status === "fulfilled" && res[0].value && res[0].value.success) setTracking(res[0].value);
      else problems.push("tracking: " + (res[0].status === "rejected" ? String(res[0].reason) : ((res[0].value && res[0].value.error) || "failed")));
      if (res[1].status === "fulfilled" && res[1].value && res[1].value.success) setCredits(res[1].value);
      else problems.push("credits: " + (res[1].status === "rejected" ? String(res[1].reason) : ((res[1].value && res[1].value.error) || "failed")));
      if (problems.length) setErr(problems.join(" · "));
      setLoading(false);
    });
    return function() { alive = false; };
  }, [af]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading review tracking…</div>;
  }

  var share = credits && credits.five_star_share != null ? credits.five_star_share : null;
  var stores = (tracking && tracking.stores) || [];
  var competitors = (tracking && tracking.competitors) || [];
  var items = (credits && credits.items) || [];

  // Every page we own, flattened, so the table and the per-store cards agree.
  var allPages = [];
  stores.forEach(function(s) { (s.listings || []).forEach(function(l) { allPages.push(l); }); });
  var mainTotal = allPages.filter(function(p) { return p.listing_type === "main"; })
    .reduce(function(a, p) { return a + (p.total_reviews || 0); }, 0);
  var deptPages = allPages.filter(function(p) { return p.listing_type !== "main"; });
  var deptTotal = deptPages.reduce(function(a, p) { return a + (p.total_reviews || 0); }, 0);
  var deptThin = deptPages.filter(function(p) { return (p.total_reviews || 0) < FLOOR; }).length;

  var gainedAll = stores.reduce(function(a, s) { return a + (s.gained_this_month || 0); }, 0);
  var anyGainUnknown = allPages.some(function(p) { return p.gained_this_month === null; });

  var pendingCredits = items.filter(function(it) {
    return !acted[it.id] && (it.proposed_credits || []).some(function(c) { return c.amount > 0; });
  }).length;
  var badThisMonth = items.filter(function(it) { return it.rating === 1 || it.rating === 2; }).length;

  var entered = (tracking && tracking.five_star_entered) || null;
  var tableMissing = !!(tracking && tracking.five_star_table_missing);
  var period = (tracking && tracking.period) || "";

  // A hand-entered count is the real figure and wins outright. The estimate is
  // only a stand-in until somebody counts, and it is always labelled as one.
  function fiveStarFor(store, gained) {
    var row = entered && entered[store];
    if (row && row.five_star_count != null) return { n: row.five_star_count, exact: true, row: row };
    if (gained == null || share == null) return { n: null, exact: false, row: null };
    return { n: Math.round(gained * share * 10) / 10, exact: false, row: null };
  }

  function fiveStarEst(n) {
    if (n == null || share == null) return null;
    return Math.round(n * share * 10) / 10;
  }

  // Company figure: exact where a store has been entered, estimated elsewhere.
  var companyFive = 0, companyAllExact = stores.length > 0;
  stores.forEach(function(s) {
    var f = fiveStarFor(s.store, s.gained_this_month);
    if (f.n == null) { companyAllExact = false; return; }
    if (!f.exact) companyAllExact = false;
    companyFive += f.n;
  });
  companyFive = Math.round(companyFive * 10) / 10;

  function tierFor(n) {
    var t = null;
    TIERS.forEach(function(x) { if (n != null && n >= x.at) t = x; });
    return t;
  }

  async function saveFiveStar(store) {
    var e = entry[store] || {};
    if (e.five === undefined || e.five === "") { setSaveMsg({ store: store, ok: false, text: "Enter a five-star count first." }); return; }
    setSaving(store); setSaveMsg(null);
    try {
      var res = await af("/api/dialpad/google-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_five_star", period: period, store: store,
          five_star_count: e.five, one_two_star_count: e.bad === undefined || e.bad === "" ? 0 : e.bad,
        }),
      });
      var j = await res.json();
      if (!j.success) { setSaveMsg({ store: store, ok: false, text: j.error || "Save failed." }); setSaving(null); return; }
      // Re-read rather than patching local state, so the screen shows what the
      // database actually holds.
      var fresh = await af("/api/dialpad/google-tracking?action=tracking").then(function(r) { return r.json(); });
      if (fresh && fresh.success) setTracking(fresh);
      setSaveMsg({ store: store, ok: true, text: "Saved." });
      setEntry(function(x) { var n = Object.assign({}, x); delete n[store]; return n; });
    } catch (ex) {
      setSaveMsg({ store: store, ok: false, text: String(ex.message || ex) });
    }
    setSaving(null);
  }

  return (
    <div style={{ display: "grid", gap: 30 }}>

      {err ? (
        <div style={card({ background: tint("var(--red)", 8), borderColor: tint("var(--red)", 32), fontSize: 13 })}>
          <b style={{ color: "var(--text-primary)" }}>Some of this screen could not load.</b>
          <div style={{ marginTop: 6, color: "var(--text-body)", fontFamily: mono.fontFamily, fontSize: 11.5 }}>{err}</div>
        </div>
      ) : null}

      {tableMissing ? (
        <div style={card({ background: tint("var(--yellow)", 10), borderColor: tint("var(--yellow)", 38), fontSize: 13 })}>
          <b style={{ color: "var(--text-primary)" }}>Five-star entry is not available yet.</b> The table does not exist &mdash;
          run <span style={{ fontFamily: mono.fontFamily }}>sql/migration_review_five_star.sql</span> in the Supabase SQL
          editor. Until then every 5&#9733; figure below is an estimate, and nothing can be counted or saved.
          <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>
            Said out loud rather than shown as zero five-star reviews, which is how an empty table went unnoticed for
            months once before.
          </div>
        </div>
      ) : null}

      {/* ── the blocker, first, because it governs every number below ── */}
      <div style={card({ background: tint("var(--red)", 8), borderColor: tint("var(--red)", 30), fontSize: 13, lineHeight: 1.55 })}>
        <b style={{ color: "var(--text-primary)" }}>Only 5★ reviews count — and this data source cannot count them.</b>{" "}
        Google&rsquo;s Places API returns a <b style={{ color: "var(--text-primary)" }}>total</b> and an{" "}
        <b style={{ color: "var(--text-primary)" }}>average</b>, never a breakdown by star, and the average is published
        to one decimal — on a 647-review page that is <b style={{ color: "var(--text-primary)" }}>±32 stars</b> of
        rounding, which cannot resolve even one review, let alone tell a 4★ from a 5★.
        {share != null ? (
          <> Every 5★ figure below is an <b style={{ color: "var(--text-primary)" }}>estimate at {(100 * share).toFixed(1)}%</b>,
          measured on {credits.five_star_share_sample} captured reviews, and is labelled as one.</>
        ) : null}{" "}
        <b style={{ color: "var(--text-primary)" }}>It must not be used to pay anyone.</b>
        <div style={{ marginTop: 9, color: "var(--text-secondary)", fontSize: 12.5 }}>
          The fix is a different Google API, not a different key: the <b style={{ color: "var(--text-primary)" }}>Business
          Profile Reviews API</b> returns every review with its star rating for listings we own, via owner OAuth rather
          than the Places key. Until then <b style={{ color: "var(--text-primary)" }}>Matt&rsquo;s Business Profile inbox
          is the only exact source</b> — which is already where he confirms names.
        </div>
      </div>

      {/* ── headline strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))", gap: 1,
        background: "var(--border)", border: "1px solid var(--border)", borderRadius: 13, overflow: "hidden" }}>
        {[
          { k: "5★ this month", v: companyFive == null ? "—" : companyFive, suffix: companyAllExact ? "" : " est.",
            h: (companyAllExact ? "counted" : "estimated") + " · of " + gainedAll + " reviews" + (anyGainUnknown ? " with a baseline" : ""),
            color: companyAllExact ? "var(--text-primary)" : "var(--yellow)" },
          { k: "Stores at a tier", v: String(stores.filter(function(s) { return tierFor(fiveStarFor(s.store, s.gained_this_month).n); }).length),
            suffix: " of " + stores.length, h: "not payable — the bonus is not approved", color: "var(--text-muted)" },
          { k: "Credits to confirm", v: String(pendingCredits), h: "proposed from review text", color: "var(--text-primary)" },
          { k: "1★ or 2★ captured", v: String(badThisMonth), h: badThisMonth ? "would halve a store's tier" : "none in the sample", color: badThisMonth ? "var(--red)" : "var(--green)" },
          { k: "Department pages", v: String(deptThin), suffix: " of " + deptPages.length, h: "under " + FLOOR + " reviews — named pays $20", color: "var(--cyan)" },
        ].map(function(c) {
          return (
            <div key={c.k} style={{ background: "var(--bg-card)", padding: "15px 17px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)" }}>{c.k}</div>
              <div style={Object.assign({ fontSize: 27, fontWeight: 700, color: c.color, lineHeight: 1.05, marginTop: 7, letterSpacing: "-.022em" }, mono)}>
                {c.v}{c.suffix ? <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-secondary)" }}>{c.suffix}</span> : null}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 5 }}>{c.h}</div>
            </div>
          );
        })}
      </div>

      {/* ── per-store standing ── */}
      <div>
        <H2 note={"5★ only · floor of " + FLOOR}>Where each store stands</H2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(282px, 1fr))", gap: 14 }}>
          {stores.map(function(s) {
            var c = STORE_COLOR[s.store] || "var(--purple)";
            var gained = s.gained_this_month;
            var f = fiveStarFor(s.store, gained);
            var est = f.n;
            var tier = tierFor(est);
            var pct = est == null ? 0 : Math.min(100, 100 * est / FLOOR);
            var pageCount = (s.listings || []).length;
            var thin = (s.listings || []).filter(function(l) { return l.listing_type !== "main" && (l.total_reviews || 0) < FLOOR; }).length;
            return (
              <div key={s.store} style={card({ position: "relative", overflow: "hidden", paddingTop: 19 })}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: c }} />
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: c }}>{cap(s.store)}</span>
                  {est == null ? <Chip color="var(--text-muted)">not counted yet</Chip>
                    : tier ? <Chip color="var(--green)">{tier.at}+ reached</Chip>
                    : <Chip color="var(--yellow)">{(FLOOR - est).toFixed(1)} short</Chip>}
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 9, marginTop: 12 }}>
                  <span style={Object.assign({ fontSize: 36, fontWeight: 700, color: "var(--text-primary)", lineHeight: .9, letterSpacing: "-.03em" }, mono)}>
                    {est == null ? "—" : est}
                  </span>
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)", paddingBottom: 3 }}>
                    {f.exact ? "5★ counted" : "5★ est."} of {gained == null ? "—" : gained} reviews
                  </span>
                  {f.exact ? null : <Chip color="var(--yellow)">estimate</Chip>}
                </div>
                <div style={{ position: "relative", height: 9, borderRadius: 5, background: "var(--bg-card-inner)", marginTop: 13 }}>
                  <div style={{ height: "100%", width: pct + "%", borderRadius: 5, background: c, transition: "width .8s cubic-bezier(.2,.85,.25,1)" }} />
                  <span style={{ position: "absolute", top: -4, right: 0, width: 1, height: 17, background: "var(--border-heavy)" }} />
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 24 }}>
                  Rating <b style={{ color: "var(--text-primary)" }}>{s.main_rating == null ? "—" : s.main_rating}</b> on{" "}
                  <b style={{ color: "var(--text-primary)" }}>{s.main_total == null ? "—" : s.main_total.toLocaleString()}</b> main-page reviews.
                </div>
                <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid var(--border-light)", fontSize: 11, color: "var(--text-muted)" }}>
                  {pageCount} pages · {thin} under {FLOOR} reviews
                </div>
                {/* Matt counts five-stars in the Business Profile inbox and types
                    them here. Two numbers a store, once a month - the only exact
                    source there is until the Business Profile API is connected. */}
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-light)" }}>
                  {tableMissing ? (
                    <div style={{ fontSize: 11, color: "var(--yellow)" }}>
                      Entry unavailable &mdash; run <span style={{ fontFamily: mono.fontFamily }}>sql/migration_review_five_star.sql</span>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase",
                        color: "var(--text-muted)", marginBottom: 7 }}>
                        Counted from Business Profile &middot; {period}
                      </div>
                      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                        {[["five", "5\u2605", f.row ? f.row.five_star_count : ""], ["bad", "1\u2605/2\u2605", f.row ? f.row.one_two_star_count : ""]].map(function(fld) {
                          var val = (entry[s.store] || {})[fld[0]];
                          return (
                            <label key={fld[0]} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
                              {fld[1]}
                              <input type="number" min="0" step="1"
                                value={val === undefined ? (fld[2] === null || fld[2] === undefined ? "" : fld[2]) : val}
                                onChange={function(ev) {
                                  var v = ev.target.value;
                                  setEntry(function(x) { var n = Object.assign({}, x); n[s.store] = Object.assign({}, n[s.store]); n[s.store][fld[0]] = v; return n; });
                                }}
                                style={Object.assign({ width: 58, padding: "5px 7px", borderRadius: 7, fontSize: 12.5,
                                  background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border)" }, mono)} />
                            </label>
                          );
                        })}
                        <button onClick={function() { saveFiveStar(s.store); }} disabled={saving === s.store}
                          style={{ fontSize: 11, padding: "5px 11px", borderRadius: 7, cursor: saving === s.store ? "default" : "pointer",
                            background: "var(--bg-card-inner)", color: "var(--cyan)", border: "1px solid " + tint("var(--cyan)", 45),
                            fontFamily: "'Space Grotesk', sans-serif" }}>
                          {saving === s.store ? "Saving\u2026" : f.row ? "Update" : "Save"}
                        </button>
                      </div>
                      {saveMsg && saveMsg.store === s.store ? (
                        <div style={{ fontSize: 11, marginTop: 6, color: saveMsg.ok ? "var(--green)" : "var(--red)" }}>{saveMsg.text}</div>
                      ) : null}
                      {f.row ? (
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6 }}>
                          Entered by {f.row.entered_by || "unknown"}
                          {f.row.updated_at ? " \u00b7 " + String(f.row.updated_at).slice(0, 10) : ""}
                          {f.row.one_two_star_count > 0 ? " \u00b7 penalty would apply" : ""}
                        </div>
                      ) : null}
                    </>
                  )}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-light)" }}>
                    {tier ? "Would pay $" + tier.pays + " each \u2014 " : "At 10 five-star, $50 each \u2014 "}
                    <b style={{ color: "var(--text-primary)" }}>not payable, bonus not approved</b>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 12 }}>
          Totals are exact. The five-star split is <b style={{ color: "var(--text-primary)" }}>estimated</b>
          {share != null ? " at " + (100 * share).toFixed(1) + "%" : ""} and the bonus is not approved, so no store card
          shows money owed.
        </div>
      </div>

      {/* ── every page ── */}
      <div>
        <H2 note={deptThin + " of " + deptPages.length + " department pages under " + FLOOR}>Every page</H2>
        <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg-card)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 680, fontSize: 13 }}>
            <thead>
              <tr>
                {["Page", "Rating", "Total", "This month", "Named pays", "Review link"].map(function(h, i) {
                  return <th key={h} style={{ textAlign: i >= 1 && i <= 3 ? "right" : "left", fontSize: 9.5, fontWeight: 700,
                    letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)", padding: "11px 13px",
                    borderBottom: "1px solid var(--border)", whiteSpace: "nowrap", background: "var(--bg-card-inner)" }}>{h}</th>;
                })}
              </tr>
            </thead>
            <tbody>
              {allPages.map(function(p) {
                var c = STORE_COLOR[p.store] || "var(--purple)";
                var thin = p.listing_type !== "main" && (p.total_reviews || 0) < FLOOR;
                return (
                  <tr key={p.id}>
                    <td style={{ padding: "10px 13px", borderBottom: "1px solid var(--border-light)" }}>
                      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", marginRight: 8, background: c, verticalAlign: 1 }} />
                      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{cap(p.store)}</span>{" "}
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· {TYPE_LABEL[p.listing_type] || p.listing_type}</span>
                      {p.note ? <div style={{ fontSize: 10.5, color: "var(--yellow)", marginTop: 2 }}>{p.note}</div> : null}
                    </td>
                    <td style={Object.assign({ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right" }, mono)}>
                      {p.rating == null ? <span style={{ color: "var(--text-muted)" }}>—</span>
                        : <span style={{ color: p.rating < 4 ? "var(--red)" : "var(--yellow)", fontWeight: 700 }}>{p.rating}</span>}
                    </td>
                    <td style={Object.assign({ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right", color: "var(--text-body)" }, mono)}>
                      {p.total_reviews == null ? "—" : p.total_reviews.toLocaleString()}
                    </td>
                    <td style={Object.assign({ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right", color: "var(--text-body)" }, mono)}>
                      {p.gained_this_month == null ? <span style={{ color: "var(--text-muted)" }}>—</span>
                        : (p.gained_this_month > 0 ? "+" + p.gained_this_month : p.gained_this_month)}
                    </td>
                    <td style={{ padding: "10px 13px", borderBottom: "1px solid var(--border-light)" }}>
                      {thin ? <Chip color="var(--cyan)">$20</Chip>
                        : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>$10</span>}
                    </td>
                    <td style={{ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right" }}>
                      {p.write_review_url ? (
                        <button
                          onClick={function() {
                            // The free lever: send the customer to the RIGHT page.
                            // The route owns the URL shape; this only copies it.
                            setCopied(p.id);
                            if (navigator.clipboard) navigator.clipboard.writeText(p.write_review_url).catch(function() {});
                            setTimeout(function() { setCopied(null); }, 1400);
                          }}
                          style={{ fontSize: 11, padding: "4px 9px", borderRadius: 6, cursor: "pointer",
                            background: "var(--bg-card-inner)", color: copied === p.id ? "var(--green)" : "var(--text-primary)",
                            border: "1px solid " + (copied === p.id ? tint("var(--green)", 50) : "var(--border)"),
                            fontFamily: "'Space Grotesk', sans-serif" }}
                        >{copied === p.id ? "Copied" : "Copy"}</button>
                      ) : <span style={{ fontSize: 11, color: "var(--yellow)" }}>no place id</span>}
                    </td>
                  </tr>
                );
              })}
              {competitors.map(function(p) {
                return (
                  <tr key={p.id} style={{ opacity: .72 }}>
                    <td style={{ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", boxShadow: "inset 2px 0 0 var(--text-muted)" }}>
                      <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", marginRight: 8, background: "var(--text-muted)", verticalAlign: 1 }} />
                      <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{p.label || cap(p.store)}</span>{" "}
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>· competitor, watched</span>
                    </td>
                    <td style={Object.assign({ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right", color: "var(--yellow)", fontWeight: 700 }, mono)}>{p.rating == null ? "—" : p.rating}</td>
                    <td style={Object.assign({ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right", color: "var(--text-body)" }, mono)}>{p.total_reviews == null ? "—" : p.total_reviews.toLocaleString()}</td>
                    <td style={Object.assign({ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right", color: "var(--text-body)" }, mono)}>{p.gained_this_month == null ? "—" : (p.gained_this_month > 0 ? "+" + p.gained_this_month : p.gained_this_month)}</td>
                    <td style={{ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", fontSize: 11, color: "var(--text-muted)" }}>—</td>
                    <td style={{ padding: "10px 13px", borderBottom: "1px solid var(--border-light)", textAlign: "right", color: "var(--text-muted)" }}>—</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 12 }}>
          {deptPages.length} department pages hold <b style={{ color: "var(--text-primary)" }}>{deptTotal} reviews between them</b>.
          The main pages hold <b style={{ color: "var(--text-primary)" }}>{mainTotal.toLocaleString()}</b>. Those pages are new,
          so that is a cold start rather than neglect — but they are where a handful of reviews decides whether we appear at all.
        </div>
      </div>

      {/* ── credit queue ── */}
      <div>
        <H2 note="proposed from review text — confirmed in Business Profile">Credits to confirm</H2>
        {items.length === 0 ? (
          <div style={card({ fontSize: 13, color: "var(--text-secondary)" })}>No review text captured yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 9 }}>
            {items.map(function(it) {
              var pays = (it.proposed_credits || []).filter(function(c) { return c.amount > 0; });
              var named = (it.proposed_credits || []);
              var done = !!acted[it.id];
              var edge = it.rating === 1 || it.rating === 2 ? "var(--red)"
                : it.counts_for_tier ? "var(--green)" : "var(--border-heavy)";
              return (
                <div key={it.id} style={card({ borderLeft: "3px solid " + edge, opacity: done ? .45 : 1,
                  display: "grid", gap: 8, padding: "13px 15px", transition: "opacity .25s" })}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
                    <span style={{ color: it.rating != null && it.rating < 3 ? "var(--red)" : "var(--yellow)", fontWeight: 700, fontSize: 12, letterSpacing: -1 }}>
                      {it.rating == null ? "—" : "★".repeat(it.rating)}
                    </span>
                    <span style={{ padding: "1px 7px", borderRadius: 5, background: "var(--bg-card-inner)",
                      border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 10.5 }}>
                      {cap(it.store)} · {TYPE_LABEL[it.listing_type] || it.listing_type}
                    </span>
                    {it.page_under_threshold ? <Chip color="var(--cyan)">page under {FLOOR}</Chip> : null}
                    {!it.counts_for_tier ? <Chip color="var(--text-muted)">{it.why_not}</Chip> : null}
                    {it.posted_at ? <span>{String(it.posted_at).slice(0, 10)}</span> : null}
                  </div>
                  {it.text ? (
                    <p style={{ margin: 0, fontSize: 13, color: "var(--text-body)" }}>
                      &ldquo;{it.text.length > 320 ? it.text.slice(0, 320) + "…" : it.text}&rdquo;
                    </p>
                  ) : null}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, color: pays.length ? "var(--cyan)" : "var(--text-muted)" }}>
                      {named.length === 0
                        ? "→ names nobody on the roster — counts toward the store total only"
                        : named.map(function(c) {
                            return c.name + (c.amount > 0 ? " · $" + c.amount : " · no credit (" + c.blocked + ")");
                          }).join(" · ")}
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      {pays.length && !done ? (
                        <button onClick={function() { setActed(function(a) { var n = Object.assign({}, a); n[it.id] = "ok"; return n; }); }}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: "pointer",
                            background: "var(--bg-card-inner)", color: "var(--green)", border: "1px solid " + tint("var(--green)", 42),
                            fontFamily: "'Space Grotesk', sans-serif" }}>Confirm</button>
                      ) : null}
                      {!done ? (
                        <button onClick={function() { setActed(function(a) { var n = Object.assign({}, a); n[it.id] = "no"; return n; }); }}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 7, cursor: "pointer",
                            background: "var(--bg-card-inner)", color: "var(--text-secondary)", border: "1px solid var(--border)",
                            fontFamily: "'Space Grotesk', sans-serif" }}>{pays.length ? "Not them" : "Acknowledge"}</button>
                      ) : <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{acted[it.id] === "ok" ? "confirmed" : "acknowledged"}</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 12 }}>
          {credits && credits.rating_mix ? (
            <>Captured mix: {[5, 4, 3, 2, 1].map(function(r) { return credits.rating_mix[r] + " × " + r + "★"; }).join(" · ")}.{" "}
            Only the 5★ ones count for anything.{" "}</>
          ) : null}
          <b style={{ color: "var(--text-primary)" }}>Confirming here records nothing yet</b> — the bonus is not approved and
          no ledger row is written. {credits ? credits.text_coverage : ""}
        </div>
      </div>

      {/* ── the rules, collapsed ── */}
      {[
        { id: "rules", title: "How the bonus would work — designed, not approved", rows: [
          ["Only 5★ reviews count", "A 4★ or 3★ counts for nothing — not toward the tier, no named credit. On the captured sample that removes about one review in five, so ten five-star takes roughly 12.4 reviews and the real bar is 24% higher than it looks.", "5★ or nothing"],
          ["Store tier", "10 / 15 / 20 five-star reviews in the month across that store's four pages. Highest tier only, paid to each eligible person — not split.", "$50 / $75 / $100"],
          ["10 pays, tell them 13", "Ten is a small number, so luck matters. A store genuinely at ten a month still lands at nine or fewer 46% of the time; at thirteen it misses twice a year. The count is exact — this is month-to-month variation, not measurement error.", "by design"],
          ["Named in the review", "The customer writes your name. Paid to the person, outside the tier, after a person confirms it.", "$10"],
          ["Named on a page under 10 reviews", "Threshold is TOTAL reviews, not five-star — it asks whether a page is established. Retires itself as pages fill, so the premium can never cost more than $750 in total.", "$20"],
          ["Unnamed review", "Counts one toward the store tier, nothing individually. With the 0–3 day posting lag there is only one candidate tech 6% of the time, so it cannot be attributed honestly.", "store credit only"],
          ["A 1★ or 2★ lands", "The first halves the store's tier that month, a second zeroes it. Named bonuses survive. Flagged for Eric: under 5★-only a bad review already earns nothing, so the halving is a second punishment.", "½ → $0"],
          ["Which store you count for", "The one where you logged the most hours that month, same rule as the answer-rate bonus. Duncan worked all three in October and counts once.", "most hours"],
          ["Tier multiplier", "Does not apply. Gold and Platinum multiply per-repair commission only — this is flat, like the answer-rate and streak bonuses.", "none"],
        ] },
      ].map(function(p) {
        var open = openPanel === p.id;
        return (
          <div key={p.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 13, overflow: "hidden" }}>
            <button onClick={function() { setOpenPanel(open ? null : p.id); }} aria-expanded={open}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                padding: "14px 17px", border: "none", background: "transparent", cursor: "pointer",
                fontSize: 13, fontWeight: 600, color: "var(--text-primary)", textAlign: "left",
                fontFamily: "'Space Grotesk', sans-serif" }}>
              <span>{p.title}</span>
              <span style={{ color: "var(--text-muted)", transform: open ? "rotate(90deg)" : "none", transition: "transform .22s" }}>▸</span>
            </button>
            {open ? (
              <div style={{ padding: "2px 17px 18px", borderTop: "1px solid var(--border-light)" }}>
                {p.rows.map(function(r) {
                  return (
                    <div key={r[0]} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "baseline",
                      padding: "11px 0", borderBottom: "1px solid var(--border-light)" }}>
                      <div>
                        <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600 }}>{r[0]}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3 }}>{r[1]}</div>
                      </div>
                      <div style={{ fontSize: r[2].indexOf("$") === 0 ? 14 : 12, fontWeight: r[2].indexOf("$") === 0 ? 700 : 500,
                        color: r[2].indexOf("$") === 0 ? "var(--text-primary)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{r[2]}</div>
                    </div>
                  );
                })}
                <div style={card({ marginTop: 16, background: tint("var(--red)", 7), borderColor: tint("var(--red)", 26), fontSize: 12.5 })}>
                  <b style={{ color: "var(--text-primary)" }}>Never pair a review request with a discount.</b> Google asks
                  reviewers whether they were incentivised and suppresses the review if they say yes. This pays the employee,
                  not the customer, which is the safe side of that line — and it only stays safe if nobody crosses it.
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

      <div style={{ fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: 15, lineHeight: 1.6 }}>
        Review counts come from Google Places and are exact; a <b style={{ color: "var(--text-primary)" }}>gain</b> is always
        the difference between two snapshots, never a stored number, so it cannot drift from Google. Review{" "}
        <b style={{ color: "var(--text-primary)" }}>text</b> is a relevance sample, not the full set, which is why name credits
        are proposed here and confirmed in Business Profile.{" "}
        {tracking && tracking.listings_without_place_id ? (
          <b style={{ color: "var(--yellow)" }}>{tracking.listings_without_place_id} listing(s) still have no place id and cannot sync. </b>
        ) : null}
        <b style={{ color: "var(--text-primary)" }}>Nothing on this screen is wired to payroll.</b>
      </div>
    </div>
  );
}

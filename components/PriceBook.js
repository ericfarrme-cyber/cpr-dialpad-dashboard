// Price Book — the repair price cheat sheet as a page. Built for one job: a
// customer names a device on the phone and the agent needs the number in five
// seconds while still talking. Search-first, tiers shown as choices, the
// turnaround ladder shown as a closing tool. Admins (Eric, Matt) edit in place,
// singly or in bulk, and every change is recorded with a date so Price & Demand
// can measure what it did.
"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/components/AuthProvider";
import { ThemeToggle } from "@/components/ThemeProvider";
import { QUOTE_REASONS } from "@/lib/quote-reasons";
import { resolveModel } from "@/lib/device-model";

var FAMILY_LABEL = { all: "All", phone: "Phones", tablet: "Tablets", console: "Consoles", computer: "Computers", service: "Services" };
var FAMILY_ORDER = ["all", "phone", "console", "tablet", "computer", "service"];
var QUALITY_TIERS = ["LCD", "OLED", "OEM", "Digitizer"];
var FLAG_LABEL = {
  solder_or_order: "part ordered / solder",
  non_consigned_part: "non-consigned part",
  supplier_choice: "supplier choice",
};

var money = function(n) { return n === null || n === undefined ? "—" : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
var num = function(v) { if (v === null || v === undefined || v === "") return null; var n = parseFloat(v); return isFinite(n) ? n : null; };
// A device's generation, for newest-first ordering and "nearest model" lookups.
var deviceGen = function(d) {
  var s = String(d).toLowerCase();
  var y = s.match(/\b(20\d\d)\b/);                       // MacBooks carry a year
  if (y) return parseInt(y[1], 10);
  var g = s.match(/\b(\d{1,2})(?:st|nd|rd|th)\s*gen/);   // "iPad 10th Gen", "iPad Pro 11" 4th gen"
  if (g) return parseInt(g[1], 10);
  if (/\bx[sr]?\b/.test(s) && /iphone/.test(s)) return 10;
  if (/iphone\s+air\b/.test(s)) return 17;              // launched alongside the 17
  g = s.match(/(\d{1,2})(?:st|nd|rd|th|e)?\b/);          // "16e" is a 16
  return g ? parseInt(g[1], 10) : -1;
};
// Size / tier within a generation: Pro Max & Ultra, Pro, Plus, Air, base, e / mini / FE.
var deviceVariant = function(d) {
  var s = String(d).toLowerCase();
  if (/pro\s*max|ultra|\bmax\b/.test(s)) return 0;
  if (/\bpro\b/.test(s)) return 1;
  if (/\bplus\b|\+/.test(s)) return 2;
  if (/\bair\b/.test(s)) return 3;
  if (/\d+e\b|\bmini\b|\bfe\b|\blite\b/.test(s)) return 5;
  return 4;
};
var whenStr = function(iso) { if (!iso) return ""; var d = new Date(iso); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
var isLadder = function(tiers) { return tiers.length > 1 && tiers.every(function(t) { return /day/i.test(t.tier || ""); }); };
var tok = function(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9+"\s.-]/g, " ").split(/\s+/).filter(Boolean); };

// What agents actually type is shorthand — "ps5", "series x", "s23" — and the
// sheet spells those out ("Play Station 5 (all models)"). Without these the
// most common console search found nothing.
var aliasesFor = function(canonical, device) {
  var out = [];
  var c = String(canonical || "");
  var m;
  if ((m = c.match(/^PlayStation (\d)/))) out.push("ps" + m[1], "playstation", "sony");
  if ((m = c.match(/^Xbox Series ([XS])/))) out.push("series" + m[1].toLowerCase(), "xbox" + m[1].toLowerCase(), "microsoft");
  if (/^Xbox/.test(c)) out.push("xbox", "microsoft");
  if (/^Galaxy/.test(c)) out.push("samsung", "galaxy");
  if (/^Nintendo/.test(c)) out.push("nintendo", "switch");
  if (/^iPhone|^iPad|^MacBook|^iMac/.test(c)) out.push("apple");
  if (/^Pixel/.test(c)) out.push("google", "pixel");
  if (/macbook/i.test(device)) out.push("mac", "laptop");
  return out;
};

// ── small pieces ─────────────────────────────────────────────────────────────
function Chip({ active, onClick, children, tone }) {
  var c = tone || "var(--purple)";
  return (
    <button onClick={onClick} style={{
      padding: "6px 13px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontWeight: 700,
      border: "1px solid " + (active ? c : "var(--border)"),
      background: active ? "#7B2FFF1A" : "transparent",
      color: active ? c : "var(--text-secondary)", transition: "all .18s ease", whiteSpace: "nowrap",
    }}>{children}</button>
  );
}
function Tag({ children, tone }) {
  var c = tone || "var(--text-muted)";
  return <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", padding: "2px 7px", borderRadius: 4, border: "1px solid " + c + "55", color: c, whiteSpace: "nowrap" }}>{children}</span>;
}

// What actually happened at the register for this price. Framed as ACCEPTANCE,
// never as an average — the point is to argue for holding the line.
function Acceptance({ a, setPrice, isAdmin }) {
  if (!a || !a.sold) return null;
  var low = a.sold >= 10 && a.full_price_rate !== null && a.full_price_rate < 20;
  var mismatch = a.pos_list !== null && setPrice !== null && Math.abs(a.pos_list - setPrice) >= 1;
  return (
    <div style={{ marginTop: 7, display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ fontSize: 11, color: low ? "var(--orange)" : "var(--text-secondary)", fontWeight: low ? 700 : 500 }}>
        {a.full_price} of {a.sold} paid full price
        {low && <span> — nobody has held this one. Aim high.</span>}
      </div>
      {mismatch && (
        <div style={{ fontSize: 10.5, color: "var(--yellow)" }}>
          register rings <strong>{money(a.pos_list)}</strong> on {a.pos_list_share}% of jobs — not what this sheet says
        </div>
      )}
      {isAdmin && a.avg_collected !== undefined && a.avg_collected !== null && (
        <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>admin: avg collected {money(a.avg_collected)}</div>
      )}
    </div>
  );
}

// One price cell: the number to say out loud, the floor beneath it, and what
// the customer will ask next.
function PriceCell({ r, isAdmin, editMode, selected, onToggle, onInline, emphasis, onBook }) {
  var [editing, setEditing] = useState(false);
  var [val, setVal] = useState("");
  var flags = r.flags || [];
  var off = r.active === false;
  return (
    <div onClick={editMode ? function() { onToggle(r.id); } : undefined}
      style={{
        flex: "1 1 150px", minWidth: 140, padding: "11px 13px", borderRadius: 10,
        background: selected ? "#7B2FFF14" : "var(--bg-card-inner)",
        border: "1px solid " + (selected ? "var(--purple)" : off ? "var(--red)" : emphasis ? "var(--border)" : "var(--border-light)"),
        borderStyle: off ? "dashed" : "solid", opacity: off && !selected ? 0.55 : 1,
        cursor: editMode ? "pointer" : "default", transition: "border-color .15s ease, background .15s ease, opacity .15s ease", position: "relative",
      }}>
      {off && <div style={{ marginBottom: 4 }}><Tag tone="var(--red)">not offered</Tag></div>}
      {editMode && (
        <span style={{ position: "absolute", top: 8, right: 8, width: 14, height: 14, borderRadius: 4, border: "1.5px solid " + (selected ? "var(--purple)" : "var(--border-heavy)"), background: selected ? "var(--purple)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 10, fontWeight: 900 }}>{selected ? "✓" : ""}</span>
      )}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        {r.tier && <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--purple)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{r.tier}</span>}
        {r.turnaround && <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{r.turnaround}</span>}
      </div>
      {editing ? (
        <input autoFocus value={val} onChange={function(e) { setVal(e.target.value); }}
          onClick={function(e) { e.stopPropagation(); }}
          onKeyDown={function(e) {
            if (e.key === "Enter") { onInline(r, val); setEditing(false); }
            if (e.key === "Escape") setEditing(false);
          }}
          style={{ marginTop: 4, width: "100%", fontSize: 20, fontWeight: 800, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--purple)", background: "var(--bg-input)", color: "var(--text-primary)" }} />
      ) : (
        <div onDoubleClick={isAdmin ? function(e) { e.stopPropagation(); setVal(r.set_price === null ? "" : String(r.set_price)); setEditing(true); } : undefined}
          title={isAdmin ? "Double-click to edit" : undefined}
          style={{ marginTop: 3, fontSize: 24, fontWeight: 800, color: r.set_price === null ? "var(--text-muted)" : "var(--text-primary)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>
          {r.set_price === null ? "quote on inspection" : money(r.set_price)}
        </div>
      )}
      {r.floor_price !== null && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
          as low as <strong style={{ color: "var(--text-secondary)" }}>{money(r.floor_price)}</strong>
          {r.max_discount !== null && r.max_discount !== undefined && <span> · max discount {r.max_discount > 0 ? money(r.max_discount) : "none"}</span>}
        </div>
      )}
      {r.floor_price === null && r.max_discount !== null && r.max_discount !== undefined && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>max discount {r.max_discount > 0 ? money(r.max_discount) : "none"}</div>
      )}
      {(flags.length > 0) && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
          {flags.map(function(f) { return <Tag key={f} tone={f === "non_consigned_part" ? "var(--orange)" : "var(--cyan)"}>{FLAG_LABEL[f] || f}</Tag>; })}
        </div>
      )}
      {r.note && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.4 }}>{r.note}</div>}
      <Acceptance a={r.actuals} setPrice={r.set_price} isAdmin={isAdmin} />
      {r.quotes && r.quotes.given > 0 && (
        <div style={{ fontSize: 11, marginTop: 4, color: r.quotes.at_sheet === r.quotes.given ? "var(--green)" : "var(--text-secondary)", fontWeight: r.quotes.at_sheet === r.quotes.given ? 700 : 500 }}>
          {r.quotes.at_sheet} of {r.quotes.given} quote{r.quotes.given === 1 ? "" : "s"} booked at full price this month
          {r.quotes.showed + r.quotes.no_show > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> · {r.quotes.showed} showed{r.quotes.no_show ? ", " + r.quotes.no_show + " didn’t" : ""}</span>}
        </div>
      )}
      {r.actuals_other && r.actuals_other.sold > 0 && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--yellow)" }}>
          register also rings <strong>{money(r.actuals_other.pos_list)}</strong> on {r.actuals_other.sold} job{r.actuals_other.sold === 1 ? "" : "s"} — a line this sheet doesn&apos;t have
        </div>
      )}
      {r.insurance && r.insurance.sold > 0 && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--text-muted)" }}>
          + {r.insurance.sold} insurance claim{r.insurance.sold === 1 ? "" : "s"} · insurer paid ~{money(r.insurance.avg_price)} — not a quote
        </div>
      )}
      {isAdmin && r.updated_by && !String(r.updated_by).startsWith("import:") && (
        <div style={{ fontSize: 9.5, color: "var(--text-faint)", marginTop: 6 }}>edited {whenStr(r.updated_at)} · {r.updated_by}</div>
      )}
      {/* The quote becomes the appointment: the customer said yes, book it here. */}
      {!editMode && !off && onBook && (
        <button onClick={function(e) { e.stopPropagation(); onBook(r); }}
          style={{ marginTop: 9, width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--purple)", background: "transparent", color: "var(--purple)", fontSize: 11.5, fontWeight: 800, cursor: "pointer", transition: "background .15s ease" }}
          onMouseEnter={function(e) { e.currentTarget.style.background = "#7B2FFF1A"; }} onMouseLeave={function(e) { e.currentTarget.style.background = "transparent"; }}>
          Book this quote →
        </button>
      )}
    </div>
  );
}

// The turnaround ladder is the closing tool: when the price is too much, offer
// time instead of a discount.
function Ladder({ tiers, isAdmin, editMode, selectedIds, onToggle, onInline, onBook }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 6 }}>Same repair, priced by how soon they need it — offer the slower tier before offering a discount.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tiers.map(function(r, i) {
          return <PriceCell key={r.id} r={r} isAdmin={isAdmin} editMode={editMode} selected={!!selectedIds[r.id]} onToggle={onToggle} onInline={onInline} emphasis={i === 0} onBook={onBook} />;
        })}
      </div>
    </div>
  );
}

// Edit one device in one pass: every repair and tier it has, prices and part
// costs side by side, offered on or off, one reason, one save. Matt's first
// real session was ~70 single-row edits over three hours and half of them
// carried no reason — this is that session as one form per device.
function DeviceEditor({ device, rows, onSave, onCancel, allRows, onAddRepairs }) {
  // New repairs for this device (Matt: the 16e had Screen only and nowhere to
  // add Battery). Each suggestion comes from the nearest model in the same
  // line that already offers that repair — "iPhone 16 Battery is $99.99".
  var [adding, setAdding] = useState([]);
  var [draft, setDraft] = useState({ repair: "", tier: "", set_price: "", turnaround: "", part_price: "" });
  var repairNames = useMemo(function() {
    var c = {};
    (allRows || []).forEach(function(r) { c[r.repair] = (c[r.repair] || 0) + 1; });
    var fam = rows[0] && rows[0].family;
    var inFam = {};
    (allRows || []).forEach(function(r) { if (r.family === fam) inFam[r.repair] = 1; });
    return Object.keys(c).sort(function(a, b) { return (inFam[b] || 0) - (inFam[a] || 0) || c[b] - c[a]; });
  }, [allRows, rows]);
  function suggestionFor(repair, tier) {
    if (!repair) return null;
    var line = rows[0] ? rows[0].model_group : null;
    var myGen = deviceGen(device);
    var cands = (allRows || []).filter(function(r) {
      return r.device !== device && r.active !== false && r.repair === repair && (r.tier || "") === (tier || "") && r.set_price !== null && (!line || r.model_group === line);
    });
    if (!cands.length) return null;
    // Nearest generation first, then the closest size — a 16e borrows from the
    // plain 15, not the 15 Pro Max.
    var myVar = deviceVariant(device);
    cands.sort(function(a, b) {
      return (Math.abs(deviceGen(a.device) - myGen) - Math.abs(deviceGen(b.device) - myGen))
        || (Math.abs(deviceVariant(a.device) - myVar) - Math.abs(deviceVariant(b.device) - myVar));
    });
    return cands[0];
  }
  var sugg = suggestionFor(draft.repair, draft.tier);
  var tiersForRepair = useMemo(function() {
    var t = {};
    (allRows || []).forEach(function(r) { if (r.repair === draft.repair && r.tier) t[r.tier] = 1; });
    return Object.keys(t);
  }, [allRows, draft.repair]);
  var draftClash = rows.some(function(r) { return r.repair === draft.repair && (r.tier || "") === (draft.tier || ""); })
    || adding.some(function(a) { return a.repair === draft.repair && (a.tier || "") === (draft.tier || ""); });
  var draftPrice = draft.set_price !== "" ? parseFloat(draft.set_price) : sugg ? num(sugg.set_price) : NaN;
  var draftOk = !!draft.repair.trim() && isFinite(draftPrice) && draftPrice >= 0 && !draftClash;
  function addDraft() {
    if (!draftOk) return;
    setAdding(adding.concat([{
      repair: draft.repair.trim(), tier: draft.tier.trim() || null, set_price: draftPrice,
      turnaround: draft.turnaround.trim() || (sugg && sugg.turnaround) || null,
      part_price: draft.part_price !== "" ? parseFloat(draft.part_price) : null,
      from: draft.set_price === "" && sugg ? sugg.device : null,
    }]));
    setDraft({ repair: "", tier: "", set_price: "", turnaround: "", part_price: "" });
  }

  var [vals, setVals] = useState(function() {
    var v = {};
    rows.forEach(function(r) { v[r.id] = { set_price: r.set_price === null ? "" : String(r.set_price), part_price: r.part_price === null ? "" : String(r.part_price), active: r.active !== false }; });
    return v;
  });
  var [reason, setReason] = useState("");
  var [busy, setBusy] = useState(false);
  function set(id, k, val) { setVals(function(p) { var n = Object.assign({}, p); n[id] = Object.assign({}, n[id], {}); n[id][k] = val; return n; }); }

  // Only what actually moved, so the ledger records changes and not a re-save.
  var changes = rows.map(function(r) {
    var v = vals[r.id] || {};
    var c = { id: r.id };
    var sp = v.set_price === "" ? null : parseFloat(v.set_price);
    if (sp !== null && isFinite(sp) && (r.set_price === null || Math.abs(sp - num(r.set_price)) >= 0.005)) c.set_price = sp;
    var pp = v.part_price === "" ? null : parseFloat(v.part_price);
    if (pp !== null && isFinite(pp) && (r.part_price === null || Math.abs(pp - num(r.part_price)) >= 0.005)) c.part_price = pp;
    if (!!v.active !== (r.active !== false)) c.active = !!v.active;
    return Object.keys(c).length > 1 ? c : null;
  }).filter(Boolean);
  var total = changes.length + adding.length;
  var canSave = total > 0 && reason.trim().length > 0 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try { await onSave(changes, adding, reason.trim()); } finally { setBusy(false); }
  }

  var cell = { padding: "6px 8px", borderTop: "1px solid var(--border-light)", fontSize: 12 };
  var priceIn = { width: 88, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12.5, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" };
  return (
    <div onClick={function(e) { e.stopPropagation(); }} style={{ border: "1px solid var(--purple)", borderRadius: 10, overflow: "hidden", animation: "pbExpand .2s ease both" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr style={{ color: "var(--text-muted)", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <th style={{ textAlign: "left", padding: "7px 8px", fontWeight: 700 }}>Repair</th>
          <th style={{ textAlign: "right", padding: "7px 8px", fontWeight: 700 }}>Price</th>
          <th style={{ textAlign: "right", padding: "7px 8px", fontWeight: 700 }}>Part cost</th>
          <th style={{ textAlign: "right", padding: "7px 8px", fontWeight: 700 }}>Floor</th>
          <th style={{ textAlign: "center", padding: "7px 8px", fontWeight: 700 }}>Offered</th>
        </tr></thead>
        <tbody>
          {rows.map(function(r) {
            var v = vals[r.id] || {};
            var moved = changes.some(function(c) { return c.id === r.id; });
            return (
              <tr key={r.id} style={{ background: moved ? "#7B2FFF0D" : "transparent", opacity: v.active ? 1 : 0.6 }}>
                <td style={Object.assign({}, cell, { color: "var(--text-body)" })}>
                  {r.repair}{r.tier ? <span style={{ color: "var(--purple)", fontWeight: 700 }}> · {r.tier}</span> : null}
                  {r.turnaround ? <span style={{ color: "var(--text-muted)" }}> · {r.turnaround}</span> : null}
                </td>
                <td style={Object.assign({}, cell, { textAlign: "right" })}>
                  <input value={v.set_price} onChange={function(e) { set(r.id, "set_price", e.target.value); }} inputMode="decimal" placeholder="—" style={priceIn} />
                </td>
                <td style={Object.assign({}, cell, { textAlign: "right" })}>
                  <input value={v.part_price} onChange={function(e) { set(r.id, "part_price", e.target.value); }} inputMode="decimal" placeholder="—" style={Object.assign({}, priceIn, { width: 76, fontWeight: 500 })} />
                </td>
                <td style={Object.assign({}, cell, { textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" })}>
                  {r.floor_price === null ? "—" : money(r.floor_price)}
                  {r.floor_rule ? <div style={{ fontSize: 9.5, color: "var(--text-faint)" }}>{r.floor_rule}</div> : null}
                </td>
                <td style={Object.assign({}, cell, { textAlign: "center" })}>
                  <button onClick={function() { set(r.id, "active", !v.active); }} title={v.active ? "Offered — click to stop offering" : "Not offered — click to offer again"}
                    style={{ width: 34, height: 19, borderRadius: 999, border: "none", cursor: "pointer", background: v.active ? "var(--green)" : "var(--border-heavy)", position: "relative", transition: "background .15s ease" }}>
                    <span style={{ position: "absolute", top: 2, left: v.active ? 17 : 2, width: 15, height: 15, borderRadius: "50%", background: "#fff", transition: "left .15s ease" }} />
                  </button>
                </td>
              </tr>
            );
          })}
          {adding.map(function(a, i) {
            return (
              <tr key={"new" + i} style={{ background: "#00D4FF0F", animation: "pbExpand .2s ease both" }}>
                <td style={Object.assign({}, cell, { color: "var(--text-body)" })}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: "var(--cyan)", letterSpacing: "0.06em", marginRight: 6 }}>NEW</span>
                  {a.repair}{a.tier ? <span style={{ color: "var(--purple)", fontWeight: 700 }}> · {a.tier}</span> : null}
                  {a.turnaround ? <span style={{ color: "var(--text-muted)" }}> · {a.turnaround}</span> : null}
                  {a.from ? <span style={{ color: "var(--text-faint)", fontSize: 10.5 }}> · price from {a.from}</span> : null}
                </td>
                <td style={Object.assign({}, cell, { textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" })}>{money(a.set_price)}</td>
                <td style={Object.assign({}, cell, { textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" })}>{a.part_price === null ? "—" : money(a.part_price)}</td>
                <td style={Object.assign({}, cell, { textAlign: "right", color: "var(--text-faint)" })}>—</td>
                <td style={Object.assign({}, cell, { textAlign: "center" })}>
                  <button onClick={function() { setAdding(adding.filter(function(_, j) { return j !== i; })); }} title="Remove"
                    style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 15 }}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* + Add a repair */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "10px 8px", borderTop: "1px dashed var(--border)", background: "var(--bg-card-inner)" }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: "var(--cyan)", marginRight: 2 }}>＋ Add a repair</span>
        <input list={"pb-repairs-" + device} value={draft.repair} onChange={function(e) { setDraft(Object.assign({}, draft, { repair: e.target.value, set_price: "" })); }} placeholder="Battery, Charge port…"
          style={{ width: 150, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12 }} />
        <datalist id={"pb-repairs-" + device}>{repairNames.map(function(n) { return <option key={n} value={n} />; })}</datalist>
        <input list={"pb-tiers-" + device} value={draft.tier} onChange={function(e) { setDraft(Object.assign({}, draft, { tier: e.target.value, set_price: "" })); }} placeholder="tier (optional)"
          style={{ width: 110, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12 }} />
        <datalist id={"pb-tiers-" + device}>{tiersForRepair.map(function(n) { return <option key={n} value={n} />; })}</datalist>
        <input value={draft.set_price} onChange={function(e) { setDraft(Object.assign({}, draft, { set_price: e.target.value })); }} inputMode="decimal"
          placeholder={sugg && sugg.set_price !== null ? String(sugg.set_price) : "price"}
          style={Object.assign({}, priceIn, { width: 84 })} />
        <input value={draft.turnaround} onChange={function(e) { setDraft(Object.assign({}, draft, { turnaround: e.target.value })); }} placeholder={sugg && sugg.turnaround ? sugg.turnaround : "turnaround"}
          style={{ width: 96, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12 }} />
        <button onClick={addDraft} disabled={!draftOk}
          style={{ padding: "6px 12px", borderRadius: 7, border: "none", background: draftOk ? "var(--cyan)" : "var(--border)", color: draftOk ? "#0B0D11" : "var(--text-muted)", fontSize: 11.5, fontWeight: 800, cursor: draftOk ? "pointer" : "not-allowed" }}>Add</button>
        <span style={{ fontSize: 10.5, color: draftClash ? "var(--orange)" : "var(--text-muted)", flexBasis: "100%", paddingLeft: 2 }}>
          {draftClash ? device + " already has " + draft.repair + (draft.tier ? " · " + draft.tier : "") + " — edit it above instead"
            : sugg ? "Suggested from " + sugg.device + ": " + money(sugg.set_price) + (sugg.turnaround ? " · " + sugg.turnaround : "") + " — leave the price blank to use it"
            : draft.repair ? "No other model in this line offers " + draft.repair + " — set the price" : ""}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 8px", borderTop: "1px solid var(--border-light)", flexWrap: "wrap" }}>
        <input value={reason} onChange={function(e) { setReason(e.target.value); }} placeholder="why — required, e.g. OLED cost dropped $20"
          style={{ flex: "1 1 240px", padding: "8px 10px", borderRadius: 8, border: "1px solid " + (total && !reason.trim() ? "var(--orange)" : "var(--border)"), background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12.5 }} />
        <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{total === 0 ? "nothing changed" : [changes.length ? changes.length + " change" + (changes.length === 1 ? "" : "s") : null, adding.length ? adding.length + " new" : null].filter(Boolean).join(" · ")}</span>
        <button onClick={onCancel} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cancel</button>
        <button onClick={save} disabled={!canSave} title={total && !reason.trim() ? "Say why — it is what makes the history worth having" : undefined}
          style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: canSave ? "var(--green)" : "var(--border)", color: canSave ? "#0B0D11" : "var(--text-muted)", fontSize: 12.5, fontWeight: 800, cursor: canSave ? "pointer" : "not-allowed" }}>
          {busy ? "Saving…" : "Save " + (total || "")}
        </button>
      </div>
    </div>
  );
}

function DeviceCard({ device, rows, index, isAdmin, editMode, selectedIds, onToggle, onInline, forceOpen, onBook, onDeviceSave, allRows }) {
  var [open, setOpen] = useState(forceOpen);
  var [editingDevice, setEditingDevice] = useState(false);
  useEffect(function() { setOpen(forceOpen); }, [forceOpen]);
  useEffect(function() { if (!editMode) setEditingDevice(false); }, [editMode]);
  var byRepair = useMemo(function() {
    var m = {};
    rows.forEach(function(r) { (m[r.repair] = m[r.repair] || []).push(r); });
    return Object.keys(m).map(function(k) { return { repair: k, tiers: m[k].slice().sort(function(a, b) { return a.sort_order - b.sort_order; }) }; });
  }, [rows]);
  var first = rows[0];
  var lead = byRepair[0] && byRepair[0].tiers[0];
  return (
    <div style={{
      background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 14, marginBottom: 10, overflow: "hidden",
      animation: "pbIn .38s cubic-bezier(.22,1,.36,1) both", animationDelay: Math.min(index, 12) * 35 + "ms",
    }}>
      <div onClick={function() { setOpen(!open); }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer", userSelect: "none" }}>
        <span style={{ color: "var(--text-muted)", fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s ease", display: "inline-block", width: 12 }}>▶</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)" }}>{device}</div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>
            {first.model_group}{first.model_group ? " · " : ""}{byRepair.length} repair{byRepair.length === 1 ? "" : "s"}
            {!open && lead && lead.set_price !== null && <span> · {byRepair[0].repair}{lead.tier ? " " + lead.tier : ""} from <strong style={{ color: "var(--text-secondary)" }}>{money(lead.set_price)}</strong></span>}
          </div>
        </div>
        {isAdmin && editMode && !editingDevice && (
          <button onClick={function(e) { e.stopPropagation(); setOpen(true); setEditingDevice(true); }} title="Every price on this device at once — one reason, one save"
            style={{ padding: "5px 11px", borderRadius: 999, border: "1px solid var(--purple)", background: "transparent", color: "var(--purple)", fontSize: 11, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>Edit · add repair</button>
        )}
        <Tag>{FAMILY_LABEL[first.family] || first.family}</Tag>
      </div>
      {open && editingDevice && (
        <div style={{ padding: "0 16px 16px" }}>
          <DeviceEditor device={device} rows={rows.slice().sort(function(a, b) { return a.sort_order - b.sort_order || a.id - b.id; })} allRows={allRows}
            onCancel={function() { setEditingDevice(false); }}
            onSave={async function(changes, adds, reason) { var ok = await onDeviceSave(device, changes, adds, reason); if (ok !== false) setEditingDevice(false); }} />
        </div>
      )}
      {open && !editingDevice && (
        <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 14, animation: "pbExpand .25s ease both" }}>
          {byRepair.map(function(g) {
            var ladder = isLadder(g.tiers);
            var quality = g.tiers.length > 1 && g.tiers.every(function(t) { return QUALITY_TIERS.indexOf(t.tier) >= 0 || /supplier/i.test(t.tier || ""); });
            return (
              <div key={g.repair}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text-body)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 7 }}>
                  {g.repair}
                  {quality && <span style={{ color: "var(--text-muted)", fontWeight: 500, textTransform: "none", letterSpacing: 0, marginLeft: 8 }}>— offer the customer a choice</span>}
                </div>
                {ladder
                  ? <Ladder tiers={g.tiers} isAdmin={isAdmin} editMode={editMode} selectedIds={selectedIds} onToggle={onToggle} onInline={onInline} onBook={onBook} />
                  : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {g.tiers.map(function(r) { return <PriceCell key={r.id} r={r} isAdmin={isAdmin} editMode={editMode} selected={!!selectedIds[r.id]} onToggle={onToggle} onInline={onInline} onBook={onBook} />; })}
                    </div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Book this quote. The appointment is a consequence of the price the agent
// just read out: device, repair, tier, sheet price, floor, store and the
// agent's own name are already known — they add the customer, a time, and
// what they actually quoted. Any quote under the sheet needs a reason, so the
// discount becomes a countable category instead of prose in a notes field.
var BOOK_STORES = [["fishers", "Fishers"], ["bloomington", "Bloomington"], ["indianapolis", "Indianapolis"]];
// What agents have actually told customers, mined from 974 appointments:
// "1-2hrs" ×73, "same day" ×24, "1-2 days" ×16, "2 hrs"/"1 hour" ×35, "3-4 hrs",
// "2-3 days", "next day" — plus the console ladder's business-day tiers.
// "1 hour" leads because it is the standard phone-screen promise (Matt,
// 2026-09-21 — it replaced "Under 1 hr").
var TURNAROUNDS = ["1 hour", "1–2 hrs", "2–3 hrs", "3–4 hrs", "Same day", "Next day", "1–2 days", "2–3 days", "3–5 days", "5–10 days"];
// The sheet writes "1-2 hrs", "2-3 BD", "same day"; map those onto the chips.
var normalizeTurnaround = function(s) {
  var t = String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (/^(under\s*)?1\s*(hr|hour)s?$|^(under|within) an? hour$/.test(t)) return "1 hour";
  if (/same\s*-?\s*day/.test(t)) return "Same day";
  if (/next\s*day|24\s*(hrs?|hours?)/.test(t)) return "Next day";
  var m = t.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(bd|business|days?|hrs?|hours?)/);
  if (m) {
    var a = m[1], b = m[2], unit = /^(bd|business|day)/.test(m[3]) ? "days" : "hrs";
    var cand = a + "–" + b + " " + unit;
    if (TURNAROUNDS.indexOf(cand) >= 0) return cand;
    if (unit === "days" && a === "3" && b === "5") return "3–5 days";
  }
  return "";
};
var localYmd = function(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
var fmtPhone = function(s) { var d = String(s || "").replace(/\D/g, "").slice(-10); if (d.length < 4) return d; if (d.length < 7) return "(" + d.slice(0, 3) + ") " + d.slice(3); return "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6); };

function BookPanel({ row, viewer, af, onClose, onBooked, deviceRows, services }) {
  var today = localYmd(new Date());
  var tomorrow = (function() { var d = new Date(); d.setDate(d.getDate() + 1); return localYmd(d); })();
  var homeStore = viewer && viewer.store && BOOK_STORES.some(function(s) { return s[0] === viewer.store; }) ? viewer.store : "fishers";
  var [f, setF] = useState({ store: homeStore, customer_name: "", customer_phone: "", date_of_appt: today, appt_time: "", quoted: row.set_price === null ? "" : String(row.set_price), reason: "", reason_text: "", notes: "" });
  var [call, setCall] = useState(null);
  var [todays, setTodays] = useState(null);
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState(null);
  var nameRef = useRef(null);

  // Everything this customer could be coming in for: every sheet row for the
  // device, then the services the register has rung for this model (or its
  // family when the model has never had one), then "something else".
  var options = useMemo(function() {
    var out = (deviceRows && deviceRows.length ? deviceRows : [row]).map(function(r) {
      return { kind: "row", key: "row:" + r.id, row: r, label: r.repair + (r.tier ? " · " + r.tier : ""), price: r.set_price, sub: r.turnaround || null };
    });
    var seen = {};
    var forModel = services && services.models && row.canonical_model ? services.models[row.canonical_model] || [] : [];
    var forFamily = services && services.families ? services.families[row.family] || [] : [];
    // A model's own figure wins when it carries a price; a model that has been
    // rung but at no usual price defers to the family's usual price.
    var famPriced = {};
    forFamily.forEach(function(s) { if (s.price !== null) famPriced[s.type] = s; });
    forModel.map(function(s) { return s.price === null && famPriced[s.type] ? famPriced[s.type] : s; }).concat(forFamily).forEach(function(s) {
      if (seen[s.type] || (services.types || []).indexOf(s.type) < 0) return;
      if (out.some(function(o) { return o.kind === "row" && o.row.canonical_repair === s.type; })) return; // the sheet already prices it
      seen[s.type] = 1;
      out.push({ kind: "service", key: "svc:" + s.type, type: s.type, label: s.type === "Other repair" ? "Other repair" : s.type, price: s.price, sold: s.sold, scope: s.scope, sub: s.scope === "model" ? "rung " + s.sold + "× on this model" : "rung " + s.sold + "× on " + (FAMILY_LABEL[row.family] || "this family").toLowerCase() });
    });
    out.push({ kind: "other", key: "other", label: "Something else", price: null, sub: "describe it, set the price" });
    return out;
  }, [deviceRows, row, services]);
  var [selKey, setSelKey] = useState("row:" + row.id);
  var [otherLabel, setOtherLabel] = useState("");
  var sel = options.filter(function(o) { return o.key === selKey; })[0] || options[0];
  var selRow = sel.kind === "row" ? sel.row : null;
  // Turnaround the customer is told. Defaults to the sheet row's own figure
  // ("1-2 hrs" → 1–2 hrs); a service starts blank because it depends on the job.
  var [tat, setTat] = useState(normalizeTurnaround(row.turnaround));
  var [tatCustom, setTatCustom] = useState("");
  useEffect(function() { setTat(normalizeTurnaround(selRow ? selRow.turnaround : "")); setTatCustom(""); }, [selKey, selRow]);
  var turnaroundOut = tat === "custom" ? tatCustom.trim() : tat;
  // Who booked it. Defaults to the session's name — but stores share logins
  // ("General Access"), so the agent can put their own name on it.
  var [bookedBy, setBookedBy] = useState(viewer && viewer.name ? viewer.name : "");
  var [roster, setRoster] = useState([]);
  useEffect(function() {
    var alive = true;
    fetch("/api/dialpad/roster?action=list").then(function(r) { return r.json(); })
      .then(function(j) { if (alive && j && j.success) setRoster((j.employees || []).map(function(e) { return e.name; }).filter(Boolean)); })
      .catch(function() {});
    return function() { alive = false; };
  }, []);
  var sharedLogin = !!(viewer && viewer.name) && roster.length > 0 && roster.indexOf(viewer.name) < 0;

  // The reference price the quote is judged against: the sheet for a sheet
  // row, the register's usual price for a service, nothing for "something else".
  var sheet = sel.kind === "row" ? selRow.set_price : sel.kind === "service" ? sel.price : null;
  var sheetLabel = sel.kind === "row" ? "Set price" : sel.kind === "service" ? "Register usually" : "No reference";
  // Eric's rule: the booking floor is 20% under what this actually sells for.
  // With too few jobs to average, the sheet's own floor stands in.
  var floor = selRow && selRow.actuals && selRow.actuals.book_floor !== null && selRow.actuals.book_floor !== undefined ? selRow.actuals.book_floor
    : selRow && selRow.floor_price !== null && selRow.floor_price !== undefined ? selRow.floor_price
    : sel.kind === "service" && sel.price !== null ? Math.round(sel.price * 0.8 * 100) / 100 : null;
  // A floor above the price itself is a stale part cost, not a floor — it made
  // quoting the full set price show "below the floor" in red (8 rows as of
  // 2026-09-15, e.g. 17 Pro Max back glass $239.99 with a $259.99 floor).
  if (floor !== null && sheet !== null && sheet !== undefined && floor > sheet) floor = null;
  var floorSrc = selRow && selRow.actuals && selRow.actuals.book_floor !== null && selRow.actuals.book_floor !== undefined ? "20% under the average sold"
    : selRow && floor !== null ? "sheet floor" : sel.kind === "service" && floor !== null ? "20% under what it usually rings" : null;
  // Switching what they are coming in for resets the quote to that option's price.
  var firstSel = useRef(true);
  useEffect(function() {
    if (firstSel.current) { firstSel.current = false; return; }
    set("quoted", sheet === null || sheet === undefined ? "" : String(sheet));
    set("reason", ""); set("reason_text", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);
  var quotedNum = parseFloat(f.quoted);
  var quotedOk = isFinite(quotedNum) && quotedNum >= 0;
  var disc = quotedOk && sheet !== null ? Math.round((sheet - quotedNum) * 100) / 100 : 0;
  var needsReason = disc > 0.005;
  var belowFloor = quotedOk && floor !== null && quotedNum < floor - 0.005;
  var reasonGiven = f.reason && (f.reason !== "Other" || f.reason_text.trim());

  function set(k, v) { setF(function(p) { var n = Object.assign({}, p); n[k] = v; return n; }); }

  useEffect(function() { nameRef.current && nameRef.current.focus(); }, []);
  useEffect(function() {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return function() { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  // Today's appointments at the chosen store, so a slot is not double-booked.
  useEffect(function() {
    if (f.date_of_appt !== today) { setTodays(null); return; }
    var alive = true;
    af("/api/dialpad/appointments?action=today&store=" + encodeURIComponent(f.store)).then(function(r) { return r.json(); })
      .then(function(j) { if (alive) setTodays(j && j.success ? j.appointments : []); }).catch(function() { if (alive) setTodays([]); });
    return function() { alive = false; };
  }, [f.store, f.date_of_appt, today, af]);

  // Did this number just call us? Then the appointment carries the call.
  function checkPhone() {
    var d = String(f.customer_phone || "").replace(/\D/g, "").slice(-10);
    if (d.length !== 10) { setCall(null); return; }
    af("/api/dialpad/appointments?action=match_call&phone=" + d).then(function(r) { return r.json(); })
      .then(function(j) { setCall(j && j.success && j.calls && j.calls.length ? j.calls[0] : null); }).catch(function() { setCall(null); });
  }

  async function submit() {
    setErr(null);
    if (!f.customer_name.trim()) { setErr("Customer name"); nameRef.current && nameRef.current.focus(); return; }
    if (sel.kind === "other" && !otherLabel.trim()) { setErr("Say what they're coming in for"); return; }
    if (!f.date_of_appt) { setErr("Pick a date"); return; }
    if (!quotedOk) { setErr("Quoted price"); return; }
    if (needsReason && !reasonGiven) { setErr("A quote under the set price needs a reason"); return; }
    setBusy(true);
    try {
      var reason = f.reason === "Other" ? f.reason_text.trim() : (f.reason + (f.reason_text.trim() ? " — " + f.reason_text.trim() : ""));
      var res = await af("/api/dialpad/appointments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add", source: "price_book",
          store: f.store, customer_name: f.customer_name.trim(), customer_phone: f.customer_phone,
          date_of_appt: f.date_of_appt, appt_time: f.appt_time, notes: f.notes,
          repair_price_id: selRow ? selRow.id : null, device: row.device,
          repair: selRow ? selRow.repair : sel.kind === "service" ? sel.type : otherLabel.trim(),
          tier: selRow ? selRow.tier : null,
          canonical_model: row.canonical_model,
          canonical_repair: selRow ? selRow.canonical_repair : sel.kind === "service" ? sel.type : null,
          sheet_price: sheet, book_floor: floor, quoted_price: quotedNum,
          quote_reason: needsReason ? reason : null,
          call_id: call ? call.call_id : null,
          turnaround: turnaroundOut || null,
          scheduled_by: bookedBy.trim() || (viewer && viewer.name ? viewer.name : ""),
        }),
      });
      var j = await res.json();
      if (!j.success) throw new Error(j.error || "not saved");
      onBooked(j.appointment);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  var input = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 13, boxSizing: "border-box" };
  var label = { fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" };
  var chip = function(on) { return { padding: "6px 11px", borderRadius: 999, border: "1px solid " + (on ? "var(--purple)" : "var(--border)"), background: on ? "#7B2FFF1A" : "transparent", color: on ? "var(--purple)" : "var(--text-secondary)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }; };
  var discTone = belowFloor ? "var(--red)" : needsReason ? "var(--orange)" : "var(--green)";

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 30, animation: "pbFade .2s ease both" }} />
      <div role="dialog" aria-label="Book this quote" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(460px, 100vw)", background: "var(--bg-card)", borderLeft: "1px solid var(--border)", boxShadow: "-20px 0 60px rgba(0,0,0,.35)", zIndex: 31, overflowY: "auto", padding: "18px 20px 24px", animation: "pbSlide .28s cubic-bezier(.22,1,.36,1) both", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--purple)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Book this quote</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", marginTop: 3 }}>{row.device}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>{sel.kind === "other" ? (otherLabel.trim() || "Something else") : sel.label}{sel.sub ? " · " + sel.sub : ""}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* what they are coming in for — every sheet row, every service the register has rung, or something else */}
        <div>
          <label style={label}>Coming in for</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {options.map(function(o) {
              var on = o.key === sel.key;
              return (
                <button key={o.key} onClick={function() { setSelKey(o.key); }} title={o.sub || undefined}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid " + (on ? "var(--purple)" : "var(--border)"), background: on ? "#7B2FFF1A" : "transparent", color: on ? "var(--purple)" : "var(--text-secondary)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "baseline", gap: 6, transition: "all .15s ease" }}>
                  <span>{o.label}</span>
                  {o.price !== null && o.price !== undefined && <span style={{ fontWeight: 500, color: on ? "var(--purple)" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{money(o.price)}</span>}
                  {o.kind === "service" && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: on ? "var(--purple)" : "var(--text-faint)" }}>{o.scope === "model" ? "register" : "family"}</span>}
                </button>
              );
            })}
          </div>
          {sel.kind === "other" && (
            <input value={otherLabel} onChange={function(e) { setOtherLabel(e.target.value); }} placeholder="what is it — e.g. speaker, housing, SIM tray" style={Object.assign({}, input, { marginTop: 8 })} />
          )}
          {sel.kind === "service" && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6 }}>Price is what the register usually rings for a {sel.type.toLowerCase()} — {sel.sub}. Not on the sheet; quote it, adjust if the job needs it.</div>}
        </div>

        {/* the quote */}
        <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
          <div style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: "var(--bg-card-inner)", border: "1px solid var(--border-light)" }}>
            <div style={label}>{sheetLabel}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{money(sheet)}</div>
            {floor !== null && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2 }}>floor {money(floor)} · {floorSrc}</div>}
          </div>
          {/* Quoted price. It has to LOOK editable — Matt wasn't sure it was —
              so it is a real input with a border and a pencil, and the common
              moves are one tap away with the set price marked as the pick. */}
          <div style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: "var(--bg-card-inner)", border: "1px solid " + (needsReason ? discTone : "var(--border-light)") }}>
            <div style={Object.assign({}, label, { display: "flex", justifyContent: "space-between" })}>
              <span>Quoted to customer</span><span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--purple)" }}>✎ tap to change</span>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 2, border: "1.5px solid var(--purple)", borderRadius: 8, padding: "3px 8px", background: "var(--bg-input)", cursor: "text" }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "var(--text-muted)" }}>$</span>
              <input value={f.quoted} onChange={function(e) { set("quoted", e.target.value); }} onFocus={function(e) { e.target.select(); }} inputMode="decimal" aria-label="Quoted price"
                style={{ width: "100%", fontSize: 20, fontWeight: 800, padding: "2px 0", border: "none", background: "transparent", color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", outline: "none" }} />
            </label>
            <div style={{ fontSize: 10.5, color: discTone, marginTop: 4, fontWeight: needsReason ? 700 : 600 }}>
              {!quotedOk ? "enter a price" : sheet === null ? "no reference price — your call" : belowFloor ? "−" + money(disc) + " · below the floor" : needsReason ? "−" + money(disc) + (sel.kind === "row" ? " under the set price" : " under the usual price") : disc < -0.005 ? "+" + money(-disc) + (sel.kind === "row" ? " over the set price" : " over the usual price") : sel.kind === "row" ? money(quotedNum) + " — at listed price!" : money(quotedNum) + " — the usual price"}
            </div>
          </div>
        </div>
        {sheet !== null && sheet !== undefined && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: -6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Quote</span>
            {[{ v: sheet, t: money(sheet) + " · recommended" }, { v: sheet - 10, t: "−$10" }, { v: sheet - 20, t: "−$20" }]
              .filter(function(o) { return o.v > 0; })
              .map(function(o, i) {
                var on = quotedOk && Math.abs(quotedNum - o.v) < 0.005;
                return <button key={i} onClick={function() { set("quoted", (Math.round(o.v * 100) / 100).toFixed(2)); }}
                  style={Object.assign({}, chip(on), i === 0 && !on ? { borderColor: "var(--green)", color: "var(--green)" } : {})}>{o.t}</button>;
              })}
          </div>
        )}
        {needsReason && (
          <div style={{ animation: "pbExpand .2s ease both" }}>
            <label style={label}>Why under the set price?</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
              {QUOTE_REASONS.map(function(r) { return <button key={r} onClick={function() { set("reason", r); }} style={chip(f.reason === r)}>{r}</button>; })}
            </div>
            <input value={f.reason_text} onChange={function(e) { set("reason_text", e.target.value); }} placeholder={f.reason === "Other" ? "say what happened" : "detail (optional)"} style={input} />
            {belowFloor && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 6 }}>This is under the floor. It will book — and it will be counted.</div>}
          </div>
        )}

        {/* store */}
        <div>
          <label style={label}>Store</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BOOK_STORES.map(function(s) { return <button key={s[0]} onClick={function() { set("store", s[0]); }} style={chip(f.store === s[0])}>{s[1]}{viewer && viewer.store === s[0] ? " · yours" : ""}</button>; })}
          </div>
        </div>

        {/* customer */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={label}>Customer</label>
            <input ref={nameRef} value={f.customer_name} onChange={function(e) { set("customer_name", e.target.value); }} placeholder="name" style={input} />
          </div>
          <div>
            <label style={label}>Phone</label>
            <input value={f.customer_phone} onChange={function(e) { set("customer_phone", fmtPhone(e.target.value)); }} onBlur={checkPhone} placeholder="(317) 555-1234" inputMode="tel" style={input} />
          </div>
        </div>
        {call && (
          <div style={{ fontSize: 11.5, color: "var(--cyan)", marginTop: -8, animation: "pbExpand .2s ease both" }}>
            📞 Called {call.store || "us"} {whenStr(call.date_started)}{call.employee ? " · " + call.employee : ""}{call.inquiry ? " · " + String(call.inquiry).slice(0, 60) : ""} — this booking will carry that call
          </div>
        )}

        {/* when */}
        <div>
          <label style={label}>When</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={function() { set("date_of_appt", today); }} style={chip(f.date_of_appt === today)}>Today</button>
            <button onClick={function() { set("date_of_appt", tomorrow); }} style={chip(f.date_of_appt === tomorrow)}>Tomorrow</button>
            <input type="date" value={f.date_of_appt} onChange={function(e) { set("date_of_appt", e.target.value); }} style={Object.assign({}, input, { width: "auto", padding: "6px 9px" })} />
            <input type="time" value={f.appt_time} onChange={function(e) { set("appt_time", e.target.value); }} step={900} style={Object.assign({}, input, { width: "auto", padding: "6px 9px" })} />
          </div>
          {todays && todays.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
              Already today at {BOOK_STORES.filter(function(s) { return s[0] === f.store; })[0][1]}: {todays.slice(0, 4).map(function(a) { return (a.appt_time || "—") + " " + (a.customer_name || "").split(" ")[0]; }).join(" · ")}{todays.length > 4 ? " · +" + (todays.length - 4) : ""}
            </div>
          )}
          {todays && todays.length === 0 && <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>Nothing booked there yet today.</div>}
        </div>

        {/* turnaround — what the customer was told, which is what the ladder is for */}
        <div>
          <label style={label}>Turnaround{selRow && selRow.turnaround ? <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}> · sheet says {selRow.turnaround}</span> : null}</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TURNAROUNDS.map(function(t) { return <button key={t} onClick={function() { setTat(tat === t ? "" : t); }} style={chip(tat === t)}>{t}</button>; })}
            <button onClick={function() { setTat(tat === "custom" ? "" : "custom"); }} style={chip(tat === "custom")}>Other…</button>
          </div>
          {tat === "custom" && <input value={tatCustom} onChange={function(e) { setTatCustom(e.target.value); }} placeholder="e.g. 7–10 days, part on order" style={Object.assign({}, input, { marginTop: 8 })} autoFocus />}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={label}>Notes</label>
            <input value={f.notes} onChange={function(e) { set("notes", e.target.value); }} placeholder="colour, cracked back glass too, needs it by 5…" style={input} />
          </div>
          <div>
            <label style={label}>Booked by{sharedLogin ? <span style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "var(--orange)" }}> · shared login — put your name</span> : null}</label>
            <input list="pb-roster" value={bookedBy} onChange={function(e) { setBookedBy(e.target.value); }} placeholder="your name" style={Object.assign({}, input, sharedLogin && !roster.some(function(n) { return n === bookedBy; }) ? { borderColor: "var(--orange)" } : {})} />
            <datalist id="pb-roster">{roster.map(function(n) { return <option key={n} value={n} />; })}</datalist>
          </div>
        </div>

        {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 700 }}>{err}</div>}
        <button disabled={busy} onClick={submit}
          style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: "var(--purple)", color: "#fff", fontSize: 14, fontWeight: 800, cursor: busy ? "wait" : "pointer", boxShadow: "0 8px 24px #7B2FFF44", transition: "transform .12s ease" }}
          onMouseDown={function(e) { e.currentTarget.style.transform = "scale(.98)"; }} onMouseUp={function(e) { e.currentTarget.style.transform = "none"; }}>
          {busy ? "Booking…" : "Book " + (quotedOk ? money(quotedNum) : "") + " at " + (BOOK_STORES.filter(function(s) { return s[0] === f.store; })[0][1])}
        </button>
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", textAlign: "center" }}>Booked as {bookedBy.trim() || (viewer && viewer.name ? viewer.name : "you")} · shows on the appointments page like any other</div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add a device. A new model starts as a copy of the product line of the one
// before it — every row the template has, at the template's prices — and
// bulk edit takes it from there. "iPhone 17 Pro Max" guesses "iPhone 16 Pro
// Max"; "S27 Ultra" walks down to the newest Ultra on the sheet.
function AddDevicePanel({ allRows, af, onClose, onAdded, prefill }) {
  var devices = useMemo(function() {
    var seen = {}, out = [];
    allRows.forEach(function(r) { if (r.active === false || seen[r.device]) return; seen[r.device] = 1; out.push({ device: r.device, family: r.family, model_group: r.model_group }); });
    return out;
  }, [allRows]);
  var byLower = useMemo(function() { var m = {}; devices.forEach(function(d) { m[d.device.toLowerCase()] = d.device; }); return m; }, [devices]);

  // A recommendation from the route arrives prefilled: the sheet's name for the
  // model, the template it follows, and a price per row — the register's own
  // where it has rung, the template's where it has not.
  var rec = prefill && prefill.model ? prefill : null;
  var [namesText, setNamesText] = useState(rec ? rec.suggested_name : "");
  var [template, setTemplate] = useState(rec && rec.template ? rec.template : "");
  var [autoTemplate, setAutoTemplate] = useState(!rec);
  var [prices, setPrices] = useState(function() {
    var m = {};
    if (rec) rec.recommended.forEach(function(x) { m[x.repair + "|" + (x.tier || "")] = x.set_price === null ? "" : String(x.set_price); });
    return m;
  });
  var [reason, setReason] = useState(rec ? "recommended from " + rec.jobs + " register jobs" : "");
  var [busy, setBusy] = useState(false);
  var [err, setErr] = useState(null);
  var firstRef = useRef(null);
  useEffect(function() { firstRef.current && firstRef.current.focus(); }, []);
  useEffect(function() {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return function() { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  var names = namesText.split(/\r?\n|,/).map(function(s) { return s.trim(); }).filter(Boolean).filter(function(n, i, a) { return a.indexOf(n) === i; });

  // The model before this one: same name with the generation number stepped
  // down until it hits a device that exists (S27 → S26 → S25 Ultra).
  function guessTemplate(name) {
    var m = name.match(/(\d{1,2})/);
    if (!m) return "";
    var n = parseInt(m[1], 10);
    for (var k = 1; k <= 4; k++) {
      var cand = name.replace(m[1], String(n - k)).toLowerCase();
      if (byLower[cand]) return byLower[cand];
    }
    return "";
  }
  useEffect(function() {
    if (!autoTemplate || !names.length) return;
    var g = guessTemplate(names[0]);
    if (g) setTemplate(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesText, autoTemplate]);

  var tRows = useMemo(function() {
    return allRows.filter(function(r) { return r.device === template && r.active !== false; }).slice().sort(function(a, b) { return a.sort_order - b.sort_order || a.id - b.id; });
  }, [allRows, template]);
  // What will be created: the template's rows, plus any register lines the
  // template lacks when a recommendation brought them along.
  var plan = useMemo(function() {
    var recBy = {};
    if (rec && rec.template === template) rec.recommended.forEach(function(x) { recBy[x.repair + "|" + (x.tier || "")] = x; });
    var out = tRows.map(function(r) {
      var k = r.repair + "|" + (r.tier || "");
      var x = recBy[k];
      return { key: k, repair: r.repair, tier: r.tier, turnaround: r.turnaround, floor_price: r.floor_price, template_price: r.set_price, source: x ? x.source : "template", register_jobs: x ? x.register_jobs : 0, extra: false };
    });
    if (rec && rec.template === template) rec.recommended.filter(function(x) { return x.extra; }).forEach(function(x) {
      out.push({ key: x.repair + "|" + (x.tier || ""), repair: x.repair, tier: x.tier, canonical_repair: x.canonical_repair, turnaround: null, floor_price: null, template_price: null, source: "register", register_jobs: x.register_jobs, extra: true });
    });
    return out;
  }, [tRows, rec, template]);
  function priceOf(p) { var v = prices[p.key]; if (v !== undefined) return v; return p.template_price === null ? "" : String(p.template_price); }
  var existing = names.filter(function(n) { return !!byLower[n.toLowerCase()]; });
  var resolved = names.map(function(n) { var r = resolveModel(n); return { name: n, canonical: r.specified ? r.canonical : null }; });
  var templateOk = !!template && tRows.length > 0;
  var canSubmit = names.length > 0 && templateOk && existing.length === 0 && !busy;

  async function submit() {
    setErr(null);
    if (!canSubmit) return;
    setBusy(true);
    try {
      var res = await af("/api/dialpad/price-book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_device", devices: names, template_device: template, reason: reason || null,
          // every edited or register-sourced price for a template row, and the register-only rows
          overrides: plan.filter(function(p) { return !p.extra; }).map(function(p) { return { repair: p.repair, tier: p.tier, set_price: parseFloat(priceOf(p)) }; }).filter(function(o) { return isFinite(o.set_price); }),
          extra_rows: plan.filter(function(p) { return p.extra; }).map(function(p) { return { repair: p.repair, tier: p.tier, canonical_repair: p.canonical_repair, set_price: parseFloat(priceOf(p)) }; }).filter(function(o) { return isFinite(o.set_price); }),
        }),
      });
      var j = await res.json();
      if (!j.success) throw new Error(j.error || "not added");
      onAdded(j);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  var input = { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 13, boxSizing: "border-box" };
  var label = { fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "block" };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 30, animation: "pbFade .2s ease both" }} />
      <div role="dialog" aria-label="Add a device" style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 100vw)", background: "var(--bg-card)", borderLeft: "1px solid var(--border)", boxShadow: "-20px 0 60px rgba(0,0,0,.35)", zIndex: 31, overflowY: "auto", padding: "18px 20px 24px", animation: "pbSlide .28s cubic-bezier(.22,1,.36,1) both", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "var(--cyan)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Add a device</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", marginTop: 3 }}>New model, same product line</div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>Copies every row the model before it has — LCD, OLED, OEM, back glass — at that model&apos;s prices. Then bulk-edit the new one.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: 4 }}>×</button>
        </div>

        <div>
          <label style={label}>New device name{names.length > 1 ? "s" : ""} — one per line</label>
          <textarea ref={firstRef} value={namesText} onChange={function(e) { setNamesText(e.target.value); }} rows={4}
            placeholder={"iPhone 17 Pro Max\niPhone 17 Pro\niPhone 17\niPhone 17 Air"} style={Object.assign({}, input, { fontFamily: "inherit", resize: "vertical" })} />
          {resolved.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
              {resolved.map(function(r) {
                var dup = !!byLower[r.name.toLowerCase()];
                return <div key={r.name} style={{ fontSize: 11, color: dup ? "var(--red)" : r.canonical ? "var(--text-muted)" : "var(--orange)" }}>
                  <strong style={{ color: "var(--text-body)" }}>{r.name}</strong>{dup ? " — already on the sheet" : r.canonical ? " → joins register data as " + r.canonical : " — ⚠ the resolver doesn't know this name; it will be on the sheet but won't join to register data until it does"}
                </div>;
              })}
            </div>
          )}
        </div>

        <div>
          <label style={label}>Copy the product line from</label>
          <input list="pb-devices" value={template} onChange={function(e) { setTemplate(e.target.value); setAutoTemplate(false); }} placeholder="start typing — iPhone 16 Pro Max, S25 Ultra…" style={input} />
          <datalist id="pb-devices">{devices.map(function(d) { return <option key={d.device} value={d.device} />; })}</datalist>
          {template && !templateOk && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>No device called “{template}” on the sheet.</div>}
          {templateOk && autoTemplate && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 4 }}>guessed from the name — change it if the line should follow a different model</div>}
        </div>

        {templateOk && (
          <div style={{ animation: "pbExpand .2s ease both" }}>
            <label style={label}>{plan.length} row{plan.length === 1 ? "" : "s"} × {names.length || 1} device{names.length === 1 ? "" : "s"} — prices are editable</label>
            <div style={{ border: "1px solid var(--border-light)", borderRadius: 8, overflow: "hidden" }}>
              {plan.map(function(p) {
                var reg = p.source === "register";
                return <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 10px", borderTop: "1px solid var(--border-light)", fontSize: 12 }}>
                  <span style={{ flex: 1, color: "var(--text-body)" }}>{p.repair}{p.tier ? <span style={{ color: "var(--purple)", fontWeight: 700 }}> · {p.tier}</span> : null}{p.turnaround ? <span style={{ color: "var(--text-muted)" }}> · {p.turnaround}</span> : null}{p.extra ? <span style={{ color: "var(--text-muted)" }}> · not on {template}</span> : null}</span>
                  <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: reg ? "var(--green)" : "var(--text-muted)", whiteSpace: "nowrap" }} title={reg ? "what RepairQ rings on " + p.register_jobs + " jobs" : "copied from " + template}>{reg ? "register ×" + p.register_jobs : "sheet copy"}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontVariantNumeric: "tabular-nums" }}>
                    <span style={{ color: "var(--text-muted)" }}>$</span>
                    <input value={priceOf(p)} onChange={function(e) { var v = e.target.value; setPrices(function(m) { var n = Object.assign({}, m); n[p.key] = v; return n; }); }} inputMode="decimal" placeholder="—"
                      style={{ width: 76, padding: "4px 7px", borderRadius: 6, border: "1px solid " + (reg ? "var(--green)" : "var(--border)"), background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 12.5, fontWeight: 800, textAlign: "right" }} />
                  </span>
                </div>;
              })}
            </div>
            {rec && rec.template === template && <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6 }}>Green prices are what the register already rings for this model; grey are copied from {template}. Floors come from {template}&apos;s part costs.</div>}
          </div>
        )}

        <div>
          <label style={label}>Note (optional)</label>
          <input value={reason} onChange={function(e) { setReason(e.target.value); }} placeholder="launch pricing, adjust once parts land" style={input} />
        </div>

        {err && <div style={{ fontSize: 12, color: "var(--red)", fontWeight: 700 }}>{err}</div>}
        <button disabled={!canSubmit} onClick={submit}
          style={{ padding: "12px 16px", borderRadius: 10, border: "none", background: canSubmit ? "var(--cyan)" : "var(--border)", color: canSubmit ? "#0B0D11" : "var(--text-muted)", fontSize: 14, fontWeight: 800, cursor: canSubmit ? "pointer" : "not-allowed", boxShadow: canSubmit ? "0 8px 24px #00D4FF33" : "none" }}>
          {busy ? "Adding…" : names.length > 1 ? "Add " + names.length + " devices" : "Add " + (names[0] || "device")}
        </button>
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", textAlign: "center" }}>Recorded in the price history as one event · the new rows sort above {template || "the template"}</div>
      </div>
    </>
  );
}

export default function PriceBook() {
  var auth = useAuth();
  var [data, setData] = useState(null);
  var [error, setError] = useState(null);
  var [q, setQ] = useState("");
  var [family, setFamily] = useState("all");
  var [editMode, setEditMode] = useState(false);
  var [selectedIds, setSelectedIds] = useState({});
  var [bulk, setBulk] = useState({ mode: "minus", amount: "", field: "set_price", reason: "" });
  var [preview, setPreview] = useState(null);
  var [busy, setBusy] = useState(false);
  var [toast, setToast] = useState(null);
  var [history, setHistory] = useState(null);
  var [showHistory, setShowHistory] = useState(false);
  var [booking, setBooking] = useState(null); // the price row being turned into an appointment
  var [addingDevice, setAddingDevice] = useState(null); // {} for a blank panel, or a missing-model recommendation to prefill
  var searchRef = useRef(null);

  var isAdmin = !!(data && data.can_edit);

  function load() {
    setError(null);
    var f = auth && auth.authFetch ? auth.authFetch : fetch;
    f("/api/dialpad/price-book?months=6").then(function(r) { return r.json(); }).then(function(j) {
      if (!j || !j.success) { setError((j && j.error) || "request failed"); return; }
      setData(j);
    }).catch(function(e) { setError(e.message); });
  }
  useEffect(function() { load(); /* eslint-disable-line */ }, []);

  // "/" focuses search from anywhere; Esc clears it.
  useEffect(function() {
    function onKey(e) {
      var tag = (document.activeElement && document.activeElement.tagName) || "";
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
      if (e.key === "Escape" && document.activeElement === searchRef.current) { setQ(""); }
    }
    window.addEventListener("keydown", onKey);
    return function() { window.removeEventListener("keydown", onKey); };
  }, []);

  useEffect(function() { if (!toast) return; var t = setTimeout(function() { setToast(null); }, 3500); return function() { clearTimeout(t); }; }, [toast]);

  // Rows taken off the sheet only exist in edit mode, dimmed, so they can be
  // offered again. Non-admins never receive them from the route.
  var rows = useMemo(function() {
    var all = data ? data.rows : [];
    return editMode ? all : all.filter(function(r) { return r.active !== false; });
  }, [data, editMode]);
  var hiddenCount = data ? data.rows.filter(function(r) { return r.active === false; }).length : 0;
  var filtered = useMemo(function() {
    var terms = tok(q);
    return rows.filter(function(r) {
      if (family !== "all" && r.family !== family) return false;
      if (!terms.length) return true;
      var hay = tok([r.device, r.model_group, r.repair, r.tier, r.family, r.canonical_model].join(" ")).concat(aliasesFor(r.canonical_model, r.device));
      return terms.every(function(t) { return hay.some(function(h) { return h.indexOf(t) >= 0; }); });
    });
  }, [rows, q, family]);

  // Newest model first inside each line (Matt, 2026-09-21). Sheet order had
  // gone ragged once devices were added from a template — each new model sits
  // just above the one it was copied from, so 17 Pro Max, 16 Pro Max, 17 Pro,
  // 16 Pro. Lines keep the sheet's order; inside a line, higher generation
  // first, then Pro Max / Ultra, Pro, Plus, Air, base, e / mini / FE.
  var devices = useMemo(function() {
    var m = {}, order = [];
    filtered.forEach(function(r) { if (!m[r.device]) { m[r.device] = []; order.push(r.device); } m[r.device].push(r); });
    var lineRank = {};
    order.forEach(function(d) { var k = (m[d][0].family || "") + "|" + (m[d][0].model_group || ""); if (lineRank[k] === undefined) lineRank[k] = Object.keys(lineRank).length; });
    var pos = {};
    order.forEach(function(d, i) { pos[d] = i; });
    var gen = deviceGen;
    var variant = deviceVariant;
    var sorted = order.slice().sort(function(a, b) {
      var ka = (m[a][0].family || "") + "|" + (m[a][0].model_group || ""), kb = (m[b][0].family || "") + "|" + (m[b][0].model_group || "");
      if (ka !== kb) return lineRank[ka] - lineRank[kb];
      var ga = gen(a), gb = gen(b);
      if (ga !== gb) return gb - ga;
      var va = variant(a), vb = variant(b);
      if (va !== vb) return va - vb;
      return pos[a] - pos[b];
    });
    return sorted.map(function(d) { return { device: d, rows: m[d] }; });
  }, [filtered]);

  var famCounts = useMemo(function() {
    var m = { all: 0 };
    var seen = {};
    rows.forEach(function(r) { var k = r.family + "|" + r.device; if (seen[k]) return; seen[k] = 1; m.all++; m[r.family] = (m[r.family] || 0) + 1; });
    return m;
  }, [rows]);

  var selectedCount = Object.keys(selectedIds).length;
  var visibleIds = filtered.map(function(r) { return r.id; });

  // Where the register disagrees with the sheet. The route already attaches
  // what RepairQ actually rang for each row; this is the list, ranked by how
  // many jobs the difference touches, so the biggest gaps are on top.
  var mismatches = useMemo(function() {
    // A disagreement needs a real catalog price behind it: at least three jobs
    // and the majority at one number. A single job rung at $40 on a charge-port
    // line is a tech improvising, not the register's list price.
    return rows.filter(function(r) {
      var a = r.actuals;
      return r.active !== false && a && a.pos_list !== null && r.set_price !== null && a.sold >= 3 && a.pos_list_share >= 50 && Math.abs(a.pos_list - r.set_price) >= 1;
    }).sort(function(a, b) { return b.actuals.sold - a.actuals.sold; });
  }, [rows]);
  // Catalog lines the register rings that the sheet has no row for at all.
  var unlisted = useMemo(function() {
    return rows.filter(function(r) { return r.actuals_other && r.actuals_other.sold > 0; })
      .sort(function(a, b) { return b.actuals_other.sold - a.actuals_other.sold; });
  }, [rows]);
  // Models the register has been selling that the sheet has never had a row
  // for (iPhone 17 with 35 jobs). The route ships each with a recommended
  // product line; adding one is a click, not a data-entry job.
  var missingModels = data && Array.isArray(data.missing_models) ? data.missing_models : [];
  var [showReconcile, setShowReconcile] = useState(false);

  function toggle(id) { setSelectedIds(function(p) { var n = Object.assign({}, p); if (n[id]) delete n[id]; else n[id] = true; return n; }); setPreview(null); }
  function selectWhere(pred) { setSelectedIds(function(p) { var n = Object.assign({}, p); filtered.forEach(function(r) { if (pred(r)) n[r.id] = true; }); return n; }); setPreview(null); }
  function clearSel() { setSelectedIds({}); setPreview(null); }

  // Bulk edit: compute every new value client-side and show it BEFORE writing.
  // Same dry-run discipline as the importer; these are the numbers customers get quoted.
  function buildPreview() {
    var amt = parseFloat(bulk.amount);
    if (bulk.mode !== "register" && !isFinite(amt)) { setToast({ tone: "var(--red)", text: "Enter an amount first" }); return; }
    var out = [];
    rows.forEach(function(r) {
      if (!selectedIds[r.id]) return;
      var cur = r[bulk.field];
      if (cur === null || cur === undefined) return;
      var nv;
      if (bulk.mode === "register") {
        // Adopt what the register actually rings for THIS row — each row has
        // its own target, so no amount is needed.
        if (!r.actuals || r.actuals.pos_list === null) return;
        nv = r.actuals.pos_list;
      }
      else if (bulk.mode === "minus") nv = cur - amt;
      else if (bulk.mode === "plus") nv = cur + amt;
      else if (bulk.mode === "pct") nv = cur * (1 - amt / 100);
      else nv = amt;
      nv = Math.round(nv * 100) / 100;
      if (nv < 0) nv = 0;
      if (Math.abs(nv - cur) < 0.005) return;
      out.push({ id: r.id, device: r.device, repair: r.repair, tier: r.tier, from: cur, to: nv });
    });
    setPreview(out);
  }

  async function commit(changes, reason) {
    setBusy(true);
    try {
      // Without a session this is plain fetch and the route answers 401 —
      // the gate is the server's, never the UI's.
      var af = auth && auth.authFetch ? auth.authFetch : fetch;
      var res = await af("/api/dialpad/price-book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", changes: changes, reason: reason || null }),
      });
      var j = await res.json();
      if (!j.success) throw new Error(j.error || "update failed");
      setToast({ tone: "var(--green)", text: "Saved " + j.updated + " price" + (j.updated === 1 ? "" : "s") + " · recorded as one change, effective " + j.effective_date });
      clearSel(); setPreview(null); setBulk(function(b) { return Object.assign({}, b, { amount: "", reason: "" }); });
      load();
    } catch (e) {
      setToast({ tone: "var(--red)", text: "Not saved — " + e.message });
    }
    setBusy(false);
  }

  // Take the selected rows off the sheet (or put them back). No preview step:
  // nothing numeric changes, it is reversible, and the ledger records it.
  function setOffered(flag) {
    var ids = Object.keys(selectedIds);
    if (!ids.length) return;
    commit(ids.map(function(id) { return { id: id, active: flag }; }), bulk.reason || (flag ? "offered again" : "no longer offered"));
  }

  // New repairs on an existing device — one ledger batch, same reason rule.
  async function addRepairs(device, adds, reason) {
    try {
      var af = auth && auth.authFetch ? auth.authFetch : fetch;
      var res = await af("/api/dialpad/price-book", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_repairs", device: device, reason: reason, repairs: adds }),
      });
      var j = await res.json();
      if (!j.success) throw new Error(j.error || "not added");
      setToast({ tone: "var(--green)", text: "Added " + j.added + " repair" + (j.added === 1 ? "" : "s") + " to " + device });
      return true;
    } catch (e) {
      setToast({ tone: "var(--red)", text: "Not added — " + e.message });
      return false;
    }
  }

  function inlineSave(r, val) {
    var nv = parseFloat(val);
    if (!isFinite(nv)) { setToast({ tone: "var(--red)", text: "That isn't a price" }); return; }
    commit([{ id: r.id, set_price: nv }], "inline edit");
  }

  function loadHistory() {
    var af = auth && auth.authFetch ? auth.authFetch : fetch;
    af("/api/dialpad/price-book?action=changes").then(function(r) { return r.json(); }).then(function(j) { if (j.success) setHistory(j.batches); });
  }

  var input = { padding: "9px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-input)", color: "var(--text-primary)", fontSize: 13 };

  return (
    <div style={{ background: "var(--bg-page)", minHeight: "100vh", color: "var(--text-primary)", fontFamily: "'Space Grotesk',-apple-system,sans-serif" }}>
      {/* header — same shell as the store pages */}
      <div style={{ background: "var(--bg-card-inner)", borderBottom: "1px solid var(--border-light)", padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,var(--cyan),var(--purple))", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ color: "#FFF", fontSize: 18, fontWeight: 900 }}>FT</span></div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Price Book</h1>
            <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 11 }}>What to quote, what it can go to, and what to say next</p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {isAdmin && <Chip active={editMode} onClick={function() { setEditMode(!editMode); clearSel(); }}>{editMode ? "Done editing" : "Edit prices"}</Chip>}
          {isAdmin && <Chip active={showHistory} onClick={function() { setShowHistory(!showHistory); if (!history) loadHistory(); }}>History</Chip>}
          <a href="/appointments" style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--text-secondary)", fontSize: 10, textDecoration: "none" }}>Store Dashboard</a>
          <ThemeToggle />
          {auth && <button onClick={auth.signOut} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text-secondary)", fontSize: 10, cursor: "pointer" }}>Sign Out</button>}
        </div>
      </div>

      <div style={{ padding: "22px 22px 60px", maxWidth: 1180, margin: "0 auto" }}>
        {/* search — the whole page exists for this box */}
        <div style={{ position: "relative", marginBottom: 12 }}>
          <input ref={searchRef} autoFocus value={q} onChange={function(e) { setQ(e.target.value); }}
            placeholder="Type a device or repair — “14 pro max”, “ps5 hdmi”, “s23 battery”"
            style={{ width: "100%", boxSizing: "border-box", padding: "16px 18px", fontSize: 17, fontWeight: 600, borderRadius: 14, border: "1.5px solid var(--border)", background: "var(--bg-card)", color: "var(--text-primary)", outline: "none", boxShadow: "0 6px 24px rgba(0,0,0,.08)" }} />
          <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", fontSize: 10.5, color: "var(--text-faint)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px" }}>/</span>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          {FAMILY_ORDER.filter(function(f) { return f === "all" || famCounts[f]; }).map(function(f) {
            return <Chip key={f} active={family === f} onClick={function() { setFamily(f); }}>{FAMILY_LABEL[f]} <span style={{ opacity: .6 }}>{famCounts[f] || 0}</span></Chip>;
          })}
          {data && <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-muted)" }}>{devices.length} device{devices.length === 1 ? "" : "s"} · acceptance from the last {data.window_months} months</span>}
        </div>

        {error && <div style={{ padding: 18, borderRadius: 12, border: "1px solid var(--red)", color: "var(--red)", fontSize: 13, marginBottom: 14 }}>Couldn&apos;t load the price book — {error}</div>}
        {!data && !error && <div style={{ padding: 50, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Loading prices…</div>}

        {/* reconcile with the register — the sheet vs what RepairQ actually rings */}
        {isAdmin && !editMode && (mismatches.length > 0 || missingModels.length > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 14, borderRadius: 10, border: "1px solid var(--yellow)", background: "#FBBF2414", fontSize: 12, animation: "pbExpand .22s ease both", flexWrap: "wrap" }}>
            {missingModels.length > 0 && (
              <span style={{ color: "var(--yellow)", fontWeight: 800 }}>
                The register is selling {missingModels.length} model{missingModels.length === 1 ? "" : "s"} this sheet doesn&apos;t have — {missingModels.slice(0, 3).map(function(m) { return m.model + " (" + m.jobs + ")"; }).join(", ")}{missingModels.length > 3 ? "…" : ""}
              </span>
            )}
            {mismatches.length > 0 && (
              <span style={{ color: missingModels.length ? "var(--text-secondary)" : "var(--yellow)", fontWeight: 800 }}>{missingModels.length ? "· " : ""}disagrees on {mismatches.length} price{mismatches.length === 1 ? "" : "s"}</span>
            )}
            {unlisted.length > 0 && <span style={{ color: "var(--text-muted)" }}>· {unlisted.length} line{unlisted.length === 1 ? "" : "s"} it rings that aren&apos;t on the sheet</span>}
            <button onClick={function() { setEditMode(true); setShowReconcile(true); }} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 7, border: "none", background: "var(--yellow)", color: "#0B0D11", fontSize: 11.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>{missingModels.length ? "Review & add" : "Review them"}</button>
          </div>
        )}
        {editMode && (mismatches.length > 0 || unlisted.length > 0 || missingModels.length > 0) && (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--yellow)", borderRadius: 14, marginBottom: 12, overflow: "hidden", animation: "pbExpand .22s ease both" }}>
            <div onClick={function() { setShowReconcile(!showReconcile); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", userSelect: "none" }}>
              <span style={{ color: "var(--text-muted)", fontSize: 11, transform: showReconcile ? "rotate(90deg)" : "none", transition: "transform .2s ease", display: "inline-block", width: 12 }}>▶</span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>Reconcile with the register</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{missingModels.length > 0 ? missingModels.length + " model" + (missingModels.length === 1 ? "" : "s") + " to add · " : ""}{mismatches.length} disagree · {unlisted.length} not on the sheet</span>
              {showReconcile && mismatches.length > 0 && (
                <button onClick={function(e) { e.stopPropagation(); var n = {}; mismatches.forEach(function(r) { n[r.id] = true; }); setSelectedIds(n); setBulk(Object.assign({}, bulk, { mode: "register", reason: bulk.reason || "Match the register (RepairQ list price)" })); setPreview(null); setToast({ tone: "var(--purple)", text: mismatches.length + " selected · mode set to match register — hit Preview" }); }}
                  style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 7, border: "none", background: "var(--purple)", color: "#fff", fontSize: 11.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>Select all {mismatches.length} → match register</button>
              )}
            </div>
            {showReconcile && (
              <div style={{ padding: "0 14px 14px" }}>
                {mismatches.length > 0 && (
                  <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--border-light)", borderRadius: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ color: "var(--text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        <th style={{ textAlign: "left", padding: "7px 10px", fontWeight: 700 }}>Item</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", fontWeight: 700 }}>Sheet</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", fontWeight: 700 }}>Register</th>
                        <th style={{ textAlign: "right", padding: "7px 10px", fontWeight: 700 }}>Jobs</th>
                        <th style={{ padding: "7px 10px" }}></th>
                      </tr></thead>
                      <tbody>
                        {mismatches.map(function(r) {
                          var on = !!selectedIds[r.id];
                          var d = r.actuals.pos_list - r.set_price;
                          return (
                            <tr key={r.id} onClick={function() { toggle(r.id); }} style={{ borderTop: "1px solid var(--border-light)", background: on ? "#7B2FFF12" : "transparent", cursor: "pointer" }}>
                              <td style={{ padding: "7px 10px", color: "var(--text-body)" }}>{r.device} · {r.repair}{r.tier ? " · " + r.tier : ""}</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{money(r.set_price)}</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: d < 0 ? "var(--orange)" : "var(--green)" }}>{money(r.actuals.pos_list)} <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: 10.5 }}>({d < 0 ? "−" : "+"}{money(Math.abs(d))})</span></td>
                              <td style={{ padding: "7px 10px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{r.actuals.sold} <span style={{ fontSize: 10.5 }}>· {r.actuals.pos_list_share}% at that price</span></td>
                              <td style={{ padding: "7px 10px", textAlign: "center" }}><span style={{ display: "inline-block", width: 14, height: 14, borderRadius: 4, border: "1.5px solid " + (on ? "var(--purple)" : "var(--border-heavy)"), background: on ? "var(--purple)" : "transparent", color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: "14px", textAlign: "center" }}>{on ? "✓" : ""}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 8 }}>Tap rows to pick which to adopt, or take them all. Nothing changes until you Preview and Commit below.</div>
                {missingModels.length > 0 && (
                  <div style={{ marginTop: mismatches.length ? 14 : 0 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text-body)", marginBottom: 6 }}>Models the register sells that this sheet doesn&apos;t have</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {missingModels.map(function(m) {
                        var regRows = m.recommended.filter(function(x) { return x.source === "register"; }).length;
                        return (
                          <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-light)", background: "var(--bg-card-inner)", flexWrap: "wrap" }}>
                            <div style={{ flex: "1 1 240px" }}>
                              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-primary)" }}>{m.model} <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: 11.5 }}>· {m.jobs} job{m.jobs === 1 ? "" : "s"} in 6 months</span></div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                                {m.lines.slice(0, 3).map(function(l) { return l.repair + (l.tier ? " " + l.tier : "") + " " + money(l.pos_list) + " ×" + l.sold; }).join(" · ")}
                              </div>
                              <div style={{ fontSize: 11, color: m.template ? "var(--text-secondary)" : "var(--orange)", marginTop: 2 }}>
                                {m.template ? "Recommended: " + m.recommended.length + " rows following " + m.template + " — " + regRows + " at register prices, " + (m.recommended.length - regRows) + " copied" : "No earlier model on the sheet to follow — add it by hand"}
                              </div>
                            </div>
                            <button onClick={function(e) { e.stopPropagation(); setAddingDevice(m.template ? m : { }); }}
                              style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: m.template ? "var(--green)" : "var(--border)", color: m.template ? "#0B0D11" : "var(--text-muted)", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>
                              {m.template ? "Add " + m.suggested_name + " →" : "Add by hand"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {unlisted.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text-body)", marginBottom: 6 }}>Rung at the register, not on this sheet</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {unlisted.slice(0, 40).map(function(r) {
                        return <div key={"u" + r.id} style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderTop: "1px solid var(--border-light)" }}>
                          <span>{r.device} · {r.repair}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}><strong style={{ color: "var(--yellow)" }}>{money(r.actuals_other.pos_list)}</strong> · {r.actuals_other.sold} job{r.actuals_other.sold === 1 ? "" : "s"}</span>
                        </div>;
                      })}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6 }}>These have no row to adopt into. Adding rows to the sheet from here is the next capability.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* bulk edit bar */}
        {editMode && (
          <div style={{ position: "sticky", top: 10, zIndex: 5, background: "var(--bg-card)", border: "1px solid var(--purple)", borderRadius: 14, padding: 14, marginBottom: 16, boxShadow: "0 10px 30px rgba(0,0,0,.18)", animation: "pbExpand .22s ease both" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <strong style={{ fontSize: 12.5 }}>{selectedCount} selected</strong>
              <span style={{ color: "var(--text-muted)", fontSize: 11 }}>· tap prices to select, or</span>
              <Chip onClick={function() { selectWhere(function() { return true; }); }}>all in view ({visibleIds.length})</Chip>
              {QUALITY_TIERS.filter(function(t) { return filtered.some(function(r) { return r.tier === t; }); }).map(function(t) {
                return <Chip key={t} onClick={function() { selectWhere(function(r) { return r.tier === t; }); }}>all {t}</Chip>;
              })}
              {["Screen", "Battery", "HDMI port", "Charge port", "Back glass"].filter(function(rp) { return filtered.some(function(r) { return r.repair === rp; }); }).map(function(rp) {
                return <Chip key={rp} onClick={function() { selectWhere(function(r) { return r.repair === rp; }); }}>all {rp}</Chip>;
              })}
              {selectedCount > 0 && <Chip onClick={clearSel} tone="var(--red)">clear</Chip>}
              <span style={{ flex: 1 }} />
              <button onClick={function() { setAddingDevice({}); }} title="Add a new model with the full product line of the one before it — LCD, OLED, OEM, back glass…"
                style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--cyan)", background: "transparent", color: "var(--cyan)", fontSize: 11.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>＋ Add device</button>
              {selectedCount > 0 && rows.some(function(r) { return selectedIds[r.id] && r.active !== false; }) && (
                <button disabled={busy} onClick={function() { setOffered(false); }} title="Take the selected prices off the sheet. Agents stop seeing them; the register history stays attached and they can be offered again."
                  style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--red)", background: "transparent", color: "var(--red)", fontSize: 11.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>Stop offering selected</button>
              )}
              {selectedCount > 0 && rows.some(function(r) { return selectedIds[r.id] && r.active === false; }) && (
                <button disabled={busy} onClick={function() { setOffered(true); }}
                  style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--green)", background: "transparent", color: "var(--green)", fontSize: 11.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>Offer again</button>
              )}
              {hiddenCount > 0 && selectedCount === 0 && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{hiddenCount} not offered — shown dimmed</span>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <select value={bulk.field} onChange={function(e) { setBulk(Object.assign({}, bulk, { field: e.target.value })); setPreview(null); }} style={input}>
                <option value="set_price">Quote price</option>
                <option value="floor_price">Floor price</option>
                <option value="part_price">Part cost (floor follows)</option>
              </select>
              <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                {[["minus", "− $"], ["plus", "+ $"], ["pct", "− %"], ["set", "set to $"], ["register", "match register"]].map(function(m) {
                  var on = bulk.mode === m[0];
                  return <button key={m[0]} onClick={function() { setBulk(Object.assign({}, bulk, { mode: m[0] })); setPreview(null); }} style={{ padding: "8px 12px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700, background: on ? "#7B2FFF22" : "transparent", color: on ? "var(--purple)" : "var(--text-secondary)" }}>{m[1]}</button>;
                })}
              </div>
              <input value={bulk.amount} onChange={function(e) { setBulk(Object.assign({}, bulk, { amount: e.target.value })); setPreview(null); }} placeholder="20" inputMode="decimal" style={Object.assign({}, input, { width: 90 })} />
              <input value={bulk.reason} onChange={function(e) { setBulk(Object.assign({}, bulk, { reason: e.target.value })); }} placeholder="why — required, e.g. OLED cost dropped $20"
                style={Object.assign({}, input, { flex: "1 1 220px" }, preview && preview.length && !bulk.reason.trim() ? { borderColor: "var(--orange)" } : {})} />
              <button disabled={!selectedCount || busy} onClick={buildPreview} style={{ padding: "9px 16px", borderRadius: 8, border: "none", cursor: selectedCount ? "pointer" : "not-allowed", background: selectedCount ? "var(--purple)" : "var(--border)", color: "#fff", fontSize: 12.5, fontWeight: 800 }}>Preview</button>
            </div>
            {preview && (
              <div style={{ marginTop: 12, animation: "pbExpand .22s ease both" }}>
                {preview.length === 0 ? <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Nothing would change.</div> : (
                  <>
                    <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-light)", borderRadius: 8 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <tbody>
                          {preview.map(function(p) {
                            return <tr key={p.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                              <td style={{ padding: "6px 10px", color: "var(--text-body)" }}>{p.device} · {p.repair}{p.tier ? " · " + p.tier : ""}</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{money(p.from)}</td>
                              <td style={{ padding: "6px 10px", textAlign: "center", color: "var(--text-faint)" }}>→</td>
                              <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 800, color: p.to < p.from ? "var(--orange)" : "var(--green)", fontVariantNumeric: "tabular-nums" }}>{money(p.to)}</td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{preview.length} price{preview.length === 1 ? "" : "s"} change · saved as one event, dated today, and marked on the Price &amp; Demand trend</span>
                      <button disabled={busy || !bulk.reason.trim()} onClick={function() { commit(preview.map(function(p) { var c = { id: p.id }; c[bulk.field] = p.to; return c; }), bulk.reason); }}
                        title={bulk.reason.trim() ? undefined : "Say why — it is what makes the history worth having"}
                        style={{ padding: "9px 18px", borderRadius: 8, border: "none", cursor: bulk.reason.trim() ? "pointer" : "not-allowed", background: bulk.reason.trim() ? "var(--green)" : "var(--border)", color: bulk.reason.trim() ? "#0B0D11" : "var(--text-muted)", fontSize: 12.5, fontWeight: 800 }}>{busy ? "Saving…" : bulk.reason.trim() ? "Commit " + preview.length : "Add a reason to commit"}</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* history */}
        {isAdmin && showHistory && (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)", borderRadius: 14, padding: 16, marginBottom: 16, animation: "pbExpand .22s ease both" }}>
            <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Price changes</div>
            {!history && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Loading…</div>}
            {history && history.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>No changes recorded yet. The imported sheet is the starting point.</div>}
            {history && history.slice(0, 25).map(function(b) {
              var fields = {};
              b.rows.forEach(function(r) { fields[r.field] = (fields[r.field] || 0) + 1; });
              var sample = b.rows[0];
              return (
                <div key={b.batch_id} style={{ padding: "9px 0", borderTop: "1px solid var(--border-light)", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span><strong>{b.changed_by}</strong> · {whenStr(b.changed_at)} · effective {b.effective_date}</span>
                    <span style={{ color: "var(--text-muted)" }}>{b.rows.length} change{b.rows.length === 1 ? "" : "s"} · {Object.keys(fields).map(function(f) { return f.replace("_", " "); }).join(", ")}</span>
                  </div>
                  <div style={{ color: "var(--text-muted)", marginTop: 3 }}>
                    {b.reason ? <em>{b.reason}</em> : <span>no reason given</span>}
                    {sample && sample.field === "active" && <span> · e.g. {sample.device} {sample.repair}{sample.tier ? " " + sample.tier : ""}: {Number(sample.new_value) ? "offered again" : "no longer offered"}</span>}
                    {sample && sample.field !== "active" && <span> · e.g. {sample.device} {sample.repair}{sample.tier ? " " + sample.tier : ""}: {money(sample.old_value)} → {money(sample.new_value)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* results */}
        {data && devices.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: 13, background: "var(--bg-card)", borderRadius: 14, border: "1px dashed var(--border)" }}>
            Nothing matches “{q}”. Try fewer words — “15 pro”, “xbox”, “ipad battery”.
          </div>
        )}
        {devices.slice(0, 60).map(function(d, i) {
          return <DeviceCard key={d.device} device={d.device} rows={d.rows} index={i} isAdmin={isAdmin} editMode={editMode} selectedIds={selectedIds} onToggle={toggle} onInline={inlineSave} forceOpen={devices.length <= 4 || q.trim().length > 0} onBook={function(r) { setBooking(r); }}
            allRows={data ? data.rows : []}
            onDeviceSave={async function(device, changes, adds, reason) {
              if (adds && adds.length) { var ok = await addRepairs(device, adds, reason); if (!ok) return false; }
              if (changes && changes.length) await commit(changes, reason);
              else if (adds && adds.length) load();
              return true;
            }} />;
        })}
        {devices.length > 60 && <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: 12 }}>Showing 60 of {devices.length} — type to narrow it down.</div>}
      </div>

      {addingDevice && isAdmin && (
        <AddDevicePanel allRows={data ? data.rows : []} af={auth && auth.authFetch ? auth.authFetch : fetch} prefill={addingDevice}
          onClose={function() { setAddingDevice(null); }}
          onAdded={function(j) {
            setAddingDevice(null);
            setToast({ tone: "var(--green)", text: "Added " + j.devices.join(", ") + " · " + j.rows_per_device + " rows each, copied from " + j.template + (j.unresolved.length ? " · ⚠ " + j.unresolved.join(", ") + " won't join to register data yet" : "") });
            setQ(j.devices[0]); setEditMode(false); load();
          }} />
      )}
      {booking && (
        <BookPanel row={booking} viewer={auth && auth.userInfo ? auth.userInfo : null} af={auth && auth.authFetch ? auth.authFetch : fetch}
          deviceRows={(data ? data.rows : []).filter(function(r) { return r.device === booking.device && r.active !== false; })}
          services={data && data.services ? data.services : null}
          onClose={function() { setBooking(null); }}
          onBooked={function(a) { setBooking(null); setToast({ tone: "var(--green)", text: "Booked · " + (a.customer_name || "") + " · " + a.date_of_appt + (a.appt_time ? " at " + a.appt_time : "") + " · " + a.store }); }} />
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid " + toast.tone, color: toast.tone, padding: "11px 18px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, boxShadow: "0 10px 30px rgba(0,0,0,.3)", zIndex: 20, animation: "pbIn .25s ease both", maxWidth: "90vw" }}>{toast.text}</div>
      )}

      <style>{"@keyframes pbIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } } @keyframes pbExpand { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } } @keyframes pbSlide { from { transform:translateX(40px); opacity:0 } to { transform:translateX(0); opacity:1 } } @keyframes pbFade { from { opacity:0 } to { opacity:1 } }"}</style>
    </div>
  );
}

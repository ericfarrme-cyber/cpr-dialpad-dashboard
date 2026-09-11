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

var FAMILY_LABEL = { all: "All", phone: "Phones", tablet: "Tablets", console: "Consoles", computer: "Computers", service: "Services" };
var FAMILY_ORDER = ["all", "phone", "console", "tablet", "computer", "service"];
var QUALITY_TIERS = ["LCD", "OLED", "OEM", "Digitizer"];
var FLAG_LABEL = {
  solder_or_order: "part ordered / solder",
  non_consigned_part: "non-consigned part",
  supplier_choice: "supplier choice",
};

var money = function(n) { return n === null || n === undefined ? "—" : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
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
function PriceCell({ r, isAdmin, editMode, selected, onToggle, onInline, emphasis }) {
  var [editing, setEditing] = useState(false);
  var [val, setVal] = useState("");
  var flags = r.flags || [];
  return (
    <div onClick={editMode ? function() { onToggle(r.id); } : undefined}
      style={{
        flex: "1 1 150px", minWidth: 140, padding: "11px 13px", borderRadius: 10,
        background: selected ? "#7B2FFF14" : "var(--bg-card-inner)",
        border: "1px solid " + (selected ? "var(--purple)" : emphasis ? "var(--border)" : "var(--border-light)"),
        cursor: editMode ? "pointer" : "default", transition: "border-color .15s ease, background .15s ease", position: "relative",
      }}>
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
      {r.actuals_other && r.actuals_other.sold > 0 && (
        <div style={{ marginTop: 6, fontSize: 10.5, color: "var(--yellow)" }}>
          register also rings <strong>{money(r.actuals_other.pos_list)}</strong> on {r.actuals_other.sold} job{r.actuals_other.sold === 1 ? "" : "s"} — a line this sheet doesn&apos;t have
        </div>
      )}
      {isAdmin && r.updated_by && !String(r.updated_by).startsWith("import:") && (
        <div style={{ fontSize: 9.5, color: "var(--text-faint)", marginTop: 6 }}>edited {whenStr(r.updated_at)} · {r.updated_by}</div>
      )}
    </div>
  );
}

// The turnaround ladder is the closing tool: when the price is too much, offer
// time instead of a discount.
function Ladder({ tiers, isAdmin, editMode, selectedIds, onToggle, onInline }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginBottom: 6 }}>Same repair, priced by how soon they need it — offer the slower tier before offering a discount.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tiers.map(function(r, i) {
          return <PriceCell key={r.id} r={r} isAdmin={isAdmin} editMode={editMode} selected={!!selectedIds[r.id]} onToggle={onToggle} onInline={onInline} emphasis={i === 0} />;
        })}
      </div>
    </div>
  );
}

function DeviceCard({ device, rows, index, isAdmin, editMode, selectedIds, onToggle, onInline, forceOpen }) {
  var [open, setOpen] = useState(forceOpen);
  useEffect(function() { setOpen(forceOpen); }, [forceOpen]);
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
        <Tag>{FAMILY_LABEL[first.family] || first.family}</Tag>
      </div>
      {open && (
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
                  ? <Ladder tiers={g.tiers} isAdmin={isAdmin} editMode={editMode} selectedIds={selectedIds} onToggle={onToggle} onInline={onInline} />
                  : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {g.tiers.map(function(r) { return <PriceCell key={r.id} r={r} isAdmin={isAdmin} editMode={editMode} selected={!!selectedIds[r.id]} onToggle={onToggle} onInline={onInline} />; })}
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

  var rows = data ? data.rows : [];
  var filtered = useMemo(function() {
    var terms = tok(q);
    return rows.filter(function(r) {
      if (family !== "all" && r.family !== family) return false;
      if (!terms.length) return true;
      var hay = tok([r.device, r.model_group, r.repair, r.tier, r.family, r.canonical_model].join(" ")).concat(aliasesFor(r.canonical_model, r.device));
      return terms.every(function(t) { return hay.some(function(h) { return h.indexOf(t) >= 0; }); });
    });
  }, [rows, q, family]);

  var devices = useMemo(function() {
    var m = {}, order = [];
    filtered.forEach(function(r) { if (!m[r.device]) { m[r.device] = []; order.push(r.device); } m[r.device].push(r); });
    return order.map(function(d) { return { device: d, rows: m[d] }; });
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
    return rows.filter(function(r) {
      return r.actuals && r.actuals.pos_list !== null && r.set_price !== null && Math.abs(r.actuals.pos_list - r.set_price) >= 1;
    }).sort(function(a, b) { return b.actuals.sold - a.actuals.sold; });
  }, [rows]);
  // Catalog lines the register rings that the sheet has no row for at all.
  var unlisted = useMemo(function() {
    return rows.filter(function(r) { return r.actuals_other && r.actuals_other.sold > 0; })
      .sort(function(a, b) { return b.actuals_other.sold - a.actuals_other.sold; });
  }, [rows]);
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
        {isAdmin && !editMode && mismatches.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 14, borderRadius: 10, border: "1px solid var(--yellow)", background: "#FBBF2414", fontSize: 12, animation: "pbExpand .22s ease both" }}>
            <span style={{ color: "var(--yellow)", fontWeight: 800 }}>The register disagrees with this sheet on {mismatches.length} price{mismatches.length === 1 ? "" : "s"}</span>
            <span style={{ color: "var(--text-muted)" }}>· {unlisted.length} line{unlisted.length === 1 ? "" : "s"} it rings that aren&apos;t on the sheet at all</span>
            <button onClick={function() { setEditMode(true); setShowReconcile(true); }} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 7, border: "none", background: "var(--yellow)", color: "#0B0D11", fontSize: 11.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>Review them</button>
          </div>
        )}
        {editMode && (mismatches.length > 0 || unlisted.length > 0) && (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--yellow)", borderRadius: 14, marginBottom: 12, overflow: "hidden", animation: "pbExpand .22s ease both" }}>
            <div onClick={function() { setShowReconcile(!showReconcile); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer", userSelect: "none" }}>
              <span style={{ color: "var(--text-muted)", fontSize: 11, transform: showReconcile ? "rotate(90deg)" : "none", transition: "transform .2s ease", display: "inline-block", width: 12 }}>▶</span>
              <span style={{ fontSize: 13, fontWeight: 800 }}>Reconcile with the register</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{mismatches.length} disagree · {unlisted.length} not on the sheet</span>
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
              <input value={bulk.reason} onChange={function(e) { setBulk(Object.assign({}, bulk, { reason: e.target.value })); }} placeholder="why — e.g. OLED cost dropped $20" style={Object.assign({}, input, { flex: "1 1 220px" })} />
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
                      <button disabled={busy} onClick={function() { commit(preview.map(function(p) { var c = { id: p.id }; c[bulk.field] = p.to; return c; }), bulk.reason); }}
                        style={{ padding: "9px 18px", borderRadius: 8, border: "none", cursor: "pointer", background: "var(--green)", color: "#0B0D11", fontSize: 12.5, fontWeight: 800 }}>{busy ? "Saving…" : "Commit " + preview.length}</button>
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
                    {sample && <span> · e.g. {sample.device} {sample.repair}{sample.tier ? " " + sample.tier : ""}: {money(sample.old_value)} → {money(sample.new_value)}</span>}
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
          return <DeviceCard key={d.device} device={d.device} rows={d.rows} index={i} isAdmin={isAdmin} editMode={editMode} selectedIds={selectedIds} onToggle={toggle} onInline={inlineSave} forceOpen={devices.length <= 4 || q.trim().length > 0} />;
        })}
        {devices.length > 60 && <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: 12 }}>Showing 60 of {devices.length} — type to narrow it down.</div>}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--bg-card)", border: "1px solid " + toast.tone, color: toast.tone, padding: "11px 18px", borderRadius: 10, fontSize: 12.5, fontWeight: 700, boxShadow: "0 10px 30px rgba(0,0,0,.3)", zIndex: 20, animation: "pbIn .25s ease both", maxWidth: "90vw" }}>{toast.text}</div>
      )}

      <style>{"@keyframes pbIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } } @keyframes pbExpand { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } }"}</style>
    </div>
  );
}

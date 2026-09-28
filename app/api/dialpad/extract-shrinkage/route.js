// Read damage and shrinkage off a screenshot of RepairQ's inventory usage
// summary, so the monthly reconciliation stops being hand-typed.
//
// Same shape as extract-gbp and extract-amex: this route only READS the image
// and returns numbers. Nothing is saved until a person looks at them and hits
// save in the Profitability tab — which matters more here than usual, because
// the layout of that RepairQ report has not been seen by this code. The prompt
// is written to the report's vocabulary rather than its pixel layout, and every
// line item it found comes back so a wrong total can be traced to the row that
// caused it.
//
// Damage and shrinkage land in profitability.damaged / .shrinkage, which feed
// Store Controllables in the P&L. Eric's policy (2026-08-17): cleanup-era
// shrinkage got a pass through August 2026; from September it counts.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { AI_MODEL, storeKeyFromName } from "@/lib/constants";

export const maxDuration = 60;

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];
// RepairQ names the locations in its own way; storeKeyFromName maps whatever
// comes back onto ours, and returns null rather than guessing.
var storeKey = storeKeyFromName;
function money(v) {
  if (v === null || v === undefined || v === "") return 0;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isFinite(n) ? Math.round(Math.abs(n) * 100) / 100 : 0;
}

var PROMPT = `This is RepairQ's inventory usage / adjustment summary for a CPR Cell Phone Repair franchise.

Pull out every inventory adjustment that COST the business money, and classify each one as damage, shrinkage or voided:

- "damaged" — a part broken in handling or a failed repair. Reasons read like: Damaged, Damage, Defective, Broken, DOA, Failed Install, Bad Part, Warranty Loss.
- "shrinkage" — inventory that is simply gone or unaccounted for. Reasons read like: Shrinkage, Loss, Lost, Missing, Stolen, Theft, Count Adjustment, Cycle Count, Inventory Adjustment, Write-off.
- "voided" — a voided or cancelled transaction that still consumed stock.

Ignore anything that is NOT a loss: parts consumed by a normal repair or sale, transfers between locations, received stock, returns to a supplier, and any positive adjustment that ADDS inventory.

Use the COST value, not the retail price. If a row shows a quantity and a unit cost, multiply them. Report every amount as a positive number.

Return ONLY valid JSON — no markdown, no backticks, no preamble:

{
  "period_shown": "what date range the report covers, verbatim, or null",
  "locations_found": ["the location names exactly as the report writes them"],
  "by_store": [
    {"store": "location name as written", "damaged": 0.00, "shrinkage": 0.00, "voided": 0.00}
  ],
  "line_items": [
    {"store": "location name as written", "item": "part name", "reason": "reason as written", "bucket": "damaged|shrinkage|voided", "qty": 0, "cost": 0.00}
  ],
  "unclassified": [
    {"store": "location name", "item": "part name", "reason": "reason as written", "cost": 0.00}
  ],
  "notes": "anything ambiguous a person should check, or null"
}

Rules:
- If the report covers only ONE location and never names it, use "unknown" as the store name and say so in notes.
- Put any loss whose reason you cannot confidently bucket into "unclassified" rather than guessing. Never silently drop a row.
- by_store totals must equal the sum of line_items for that store and bucket.
- If you cannot read a number, leave it out of the totals and say so in notes. Do not invent one.`;

export async function POST(request) {
  // Matt reconciles this each month, so manager is enough (open item 14 —
  // "grant Matt edit permission on controllable expenses").
  var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
  if (!gate.authorized) return gate.response;

  try {
    var body = await request.json();
    var pages = body.pages;   // [{ data: base64, media_type }]
    var rawText = body.text;  // or pasted text, which costs nothing to support
    var period = body.period || null;

    if ((!pages || !pages.length) && !rawText) return json({ success: false, error: "No screenshot or text provided" }, 400);

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ success: false, error: "Anthropic API key not configured" }, 500);

    var content = [];
    if (rawText) {
      content.push({ type: "text", text: "Here is text from a RepairQ inventory usage summary:\n\n" + rawText });
    } else {
      for (var i = 0; i < pages.length; i++) {
        var pg = pages[i];
        if (pg.media_type === "application/pdf") {
          content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pg.data } });
        } else {
          content.push({ type: "image", source: { type: "base64", media_type: pg.media_type || "image/png", data: pg.data } });
        }
      }
    }
    content.push({ type: "text", text: PROMPT + (period ? "\n\nThe person importing this says it covers " + period + ". If the report itself disagrees, say so in notes and report what the REPORT says." : "") });

    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 8000, messages: [{ role: "user", content: content }] }),
    });

    // Loud, not silent: a failed extraction says why (June 2026).
    if (!res.ok) {
      var errText = await res.text();
      console.error("[extract-shrinkage] Anthropic error:", res.status, errText.slice(0, 400));
      var msg = "AI extraction failed (" + res.status + ")";
      try { var ej = JSON.parse(errText); msg = (ej.error && ej.error.message) || msg; } catch (e) { /* keep the status */ }
      return json({ success: false, error: msg }, 502);
    }

    var result = await res.json();
    var text = "";
    (result.content || []).forEach(function(c) { if (c.type === "text") text += c.text; });
    text = text.trim();
    if (text.indexOf("```") === 0) text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");

    var extracted;
    try { extracted = JSON.parse(text); }
    catch (e) {
      console.error("[extract-shrinkage] unparseable response:", text.slice(0, 500));
      return json({ success: false, error: "Could not read the report. The model returned: " + text.slice(0, 200) }, 502);
    }

    // Fold RepairQ's location names onto ours, and total what it found.
    var byStore = {};
    STORE_KEYS.forEach(function(k) { byStore[k] = { store: k, damaged: 0, shrinkage: 0, voided: 0, matched_as: null }; });
    var unmatched = [];
    (extracted.by_store || []).forEach(function(r) {
      var k = storeKey(r.store);
      if (!k) { unmatched.push({ store: r.store || "(unnamed)", damaged: money(r.damaged), shrinkage: money(r.shrinkage), voided: money(r.voided) }); return; }
      byStore[k].damaged += money(r.damaged);
      byStore[k].shrinkage += money(r.shrinkage);
      byStore[k].voided += money(r.voided);
      byStore[k].matched_as = r.store;
    });
    STORE_KEYS.forEach(function(k) {
      byStore[k].damaged = Math.round(byStore[k].damaged * 100) / 100;
      byStore[k].shrinkage = Math.round(byStore[k].shrinkage * 100) / 100;
      byStore[k].voided = Math.round(byStore[k].voided * 100) / 100;
    });

    var lines = (extracted.line_items || []).map(function(l) {
      return { store: storeKey(l.store), store_raw: l.store || null, item: l.item || "", reason: l.reason || "", bucket: l.bucket || null, qty: l.qty || null, cost: money(l.cost) };
    });
    var unclassified = (extracted.unclassified || []).map(function(l) {
      return { store: storeKey(l.store), store_raw: l.store || null, item: l.item || "", reason: l.reason || "", cost: money(l.cost) };
    });

    // Does the per-store summary agree with the rows behind it? A mismatch
    // doesn't block the import — it is shown, so the person deciding can look.
    var lineTotals = {};
    lines.forEach(function(l) {
      if (!l.store || !l.bucket) return;
      var t = lineTotals[l.store] || (lineTotals[l.store] = { damaged: 0, shrinkage: 0, voided: 0 });
      if (t[l.bucket] !== undefined) t[l.bucket] += l.cost;
    });
    var disagreements = [];
    STORE_KEYS.forEach(function(k) {
      var t = lineTotals[k];
      if (!t) return;
      ["damaged", "shrinkage", "voided"].forEach(function(b) {
        var summed = Math.round(t[b] * 100) / 100;
        if (Math.abs(summed - byStore[k][b]) > 0.01) disagreements.push({ store: k, bucket: b, summary: byStore[k][b], line_items: summed });
      });
    });

    var total = STORE_KEYS.reduce(function(s, k) { return s + byStore[k].damaged + byStore[k].shrinkage + byStore[k].voided; }, 0);

    return json({
      success: true,
      period: period,
      period_shown: extracted.period_shown || null,
      by_store: STORE_KEYS.map(function(k) { return byStore[k]; }),
      total: Math.round(total * 100) / 100,
      line_items: lines,
      unclassified: unclassified,
      unmatched_locations: unmatched,
      disagreements: disagreements,
      notes: extracted.notes || null,
    });
  } catch (e) {
    console.error("[extract-shrinkage] failed:", e.message);
    return json({ success: false, error: e.message }, 500);
  }
}

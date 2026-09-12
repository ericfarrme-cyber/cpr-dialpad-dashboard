// Interpretation of the quotes report — what we should be seeing and what
// to do about it — in plain words for Eric and Matt.
//
//   POST /api/dialpad/quote-insights  { metrics: <compact quote-metrics>, demand: {...} }
//
// The client sends the numbers it already has (a route must never HTTP-call
// itself on Vercel). The model gets the numbers and the rules of the house,
// and answers in a fixed shape: reading, actions, watch, caveat. Any failure
// is returned as a failure — a blank interpretation is worse than none.
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { AI_MODEL } from "@/lib/constants";

export const dynamic = "force-dynamic";

function trim(o, keys) { var out = {}; keys.forEach(function(k) { if (o && o[k] !== undefined) out[k] = o[k]; }); return out; }

export async function POST(request) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
  var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
  if (!gate.authorized) return gate.response;

  try {
    var body = await request.json();
    var m = body.metrics || {};
    if (!m.totals) return NextResponse.json({ success: false, error: "metrics missing" }, { status: 400 });

    // Compact, so the model reads numbers, not a payload.
    var compact = {
      window: { since: m.since, months: m.months, store: m.store, min_sample: m.min_sample, event_window_days: m.event_window_days },
      totals: m.totals,
      bands: (m.bands || []).map(function(b) { return trim(b, ["label", "quotes", "showed", "no_show", "pending", "ticketed", "show_rate", "avg_discount", "readable"]); }),
      reasons: (m.reasons || []).slice(0, 8).map(function(r) { return trim(r, ["label", "quotes", "showed", "no_show", "avg_discount", "show_rate"]); }),
      agents: (m.agents || []).slice(0, 10).map(function(a) { return trim(a, ["label", "quotes", "at_sheet_rate", "avg_discount", "showed", "no_show", "show_rate"]); }),
      models: (m.models || []).slice(0, 12).map(function(x) { return trim(x, ["label", "quotes", "at_sheet_rate", "avg_discount", "showed", "no_show"]); }),
      price_changes: (m.events || []).slice(0, 12).map(function(e) {
        return { date: e.date, model: e.model, repair: e.repair, tier: e.tier, old_price: e.old_price, new_price: e.new_price, introduced: e.introduced, reason: e.reason,
          before: e.before, after: e.after, after_days_elapsed: e.after_days_elapsed, quotes_after: e.quotes_after };
      }),
      demand: body.demand || null,
    };

    var prompt =
      "You are reading a report for the owner (Eric) and area manager (Matt) of three CPR Cell Phone Repair stores in Indiana. " +
      "The report covers quotes given from the repair price book and booked as appointments, and price changes made to that book.\n\n" +
      "HOUSE RULES you must respect:\n" +
      "- The price book is meant to encourage agents to AIM HIGH: quote the sheet price, discount only with a reason.\n" +
      "- A rate built on fewer than " + (m.min_sample || 20) + " decided visits is not a conclusion. Say 'too early' plainly when it is.\n" +
      "- Price changes: describe what happened before vs after; never claim the change caused it. Insurance claims are already excluded.\n" +
      "- Reasons like 'Booking the appointment' or 'Slow day' are agent-chosen labels for why a quote went under the sheet.\n" +
      "- Actions must be specific, doable this week, and name who does them (Eric, Matt, or the agents). No filler, no praise.\n" +
      "- Numbers you cite must come from the data below. Do not invent figures.\n\n" +
      "DATA (JSON):\n" + JSON.stringify(compact) + "\n\n" +
      "Respond in EXACTLY this JSON, no markdown, no backticks:\n" +
      '{"headline": "one sentence, the single most important thing in this report", ' +
      '"reading": ["what we are seeing, 2-4 short bullets, each with the number that backs it"], ' +
      '"actions": ["2-4 bullets, each: WHO does WHAT this week, and the number that will show it worked"], ' +
      '"watch": ["1-3 bullets: what to check next week and the threshold that would change the call"], ' +
      '"caveat": "one sentence on what this data cannot tell you yet"}';

    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 900, messages: [{ role: "user", content: prompt }] }),
    });
    var aiRes = await res.json();
    if (!res.ok) {
      console.error("[quote-insights] Anthropic error:", JSON.stringify(aiRes).slice(0, 300));
      return NextResponse.json({ success: false, error: "AI request failed: " + ((aiRes.error && aiRes.error.message) || res.status) }, { status: 502 });
    }
    var reply = aiRes.content && aiRes.content[0] ? aiRes.content[0].text : "";
    var parsed;
    try { parsed = JSON.parse(reply.replace(/```json|```/g, "").trim()); }
    catch (e) {
      console.error("[quote-insights] unparseable reply:", reply.slice(0, 300));
      return NextResponse.json({ success: false, error: "AI reply was not in the expected shape" }, { status: 502 });
    }
    return NextResponse.json({
      success: true,
      generated_at: new Date().toISOString(),
      model: AI_MODEL,
      headline: String(parsed.headline || ""),
      reading: Array.isArray(parsed.reading) ? parsed.reading.map(String) : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions.map(String) : [],
      watch: Array.isArray(parsed.watch) ? parsed.watch.map(String) : [],
      caveat: String(parsed.caveat || ""),
    });
  } catch (e) {
    console.error("[quote-insights] failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

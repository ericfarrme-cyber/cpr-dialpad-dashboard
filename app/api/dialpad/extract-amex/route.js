import { NextResponse } from "next/server";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

// Known parts vendors — these are already in COGS via RepairQ
var PARTS_VENDORS = [
  "mobilesentrix", "phone lcd parts", "blisscomput", "zagg", "spot,",
  "spot ", "nwuebker@radial"
];

function isPartsVendor(description) {
  var lower = (description || "").toLowerCase();
  return PARTS_VENDORS.some(function(v) { return lower.includes(v); });
}

export async function POST(request) {
  try {
    var body = await request.json();
    var text = body.text;

    if (!text) return json({ success: false, error: "No text provided" });

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ success: false, error: "Anthropic API key not configured" });

    var response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: [
          { type: "text", text: "Here is text extracted from an American Express business credit card statement for Focused Technologies LLC:\n\n" + text },
          { type: "text", text: `Extract ONLY the transactions charged by MATTHEW SLADE (Card Ending 3-71024). Ignore all transactions by ERIC J FARR.

Return ONLY valid JSON with no markdown, no backticks, no preamble. The JSON must be:

{
  "statement_period": "MM/DD/YYYY - MM/DD/YYYY",
  "matt_total": 0.00,
  "transactions": [
    {"date": "MM/DD/YY", "vendor": "Vendor Name", "location": "City ST", "amount": 0.00, "category": "parts|gas|food|shipping|telecom|travel|vehicle|software|other"}
  ]
}

Category rules:
- "parts": BT*MOBILESENTRIX, BT*PHONE LCD PARTS, BLISSCOMPUT, ZAGG, MOBILESENTRIX, SPOT (West Chester PA) — these are phone repair parts suppliers
- "gas": Speedway, Marathon, Kroger Fuel, Shell, gas stations
- "food": Coffee shops, restaurants, doughnuts, bakeries
- "shipping": UPS, FedEx, USPS, Postal Annex
- "telecom": ATT Business, phone/internet services
- "travel": Uber, Lyft, hotels, airlines, Marriott
- "vehicle": Ford, auto repair, car maintenance
- "software": Subscriptions, Claude.AI, Paddle.net, Apple.com/Bill
- "other": Anything else

All amounts should be positive numbers (charges). Return ONLY the JSON.` }
        ] }],
      }),
    });

    if (!response.ok) {
      var errText = await response.text();
      var errMsg = "AI extraction failed: " + response.status;
      try { var errJson = JSON.parse(errText); errMsg = errJson.error?.message || errMsg; } catch(e) {}
      return json({ success: false, error: errMsg });
    }

    var result = await response.json();
    var responseText = "";
    for (var i = 0; i < result.content.length; i++) {
      if (result.content[i].type === "text") responseText += result.content[i].text;
    }

    responseText = responseText.trim();
    if (responseText.startsWith("```")) {
      responseText = responseText.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    var extracted;
    try {
      extracted = JSON.parse(responseText);
    } catch (parseErr) {
      return json({ success: false, error: "Could not parse AI response. Raw: " + responseText.substring(0, 300) });
    }

    // Post-process: separate parts vs non-parts
    var parts = [];
    var nonParts = [];
    var partsTotal = 0;
    var nonPartsTotal = 0;

    (extracted.transactions || []).forEach(function(t) {
      // Double-check categorization using our vendor list
      if (t.category === "parts" || isPartsVendor(t.vendor)) {
        t.category = "parts";
        parts.push(t);
        partsTotal += t.amount || 0;
      } else {
        nonParts.push(t);
        nonPartsTotal += t.amount || 0;
      }
    });

    // Group non-parts by category
    var byCategory = {};
    nonParts.forEach(function(t) {
      var cat = t.category || "other";
      if (!byCategory[cat]) byCategory[cat] = { total: 0, count: 0, items: [] };
      byCategory[cat].total += t.amount || 0;
      byCategory[cat].count++;
      byCategory[cat].items.push(t);
    });

    return json({
      success: true,
      data: {
        statement_period: extracted.statement_period || "",
        matt_total: extracted.matt_total || 0,
        parts_total: Math.round(partsTotal * 100) / 100,
        non_parts_total: Math.round(nonPartsTotal * 100) / 100,
        parts_count: parts.length,
        non_parts_count: nonParts.length,
        by_category: byCategory,
        non_parts: nonParts,
        parts: parts,
      },
    });

  } catch (e) {
    console.error("Extract Amex error:", e);
    return json({ success: false, error: e.message });
  }
}

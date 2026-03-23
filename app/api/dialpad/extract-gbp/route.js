import { NextResponse } from "next/server";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

export async function POST(request) {
  try {
    var body = await request.json();
    var pages = body.pages; // array of { data: base64, media_type: "image/png" | "application/pdf" }

    if (!pages || pages.length === 0) {
      return json({ success: false, error: "No pages provided" });
    }

    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return json({ success: false, error: "Anthropic API key not configured" });

    // Build content array with all pages
    var content = [];
    for (var i = 0; i < pages.length; i++) {
      var pg = pages[i];
      if (pg.media_type === "application/pdf") {
        content.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: pg.data },
        });
      } else {
        content.push({
          type: "image",
          source: { type: "base64", media_type: pg.media_type || "image/png", data: pg.data },
        });
      }
    }

    content.push({
      type: "text",
      text: `Extract ALL data from this Google Business Profile weekly report PDF. Return ONLY valid JSON with no markdown formatting, no backticks, no preamble. The JSON must have this exact structure:

{
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "customer_calls": 0,
  "profile_views": 0,
  "website_visits": 0,
  "direction_requests": 0,
  "competitors_outranked": 0,
  "received_reviews": 0,
  "posts_published": 0,
  "photos_published": 0,
  "review_responses": 0,
  "offers_published": 0,
  "keywords": [
    {"keyword": "example keyword", "position": 1, "position_change": 0}
  ],
  "competitors": [
    {"name": "Competitor Name", "actions": "What they did", "impact": "Impact description"}
  ]
}

Rules:
- For the period dates, parse them from the report header (e.g. "16-22 March 2026" becomes period_start "2026-03-16" and period_end "2026-03-22")
- For statistics, find the numbers for Customer calls, Profile views, Website visits, Direction requests
- For competitors_outranked, use the number shown (may be 0)
- For keywords, extract each keyword with its current position and position change (+ means improved, 0 means no change, - means dropped). If the position shows "3 → 2" that means position is 2 and change is +1
- For competitors, extract name, their actions, and the impact/potential impact
- For content activity, extract posts published, photos published, review responses, offers published
- For received_reviews, look for the new reviews count (e.g. "+3 new reviews" means 3)
- All numbers should be integers, not strings
- Return ONLY the JSON object, nothing else`
    });

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
        messages: [{ role: "user", content: content }],
      }),
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return json({ success: false, error: "AI extraction failed: " + response.status });
    }

    var result = await response.json();
    var text = "";
    for (var i = 0; i < result.content.length; i++) {
      if (result.content[i].type === "text") text += result.content[i].text;
    }

    // Clean and parse JSON
    text = text.trim();
    // Remove markdown code fences if present
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    var extracted;
    try {
      extracted = JSON.parse(text);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr.message, "Raw:", text.substring(0, 500));
      return json({ success: false, error: "Could not parse extracted data. Raw: " + text.substring(0, 200) });
    }

    return json({ success: true, data: extracted });

  } catch (e) {
    console.error("Extract GBP error:", e);
    return json({ success: false, error: e.message });
  }
}

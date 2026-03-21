import { NextResponse } from "next/server";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

export async function POST(request) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ success: false, error: "Anthropic API key not configured" });

  try {
    var formData = await request.formData();
    var file = formData.get("image");
    if (!file) return json({ success: false, error: "No image provided" });

    var buffer = await file.arrayBuffer();
    var base64 = Buffer.from(buffer).toString("base64");
    var mediaType = file.type || "image/png";

    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: 'This is a RepairQ "Profitability by Item Type" report for a CPR Cell Phone Repair store. Extract the financial data and return ONLY a JSON object with these exact fields. For each item type row, map it to the correct category. Use the "Net Sales" column for revenue and "COGS" column for cost of goods sold.\n\nMapping:\n- Rows starting with "Accessory" → sum into accessory_revenue (Net Sales) and accessory_cogs (COGS)\n- Rows starting with "Device" → device_revenue and device_cogs\n- Rows starting with "Repair" → sum ALL repair types into repair_revenue and repair_cogs\n- Rows starting with "Part" → parts_revenue and parts_cogs\n- Rows starting with "Service" → services_revenue and services_cogs\n- Rows starting with "Promotion" → promotions_revenue and promotions_cogs\n\nIMPORTANT: Use the "Net Sales" column (which is Gross Sales minus Returns minus Discounts) for revenue, NOT the "Gross Sales" column. Use the "COGS" column for cost values.\n\nReturn ONLY valid JSON, no markdown, no backticks, no explanation:\n{"accessory_revenue": 0, "accessory_cogs": 0, "device_revenue": 0, "device_cogs": 0, "repair_revenue": 0, "repair_cogs": 0, "parts_revenue": 0, "parts_cogs": 0, "services_revenue": 0, "services_cogs": 0, "promotions_revenue": 0, "promotions_cogs": 0}',
            },
          ],
        }],
      }),
    });

    var aiRes = await res.json();
    var reply = aiRes.content && aiRes.content[0] ? aiRes.content[0].text : "";

    // Parse JSON
    var cleaned = reply.replace(/```json|```/g, "").trim();
    var data = JSON.parse(cleaned);

    return json({ success: true, data: data });
  } catch(e) {
    console.error("[extract-profitability] Error:", e.message);
    return json({ success: false, error: "Failed to extract data: " + e.message });
  }
}

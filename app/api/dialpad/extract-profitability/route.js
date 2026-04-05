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
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: 'You are reading a RepairQ "Profitability by Item Type" report screenshot for a CPR Cell Phone Repair store.\n\nThe table has these columns: Item Type | Gross Sales | Gross Returns | Restock Fees | Net Discounts | Net Sales | COGS | Gross Profit | GPM %\n\nSTEP 1: List EVERY row in the table. For each row, extract the "Item Type", "Net Sales" dollar amount, and "COGS" dollar amount. Be extremely careful reading the numbers — they include dollar signs and commas. Read each digit carefully.\n\nSTEP 2: Group and sum the rows into categories:\n- accessory_revenue = SUM of "Net Sales" for ALL rows where Item Type starts with "Accessory" (Case + Power + Screen Protector + Audio + Misc + Other + any others)\n- accessory_cogs = SUM of "COGS" for those same Accessory rows\n- repair_revenue = SUM of "Net Sales" for ALL rows where Item Type starts with "Repair" (Phone + Computer + Game + Tablet + Misc + any others)\n- repair_cogs = SUM of "COGS" for those same Repair rows\n- device_revenue = SUM of "Net Sales" for rows starting with "Device"\n- device_cogs = SUM of "COGS" for Device rows\n- parts_revenue = SUM of "Net Sales" for rows starting with "Part"\n- parts_cogs = SUM of "COGS" for Part rows\n- services_revenue = SUM of "Net Sales" for rows starting with "Service"\n- services_cogs = SUM of "COGS" for Service rows\n- promotions_revenue = SUM of "Net Sales" for rows starting with "Promotion"\n- promotions_cogs = SUM of "COGS" for Promotion rows\n\nCRITICAL RULES:\n- Use the "Net Sales" column for revenue (NOT "Gross Sales")\n- Use the "COGS" column for cost values\n- There is a "Total" row at the bottom — do NOT include it in any category sum, but use it to verify: the sum of all category revenues should equal the Total Net Sales, and sum of all category COGS should equal Total COGS\n- Numbers with parentheses like ($85.21) are NEGATIVE\n- If a value shows "$ 0.00" it is zero\n- "Repair - Phone" is usually the LARGEST revenue row (often $20,000+) — make sure you read all its digits correctly\n\nSTEP 3: Return ONLY a JSON object with the summed values. No explanation, no markdown, no backticks:\n{"accessory_revenue": 0, "accessory_cogs": 0, "device_revenue": 0, "device_cogs": 0, "repair_revenue": 0, "repair_cogs": 0, "parts_revenue": 0, "parts_cogs": 0, "services_revenue": 0, "services_cogs": 0, "promotions_revenue": 0, "promotions_cogs": 0}',
            },
          ],
        }],
      }),
    });

    var aiRes = await res.json();
    var reply = aiRes.content && aiRes.content[0] ? aiRes.content[0].text : "";

    // Parse JSON
    var cleaned = reply.replace(/```json|```/g, "").trim();
    // Try to extract JSON from response even if there's text around it
    var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ success: false, error: "Could not parse JSON from AI response" });
    var data = JSON.parse(jsonMatch[0]);

    // Verification: log totals for debugging
    var totalRev = (parseFloat(data.accessory_revenue)||0) + (parseFloat(data.device_revenue)||0) + (parseFloat(data.repair_revenue)||0) + (parseFloat(data.parts_revenue)||0) + (parseFloat(data.services_revenue)||0) + (parseFloat(data.promotions_revenue)||0);
    var totalCogs = (parseFloat(data.accessory_cogs)||0) + (parseFloat(data.device_cogs)||0) + (parseFloat(data.repair_cogs)||0) + (parseFloat(data.parts_cogs)||0) + (parseFloat(data.services_cogs)||0) + (parseFloat(data.promotions_cogs)||0);
    console.log("[extract-profitability] Extracted — Revenue: $" + totalRev.toFixed(2) + " | COGS: $" + totalCogs.toFixed(2) + " | Repair Rev: $" + (parseFloat(data.repair_revenue)||0).toFixed(2));

    return json({ success: true, data: data, verification: { totalRevenue: totalRev, totalCogs: totalCogs } });
  } catch(e) {
    console.error("[extract-profitability] Error:", e.message);
    return json({ success: false, error: "Failed to extract data: " + e.message });
  }
}

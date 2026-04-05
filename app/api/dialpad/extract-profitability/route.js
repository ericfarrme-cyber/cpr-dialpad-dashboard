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
        max_tokens: 3000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: 'You are reading a RepairQ "Profitability by Item Type" report. The table has columns including "Item Type", "Net Sales", and "COGS".\n\nExtract EVERY data row from the table (NOT the Total row). For each row, read the "Item Type" name, the "Net Sales" dollar amount, and the "COGS" dollar amount.\n\nCRITICAL RULES FOR READING NUMBERS:\n- Read each digit one at a time. Do not guess or approximate.\n- Numbers have dollar signs and commas: "$ 25,468.77" = 25468.77\n- Numbers in parentheses are negative: "($ 269.20)" = -269.20\n- "$ 0.00" = 0\n- The "Net Sales" column is the 6th column from the left\n- The "COGS" column is the 7th column from the left\n- DO NOT use "Gross Sales" (1st data column) — use "Net Sales" (6th column)\n- "Repair - Phone" row typically has the largest Net Sales value, often $20,000-$30,000\n\nAlso extract the TOTAL row values separately for verification.\n\nReturn ONLY a JSON object with this exact structure, no markdown, no backticks:\n{"rows": [{"item": "Accessory - Case", "net_sales": 734.69, "cogs": 193.41}, {"item": "Accessory - Power", "net_sales": 410.26, "cogs": 154.13}], "total_net_sales": 34989.83, "total_cogs": 14142.57}',
            },
          ],
        }],
      }),
    });

    var aiRes = await res.json();
    var reply = aiRes.content && aiRes.content[0] ? aiRes.content[0].text : "";

    // Parse JSON — extract rows
    var cleaned = reply.replace(/```json|```/g, "").trim();
    var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ success: false, error: "Could not parse JSON from AI response" });
    var parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.rows || !Array.isArray(parsed.rows)) {
      return json({ success: false, error: "AI response missing rows array" });
    }

    // Group and sum in CODE — no AI math errors
    var categories = {
      accessory_revenue: 0, accessory_cogs: 0,
      device_revenue: 0, device_cogs: 0,
      repair_revenue: 0, repair_cogs: 0,
      parts_revenue: 0, parts_cogs: 0,
      services_revenue: 0, services_cogs: 0,
      promotions_revenue: 0, promotions_cogs: 0,
    };

    parsed.rows.forEach(function(row) {
      var item = (row.item || "").toLowerCase().trim();
      var ns = parseFloat(row.net_sales) || 0;
      var cogs = parseFloat(row.cogs) || 0;

      if (item.startsWith("accessory")) {
        categories.accessory_revenue += ns;
        categories.accessory_cogs += cogs;
      } else if (item.startsWith("repair")) {
        categories.repair_revenue += ns;
        categories.repair_cogs += cogs;
      } else if (item.startsWith("device")) {
        categories.device_revenue += ns;
        categories.device_cogs += cogs;
      } else if (item.startsWith("part")) {
        categories.parts_revenue += ns;
        categories.parts_cogs += cogs;
      } else if (item.startsWith("service")) {
        categories.services_revenue += ns;
        categories.services_cogs += cogs;
      } else if (item.startsWith("promotion")) {
        categories.promotions_revenue += ns;
        categories.promotions_cogs += cogs;
      }
    });

    // Round to 2 decimal places
    Object.keys(categories).forEach(function(k) {
      categories[k] = Math.round(categories[k] * 100) / 100;
    });

    // Verification against Total row
    var computedRevenue = categories.accessory_revenue + categories.device_revenue + categories.repair_revenue + categories.parts_revenue + categories.services_revenue + categories.promotions_revenue;
    var computedCogs = categories.accessory_cogs + categories.device_cogs + categories.repair_cogs + categories.parts_cogs + categories.services_cogs + categories.promotions_cogs;
    var reportedRevenue = parseFloat(parsed.total_net_sales) || 0;
    var reportedCogs = parseFloat(parsed.total_cogs) || 0;
    var revDiff = Math.abs(computedRevenue - reportedRevenue);
    var cogsDiff = Math.abs(computedCogs - reportedCogs);

    console.log("[extract-profitability] Rows extracted: " + parsed.rows.length);
    console.log("[extract-profitability] Computed Revenue: $" + computedRevenue.toFixed(2) + " | Report Total: $" + reportedRevenue.toFixed(2) + " | Diff: $" + revDiff.toFixed(2));
    console.log("[extract-profitability] Computed COGS: $" + computedCogs.toFixed(2) + " | Report Total: $" + reportedCogs.toFixed(2) + " | Diff: $" + cogsDiff.toFixed(2));

    var verified = revDiff < 1.00 && cogsDiff < 1.00;

    return json({
      success: true,
      data: categories,
      verification: {
        rows_extracted: parsed.rows.length,
        computed_revenue: Math.round(computedRevenue * 100) / 100,
        computed_cogs: Math.round(computedCogs * 100) / 100,
        report_total_revenue: reportedRevenue,
        report_total_cogs: reportedCogs,
        revenue_diff: Math.round(revDiff * 100) / 100,
        cogs_diff: Math.round(cogsDiff * 100) / 100,
        verified: verified,
      },
      rows: parsed.rows,
    });
  } catch(e) {
    console.error("[extract-profitability] Error:", e.message);
    return json({ success: false, error: "Failed to extract data: " + e.message });
  }
}

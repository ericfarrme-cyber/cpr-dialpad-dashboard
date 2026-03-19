import { NextResponse } from "next/server";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "API key not configured" }, { headers: corsHeaders() });

  try {
    var body = await request.json();
    var messages = body.messages || [];

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
        messages: messages,
      }),
    });

    var json = await res.json();
    var reply = "";
    if (json.content && json.content[0]) {
      reply = json.content[0].text;
    }

    return NextResponse.json({ success: true, reply: reply }, { headers: corsHeaders() });
  } catch(e) {
    console.error("[ai-chat] Error:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { headers: corsHeaders() });
  }
}

// app/api/dialpad/debug-export/route.js
// TEMPORARY diagnostic: dumps Dialpad's RAW response for a stats export poll,
// so we can see exactly what the is_today exports return (status code, content
// type, body). Gated behind the cron secret. Safe to delete once the is_today
// completion-detection issue is resolved.
//
// Usage:
//   /api/dialpad/debug-export?secret=<CRON_SECRET>&requestId=<id>

import { NextResponse } from "next/server";

const DIALPAD_BASE = "https://dialpad.com/api/v2";

export async function GET(request) {
  var url = new URL(request.url);
  var secret = url.searchParams.get("secret") || "";
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  var requestId = (url.searchParams.get("requestId") || "").trim();
  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }

  try {
    var res = await fetch(DIALPAD_BASE + "/stats/" + requestId, {
      method: "GET",
      headers: {
        Authorization: "Bearer " + (process.env.DIALPAD_API_KEY || ""),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    var rawText = await res.text();
    var headersOut = {};
    res.headers.forEach(function (v, k) { headersOut[k] = v; });

    return NextResponse.json({
      requestId: requestId,
      httpStatus: res.status,
      contentType: res.headers.get("content-type") || "",
      headers: headersOut,
      bodyLength: rawText.length,
      bodyPreview: rawText.slice(0, 3000),
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

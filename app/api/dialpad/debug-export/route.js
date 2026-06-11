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

  // ── CALL-LIST PROBE: ?calls=1&target=<departmentId> ──
  // Dumps a raw sample from Dialpad's SYNCHRONOUS call-list API (GET /call) so
  // the today-leg bypass can be mapped from real field names instead of guesses.
  // The answered/missed classification feeds the answer-rate bonus — mapping it
  // blind is not acceptable.
  if (url.searchParams.get("calls")) {
    var target = (url.searchParams.get("target") || "").trim();
    if (!target) return NextResponse.json({ error: "target (department id) required" }, { status: 400 });
    try {
      // Last 6 hours, small sample. started_after is epoch millis per Dialpad docs.
      var sinceMs = Date.now() - 6 * 60 * 60 * 1000;
      var listUrl = DIALPAD_BASE + "/call?target_id=" + encodeURIComponent(target) +
        "&target_type=department&started_after=" + sinceMs + "&limit=5";
      var lr = await fetch(listUrl, {
        method: "GET",
        headers: {
          Authorization: "Bearer " + (process.env.DIALPAD_API_KEY || ""),
          Accept: "application/json",
        },
      });
      var lrText = await lr.text();
      return NextResponse.json({
        probe: "call-list",
        requestUrl: listUrl.replace(/Bearer [^&]*/g, ""),
        httpStatus: lr.status,
        contentType: lr.headers.get("content-type") || "",
        bodyLength: lrText.length,
        bodyPreview: lrText.slice(0, 6000),
      });
    } catch (probeErr) {
      return NextResponse.json({ error: probeErr.message }, { status: 500 });
    }
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

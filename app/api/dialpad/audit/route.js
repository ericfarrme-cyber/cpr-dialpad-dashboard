import { NextResponse } from "next/server";
import { supabase, saveAuditResult, getAuditResults, getEmployeePerformance, getStorePerformance, isCallAudited, getEmployeeStatsFromAudits, overrideAudit, excludeAudit, reinstateAudit, deleteAudit, deleteAuditsByEmployee, clearAllAudits, getLowConfidenceAudits } from "@/lib/supabase";
import { AUDIT_PROMPT, preAuditFilter, transcriptPreCheck } from "@/lib/audit-config";

const DIALPAD_BASE = "https://dialpad.com/api/v2";
const API_KEY = process.env.DIALPAD_API_KEY;

function dialpadHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json" };
}


// GET: Read audit results, employee perf, store perf, low confidence
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const store = searchParams.get("store");
  const employee = searchParams.get("employee");
  const callType = searchParams.get("callType");
  const limit = parseInt(searchParams.get("limit") || "200");
  const daysBack = parseInt(searchParams.get("days") || "30");

  if (action === "employees") {
    let data = await getEmployeePerformance(store);
    if (!data || data.length === 0) {
      data = await getEmployeeStatsFromAudits(store);
    }
    return NextResponse.json({ success: true, employees: data });
  }

  if (action === "stores") {
    const data = await getStorePerformance();
    return NextResponse.json({ success: true, stores: data });
  }

  if (action === "low_confidence") {
    const threshold = parseInt(searchParams.get("threshold") || "70");
    const data = await getLowConfidenceAudits(threshold, limit);
    return NextResponse.json({ success: true, audits: data, count: data.length });
  }

  const data = await getAuditResults({ store, employee, callType, limit, daysBack });
  return NextResponse.json({ success: true, audits: data, count: data.length });
}

// POST: Score, override, exclude, delete, re-audit
export async function POST(request) {
  try {
    const body = await request.json();

    // ── Delete audits by employee ──
    if (body.action === "delete_by_employee") {
      const deleted = await deleteAuditsByEmployee(body.employee, body.store);
      return NextResponse.json({ success: true, deleted: deleted });
    }

    // ── Override an audit (manager correction) ──
    if (body.action === "override") {
      if (!body.callId) return NextResponse.json({ success: false, error: "callId required" });
      const result = await overrideAudit(body.callId, {
        callType: body.callType,
        score: body.score,
        notes: body.notes,
        overrideBy: body.overrideBy || "manager",
      });
      if (!result) return NextResponse.json({ success: false, error: "Audit not found" });
      return NextResponse.json({ success: true, audit: result });
    }

    // ── Exclude an audit from scoring ──
    if (body.action === "exclude") {
      if (!body.callId) return NextResponse.json({ success: false, error: "callId required" });
      const result = await excludeAudit(body.callId, body.reason);
      return NextResponse.json({ success: true, audit: result });
    }

    // ── Reinstate an excluded audit ──
    if (body.action === "reinstate") {
      if (!body.callId) return NextResponse.json({ success: false, error: "callId required" });
      const result = await reinstateAudit(body.callId);
      return NextResponse.json({ success: true, audit: result });
    }

    // ── Delete a single audit (for re-audit) ──
    if (body.action === "delete_single") {
      if (!body.callId) return NextResponse.json({ success: false, error: "callId required" });
      const ok = await deleteAudit(body.callId);
      return NextResponse.json({ success: ok, deleted: ok ? 1 : 0 });
    }

    // ── Clear ALL audits (for full re-audit) ──
    if (body.action === "clear_all") {
      const secret = body.secret;
      if (secret !== process.env.CRON_SECRET) return NextResponse.json({ success: false, error: "Secret required for bulk clear" });
      const ok = await clearAllAudits();
      return NextResponse.json({ success: ok });
    }

    // ── Score a single call ──
    const { callId, callInfo, forceReaudit } = body;
    if (!callId) return NextResponse.json({ success: false, error: "callId required" });

    // If re-auditing, delete old result first
    if (forceReaudit) {
      await deleteAudit(callId);
    } else {
      const alreadyDone = await isCallAudited(callId);
      if (alreadyDone) return NextResponse.json({ success: false, error: "Call already audited", alreadyAudited: true });
    }

    // ── Pre-audit filter (inter-store, too short, etc.) ──
    if (callInfo) {
      const preCheck = preAuditFilter(callInfo);
      if (!preCheck.pass) {
        // Auto-save as non_scorable + excluded
        const excluded = await saveAuditResult({
          call_id: callId,
          date: callInfo.date_started || new Date().toISOString(),
          store: callInfo._storeKey || "unknown",
          store_name: callInfo.name || "",
          call_type: "non_scorable",
          employee: "Unknown",
          customer_name: "Unknown",
          device_type: "Not mentioned",
          phone: callInfo.external_number || "",
          direction: callInfo.direction || "inbound",
          talk_duration: callInfo.talk_duration || null,
          inquiry: preCheck.reason,
          outcome: "Auto-excluded by pre-filter",
          score: 0,
          max_score: 0,
          confidence: 100,
          confidence_reason: "Pre-filter auto-exclusion",
          excluded: true,
          exclude_reason: preCheck.detail || preCheck.reason,
          criteria: {},
          transcript_preview: "",
        });
        return NextResponse.json({
          success: true,
          audit: { call_type: "non_scorable", score: 0, max_score: 0, excluded: true, exclude_reason: preCheck.reason, call_id: callId, saved: !!excluded },
          filtered: true,
          filterReason: preCheck.reason,
        });
      }
    }

    // ── Fetch transcript ──
    const transcriptRes = await fetch(`${DIALPAD_BASE}/transcripts/${callId}`, { method: "GET", headers: dialpadHeaders() });
    if (!transcriptRes.ok) {
      return NextResponse.json({ success: false, error: transcriptRes.status === 404 ? "No transcript available" : `Transcript fetch failed (${transcriptRes.status})` });
    }
    const transcriptData = await transcriptRes.json();

    let formattedTranscript = "";
    if (transcriptData.lines) {
      formattedTranscript = transcriptData.lines.map(l => `${l.speaker || l.name || "Unknown"}: ${l.text || l.content || ""}`).join("\n");
    } else if (transcriptData.transcript) {
      formattedTranscript = typeof transcriptData.transcript === "string" ? transcriptData.transcript : JSON.stringify(transcriptData.transcript);
    } else {
      formattedTranscript = JSON.stringify(transcriptData);
    }

    // ── Transcript pre-check ──
    const tCheck = transcriptPreCheck(formattedTranscript);
    if (!tCheck.pass) {
      const excluded = await saveAuditResult({
        call_id: callId,
        date: callInfo?.date_started || new Date().toISOString(),
        store: callInfo?._storeKey || "unknown",
        store_name: callInfo?.name || "",
        call_type: "non_scorable",
        employee: "Unknown",
        customer_name: "Unknown",
        device_type: "Not mentioned",
        phone: callInfo?.external_number || "",
        direction: callInfo?.direction || "inbound",
        talk_duration: callInfo?.talk_duration || null,
        inquiry: tCheck.reason,
        outcome: "Auto-excluded by transcript check",
        score: 0,
        max_score: 0,
        confidence: 100,
        confidence_reason: "Transcript pre-check exclusion",
        excluded: true,
        exclude_reason: tCheck.detail || tCheck.reason,
        criteria: {},
        transcript_preview: (formattedTranscript || "").substring(0, 500),
      });
      return NextResponse.json({
        success: true,
        audit: { call_type: "non_scorable", score: 0, max_score: 0, excluded: true, call_id: callId, saved: !!excluded },
        filtered: true,
        filterReason: tCheck.reason,
      });
    }

    // ── Build context and score with Claude ──
    let context = "";
    if (callInfo) {
      context = `\nCall Info: ${callInfo.direction || ""} call, ${callInfo.external_number || "unknown"}, ${callInfo.date_started || ""}, Store: ${callInfo.name || "unknown"}\n`;
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY || "", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: `${AUDIT_PROMPT}\n${context}\n--- TRANSCRIPT ---\n${formattedTranscript}\n--- END TRANSCRIPT ---` }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return NextResponse.json({ success: false, error: `Claude API failed (${claudeRes.status}): ${err.substring(0, 200)}` });
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || "";

    let auditResult;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      auditResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch (e) { auditResult = null; }

    if (!auditResult) return NextResponse.json({ success: false, error: "Could not parse audit result", raw: responseText.substring(0, 500) });

    const storeName = callInfo?.name || "";
    const storeKey = callInfo?._storeKey ||
      (storeName.toLowerCase().includes("fisher") ? "fishers" :
       storeName.toLowerCase().includes("bloom") ? "bloomington" :
       storeName.toLowerCase().includes("indian") ? "indianapolis" : "unknown");

    // Determine if this should be auto-excluded
    var shouldExclude = auditResult.call_type === "non_scorable";
    var excludeReason = shouldExclude ? "AI classified as non-scorable" : "";

    // Low confidence + non_scorable classification → auto-exclude
    var confidence = auditResult.confidence || 0;
    if (confidence < 50 && auditResult.call_type !== "non_scorable") {
      // Very low confidence on a scored call — flag but don't exclude
      // Manager can review via low_confidence endpoint
    }

    const saved = await saveAuditResult({
      call_id: callId,
      date: callInfo?.date_started || new Date().toISOString(),
      store: storeKey,
      store_name: storeName,
      call_type: auditResult.call_type || "opportunity",
      employee: auditResult.employee || "Unknown",
      customer_name: auditResult.customer_name || "Unknown",
      device_type: auditResult.device_type || "Not mentioned",
      phone: callInfo?.external_number || "",
      direction: callInfo?.direction || "inbound",
      talk_duration: callInfo?.talk_duration || null,
      inquiry: auditResult.inquiry || "",
      outcome: auditResult.outcome || "",
      score: auditResult.score || 0,
      max_score: auditResult.max_score || 4.0,
      confidence: confidence,
      confidence_reason: auditResult.confidence_reason || "",
      excluded: shouldExclude,
      exclude_reason: excludeReason,
      criteria: auditResult.criteria,
      transcript_preview: formattedTranscript.substring(0, 500),
    });

    return NextResponse.json({
      success: true,
      audit: {
        ...auditResult,
        call_id: callId, store: storeKey, store_name: storeName,
        phone: callInfo?.external_number || "", date: callInfo?.date_started,
        confidence: confidence,
        excluded: shouldExclude, exclude_reason: excludeReason,
        saved: !!saved,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

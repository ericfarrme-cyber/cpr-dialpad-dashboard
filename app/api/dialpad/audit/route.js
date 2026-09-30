import { NextResponse } from "next/server";
import { supabase, saveAuditResult, getAuditResults, getEmployeePerformance, getStorePerformance, isCallAudited, getEmployeeStatsFromAudits, overrideAudit, excludeAudit, reinstateAudit, deleteAudit, deleteAuditsByEmployee, clearAllAudits, getLowConfidenceAudits } from "@/lib/supabase";
import { AUDIT_PROMPT, preAuditFilter, transcriptPreCheck } from "@/lib/audit-config";
import { buildResolver, resolveName } from "@/lib/roster-resolver";

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

  // ── every call that belongs to one person, wherever they took it ─────────
  // My Performance used to ask for `?store=<their roster store>` and filter the
  // names client-side. Two things were wrong with that, both measured
  // 2026-09-28 over 30 days: a call taken at any OTHER store was invisible —
  // Luke Stirling is on the roster at Bloomington and works Indianapolis, so
  // he saw 0 of his 130 calls, Matthew Slade 43 of 91, Duncan Hitti 74 of 112 —
  // and the resolution happened in the browser, so no two screens had to agree.
  // Resolved here instead, with no store filter at all.
  if (action === "for_employee") {
    var who = (searchParams.get("name") || "").trim();
    if (!who) return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });

    var { data: rosterRows, error: rErr } = await supabase.from("employee_roster").select("name,aliases,active,store");
    if (rErr) return NextResponse.json({ success: false, error: rErr.message }, { status: 500 });
    var resolver = buildResolver(rosterRows || []);

    // Whose page is this? Resolve the requested name the same way, so
    // "Luke"/"Luke Stirling" both land on the roster spelling.
    var canonicalMe = resolveName(who, resolver.map) || who;

    var all = await getAuditResults({ store: "all", limit: 4000, daysBack: daysBack });
    // Every scanned row lands in exactly one of these, so the counts below add
    // up to `scanned` and a row can never go missing without being named.
    var mine = [], excluded = 0, nonScorable = 0, ambiguous = 0, unresolved = 0, others = 0;
    (all || []).forEach(function(a) {
      if (a.excluded) { excluded++; return; }
      if (a.call_type === "non_scorable") { nonScorable++; return; }
      var key = String(a.employee || "").trim().toLowerCase();
      if (resolver.ambiguous[key]) { ambiguous++; return; }   // claimed by two people — credit nobody
      var canon = resolveName(a.employee, resolver.map);
      if (!canon) { unresolved++; return; }
      if (canon === canonicalMe) mine.push(a); else others++;
    });

    return NextResponse.json({
      success: true,
      employee: canonicalMe,
      days: daysBack,
      audits: mine,
      // Surfaced, never silent: calls the resolver could not place, and calls
      // an alias claimed for two people.
      meta: {
        returned: mine.length, scanned: (all || []).length,
        excluded: excluded, non_scorable: nonScorable,
        ambiguous: ambiguous, unresolved: unresolved, other_people: others,
      },
    });
  }

  // ── one person's rubric, this month and last ─────────────────────────────
  // Powers the four "free closer" placements (2026-09-29): the Price Book
  // strip, the script lines on a row, the line at the discount moment, and
  // month-over-month on My Calls. Warranty and faster-turnaround each score
  // 0.92 of 4.01 on an opportunity call — the same as a discount — and cost
  // nothing, yet nobody clears 25%. Resolved through the roster the same way
  // as for_employee, across every store.
  if (action === "criteria") {
    var cName = (searchParams.get("name") || "").trim();
    if (!cName) return NextResponse.json({ success: false, error: "name is required" }, { status: 400 });
    if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });

    var { data: cRoster, error: cErr } = await supabase.from("employee_roster").select("name,aliases,active,store");
    if (cErr) return NextResponse.json({ success: false, error: cErr.message }, { status: 500 });
    var cRes = buildResolver(cRoster || []);
    var me = resolveName(cName, cRes.map) || cName;

    // Indiana-local month boundaries, so the month rolls when the stores' does.
    function indyNow() { return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" })); }
    function ym(d) { return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1); }
    var nowI = indyNow();
    var curKey = searchParams.get("period") || ym(nowI);
    var cy = parseInt(curKey.slice(0, 4), 10), cm = parseInt(curKey.slice(5, 7), 10);
    var prevD = new Date(cy, cm - 2, 1);
    var prevKey = ym(prevD);

    var rows = await getAuditResults({ store: "all", limit: 6000, daysBack: 100 });
    function blank(k) {
      return { period: k, opportunity: 0, current_customer: 0, score_sum: 0, scored: 0,
        opp_score_sum: 0,
        appt_offered: 0, discount_mentioned: 0, warranty_mentioned: 0, faster_turnaround: 0,
        status_update_given: 0, eta_communicated: 0, professional_tone: 0, next_steps_explained: 0 };
    }
    var acc = {}; acc[curKey] = blank(curKey); acc[prevKey] = blank(prevKey);
    (rows || []).forEach(function(a) {
      if (a.excluded || a.call_type === "non_scorable") return;
      var key = String(a.employee || "").trim().toLowerCase();
      if (cRes.ambiguous[key]) return;
      if (resolveName(a.employee, cRes.map) !== me) return;
      var k = String(a.date_started || "").slice(0, 7);
      var B = acc[k];
      if (!B) return;
      B.score_sum += parseFloat(a.score || 0); B.scored += 1;
      if (a.call_type === "opportunity") {
        B.opportunity += 1;
        B.opp_score_sum += parseFloat(a.score || 0);
        ["appt_offered", "discount_mentioned", "warranty_mentioned", "faster_turnaround"].forEach(function(f) { if (a[f]) B[f] += 1; });
      } else {
        B.current_customer += 1;
        ["status_update_given", "eta_communicated", "professional_tone", "next_steps_explained"].forEach(function(f) { if (a[f]) B[f] += 1; });
      }
    });
    function shape(B) {
      var rate = function(n, d) { return d > 0 ? Math.round((n / d) * 100) : null; };
      return {
        period: B.period, opportunity_calls: B.opportunity, current_customer_calls: B.current_customer,
        avg_score: B.scored ? Math.round((B.score_sum / B.scored) * 100) / 100 : null,
        // The opportunity-only average. `avg_score` blends both call types and
        // repeat-customer calls score far higher, so measuring an opportunity
        // criterion against the blended figure overstates where someone
        // stands — Andrew reads 1.85 blended against 0.64 on opportunity
        // calls alone. Anything scaled by opportunity_max must use this one.
        opportunity_avg_score: B.opportunity ? Math.round((B.opp_score_sum / B.opportunity) * 100) / 100 : null,
        counts: { warranty: B.warranty_mentioned, faster: B.faster_turnaround, appt: B.appt_offered, discount: B.discount_mentioned },
        rates: {
          warranty_mentioned: rate(B.warranty_mentioned, B.opportunity),
          faster_turnaround: rate(B.faster_turnaround, B.opportunity),
          appt_offered: rate(B.appt_offered, B.opportunity),
          discount_mentioned: rate(B.discount_mentioned, B.opportunity),
          status_update_given: rate(B.status_update_given, B.current_customer),
          eta_communicated: rate(B.eta_communicated, B.current_customer),
          professional_tone: rate(B.professional_tone, B.current_customer),
          next_steps_explained: rate(B.next_steps_explained, B.current_customer),
        },
      };
    }
    return NextResponse.json({
      success: true, employee: me,
      // Each free criterion is worth this much of an opportunity call, so the
      // UI can show the prize without hardcoding the rubric.
      points: { per_criterion: 0.92, opportunity_max: 4.01 },
      current: shape(acc[curKey]), previous: shape(acc[prevKey]),
    });
  }

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

    // ── Full re-audit: clear all + trigger cron ──
    if (body.action === "trigger_reaudit") {
      if (body.confirm !== "REAUDIT_ALL") {
        return NextResponse.json({ success: false, error: "Must send confirm: 'REAUDIT_ALL'" });
      }
      // Step 1: Clear all audits
      const cleared = await clearAllAudits();
      if (!cleared) return NextResponse.json({ success: false, error: "Failed to clear audits" });

      // Step 2: Trigger cron via internal fetch (fire-and-forget)
      const baseUrl = new URL(request.url).origin;
      const cronSecret = process.env.CRON_SECRET || "";
      const cronUrl = baseUrl + "/api/dialpad/cron?secret=" + cronSecret;
      console.log("[ReAudit] Cleared all audits, triggering cron...");

      // We don't await — cron runs in background (up to 300s on Vercel)
      fetch(cronUrl).then(function(r) {
        console.log("[ReAudit] Cron responded: " + r.status);
      }).catch(function(e) {
        console.error("[ReAudit] Cron trigger error:", e.message);
      });

      return NextResponse.json({
        success: true,
        message: "All audits cleared. Re-audit cron triggered — this takes several minutes. Refresh the page periodically to see new results.",
        cleared: true,
        cronTriggered: true,
      });
    }

    // ── Trigger cron only (no clear) ──
    if (body.action === "trigger_cron") {
      const baseUrl = new URL(request.url).origin;
      const cronSecret = process.env.CRON_SECRET || "";
      const cronUrl = baseUrl + "/api/dialpad/cron?secret=" + cronSecret;
      try {
        const cronRes = await fetch(cronUrl);
        const cronJson = await cronRes.json();
        return NextResponse.json({ success: true, cron: cronJson });
      } catch(e) {
        return NextResponse.json({ success: false, error: "Cron trigger failed: " + e.message });
      }
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
        model: "claude-sonnet-4-6",
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
      // Qualitative grading (added with cx insights migration) — null for non_scorable
      tone_score: auditResult.tone_score != null ? parseInt(auditResult.tone_score) || null : null,
      clarity_score: auditResult.clarity_score != null ? parseInt(auditResult.clarity_score) || null : null,
      empathy_score: auditResult.empathy_score != null ? parseInt(auditResult.empathy_score) || null : null,
      qualitative_notes: auditResult.qualitative_notes || null,
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

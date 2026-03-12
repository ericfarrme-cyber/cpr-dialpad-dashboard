import { NextResponse } from "next/server";
import { getAuditResults, getStorePerformance, getEmployeeStatsFromAudits } from "@/lib/supabase";

// POST /api/dialpad/summary — generate AI insights
export async function POST(request) {
  try {
    const body = await request.json();
    const { type, dashboardData } = body; // type: 'overview' | 'audit'

    // Fetch audit data for context
    const [audits, storePerf, employees] = await Promise.all([
      getAuditResults({ limit: 100, daysBack: 7 }),
      getStorePerformance(),
      getEmployeeStatsFromAudits(),
    ]);

    let prompt = "";

    if (type === "overview") {
      // Main dashboard summary
      const stats = dashboardData || {};
      prompt = `You are a business intelligence analyst for CPR Cell Phone Repair, a chain of 3 stores: Fishers, Bloomington, and Indianapolis.

Here is the last 7 days of data:

CALL PERFORMANCE:
${JSON.stringify(stats.overviewStats || {}, null, 2)}

STORE AUDIT SCORES:
${JSON.stringify(storePerf.map(s => ({ store: s.store_name, avg_score: s.avg_score, total_audits: s.total_audits, opportunity: s.opportunity_calls, current: s.current_calls, appt_rate: s.appt_rate, warranty_rate: s.warranty_rate })), null, 2)}

TOP EMPLOYEES:
${JSON.stringify(employees.slice(0, 10).map(e => ({ name: e.employee, store: e.store, score: e.avg_score, calls: e.total_calls, appt: e.appt_rate, warranty: e.warranty_rate })), null, 2)}

RECENT AUDITS (last 10):
${JSON.stringify(audits.slice(0, 10).map(a => ({ employee: a.employee, store: a.store, score: a.score, type: a.call_type, inquiry: a.inquiry, outcome: a.outcome })), null, 2)}

Write a concise executive summary (3-4 paragraphs) covering:
1. Overall performance snapshot — call volume trends, answer rates, which store is outperforming
2. Audit quality — average scores, biggest gaps in the scoring criteria, which criteria employees struggle with most
3. Employee highlights — top performers and who needs coaching, specific behaviors to address
4. Action items — 2-3 concrete steps to improve this week

Keep it direct and actionable. Use specific numbers. No fluff.`;
    } else if (type === "audit") {
      // Audit-specific insights
      const oppCalls = audits.filter(a => a.call_type === "opportunity");
      const currCalls = audits.filter(a => a.call_type === "current_customer");

      prompt = `You are a phone call quality coach for CPR Cell Phone Repair stores (Fishers, Bloomington, Indianapolis).

AUDIT DATA (last 7 days):

OPPORTUNITY CALLS (${oppCalls.length} calls):
${JSON.stringify(oppCalls.slice(0, 20).map(a => ({ employee: a.employee, store: a.store, score: a.score, inquiry: a.inquiry, outcome: a.outcome, appt: a.appt_offered, discount: a.discount_mentioned, warranty: a.warranty_mentioned, turnaround: a.faster_turnaround })), null, 2)}

CURRENT CUSTOMER CALLS (${currCalls.length} calls):
${JSON.stringify(currCalls.slice(0, 20).map(a => ({ employee: a.employee, store: a.store, score: a.score, inquiry: a.inquiry, outcome: a.outcome, status: a.status_update_given, eta: a.eta_communicated, tone: a.professional_tone, next_steps: a.next_steps_explained })), null, 2)}

EMPLOYEE PERFORMANCE:
${JSON.stringify(employees.map(e => ({ name: e.employee, store: e.store, score: e.avg_score, calls: e.total_calls, opp: e.opportunity_calls, curr: e.current_calls })), null, 2)}

STORE SCORES:
${JSON.stringify(storePerf.map(s => ({ store: s.store_name, avg: s.avg_score, audits: s.total_audits })), null, 2)}

Write a coaching report (3-4 paragraphs):
1. Opportunity call performance — are employees converting inquiries? What's the biggest missed opportunity? Which criteria is weakest across stores?
2. Current customer experience — are status updates clear? Are customers getting proper next steps?
3. Employee coaching priorities — who needs immediate attention? Who should be recognized? Give specific call examples if notable.
4. Training recommendations — 2-3 specific things to focus on in the next team meeting, with concrete talk tracks or scripts employees could use.

Be specific, use employee names and numbers. This is for the store owner to act on immediately.`;
    }

    if (!prompt) {
      return NextResponse.json({ success: false, error: "Invalid summary type" });
    }

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return NextResponse.json({ success: false, error: `Claude API failed (${claudeRes.status})` });
    }

    const claudeData = await claudeRes.json();
    const summary = claudeData.content?.[0]?.text || "";

    return NextResponse.json({ success: true, summary, type, generatedAt: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

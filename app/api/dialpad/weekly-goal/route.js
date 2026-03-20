import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

function getWeekStart() {
  var now = new Date();
  var day = now.getDay();
  var diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  var monday = new Date(now.setDate(diff));
  return monday.toISOString().split("T")[0];
}

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var store = searchParams.get("store") || "fishers";
  var action = searchParams.get("action") || "current";
  var weekStart = getWeekStart();

  if (action === "current") {
    // Check if we have a goal for this week
    var { data: existing } = await supabase.from("weekly_goals")
      .select("*")
      .eq("store", store)
      .eq("week_start", weekStart)
      .single();

    if (existing) {
      return json({ success: true, goal: existing, fresh: false });
    }

    // No goal yet — generate one
    var goal = await generateWeeklyGoal(store, weekStart);
    if (goal) {
      return json({ success: true, goal: goal, fresh: true });
    }
    return json({ success: false, error: "Could not generate weekly goal" });
  }

  if (action === "history") {
    var { data } = await supabase.from("weekly_goals")
      .select("*")
      .eq("store", store)
      .order("week_start", { ascending: false })
      .limit(12);
    return json({ success: true, goals: data || [] });
  }

  if (action === "regenerate") {
    // Force regenerate for this week (admin use)
    await supabase.from("weekly_goals").delete().eq("store", store).eq("week_start", weekStart);
    var goal = await generateWeeklyGoal(store, weekStart);
    if (goal) return json({ success: true, goal: goal, fresh: true });
    return json({ success: false, error: "Failed to regenerate" });
  }

  return json({ success: false, error: "Unknown action" });
}

async function generateWeeklyGoal(store, weekStart) {
  try {
    // Gather all performance data for this store
    var dataSnapshot = {};

    // Scorecard
    try {
      var scRes = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL ? "" : "" + "/api/dialpad/scorecard?days=30", { headers: { "Host": "localhost" } }).catch(function() { return null; });
    } catch(e) {}

    // Get data directly from Supabase
    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    var cutoff = thirtyDaysAgo.toISOString().split("T")[0];

    // Call audit data
    var { data: audits } = await supabase.from("audit_results")
      .select("employee, score, appt_offered, discount_mentioned, warranty_mentioned")
      .eq("store", store)
      .gte("date_started", cutoff + "T00:00:00");

    var auditCount = audits ? audits.length : 0;
    var avgAuditScore = auditCount > 0 ? audits.reduce(function(s,a){return s + (parseFloat(a.score)||0);}, 0) / auditCount : 0;
    var apptRate = auditCount > 0 ? audits.filter(function(a){return a.appt_offered;}).length / auditCount * 100 : 0;
    var discountRate = auditCount > 0 ? audits.filter(function(a){return a.discount_mentioned;}).length / auditCount * 100 : 0;
    var warrantyRate = auditCount > 0 ? audits.filter(function(a){return a.warranty_mentioned;}).length / auditCount * 100 : 0;

    // Ticket compliance
    var { data: tickets } = await supabase.from("ticket_grades")
      .select("overall_score, diagnostics_score, notes_score, pickup_score, payment_score, contact_score")
      .eq("store", store)
      .gte("graded_at", cutoff + "T00:00:00");

    var ticketCount = tickets ? tickets.length : 0;
    var avgTicketScore = ticketCount > 0 ? tickets.reduce(function(s,t){return s + (t.overall_score||0);}, 0) / ticketCount : 0;
    var avgDiag = ticketCount > 0 ? tickets.reduce(function(s,t){return s + (t.diagnostics_score||0);}, 0) / ticketCount : 0;
    var avgNotes = ticketCount > 0 ? tickets.reduce(function(s,t){return s + (t.notes_score||0);}, 0) / ticketCount : 0;
    var avgPickup = ticketCount > 0 ? tickets.reduce(function(s,t){return s + (t.pickup_score||0);}, 0) / ticketCount : 0;

    // Appointment show rate
    var { data: appts } = await supabase.from("appointments")
      .select("did_arrive")
      .eq("store", store)
      .gte("date_of_appt", cutoff);

    var apptTotal = appts ? appts.length : 0;
    var apptArrived = appts ? appts.filter(function(a){return a.did_arrive && a.did_arrive.toLowerCase()==="yes";}).length : 0;
    var showRate = apptTotal > 0 ? Math.round(apptArrived / apptTotal * 100) : 0;

    // Sales data
    var currentPeriod = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");
    var { data: phoneSales } = await supabase.from("repair_tickets")
      .select("employee, repair_total")
      .eq("period", currentPeriod);
    var { data: accySales } = await supabase.from("accessory_sales")
      .select("employee, accy_gp")
      .eq("period", currentPeriod);

    var totalRepairs = phoneSales ? phoneSales.length : 0;
    var totalAccyGP = accySales ? accySales.reduce(function(s,a){return s + (parseFloat(a.accy_gp)||0);}, 0) : 0;

    dataSnapshot = {
      audit: { count: auditCount, avgScore: Math.round(avgAuditScore * 100) / 100, apptRate: Math.round(apptRate), discountRate: Math.round(discountRate), warrantyRate: Math.round(warrantyRate) },
      tickets: { count: ticketCount, avgScore: Math.round(avgTicketScore), avgDiag: Math.round(avgDiag), avgNotes: Math.round(avgNotes), avgPickup: Math.round(avgPickup) },
      appointments: { total: apptTotal, arrived: apptArrived, showRate: showRate },
      sales: { repairs: totalRepairs, accyGP: Math.round(totalAccyGP) },
    };

    // Call Anthropic to generate the goal
    var apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Fallback — generate a basic goal without AI
      return await saveFallbackGoal(store, weekStart, dataSnapshot);
    }

    var prompt = "You are the operations coach for a CPR Cell Phone Repair store called " + store + ". Based on the following 30-day performance data, identify the SINGLE most impactful area for improvement this week and create a specific, measurable weekly goal.\n\n" +
      "PERFORMANCE DATA:\n" +
      "• Phone Audit: " + dataSnapshot.audit.count + " calls audited, avg score " + dataSnapshot.audit.avgScore + "/4\n" +
      "  - Appointment offered: " + dataSnapshot.audit.apptRate + "% of calls\n" +
      "  - Discount mentioned: " + dataSnapshot.audit.discountRate + "% of calls\n" +
      "  - Warranty mentioned: " + dataSnapshot.audit.warrantyRate + "% of calls\n" +
      "• Ticket Compliance: " + dataSnapshot.tickets.count + " tickets graded, avg " + dataSnapshot.tickets.avgScore + "/100\n" +
      "  - Diagnostics avg: " + dataSnapshot.tickets.avgDiag + "/100\n" +
      "  - Repair Notes avg: " + dataSnapshot.tickets.avgNotes + "/100\n" +
      "  - Pickup/Completion avg: " + dataSnapshot.tickets.avgPickup + "/100\n" +
      "• Appointments: " + dataSnapshot.appointments.total + " booked, " + dataSnapshot.appointments.showRate + "% show rate\n" +
      "• Sales: " + dataSnapshot.sales.repairs + " repairs, $" + dataSnapshot.sales.accyGP + " accessory GP\n\n" +
      "RULES:\n" +
      "1. Pick the area with the BIGGEST revenue or quality impact — never something trivial\n" +
      "2. The goal must be specific and measurable (a number to hit)\n" +
      "3. Frame it positively — this is about growth, not punishment\n" +
      "4. Use a motivating, team-oriented tone — like a coach before a game\n" +
      "5. Keep it practical — something the team can actually do differently this week\n" +
      "6. Reference the specific data points that drove your recommendation\n\n" +
      "Respond in EXACTLY this JSON format (no markdown, no backticks):\n" +
      '{"goal_title": "Short punchy title (5-8 words)", "goal_description": "2-3 sentences explaining the specific goal with a target number. Reference the current baseline and what to aim for.", "coaching_tip": "3-4 actionable sentences on HOW to achieve this goal. Include specific behaviors, scripts, or habits the team should practice this week.", "metric_key": "one of: audit_score, appt_rate, discount_rate, warranty_rate, ticket_score, diagnostics, notes, pickup, show_rate, repairs, accy_gp", "metric_baseline": current_number, "metric_target": target_number}';

    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    var aiRes = await res.json();
    var reply = aiRes.content && aiRes.content[0] ? aiRes.content[0].text : "";

    // Parse the JSON response
    var goalData;
    try {
      reply = reply.replace(/```json|```/g, "").trim();
      goalData = JSON.parse(reply);
    } catch(e) {
      console.error("[weekly-goal] Failed to parse AI response:", reply);
      return await saveFallbackGoal(store, weekStart, dataSnapshot);
    }

    // Save to database
    var { data: saved, error } = await supabase.from("weekly_goals").insert({
      store: store,
      week_start: weekStart,
      goal_title: goalData.goal_title,
      goal_description: goalData.goal_description,
      coaching_tip: goalData.coaching_tip,
      metric_key: goalData.metric_key || "",
      metric_baseline: goalData.metric_baseline || 0,
      metric_target: goalData.metric_target || 0,
      data_snapshot: dataSnapshot,
    }).select().single();

    if (error) {
      console.error("[weekly-goal] Save error:", error.message);
      return null;
    }
    return saved;

  } catch(e) {
    console.error("[weekly-goal] Error:", e.message);
    return null;
  }
}

async function saveFallbackGoal(store, weekStart, data) {
  // Determine the weakest area without AI
  var areas = [];
  if (data.audit.count > 0) {
    if (data.audit.apptRate < 60) areas.push({ key: "appt_rate", title: "Book More Appointments on Calls", desc: "Only " + data.audit.apptRate + "% of calls resulted in an appointment being offered. Aim for 70% this week. Every call is a chance to get a customer in the door.", tip: "Before ending any call, ask: 'Can I schedule a time for you to come in? We'll have everything ready and you'll get $10 off.' Make it easy and give them a reason.", baseline: data.audit.apptRate, target: 70, impact: 60 - data.audit.apptRate });
    if (data.audit.avgScore < 2.5) areas.push({ key: "audit_score", title: "Level Up Our Phone Game", desc: "Average call score is " + data.audit.avgScore.toFixed(1) + "/4. Let's push it to " + Math.min(4, data.audit.avgScore + 0.5).toFixed(1) + " this week. Better calls = more customers walking through the door.", tip: "Hit all the basics on every call: greet warmly, diagnose the issue, quote a price, offer an appointment with a discount, and mention our warranty. Practice with each other.", baseline: data.audit.avgScore, target: Math.min(4, data.audit.avgScore + 0.5), impact: 2.5 - data.audit.avgScore });
  }
  if (data.tickets.count > 0) {
    if (data.tickets.avgScore < 65) areas.push({ key: "ticket_score", title: "Tighten Up Our Ticket Documentation", desc: "Ticket compliance is at " + data.tickets.avgScore + "/100. Target: 75/100 this week. Complete documentation protects us and builds customer trust.", tip: "Every ticket needs: full diagnostic notes, repair steps taken, customer notified of completion, and proper contact info. Take 60 extra seconds per ticket — it makes a huge difference.", baseline: data.tickets.avgScore, target: 75, impact: 65 - data.tickets.avgScore });
  }
  if (data.appointments.total > 5 && data.appointments.showRate < 65) {
    areas.push({ key: "show_rate", title: "Get More Customers Through the Door", desc: "Show rate is " + data.appointments.showRate + "%. Target: " + Math.min(80, data.appointments.showRate + 15) + "% this week. Every no-show is lost revenue.", tip: "Confirm every appointment the day before with a quick call or text. When booking, get their name and number and say 'We'll have everything ready for you.' Follow up on no-shows within 24 hours.", baseline: data.appointments.showRate, target: Math.min(80, data.appointments.showRate + 15), impact: 65 - data.appointments.showRate });
  }

  // Sort by impact
  areas.sort(function(a, b) { return b.impact - a.impact; });
  var pick = areas.length > 0 ? areas[0] : {
    key: "general", title: "Deliver 5-Star Experiences", desc: "Focus on making every customer interaction exceptional this week. Greet warmly, communicate clearly, and follow up proactively.",
    tip: "Start each day with a team huddle. Pick one thing to focus on together. End each day by sharing one great customer moment.", baseline: 0, target: 100
  };

  var { data: saved, error } = await supabase.from("weekly_goals").insert({
    store: store, week_start: weekStart,
    goal_title: pick.title, goal_description: pick.desc, coaching_tip: pick.tip,
    metric_key: pick.key, metric_baseline: pick.baseline, metric_target: pick.target,
    data_snapshot: data,
  }).select().single();

  return error ? null : saved;
}

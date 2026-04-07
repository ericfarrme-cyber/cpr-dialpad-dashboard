import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  );
}

var STORES = {
  fishers: { targetId: process.env.DIALPAD_FISHERS_ID, name: "Fishers" },
  bloomington: { targetId: process.env.DIALPAD_BLOOMINGTON_ID, name: "Bloomington" },
  indianapolis: { targetId: process.env.DIALPAD_INDIANAPOLIS_ID, name: "Indianapolis" },
};

var DAYS_OF_WEEK = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// ═══════════════════════════════════════════════════════════
// ACTION: hourly-demand
// Computes average call volume per hour per day-of-week per store
// Uses Dialpad API for call data + ticket_grades for ticket data
// ═══════════════════════════════════════════════════════════
async function getHourlyDemand(store, days) {
  var sb = getSupabase();
  var storeKeys = store ? [store] : Object.keys(STORES);
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  var cutoffStr = cutoff.toISOString();

  var results = {};

  for (var sk of storeKeys) {
    // Initialize hourly buckets: [dayOfWeek][hour] = { calls, missed, tickets, days_seen }
    var buckets = {};
    for (var d = 0; d < 7; d++) {
      buckets[d] = {};
      for (var h = 8; h <= 20; h++) {
        buckets[d][h] = { calls: 0, missed: 0, tickets: 0, days_seen: new Set() };
      }
    }

    // ── Fetch call data from Dialpad API (last N days) ──
    var targetId = STORES[sk].targetId;
    if (targetId) {
      try {
        var startDate = cutoff.toISOString().split("T")[0];
        var endDate = new Date().toISOString().split("T")[0];
        var apiKey = process.env.DIALPAD_API_KEY;

        // Fetch calls in batches
        var cursor = null;
        var allCalls = [];
        var maxPages = 10;

        for (var page = 0; page < maxPages; page++) {
          var url = "https://dialpad.com/api/v2/stats/calls?" +
            "target_id=" + targetId +
            "&target_type=office" +
            "&stat_type=calls" +
            "&days_ago_start=" + days +
            "&days_ago_end=0" +
            "&limit=200" +
            "&timezone=America/Indiana/Indianapolis";
          if (cursor) url += "&cursor=" + cursor;

          var resp = await fetch(url, {
            headers: { Authorization: "Bearer " + apiKey, Accept: "application/json" }
          });
          if (!resp.ok) break;
          var data = await resp.json();
          var calls = data.items || data.records || data || [];
          if (Array.isArray(calls)) allCalls = allCalls.concat(calls);
          cursor = data.cursor;
          if (!cursor || calls.length === 0) break;
        }

        // Bucket calls by day-of-week and hour (Eastern time)
        allCalls.forEach(function(call) {
          var ts = call.started_at || call.start_date_time || call.date_started;
          if (!ts) return;
          var dt = new Date(typeof ts === "number" ? ts * 1000 : ts);
          // Convert to ET
          var etStr = dt.toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" });
          var etDate = new Date(etStr);
          var dow = etDate.getDay();
          var hr = etDate.getHours();
          if (hr < 8 || hr > 20) return;
          if (!buckets[dow][hr]) return;

          var dateKey = etDate.toISOString().split("T")[0];
          buckets[dow][hr].days_seen.add(dateKey);
          buckets[dow][hr].calls++;

          // Check if missed
          var isMissed = call.call_type === "missed" ||
            call.disposition === "missed" ||
            (call.is_missed === true) ||
            (call.talk_duration !== undefined && call.talk_duration === 0 && !call.voicemail);
          if (isMissed) buckets[dow][hr].missed++;
        });
      } catch (e) {
        console.error("Dialpad fetch error for " + sk + ":", e.message);
      }
    }

    // ── Fetch ticket data from ticket_grades ──
    try {
      var { data: tickets } = await sb.from("ticket_grades")
        .select("graded_at, created_at")
        .eq("store", sk)
        .gte("graded_at", cutoffStr)
        .order("graded_at", { ascending: false })
        .limit(5000);

      if (tickets) {
        tickets.forEach(function(t) {
          var ts = t.created_at || t.graded_at;
          if (!ts) return;
          var dt = new Date(ts);
          var etStr = dt.toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" });
          var etDate = new Date(etStr);
          var dow = etDate.getDay();
          var hr = etDate.getHours();
          if (hr < 8 || hr > 20 || !buckets[dow] || !buckets[dow][hr]) return;
          buckets[dow][hr].tickets++;
          buckets[dow][hr].days_seen.add(etDate.toISOString().split("T")[0]);
        });
      }
    } catch (e) {
      console.error("Ticket fetch error for " + sk + ":", e.message);
    }

    // ── Compute averages ──
    var hourlyPatterns = {};
    for (var d = 0; d < 7; d++) {
      hourlyPatterns[DAYS_OF_WEEK[d]] = {};
      for (var h = 8; h <= 20; h++) {
        var b = buckets[d][h];
        var numDays = Math.max(b.days_seen.size, 1);
        // For days with no data, estimate based on total days / 7
        var estimatedDays = Math.max(Math.floor(days / 7), 1);
        var divisor = Math.max(numDays, estimatedDays);
        hourlyPatterns[DAYS_OF_WEEK[d]][h] = {
          avgCalls: Math.round((b.calls / divisor) * 10) / 10,
          avgMissed: Math.round((b.missed / divisor) * 10) / 10,
          avgTickets: Math.round((b.tickets / divisor) * 10) / 10,
          totalCalls: b.calls,
          totalMissed: b.missed,
          totalTickets: b.tickets,
          daysObserved: numDays,
          missRate: b.calls > 0 ? Math.round((b.missed / b.calls) * 100) : 0,
          // Demand score: calls + tickets weighted
          demandScore: Math.round(((b.calls + b.tickets * 1.5) / divisor) * 10) / 10,
          // Recommended staff: 1 per 4 calls/hr or 1 per 3 tickets/hr, min 1
          recommendedStaff: Math.max(1, Math.ceil(Math.max(
            (b.calls / divisor) / 4,
            (b.tickets / divisor) / 3
          ))),
        };
      }
    }

    results[sk] = hourlyPatterns;
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// ACTION: float-employees
// Identifies employees who work at multiple stores
// ═══════════════════════════════════════════════════════════
async function getFloatEmployees(days) {
  var sb = getSupabase();
  var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);

  var { data: shifts } = await sb.from("employee_shifts")
    .select("employee_name, store, hours, shift_date")
    .gte("shift_date", cutoff.toISOString().split("T")[0])
    .order("employee_name");

  if (!shifts) return [];

  // Group by employee
  var byEmployee = {};
  shifts.forEach(function(s) {
    var name = s.employee_name;
    if (!byEmployee[name]) byEmployee[name] = { name: name, stores: {}, totalHours: 0, shifts: 0 };
    if (!byEmployee[name].stores[s.store]) byEmployee[name].stores[s.store] = { hours: 0, shifts: 0 };
    var h = parseFloat(s.hours) || 0;
    byEmployee[name].stores[s.store].hours += h;
    byEmployee[name].stores[s.store].shifts++;
    byEmployee[name].totalHours += h;
    byEmployee[name].shifts++;
  });

  var employees = Object.values(byEmployee).map(function(e) {
    var storeList = Object.keys(e.stores);
    return {
      name: e.name,
      storeCount: storeList.length,
      isFloat: storeList.length > 1,
      stores: e.stores,
      storeList: storeList,
      totalHours: Math.round(e.totalHours * 10) / 10,
      primaryStore: storeList.reduce(function(a, b) {
        return (e.stores[a]?.hours || 0) >= (e.stores[b]?.hours || 0) ? a : b;
      }),
      avgWeeklyHours: Math.round((e.totalHours / Math.max(days / 7, 1)) * 10) / 10,
    };
  });

  return employees.sort(function(a, b) { return b.storeCount - a.storeCount || b.totalHours - a.totalHours; });
}

// ═══════════════════════════════════════════════════════════
// ACTION: coverage-analysis
// For a given week, compute coverage score per store per day per hour
// Cross-references shifts with demand patterns
// ═══════════════════════════════════════════════════════════
async function getCoverageAnalysis(weekOf, demandPatterns) {
  var sb = getSupabase();

  // Parse week start date
  var startDate = new Date(weekOf + "T00:00:00");
  var endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 7);

  var startStr = startDate.toISOString().split("T")[0];
  var endStr = endDate.toISOString().split("T")[0];

  // Get shifts for this week
  var { data: shifts } = await sb.from("employee_shifts")
    .select("*")
    .gte("shift_date", startStr)
    .lt("shift_date", endStr)
    .order("shift_date");

  if (!shifts) shifts = [];

  // Build coverage map: [store][date][hour] = [employee names]
  var coverage = {};
  Object.keys(STORES).forEach(function(sk) { coverage[sk] = {}; });

  shifts.forEach(function(s) {
    if (!coverage[s.store]) coverage[s.store] = {};
    if (!coverage[s.store][s.shift_date]) {
      coverage[s.store][s.shift_date] = {};
      for (var h = 8; h <= 20; h++) coverage[s.store][s.shift_date][h] = [];
    }
    // Determine which hours this shift covers
    var startH = 9, endH = 17; // defaults
    if (s.start_time) {
      var st = new Date(s.start_time);
      var stET = new Date(st.toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
      startH = stET.getHours();
      if (s.end_time) {
        var et = new Date(s.end_time);
        var etET = new Date(et.toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
        endH = etET.getHours();
      } else {
        endH = startH + (parseFloat(s.hours) || 8);
      }
    }
    for (var h = startH; h < endH && h <= 20; h++) {
      if (!coverage[s.store][s.shift_date]) {
        coverage[s.store][s.shift_date] = {};
      }
      if (!coverage[s.store][s.shift_date][h]) {
        coverage[s.store][s.shift_date][h] = [];
      }
      coverage[s.store][s.shift_date][h].push(s.employee_name);
    }
  });

  // Now cross-reference with demand patterns to find gaps
  var analysis = {};
  var totalGaps = 0;
  var criticalGaps = 0;
  var revenueAtRisk = 0;

  Object.keys(STORES).forEach(function(sk) {
    analysis[sk] = { days: {}, summary: { totalGapHours: 0, criticalHours: 0, revenueAtRisk: 0 } };

    for (var dayOffset = 0; dayOffset < 7; dayOffset++) {
      var dt = new Date(startDate);
      dt.setDate(dt.getDate() + dayOffset);
      var dateStr = dt.toISOString().split("T")[0];
      var dow = DAYS_OF_WEEK[dt.getDay()];
      var demand = demandPatterns[sk]?.[dow] || {};

      analysis[sk].days[dateStr] = { dow: dow, hours: {} };

      for (var h = 9; h <= 19; h++) {
        var staffOnHand = coverage[sk]?.[dateStr]?.[h]?.length || 0;
        var staffNames = coverage[sk]?.[dateStr]?.[h] || [];
        var demandData = demand[h] || { avgCalls: 0, avgMissed: 0, avgTickets: 0, recommendedStaff: 1, demandScore: 0 };
        var recommended = demandData.recommendedStaff;
        var gap = recommended - staffOnHand;
        var severity = gap <= 0 ? "OK" : gap === 1 ? "WATCH" : "CRITICAL";
        // Revenue at risk: each understaffed hour × avg missed calls × 25% conversion × $175 avg ticket
        var missedRevPerHour = gap > 0 ? Math.round(demandData.avgMissed * 0.25 * 175) : 0;

        analysis[sk].days[dateStr].hours[h] = {
          staffOnHand: staffOnHand,
          staffNames: staffNames,
          recommended: recommended,
          gap: gap,
          severity: severity,
          demandScore: demandData.demandScore,
          avgCalls: demandData.avgCalls,
          avgMissed: demandData.avgMissed,
          avgTickets: demandData.avgTickets,
          revenueAtRisk: missedRevPerHour,
        };

        if (severity !== "OK") {
          analysis[sk].summary.totalGapHours++;
          totalGaps++;
          if (severity === "CRITICAL") {
            analysis[sk].summary.criticalHours++;
            criticalGaps++;
          }
          analysis[sk].summary.revenueAtRisk += missedRevPerHour;
          revenueAtRisk += missedRevPerHour;
        }
      }
    }
  });

  return {
    weekOf: startStr,
    stores: analysis,
    summary: { totalGapHours: totalGaps, criticalGapHours: criticalGaps, totalRevenueAtRisk: revenueAtRisk }
  };
}

// ═══════════════════════════════════════════════════════════
// ACTION: optimize
// AI-powered schedule optimization for a future week
// ═══════════════════════════════════════════════════════════
async function optimizeSchedule(weekOf, demandPatterns, floatEmployees) {
  var sb = getSupabase();

  // Get each employee's recent avg weekly hours and store assignments
  var employeeProfiles = floatEmployees.map(function(e) {
    return {
      name: e.name,
      primaryStore: e.primaryStore,
      canWorkAt: e.storeList,
      avgWeeklyHours: e.avgWeeklyHours,
      isFloat: e.isFloat,
    };
  });

  // Build demand summary for the AI
  var demandSummary = {};
  Object.keys(STORES).forEach(function(sk) {
    demandSummary[sk] = {};
    DAYS_OF_WEEK.forEach(function(dow) {
      if (dow === "Sunday") return; // Closed Sundays typically
      var dayDemand = demandPatterns[sk]?.[dow] || {};
      var peakHour = 9, peakCalls = 0;
      for (var h = 9; h <= 19; h++) {
        if ((dayDemand[h]?.avgCalls || 0) > peakCalls) {
          peakCalls = dayDemand[h]?.avgCalls || 0;
          peakHour = h;
        }
      }
      var totalCalls = 0, totalMissed = 0;
      for (var h = 9; h <= 19; h++) {
        totalCalls += dayDemand[h]?.avgCalls || 0;
        totalMissed += dayDemand[h]?.avgMissed || 0;
      }
      demandSummary[sk][dow] = {
        totalCalls: Math.round(totalCalls),
        totalMissed: Math.round(totalMissed),
        peakHour: peakHour,
        peakCalls: Math.round(peakCalls * 10) / 10,
      };
    });
  });

  // Call Anthropic API for optimization
  var prompt = `You are a ruthlessly analytical staffing optimizer for 3 cell phone repair stores. Generate the optimal weekly schedule.

CONSTRAINTS:
- Each store must have at least 1 person at all times during operating hours (Mon-Sat 9AM-7PM)
- No employee should exceed 40 hours/week
- Float employees can work at multiple stores but should minimize travel days
- Prioritize coverage during peak hours (highest call/ticket volume)
- Minimize labor cost while maintaining >85% call answer rate

EMPLOYEES:
${JSON.stringify(employeeProfiles, null, 1)}

DEMAND PATTERNS (avg daily calls/missed by store by day):
${JSON.stringify(demandSummary, null, 1)}

WEEK TO SCHEDULE: ${weekOf}

Generate a JSON schedule. For each employee, specify which store and hours for each day (Mon-Sat). Format:
{
  "schedule": [
    { "employee": "Name", "monday": {"store":"fishers","start":"9:00","end":"5:00","hours":8}, "tuesday": null, ... },
  ],
  "rationale": "Brief explanation of key decisions",
  "expectedMetrics": { "totalLaborHours": N, "coverageScore": N, "estimatedAnswerRate": N }
}

Return ONLY valid JSON, no markdown or preamble.`;

  try {
    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    var aiData = await resp.json();
    var text = (aiData.content || []).map(function(c) { return c.text || ""; }).join("");
    var clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("AI optimize error:", e.message);
    return { error: "Optimization failed: " + e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════
export async function GET(request) {
  try {
    var { searchParams } = new URL(request.url);
    var action = searchParams.get("action") || "hourly-demand";
    var store = searchParams.get("store") || null;
    var days = parseInt(searchParams.get("days")) || 30;
    var weekOf = searchParams.get("weekOf");

    if (action === "hourly-demand") {
      var patterns = await getHourlyDemand(store, days);
      return Response.json({ success: true, patterns: patterns, days: days });
    }

    if (action === "float-employees") {
      var floats = await getFloatEmployees(days);
      return Response.json({ success: true, employees: floats });
    }

    if (action === "coverage") {
      if (!weekOf) return Response.json({ error: "weekOf parameter required" }, { status: 400 });
      var demand = await getHourlyDemand(null, days);
      var coverage = await getCoverageAnalysis(weekOf, demand);
      return Response.json({ success: true, ...coverage });
    }

    if (action === "optimize") {
      if (!weekOf) return Response.json({ error: "weekOf parameter required" }, { status: 400 });
      var demand = await getHourlyDemand(null, Math.min(days, 30));
      var floats = await getFloatEmployees(60);
      var result = await optimizeSchedule(weekOf, demand, floats);
      return Response.json({ success: true, optimization: result });
    }

    return Response.json({ error: "Unknown action: " + action }, { status: 400 });
  } catch (e) {
    console.error("Demand analysis error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  );
}

var STORE_KEYS = ["fishers", "bloomington", "indianapolis"];
var DAYS_OF_WEEK = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// Typical phone repair store hourly demand distribution (% of daily total)
// Based on retail foot traffic patterns — peaks late morning through early afternoon
var HOURLY_DISTRIBUTION = {
  9: 0.06,
  10: 0.09,
  11: 0.12,
  12: 0.13,
  13: 0.12,
  14: 0.11,
  15: 0.10,
  16: 0.09,
  17: 0.08,
  18: 0.06,
  19: 0.04,
};

// Store name resolver
function resolveStore(name) {
  if (!name) return null;
  var lower = name.toLowerCase().trim();
  if (lower === "fishers" || lower === "bloomington" || lower === "indianapolis") return lower;
  if (lower.includes("fishers")) return "fishers";
  if (lower.includes("bloomington")) return "bloomington";
  if (lower.includes("indianapolis") || lower.includes("indy") || lower.includes("downtown")) return "indianapolis";
  return name;
}

// ═══════════════════════════════════════════════════════════
// ACTION: hourly-demand
// Builds hourly demand patterns per store per day-of-week
// Uses: daily call totals from Supabase × hourly distribution curve
// + actual ticket timestamps from ticket_grades
// ═══════════════════════════════════════════════════════════
async function getHourlyDemand(store, days) {
  var sb = getSupabase();
  var storeKeys = store ? [store] : STORE_KEYS;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffStr = cutoff.toISOString().split("T")[0];

  var results = {};

  for (var sk of storeKeys) {
    // ── Get daily call data ──
    var dailyCallsByDow = {};
    for (var d = 0; d < 7; d++) {
      dailyCallsByDow[d] = { totalCalls: 0, totalMissed: 0, dayCount: 0 };
    }

    // ── Get daily call data from audit_records (PRIMARY — known to exist) ──
    try {
      var { data: audits } = await sb.from("audit_records")
        .select("date, categories")
        .eq("store", sk)
        .gte("date", cutoffStr)
        .limit(10000);

      if (audits && audits.length > 0) {
        var byDate = {};
        audits.forEach(function(a) {
          if (!a.date) return;
          if (!byDate[a.date]) byDate[a.date] = { total: 0, missed: 0 };
          byDate[a.date].total++;
          // Word-boundary check for missed (avoid "answered" matching in "unanswered")
          var cats = (a.categories || "").toLowerCase();
          var catList = cats.split(/[\s,|]+/);
          var isAnswered = catList.indexOf("answered") >= 0;
          var isMissed = !isAnswered || catList.indexOf("missed") >= 0;
          if (isMissed) byDate[a.date].missed++;
        });
        Object.entries(byDate).forEach(function(entry) {
          var date = entry[0], counts = entry[1];
          var dt = new Date(date + "T12:00:00");
          var dow = dt.getDay();
          dailyCallsByDow[dow].totalCalls += counts.total;
          dailyCallsByDow[dow].totalMissed += counts.missed;
          dailyCallsByDow[dow].dayCount++;
        });
      }
    } catch (e) {
      console.error("audit_records query failed for " + sk + ":", e.message);
      // Last resort fallback: try call_records table
      try {
        var { data: callRecords } = await sb.from("call_records")
          .select("date, total_calls, answered_calls, missed_calls")
          .eq("store", sk).gte("date", cutoffStr);
        if (callRecords) {
          callRecords.forEach(function(r) {
            var dt = new Date(r.date + "T12:00:00");
            var dow = dt.getDay();
            dailyCallsByDow[dow].totalCalls += r.total_calls || 0;
            dailyCallsByDow[dow].totalMissed += r.missed_calls || Math.max(0, (r.total_calls||0) - (r.answered_calls||0));
            dailyCallsByDow[dow].dayCount++;
          });
        }
      } catch (e2) { console.error("call_records also failed:", e2.message); }
    }

    // ── Get hourly ticket data from ticket_grades ──
    var ticketsByDowHour = {};
    var ticketDays = {};
    for (var d = 0; d < 7; d++) {
      ticketsByDowHour[d] = {};
      for (var h = 9; h <= 19; h++) ticketsByDowHour[d][h] = 0;
      ticketDays[d] = new Set();
    }

    try {
      var { data: tickets } = await sb.from("ticket_grades")
        .select("graded_at, created_at")
        .eq("store", sk)
        .gte("graded_at", cutoff.toISOString())
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
          if (hr < 9 || hr > 19) return;
          ticketsByDowHour[dow][hr]++;
          ticketDays[dow].add(etDate.toISOString().split("T")[0]);
        });
      }
    } catch (e) {
      console.error("Ticket query error for " + sk + ":", e.message);
    }

    // ── Build hourly patterns: daily calls × distribution curve ──
    var hourlyPatterns = {};
    for (var d = 0; d < 7; d++) {
      var dow = DAYS_OF_WEEK[d];
      hourlyPatterns[dow] = {};

      var callData = dailyCallsByDow[d];
      var avgDailyCalls = callData.dayCount > 0 ? callData.totalCalls / callData.dayCount : 0;
      var avgDailyMissed = callData.dayCount > 0 ? callData.totalMissed / callData.dayCount : 0;
      var ticketDayCount = ticketDays[d] ? Math.max(ticketDays[d].size, 1) : Math.max(Math.floor(days / 7), 1);

      for (var h = 9; h <= 19; h++) {
        var pct = HOURLY_DISTRIBUTION[h] || 0.05;
        var hourlyCalls = Math.round(avgDailyCalls * pct * 10) / 10;
        var hourlyMissed = Math.round(avgDailyMissed * pct * 10) / 10;
        var hourlyTickets = Math.round((ticketsByDowHour[d][h] || 0) / ticketDayCount * 10) / 10;
        var demandScore = Math.round((hourlyCalls + hourlyTickets * 1.5) * 10) / 10;

        hourlyPatterns[dow][h] = {
          avgCalls: hourlyCalls,
          avgMissed: hourlyMissed,
          avgTickets: hourlyTickets,
          missRate: hourlyCalls > 0 ? Math.round((hourlyMissed / hourlyCalls) * 100) : 0,
          demandScore: demandScore,
          recommendedStaff: Math.max(1, Math.ceil(Math.max(
            hourlyCalls / 4,
            hourlyTickets / 2,
            demandScore / 5
          ))),
          daysObserved: callData.dayCount,
        };
      }
    }

    results[sk] = hourlyPatterns;
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// ACTION: float-employees
// ═══════════════════════════════════════════════════════════
async function getFloatEmployees(days) {
  var sb = getSupabase();
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  var { data: shifts } = await sb.from("employee_shifts")
    .select("employee_name, store, hours, shift_date")
    .gte("shift_date", cutoff.toISOString().split("T")[0])
    .order("employee_name");

  if (!shifts) return [];

  var byEmployee = {};
  shifts.forEach(function(s) {
    var name = s.employee_name;
    if (!byEmployee[name]) byEmployee[name] = { name: name, stores: {}, totalHours: 0, shifts: 0 };
    var store = s.store;
    if (!byEmployee[name].stores[store]) byEmployee[name].stores[store] = { hours: 0, shifts: 0 };
    var h = parseFloat(s.hours) || 0;
    byEmployee[name].stores[store].hours += h;
    byEmployee[name].stores[store].shifts++;
    byEmployee[name].totalHours += h;
    byEmployee[name].shifts++;
  });

  return Object.values(byEmployee).map(function(e) {
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
  }).sort(function(a, b) { return b.storeCount - a.storeCount || b.totalHours - a.totalHours; });
}

// ═══════════════════════════════════════════════════════════
// ACTION: coverage
// ═══════════════════════════════════════════════════════════
async function getCoverageAnalysis(weekOf, demandPatterns) {
  var sb = getSupabase();

  var startDate = new Date(weekOf + "T00:00:00");
  var endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 8);

  var startStr = startDate.toISOString().split("T")[0];
  var endStr = endDate.toISOString().split("T")[0];

  // Merge stored shifts + WhenIWork live
  var shifts = [];

  try {
    var { data: storedShifts } = await sb.from("employee_shifts")
      .select("*")
      .gte("shift_date", startStr)
      .lt("shift_date", endStr)
      .order("shift_date");
    if (storedShifts) shifts = shifts.concat(storedShifts);
  } catch (e) { console.error("Stored shifts error:", e.message); }

  // WhenIWork live for future/unsynced shifts
  try {
    var wiwToken = process.env.WHENIWORK_TOKEN;
    if (wiwToken) {
      var wiwResp = await fetch("https://api.wheniwork.com/2/shifts?start=" + startStr + "&end=" + endStr, {
        headers: { "W-Token": wiwToken, Accept: "application/json" }
      });
      if (wiwResp.ok) {
        var wiwData = await wiwResp.json();
        var wiwUsers = {};
        (wiwData.users || []).forEach(function(u) { wiwUsers[u.id] = ((u.first_name || "") + " " + (u.last_name || "")).trim(); });
        var wiwLocations = {};
        (wiwData.locations || []).forEach(function(l) { wiwLocations[l.id] = l.name || ""; });

        (wiwData.shifts || []).forEach(function(ws) {
          var name = wiwUsers[ws.user_id] || "Unknown";
          var store = resolveStore(wiwLocations[ws.location_id] || "");
          var shiftDate = ws.start_time ? ws.start_time.split("T")[0] : null;
          if (!shiftDate || !store) return;

          var exists = shifts.some(function(s) {
            return s.employee_name === name && s.shift_date === shiftDate && s.store === store;
          });
          if (!exists) {
            var hours = 0;
            if (ws.start_time && ws.end_time) hours = (new Date(ws.end_time) - new Date(ws.start_time)) / 3600000;
            shifts.push({
              employee_name: name, store: store, shift_date: shiftDate,
              start_time: ws.start_time, end_time: ws.end_time, hours: hours,
            });
          }
        });
      }
    }
  } catch (e) { console.error("WhenIWork live error:", e.message); }

  // Build coverage map
  var coverage = {};
  STORE_KEYS.forEach(function(sk) { coverage[sk] = {}; });

  shifts.forEach(function(s) {
    var store = resolveStore(s.store) || s.store;
    if (!coverage[store]) return;
    if (!s.shift_date) return;
    if (!coverage[store][s.shift_date]) {
      coverage[store][s.shift_date] = {};
      for (var h = 9; h <= 19; h++) coverage[store][s.shift_date][h] = [];
    }

    var startH = 9, endH = 17;
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

    for (var h = Math.max(startH, 9); h < Math.min(endH, 20); h++) {
      if (!coverage[store][s.shift_date][h]) coverage[store][s.shift_date][h] = [];
      coverage[store][s.shift_date][h].push(s.employee_name);
    }
  });

  // Gap analysis
  var analysis = {};
  var totalGaps = 0, criticalGaps = 0, revenueAtRisk = 0;

  STORE_KEYS.forEach(function(sk) {
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
        var dd = demand[h] || { avgCalls: 0, avgMissed: 0, avgTickets: 0, recommendedStaff: 1, demandScore: 0 };
        var recommended = dd.recommendedStaff;
        var gap = recommended - staffOnHand;
        var severity = gap <= 0 ? "OK" : gap === 1 ? "WATCH" : "CRITICAL";

        var estimatedMissed = dd.avgMissed > 0
          ? dd.avgMissed
          : (dd.avgCalls > 0 && recommended > 0 ? dd.avgCalls * Math.max(gap, 0) / recommended : Math.max(gap, 0) * 2);
        var missedRevPerHour = gap > 0 ? Math.round(estimatedMissed * 0.25 * 175) : 0;

        analysis[sk].days[dateStr].hours[h] = {
          staffOnHand: staffOnHand, staffNames: staffNames,
          recommended: recommended, gap: gap, severity: severity,
          demandScore: dd.demandScore, avgCalls: dd.avgCalls, avgMissed: dd.avgMissed,
          avgTickets: dd.avgTickets, revenueAtRisk: missedRevPerHour,
        };

        if (severity !== "OK") {
          analysis[sk].summary.totalGapHours++;
          totalGaps++;
          if (severity === "CRITICAL") { analysis[sk].summary.criticalHours++; criticalGaps++; }
          analysis[sk].summary.revenueAtRisk += missedRevPerHour;
          revenueAtRisk += missedRevPerHour;
        }
      }
    }
  });

  return {
    weekOf: startStr, stores: analysis,
    summary: { totalGapHours: totalGaps, criticalGapHours: criticalGaps, totalRevenueAtRisk: revenueAtRisk }
  };
}

// ═══════════════════════════════════════════════════════════
// ACTION: optimize
// ═══════════════════════════════════════════════════════════
async function optimizeSchedule(weekOf, demandPatterns, floatEmployees) {
  var employeeProfiles = floatEmployees.map(function(e) {
    return { name: e.name, primaryStore: e.primaryStore, canWorkAt: e.storeList, avgWeeklyHours: e.avgWeeklyHours, isFloat: e.isFloat };
  });

  var demandSummary = {};
  STORE_KEYS.forEach(function(sk) {
    demandSummary[sk] = {};
    DAYS_OF_WEEK.forEach(function(dow) {
      var dayDemand = demandPatterns[sk]?.[dow] || {};
      var totalCalls = 0, totalMissed = 0, peakHour = 12, peakDemand = 0;
      for (var h = 9; h <= 19; h++) {
        totalCalls += dayDemand[h]?.avgCalls || 0;
        totalMissed += dayDemand[h]?.avgMissed || 0;
        if ((dayDemand[h]?.demandScore || 0) > peakDemand) {
          peakDemand = dayDemand[h]?.demandScore || 0; peakHour = h;
        }
      }
      demandSummary[sk][dow] = { totalCalls: Math.round(totalCalls), totalMissed: Math.round(totalMissed), peakHour: peakHour, peakDemand: Math.round(peakDemand * 10) / 10 };
    });
  });

  try {
    var resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 4000,
        messages: [{ role: "user", content: `You are a ruthlessly analytical staffing optimizer for 3 cell phone repair stores (Fishers, Bloomington, Indianapolis). Generate the optimal weekly schedule starting ${weekOf}.

CONSTRAINTS:
- Stores open Mon-Sat 10AM-7PM, some open Sunday 11AM-5PM
- At least 1 person per open store at all times
- No employee exceeds 40 hours/week
- Float employees can work multiple stores — minimize travel days
- Prioritize 2+ staff during peak hours (11AM-2PM)

EMPLOYEES:
${JSON.stringify(employeeProfiles, null, 1)}

DEMAND PATTERNS:
${JSON.stringify(demandSummary, null, 1)}

Return ONLY valid JSON:
{
  "schedule": [{"employee":"Name","monday":{"store":"fishers","start":"10:00","end":"6:00","hours":8},"tuesday":null,...}],
  "rationale": "Brief explanation",
  "expectedMetrics": {"totalLaborHours":N,"coverageScore":N,"estimatedAnswerRate":N}
}` }],
      }),
    });

    var aiData = await resp.json();
    var text = (aiData.content || []).map(function(c) { return c.text || ""; }).join("");
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (e) {
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
      if (!weekOf) return Response.json({ error: "weekOf required" }, { status: 400 });
      var demand = await getHourlyDemand(null, days);
      var cov = await getCoverageAnalysis(weekOf, demand);
      return Response.json({ success: true, ...cov });
    }
    if (action === "optimize") {
      if (!weekOf) return Response.json({ error: "weekOf required" }, { status: 400 });
      var demand2 = await getHourlyDemand(null, 30);
      var floats2 = await getFloatEmployees(60);
      var opt = await optimizeSchedule(weekOf, demand2, floats2);
      return Response.json({ success: true, optimization: opt });
    }
    return Response.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("Demand analysis error:", e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

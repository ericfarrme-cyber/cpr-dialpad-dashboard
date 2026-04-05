import { NextResponse } from "next/server";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

// Employee-to-store mapping from roster (fallback if no WhenIWork data)
var AREA_MANAGER_NAMES = ["matthew slade", "matt slade", "slade, matthew"];

function isAreaManager(name) {
  var lower = (name || "").toLowerCase().trim();
  return AREA_MANAGER_NAMES.some(function(am) { return lower.includes(am) || am.includes(lower.split(",").reverse().join(" ").trim()); });
}

function normalizeEmployeeName(name) {
  // Convert "Last, First" to "First Last"
  if (name && name.includes(",")) {
    var parts = name.split(",").map(function(p) { return p.trim(); });
    // Remove middle initial if present (e.g., "Slade, Matthew R" -> "Matthew Slade")
    var first = parts[1] ? parts[1].replace(/\s+[A-Z]$/, "").trim() : "";
    return (first + " " + parts[0]).trim();
  }
  return (name || "").trim();
}

export async function POST(request) {
  var apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ success: false, error: "Anthropic API key not configured" });

  try {
    var formData = await request.formData();
    var file = formData.get("file");
    if (!file) return json({ success: false, error: "No file provided" });

    var buffer = await file.arrayBuffer();
    var base64 = Buffer.from(buffer).toString("base64");
    var mediaType = file.type || "application/pdf";

    // Step 1: Extract payroll data via Claude
    var res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [{
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            {
              type: "text",
              text: 'This is a payroll summary PDF. Extract EVERY employee row.\n\nFor each employee, I need:\n- name: The employee name exactly as shown (e.g., "Awad, Mahmoud")\n- hours: Total hours worked (number)\n- total_expense: The "Total Expense" column value (this is Total Paid + Employer Liability — the TRUE cost to the business)\n\nIf an employee appears on multiple check dates, create a SEPARATE entry for each row. Do NOT combine them.\n\nAlso extract:\n- pay_period_start: The pay period start date\n- pay_period_end: The pay period end date  \n- company_total_expense: The company total from the totals row\n\nReturn ONLY valid JSON, no markdown, no backticks:\n{"employees": [{"name": "Awad, Mahmoud", "hours": 29.16, "total_expense": 569.58, "check_date": "03/27/2026"}], "pay_period_start": "02/23/2026", "pay_period_end": "03/22/2026", "company_total_expense": 24672.77}',
            },
          ],
        }],
      }),
    });

    var aiRes = await res.json();
    var reply = aiRes.content && aiRes.content[0] ? aiRes.content[0].text : "";
    var cleaned = reply.replace(/```json|```/g, "").trim();
    var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return json({ success: false, error: "Could not parse payroll data" });
    var payrollData = JSON.parse(jsonMatch[0]);

    if (!payrollData.employees || payrollData.employees.length === 0) {
      return json({ success: false, error: "No employee data found in PDF" });
    }

    // Step 2: Aggregate by employee (sum across check dates)
    var empTotals = {};
    payrollData.employees.forEach(function(e) {
      var name = normalizeEmployeeName(e.name);
      if (!empTotals[name]) empTotals[name] = { name: name, rawName: e.name, hours: 0, total_expense: 0, entries: 0 };
      empTotals[name].hours += parseFloat(e.hours) || 0;
      empTotals[name].total_expense += parseFloat(e.total_expense) || 0;
      empTotals[name].entries += 1;
    });

    // Step 3: Fetch WhenIWork shifts for the pay period
    var wiwToken = process.env.WHENIWORK_TOKEN;
    var shifts = [];
    if (wiwToken) {
      try {
        var startDate = payrollData.pay_period_start ? new Date(payrollData.pay_period_start).toISOString().split("T")[0] : null;
        var endDate = payrollData.pay_period_end ? new Date(payrollData.pay_period_end).toISOString().split("T")[0] : null;
        if (!startDate || !endDate) {
          // Fallback: use check date range
          startDate = "2026-02-23";
          endDate = "2026-03-22";
        }
        var wiwRes = await fetch("https://api.wheniwork.com/2/shifts?start=" + startDate + "&end=" + endDate + "&include_objects=true", {
          headers: { "Authorization": "Bearer " + wiwToken, "Content-Type": "application/json" },
        });
        if (wiwRes.ok) {
          var wiwData = await wiwRes.json();
          var users = {};
          (wiwData.users || []).forEach(function(u) { users[u.id] = ((u.first_name || "") + " " + (u.last_name || "")).trim(); });
          var locations = {};
          (wiwData.locations || []).forEach(function(l) { locations[l.id] = l.name || ""; });

          (wiwData.shifts || []).filter(function(s) { return !s.is_open; }).forEach(function(s) {
            var empName = users[s.user_id] || "Unknown";
            var locName = (locations[s.location_id] || "").toLowerCase();
            var store = locName.includes("fishers") ? "fishers" : locName.includes("bloomington") ? "bloomington" : locName.includes("indianapolis") || locName.includes("indy") ? "indianapolis" : null;
            var startH = new Date(s.start_time);
            var endH = new Date(s.end_time);
            var hours = (endH - startH) / (1000 * 60 * 60);
            if (store && hours > 0) {
              shifts.push({ employee: empName, store: store, hours: hours });
            }
          });
        }
      } catch (wiwErr) {
        console.log("[extract-payroll] WhenIWork fetch failed:", wiwErr.message);
      }
    }

    // Step 4: Build per-employee store hour breakdown from WhenIWork
    var empStoreHours = {};
    shifts.forEach(function(s) {
      var name = s.employee.toLowerCase();
      if (!empStoreHours[name]) empStoreHours[name] = { fishers: 0, bloomington: 0, indianapolis: 0 };
      empStoreHours[name][s.store] += s.hours;
    });

    // Step 5: Distribute payroll costs
    var distribution = { fishers: 0, bloomington: 0, indianapolis: 0, corporate: 0 };
    var employeeBreakdown = [];

    Object.values(empTotals).forEach(function(emp) {
      var nameLower = emp.name.toLowerCase();
      var expense = Math.round(emp.total_expense * 100) / 100;

      // Area manager special handling
      if (isAreaManager(emp.name) || isAreaManager(emp.rawName)) {
        var perStore = Math.round(expense / 5 * 100) / 100;
        var corporate = Math.round(expense * 2 / 5 * 100) / 100;
        distribution.fishers += perStore;
        distribution.bloomington += perStore;
        distribution.indianapolis += perStore;
        distribution.corporate += corporate;
        employeeBreakdown.push({
          name: emp.name, total_expense: expense, hours: Math.round(emp.hours * 100) / 100,
          method: "area_manager", fishers: perStore, bloomington: perStore, indianapolis: perStore, corporate: corporate,
        });
        return;
      }

      // Try WhenIWork-based distribution
      var storeHours = empStoreHours[nameLower];
      if (!storeHours) {
        // Try partial match
        Object.keys(empStoreHours).forEach(function(k) {
          var nameParts = nameLower.split(" ");
          if (nameParts.some(function(p) { return p.length > 2 && k.includes(p); })) {
            storeHours = empStoreHours[k];
          }
        });
      }

      if (storeHours) {
        var totalH = storeHours.fishers + storeHours.bloomington + storeHours.indianapolis;
        if (totalH > 0) {
          var fPct = storeHours.fishers / totalH;
          var bPct = storeHours.bloomington / totalH;
          var iPct = storeHours.indianapolis / totalH;
          var fAmt = Math.round(expense * fPct * 100) / 100;
          var bAmt = Math.round(expense * bPct * 100) / 100;
          var iAmt = Math.round(expense * iPct * 100) / 100;
          // Fix rounding — assign remainder to largest store
          var remainder = expense - fAmt - bAmt - iAmt;
          if (Math.abs(remainder) > 0.001) {
            if (fPct >= bPct && fPct >= iPct) fAmt += remainder;
            else if (bPct >= iPct) bAmt += remainder;
            else iAmt += remainder;
          }
          distribution.fishers += fAmt;
          distribution.bloomington += bAmt;
          distribution.indianapolis += iAmt;
          employeeBreakdown.push({
            name: emp.name, total_expense: expense, hours: Math.round(emp.hours * 100) / 100,
            method: "schedule", fishers: fAmt, bloomington: bAmt, indianapolis: iAmt, corporate: 0,
            schedule_hours: { fishers: Math.round(storeHours.fishers * 10) / 10, bloomington: Math.round(storeHours.bloomington * 10) / 10, indianapolis: Math.round(storeHours.indianapolis * 10) / 10 },
          });
          return;
        }
      }

      // No schedule data — mark as unassigned
      employeeBreakdown.push({
        name: emp.name, total_expense: expense, hours: Math.round(emp.hours * 100) / 100,
        method: "unassigned", fishers: 0, bloomington: 0, indianapolis: 0, corporate: 0,
      });
    });

    // Round distribution totals
    Object.keys(distribution).forEach(function(k) { distribution[k] = Math.round(distribution[k] * 100) / 100; });

    var computedTotal = distribution.fishers + distribution.bloomington + distribution.indianapolis + distribution.corporate;
    var unassigned = employeeBreakdown.filter(function(e) { return e.method === "unassigned"; });

    console.log("[extract-payroll] Employees: " + Object.keys(empTotals).length + " | Shifts: " + shifts.length + " | Distributed: $" + computedTotal.toFixed(2));

    return json({
      success: true,
      distribution: distribution,
      employees: employeeBreakdown,
      unassigned: unassigned,
      totals: {
        payroll_total: payrollData.company_total_expense,
        distributed_total: computedTotal,
        unassigned_total: unassigned.reduce(function(s, e) { return s + e.total_expense; }, 0),
      },
      pay_period: { start: payrollData.pay_period_start, end: payrollData.pay_period_end },
      shifts_found: shifts.length,
    });

  } catch (e) {
    console.error("[extract-payroll] Error:", e.message);
    return json({ success: false, error: "Failed: " + e.message });
  }
}

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════════════════
// Advanced Repairs API
//
// Commission rules:
//   Primary tech bonus (paid to repaired_by employee):
//     If repaired_by = "Duncan"  → 10% × profit
//     Else                       →  7% × profit
//   Duncan overhead bonus (paid to Duncan, in addition):
//     If repaired_by ≠ "Duncan"  →  3% × profit
//     Else                       →  0
//   Commission only counts when status = 'closed' (customer picked up + paid).
//   Origin Store absorbs the commission expense on its P&L.
// ═══════════════════════════════════════════════════════════════════════════

var DUNCAN_PRIMARY_RATE = 0.10;
var DEFAULT_PRIMARY_RATE = 0.07;
var DUNCAN_OVERHEAD_RATE = 0.03;

// Fuzzy name match — handles "Duncan Hitti" vs "Duncan" vs "Hitti, Duncan" etc.
// Mirrors the matchName helper in MyPerformanceTab so the two stay in sync.
function namesMatch(a, b) {
  if (!a || !b) return false;
  var x = String(a).toLowerCase().trim();
  var y = String(b).toLowerCase().trim();
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  var xParts = x.replace(",", " ").split(/\s+/).filter(Boolean);
  var yParts = y.replace(",", " ").split(/\s+/).filter(Boolean);
  if (xParts.length > 0 && yParts.length > 0 && xParts[0] === yParts[0]) return true;
  if (xParts.length >= 2 && yParts.length >= 2) {
    if (xParts[0] === yParts[1] && xParts[1] === yParts[0]) return true;
  }
  return false;
}

// Detect "Duncan" specifically — used for commission rate decisions.
// Matches "Duncan", "Duncan Hitti", "Hitti, Duncan", etc.
function isDuncan(name) {
  return namesMatch(name, "Duncan");
}

// ─── Ownership check ──────────────────────────────────────────────────────
// Returns true if the actor is authorized to edit/delete this repair.
// Admins can edit anything. Non-admins can edit a repair if they created it
// (created_by matches) or they were the intake employee (intake_employee matches).
// The actor object comes from the client (passed via body.actor).
function canActOn(repair, actor) {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  if (!repair) return false;
  // Check against both created_by and intake_employee, against both name and email
  var candidates = [actor.name, actor.email].filter(Boolean);
  for (var i = 0; i < candidates.length; i++) {
    if (namesMatch(repair.created_by, candidates[i])) return true;
    if (namesMatch(repair.intake_employee, candidates[i])) return true;
  }
  return false;
}

function commissionFor(repair) {
  // Returns array of { employee, rate, amount, store, role }
  // Only paid on closed repairs (not open/in_transit/repaired/nonrepairable)
  if (repair.status !== "closed") return [];
  var profit = parseFloat(repair.profit || 0);
  if (profit <= 0) return [];
  var techRaw = (repair.repaired_by || "").trim();
  if (!techRaw) return [];
  var isDuncanTech = isDuncan(techRaw);
  var primaryRate = isDuncanTech ? DUNCAN_PRIMARY_RATE : DEFAULT_PRIMARY_RATE;
  var out = [{
    employee: techRaw,
    rate: primaryRate,
    amount: Math.round(profit * primaryRate * 100) / 100,
    store: repair.origin_store,
    role: "primary",
    repair_id: repair.id,
  }];
  if (!isDuncanTech) {
    out.push({
      employee: "Duncan",
      rate: DUNCAN_OVERHEAD_RATE,
      amount: Math.round(profit * DUNCAN_OVERHEAD_RATE * 100) / 100,
      store: repair.origin_store,
      role: "overhead",
      repair_id: repair.id,
    });
  }
  return out;
}

// ─── Try to pull final price/profit from ticket_grades when ticket is closed in RepairQ ───
async function tryReconcile(ticketNumber) {
  if (!ticketNumber) return null;
  var { data, error } = await supabase
    .from("ticket_grades")
    .select("ticket_number, gross_sales, gross_profit, employee_repaired, device, date_closed")
    .eq("ticket_number", ticketNumber)
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    price: parseFloat(data.gross_sales || 0),
    profit: parseFloat(data.gross_profit || 0),
    employee_repaired: data.employee_repaired || "",
    device: data.device || "",
    date_closed: data.date_closed || null,
  };
}

// ─── Reconcile a single repair row against ticket_grades ───
// Shared by the single "reconcile" action and the batch "reconcile_all" action
// so the auto-close guards stay identical in both paths.
// `repair` is the full advanced_repairs row (must include status, commission_locked,
// profit, price, repaired_by, device_repair, date_closed, ticket_number, id).
// Returns { reconciled, status_auto_closed, repair (updated), source, note, error }.
async function reconcileRepair(repair) {
  if (!repair) return { reconciled: false, error: "repair not found" };
  var match = await tryReconcile(repair.ticket_number);
  if (!match) {
    return { reconciled: false, message: "No matching ticket in ticket_grades yet." };
  }

  // Don't overwrite a manually-entered non-zero profit/price with a $0 from RepairQ.
  var existingProfit = parseFloat(repair.profit || 0);
  var matchedProfit = parseFloat(match.profit || 0);
  var existingPrice = parseFloat(repair.price || 0);
  var matchedPrice = parseFloat(match.price || 0);
  var keepExistingProfit = existingProfit > 0 && matchedProfit === 0;
  var keepExistingPrice = existingPrice > 0 && matchedPrice === 0;

  var patch = {
    reconciled_from_ticket: true,
    reconciled_at: new Date().toISOString(),
  };
  if (!keepExistingPrice) patch.price = matchedPrice;
  if (!keepExistingProfit) patch.profit = matchedProfit;
  if (!repair.repaired_by && match.employee_repaired) patch.repaired_by = match.employee_repaired;
  if (!repair.device_repair && match.device) patch.device_repair = match.device;
  if (!repair.date_closed && match.date_closed) patch.date_closed = match.date_closed;

  // ─── AUTO-CLOSE on sync ───
  // In ticket_grades, a non-null date_closed proves RepairQ closed the ticket.
  // Flip the advanced repair to "closed" so it shows correctly and pays commission
  // (commission only counts status === "closed"). Guards:
  //  - Only close when RepairQ actually has a close date.
  //  - Never override "nonrepairable" (a tech's call — don't pay a repair commission).
  //  - Skip if already "closed" (no-op) or commission_locked (paid period).
  var statusAutoClosed = false;
  if (
    match.date_closed &&
    !repair.commission_locked &&
    repair.status !== "closed" &&
    repair.status !== "nonrepairable"
  ) {
    patch.status = "closed";
    statusAutoClosed = true;
  }

  var { data, error } = await supabase
    .from("advanced_repairs")
    .update(patch)
    .eq("id", repair.id)
    .select()
    .single();
  if (error) return { reconciled: false, error: error.message };

  var note = null;
  if (keepExistingProfit && keepExistingPrice) {
    note = "RepairQ ticket found but has $0 price and profit (warranty rework or zero-profit ticket). Kept your manually-entered values.";
  } else if (keepExistingProfit) {
    note = "RepairQ profit was $0 — kept your manually-entered profit of $" + existingProfit.toFixed(2) + ".";
  } else if (keepExistingPrice) {
    note = "RepairQ price was $0 — kept your manually-entered price.";
  }
  if (statusAutoClosed) {
    note = (note ? note + " " : "") + "Marked closed (RepairQ shows this ticket closed on " + match.date_closed + ").";
  }

  return { reconciled: true, status_auto_closed: statusAutoClosed, repair: data, source: match, note: note };
}


export async function GET(request) {
  try {
    var { searchParams } = new URL(request.url);
    var action = searchParams.get("action") || "list";

    // ─── LIST: returns all repairs with filters ───
    if (action === "list") {
      var period = searchParams.get("period"); // YYYY-MM
      var store = searchParams.get("store");   // filter by origin_store
      var status = searchParams.get("status"); // filter by status
      var q = supabase.from("advanced_repairs").select("*").order("ticket_created_date", { ascending: false }).limit(500);

      // Period filter: matches repairs that were ACTIVE during that month.
      // For closed repairs, filter by date_closed. For others, filter by ticket_created_date.
      if (period) {
        var parts = period.split("-");
        var year = parseInt(parts[0]);
        var month = parseInt(parts[1]);
        if (year && month) {
          var start = year + "-" + String(month).padStart(2, "0") + "-01";
          var endMonth = month === 12 ? 1 : month + 1;
          var endYear = month === 12 ? year + 1 : year;
          var end = endYear + "-" + String(endMonth).padStart(2, "0") + "-01";
          // Show repairs whose ticket_created_date OR date_closed falls in the window
          q = q.or("and(ticket_created_date.gte." + start + ",ticket_created_date.lt." + end + "),and(date_closed.gte." + start + ",date_closed.lt." + end + ")");
        }
      }
      if (store) q = q.eq("origin_store", store);
      if (status) q = q.eq("status", status);

      var { data, error } = await q;
      if (error) return NextResponse.json({ success: false, error: error.message });

      // Attach commission breakdown to each row for client display
      var rows = (data || []).map(function(r) {
        return Object.assign({}, r, { commissions: commissionFor(r) });
      });
      return NextResponse.json({ success: true, repairs: rows });
    }

    // ─── COMMISSIONS: per-employee totals for a period ───
    if (action === "commissions") {
      var period = searchParams.get("period"); // YYYY-MM
      if (!period) return NextResponse.json({ success: false, error: "period required (YYYY-MM)" });
      var parts = period.split("-");
      var year = parseInt(parts[0]);
      var month = parseInt(parts[1]);
      if (!year || !month) return NextResponse.json({ success: false, error: "invalid period" });
      var start = year + "-" + String(month).padStart(2, "0") + "-01";
      var endMonth = month === 12 ? 1 : month + 1;
      var endYear = month === 12 ? year + 1 : year;
      var end = endYear + "-" + String(endMonth).padStart(2, "0") + "-01";

      var { data, error } = await supabase
        .from("advanced_repairs")
        .select("*")
        .eq("status", "closed")
        .gte("date_closed", start)
        .lt("date_closed", end);
      if (error) return NextResponse.json({ success: false, error: error.message });

      // Aggregate by employee
      var byEmployee = {};
      var byStore = { fishers: 0, bloomington: 0, indianapolis: 0 };
      var totalRepairs = (data || []).length;
      var totalProfit = 0;
      var totalCommission = 0;
      (data || []).forEach(function(r) {
        totalProfit += parseFloat(r.profit || 0);
        var lines = commissionFor(r);
        lines.forEach(function(line) {
          if (!byEmployee[line.employee]) {
            byEmployee[line.employee] = { employee: line.employee, primary_count: 0, overhead_count: 0, primary_amount: 0, overhead_amount: 0, total_amount: 0 };
          }
          byEmployee[line.employee][line.role + "_count"] += 1;
          byEmployee[line.employee][line.role + "_amount"] += line.amount;
          byEmployee[line.employee].total_amount += line.amount;
          if (byStore[line.store] !== undefined) byStore[line.store] += line.amount;
          totalCommission += line.amount;
        });
      });
      // Round
      Object.keys(byEmployee).forEach(function(k) {
        byEmployee[k].primary_amount = Math.round(byEmployee[k].primary_amount * 100) / 100;
        byEmployee[k].overhead_amount = Math.round(byEmployee[k].overhead_amount * 100) / 100;
        byEmployee[k].total_amount = Math.round(byEmployee[k].total_amount * 100) / 100;
      });
      Object.keys(byStore).forEach(function(k) {
        byStore[k] = Math.round(byStore[k] * 100) / 100;
      });

      var employees = Object.values(byEmployee).sort(function(a, b) { return b.total_amount - a.total_amount; });

      return NextResponse.json({
        success: true,
        period: period,
        total_repairs: totalRepairs,
        total_profit: Math.round(totalProfit * 100) / 100,
        total_commission: Math.round(totalCommission * 100) / 100,
        by_employee: employees,
        by_store: byStore,
      });
    }

    // ─── LEADERBOARD: same as commissions but trimmed for /appointments widget ───
    if (action === "leaderboard" || action === "public_leaderboard") {
      // public_leaderboard hides overhead earnings entirely — for employee-facing widget.
      // leaderboard includes overhead breakdown — for admin views.
      var hideOverhead = (action === "public_leaderboard");
      var period = searchParams.get("period");
      if (!period) {
        var now = new Date();
        period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      }
      var parts = period.split("-");
      var year = parseInt(parts[0]);
      var month = parseInt(parts[1]);
      var start = year + "-" + String(month).padStart(2, "0") + "-01";
      var endMonth = month === 12 ? 1 : month + 1;
      var endYear = month === 12 ? year + 1 : year;
      var end = endYear + "-" + String(endMonth).padStart(2, "0") + "-01";

      var { data, error } = await supabase
        .from("advanced_repairs")
        .select("repaired_by, profit, status, date_closed, origin_store")
        .eq("status", "closed")
        .gte("date_closed", start)
        .lt("date_closed", end);
      if (error) return NextResponse.json({ success: false, error: error.message });

      // Helper: find existing key for this employee using namesMatch, so "Duncan"
      // and "Duncan Hitti" collapse into one row regardless of name variation.
      var byEmployee = {};
      function findKeyFor(empName) {
        var keys = Object.keys(byEmployee);
        for (var i = 0; i < keys.length; i++) {
          if (namesMatch(keys[i], empName)) return keys[i];
        }
        return null;
      }

      (data || []).forEach(function(r) {
        var lines = commissionFor(r);
        lines.forEach(function(line) {
          // Skip overhead in public_leaderboard mode — employees shouldn't see it
          if (hideOverhead && line.role === "overhead") return;
          var key = findKeyFor(line.employee) || line.employee;
          if (!byEmployee[key]) {
            byEmployee[key] = { employee: key, repairs: 0, profit: 0, commission: 0 };
          }
          if (line.role === "primary") {
            byEmployee[key].repairs += 1;
            byEmployee[key].profit += parseFloat(r.profit || 0);
          }
          byEmployee[key].commission += line.amount;
        });
      });
      Object.keys(byEmployee).forEach(function(k) {
        byEmployee[k].profit = Math.round(byEmployee[k].profit * 100) / 100;
        byEmployee[k].commission = Math.round(byEmployee[k].commission * 100) / 100;
      });
      // Filter out employees with zero earnings in public mode (Duncan with no own work shouldn't show)
      var rankedRaw = Object.values(byEmployee);
      if (hideOverhead) rankedRaw = rankedRaw.filter(function(e) { return e.commission > 0 || e.repairs > 0; });
      var ranked = rankedRaw.sort(function(a, b) { return b.commission - a.commission; });
      return NextResponse.json({ success: true, period: period, leaderboard: ranked });
    }

    // ─── OPEN AT STORE: open/in-transit/repaired (not closed/nonrepairable) at a given store ───
    if (action === "open_at_store") {
      var store = searchParams.get("store");
      if (!store) return NextResponse.json({ success: false, error: "store required" });
      // Filter by origin_store — these are this store's customers' devices,
      // regardless of where they currently sit (e.g. sent to Duncan in Indy).
      var { data, error } = await supabase
        .from("advanced_repairs")
        .select("*")
        .eq("origin_store", store)
        .in("status", ["open", "in_transit", "repaired"])
        .order("ticket_created_date", { ascending: true }) // oldest first — they need attention most
        .limit(50);
      if (error) return NextResponse.json({ success: false, error: error.message });
      // Annotate each repair with days_in_queue (today minus ticket_created_date)
      var todayMs = Date.now();
      var enriched = (data || []).map(function(r) {
        var daysInQueue = null;
        if (r.ticket_created_date) {
          var created = new Date(r.ticket_created_date).getTime();
          if (!isNaN(created)) {
            daysInQueue = Math.max(0, Math.floor((todayMs - created) / (1000 * 60 * 60 * 24)));
          }
        }
        return Object.assign({}, r, { days_in_queue: daysInQueue });
      });
      return NextResponse.json({ success: true, repairs: enriched });
    }

    // ─── STORE STATS: aggregate metrics for one store's advanced repair widget ───
    // Returns: avg turnaround days (closed this month at store), open count, etc.
    if (action === "store_stats") {
      var store = searchParams.get("store");
      if (!store) return NextResponse.json({ success: false, error: "store required" });
      var period = searchParams.get("period");
      if (!period) {
        var nowS = new Date();
        period = nowS.getFullYear() + "-" + String(nowS.getMonth() + 1).padStart(2, "0");
      }
      var partsS = period.split("-");
      var yearS = parseInt(partsS[0]);
      var monthS = parseInt(partsS[1]);
      var startS = yearS + "-" + String(monthS).padStart(2, "0") + "-01";
      var endMonthS = monthS === 12 ? 1 : monthS + 1;
      var endYearS = monthS === 12 ? yearS + 1 : yearS;
      var endS = endYearS + "-" + String(endMonthS).padStart(2, "0") + "-01";

      // Closed-this-month at this store — for avg turnaround
      var closedRes = await supabase
        .from("advanced_repairs")
        .select("ticket_created_date, date_completed, date_closed, status")
        .eq("origin_store", store)
        .eq("status", "closed")
        .gte("date_closed", startS)
        .lt("date_closed", endS);
      if (closedRes.error) return NextResponse.json({ success: false, error: closedRes.error.message });

      // Compute average turnaround: intake → date_completed (NOT date_closed)
      var turnaroundDays = [];
      (closedRes.data || []).forEach(function(r) {
        if (!r.ticket_created_date || !r.date_completed) return;
        var start = new Date(r.ticket_created_date).getTime();
        var done = new Date(r.date_completed).getTime();
        if (isNaN(start) || isNaN(done) || done < start) return;
        turnaroundDays.push((done - start) / (1000 * 60 * 60 * 24));
      });
      var avgTurnaround = null;
      if (turnaroundDays.length > 0) {
        var sum = turnaroundDays.reduce(function(a, b) { return a + b; }, 0);
        avgTurnaround = Math.round((sum / turnaroundDays.length) * 10) / 10;
      }

      // Open count at store (any status that's not closed/nonrepairable, originated at this store)
      var openRes = await supabase
        .from("advanced_repairs")
        .select("id", { count: "exact", head: true })
        .eq("origin_store", store)
        .in("status", ["open", "in_transit", "repaired"]);
      var openCount = openRes.count || 0;

      return NextResponse.json({
        success: true,
        store: store,
        period: period,
        avg_turnaround_days: avgTurnaround,
        turnaround_sample_size: turnaroundDays.length,
        closed_this_month: (closedRes.data || []).length,
        open_count: openCount,
      });
    }

    // ─── MY COMMISSION: a single employee's earnings for the period ───
    if (action === "my_commission") {
      var employee = searchParams.get("employee");
      var period = searchParams.get("period");
      if (!employee) return NextResponse.json({ success: false, error: "employee required" });
      if (!period) {
        var now2 = new Date();
        period = now2.getFullYear() + "-" + String(now2.getMonth() + 1).padStart(2, "0");
      }
      var parts2 = period.split("-");
      var year2 = parseInt(parts2[0]);
      var month2 = parseInt(parts2[1]);
      var start2 = year2 + "-" + String(month2).padStart(2, "0") + "-01";
      var endMonth2 = month2 === 12 ? 1 : month2 + 1;
      var endYear2 = month2 === 12 ? year2 + 1 : year2;
      var end2 = endYear2 + "-" + String(endMonth2).padStart(2, "0") + "-01";
      var { data, error } = await supabase
        .from("advanced_repairs")
        .select("*")
        .eq("status", "closed")
        .gte("date_closed", start2)
        .lt("date_closed", end2);
      if (error) return NextResponse.json({ success: false, error: error.message });
      var totalAmount = 0;
      var totalRepairs = 0;
      var primaryAmount = 0;
      var overheadAmount = 0;
      (data || []).forEach(function(r) {
        var lines = commissionFor(r);
        lines.forEach(function(line) {
          if (namesMatch(line.employee, employee)) {
            totalAmount += line.amount;
            if (line.role === "primary") {
              totalRepairs += 1;
              primaryAmount += line.amount;
            } else {
              overheadAmount += line.amount;
            }
          }
        });
      });
      return NextResponse.json({
        success: true,
        employee: employee,
        period: period,
        total_amount: Math.round(totalAmount * 100) / 100,
        primary_amount: Math.round(primaryAmount * 100) / 100,
        overhead_amount: Math.round(overheadAmount * 100) / 100,
        primary_repairs: totalRepairs,
      });
    }

    // ─── LOOKUP: look up a ticket_number in ticket_grades for auto-fill at intake ───
    if (action === "lookup") {
      var ticketNumber = (searchParams.get("ticket_number") || "").trim();
      if (!ticketNumber) return NextResponse.json({ success: false, error: "ticket_number required" });
      var { data: lookupData, error: lookupError } = await supabase
        .from("ticket_grades")
        .select("ticket_number, customer_name, device, gross_sales, gross_profit, employee_repaired, date_closed")
        .eq("ticket_number", ticketNumber)
        .limit(1)
        .maybeSingle();
      if (lookupError) return NextResponse.json({ success: false, error: lookupError.message });
      if (!lookupData) return NextResponse.json({ success: true, found: false });
      return NextResponse.json({
        success: true,
        found: true,
        customer_name: lookupData.customer_name || "",
        device: lookupData.device || "",
        gross_sales: parseFloat(lookupData.gross_sales || 0),
        gross_profit: parseFloat(lookupData.gross_profit || 0),
        employee_repaired: lookupData.employee_repaired || "",
        date_closed: lookupData.date_closed || null,
      });
    }

    return NextResponse.json({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

export async function POST(request) {
  try {
    var body = await request.json();
    var action = body.action || "create";

    // ─── CREATE ───
    if (action === "create") {
      var payload = {
        ticket_number: (body.ticket_number || "").trim(),
        ticket_url: body.ticket_url || "",
        ticket_created_date: body.ticket_created_date || null,
        customer_name: body.customer_name || "",
        device_repair: body.device_repair || "",
        origin_store: body.origin_store,
        current_location: body.current_location || body.origin_store,
        bench_fee: !!body.bench_fee,
        intake_employee: body.intake_employee || "",
        repaired_by: body.repaired_by || "",
        last_transported_by: body.last_transported_by || "",
        last_transport_date: body.last_transport_date || null,
        status: body.status || "open",
        estimated_completion: body.estimated_completion || null,
        date_completed: body.date_completed || null,
        date_closed: body.date_closed || null,
        customer_picked_up_at_origin: body.customer_picked_up_at_origin !== false,
        price: parseFloat(body.price || 0),
        profit: parseFloat(body.profit || 0),
        notes: body.notes || "",
        created_by: body.created_by || "",
        updated_by: body.created_by || "",
      };
      if (!payload.ticket_number) return NextResponse.json({ success: false, error: "ticket_number required" });
      if (!payload.origin_store) return NextResponse.json({ success: false, error: "origin_store required" });

      var { data, error } = await supabase
        .from("advanced_repairs")
        .insert(payload)
        .select()
        .single();
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, repair: data });
    }

    // ─── UPDATE ───
    if (action === "update") {
      if (!body.id) return NextResponse.json({ success: false, error: "id required" });

      // Load existing record so we can check ownership + locked status
      var { data: existing } = await supabase
        .from("advanced_repairs")
        .select("commission_locked, created_by, intake_employee")
        .eq("id", body.id)
        .single();
      if (existing && existing.commission_locked) {
        return NextResponse.json({ success: false, error: "This repair's commission has been paid out and is locked from edits." });
      }

      // Permission check: admin always allowed; non-admin must own this repair
      if (existing && !canActOn(existing, body.actor)) {
        return NextResponse.json({ success: false, error: "You can only edit advanced repairs you logged. Ask an admin or whoever created this entry." });
      }

      // Build patch — only update fields actually supplied
      var patch = { updated_by: body.updated_by || "" };
      var editable = [
        "ticket_number", "ticket_url", "ticket_created_date", "customer_name",
        "device_repair", "origin_store", "current_location", "bench_fee",
        "intake_employee", "repaired_by", "last_transported_by", "last_transport_date",
        "status", "estimated_completion", "date_completed", "date_closed",
        "customer_picked_up_at_origin", "price", "profit", "notes",
      ];
      editable.forEach(function(k) {
        if (body[k] !== undefined) {
          if (k === "price" || k === "profit") patch[k] = parseFloat(body[k] || 0);
          else if (k === "bench_fee" || k === "customer_picked_up_at_origin") patch[k] = !!body[k];
          else patch[k] = body[k];
        }
      });

      // Auto-set date_completed when transitioning to repaired (if not already set)
      if (body.status === "repaired" && !body.date_completed) {
        var { data: cur } = await supabase.from("advanced_repairs").select("date_completed").eq("id", body.id).single();
        if (cur && !cur.date_completed) {
          patch.date_completed = new Date().toISOString().slice(0, 10);
        }
      }
      // Auto-set date_closed when transitioning to closed (if not already set)
      if (body.status === "closed" && !body.date_closed) {
        var { data: cur2 } = await supabase.from("advanced_repairs").select("date_closed").eq("id", body.id).single();
        if (cur2 && !cur2.date_closed) {
          patch.date_closed = new Date().toISOString().slice(0, 10);
        }
      }

      var { data, error } = await supabase
        .from("advanced_repairs")
        .update(patch)
        .eq("id", body.id)
        .select()
        .single();
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, repair: data });
    }

    // ─── RECONCILE: pull final price/profit from ticket_grades by ticket_number ───
    if (action === "reconcile") {
      if (!body.id) return NextResponse.json({ success: false, error: "id required" });
      var { data: repair } = await supabase.from("advanced_repairs").select("*").eq("id", body.id).single();
      if (!repair) return NextResponse.json({ success: false, error: "repair not found" });

      var result = await reconcileRepair(repair);
      if (result.error) return NextResponse.json({ success: false, error: result.error });
      if (!result.reconciled) {
        return NextResponse.json({ success: true, reconciled: false, message: result.message || "No matching ticket in ticket_grades yet. Will retry later." });
      }
      return NextResponse.json({
        success: true,
        reconciled: true,
        repair: result.repair,
        source: result.source,
        status_auto_closed: result.status_auto_closed,
        note: result.note,
      });
    }

    // ─── RECONCILE ALL: batch-reconcile every open repair against RepairQ ───
    // One call sweeps all non-closed/non-nonrepairable repairs, pulling final
    // price/profit and auto-closing any that RepairQ shows closed. Safe to call
    // repeatedly (idempotent) and safe for a cron to hit on a schedule.
    // Locked and already-closed repairs are skipped by the shared guards.
    if (action === "reconcile_all") {
      var { data: openRepairs, error: listErr } = await supabase
        .from("advanced_repairs")
        .select("*")
        .in("status", ["open", "in_transit", "repaired"]);
      if (listErr) return NextResponse.json({ success: false, error: listErr.message });

      var summary = {
        scanned: (openRepairs || []).length,
        reconciled: 0,
        auto_closed: 0,
        no_match: 0,
        errors: 0,
      };
      var closedTickets = [];

      for (var i = 0; i < (openRepairs || []).length; i++) {
        var r = openRepairs[i];
        try {
          var res = await reconcileRepair(r);
          if (res.error) { summary.errors++; continue; }
          if (!res.reconciled) { summary.no_match++; continue; }
          summary.reconciled++;
          if (res.status_auto_closed) {
            summary.auto_closed++;
            closedTickets.push(r.ticket_number);
          }
        } catch (e) {
          summary.errors++;
        }
      }

      return NextResponse.json({ success: true, summary: summary, closed_tickets: closedTickets });
    }

    // ─── DELETE ───
    if (action === "delete") {
      if (!body.id) return NextResponse.json({ success: false, error: "id required" });
      var { data: existingDel } = await supabase
        .from("advanced_repairs")
        .select("commission_locked, created_by, intake_employee")
        .eq("id", body.id)
        .single();
      if (existingDel && existingDel.commission_locked) {
        return NextResponse.json({ success: false, error: "This repair's commission has been paid out. Cannot delete." });
      }
      if (existingDel && !canActOn(existingDel, body.actor)) {
        return NextResponse.json({ success: false, error: "You can only delete advanced repairs you logged. Ask an admin if you need help." });
      }
      var { error: delError } = await supabase.from("advanced_repairs").delete().eq("id", body.id);
      if (delError) return NextResponse.json({ success: false, error: delError.message });
      return NextResponse.json({ success: true });
    }

    // ─── LOCK: mark commission as paid for a period (prevents future edits) ───
    if (action === "lock_period") {
      var period = body.period;
      if (!period) return NextResponse.json({ success: false, error: "period required" });
      var parts = period.split("-");
      var year = parseInt(parts[0]);
      var month = parseInt(parts[1]);
      var start = year + "-" + String(month).padStart(2, "0") + "-01";
      var endMonth = month === 12 ? 1 : month + 1;
      var endYear = month === 12 ? year + 1 : year;
      var end = endYear + "-" + String(endMonth).padStart(2, "0") + "-01";
      var { data, error } = await supabase
        .from("advanced_repairs")
        .update({ commission_locked: true })
        .eq("status", "closed")
        .gte("date_closed", start)
        .lt("date_closed", end)
        .select("id");
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, locked: (data || []).length });
    }

    return NextResponse.json({ success: false, error: "Unknown action: " + action });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message });
  }
}

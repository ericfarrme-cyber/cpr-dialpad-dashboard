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

function commissionFor(repair) {
  // Returns array of { employee, rate, amount, store, role }
  // Only paid on closed repairs (not open/in_transit/repaired/nonrepairable)
  if (repair.status !== "closed") return [];
  var profit = parseFloat(repair.profit || 0);
  if (profit <= 0) return [];
  var techRaw = (repair.repaired_by || "").trim();
  var tech = techRaw.toLowerCase();
  if (!tech) return [];
  var isDuncanTech = tech === "duncan";
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
    if (action === "leaderboard") {
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

      var byEmployee = {};
      (data || []).forEach(function(r) {
        var lines = commissionFor(r);
        lines.forEach(function(line) {
          if (!byEmployee[line.employee]) {
            byEmployee[line.employee] = { employee: line.employee, repairs: 0, profit: 0, commission: 0 };
          }
          if (line.role === "primary") {
            byEmployee[line.employee].repairs += 1;
            byEmployee[line.employee].profit += parseFloat(r.profit || 0);
          }
          byEmployee[line.employee].commission += line.amount;
        });
      });
      Object.keys(byEmployee).forEach(function(k) {
        byEmployee[k].profit = Math.round(byEmployee[k].profit * 100) / 100;
        byEmployee[k].commission = Math.round(byEmployee[k].commission * 100) / 100;
      });
      var ranked = Object.values(byEmployee).sort(function(a, b) { return b.commission - a.commission; });
      return NextResponse.json({ success: true, period: period, leaderboard: ranked });
    }

    // ─── OPEN AT STORE: open/in-transit/repaired (not closed/nonrepairable) at a given store ───
    if (action === "open_at_store") {
      var store = searchParams.get("store");
      if (!store) return NextResponse.json({ success: false, error: "store required" });
      var { data, error } = await supabase
        .from("advanced_repairs")
        .select("*")
        .or("origin_store.eq." + store + ",current_location.eq." + store)
        .in("status", ["open", "in_transit", "repaired"])
        .order("ticket_created_date", { ascending: false })
        .limit(50);
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, repairs: data || [] });
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
          if (line.employee.toLowerCase() === employee.toLowerCase()) {
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

      // Check if it's commission-locked
      var { data: existing } = await supabase.from("advanced_repairs").select("commission_locked").eq("id", body.id).single();
      if (existing && existing.commission_locked) {
        return NextResponse.json({ success: false, error: "This repair's commission has been paid out and is locked from edits." });
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
      var match = await tryReconcile(repair.ticket_number);
      if (!match) {
        return NextResponse.json({ success: true, reconciled: false, message: "No matching ticket in ticket_grades yet. Will retry later." });
      }
      var patch = {
        price: match.price,
        profit: match.profit,
        reconciled_from_ticket: true,
        reconciled_at: new Date().toISOString(),
      };
      if (!repair.repaired_by && match.employee_repaired) patch.repaired_by = match.employee_repaired;
      if (!repair.device_repair && match.device) patch.device_repair = match.device;
      if (!repair.date_closed && match.date_closed) patch.date_closed = match.date_closed;
      var { data, error } = await supabase
        .from("advanced_repairs")
        .update(patch)
        .eq("id", body.id)
        .select()
        .single();
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, reconciled: true, repair: data, source: match });
    }

    // ─── DELETE ───
    if (action === "delete") {
      if (!body.id) return NextResponse.json({ success: false, error: "id required" });
      var { data: existing } = await supabase.from("advanced_repairs").select("commission_locked").eq("id", body.id).single();
      if (existing && existing.commission_locked) {
        return NextResponse.json({ success: false, error: "This repair's commission has been paid out. Cannot delete." });
      }
      var { error } = await supabase.from("advanced_repairs").delete().eq("id", body.id);
      if (error) return NextResponse.json({ success: false, error: error.message });
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

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

function normPhone(p) { return p ? String(p).replace(/\D/g, "").slice(-10) : ""; }

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action") || "list";
  var store = searchParams.get("store");
  var days = parseInt(searchParams.get("days") || "30");

  if (action === "list") {
    var query = supabase.from("appointments").select("*").order("date_of_appt", { ascending: false }).order("appt_time", { ascending: true }).limit(500);
    if (store && store !== "all") query = query.eq("store", store);
    var startDate = searchParams.get("start");
    var endDate = searchParams.get("end");
    var listDays = searchParams.get("days");
    if (listDays) {
      var cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(listDays));
      query = query.gte("date_of_appt", cutoffDate.toISOString().split("T")[0]);
    }
    if (startDate) query = query.gte("date_of_appt", startDate);
    if (endDate) query = query.lte("date_of_appt", endDate);
    var { data, error } = await query;
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, appointments: data || [] });
  }

  if (action === "stats") {
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var query = supabase.from("appointments").select("store, scheduled_by, did_arrive, date_of_appt, customer_phone, follow_up_needed, follow_up_done").gte("date_of_appt", cutoff.toISOString().split("T")[0]);
    if (store && store !== "all") query = query.eq("store", store);
    var { data, error } = await query;
    if (error) return json({ success: false, error: error.message });

    var appts = data || [];
    var total = appts.length;
    var arrived = appts.filter(function(a) { return a.did_arrive && (a.did_arrive.toLowerCase() === "yes" || a.did_arrive.toLowerCase() === "converted"); }).length;
    var converted = appts.filter(function(a) { return a.did_arrive && a.did_arrive.toLowerCase() === "converted"; }).length;
    var noShow = appts.filter(function(a) { return a.did_arrive && (a.did_arrive.toLowerCase() === "no" || a.did_arrive.toLowerCase().includes("no")); }).length;
    var pending = appts.filter(function(a) { return !a.did_arrive || a.did_arrive === ""; }).length;
    var showRate = total > 0 ? Math.round((arrived / total) * 100) : 0;
    var needFollowUp = appts.filter(function(a) { return a.follow_up_needed && !a.follow_up_done; }).length;

    // Per employee
    var empMap = {};
    appts.forEach(function(a) {
      var emp = a.scheduled_by || "Unknown";
      if (!empMap[emp]) empMap[emp] = { name: emp, total: 0, arrived: 0, converted: 0, no_show: 0 };
      empMap[emp].total++;
      if (a.did_arrive && (a.did_arrive.toLowerCase() === "yes" || a.did_arrive.toLowerCase() === "converted")) empMap[emp].arrived++;
      if (a.did_arrive && a.did_arrive.toLowerCase() === "converted") empMap[emp].converted++;
      if (a.did_arrive && (a.did_arrive.toLowerCase() === "no" || a.did_arrive.toLowerCase().includes("no"))) empMap[emp].no_show++;
    });
    var empStats = Object.values(empMap).map(function(e) {
      e.show_rate = e.total > 0 ? Math.round((e.arrived / e.total) * 100) : 0;
      return e;
    }).sort(function(a, b) { return b.total - a.total; });

    // Per store
    var storeMap = {};
    appts.forEach(function(a) {
      var sk = a.store || "unknown";
      if (!storeMap[sk]) storeMap[sk] = { store: sk, total: 0, arrived: 0, converted: 0, no_show: 0 };
      storeMap[sk].total++;
      if (a.did_arrive && (a.did_arrive.toLowerCase() === "yes" || a.did_arrive.toLowerCase() === "converted")) storeMap[sk].arrived++;
      if (a.did_arrive && a.did_arrive.toLowerCase() === "converted") storeMap[sk].converted++;
      if (a.did_arrive && (a.did_arrive.toLowerCase() === "no" || a.did_arrive.toLowerCase().includes("no"))) storeMap[sk].no_show++;
    });
    var storeStats = Object.values(storeMap).map(function(s) {
      s.show_rate = s.total > 0 ? Math.round((s.arrived / s.total) * 100) : 0;
      return s;
    });

    return json({
      success: true,
      stats: { total: total, arrived: arrived, converted: converted, noShow: noShow, pending: pending, showRate: showRate, needFollowUp: needFollowUp },
      empStats: empStats,
      storeStats: storeStats,
    });
  }

  if (action === "today") {
    var today = new Date().toISOString().split("T")[0];
    var query = supabase.from("appointments").select("*").eq("date_of_appt", today).order("appt_time", { ascending: true });
    if (store && store !== "all") query = query.eq("store", store);
    var { data, error } = await query;
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, appointments: data || [] });
  }

  // Check if a phone number has a recent call audit
  if (action === "match_call") {
    var phone = normPhone(searchParams.get("phone"));
    if (!phone) return json({ success: false, error: "Phone required" });
    var { data: audits } = await supabase.from("audit_results")
      .select("call_id, employee, store, score, call_type, inquiry, outcome, date_started, appt_offered, discount_mentioned, warranty_mentioned")
      .ilike("phone", "%" + phone)
      .order("date_started", { ascending: false })
      .limit(3);
    return json({ success: true, calls: audits || [] });
  }

  return json({ success: false, error: "Unknown action" });
}

export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var body = await request.json();
  var action = body.action || "add";

  if (action === "add") {
    var record = {
      store: body.store || "",
      customer_name: body.customer_name || "",
      customer_phone: normPhone(body.customer_phone),
      date_set: body.date_set || new Date().toISOString().split("T")[0],
      date_of_appt: body.date_of_appt || null,
      appt_time: body.appt_time || "",
      reason: body.reason || "",
      price_quoted: body.price_quoted || "",
      scheduled_by: body.scheduled_by || "",
      did_arrive: body.did_arrive || "",
      notes: body.notes || "",
      follow_up_needed: body.did_arrive ? body.did_arrive.toLowerCase().includes("no") : false,
    };
    var { data, error } = await supabase.from("appointments").insert(record).select();
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, appointment: data[0] });
  }

  if (action === "update") {
    var { id } = body;
    if (!id) return json({ success: false, error: "id required" });
    var updates = {};
    ["customer_name", "customer_phone", "date_set", "date_of_appt", "appt_time", "reason", "price_quoted", "scheduled_by", "did_arrive", "notes", "follow_up_needed", "follow_up_done", "follow_up_notes", "store"].forEach(function(k) {
      if (body[k] !== undefined) updates[k] = k === "customer_phone" ? normPhone(body[k]) : body[k];
    });
    // Auto-set follow_up_needed if marking no-show
    if (updates.did_arrive && updates.did_arrive.toLowerCase().includes("no")) {
      updates.follow_up_needed = true;
    }
    updates.updated_at = new Date().toISOString();
    var { data, error } = await supabase.from("appointments").update(updates).eq("id", id).select();
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, appointment: data[0] });
  }

  if (action === "delete") {
    var { id } = body;
    if (!id) return json({ success: false, error: "id required" });
    var { error } = await supabase.from("appointments").delete().eq("id", id);
    if (error) return json({ success: false, error: error.message });
    return json({ success: true });
  }

  if (action === "bulk_import") {
    var rows = body.rows || [];
    var store = body.store || "";
    if (rows.length === 0) return json({ success: false, error: "No rows to import" });
    var records = rows.map(function(r) {
      return {
        store: store,
        customer_name: r.customer_name || "",
        customer_phone: normPhone(r.customer_phone),
        date_set: r.date_set || null,
        date_of_appt: r.date_of_appt || null,
        appt_time: r.appt_time || "",
        reason: r.reason || "",
        price_quoted: r.price_quoted || "",
        scheduled_by: r.scheduled_by || "",
        did_arrive: r.did_arrive || "",
        notes: r.notes || "",
        follow_up_needed: r.did_arrive ? String(r.did_arrive).toLowerCase().includes("no") : false,
      };
    });
    var { data, error } = await supabase.from("appointments").insert(records).select();
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, imported: (data || []).length });
  }

  if (action === "clear_store") {
    var clearStore = body.store;
    if (!clearStore) return json({ success: false, error: "Store required" });
    var confirmCode = body.confirm;
    if (confirmCode !== "DELETE-ALL-" + clearStore.toUpperCase()) {
      return json({ success: false, error: "Invalid confirmation code. Send confirm: 'DELETE-ALL-" + clearStore.toUpperCase() + "'" });
    }
    var { error } = await supabase.from("appointments").delete().eq("store", clearStore);
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, message: "All appointments for " + clearStore + " deleted" });
  }

  return json({ success: false, error: "Unknown action" });
}

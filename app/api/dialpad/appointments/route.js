import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

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
    var query = supabase.from("appointments").select("*").order("date_of_appt", { ascending: false }).order("appt_time", { ascending: true }).limit(2000);
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

  // ── link appointments to the tickets they became ──────────────────────────
  // An appointment with a phone number and no ticket gets the first ticket
  // with that phone closed from the day of the visit to 14 days after. Runs
  // daily from Vercel Cron (Bearer $CRON_SECRET) or by an admin. Never
  // overwrites a ticket number a person typed, never touches did_arrive.
  if (action === "link_tickets") {
    var cronSecret = process.env.CRON_SECRET;
    var authz = request.headers.get("authorization") || "";
    var viaCron = !!cronSecret && authz === "Bearer " + cronSecret;
    if (!viaCron) {
      var gateL = await requireAuth(request, { requiredRoles: ["admin"] });
      if (!gateL.authorized) return gateL.response;
    }
    var LINK_DAYS = 14;
    var sinceA = new Date(); sinceA.setUTCDate(sinceA.getUTCDate() - 120);
    var { data: open, error: oErr } = await supabase.from("appointments")
      .select("id,customer_phone,date_of_appt,ticket_number")
      .gte("date_of_appt", sinceA.toISOString().slice(0, 10))
      .or("ticket_number.is.null,ticket_number.eq.")
      .not("customer_phone", "is", null).neq("customer_phone", "")
      .limit(3000);
    if (oErr) return json({ success: false, error: oErr.message }, 500);
    var byPhone = {};
    var tix = [];
    for (var from = 0; ; from += 1000) {
      var res = await supabase.from("ticket_grades").select("ticket_number,customer_phone,date_closed")
        .gte("date_closed", sinceA.toISOString()).not("date_closed", "is", null)
        .order("ticket_number", { ascending: true }).range(from, from + 999);
      if (res.error) return json({ success: false, error: "ticket_grades: " + res.error.message }, 500);
      tix = tix.concat(res.data || []);
      if ((res.data || []).length < 1000) break;
    }
    tix.forEach(function(t) {
      var d = normPhone(t.customer_phone);
      if (d.length !== 10) return;
      (byPhone[d] = byPhone[d] || []).push({ n: t.ticket_number, closed: String(t.date_closed).slice(0, 10) });
    });
    var linked = 0, examined = (open || []).length, failures = [];
    for (var i = 0; i < (open || []).length; i++) {
      var a = open[i];
      var cands = byPhone[normPhone(a.customer_phone)];
      if (!cands || !a.date_of_appt) continue;
      var end = new Date(a.date_of_appt + "T00:00:00Z"); end.setUTCDate(end.getUTCDate() + LINK_DAYS);
      var endS = end.toISOString().slice(0, 10);
      var hit = cands.filter(function(c) { return c.closed >= a.date_of_appt && c.closed <= endS; }).sort(function(x, y) { return x.closed < y.closed ? -1 : 1; })[0];
      if (!hit) continue;
      var { error: uErr } = await supabase.from("appointments").update({ ticket_number: String(hit.n), updated_at: new Date().toISOString() }).eq("id", a.id);
      if (uErr) failures.push({ id: a.id, error: uErr.message }); else linked++;
    }
    if (failures.length) console.error("[appointments] link_tickets partial failure:", JSON.stringify(failures.slice(0, 5)));
    return json({ success: failures.length === 0, examined: examined, linked: linked, failed: failures.length, window_days: LINK_DAYS });
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

function moneyNum(v) { if (v === null || v === undefined || v === "") return null; var n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isFinite(n) ? Math.round(n * 100) / 100 : null; }

export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var body = await request.json();
  var action = body.action || "add";

  // Writes need a signed-in user. Any role may book or update; deleting one
  // appointment is a manager's call and wiping a store is Eric's. Until
  // 2026-09-11 this route accepted writes from anyone with the URL.
  var gate = await requireAuth(request, { requiredRoles: action === "clear_store" ? ["admin"] : action === "delete" ? ["admin", "manager"] : ["admin", "manager", "employee"] });
  if (!gate.authorized) return gate.response;
  var who = gate.result;

  if (action === "add") {
    var fromBook = body.source === "price_book";
    var record = {
      store: body.store || who.store || "",
      customer_name: body.customer_name || "",
      customer_phone: normPhone(body.customer_phone),
      date_set: body.date_set || new Date().toISOString().split("T")[0],
      date_of_appt: body.date_of_appt || null,
      appt_time: body.appt_time || "",
      reason: body.reason || "",
      price_quoted: body.price_quoted || "",
      // The signed-in person books it. Hand-typed names produced 18 spellings for 8 people.
      scheduled_by: body.scheduled_by || who.name || "",
      did_arrive: body.did_arrive || "",
      notes: body.notes || "",
      follow_up_needed: body.did_arrive ? body.did_arrive.toLowerCase().includes("no") : false,
      // sql/migration_appointments_quote.sql ran 2026-09-11; every add says where it came from.
      source: fromBook ? "price_book" : "manual",
      booked_by_email: who.email || null,
    };
    if (fromBook) {
      // Structured quote: the row it came from, the sheet and floor at that
      // moment, what was actually said, and why if it was under the sheet.
      var sheet = moneyNum(body.sheet_price), quoted = moneyNum(body.quoted_price);
      if (!record.customer_name.trim()) return json({ success: false, error: "Customer name is required" }, 400);
      if (!record.date_of_appt) return json({ success: false, error: "Appointment date is required" }, 400);
      if (quoted === null) return json({ success: false, error: "Quoted price is required" }, 400);
      if (sheet !== null && quoted < sheet - 0.005 && !String(body.quote_reason || "").trim()) {
        return json({ success: false, error: "A quote under the sheet needs a reason" }, 400);
      }
      Object.assign(record, {
        repair_price_id: body.repair_price_id || null,
        device: body.device || null, repair: body.repair || null, tier: body.tier || null,
        canonical_model: body.canonical_model || null, canonical_repair: body.canonical_repair || null,
        sheet_price: sheet, book_floor: moneyNum(body.book_floor), quoted_price: quoted,
        quote_reason: body.quote_reason ? String(body.quote_reason).slice(0, 200) : null,
        call_id: body.call_id || null,
        turnaround: body.turnaround ? String(body.turnaround).slice(0, 40) : null,
      });
      // The prose the appointments page shows carries the turnaround too, the
      // way agents always wrote it ("iPhone 16 screen 1-2hrs $160").
      if (!record.reason) record.reason = [record.device, record.repair, record.tier, record.turnaround].filter(Boolean).join(" · ");
      if (!record.price_quoted) record.price_quoted = String(quoted);
    }
    var { data, error } = await supabase.from("appointments").insert(record).select();
    if (error) return json({ success: false, error: error.message }, 500);
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
    var importStore = body.store || "";
    if (rows.length === 0) return json({ success: false, error: "No rows to import" });
    var records = rows.map(function(r) {
      return {
        store: importStore,
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
        source: "import",
        booked_by_email: who.email || null,
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

  // ═══ VERIFY FOLLOWUPS via Dialpad call data ═══
  if (action === "verify_followups") {
    var vStore = body.store || "";
    // Get all pending verification appointments
    var pendingQ = supabase.from("appointments").select("id, customer_phone, date_of_appt, follow_up_notes, store")
      .eq("follow_up_done", false).eq("follow_up_needed", true)
      .like("follow_up_notes", "pending_verification%");
    if (vStore && vStore !== "all") pendingQ = pendingQ.eq("store", vStore);

    var { data: pendingAppts, error: pErr } = await pendingQ;
    if (pErr) return json({ success: false, error: pErr.message });
    if (!pendingAppts || pendingAppts.length === 0) return json({ success: true, verified: 0 });

    // Get outbound calls from last 60 days
    var obCutoff = new Date();
    obCutoff.setDate(obCutoff.getDate() - 60);
    var { data: outboundCalls } = await supabase.from("call_records")
      .select("external_number, date_started, store")
      .eq("direction", "outbound")
      .gte("date_started", obCutoff.toISOString());

    // Index outbound calls by phone
    var obByPhone = {};
    (outboundCalls || []).forEach(function(c) {
      var ph = normPhone(c.external_number);
      if (!ph) return;
      if (!obByPhone[ph]) obByPhone[ph] = [];
      obByPhone[ph].push(c);
    });

    var verified = 0;
    for (var i = 0; i < pendingAppts.length; i++) {
      var appt = pendingAppts[i];
      var custPhone = normPhone(appt.customer_phone);
      if (!custPhone || custPhone.length !== 10) continue;

      var calls = obByPhone[custPhone] || [];
      // Check if any outbound call was made after the no-show date
      var hasCallback = calls.some(function(c) {
        return new Date(c.date_started) >= new Date(appt.date_of_appt + "T00:00:00");
      });

      if (hasCallback) {
        var parts = (appt.follow_up_notes || "").split("|");
        var origNote = parts[1] || "Called back";
        await supabase.from("appointments").update({
          follow_up_done: true,
          follow_up_notes: "Verified via Dialpad|" + origNote + "|" + new Date().toISOString(),
        }).eq("id", appt.id);
        verified++;
      }
    }

    return json({ success: true, verified: verified });
  }

  return json({ success: false, error: "Unknown action" });
}

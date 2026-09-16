// Store hours for days that are not normal days.
//
//   GET  /api/dialpad/store-hours?days=21   upcoming holidays + what is recorded
//   POST { action:"set", store|stores, date, closes_at?, opens_at?, closed_all_day?, reason }
//   POST { action:"clear", store, date }
//
// The point is the prompt: a holiday with no hours recorded is asked about
// before it arrives, because after the fact Dialpad cannot retag the calls and
// a missed call at 4:30pm on a day the store shut at 4 counts against the team.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { STORE_KEYS } from "@/lib/constants";
import { upcomingHolidays } from "@/lib/store-closures";

export const dynamic = "force-dynamic";

function todayIndy() {
  var p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Indiana/Indianapolis", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  var o = {}; p.forEach(function(x) { o[x.type] = x.value; });
  return o.year + "-" + o.month + "-" + o.day;
}
function validTime(t) { return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t); }

export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  try {
    var { searchParams } = new URL(request.url);
    var days = Math.min(120, Math.max(1, parseInt(searchParams.get("days") || "21", 10)));
    var today = todayIndy();
    var horizon = new Date(today + "T00:00:00Z"); horizon.setUTCDate(horizon.getUTCDate() + days);

    var { data: rows, error } = await supabase
      .from("store_closures")
      .select("id, store, closure_date, closes_at, opens_at, reason, created_by")
      .gte("closure_date", today).lte("closure_date", horizon.toISOString().slice(0, 10));
    if (error) throw new Error(error.message);

    // A holiday still needs asking about until every store has hours on it.
    var holidays = upcomingHolidays(today, days).map(function(h) {
      var have = (rows || []).filter(function(r) { return String(r.closure_date).slice(0, 10) === h.date; });
      var missing = STORE_KEYS.filter(function(s) { return !have.some(function(r) { return r.store === s; }); });
      return Object.assign({}, h, { recorded: have, missing_stores: missing, needs_hours: missing.length > 0 });
    });

    // Recent history so a wrong entry can be spotted and fixed.
    var back = new Date(today + "T00:00:00Z"); back.setUTCDate(back.getUTCDate() - 90);
    var { data: past, error: pErr } = await supabase
      .from("store_closures")
      .select("id, store, closure_date, closes_at, opens_at, reason, created_by")
      .gte("closure_date", back.toISOString().slice(0, 10)).lt("closure_date", today)
      .order("closure_date", { ascending: false }).limit(60);
    if (pErr) throw new Error(pErr.message);

    return NextResponse.json({ success: true, today: today, days: days, holidays: holidays, upcoming: rows || [], recent: past || [] });
  } catch (e) {
    console.error("[store-hours] GET failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" }, { status: 500 });
  // Hours feed the answer rate, which feeds a bonus — managers and admins only.
  var gate = await requireAuth(request, { requiredRoles: ["admin", "manager"] });
  if (!gate.authorized) return gate.response;
  var who = gate.result.name || gate.result.email;

  try {
    var body = await request.json();
    var date = String(body.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ success: false, error: "date must be YYYY-MM-DD" }, { status: 400 });
    var stores = Array.isArray(body.stores) ? body.stores : body.store ? [body.store] : [];
    stores = stores.filter(function(s) { return STORE_KEYS.indexOf(s) >= 0; });
    if (!stores.length) return NextResponse.json({ success: false, error: "no valid store given" }, { status: 400 });

    if (body.action === "clear") {
      var { error: dErr } = await supabase.from("store_closures").delete().eq("closure_date", date).in("store", stores);
      if (dErr) throw new Error(dErr.message);
      return NextResponse.json({ success: true, cleared: stores.length, date: date });
    }
    if (body.action !== "set") return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });

    var closesAt = body.closed_all_day ? null : body.closes_at || null;
    var opensAt = body.closed_all_day ? null : body.opens_at || null;
    if (closesAt && !validTime(closesAt)) return NextResponse.json({ success: false, error: "closes_at must be HH:MM" }, { status: 400 });
    if (opensAt && !validTime(opensAt)) return NextResponse.json({ success: false, error: "opens_at must be HH:MM" }, { status: 400 });
    if (!body.closed_all_day && !closesAt && !opensAt) return NextResponse.json({ success: false, error: "Give a closing time, an opening time, or mark the day closed" }, { status: 400 });

    var now = new Date().toISOString();
    var records = stores.map(function(s) {
      return { store: s, closure_date: date, closes_at: closesAt, opens_at: opensAt, reason: body.reason ? String(body.reason).slice(0, 200) : null, created_by: who, updated_at: now };
    });
    var { data, error } = await supabase.from("store_closures").upsert(records, { onConflict: "store,closure_date" }).select();
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, saved: (data || []).length, date: date, stores: stores, closed_all_day: !!body.closed_all_day, closes_at: closesAt, by: who });
  } catch (e) {
    console.error("[store-hours] POST failed:", e.message);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

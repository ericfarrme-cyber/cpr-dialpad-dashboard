import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

var REVENUE_FIELDS = ["accessory_revenue","accessory_cogs","device_revenue","device_cogs","repair_revenue","repair_cogs","parts_revenue","parts_cogs","services_revenue","services_cogs","promotions_revenue","promotions_cogs"];
var EXPENSE_FIELDS = ["rent","payroll","corporate_overhead","area_manager_expenses","internet_security","electric","gas_parking","voip","marketing_digital","marketing_local","store_budget","damaged","shrinkage","voided","kbb_charges","tips","lcd_credits","cc_fee_diff"];
var FEE_FIELDS = ["royalty_rate","cpr_ad_fee","cpr_tech_fee"];
var LABOR_FIELDS = ["hours_worked","revenue_per_hour_goal","profit_per_hour_goal"];
var ALL_FIELDS = REVENUE_FIELDS.concat(EXPENSE_FIELDS).concat(FEE_FIELDS).concat(LABOR_FIELDS).concat(["notes", "area_manager_breakdown"]);

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action") || "get";
  var period = searchParams.get("period");
  var store = searchParams.get("store");

  if (action === "get") {
    if (!period) {
      var now = new Date();
      period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    }
    var query = supabase.from("profitability").select("*").eq("period", period);
    if (store && store !== "all") query = query.eq("store", store);
    var { data, error } = await query;
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, records: data || [], period: period });
  }

  if (action === "periods") {
    var { data, error } = await supabase.from("profitability").select("period").order("period", { ascending: false });
    if (error) return json({ success: false, error: error.message });
    var unique = [];
    (data || []).forEach(function(r) { if (unique.indexOf(r.period) < 0) unique.push(r.period); });
    return json({ success: true, periods: unique });
  }

  if (action === "history") {
    var sk = searchParams.get("store") || "all";
    var query = supabase.from("profitability").select("*").order("period", { ascending: true });
    if (sk !== "all") query = query.eq("store", sk);
    var { data, error } = await query;
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, records: data || [] });
  }

  return json({ success: false, error: "Unknown action" });
}

export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var body = await request.json();
  var action = body.action || "save";

  if (action === "save") {
    var period = body.period;
    var store = body.store;
    if (!period || !store) return json({ success: false, error: "Period and store required" });

    var record = { period: period, store: store, updated_at: new Date().toISOString() };
    ALL_FIELDS.forEach(function(f) {
      if (body[f] !== undefined) {
        record[f] = (f === "notes" || f === "area_manager_breakdown") ? body[f] : parseFloat(body[f]) || 0;
      }
    });

    var { data, error } = await supabase.from("profitability")
      .upsert(record, { onConflict: "period,store" })
      .select();
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, record: data[0] });
  }

  if (action === "copy_forward") {
    var fromPeriod = body.from_period;
    var toPeriod = body.to_period;
    if (!fromPeriod || !toPeriod) return json({ success: false, error: "from_period and to_period required" });

    var { data: source } = await supabase.from("profitability").select("*").eq("period", fromPeriod);
    if (!source || source.length === 0) return json({ success: false, error: "No data for " + fromPeriod });

    var copies = source.map(function(r) {
      var copy = {};
      ALL_FIELDS.forEach(function(f) { if (r[f] !== undefined && r[f] !== null) copy[f] = r[f]; });
      copy.period = toPeriod;
      copy.store = r.store;
      // Zero out revenue fields — those need fresh data
      REVENUE_FIELDS.forEach(function(f) { copy[f] = 0; });
      copy.hours_worked = 0;
      copy.notes = "";
      return copy;
    });

    var { data, error } = await supabase.from("profitability")
      .upsert(copies, { onConflict: "period,store" })
      .select();
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, copied: (data || []).length });
  }

  return json({ success: false, error: "Unknown action" });
}

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var store = searchParams.get("store") || "fishers";
  var currentPeriod = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");

  // Get current month
  var { data: current } = await supabase.from("google_reviews")
    .select("*")
    .eq("store", store)
    .eq("period", currentPeriod)
    .single();

  // Get history
  var { data: history } = await supabase.from("google_reviews")
    .select("*")
    .eq("store", store)
    .order("period", { ascending: false })
    .limit(12);

  return json({ success: true, current: current || null, history: history || [] });
}

export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var body = await request.json();
  var action = body.action || "save";

  if (action === "save") {
    var period = body.period;
    var store = body.store;
    if (!period || !store) return json({ success: false, error: "Period and store required" });

    var record = {
      period: period,
      store: store,
      total_reviews: parseInt(body.total_reviews) || 0,
      photo_reviews: parseInt(body.photo_reviews) || 0,
      employee_count: parseInt(body.employee_count) || 0,
      notes: body.notes || "",
      updated_at: new Date().toISOString(),
    };

    var { data, error } = await supabase.from("google_reviews")
      .upsert(record, { onConflict: "period,store" })
      .select();

    if (error) return json({ success: false, error: error.message });
    return json({ success: true, record: data[0] });
  }

  return json({ success: false, error: "Unknown action" });
}

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function json(data, status) { return NextResponse.json(data, { status: status || 200, headers: cors() }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: cors() }); }

export async function GET(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var store = searchParams.get("store") || "fishers";
  var action = searchParams.get("action") || "all";
  var currentPeriod = new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0");

  // Get monthly review/commission data
  var { data: current } = await supabase.from("google_reviews")
    .select("*")
    .eq("store", store)
    .eq("period", currentPeriod)
    .single();

  var { data: history } = await supabase.from("google_reviews")
    .select("*")
    .eq("store", store)
    .order("period", { ascending: false })
    .limit(12);

  // Get latest GBP report
  var { data: latestReport } = await supabase.from("gbp_reports")
    .select("*")
    .eq("store", store)
    .order("period_end", { ascending: false })
    .limit(1)
    .single();

  // Get GBP report history (last 12 weeks)
  var { data: reportHistory } = await supabase.from("gbp_reports")
    .select("*")
    .eq("store", store)
    .order("period_end", { ascending: false })
    .limit(12);

  return json({
    success: true,
    current: current || null,
    history: history || [],
    latestReport: latestReport || null,
    reportHistory: reportHistory || [],
  });
}

export async function POST(request) {
  if (!supabase) return json({ success: false, error: "Supabase not configured" });
  var body = await request.json();
  var action = body.action || "save";

  // ═══ SAVE MONTHLY REVIEW DATA (commission tracking) ═══
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

  // ═══ SAVE GBP WEEKLY REPORT ═══
  if (action === "save_report") {
    var store = body.store;
    var periodStart = body.period_start;
    var periodEnd = body.period_end;
    if (!store || !periodStart || !periodEnd) return json({ success: false, error: "Store, period_start, and period_end required" });

    var report = {
      store: store,
      period_start: periodStart,
      period_end: periodEnd,
      customer_calls: parseInt(body.customer_calls) || 0,
      profile_views: parseInt(body.profile_views) || 0,
      website_visits: parseInt(body.website_visits) || 0,
      direction_requests: parseInt(body.direction_requests) || 0,
      competitors_outranked: parseInt(body.competitors_outranked) || 0,
      received_reviews: parseInt(body.received_reviews) || 0,
      posts_published: parseInt(body.posts_published) || 0,
      photos_published: parseInt(body.photos_published) || 0,
      review_responses: parseInt(body.review_responses) || 0,
      offers_published: parseInt(body.offers_published) || 0,
      keywords: body.keywords || [],
      competitors: body.competitors || [],
      notes: body.notes || "",
      updated_at: new Date().toISOString(),
    };

    var { data, error } = await supabase.from("gbp_reports")
      .upsert(report, { onConflict: "store,period_start,period_end" })
      .select();

    if (error) return json({ success: false, error: error.message });
    return json({ success: true, report: data[0] });
  }

  // ═══ DELETE GBP REPORT ═══
  if (action === "delete_report") {
    var id = body.id;
    if (!id) return json({ success: false, error: "Report ID required" });

    var { error } = await supabase.from("gbp_reports").delete().eq("id", id);
    if (error) return json({ success: false, error: error.message });
    return json({ success: true });
  }

  return json({ success: false, error: "Unknown action" });
}

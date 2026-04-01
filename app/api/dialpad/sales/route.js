import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function parseCurrency(val) {
  if (!val) return 0;
  return parseFloat(String(val).replace(/[$,]/g, "")) || 0;
}

function parseRow(row) {
  var out = {};
  Object.keys(row).forEach(function(k) { out[k.trim()] = (row[k] || "").trim(); });
  return out;
}

function parseCSV(text) {
  var lines = text.split("\n").map(function(l) { return l.trim(); }).filter(Boolean);
  if (lines.length < 2) return [];
  
  // Handle quoted fields with commas
  function splitCSVLine(line) {
    var result = [];
    var current = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuotes = !inQuotes; }
      else if (line[i] === ',' && !inQuotes) { result.push(current); current = ""; }
      else { current += line[i]; }
    }
    result.push(current);
    return result.map(function(s) { return s.trim(); });
  }

  var headers = splitCSVLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var vals = splitCSVLine(lines[i]);
    var obj = {};
    headers.forEach(function(h, j) { obj[h] = vals[j] || ""; });
    rows.push(obj);
  }
  return rows;
}

// GET: Fetch sales data, commission config
export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action");
  var period = searchParams.get("period");

  // Get commission config
  if (action === "commission_config") {
    var { data, error } = await supabase.from("commission_config").select("*").order("id");
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, config: data || [] });
  }

  // Get all sales/repair data for a period
  if (action === "performance") {
    if (!period) {
      // Default to current month
      var now = new Date();
      period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    }

    var [phones, others, accessories, cleanings, cleaningSales, config] = await Promise.all([
      supabase.from("repair_phone").select("*").eq("import_period", period),
      supabase.from("repair_other").select("*").eq("import_period", period),
      supabase.from("sales_accessory").select("*").eq("import_period", period),
      supabase.from("repair_cleaning").select("*").eq("import_period", period),
      supabase.from("cleaning_sales").select("*").eq("import_period", period),
      supabase.from("commission_config").select("*"),
    ]);

    // Build commission rate map
    var rates = {};
    (config.data || []).forEach(function(c) { rates[c.config_key] = parseFloat(c.config_value); });

    // Get all available periods
    var { data: periodData } = await supabase.from("repair_phone").select("import_period").order("import_period", { ascending: false });
    var periods = [...new Set((periodData || []).map(function(r) { return r.import_period; }))];

    return NextResponse.json({
      success: true,
      period: period,
      available_periods: periods,
      phones: phones.data || [],
      others: others.data || [],
      accessories: accessories.data || [],
      cleanings: cleanings.data || [],
      cleaningSales: cleaningSales.data || [],
      rates: rates,
    });
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

// POST: Upload CSV, update commission config
export async function POST(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });

  var contentType = request.headers.get("content-type") || "";

  // JSON actions (commission config updates)
  if (contentType.includes("application/json")) {
    var body = await request.json();

    if (body.action === "update_commission") {
      var { key, value } = body;
      if (!key) return NextResponse.json({ success: false, error: "key required" });
      var { data, error } = await supabase.from("commission_config")
        .update({ config_value: parseFloat(value), updated_at: new Date().toISOString() })
        .eq("config_key", key).select();
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, config: data?.[0] });
    }

    if (body.action === "toggle_commission") {
      var { key, enabled } = body;
      if (!key) return NextResponse.json({ success: false, error: "key required" });
      var { data, error } = await supabase.from("commission_config")
        .update({ enabled: !!enabled, updated_at: new Date().toISOString() })
        .eq("config_key", key).select();
      if (error) return NextResponse.json({ success: false, error: error.message });
      return NextResponse.json({ success: true, config: data?.[0] });
    }

    if (body.action === "import_cleaning_sales") {
      var rows = body.rows || [];
      var csPeriod = body.period;
      if (!csPeriod) return NextResponse.json({ success: false, error: "period required" });
      if (rows.length === 0) return NextResponse.json({ success: false, error: "No rows to import" });
      var saved = 0;
      var errors = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r.employee) continue;
        var { error } = await supabase.from("cleaning_sales").upsert({
          employee: r.employee,
          ticket_count: parseInt(r.ticket_count) || 0,
          gross_sales: parseFloat(r.gross_sales) || 0,
          discount: parseFloat(r.discount) || 0,
          discounted_sales: parseFloat(r.discounted_sales) || 0,
          import_period: csPeriod,
          updated_at: new Date().toISOString(),
        }, { onConflict: "employee,import_period" });
        if (error) errors.push(r.employee + ": " + error.message); else saved++;
      }
      return NextResponse.json({ success: true, saved: saved, errors: errors, period: csPeriod });
    }

    if (body.action === "delete_period") {
      var dp = body.period;
      if (!dp) return NextResponse.json({ success: false, error: "period required" });
      var deleted = {};
      var tables = ["repair_phone", "repair_other", "sales_accessory", "repair_cleaning", "cleaning_sales"];
      for (var ti = 0; ti < tables.length; ti++) {
        var tbl = tables[ti];
        var { data: delData, error: delErr } = await supabase.from(tbl).delete().eq("import_period", dp).select();
        if (delErr) { deleted[tbl] = "error: " + delErr.message; }
        else { deleted[tbl] = delData ? delData.length : 0; }
      }
      return NextResponse.json({ success: true, deleted: deleted, period: dp });
    }

    return NextResponse.json({ success: false, error: "Invalid action" });
  }

  // FormData: CSV upload
  var formData = await request.formData();
  var file = formData.get("file");
  var type = formData.get("type"); // phone_repairs, other_repairs, accessories, cleanings
  var period = formData.get("period"); // e.g. "2026-03"

  if (!file || !type || !period) {
    return NextResponse.json({ success: false, error: "file, type, and period are required" });
  }

  var text = await file.text();
  var rows = parseCSV(text);
  if (rows.length === 0) return NextResponse.json({ success: false, error: "No data rows found in CSV" });

  var saved = 0;
  var errors = [];

  if (type === "phone_repairs") {
    for (var i = 0; i < rows.length; i++) {
      var r = parseRow(rows[i]);
      if (!r.Employee || r.Employee === "") continue; // skip totals row
      var { error } = await supabase.from("repair_phone").upsert({
        employee: r.Employee,
        repair_tickets: parseInt(r["Repair Tkts"]) || 0,
        repair_total: parseCurrency(r["Repair Total"]),
        avg_repair: parseCurrency(r["Average Repair"]),
        import_period: period,
      }, { onConflict: "employee,import_period" });
      if (error) errors.push(r.Employee + ": " + error.message); else saved++;
    }
  }

  else if (type === "other_repairs") {
    for (var i = 0; i < rows.length; i++) {
      var r = parseRow(rows[i]);
      if (!r.Employee || r.Employee === "") continue;
      var { error } = await supabase.from("repair_other").upsert({
        employee: r.Employee,
        repair_count: parseInt(r["# Repairs"]) || 0,
        repair_total: parseCurrency(r["Repair Total"]),
        avg_repair: parseCurrency(r.Avg || r["Avg"]),
        import_period: period,
      }, { onConflict: "employee,import_period" });
      if (error) errors.push(r.Employee + ": " + error.message); else saved++;
    }
  }

  else if (type === "accessories") {
    for (var i = 0; i < rows.length; i++) {
      var r = parseRow(rows[i]);
      if (!r.Employee || r.Employee === "") continue;
      var { error } = await supabase.from("sales_accessory").upsert({
        employee: r.Employee,
        accy_total: parseCurrency(r["Accy Total"]),
        accy_gp: parseCurrency(r["Accy GP"]),
        accy_count: parseInt(r["Accy Count"]) || 0,
        import_period: period,
      }, { onConflict: "employee,import_period" });
      if (error) errors.push(r.Employee + ": " + error.message); else saved++;
    }
  }

  else if (type === "cleanings") {
    for (var i = 0; i < rows.length; i++) {
      var r = parseRow(rows[i]);
      if (!r.Employee || r.Employee === "") continue;
      var { error } = await supabase.from("repair_cleaning").upsert({
        employee: r.Employee,
        clean_count: parseInt(r["# Cleans"]) || 0,
        clean_total: parseCurrency(r["Cleans Total"]),
        clean_avg: parseCurrency(r["Cleans Avg"]),
        import_period: period,
      }, { onConflict: "employee,import_period" });
      if (error) errors.push(r.Employee + ": " + error.message); else saved++;
    }
  }

  else {
    return NextResponse.json({ success: false, error: "Invalid type. Use: phone_repairs, other_repairs, accessories, cleanings" });
  }

  return NextResponse.json({ success: true, saved: saved, errors: errors, period: period, type: type });
}

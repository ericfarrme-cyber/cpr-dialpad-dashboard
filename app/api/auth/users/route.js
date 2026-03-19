import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validateAuth } from "@/lib/auth";

var adminClient = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function json(data, status) {
  return NextResponse.json(data, { status: status || 200, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } });
}

export async function GET(request) {
  var auth = await validateAuth(request, { requiredRoles: ["admin"] });
  if (auth.error) return json({ success: false, error: auth.error }, auth.user ? 403 : 401);

  var { data, error } = await adminClient
    .from("dashboard_users")
    .select("*")
    .order("role")
    .order("name");

  if (error) return json({ success: false, error: error.message });
  return json({ success: true, users: data || [] });
}

export async function POST(request) {
  var auth = await validateAuth(request, { requiredRoles: ["admin"] });
  if (auth.error) return json({ success: false, error: auth.error }, auth.user ? 403 : 401);

  var body = await request.json();
  var action = body.action;

  if (action === "add") {
    var { email, name, role, store } = body;
    if (!email) return json({ success: false, error: "Email required" });
    if (["admin", "manager", "employee"].indexOf(role) < 0) return json({ success: false, error: "Invalid role" });

    var { data, error } = await adminClient.from("dashboard_users")
      .upsert({ email: email.toLowerCase().trim(), name: name || "", role: role, store: store || "", active: true }, { onConflict: "email" })
      .select();
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, user: data[0] });
  }

  if (action === "update") {
    var { id, role, store, active, name, email } = body;
    if (!id) return json({ success: false, error: "User id required" });

    var updates = {};
    if (role !== undefined) updates.role = role;
    if (store !== undefined) updates.store = store;
    if (active !== undefined) updates.active = active;
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email.toLowerCase().trim();
    updates.updated_at = new Date().toISOString();

    var { data, error } = await adminClient.from("dashboard_users").update(updates).eq("id", id).select();
    if (error) return json({ success: false, error: error.message });
    return json({ success: true, user: data[0] });
  }

  if (action === "remove") {
    var { id } = body;
    if (!id) return json({ success: false, error: "User id required" });

    // Deactivate rather than delete for audit trail
    var { error } = await adminClient.from("dashboard_users").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ success: false, error: error.message });
    return json({ success: true });
  }

  return json({ success: false, error: "Unknown action" });
}

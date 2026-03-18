import { NextResponse } from "next/server";
import { validateAuth } from "@/lib/auth";

export async function GET(request) {
  var result = await validateAuth(request, {
    requiredRoles: ["admin", "manager", "employee"],
  });

  if (result.error) {
    return NextResponse.json({ success: false, error: result.error }, {
      status: result.user ? 403 : 401,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }

  return NextResponse.json({
    success: true,
    email: result.email,
    role: result.role,
    name: result.name,
    store: result.store,
  });
}

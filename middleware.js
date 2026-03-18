import { NextResponse } from "next/server";

export function middleware(request) {
  // Only add security headers — auth is handled client-side by AuthProvider
  var response = NextResponse.next();

  // Security headers
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-XSS-Protection", "1; mode=block");

  return response;
}

export var config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

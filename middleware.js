import { NextResponse } from "next/server";

export function middleware(request) {
  var url = request.nextUrl;
  var path = url.pathname;

  // Public paths — don't require auth
  var publicPaths = ["/login", "/auth/callback", "/api/auth"];
  for (var i = 0; i < publicPaths.length; i++) {
    if (path.startsWith(publicPaths[i])) return NextResponse.next();
  }

  // API routes that use their own auth (cron, extension, etc)
  // These check auth internally via validateAuth
  if (path.startsWith("/api/")) return NextResponse.next();

  // Static files
  if (path.startsWith("/_next") || path.startsWith("/favicon") || path.includes(".")) {
    return NextResponse.next();
  }

  // Check for Supabase auth cookie
  var cookies = request.cookies;
  var hasAuthCookie = false;
  cookies.getAll().forEach(function(c) {
    if (c.name.includes("auth-token") || c.name.includes("sb-")) {
      hasAuthCookie = true;
    }
  });

  // No auth cookie — redirect to login
  if (!hasAuthCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export var config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

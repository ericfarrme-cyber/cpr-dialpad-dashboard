import { createClient } from "@supabase/supabase-js";

// Service-role client for looking up user roles
var adminClient = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Shared secrets for non-user auth (cron jobs, chrome extension)
var CRON_SECRET = process.env.CRON_SECRET;
var EXTENSION_SECRET = "ft-ticket-grader-2026";

/**
 * Validate a request and return user info.
 * 
 * @param {Request} request - The incoming request
 * @param {Object} options
 * @param {string[]} options.requiredRoles - Roles allowed (e.g. ["admin", "manager"])
 * @param {boolean} options.allowCron - Allow cron secret auth
 * @param {boolean} options.allowExtension - Allow extension secret auth
 * @returns {{ user, role, email, error }} 
 */
export async function validateAuth(request, options) {
  var opts = options || {};
  var requiredRoles = opts.requiredRoles || ["admin", "manager", "employee"];
  var allowCron = opts.allowCron || false;
  var allowExtension = opts.allowExtension || false;

  // Check for cron secret (in URL path or header)
  if (allowCron) {
    var url = new URL(request.url);
    if (url.searchParams.get("secret") === CRON_SECRET || url.pathname.includes(CRON_SECRET)) {
      return { user: { id: "cron" }, role: "system", email: "cron@system", error: null };
    }
    var cronHeader = request.headers.get("x-cron-secret");
    if (cronHeader === CRON_SECRET) {
      return { user: { id: "cron" }, role: "system", email: "cron@system", error: null };
    }
  }

  // Check for extension secret
  if (allowExtension) {
    var extSecret = request.headers.get("x-extension-secret");
    if (extSecret === EXTENSION_SECRET) {
      return { user: { id: "extension" }, role: "system", email: "extension@system", error: null };
    }
    // Also check body for extension requests (backward compat)
    try {
      var cloned = request.clone();
      var body = await cloned.json();
      if (body && body.secret === EXTENSION_SECRET) {
        return { user: { id: "extension" }, role: "system", email: "extension@system", error: null };
      }
    } catch(e) { /* not json body, skip */ }
  }

  // Check for Bearer token (Supabase auth)
  var authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    // Check cookie fallback (for same-origin requests from the dashboard)
    var cookieHeader = request.headers.get("cookie") || "";
    var tokenMatch = cookieHeader.match(/sb-[^=]+-auth-token=([^;]+)/);
    if (!tokenMatch) {
      return { user: null, role: null, email: null, error: "No authentication token provided" };
    }
    // Parse the cookie token
    try {
      var parsed = JSON.parse(decodeURIComponent(tokenMatch[1]));
      authHeader = "Bearer " + (parsed.access_token || parsed[0]);
    } catch(e) {
      return { user: null, role: null, email: null, error: "Invalid auth cookie" };
    }
  }

  var token = authHeader.replace("Bearer ", "");

  // Validate the token with Supabase
  var { data: userData, error: authError } = await adminClient.auth.getUser(token);
  if (authError || !userData || !userData.user) {
    return { user: null, role: null, email: null, error: "Invalid or expired token" };
  }

  var email = userData.user.email;

  // Look up the user's role in dashboard_users
  var { data: dashUser, error: roleError } = await adminClient
    .from("dashboard_users")
    .select("role, name, store, active, dashboard_access")
    .eq("email", email)
    .eq("active", true)
    .single();

  if (roleError || !dashUser) {
    return { user: userData.user, role: null, email: email, error: "Access denied — your email is not authorized for dashboard access. Contact admin." };
  }

  // Check if user's role is in the required roles
  if (requiredRoles.indexOf(dashUser.role) < 0) {
    return { user: userData.user, role: dashUser.role, email: email, error: "Insufficient permissions. Required: " + requiredRoles.join(" or ") };
  }

  return {
    user: userData.user,
    role: dashUser.role,
    name: dashUser.name,
    store: dashUser.store,
    email: email,
    dashboard_access: dashUser.role === "admin" ? true : (dashUser.dashboard_access || false),
    error: null,
  };
}

/**
 * Quick helper — returns 401/403 response or null if authorized
 */
export async function requireAuth(request, options) {
  var result = await validateAuth(request, options);
  if (result.error) {
    var status = result.user ? 403 : 401;
    return { authorized: false, result: result, response: new Response(JSON.stringify({ success: false, error: result.error }), {
      status: status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    })};
  }
  return { authorized: true, result: result, response: null };
}

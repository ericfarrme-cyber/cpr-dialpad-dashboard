import { NextResponse } from "next/server";

// WhenIWork API Route
// Env vars needed:
//   WHENIWORK_KEY    - Developer API key (W-Key header)
//   WHENIWORK_TOKEN  - Bearer token (obtained from login)
//   WHENIWORK_EMAIL  - (optional) For auto-login if token expires
//   WHENIWORK_PASSWORD - (optional) For auto-login if token expires

var WIW_API = "https://api.wheniwork.com/2";
var WIW_LOGIN = "https://api.login.wheniwork.com/login";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(data, status) {
  return NextResponse.json(data, { status: status || 200, headers: corsHeaders() });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// Get a valid bearer token — try stored token first, then login
async function getToken() {
  // If we have a direct bearer token, use it
  if (process.env.WHENIWORK_TOKEN) return process.env.WHENIWORK_TOKEN;

  // Otherwise try to login with key + email + password
  var key = process.env.WHENIWORK_KEY;
  var email = process.env.WHENIWORK_EMAIL;
  var password = process.env.WHENIWORK_PASSWORD;

  if (!key || !email || !password) return null;

  try {
    var res = await fetch(WIW_LOGIN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "W-Key": key,
      },
      body: JSON.stringify({ email: email, password: password }),
    });
    var json = await res.json();
    if (json.login && json.login.token) {
      return json.login.token;
    }
    console.error("[wheniwork] Login failed:", JSON.stringify(json));
    return null;
  } catch (e) {
    console.error("[wheniwork] Login error:", e.message);
    return null;
  }
}

// Make an authenticated request to WhenIWork API
async function wiwFetch(path, token) {
  var url = WIW_API + path;
  console.log("[wheniwork] Fetching:", url);
  var res = await fetch(url, {
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    var errText = await res.text();
    console.error("[wheniwork] API error " + res.status + ":", errText);
    throw new Error("WhenIWork API " + res.status + ": " + errText.substring(0, 200));
  }
  return res.json();
}

// Format date as YYYY-MM-DD
function fmtDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export async function GET(request) {
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action") || "status";

  if (action === "debug") {
    return jsonResponse({
      hasKey: !!process.env.WHENIWORK_KEY,
      hasEmail: !!process.env.WHENIWORK_EMAIL,
      hasPassword: !!process.env.WHENIWORK_PASSWORD,
      hasToken: !!process.env.WHENIWORK_TOKEN,
    });
  }

  // ─── STATUS CHECK ───
  if (action === "status") {
    var token = await getToken();
    if (!token) {
      return jsonResponse({
        success: false,
        authenticated: false,
        message: "WhenIWork not configured. Set WHENIWORK_TOKEN or WHENIWORK_KEY + WHENIWORK_EMAIL + WHENIWORK_PASSWORD in Vercel env vars.",
      });
    }
    // Verify token works by fetching locations
    try {
      var locData = await wiwFetch("/locations", token);
      return jsonResponse({
        success: true,
        authenticated: true,
        locations: (locData.locations || []).length,
      });
    } catch (e) {
      return jsonResponse({
        success: false,
        authenticated: false,
        message: "Token invalid or expired: " + e.message,
      });
    }
  }

  // All other actions need auth
  var token = await getToken();
  if (!token) return jsonResponse({ success: false, error: "Not authenticated" });

  try {
    // ─── TODAY'S SHIFTS ───
    if (action === "today") {
      var today = fmtDate(new Date());
      var data = await wiwFetch("/shifts?start=" + today + "&end=" + today + "&include_objects=true", token);

      var users = {};
      (data.users || []).forEach(function(u) { users[u.id] = u; });
      var locations = {};
      (data.locations || []).forEach(function(l) { locations[l.id] = l; });
      var positions = {};
      (data.positions || []).forEach(function(p) { positions[p.id] = p; });

      var shifts = (data.shifts || []).filter(function(s) { return !s.is_open; }).map(function(s) {
        var user = users[s.user_id] || {};
        var loc = locations[s.location_id] || {};
        var pos = positions[s.position_id] || {};
        return {
          id: s.id,
          employee: ((user.first_name || "") + " " + (user.last_name || "")).trim() || "Open Shift",
          user_id: s.user_id,
          start_time: s.start_time,
          end_time: s.end_time,
          location: loc.name || "",
          location_id: s.location_id,
          position: pos.name || "",
          position_id: s.position_id,
          notes: s.notes || "",
          is_open: s.is_open || false,
        };
      });

      return jsonResponse({ success: true, shifts: shifts });
    }

    // ─── SHIFTS BY DATE RANGE ───
    if (action === "shifts") {
      var start = searchParams.get("start") || fmtDate(new Date());
      var end = searchParams.get("end") || start;
      var data = await wiwFetch("/shifts?start=" + start + "&end=" + end + "&include_objects=true", token);

      var users = {};
      (data.users || []).forEach(function(u) { users[u.id] = u; });
      var locations = {};
      (data.locations || []).forEach(function(l) { locations[l.id] = l; });
      var positions = {};
      (data.positions || []).forEach(function(p) { positions[p.id] = p; });

      var shifts = (data.shifts || []).map(function(s) {
        var user = users[s.user_id] || {};
        var loc = locations[s.location_id] || {};
        var pos = positions[s.position_id] || {};
        return {
          id: s.id,
          employee: ((user.first_name || "") + " " + (user.last_name || "")).trim() || "Open Shift",
          user_id: s.user_id,
          start_time: s.start_time,
          end_time: s.end_time,
          location: loc.name || "",
          location_id: s.location_id,
          position: pos.name || "",
          position_id: s.position_id,
          notes: s.notes || "",
          is_open: s.is_open || false,
        };
      });

      return jsonResponse({
        success: true,
        shifts: shifts,
        users: users,
        locations: locations,
        positions: positions,
      });
    }

    // ─── USERS ───
    if (action === "users") {
      var data = await wiwFetch("/users", token);
      return jsonResponse({ success: true, users: data.users || [] });
    }

    // ─── LOCATIONS ───
    if (action === "locations") {
      var data = await wiwFetch("/locations", token);
      return jsonResponse({ success: true, locations: data.locations || [] });
    }

    // ─── POSITIONS ───
    if (action === "positions") {
      var data = await wiwFetch("/positions", token);
      return jsonResponse({ success: true, positions: data.positions || [] });
    }

    return jsonResponse({ success: false, error: "Unknown action: " + action });

  } catch (e) {
    console.error("[wheniwork] Error:", e.message);
    return jsonResponse({ success: false, error: e.message });
  }
}

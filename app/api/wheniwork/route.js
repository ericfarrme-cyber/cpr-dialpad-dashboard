import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  var url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

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
    console.log("[wheniwork] Attempting login with key:", key.substring(0, 8) + "...", "email:", email);
    var res = await fetch(WIW_LOGIN, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "W-Key": key,
      },
      body: JSON.stringify({ email: email, password: password }),
    });
    console.log("[wheniwork] Login response status:", res.status);
    var json = await res.json();
    console.log("[wheniwork] Login response keys:", Object.keys(json));
    if (json.login && json.login.token) {
      console.log("[wheniwork] Login successful, got token");
      return json.login.token;
    }
    // Some WIW responses have token at top level
    if (json.token) {
      console.log("[wheniwork] Got token at top level");
      return json.token;
    }
    console.error("[wheniwork] Login failed:", JSON.stringify(json).substring(0, 500));
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
    var key = process.env.WHENIWORK_KEY;
    var email = process.env.WHENIWORK_EMAIL;
    var password = process.env.WHENIWORK_PASSWORD;
    var directToken = process.env.WHENIWORK_TOKEN;

    if (!directToken && (!key || !email || !password)) {
      return jsonResponse({
        success: false,
        authenticated: false,
        message: "WhenIWork not configured. Set WHENIWORK_TOKEN or WHENIWORK_KEY + WHENIWORK_EMAIL + WHENIWORK_PASSWORD in Vercel env vars.",
      });
    }

    // Try to get token and show detailed error if it fails
    try {
      var token = await getToken();
      if (!token) {
        return jsonResponse({
          success: false,
          authenticated: false,
          message: "Login failed — credentials may be incorrect. Check WHENIWORK_KEY, WHENIWORK_EMAIL, and WHENIWORK_PASSWORD.",
        });
      }
      // Verify token works by fetching locations
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
        message: "Auth error: " + e.message,
      });
    }
  }

  // All other actions need auth
  var token = await getToken();
  if (!token) return jsonResponse({ success: false, error: "Not authenticated" });

  try {
    // ─── TODAY'S SHIFTS ───
    if (action === "today") {
      // Use Eastern time for "today" since stores are in Indiana
      var now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
      var today = searchParams.get("date") || fmtDate(now);
      var tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      var data = await wiwFetch("/shifts?start=" + today + "&end=" + fmtDate(tomorrow) + "&include_objects=true", token);

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

    // ─── SYNC SHIFTS TO SUPABASE ───
    if (action === "sync") {
      var syncDays = parseInt(searchParams.get("days")) || 30;
      var now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
      var syncStart = searchParams.get("start") || fmtDate(new Date(now.getTime() - syncDays * 86400000));
      var syncEnd = searchParams.get("end") || fmtDate(new Date(now.getTime() + 7 * 86400000));

      console.log("[wheniwork] Syncing shifts from " + syncStart + " to " + syncEnd);
      var data = await wiwFetch("/shifts?start=" + syncStart + "&end=" + syncEnd + "&include_objects=true", token);

      var users = {};
      (data.users || []).forEach(function(u) { users[u.id] = u; });
      var locations = {};
      (data.locations || []).forEach(function(l) { locations[l.id] = l; });
      var positions = {};
      (data.positions || []).forEach(function(p) { positions[p.id] = p; });

      var rows = (data.shifts || []).filter(function(s) { return !s.is_open && s.user_id; }).map(function(s) {
        var user = users[s.user_id] || {};
        var loc = locations[s.location_id] || {};
        var pos = positions[s.position_id] || {};
        var empName = ((user.first_name || "") + " " + (user.last_name || "")).trim() || "Unknown";
        var locName = (loc.name || "").toLowerCase();
        var store = locName.includes("fishers") ? "fishers" : locName.includes("bloomington") ? "bloomington" : locName.includes("indianapolis") || locName.includes("indy") || locName.includes("downtown") ? "indianapolis" : "unknown";
        var startDt = new Date(s.start_time);
        var endDt = new Date(s.end_time);
        var hours = Math.round((endDt - startDt) / (1000 * 60 * 60) * 100) / 100;
        var dateStr = s.start_time ? s.start_time.split("T")[0] || fmtDate(startDt) : fmtDate(startDt);

        return {
          shift_id: String(s.id),
          employee_name: empName,
          user_id: String(s.user_id),
          store: store,
          location_name: loc.name || "",
          position: pos.name || "",
          start_time: s.start_time,
          end_time: s.end_time,
          hours: hours,
          date: dateStr,
          notes: s.notes || "",
        };
      });

      // Upsert in batches of 50
      var inserted = 0, updated = 0, errors = 0;
      for (var bi = 0; bi < rows.length; bi += 50) {
        var batch = rows.slice(bi, bi + 50);
        var { error } = await getSupabase().from("employee_shifts").upsert(batch, { onConflict: "shift_id" });
        if (error) {
          console.error("[wheniwork] Upsert error:", error.message);
          errors += batch.length;
        } else {
          inserted += batch.length;
        }
      }

      // ─── ORPHAN CLEANUP ───
      // WhenIWork sometimes DELETES a shift and RECREATES it with a new
      // shift_id (e.g. on a position change or schedule edit). The upsert
      // above (onConflict: shift_id) can't match the old row, so it inserts a
      // NEW row and leaves the OLD one orphaned — producing two rows for the
      // same (user_id, date) and inflating hours.
      //
      // Fix: WhenIWork is the source of truth for the synced window. For every
      // (user_id, date) WhenIWork returned, the ONLY valid shift_id(s) are the
      // ones in this pull. Delete any stored row for those same (user_id, date)
      // keys whose shift_id is NOT in the current pull.
      //
      // Scoped strictly to (user_id, date) pairs present in this pull, so
      // historical shifts outside the window are never touched.
      var orphansDeleted = 0;
      try {
        // Map user_id -> Set(dates) and (user_id|date) -> Set(valid shift_ids)
        var validByKey = {};   // "user_id|date" -> [shift_id,...]
        var datesByUser = {};  // user_id -> Set(date)
        rows.forEach(function(r) {
          var key = r.user_id + "|" + r.date;
          if (!validByKey[key]) validByKey[key] = [];
          validByKey[key].push(r.shift_id);
          if (!datesByUser[r.user_id]) datesByUser[r.user_id] = {};
          datesByUser[r.user_id][r.date] = true;
        });

        var userIds = Object.keys(datesByUser);
        if (userIds.length > 0) {
          // Pull stored rows for these users within the synced window only.
          var { data: stored, error: selErr } = await getSupabase()
            .from("employee_shifts")
            .select("id, shift_id, user_id, date")
            .in("user_id", userIds)
            .gte("date", syncStart)
            .lte("date", syncEnd)
            .limit(5000);

          if (selErr) {
            console.error("[wheniwork] Orphan select error:", selErr.message);
          } else {
            var toDelete = [];
            (stored || []).forEach(function(row) {
              var key = row.user_id + "|" + row.date;
              var valid = validByKey[key];
              // Only consider (user_id, date) pairs WhenIWork actually returned.
              // If WhenIWork returned this day for this user but NOT this
              // shift_id, the stored row is an orphan from a recreated shift.
              if (valid && valid.indexOf(String(row.shift_id)) === -1) {
                toDelete.push(row.id);
              }
            });

            for (var di = 0; di < toDelete.length; di += 50) {
              var delBatch = toDelete.slice(di, di + 50);
              var { error: delErr } = await getSupabase()
                .from("employee_shifts")
                .delete()
                .in("id", delBatch);
              if (delErr) {
                console.error("[wheniwork] Orphan delete error:", delErr.message);
              } else {
                orphansDeleted += delBatch.length;
              }
            }
            if (orphansDeleted > 0) {
              console.log("[wheniwork] Removed " + orphansDeleted + " orphaned duplicate shift(s)");
            }
          }
        }
      } catch (cleanupErr) {
        // Never let cleanup failure break the sync result.
        console.error("[wheniwork] Orphan cleanup exception:", cleanupErr.message);
      }

      console.log("[wheniwork] Synced " + inserted + " shifts (" + errors + " errors, " + orphansDeleted + " orphans removed)");
      return jsonResponse({
        success: true,
        synced: inserted,
        errors: errors,
        orphans_removed: orphansDeleted,
        total_from_wiw: rows.length,
        date_range: { start: syncStart, end: syncEnd },
      });
    }

    // ─── QUERY STORED SHIFTS FROM SUPABASE ───
    if (action === "stored-shifts") {
      var start = searchParams.get("start");
      var end = searchParams.get("end");
      var storeFilter = searchParams.get("store");
      var employee = searchParams.get("employee");

      var query = getSupabase().from("employee_shifts").select("*").order("date", { ascending: true }).order("start_time", { ascending: true });
      if (start) query = query.gte("date", start);
      if (end) query = query.lte("date", end);
      if (storeFilter) query = query.eq("store", storeFilter);
      if (employee) query = query.ilike("employee_name", "%" + employee + "%");
      query = query.limit(2000);

      var { data: shifts, error } = await query;
      if (error) return jsonResponse({ success: false, error: error.message });

      // ─── DEFENSIVE DEDUP ───
      // One shift per employee per day is the rule. If any duplicate rows
      // still exist (e.g. a sync ran before the orphan-cleanup fix shipped),
      // collapse them here so displayed hours are always correct: keep the
      // row with the latest synced_at for each (user_id, date).
      var bestByKey = {};
      (shifts || []).forEach(function(s) {
        var key = s.user_id + "|" + s.date;
        var prev = bestByKey[key];
        if (!prev) {
          bestByKey[key] = s;
        } else {
          var a = s.synced_at || "";
          var b = prev.synced_at || "";
          // Latest synced_at wins; tie-break on higher id.
          if (a > b || (a === b && (s.id || 0) > (prev.id || 0))) {
            bestByKey[key] = s;
          }
        }
      });
      var dedupedShifts = Object.keys(bestByKey).map(function(k) { return bestByKey[k]; });
      // Preserve original ordering (date asc, then start_time asc)
      dedupedShifts.sort(function(a, b) {
        if (a.date < b.date) return -1;
        if (a.date > b.date) return 1;
        return (a.start_time || "") < (b.start_time || "") ? -1 : 1;
      });
      shifts = dedupedShifts;

      // Also compute summary stats
      var byEmployee = {};
      var byStore = { fishers: 0, bloomington: 0, indianapolis: 0 };
      (shifts || []).forEach(function(s) {
        var name = s.employee_name;
        if (!byEmployee[name]) byEmployee[name] = { name: name, fishers: 0, bloomington: 0, indianapolis: 0, total: 0 };
        byEmployee[name][s.store] = (byEmployee[name][s.store] || 0) + parseFloat(s.hours);
        byEmployee[name].total += parseFloat(s.hours);
        byStore[s.store] = (byStore[s.store] || 0) + parseFloat(s.hours);
      });

      // Round hours
      Object.values(byEmployee).forEach(function(e) {
        e.fishers = Math.round(e.fishers * 100) / 100;
        e.bloomington = Math.round(e.bloomington * 100) / 100;
        e.indianapolis = Math.round(e.indianapolis * 100) / 100;
        e.total = Math.round(e.total * 100) / 100;
      });

      return jsonResponse({
        success: true,
        shifts: shifts || [],
        count: (shifts || []).length,
        summary: {
          byEmployee: Object.values(byEmployee).sort(function(a, b) { return b.total - a.total; }),
          byStore: byStore,
          totalHours: Math.round((byStore.fishers + byStore.bloomington + byStore.indianapolis) * 100) / 100,
        },
      });
    }

    return jsonResponse({ success: false, error: "Unknown action: " + action });

  } catch (e) {
    console.error("[wheniwork] Error:", e.message);
    return jsonResponse({ success: false, error: e.message });
  }
}

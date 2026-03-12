import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/dialpad/roster — list employees, resolve names
export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const store = searchParams.get("store");

  // Return the roster
  if (action === "list" || !action) {
    let query = supabase.from("employee_roster").select("*").eq("active", true).order("store").order("name");
    if (store && store !== "all") query = query.eq("store", store);
    const { data, error } = await query;
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, employees: data || [] });
  }

  // Return unmatched transcript names (names in audit_results not in any roster alias)
  if (action === "unmatched") {
    // Get all roster aliases
    const { data: roster } = await supabase.from("employee_roster").select("name, store, aliases").eq("active", true);
    // Build two maps: store-specific and global (for multi-store employees)
    const aliasMapByStore = {};
    const aliasMapGlobal = {};
    (roster || []).forEach(r => {
      const allNames = [r.name.toLowerCase(), ...(r.aliases || []).map(a => a.toLowerCase())];
      allNames.forEach(a => {
        aliasMapByStore[`${a}__${r.store}`] = r.name;
        aliasMapGlobal[a] = r.name; // global match regardless of store
      });
    });

    // Get distinct employee names from audits
    const { data: audits } = await supabase
      .from("audit_results")
      .select("employee, store")
      .not("employee", "is", null)
      .neq("employee", "Unknown");

    const uniqueNames = {};
    (audits || []).forEach(a => {
      const key = `${a.employee}__${a.store}`;
      if (!uniqueNames[key]) uniqueNames[key] = { name: a.employee, store: a.store, count: 0 };
      uniqueNames[key].count++;
    });

    // Find unmatched — check both store-specific and global
    const unmatched = Object.values(uniqueNames).filter(u => {
      const storeKey = `${u.name.toLowerCase()}__${u.store}`;
      if (aliasMapByStore[storeKey]) return false; // matched by store
      if (aliasMapGlobal[u.name.toLowerCase()]) return false; // matched globally
      return true;
    }).sort((a, b) => b.count - a.count);

    return NextResponse.json({ success: true, unmatched });
  }

  // Resolve a transcript name to a real name
  if (action === "resolve") {
    const name = searchParams.get("name");
    const nameStore = searchParams.get("nameStore");
    if (!name) return NextResponse.json({ success: false, error: "name required" });

    const { data: roster } = await supabase.from("employee_roster").select("*").eq("active", true);
    const resolved = resolveEmployeeName(name, nameStore, roster || []);
    return NextResponse.json({ success: true, resolved });
  }

  // Get consolidated employee performance (using roster to merge aliases)
  if (action === "consolidated") {
    const { data: roster } = await supabase.from("employee_roster").select("*").eq("active", true);
    let auditQuery = supabase.from("audit_results").select("*")
      .not("employee", "is", null).neq("employee", "Unknown")
      .gte("date_started", new Date(Date.now() - 30 * 86400000).toISOString());
    if (store && store !== "all") auditQuery = auditQuery.eq("store", store);
    const { data: audits } = await auditQuery;

    const consolidated = consolidateByRoster(roster || [], audits || []);
    return NextResponse.json({ success: true, employees: consolidated });
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

// POST — add/update/delete roster entries
export async function POST(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });
  const body = await request.json();
  const { action } = body;

  if (action === "add") {
    const { name, store, aliases, role } = body;
    if (!name || !store) return NextResponse.json({ success: false, error: "name and store required" });
    const aliasArr = (aliases || "").split(",").map(a => a.trim()).filter(Boolean);
    const { data, error } = await supabase.from("employee_roster")
      .upsert({ name, store, aliases: aliasArr, role: role || "Technician" }, { onConflict: "name,store" })
      .select();
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, employee: data?.[0] });
  }

  if (action === "update") {
    const { id, name, aliases, role, active } = body;
    if (!id) return NextResponse.json({ success: false, error: "id required" });
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (aliases !== undefined) updates.aliases = Array.isArray(aliases) ? aliases : aliases.split(",").map(a => a.trim()).filter(Boolean);
    if (role !== undefined) updates.role = role;
    if (active !== undefined) updates.active = active;
    const { data, error } = await supabase.from("employee_roster").update(updates).eq("id", id).select();
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true, employee: data?.[0] });
  }

  if (action === "delete") {
    const { id } = body;
    if (!id) return NextResponse.json({ success: false, error: "id required" });
    const { error } = await supabase.from("employee_roster").delete().eq("id", id);
    if (error) return NextResponse.json({ success: false, error: error.message });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: "Invalid action" });
}

// ── Helper: resolve a transcript name to a roster entry ──
function resolveEmployeeName(transcriptName, store, roster) {
  const lower = transcriptName.toLowerCase().trim();

  // Exact match on name or alias
  for (const emp of roster) {
    if (store && emp.store !== store) continue;
    if (emp.name.toLowerCase() === lower) return emp.name;
    if ((emp.aliases || []).some(a => a.toLowerCase() === lower)) return emp.name;
  }

  // Prefix match (transcript often truncates: "Ma" -> "Mahmoud", "Lu" -> "Luke")
  for (const emp of roster) {
    if (store && emp.store !== store) continue;
    if (emp.name.toLowerCase().startsWith(lower) && lower.length >= 2) return emp.name;
    if ((emp.aliases || []).some(a => a.toLowerCase().startsWith(lower) && lower.length >= 2)) return emp.name;
  }

  // Reverse prefix (roster name is prefix of transcript: "Luke" -> "Luke S")
  for (const emp of roster) {
    if (store && emp.store !== store) continue;
    if (lower.startsWith(emp.name.toLowerCase())) return emp.name;
  }

  return null; // No match
}

// ── Helper: consolidate audit data using roster aliases ──
// Groups by employee NAME only (not per-store) so multi-store employees merge
function consolidateByRoster(roster, audits) {
  // Build resolution map — try matching with store first, then without
  const resolveCache = {};
  function resolve(name, store) {
    const key = `${name}__${store}`;
    if (resolveCache[key] !== undefined) return resolveCache[key];
    // Try store-specific match first
    let resolved = resolveEmployeeName(name, store, roster);
    // If no match, try matching against all stores (employee works at multiple locations)
    if (!resolved) resolved = resolveEmployeeName(name, null, roster);
    resolveCache[key] = resolved || name;
    return resolveCache[key];
  }

  // Group audits by resolved name ONLY (merge across stores)
  const groups = {};
  audits.forEach(a => {
    const realName = resolve(a.employee, a.store);
    const key = realName; // group by name only, not name+store
    if (!groups[key]) {
      const rosterEntry = roster.find(r => r.name === realName);
      groups[key] = { name: realName, stores: new Set(), store_names: new Set(), role: rosterEntry?.role || "—", audits: [] };
    }
    groups[key].stores.add(a.store);
    if (a.store_name) groups[key].store_names.add(a.store_name);
    groups[key].audits.push(a);
  });

  // Compute stats per consolidated employee
  return Object.values(groups).map(g => {
    const all = g.audits;
    const total = all.length;
    const opp = all.filter(a => a.call_type === "opportunity");
    const curr = all.filter(a => a.call_type === "current_customer");
    const avg = (arr, field) => arr.length > 0 ? parseFloat(((arr.filter(a => a[field]).length / arr.length) * 100).toFixed(1)) : 0;
    const storesArr = [...g.stores];
    return {
      employee: g.name,
      store: storesArr[0] || "",  // primary store
      stores: storesArr,           // all stores
      store_name: [...g.store_names].join(", "),
      role: g.role,
      total_calls: total,
      avg_score: parseFloat((all.reduce((s, a) => s + parseFloat(a.score || 0), 0) / total).toFixed(2)),
      opportunity_calls: opp.length,
      current_calls: curr.length,
      opp_avg_score: opp.length > 0 ? parseFloat((opp.reduce((s, a) => s + parseFloat(a.score || 0), 0) / opp.length).toFixed(2)) : null,
      curr_avg_score: curr.length > 0 ? parseFloat((curr.reduce((s, a) => s + parseFloat(a.score || 0), 0) / curr.length).toFixed(2)) : null,
      appt_rate: avg(all, "appt_offered"),
      discount_rate: avg(all, "discount_mentioned"),
      warranty_rate: avg(all, "warranty_mentioned"),
      turnaround_rate: avg(all, "faster_turnaround"),
      status_rate: avg(all, "status_update_given"),
      eta_rate: avg(all, "eta_communicated"),
      tone_rate: avg(all, "professional_tone"),
      next_steps_rate: avg(all, "next_steps_explained"),
      // Per-store breakdown
      by_store: storesArr.reduce((acc, s) => {
        const sa = all.filter(a => a.store === s);
        acc[s] = { calls: sa.length, avg_score: sa.length > 0 ? parseFloat((sa.reduce((sum, a) => sum + parseFloat(a.score || 0), 0) / sa.length).toFixed(2)) : 0 };
        return acc;
      }, {}),
      recent_audits: all.sort((a, b) => new Date(b.date_started) - new Date(a.date_started)).slice(0, 5),
    };
  }).sort((a, b) => b.avg_score - a.avg_score);
}

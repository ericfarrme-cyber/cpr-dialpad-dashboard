import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn("Supabase credentials not configured — persistence disabled");
}

export const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// ══════════════════════════════════════════
// AUDIT FUNCTIONS
// ══════════════════════════════════════════

export async function saveAuditResult(audit) {
  if (!supabase) return null;
  const row = {
    call_id: audit.call_id,
    date_started: audit.date,
    store: audit.store,
    store_name: audit.store_name || audit.store,
    employee: audit.employee || "Unknown",
    phone: audit.phone || "",
    direction: audit.direction || "inbound",
    talk_duration: audit.talk_duration || null,
    inquiry: audit.inquiry || "",
    outcome: audit.outcome || "",
    score: audit.score || 0,
    max_score: audit.max_score || 4.0,
    appt_offered: audit.criteria?.appointment_offered?.pass || false,
    appt_notes: audit.criteria?.appointment_offered?.notes || "",
    discount_mentioned: audit.criteria?.discount_mentioned?.pass || false,
    discount_notes: audit.criteria?.discount_mentioned?.notes || "",
    warranty_mentioned: audit.criteria?.warranty_mentioned?.pass || false,
    warranty_notes: audit.criteria?.warranty_mentioned?.notes || "",
    faster_turnaround: audit.criteria?.faster_turnaround?.pass || false,
    turnaround_notes: audit.criteria?.faster_turnaround?.notes || "",
    transcript_preview: audit.transcript_preview || "",
  };

  const { data, error } = await supabase
    .from("audit_results")
    .upsert(row, { onConflict: "call_id" })
    .select();

  if (error) console.error("Supabase audit save error:", error);
  return data?.[0] || null;
}

export async function getAuditResults({ store, employee, limit = 100, daysBack = 30 } = {}) {
  if (!supabase) return [];
  let query = supabase
    .from("audit_results")
    .select("*")
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString())
    .order("date_started", { ascending: false })
    .limit(limit);

  if (store && store !== "all") query = query.eq("store", store);
  if (employee) query = query.ilike("employee", `%${employee}%`);

  const { data, error } = await query;
  if (error) console.error("Supabase audit read error:", error);
  return data || [];
}

export async function getEmployeePerformance(store) {
  if (!supabase) return [];
  let query = supabase.from("employee_performance").select("*");
  if (store && store !== "all") query = query.eq("store", store);
  const { data, error } = await query;
  if (error) console.error("Supabase employee query error:", error);
  return data || [];
}

export async function getStorePerformance() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("store_performance").select("*");
  if (error) console.error("Supabase store query error:", error);
  return data || [];
}

export async function isCallAudited(callId) {
  if (!supabase) return false;
  const { count } = await supabase
    .from("audit_results")
    .select("*", { count: "exact", head: true })
    .eq("call_id", callId);
  return count > 0;
}

export async function getSyncState(store) {
  if (!supabase) return null;
  const { data } = await supabase.from("audit_sync_state").select("*").eq("store", store).single();
  return data;
}

export async function updateSyncState(store, lastCallId, callsProcessed) {
  if (!supabase) return;
  await supabase.from("audit_sync_state").upsert({
    store,
    last_call_id: lastCallId,
    last_run_at: new Date().toISOString(),
    calls_processed: callsProcessed,
  });
}

// ══════════════════════════════════════════
// CALL RECORD FUNCTIONS
// ══════════════════════════════════════════

export async function saveCallRecords(records) {
  if (!supabase || !records.length) return { saved: 0, errors: 0 };

  const rows = records.map(r => {
    const cats = (r.categories || "").toLowerCase();
    return {
      call_id: r.call_id,
      date_started: r.date_started,
      store: r._storeKey,
      store_name: r.name || "",
      direction: r.direction || "",
      categories: r.categories || "",
      target_type: r.target_type || "",
      external_number: r.external_number || "",
      availability: r.availability || "",
      was_recorded: r.was_recorded || "",
      ringing_duration: r.ringing_duration ? parseFloat(r.ringing_duration) : null,
      talk_duration: r.talk_duration ? parseFloat(r.talk_duration) : null,
      is_answered: cats.includes("answered"),
      is_missed: cats.includes("missed") || cats.includes("unanswered"),
      is_voicemail: cats.includes("voicemail"),
      is_abandoned: cats.includes("abandoned"),
    };
  });

  // Upsert in batches of 500
  let saved = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { data, error } = await supabase
      .from("call_records")
      .upsert(batch, { onConflict: "call_id" });

    if (error) {
      console.error("Supabase call save error:", error);
      errors += batch.length;
    } else {
      saved += batch.length;
    }
  }

  return { saved, errors };
}

// Get daily call volume for the dashboard charts
export async function getDailyCallVolume(daysBack = 30) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("daily_call_volume")
    .select("*")
    .gte("call_date", new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0])
    .order("call_date", { ascending: true });

  if (error) console.error("Supabase daily volume error:", error);
  return data || [];
}

// Get hourly missed calls
export async function getHourlyMissed(daysBack = 30) {
  if (!supabase) return [];
  // Use raw query since the view aggregates all time — we'll filter in JS
  const { data, error } = await supabase
    .from("call_records")
    .select("date_started, store")
    .eq("target_type", "department")
    .eq("direction", "inbound")
    .eq("is_missed", true)
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString());

  if (error) console.error("Supabase hourly missed error:", error);
  return data || [];
}

// Get DOW missed calls
export async function getDOWMissed(daysBack = 30) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("call_records")
    .select("date_started, store")
    .eq("target_type", "department")
    .eq("direction", "inbound")
    .eq("is_missed", true)
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString());

  if (error) console.error("Supabase DOW missed error:", error);
  return data || [];
}

// Get callback data — missed calls + outbound calls to same number
export async function getCallbackData(daysBack = 30) {
  if (!supabase) return [];
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();

  // Get missed inbound calls
  const { data: missed, error: e1 } = await supabase
    .from("call_records")
    .select("call_id, date_started, store, external_number")
    .eq("target_type", "department")
    .eq("direction", "inbound")
    .eq("is_missed", true)
    .gte("date_started", since);

  // Get outbound calls
  const { data: outbound, error: e2 } = await supabase
    .from("call_records")
    .select("date_started, store, external_number")
    .eq("direction", "outbound")
    .gte("date_started", since);

  if (e1) console.error("Callback missed error:", e1);
  if (e2) console.error("Callback outbound error:", e2);

  return { missed: missed || [], outbound: outbound || [] };
}

// Get all call records for a time period (for problem call analysis etc)
export async function getCallRecords({ store, daysBack = 7, limit = 2000 } = {}) {
  if (!supabase) return [];
  let query = supabase
    .from("call_records")
    .select("*")
    .eq("target_type", "department")
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString())
    .order("date_started", { ascending: false })
    .limit(limit);

  if (store && store !== "all") query = query.eq("store", store);
  const { data, error } = await query;
  if (error) console.error("Supabase call records error:", error);
  return data || [];
}

// Update call sync state
export async function updateCallSyncState(store, recordsSynced) {
  if (!supabase) return;
  await supabase.from("call_sync_state").upsert({
    store,
    last_sync_at: new Date().toISOString(),
    records_synced: recordsSynced,
  });
}

// Get last sync time
export async function getCallSyncState() {
  if (!supabase) return [];
  const { data } = await supabase.from("call_sync_state").select("*");
  return data || [];
}

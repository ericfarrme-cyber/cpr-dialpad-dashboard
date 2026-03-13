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
  const isOpp = (audit.call_type || "opportunity") === "opportunity";
  const row = {
    call_id: audit.call_id,
    date_started: audit.date,
    store: audit.store,
    store_name: audit.store_name || audit.store,
    call_type: audit.call_type || "opportunity",
    employee: audit.employee || "Unknown",
    customer_name: audit.customer_name || "Unknown",
    device_type: audit.device_type || "Not mentioned",
    phone: audit.phone || "",
    direction: audit.direction || "inbound",
    talk_duration: audit.talk_duration || null,
    inquiry: audit.inquiry || "",
    outcome: audit.outcome || "",
    score: audit.score || 0,
    max_score: audit.max_score || 4.0,
    confidence: audit.confidence || 0,
    confidence_reason: audit.confidence_reason || "",
    excluded: audit.excluded || false,
    exclude_reason: audit.exclude_reason || "",
    // Opportunity criteria
    appt_offered: audit.criteria?.appointment_offered?.pass || false,
    appt_notes: audit.criteria?.appointment_offered?.notes || "",
    discount_mentioned: audit.criteria?.discount_mentioned?.pass || false,
    discount_notes: audit.criteria?.discount_mentioned?.notes || "",
    warranty_mentioned: audit.criteria?.warranty_mentioned?.pass || false,
    warranty_notes: audit.criteria?.warranty_mentioned?.notes || "",
    faster_turnaround: audit.criteria?.faster_turnaround?.pass || false,
    turnaround_notes: audit.criteria?.faster_turnaround?.notes || "",
    // Current customer criteria
    status_update_given: audit.criteria?.status_update_given?.pass || false,
    status_notes: audit.criteria?.status_update_given?.notes || "",
    eta_communicated: audit.criteria?.eta_communicated?.pass || false,
    eta_notes: audit.criteria?.eta_communicated?.notes || "",
    professional_tone: audit.criteria?.professional_tone?.pass || false,
    tone_notes: audit.criteria?.professional_tone?.notes || "",
    next_steps_explained: audit.criteria?.next_steps_explained?.pass || false,
    next_steps_notes: audit.criteria?.next_steps_explained?.notes || "",
    transcript_preview: audit.transcript_preview || "",
  };

  const { data, error } = await supabase
    .from("audit_results")
    .upsert(row, { onConflict: "call_id" })
    .select();

  if (error) console.error("Supabase audit save error:", error);
  return data?.[0] || null;
}

export async function getAuditResults({ store, employee, callType, limit = 200, daysBack = 30 } = {}) {
  if (!supabase) return [];
  let query = supabase
    .from("audit_results")
    .select("*")
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString())
    .order("date_started", { ascending: false })
    .limit(limit);

  if (store && store !== "all") query = query.eq("store", store);
  if (employee) query = query.ilike("employee", `%${employee}%`);
  if (callType && callType !== "all") query = query.eq("call_type", callType);

  const { data, error } = await query;
  if (error) console.error("Supabase audit read error:", error);
  return data || [];
}

export async function getEmployeePerformance(store) {
  if (!supabase) return [];
  let query = supabase.from("employee_performance").select("*");
  if (store && store !== "all") query = query.eq("store", store);
  const { data, error } = await query;
  if (error) console.error("Supabase employee view error:", error);
  return data || [];
}

// Fallback: compute employee stats directly from audit_results
export async function getEmployeeStatsFromAudits(store) {
  if (!supabase) return [];
  let query = supabase
    .from("audit_results")
    .select("employee, store, store_name, score, call_type, appt_offered, discount_mentioned, warranty_mentioned, faster_turnaround, status_update_given, eta_communicated, professional_tone, next_steps_explained, date_started")
    .not("employee", "is", null)
    .neq("employee", "Unknown")
    .eq("excluded", false)
    .neq("call_type", "non_scorable");

  if (store && store !== "all") query = query.eq("store", store);
  const { data, error } = await query;
  if (error) { console.error("Supabase employee fallback error:", error); return []; }
  if (!data || data.length === 0) return [];

  // Group by employee + store
  const groups = {};
  data.forEach(row => {
    const key = `${row.employee}__${row.store}`;
    if (!groups[key]) groups[key] = { employee: row.employee, store: row.store, store_name: row.store_name, rows: [] };
    groups[key].rows.push(row);
  });

  return Object.values(groups).map(g => {
    const r = g.rows;
    const total = r.length;
    const avg = (arr, fn) => total > 0 ? parseFloat(((arr.filter(fn).length / total) * 100).toFixed(1)) : 0;
    return {
      employee: g.employee,
      store: g.store,
      store_name: g.store_name,
      total_calls: total,
      avg_score: parseFloat((r.reduce((s, x) => s + parseFloat(x.score || 0), 0) / total).toFixed(2)),
      opportunity_calls: r.filter(x => x.call_type === "opportunity").length,
      current_calls: r.filter(x => x.call_type === "current_customer").length,
      appt_rate: avg(r, x => x.appt_offered),
      discount_rate: avg(r, x => x.discount_mentioned),
      warranty_rate: avg(r, x => x.warranty_mentioned),
      turnaround_rate: avg(r, x => x.faster_turnaround),
      status_rate: avg(r, x => x.status_update_given),
      eta_rate: avg(r, x => x.eta_communicated),
      tone_rate: avg(r, x => x.professional_tone),
      next_steps_rate: avg(r, x => x.next_steps_explained),
      first_audit: r.reduce((min, x) => !min || x.date_started < min ? x.date_started : min, null),
      last_audit: r.reduce((max, x) => !max || x.date_started > max ? x.date_started : max, null),
    };
  }).sort((a, b) => b.avg_score - a.avg_score);
}

export async function getStorePerformance() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("store_performance").select("*");
  if (error) console.error("Supabase store query error:", error);
  return data || [];
}

export async function isCallAudited(callId) {
  if (!supabase) return false;
  const { count } = await supabase.from("audit_results").select("*", { count: "exact", head: true }).eq("call_id", callId);
  return count > 0;
}

export async function getSyncState(store) {
  if (!supabase) return null;
  const { data } = await supabase.from("audit_sync_state").select("*").eq("store", store).single();
  return data;
}

export async function updateSyncState(store, lastCallId, callsProcessed) {
  if (!supabase) return;
  await supabase.from("audit_sync_state").upsert({ store, last_call_id: lastCallId, last_run_at: new Date().toISOString(), calls_processed: callsProcessed });
}

// ══════════════════════════════════════════
// CALL RECORD FUNCTIONS
// ══════════════════════════════════════════

export async function saveCallRecords(records) {
  if (!supabase || !records.length) return { saved: 0, errors: 0 };
  const rows = records.map(r => {
    const cats = (r.categories || "").toLowerCase();
    return {
      call_id: r.call_id, date_started: r.date_started, store: r._storeKey, store_name: r.name || "",
      direction: r.direction || "", categories: r.categories || "", target_type: r.target_type || "",
      external_number: r.external_number || "", availability: r.availability || "", was_recorded: r.was_recorded || "",
      ringing_duration: r.ringing_duration ? parseFloat(r.ringing_duration) : null,
      talk_duration: r.talk_duration ? parseFloat(r.talk_duration) : null,
      is_answered: cats.includes("answered"), is_missed: cats.includes("missed") || cats.includes("unanswered"),
      is_voicemail: cats.includes("voicemail"), is_abandoned: cats.includes("abandoned"),
    };
  });
  let saved = 0, errors = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase.from("call_records").upsert(batch, { onConflict: "call_id" });
    if (error) { console.error("Call save error:", error); errors += batch.length; } else { saved += batch.length; }
  }
  return { saved, errors };
}

export async function getDailyCallVolume(daysBack = 30) {
  if (!supabase) return [];
  const { data, error } = await supabase.from("daily_call_volume").select("*")
    .gte("call_date", new Date(Date.now() - daysBack * 86400000).toISOString().split("T")[0])
    .order("call_date", { ascending: true });
  if (error) console.error("Daily volume error:", error);
  return data || [];
}

export async function getHourlyMissed(daysBack = 30) {
  if (!supabase) return [];
  const { data, error } = await supabase.from("call_records").select("date_started, store")
    .eq("target_type", "department").eq("direction", "inbound").eq("is_missed", true)
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString());
  if (error) console.error("Hourly missed error:", error);
  return data || [];
}

export async function getDOWMissed(daysBack = 30) {
  if (!supabase) return [];
  const { data, error } = await supabase.from("call_records").select("date_started, store")
    .eq("target_type", "department").eq("direction", "inbound").eq("is_missed", true)
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString());
  if (error) console.error("DOW missed error:", error);
  return data || [];
}

export async function getCallbackData(daysBack = 30) {
  if (!supabase) return [];
  const since = new Date(Date.now() - daysBack * 86400000).toISOString();
  const { data: missed, error: e1 } = await supabase.from("call_records").select("call_id, date_started, store, external_number")
    .eq("target_type", "department").eq("direction", "inbound").eq("is_missed", true).gte("date_started", since);
  const { data: outbound, error: e2 } = await supabase.from("call_records").select("date_started, store, external_number")
    .eq("direction", "outbound").gte("date_started", since);
  if (e1) console.error("Callback missed error:", e1);
  if (e2) console.error("Callback outbound error:", e2);
  return { missed: missed || [], outbound: outbound || [] };
}

export async function getCallRecords({ store, daysBack = 7, limit = 2000 } = {}) {
  if (!supabase) return [];
  let query = supabase.from("call_records").select("*").eq("target_type", "department")
    .gte("date_started", new Date(Date.now() - daysBack * 86400000).toISOString())
    .order("date_started", { ascending: false }).limit(limit);
  if (store && store !== "all") query = query.eq("store", store);
  const { data, error } = await query;
  if (error) console.error("Call records error:", error);
  return data || [];
}

export async function updateCallSyncState(store, recordsSynced) {
  if (!supabase) return;
  await supabase.from("call_sync_state").upsert({ store, last_sync_at: new Date().toISOString(), records_synced: recordsSynced });
}

export async function getCallSyncState() {
  if (!supabase) return [];
  const { data } = await supabase.from("call_sync_state").select("*");
  return data || [];
}

// ══════════════════════════════════════════
// OVERRIDE & EXCLUSION FUNCTIONS
// ══════════════════════════════════════════

export async function overrideAudit(callId, { callType, score, notes, overrideBy }) {
  if (!supabase) return null;
  // First get the current values to preserve as originals
  const { data: current } = await supabase.from("audit_results").select("call_type, score").eq("call_id", callId).single();
  if (!current) return null;

  const updates = {
    manager_override: true,
    override_notes: notes || "",
    override_by: overrideBy || "manager",
    override_at: new Date().toISOString(),
    original_call_type: current.call_type,
    original_score: current.score,
  };

  if (callType) {
    updates.override_call_type = callType;
    updates.call_type = callType;
    // If reclassified to non_scorable, auto-exclude
    if (callType === "non_scorable") {
      updates.excluded = true;
      updates.exclude_reason = "Manager reclassified as non-scorable";
      updates.score = 0;
      updates.max_score = 0;
    }
  }
  if (score !== undefined && score !== null) {
    updates.override_score = score;
    updates.score = score;
  }

  const { data, error } = await supabase.from("audit_results").update(updates).eq("call_id", callId).select();
  if (error) console.error("Override error:", error);
  return data?.[0] || null;
}

export async function excludeAudit(callId, reason) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("audit_results").update({
    excluded: true,
    exclude_reason: reason || "Manually excluded",
  }).eq("call_id", callId).select();
  if (error) console.error("Exclude error:", error);
  return data?.[0] || null;
}

export async function reinstateAudit(callId) {
  if (!supabase) return null;
  const { data, error } = await supabase.from("audit_results").update({
    excluded: false,
    exclude_reason: "",
  }).eq("call_id", callId).select();
  if (error) console.error("Reinstate error:", error);
  return data?.[0] || null;
}

// Delete a single audit by call_id (for re-audit)
export async function deleteAudit(callId) {
  if (!supabase) return false;
  const { error } = await supabase.from("audit_results").delete().eq("call_id", callId);
  if (error) { console.error("Delete audit error:", error); return false; }
  return true;
}

// Delete all audits for an employee (with optional store filter)
export async function deleteAuditsByEmployee(employee, store) {
  if (!supabase) return 0;
  let query = supabase.from("audit_results").delete().eq("employee", employee);
  if (store) query = query.eq("store", store);
  const { data, error } = await query.select();
  if (error) { console.error("Delete by employee error:", error); return 0; }
  return data ? data.length : 0;
}

// Get all audited call_ids (for re-audit: clear and re-run)
export async function getAllAuditedCallIds() {
  if (!supabase) return [];
  const { data, error } = await supabase.from("audit_results").select("call_id");
  if (error) { console.error("Get all audited error:", error); return []; }
  return (data || []).map(function(r) { return r.call_id; });
}

// Clear all audits (for full re-audit)
export async function clearAllAudits() {
  if (!supabase) return false;
  const { error } = await supabase.from("audit_results").delete().neq("call_id", "");
  if (error) { console.error("Clear all audits error:", error); return false; }
  return true;
}

// Get low-confidence audits for review
export async function getLowConfidenceAudits(threshold, limit) {
  if (!supabase) return [];
  threshold = threshold || 70;
  limit = limit || 50;
  const { data, error } = await supabase.from("audit_results")
    .select("*")
    .lt("confidence", threshold)
    .eq("excluded", false)
    .neq("call_type", "non_scorable")
    .order("confidence", { ascending: true })
    .limit(limit);
  if (error) console.error("Low confidence query error:", error);
  return data || [];
}

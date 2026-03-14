import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { STORES } from "@/lib/constants";

var STORE_KEYS = Object.keys(STORES);

function clamp(v) { return Math.max(0, Math.min(100, v)); }

function cfg(configMap, key, fallback) {
  return configMap[key] !== undefined ? parseFloat(configMap[key]) : fallback;
}

export async function GET(request) {
  if (!supabase) return NextResponse.json({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var daysBack = parseInt(searchParams.get("days") || "30");
  var since = new Date(Date.now() - daysBack * 86400000).toISOString();

  // Get current period for sales
  var now = new Date();
  var period = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

  try {
    // Parallel fetch all data
    var [callRes, auditRes, phoneRes, otherRes, accyRes, cleanRes, vmRes, outboundRes, rosterRes, configRes, ticketRes] = await Promise.all([
      supabase.from("call_records").select("store, direction, is_answered, is_missed, is_voicemail, talk_duration, ringing_duration, date_started, external_number")
        .eq("target_type", "department").gte("date_started", since),
      supabase.from("audit_results").select("store, employee, score, max_score, call_type, excluded, appt_offered, warranty_mentioned, discount_mentioned, faster_turnaround, confidence")
        .eq("excluded", false).neq("call_type", "non_scorable").gte("date_started", since),
      supabase.from("repair_phone").select("*").eq("import_period", period),
      supabase.from("repair_other").select("*").eq("import_period", period),
      supabase.from("sales_accessory").select("*").eq("import_period", period),
      supabase.from("repair_cleaning").select("*").eq("import_period", period),
      supabase.from("call_records").select("store, date_started, external_number")
        .eq("target_type", "department").eq("direction", "inbound").eq("is_voicemail", true).gte("date_started", since),
      supabase.from("call_records").select("store, date_started, external_number")
        .eq("direction", "outbound").gte("date_started", since),
      supabase.from("employee_roster").select("name, store, aliases, role").eq("active", true),
      supabase.from("commission_config").select("config_key, config_value"),
      supabase.from("ticket_grades").select("store, employee_added, employee_repaired, overall_score, diagnostics_score, notes_score, payment_score, notes_outcome_documented, notes_customer_contacted"),
    ]);

    var calls = callRes.data || [];
    var audits = auditRes.data || [];
    var phones = phoneRes.data || [];
    var others = otherRes.data || [];
    var accys = accyRes.data || [];
    var cleans = cleanRes.data || [];
    var vms = vmRes.data || [];
    var outbound = outboundRes.data || [];
    var roster = rosterRes.data || [];
    var ticketGrades = ticketRes.data || [];

    // Build config map
    var configMap = {};
    (configRes.data || []).forEach(function(c) { configMap[c.config_key] = parseFloat(c.config_value); });

    // Store weights (from config or defaults)
    var WEIGHTS = {
      revenue: cfg(configMap, "store_weight_repairs", 0.25),
      audit: cfg(configMap, "store_weight_audit", 0.20),
      calls: cfg(configMap, "store_weight_calls", 0.15),
      experience: cfg(configMap, "store_weight_cx", 0.10),
      compliance: cfg(configMap, "store_weight_compliance", 0.20),
    };

    // Build outbound lookup for VM matching
    var obByPhone = {};
    outbound.forEach(function(o) {
      var ph = (o.external_number || "").replace(/\D/g, "").slice(-10);
      if (!ph) return;
      if (!obByPhone[ph]) obByPhone[ph] = [];
      obByPhone[ph].push(o);
    });

    // Build roster name resolver (handles "Ziegler", "Tomey, Samuel", "Matthew Slade" etc.)
    var rosterLookup = {};
    roster.forEach(function(r) {
      var name = r.name.toLowerCase();
      rosterLookup[name] = r.name;
      // Also index by last name, first name, and aliases
      var parts = r.name.split(/\s+/);
      parts.forEach(function(p) { if (p.length >= 3) rosterLookup[p.toLowerCase()] = r.name; });
      (r.aliases || []).forEach(function(a) { rosterLookup[a.toLowerCase()] = r.name; });
    });
    function resolveTicketName(raw) {
      if (!raw) return raw;
      var lower = raw.toLowerCase().trim();
      // Remove "Last, First" format
      if (lower.includes(",")) {
        var commaParts = lower.split(",").map(function(s){return s.trim();});
        lower = commaParts[1] ? commaParts[1] + " " + commaParts[0] : commaParts[0];
      }
      if (rosterLookup[lower]) return rosterLookup[lower];
      // Try each word
      var words = lower.split(/\s+/);
      for (var w = 0; w < words.length; w++) {
        if (rosterLookup[words[w]]) return rosterLookup[words[w]];
      }
      // Prefix match
      for (var key in rosterLookup) {
        if (key.startsWith(lower) || lower.startsWith(key)) return rosterLookup[key];
      }
      return raw;
    }

    // Resolve ticket grade employee names and group by store
    ticketGrades.forEach(function(t) {
      t.employee_resolved = resolveTicketName(t.employee_repaired || t.employee_added);
      // Resolve store from roster if ticket store is empty
      if (!t.store && t.employee_resolved) {
        var rEntry = roster.find(function(r) { return r.name === t.employee_resolved; });
        if (rEntry) t.store = rEntry.store;
      }
    });

    var scores = {};

    STORE_KEYS.forEach(function(sk) {
      // ═══ CALL HANDLING (20%) ═══
      var storeCalls = calls.filter(function(c) { return c.store === sk && c.direction === "inbound"; });
      var answered = storeCalls.filter(function(c) { return c.is_answered; }).length;
      var missed = storeCalls.filter(function(c) { return c.is_missed; }).length;
      var totalInbound = answered + missed;
      var answerRate = totalInbound > 0 ? (answered / totalInbound) * 100 : 0;

      // Callback rate: of missed calls, how many got an outbound call to same number?
      var missedCalls = storeCalls.filter(function(c) { return c.is_missed; });
      var calledBack = 0;
      missedCalls.forEach(function(m) {
        var ph = (m.external_number || "").replace(/\D/g, "").slice(-10);
        var cands = obByPhone[ph] || [];
        if (cands.some(function(o) { return new Date(o.date_started) > new Date(m.date_started); })) calledBack++;
      });
      var callbackRate = missedCalls.length > 0 ? (calledBack / missedCalls.length) * 100 : 100;

      // VM return rate
      var storeVMs = vms.filter(function(v) { return v.store === sk; });
      var vmReturned = 0;
      storeVMs.forEach(function(v) {
        var ph = (v.external_number || "").replace(/\D/g, "").slice(-10);
        var cands = obByPhone[ph] || [];
        if (cands.some(function(o) { return new Date(o.date_started) > new Date(v.date_started); })) vmReturned++;
      });
      var vmReturnRate = storeVMs.length > 0 ? (vmReturned / storeVMs.length) * 100 : 100;

      var callScore = clamp((answerRate * 0.4) + (callbackRate * 0.3) + (vmReturnRate * 0.3));

      // ═══ AUDIT QUALITY (30%) ═══
      var storeAudits = audits.filter(function(a) { return a.store === sk; });
      var avgAuditScore = 0;
      var apptRate = 0;
      var warrantyRate = 0;
      if (storeAudits.length > 0) {
        var totalScore = storeAudits.reduce(function(s, a) { return s + parseFloat(a.score || 0); }, 0);
        var maxPossible = storeAudits.reduce(function(s, a) { return s + parseFloat(a.max_score || 4); }, 0);
        avgAuditScore = maxPossible > 0 ? (totalScore / maxPossible) * 100 : 0;
        var oppAudits = storeAudits.filter(function(a) { return a.call_type === "opportunity"; });
        if (oppAudits.length > 0) {
          apptRate = (oppAudits.filter(function(a) { return a.appt_offered; }).length / oppAudits.length) * 100;
          warrantyRate = (oppAudits.filter(function(a) { return a.warranty_mentioned; }).length / oppAudits.length) * 100;
        }
      }
      var auditScore = clamp(storeAudits.length > 0 ? (avgAuditScore * cfg(configMap, "emp_audit_sub_score", 0.5)) + (apptRate * cfg(configMap, "emp_audit_sub_appt", 0.25)) + (warrantyRate * cfg(configMap, "emp_audit_sub_warranty", 0.25)) : 0);

      // ═══ REPAIRS & PRODUCTION (35%) ═══
      // Qty of repairs is what matters, not revenue. GP matters for accessories.
      var phoneTickets = phones.reduce(function(s, r) { return s + (r.repair_tickets || 0); }, 0);
      var otherTickets = others.reduce(function(s, r) { return s + (r.repair_count || 0); }, 0);
      var totalRepairTickets = phoneTickets + otherTickets;
      var accyGP = accys.reduce(function(s, r) { return s + parseFloat(r.accy_gp || 0); }, 0);
      var accyCount = accys.reduce(function(s, r) { return s + (r.accy_count || 0); }, 0);
      var cleanCount = cleans.reduce(function(s, r) { return s + (r.clean_count || 0); }, 0);

      // Since sales data isn't per-store yet, divide by store count
      var storeCount = STORE_KEYS.length || 1;
      var storeRepairs = totalRepairTickets / storeCount;
      var storeAccyGP = accyGP / storeCount;
      var storeAccyCount = accyCount / storeCount;
      var storeCleans = cleanCount / storeCount;

      // Targets per store per month (from config or defaults)
      var repairTarget = cfg(configMap, "store_target_repairs", 60);
      var accyGPTarget = cfg(configMap, "store_target_accy_gp", 500);
      var cleanTarget = cfg(configMap, "store_target_cleans", 10);

      var repSubTickets = cfg(configMap, "emp_repair_sub_qty", 0.25);
      var repSubAccy = cfg(configMap, "emp_repair_sub_accy", 0.50);
      var repSubCleans = cfg(configMap, "emp_repair_sub_clean", 0.25);

      var revenueScore = clamp(
        ((Math.min(storeRepairs / repairTarget, 1.2) / 1.2) * 100 * repSubTickets) +
        ((Math.min(storeAccyGP / accyGPTarget, 1.2) / 1.2) * 100 * repSubAccy) +
        ((Math.min(storeCleans / cleanTarget, 1.2) / 1.2) * 100 * repSubCleans)
      );

      // ═══ CUSTOMER EXPERIENCE (15%) ═══
      var missRate = totalInbound > 0 ? (missed / totalInbound) * 100 : 0;
      var missScore = clamp(100 - (missRate * 2)); // Every 1% missed = -2 points
      var avgRing = storeCalls.length > 0 ? storeCalls.reduce(function(s, c) { return s + parseFloat(c.ringing_duration || 0); }, 0) / storeCalls.length : 0;
      var ringScore = clamp(100 - (Math.max(avgRing - 0.3, 0) * 100)); // Penalty above 20s ring
      var urgentVMs = storeVMs.filter(function(v) {
        var ph = (v.external_number || "").replace(/\D/g, "").slice(-10);
        var cands = obByPhone[ph] || [];
        var returned = cands.some(function(o) { return new Date(o.date_started) > new Date(v.date_started); });
        return !returned && (Date.now() - new Date(v.date_started).getTime()) > 3600000;
      }).length;
      var urgentPenalty = Math.min(urgentVMs * 10, 50);

      var expScore = clamp((missScore * 0.4) + (ringScore * 0.3) + ((100 - urgentPenalty) * 0.3));

      // ═══ TICKET COMPLIANCE ═══
      var storeTickets = ticketGrades.filter(function(t) { return t.store === sk; });
      var complianceScore = 0;
      if (storeTickets.length > 0) {
        complianceScore = Math.round(storeTickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / storeTickets.length);
      }

      // ═══ OVERALL ═══
      var overall = (revenueScore * WEIGHTS.revenue) + (auditScore * WEIGHTS.audit) + (callScore * WEIGHTS.calls) + (expScore * WEIGHTS.experience) + (complianceScore * (WEIGHTS.compliance || 0));

      scores[sk] = {
        store: sk,
        store_name: STORES[sk] ? STORES[sk].name : sk,
        overall: Math.round(overall),
        categories: {
          revenue: { score: Math.round(revenueScore), weight: WEIGHTS.revenue, details: {
            repair_tickets: Math.round(storeRepairs), repair_target: repairTarget,
            accy_gp: storeAccyGP, accy_gp_target: accyGPTarget, accy_count: Math.round(storeAccyCount),
            clean_count: Math.round(storeCleans), clean_target: cleanTarget,
          }},
          audit: { score: Math.round(auditScore), weight: WEIGHTS.audit, details: {
            avg_score_pct: Math.round(avgAuditScore), appt_rate: Math.round(apptRate), warranty_rate: Math.round(warrantyRate),
            total_audits: storeAudits.length,
          }},
          calls: { score: Math.round(callScore), weight: WEIGHTS.calls, details: {
            answer_rate: Math.round(answerRate), callback_rate: Math.round(callbackRate), vm_return_rate: Math.round(vmReturnRate),
            total_inbound: totalInbound, missed: missed, vms: storeVMs.length,
          }},
          experience: { score: Math.round(expScore), weight: WEIGHTS.experience, details: {
            miss_rate: Math.round(missRate), urgent_vms: urgentVMs,
            total_calls: storeCalls.length,
          }},
          compliance: { score: Math.round(complianceScore), weight: WEIGHTS.compliance || 0, details: {
            tickets_graded: storeTickets.length,
            avg_diagnostics: storeTickets.length > 0 ? Math.round(storeTickets.reduce(function(s,t){return s+(t.diagnostics_score||0);},0)/storeTickets.length) : 0,
            avg_notes: storeTickets.length > 0 ? Math.round(storeTickets.reduce(function(s,t){return s+(t.notes_score||0);},0)/storeTickets.length) : 0,
          }},
        },
      };
    });

    // Rank stores
    var ranked = STORE_KEYS.map(function(sk) { return scores[sk]; }).sort(function(a, b) { return b.overall - a.overall; });

    // ═══════════════════════════════════════════
    // EMPLOYEE SCORING (Repairs 50% + Audit 50%)
    // ═══════════════════════════════════════════

    // Build roster alias lookup
    var aliasToName = {};
    roster.forEach(function(r) {
      aliasToName[r.name.toLowerCase()] = r.name;
      (r.aliases || []).forEach(function(a) { aliasToName[a.toLowerCase()] = r.name; });
    });
    function resolveEmp(name) {
      if (!name) return null;
      var lower = name.toLowerCase().trim();
      if (aliasToName[lower]) return aliasToName[lower];
      // Prefix match
      for (var key in aliasToName) {
        if (key.startsWith(lower) && lower.length >= 2) return aliasToName[key];
        if (lower.startsWith(key) && key.length >= 2) return aliasToName[key];
      }
      return name;
    }

    // Gather all employee names from all sources
    var empMap = {};
    function ensureEmp(name) {
      if (!name || name === "Unknown") return null;
      var resolved = resolveEmp(name);
      if (!resolved) return null;
      if (!empMap[resolved]) {
        var rEntry = roster.find(function(r) { return r.name === resolved; });
        empMap[resolved] = {
          name: resolved,
          store: rEntry ? rEntry.store : "",
          role: rEntry ? rEntry.role : "",
          onRoster: !!rEntry,
          // Repairs
          phone_tickets: 0, other_tickets: 0, accy_count: 0, accy_gp: 0, clean_count: 0,
          // Audit
          audit_scores: [], opp_audits: 0, appt_offered: 0, warranty_mentioned: 0,
          // Compliance
          compliance_scores: [],
        };
      }
      return empMap[resolved];
    }

    // Fill repair data
    phones.forEach(function(r) { var e = ensureEmp(r.employee); if (e) { e.phone_tickets = r.repair_tickets || 0; } });
    others.forEach(function(r) { var e = ensureEmp(r.employee); if (e) { e.other_tickets = r.repair_count || 0; } });
    accys.forEach(function(r) { var e = ensureEmp(r.employee); if (e) { e.accy_count = r.accy_count || 0; e.accy_gp = parseFloat(r.accy_gp || 0); } });
    cleans.forEach(function(r) { var e = ensureEmp(r.employee); if (e) { e.clean_count = r.clean_count || 0; } });

    // Fill audit data
    audits.forEach(function(a) {
      if (!a.employee || a.employee === "Unknown") return;
      var e = ensureEmp(a.employee);
      if (!e) return;
      e.audit_scores.push({ score: parseFloat(a.score || 0), max: parseFloat(a.max_score || 4) });
      if (a.call_type === "opportunity") {
        e.opp_audits++;
        if (a.appt_offered) e.appt_offered++;
        if (a.warranty_mentioned) e.warranty_mentioned++;
      }
    });

    // Fill compliance data (resolved ticket names)
    ticketGrades.forEach(function(t) {
      if (!t.employee_resolved) return;
      var e = ensureEmp(t.employee_resolved);
      if (e) e.compliance_scores.push(t.overall_score || 0);
    });

    // Compute employee scores
    // Per-employee targets and weights (from config or defaults)
    var empRepairTarget = cfg(configMap, "emp_target_repairs", 20);
    var empAccyGPTarget = cfg(configMap, "emp_target_accy_gp", 200);
    var empCleanTarget = cfg(configMap, "emp_target_cleans", 4);
    var empWeightRepairs = cfg(configMap, "emp_weight_repairs", 0.35);
    var empWeightAudit = cfg(configMap, "emp_weight_audit", 0.35);
    var empWeightCompliance = cfg(configMap, "emp_weight_compliance", 0.30);
    var empRepTicketW = cfg(configMap, "emp_repair_sub_qty", 0.25);
    var empRepAccyW = cfg(configMap, "emp_repair_sub_accy", 0.50);
    var empRepCleanW = cfg(configMap, "emp_repair_sub_clean", 0.25);
    var empAuditAvgW = cfg(configMap, "emp_audit_sub_score", 0.50);
    var empAuditApptW = cfg(configMap, "emp_audit_sub_appt", 0.25);
    var empAuditWarrW = cfg(configMap, "emp_audit_sub_warranty", 0.25);

    var employeeScores = Object.values(empMap).map(function(e) {
      var totalRepairs = e.phone_tickets + e.other_tickets;

      // Repairs & Production score
      var repairPct = clamp((Math.min(totalRepairs / empRepairTarget, 1.2) / 1.2) * 100);
      var accyPct = clamp(empAccyGPTarget > 0 ? (Math.min(e.accy_gp / empAccyGPTarget, 1.2) / 1.2) * 100 : 0);
      var cleanPct = clamp(empCleanTarget > 0 ? (Math.min(e.clean_count / empCleanTarget, 1.2) / 1.2) * 100 : 0);
      var repairScore = (repairPct * empRepTicketW) + (accyPct * empRepAccyW) + (cleanPct * empRepCleanW);

      // Audit score
      var avgAuditPct = 0;
      var apptRate = 0;
      var warrantyRate = 0;
      if (e.audit_scores.length > 0) {
        var totalS = e.audit_scores.reduce(function(s, a) { return s + a.score; }, 0);
        var totalM = e.audit_scores.reduce(function(s, a) { return s + a.max; }, 0);
        avgAuditPct = totalM > 0 ? (totalS / totalM) * 100 : 0;
      }
      if (e.opp_audits > 0) {
        apptRate = (e.appt_offered / e.opp_audits) * 100;
        warrantyRate = (e.warranty_mentioned / e.opp_audits) * 100;
      }
      var auditScore = e.audit_scores.length > 0
        ? (avgAuditPct * empAuditAvgW) + (apptRate * empAuditApptW) + (warrantyRate * empAuditWarrW)
        : 0;

      // Compliance score
      var complianceAvg = e.compliance_scores.length > 0
        ? e.compliance_scores.reduce(function(s, v) { return s + v; }, 0) / e.compliance_scores.length
        : 0;

      var overall = clamp((repairScore * empWeightRepairs) + (auditScore * empWeightAudit) + (complianceAvg * empWeightCompliance));
      var hasData = totalRepairs > 0 || e.accy_count > 0 || e.audit_scores.length > 0 || e.compliance_scores.length > 0;

      return {
        name: e.name,
        store: e.store,
        role: e.role,
        onRoster: e.onRoster,
        overall: Math.round(overall),
        hasData: hasData,
        repairs: {
          score: Math.round(repairScore),
          phone_tickets: e.phone_tickets,
          other_tickets: e.other_tickets,
          total_repairs: totalRepairs,
          accy_count: e.accy_count,
          accy_gp: e.accy_gp,
          clean_count: e.clean_count,
        },
        audit: {
          score: Math.round(auditScore),
          avg_pct: Math.round(avgAuditPct),
          appt_rate: Math.round(apptRate),
          warranty_rate: Math.round(warrantyRate),
          total_audits: e.audit_scores.length,
          opp_audits: e.opp_audits,
        },
        compliance: {
          score: Math.round(complianceAvg),
          tickets_graded: e.compliance_scores.length,
        },
      };
    }).filter(function(e) { return e.hasData; }).sort(function(a, b) { return b.overall - a.overall; });

    return NextResponse.json({
      success: true,
      scores: scores,
      ranked: ranked,
      employeeScores: employeeScores,
      weights: WEIGHTS,
      empWeights: { repairs: empWeightRepairs, audit: empWeightAudit, compliance: empWeightCompliance },
      configMap: configMap,
      period: period,
      daysBack: daysBack,
    });
  } catch (err) {
    console.error("Scorecard error:", err);
    return NextResponse.json({ success: false, error: err.message });
  }
}

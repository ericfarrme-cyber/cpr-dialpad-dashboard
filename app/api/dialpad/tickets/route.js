import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// ── Role-split scoring helpers (April 2026) ──
// Splits the 5-category ticket grade into intake-role and repair-role scores.
//   Intake (employee_added):    Diagnostics 30%, Payment 20%, Contact 5%   (55% of overall)
//   Repair (employee_repaired): Repair Notes 25%, Pickup 20%                (45% of overall)
// When payment is N/A, intake = Diag 30 + Contact 5 (35); repair = Notes 40 + Pickup 25 (65).
function ROLE_SPLIT_CUTOFF() { return "2026-04-01"; }
function isRoleSplitEra(dateStr) {
  if (!dateStr) return false;
  return String(dateStr).substring(0, 10) >= ROLE_SPLIT_CUTOFF();
}

// Indiana-local "today" as YYYY-MM-DD. Used to clamp the current month to
// month-to-date so we never count shifts that haven't been worked yet.
function indyTodayYMD() {
  var d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Indiana/Indianapolis" }));
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function paymentIsNA(t) {
  if (t == null) return false;
  if (parseFloat(t.payment_score) !== 100) return false;
  var n = String(t.payment_notes || "").toLowerCase();
  return n.indexOf("not applicable") >= 0 || n.indexOf("n/a") >= 0 || n.indexOf("no parts") >= 0;
}
function computeIntakeRoleScore(t) {
  if (!t) return null;
  var diag = t.diagnostics_score, pay = t.payment_score, contact = t.contact_score;
  if (diag == null && contact == null) return null;
  diag = diag == null ? 0 : parseFloat(diag);
  contact = contact == null ? 0 : parseFloat(contact);
  pay = pay == null ? 0 : parseFloat(pay);
  if (paymentIsNA(t)) return Math.round((diag * 30 + contact * 5) / 35);
  return Math.round((diag * 30 + pay * 20 + contact * 5) / 55);
}
function computeRepairRoleScore(t) {
  if (!t) return null;
  var notes = t.notes_score, pickup = t.categorization_score;
  if (notes == null && pickup == null) return null;
  notes = notes == null ? 0 : parseFloat(notes);
  pickup = pickup == null ? 0 : parseFloat(pickup);
  if (paymentIsNA(t)) return Math.round((notes * 40 + pickup * 25) / 65);
  return Math.round((notes * 25 + pickup * 20) / 45);
}
function nameMatches(needle, hay) {
  if (!needle || !hay) return false;
  return String(hay).toLowerCase().indexOf(String(needle).toLowerCase()) >= 0;
}

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

function parseSafeDate(val) {
  if (!val) return null;
  // Strip leading "Date:" prefix
  var cleaned = String(val).replace(/^Date:\s*/i, "").trim();
  if (!cleaned) return null;
  var d = new Date(cleaned);
  if (isNaN(d.getTime())) {
    // Try common formats like "3/14/26 3:47 PM"
    var m = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(.*)/);
    if (m) {
      var year = parseInt(m[3]);
      if (year < 100) year += 2000;
      d = new Date(m[1] + "/" + m[2] + "/" + year + " " + (m[4] || ""));
    }
  }
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

var GRADING_PROMPT = `You are grading a CPR Cell Phone Repair ticket for process compliance. Score each section 0-100 and explain why. Be thorough but fair — partial credit for partial documentation.

═══ SECTION 1: INTAKE / DIAGNOSTIC NOTES (0-100) ═══
The initial diagnostics section should address these questions. Not every item applies to every repair — score based on what's RELEVANT to this specific ticket:

A) PRIMARY ISSUE: What is the main problem? What did the customer report?
B) SECONDARY ISSUES: Any additional issues noted? (Only penalize if there are obvious secondary issues visible but not documented)
C) SERVICE PLANNED: What service/repair will be provided?
D) REPAIR HISTORY: Any previous repairs mentioned? (e.g. "no previous repairs" or "was repaired elsewhere before")
E) LIQUID/SPILL CHECK: Any mention of spills, submersion, or liquid damage? (e.g. "no known liquid damage" or "customer reports water exposure")
F) WARRANTY OFFERED: Was a warranty mentioned or offered?
G) PRICING: What is the total before tax? Any discounts and reasons?
H) TURNAROUND/PROMISED BY: When is the customer expecting completion or an update? (e.g. "12-24hrs", "1-2 days for part + 1-2hrs once arrived", "ready by 3pm")

Scoring:
- 90-100: 6+ of the applicable items are clearly documented
- 75-89: 4-5 items documented
- 50-74: 2-3 items documented
- 25-49: Only 1 item documented
- 0-24: Empty or essentially no diagnostic information

═══ SECTION 2: REPAIR NOTES (0-100) ═══
The repair notes should read as if someone is taking over the repair. They should document:

A) PRETEST: What was pretested before starting? (if device was functional enough to pretest)
B) SERVICE PROVIDED: What repair/service was actually performed?
C) NEW FINDINGS: Any new details discovered during the repair? (e.g. "found water damage indicators tripped", "battery was swollen")
D) CUSTOMER COMMUNICATION: What has the customer been told along the way? Any updates given during the repair process?
E) POST-TEST: What was post-tested after the repair? (e.g. "tested all functions", "screen, touch, Face ID all working")

Scoring:
- 90-100: Service provided + post-test + at least 1-2 other items documented
- 70-89: Service provided clearly documented, plus post-test OR new findings
- 50-69: Service provided is documented but minimal detail, missing post-test
- 25-49: Notes exist but vague — unclear what was actually done
- 0-24: No repair notes or completely irrelevant

═══ SECTION 3: PICKUP NOTES (0-100) ═══
The pickup/completion notes should confirm the customer knows their device is ready:

A) CUSTOMER CONTACTED: Is the customer aware the device is ready? Look for:
   - "Called customer, ready for pickup"
   - "Texted customer repair complete"
   - "Left voicemail, device is ready"
   - "Customer VM not setup, auto email sent"
   EXCEPTION: If customer is waiting in store, returning soon, or was told a specific time and it's within that window, this counts as FULL CREDIT.

B) CUSTOMER INFORMED OF WORK: Does the customer know what was done and what they're paying for?

C) PICKUP TIMING: Any indication of when the customer is picking up? (e.g. "customer picking up today", "will return tomorrow")

Scoring:
- 90-100: Customer contacted + informed of what was done + pickup timing noted
- 70-89: Customer contacted and at least partially informed
- 50-69: Customer contacted but no detail on what was communicated
- 25-49: Some indication but unclear if customer actually knows device is ready
- 0-24: No evidence customer was notified at all

═══ SECTION 4: PAYMENT / DOWN PAYMENT (0-100) ═══
This ONLY applies if parts needed to be ordered. If no parts were ordered, mark "payment_not_applicable": true, score 100, and EXCLUDE from overall score.

Look at ticket items, notes, and transactions for ANY indication a part was ordered, back-ordered, or special-ordered.

INSURANCE CLAIM EXCEPTION: If the ticket appears to be an insurance claim (look for mentions of "insurance", "claim", "deductible", "Asurion", "warranty claim", carrier names like "Verizon claim", etc. in the notes, items, or ticket type), payment is typically invoiced/paid at a later date. In this case, mark "payment_not_applicable": true, score 100, and note "Insurance claim — payment invoiced separately."

TIMING IS CRITICAL: The down payment is our collateral. It must be collected at or very near ticket intake — within about 2 hours. Compare transaction/payment dates against the ticket creation date.

Scoring if parts were ordered (non-insurance):
- 100: Down payment or full payment collected within ~2 hours of ticket creation
- 50: Payment collected but more than 2 hours after intake
- 0: Part ordered with NO down payment, or payment only collected days later

If NO parts were ordered:
- Mark "payment_not_applicable": true and score 100

═══ SECTION 5: CONTACT INFORMATION (0-100) ═══
Check the customer information on the ticket for completeness:

A) FULL NAME: Does the customer have a first AND last name on file? (Not just a first name or a company name with no contact person)
B) PHONE NUMBER: Is there a main phone number?
C) ALTERNATE PHONE: Is there a second/alternate phone number? This is BONUS credit — employees who take the time to collect an alternate number are going above and beyond. Look at the "All Phones" field — if there are 2+ phone numbers listed, the alternate was collected.
D) EMAIL ADDRESS: Is there a REAL email address on file? 

   FAKE EMAIL DETECTION: Employees sometimes enter fake/placeholder emails to bypass required fields. The following are NOT real emails and should be scored as NO email:
   - none@gmail.com, none@yahoo.com, none@anything
   - declined@gmail.com, declined@anything
   - no@gmail.com, na@gmail.com, noemail@gmail.com
   - test@test.com, fake@fake.com, asdf@gmail.com
   - Any email starting with "none", "declined", "noemail", "na@", "no@", "test@test"
   - Any email containing "decline" or "noneemail"
   
   A REAL email ensures customers get automated Ready for Pickup notifications if we can't reach them by phone. This is important.

Scoring:
- 95-100: Full name + phone + REAL email + alternate phone (above and beyond)
- 85-94: Full name + phone + REAL email (no alternate, but solid)
- 70-84: Name + phone present, real email missing but alternate phone collected
- 55-69: Name + phone present, no real email, no alternate phone
- 25-54: Minimal info — only a name or only a phone number
- 0-24: Customer info is essentially empty or placeholder

═══ RESPONSE FORMAT ═══
Respond ONLY with this exact JSON format, no other text:
{
  "diagnostics_score": <number 0-100>,
  "diagnostics_notes": "<brief explanation — mention which items were found or missing>",
  "diagnostics_issue_found": <true/false>,
  "diagnostics_price_found": <true/false>,
  "diagnostics_turnaround_found": <true/false>,
  "diagnostics_history_noted": <true/false>,
  "diagnostics_liquid_check": <true/false>,
  "diagnostics_warranty_offered": <true/false>,
  "diagnostics_service_planned": <true/false>,
  "repair_notes_score": <number 0-100>,
  "repair_notes_detail": "<brief explanation>",
  "repair_pretest_documented": <true/false>,
  "repair_service_documented": <true/false>,
  "repair_findings_documented": <true/false>,
  "repair_communication_documented": <true/false>,
  "repair_posttest_documented": <true/false>,
  "pickup_score": <number 0-100>,
  "pickup_notes": "<brief explanation>",
  "pickup_customer_contacted": <true/false>,
  "pickup_customer_informed": <true/false>,
  "pickup_timing_noted": <true/false>,
  "payment_score": <number 0-100>,
  "payment_notes": "<brief explanation>",
  "payment_not_applicable": <true/false>,
  "contact_score": <number 0-100>,
  "contact_notes": "<brief explanation>",
  "contact_name_present": <true/false>,
  "contact_phone_present": <true/false>,
  "contact_email_present": <true/false>,
  "contact_alternate_phone": <true/false>,
  "overall_score": <number 0-100>,
  "confidence": <number 0-100>
}

The overall_score should be calculated as:
- If payment applies: Intake 25% + Repair Notes 25% + Pickup 20% + Payment 20% + Contact 5% (= 95%, round remaining 5% into Intake making it 30%)
- If payment is not applicable: Intake 30% + Repair Notes 35% + Pickup 25% + Contact 5% (= 95%, round remaining 5% into Repair making it 40%)
Simplified:
- If payment applies: Intake 30% + Repair Notes 25% + Pickup 20% + Payment 20% + Contact 5%
- If payment is not applicable: Intake 30% + Repair Notes 40% + Pickup 25% + Contact 5%`;

export async function GET(request) {
  if (!supabase) return jsonResponse({ success: false, error: "Supabase not configured" });
  var { searchParams } = new URL(request.url);
  var action = searchParams.get("action");
  var store = searchParams.get("store");
  var employee = searchParams.get("employee");
  var limit = parseInt(searchParams.get("limit") || "100");

  if (action === "list") {
    var query = supabase.from("ticket_grades").select("*").order("date_closed", { ascending: false }).limit(limit);
    if (store) query = query.eq("store", store);
    if (employee) query = query.or("employee_added.eq." + employee + ",employee_repaired.eq." + employee);
    var { data, error } = await query;
    if (error) return jsonResponse({ success: false, error: error.message });
    return jsonResponse({ success: true, tickets: data || [] });
  }

  if (action === "employee_tickets") {
    var employee = searchParams.get("employee") || "";
    var days = parseInt(searchParams.get("days")) || 60;
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    var cutoffStr = cutoff.toISOString();

    if (!employee) return jsonResponse({ success: false, error: "Employee name required" });

    var { data, error } = await supabase.from("ticket_grades")
      .select("ticket_number, ticket_type, store, employee_added, employee_repaired, customer_name, device, device_category, device_brand, date_closed, gross_sales, gross_profit, gpm_pct, discount_amount, turnaround_hours, total_collected, total_cost, payment_method, item_details, overall_score, diagnostics_score, diagnostics_notes, notes_score, notes_detail, categorization_score, categorization_notes, payment_score, payment_notes, contact_score, contact_notes")
      .or("employee_added.ilike.%" + employee + "%,employee_repaired.ilike.%" + employee + "%")
      .gte("date_closed", cutoffStr)
      .order("date_closed", { ascending: false })
      .limit(200);

    if (error) return jsonResponse({ success: false, error: error.message });

    // Enrich each ticket with role-split scores and the requesting employee's role on this ticket
    var enriched = (data || []).map(function(t) {
      var roleEra = isRoleSplitEra(t.date_closed);
      var intakeMatch = nameMatches(employee, t.employee_added);
      var repairMatch = nameMatches(employee, t.employee_repaired);
      var yourRole;
      if (intakeMatch && repairMatch) yourRole = "both";
      else if (intakeMatch) yourRole = "intake";
      else if (repairMatch) yourRole = "repair";
      else yourRole = null;
      // Role-split scores only computed for April 2026+ tickets — pre-April keep shared overall_score
      var intakeScore = roleEra ? computeIntakeRoleScore(t) : null;
      var repairScore = roleEra ? computeRepairRoleScore(t) : null;
      // role-split null if the corresponding role's tech is null on the ticket (Sale tickets, walk-outs, etc.)
      if (!t.employee_added) intakeScore = null;
      if (!t.employee_repaired) repairScore = null;
      return Object.assign({}, t, {
        intake_role_score: intakeScore,
        repair_role_score: repairScore,
        your_role: yourRole,
        role_split_era: roleEra,
      });
    });

    return jsonResponse({ success: true, tickets: enriched, role_split_cutoff: ROLE_SPLIT_CUTOFF() });
  }

  if (action === "stats") {
    var query = supabase.from("ticket_grades").select("store, employee_added, employee_repaired, overall_score, diagnostics_score, payment_score, notes_score, categorization_score, ticket_type")
      .or("ticket_type.is.null,ticket_type.neq.Sale"); // Exclude sale tickets from compliance stats
    if (store) query = query.eq("store", store);
    var { data, error } = await query;
    if (error) return jsonResponse({ success: false, error: error.message });

    var tickets = data || [];
    var total = tickets.length;
    if (total === 0) return jsonResponse({ success: true, stats: { total: 0 } });

    var avgOverall = Math.round(tickets.reduce(function(s, t) { return s + (t.overall_score || 0); }, 0) / total);
    var avgDiag = Math.round(tickets.reduce(function(s, t) { return s + (t.diagnostics_score || 0); }, 0) / total);
    var avgPay = Math.round(tickets.reduce(function(s, t) { return s + (t.payment_score || 0); }, 0) / total);
    var avgNotes = Math.round(tickets.reduce(function(s, t) { return s + (t.notes_score || 0); }, 0) / total);
    var avgCategorization = Math.round(tickets.reduce(function(s, t) { return s + (t.categorization_score || 0); }, 0) / total);

    // Per-employee stats
    var empMap = {};
    tickets.forEach(function(t) {
      var emp = t.employee_repaired || t.employee_added || "Unknown";
      if (!empMap[emp]) empMap[emp] = { name: emp, scores: [], count: 0 };
      empMap[emp].scores.push(t.overall_score || 0);
      empMap[emp].count++;
    });
    var empStats = Object.values(empMap).map(function(e) {
      e.avg_score = Math.round(e.scores.reduce(function(s, v) { return s + v; }, 0) / e.count);
      return e;
    }).sort(function(a, b) { return b.avg_score - a.avg_score; });

    // Per-store stats
    var storeMap = {};
    tickets.forEach(function(t) {
      var sk = t.store || "unknown";
      if (!storeMap[sk]) storeMap[sk] = { store: sk, scores: [], count: 0 };
      storeMap[sk].scores.push(t.overall_score || 0);
      storeMap[sk].count++;
    });
    var storeStats = Object.values(storeMap).map(function(s) {
      s.avg_score = Math.round(s.scores.reduce(function(sum, v) { return sum + v; }, 0) / s.count);
      return s;
    });

    return jsonResponse({
      success: true,
      stats: { total: total, avgOverall: avgOverall, avgDiag: avgDiag, avgPay: avgPay, avgNotes: avgNotes, avgCategorization: avgCategorization, empStats: empStats, storeStats: storeStats }
    });
  }

  if (action === "gp_leaderboard") {
    // Cross-table aggregate: gross profit per employee + hours worked + computed GP/hour.
    // Period inputs: ?period=YYYY-MM (calendar month) OR ?start=YYYY-MM-DD&end=YYYY-MM-DD (custom range).
    // Default: current calendar month, month-to-date.
    var period = searchParams.get("period");
    var rangeStart, rangeEnd;
    if (searchParams.get("start") && searchParams.get("end")) {
      rangeStart = searchParams.get("start");
      rangeEnd = searchParams.get("end");
    } else if (period) {
      var parts = period.split("-");
      var year = parseInt(parts[0]);
      var month = parseInt(parts[1]);
      rangeStart = period + "-01";
      var lastDay = new Date(year, month, 0).getDate();
      rangeEnd = period + "-" + String(lastDay).padStart(2, "0");
      // Month-to-date clamp: if this IS the current month, don't reach past today.
      // WhenIWork has the whole month's shifts PUBLISHED, so an unclamped end pulls
      // future scheduled shifts (e.g. the 23rd–30th when it's only the 22nd) and
      // inflates hours, dragging GP/hour down. Past months are unaffected (today is
      // already beyond their last day). Tickets can't be closed in the future, so
      // this only changes the hours window.
      var todayYMD = indyTodayYMD();
      if (rangeEnd > todayYMD) rangeEnd = todayYMD;
    } else {
      var now = new Date();
      var y = now.getFullYear(), m = now.getMonth() + 1;
      rangeStart = y + "-" + String(m).padStart(2, "0") + "-01";
      rangeEnd = now.toISOString().substring(0, 10);
    }

    var { data: roster, error: rErr } = await supabase.from("employee_roster").select("name, store, aliases, role, active").eq("active", true);
    if (rErr) return jsonResponse({ success: false, error: "roster: " + rErr.message });

    var aliasMap = {};
    (roster || []).forEach(function(r) {
      if (!r || !r.name) return;
      var name = r.name;
      var lower = name.toLowerCase();
      aliasMap[lower] = name;
      var nameParts = lower.split(/\s+/);
      if (nameParts.length > 0) aliasMap[nameParts[0]] = name;
      if (nameParts.length > 1) aliasMap[nameParts[nameParts.length - 1]] = name;
      if (Array.isArray(r.aliases)) {
        r.aliases.forEach(function(a) { if (a) aliasMap[String(a).toLowerCase().trim()] = name; });
      }
    });
    function resolveName(raw) {
      if (!raw) return null;
      var lower = String(raw).toLowerCase().trim();
      if (aliasMap[lower]) return aliasMap[lower];
      for (var k in aliasMap) {
        if (k.length >= 3 && lower.indexOf(k) >= 0) return aliasMap[k];
      }
      return null;
    }

    var { data: tickets, error: tErr } = await supabase.from("ticket_grades")
      .select("ticket_number, store, employee_added, employee_repaired, gross_sales, gross_profit, ticket_type, date_closed")
      .gte("date_closed", rangeStart)
      .lte("date_closed", rangeEnd + "T23:59:59")
      .order("date_closed", { ascending: false })
      .limit(5000);
    if (tErr) return jsonResponse({ success: false, error: "tickets: " + tErr.message });

    var { data: shifts, error: sErr } = await supabase.from("employee_shifts")
      .select("employee_name, store, date, start_time, end_time")
      .gte("date", rangeStart).lte("date", rangeEnd);
    if (sErr) return jsonResponse({ success: false, error: "shifts: " + sErr.message });

    var byEmp = {};
    function ensureEmp(name) {
      if (!byEmp[name]) {
        var r = (roster || []).filter(function(x) { return x.name === name; })[0];
        byEmp[name] = {
          employee: name,
          store: r ? r.store : null,
          role: r ? r.role : null,
          ticket_count: 0,
          total_gross: 0,
          total_gp: 0,
          hours: 0,
          sale_tickets: 0,
          repair_tickets: 0,
        };
      }
      return byEmp[name];
    }
    (roster || []).forEach(function(r) { ensureEmp(r.name); });

    // Tickets — attribution Option A (sale → added, repair → repaired-then-added)
    (tickets || []).forEach(function(t) {
      var isSale = t.ticket_type === "Sale";
      var attribName = null;
      if (isSale) {
        attribName = resolveName(t.employee_added);
      } else {
        attribName = resolveName(t.employee_repaired) || resolveName(t.employee_added);
      }
      if (!attribName) return;
      var e = ensureEmp(attribName);
      e.ticket_count += 1;
      e.total_gross += parseFloat(t.gross_sales) || 0;
      e.total_gp += parseFloat(t.gross_profit) || 0;
      if (isSale) e.sale_tickets += 1; else e.repair_tickets += 1;
    });

    // Shifts — sum hours per employee across all stores (Option 1)
    (shifts || []).forEach(function(s) {
      var name = resolveName(s.employee_name);
      if (!name) return;
      if (!s.start_time || !s.end_time) return;
      var startMs, endMs;
      if (String(s.start_time).indexOf("T") >= 0 || String(s.start_time).indexOf("-") > 4) {
        startMs = new Date(s.start_time).getTime();
        endMs = new Date(s.end_time).getTime();
      } else {
        startMs = new Date(s.date + "T" + s.start_time).getTime();
        endMs = new Date(s.date + "T" + s.end_time).getTime();
      }
      if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return;
      var hours = (endMs - startMs) / (1000 * 60 * 60);
      if (hours > 16) hours = 16; // sanity cap
      var e = ensureEmp(name);
      e.hours += hours;
    });

    var rows = Object.values(byEmp).map(function(e) {
      e.hours = Math.round(e.hours * 10) / 10;
      e.total_gross = Math.round(e.total_gross * 100) / 100;
      e.total_gp = Math.round(e.total_gp * 100) / 100;
      e.avg_gp_per_ticket = e.ticket_count > 0 ? Math.round((e.total_gp / e.ticket_count) * 100) / 100 : 0;
      e.gp_per_hour = e.hours > 0 ? Math.round((e.total_gp / e.hours) * 100) / 100 : 0;
      e.gpm_pct = e.total_gross > 0 ? Math.round((e.total_gp / e.total_gross) * 1000) / 10 : 0;
      return e;
    }).filter(function(e) {
      return e.ticket_count > 0 || e.hours > 0;
    });

    rows.sort(function(a, b) { return b.gp_per_hour - a.gp_per_hour; });
    rows.forEach(function(r, i) { r.rank = i + 1; });

    var totalGP = rows.reduce(function(s, r) { return s + r.total_gp; }, 0);
    var totalHours = rows.reduce(function(s, r) { return s + r.hours; }, 0);
    var totalTickets = rows.reduce(function(s, r) { return s + r.ticket_count; }, 0);

    return jsonResponse({
      success: true,
      period: { start: rangeStart, end: rangeEnd },
      rows: rows,
      summary: {
        total_employees: rows.length,
        total_gp: Math.round(totalGP * 100) / 100,
        total_hours: Math.round(totalHours * 10) / 10,
        total_tickets: totalTickets,
        avg_gp_per_hour: totalHours > 0 ? Math.round((totalGP / totalHours) * 100) / 100 : 0,
        avg_gp_per_ticket: totalTickets > 0 ? Math.round((totalGP / totalTickets) * 100) / 100 : 0,
      },
    });
  }

  if (action === "ticket_economics") {
    // Per-store aggregates for use in Labor Economics ROI math.
    var period2 = searchParams.get("period");
    var rs2, re2;
    if (period2) {
      var p2 = period2.split("-");
      rs2 = period2 + "-01";
      var lastD = new Date(parseInt(p2[0]), parseInt(p2[1]), 0).getDate();
      re2 = period2 + "-" + String(lastD).padStart(2, "0");
    } else {
      var n2 = new Date();
      var thirtyAgo = new Date(); thirtyAgo.setDate(thirtyAgo.getDate() - 30);
      rs2 = thirtyAgo.toISOString().substring(0, 10);
      re2 = n2.toISOString().substring(0, 10);
    }
    var { data: tix, error: txErr } = await supabase.from("ticket_grades")
      .select("store, gross_sales, gross_profit, ticket_type, date_closed")
      .gte("date_closed", rs2).lte("date_closed", re2 + "T23:59:59")
      .or("ticket_type.is.null,ticket_type.neq.Sale")
      .limit(10000);
    if (txErr) return jsonResponse({ success: false, error: txErr.message });

    var byStore = {};
    function ensureStore(s) {
      if (!byStore[s]) byStore[s] = { store: s, tickets: 0, total_gross: 0, total_gp: 0 };
      return byStore[s];
    }
    (tix || []).forEach(function(t) {
      if (!t.store) return;
      var s = ensureStore(t.store);
      s.tickets += 1;
      s.total_gross += parseFloat(t.gross_sales) || 0;
      s.total_gp += parseFloat(t.gross_profit) || 0;
    });
    var stores = Object.values(byStore).map(function(s) {
      return {
        store: s.store,
        tickets: s.tickets,
        avg_gross: s.tickets > 0 ? Math.round((s.total_gross / s.tickets) * 100) / 100 : 0,
        avg_gp: s.tickets > 0 ? Math.round((s.total_gp / s.tickets) * 100) / 100 : 0,
        gpm_pct: s.total_gross > 0 ? Math.round((s.total_gp / s.total_gross) * 1000) / 10 : 0,
        total_gross: Math.round(s.total_gross * 100) / 100,
        total_gp: Math.round(s.total_gp * 100) / 100,
      };
    });
    return jsonResponse({ success: true, period: { start: rs2, end: re2 }, stores: stores });
  }

  return jsonResponse({ success: false, error: "Invalid action" });
}

export async function POST(request) {
  if (!supabase) return jsonResponse({ success: false, error: "Supabase not configured" });
  var body = await request.json();

  if (body.action === "grade") {
    var ticket = body.ticket;
    if (!ticket || !ticket.ticket_number) return jsonResponse({ success: false, error: "ticket_number required" });

    // Resolve employee names against roster
    console.log("[tickets] Incoming employee_added:", JSON.stringify(ticket.employee_added), "employee_repaired:", JSON.stringify(ticket.employee_repaired), "store:", JSON.stringify(ticket.store));
    var rosterRes = await supabase.from("employee_roster").select("name, store, aliases, role").eq("active", true);
    if (rosterRes.error) {
      console.error("[tickets] Roster query FAILED:", rosterRes.error.message, rosterRes.error.code, rosterRes.error.hint);
    }
    var rosterList = rosterRes.data || [];
    console.log("[tickets] Roster returned", rosterList.length, "entries:", rosterList.map(function(r) { return r.name + " (" + r.store + ")"; }));
    var rosterLookup = {};
    rosterList.forEach(function(r) {
      rosterLookup[r.name.toLowerCase()] = r;
      var parts = r.name.split(/\s+/);
      parts.forEach(function(p) { if (p.length >= 3) rosterLookup[p.toLowerCase()] = r; });
      (r.aliases || []).forEach(function(a) { if (a) rosterLookup[a.toLowerCase()] = r; });
    });
    console.log("[tickets] Lookup keys:", Object.keys(rosterLookup).join(", "));
    function resolveEmpName(raw) {
      if (!raw) return { name: raw, store: "" };
      var lower = raw.toLowerCase().trim();
      console.log("[tickets] resolveEmpName input:", JSON.stringify(raw), "-> lower:", JSON.stringify(lower));
      // Handle "Last, First" format -> try both orderings
      if (lower.includes(",")) {
        var cp = lower.split(",").map(function(s){return s.trim();});
        // Try "First Last"
        var flipped = cp[1] ? cp[1] + " " + cp[0] : cp[0];
        if (rosterLookup[flipped]) return { name: rosterLookup[flipped].name, store: rosterLookup[flipped].store };
        // Try each part
        for (var ci = 0; ci < cp.length; ci++) {
          if (cp[ci].length >= 3 && rosterLookup[cp[ci]]) return { name: rosterLookup[cp[ci]].name, store: rosterLookup[cp[ci]].store };
        }
        lower = flipped; // use flipped for further matching
      }
      if (rosterLookup[lower]) { console.log("[tickets] MATCH exact:", lower); return { name: rosterLookup[lower].name, store: rosterLookup[lower].store }; }
      // Try each word individually
      var words = lower.split(/\s+/);
      for (var w = 0; w < words.length; w++) {
        if (words[w].length >= 3 && rosterLookup[words[w]]) { console.log("[tickets] MATCH word:", words[w]); return { name: rosterLookup[words[w]].name, store: rosterLookup[words[w]].store }; }
      }
      // Prefix match
      for (var key in rosterLookup) {
        if (key.length >= 3 && (key.startsWith(lower) || lower.startsWith(key))) { console.log("[tickets] MATCH prefix:", key); return { name: rosterLookup[key].name, store: rosterLookup[key].store }; }
      }
      console.log("[tickets] NO MATCH for:", JSON.stringify(raw));
      return { name: raw, store: "" };
    }
    var resolvedAdded = resolveEmpName(ticket.employee_added);
    var resolvedRepaired = resolveEmpName(ticket.employee_repaired);
    ticket.employee_added = resolvedAdded.name;
    ticket.employee_repaired = resolvedRepaired.name;
    // ALWAYS derive store from roster — the extension's store detection is unreliable
    var rosterStore = resolvedRepaired.store || resolvedAdded.store;
    if (rosterStore) ticket.store = rosterStore;
    console.log("[tickets] RESOLVED -> added:", JSON.stringify(ticket.employee_added), "repaired:", JSON.stringify(ticket.employee_repaired), "store:", JSON.stringify(ticket.store));

    // Build the prompt with ticket data
    var ticketContext = "TICKET #" + ticket.ticket_number + "\n";
    ticketContext += "Type: " + (ticket.ticket_type || "Unknown") + "\n";
    ticketContext += "Store: " + (ticket.store || "Unknown") + "\n";
    ticketContext += "Employee Added: " + (ticket.employee_added || "Unknown") + "\n";
    ticketContext += "Employee Repaired: " + (ticket.employee_repaired || "Unknown") + "\n";
    ticketContext += "Device: " + (ticket.device || "Unknown") + "\n";
    ticketContext += "Device Type: " + (ticket.device_category || "Unknown") + " | Brand: " + (ticket.device_brand || "Unknown") + "\n";
    ticketContext += "Date Created (Intake): " + (ticket.date_created || "Unknown") + "\n";
    ticketContext += "Date Closed: " + (ticket.date_closed || "Unknown") + "\n\n";
    ticketContext += "CUSTOMER CONTACT INFO:\n";
    ticketContext += "Name: " + (ticket.customer_name || "(not found)") + "\n";
    ticketContext += "Phone: " + (ticket.customer_phone || "(not found)") + "\n";
    ticketContext += "All Phones: " + (ticket.customer_phones_all && ticket.customer_phones_all.length > 0 ? ticket.customer_phones_all.join(", ") : "(none)") + "\n";
    ticketContext += "Email: " + (ticket.customer_email || "(not found)") + "\n\n";
    ticketContext += "INITIAL DIAGNOSTICS:\n" + (ticket.raw_diagnostics || "(none)") + "\n\n";
    ticketContext += "TICKET ITEMS:\n" + (ticket.raw_items || "(none)") + "\n\n";
    if (ticket.structured_items && ticket.structured_items.length > 0) {
      ticketContext += "STRUCTURED ITEMS:\n";
      ticket.structured_items.forEach(function(item, idx) {
        ticketContext += (idx + 1) + ". " + (item.catalog_item || "Unknown") + " [" + (item.category || "?") + "]";
        if (item.repaired_by) ticketContext += " — Repaired by: " + item.repaired_by;
        if (item.added_by) ticketContext += " — Added by: " + item.added_by;
        if (item.unit_price) ticketContext += " — $" + item.unit_price;
        if (item.discount) ticketContext += " (discount: $" + item.discount + ")";
        ticketContext += "\n";
      });
      ticketContext += "\n";
    }
    ticketContext += "TICKET NOTES:\n" + (ticket.raw_notes || "(none)") + "\n\n";
    ticketContext += "TRANSACTIONS/PAYMENTS:\n" + (ticket.raw_transactions || "(none)") + "\n";

    try {
      var apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          messages: [
            { role: "user", content: GRADING_PROMPT + "\n\n" + ticketContext }
          ]
        })
      });
      var apiJson = await apiRes.json();
      var text = (apiJson.content && apiJson.content[0]) ? apiJson.content[0].text : "";
      var cleaned = text.replace(/```json|```/g, "").trim();
      var grade = JSON.parse(cleaned);

      // Save to Supabase — map new grading structure to existing columns
      var record = {
        ticket_number: ticket.ticket_number,
        ticket_type: ticket.ticket_type || "",
        store: ticket.store || "",
        employee_added: ticket.employee_added || "",
        employee_repaired: ticket.employee_repaired || "",
        customer_name: ticket.customer_name || "",
        customer_phone: ticket.customer_phone ? ticket.customer_phone.replace(/\D/g, "").slice(-10) : "",
        customer_phones_all: ticket.customer_phones_all || [],
        device: ticket.device || "",
        device_category: ticket.device_category || "",
        device_brand: ticket.device_brand || "",
        date_closed: parseSafeDate(ticket.date_closed),
        gross_sales: parseFloat(ticket.gross_sales || 0),
        gross_profit: parseFloat(ticket.gross_profit || 0),
        gpm_pct: parseFloat(ticket.gpm_pct || 0),
        discount_amount: parseFloat(ticket.discount_amount || 0),
        total_cost: parseFloat(ticket.total_cost || 0),
        total_collected: parseFloat(ticket.total_collected || 0),
        payment_method: (ticket.payment_method || "").substring(0, 50),
        turnaround_hours: parseFloat(ticket.turnaround_hours || 0),
        item_details: ticket.structured_items || [],
        overall_score: grade.overall_score || 0,
        // Section 1: Intake/Diagnostics
        diagnostics_score: grade.diagnostics_score || 0,
        diagnostics_notes: grade.diagnostics_notes || "",
        // Section 2: Repair Notes → stored in notes_score/notes_detail
        notes_score: grade.repair_notes_score || 0,
        notes_detail: grade.repair_notes_detail || "",
        notes_outcome_documented: !!grade.repair_service_documented,
        notes_customer_contacted: !!grade.pickup_customer_contacted,
        // Section 3: Pickup → stored in categorization_score/categorization_notes
        categorization_score: grade.pickup_score || 0,
        categorization_notes: grade.pickup_notes || "",
        // Section 4: Payment
        payment_score: grade.payment_score || 0,
        payment_notes: grade.payment_notes || (grade.payment_not_applicable ? "Payment N/A — no parts ordered" : ""),
        raw_diagnostics: ticket.raw_diagnostics || "",
        raw_notes: ticket.raw_notes || "",
        raw_items: ticket.raw_items || "",
        raw_transactions: ticket.raw_transactions || "",
        confidence: grade.confidence || 0,
        contact_score: grade.contact_score || 0,
        contact_notes: grade.contact_notes || "",
        graded_by: "extension",
      };

      var { data, error } = await supabase.from("ticket_grades")
        .upsert(record, { onConflict: "ticket_number" }).select();
      if (error) return jsonResponse({ success: false, error: error.message });

      return jsonResponse({ success: true, grade: grade, saved: data?.[0] });
    } catch (err) {
      console.error("Grading error:", err);
      return jsonResponse({ success: false, error: err.message });
    }
  }

  if (body.action === "check_graded") {
    // Given a list of ticket numbers, return which ones already have a grade.
    // The Chrome extension uses this to skip already-graded tickets during a
    // batch run, so a re-run after a RepairQ timeout only grades what's left.
    var nums = Array.isArray(body.ticket_numbers) ? body.ticket_numbers : [];
    nums = nums.map(function(n) { return String(n).trim(); }).filter(Boolean);
    if (nums.length === 0) return jsonResponse({ success: true, graded: [] });
    var checkRes = await supabase.from("ticket_grades")
      .select("ticket_number")
      .in("ticket_number", nums);
    if (checkRes.error) return jsonResponse({ success: false, error: checkRes.error.message });
    var gradedSet = (checkRes.data || []).map(function(r) { return String(r.ticket_number); });
    return jsonResponse({ success: true, graded: gradedSet });
  }

  if (body.action === "delete") {
    var { id } = body;
    if (!id) return jsonResponse({ success: false, error: "id required" });
    var { error } = await supabase.from("ticket_grades").delete().eq("id", id);
    if (error) return jsonResponse({ success: false, error: error.message });
    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, error: "Invalid action" });
}

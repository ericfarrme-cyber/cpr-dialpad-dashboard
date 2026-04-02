'use client';

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

export default function AIAssistant({ isOpen, onClose }) {
  var auth = useAuth();
  var [messages, setMessages] = useState([
    { role: "assistant", content: "I've loaded your complete business data across all three stores — current month plus 3 months of history. I have employee scores, call records, audit results, ticket compliance, sales, appointments, schedules, reviews, and profitability data.\n\nI cross-reference everything automatically. Ask me anything:\n\n• \"Who is our most effective employee and why?\"\n• \"What's costing us the most revenue right now?\"\n• \"Give me a coaching plan for the Indianapolis team\"\n• \"Compare store performance — who's improving, who's declining?\"\n• \"What patterns do you see in our missed calls?\"\n• \"Build me a 1:1 agenda for my meeting with Luke\"" }
  ]);
  var [input, setInput] = useState("");
  var [loading, setLoading] = useState(false);
  var [contextLoaded, setContextLoaded] = useState(false);
  var [businessContext, setBusinessContext] = useState("");
  var messagesEndRef = useRef(null);
  var inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(function() {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Focus input when opened
  useEffect(function() {
    if (isOpen && inputRef.current) {
      setTimeout(function() { inputRef.current.focus(); }, 200);
    }
  }, [isOpen]);

  // Load business context on first open
  useEffect(function() {
    if (isOpen && !contextLoaded) {
      loadContext();
    }
  }, [isOpen]);

  var loadContext = async function() {
    try {
      var now = new Date();
      var currentPeriod = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");

      // Compute previous months for historical context
      var prevMonths = [];
      for (var pmi = 1; pmi <= 3; pmi++) {
        var pmd = new Date(now.getFullYear(), now.getMonth() - pmi, 1);
        prevMonths.push(pmd.getFullYear() + "-" + String(pmd.getMonth() + 1).padStart(2, "0"));
      }

      var results = await Promise.allSettled([
        fetch("/api/dialpad/scorecard?period=" + currentPeriod).then(function(r){return r.json();}),
        fetch("/api/dialpad/tickets?action=stats").then(function(r){return r.json();}),
        fetch("/api/dialpad/audit?action=stores").then(function(r){return r.json();}),
        fetch("/api/dialpad/audit?action=employees").then(function(r){return r.json();}),
        fetch("/api/dialpad/insights?days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/stored?days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=stats&days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/appointments?action=list&days=60").then(function(r){return r.json();}),
        fetch("/api/dialpad/sales?action=performance").then(function(r){return r.json();}),
        fetch("/api/dialpad/roster").then(function(r){return r.json();}),
        fetch("/api/dialpad/profitability").then(function(r){return r.json();}),
        fetch("/api/dialpad/repeat-callers?days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/google-reviews?store=fishers").then(function(r){return r.json();}),
        fetch("/api/dialpad/google-reviews?store=bloomington").then(function(r){return r.json();}),
        fetch("/api/dialpad/google-reviews?store=indianapolis").then(function(r){return r.json();}),
        fetch("/api/dialpad/weekly-goal?store=fishers").then(function(r){return r.json();}),
        fetch("/api/dialpad/weekly-goal?store=bloomington").then(function(r){return r.json();}),
        fetch("/api/dialpad/weekly-goal?store=indianapolis").then(function(r){return r.json();}),
        fetch("/api/dialpad/voicemails").then(function(r){return r.json();}),
        fetch("/api/wheniwork?action=today").then(function(r){return r.json();}),
        fetch("/api/wheniwork?action=shifts&start=" + new Date(Date.now() - 7*86400000).toISOString().split("T")[0] + "&end=" + new Date(Date.now() + 7*86400000).toISOString().split("T")[0]).then(function(r){return r.json();}),
        // Historical scorecards (last 3 months)
        fetch("/api/dialpad/scorecard?period=" + prevMonths[0]).then(function(r){return r.json();}),
        fetch("/api/dialpad/scorecard?period=" + prevMonths[1]).then(function(r){return r.json();}),
        fetch("/api/dialpad/scorecard?period=" + prevMonths[2]).then(function(r){return r.json();}),
      ]);

      function g(i) { return results[i] && results[i].status === "fulfilled" ? results[i].value : null; }

      var context = "COMPLETE BUSINESS DATA — " + now.toLocaleDateString() + "\nFocused Technologies — 3 CPR Cell Phone Repair stores (Fishers, Bloomington, Indianapolis)\n\n";

      // ═══ EMPLOYEE SCORECARD ═══
      var scorecard = g(0);
      if (scorecard && scorecard.success) {
        context += "═══ EMPLOYEE SCORECARD (" + currentPeriod + ") ═══\n";
        context += "Weights: Repairs " + Math.round((scorecard.empWeights.repairs||0.35)*100) + "% + Audit " + Math.round((scorecard.empWeights.audit||0.35)*100) + "% + Compliance " + Math.round((scorecard.empWeights.compliance||0.30)*100) + "%\n\n";
        (scorecard.employeeScores || []).forEach(function(e) {
          context += e.name + " (" + e.store + (e.role ? ", " + e.role : "") + "): Overall " + e.overall + "/100";
          context += " | Repairs: " + (e.repairs ? e.repairs.score : 0) + " (phones:" + (e.repairs ? e.repairs.phone_tickets : 0) + " other:" + (e.repairs ? e.repairs.other_tickets : 0) + " accyGP:$" + (e.repairs ? Math.round(e.repairs.accy_gp || 0) : 0) + " cleans:" + (e.repairs ? e.repairs.clean_count : 0) + ")";
          context += " | Audit: " + (e.audit ? e.audit.score : 0) + " (avg:" + (e.audit ? e.audit.avg_pct : 0) + "% appt:" + (e.audit ? e.audit.appt_rate : 0) + "% warranty:" + (e.audit ? e.audit.warranty_rate : 0) + "% audited:" + (e.audit ? e.audit.total_audits : 0) + ")";
          context += " | Compliance: " + (e.compliance ? e.compliance.score : 0) + " (" + (e.compliance ? e.compliance.tickets_graded : 0) + " tickets)";
          context += "\n";
        });
        context += "\n═══ STORE RANKINGS ═══\n";
        (scorecard.ranked || []).forEach(function(s, i) {
          context += "#" + (i+1) + " " + s.store_name + ": " + s.overall + "/100";
          if (s.categories) {
            context += " | Repairs:" + s.categories.revenue.score + " Audit:" + s.categories.audit.score + " Calls:" + s.categories.calls.score + " CX:" + s.categories.experience.score + " Compliance:" + (s.categories.compliance ? s.categories.compliance.score : 0);
            if (s.categories.calls.details) {
              var cd = s.categories.calls.details;
              context += " | CallDetails(answered:" + cd.answer_rate + "% callback:" + cd.callback_rate + "% vmReturn:" + cd.vm_return_rate + "% inbound:" + cd.total_inbound + " missed:" + cd.missed + ")";
            }
          }
          context += "\n";
        });
        context += "\n";
      }

      // ═══ HISTORICAL SCORECARDS (Previous 3 months) ═══
      [{ idx: 21, period: prevMonths[0] }, { idx: 22, period: prevMonths[1] }, { idx: 23, period: prevMonths[2] }].forEach(function(item) {
        var hist = g(item.idx);
        if (hist && hist.success) {
          var monthLabel = new Date(item.period + "-15").toLocaleDateString(undefined, { month: "long", year: "numeric" });
          context += "═══ SCORECARD — " + monthLabel + " ═══\n";
          (hist.employeeScores || []).forEach(function(e) {
            context += e.name + " (" + e.store + "): Overall " + e.overall;
            context += " | Repairs:" + (e.repairs ? e.repairs.score : 0) + " (phones:" + (e.repairs ? e.repairs.phone_tickets : 0) + " other:" + (e.repairs ? e.repairs.other_tickets : 0) + " accyGP:$" + (e.repairs ? Math.round(e.repairs.accy_gp || 0) : 0) + ")";
            context += " | Audit:" + (e.audit ? e.audit.score : 0) + " | Compliance:" + (e.compliance ? e.compliance.score : 0);
            context += "\n";
          });
          if (hist.ranked && hist.ranked.length > 0) {
            context += "Store rankings: ";
            context += hist.ranked.map(function(s, i) { return "#" + (i+1) + " " + (s.store_name || s.store) + " " + s.overall; }).join(", ");
            context += "\n";
          }
          context += "\n";
        }
      });
      var stored = g(5);
      if (stored && stored.success && stored.data) {
        var sd = stored.data;
        context += "═══ CALL PERFORMANCE (Last 30 Days) ═══\n";
        if (sd.dailyCalls && sd.dailyCalls.length > 0) {
          context += "Daily call breakdown (date | store: total/answered/missed):\n";
          sd.dailyCalls.forEach(function(d) {
            var parts = [];
            ["fishers","bloomington","indianapolis"].forEach(function(sk) {
              var t = d[sk + "_total"] || 0;
              var a = d[sk + "_answered"] || 0;
              var m = d[sk + "_missed"] || (t - a);
              if (t > 0) parts.push(sk + ": " + t + "/" + a + "/" + m);
            });
            if (parts.length > 0) context += "  " + d.date + " — " + parts.join(" | ") + "\n";
          });
          context += "\n";
        }
        if (sd.storePerf) {
          context += "Per-store call totals:\n";
          sd.storePerf.forEach(function(sp) {
            context += "  " + sp.store + ": " + (sp.total_calls||0) + " calls, " + (sp.answered||0) + " answered, " + (sp.missed||0) + " missed, rate " + (sp.answer_rate||0) + "%\n";
          });
          context += "\n";
        }
        if (sd.hourlyMissed && sd.hourlyMissed.length > 0) {
          context += "Missed calls by hour of day:\n";
          sd.hourlyMissed.forEach(function(h) {
            var total = (h.fishers||0) + (h.bloomington||0) + (h.indianapolis||0);
            if (total > 0) context += "  " + h.hour + ": fishers=" + (h.fishers||0) + " bloomington=" + (h.bloomington||0) + " indianapolis=" + (h.indianapolis||0) + " (total=" + total + ")\n";
          });
          context += "\n";
        }
        if (sd.dowData || sd.dowMissed) {
          var dowArr = sd.dowData || sd.dowMissed;
          context += "Missed calls by day of week:\n";
          dowArr.forEach(function(d) {
            context += "  " + d.day + ": fishers=" + (d.fishers||0) + " bloomington=" + (d.bloomington||0) + " indianapolis=" + (d.indianapolis||0) + "\n";
          });
          context += "\n";
        }
        if (sd.callbackData) {
          context += "Callback performance:\n";
          sd.callbackData.forEach(function(cb) {
            context += "  " + cb.store + ": " + (cb.missed||0) + " missed, " + (cb.calledBack||cb.called_back||0) + " called back";
            context += ", within30min:" + (cb.within30||0) + " within60min:" + (cb.within60||0) + " later:" + (cb.later||0) + " never:" + (cb.never||0) + "\n";
          });
          context += "\n";
        }
        if (sd.problemCalls) {
          context += "Problem call breakdown:\n";
          sd.problemCalls.forEach(function(p) {
            context += "  " + p.type + ": fishers=" + (p.fishers||0) + " bloomington=" + (p.bloomington||0) + " indianapolis=" + (p.indianapolis||0) + "\n";
          });
          context += "\n";
        }
      }

      // ═══ TICKET COMPLIANCE ═══
      var ticketStats = g(1);
      if (ticketStats && ticketStats.success && ticketStats.stats) {
        var ts = ticketStats.stats;
        context += "═══ TICKET COMPLIANCE ═══\n";
        context += "Total graded: " + ts.total + " | Avg overall: " + ts.avgOverall + "/100\n";
        context += "Avg Diagnostics: " + ts.avgDiag + " | Avg Notes: " + ts.avgNotes + " | Avg Payment: " + ts.avgPay + "\n";
        if (ts.empStats) {
          context += "Per employee compliance:\n";
          ts.empStats.forEach(function(e) {
            context += "  " + e.name + ": " + e.avg_score + "/100 (" + e.count + " tickets)\n";
          });
        }
        if (ts.storeStats) {
          context += "Per store compliance:\n";
          ts.storeStats.forEach(function(s) {
            context += "  " + s.store + ": " + s.avg_score + "/100 (" + s.count + " tickets)\n";
          });
        }
        context += "\n";
      }

      // ═══ CALL AUDITS ═══
      var storeAudits = g(2);
      if (storeAudits && storeAudits.success && storeAudits.stores) {
        context += "═══ CALL AUDIT BY STORE ═══\n";
        storeAudits.stores.forEach(function(s) {
          context += s.store + ": avg " + (s.avg_score || 0).toFixed(1) + "/4, " + s.total_audits + " calls audited";
          context += ", appt rate: " + Math.round((s.appt_rate||0)*100) + "%, warranty: " + Math.round((s.warranty_rate||0)*100) + "%\n";
        });
        context += "\n";
      }

      var empAudits = g(3);
      if (empAudits && empAudits.success && empAudits.employees) {
        context += "═══ CALL AUDIT BY EMPLOYEE ═══\n";
        empAudits.employees.forEach(function(e) {
          context += e.name + " (" + e.store + "): avg " + (e.avg_score || 0).toFixed(2) + "/4, " + e.total_audits + " calls";
          context += " | appt: " + Math.round((e.appt_rate||0)*100) + "%, discount: " + Math.round((e.discount_rate||0)*100) + "%, warranty: " + Math.round((e.warranty_rate||0)*100) + "%\n";
        });
        context += "\n";
      }

      // ═══ SALES DATA ═══
      var sales = g(8);
      if (sales && sales.success) {
        context += "═══ SALES DATA (Current Period) ═══\n";
        if (sales.phones && sales.phones.length > 0) {
          context += "Phone repairs by employee:\n";
          sales.phones.forEach(function(r) {
            context += "  " + r.employee + ": " + (r.repair_tickets||0) + " tickets, $" + (Math.round(parseFloat(r.repair_total)||0)) + " revenue\n";
          });
        }
        if (sales.others && sales.others.length > 0) {
          context += "Other repairs by employee:\n";
          sales.others.forEach(function(r) {
            context += "  " + r.employee + ": " + (r.repair_count||0) + " tickets, $" + (Math.round(parseFloat(r.repair_total)||0)) + " revenue\n";
          });
        }
        if (sales.accessories && sales.accessories.length > 0) {
          context += "Accessory sales by employee:\n";
          sales.accessories.forEach(function(r) {
            context += "  " + r.employee + ": " + (r.accy_count||0) + " items, $" + (Math.round(parseFloat(r.accy_gp)||0)) + " GP\n";
          });
        }
        if (sales.cleanings && sales.cleanings.length > 0) {
          context += "Cleaning sales by employee:\n";
          sales.cleanings.forEach(function(r) {
            context += "  " + r.employee + ": " + (r.clean_count || r.ticket_count || 0) + " cleanings\n";
          });
        }
        context += "\n";
      }

      // ═══ APPOINTMENTS ═══
      var apptStats = g(6);
      if (apptStats && apptStats.success) {
        context += "═══ APPOINTMENT STATS (Last 30 Days) ═══\n";
        var as = apptStats.stats || {};
        context += "Total: " + (as.total||0) + " | Arrived: " + (as.arrived||0) + " | Converted: " + (as.converted||0) + " | No-show: " + (as.noShow||0) + " | Show rate: " + (as.showRate||0) + "%\n";
        context += "Pending follow-up: " + (as.needFollowUp||0) + " | Pending: " + (as.pending||0) + "\n";
        if (apptStats.empStats && apptStats.empStats.length > 0) {
          context += "Appointments by employee:\n";
          apptStats.empStats.forEach(function(e) {
            context += "  " + e.name + ": " + e.total + " booked, " + e.arrived + " arrived, " + e.no_show + " no-shows, " + e.show_rate + "% show rate\n";
          });
        }
        if (apptStats.storeStats && apptStats.storeStats.length > 0) {
          context += "Appointments by store:\n";
          apptStats.storeStats.forEach(function(s) {
            context += "  " + s.store + ": " + s.total + " booked, " + s.arrived + " arrived, " + s.show_rate + "% show rate\n";
          });
        }
        context += "\n";
      }

      var apptList = g(7);
      if (apptList && apptList.success && apptList.appointments) {
        var recentAppts = apptList.appointments.slice(0, 30);
        if (recentAppts.length > 0) {
          context += "═══ RECENT APPOINTMENTS (Last 30) ═══\n";
          recentAppts.forEach(function(a) {
            context += a.date_of_appt + " " + (a.appt_time||"") + " | " + a.customer_name + " | " + (a.reason||"") + " | Status: " + (a.did_arrive||"Pending") + " | Store: " + (a.store||"") + " | By: " + (a.scheduled_by||"") + "\n";
          });
          context += "\n";
        }
      }

      // ═══ EMPLOYEE ROSTER ═══
      var roster = g(9);
      if (roster && roster.success && roster.roster) {
        context += "═══ EMPLOYEE ROSTER ═══\n";
        roster.roster.filter(function(r){return r.active;}).forEach(function(r) {
          context += r.name + " — " + (r.store||"unknown") + " — " + (r.role||"employee") + "\n";
        });
        context += "\n";
      }

      // ═══ PROFITABILITY ═══
      var profit = g(10);
      if (profit && profit.success && profit.data) {
        context += "═══ PROFITABILITY / P&L ═══\n";
        profit.data.forEach(function(p) {
          context += p.store + " (" + p.period + "): Revenue $" + (Math.round(p.revenue||0)).toLocaleString() + " | Expenses $" + (Math.round(p.total_expenses||0)).toLocaleString() + " | Net $" + (Math.round(p.net_income||0)).toLocaleString() + "\n";
        });
        context += "\n";
      }

      // ═══ REPEAT CALLERS ═══
      var repeats = g(11);
      if (repeats && repeats.success && repeats.callers && repeats.callers.length > 0) {
        context += "═══ REPEAT CALLERS (Last 7 Days) ═══\n";
        repeats.callers.slice(0, 15).forEach(function(c) {
          context += c.phone + " — " + c.call_count + " calls to " + (c.store||"unknown") + (c.customer_name ? " (" + c.customer_name + ")" : "") + "\n";
        });
        context += "\n";
      }

      // ═══ GOOGLE REVIEWS ═══
      [{ idx: 12, store: "Fishers" }, { idx: 13, store: "Bloomington" }, { idx: 14, store: "Indianapolis" }].forEach(function(item) {
        var rev = g(item.idx);
        if (rev && rev.success) {
          context += "═══ GOOGLE REVIEWS — " + item.store + " ═══\n";
          if (rev.current) {
            context += "This month: " + (rev.current.total_reviews||0) + " reviews, " + (rev.current.photo_reviews||0) + " with photos, " + (rev.current.employee_count||0) + " employees\n";
          }
          if (rev.latestReport) {
            var rpt = rev.latestReport;
            context += "Latest GBP report (" + (rpt.period_start||"") + " to " + (rpt.period_end||"") + "): ";
            context += "Calls:" + (rpt.customer_calls||0) + " Views:" + (rpt.profile_views||0) + " Visits:" + (rpt.website_visits||0) + " Directions:" + (rpt.direction_requests||0) + " Reviews:+" + (rpt.received_reviews||0) + "\n";
            if (rpt.keywords && rpt.keywords.length > 0) {
              context += "Top keywords: ";
              context += rpt.keywords.map(function(k) { return k.keyword + " (#" + k.position + ")"; }).join(", ") + "\n";
            }
          }
          context += "\n";
        }
      });

      // ═══ WEEKLY GOALS ═══
      [{ idx: 15, store: "Fishers" }, { idx: 16, store: "Bloomington" }, { idx: 17, store: "Indianapolis" }].forEach(function(item) {
        var goal = g(item.idx);
        if (goal && goal.success && goal.goal) {
          context += "═══ WEEKLY GOAL — " + item.store + " ═══\n";
          context += "Goal: " + goal.goal.goal_title + "\n";
          context += "Description: " + goal.goal.goal_description + "\n";
          if (goal.goal.metric_baseline) context += "Baseline: " + goal.goal.metric_baseline + " → Target: " + goal.goal.metric_target + "\n";
          context += "Coaching tip: " + (goal.goal.coaching_tip || "") + "\n\n";
        }
      });

      // ═══ VOICEMAILS ═══
      var vms = g(18);
      if (vms && vms.success && vms.voicemails && vms.voicemails.length > 0) {
        context += "═══ VOICEMAILS (Unreturned) ═══\n";
        context += "Total unreturned: " + vms.voicemails.length + "\n";
        vms.voicemails.slice(0, 10).forEach(function(v) {
          context += "  " + (v.store||"") + " | " + v.external_number + " | " + new Date(v.date_started).toLocaleString() + "\n";
        });
        context += "\n";
      }

      // ═══ EMPLOYEE SCHEDULES (WhenIWork) ═══
      var todayShifts = g(19);
      var weekShifts = g(20);

      if ((todayShifts && todayShifts.success) || (weekShifts && weekShifts.success)) {
        context += "═══ EMPLOYEE SCHEDULES (WhenIWork) ═══\n";

        if (todayShifts && todayShifts.success && todayShifts.shifts && todayShifts.shifts.length > 0) {
          context += "TODAY'S SCHEDULE:\n";
          todayShifts.shifts.forEach(function(s) {
            var start = s.start_time ? new Date(s.start_time).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}) : "?";
            var end = s.end_time ? new Date(s.end_time).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}) : "?";
            context += "  " + (s.employee || "Unknown") + " | " + (s.location || "") + " | " + start + " — " + end + " | " + (s.position || "") + "\n";
          });
          context += "\n";
        }

        if (weekShifts && weekShifts.success && weekShifts.shifts && weekShifts.shifts.length > 0) {
          context += "SHIFTS (Last 7 days + Next 7 days):\n";
          // Group by date
          var byDate = {};
          weekShifts.shifts.forEach(function(s) {
            var dateKey = s.start_time ? s.start_time.split("T")[0] || s.start_time.substring(0, 10) : "unknown";
            if (!byDate[dateKey]) byDate[dateKey] = [];
            byDate[dateKey].push(s);
          });
          Object.keys(byDate).sort().forEach(function(dateKey) {
            var dayName = new Date(dateKey + "T12:00:00").toLocaleDateString([], {weekday:"short",month:"short",day:"numeric"});
            context += "  " + dayName + ":\n";
            byDate[dateKey].forEach(function(s) {
              var start = s.start_time ? new Date(s.start_time).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}) : "?";
              var end = s.end_time ? new Date(s.end_time).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}) : "?";
              context += "    " + (s.employee || "Unknown") + " @ " + (s.location || "") + " " + start + "-" + end + " (" + (s.position || "") + ")\n";
            });
          });
          context += "\n";
        }
      }

      // ═══ INSIGHTS ═══
      var insights = g(4);
      if (insights && insights.success) {
        context += "═══ INSIGHTS & COACHING ═══\n";
        if (insights.summary) {
          context += "Callback rate: " + (insights.summary.callbackRate || 0) + "%\n";
        }
        if (insights.employeeCorrelation) {
          insights.employeeCorrelation.forEach(function(e) {
            if (e.coaching && e.coaching.length > 0) {
              context += e.name + " coaching notes: " + e.coaching.join("; ") + "\n";
            }
          });
        }
        if (insights.callbacks && insights.callbacks.length > 0) {
          context += "Post-repair callbacks (potential issues):\n";
          insights.callbacks.slice(0, 10).forEach(function(cb) {
            context += "  Ticket #" + cb.ticket_number + " " + cb.customer_name + " — " + cb.callback_count + " calls, " + cb.days_after + " days after close (repaired by " + cb.employee_repaired + ")\n";
          });
        }
        context += "\n";
      }

      setBusinessContext(context);
      setContextLoaded(true);
    } catch(e) {
      console.error("Failed to load AI context:", e);
      setBusinessContext("(Business data could not be loaded — answering from general knowledge only)");
      setContextLoaded(true);
    }
  };

  var sendMessage = async function() {
    if (!input.trim() || loading) return;
    var userMsg = input.trim();
    setInput("");
    setMessages(function(prev) { return prev.concat({ role: "user", content: userMsg }); });
    setLoading(true);

    try {
      // Build conversation history for the API
      var apiMessages = [];

      // System context as first user message + assistant acknowledgement
      var systemPrompt = "You are the chief operations intelligence engine for Focused Technologies — a company running three CPR Cell Phone Repair stores (Fishers, Bloomington, Indianapolis) in Indiana. The owner is Eric Farr. You operate with the analytical rigor of a top-tier management consultant and the operational intuition of someone who has run multi-location service businesses for decades.\n\n" +

        "YOUR OPERATING PRINCIPLES:\n\n" +

        "1. CROSS-REFERENCE EVERYTHING. Never answer from a single data source. When asked about an employee, pull their repair numbers, audit scores, compliance grades, appointment conversion, call handling, AND schedule data together. Identify contradictions (e.g. 'high repair count but zero accessory GP suggests they're not upselling').\n\n" +

        "2. THINK IN SYSTEMS. Every metric connects to revenue. Missed calls = lost appointments = lost repairs = lost revenue. Poor ticket compliance = warranty issues = customer callbacks = reputation damage. Always trace the chain.\n\n" +

        "3. SPOT WHAT OTHERS MISS. Look for:\n" +
        "   - Employees who score high in one area but collapse in another (hidden weaknesses)\n" +
        "   - Stores where answer rates drop at specific hours (staffing gaps)\n" +
        "   - Month-over-month trends (who's improving vs declining vs stagnant)\n" +
        "   - Correlations between employee schedule times and missed call spikes\n" +
        "   - Employees with zero data in a category (are they avoiding it or not being measured?)\n" +
        "   - Outliers — both positive and negative\n\n" +

        "4. QUANTIFY EVERYTHING. Don't say 'needs improvement' — say 'scoring 33% on appointment offers vs the team average of 67%, which means approximately 15 missed appointment bookings this month at an average ticket of $120 = ~$1,800 in potentially lost revenue.'\n\n" +

        "5. BE PROACTIVE. After answering the question asked, add 1-2 things the user DIDN'T ask about but SHOULD know. Flag anomalies, emerging problems, or hidden wins.\n\n" +

        "6. HISTORICAL AWARENESS. You have multiple months of data. Always consider trends. An employee at 45/100 who was at 30 last month is IMPROVING and should be encouraged. An employee at 65/100 who was at 80 last month is DECLINING and needs intervention. Context matters more than snapshots.\n\n" +

        "7. ACTIONABLE COACHING. When providing coaching advice, give EXACT scripts and talking points. Not 'discuss their phone skills' but 'Hey [name], I listened to some of your recent calls and noticed you offered appointments on only 33% of opportunity calls. Let me show you a technique — after giving the customer a quote, try saying: Would you like me to get you scheduled so we can knock this out today or tomorrow? That one question can double your booking rate.'\n\n" +

        "8. COMPARE AND RANK. When analyzing performance, always show where someone stands relative to peers. Humans are motivated by relative position. 'You're #3 out of 11 employees' hits differently than 'your score is 65.'\n\n" +

        "9. IDENTIFY ROOT CAUSES. If a store has low scores, dig into WHY. Is it one employee dragging down the average? Is it a staffing problem? Is it a training gap? Is it a specific time of day? Don't just report — diagnose.\n\n" +

        "10. REVENUE IMPACT. Connect everything back to money. Eric runs a business. Every insight should implicitly or explicitly answer: 'What does this cost us and what would fixing it be worth?'\n\n" +

        "RESPONSE STYLE:\n" +
        "- Lead with the key insight or answer — don't bury it\n" +
        "- Use specific numbers, names, and dates — never generic advice\n" +
        "- Bold key findings with ** markers\n" +
        "- Keep responses focused and structured, but don't be robotic\n" +
        "- If you don't have data to answer something, say exactly what's missing and suggest how to get it\n" +
        "- When comparing months, show the delta (arrows or +/- numbers)\n\n" +

        "Here is the complete business data across multiple months:\n\n" + businessContext;

      apiMessages.push({ role: "user", content: systemPrompt });
      apiMessages.push({ role: "assistant", content: "I have all the current business data loaded. How can I help?" });

      // Add conversation history (skip the initial welcome message)
      messages.forEach(function(m, i) {
        if (i === 0) return; // skip welcome
        apiMessages.push({ role: m.role, content: m.content });
      });
      apiMessages.push({ role: "user", content: userMsg });

      var res = await fetch("/api/dialpad/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
      });
      var json = await res.json();

      if (json.success && json.reply) {
        setMessages(function(prev) { return prev.concat({ role: "assistant", content: json.reply }); });
      } else {
        setMessages(function(prev) { return prev.concat({ role: "assistant", content: "Sorry, I encountered an error: " + (json.error || "Unknown error") }); });
      }
    } catch(e) {
      setMessages(function(prev) { return prev.concat({ role: "assistant", content: "Connection error. Please try again." }); });
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div style={{ position:"fixed",top:0,right:0,bottom:0,width:460,background:"#12141A",borderLeft:"1px solid #2A2D35",zIndex:10000,display:"flex",flexDirection:"column",fontFamily:"-apple-system,sans-serif",boxShadow:"-8px 0 32px rgba(0,0,0,0.3)" }}>
      {/* Header */}
      <div style={{ padding:"16px 20px",borderBottom:"1px solid #2A2D35",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <div style={{ width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#7B2FFF,#00D4FF)",display:"flex",alignItems:"center",justifyContent:"center" }}>
            <span style={{ color:"#FFF",fontSize:16 }}>{"\u2728"}</span>
          </div>
          <div>
            <div style={{ color:"#F0F1F3",fontSize:14,fontWeight:700 }}>AI Assistant</div>
            <div style={{ color:contextLoaded?"#4ADE80":"#FBBF24",fontSize:10 }}>{contextLoaded ? "Business data loaded" : "Loading data..."}</div>
          </div>
        </div>
        <button onClick={onClose}
          style={{ width:28,height:28,borderRadius:6,border:"1px solid #2A2D35",background:"transparent",color:"#8B8F98",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center" }}>
          {"\u2715"}
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex:1,overflowY:"auto",padding:"16px 20px" }}>
        {messages.map(function(msg, i) {
          var isUser = msg.role === "user";
          return (
            <div key={i} style={{ marginBottom:16,display:"flex",justifyContent:isUser?"flex-end":"flex-start" }}>
              <div style={{
                maxWidth:"85%",
                padding:"10px 14px",
                borderRadius:isUser?"12px 12px 2px 12px":"12px 12px 12px 2px",
                background:isUser?"#7B2FFF":"#1A1D23",
                border:isUser?"none":"1px solid #2A2D35",
                color:"#F0F1F3",
                fontSize:13,
                lineHeight:1.5,
                whiteSpace:"pre-wrap",
                wordBreak:"break-word",
              }}>
                {msg.content}
              </div>
            </div>
          );
        })}
        {loading && (
          <div style={{ marginBottom:16,display:"flex",justifyContent:"flex-start" }}>
            <div style={{ padding:"10px 14px",borderRadius:"12px 12px 12px 2px",background:"#1A1D23",border:"1px solid #2A2D35" }}>
              <div style={{ display:"flex",gap:4 }}>
                <span style={{ width:6,height:6,borderRadius:"50%",background:"#7B2FFF",animation:"pulse 1.2s infinite" }} />
                <span style={{ width:6,height:6,borderRadius:"50%",background:"#7B2FFF",animation:"pulse 1.2s infinite 0.2s" }} />
                <span style={{ width:6,height:6,borderRadius:"50%",background:"#7B2FFF",animation:"pulse 1.2s infinite 0.4s" }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding:"12px 20px",borderTop:"1px solid #2A2D35",flexShrink:0 }}>
        <div style={{ display:"flex",gap:8 }}>
          <input ref={inputRef}
            type="text" value={input}
            onChange={function(e){setInput(e.target.value);}}
            onKeyDown={function(e){ if(e.key==="Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }}}
            placeholder={contextLoaded ? "Ask about your business..." : "Loading business data..."}
            disabled={!contextLoaded}
            style={{ flex:1,padding:"10px 14px",borderRadius:10,border:"1px solid #2A2D35",background:"#0F1117",color:"#F0F1F3",fontSize:13,outline:"none" }}
            onFocus={function(e){e.target.style.borderColor="#7B2FFF";}}
            onBlur={function(e){e.target.style.borderColor="#2A2D35";}} />
          <button onClick={sendMessage} disabled={loading || !contextLoaded || !input.trim()}
            style={{ padding:"10px 16px",borderRadius:10,border:"none",background:loading||!contextLoaded?"#2A2D35":"linear-gradient(135deg,#7B2FFF,#00D4FF)",color:"#FFF",fontSize:13,fontWeight:700,cursor:loading?"wait":"pointer",flexShrink:0 }}>
            Send
          </button>
        </div>
        <div style={{ display:"flex",gap:6,marginTop:8,flexWrap:"wrap" }}>
          {["What's costing us the most revenue?","Who needs intervention this week?","Store performance trends","Build a coaching plan"].map(function(q) {
            return <button key={q} onClick={function(){setInput(q);}}
              style={{ padding:"4px 8px",borderRadius:4,border:"1px solid #2A2D35",background:"transparent",color:"#6B6F78",fontSize:9,cursor:"pointer" }}>{q}</button>;
          })}
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
    </div>
  );
}

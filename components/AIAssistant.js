'use client';

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";

export default function AIAssistant({ isOpen, onClose }) {
  var auth = useAuth();
  var [messages, setMessages] = useState([
    { role: "assistant", content: "Hey! I'm your Focused Technologies AI assistant. I have access to all your store data — call audits, ticket grades, employee scores, schedules, and customer journeys.\n\nAsk me anything about your business, like:\n• \"How is Matthew Slade performing this month?\"\n• \"Which employees need coaching on phone skills?\"\n• \"What are the most common repair issues at Bloomington?\"\n• \"Give me talking points for coaching Luke on ticket documentation\"\n• \"Which customers had bad experiences recently?\"" }
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
      var results = await Promise.allSettled([
        fetch("/api/dialpad/scorecard?days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/tickets?action=stats").then(function(r){return r.json();}),
        fetch("/api/dialpad/audit?action=stores").then(function(r){return r.json();}),
        fetch("/api/dialpad/audit?action=employees").then(function(r){return r.json();}),
        fetch("/api/dialpad/insights?days=30").then(function(r){return r.json();}),
        fetch("/api/dialpad/customer-journey?action=journeys&days=30").then(function(r){return r.json();}),
      ]);

      var context = "BUSINESS DATA SNAPSHOT (Last 30 days):\n\n";

      // Scorecard data
      var scorecard = results[0].status === "fulfilled" ? results[0].value : null;
      if (scorecard && scorecard.success) {
        context += "═══ EMPLOYEE SCORES ═══\n";
        (scorecard.employeeScores || []).forEach(function(e) {
          context += e.name + " (" + e.store + "): Overall " + e.overall + "/100";
          if (e.categories) {
            var cats = [];
            Object.keys(e.categories).forEach(function(k) { cats.push(k + ": " + e.categories[k].score); });
            context += " [" + cats.join(", ") + "]";
          }
          context += "\n";
        });
        context += "\n═══ STORE RANKINGS ═══\n";
        (scorecard.ranked || []).forEach(function(s, i) {
          context += "#" + (i+1) + " " + s.store + ": " + s.overall + "/100\n";
        });
        context += "\n";
      }

      // Ticket compliance stats
      var ticketStats = results[1].status === "fulfilled" ? results[1].value : null;
      if (ticketStats && ticketStats.success && ticketStats.stats) {
        var ts = ticketStats.stats;
        context += "═══ TICKET COMPLIANCE ═══\n";
        context += "Total graded: " + ts.total + " | Avg overall: " + ts.avgOverall + "/100\n";
        context += "Avg Intake: " + ts.avgDiag + " | Avg Repair Notes: " + ts.avgNotes + " | Avg Payment: " + ts.avgPay + "\n";
        if (ts.empStats) {
          context += "Per employee compliance:\n";
          ts.empStats.forEach(function(e) {
            context += "  " + e.name + ": " + e.avg_score + "/100 (" + e.count + " tickets)\n";
          });
        }
        context += "\n";
      }

      // Audit store performance
      var storeAudits = results[2].status === "fulfilled" ? results[2].value : null;
      if (storeAudits && storeAudits.success && storeAudits.stores) {
        context += "═══ CALL AUDIT BY STORE ═══\n";
        storeAudits.stores.forEach(function(s) {
          context += s.store + ": avg " + (s.avg_score || 0).toFixed(1) + "/4, " + s.total_audits + " calls audited\n";
        });
        context += "\n";
      }

      // Audit employee performance
      var empAudits = results[3].status === "fulfilled" ? results[3].value : null;
      if (empAudits && empAudits.success && empAudits.employees) {
        context += "═══ CALL AUDIT BY EMPLOYEE ═══\n";
        empAudits.employees.forEach(function(e) {
          context += e.name + " (" + e.store + "): avg " + (e.avg_score || 0).toFixed(2) + "/4, " + e.total_audits + " calls";
          context += " | appt: " + Math.round((e.appt_rate||0)*100) + "%, discount: " + Math.round((e.discount_rate||0)*100) + "%, warranty: " + Math.round((e.warranty_rate||0)*100) + "%\n";
        });
        context += "\n";
      }

      // Insights
      var insights = results[4].status === "fulfilled" ? results[4].value : null;
      if (insights && insights.success) {
        context += "═══ INSIGHTS ═══\n";
        context += "Callback rate: " + (insights.summary.callbackRate || 0) + "%\n";
        if (insights.employeeCorrelation) {
          insights.employeeCorrelation.forEach(function(e) {
            if (e.coaching && e.coaching.length > 0) {
              context += e.name + " coaching notes: " + e.coaching.join("; ") + "\n";
            }
          });
        }
        if (insights.callbacks && insights.callbacks.length > 0) {
          context += "Recent post-repair callbacks:\n";
          insights.callbacks.slice(0, 10).forEach(function(cb) {
            context += "  #" + cb.ticket_number + " " + cb.customer_name + " — " + cb.callback_count + " callbacks, " + cb.days_after + " days after close (repaired by " + cb.employee_repaired + ")\n";
          });
        }
        context += "\n";
      }

      // Customer journeys
      var journeys = results[5].status === "fulfilled" ? results[5].value : null;
      if (journeys && journeys.success) {
        context += "═══ CUSTOMER EXPERIENCE ═══\n";
        context += "Customers matched (call+ticket): " + journeys.stats.total_customers_cross_referenced + "\n";
        context += "Avg CX score: " + (journeys.stats.avg_cx_score || "N/A") + "/100\n";
        context += "Flagged customers: " + journeys.stats.total_flagged + "\n";
        if (journeys.journeys) {
          var flagged = journeys.journeys.filter(function(j){return j.flags.length > 0;});
          if (flagged.length > 0) {
            context += "Top flagged customers:\n";
            flagged.slice(0, 10).forEach(function(j) {
              context += "  " + (j.customer_name || j.phone) + ": CX " + (j.cx_score||"?") + ", flags: " + j.flags.join(", ") + "\n";
            });
          }
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
      var systemPrompt = "You are the AI assistant for Focused Technologies, a company operating three CPR Cell Phone Repair stores (Fishers, Bloomington, and Indianapolis in Indiana). You help the owner (Eric) and managers analyze business performance, coach employees, and improve operations.\n\n" +
        "IMPORTANT GUIDELINES:\n" +
        "- Be specific and actionable. Reference actual employee names, scores, and data.\n" +
        "- When coaching, provide specific talking points and examples.\n" +
        "- When analyzing performance, compare across employees and stores.\n" +
        "- Be direct and concise — this is an operations dashboard, not a general chat.\n" +
        "- If asked about something not in the data, say so clearly.\n" +
        "- Format responses with clear sections when appropriate, but keep them readable.\n\n" +
        "Here is the current business data:\n\n" + businessContext;

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
          {["Who needs coaching?","Store performance summary","Top performers this month","Recent customer complaints"].map(function(q) {
            return <button key={q} onClick={function(){setInput(q);}}
              style={{ padding:"4px 8px",borderRadius:4,border:"1px solid #2A2D35",background:"transparent",color:"#6B6F78",fontSize:9,cursor:"pointer" }}>{q}</button>;
          })}
        </div>
      </div>

      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }`}</style>
    </div>
  );
}

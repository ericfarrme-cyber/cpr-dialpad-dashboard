// Popup UI — grade the current ticket or launch a batch from a report page
var gradeBtn = document.getElementById("gradeBtn");
var batchBtn = document.getElementById("batchBtn");
var statusEl = document.getElementById("status");
var scorePreview = document.getElementById("scorePreview");
var overallScore = document.getElementById("overallScore");
var scoreDetails = document.getElementById("scoreDetails");

function showStatus(type, text) {
  statusEl.className = "status show " + type;
  statusEl.textContent = text;
}

function scoreColor(s) { return s >= 80 ? "#4ADE80" : s >= 60 ? "#FBBF24" : "#F87171"; }

// `grade` is the raw model output, whose fields are named repair_notes_score /
// pickup_* etc. `saved` is the row actually written to the database, using the
// column names. Prefer saved: it is both correctly named and the thing that will
// show up on the dashboard. Reading the raw object is why Notes and
// Categorization displayed "undefined" while the stored values were fine.
function showScore(grade, saved) {
  var s = saved || grade || {};
  var pick = function(a, b) { return s[a] != null ? s[a] : (grade && grade[b] != null ? grade[b] : null); };
  var overall = pick("overall_score", "overall_score");
  overallScore.textContent = (overall == null ? "—" : overall + "/100");
  overallScore.style.color = scoreColor(overall || 0);
  var rows = [
    { label: "Diagnostics", score: pick("diagnostics_score", "diagnostics_score") },
    { label: "Payment", score: pick("payment_score", "payment_score") },
    { label: "Notes", score: pick("notes_score", "repair_notes_score") },
    { label: "Categorization", score: pick("categorization_score", "categorization_score") },
    { label: "Contact", score: pick("contact_score", "contact_score") },
  ].filter(function(r) { return r.score != null; });
  scoreDetails.innerHTML = rows.map(function(item) {
    return '<div class="score-row"><span class="score-label">' + item.label + '</span><span class="score-val" style="color:' + scoreColor(item.score) + '">' + item.score + '</span></div>';
  }).join("");
  scorePreview.className = "score-preview show";
}

// ═══ SINGLE TICKET GRADE ═══
gradeBtn.addEventListener("click", function() {
  gradeBtn.disabled = true;
  gradeBtn.textContent = "Grading...";
  showStatus("progress", "Extracting ticket data and sending to AI...");

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { action: "grade_current" }, function(response) {
      if (chrome.runtime.lastError) {
        // Same orphaned-content-script case as the batch path below.
        showStatus("error", "This page needs a refresh. The extension was reloaded, so the " +
          "script on this tab is stale. Press F5 here, then try again.");
        gradeBtn.disabled = false;
        gradeBtn.textContent = "Grade This Ticket";
        return;
      }
      if (response && response.success && response.grade) {
        showStatus("success", "Ticket graded and saved to dashboard!");
        showScore(response.grade, response.saved);
        gradeBtn.textContent = "✓ Graded";
      } else {
        showStatus("error", response ? (response.error || "Unknown error") : "No response from page");
        gradeBtn.textContent = "Try Again";
      }
      setTimeout(function() {
        gradeBtn.disabled = false;
        gradeBtn.textContent = "Grade This Ticket";
      }, 3000);
    });
  });
});

// ═══ BATCH GRADE ═══
// The action popup closes the moment the ticket tab navigates (Chrome force-closes
// popups on focus loss), so progress is shown in a separate standalone window that
// the background worker opens. This handler just kicks the batch off.
function startBatch(btn, idleLabel, force, only) {
  btn.disabled = true;
  btn.textContent = force ? "Starting re-grade..." : "Starting batch...";
  showStatus("progress", "Reading ticket links from report page...");

  function reset() {
    btn.disabled = false;
    btn.textContent = idleLabel;
    btn.classList.remove("confirming");
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { action: "get_report_tickets" }, function(response) {
      if (chrome.runtime.lastError) {
        // The content script is not reachable. Almost always this means the
        // extension was reloaded while this tab was already open, which orphans
        // the injected script — it stays on the page but stops receiving
        // messages. A page refresh re-injects it.
        showStatus("error", "This page needs a refresh. The extension was reloaded, so the " +
          "script on this tab is stale. Press F5 here, then try again.");
        reset();
        return;
      }
      if (!response || !response.success) {
        showStatus("error", "Couldn't read tickets from this page. Make sure you're on " +
          "Reports > Ticket Profitability with results showing.");
        reset();
        return;
      }

      var links = response.links || [];
      if (links.length === 0) {
        showStatus("error", "No ticket links found on this page.");
        reset();
        return;
      }

      // Optional filter: only grade tickets whose number is in `only`. Used by
      // the ticket-list mode. We filter the report's OWN links rather than
      // building URLs from ticket numbers, so RepairQ's real hrefs are always
      // used and there is no URL format to guess wrong.
      var missing = [];
      if (only) {
        var have = {};
        links.forEach(function(l) { have[String(l.ticket_number)] = true; });
        Object.keys(only).forEach(function(num) { if (!have[num]) missing.push(num); });
        links = links.filter(function(l) { return only[String(l.ticket_number)]; });
        if (links.length === 0) {
          showStatus("error", "None of those " + Object.keys(only).length +
            " tickets are on this report page. Widen the report's date range so they appear, then try again.");
          reset();
          return;
        }
      }

      showStatus("progress", "Found " + links.length + " tickets. Opening progress window...");

      // Store the job, then let the background worker open the progress window
      // and run the batch. The window stays open and shows live progress.
      chrome.storage.local.set({
        batchJob: {
          links: links,
          currentIndex: 0,
          results: [],
          tabId: tabs[0].id,
          status: "running",
          // Tells runBatch() to skip the already-graded lookup and do them all.
          forceRegrade: !!force
        }
      }, function() {
        chrome.runtime.sendMessage({ action: "start_batch", force: !!force });
        var msg = (force ? "Re-grading " : "Grading ") + links.length + " tickets — watch the progress window.";
        // Never silently drop requested tickets: say which ones were not found.
        if (missing.length) {
          msg += " " + missing.length + " of your " + (links.length + missing.length) +
                 " were not on this page: " + missing.slice(0, 8).join(", ") +
                 (missing.length > 8 ? "…" : "");
        }
        showStatus(missing.length ? "progress" : "success", msg);
        reset();
      });
    });
  });
}

batchBtn.addEventListener("click", function() {
  startBatch(batchBtn, "Batch Grade Report Page", false);
});

// ═══ FORCE RE-GRADE ═══
// Two-step: re-grading every ticket on a report costs an AI call each and can
// run for a long time, so one stray click should not start it.
var regradeBtn = document.getElementById("regradeBtn");
var regradeArmed = false;
var regradeTimer = null;

regradeBtn.addEventListener("click", function() {
  if (!regradeArmed) {
    regradeArmed = true;
    regradeBtn.classList.add("confirming");
    regradeBtn.textContent = "Click again to re-grade ALL";
    showStatus("progress", "This re-grades every ticket on the page, including ones already graded.");
    regradeTimer = setTimeout(function() {
      regradeArmed = false;
      regradeBtn.classList.remove("confirming");
      regradeBtn.textContent = "Re-grade Report Page";
    }, 5000);
    return;
  }
  clearTimeout(regradeTimer);
  regradeArmed = false;
  regradeBtn.classList.remove("confirming");
  startBatch(regradeBtn, "Re-grade Report Page", true);
});

// ═══ RE-GRADE A SPECIFIC LIST OF TICKETS ═══
// Re-grading a whole report to fix a handful of rows is wasteful: it is one AI
// call per ticket. This grades only the numbers pasted below, matched against
// the links already on the current report page.
var listBtn = document.getElementById("listBtn");
var listPanel = document.getElementById("listPanel");
var ticketList = document.getElementById("ticketList");
var listInfo = document.getElementById("listInfo");
var listRunBtn = document.getElementById("listRunBtn");

function parseTicketNumbers(text) {
  var seen = {};
  var out = [];
  var parts = String(text || "").split(/[^0-9]+/);
  for (var i = 0; i < parts.length; i++) {
    var v = parts[i];
    if (!v || v.length < 4) continue;   // ticket numbers are 5+ digits
    if (seen[v]) continue;
    seen[v] = true;
    out.push(v);
  }
  return out;
}

function refreshListInfo() {
  var nums = parseTicketNumbers(ticketList.value);
  listInfo.textContent = nums.length
    ? nums.length + " ticket number" + (nums.length === 1 ? "" : "s") + " recognised — each will be opened directly by number."
    : "Paste ticket numbers above. Any separator works; duplicates are ignored.";
}

listBtn.addEventListener("click", function() {
  var showing = listPanel.classList.toggle("show");
  listBtn.textContent = showing ? "Hide Ticket List" : "Re-grade Ticket List…";
  if (showing) { refreshListInfo(); ticketList.focus(); }
});

ticketList.addEventListener("input", refreshListInfo);

// Ticket URLs are built directly rather than harvested from a report page.
// RepairQ's profitability report paginates at 100 rows, and the content script
// only sees the page currently rendered — so a list spanning months could never
// be matched against it. Ticket pages are addressable as /ticket/<number>
// (confirmed against 16340083), so we navigate straight to each one and the
// report's pagination stops mattering. You only need to be on any RepairQ page.
var REPAIRQ_TICKET_URL = "https://cpr.repairq.io/ticket/";

listRunBtn.addEventListener("click", function() {
  var nums = parseTicketNumbers(ticketList.value);
  if (!nums.length) {
    showStatus("error", "No ticket numbers found in that text.");
    return;
  }

  listRunBtn.disabled = true;
  listRunBtn.textContent = "Starting re-grade...";

  function reset() {
    listRunBtn.disabled = false;
    listRunBtn.textContent = "Re-grade these tickets";
  }

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    var tab = tabs && tabs[0];
    if (!tab || !/^https:\/\/cpr\.repairq\.io\//.test(tab.url || "")) {
      showStatus("error", "Open any RepairQ page in this tab first — the batch navigates it through each ticket.");
      reset();
      return;
    }

    var links = nums.map(function(v) {
      return { url: REPAIRQ_TICKET_URL + v, ticket_number: v };
    });

    chrome.storage.local.set({
      batchJob: {
        links: links,
        currentIndex: 0,
        results: [],
        tabId: tab.id,
        status: "running",
        forceRegrade: true
      }
    }, function() {
      chrome.runtime.sendMessage({ action: "start_batch", force: true });
      showStatus("success", "Re-grading " + links.length +
        " tickets by ticket number — no report page needed. Watch the progress window.");
      reset();
    });
  });
});

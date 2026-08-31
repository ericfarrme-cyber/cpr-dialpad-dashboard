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

function showScore(grade) {
  overallScore.textContent = grade.overall_score + "/100";
  overallScore.style.color = scoreColor(grade.overall_score);
  scoreDetails.innerHTML = [
    { label: "Diagnostics", score: grade.diagnostics_score },
    { label: "Payment", score: grade.payment_score },
    { label: "Notes", score: grade.notes_score },
    { label: "Categorization", score: grade.categorization_score },
  ].map(function(item) {
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
        showStatus("error", "Not on a RepairQ ticket page, or page not loaded yet.");
        gradeBtn.disabled = false;
        gradeBtn.textContent = "Grade This Ticket";
        return;
      }
      if (response && response.success && response.grade) {
        showStatus("success", "Ticket graded and saved to dashboard!");
        showScore(response.grade);
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
function startBatch(btn, idleLabel, force) {
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
      if (chrome.runtime.lastError || !response || !response.success) {
        showStatus("error", "Not on a profitability report page, or no tickets found.");
        reset();
        return;
      }

      var links = response.links || [];
      if (links.length === 0) {
        showStatus("error", "No ticket links found on this page.");
        reset();
        return;
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
        chrome.runtime.sendMessage({ action: "start_batch" });
        showStatus("success", (force ? "Re-grading all " : "Grading ") + links.length +
          " tickets — watch the progress window.");
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

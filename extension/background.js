// Background service worker — handles batch ticket grading
var API_BASE = "https://cpr-dialpad-dashboard.vercel.app/api/dialpad/tickets";

// Hard ceilings so NO single step can freeze the batch loop. This is the fix for
// "stops on a ticket and won't continue": every await below is time-bounded, so a
// slow grade call, an unresponsive content script, or a stuck page fails THAT one
// ticket and the loop advances instead of hanging forever.
var EXTRACT_TIMEOUT_MS = 30000; // content script must answer within 30s
var GRADE_TIMEOUT_MS   = 60000; // grading API (runs the LLM) abort ceiling
var CHECK_TIMEOUT_MS   = 20000; // "which tickets are already graded?" lookup
var EXTRACT_RETRIES    = 3;     // retry a not-yet-ready DOM a few times
var LOAD_TIMEOUT_MS    = 15000; // max wait for the tab to report loaded
var SETTLE_MS          = 2000;  // initial DOM settle after load
var RETRY_GAP_MS       = 1500;  // gap between extract retries
var BETWEEN_TICKETS_MS = 1500;  // pause between tickets
var HEARTBEAT_MS       = 20000; // keep the MV3 service worker awake during long grades

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.action === "start_batch") {
    openProgressWindow();
    runBatch();
  }
  if (msg.action === "grade_ticket") {
    gradeTicket(msg.ticket).then(function(result) {
      sendResponse(result);
    }).catch(function(err) {
      sendResponse({ success: false, error: err.message });
    });
    return true; // keep message port open for async response
  }
});

async function runBatch() {
  var data = await chrome.storage.local.get("batchJob");
  var job = data.batchJob;
  if (!job || job.status !== "running") return;

  var links = job.links;
  var tabId = job.tabId;

  // ── Skip already-graded tickets ──
  // Ask the dashboard which of these ticket numbers already have a grade, and
  // skip those. This makes a re-run after a RepairQ timeout cheap: only the
  // ungraded tickets get re-navigated and re-graded. If the lookup fails for any
  // reason, we fall back to grading everything (safe default).
  var alreadyGraded = {};
  try {
    var nums = links.map(function(l) { return String(l.ticket_number); });
    var checkRes = await checkGraded(nums, CHECK_TIMEOUT_MS);
    if (checkRes && checkRes.success && Array.isArray(checkRes.graded)) {
      checkRes.graded.forEach(function(n) { alreadyGraded[String(n)] = true; });
    }
  } catch (e) {
    // ignore — grade everything
  }
  job.skippedCount = 0;
  await chrome.storage.local.set({ batchJob: job });

  for (var i = 0; i < links.length; i++) {
    // Update progress (also keeps the service worker active each iteration)
    job.currentIndex = i;
    await chrome.storage.local.set({ batchJob: job });

    // Already graded → record as skipped and move on without touching the page.
    if (alreadyGraded[String(links[i].ticket_number)]) {
      job.results.push({ ticket: links[i].ticket_number, success: true, skipped: true, score: null, error: null });
      job.skippedCount = (job.skippedCount || 0) + 1;
      await chrome.storage.local.set({ batchJob: job });
      continue;
    }

    try {
      // Navigate to ticket page
      await chrome.tabs.update(tabId, { url: links[i].url });

      // Wait for page to load (already bounded), then let the DOM settle
      await waitForTabLoad(tabId);
      await sleep(SETTLE_MS);

      // Extract — retry a not-ready DOM a few times. Each attempt is
      // timeout-guarded so a silent/unloaded content script can't hang us.
      var extractResult = null;
      for (var attempt = 0; attempt < EXTRACT_RETRIES; attempt++) {
        extractResult = await sendTabMessage(tabId, { action: "extract_ticket" }, EXTRACT_TIMEOUT_MS);
        if (extractResult && extractResult.success && extractResult.data && extractResult.data.ticket_number) break;
        if (attempt < EXTRACT_RETRIES - 1) await sleep(RETRY_GAP_MS);
      }

      if (!extractResult || !extractResult.success || !extractResult.data) {
        job.results.push({
          ticket: links[i].ticket_number,
          success: false,
          error: (extractResult && extractResult.error) || "Extract failed / timed out",
        });
        await chrome.storage.local.set({ batchJob: job });
        await sleep(BETWEEN_TICKETS_MS);
        continue;
      }

      // Mark this ticket as actively grading so the progress window can show a
      // live elapsed timer (proof of life — distinguishes "slow" from "frozen").
      job.gradingTicket = links[i].ticket_number;
      job.gradingStartedAt = Date.now();
      await chrome.storage.local.set({ batchJob: job });

      // Heartbeat: write to storage every 20s WHILE grading so the MV3 service
      // worker can't go idle during a long grade call and kill the loop.
      var hb = setInterval(function() {
        chrome.storage.local.set({ ftHeartbeat: Date.now() });
      }, HEARTBEAT_MS);

      // Grade via API — abort-guarded so a slow/stuck grading call (heavy tickets
      // produce large prompts) fails THIS ticket instead of freezing the batch.
      var gradeResult;
      try {
        gradeResult = await gradeTicket(extractResult.data, GRADE_TIMEOUT_MS);
      } finally {
        clearInterval(hb);
      }
      job.gradingTicket = null;
      job.gradingStartedAt = null;
      job.results.push({
        ticket: links[i].ticket_number,
        success: !!gradeResult.success,
        score: gradeResult.grade ? gradeResult.grade.overall_score : null,
        error: gradeResult.error || null,
      });
      await chrome.storage.local.set({ batchJob: job });

      // Brief pause between tickets
      await sleep(BETWEEN_TICKETS_MS);
    } catch (err) {
      job.gradingTicket = null;
      job.gradingStartedAt = null;
      job.results.push({
        ticket: links[i].ticket_number,
        success: false,
        error: err && err.message ? err.message : String(err),
      });
      await chrome.storage.local.set({ batchJob: job });
      await sleep(BETWEEN_TICKETS_MS);
    }
  }

  job.status = "complete";
  await chrome.storage.local.set({ batchJob: job });
}

function waitForTabLoad(tabId) {
  return new Promise(function(resolve) {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(tid, info) {
      if (tid === tabId && info.status === "complete") finish();
    }
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout so a SPA navigation that never fires "complete" can't hang us
    setTimeout(finish, LOAD_TIMEOUT_MS);
  });
}

// sendMessage with a hard timeout. Always RESOLVES (never rejects/hangs) so the
// loop can always make a decision and move on.
function sendTabMessage(tabId, message, timeoutMs) {
  return new Promise(function(resolve) {
    var settled = false;
    function done(v) {
      if (settled) return;
      settled = true;
      resolve(v);
    }
    var timer = setTimeout(function() {
      done({ success: false, error: "Content script timed out after " + (timeoutMs || EXTRACT_TIMEOUT_MS) + "ms" });
    }, timeoutMs || EXTRACT_TIMEOUT_MS);
    try {
      chrome.tabs.sendMessage(tabId, message, function(response) {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          done({ success: false, error: chrome.runtime.lastError.message });
        } else {
          done(response || { success: false, error: "Empty response" });
        }
      });
    } catch (e) {
      clearTimeout(timer);
      done({ success: false, error: e.message });
    }
  });
}

// Ask the dashboard which of the given ticket numbers already have a grade.
// Abort-guarded so a slow/stuck lookup can't delay the batch start.
async function checkGraded(ticketNumbers, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs || CHECK_TIMEOUT_MS);
  try {
    var res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_graded", ticket_numbers: ticketNumbers }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return { success: false, error: e && e.name === "AbortError" ? "check_graded timed out" : e.message };
  }
}

async function gradeTicket(ticketData, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs || GRADE_TIMEOUT_MS);
  try {
    var res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "grade", ticket: ticketData }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e && e.name === "AbortError") {
      return { success: false, error: "Grading timed out after " + (timeoutMs || GRADE_TIMEOUT_MS) + "ms" };
    }
    return { success: false, error: e.message };
  }
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

// Open (or focus) a standalone progress window. Unlike the action popup, a real
// window is NOT tied to the toolbar, so navigating the ticket tab can't close it.
// It stays open the whole run and waits for the user to close it.
var progressWindowId = null;
function openProgressWindow() {
  function create() {
    chrome.windows.create(
      {
        url: chrome.runtime.getURL("progress.html"),
        type: "popup",
        width: 400,
        height: 620,
      },
      function(win) {
        if (win) progressWindowId = win.id;
      }
    );
  }
  if (progressWindowId != null) {
    // If a previous progress window is still open, reuse/focus it; otherwise make a new one.
    chrome.windows.get(progressWindowId, {}, function(win) {
      if (chrome.runtime.lastError || !win) {
        progressWindowId = null;
        create();
      } else {
        chrome.windows.update(progressWindowId, { focused: true });
      }
    });
  } else {
    create();
  }
}

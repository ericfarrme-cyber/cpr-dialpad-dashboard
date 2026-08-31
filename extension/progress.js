// Standalone batch-progress window. Polls chrome.storage.local for the live
// batchJob the background worker writes on every iteration, and renders progress.
// Stays open until the user closes it (no auto-close).

var counter = document.getElementById("counter");
var barFill = document.getElementById("barFill");
var pctLabel = document.getElementById("pctLabel");
var passCount = document.getElementById("passCount");
var skipCount = document.getElementById("skipCount");
var failCount = document.getElementById("failCount");
var list = document.getElementById("list");
var emptyMsg = document.getElementById("emptyMsg");
var doneBanner = document.getElementById("doneBanner");
var closeBtn = document.getElementById("closeBtn");

closeBtn.addEventListener("click", function() { window.close(); });

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render(job) {
  if (!job) {
    counter.textContent = "No active batch.";
    return;
  }

  // Mode + build. If this line is missing or shows an old build, the MV3 service
  // worker is stale and is ignoring whatever you just changed in background.js —
  // which otherwise looks exactly like a successful run that skipped everything.
  var modeLine = document.getElementById("modeLine");
  if (modeLine) {
    var buildTxt = job.build ? ("build " + job.build) : "build UNKNOWN — stale service worker";
    if (job.forceRegrade) {
      modeLine.textContent = "FORCE RE-GRADE — ignoring already-graded · " + buildTxt;
      modeLine.style.color = "#FBBF24";
    } else {
      modeLine.textContent = "Normal batch — skips already-graded · " + buildTxt;
      modeLine.style.color = "#6B6F78";
    }
    modeLine.style.display = "block";
  }

  var results = job.results || [];
  var total = (job.links || []).length;
  var done = results.length;
  var running = job.status === "running";
  var complete = job.status === "complete";

  var passed = 0, skipped = 0, failed = 0;
  for (var k = 0; k < results.length; k++) {
    if (results[k].skipped) skipped++;
    else if (results[k].success) passed++;
    else failed++;
  }
  passCount.textContent = passed;
  skipCount.textContent = skipped;
  failCount.textContent = failed;

  var pct = total ? Math.round((done / total) * 100) : 0;
  barFill.style.width = pct + "%";
  pctLabel.textContent = pct + "%";

  if (complete) {
    counter.innerHTML = 'Finished — <span class="big">' + done + "</span> / " + total + " tickets";
    var parts = [passed + " graded"];
    if (skipped) parts.push(skipped + " skipped");
    if (failed) parts.push(failed + " failed");
    doneBanner.textContent = "Batch complete! " + parts.join(" · ") + ".";
    doneBanner.className = "done-banner show";
  } else if (running) {
    var cur = Math.min(done + 1, total);
    counter.innerHTML = 'Grading ticket <span class="big">' + cur + "</span> of " + total + "…";
    doneBanner.className = "done-banner";
  } else {
    counter.textContent = "Starting…";
  }

  // Build the rows: every completed result, plus an in-progress row for the current ticket.
  var rows = "";
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    if (r.skipped) {
      rows += '<div class="row"><span class="dot skip"></span>'
        + '<span class="tk">#' + esc(r.ticket) + '</span>'
        + '<span class="meta skip">already graded</span></div>';
    } else if (r.success) {
      var scoreTxt = (r.score != null) ? (r.score + "/100") : "graded";
      rows += '<div class="row"><span class="dot ok"></span>'
        + '<span class="tk">#' + esc(r.ticket) + '</span>'
        + '<span class="meta ok">' + esc(scoreTxt) + "</span></div>";
    } else {
      rows += '<div class="row"><span class="dot no"></span>'
        + '<span class="tk">#' + esc(r.ticket) + '</span>'
        + '<span class="meta no" title="' + esc(r.error) + '">' + esc(r.error || "failed") + "</span></div>";
    }
  }
  if (running && done < total) {
    var gtk = job.gradingTicket;
    if (!gtk) {
      var links0 = job.links || [];
      var curLink0 = links0[done];
      gtk = curLink0 ? (curLink0.ticket_number || "") : "";
    }
    var label = "grading…";
    if (job.gradingStartedAt) {
      var secs = Math.floor((Date.now() - job.gradingStartedAt) / 1000);
      label = "grading… " + secs + "s";
      if (secs > 62) label = "still working… " + secs + "s";
    }
    rows += '<div class="row"><span class="dot run"></span>'
      + '<span class="tk">#' + esc(gtk) + '</span>'
      + '<span class="meta run">' + esc(label) + "</span></div>";
  }

  if (rows) {
    list.innerHTML = rows;
    // keep the newest row in view
    list.scrollTop = list.scrollHeight;
  } else if (emptyMsg) {
    list.innerHTML = '<div class="empty">Waiting for the first ticket…</div>';
  }
}

function tick() {
  chrome.storage.local.get("batchJob", function(data) {
    render(data ? data.batchJob : null);
  });
}

tick();
var poll = setInterval(tick, 750);

// Stop polling once complete, but leave the window open for the user.
var stopWatcher = setInterval(function() {
  chrome.storage.local.get("batchJob", function(data) {
    var job = data ? data.batchJob : null;
    if (job && job.status === "complete") {
      clearInterval(poll);
      clearInterval(stopWatcher);
      tick(); // final paint
    }
  });
}, 1000);

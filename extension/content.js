// Focused Technologies — RepairQ Ticket Grader Content Script
// Runs on cpr.repairq.io/* pages

(function() {
  var API_BASE = "https://cpr-dialpad-dashboard.vercel.app/api/dialpad/tickets";
  var GRADING_SECRET = "ft-ticket-grader-2026";

  // ═══ UTILITY ═══
  function getText(el) { return el ? el.textContent.trim() : ""; }
  function getAll(selector) { return Array.from(document.querySelectorAll(selector)); }

  // ═══ DETECT PAGE TYPE ═══
  function isTicketPage() {
    return /\/ticket\/\d+/.test(window.location.pathname);
  }
  function isProfitabilityPage() {
    var h1 = document.querySelector("h1, .page-title, .report-title");
    return h1 && getText(h1).toLowerCase().includes("profitability");
  }

  // ═══ EXTRACT TICKET DATA ═══
  function extractTicketData() {
    var data = {};

    // Ticket number — URL first, then fall back to the page itself.
    // The old pattern was /\/ticket\/(\d+)/ against the pathname only. When it
    // missed, ticket_number went out empty and the server rejected the whole
    // grade with "ticket_number required" — an error that says nothing about the
    // real cause and looks like a server problem. Accept /ticket/ and /tickets/
    // and common query-string forms, then fall back to the "Repair Ticket #N"
    // heading and finally the document title.
    var urlPath = window.location.pathname + window.location.search;
    var urlMatch = urlPath.match(/\/tickets?\/(\d+)/i) ||
                   urlPath.match(/[?&](?:id|ticket|ticket_id|ticketNumber)=(\d+)/i);
    data.ticket_number = urlMatch ? urlMatch[1] : "";
    if (!data.ticket_number) {
      var hdrMatch = (document.body ? document.body.innerText : "").match(/Repair\s+Ticket\s*#\s*(\d+)/i);
      if (hdrMatch) data.ticket_number = hdrMatch[1];
    }
    if (!data.ticket_number) {
      var titleMatch = (document.title || "").match(/#\s*(\d+)/);
      if (titleMatch) data.ticket_number = titleMatch[1];
    }
    if (!data.ticket_number) {
      console.error("[FT-extract] Could not determine ticket_number from URL (" + urlPath +
        "), page heading, or title. The grade will be rejected by the server.");
    }

    // Store — extract from the ticket's Summary section on the left sidebar
    // Strategy: get the text of the left column/sidebar only, find CPR [Store] there
    data.store = "";
    // The ticket's REAL store lives in the Summary panel at: #summary .location
    // (a SPAN inside DIV.location.tooltip-toggle inside DIV#summary), shown as
    // "CPR <Store>". This is deterministic. It is NOT the navbar's active-location
    // selector, and NOT the many <option> location dropdowns inside hidden modals
    // (#priceCheck, #appointment-edit-modal, #switchLocation) — those list ALL
    // three stores and previously caused mis-reads. #summary contains none of them.
    var storePattern = /CPR\s+(Fishers|Bloomington|Indianapolis|Indy|Noblesville|Carmel)/i;

    // Primary: the exact element that holds the ticket's own store.
    var locEl = document.querySelector("#summary .location");
    if (locEl) {
      var locMatch = getText(locEl).match(storePattern);
      if (locMatch) data.store = locMatch[1].trim();
    }

    // Fallback 1: anywhere inside the #summary panel. Safe — the multi-store
    // <option> dropdowns live in modals, not in #summary.
    if (!data.store) {
      var summaryEl = document.querySelector("#summary");
      if (summaryEl) {
        var sm = getText(summaryEl).match(storePattern);
        if (sm) data.store = sm[1].trim();
      }
    }

    // Fallback 2: the ticket short-info / breadcrumb block, but only if it has no
    // <select> (so we never read an option list that contains every store).
    if (!data.store) {
      var shortInfo = document.querySelector(".ticket-short-info, #ticket .block-content");
      if (shortInfo && !shortInfo.querySelector("select")) {
        var si = getText(shortInfo).match(storePattern);
        if (si) data.store = si[1].trim();
      }
    }

    console.log("[FT-extract] Store (from #summary .location):", data.store || "(none)");

    // Parse store to key
    var storeText = (data.store || "").toLowerCase();
    if (storeText.includes("fishers")) data.store = "fishers";
    else if (storeText.includes("bloomington")) data.store = "bloomington";
    else if (storeText.includes("indianapolis") || storeText.includes("indy")) data.store = "indianapolis";
    else data.store = "";

    // Ticket type from page header (e.g. "Sale Ticket #15849286", "Repair Ticket #15807154", "Claim Ticket #15813868")
    data.ticket_type = "";
    var ticketTitle = document.querySelector(".ticket-title, h1.page-header, .panel-heading h3, h1");
    if (ticketTitle) {
      var tt = getText(ticketTitle).toLowerCase();
      if (tt.includes("repair")) data.ticket_type = "Repair";
      else if (tt.includes("claim")) data.ticket_type = "Claim";
      else if (tt.includes("sale")) data.ticket_type = "Sale";
    }
    // Fallback: scan all h1/h2/h3 elements for "Sale Ticket", "Repair Ticket", "Claim Ticket"
    if (!data.ticket_type) {
      var headings = document.querySelectorAll("h1, h2, h3, .page-header, div[class*=ticket-title], div[class*=header]");
      for (var hi = 0; hi < headings.length; hi++) {
        var hText = getText(headings[hi]).toLowerCase();
        if (hText.includes("sale ticket")) { data.ticket_type = "Sale"; break; }
        else if (hText.includes("repair ticket")) { data.ticket_type = "Repair"; break; }
        else if (hText.includes("claim ticket")) { data.ticket_type = "Claim"; break; }
      }
    }
    // Fallback: check full page text for the ticket header pattern
    if (!data.ticket_type) {
      var bodyText = (document.body ? document.body.innerText : "").substring(0, 500).toLowerCase();
      if (bodyText.includes("sale ticket")) data.ticket_type = "Sale";
      else if (bodyText.includes("repair ticket")) data.ticket_type = "Repair";
      else if (bodyText.includes("claim ticket")) data.ticket_type = "Claim";
    }
    console.log("[FT-extract] Ticket type:", data.ticket_type || "(unknown)");

    // Employee info from Relations column
    // RepairQ structure: td#relations-col > div.small-italic > "Added by" <a href="/staff/profile/XXX">Last, First</a>
    var employeeAdded = "";
    var employeeRepaired = "";
    var employeeSold = "";
    var relationDivs = getAll("td#relations-col div.small-italic, td[id=relations-col] div.small-italic");
    // Also try without ID in case there are multiple items
    if (relationDivs.length === 0) relationDivs = getAll(".items-list .small-italic");
    
    relationDivs.forEach(function(div) {
      var divText = getText(div);
      var nameLink = div.querySelector("a[href*='/staff/profile/']");
      if (!nameLink) return;
      var fullName = getText(nameLink); // e.g. "Slade, Matthew"
      
      if (divText.includes("Added by")) employeeAdded = fullName;
      if (divText.includes("Repaired by") || divText.includes("Repaiered by")) employeeRepaired = fullName;
      if (divText.includes("Sold by")) employeeSold = fullName;
    });
    
    data.employee_added = employeeAdded || employeeSold;
    data.employee_repaired = employeeRepaired;

    // Customer info — find the Customer section using broad search (RepairQ uses h2 dark bars)
    data.customer_name = "";
    data.customer_email = "";
    console.log("[FT-extract] Starting customer info extraction...");

    // Find Customer section header
    var custHeaderEl = null;
    var custCandidates = document.querySelectorAll("h1, h2, h3, h4, h5, h6, .panel-heading, div[class*=heading]");
    for (var ci = 0; ci < custCandidates.length; ci++) {
      if (custCandidates[ci].textContent.trim() === "Customer") {
        custHeaderEl = custCandidates[ci];
        break;
      }
    }

    // Get the customer section container — need to go BEYOND the header's immediate parent
    var custContainer = null;
    if (custHeaderEl) {
      // Strategy 1: Walk UP to find a broad enough container (col-md-3, sidebar column)
      var ancestor = custHeaderEl.parentElement;
      var walkUp = 0;
      while (ancestor && walkUp < 6) {
        // Check if this ancestor contains phone/email links (signs we're in the right container)
        if (ancestor.querySelector("a[href^='tel:']") || ancestor.querySelector("a[href^='mailto:']")) {
          custContainer = ancestor;
          break;
        }
        // Check if it's a Bootstrap column (typical sidebar wrapper)
        var cls = ancestor.className || "";
        if (cls.includes("col-") || cls.includes("sidebar") || cls.includes("customer")) {
          custContainer = ancestor;
          break;
        }
        ancestor = ancestor.parentElement;
        walkUp++;
      }
      
      // Strategy 2: Collect ALL sibling elements after the Customer header into a virtual container
      if (!custContainer) {
        console.log("[FT-extract] Building virtual customer container from siblings");
        var tempDiv = document.createElement("div");
        var sibling = custHeaderEl.parentElement ? custHeaderEl.parentElement.nextElementSibling : custHeaderEl.nextElementSibling;
        var sibCount = 0;
        while (sibling && sibCount < 15) {
          // Stop if we hit another major section header (Analytics, Summary, etc)
          var sibText = getText(sibling);
          if (/^(Analytics|Summary|Ticket Items|Repair Devices|Transactions|Notes)$/i.test(sibText.trim())) break;
          tempDiv.appendChild(sibling.cloneNode(true));
          sibling = sibling.nextElementSibling;
          sibCount++;
        }
        // Also include the header's own parent
        if (custHeaderEl.parentElement) tempDiv.appendChild(custHeaderEl.parentElement.cloneNode(true));
        custContainer = tempDiv;
      }
    }
    // Fallback selectors
    if (!custContainer) custContainer = document.querySelector("#customer, .customer-section, .customer, .customer-info");

    if (custContainer) {
      var custText = getText(custContainer);
      console.log("[FT-extract] Customer section text: " + custText.substring(0, 200));

      // Name — look for a link in the customer section (RepairQ links customer names)
      var nameLink = custContainer.querySelector("a[href*='/customer/'], a[href*='/customers/']");
      if (nameLink) {
        data.customer_name = getText(nameLink);
      }
      // Fallback: first link that's not a tel: or mailto: link
      if (!data.customer_name) {
        var custLinks = custContainer.querySelectorAll("a");
        for (var cli = 0; cli < custLinks.length; cli++) {
          var href = custLinks[cli].getAttribute("href") || "";
          if (!href.startsWith("tel:") && !href.startsWith("mailto:") && getText(custLinks[cli]).length > 2) {
            data.customer_name = getText(custLinks[cli]);
            break;
          }
        }
      }
      // Fallback: look in bordered box / input-like elements
      if (!data.customer_name) {
        var nameBoxes = custContainer.querySelectorAll("div[style*=border], .form-control, input[type=text]");
        nameBoxes.forEach(function(box) {
          var t = getText(box);
          if (t && t.length > 2 && !t.includes("@") && !t.match(/^\(?\d{3}/) && !data.customer_name) {
            data.customer_name = t;
          }
        });
      }

      // Email — check mailto: links in the customer section first
      var mailLinks = custContainer.querySelectorAll("a[href^='mailto:']");
      if (mailLinks.length > 0) {
        data.customer_email = mailLinks[0].getAttribute("href").replace("mailto:", "").trim();
      }
      // Also check for email icon links (RepairQ uses envelope icon before email)
      if (!data.customer_email) {
        var allCustLinks = custContainer.querySelectorAll("a");
        allCustLinks.forEach(function(link) {
          var linkText = getText(link);
          var linkHref = link.getAttribute("href") || "";
          if (linkText.includes("@") || linkHref.includes("mailto:")) {
            data.customer_email = linkText.includes("@") ? linkText : linkHref.replace("mailto:", "");
          }
        });
      }
      // Scan full text for email pattern
      if (!data.customer_email) {
        var emailMatch = custText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) data.customer_email = emailMatch[0];
      }
    }

    // Fallback for name if still empty
    if (!data.customer_name) {
      var oldNameEl = document.querySelector(".customer-name a, .customer-section a, #customer a");
      if (oldNameEl) data.customer_name = getText(oldNameEl);
    }

    // Fallback for email — scan page-wide for mailto:
    if (!data.customer_email) {
      var globalMailto = document.querySelector("a[href^='mailto:']");
      if (globalMailto) data.customer_email = globalMailto.getAttribute("href").replace("mailto:", "").trim();
    }

    console.log("[FT-extract] Customer name:", data.customer_name || "(none)");
    console.log("[FT-extract] Customer email:", data.customer_email || "(none)");

    // Customer phone number — check primary, alternate, and notes
    var foundPhones = [];
    
    // 1. All tel: links on the page (primary + alternate)
    var allTelLinks = getAll("a[href^='tel:']");
    allTelLinks.forEach(function(link) {
      var ph = link.getAttribute("href").replace("tel:", "").replace(/\D/g, "").slice(-10);
      if (ph.length === 10 && foundPhones.indexOf(ph) < 0) foundPhones.push(ph);
    });
    
    // 2. Customer section — look for any phone patterns
    var custSection = document.querySelector("#customer, .customer-section, .customer, .customer-info");
    if (custSection) {
      var custText = getText(custSection);
      var phoneMatches = custText.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
      phoneMatches.forEach(function(m) {
        var ph = m.replace(/\D/g, "").slice(-10);
        if (ph.length === 10 && foundPhones.indexOf(ph) < 0) foundPhones.push(ph);
      });
    }
    
    // 3. Summary section — sometimes has phone
    var summarySection = document.querySelector("#summary, .summary, .ticket-summary");
    if (summarySection) {
      var sumText = getText(summarySection);
      var sumPhones = sumText.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
      sumPhones.forEach(function(m) {
        var ph = m.replace(/\D/g, "").slice(-10);
        if (ph.length === 10 && foundPhones.indexOf(ph) < 0) foundPhones.push(ph);
      });
    }
    
    // 4. Notes section — customers sometimes leave alternate numbers in notes
    // (raw_notes gets extracted later, so scan the full page notes area now)
    var allElements = getAll("h1, h2, h3, h4, h5, strong, b, th, td, .panel-heading, .section-heading");
    var notesArea = document.querySelector("#notes, .notes, .ticket-notes");
    if (!notesArea) {
      // Find by heading
      allElements.forEach(function(el) {
        if (getText(el).toLowerCase() === "notes" && !notesArea) {
          notesArea = el.closest(".panel, .card, section") || el.parentElement;
        }
      });
    }
    if (notesArea) {
      var notesText = getText(notesArea);
      var notePhones = notesText.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) || [];
      notePhones.forEach(function(m) {
        var ph = m.replace(/\D/g, "").slice(-10);
        if (ph.length === 10 && foundPhones.indexOf(ph) < 0) foundPhones.push(ph);
      });
    }
    
    // Primary phone is first found, all others are alternates
    data.customer_phone = foundPhones[0] || "";
    data.customer_phones_all = foundPhones;
    console.log("[FT-extract] Phones found:", foundPhones.length, foundPhones.join(", "));

    // ═══ DEVICE INFO (from Repair Devices section) ═══
    data.device = "";
    data.device_category = "";
    data.device_brand = "";
    console.log("[FT-extract] Starting device extraction...");

    // Strategy 1: Find "Repair Devices" header and walk to its table
    var deviceHeaderEl = null;
    var devCandidates = document.querySelectorAll("h1, h2, h3, h4, h5, h6, .panel-heading, .section-heading, div[class*=heading], div[class*=header], div[class*=title]");
    for (var dvi = 0; dvi < devCandidates.length; dvi++) {
      var dvText = devCandidates[dvi].textContent.trim();
      if (/^\s*Repair Devices\s*$/i.test(dvText) || dvText === "Repair Devices") {
        deviceHeaderEl = devCandidates[dvi];
        break;
      }
    }

    if (deviceHeaderEl) {
      // Walk up/siblings to find the table
      var devSearchEls = [];
      var devPanel = deviceHeaderEl.closest(".panel, .card, section, [class*=panel], [class*=section], [class*=col]");
      if (devPanel) devSearchEls.push(devPanel);
      if (deviceHeaderEl.parentElement) devSearchEls.push(deviceHeaderEl.parentElement);
      var devSib = deviceHeaderEl.nextElementSibling || (deviceHeaderEl.parentElement ? deviceHeaderEl.parentElement.nextElementSibling : null);
      var devWalk = 0;
      while (devSib && devWalk < 6) { devSearchEls.push(devSib); devSib = devSib.nextElementSibling; devWalk++; }

      for (var dsi = 0; dsi < devSearchEls.length; dsi++) {
        if (data.device) break;
        var devTables = devSearchEls[dsi].tagName === "TABLE" ? [devSearchEls[dsi]] : Array.from(devSearchEls[dsi].querySelectorAll("table"));
        for (var dti = 0; dti < devTables.length; dti++) {
          var devRows = devTables[dti].querySelectorAll("tr");
          if (devRows.length < 2) continue;
          // First data row, first cell = device name
          var dataRow = devRows[1]; // skip header
          var firstCell = dataRow ? dataRow.querySelector("td") : null;
          if (firstCell) {
            var devName = getText(firstCell);
            if (devName && devName.length > 3 && !/^(catalog|description|warranty|serial|password|carrier)$/i.test(devName)) {
              data.device = devName;
              console.log("[FT-extract] Device from Repair Devices table:", devName);
            }
          }
          if (data.device) break;
        }
      }
    }

    // Strategy 2: Extract from "for device:" in Relations text (Ticket Items)
    if (!data.device) {
      var fullText = document.body ? document.body.innerText : "";
      var forDevMatch = fullText.match(/for device:\s*([^\n]+)/i);
      if (forDevMatch) {
        var devStr = forDevMatch[1].replace(/\s*TBD\s*$/, "").trim();
        if (devStr.length > 3) {
          data.device = devStr;
          console.log("[FT-extract] Device from Relations:", devStr);
        }
      }
    }

    // Strategy 3: Legacy selectors
    if (!data.device) {
      var deviceSection = document.querySelector("#repair-devices, .repair-devices");
      if (deviceSection) {
        var dCells = deviceSection.querySelectorAll("td");
        for (var dci = 0; dci < dCells.length; dci++) {
          var t = getText(dCells[dci]);
          if (t && t.length > 3 && !/^(catalog|description|warranty|serial|password|carrier|TBD|N\/A)$/i.test(t)) {
            data.device = t;
            break;
          }
        }
      }
    }

    // ═══ CLASSIFY DEVICE CATEGORY + BRAND ═══
    if (data.device) {
      var devLower = data.device.toLowerCase();

      // Brand detection
      var brands = [
        { pattern: /apple|iphone|ipad|macbook|ipod|imac|apple watch/i, brand: "Apple" },
        { pattern: /samsung|galaxy/i, brand: "Samsung" },
        { pattern: /sony|playstation|ps[45]/i, brand: "Sony" },
        { pattern: /microsoft|xbox|surface/i, brand: "Microsoft" },
        { pattern: /nintendo|switch/i, brand: "Nintendo" },
        { pattern: /motorola|moto /i, brand: "Motorola" },
        { pattern: /google|pixel/i, brand: "Google" },
        { pattern: /lg /i, brand: "LG" },
        { pattern: /oneplus/i, brand: "OnePlus" },
        { pattern: /huawei/i, brand: "Huawei" },
        { pattern: /lenovo|thinkpad/i, brand: "Lenovo" },
        { pattern: /hp |hewlett|pavilion|envy/i, brand: "HP" },
        { pattern: /dell |inspiron|latitude|xps/i, brand: "Dell" },
        { pattern: /asus|zenbook|rog/i, brand: "Asus" },
        { pattern: /acer|aspire|nitro/i, brand: "Acer" },
      ];
      for (var bi = 0; bi < brands.length; bi++) {
        if (brands[bi].pattern.test(data.device)) {
          data.device_brand = brands[bi].brand;
          break;
        }
      }

      // Category detection
      if (/playstation|ps[45]|xbox|nintendo|switch|game\s*console|wii/i.test(devLower)) {
        data.device_category = "game_console";
      } else if (/ipad|tablet|galaxy tab|surface pro|fire hd|kindle/i.test(devLower)) {
        data.device_category = "tablet";
      } else if (/macbook|laptop|notebook|chromebook|thinkpad|inspiron|latitude|pavilion|zenbook|aspire/i.test(devLower)) {
        data.device_category = "laptop";
      } else if (/imac|desktop|pc|computer|mac mini|mac pro|mac studio/i.test(devLower)) {
        data.device_category = "computer";
      } else if (/apple watch|galaxy watch|smartwatch|watch/i.test(devLower)) {
        data.device_category = "watch";
      } else if (/iphone|galaxy s|galaxy a|galaxy z|pixel|moto|phone|note \d|oneplus/i.test(devLower)) {
        data.device_category = "phone";
      } else if (/airpod|earbud|headphone|speaker|beats/i.test(devLower)) {
        data.device_category = "audio";
      } else {
        data.device_category = "other";
      }

      console.log("[FT-extract] Device:", data.device, "| Brand:", data.device_brand, "| Category:", data.device_category);
    }

    // Date — extract BOTH created and closed dates from Summary sidebar
    // RepairQ Summary shows dates with icons: "+" for created, checkmark for closed/fixed
    // Format: "M/D/YY, H:MM AM" e.g. "2/27/26, 11:17 AM"
    data.date_closed = "";
    data.date_created = "";
    console.log("[FT-extract] Starting date extraction...");
    
    // Strategy 1: Find dates in the Summary section (left sidebar)
    // The Summary section has the store name, status, and dates
    var summaryArea = null;
    var leftCols = document.querySelectorAll(".col-md-3, .col-sm-3, .col-lg-3, .col-xs-12");
    for (var lci = 0; lci < leftCols.length; lci++) {
      var colTxt = getText(leftCols[lci]);
      if (colTxt.includes("Summary") || colTxt.includes("Closed") || colTxt.includes("Open")) {
        summaryArea = leftCols[lci];
        break;
      }
    }
    if (!summaryArea) summaryArea = document.querySelector("#summary, .summary, .ticket-summary");
    
    if (summaryArea) {
      var sumText = getText(summaryArea);
      console.log("[FT-extract] Summary text: " + sumText.substring(0, 300));
      // Find all date patterns in the summary
      var datePattern = /(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/gi;
      var dateMatches = [];
      var dmatch;
      while ((dmatch = datePattern.exec(sumText)) !== null) {
        dateMatches.push(dmatch[1] + ", " + dmatch[2]);
      }
      console.log("[FT-extract] Found dates in summary:", JSON.stringify(dateMatches));
      
      // RepairQ typically shows dates in order: closed/updated first, then created
      // But we can be smarter: the EARLIEST date is created, the LATEST is closed
      if (dateMatches.length >= 2) {
        var parsedDates = dateMatches.map(function(ds) {
          var parts = ds.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
          var year = parseInt(parts[3]);
          if (year < 100) year += 2000;
          return { str: ds, date: new Date(parts[1] + "/" + parts[2] + "/" + year + " " + ds.split(",")[1]) };
        }).sort(function(a, b) { return a.date - b.date; });
        data.date_created = parsedDates[0].str;
        data.date_closed = parsedDates[parsedDates.length - 1].str;
      } else if (dateMatches.length === 1) {
        data.date_closed = dateMatches[0];
      }
    }

    // ── A ticket that is not closed has no close date ────────────────────────
    // The block above assigns whatever date it finds to date_closed, including
    // on tickets that have not closed — an open ticket showing only its created
    // date came out looking exactly like a completed sale. daily-profit buckets
    // on date_closed and treats it as "the revenue event", so 121 unclosed
    // tickets were being counted as $28,276 of booked revenue, 48 of them
    // waiting_for_payment (money not yet collected). Measured 2026-08-31 against
    // RepairQ's own report, which excludes them.
    var FT_STATUSES = ["closed", "waiting for payment", "on hold", "new",
                       "pending notification", "in repair", "in diagnosis",
                       "pending approval", "ready for pickup", "invoiced"];
    data.ticket_status = "";
    var statusText = summaryArea ? getText(summaryArea).toLowerCase() : "";
    for (var si = 0; si < FT_STATUSES.length; si++) {
      if (statusText.indexOf(FT_STATUSES[si]) >= 0) {
        data.ticket_status = FT_STATUSES[si].replace(/ /g, "_");
        break;   // list is ordered so "closed" wins if present
      }
    }
    if (data.ticket_status && data.ticket_status !== "closed" && data.date_closed) {
      console.warn("[FT-extract] Ticket " + data.ticket_number + " is '" + data.ticket_status +
        "', not closed — discarding the scraped date so it is not counted as revenue.");
      data.date_closed = "";
    }
    
    // Strategy 2: Fallback to time elements
    if (!data.date_closed) {
      var dateEls = getAll("time, .ticket-date, .date-closed");
      if (dateEls.length > 0) data.date_closed = dateEls[0].getAttribute("datetime") || getText(dateEls[0]);
    }
    
    console.log("[FT-extract] Dates -> created:", JSON.stringify(data.date_created), "closed:", JSON.stringify(data.date_closed));

    // ═══ DIAGNOSTICS ═══
    var diagSection = "";
    console.log("[FT-extract] Starting diagnostics extraction...");
    
    // Approach 1: Find ANY element containing exactly "Initial Diagnostics" and walk siblings
    var allEls = document.querySelectorAll("td, th, div, p, span, h3, h4, h5, h6, label, strong, b");
    var diagLabelEl = null;
    for (var di = 0; di < allEls.length; di++) {
      // Check direct text content (not children) to avoid matching parent containers
      var elText = allEls[di].textContent.trim();
      if (elText === "Initial Diagnostics" || elText === "initial diagnostics") {
        diagLabelEl = allEls[di];
        console.log("[FT-extract] Found 'Initial Diagnostics' label in <" + diagLabelEl.tagName + "> class='" + (diagLabelEl.className || "") + "'");
        break;
      }
    }
    
    if (diagLabelEl) {
      // Strategy A: If it's a <td>, check the same row for other cells, then next row
      if (diagLabelEl.tagName === "TD" || diagLabelEl.tagName === "TH") {
        var diagRow = diagLabelEl.closest("tr");
        if (diagRow) {
          // Check other cells in the same row
          var cells = diagRow.querySelectorAll("td");
          cells.forEach(function(cell) {
            var ct = getText(cell).trim();
            if (ct && ct.toLowerCase() !== "initial diagnostics") diagSection += ct + " ";
          });
          diagSection = diagSection.trim();
          // If nothing in same row, check next row
          if (!diagSection && diagRow.nextElementSibling) {
            diagSection = getText(diagRow.nextElementSibling).trim();
          }
        }
      }
      
      // Strategy B: Walk next siblings of the label element itself
      if (!diagSection) {
        var sibling = diagLabelEl.nextElementSibling;
        var attempts = 0;
        while (sibling && attempts < 5) {
          var sibText = getText(sibling).trim();
          if (sibText && sibText.length > 5 && sibText.toLowerCase() !== "initial diagnostics") {
            diagSection = sibText;
            console.log("[FT-extract] Got diag from next sibling <" + sibling.tagName + ">: " + diagSection.substring(0, 60));
            break;
          }
          sibling = sibling.nextElementSibling;
          attempts++;
        }
      }
      
      // Strategy C: Walk next siblings of the parent row/container
      if (!diagSection) {
        var parentContainer = diagLabelEl.closest("tr") || diagLabelEl.parentElement;
        if (parentContainer) {
          var pSibling = parentContainer.nextElementSibling;
          var pAttempts = 0;
          while (pSibling && pAttempts < 5) {
            var psText = getText(pSibling).trim();
            if (psText && psText.length > 5) {
              diagSection = psText;
              console.log("[FT-extract] Got diag from parent-sibling <" + pSibling.tagName + ">: " + diagSection.substring(0, 60));
              break;
            }
            pSibling = pSibling.nextElementSibling;
            pAttempts++;
          }
        }
      }
    }
    
    // Approach 2: Full page innerText scan (reliable fallback)
    if (!diagSection) {
      console.log("[FT-extract] Falling back to full-page text scan for diagnostics");
      var fullPageText = document.body ? document.body.innerText : "";
      var diagIdx = fullPageText.indexOf("Initial Diagnostics");
      if (diagIdx >= 0) {
        // Get everything after "Initial Diagnostics" header
        var afterDiag = fullPageText.substring(diagIdx + "Initial Diagnostics".length).trim();
        // Stop at the next known section header
        var stopWords = ["Device History", "Custom Forms", "Approvals", "Appointments", "Notes", "Ticket Items", "Transactions"];
        var cutoff = afterDiag.length;
        stopWords.forEach(function(sw) {
          var swIdx = afterDiag.indexOf(sw);
          if (swIdx > 0 && swIdx < cutoff) cutoff = swIdx;
        });
        diagSection = afterDiag.substring(0, Math.min(cutoff, 800)).trim();
        console.log("[FT-extract] Page-scan diag result: " + diagSection.substring(0, 80));
      }
    }
    
    data.raw_diagnostics = diagSection || "(not found on page)";
    console.log("[FT-extract] Final raw_diagnostics: " + data.raw_diagnostics.substring(0, 100));

    // ═══ TICKET ITEMS (structured) ═══
    var itemsSection = "";
    var structuredItems = [];
    console.log("[FT-extract] Starting items extraction...");

    // Strategy 1: Find the "Ticket Items" header and walk to its table
    var itemsHeaderEl = null;
    var itemCandidates = document.querySelectorAll("h1, h2, h3, h4, h5, h6, .panel-heading, .section-heading, div[class*=heading], div[class*=header], div[class*=title]");
    for (var ii = 0; ii < itemCandidates.length; ii++) {
      var iText = itemCandidates[ii].textContent.trim();
      if (/^\s*Ticket Items\s*$/i.test(iText) || iText === "Ticket Items") {
        itemsHeaderEl = itemCandidates[ii];
        console.log("[FT-extract] Found 'Ticket Items' header in <" + itemsHeaderEl.tagName + ">");
        break;
      }
    }

    if (itemsHeaderEl) {
      // Walk up to find panel, then find table within it
      var searchEls = [];
      var itemPanel = itemsHeaderEl.closest(".panel, .card, section, [class*=panel], [class*=section], [class*=col]");
      if (itemPanel) searchEls.push(itemPanel);
      // Also try parent and grandparent
      if (itemsHeaderEl.parentElement) searchEls.push(itemsHeaderEl.parentElement);
      if (itemsHeaderEl.parentElement && itemsHeaderEl.parentElement.parentElement) searchEls.push(itemsHeaderEl.parentElement.parentElement);
      // Walk siblings
      var itemSib = itemsHeaderEl.nextElementSibling || (itemsHeaderEl.parentElement ? itemsHeaderEl.parentElement.nextElementSibling : null);
      var sibWalk = 0;
      while (itemSib && sibWalk < 8) {
        searchEls.push(itemSib);
        itemSib = itemSib.nextElementSibling;
        sibWalk++;
      }

      for (var sei = 0; sei < searchEls.length; sei++) {
        if (itemsSection) break;
        var tables = searchEls[sei].tagName === "TABLE" ? [searchEls[sei]] : Array.from(searchEls[sei].querySelectorAll("table"));
        for (var iti = 0; iti < tables.length; iti++) {
          var rows = tables[iti].querySelectorAll("tr");
          if (rows.length < 2) continue; // skip empty/header-only tables
          rows.forEach(function(row) {
            var cells = row.querySelectorAll("th, td");
            var rowText = Array.from(cells).map(getText).join(" | ");
            itemsSection += rowText + "\n";
          });
          // Parse structured items from this table
          var headerRow = tables[iti].querySelector("tr");
          var headerCells = headerRow ? Array.from(headerRow.querySelectorAll("th, td")).map(function(c) { return getText(c).toLowerCase(); }) : [];
          var dataRows = Array.from(rows).slice(1); // skip header
          dataRows.forEach(function(row) {
            var cells = Array.from(row.querySelectorAll("td"));
            if (cells.length < 3) return;
            // Skip bundled-with sub-header rows (they have a dark background label)
            var firstCellText = getText(cells[0]);
            if (firstCellText.toLowerCase().startsWith("bundled with")) return;

            var item = {};
            item.catalog_item = firstCellText;
            // Detect item category from catalog name
            var catLower = firstCellText.toLowerCase();
            if (catLower.includes("repair") || catLower.includes("replacement") || catLower.includes("screen") || catLower.includes("battery") || catLower.includes("lcd")) {
              item.category = catLower.includes("screen protector") || catLower.includes("tempered glass") || catLower.includes("casper") ? "accessory" : "repair";
            } else if (catLower.includes("accessory") || catLower.includes("case") || catLower.includes("charger") || catLower.includes("cable") || catLower.includes("power") || catLower.includes("screen protector") || catLower.includes("tempered glass") || catLower.includes("casper")) {
              item.category = "accessory";
            } else if (catLower.includes("part") || catLower.includes("component")) {
              item.category = "part";
            } else if (catLower.includes("service") || catLower.includes("cleaning") || catLower.includes("clean")) {
              item.category = "service";
            } else {
              item.category = "other";
            }

            // Parse Relations column for per-item employee data
            var relCell = null;
            for (var ci = 0; ci < cells.length; ci++) {
              var cellText = getText(cells[ci]);
              if (cellText.includes("Added by") || cellText.includes("Sold by") || cellText.includes("Repaired by")) {
                relCell = cells[ci];
                break;
              }
            }
            if (relCell) {
              var relText = getText(relCell);
              var addedMatch = relText.match(/Added by\s+([^,\n]+(?:,\s*[^,\n]+)?)/i);
              var soldMatch = relText.match(/Sold by\s+([^,\n]+(?:,\s*[^,\n]+)?)/i);
              var repairedMatch = relText.match(/Repaired by\s+([^,\n]+(?:,\s*[^,\n]+)?)/i);
              item.added_by = addedMatch ? addedMatch[1].replace(/\s+for device.*$/i, "").trim() : "";
              item.sold_by = soldMatch ? soldMatch[1].replace(/\s+for device.*$/i, "").trim() : "";
              item.repaired_by = repairedMatch ? repairedMatch[1].replace(/\s+for device.*$/i, "").trim() : "";
            }

            // Price, discount, line total from remaining cells
            cells.forEach(function(cell) {
              var val = getText(cell);
              var numVal = parseFloat(val.replace(/[$,]/g, ""));
              // Use header position if available
              var idx = Array.from(cell.parentElement.children).indexOf(cell);
              if (headerCells[idx]) {
                var hdr = headerCells[idx];
                if (hdr.includes("unit price") || hdr.includes("price")) item.unit_price = numVal || 0;
                if (hdr.includes("discount")) item.discount = numVal || 0;
                if (hdr.includes("line total") || hdr.includes("total")) item.line_total = numVal || 0;
                if (hdr.includes("status")) item.status = val;
              }
            });

            if (item.catalog_item) structuredItems.push(item);
          });
          if (itemsSection) break; // got data from this table
        }
      }
    }

    // Fallback: page text scan for items section
    if (!itemsSection) {
      console.log("[FT-extract] Falling back to page-scan for items");
      var fullText2 = document.body ? document.body.innerText : "";
      var itemsIdx = fullText2.indexOf("Ticket Items");
      if (itemsIdx >= 0) {
        var afterItems = fullText2.substring(itemsIdx, itemsIdx + 2000);
        var stopWords2 = ["Transactions", "Notes", "Custom Forms", "Appointments", "Repair Devices"];
        var cutoff2 = afterItems.length;
        stopWords2.forEach(function(sw) {
          var swi = afterItems.indexOf(sw);
          if (swi > 15 && swi < cutoff2) cutoff2 = swi;
        });
        itemsSection = afterItems.substring(0, cutoff2).trim();
      }
    }

    data.raw_items = itemsSection || "(not found on page)";
    data.structured_items = structuredItems;
    console.log("[FT-extract] Items found:", structuredItems.length, "raw length:", itemsSection.length);

    // ═══ FINANCIAL DATA (Totals sidebar + Analytics section) ═══
    console.log("[FT-extract] Starting financial extraction...");
    data.subtotal = 0;
    data.discount_amount = 0;
    data.total_collected = 0;
    data.total_cost = 0;

    // Strategy 1: Find the Totals panel on the right sidebar
    var fullPageText = document.body ? document.body.innerText : "";

    // Money label matcher.
    //
    // RepairQ renders a LOSS in accounting style with parentheses, and puts the
    // value on the line AFTER the label:
    //     "Total Cost:\n$ 423.62\nGross Profit:\n($ 198.38)"
    // Verified on the page for ticket 15304992, 2026-08-31.
    //
    // So the sign can be "-", an en dash, or an opening paren, before or (for
    // the dashes) after the $. Miss it and the whole pattern fails to match,
    // data.gross_profit is never assigned, and the server's `parseFloat(x || 0)`
    // silently stores 0 — which is why no row in 4,124 had ever been negative
    // and $4,538.90 of real losses were booked as break-even.
    //
    // `[:\s]*` spans the newline between label and value (\s matches \n).
    // Commas are stripped globally — .replace(",", "") only drops the first.
    var FT_MONEY = "[:\\s]*([-–(]?)\\s*\\$\\s*([-–]?)\\s*([\\d,.]+)";
    function ftMoney(label) {
      var m = fullPageText.match(new RegExp(label + FT_MONEY, "i"));
      if (!m) return null;                       // null = label absent, not zero
      var n = parseFloat(String(m[3]).replace(/,/g, ""));
      if (!isFinite(n)) return null;
      return /[-–(]/.test((m[1] || "") + (m[2] || "")) ? -n : n;
    }

    var vSubtotal = ftMoney("Subtotal");
    var vNetDisc  = ftMoney("Net Discounts?");
    var vDisc     = ftMoney("[-–]\\s*Discount");
    // \b is load-bearing: without it, /Total\s*\$/i matches the "total" inside
    // "Subtotal" and total_collected silently becomes the subtotal. That is why
    // total_collected equalled gross_sales on every discounted ticket.
    var vTotal    = ftMoney("\\bTotal");
    // "Payments" is what the customer actually handed over; "Total" is what was
    // owed. They differ whenever there is an outstanding balance, so prefer it.
    var vPayments = ftMoney("[-–]?\\s*Payments");

    if (vSubtotal !== null) data.subtotal = vSubtotal;
    if (vNetDisc !== null) data.discount_amount = vNetDisc;
    else if (vDisc !== null) data.discount_amount = vDisc;
    if (vPayments !== null) data.total_collected = vPayments;
    else if (vTotal !== null) data.total_collected = vTotal;

    // Strategy 2: Find Analytics section for Gross Sales, Total Cost, Gross Profit
    var vGrossSales  = ftMoney("Gross Sales");
    var vTotalCost   = ftMoney("Total Cost");
    var vGrossProfit = ftMoney("Gross Profit");
    if (vGrossSales !== null) data.gross_sales = vGrossSales;
    if (vTotalCost !== null) data.total_cost = vTotalCost;
    if (vGrossProfit !== null) data.gross_profit = vGrossProfit;

    // Loud, not silent: a missing financial label means this ticket will be
    // stored with a wrong number, so say so rather than shipping a quiet zero.
    var ftMissing = [];
    if (vGrossSales === null) ftMissing.push("Gross Sales");
    if (vTotalCost === null) ftMissing.push("Total Cost");
    if (vGrossProfit === null) ftMissing.push("Gross Profit");
    if (vPayments === null && vTotal === null) ftMissing.push("Payments/Total");
    if (ftMissing.length) {
      console.error("[FT-extract] MISSING financial field(s): " + ftMissing.join(", ") +
        " — ticket will be stored with incomplete figures.");
    }

    // GPM
    if (data.gross_sales > 0 && data.gross_profit > 0) {
      data.gpm_pct = Math.round(data.gross_profit / data.gross_sales * 100 * 10) / 10;
    }
    console.log("[FT-extract] Financial: sales=$" + data.gross_sales + " cost=$" + data.total_cost + " profit=$" + data.gross_profit + " discount=$" + data.discount_amount);

    // ═══ PAYMENT METHOD (from transactions) ═══
    data.payment_method = "";
    var methodMatch = fullPageText.match(/(?:Square|Cash|Visa|Mastercard|Amex|American Express|Discover|Apple Pay|Google Pay|Debit|Credit|Check|PayPal|Venmo|Zelle)[^\n]*/i);
    if (methodMatch) data.payment_method = methodMatch[0].split(/\s{2,}/)[0].trim().substring(0, 50);

    // ═══ TURNAROUND TIME ═══
    if (data.date_created && data.date_closed && data.date_created !== data.date_closed) {
      try {
        var parseDate = function(ds) {
          var parts = ds.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
          if (!parts) return null;
          var year = parseInt(parts[3]);
          if (year < 100) year += 2000;
          var timeStr = ds.split(",")[1] || "";
          return new Date(parts[1] + "/" + parts[2] + "/" + year + " " + timeStr.trim());
        };
        var created = parseDate(data.date_created);
        var closed = parseDate(data.date_closed);
        if (created && closed && !isNaN(created.getTime()) && !isNaN(closed.getTime())) {
          data.turnaround_hours = Math.round((closed - created) / (1000 * 60 * 60) * 10) / 10;
          console.log("[FT-extract] Turnaround: " + data.turnaround_hours + " hours");
        }
      } catch(e) { console.log("[FT-extract] Turnaround calc error:", e.message); }
    }

    // ═══ NOTES ═══
    var notesSection = "";
    console.log("[FT-extract] Starting notes extraction...");
    
    // Approach 1: Find the Notes heading using broad selectors (RepairQ uses dark header bars)
    var notesCandidates = document.querySelectorAll("h1, h2, h3, h4, h5, h6, .panel-heading, .section-heading, div[class*=heading], div[class*=header], div[class*=title], th, td, span, strong, b");
    var notesHeaderEl = null;
    for (var ni = 0; ni < notesCandidates.length; ni++) {
      var nText = notesCandidates[ni].textContent.trim();
      // Must be JUST "Notes" (with maybe an emoji/icon) not "notes_something" or a long string containing "notes"
      if (/^\s*[\u{1F4AC}\u{1F5D2}\u{270F}\u{2709}]?\s*Notes\s*$/iu.test(nText) || nText === "Notes") {
        notesHeaderEl = notesCandidates[ni];
        console.log("[FT-extract] Found Notes header in <" + notesHeaderEl.tagName + "> class='" + (notesHeaderEl.className || "") + "'");
        break;
      }
    }
    
    if (notesHeaderEl) {
      // Strategy A: Find table within the same panel/section/parent container
      var searchContainers = [];
      var panel = notesHeaderEl.closest(".panel, .card, section, [class*=panel], [class*=section]");
      if (panel) searchContainers.push(panel);
      // Also try parent and grandparent
      if (notesHeaderEl.parentElement) searchContainers.push(notesHeaderEl.parentElement);
      if (notesHeaderEl.parentElement && notesHeaderEl.parentElement.parentElement) searchContainers.push(notesHeaderEl.parentElement.parentElement);
      
      for (var sci = 0; sci < searchContainers.length; sci++) {
        if (notesSection) break;
        var tables = searchContainers[sci].querySelectorAll("table");
        console.log("[FT-extract] Searching container " + sci + " <" + searchContainers[sci].tagName + "> found " + tables.length + " tables");
        for (var ti = 0; ti < tables.length; ti++) {
          var rows = tables[ti].querySelectorAll("tr");
          for (var ri = 0; ri < rows.length; ri++) {
            var cells = rows[ri].querySelectorAll("td");
            if (cells.length >= 2) {
              var content = getText(cells[0]);
              var by = cells.length >= 3 ? getText(cells[1]) : "";
              var created = cells.length >= 3 ? getText(cells[2]) : getText(cells[1]);
              if (content && content.toLowerCase() !== "content" && content.length > 3) {
                notesSection += "[" + by + " - " + created + "] " + content + "\n";
              }
            }
          }
        }
      }
      
      // Strategy B: Walk next siblings of the header to find a table
      if (!notesSection) {
        var nextEl = notesHeaderEl.nextElementSibling || (notesHeaderEl.parentElement ? notesHeaderEl.parentElement.nextElementSibling : null);
        var walkAttempts = 0;
        while (nextEl && walkAttempts < 10 && !notesSection) {
          var table = nextEl.tagName === "TABLE" ? nextEl : nextEl.querySelector("table");
          if (table) {
            console.log("[FT-extract] Found notes table via sibling walk");
            var rows = table.querySelectorAll("tr");
            for (var ri = 0; ri < rows.length; ri++) {
              var cells = rows[ri].querySelectorAll("td");
              if (cells.length >= 2) {
                var content = getText(cells[0]);
                var by = cells.length >= 3 ? getText(cells[1]) : "";
                var created = cells.length >= 3 ? getText(cells[2]) : getText(cells[1]);
                if (content && content.toLowerCase() !== "content" && content.length > 3) {
                  notesSection += "[" + by + " - " + created + "] " + content + "\n";
                }
              }
            }
          }
          nextEl = nextEl.nextElementSibling;
          walkAttempts++;
        }
      }
    }
    
    // Approach 2: Find by #notes ID or notes-related class
    if (!notesSection) {
      var notesContainer = document.querySelector("#notes, .notes, .ticket-notes, [id*=notes], [class*=notes]");
      if (notesContainer) {
        console.log("[FT-extract] Found notes by ID/class selector");
        var tables = notesContainer.querySelectorAll("table");
        tables.forEach(function(table) {
          var rows = table.querySelectorAll("tr");
          for (var ri = 0; ri < rows.length; ri++) {
            var cells = rows[ri].querySelectorAll("td");
            if (cells.length >= 2) {
              var content = getText(cells[0]);
              var by = cells.length >= 3 ? getText(cells[1]) : "";
              var created = cells.length >= 3 ? getText(cells[2]) : getText(cells[1]);
              if (content && content.toLowerCase() !== "content" && content.length > 3) {
                notesSection += "[" + by + " - " + created + "] " + content + "\n";
              }
            }
          }
        });
      }
    }
    
    // Approach 3: Full page text scan — find text between "Notes" section and next section
    if (!notesSection) {
      console.log("[FT-extract] Falling back to full-page text scan for notes");
      var fullText = document.body ? document.body.innerText : "";
      // Find standalone "Notes" (not "Release Notes" etc) — look for Notes header preceded by newlines
      var notesPatterns = ["\nNotes\n", "\nNotes \n", "Notes\n"];
      var notesIdx = -1;
      for (var np = 0; np < notesPatterns.length; np++) {
        notesIdx = fullText.lastIndexOf(notesPatterns[np]); // use lastIndexOf to skip earlier "notes" mentions
        if (notesIdx >= 0) { notesIdx += notesPatterns[np].length; break; }
      }
      if (notesIdx >= 0) {
        var afterNotes = fullText.substring(notesIdx).trim();
        // Cut at next major section
        var stopWords = ["Transactions", "Payment", "Ticket Items", "Repair Devices", "Analytics", "Approvals"];
        var cutoff = afterNotes.length;
        stopWords.forEach(function(sw) {
          var swIdx = afterNotes.indexOf(sw);
          if (swIdx > 0 && swIdx < cutoff) cutoff = swIdx;
        });
        notesSection = afterNotes.substring(0, Math.min(cutoff, 800)).trim();
        console.log("[FT-extract] Page-scan notes result: " + notesSection.substring(0, 80));
      }
    }
    
    // Fallback: textarea/note elements
    if (!notesSection) {
      getAll("textarea, .note-content, .comment-body").forEach(function(el) {
        var t = getText(el);
        if (t) notesSection += t + "\n";
      });
    }
    
    data.raw_notes = notesSection || "(not found on page)";
    console.log("[FT-extract] Final raw_notes: " + data.raw_notes.substring(0, 100));

    // ═══ TRANSACTIONS ═══
    var transSection = "";
    console.log("[FT-extract] Starting transactions extraction...");
    
    // Approach 1: Find the Transactions header using broad selectors
    var transCandidates = document.querySelectorAll("h1, h2, h3, h4, h5, h6, .panel-heading, .section-heading, div[class*=heading], div[class*=header], th, td, span, strong, b");
    var transHeaderEl = null;
    for (var ti = 0; ti < transCandidates.length; ti++) {
      var tText = transCandidates[ti].textContent.trim();
      if (/^\s*[\u{1F4B3}\u{1F4B0}]?\s*Transactions\s*$/iu.test(tText) || tText === "Transactions") {
        transHeaderEl = transCandidates[ti];
        console.log("[FT-extract] Found Transactions header in <" + transHeaderEl.tagName + "> class='" + (transHeaderEl.className || "") + "'");
        break;
      }
    }
    
    if (transHeaderEl) {
      // Strategy A: Find table in same panel/section/parent
      var searchContainers = [];
      var tPanel = transHeaderEl.closest(".panel, .card, section, [class*=panel], [class*=section]");
      if (tPanel) searchContainers.push(tPanel);
      if (transHeaderEl.parentElement) searchContainers.push(transHeaderEl.parentElement);
      if (transHeaderEl.parentElement && transHeaderEl.parentElement.parentElement) searchContainers.push(transHeaderEl.parentElement.parentElement);
      
      for (var sci = 0; sci < searchContainers.length; sci++) {
        if (transSection) break;
        var tables = searchContainers[sci].querySelectorAll("table");
        for (var tti = 0; tti < tables.length; tti++) {
          var rows = tables[tti].querySelectorAll("tr");
          rows.forEach(function(row) {
            var cells = row.querySelectorAll("th, td");
            transSection += Array.from(cells).map(getText).join(" | ") + "\n";
          });
        }
      }
      
      // Strategy B: Walk siblings to find a table
      if (!transSection) {
        var nextEl = transHeaderEl.nextElementSibling || (transHeaderEl.parentElement ? transHeaderEl.parentElement.nextElementSibling : null);
        var walkAttempts = 0;
        while (nextEl && walkAttempts < 10 && !transSection) {
          var table = nextEl.tagName === "TABLE" ? nextEl : nextEl.querySelector("table");
          if (table) {
            console.log("[FT-extract] Found transactions table via sibling walk");
            var rows = table.querySelectorAll("tr");
            rows.forEach(function(row) {
              var cells = row.querySelectorAll("th, td");
              transSection += Array.from(cells).map(getText).join(" | ") + "\n";
            });
          }
          nextEl = nextEl.nextElementSibling;
          walkAttempts++;
        }
      }
    }
    
    // Approach 2: Fallback to allElements (legacy)
    if (!transSection) {
      allElements.forEach(function(el) {
        if (getText(el).toLowerCase().includes("transaction")) {
          var panel = el.closest(".panel, .card, section, div[class*=panel]");
          if (panel) {
            var table = panel.querySelector("table");
            if (table) {
              var rows = table.querySelectorAll("tr");
              rows.forEach(function(row) {
                var cells = row.querySelectorAll("th, td");
                transSection += Array.from(cells).map(getText).join(" | ") + "\n";
              });
            }
          }
        }
      });
    }
    
    data.raw_transactions = transSection || "(not found on page)";
    console.log("[FT-extract] Final raw_transactions: " + data.raw_transactions.substring(0, 150));

    return data;
  }

  // ═══ GRADE SINGLE TICKET (via background worker to avoid CSP) ═══
  async function gradeTicket(ticketData) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({ action: "grade_ticket", ticket: ticketData }, function(response) {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { success: false, error: "No response" });
        }
      });
    });
  }

  // ═══ SHOW GRADE OVERLAY ═══
  function showGradeOverlay(grade) {
    // Remove existing overlay
    var existing = document.getElementById("ft-grade-overlay");
    if (existing) existing.remove();

    var scoreColor = grade.overall_score >= 80 ? "#4ADE80" : grade.overall_score >= 60 ? "#FBBF24" : "#F87171";
    var cm = "\u2705"; // checkmark
    var xm = "\u274C"; // cross

    var overlay = document.createElement("div");
    overlay.id = "ft-grade-overlay";
    overlay.innerHTML = '<div style="background:#1A1D23;border-radius:12px;padding:20px;max-width:520px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:-apple-system,sans-serif;max-height:90vh;overflow-y:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<div style="color:#F0F1F3;font-size:14px;font-weight:700;">Ticket Compliance Grade</div>' +
        '<div style="color:' + scoreColor + ';font-size:28px;font-weight:800;">' + grade.overall_score + '/100</div>' +
      '</div>' +
      // Score cards row
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:6px;margin-bottom:12px;">' +
        makeScoreCard("Intake", grade.diagnostics_score, grade.diagnostics_notes) +
        makeScoreCard("Repair", grade.repair_notes_score, grade.repair_notes_detail) +
        makeScoreCard("Pickup", grade.pickup_score, grade.pickup_notes) +
        makeScoreCard("Payment", grade.payment_score, grade.payment_notes + (grade.payment_not_applicable ? " (N/A)" : "")) +
        makeScoreCard("Contact", grade.contact_score, grade.contact_notes) +
      '</div>' +
      // Intake sub-criteria
      '<div style="margin-bottom:8px;">' +
        '<div style="color:#8B8F98;font-size:9px;text-transform:uppercase;margin-bottom:4px;letter-spacing:0.05em;">Intake Checklist</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;background:#12141A;border-radius:6px;">' +
          makePill(grade.diagnostics_issue_found, "Issue") +
          makePill(grade.diagnostics_service_planned, "Service") +
          makePill(grade.diagnostics_price_found, "Price") +
          makePill(grade.diagnostics_turnaround_found, "Turnaround") +
          makePill(grade.diagnostics_history_noted, "History") +
          makePill(grade.diagnostics_liquid_check, "Liquid Check") +
          makePill(grade.diagnostics_warranty_offered, "Warranty") +
        '</div>' +
      '</div>' +
      // Repair sub-criteria
      '<div style="margin-bottom:8px;">' +
        '<div style="color:#8B8F98;font-size:9px;text-transform:uppercase;margin-bottom:4px;letter-spacing:0.05em;">Repair Notes Checklist</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;background:#12141A;border-radius:6px;">' +
          makePill(grade.repair_pretest_documented, "Pretest") +
          makePill(grade.repair_service_documented, "Service Done") +
          makePill(grade.repair_findings_documented, "Findings") +
          makePill(grade.repair_communication_documented, "Cust Comms") +
          makePill(grade.repair_posttest_documented, "Post-test") +
        '</div>' +
      '</div>' +
      // Pickup sub-criteria
      '<div style="margin-bottom:8px;">' +
        '<div style="color:#8B8F98;font-size:9px;text-transform:uppercase;margin-bottom:4px;letter-spacing:0.05em;">Pickup Checklist</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;background:#12141A;border-radius:6px;">' +
          makePill(grade.pickup_customer_contacted, "Customer Contacted") +
          makePill(grade.pickup_customer_informed, "Informed of Work") +
          makePill(grade.pickup_timing_noted, "Pickup Timing") +
        '</div>' +
      '</div>' +
      // Contact sub-criteria
      '<div style="margin-bottom:12px;">' +
        '<div style="color:#8B8F98;font-size:9px;text-transform:uppercase;margin-bottom:4px;letter-spacing:0.05em;">Contact Info Checklist</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:8px 10px;background:#12141A;border-radius:6px;">' +
          makePill(grade.contact_name_present, "Full Name") +
          makePill(grade.contact_phone_present, "Phone") +
          makePill(grade.contact_email_present, "Email") +
          makePill(grade.contact_alternate_phone, "Alt Phone") +
        '</div>' +
      '</div>' +
      '<button id="ft-close-overlay" style="width:100%;padding:8px;border-radius:6px;border:1px solid #2A2D35;background:transparent;color:#8B8F98;font-size:11px;cursor:pointer;">Close</button>' +
    '</div>';
    overlay.style.cssText = "position:fixed;top:20px;right:20px;z-index:999999;";
    document.body.appendChild(overlay);

    document.getElementById("ft-close-overlay").addEventListener("click", function() { overlay.remove(); });
  }

  function makePill(pass, label) {
    var bg = pass ? "#4ADE8015" : "#F8717115";
    var border = pass ? "#4ADE8033" : "#F8717133";
    var icon = pass ? "\u2705" : "\u274C";
    return '<span style="font-size:10px;padding:2px 6px;border-radius:4px;background:' + bg + ';border:1px solid ' + border + ';">' + icon + ' ' + label + '</span>';
  }

  function makeScoreCard(label, score, note) {
    var c = score >= 80 ? "#4ADE80" : score >= 60 ? "#FBBF24" : "#F87171";
    return '<div style="background:#12141A;border-radius:8px;padding:10px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<span style="color:#8B8F98;font-size:10px;text-transform:uppercase;">' + label + '</span>' +
        '<span style="color:' + c + ';font-size:16px;font-weight:800;">' + score + '</span>' +
      '</div>' +
      '<div style="color:#6B6F78;font-size:9px;margin-top:4px;">' + (note || "") + '</div>' +
    '</div>';
  }

  // ═══ ADD GRADE BUTTON TO TICKET PAGES ═══
  function injectGradeButton() {
    if (!isTicketPage()) return;
    if (document.getElementById("ft-grade-btn")) return;

    var btn = document.createElement("button");
    btn.id = "ft-grade-btn";
    btn.textContent = "Grade Ticket";
    btn.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:999998;padding:12px 24px;border-radius:8px;border:none;background:linear-gradient(135deg,#00D4FF,#7B2FFF);color:#FFF;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(123,47,255,0.3);";

    btn.addEventListener("click", async function() {
      btn.textContent = "Grading...";
      btn.style.opacity = "0.7";
      btn.disabled = true;

      var ticketData = extractTicketData();
      var result = await gradeTicket(ticketData);

      if (result.success && result.grade) {
        showGradeOverlay(result.grade);
        btn.textContent = "✓ Graded";
        btn.style.background = "#4ADE80";
        btn.style.color = "#000";
      } else {
        btn.textContent = "Error — Try Again";
        btn.style.background = "#F87171";
        console.error("Grade error:", result.error);
      }

      setTimeout(function() {
        btn.textContent = "Grade Ticket";
        btn.style.background = "linear-gradient(135deg,#00D4FF,#7B2FFF)";
        btn.style.color = "#FFF";
        btn.style.opacity = "1";
        btn.disabled = false;
      }, 5000);
    });

    document.body.appendChild(btn);
  }

  // ═══ EXTRACT TICKET LINKS FROM PROFITABILITY REPORT ═══
  function getTicketLinksFromReport() {
    var links = [];
    var rows = getAll("table tr");
    rows.forEach(function(row) {
      var firstCell = row.querySelector("td:first-child a");
      if (firstCell) {
        var href = firstCell.getAttribute("href") || "";
        var ticketNum = getText(firstCell);
        if (href.includes("/ticket/") || /^\d{5,}$/.test(ticketNum)) {
          links.push({
            url: href.startsWith("http") ? href : "https://cpr.repairq.io" + href,
            ticket_number: ticketNum,
          });
        }
      }
    });
    return links;
  }

  // ═══ LISTEN FOR MESSAGES FROM POPUP/BACKGROUND ═══
  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg.action === "extract_ticket") {
      var data = extractTicketData();
      sendResponse({ success: true, data: data });
    }
    if (msg.action === "get_report_tickets") {
      var links = getTicketLinksFromReport();
      sendResponse({ success: true, links: links });
    }
    if (msg.action === "grade_current") {
      extractAndGrade().then(function(result) {
        sendResponse(result);
      });
      return true; // async
    }
  });

  async function extractAndGrade() {
    // Loud, not silent. Previously a throw in extractTicketData() rejected this
    // promise, sendResponse() never fired, and the popup showed whatever the
    // server said about an absent ticket — which hid the real failure.
    var data;
    try {
      data = extractTicketData();
    } catch (e) {
      console.error("[FT-extract] extraction threw:", e);
      return { success: false, error: "Extraction failed on this page: " + (e && e.message ? e.message : String(e)) };
    }
    if (!data || !data.ticket_number) {
      return {
        success: false,
        error: "Could not read a ticket number from this page. Open the ticket itself " +
               "(not a list or report) and reload the page, then try again.",
      };
    }
    return await gradeTicket(data);
  }

  // ═══ INIT ═══
  // Wait for page to load, then inject button
  if (document.readyState === "complete") {
    injectGradeButton();
  } else {
    window.addEventListener("load", injectGradeButton);
  }

})();

/* ──────────────────────────────────────────────────────────────────────────
 * Batch keep-alive (Focused Technologies)
 * RepairQ shows an "Inactivity Lock" (PIN to resume) after a period with no
 * real user input. A batch run navigates the tab programmatically, which does
 * NOT count as activity, so the lock fires mid-run and stalls grading.
 *
 * While — and ONLY while — a batch is running, this:
 *   1. dispatches synthetic activity so RepairQ's idle timer never trips, and
 *   2. if the 30s lock warning appears anyway, clicks "Click here to stay
 *      logged in" (#clear_timer) to reset it before it escalates to the PIN.
 * Outside of a batch this does nothing, so normal inactivity locking (a store
 * security feature on shared machines) is fully preserved.
 * ────────────────────────────────────────────────────────────────────────── */
(function ftBatchKeepAlive() {
  var KEEPALIVE_PING_MS = 25000; // synthetic-activity cadence (under RepairQ's idle window)
  var LOCK_WATCH_MS     = 1500;  // how often to look for the lock warning
  var batchRunning = false;
  var pingTimer = null;
  var watchTimer = null;

  function dispatchActivity() {
    try {
      var evs = ["mousemove", "mousedown", "keydown", "scroll"];
      for (var i = 0; i < evs.length; i++) {
        document.dispatchEvent(new Event(evs[i], { bubbles: true }));
      }
      window.dispatchEvent(new Event("mousemove", { bubbles: true }));
    } catch (e) {}
  }

  function dismissLockIfPresent() {
    try {
      // Primary: the explicit "stay logged in" reset button, when visible.
      var btn = document.getElementById("clear_timer");
      if (btn && btn.offsetParent !== null) { btn.click(); return; }
      // Fallback: the warning popup is shown (aria-hidden="false") — click its primary action.
      var popup = document.getElementById("lock-timer-popup");
      if (popup && popup.getAttribute("aria-hidden") === "false") {
        var b = popup.querySelector("#clear_timer, .btn-primary");
        if (b) b.click();
      }
    } catch (e) {}
  }

  function start() {
    if (pingTimer) return;
    dispatchActivity();
    pingTimer = setInterval(dispatchActivity, KEEPALIVE_PING_MS);
    watchTimer = setInterval(dismissLockIfPresent, LOCK_WATCH_MS);
  }
  function stop() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }
  }

  function sync() {
    try {
      chrome.storage.local.get("batchJob", function(data) {
        var running = !!(data && data.batchJob && data.batchJob.status === "running");
        if (running && !batchRunning) { batchRunning = true; start(); }
        else if (!running && batchRunning) { batchRunning = false; stop(); }
      });
    } catch (e) {}
  }

  // React immediately when a batch starts/stops, and re-check on every page load
  // (the batch navigates the tab, so this content script re-runs each ticket).
  try {
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area === "local" && changes.batchJob) sync();
    });
  } catch (e) {}
  sync();
})();

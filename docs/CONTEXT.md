# CPR Dashboard — Business Context & Current State

**Last updated:** 2026-09-11 evening (Book-this-quote from the Price Book, appointments route authenticated, Screen tiers in Price & Demand, Discounts on the Morning Brief, "stop offering" — § 10m–10t)
**Maintainer:** update Open items + Recent changes at the end of every session.

---

## 1. The business

**Focused Technologies LLC** — Eric Farr, owner. Three CPR Cell Phone Repair franchise stores:

| Store | Notes |
|---|---|
| **Fishers** | Busiest, "model store." Highest appointments (~48/month), best accessory sales (~$3k/month), 88% answer rate (inflated by Alyssa's test calls). |
| **Bloomington** | College town (IU). Slowest in summer, busiest Sept–Oct. Franchise renewal in progress (5-yr). Two Dialpad departments ("CPR Bloomington" + "CPR Bloomington 2"). Soldering gap since Luke moved to Indy. Landlord doing ~$1,500 drywall/insulation repair (AC condensation). |
| **Indianapolis** (downtown) | Slower relative to others lately; heavy on insurance claims. Inventory has been cleaned up by Duncan over the past months (drives visible shrinkage). |

Seasonality: Sept/Oct Bloomington carries; Nov/Dec Indy + Fishers carry (Thanksgiving week off; December is tough).

### People
- **Eric Farr** — owner. Makes all comp decisions. Sign-off required for anything payroll.
- **Matt Slade** — area manager. Lives downtown Indy now (~10 min from Indy store). Primary dashboard user. Payroll split 1/5 per store + 2/5 corporate overhead. Alternating Saturdays at Fishers with Duncan.
- **Duncan Hitti** — advanced repair manager (consoles, computers, tablets, soldering). Works Indy; goes to Bloomington ~2x/month minimum for oversight/training. Non-phone repair bonus being built for him. **Owed $100 streak bonus** (§ 9). Honest about shrinkage; has been cleaning up Indy inventory.
- **Alyssa Parent** — Fishers. Star employee: ~$93 GP/ticket, $170 Pro Points in one day, does advanced repairs, spent months cleaning Fishers inventory. Does test calls to Fishers (inflates answer rate). **Owed $200 + 1 PTO day** (§ 9). Needs to work ≥1 Saturday/month.
- **Aaron / Aerick Long** — Fishers. **Owed $100 streak bonus** (§ 9). Dialpad transcribes name as "Eric" → roster alias `{eric,erik,derek,arick}`. Wrist injury Aug 2026 (basement flood). Reasonable about answer-rate changes.
- **Luke Stirling** — **Owed $100 streak bonus** (§ 9). Moved Bloomington → Indy Aug 2026 on short notice; can solder. Old RepairQ hourly rate was polluting ticket profit on older tickets. "Still not amazing" on GP.
- **Alec** — Bloomington. Reliable, initiative, good customer service, learning; forgets to ask for appointment sometimes; needs coaching on ticket notes (final call, "ready for pickup"). Willing to drive to Indy for soldering training.
- **Andrew** — Bloomington new hire (started ~Aug 18, 2026). Candidate for soldering training alongside Alec.
- **Sam (Samuel Tomey)** — Indy; can solder.
- **Mahmoud Awad, Joseph Ciceu, Matthew Ziegler** — active roster.
- **Ziggy, Gabe, Johnny, Tyler** — former employees; referenced re: inventory mess / prior low performance.

### Staffing math (from 8/17)
9 techs across 3 stores, 2/store/day target = 42 shifts/week; ~40 covered when everyone works 5 days. Decision: **no part-timer** (~$1,500/mo not worth covering ~2 single-person days). Fishers Saturdays: Matt/Duncan alternate; Alyssa ≥1 Saturday/month.

---

## 2. Compensation structures (payroll-sensitive)

### Answer-rate bonus — CURRENT (in code)
≥90% = $100, ≥85% = $75, ≥80% = $50. Highest tier only. Employee assigned to their max-hours store.
**Answered calls under 15 seconds are excluded from 2026-09 forward** (Eric, 2026-08-31) — test
calls, hangups, misdials, wrong numbers. **Forward-only**: retroactively this drops Fishers and
Bloomington under 80% in July and Bloomington in August, clawing back $50 bonuses already earned.
Constants live at the top of `answer-rate-bonus/route.js`
(`SHORT_CALL_EFFECTIVE_PERIOD`, `SHORT_CALL_MIN_MINUTES`). ⚠ `talk_duration` is in **MINUTES** —
15s is `0.25`; writing `< 15` matches every call ever recorded and zeroes every rate.
Expected first clean month: **September 2026**. Measured effect if it had applied:
Jul 80.4/80.4/79.2 → 77.6/79.1/77.6 · Aug 87.5/80.4/82.0 → 85.4/79.7/80.5.

### Answer-rate bonus — AGREED DIRECTION (NOT YET IMPLEMENTED, exact table pending Eric)
With two people per shift: **85% becomes the bonus floor, 90% is the expectation, <80% is poor performance.** Eric has NOT confirmed the exact new tier table or effective month. **Sequencing: test-call scrub first → one clean month → then re-tier.**

### Duncan non-phone repair bonus — AGREED DIRECTION (NOT YET IMPLEMENTED)
- Scope: **consoles + tablets + computers + miscellaneous** repair profit (revenue − COGS), all three stores combined.
- $100 for hitting **$15,000/month**, plus **$75 per $1,000 above** (Eric said $75 twice; Matt floated $50 — confirm).
- Baseline reference: $12,615 avg Jan–Jul 2026; July ~$12–13.5k. Fairer baseline window is Mar–Jul (Duncan not in role Jan–Feb).
- **Blocked until Daily Profit accuracy is fixed and closed-ticket sync works.**

### Streak / tier bonus
$100 per completed run of 3 consecutive months at Gold+ tier. **Recurring** — a sustained streak
earns again at 6, 9, 12 months (Eric confirmed 2026-08-31). 3 consecutive months at Platinum+ earns
1 PTO day on the same repeating basis. Eligibility is `employee_roster.bonus_eligible`, NOT the
`role` label. **Working as of 2026-08-31** (was broken since inception — see Open items #1);
Mar–Aug backfilled, payouts owed in § 9.

### Google review bonuses
10 minimum/month; $5/employee per review above 10; $5/employee per photo review regardless of count.

### Shrinkage policy (agreed 8/17)
Cleanup-era shrinkage gets a pass **through end of August 2026**; from September it counts. Intent: shrinkage eventually factors into bonuses. Last month: ~$2,077 combined ($780 damage, ~$1,200 shrinkage; ~$400/store shrinkage is "average").

---

## 3. Profitability reference (Jan 2026 base expenses)
- **Bloomington:** rent $2,511 / internet $508 / electric $220 / VoIP $150
- **Fishers:** rent $5,520 / internet $508 / electric $430 / VoIP $150
- **Indianapolis:** rent $4,300 / internet $485 / electric $450 / gas $200 / VoIP $150
- All stores: royalty 5%, CPR ad $285, tech $95, budget $50
- Other income: Fieldprint payouts (~$1,400–1,500 some months), LCD credits (last received June 2026; two boxes shipped Aug)
- Area manager payroll split: 1/5 per store + 2/5 corporate overhead

Google listing links: Fishers `share.google/boLKmW7TWqLQMaUsY`, Bloomington `share.google/0XO2eEVlRVWHrUpGC`, Indianapolis `share.google/uNhlR2bdbFSjbF360`

---

## 4. The June 2026 outage (why the rules exist)
Grading/audit pipeline hardcoded `claude-sonnet-4-20250514`, retired June 15, 2026. Every AI call failed **silently** (`catch → {success:false}` HTTP 200) for ~8 days across 12 routes. Fixed via global replace → `claude-sonnet-4-6`. Same week: PostgREST max-rows cap (546) found clipping reads → raised to 100,000; `call-leaders` made cap-immune via pagination. Left a **June 15–23 hole** in `audit_results` and `ticket_grades` that has not been backfilled.

---

## 5. OPEN ITEMS (priority order)

### Priority 1 — Money owed & broken numbers
1. ~~**Streak bonus not calculating.**~~ **FIXED + BACKFILLED 2026-08-31.** Root cause was never
   the streak math — `computeStreaks()` was correct. `employee_tier_history` had **never received a
   single row**, so every streak was 0. Six defects, all confirmed against the live DB:
   (a) the snapshot wrote `updated_at`, but the column is `recorded_at` — PostgREST rejected every
   upsert; (b) `tier_celebrations` **did not exist** (PGRST205), silently no-opping 8 call sites;
   (c) `snapshotPeriod` HTTP-fetched `/scorecard` and `/sales` from inside a route (gotcha #1) and
   needed `NEXT_PUBLIC_BASE_URL`, which is not set in Vercel — now invoked in-process;
   (d) it returned `success:true` with `written:0`, which is how an empty table went unnoticed;
   (e) `priorPeriod(p, 0)` returned the *previous* month (`n = n || 1`), so backfill skipped the
   current month and did another twice; (f) streak math read the whole history table instead of
   history **up to** the period being snapshotted, so a re-run paid the same 3-month run once per
   period (Aerick briefly showed 5 × $100).
   **Payout is $500 + 1 PTO day, not the $200 expected** — see § 9. Ran
   `sql/migration_tier_celebrations.sql`. 43 history rows, 12 events, Mar–Aug 2026.
   **Still owed: Eric pays these out manually.** Nothing marks them paid yet — use the AdminTab
   celebration queue (`mark_paid`), which works now that the table exists.
2. **Daily Profit inaccurate.** **DIAGNOSED 2026-08-31 — it is a COVERAGE bug, not a math bug.** The $1,112.35 "third view" is simply **8/13's total**, not a competing figure for 8/14. Verified ticket 16346808 against RepairQ: our stored `gross_profit` ($241.06) matches RepairQ's own Analytics panel to the penny, so `gross_profit = gross_sales − discount − cost` is CORRECT and the discount is **not** double-counted (an earlier theory, disproved). Since every captured ticket matches, the $253.39 gap can only be tickets never captured → this is a subset of item 3. Two real bugs remain, **both in the Chrome extension's scraping, not in this repo** (`tickets/route.js` stores what the extension sends, unmodified): (a) `total_collected` is `gross_sales` verbatim on 815/815 discounted tickets — 16346808 stores $403.99 but the customer paid $313.32; it IS shown to employees in MyPerformanceTab. (b) 13 rows compute GP wrongly — 5 floored at $0.00 where the result goes negative, 4 drop `total_cost` entirely. **Ticket numbers are franchise-global (0.042% density), so missing tickets CANNOT be found by gap analysis** — diff against RepairQ's day view instead. Superseded:  Candidates: discount double-count/miss, duplicate ticket rows, stale wage rates (Luke's old RepairQ hourly). Feeds GP/hour (reads $75; floor quote is $80) and will feed Duncan's bonus. **Do a one-day line-by-line reconciliation of `ticket_grades` vs RepairQ before touching code.**
3. **RepairQ sync only pulls active tickets.** **REFRAMED 2026-08-31 - this is probably NOT a code
   bug.** `getTicketLinksFromReport()` in `extension/content.js` scrapes ticket links from whatever
   RepairQ report is on screen; there is **no status filter anywhere in the extension**. So "only
   active" is a consequence of which report the batch is run against. Try running it on a report
   whose date range + status cover closed tickets before writing any sync code - `check_graded`
   skips already-graded tickets, so a wider re-run is cheap. This is also the cause of the Daily
   Profit gap in item 2. Original note: Closed tickets don't sync → Matt manually marks closed; Alyssa/Duncan advanced-repair bonuses showed $0. Need: sync closed tickets + "re-sync all" that refreshes financials on stored tickets so wage-rate fixes propagate backward. Loud failures.
4. **June 15–23 backfill.** Re-run audit cron over the window + batch-grade June 15–23 tickets via extension (skip-graded makes it cheap). Two Fishers conversions depend on it: Timothy Bailey appt 6/16 → ticket #16075332; Jennifer Coffield appt 6/17 → ticket #16079316. `verify-conversions` 14-day window may need manual widen/rerun.

### Priority 2 — Answer-rate integrity (before re-tier)
5. **Test-call detection.** **PARTIALLY SHIPPED 2026-08-31** - the duration half is live: answered
   calls under 15s are excluded from the answer rate from 2026-09 (see § 2), and the response now
   returns `short_calls_excluded` / `answered_before_short_exclusion` so the count can be displayed.
   **Still open:** the transcript-based half (flag transcript-is-just-"test" as a third category),
   and actually surfacing the excluded count in the UI. Note the duration filter is a broader net
   than test-call detection - it also removes hangups, misdials and wrong numbers, which is
   intended but means the excluded count is NOT purely test calls. Original spec: Staff will say only "test" on test calls (Matt owns telling them). Dashboard: flag transcript-is-just-"test" as third category (not opportunity, not existing), exclude from answer-rate denominator, **display test-call count** so testing stays visible/praised. Going-forward only, no retroactive scrub.
6. **Store-level opportunity/existing split** in Call Performance summary (exists at employee level; surface at store level).
7. ~~**Verify short-call filter**~~ **ANSWERED 2026-08-31: there is NO short-call filter anywhere.**
   The denominator is `answered` (from the `daily_call_volume` view) + open missed. Neither consults
   `talk_duration` or `ringing_duration`, and `is_answered` is set purely from the category string in
   `saveCallRecords`.
   **⚠ UNITS TRAP — `call_records.talk_duration` and `ringing_duration` are stored in MINUTES, not
   seconds.** Verified: **0 rows above 60 across all 28,853 records**; median answered call 1.68
   (≈101s), max 32.72 (≈33 min); ringing median 0.17 (≈10s). Writing `talk_duration < 60` to mean
   "under a minute" matches EVERY call and zeroes the answer rate. Under one minute is `< 1.0`.
   Note `lib/dialpad-stats.js:221` divides Dialpad's ms `duration` by 1000 (→ seconds), which does
   **not** match what is actually stored — check the unit before trusting either path.

   Measured impact of excluding answered calls under 60s (Aug 2026) — lands in the predicted 5–10% band:

   | store | answered | <15s | <60s | open missed | rate now | excl <60s | delta |
   |---|---|---|---|---|---|---|---|
   | fishers | 456 | 76 | 186 | 65 | 87.5% | 80.6% | −6.9 |
   | bloomington | 414 | 17 | 79 | 101 | 80.4% | 76.8% | −3.6 |
   | indianapolis | 498 | 49 | 152 | 109 | 82.0% | 76.0% | −6.0 |

   Fishers has **16.7%** of answered calls under 15s vs Bloomington **4.1%** — 4×, consistent with
   the test-call theory in item 5. The 87.5% also corroborates the "88%" in § 7.
8. Expectation: rates drop ~5–10% when clean. Matt frames it as "your real number was always this."

### Priority 3 — Comp changes (need Eric sign-off)
9. Answer-rate re-tier (exact table + effective month pending).
10. Duncan non-phone bonus formula ($75 vs $50 per $1k pending; blocked on #2 and #3).

### Priority 3.5 — From the 2026-09-10 meeting (NEW)
10a. ~~**Zero / negative profit ticket report.**~~ **SHIPPED 2026-09-10** as a fourth view inside Ticket Compliance (`components/ZeroProfitTickets.js`, `app/api/dialpad/zero-profit/route.js`). Three buckets rather than one number, which is the part that makes it trustworthy: **172 real losses (−$6,128.37)**, **81 true zeros**, and **19 "not captured"** — stored $0 but the line items disagree. Twelve of those 19 are hiding **$1,260.45 of real profit** the grader never captured and seven are losses floored up to zero, so they are excluded from every total and grouping. Group by employee / month / store, click a row to filter, ticket numbers link to cpr.repairq.io. `gross_profit` is shown as stored, never recomputed — 25 of the 272 disagree with sales − discount − cost because the RepairQ export accounts for returns.
10b. ~~**Ticket views show former staff and non-humans.**~~ **SHIPPED 2026-09-10** (`c3e1600`). `tickets/route.js` `action=stats` canonicalises names through `lib/roster-resolver.js` (`resolveNamePersonish` flips "Last, First" and accepts a two-token agreement, so "Sam Tomey" → "Samuel Tomey"; "Alex Ferguson" is correctly rejected); `empStats` is active roster only, former staff sit in `empStatsOther` behind a "Show former staff" toggle in ComplianceTab, and `isSystemActor` drops "Assurant ServiceNetwork" / "API". Read path only. Original finding: `ticket_grades.employee_added` held 22 distinct names, 13 off the active roster across 837 tickets.
10c. ~~**Price sensitivity + call-to-repair conversion.**~~ **SHIPPED 2026-09-10** as its own tab (`components/PriceDemandTab.js`, `app/api/dialpad/price-demand/route.js`, `lib/device-model.js`). Baseline over 6 months: **3,712 opportunity calls, 53.5% offered an appointment, 18.0% became a repair.** Per model: list, average discount, selling price, full-price vs discounted counts, repairs, profit, and a monthly calls-vs-repairs trend. **PS5 is the biggest demand at 306 calls, 34.3% conversion, 67% of repairs discounted ($160.77 → $123.24). iPhone 17 Pro Max is the opposite: $316 list, 5.1% discount, 19.7% conversion — the price-sensitivity case with a number on it. Xbox Series S converts 5.9% despite a 79% appointment-offer rate**, so something breaks after the offer. ⚠ Deliberately does NOT claim a price change caused a volume change; the monthly trend supports the before/after test Eric described instead.
10d. **Google reviews across three listings.** `google_reviews` is keyed `(period, store)` with **no listing dimension**, so it cannot separate repairs / computers-electronics / consoles. The console listing has **2 reviews** and the computer listing carries a **3-star**. Needs a schema change. Competitive urgency: **Carmel 565 vs Fishers 639**, Carmel took 6 reviews in a week to Fishers' 6 in a month, and their owner told Matt they intend to catch us.
10e. **Store-level review bonus (needs Eric sign-off).** Eric's preference is deliberately simple — *"the store with the most reviews gets another twenty-five dollars on their bonus"* — rather than per-review accounting. Exact rule and effective month not set. ⚠ Google now asks reviewers whether they were incentivised and suppresses the review if they say yes: **never pair a review request with a discount.**
10f. **January + February 2026 profitability backfill.** Data entry, not a build. Roughly **−$6,000 combined** (January snowstorm, five payrolls, New Year's closure). Until they exist the trend's YTD is honestly labelled "6 months saved" rather than a full year.
10g. **Duncan's main-dashboard permission — open.** Matt: *"you'll have to move that permissions to manager, not just admin."* He now has the Advanced Repair Traffic tab on My Performance, which Matt said he preferred anyway; whether Duncan should also reach the main dashboard tab is undecided.
10h. **Server-side alias resolution for audits.** `MyPerformanceTab` now resolves names client-side via `?action=alias_map`. The cleaner fix is resolving in the audit route so every consumer benefits and the 1500-row payload can shrink back down.
10i. **`appointments.call_id` and `.ticket_number` are 0% populated** across all 967 rows, so the stored call → appointment → ticket chain does not exist. Price & Demand works around it by matching phone numbers (100% of calls, 86% of tickets, 30-day window). Populating those columns at intake would make conversion exact instead of inferred, and would let a specific appointment be tied to the call that created it.
10j. **iPad: 70 opportunity calls, 0 repairs closed** in the same 6 months. Either the work is going elsewhere or iPad tickets are logged under a device name that does not resolve. Worth one afternoon before assuming it is demand we are losing.
10k. **Model coverage is 77.5% of calls / 92.6% of tickets.** The long tail left unresolved is genuinely exotic (AirPods, Steam Deck, Meta Quest, Chromebook, external drives). Adding rules is cheap when a category starts to matter; `lib/device-model.js` is the one place to do it.
10l. **Recharts charts keep literal colours.** They are masked out of the theme sweep because `var()` does not resolve in SVG presentation attributes. Bar fills read fine on both grounds, but `CartesianGrid` strokes are near-invisible on white. `lib/theme-colors.js` is the fix when it starts to bother anyone — ComplianceTab already uses it.
10m. ~~**Repair Price Cheat Sheet as a page.**~~ **SHIPPED 2026-09-11** as `/prices` (`components/PriceBook.js`, `app/api/dialpad/price-book/route.js`, tables `repair_prices` + `repair_price_changes`, seeded from the xlsx by `tools/parse-price-sheet.py` → `tools/import-repair-prices.mjs`; 632 rows / 177 devices, 96.5% joined to a canonical model). Linked from the appointments header, readable by every role. **Rules that must survive edits:** agents see acceptance framing ("N of M paid full price") and never an average; `avg_collected` is admin-only; only `role === "admin"` (Eric, Matt) can edit, enforced by `requireAuth(..., ["admin"])` — the UI gate is cosmetic; every change writes `repair_price_changes` **before** touching the row, one `batch_id` per bulk edit with an `effective_date` so Price & Demand can mark it; re-seeding deletes only `updated_by like 'import:*'` rows and never re-introduces a price a person set.
10n. **RepairQ's catalog is the source of truth for prices; the sheet must match it** (Eric, 2026-09-11). The register price shown is the modal `item_details[].unit_price`, which is the catalog list price *before* the line discount (verified: 24/24 iPhone 16 Pro Max OLED lines ring $259.99 with discounts $0–$139.51 recorded separately). **First ledger event, batch `198416bb`, 2026-09-11, Eric Farr:** 19 prices matched to the register — 18 iPhone OLED screens the sheet had $20–$140 *above* RepairQ (16 Pro Max $399.99 → $259.99, 16 Pro $349.99 → $239.99, 15 Pro $279.99 → $209.99…) plus Note 20 Ultra $399.99 → $349.99 and the $188.87 typo on 12 Pro Max. **Still open: iPhone 14 Battery, sheet $159.99 vs register $149.99 on 8 jobs** — the one disagreement left after the insurance fix. `/prices` → Review them → Select all → Commit adopts it in one click if the catalog is right.
10o. **"(Protected)" catalog lines are insurance claims, not prices.** The insurer sets the price per claim (S23 Ultra: $320.76, $320.47, $320.68, $319.97…), so they never match a sheet row and on the first pass 76 lines showed as "rung at the register, not on the sheet" — for screens that were. They are now counted separately (291 claims across 60 model+repair groups in 6 months; S23 Ultra 25 @ ~$320.56, S22 Ultra 21 @ ~$329.58, iPhone 15 Pro Max 17 @ ~$404.19) and shown on the card as "not a quote". Anything that reads `item_details` for pricing must exclude `/\(protected\)/i` the same way, or insurance will look like discounting.
10p. **12 register lines have no sheet row at all** — real gaps, not attribution: MacBook Pro 14" (A2918) screen $499.99 × 7, MacBook Air 15" M3 screen $500 × 6, iPhone 15 Pro Max back glass $205 × 6, Pixel 9 Pro XL screen $369.99 × 3, iPad Pro 11" 1st-gen battery/charge port, MacBook Pro 16" battery. They are listed read-only in the reconcile panel; **adding a row to the sheet from that list is the next Price Book capability.** Also unresolved: `iPhone SE3` in `lib/device-model.js`; Price & Demand does not yet draw `repair_price_changes` as markers on the monthly trend (the ledger now has its first real event to draw). **MacBook screens** ($343–$650 collected against an $899.99 sheet / $799.99 floor) are deliberately parked: Eric and Matt will reprice them as part + labour.
10q. ~~**Book this quote.**~~ **SHIPPED 2026-09-11** (`457f94a`; plan in `docs/QUOTE_TO_APPOINTMENT_PLAN.md`, Phase 1). Every price cell has "Book this quote →"; the panel pre-fills device, repair, tier, sheet price, floor, the viewer's store and name; the agent adds customer, phone (blur → `match_call`, booking carries `call_id`), a time, and what they quoted. Migration `sql/migration_appointments_quote.sql` **run by Eric 2026-09-11** — adds `source, repair_price_id, device, repair, tier, canonical_model, canonical_repair, sheet_price, book_floor, quoted_price, quote_reason, booked_by_email`; `reason`/`price_quoted` still written as text so nothing else changed. **Booking floor rule (Eric's decision, over my recommendation of part + labour): 20% under the row's 6-month average collected** (`actuals.book_floor`, needs ≥ 3 jobs, else the sheet floor stands). Measured why I argued: average sold ($169.90) already sits $10 above the part + labour floor ($159.98), so an average-based floor can ratchet down as agents discount toward it — watch `quote_reason` counts for that. **Any quote under the sheet requires a reason** from `lib/quote-reasons.js` (Booking the appointment, Slow day, Price match, Repeat customer, Warranty / redo, Manager approved, Other + text). Under the floor still books, flagged red, counted. Anyone may book for any store. **Every option is bookable** (`779a63c`): the panel's "Coming in for" row lists every sheet row for the device, then the services the register has rung for that model — Diagnostic, Data transfer, Water damage, Software, Cleaning, Other repair — at the register's usual price (`services` in the price-book GET: modal price only when it covers ≥ 40% of jobs, model-level only with ≥ 3 jobs, else the family's; "Other repair" is offered with no price because it never has a usual one), and "Something else" with a free label. Service bookings carry `repair_price_id null`, `canonical_repair = type`. **Turnaround** (`d70107e`): chips mined from 974 past appointments (Under 1 hr · 1–2 hrs · 2–3 hrs · 3–4 hrs · Same day · Next day · 1–2 days · 2–3 days · 3–5 days · 5–10 days · Other), default from the sheet row; stored in `appointments.turnaround` — column added 2026-09-11 evening by Claude through the Supabase Management API (`POST /v1/projects/<ref>/database/query`) using the access token Eric keeps for his supabase MCP server in `~/.claude.json`, at Eric's direction ("go ahead do what you need to on SQL for me"); verified with a PostgREST select. That path exists for DDL when the SQL editor is out of reach — the service key cannot run DDL and the MCP server is `--read-only`. **First real booking from the Price Book: Duncan Hitti, 2026-09-11 13:32 ET, Indianapolis, "Sierra", Xbox Series S · HDMI port · Same day, quoted $149.99 = sheet (book_floor $104.59), no discount, booked before the turnaround chips shipped.** Every add now stamps `source` (`price_book` / `manual` / `import`) and `booked_by_email`. **Phase 2 SHIPPED 2026-09-12** — `app/api/dialpad/quote-metrics/route.js` (read-only) + a "Quotes from the Price Book" section at the top of Price & Demand: quotes booked, % at the sheet, avg discount, show rate (showed ÷ showed+no-show, pending excluded), **show rate by discount band** (at sheet / 1–10% / 10–20% / 20%+ / no reference), by reason, by agent, by model; `MIN_SAMPLE = 20` decided visits before a rate is called readable — below that the UI says so. **Price-change markers**: every `repair_price_changes` set_price row becomes an event with 60-day before/after (jobs/week, avg collected, full-price rate; insurance excluded) listed in the section and drawn as a dashed line on the model's monthly trend (green = introduced, orange = changed). Each Price Book cell shows "N of M quotes booked at full price this month · showed/didn't". **Ticket auto-link** (`appointments?action=link_tickets`, daily 11:30 UTC via Vercel Cron Bearer, or admin): appointment with a phone and no ticket ← first ticket with that phone closed within 14 days of the visit; never overwrites, never touches `did_arrive`. First run: **304 of 576 appointments (120 days) linked**; cross-check against agents' own marks: 280 of 293 "Converted" got a ticket (95.6%), 12 of 108 "Yes", 10 of 100 "No" (came back later or another ticket on that phone), 2 of 99 blank. **Open item 10i is effectively closed for the last 120 days.** ⚠ `ticket_number` on old rows is `''` not null — filter both. Also: a second booking arrived under `scheduled_by = "General Access"` — stores share logins, so the panel now has a "Booked by" field with the roster as a datalist, flagged orange when the session name isn't a roster name. **Interpretation dropdown** ("What should we be seeing — and doing?", top of the Quotes section): a rules-based *Reading* computed in the browser (sample size vs `MIN_SAMPLE`, share at the sheet with a 70% line, show rate at-sheet vs discounted once both have ≥ 5 decided, "(no reason)" and under-floor counts, top reason, price changes still inside the 60-day window, matured before/afters) plus **Ask for actions** (admin/manager) → `app/api/dialpad/quote-insights` POSTs the compact metrics to `AI_MODEL` (now a single constant in `lib/constants.js`) and returns headline / what it says / do this week (with an owner) / watch next week / caveat; house rules in the prompt: aim high, <20 decided is "too early", before/after never "caused", numbers only from the data. Cached in sessionStorage per data shape per day; failures shown, never blanked. quote metrics in Price & Demand (share at sheet, avg quote discount, show rate by discount, before/after each ledger event), acceptance line "N of M booked at full price" on cells, auto `ticket_number` link.
10r. **Appointments route is now authenticated** (`457f94a`). Every POST needs a signed-in user: any role adds/updates, manager deletes, admin clears a store. It had accepted writes from anyone with the URL since it was built (CORS `*`). All seven POSTs on `/appointments` now go through `auth.authFetch`; nothing else called it (extension checked). `scheduled_by` defaults to the session name — hand-typing had produced 18 spellings for 8 people, 36 blank.
10s. **Price & Demand: Screen drops open to OEM / OLED / LCD** (`ad98efd`) in a model's "Pricing by repair" table — jobs, list, selling price, discount share, full-price count per tier. **Insurance "(Protected)" lines are now excluded from every Price & Demand average** (410 of 1,944+410 lines in 6 months) and counted per model — same rule as the Price Book, shared via `lib/repair-type.js` (`tierOfCatalogLine`, `isInsuranceLine`, `TIER_ORDER`). ⚠ This moved numbers Eric had seen before on iPhone/Samsung screens: they were averaging insurer prices in.
10t. **Morning Brief: Discounts card** (`ad98efd`) — repair lines rung under list yesterday, how many went under the 6-month average for that model + repair + tier (the same number the booking floor uses), dollars given away, each line linked to `cpr.repairq.io/ticket/<n>`. New read-only route `app/api/dialpad/discounts?date=`; Indiana calendar day; insurance excluded; `daily-profit` untouched. First read (2026-09-08): 22 repair lines, 9 discounted, 5 below average, $509 given; 13 Pro OLED at $30 and 15 OLED at $59.99 lead — warranty re-dos rung as discounts, which is exactly what `quote_reason` will separate going forward.
10v. **Price Book "Add device"** (`4739dd9`) — edit mode → "＋ Add device": one or more names, one per line; the product line is cloned from the model before it (template guessed by stepping the generation number down: S27 Ultra → S26 → S25 Ultra; overridable). Every template row is copied — repair, tier, prices, floor + rule, turnaround, flags — so bulk edit is the second step. Ledger: one batch of `set_price null → price` with reason "Added <device> from <template>" — **a null → value ledger row means "went on the sheet that day"** for Price & Demand markers. **Missing-model recommendations** (`3f42b88`, Eric: "should not be something we do manually"): the route lists every model with ≥ 3 real register jobs and no sheet row, each with a recommended product line — template = the model before it, prices = the register's where it has rung ≥ 2 times, the template's otherwise, plus register-only lines. Banner + reconcile panel → "Add iPhone 17 Pro →" opens the add panel prefilled, prices editable. Catch-all types (Other repair, Accessory, Diagnostic, Data transfer, Water damage, Software) are ignored. **As of 2026-09-11 it recommends 5: iPhone 17 Pro (36 jobs, OLED rings $259.99 vs 16 Pro's $239.99), iPhone 17 Pro Max (35, $269.99), iPhone 17 (12, $249.99), Galaxy A03s (5, no template), iPhone 8 Plus (3, no template).** "iPhone SE" had shown as missing with 36 jobs because the sheet's SE3 rows had `canonical_model = null`; every SE spelling now resolves to "iPhone SE" and the two rows were pointed at it. Dev-only `?as_admin=1` on the price-book GET renders the admin payload locally (ignored in production).
10u. **Price Book "stop offering"** (`ad98efd`) — Matt selects rows in edit mode → "Stop offering selected"; agents stop seeing them, admins see them dimmed with "not offered", register history stays attached, "Offer again" reverses. Ledger records `active 1 → 0`. Verified the non-admin payload leaks none.

10w. **Matt's 2026-09-21 email — status.** Shipped (`d3438c4`): Add repair on a device, "1 hour" turnaround, "Set price" / "at listed price!" wording, quoted-price box obviously editable with set / −$10 / −$20 chips, newest model first, Non-Phone Repair Traffic rename + compare-to selector (previous / peak / slowest / average), Windows laptops in Price & Demand (`matchPc` in `lib/device-model.js`; 220 rows newly resolve, 0 lost), floor-above-price ignored in the booking panel. **Payroll, Eric signed off 2026-09-21:** (a) **cleanings commission ends after 2026-08** — `lib/commission-rules.js` `CLEANING_COMMISSION_LAST_PERIOD`, a dated rule rather than the `enabled` flag so August stays as paid; CLN sales 10% continues; the scorecard's `emp_repair_sub_clean` weight is untouched; (b) **Sales & Repairs shows gross profit** from `ticket_grades` by `employee_added` through the roster resolver (`gpByEmployee` in `sales/route.js`; Assurant/API dropped, unmatched counted in `gp_meta.unresolved`); Aug 2026: 806 graded, 1 unresolved, $58,408 across 8 people, matches SQL to the cent. **Paycheck name-match bug — FIXED 2026-09-21** (payroll; Eric: "Luke Schooley isn't an employee and never has been. Commissions are paid from their 'paycheck' on their MyPerformance screens"). `MyPerformanceTab`'s `findEmp` matched sales-import rows through `matchName`, which accepts a first-name hit. Measured against the live route, base commission before tier multiplier: **Luke Stirling Aug 2026 page $90.38, correct $133.38** (phone row was Luke Schooley); **Matthew Ziegler's page showed Matthew Slade's commission — Mar $207.44 (his $89.40), Apr $200.12 ($0.00), Aug $183.85 ($1.00)**; Slade's own Mar page $207.44 vs $235.44 (CLN-sales row matched Ziegler). Ziegler is **not on `employee_roster`** but `dashboard_users` has a login named "Matthew Ziegler" (`ejfarr1022@gmail.com`, employee, indianapolis). Pay rows now match on the whole name only (`sameName`, exact or "Last, First"). `matchName` still serves the other 18 call sites (scorecard lists, tickets, "Duncan" literal) — collision-safe today because no two roster people share a first name. **Owed/overpaid to settle: Luke Aug −$43.00 base (× his tier multiplier); Ziegler +$118.04 / +$200.12 / +$182.85 base if he was paid from his screen.** Stray import rows (Luke Schooley, Eric Green, Michele Pastorius) can be deleted from Sales & Repairs → strays. **Resolved 2026-09-21:** the "Matthew Ziegler" login was Eric's old test account — deleted from `dashboard_users` at his direction; nobody was overpaid. Ziegler himself was let go long ago; his 2026-03/04/08 import rows are legacy strays. **Matt Slade is not on tech commission or the per-employee bonuses** — he is salaried as Area Manager with a separate annual profit-share (terms are in his offer letter, deliberately NOT recorded in this public repo). `employee_roster.bonus_eligible = false` already keeps him out of tier awards; **Applied 2026-09-21:** `bonus_eligible = false` now also means no per-repair commission and no answer-rate bonus — the answer-rate route resolves each WhenIWork name through the roster and marks him `not_bonused` (kept on the list at $0, out of the totals: Aug payout $450 → $400, Sep $400 → $300 so far; he had been listed for $50 Jul / $50 Aug / $100 Sep from scheduled hours), the sales route returns `not_commissioned`, and Sales & Repairs / My Performance show his work with "salaried · no per-repair commission" instead of a payout. Stale logins worth reviewing: `jojotross@gmail.com` (Jordan Ross, employee — off the roster) and `jasonalexferguson12@gmail.com` (Alex Ferguson, manager — not on the roster). **Area manager profit-share tracker** (2026-09-21, Eric: calendar year 2026): a card on the Profitability tab's Monthly Trend — company net profit YTD (sum of the three stores' P&L net, the same `compute()` the table uses), amount above/below the threshold, share earned so far, and an on-pace projection (saved-month average × 12). The rate and threshold are **`commission_config` rows `am_profit_share_rate` / `am_profit_share_threshold`, deliberately not in code** — this repo is public. Until January and February are entered (10f) the card says so and the YTD is understated by roughly the −$6,000 those months are expected to carry.

### Priority 4 — New capabilities Matt requested
11. **Advanced Repair tab.** Per store + combined: monthly non-phone profit split by consoles / tablets / computers / misc (from `device_category`), total vs $15k, projected bonus, ticket counts, avg profit/ticket, turnaround time. Replaces Matt's manual "profitability by item type" screenshot. **Prereq: category diagnostic** — ~1,100 tickets show "unknown repair" in Insights; dump distinct `device_category` values + counts + summed profit per month; determine if unknowns are legacy or current grader failures; build explicit allowlist mapping raw values → 4 buckets with a visible "uncategorized" row (never silently drop). Watches → misc. Per-ticket bucket assignment, no line-item splitting.
12. **Console demand analytics.** Keyword/device extraction from call transcripts ("how many PS5 opportunity calls in Indy this month?") surfaced on the Advanced Repair tab → answers whether the constraint is call volume (marketing) vs conversion (pricing/turnaround/phone skills).
13. **Shrinkage & damage.** Screenshot upload of RepairQ inventory usage summary (monthly at reconciliation; same pattern as Amex import) → shrinkage + damages into P&L operating expenses → **shrinkage stat on TV dashboard**. Weekly (Monday) update cadence.
14. **P&L adjustments.** Move LCD credits to Other Income (with Fieldprint); add shrinkage/damage expense lines; keep misc in non-phone rollup; **grant Matt edit permission on controllable expenses** (he couldn't edit in the meeting).
15. **Dashboard declutter.** Remove Keyword Analysis (also code-audit #1: fake data); merge Missed Calls into Call Performance; drop Callback Tracking, Problem Calls, Voicemails tab (Slack zap covers voicemails). Keep Call Quality, Compliance, Insights device data, MyPerformance (don't touch). Fix Coaching tab showing Matt & Luke incorrectly. Add "busiest call days" simple stat.
16. **Morning briefing view** for Matt on login: yesterday's profit per store, answer rates, missed calls, appointments scheduled/converted, shrinkage MTD, coaching flags.
17. **TV dashboard link** in main nav (top-right).

### Priority 5 — Local SEO / console reviews (no code)
18. Invisible on "video game console repair Fishers" map pack; competitor with 800+ reviews owns it. Drive ~10 console-specific Google reviews per store (employees, family, customers); post console-repair photos to GBP. Photo reviews already pay $5/employee.

### Carryover technical items
19. Confirm Profitability deploy (June dropdown fix + per-store Clear button + `clear` POST action; push component + route together).
20. Confirm DialpadDashboard deploy (Calls Audited headline was pinned at 1000; now derives from `consolidatedStores` → all-time ~3,643). Decide: keep all-time or add true 30-day server count.
21. Confirm extension file-swap fix landed → clean end-to-end batch with keep-alive surviving inactivity lock.
22. Deploy `lib/supabase.js` paginated `getEmployeeStatsFromAudits` (delivered, not confirmed deployed).
23. **Cron dispatcher:** `cron-route.js` with `AbortSignal.timeout(2000)` + `Promise.allSettled` shipped — deploy + test, then switch cron-job.org's three store crons (which time out at 30s) to single dispatcher URL.
24. **"CPR Bloomington 2" Dialpad dept ID** still needs adding to `lib/constants.js` `dialpadIds`.
25. **Freshness/sanity monitor** — latest row per table per store + alert if >24h stale. Would have caught the entire June saga in a day.
26. Code-audit findings: #1 keyword tab fake data, #3 prop mismatch, #4 duplicate tabs, #5 dead `OverviewTab` (delete). DataProvider context refactor deferred (high regression risk).
27. Light mode Phase 2: ThemeProvider built, appointments page converted; main dashboard components still need CSS-variable conversion.
28. `delete_by_employee` in audit route (may not be deployed); `migration_cleaning_sales.sql` pending + verify cleaning sales route ("Invalid action" seen).
29. Extension: auto-grade-on-view mode; optional grade-prompt trimming for monster tickets (only if timer shows many 40s+ grades).
30. QuickBooks integration — Eric interested, not priority.
31. Qualitative call scores (tone/clarity/empathy) stay **calibration-only** until explicitly approved.

---

## 6. Agreed build order (from 8/17 plan)
1. Streak fix + pay $100s; Daily Profit one-day reconciliation; sync-closed-tickets.
2. Test-call detection + store-level opp/existing split; June backfill.
3. Advanced Repair tab + console keyword analytics; shrinkage upload + TV stat + P&L lines + Matt's permissions.
4. After one clean answer-rate month: re-tier (confirmed table) + Duncan formula.
5. Ongoing: declutter + morning briefing; console review campaign starts now.

---

## 7. Key facts from the 8/17 meeting (raw reference)
- Fishers Saturday 8/15: ~$1,000–1,100 closed; only possible because Matt was there for computer repairs while Aaron (wrist) did phones/console. Zero missed calls that day.
- Fishers 88% answer rate ≈ 36 missed of ~300 calls/month; 5 points ≈ 15 calls.
- Bloomington ~79–81% answer rate, 19 appointments/month (~1/day) — needs to tick up with students back and Andrew on staff.
- Consoles pitched at 3–5 day turnaround, lifetime warranty; undercutting some competitors ($130 vs $150); PS5/PS4 cleans growing.
- Insurance claim payouts now ~$90–100 avg (flips/folds $140–150), up from ~$50.
- Ticket profit discrepancies observed: $113 vs $21; discount of $65 changing synced price to $199; Luke's hourly rate in RepairQ not saving.
- Coaching example for Alec: ticket missing final-call note and "ready for pickup."
- Matt: "Coaching tab is hard to parse." Wants concise, presented differently — not more data.
- Indy shrinkage $125 parts (40–50 are $2–5 adhesives never attached to tickets — legacy cleanup).
- Bloomington franchise renewal call was 8/17 at 3pm; Matt to help with compliance photos.

---

## 8. Recent changes log
- **2026-09-11 (evening)** — Four asks, four ships. **Book this quote** (§ 10q): the appointment is now a consequence of the price the agent read out; migration run; floor = 20% under average at Eric's direction, reason required under the sheet. **Appointments route authenticated** for the first time (§ 10r). **Screen tiers** OEM / OLED / LCD in Price & Demand and insurance claims removed from its averages (§ 10s). **Discounts card** on the Morning Brief with ticket links (§ 10t). **Stop offering** in the Price Book for Matt (§ 10u). Measured before deciding the floor: 27.5% of retail repair lines over 6 months closed below the sheet's own part + labour floor, and average sold sits $10 above it. The sheet's part costs are stale (16 Pro Max OLED part $284 → floor $364 above its $259.99 quote; 8 rows upside-down) — Eric: "disregard those". ⚠ Verification of the booking panel in the browser was blocked by a background-tab freeze in Eric's Chrome (timers throttled while hidden), so **the first real booking is Eric's to make and confirm**; the route was exercised only through the build and the migration.
- **2026-09-11** — **Price Book** shipped (§ 10m) and used for real the same day: Eric's first commit matched 19 iPhone OLED prices to RepairQ's catalog through the new reconcile panel, verified in the DB as one batch (§ 10n). The panel's first read was wrong in a way worth remembering — it flagged 76 "register lines not on the sheet", and Eric spotted that S22 Ultra *was* on the sheet: the lines were "(Protected)" insurance claims, each at an insurer-set price, pooled with retail (§ 10o). After separating them: unlisted 76 → 12 real gaps, disagreements 19 → 1. The reconcile panel now needs ≥ 3 jobs with the majority at one price before it calls something a disagreement. Also this session: Price & Demand split by repair type with client-side filtering (`lib/repair-type.js`, 99.3% of ticket lines classified), **unordered `.range()` pagination returns overlapping pages** — `fetchAll` now requires an `orderBy` (the 109 / 63 / 93 instability was this), 10b closed, `CRON_SECRET` set in Vercel by Eric (prod cron returns 401 without it), Chrome extension zipped for Matt's Mac with POSIX paths. ⚠ Two things flagged, not fixed: the extension's grade POST is unauthenticated (anyone with `GRADING_SECRET` from the public repo can write `ticket_grades`), and `advanced-repair-traffic` logs a "Dynamic server usage" error at build time because it reads `request.url` without `export const dynamic = "force-dynamic"` — harmless today, but it is noise in every build.
- **2026-09-10 (later)** — Build day continued. **Price & Demand** shipped as its own tab (§ 10c) on `lib/device-model.js`, a conservative model resolver in the same spirit as `lib/roster-resolver.js` — 1,155 distinct call device names against 240 ticket names, naive matching hit 109, the resolver reaches 141 with 25 unit tests. **Zero / negative profit report** shipped inside Ticket Compliance (§ 10a). **My Performance call attribution fixed twice over**: it never read roster aliases, so Alec saw 29 of his 213 calls, and the request asked for `limit=300` store-wide before narrowing to one person, which clipped every store (Bloomington has ~432 scorable audits in 30 days). The conservative resolver moved out of `call-leaders` into `lib/roster-resolver.js` and is now shared; verified byte-identical on two months of call-leaders output before/after. **Light mode finished**: `ThemeProvider` had only ever been mounted on `/appointments`, so the main dashboard defined no tokens at all and every converted component lost its card backgrounds — it now wraps the app in `app/layout.js`, ~2,100 further literals were converted, and content is capped at 1600px. **Recharts renders black on `var()`** in SVG attributes; the sweep masks those regions and `lib/theme-colors.js` resolves tokens to literals for charts. **Cron secret removed from `vercel.json`** — Vercel Cron sends `Authorization: Bearer $CRON_SECRET` and the route already accepted it, so the four store crons keep authenticating. ⚠ The value stays `cpr-audit-cron-2026-secret` at Eric's explicit direction (2026-09-10); it is in a public repo, so the ingest and audit endpoints are triggerable by anyone who finds it. `CRON_SECRET` still needs setting in Vercel.
- **2026-09-10** — Everything Eric asked for on the 09-10 call, shipped same day. **P&L manual entry**: LCD credits reclassified from EXPENSE to Other Income (entering a $1,078 credit had been moving net profit DOWN by that amount — a $2,156 swing; no month was restated because every row was 0), Fieldprint + LCD under Other Income, damage/shrinkage grouped as Store Controllables, statement figures made click-to-edit, and `copy_forward` no longer carries controllables into a new month. **Monthly Trend** chart added (`ProfitabilityTrend.js`) with YTD per store; it imports `compute()` from ProfitabilityTab so chart and table cannot drift. **Duncan** got an Advanced Repairs tab on My Performance, gated on the same rule as his bonus. **Advanced repair log** now syncs daily at 11:00 UTC (7am ET) via Vercel Cron, authenticated by `Authorization: Bearer $CRON_SECRET` — header, not query param, so no secret enters vercel.json. **Light mode** fixed across 5 components (357 colour literals → theme tokens) plus the hard-coded dark `body` in globals.css. **My Performance call attribution** fixed: Alec was seeing 29 of 213 calls. ⚠ **`CRON_SECRET` must be set in Vercel** or the daily sync returns 500 by design.
- **2026-08-31 (evening)** - Answer rate now excludes sub-15s answered calls from 2026-09 forward
  (payroll, Eric-approved; forward-only so no bonus is clawed back - verified Jul/Aug return
  byte-identical figures). Chrome extension moved into `extension/` and version controlled for the
  first time; fixed three financial-extraction bugs in `content.js` (Subtotal/Total regex collision,
  negative amounts unparseable, single-comma strip), added `popup.js` header comment and
  `extension/README.md`. **The extension must be re-loaded in chrome://extensions by Eric - pushing
  to Vercel does NOT deploy it.**
- **2026-08-31 (later)** — Diagnosed open item 2 (Daily Profit): it is a **coverage** problem, a subset
  of item 3, not a calculation error. GP verified against RepairQ to the penny. Answered open item 7:
  no short-call filter exists, and found that `talk_duration` is stored in **minutes** — a filter
  written as `< 60` would zero the answer rate. Excluding sub-60s answered calls moves rates
  −6.9 / −3.6 / −6.0 points, matching the predicted 5–10% drop. No code changed; both remaining
  Daily Profit bugs live in the Chrome extension, which is not in this repo.
- **2026-08-31** — Streak bonuses fixed end-to-end and backfilled (open item 1). One route changed
  (`tier-history`), one migration added (`tier_celebrations` + `employee_tier_history.is_locked` +
  `employee_roster.bonus_eligible`). Deployed to production and verified live. Repo had **no
  `.gitignore`** — added one before any `.env.local` existed. `CLAUDE.md` + `docs/CONTEXT.md`
  committed to the repo.
- **2026-08-30** — Migrated workflow to Claude Code (local clone + Supabase MCP read-only). Created `CLAUDE.md` + this file.
- **2026-07-08** — Extension: bounded awaits, standalone progress window, skip-already-graded, RepairQ keep-alive. Dashboard: Calls Audited headline fix (delivered), Profitability month dropdown + per-store Clear (delivered). `lib/supabase.js` pagination (delivered, unconfirmed).
- **2026-06-24** — Model string fixed across 12 routes after outage. PostgREST cap → 100k. `call-leaders` paginated.

---

## 9. Tier bonus payouts owed (calculated 2026-08-31, NOT yet paid)

Backfill of Mar–Aug 2026. **$500 cash + 1 PTO day**, across four people.

| Period | Who | Store | Award | Streak |
|---|---|---|---|---|
| 2026-05 | Alyssa Parent | fishers | $100 | 3 mo Gold+ |
| 2026-05 | Luke Stirling | bloomington | $100 | 3 mo Gold+ |
| 2026-06 | Duncan Hitti | indianapolis | $100 | 3 mo Gold+ |
| 2026-07 | Aerick Long | fishers | $100 | 3 mo Gold+ |
| 2026-08 | Alyssa Parent | fishers | $100 | 6 mo Gold+ (second award) |
| 2026-08 | Alyssa Parent | fishers | 1 PTO day | 3 mo Platinum |

Plus 6 zero-dollar `tier_up` recognition events. Summary artifact for Matt:
https://claude.ai/code/artifact/b786f32c-534a-4d02-a33b-5270c31f489f

**Rules as implemented (Eric confirmed 2026-08-31):**
- Gold streak is **recurring** — $100 per completed 3 consecutive months at Gold+, so it pays
  again at 6, 9, 12. Platinum streak (1 PTO day) works the same way.
- **Eligibility is `employee_roster.bonus_eligible`, deliberately NOT the `role` label** — a role
  rename must never silently restore someone's bonuses. Matt Slade is `false` (area manager).
  Ineligible staff still get `employee_tier_history` rows; they are excluded only from awards.

**Two things to confirm before paying:** Aerick's July $100 and Alyssa's *second* $100 were not
anticipated (the expectation was $200 total, Duncan + Alyssa). Both are correct on the scores, but
they are new.

**Related data bug, not fixed:** `employee_roster.role` for Matthew Slade reads `"Technician"`.
He is the area manager. Payroll is unaffected (eligibility uses `bonus_eligible`), but `role` feeds
the peer-comparison pools in `flags/route.js` — likely the same stale data behind open item 15
("Coaching tab showing Matt & Luke incorrectly"). Changing it shifts his peer pool, so it was left
for Eric to decide.

---

## 10. Ticket financials: RepairQ is the source of truth (2026-08-31/09-01)

**The report, not the ticket page, is authoritative for money.** The Chrome extension
scrapes the ticket page, which shows the transaction as originally rung — list prices,
before returns, adjustments and no-charge discounts. RepairQ's **Profitability by Ticket**
export shows what actually moved. Reconciled for the first time on 2026-08-31:
`ticket_grades` was understating gross profit by **$106,719** across 4,125 tickets, with
another **$86,109** on 1,060 tickets never graded at all.

Import with `tools/import-profitability.py` (dry run by default, `--apply` to write; see
`tools/README.md`). After the import, April–August reconcile to **$0.00**.

**`tickets/route.js` no longer writes financial columns on a re-grade** — only on first
insert — or every re-grade would silently revert the imported figures to scraped ones.

### Four scraping bugs found and fixed the same day
1. `/Total[:\s]*\$/i` matched the "total" inside **Subtotal**, so `total_collected` was the
   subtotal on all 815 discounted tickets. Needs `\b`, and prefer the **Payments** line.
2. **RepairQ writes losses in accounting parentheses on the line AFTER the label** —
   `"Gross Profit:\n($ 198.38)"`. The sign group didn't accept `(`, so the match failed,
   the field was never assigned, and the server's `|| 0` stored **0**. No row in 4,124 had
   ever been negative; $4,538.90 of real losses sat as break-even.
3. `.replace(",", "")` dropped only the first comma — `$1,234,567.89` parsed as `1234`.
4. **Unclosed tickets were counted as booked revenue** (see below).

### ⚠ date_closed was being invented on open tickets
The extension assigned whatever single date it found in the Summary sidebar to
`date_closed`, **including on tickets that had not closed**. An open ticket showing only its
created date was indistinguishable from a completed sale, and `daily-profit` buckets on
`date_closed` and calls it "the revenue event".

121 unclosed tickets carried **$28,276 of gross sales / $11,421 of gross profit** as if
booked — 48 of them `waiting_for_payment`, money not yet collected. 101 sat in August and
accounted for the entire August discrepancy. **This was also the original 8/14 Fishers
question** ($1,747 vs $1,493.61) — never a discount-math problem.

`content.js` now reads ticket status and discards the date unless the ticket is closed.
`tools/clear-unclosed-dates.py` remediated the existing rows. August now reconciles at
804 vs RepairQ's 813 tickets, 0.07% on gross sales; the 9 remaining are ungraded.

**Optional, not yet run:** `alter table public.ticket_grades add column if not exists status text;`
The extension already sends `ticket_status`; the server does not persist it yet.

### Store attribution
`tickets/route.js` used to **always** overwrite the ticket's store with the employee's
roster store. Every employee had 100% of their tickets at their home store and zero
elsewhere — Matt's 597 area-manager tickets all on Bloomington, Luke's post-move Indy work
still Bloomington. Fixed forward 2026-08-31: the ticket page wins, roster is the fallback.
**History keeps its old attribution until re-graded.**

### Gotchas the export taught us
- The export's **`Date` column is the CREATED date**, not the close date — a Feb–Aug
  close-date filter returns rows dated 2025. Never group months by it.
- **The export has no location column.** Per-store figures need one export per location.
- The report paginates at **100 rows** in the browser; the extension's batch only sees the
  rendered page. Use the extension's **Re-grade Ticket List** mode, which goes straight to
  `/ticket/<number>` and ignores pagination.

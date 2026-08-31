# CPR Dashboard — Business Context & Current State

**Last updated:** 2026-08-31 (streak bonuses fixed + backfilled; payouts owed in § 9)
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
3. **RepairQ sync only pulls active tickets.** Closed tickets don't sync → Matt manually marks closed; Alyssa/Duncan advanced-repair bonuses showed $0. Need: sync closed tickets + "re-sync all" that refreshes financials on stored tickets so wage-rate fixes propagate backward. Loud failures.
4. **June 15–23 backfill.** Re-run audit cron over the window + batch-grade June 15–23 tickets via extension (skip-graded makes it cheap). Two Fishers conversions depend on it: Timothy Bailey appt 6/16 → ticket #16075332; Jennifer Coffield appt 6/17 → ticket #16079316. `verify-conversions` 14-day window may need manual widen/rerun.

### Priority 2 — Answer-rate integrity (before re-tier)
5. **Test-call detection.** Staff will say only "test" on test calls (Matt owns telling them). Dashboard: flag transcript-is-just-"test" as third category (not opportunity, not existing), exclude from answer-rate denominator, **display test-call count** so testing stays visible/praised. Going-forward only, no retroactive scrub.
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

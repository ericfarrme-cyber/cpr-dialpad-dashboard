# CPR Dashboard — Claude Code Instructions

This repo is the business-intelligence dashboard for **Focused Technologies LLC** (Eric Farr), which operates three CPR Cell Phone Repair stores: **Fishers, Bloomington, Indianapolis**. Live at `cpr-dialpad-dashboard.vercel.app`. Vercel auto-deploys on push to `main`.

Full business context, personnel, comp structures, open items, and the current priority list live in `docs/CONTEXT.md`. **Read it at the start of every session.**

@docs/CONTEXT.md

---

## Non-negotiable rules

1. **Measure first.** Run diagnostic SQL or read the actual code before proposing any fix. Theories have repeatedly died on contact with real data. Never guess at root cause.
2. **Payroll-sensitive code requires explicit sign-off from Eric before any edit.** See the list below. Isolate changes; never bundle payroll edits with other work.
3. **Loud errors over silent failures.** Never `catch → return {success:false}` with HTTP 200. Throw, log, or surface. The June 2026 outage (8 days of silently failed AI calls across 12 routes) is why.
4. **Anchored edits only.** No blind rewrites of existing files. Read the file, edit the specific block.
5. **Validate before pushing.** Run `npm run build` (real Next.js build). Never rely on `node --check` — it once passed a stray-brace error that broke production.
6. **Never activate a payroll-touching feature on data that is known to be inaccurate.** Fix accuracy first, then activate.
7. **Deploy verification is via Eric.** Push → Vercel deploys → Eric confirms with a screenshot. Say exactly which files changed and what he should see.
8. **No secrets in committed files.** Env vars only. Never write keys, tokens, or the cron secret into `CLAUDE.md`, docs, or code.

### Payroll-sensitive files (sign-off required)
- `app/api/dialpad/answer-rate-bonus/route.js`
- `app/api/dialpad/scorecard/route.js`
- `app/api/dialpad/daily-profit/route.js`
- `app/api/dialpad/profitability/route.js`
- `components/ScorecardTab.js`, `components/MyPerformanceTab.js` (Paycheck / streak / tier display)
- `lib/audit-config.js` (scoring weights)
- Anything reading `commission_config`, `employee_shifts`, `weekly_goals`, or computing bonus dollars
- Chrome extension grading prompt (grades feed `ticket_grades`, which feeds bonuses)

---

## Stack

- **Next.js 14** (App Router), JavaScript (not TS), **Recharts**, **Supabase** (Postgres + Auth + Google OAuth)
- **Supabase project:** `cpr-audit`, ref `yogkiqvpzgbxhyqnotjm`, us-east-1, Pro plan
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (fallback `SUPABASE_SERVICE_KEY`), `ANTHROPIC_API_KEY`, Dialpad + WhenIWork tokens. All in `.env.local` (gitignored) and Vercel project settings.
- **AI model:** `claude-sonnet-4-6` everywhere. Never hardcode a dated model string (`claude-sonnet-4-20250514` retirement caused the June outage). Prefer a single constant in `lib/constants.js`.
- **Brand:** dark mode, Space Grotesk, cyan `#00D4FF` / purple `#7B2FFF` / pink `#FF2D95`. Store colors: Fishers `#E03E3E`, Bloomington `#1A9E8F`, Indianapolis `#D4A017`.

## Integrations
- **Dialpad API** — call data, transcripts, department IDs in `lib/constants.js`
- **WhenIWork API** — schedules/shifts
- **RepairQ** — via Chrome extension (ticket grading) + CSV imports; no public API
- **Anthropic API** — ticket grading, call audits, AI assistant, weekly goals, vision extraction (screenshot imports)
- **Google Business Profile** — reviews via `google-reviews` route

---

## Architecture gotchas (learned the hard way)

- **Vercel serverless functions cannot reliably HTTP-call themselves.** Use direct Supabase queries, never `fetch('/api/...')` from a route.
- **Never call `createClient()` at module top level** in API routes — it runs at build time without env vars. Use a lazy initializer (see `lib/supabase.js`).
- **PostgREST "Max rows" cap** is set to 100,000 in the Supabase dashboard. If any total looks clipped (~546 or ~1000 exactly), suspect the cap or a client-side `limit=`. Paginate reads that can exceed it (`.range()`, pageSize 1000, ordered).
- **Bloomington has two Dialpad departments:** "CPR Bloomington" and "CPR Bloomington 2". Every call query must fan out over both IDs via `storeDeptIds()` and dedupe by `call_id`. (Bloomington 2 ID still needs to be confirmed in `lib/constants.js` — see open items.)
- **Category string matching:** `cats.includes("answered")` matches "unanswered". Always split category strings into tokens and match whole words.
- **Employee vs store score shapes differ:** employee scorecard has `emp.repairs`, `emp.audit`, `emp.compliance` as **direct properties**. Store scores use a `categories` wrapper. Don't assume either.
- **Time windows:** rolling 30-day windows mixed with calendar-month scorecard data produce misleading numbers. Use month-to-date clamp for the current period, calendar-month bounds for history.
- **Data sources for totals:** `store_performance` (server-aggregated, all-time, uncapped) is trustworthy for headline totals. `getAuditResults` is a windowed + capped list — fine for lists, never for totals.
- **Profitability tab:** revenue/COGS are pulled live from RepairQ per period; only expense inputs, labor, and notes are stored rows. `copy_forward` zeroes revenue, other income, and hours.
- **RepairQ sync currently pulls only ACTIVE tickets.** Closed tickets are not synced — this is a known bug (see open items).
- **`sed` fails on multi-line patterns and Unicode.** For scripted edits use Python `content.replace()`.
- **When something breaks right after an update, check simple causes first** (file swap, wrong env var name, stale deploy) before deep debugging. But prove it — don't guess.

---

## Repo layout

```
lib/            constants.js, supabase.js, supabase-browser.js, data.js, audit-config.js, auth.js
components/     DialpadDashboard.js (main shell), EmployeeTab, ScheduleTab, VoicemailTab, SalesTab,
                ScorecardTab, ComplianceTab, InsightsTab, AIAssistant, AdminTab, ProfitabilityTab,
                DailyProfitTab, TVDashboard, ScreenDaily, ScreenRankings, MyPerformanceTab,
                ThemeProvider, ErrorBoundary, AuthProvider
app/            login/, auth/callback/, appointments/
app/api/auth/   me/, users/
app/api/dialpad/ audit, cron, roster, stats, stored, voicemails, sales, scorecard, tickets, insights,
                summary, repeat-callers, appointments, weekly-goal, ai-chat, google-reviews,
                profitability, extract-profitability, extract-gbp, extract-amex, verify-conversions,
                daily-profit, answer-rate-bonus, call-leaders
middleware.js   security headers only (auth is client-side via AuthProvider)
vercel.json     3 per-store staggered crons with secret in path
extension/      Chrome extension "Focused Technologies — Ticket Grader" (if moved into repo; see below)
```

## Supabase tables
`audit_results` (call audits; has `tone_score`, `clarity_score`, `empathy_score`, `qualitative_notes` — calibration only, must NOT affect scorecards), `ticket_grades` (keyed on `ticket_number` text; has `discount_amount`, `total_cost`, `total_collected`, `payment_method`, `turnaround_hours`, `item_details` JSONB, `device_category`, `device_brand`), `employee_roster` (with alias arrays for transcription mismatches, e.g. Aerick Long → `{eric,erik,derek,arick}`), `dashboard_users`, `appointments`, `weekly_goals`, `google_reviews`, `gbp_reports`, `profitability` (with `corporate_overhead`, `area_manager_expenses`, `area_manager_breakdown` JSONB), `phone_repairs`, `cleaning_sales`, `employee_shifts`, `commission_config`, `store_performance` (aggregate).

Migrations already run: `audit_integrity`, `sales_tables`, `commission_toggle`, `scorecard_weights`, `ticket_grades`, `ticket_notes_subcriteria`, `ticket_phone`, `compliance_weights`, `cx_insights`. Pending: `migration_cleaning_sales.sql`.

---

## Scoring architecture (all configurable via `commission_config`)
- **Employee overall:** Repairs 35% + Audit 35% + Compliance 30%
- **Repair sub-weights:** Accessory GP 50%, Repair qty 25%, Cleanings 25%
- **Audit sub-weights:** Avg score 50%, Appt offered 25%, Warranty mentioned 25%
- **Store overall:** Repairs 25% + Audit 20% + Calls 15% + CX 10% + Compliance 20%

**Ticket grading criteria** (Chrome extension → `tickets` route → `ticket_grades`):
1. Diagnostics — issue + price + turnaround time
2. Notes — repair outcome + customer notified of completion (exception: customer already returning)
3. Payment — only if parts ordered, must be within 2 hours of intake; N/A otherwise
- Weights: payment applies 35/40/25; payment N/A 45/55. Sale tickets excluded from compliance scoring.

---

## Chrome extension (Ticket Grader)
Files: `manifest.json`, `background.js`, `content.js` (~1269 lines incl. keep-alive IIFE), `content.css`, `popup.html`, `popup.js`, `progress.html`, `progress.js`. Deploy = replace files in the local folder → `chrome://extensions` → reload icon.

**Every file has an identifying first-line comment.** After any multi-file change, tell Eric which first line belongs in which filename (a file swap once made the whole extension go dead):
- `background.js` → `// Background service worker — handles batch ticket grading`
- `progress.js` → `// Standalone batch-progress window.`

Key mechanics: bounded awaits (`EXTRACT_TIMEOUT_MS=30000`, `GRADE_TIMEOUT_MS=60000`, `CHECK_TIMEOUT_MS=20000`, `LOAD_TIMEOUT_MS=15000`, `EXTRACT_RETRIES=3`); AbortController on grade fetch; 20s heartbeat storage write (`ftHeartbeat`) keeps MV3 worker alive; standalone progress window via `chrome.windows.create` (action popups die on focus loss); `check_graded` action skips already-graded tickets; RepairQ inactivity lock defeated by keep-alive IIFE (synthetic activity every 25s, clicks `#clear_timer` every 1.5s) **only while `batchJob.status === "running"`**.

API contracts:
- Grade: POST `{action:"grade", ticket:{...}}` → `/api/dialpad/tickets`
- Check: POST `{action:"check_graded", ticket_numbers:[...]}` → `{success, graded:[...]}`
- `batchJob` (storage.local): `{links:[{url,ticket_number}], currentIndex, results:[{ticket,success,skipped?,score,error}], tabId, status:"running"|"complete", skippedCount, gradingTicket, gradingStartedAt}`

---

## Working with Eric
Direct, results-oriented, rapid iterate → deploy → screenshot loop. Wants honest tradeoffs flagged (all-time vs 30-day, hard delete vs soft, what can't be verified). Wants to be told exactly which files changed, where they go (repo vs extension folder), and what he'll see after deploy. Doesn't want disclaimers padded on; does want risks named once, clearly.

## Session end
Before ending a session, update `docs/CONTEXT.md` — specifically the **Open items** and **Recent changes** sections — so the next session starts current.

# Focused Technologies — Ticket Grader (Chrome extension)

Scrapes RepairQ tickets, sends them to `/api/dialpad/tickets` for AI grading, and
stores the result in `ticket_grades`. Those grades feed ticket compliance scores,
Daily Profit, and therefore **bonus dollars** — treat this folder as
payroll-sensitive and get Eric's sign-off before changing extraction or grading.

## Load / deploy

**Load this folder directly** — `chrome://extensions` → Developer mode →
*Load unpacked* → select `extension/`. Deploying a change is then: pull, then hit
the reload icon on the extension card.

Do **not** keep a second copy elsewhere (it used to live in `Downloads/`). Two
copies is how a file swap once made the whole extension go dead.

## File identity

Every file starts with an identifying comment. After any multi-file change,
confirm each first line matches its filename:

| File | First line |
|---|---|
| `background.js` | `// Background service worker — handles batch ticket grading` |
| `content.js` | `// Focused Technologies — RepairQ Ticket Grader Content Script` |
| `popup.js` | `// Popup UI — grade the current ticket or launch a batch from a report page` |
| `progress.js` | `// Standalone batch-progress window. Polls chrome.storage.local for the live` |

## Financial extraction — read before editing

`content.js` parses the Totals sidebar and Analytics panel out of
`document.body.innerText`. The server stores whatever it sends **verbatim**
(`tickets/route.js` does `parseFloat(ticket.gross_profit)` with no computation),
so a scraping bug here becomes a wrong number in the database with nothing to
catch it.

Three traps, all fixed 2026-08-31 — do not reintroduce them:

1. **`\b` before `Total` is load-bearing.** `/Total[:\s]*\$/i` also matches the
   "total" inside **Subtotal**, which silently made `total_collected` equal the
   subtotal on all 815 discounted tickets in the table.
2. **Money amounts can be negative, and RepairQ writes losses in ACCOUNTING PARENTHESES on the line AFTER the label** — `"Gross Profit:
($ 198.38)"`, verified on ticket 15304992. `([\d,.]+)` cannot capture a minus sign, so
   a negative gross profit failed to match, was never assigned, and landed in the
   database as `0`. Five tickets sat at `$0.00` because of this. RepairQ renders
   negatives as both `-$28.70` and `$-28.70`, and sometimes with an en dash.
3. **Strip commas globally.** `.replace(",", "")` drops only the first, so
   `$1,234,567.89` parsed as `1234`.

Use the `ftMoney()` helper for any new amount — it handles all three.

## The four buttons

| Button | What it does |
|---|---|
| **Grade This Ticket** | Grades the ticket you are on. Always re-grades — it never checks whether a grade already exists, so this is the single-ticket re-grade. |
| **Batch Grade Report Page** | Grades every ticket linked on the current report, **skipping any already in the database** (`check_graded`). Cheap to re-run after a RepairQ timeout. |
| **Re-grade Report Page** | Same, but skips the already-graded lookup and re-grades **everything** on the page. Two-step: click once to arm, again within 5s to start. |
| **Re-grade Ticket List…** | Re-grades only the ticket numbers you paste. They are matched against the links already on the open report page, so open a report whose date range covers them first. |

**Use Re-grade after any change to extraction or the grading prompt.** The normal
batch skips already-graded tickets, so without it, previously-graded tickets keep
their old figures forever. It costs one AI call per ticket, which is why it is
amber and needs two clicks.

## Which tickets get graded

`getTicketLinksFromReport()` reads ticket links from **whatever RepairQ report is
on screen**. There is no status filter in this code. If closed tickets are
missing from `ticket_grades`, that is a consequence of which report the batch was
run against, not a bug here — run it on a report whose date range and status
filter cover what you want. `check_graded` skips already-graded tickets, so
re-running over a wider report is cheap.

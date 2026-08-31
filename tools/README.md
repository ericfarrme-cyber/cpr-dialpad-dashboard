# tools/

Local maintenance scripts. Not part of the deployed app.

## import-profitability.py

Imports RepairQ's **Profitability by Ticket** export into `ticket_grades`.

```
python tools/import-profitability.py <export.xlsx>            # dry run, shows the diff
python tools/import-profitability.py <export.xlsx> --apply    # writes
```

**Why this exists.** The Chrome extension scrapes financials off the ticket page,
and that page shows the transaction as originally rung — list prices, before
returns, adjustments and no-charge discounts. RepairQ's report shows the money
that actually moved. On 2026-08-31 the two were reconciled for the first time and
`ticket_grades` was understating gross profit by **$106,719** across 4,125
tickets, with another **$86,109** on 1,060 tickets that had never been graded at
all. Scraped financials had been wrong in four distinct ways in a single day.

**The report is the financial source of truth.** The extension grades compliance;
this script supplies the dollars.

Only four columns are touched: `gross_sales`, `total_cost`, `discount_amount`,
`gross_profit`. Compliance scores, stores, employees and everything else are left
alone. A rollback snapshot of the previous values is written to
`rollback-ticket-financials.json` (gitignored) before any write.

The script verifies RepairQ's own arithmetic before trusting a single row:
`Net Sales = Gross Sales − Returns + Restock − Discounts` and
`GP = Net Sales − COGS`. If those do not tie it says so and you should stop.

### Getting the export
RepairQ → Reports → Ticket Profitability → set the date range, select all
locations, Status = Closed Tickets Only, leave Profitability unfiltered → Apply
Filters → **To Excel**.

⚠ **The export has no location column.** Per-store figures cannot be reconciled
from a single file — run the report once per location if you need that.

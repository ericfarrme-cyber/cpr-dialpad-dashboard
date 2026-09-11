# Quote → Appointment: booking from the Price Book

**Status:** Phase 1 shipped 2026-09-11 (`457f94a`), migration run. Decisions taken by Eric: floor = **20% under the 6-month average sold** (not part + labour — see CONTEXT § 10q for why that was argued and measured); a quote under the sheet always needs a reason (dropdown + text); anyone may book for any store. Phase 2 (quote metrics, before/after on ledger events, auto ticket link) not started.
**Ask:** "if a customer calls in and they look up the price, shouldn't it be seamless for them to create an appointment from the price book?"

---

## 1. What happens today (measured, not assumed)

Last 400 appointments, read straight from `appointments`:

| fact | number |
|---|---|
| `reason` is free text — "IP17 $230", "15pm bg", "iphone SE 3 LCD", "115 screen -AW" | 396 / 400 filled, 0 structured |
| `price_quoted` is free text — "189.99 - 30", "$100", "10% off applicable repairs", "79.99 each" | 373 / 400 |
| `scheduled_by` is typed by hand | **18 spellings for ~8 people**, 36 blank (Bloomington signs "-aw" inside `reason` instead) |
| `call_id` populated | **0 / 400** |
| `ticket_number` populated | **0 / 400** |
| `POST /api/dialpad/appointments` authenticated | **no** — add / update / delete / clear_store are open to anyone with the URL |

So the agent today does the work twice: finds the price on `/prices`, then re-types the device, repair and price as prose on `/appointments`. Nothing links the quote to the price row it came from, the call it came from, or the ticket it became. Price & Demand infers conversion by matching phone numbers within 30 days because the direct links are empty (open item 10i).

The most valuable thing in that free text is invisible to every report: **what the agent actually quoted versus the sheet.** Luke quoted an iPhone 16 screen at "189.99 − 30" when the sheet said $259.99. That quote-time discount is the *pre-sale* half of price elasticity; today we only have the post-sale half (ticket discounts).

## 2. The design in one sentence

The appointment becomes a consequence of the quote: the agent taps **Book** on the price they just read out, and the device, repair, tier, price, store and their own name are already filled — they add the customer's name, phone and a time.

## 3. What the agent sees

**Book on every price cell** (and on each rung of a console turnaround ladder). Tapping it does not navigate away — a panel slides in from the right, the price cell stays highlighted underneath, and the search box keeps its text so the agent can still glance at the other tiers mid-call.

Panel, top to bottom:

1. **The quote, pre-filled and read-only unless tapped:** `iPhone 15 Pro Max · Screen · OLED · $239.99 · 1–2 hrs` with the floor shown to admins only. Store defaults to the signed-in user's store; a chip row switches it (Matt and Duncan float).
2. **Customer:** name, phone. Phone auto-formats; on blur it calls the existing `match_call` lookup and, if this number called a store recently, shows *"Called Fishers 4 min ago · Alyssa · asked about iPhone 15 screen"* and captures the `call_id`. Repeat-customer check runs the same way the appointments page already does.
3. **When:** date chips *Today · Tomorrow · pick*, time in 30-minute steps, and the store's next three appointments listed underneath so a slot is not double-booked (a list, not a calendar).
4. **Price quoted:** defaults to the sheet price. If the agent lowers it the panel says *"−$30 below sheet"* and, once past `max_discount` or the floor, requires a one-line reason before it will book. It never blocks — a quote below floor is information we want recorded, not hidden in prose.
5. **Notes** (optional).
6. **Book** → one POST → toast *"Booked · Tue 2:30 · Fishers"* with an 8-second Undo. The price cell gets a small *booked today ×1* tick so the agent sees it landed.

`scheduled_by` is the signed-in user's roster name. Nobody types their own name again.

## 4. What gets stored

Additive columns on `appointments` — nothing existing changes shape, so the appointments page, follow-ups and imports keep working untouched:

```sql
alter table public.appointments
  add column if not exists source            text,          -- 'price_book' | 'manual' | 'import'
  add column if not exists repair_price_id   bigint,        -- the row quoted (null for manual)
  add column if not exists device            text,
  add column if not exists repair            text,
  add column if not exists tier              text,
  add column if not exists canonical_model   text,
  add column if not exists canonical_repair  text,
  add column if not exists sheet_price       numeric(10,2), -- the sheet at the moment of the quote
  add column if not exists quoted_price      numeric(10,2),
  add column if not exists quote_reason      text,          -- required when below max_discount / floor
  add column if not exists booked_by_email   text;
create index if not exists appointments_canon_idx on public.appointments (canonical_model, canonical_repair, date_of_appt desc);
```

`reason` and `price_quoted` are still written (`"iPhone 15 Pro Max · Screen · OLED"`, `"239.99"`) so every existing view reads the same. `call_id` finally gets populated from the phone match. `sheet_price` is captured at booking time on purpose: when the price later changes, the quote still says what the sheet said that day.

## 5. What it unlocks (the reason to do it)

1. **Elasticity gets its missing half.** Per model + repair, Price & Demand can show: quotes given, share quoted at sheet vs below, average quote discount, and — the number that settles the "aim high" argument — **show rate by quote discount.** If discounted quotes do not show up more often than full-price quotes, the discount bought nothing.
2. **Price changes get a before/after on quotes, not just tickets.** The `repair_price_changes` ledger already has its first event (19 OLED prices, 2026-09-11). Quotes booked before vs after that date, and their show rates, is the test Eric described.
3. **Conversion becomes exact.** `call_id` on the appointment from the phone match; `ticket_number` linked when a ticket with the same phone closes within 14 days (extend the existing `verify_followups` scan, which already walks appointments by phone). Closes open item 10i.
4. **The Price Book learns from itself.** Each cell's acceptance line gains the pre-sale view in the same aim-high framing: *"3 of 4 booked at full price this month."*
5. **`scheduled_by` becomes clean**, which fixes the per-agent appointment counts on My Performance and the scorecard's "appointments set" without another alias table.

## 6. Prerequisite that ships with it

**Authenticate the appointments route.** Any signed-in role may add; update requires the booking user or a manager; delete / `clear_store` require admin. This is not optional once a second page writes appointments, and it is the only way `scheduled_by` can come from the session. Read actions stay as they are.

## 7. Phases

| phase | scope | size |
|---|---|---|
| **1** | Book panel on `/prices`, schema above, route auth, `scheduled_by` from session, `call_id` capture, toast + undo | one build day, ships alone |
| **2** | Quote metrics in Price & Demand (share at sheet, avg quote discount, show rate by discount, before/after each ledger event), acceptance line on price cells, auto `ticket_number` link | one build day |
| **3** (optional) | Run `resolveModel` + `classifyInquiry` over the 967 historical `reason` strings to fill `canonical_model` / `canonical_repair` for the past; SMS confirmation via Dialpad | measure first — report the resolve rate before writing anything |

## 8. Deliberately out of scope

- A calendar view or slot capacity model. The "next three at this store" list is enough to stop a double-booking; capacity is a bigger question than this build.
- Changing how the appointments page's own form works. It stays as the manual path (`source = 'manual'`).
- Quoting anything not on the sheet. If the device or repair is not in the Price Book the agent uses the appointments page as today — which also makes "how often do we book something the sheet doesn't have" a countable number.

## 9. Two decisions for Eric

1. **Below-floor quotes:** record with a required reason (recommended — it is the data you want), or hard-block?
2. **Who may book for another store:** everyone, or managers only? Recommended: everyone, defaulting to their own store, because calls get answered across stores.

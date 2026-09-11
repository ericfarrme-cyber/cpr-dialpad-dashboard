-- Quote -> appointment: structured fields on public.appointments so a booking
-- made from the Price Book carries the row it was quoted from, the sheet
-- price at that moment, what was actually quoted, and why it was discounted.
--
-- Additive only. reason / price_quoted keep being written as text, so the
-- appointments page, follow-ups and imports read exactly as before.
-- Run once in the Supabase SQL editor (Run, not Run selected).

alter table public.appointments
  add column if not exists source            text,           -- 'price_book' | 'manual' | 'import'
  add column if not exists repair_price_id   bigint,         -- repair_prices.id the quote came from
  add column if not exists device            text,
  add column if not exists repair            text,
  add column if not exists tier              text,
  add column if not exists canonical_model   text,
  add column if not exists canonical_repair  text,
  add column if not exists sheet_price       numeric(10,2),  -- the sheet at the moment of the quote
  add column if not exists book_floor        numeric(10,2),  -- 20% under the 6-month average, at the moment of the quote
  add column if not exists quoted_price      numeric(10,2),
  add column if not exists quote_reason      text,           -- required whenever quoted_price < sheet_price
  add column if not exists booked_by_email   text,
  add column if not exists turnaround        text;           -- "1–2 hrs", "same day", "3–5 days" — what the customer was told

-- Added 2026-09-11 (evening), after the first run of this file. Safe to re-run whole.
alter table public.appointments add column if not exists turnaround text;

create index if not exists appointments_canon_idx
  on public.appointments (canonical_model, canonical_repair, date_of_appt desc);
create index if not exists appointments_source_idx
  on public.appointments (source, date_set desc);

-- Everything that exists today was typed by hand or imported.
update public.appointments set source = 'manual' where source is null;

-- Store closures and early closes.
--
-- Dialpad tags each call with `availability` from the department's configured
-- hours, and a missed call tagged "closed" is already excluded from the answer
-- rate. That only works when Dialpad knew about the change: on Labor Day 2026
-- the schedule still said a normal Monday, so 10 missed calls that arrived
-- after the 4pm close counted against the stores — 6 of them at Fishers, which
-- is the difference between 79.2% and 80.9% for September, i.e. a bonus tier.
--
-- This table records what the stores actually did, so the answer rate can
-- honour an early close Dialpad never saw. Going forward the schedule should
-- still be changed in Dialpad too; this is the backstop and the record.
--
-- Run once in the Supabase SQL editor (Run, not Run selected).

create table if not exists public.store_closures (
  id            uuid primary key default gen_random_uuid(),
  store         text not null,              -- fishers | bloomington | indianapolis
  closure_date  date not null,
  closes_at     time,                       -- null = closed all day
  opens_at      time,                       -- null = opened at the normal time
  reason        text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (store, closure_date)
);

create index if not exists store_closures_date_idx on public.store_closures (closure_date desc, store);

-- Service role only, same as repair_prices: every read goes through a route
-- that has already checked who is asking.
alter table public.store_closures enable row level security;

-- Labor Day 2026: all three stores closed at 4pm (Eric, 2026-09-15).
insert into public.store_closures (store, closure_date, closes_at, reason, created_by)
values
  ('fishers',      '2026-09-07', '16:00', 'Labor Day — closed at 4pm', 'Eric Farr'),
  ('bloomington',  '2026-09-07', '16:00', 'Labor Day — closed at 4pm', 'Eric Farr'),
  ('indianapolis', '2026-09-07', '16:00', 'Labor Day — closed at 4pm', 'Eric Farr')
on conflict (store, closure_date) do nothing;

-- Review credit decisions: a named-review credit pays only once a manager
-- confirms it (Eric, 2026-11-20: "Yes, require confirmation before pay").
--
-- Until this existed the Reviews tab's Confirm / Not them buttons only changed
-- what the page showed -- nothing was saved, and the Bonus Ledger and the
-- Paycheck paid every credit the dashboard proposed from the review text.
--
-- One row per (review, person). `status`:
--   confirmed     -- the review names this person; the credit pays
--   rejected      -- "not them"; pays nothing, and drops out of any split
--   acknowledged  -- a review that names nobody, or a 1-star, has been looked
--                    at. employee_name is '' for these.
-- Changing your mind is an upsert on the same row; the latest decision wins
-- and decided_by / decided_at say who and when.

create table if not exists public.review_credit_decisions (
  id               bigserial primary key,
  review_item_id   bigint not null references public.google_review_items(id) on delete cascade,
  employee_name    text   not null default '',
  status           text   not null check (status in ('confirmed', 'rejected', 'acknowledged')),
  decided_by       text,
  decided_at       timestamptz not null default now(),
  note             text
);

create unique index if not exists review_credit_decisions_one
  on public.review_credit_decisions (review_item_id, employee_name);

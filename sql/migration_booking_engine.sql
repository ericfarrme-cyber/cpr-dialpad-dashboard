-- Booking engine, 2026-09-26.
--
-- Two new fields on an appointment and one small log table.
--
-- part_status / deposit_amount: 7 of the last 300 appointments mentioned an
-- ordered part in prose and none of them recorded a deposit, so a part order
-- was invisible to every report. Eric, 2026-09-26: "we should record a deposit
-- every single time a part is ordered … I think we can just place a check mark
-- for now." Three states, a number, nothing else.
--
-- search_misses: what agents typed into the Price Book that returned nothing.
-- The sheet's gaps are currently found by reconciling against the register
-- after the fact; this finds them at the moment someone needed the price.

alter table public.appointments add column if not exists part_status text;
alter table public.appointments add column if not exists deposit_amount numeric;

comment on column public.appointments.part_status is
  'needed | ordered | in_stock — set at booking. ordered requires deposit_amount.';
comment on column public.appointments.deposit_amount is
  'Dollars taken when the part was ordered. Null unless part_status = ordered.';

create table if not exists public.search_misses (
  id bigserial primary key,
  q text not null,
  store text,
  searched_by text,
  searched_by_email text,
  created_at timestamptz not null default now()
);

create index if not exists search_misses_created_idx on public.search_misses (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- REPAIR PRICE BOOK  (2026-09-11)
--
-- Replaces the "Repair Price Cheat Sheet" workbook agents use to quote on
-- inbound calls. 632 rows across 177 devices, seeded from that workbook.
--
-- Two tables, because the second one is the point:
--
--   repair_prices          what we quote today
--   repair_price_changes   every change, batched, with an effective date
--
-- The ledger is what lets Price & Demand answer Eric's question from the
-- 2026-09-10 meeting — "changing the price and then seeing over a week how that
-- changed things." A recorded change with a known date turns the monthly trend
-- from correlation into a real before/after.
--
-- Only Eric and Matt may edit (enforced in the route, not here).
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.repair_prices (
  id                bigserial primary key,

  -- what it is
  family            text not null,              -- phone | tablet | console | computer | service
  model_group       text,                       -- "iPhone", "Galaxy S Series", "PlayStation"
  device            text not null,              -- "iPhone 15 Pro Max"
  repair            text not null,              -- "Screen", "HDMI port", "Battery"
  tier              text,                       -- "LCD" | "OLED" | "OEM" | "Same day" | "3-5 business days"

  -- the join keys back into the rest of the dashboard. Populated with
  -- lib/device-model.js and lib/repair-type.js so a price row lines up with the
  -- demand and conversion figures on the Price & Demand tab.
  canonical_model   text,
  canonical_repair  text,

  -- money
  set_price         numeric(10,2),              -- what the agent quotes
  part_price        numeric(10,2),              -- our cost, drives the floor
  floor_price       numeric(10,2),              -- lowest they may go
  floor_rule        text,                       -- "part+80" | "part+50"
  max_discount      numeric(10,2),              -- console tiers cap the discount

  -- what the customer asks next
  turnaround        text,                       -- "1-2 hrs", "3-5 business days"
  flags             text[] not null default '{}',  -- solder_or_order, non_consigned_part, supplier_choice
  note              text,                       -- competitor quotes, combo rules, caveats

  sort_order        int not null default 0,
  active            boolean not null default true,

  updated_at        timestamptz not null default now(),
  updated_by        text
);

-- One price per device + repair + tier. coalesce() because tier is often null
-- and NULLs do not collide in a unique index on their own.
create unique index if not exists repair_prices_unique
  on public.repair_prices (device, repair, coalesce(tier, ''));

create index if not exists repair_prices_lookup
  on public.repair_prices (family, model_group, device);

-- The lookup page searches on these constantly.
create index if not exists repair_prices_canonical
  on public.repair_prices (canonical_model, canonical_repair);


-- ── the ledger ───────────────────────────────────────────────────────────────
-- One row per field changed. A bulk edit ("drop every OLED by $20") shares a
-- batch_id, so it reads back as a single deliberate event rather than 40
-- unrelated edits.
create table if not exists public.repair_price_changes (
  id                bigserial primary key,
  batch_id          uuid not null,

  repair_price_id   bigint references public.repair_prices(id) on delete set null,
  -- denormalised so history survives a row being deleted or re-seeded
  device            text not null,
  repair            text not null,
  tier              text,
  canonical_model   text,
  canonical_repair  text,

  field             text not null,              -- set_price | floor_price | part_price
  old_value         numeric(10,2),
  new_value         numeric(10,2),

  changed_by        text not null,
  changed_at        timestamptz not null default now(),
  -- when the new price actually took effect on the floor; defaults to today but
  -- can be backdated if a change was made in RepairQ before it was recorded here
  effective_date    date not null default current_date,
  reason            text
);

create index if not exists repair_price_changes_batch
  on public.repair_price_changes (batch_id);

-- Price & Demand reads this to mark the trend and split before/after.
create index if not exists repair_price_changes_elasticity
  on public.repair_price_changes (canonical_model, canonical_repair, effective_date desc);

create index if not exists repair_price_changes_recent
  on public.repair_price_changes (changed_at desc);


-- ── access ───────────────────────────────────────────────────────────────────
-- RLS on with no policies: the service role bypasses it, anon and authenticated
-- get nothing. Same posture as tier_celebrations. All reads and writes go
-- through the API routes, which enforce who may edit.
alter table public.repair_prices enable row level security;
alter table public.repair_price_changes enable row level security;

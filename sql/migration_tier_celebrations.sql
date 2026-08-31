-- ============================================================================
-- migration_tier_celebrations.sql
--
-- Creates the `tier_celebrations` table, which app/api/dialpad/tier-history
-- writes to in 4 places and reads in 4 more, and which has never existed in
-- this database (PGRST205 "Could not find the table 'public.tier_celebrations'
-- in the schema cache"). Every celebration write has silently no-opped.
--
-- Also adds `employee_tier_history.is_locked`, referenced by the `lock_period`
-- action, which likewise does not exist today.
--
-- Safe to re-run: everything is IF NOT EXISTS.
-- Read-only against existing data — no backfill, no updates to existing rows.
-- ============================================================================

-- ── 1. tier_celebrations ────────────────────────────────────────────────────
create table if not exists public.tier_celebrations (
  id             bigint generated always as identity primary key,

  employee_name  text        not null,
  store          text        not null,

  -- 'tier_up' | 'gold_streak' | 'platinum_streak' | 'diamond_plaque'
  event_type     text        not null,

  -- 'YYYY-MM' for monthly events; 'YYYY' for diamond_plaque (year-level).
  event_period   text        not null,

  prior_tier     text,
  new_tier       text,
  streak_length  integer,

  -- bonus_unit: 'cash' | 'pto_day' | 'plaque'
  bonus_amount   numeric     not null default 0,
  bonus_unit     text,

  created_at     timestamptz not null default now(),

  -- Admin workflow timestamps (AdminTab celebration queue).
  announced_at   timestamptz,
  bonus_paid_at  timestamptz,
  dismissed_at   timestamptz,
  notes          text
);

-- Matches the ON CONFLICT target used by all four upserts in tier-history.
-- Without this, every celebration upsert fails with 42P10.
create unique index if not exists tier_celebrations_employee_store_period_type_key
  on public.tier_celebrations (employee_name, store, event_period, event_type);

-- The celebration queue filters on dismissed_at and orders by created_at desc.
create index if not exists tier_celebrations_pending_idx
  on public.tier_celebrations (created_at desc)
  where dismissed_at is null;

-- RLS on with no policies: this table is reached only through the API routes,
-- which use SUPABASE_SERVICE_ROLE_KEY, and the service role bypasses RLS. This
-- cannot break the app, and it keeps bonus-dollar rows unreadable by the anon
-- key. If this project's convention is open tables, drop this line — but the
-- default here is deliberately the closed one.
alter table public.tier_celebrations enable row level security;

-- ── 2. employee_tier_history.is_locked ──────────────────────────────────────
-- Referenced by the `lock_period` POST action, which prevents a closed month
-- from being re-snapshotted. The column was never created, so that action has
-- always failed.
alter table public.employee_tier_history
  add column if not exists is_locked boolean not null default false;

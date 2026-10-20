-- Manual five-star entry for the review bonus.
--
-- WHY THIS TABLE EXISTS AT ALL: Eric's rule (2026-10-20) is that only 5-star
-- reviews count. The Places API we sync from returns a review TOTAL and an
-- AVERAGE rounded to one decimal -- never a breakdown by star -- and the
-- average cannot be used to recover one, because the star-sum uncertainty is
-- 0.05 x review_count: +/-32 stars on Fishers main, +/-44 on Indianapolis.
-- That cannot resolve a single review, let alone separate a 4-star from a
-- 5-star. The Business Profile Reviews API would give exact ratings but needs
-- owner OAuth rather than the Places key, so until that exists the only exact
-- source is a person reading the Business Profile inbox.
--
-- So this is deliberately a HUMAN-ENTERED table, kept separate from
-- google_review_snapshots rather than overloading its columns. Snapshots stay
-- a pure record of what Google reported; this is a record of what a person
-- counted. Mixing them would have corrupted the gain subtraction, which takes
-- the newest snapshot per listing regardless of source.
--
-- GRAIN IS (period, store), not per listing, because the store tier is a
-- per-store count. The $20 department premium is decided per review in the
-- credit queue from that page's own total, so it needs nothing from here --
-- which keeps Matt's monthly entry at six numbers rather than twenty-four.
--
-- one_two_star_count is here because the penalty needs it: the first 1- or
-- 2-star halves the store's tier that month, a second zeroes it. 3-star and
-- 4-star reviews are recorded nowhere because they count for nothing.

create table if not exists public.review_five_star (
  id                  bigserial primary key,
  period              text        not null,          -- 'YYYY-MM'
  store               text        not null,          -- fishers | bloomington | indianapolis
  five_star_count     integer     not null default 0 check (five_star_count >= 0),
  one_two_star_count  integer     not null default 0 check (one_two_star_count >= 0),
  total_reviews_seen  integer     check (total_reviews_seen is null or total_reviews_seen >= 0),
  entered_by          text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- One row per store per month, so every write is an idempotent upsert and a
-- re-entry corrects rather than duplicates. The route relies on this name in
-- its on_conflict target.
create unique index if not exists review_five_star_period_store_idx
  on public.review_five_star (period, store);

create index if not exists review_five_star_period_idx
  on public.review_five_star (period);

comment on table public.review_five_star is
  'Human-entered five-star counts per store per month, read from the Google Business Profile inbox. The Places API cannot break reviews down by star; see the header of this migration.';
comment on column public.review_five_star.five_star_count is
  'Five-star reviews received by this store in this period, across all four of its pages. The only count the review bonus tier reads.';
comment on column public.review_five_star.one_two_star_count is
  'One- and two-star reviews received. Drives the penalty: the first halves the tier payment, a second zeroes it.';

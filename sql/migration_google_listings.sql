-- Google review tracking, 2026-09-30.
--
-- `google_reviews` is keyed (period, store) with no listing dimension and no
-- star ratings, so it cannot answer the two questions that matter: how are the
-- console and computer listings doing, and did we take a one-star this month.
-- It also counts reviews RECEIVED in a month, which is a different thing from
-- the lifetime total Google shows — do not conflate them.
--
-- Captured by hand from the public listings on 2026-09-30, for reference:
--   Fishers        4.8 · 643      Bloomington 4.8 · 552
--   Indianapolis   4.7 · 885      Carmel (competitor) 4.8 · 575
--   Fishers · Video Game Console Repair at CPR   5.0 · 2
-- Carmel was 565 on 2026-09-10 and Fishers 639, so Carmel is gaining about
-- 2.5x faster. That is the reason this exists.

-- ── one row per Google listing we care about ────────────────────────────────
-- Every store has a main listing plus three departments that Google treats as
-- separate places: "Computer Repair at CPR", "Electronics at CPR" and
-- "Video Game Console Repair at CPR". Competitors live here too, with
-- is_ours = false, so the gap is tracked on the same footing.
create table if not exists public.google_listings (
  id            bigserial primary key,
  store         text,                       -- our store key, or null for a competitor
  listing_type  text not null,              -- main | computers | electronics | consoles
  label         text not null,              -- what to show a person
  place_id      text unique,                -- Google Places place_id; null until looked up
  maps_url      text,
  is_ours       boolean not null default true,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── a daily reading of each listing ─────────────────────────────────────────
-- Lifetime total and current average, captured once a day. Reviews gained in a
-- month is a subtraction between two snapshots, never a stored number, so it
-- cannot drift out of step with Google.
create table if not exists public.google_review_snapshots (
  id            bigserial primary key,
  listing_id    bigint not null references public.google_listings(id) on delete cascade,
  captured_on   date not null default (now() at time zone 'America/Indiana/Indianapolis')::date,
  rating        numeric,                    -- e.g. 4.8
  total_reviews integer,                    -- lifetime count Google reports
  source        text not null default 'places_api',  -- places_api | manual | browser
  unique (listing_id, captured_on)
);

-- ── individual reviews, so a one-star is visible as itself ──────────────────
-- The bonus Eric described needs five-star counts and a penalty for one-stars,
-- neither of which a total can answer. Nothing here computes a payout; this is
-- the record a payout could later be built on.
create table if not exists public.google_review_items (
  id            bigserial primary key,
  listing_id    bigint not null references public.google_listings(id) on delete cascade,
  review_key    text not null,              -- stable id from the source
  rating        integer not null,
  author        text,
  text          text,
  has_photo     boolean not null default false,
  posted_at     timestamptz,
  first_seen_at timestamptz not null default now(),
  unique (listing_id, review_key)
);

create index if not exists gr_snapshots_listing_idx on public.google_review_snapshots (listing_id, captured_on desc);
create index if not exists gr_items_listing_idx on public.google_review_items (listing_id, posted_at desc);

-- ── seed the listings we know ───────────────────────────────────────────────
-- place_id is left null deliberately: it is filled by the sync route's lookup
-- once a Places key exists, rather than guessed here.
insert into public.google_listings (store, listing_type, label, is_ours) values
  ('fishers',      'main',        'CPR Fishers',                    true),
  ('fishers',      'computers',   'Computer Repair at CPR · Fishers', true),
  ('fishers',      'electronics', 'Electronics at CPR · Fishers',   true),
  ('fishers',      'consoles',    'Video Game Console Repair at CPR · Fishers', true),
  ('bloomington',  'main',        'CPR Bloomington',                true),
  ('bloomington',  'computers',   'Computer Repair at CPR · Bloomington', true),
  ('bloomington',  'electronics', 'Electronics at CPR · Bloomington', true),
  ('bloomington',  'consoles',    'Video Game Console Repair at CPR · Bloomington', true),
  ('indianapolis', 'main',        'CPR Indianapolis',               true),
  ('indianapolis', 'computers',   'Computer Repair at CPR · Indianapolis', true),
  ('indianapolis', 'electronics', 'Electronics at CPR · Indianapolis', true),
  ('indianapolis', 'consoles',    'Video Game Console Repair at CPR · Indianapolis', true),
  (null,           'main',        'CPR Carmel (competitor)',        false)
on conflict do nothing;

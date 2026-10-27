-- One row per (store, listing_type). Run this once.
--
-- WHY: on 2026-10-20 the listings seed was re-run with `on conflict do nothing`.
-- There was no unique constraint for it to conflict ON, so it inserted a second
-- copy of all 13 listings instead of doing nothing. `on conflict do nothing`
-- only protects you when a constraint exists -- without one it is a no-op that
-- reads like a safeguard.
--
-- It was not harmless. The nightly sync looked up place_ids for the new empty
-- rows and found DIFFERENT Google pages for Indianapolis electronics and
-- consoles (ChIJid7JA7NRa4gRlGioi4f9-JE and ChIJy8gb1GhNa4gRnrECYFw4LKc), then
-- wrote eight days of snapshots against them. Those snapshots all came back
-- null/null -- the matches were wrong -- so Indy's real history sat on one row
-- while the sync wrote nothing useful to another. The 13 duplicate rows and
-- their 16 null snapshots were removed on 2026-10-27; nothing with a real
-- review count was touched.
--
-- Carmel is stored with store = null, and in Postgres a unique index treats
-- nulls as distinct, so a plain index on (store, listing_type) would NOT stop a
-- second Carmel row. coalesce gives it a real key.

create unique index if not exists google_listings_store_type_idx
  on public.google_listings (coalesce(store, '~competitor~'), listing_type);

comment on index public.google_listings_store_type_idx is
  'One listing per store per type. Added after a re-run of the seed silently doubled every row because on-conflict had no constraint to catch.';

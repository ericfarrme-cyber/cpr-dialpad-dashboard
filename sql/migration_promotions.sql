-- Flash sales and store messages.
--
-- Two tables, one migration, because they are the same job: what a store is
-- running this week and what its people are told about it. Both feed the
-- fourth TV screen; both are managed from the Promotions tab.
--
-- WHY A SEPARATE TABLE RATHER THAN COLUMNS ON repair_prices:
-- `repair_prices` has NO store dimension -- one sheet serves all three stores,
-- which is the whole point of it. A sale is per store and per date window, so
-- putting it on the row would either make the sheet store-specific (breaking
-- every other reader) or force a single company-wide price (which is not what
-- was asked for). A sale is also a temporary fact about a row, not the row.
--
-- A company-wide sale is three rows, one per store. That is deliberate: it
-- keeps every read a simple store filter, and it means ending a sale early at
-- one store does not need a special case.

create table if not exists public.repair_price_sales (
  id               bigserial primary key,
  repair_price_id  bigint not null references public.repair_prices(id) on delete cascade,
  store            text   not null,
  sale_price       numeric(10,2) not null check (sale_price >= 0),
  starts_on        date   not null,
  ends_on          date   not null,
  label            text,
  note             text,
  created_by       text,
  created_at       timestamptz not null default now(),
  ended_by         text,
  ended_at         timestamptz,
  active           boolean not null default true,
  constraint repair_price_sales_window check (ends_on >= starts_on)
);

create index if not exists repair_price_sales_store_window
  on public.repair_price_sales (store, starts_on, ends_on) where active;
create index if not exists repair_price_sales_row
  on public.repair_price_sales (repair_price_id) where active;

-- One live sale per row per store at a time. Overlapping windows on the same
-- row would make "the price today" ambiguous, and an agent reading two
-- different numbers off one line is the failure this prevents.
--
-- Postgres cannot express "no overlapping ranges" in a plain unique index, so
-- this stops the common case (two sales starting the same day) and the route
-- checks the general case before inserting. Both, not either: the seed that
-- doubled google_listings was a line that read like a safeguard and was a
-- no-op because nothing could conflict on it.
create unique index if not exists repair_price_sales_one_per_start
  on public.repair_price_sales (repair_price_id, store, starts_on) where active;

create table if not exists public.store_messages (
  id          bigserial primary key,
  -- NULL means every store. Not a magic string: a store filter has to be able
  -- to say "mine or everyone's" in one clause.
  store       text,
  kind        text not null default 'heads_up',
  body        text not null,
  pinned      boolean not null default false,
  starts_on   date,
  ends_on     date,
  created_by  text,
  created_at  timestamptz not null default now(),
  active      boolean not null default true
);

create index if not exists store_messages_board
  on public.store_messages (store, pinned, created_at desc) where active;

-- ⚠ ANYTHING IN store_messages IS EFFECTIVELY PUBLIC. The TV board hangs
-- unsigned-in in a public part of the shop and reads it through an
-- unauthenticated endpoint, the same as the rankings and reviews screens. The
-- compose form says so. Nothing private, nothing about one person's pay or
-- performance, nothing a customer should not read over a technician's
-- shoulder.

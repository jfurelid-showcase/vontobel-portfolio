-- ============================================================================
-- Vontobel Portfolio Builder — initial schema
-- Run this in Supabase SQL editor (or `supabase db push`) on ONE Supabase
-- project. You said "two databases" — in Supabase that means two *schemas*
-- or just two sets of tables in one project (one project = one Postgres
-- database already). Splitting into two literal Supabase *projects* is
-- possible but adds a second set of keys/URLs for no real benefit here,
-- since the tables have very different write patterns but the same reader
-- (your Next.js site). This migration puts everything in one project,
-- in two logical groups. Say the word if you really want two projects and
-- I'll split it.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) FULL OFFER — every Vontobel ETP instrument on NGM, refreshed once/day
-- ----------------------------------------------------------------------------
create table if not exists certificates_full (
  isin              text primary key,
  insref            bigint,
  name              text not null,
  issuer            text not null default 'Vontobel',
  underlying        text,
  buy_price         numeric,          -- Köpkurs
  sell_price        numeric,          -- Säljkurs
  last_price        numeric,          -- Senast
  direction         text,             -- Riktning: Long / Short
  leverage          numeric,          -- Hävstång
  daily_change_pct  numeric,          -- Dagsutveckling %
  turnover          numeric,          -- Omsättning
  ngm_updated_at    timestamptz,      -- "Uppdaterad" as reported by NGM
  ngm_page          int,              -- which /market/etp?page=N it was found on
  scraped_at        timestamptz not null default now()
);

create index if not exists idx_certificates_full_name on certificates_full using gin (to_tsvector('simple', name));
create index if not exists idx_certificates_full_underlying on certificates_full (underlying);

-- Simple audit trail of each daily scrape run (row counts, errors) — handy
-- for confirming the 17:30 CET job actually ran and how many rows it found.
create table if not exists scrape_runs (
  id           bigserial primary key,
  job          text not null,          -- 'full_list' | 'quote_worker'
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  rows_written int,
  ok           boolean,
  error        text
);

-- ----------------------------------------------------------------------------
-- 2) PORTFOLIO — positions the admin tool adds from the full list
-- ----------------------------------------------------------------------------
create table if not exists portfolio_positions (
  id                 uuid primary key default gen_random_uuid(),
  isin               text not null references certificates_full(isin) on update cascade,
  name               text not null,
  issuer             text default 'Vontobel',
  underlying         text,
  direction          text not null,          -- 'Long' / 'Short' (as listed on NGM)
  leverage           numeric,
  entry_price        numeric not null,       -- price when position was taken
  entry_time         timestamptz not null default now(),
  stake_sek          numeric not null default 10000,  -- notional SEK allocated, for NAV weighting
  stop_loss          numeric,
  target_price       numeric,
  status             text not null default 'open' check (status in ('open','closed')),
  exit_price         numeric,
  exit_time          timestamptz,
  current_price      numeric,                -- latest quote, updated by the worker
  current_updated_at timestamptz,
  note               text,                   -- trade rationale
  podcast_episode    text,                   -- e.g. "Redaktionens Swingtrading #42"
  created_at         timestamptz not null default now()
);

create index if not exists idx_portfolio_positions_status on portfolio_positions (status);
create index if not exists idx_portfolio_positions_isin on portfolio_positions (isin);

-- Tick-level price history for open positions — this is what lets the
-- dashboard redraw the little sparkline and lets us compute NAV at any past
-- timestamp for daily/monthly/YTD performance.
create table if not exists price_ticks (
  id           bigserial primary key,
  position_id  uuid not null references portfolio_positions(id) on delete cascade,
  price        numeric not null,
  ts           timestamptz not null default now()
);

create index if not exists idx_price_ticks_position_ts on price_ticks (position_id, ts desc);

-- NAV snapshot every time the worker refreshes quotes — an indexed value
-- (starts at 100) so daily/monthly/YTD % are simple lookups against history.
create table if not exists nav_history (
  id    bigserial primary key,
  ts    timestamptz not null default now(),
  nav   numeric not null
);

create index if not exists idx_nav_history_ts on nav_history (ts desc);

-- Single-row settings table (starting NAV index value, base currency, etc.)
create table if not exists portfolio_settings (
  id         int primary key default 1,
  nav_base   numeric not null default 100,
  cash_sek   numeric not null default 0,
  constraint single_row check (id = 1)
);
insert into portfolio_settings (id) values (1) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Row Level Security — the site talks to Supabase with the ANON key from the
-- browser for reads, and the SERVICE ROLE key (server-only: admin actions +
-- the scraper/worker) for writes. Anon can read everything, anon cannot write.
-- ----------------------------------------------------------------------------
alter table certificates_full enable row level security;
alter table portfolio_positions enable row level security;
alter table price_ticks enable row level security;
alter table nav_history enable row level security;
alter table portfolio_settings enable row level security;
alter table scrape_runs enable row level security;

create policy "public read certificates_full" on certificates_full for select using (true);
create policy "public read portfolio_positions" on portfolio_positions for select using (true);
create policy "public read price_ticks" on price_ticks for select using (true);
create policy "public read nav_history" on nav_history for select using (true);
create policy "public read portfolio_settings" on portfolio_settings for select using (true);
create policy "public read scrape_runs" on scrape_runs for select using (true);

-- No insert/update/delete policies are created for the anon role, so those
-- operations are only possible with the service_role key (server-side),
-- which bypasses RLS entirely. That's what the admin API routes and the
-- scraper/worker scripts use.

-- Enable Realtime so the dashboard gets live pushes instead of polling.
alter publication supabase_realtime add table portfolio_positions;
alter publication supabase_realtime add table price_ticks;
alter publication supabase_realtime add table nav_history;

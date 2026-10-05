-- ============================================================================
-- Multi-portfolio support: the owner's portfolio (id 1) plus any number of
-- guest portfolios, each with its own positions, NAV history, archives,
-- trader profile and private edit link.
--
-- Safe to run more than once, and BACKWARD COMPATIBLE: the app and the quote
-- worker that are running right now keep working unchanged after this runs
-- (every portfolio_id column defaults to 1, and the functions keep their old
-- call shapes). Run this FIRST, then deploy the new app and worker.
-- ============================================================================

-- ---- 1. portfolio_settings becomes the portfolios table --------------------
-- It used to be locked to a single row (id = 1). Each row now IS a portfolio.
alter table portfolio_settings drop constraint if exists single_row;

create sequence if not exists portfolio_settings_id_seq owned by portfolio_settings.id;
select setval('portfolio_settings_id_seq', greatest((select coalesce(max(id), 1) from portfolio_settings), 1));
alter table portfolio_settings alter column id set default nextval('portfolio_settings_id_seq');

alter table portfolio_settings add column if not exists slug text;                         -- public identifier used in links
alter table portfolio_settings add column if not exists kind text not null default 'guest'; -- 'owner' | 'guest'
alter table portfolio_settings add column if not exists created_at timestamptz not null default now();

update portfolio_settings set slug = 'main', kind = 'owner' where id = 1 and slug is null;
update portfolio_settings set slug = 'p' || id where slug is null;
alter table portfolio_settings alter column slug set not null;

alter table portfolio_settings drop constraint if exists portfolio_settings_kind_chk;
alter table portfolio_settings add constraint portfolio_settings_kind_chk check (kind in ('owner', 'guest'));
alter table portfolio_settings drop constraint if exists portfolio_settings_slug_fmt;
alter table portfolio_settings add constraint portfolio_settings_slug_fmt check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
create unique index if not exists portfolio_settings_slug_key on portfolio_settings (slug);
create unique index if not exists portfolio_settings_one_owner on portfolio_settings (kind) where kind = 'owner';

-- ---- 2. private edit links -------------------------------------------------
-- The secret lives in its OWN table. portfolio_settings is publicly readable
-- (the dashboards read it from the browser), so a token stored there would be
-- visible to everyone. This table has row level security on and NO policies,
-- and no grants for the public roles: only the server (service role) can read it.
create table if not exists portfolio_access (
  portfolio_id int primary key references portfolio_settings(id) on delete cascade,
  edit_token   text not null unique,
  created_at   timestamptz not null default now(),
  constraint portfolio_access_token_len check (char_length(edit_token) >= 32)
);
alter table portfolio_access enable row level security;
revoke all on portfolio_access from anon, authenticated;

-- ---- 3. every data table gets a portfolio_id -------------------------------
-- Default 1 = the owner's portfolio, so existing rows (and the currently
-- running app/worker, which don't know about portfolios yet) stay correct.
alter table portfolio_positions add column if not exists portfolio_id int not null default 1
  references portfolio_settings(id) on delete cascade;
alter table nav_history add column if not exists portfolio_id int not null default 1
  references portfolio_settings(id) on delete cascade;
alter table portfolio_archives add column if not exists portfolio_id int not null default 1
  references portfolio_settings(id) on delete cascade;

create index if not exists idx_nav_history_portfolio_ts on nav_history (portfolio_id, ts);
create index if not exists idx_positions_portfolio_status on portfolio_positions (portfolio_id, status);
create index if not exists idx_archives_portfolio_ended on portfolio_archives (portfolio_id, ended_at desc);

-- ---- 4. guard: stale NAV ticks after a reset, per portfolio ----------------
create or replace function nav_history_guard()
returns trigger
language plpgsql
as $$
declare
  v_start timestamptz;
begin
  select started_at into v_start from portfolio_settings where id = new.portfolio_id;
  if v_start is not null and new.ts < v_start then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists nav_history_guard on nav_history;
create trigger nav_history_guard
  before insert on nav_history
  for each row execute function nav_history_guard();

-- ---- 5. chart series, per portfolio ----------------------------------------
-- Same ranges as before; p_portfolio defaults to 1 so the old call shape
-- (only p_range) still returns the owner's chart.
drop function if exists nav_series(text);

create or replace function nav_series(p_range text, p_portfolio int default 1)
returns table(ts timestamptz, nav double precision)
language plpgsql
stable
as $$
#variable_conflict use_column
declare
  local_now timestamp := now() at time zone 'Europe/Stockholm';
  v_from timestamptz;
begin
  if p_range = '1D' then
    -- "1D" = the most recent day that has data for THIS portfolio.
    select date_trunc('day', max(h.ts) at time zone 'Europe/Stockholm') at time zone 'Europe/Stockholm'
      into v_from
      from nav_history h
     where h.portfolio_id = p_portfolio;
    if v_from is null then
      return;
    end if;
    return query
      select h.ts, h.nav::float8
      from nav_history h
      where h.portfolio_id = p_portfolio and h.ts >= v_from
      order by h.ts;
    return;
  elsif p_range = 'MTD' then
    v_from := date_trunc('month', local_now) at time zone 'Europe/Stockholm';
  elsif p_range = 'YTD' then
    v_from := date_trunc('year', local_now) at time zone 'Europe/Stockholm';
  else
    v_from := '-infinity'::timestamptz;
  end if;

  return query
  with src as (
    select h.ts as ts, h.nav::float8 as nav,
           date_trunc('day', h.ts at time zone 'Europe/Stockholm') as bucket
    from nav_history h
    where h.portfolio_id = p_portfolio and h.ts >= v_from
  ),
  closes as (
    select distinct on (s.bucket) s.ts, s.nav
    from src s
    order by s.bucket, s.ts desc
  ),
  first_row as (
    select s.ts, s.nav from src s order by s.ts asc limit 1
  )
  select u.ts, u.nav
  from (select c.ts, c.nav from closes c union select f.ts, f.nav from first_row f) u
  order by u.ts;
end;
$$;

grant execute on function nav_series(text, int) to anon, authenticated;

-- ---- 6. end & archive a portfolio, per portfolio ---------------------------
-- Same behaviour as before, but only touches the portfolio you name. The new
-- p_portfolio argument is last and defaults to 1, so the old 3-argument call
-- still ends the owner's portfolio.
drop function if exists end_portfolio(text, numeric, text);

create or replace function end_portfolio(
  p_name        text,
  p_new_capital numeric default null,
  p_new_name    text    default null,
  p_portfolio   int     default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id         uuid := gen_random_uuid();
  v_settings   portfolio_settings%rowtype;
  v_start      timestamptz;
  v_end        timestamptz;
  v_final_nav  numeric;
  v_realized   numeric;
  v_trades     int;
  v_closed_now int;
  v_nav_rows   bigint;
  v_name       text;
begin
  perform pg_advisory_xact_lock(hashtext('end_portfolio'));

  if p_new_capital is not null and p_new_capital <= 0 then
    raise exception 'The new start capital must be a positive number.';
  end if;
  if length(coalesce(p_name, '')) > 80 or length(coalesce(p_new_name, '')) > 80 then
    raise exception 'Portfolio names can be at most 80 characters.';
  end if;

  -- Freeze the live tables so the snapshot is consistent (waits for any
  -- in-flight worker tick; the worker/dashboard resume right after commit).
  lock table portfolio_positions, nav_history, price_ticks in access exclusive mode;

  select * into v_settings from portfolio_settings where id = p_portfolio;
  if not found then
    raise exception 'Portfolio % does not exist.', p_portfolio;
  end if;

  select count(*) into v_trades from portfolio_positions where portfolio_id = p_portfolio;
  if v_trades = 0 then
    raise exception 'There are no trades to archive.';
  end if;

  -- 1. close what is still open, at the latest known price
  update portfolio_positions
     set status = 'closed',
         exit_price = coalesce(current_price, entry_price),
         exit_time = clock_timestamp()
   where portfolio_id = p_portfolio and status = 'open';
  get diagnostics v_closed_now = row_count;

  -- 2. summary numbers
  select coalesce(sum(case when quantity is not null
                           then (exit_price - entry_price) * quantity
                           else stake_sek * ((exit_price - entry_price) / entry_price) end), 0)
    into v_realized
    from portfolio_positions
   where portfolio_id = p_portfolio and exit_price is not null;

  select nav into v_final_nav from nav_history where portfolio_id = p_portfolio order by ts desc limit 1;
  v_final_nav := coalesce(v_final_nav, 100);

  select count(*) into v_nav_rows from nav_history where portfolio_id = p_portfolio;

  v_start := coalesce(v_settings.started_at,
                      (select min(ts) from nav_history where portfolio_id = p_portfolio),
                      (select min(entry_time) from portfolio_positions where portfolio_id = p_portfolio));
  v_end := clock_timestamp();

  v_name := coalesce(nullif(btrim(p_name), ''),
                     nullif(btrim(v_settings.portfolio_name), ''),
                     'Portfolio ' || to_char(v_start at time zone 'Europe/Stockholm', 'YYYY-MM-DD')
                     || ' – ' || to_char(v_end at time zone 'Europe/Stockholm', 'YYYY-MM-DD'));

  -- 3. save the copy
  insert into portfolio_archives
    (id, portfolio_id, name, started_at, ended_at, start_capital, final_nav, realized_pl_sek, trade_count, positions)
  values
    (v_id, p_portfolio, v_name, v_start, v_end, v_settings.cash_sek, v_final_nav, v_realized, v_trades,
     coalesce((select jsonb_agg(to_jsonb(p) order by p.entry_time) from portfolio_positions p where p.portfolio_id = p_portfolio), '[]'::jsonb));

  insert into portfolio_archive_nav (archive_id, ts, nav)
  select v_id, ts, nav from nav_history where portfolio_id = p_portfolio order by ts;

  -- 4. reset THIS portfolio only (deleting positions cascades to their price_ticks)
  delete from portfolio_positions where portfolio_id = p_portfolio;
  delete from nav_history where portfolio_id = p_portfolio;

  update portfolio_settings
     set cash_sek       = coalesce(p_new_capital, cash_sek),
         started_at     = v_end,
         portfolio_name = nullif(btrim(p_new_name), '')
   where id = p_portfolio;

  insert into nav_history (ts, nav, portfolio_id) values (v_end, 100, p_portfolio);

  return jsonb_build_object(
    'archive_id', v_id,
    'name', v_name,
    'trade_count', v_trades,
    'closed_at_end', v_closed_now,
    'nav_rows_saved', v_nav_rows,
    'final_nav', v_final_nav,
    'realized_pl_sek', v_realized,
    'new_start_capital', coalesce(p_new_capital, v_settings.cash_sek),
    'new_portfolio_name', nullif(btrim(p_new_name), '')
  );
end;
$$;

revoke all on function end_portfolio(text, numeric, text, int) from public, anon, authenticated;
grant execute on function end_portfolio(text, numeric, text, int) to service_role;

-- ---- 7. create a guest portfolio, atomically -------------------------------
-- Portfolio row + private edit token + the starting NAV point of 100, all or
-- nothing. A duplicate slug raises unique_violation (the API turns that into
-- a friendly message).
create or replace function create_guest_portfolio(
  p_name    text,
  p_slug    text,
  p_capital numeric,
  p_token   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id int;
begin
  if p_capital is null or p_capital <= 0 then
    raise exception 'The start capital must be a positive number.';
  end if;
  if length(coalesce(p_name, '')) > 80 then
    raise exception 'The name can be at most 80 characters.';
  end if;

  insert into portfolio_settings (slug, kind, cash_sek, started_at, trader_name)
  values (p_slug, 'guest', p_capital, now(), nullif(btrim(p_name), ''))
  returning id into v_id;

  insert into portfolio_access (portfolio_id, edit_token) values (v_id, p_token);
  insert into nav_history (ts, nav, portfolio_id) values (now(), 100, v_id);

  return jsonb_build_object('id', v_id, 'slug', p_slug);
end;
$$;

revoke all on function create_guest_portfolio(text, text, numeric, text) from public, anon, authenticated;
grant execute on function create_guest_portfolio(text, text, numeric, text) to service_role;

notify pgrst, 'reload schema';

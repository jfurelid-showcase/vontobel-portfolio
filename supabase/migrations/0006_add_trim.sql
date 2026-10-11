-- ============================================================================
-- Buy more of a position ("Köp mer") and sell part of one ("Sälj del").
--
-- How it is stored, so that NAV and every profit/loss figure keep working
-- exactly as before:
--
--   * A position keeps its ONE row. Its entry_price is the GAV (the average
--     price you paid, weighted by quantity) and its quantity is what you hold
--     now, so quantity x GAV is always what the holding cost.
--   * BUYING MORE: quantity goes up and the GAV is recalculated:
--         new GAV = (old quantity x old GAV + bought quantity x price) / new quantity
--   * SELLING PART: the sold part becomes its own CLOSED row (same GAV as entry,
--     the sale price as exit), and the open row keeps the rest at the same GAV.
--     The realised result of the sale is therefore counted like any closed trade,
--     and the NAV does not jump.
--   * position_fills is a short journal of the buys and part-sales (for the trade
--     log and the chart); it does not feed any calculation.
--
-- Safe to run more than once. Run it FIRST, then deploy the new code. Until it has
-- been run, everything works as before and the two new buttons answer with a
-- message saying this file needs to be run.
-- ============================================================================

alter table portfolio_positions add column if not exists close_reason text;
alter table portfolio_positions add column if not exists adds int not null default 0;   -- how many times it has been added to
alter table portfolio_positions add column if not exists parent_position_id uuid
  references portfolio_positions(id) on delete cascade;                                  -- set on the closed row a part-sale creates
create index if not exists idx_positions_parent on portfolio_positions (parent_position_id)
  where parent_position_id is not null;

-- 'trim' = closed by selling part of a position.
alter table portfolio_positions drop constraint if exists portfolio_positions_close_reason_chk;
alter table portfolio_positions add constraint portfolio_positions_close_reason_chk
  check (close_reason is null or close_reason in ('manual', 'stop_loss', 'take_profit', 'trim'));

-- ---- the journal -----------------------------------------------------------
create table if not exists position_fills (
  id                  bigserial primary key,
  position_id         uuid    not null references portfolio_positions(id) on delete cascade,
  portfolio_id        int     not null references portfolio_settings(id) on delete cascade,
  ts                  timestamptz not null default now(),
  kind                text    not null check (kind in ('open', 'add', 'trim')),
  quantity            numeric not null check (quantity > 0),
  price               numeric not null check (price > 0),
  avg_cost            numeric not null check (avg_cost > 0),   -- the GAV right after this event
  qty_after           numeric not null check (qty_after >= 0), -- what was held right after this event
  realized_pl_sek     numeric,                                 -- part-sales only: quantity x (price - GAV)
  trimmed_position_id uuid references portfolio_positions(id) on delete set null
);
create index if not exists idx_fills_position on position_fills (position_id, ts);
create index if not exists idx_fills_portfolio on position_fills (portfolio_id, ts);

alter table position_fills enable row level security;
drop policy if exists "public read position_fills" on position_fills;
create policy "public read position_fills" on position_fills for select using (true);
grant select on position_fills to anon, authenticated;
revoke insert, update, delete on position_fills from anon, authenticated;

-- ---- buy more ----------------------------------------------------------------
-- p_price is what was paid for the added contracts (the live ask, fetched by the server).
create or replace function add_to_position(p_position uuid, p_quantity numeric, p_price numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v        portfolio_positions%rowtype;
  v_qty    numeric;
  v_gav    numeric;
  v_now    timestamptz := clock_timestamp();
  v_row    portfolio_positions%rowtype;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Antalet måste vara större än 0.';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Priset är ogiltigt.';
  end if;

  -- Lock the row: nothing else (not even the quote worker closing it) changes it meanwhile.
  select * into v from portfolio_positions where id = p_position for update;
  if not found then
    raise exception 'Positionen finns inte.';
  end if;
  if v.status <> 'open' then
    raise exception 'Positionen är stängd.';
  end if;
  if v.quantity is null or v.quantity <= 0 or v.entry_price is null or v.entry_price <= 0 then
    raise exception 'Positionen saknar antal eller ingångskurs och kan inte utökas.';
  end if;

  -- A position made before this feature has no journal yet: record how it started.
  if not exists (select 1 from position_fills where position_id = v.id) then
    insert into position_fills (position_id, portfolio_id, ts, kind, quantity, price, avg_cost, qty_after)
    values (v.id, v.portfolio_id, v.entry_time, 'open', v.quantity, v.entry_price, v.entry_price, v.quantity);
  end if;

  v_qty := v.quantity + p_quantity;
  v_gav := (v.quantity * v.entry_price + p_quantity * p_price) / v_qty;

  update portfolio_positions
     set quantity = v_qty,
         entry_price = v_gav,
         stake_sek = v_gav * v_qty,
         adds = adds + 1
   where id = v.id
   returning * into v_row;

  insert into position_fills (position_id, portfolio_id, ts, kind, quantity, price, avg_cost, qty_after)
  values (v.id, v.portfolio_id, v_now, 'add', p_quantity, p_price, v_gav, v_qty);

  return to_jsonb(v_row);
end;
$$;

revoke all on function add_to_position(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function add_to_position(uuid, numeric, numeric) to service_role;

-- ---- sell part ---------------------------------------------------------------
-- p_price is what the sold contracts fetched (the live bid, fetched by the server).
create or replace function trim_position(p_position uuid, p_quantity numeric, p_price numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v         portfolio_positions%rowtype;
  v_now     timestamptz := clock_timestamp();
  v_pl      numeric;
  v_left    numeric;
  v_open    portfolio_positions%rowtype;
  v_closed  portfolio_positions%rowtype;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Antalet måste vara större än 0.';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'Priset är ogiltigt.';
  end if;

  select * into v from portfolio_positions where id = p_position for update;
  if not found then
    raise exception 'Positionen finns inte.';
  end if;
  if v.status <> 'open' then
    raise exception 'Positionen är stängd.';
  end if;
  if v.quantity is null or v.quantity <= 0 or v.entry_price is null or v.entry_price <= 0 then
    raise exception 'Positionen saknar antal eller ingångskurs och kan inte delas.';
  end if;
  if p_quantity >= v.quantity then
    raise exception 'Du kan sälja högst % av de % kontrakten här. Vill du sälja allt, använd Stäng.', v.quantity - 1, v.quantity;
  end if;

  if not exists (select 1 from position_fills where position_id = v.id) then
    insert into position_fills (position_id, portfolio_id, ts, kind, quantity, price, avg_cost, qty_after)
    values (v.id, v.portfolio_id, v.entry_time, 'open', v.quantity, v.entry_price, v.entry_price, v.quantity);
  end if;

  v_left := v.quantity - p_quantity;
  v_pl   := p_quantity * (p_price - v.entry_price);   -- realised on the part that was sold

  -- The sold part, as a closed trade at the same GAV.
  insert into portfolio_positions
    (portfolio_id, isin, name, direction, leverage, underlying, instrument_type,
     entry_price, quantity, stake_sek, entry_time,
     exit_price, exit_time, current_price, current_updated_at,
     status, close_reason, parent_position_id)
  values
    (v.portfolio_id, v.isin, v.name, v.direction, v.leverage, v.underlying, v.instrument_type,
     v.entry_price, p_quantity, v.entry_price * p_quantity, v.entry_time,
     p_price, v_now, p_price, v_now,
     'closed', 'trim', v.id)
  returning * into v_closed;

  -- What is left stays open at the same GAV.
  update portfolio_positions
     set quantity = v_left,
         stake_sek = v.entry_price * v_left
   where id = v.id
   returning * into v_open;

  insert into position_fills
    (position_id, portfolio_id, ts, kind, quantity, price, avg_cost, qty_after, realized_pl_sek, trimmed_position_id)
  values
    (v.id, v.portfolio_id, v_now, 'trim', p_quantity, p_price, v.entry_price, v_left, v_pl, v_closed.id);

  return jsonb_build_object('position', to_jsonb(v_open), 'sold', to_jsonb(v_closed), 'realized_pl_sek', v_pl);
end;
$$;

revoke all on function trim_position(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function trim_position(uuid, numeric, numeric) to service_role;

notify pgrst, 'reload schema';

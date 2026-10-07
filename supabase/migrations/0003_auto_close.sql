-- ============================================================================
-- Automatic stop loss / take profit.
--
-- Each position can ask to be closed automatically when its price reaches the
-- stop loss and/or the target you set. The quote worker (which already sees
-- every price every ~10 seconds) does the closing.
--
-- Safe to run more than once. Run this FIRST, then deploy the app and worker.
-- Until it has run, everything keeps working exactly as before; the new
-- options simply can't be switched on yet.
-- ============================================================================

alter table portfolio_positions add column if not exists auto_stop   boolean not null default false;
alter table portfolio_positions add column if not exists auto_target boolean not null default false;

-- Why a position was closed: you did it ('manual'), or the price hit the
-- stop loss ('stop_loss') or the target ('take_profit'). Null for older trades.
alter table portfolio_positions add column if not exists close_reason text;

alter table portfolio_positions drop constraint if exists portfolio_positions_close_reason_chk;
alter table portfolio_positions add constraint portfolio_positions_close_reason_chk
  check (close_reason is null or close_reason in ('manual', 'stop_loss', 'take_profit'));

-- An automatic level needs a level: you can't ask for an automatic stop loss
-- without a stop loss price (or an automatic target without a target).
alter table portfolio_positions drop constraint if exists portfolio_positions_auto_stop_needs_level;
alter table portfolio_positions add constraint portfolio_positions_auto_stop_needs_level
  check (not auto_stop or stop_loss is not null);
alter table portfolio_positions drop constraint if exists portfolio_positions_auto_target_needs_level;
alter table portfolio_positions add constraint portfolio_positions_auto_target_needs_level
  check (not auto_target or target_price is not null);

notify pgrst, 'reload schema';

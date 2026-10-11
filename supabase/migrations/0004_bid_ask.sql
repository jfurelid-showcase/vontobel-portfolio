-- ============================================================================
-- Bid / ask prices.
--
-- Every contract is quoted with a bid (the price you can SELL at) and an ask
-- (the price you BUY at). The quote worker now stores both, every tick:
--   * on each position: the latest valid bid and ask, and when they were seen
--   * on each price tick: the bid, the ask and the last traded price, so you
--     can see how they behave over time (e.g. for thinly traded contracts)
--
-- Safe to run more than once. Run this FIRST, then deploy the app and worker.
-- Until it has run, everything keeps working exactly as before.
-- ============================================================================

alter table portfolio_positions add column if not exists current_bid      numeric;
alter table portfolio_positions add column if not exists current_ask      numeric;
alter table portfolio_positions add column if not exists quote_updated_at timestamptz;

alter table price_ticks add column if not exists bid        numeric;
alter table price_ticks add column if not exists ask        numeric;
alter table price_ticks add column if not exists last_price numeric;

-- Quotes are positive prices, and a bid can never be above the ask (the
-- worker discards crossed quotes instead of storing them).
alter table portfolio_positions drop constraint if exists portfolio_positions_quote_chk;
alter table portfolio_positions add constraint portfolio_positions_quote_chk
  check ((current_bid is null or current_bid > 0)
     and (current_ask is null or current_ask > 0)
     and (current_bid is null or current_ask is null or current_bid <= current_ask));

alter table price_ticks drop constraint if exists price_ticks_quote_chk;
alter table price_ticks add constraint price_ticks_quote_chk
  check ((bid is null or bid > 0)
     and (ask is null or ask > 0)
     and (last_price is null or last_price > 0)
     and (bid is null or ask is null or bid <= ask));

notify pgrst, 'reload schema';

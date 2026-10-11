-- Kör efter att workern gått minst en handelsdag med 0004 installerad.
-- Visar, per kontrakt, om senaste affär står still medan bid rör sig.
select
  p.name,
  count(*)                                   as mätningar,
  count(distinct t.last_price)               as olika_senaste_affär,
  count(distinct t.bid)                      as olika_bid,
  round(avg((t.ask - t.bid) / nullif(t.ask, 0) * 100)::numeric, 2) as snitt_spread_procent,
  count(*) filter (where t.bid is null)      as saknar_bid
from price_ticks t
join portfolio_positions p on p.id = t.position_id
where t.ts > now() - interval '1 day'
  and (t.bid is not null or t.last_price is not null)
group by p.name
order by p.name;
-- Läsning: ett kontrakt med få "olika_senaste_affär" men många "olika_bid" är precis det som
-- värdering på bid löser. Hög "saknar_bid" betyder att bid ofta saknas för kontraktet.

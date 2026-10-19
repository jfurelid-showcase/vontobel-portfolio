-- ============================================================================
-- Produkt i motsatt riktning: från och med nu matchas den på Vontobels
-- hävstång (samma siffra som "Hävstång" på markets.vontobel.com).
--
-- * Valet för nya positioner görs av quote-workern (Railway), som läser
--   hävstången från Vontobels produktsidor. Databasens trigger stängs därför av,
--   så att den inte hinner fylla i ett sämre val först.
-- * Befintliga positioner vars kommentar anger en produkt ("Produkt i motsatt
--   riktning: MFL APPLE VT307") får den produkten, en gång för alla.
-- * Öppna positioner utan sådan kommentar nollställs, så att workern väljer om
--   dem på hävstång inom några minuter (under börsens öppettider).
--
-- Kör efter 0005–0008. Säkert att köra flera gånger.
-- ============================================================================

drop trigger if exists trg_sitg_set_opposite on portfolio_positions;

-- 1) Produkten som står i kommentaren
update portfolio_positions p
set opposite_name = coalesce(c.name, x.manual),
    opposite_isin = c.isin
from (
  select id, trim((regexp_match(note, 'motsatt riktning:\s*([^\n\r]+)', 'i'))[1]) as manual
  from portfolio_positions
  where note ~* 'motsatt riktning:'
) x
left join certificates_full c on upper(c.name) = upper(x.manual)
where p.id = x.id and x.manual is not null and x.manual <> '';

-- 2) Öppna positioner utan produkt i kommentaren: välj om på hävstång (workern)
update portfolio_positions
set opposite_isin = null, opposite_name = null
where status = 'open' and (note is null or note !~* 'motsatt riktning:');

notify pgrst, 'reload schema';

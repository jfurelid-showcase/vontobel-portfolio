-- ============================================================================
-- Cache för hävstång hämtad från Vontobels produktsidor.
--
-- Valet av produkt i motsatt riktning jämför nu hävstången för ALLA kandidater
-- (kurserna i produktlistan är ofta tomma eller gamla och dög inte som
-- förurval). För att inte hämta samma sidor om och om igen sparas varje
-- hämtad hävstång här i 30 minuter. Bara servern (service role) läser och
-- skriver tabellen.
--
-- Säkert att köra flera gånger.
-- ============================================================================

create table if not exists vontobel_leverage_cache (
  isin        text primary key,
  leverage    numeric,
  fetched_at  timestamptz not null default now()
);

alter table vontobel_leverage_cache enable row level security;
-- Inga policyer: anonyma besökare kan varken läsa eller skriva.

notify pgrst, 'reload schema';

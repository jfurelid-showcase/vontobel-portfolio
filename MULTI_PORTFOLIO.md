# Flera portföljer (ägare + gäster)

## Hur det fungerar
- **Din portfölj** ligger kvar på `/` precis som förut (inga länkar går sönder).
- **Varje gäst** får en egen portfölj med egna positioner, NAV-historik, profil och arkiv.
  - Publik visning: `/?p=<adress>`
  - Privat redigeringslänk: `/?p=<adress>&k=<hemlig-nyckel>` (ger full kontroll över just den portföljen)
- **Admin** är lösenordsskyddad. Där ser du alla profiler, kopierar länkar och embed-koder,
  lägger till gäster, skapar ny privat länk och tar bort gäster.

## Uppsättning (i den här ordningen)
1. **Vercel → Settings → Environment Variables:** lägg till `ADMIN_PASSWORD` (ett långt lösenord).
   Valfritt: `SESSION_SECRET` (annars används lösenordet för att signera inloggningen).
2. **Supabase → SQL Editor:** kör `supabase/migrations/0002_multi_portfolio.sql`.
   Den är säker att köra flera gånger, och den gamla appen och workern fortsätter fungera efter den.
3. **Pusha koden.** Vercel och Railway bygger om automatiskt.
4. Öppna `/?tab=admin`, logga in, skapa en gäst och skicka den privata länken.

## Säkerhet i korthet
- Alla ändringar kontrolleras på servern: admin-lösenord, eller gästens egen nyckel för just den portföljen.
  En gästs nyckel fungerar aldrig på en annan portfölj.
- Nycklarna ligger i en egen tabell (`portfolio_access`) som anonyma besökare inte kan läsa.
- Saknas `ADMIN_PASSWORD` nekas alla ändringar (det är inte öppet som standard).
- Visningssidor är publika men inte listade. Vem som helst som känner adressen kan titta.

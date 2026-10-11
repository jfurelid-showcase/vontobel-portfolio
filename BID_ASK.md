# Köp- och säljkurs (ask / bid)

Alla köp sker till **ask** (köpkursen) och alla försäljningar till **bid** (säljkursen).
Värderingen av öppna positioner kan följa **bid**, så att kontrakt som sällan handlas
ändå följer marknaden.

## Uppsättning (i den här ordningen)
1. **Supabase:** kör `supabase/migrations/0004_bid_ask.sql` (och `0003_auto_close.sql` om du inte gjort det).
2. **Pusha koden.** Vercel och Railway bygger om automatiskt.
3. Från och med nu sparar workern bid, ask och senaste affär för varje kontrakt vid varje mätning.
   **Siffrorna i portföljen ändras inte** förrän du slår på steg 5.
4. Kontrollera datan efter en handelsdag (SQL i `BID_ASK_CHECK.sql`).
5. **Railway → workern → Variables:** lägg till `PRICE_BASIS` = `bid` och bygg om.
   Tillbaka till det gamla: ta bort variabeln eller sätt `last`.

## Regler
- **Ingångskurs** = live-ask som servern hämtar i samma stund du lägger till positionen. Går inte att skriva in eller ändra.
- **Utgångskurs** = live-bid i samma stund du stänger. Automatiska stängningar sker till bid.
- Saknas ask går det inte att köpa. Saknas bid går det inte att stänga (gäst), förutom att ägaren (admin) då kan ange kursen för hand.
- Saknas eller är en kurs trasig (bid över ask, noll) behåller workern senast kända kurs och stänger aldrig automatiskt på den.

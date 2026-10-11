# Köp- och säljkurs (ask / bid)

Alla köp sker till **ask** (köpkursen) och alla försäljningar till **bid** (säljkursen).
Värderingen av öppna positioner kan följa **bid**, så att kontrakt som sällan handlas
ändå följer marknaden.

## Uppsättning (i den här ordningen)
1. **Supabase:** kör `supabase/migrations/0004_bid_ask.sql` (och `0003_auto_close.sql` om du inte gjort det).
2. **Pusha koden.** Vercel och Railway bygger om automatiskt.
3. Från och med nu **värderas NAV och öppet P/L på bid**, och workern sparar bid, ask och senaste affär för varje öppen
   position vid varje mätning. Ingen variabel behöver läggas in på Railway.
   Vill du tillfälligt gå tillbaka till att värdera på senaste affär: lägg in `PRICE_BASIS` = `last` på Railway.
   Bara exakt ordet `last` gör det. Tas variabeln bort värderas det på bid igen.
4. Kontrollera efter en handelsdag med `BID_ASK_CHECK.sql`.

## Så fungerar det
- **Värdering:** varje öppen position värderas på **bid**, priset du faktiskt kunde sälja till. Därför börjar en ny position
  något under noll, motsvarande spreaden (du köper på ask och värderas på bid), och NAV och öppet P/L visar det direkt.
  Det gäller varje nytt köp och varje Köp mer.
- **Tempo:** workern mäter var tionde sekund vardagar kl 08:00–22:00. Nästa mätning startar 10 s efter att den förra
  *startade* (inte efter att den slutade), så tempot driver inte iväg när en mätning tar några sekunder.
- **Alltid en bid:** saknas bid i NGM:s svar för ett kontrakt, eller misslyckas anropet, frågar workern en gång till efter en
  halv sekund innan kontraktet hoppas över för den mätningen. Då behåller positionen sitt senast kända värde, och inget
  stängs automatiskt på en saknad kurs. Ett glest handlat kontrakt (där senaste affär står still) följer ändå bid och
  uppdateras vid varje mätning så länge NGM visar en bid.
- **Ingångskurs** = live-ask som servern hämtar i samma stund du lägger till positionen. Går inte att skriva in eller ändra.
- **Köp kräver både ask och bid.** Saknas bid kan köpet inte värderas, och förlusten motsvarande spreaden kunde inte noteras
  från början. Då läggs positionen inte till, och du får ett meddelande om att försöka igen.
- **Utgångskurs** = live-bid i samma stund du stänger. Automatiska stängningar sker till bid.
- Saknas ask går det inte att köpa. Saknas bid går det inte att stänga som gäst, förutom att ägaren (admin) då kan ange kursen
  för hand.
- Saknas eller är en kurs trasig (bid över ask, noll) behåller workern senast kända kurs och stänger aldrig automatiskt på den.

## Att veta
- Första mätningen efter bytet ger ett litet steg ned i NAV: dina öppna positioner köptes till priser från tiden före
  bid/ask, och värderas nu på bid. Historiken skrivs inte om.
- Utanför vardagar kl 08:00–22:00 uppdateras inget NAV.

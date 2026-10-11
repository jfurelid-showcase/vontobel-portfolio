# Köp mer och Sälj del

Du kan nu köpa mer av en befintlig position (då räknas GAV om) och sälja en del av den.

## Uppsättning (i den här ordningen)
1. **Supabase:** kör `supabase/migrations/0006_add_trim.sql`. Den är säker att köra flera gånger.
   (Har du inte kört `0004_bid_ask.sql` och `0005_contract_status.sql` än, kör dem först.)
2. **Pusha koden.** Utan steg 1 fungerar allt som förut, och knapparna svarar med att filen måste köras.

## Så fungerar det
- **Köp mer** (Admin, på en öppen position): ange antal. Köpet sker alltid till live-**ask**, som servern hämtar.
  Ingångskursen blir positionens **GAV**, snittkursen viktad på antal:

      nytt GAV = (gammalt antal × gammalt GAV + köpt antal × ask) / nytt antal

  Exempel: 100 st à 10,00 + 50 st à 12,00 → 150 st, GAV 10,67.
- **Sälj del**: ange antal (minst 1 mindre än du håller). Försäljningen sker alltid till live-**bid**.
  Den sålda delen blir en egen stängd affär till positionens GAV, så resultatet räknas som vilken stängd affär som helst
  (`antal × (säljkurs − GAV)`). Det som är kvar förblir öppet med **samma GAV**. Vill du sälja allt, använd Close.
- NAV hoppar inte när du köper eller säljer del: ett köp till marknadskurs ändrar inget, och en delförsäljning flyttar bara
  värdet från "öppet" till "stängt".
- **Syns i** kortet (GAV i stället för Ingångspris, och "Sålt X kontrakt tidigare · ±Y SEK realiserat"), i Trades-loggen
  (KÖPT TILL / SÅLD DEL med eget pris och tid) och i dagsdiagrammet (egna markörer).

## Regler och begränsningar
- Priset kan inte skrivas in. Saknas ask går det inte att köpa till, och saknas bid går det inte att sälja del (ägaren kan
  då ange en kurs för hand, precis som vid Close).
- **Antalet går inte längre att ändra i Edit.** Det ändras bara med Köp mer / Sälj del, så att GAV och resultat alltid stämmer.
- En delförsäljning kan inte öppnas igen (Reopen), eftersom samma kontrakt då skulle räknas två gånger.
- Stop loss och mål ligger kvar oförändrade efter ett köp eller en delförsäljning, och den automatiska stängningen
  stänger det som är kvar vid nivån.
- Gäster kan använda knapparna på sin egen portfölj via sin privata länk.
- Positioner som skapats före den här funktionen fungerar som vanligt: deras första köp läggs in i historiken första gången
  du köper till eller säljer del.

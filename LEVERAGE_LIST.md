# Hävstång i kontraktslistan (Admin)

När du söker efter ett kontrakt i Admin fylls kolumnen **Lev** i, och den går att sortera.

## Så fungerar det

- **Direkt i sökresultatet** kommer det som redan är känt: NGM:s fasta hävstång (Bull/Bear) och den
  senast sparade hävstången från Vontobel (tabellen `vontobel_leverage_cache`, migration 0013).
- **Resten hämtas medan du tittar**, 40 kontrakt i taget (`POST /api/certificates/leverages`), mest
  handlade först, och läggs in allt eftersom. Rubriken över tabellen visar hur långt det kommit
  ("Hämtar hävstång… (40/95)"). Kontrakt som väntar visar "…".
- **Marknaden öppen** (vardagar 08:00–22:00 svensk tid): saknade värden och värden äldre än 30 minuter
  hämtas. Ett gammalt värde visas dämpat tills det uppdaterats.
- **Marknaden stängd:** det senast kända värdet används som det är, oavsett hur gammalt, och hämtas inte
  om. Bara kontrakt som saknar något känt värde hämtas. Rubriken säger "Marknaden är stängd:
  hävstången är den senast kända." och tooltipen på värdet visar när det hämtades.
- **Rader utan värde förklarar varför** (håll muspekaren över cellen):
  - `…` hämtas just nu,
  - `–` Vontobels sida visar ingen hävstång för kontraktet just nu (det kan vara utslaget eller sakna kurs),
  - `?` det gick inte att hämta (för många anrop eller fel hos Vontobel). Tillfälliga fel sparas inte, och
    kontraktet frågas om efter en paus, upp till tre gånger, innan det ges upp.
- **Hävstång visas alltid som storlek.** NGM anger bear som negativ (−4); i listan står 4x, och riktningen
  står i kolumnen Dir. Sorteringen går på storleken.
- **Ett misslyckat försök skriver aldrig över ett känt värde.** (Det gamla hjälpanropet `getLeverages`,
  som motsatt-produkt-sökningen använder, skrev förut över med "inget" om Vontobel inte svarade. Det är
  rättat.)
- **Sortering:** klicka på "Lev" ett varv för högst hävstång först, igen för lägst först. Kontrakt utan
  värde ligger alltid sist.

## Det du behöver göra

Inget i databasen. Filerna läggs in och pushas. Om migration `0013_vontobel_leverage_cache.sql` inte har
körts fungerar listan ändå, men utan "senast känd" (värden sparas inte mellan sökningar).

## Skydd

- Rutten hämtar bara sidor för kontrakt som finns i din egen lista, byggda av det sparade namnet.
- Högst 40 kontrakt per anrop, högst 4 sidor åt gången, och en broms på 300 anrop per 10 minuter och adress.
- Varje kontrakt hämtas högst en gång per 30 minuter (stängd marknad: bara om inget värde finns).

## Filer

- `web/lib/vontobelLeverage.ts` (utökad: `getLatestLeverages`, `readCachedLeverages`, `withKnownLeverage`)
- `web/lib/leverageFill.ts` (ny: hämtar i omgångar, texter och regler på klientsidan)
- `web/app/api/certificates/leverages/route.ts` (ny)
- `web/app/api/certificates/search/route.ts` (skickar med känd hävstång och om marknaden är öppen)
- `web/app/page.tsx` (kolumnen, rubriken, sorteringens tooltip)

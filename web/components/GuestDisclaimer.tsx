"use client";

import { useState } from "react";

// Disclaimer och risker för gästportföljer. Samma text som på
// skininthegame.se. Visas under Dashboard och Trades för alla portföljer
// som inte är ägarens egen. Utkast: låt Vontobel/Adfin granska texten.
const SECTIONS: [string, string][] = [
  [
    "Om gästportföljen",
    "Skin in the Game produceras av Adfin Media AB och sponsras av Vontobel. Månadens gästportfölj är en fiktiv depå: affärerna, kommentarerna och resultatet visar hur gästen resonerar och agerar, men ingen riktig handel sker i portföljen. Kurserna kommer från NGM och kan vara fördröjda.",
  ],
  [
    "Marknadsrisk",
    "Certifikatens värde följer den underliggande tillgången och kan falla kraftigt, även långt under det pris du köpte för. Produkterna har inget kapitalskydd.",
  ],
  [
    "Emittentrisk",
    "Ett certifikat är en skuldförbindelse från den som gett ut det. Om emittenten eller dess garant inte kan fullgöra sina åtaganden kan du förlora hela det investerade beloppet. Produkterna omfattas inte av insättningsgarantin.",
  ],
  [
    "Risk med hävstångsprodukter",
    "Bull & Bear-certifikat, mini futures och turbos har hävstång, vilket förstärker både uppgångar och nedgångar och kan leda till total förlust på kort tid. Produkter med daglig hävstång räknas om varje dag, så över flera dagar kan utvecklingen skilja sig mycket från den underliggande tillgångens utveckling gånger hävstången.",
  ],
  [
    "Valutarisk",
    "Om den underliggande tillgången handlas i en annan valuta än certifikatet påverkas värdet också av växelkursen, vilket kan ge stora svängningar.",
  ],
  [
    "Viktigt att notera",
    "Börshandlade produkter med hävstång är komplexa, kräver löpande bevakning och passar inte alla investerare. De ger inga rättigheter i den underliggande tillgången, till exempel rösträtt eller utdelning. Läs alltid produktens grundprospekt, slutliga villkor och faktablad (KID) hos emittenten innan du investerar.",
  ],
  [
    "Ansvarsfriskrivning",
    "Innehållet är framtaget i informations- och utbildningssyfte och ska inte ses som investeringsrådgivning eller som en uppmaning att köpa eller sälja något finansiellt instrument. Historisk utveckling, även i en fiktiv portfölj, är ingen garanti för framtida avkastning. Fatta dina egna beslut utifrån dina mål och din ekonomi, och rådfråga en oberoende rådgivare vid behov.",
  ],
  [
    "Målgrupp",
    "Innehållet riktar sig till personer i Sverige med kunskap om och erfarenhet av börshandlade produkter med hävstång. Emittenten står under tillsyn av behörig myndighet i sitt hemland; mer information finns på emittentens webbplats.",
  ],
  [
    "Intressekonflikter",
    "Podden sponsras av Vontobel, som är emittent av certifikaten som visas på sidan, och länkarna till Vontobels produktsidor är sponsrade. Gästen och redaktionen kan privat äga eller ha handlat instrument som nämns.",
  ],
];

export default function GuestDisclaimer() {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-8 rounded-xl border border-neutral-800 bg-neutral-900/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="grid w-full grid-cols-[auto_1fr] gap-3.5 px-5 py-5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300/60"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[1.5px] border-neutral-400 font-mono text-xs font-bold text-neutral-400"
        >
          i
        </span>
        <span>
          <span className="mb-1 block text-base font-semibold text-neutral-100">Disclaimer och risker</span>
          <span className="block text-sm leading-relaxed text-neutral-400">
            Gästportföljen är fiktiv och handlas inte med riktiga pengar. Innehållet är inte investeringsrådgivning.
            Certifikat med hävstång innebär hög risk och du kan förlora hela det investerade beloppet.
          </span>
          {!open && (
            <span className="mt-3 inline-block font-mono text-xs font-semibold text-neutral-100 underline underline-offset-4">
              Visa mer
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 sm:pl-[58px]">
          {SECTIONS.map(([title, text]) => (
            <div key={title} className="mt-4 first:mt-0">
              <h4 className="mb-1 text-sm font-semibold text-neutral-100">{title}</h4>
              <p className="max-w-3xl text-sm leading-relaxed text-neutral-400">{text}</p>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="mt-4 font-mono text-xs font-semibold text-neutral-100 underline underline-offset-4"
          >
            Visa mindre
          </button>
        </div>
      )}
    </section>
  );
}

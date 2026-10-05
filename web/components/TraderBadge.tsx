"use client";

import { useEffect, useState } from "react";
import Flag from "@/components/Flag";
import { fetchTraderRow } from "@/lib/traderSettings";
import { parseStyle } from "@/lib/traderStyle";

const LEVEL_LABELS: Record<string, string> = { noob: "Nybörjare", intermediate: "Mellan", pro: "Proffs" };

export default function TraderBadge() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const data = await fetchTraderRow();
      setPhotoUrl(data?.trader_photo_url ?? null);
      setName(data?.trader_name ?? null);
      setLevel(data?.trader_level ?? null);
      setStyle(data?.trader_style ?? null);
      setCountry(data?.trader_country ?? null);
    })();
  }, []);

  if (!photoUrl && !name && !level && !style && !country) return null;

  return (
    <div>
      <div className="flex items-center gap-3">
        {photoUrl ? (
          // Country flag sits as a small badge on the photo's lower-right corner.
          <div className="relative shrink-0">
            <img src={photoUrl} alt="Trader" className="h-10 w-10 rounded-full object-cover" />
            {country && <Flag code={country} className="absolute -bottom-0.5 -right-0.5 h-4 w-4 ring-2 ring-neutral-950" />}
          </div>
        ) : (
          country && <Flag code={country} className="h-7 w-7 shrink-0 ring-1 ring-white/10" />
        )}
        <div>
          {name && <div className="text-sm font-medium text-neutral-100">{name}</div>}
          {level && (
            <div className="text-xs text-neutral-500">
              Erfarenhetsnivå: <span className="text-neutral-300">{LEVEL_LABELS[level] || level}</span>
            </div>
          )}
        </div>
      </div>
      {style && (
        <div className="mt-3 rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-300/80">Tradingstil</div>
          <p className="whitespace-pre-line break-words text-sm leading-snug text-neutral-100">
            {parseStyle(style).map((seg, i) =>
              seg.type === "link" ? (
                <a
                  key={i}
                  href={seg.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:decoration-sky-300"
                >
                  {seg.text}
                </a>
              ) : (
                <span key={i}>{seg.text}</span>
              )
            )}
          </p>
        </div>
      )}
    </div>
  );
}

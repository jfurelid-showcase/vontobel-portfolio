"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { parseStyle } from "@/lib/traderStyle";

const LEVEL_LABELS: Record<string, string> = { noob: "Nybörjare", intermediate: "Mellan", pro: "Proffs" };

export default function TraderBadge() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);
  const [style, setStyle] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // If the trader_style column isn't in the database yet, fall back to the
      // original columns instead of hiding the whole badge.
      let res = await supabase.from("portfolio_settings").select("trader_photo_url, trader_name, trader_level, trader_style").single();
      if (res.error) {
        res = await supabase.from("portfolio_settings").select("trader_photo_url, trader_name, trader_level").single();
      }
      const data = res.data as { trader_photo_url?: string; trader_name?: string; trader_level?: string; trader_style?: string } | null;
      setPhotoUrl(data?.trader_photo_url ?? null);
      setName(data?.trader_name ?? null);
      setLevel(data?.trader_level ?? null);
      setStyle(data?.trader_style ?? null);
    })();
  }, []);

  if (!photoUrl && !name && !level && !style) return null;

  return (
    <div>
      <div className="flex items-center gap-3">
        {photoUrl && <img src={photoUrl} alt="Trader" className="h-10 w-10 rounded-full object-cover" />}
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

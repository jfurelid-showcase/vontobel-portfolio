"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const LEVEL_LABELS: Record<string, string> = { noob: "Noob", intermediate: "Intermediate", pro: "Pro" };

export default function TraderBadge() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("portfolio_settings")
      .select("trader_photo_url, trader_name, trader_level")
      .single()
      .then(({ data }) => {
        setPhotoUrl(data?.trader_photo_url ?? null);
        setName(data?.trader_name ?? null);
        setLevel(data?.trader_level ?? null);
      });
  }, []);

  if (!photoUrl && !name && !level) return null;

  return (
    <div className="flex items-center gap-3">
      {photoUrl && <img src={photoUrl} alt="Trader" className="h-10 w-10 rounded-full object-cover" />}
      <div>
        {name && <div className="text-sm font-medium text-neutral-100">{name}</div>}
        {level && (
          <div className="text-xs text-neutral-500">
            Experience level: <span className="text-neutral-300">{LEVEL_LABELS[level] || level}</span>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const LEVEL_LABELS: Record<string, string> = { noob: "Noob", intermediate: "Intermediate", pro: "Pro" };
const LEVEL_COLORS: Record<string, string> = {
  noob: "bg-neutral-700 text-neutral-300",
  intermediate: "bg-amber-500/20 text-amber-400",
  pro: "bg-emerald-500/20 text-emerald-400",
};

export default function TraderBadge() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [level, setLevel] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("portfolio_settings")
      .select("trader_photo_url, trader_level")
      .single()
      .then(({ data }) => {
        setPhotoUrl(data?.trader_photo_url ?? null);
        setLevel(data?.trader_level ?? null);
      });
  }, []);

  if (!photoUrl && !level) return null;

  return (
    <div className="flex items-center gap-2">
      {photoUrl && <img src={photoUrl} alt="Trader" className="h-7 w-7 rounded-full object-cover" />}
      {level && (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_COLORS[level] || ""}`}>
          {LEVEL_LABELS[level] || level}
        </span>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const LEVELS = ["noob", "intermediate", "pro"] as const;

export default function TraderSettings() {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<string>("intermediate");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from("portfolio_settings")
      .select("trader_photo_url, trader_name, trader_level")
      .single()
      .then(({ data }) => {
        setPhotoUrl(data?.trader_photo_url ?? null);
        setName(data?.trader_name ?? "");
        setLevel(data?.trader_level ?? "intermediate");
      });
  }, []);

  async function save() {
    setSaving(true);
    const formData = new FormData();
    if (file) formData.append("photo", file);
    formData.append("name", name);
    formData.append("level", level);

    const res = await fetch("/api/settings/trader", { method: "POST", body: formData });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      setPhotoUrl(data.trader_photo_url ?? photoUrl);
      setFile(null);
    } else {
      alert((await res.json()).error || "Failed to save");
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <h2 className="mb-3 text-lg font-medium">Trader</h2>
      <div className="flex items-center gap-4">
        {photoUrl && <img src={photoUrl} alt="Trader" className="h-16 w-16 rounded-full object-cover" />}
        <div className="flex-1 space-y-3">
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Namn</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trader's name"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Foto</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-neutral-300"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-neutral-400">Erfarenhetsnivå</label>
            <div className="flex gap-1.5">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLevel(l)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                    level === l
                      ? "bg-neutral-100 text-neutral-900"
                      : "border border-neutral-700 text-neutral-400 hover:text-neutral-100"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {saving ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>
    </section>
  );
}

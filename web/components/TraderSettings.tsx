"use client";

import { useEffect, useMemo, useState } from "react";
import Flag from "@/components/Flag";
import { countryOptions } from "@/lib/countries";
import { fetchTraderRow } from "@/lib/traderSettings";
import { usePortfolio } from "@/lib/portfolioClient";
import { MAX_VISIBLE_LENGTH, RAW_MAX_LENGTH, visibleLength } from "@/lib/traderStyle";

const LEVELS = ["noob", "intermediate", "pro"] as const;

export default function TraderSettings() {
  const { id: portfolioId, authFetch } = usePortfolio();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState<string>("intermediate");
  const [style, setStyle] = useState("");
  const [country, setCountry] = useState("");
  const countries = useMemo(() => countryOptions("sv"), []);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await fetchTraderRow(portfolioId);
      setPhotoUrl(data?.trader_photo_url ?? null);
      setName(data?.trader_name ?? "");
      setLevel(data?.trader_level ?? "intermediate");
      setStyle(data?.trader_style ?? "");
      setCountry(data?.trader_country ?? "");
    })();
  }, [portfolioId]);

  const styleVisible = visibleLength(style);
  const styleTooLong = styleVisible > MAX_VISIBLE_LENGTH;

  async function save() {
    setSaving(true);
    const formData = new FormData();
    if (file) formData.append("photo", file);
    formData.append("portfolio_id", String(portfolioId));
    formData.append("name", name);
    formData.append("level", level);
    formData.append("style", style);
    formData.append("country", country);

    const res = await authFetch("/api/settings/trader", { method: "POST", body: formData });
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
            <label className="mb-1 block text-sm text-neutral-400">Land</label>
            <div className="flex items-center gap-2">
              {country && <Flag code={country} className="h-5 w-5 shrink-0 ring-1 ring-white/10" />}
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
              >
                <option value="">Inget land</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
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
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="block text-sm text-neutral-400">Tradingstil</label>
              <span
                className={`text-xs ${
                  styleTooLong ? "text-red-400" : styleVisible >= MAX_VISIBLE_LENGTH ? "text-amber-400" : "text-neutral-600"
                }`}
              >
                {styleVisible}/{MAX_VISIBLE_LENGTH}
              </span>
            </div>
            <textarea
              value={style}
              onChange={(e) => setStyle(e.target.value.slice(0, RAW_MAX_LENGTH))}
              rows={3}
              placeholder="T.ex. Swing trading i teknikaktier, 2–10 dagar. Se [min strategi](https://example.com)"
              className="w-full resize-none rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm outline-none focus:border-neutral-500"
            />
            <p className="mt-1 text-xs text-neutral-600">
              Länkar: skriv en vanlig adress (https://…) eller <code className="text-neutral-400">[text](https://…)</code>. I
              andra fallet räknas bara texten mellan hakparenteserna mot gränsen.
            </p>
          </div>
          <button
            onClick={save}
            disabled={saving || styleTooLong}
            className="rounded-lg bg-neutral-100 px-4 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
          >
            {saving ? "Sparar…" : "Spara"}
          </button>
        </div>
      </div>
    </section>
  );
}

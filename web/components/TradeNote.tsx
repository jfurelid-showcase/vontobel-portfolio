import { vontobelUrl } from "@/lib/vontobelUrl";

// Raden "Produkt i motsatt riktning: NAMN (hävstång …)" i kommentaren visas med
// produktnamnet som länk till Vontobel, precis som positionen själv.
const OPP_LINE = /^(.*?motsatt riktning:\s*)([^\n\r(]+?)(\s*\(.*)?$/i;

export default function TradeNote({
  note,
  podcastEpisode,
  oppositeIsin,
  oppositeName,
}: {
  note?: string | null;
  podcastEpisode?: string | null;
  oppositeIsin?: string | null;
  oppositeName?: string | null;
}) {
  if (!note && !podcastEpisode) return null;

  const renderNote = (text: string) =>
    text.split(/(\r?\n)/).map((part, i) => {
      const m = part.match(OPP_LINE);
      if (!m) return <span key={i}>{part}</span>;
      const name = m[2].trim();
      const isin = oppositeName && oppositeName.trim().toUpperCase() === name.toUpperCase() ? oppositeIsin : null;
      return (
        <span key={i}>
          {m[1]}
          <a
            href={vontobelUrl(name, isin)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-amber-300 underline decoration-amber-300/50 underline-offset-2 hover:decoration-amber-300"
          >
            {name} ↗
          </a>
          {m[3] ?? ""}
        </span>
      );
    });

  return (
    <div className="mt-3 rounded-lg border-l-2 border-amber-500/70 bg-amber-500/[0.07] py-2 pl-3 pr-3">
      {note && <p className="whitespace-pre-wrap text-sm text-neutral-200">{renderNote(note)}</p>}
      {podcastEpisode && (
        <p className={`text-xs text-amber-500/80 ${note ? "mt-1" : ""}`}>🎙️ {podcastEpisode}</p>
      )}
    </div>
  );
}

export default function TradeNote({ note, podcastEpisode }: { note?: string | null; podcastEpisode?: string | null }) {
  if (!note && !podcastEpisode) return null;

  return (
    <div className="mt-3 rounded-lg border-l-2 border-amber-500/70 bg-amber-500/[0.07] py-2 pl-3 pr-3">
      {note && <p className="whitespace-pre-wrap text-sm text-neutral-200">{note}</p>}
      {podcastEpisode && (
        <p className={`text-xs text-amber-500/80 ${note ? "mt-1" : ""}`}>🎙️ {podcastEpisode}</p>
      )}
    </div>
  );
}

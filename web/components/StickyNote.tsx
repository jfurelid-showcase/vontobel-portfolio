export default function StickyNote({ note, podcastEpisode }: { note?: string | null; podcastEpisode?: string | null }) {
  if (!note && !podcastEpisode) return null;

  return (
    <div className="relative mt-3 inline-block max-w-xs rotate-[-1.5deg]">
      {/* tape strip */}
      <div className="absolute -top-2 left-1/2 h-4 w-14 -translate-x-1/2 rotate-[-3deg] bg-neutral-100/25 shadow-sm" />

      <div
        className="relative rounded-[2px] bg-gradient-to-br from-amber-200 to-amber-300 p-3.5 pb-4 text-[13px] leading-snug text-neutral-800 shadow-[2px_3px_8px_rgba(0,0,0,0.35)]"
        style={{
          clipPath: "polygon(0 0, 100% 0, 100% 100%, 12px 100%, 0 calc(100% - 12px))",
        }}
      >
        {note && <p className="whitespace-pre-wrap font-medium">{note}</p>}
        {podcastEpisode && (
          <p className={`text-xs text-amber-900/70 ${note ? "mt-1.5" : ""}`}>🎙️ {podcastEpisode}</p>
        )}
      </div>
    </div>
  );
}

// One place that knows how links and embed codes are built, used by the Share
// button and by the admin's profile manager. The owner's portfolio ("main")
// has no ?p= in its links, so the links you've already shared keep working.

export type EmbedTab = "dashboard" | "trades";

export const EMBED_TABS: { key: EmbedTab; label: string; height: number }[] = [
  { key: "dashboard", label: "Dashboard", height: 900 },
  { key: "trades", label: "Trades", height: 800 },
];

function pParam(slug: string): string {
  return slug && slug !== "main" ? `p=${encodeURIComponent(slug)}&` : "";
}

// Embeddable view (no header, no admin), e.g. for an <iframe>.
export function embedUrl(origin: string, slug: string, tab: EmbedTab): string {
  return `${origin}/?${pParam(slug)}tab=${tab}&embed=1`;
}

export function embedCode(origin: string, slug: string, tab: EmbedTab): string {
  const height = EMBED_TABS.find((t) => t.key === tab)!.height;
  return `<iframe
  src="${embedUrl(origin, slug, tab)}"
  width="100%"
  height="${height}"
  style="border: none;"
  loading="lazy"
></iframe>`;
}

// The normal page for a portfolio, to share with someone as a link.
export function viewUrl(origin: string, slug: string): string {
  return slug && slug !== "main" ? `${origin}/?p=${encodeURIComponent(slug)}` : `${origin}/`;
}

// A guest's private link: opening it lets them manage that one portfolio.
export function privateUrl(origin: string, slug: string, token: string): string {
  return `${origin}/?p=${encodeURIComponent(slug)}&k=${encodeURIComponent(token)}&tab=admin`;
}

// Every embed code for every portfolio, as one labelled block of text.
export function allEmbedCodes(origin: string, portfolios: { slug: string; name: string }[]): string {
  return portfolios
    .map((p) =>
      [`<!-- ${p.name} -->`, ...EMBED_TABS.map((t) => `<!-- ${t.label} -->\n${embedCode(origin, p.slug, t.key)}`)].join("\n")
    )
    .join("\n\n");
}

// Shared by the Admin form, the Dashboard badge and the API route.
//
// The trading-style text may contain links, written either as a plain URL
// (https://example.com) or as [visible label](https://example.com). Only
// http(s) links are recognised, so nothing like javascript: can ever become
// a link. The 160-character cap counts what the reader SEES (a markdown
// link counts as its label, not its URL), so a long URL doesn't eat the
// budget; RAW_MAX is just a hard safety ceiling on what's stored.

export const MAX_VISIBLE_LENGTH = 160;
export const RAW_MAX_LENGTH = 500;

export type StyleSegment = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const TOKEN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/g;
const TRAILING_PUNCT = /[.,;:!?)]+$/;

export function parseStyle(raw: string): StyleSegment[] {
  const out: StyleSegment[] = [];
  let last = 0;
  const push = (text: string) => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev && prev.type === "text") prev.text += text;
    else out.push({ type: "text", text });
  };

  for (const m of raw.matchAll(TOKEN)) {
    const start = m.index ?? 0;
    push(raw.slice(last, start));
    if (m[1] !== undefined) {
      out.push({ type: "link", text: m[1], href: m[2] });
      last = start + m[0].length;
    } else {
      // Bare URL: keep sentence punctuation that follows it out of the link.
      let url = m[3];
      const trail = url.match(TRAILING_PUNCT)?.[0] ?? "";
      if (trail) url = url.slice(0, -trail.length);
      if (url.length > "https://".length) {
        out.push({ type: "link", text: url, href: url });
        push(trail);
      } else {
        push(m[3]);
      }
      last = start + m[0].length;
    }
  }
  push(raw.slice(last));
  return out;
}

export function visibleLength(raw: string): number {
  return parseStyle(raw).reduce((n, seg) => n + seg.text.length, 0);
}

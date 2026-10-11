// Helpers for the contract search (kept out of the route file, which may only
// export route handlers).

// Characters with a special meaning in a PostgREST filter list or an ILIKE
// pattern. They are removed from what the user types: they would otherwise
// break the search (a comma ends the filter) or act as wildcards.
const SPECIAL = /[,()"\\*%_]/g;

// "MFL  AMZN vt927" -> ["MFL", "AMZN", "vt927"]
export function searchTokens(q: string): string[] {
  return q
    .split(/\s+/)
    .map((t) => t.replace(SPECIAL, "").trim())
    .filter((t) => t.length > 0);
}

export function cleanDirection(d: string | null | undefined): string | null {
  const v = (d ?? "").replace(SPECIAL, "").trim();
  return v || null;
}

export function parseOffset(v: string | null | undefined): number {
  const n = Number.parseInt(v ?? "0", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000) : 0;
}

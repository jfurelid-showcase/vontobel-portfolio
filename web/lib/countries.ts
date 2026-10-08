// The trader's country is limited to the Nordic countries. Codes are ISO
// 3166-1 alpha-2. Names come from the browser's own localisation data
// (Intl.DisplayNames), so there is no name table to maintain; flags are
// drawn as images/SVG (see components/Flag.tsx) because Windows browsers don't
// render flag emoji.
//
// To allow more countries later, just add their codes here — the Admin
// list, the server-side validation and the flag all follow this one list.

export const COUNTRY_CODES = ["DK", "FI", "IS", "NO", "SE"] as const;

const CODE_SET = new Set<string>(COUNTRY_CODES);

export function isCountryCode(code: string | null | undefined): code is string {
  return !!code && CODE_SET.has(code);
}

export function countryName(code: string, locale = "sv"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function countryOptions(locale = "sv"): { code: string; name: string }[] {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale)
  );
}

// Round "circle-flags" artwork (https://github.com/HatScripts/circle-flags), MIT
// licensed. Only used for countries that aren't built in to components/Flag.tsx.
export function flagUrl(code: string): string {
  return `https://hatscripts.github.io/circle-flags/flags/${code.toLowerCase()}.svg`;
}

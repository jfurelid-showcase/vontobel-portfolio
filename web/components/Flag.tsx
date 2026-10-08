"use client";

import { useState } from "react";
import { countryName, flagUrl } from "@/lib/countries";

// Round flags in the "circle-flags" style: the whole flag is drawn inside the
// circle (nothing is cropped off), in flat colours.
//
// The Nordic countries are built in as inline SVG, so they show up instantly,
// need no download and can't break. Any other country that is ever added to
// lib/countries.ts falls back to the same flag set loaded from the project's
// own address (see flagUrl there), so the style stays the same.
//
// Artwork: "circle-flags" by HatScripts (https://github.com/HatScripts/circle-flags),
// MIT licensed, Copyright (c) HatScripts. Each flag is a list of [fill, path]
// shapes on a 512x512 canvas; the circle comes from rounding the wrapper.
const FLAGS: Record<string, [string, string][]> = {
  SE: [
    ["#0052b4", "M0 0h133.6l35.3 16.7L200.3 0H512v222.6l-22.6 31.7 22.6 35.1V512H200.3l-32-19.8-34.7 19.8H0V289.4l22.1-33.3L0 222.6z"],
    ["#ffda44", "M133.6 0v222.6H0v66.8h133.6V512h66.7V289.4H512v-66.8H200.3V0z"],
  ],
  DK: [
    ["#d80027", "M0 0h133.6l32.7 20.3 34-20.3H512v222.6L491.4 256l20.6 33.4V512H200.3l-31.7-20.4-35 20.4H0V289.4l29.4-33L0 222.7z"],
    ["#eee", "M133.6 0v222.6H0v66.8h133.6V512h66.7V289.4H512v-66.8H200.3V0h-66.7z"],
  ],
  FI: [
    ["#eee", "M0 0h133.6l35.3 16.7L200.3 0H512v222.6l-22.6 31.7 22.6 35.1V512H200.3l-32-19.8-34.7 19.8H0V289.4l22.1-33.3L0 222.6z"],
    ["#0052b4", "M133.6 0v222.6H0v66.8h133.6V512h66.7V289.4H512v-66.8H200.3V0h-66.7z"],
  ],
  NO: [
    ["#d80027", "M0 0h100.2l66.1 53.5L233.7 0H512v189.3L466.3 257l45.7 65.8V512H233.7l-68-50.7-65.5 50.7H0V322.8l51.4-68.5-51.4-65z"],
    ["#eee", "M100.2 0v189.3H0v33.4l24.6 33L0 289.5v33.4h100.2V512h33.4l30.6-26.3 36.1 26.3h33.4V322.8H512v-33.4l-24.6-33.7 24.6-33v-33.4H233.7V0h-33.4l-33.8 25.3L133.6 0z"],
    ["#0052b4", "M133.6 0v222.7H0v66.7h133.6V512h66.7V289.4H512v-66.7H200.3V0z"],
  ],
  IS: [
    ["#0052b4", "M0 0h100.2l66.1 53.5L233.7 0H512v189.3L466.3 257l45.7 65.8V512H233.7l-68-50.7-65.5 50.7H0V322.8l51.4-68.5-51.4-65z"],
    ["#eee", "M100.2 0v189.3H0v33.4l24.6 33L0 289.5v33.4h100.2V512h33.4l30.6-26.3 36.1 26.3h33.4V322.8H512v-33.4l-24.6-33.7 24.6-33v-33.4H233.7V0h-33.4l-33.8 25.3L133.6 0z"],
    ["#d80027", "M133.6 0v222.7H0v66.7h133.6V512h66.7V289.4H512v-66.7H200.3V0z"],
  ]
};

export default function Flag({ code, className = "" }: { code: string; className?: string }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const name = countryName(code);
  const shapes = FLAGS[code];

  if (shapes) {
    return (
      <span title={name} role="img" aria-label={name} className={`inline-block overflow-hidden rounded-full ${className}`}>
        <svg viewBox="0 0 512 512" className="block h-full w-full" aria-hidden="true">
          {shapes.map(([fill, d], i) => (
            <path key={i} fill={fill} d={d} />
          ))}
        </svg>
      </span>
    );
  }

  // Not built in: use the same flag set from the web; if that can't load, show the code.
  if (failedFor === code) {
    return (
      <span title={name} className={`inline-flex items-center justify-center rounded-full bg-neutral-700 text-[7px] font-semibold text-neutral-200 ${className}`}>
        {code}
      </span>
    );
  }
  return <img src={flagUrl(code)} alt={name} title={name} onError={() => setFailedFor(code)} className={`rounded-full ${className}`} />;
}

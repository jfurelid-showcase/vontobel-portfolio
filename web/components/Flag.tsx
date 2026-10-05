"use client";

import { useState } from "react";
import { countryName, flagUrl } from "@/lib/countries";

// Flags are images rather than emoji: Windows browsers don't render flag
// emoji (they show two letters instead). They are drawn as a circle; the
// callers pass the size (e.g. "h-4 w-4"). The crop is shifted left so the
// cross on the Nordic flags stays centred in the circle instead of being
// pushed to one side. If the image can't load, fall back to the two-letter
// code so something sensible is still shown.
const ROUND = "rounded-full object-cover object-[38%_50%]";
export default function Flag({ code, className = "" }: { code: string; className?: string }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const name = countryName(code);

  if (failedFor === code) {
    return (
      <span title={name} className={`inline-flex items-center justify-center rounded-full bg-neutral-700 text-[7px] font-semibold text-neutral-200 ${className}`}>
        {code}
      </span>
    );
  }
  return <img src={flagUrl(code)} alt={name} title={name} onError={() => setFailedFor(code)} className={`${ROUND} ${className}`} />;
}

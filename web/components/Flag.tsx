"use client";

import { useState } from "react";
import { countryName, flagUrl } from "@/lib/countries";

// Flags are images rather than emoji: Windows browsers don't render flag
// emoji (they show two letters instead). If the image can't load, fall back
// to the two-letter code so something sensible is still shown.
export default function Flag({ code, className = "" }: { code: string; className?: string }) {
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const name = countryName(code);

  if (failedFor === code) {
    return (
      <span title={name} className={`inline-flex items-center justify-center bg-neutral-700 text-[9px] font-semibold text-neutral-200 ${className}`}>
        {code}
      </span>
    );
  }
  return <img src={flagUrl(code)} alt={name} title={name} onError={() => setFailedFor(code)} className={className} />;
}

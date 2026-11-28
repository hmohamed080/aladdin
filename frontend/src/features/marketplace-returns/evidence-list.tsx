"use client";

import { useState } from "react";
import { Button } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";
import { evidenceUrlAction } from "@/server/actions/marketplace-returns";
import { RETURN_COPY, returnErrorText } from "./copy";

/** The buyer's photos of a return. Each opens through a short-lived address the server grants to whoever may read it now. */
export function EvidenceList({ evidence, locale }: { evidence: { id: string; object_key: string }[]; locale: "ar" | "en" }) {
  const [error, setError] = useState<string | null>(null);
  if (evidence.length === 0) return null;
  const open = async (key: string) => {
    setError(null);
    const r = await evidenceUrlAction(key);
    if (r.ok) window.open(r.url, "_blank", "noopener");
    else setError(returnErrorText(locale, r.code));
  };
  return (
    <section aria-label={RETURN_COPY.photos[locale]} className="grid gap-sm">
      <h3 className="text-label font-semibold">{RETURN_COPY.photos[locale]}</h3>
      <div className="flex flex-wrap gap-sm">
        {evidence.map((e, i) => (
          <Button key={e.id} variant="outline" size="sm" onClick={() => void open(e.object_key)}>
            {RETURN_COPY.photo[locale]} {i + 1}
          </Button>
        ))}
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
    </section>
  );
}

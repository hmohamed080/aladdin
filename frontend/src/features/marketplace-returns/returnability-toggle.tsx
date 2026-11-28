"use client";

import { useState, useTransition } from "react";
import { Checkbox } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { setNonReturnableAction } from "@/server/actions/marketplace-returns";
import { RETURNABILITY_COPY, returnErrorText } from "./copy";

/**
 * The showroom's "made to order, not returnable" flag of one product. It saves as soon as it changes (its own RPC, apart from
 * the product form). Buyers read it on the product page and at checkout; orders keep the value they were placed with.
 */
export function ReturnabilityToggle({ organizationId, productId, initial, locale }: {
  organizationId: string;
  productId: string;
  initial: boolean;
  locale: "ar" | "en";
}) {
  const c = RETURNABILITY_COPY[locale];
  const [value, setValue] = useState(initial);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const change = (next: boolean) => {
    if (pending) return;
    setValue(next);
    start(async () => {
      setResult(null);
      const r = await setNonReturnableAction(organizationId, productId, next);
      if (!r.ok) {
        setValue(!next);
        setResult({ ok: false, text: returnErrorText(locale, r.code) });
        return;
      }
      setResult({ ok: true, text: c.saved });
    });
  };

  return (
    <section aria-label={c.title} className="grid gap-sm rounded-md border bg-surface p-md">
      <h2 className="text-body font-semibold text-fg">{c.title}</h2>
      <Checkbox id="product-non-returnable" name="non-returnable" checked={value} onChange={change}>
        {c.label}
      </Checkbox>
      <p className="text-caption text-fg-secondary">{c.hint}</p>
      {result ? (result.ok ? <InlineSuccess>{result.text}</InlineSuccess> : <InlineError>{result.text}</InlineError>) : null}
    </section>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { useI18n } from "@/lib/i18n/context";
import { InlineError } from "@/components/ui/primitives";
import { SaveToggleButton } from "@/features/commerce/save-product-button";
import { changeEngineerCollection } from "@/server/actions/engineer-collections";

/**
 * Save / unsave a catalog product to the engineer's PERSONAL collection.
 *
 * The same bookmark control a business sees (`SaveToggleButton`), pointed at the
 * engineer's own list instead of an organization's. An engineer has no
 * organization, so the showroom's `SaveProductButton` (which needs one) cannot be
 * used; what the button looks like and how it reports pending/errors is shared,
 * what pressing it does is not.
 */
export function EngineerSaveProductButton({
  productId,
  saved,
  onChange,
}: {
  productId: string;
  saved: boolean;
  /** Called once the change really happened, so the list can react. */
  onChange?: (saved: boolean) => void;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(saved);
  useEffect(() => setCurrent(saved), [saved]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () =>
    start(async () => {
      const next = !current;
      try {
        const result = await changeEngineerCollection({
          action: next ? "save" : "unsave",
          entityType: "product",
          entityId: productId,
        });
        if (!result.ok) {
          setError(result.code ?? "states.genericRetry");
          return;
        }
        setError(null);
        setCurrent(next);
        onChange?.(next);
      } catch {
        setError("states.genericRetry");
      }
    });

  return (
    <div className="flex flex-col items-start gap-1">
      <SaveToggleButton saved={current} compact pending={pending} onClick={toggle} />
      {error ? <InlineError>{t(error)}</InlineError> : null}
    </div>
  );
}

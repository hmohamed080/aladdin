"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { toggleProductPublishAction, type FormState } from "@/server/actions/commerce-forms";
import { SubmitButton } from "@/components/ui/controls";
import { InlineError } from "@/components/ui/primitives";

const initial: FormState = { ok: false };

/**
 * Publish / unpublish a product. A single button that flips the state through the
 * trusted set_product_published RPC (requires catalog.publish). Carries the
 * optimistic version; an error is surfaced inline (never swallowed).
 */
export function ProductPublishToggle({
  productId,
  version,
  published,
}: {
  productId: string;
  version: number;
  published: boolean;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(toggleProductPublishAction, initial);
  const next = !published;
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="publish" value={String(next)} />
      <SubmitButton variant={next ? "accent" : "outline"} size="sm" pendingLabel={t("common.saving")}>
        {next ? t("commerce.actions.publish") : t("commerce.actions.unpublish")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

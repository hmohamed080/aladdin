"use client";

import { useState } from "react";
import { cn } from "@/lib/ui/cn";
import { useI18n } from "@/lib/i18n/context";
import { CheckIcon } from "@/components/ui/icons";
import { PRODUCT_AUDIENCE_GROUPS, type ProductAudienceCode } from "./product-audiences";

/**
 * "Who is this product shown to?" - the same checkbox-chip pattern as the Create Offer audience
 * picker. The chosen codes travel as repeated `audience` form fields; the server action forwards
 * them to `product_audiences_set` and the database stays the authority (unknown codes, an empty
 * set on a published product and non-owners are all refused there).
 */
export function ProductAudiencePicker({
  initial,
  error,
  disabled,
}: {
  initial: readonly ProductAudienceCode[];
  error?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<readonly ProductAudienceCode[]>(initial);
  const toggle = (code: ProductAudienceCode) =>
    setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  return (
    <fieldset className="flex min-w-0 flex-col gap-sm" data-testid="product-audience" aria-invalid={error ? true : undefined}>
      <legend className="text-label font-medium text-fg">{t("showroomProducts.audience.title")}</legend>
      <p className="text-label text-fg-muted">{t("showroomProducts.audience.hint")}</p>
      {selected.map((code) => (
        <input key={code} type="hidden" name="audience" value={code} />
      ))}
      <ul className="grid grid-cols-2 gap-sm tablet:grid-cols-4" role="group" aria-label={t("showroomProducts.audience.title")}>
        {PRODUCT_AUDIENCE_GROUPS.map(({ id, code }) => {
          const on = selected.includes(code);
          return (
            <li key={id} className="min-w-0">
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                onClick={() => toggle(code)}
                data-testid={`product-audience-${id}`}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-sm border px-3 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  on ? "border-accent bg-accent-solid/10 text-accent" : "border-strong bg-surface text-fg hover:bg-surface-2",
                )}
              >
                <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-sm border", on ? "border-accent-edge bg-accent-solid text-on-accent" : "border-strong bg-surface")}>
                  {on ? <CheckIcon size={12} /> : null}
                </span>
                <span className="min-w-0 truncate">{t(`showroomOffers.audienceGroup.${id}`)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? <p role="alert" className="text-label text-danger" data-testid="product-audience-error">{error}</p> : null}
      <p className="text-label text-fg-muted">{t("showroomProducts.audience.note")}</p>
    </fieldset>
  );
}

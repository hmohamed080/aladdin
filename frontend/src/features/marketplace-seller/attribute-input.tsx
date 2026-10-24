"use client";

import { useI18n } from "@/lib/i18n/context";
import { Input, LabeledField, Select } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";
import type { AttrValue, AttributeField } from "./form-model";

/**
 * One dynamic specification field, drawn from its DATABASE definition: an option
 * list, a multi-choice, a number / measurement with its display unit, a yes/no,
 * or free text. Nothing here knows which product type it belongs to.
 */
export function AttributeInput({
  field,
  value,
  onChange,
  idPrefix,
  disabled,
}: {
  field: AttributeField;
  value: AttrValue | undefined;
  onChange: (v: AttrValue) => void;
  idPrefix: string;
  disabled?: boolean;
}) {
  const { t, locale } = useI18n();
  const ar = locale === "ar";
  const id = `${idPrefix}-${field.key}`;
  const label = ar ? field.nameAr : field.nameEn;
  const unit = ar ? field.unitAr : field.unitEn;
  const hint = field.required ? t("marketplaceSeller.form.required") : undefined;

  if (field.dataType === "option") {
    return (
      <LabeledField label={label} htmlFor={id} hint={hint}>
        <Select id={id} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t("marketplaceSeller.form.notSet")}</option>
          {field.options.map((o) => (
            <option key={o.key} value={o.key}>
              {ar ? o.nameAr : o.nameEn}
            </option>
          ))}
        </Select>
      </LabeledField>
    );
  }

  if (field.dataType === "multi_option") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col gap-1.5" disabled={disabled}>
        <legend className="text-label font-medium text-fg-secondary">{label}</legend>
        <div className="flex flex-wrap gap-xs">
          {field.options.map((o) => {
            const on = selected.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? selected.filter((k) => k !== o.key) : [...selected, o.key])}
                className={cn(
                  "rounded-pill border px-3 py-1 text-label transition-colors",
                  on ? "border-accent bg-accent-solid/15 text-accent" : "text-fg-secondary hover:bg-surface-2",
                )}
              >
                {ar ? o.nameAr : o.nameEn}
              </button>
            );
          })}
        </div>
        {hint ? <p className="text-label text-fg-muted">{hint}</p> : null}
      </fieldset>
    );
  }

  if (field.dataType === "boolean") {
    const v = value === true ? "true" : value === false ? "false" : "";
    return (
      <LabeledField label={label} htmlFor={id} hint={hint}>
        <Select id={id} value={v} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}>
          <option value="">{t("marketplaceSeller.form.notSet")}</option>
          <option value="true">{t("marketplaceSeller.form.yes")}</option>
          <option value="false">{t("marketplaceSeller.form.no")}</option>
        </Select>
      </LabeledField>
    );
  }

  const numeric = field.dataType === "number" || field.dataType === "measurement";
  return (
    <LabeledField label={unit ? `${label} (${unit})` : label} htmlFor={id} hint={hint}>
      <Input
        id={id}
        value={typeof value === "string" ? value : ""}
        inputMode={numeric ? "decimal" : undefined}
        dir={numeric ? "ltr" : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </LabeledField>
  );
}

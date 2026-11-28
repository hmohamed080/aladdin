"use client";

import { useEffect, useId, useState } from "react";
import { Button, Textarea } from "@/components/ui/controls";
import { useI18n } from "@/lib/i18n/context";
import { reasonPresetsAction } from "@/server/actions/marketplace-order-pages";
import { customReasonPayload } from "./order-model";
import type { ReasonAction, ReasonPreset } from "./order-types";
import { ordersCopy } from "./orders-copy";

export type ReasonValue = { preset_id: string } | { message_ar: string; message_en: string };

/**
 * Pick a preset reason (admin-managed, the one preset system) or write a custom one in 3 to 300 characters; one typed
 * language is copied to the other. Used for the seller's cancellation and for «لم تصلني الفلوس».
 */
export function ReasonPanel({
  action,
  title,
  intro,
  confirmLabel,
  keepLabel,
  danger = false,
  withInternalNote = false,
  busy,
  onSubmit,
  onCancel,
}: {
  action: Extract<ReasonAction, "order_cancel_seller" | "payment_issue" | "return_reject">;
  title: string;
  intro: string;
  confirmLabel: string;
  keepLabel: string;
  danger?: boolean;
  withInternalNote?: boolean;
  busy: boolean;
  onSubmit: (reason: ReasonValue, internalNote: string) => void;
  onCancel: () => void;
}) {
  const { locale } = useI18n();
  const t = ordersCopy[locale].seller;
  const group = useId();
  const [presets, setPresets] = useState<ReasonPreset[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<string>("other");
  const [ar, setAr] = useState("");
  const [en, setEn] = useState("");
  const [internal, setInternal] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    reasonPresetsAction(action).then((r) => {
      if (!live) return;
      if (r.ok) {
        setPresets(r.presets);
        setChoice(r.presets[0]?.id ?? "other");
      } else {
        setPresets([]);
        setFailed(true);
      }
    });
    return () => {
      live = false;
    };
  }, [action]);

  const submit = () => {
    if (choice !== "other") return onSubmit({ preset_id: choice }, internal);
    const custom = customReasonPayload(ar, en);
    if (!custom) return setError(true);
    setError(false);
    onSubmit(custom, internal);
  };

  return (
    <section aria-labelledby={`${group}-t`} className={`grid gap-sm rounded-sm border p-md ${danger ? "border-danger/40" : "border-warning/50"}`}>
      <h3 id={`${group}-t`} className="text-body font-semibold text-fg">{title}</h3>
      <p className="text-label text-fg-secondary">{intro}</p>
      {presets === null ? <p className="text-label text-fg-muted">{t.loadingPresets}</p> : null}
      {failed ? <p className="text-label text-warning">{t.presetsFailed}</p> : null}
      {presets && presets.length > 0 ? (
        <fieldset className="grid gap-xs">
          <legend className="text-label text-fg-secondary">{t.presetLabel}</legend>
          {presets.map((p) => (
            <label key={p.id} className="flex items-center gap-sm text-body">
              <input type="radio" name={group} value={p.id} checked={choice === p.id} onChange={() => setChoice(p.id)} />
              {locale === "ar" ? p.label_ar : p.label_en}
            </label>
          ))}
          <label className="flex items-center gap-sm text-body">
            <input type="radio" name={group} value="other" checked={choice === "other"} onChange={() => setChoice("other")} />
            {t.presetOther}
          </label>
        </fieldset>
      ) : null}
      {choice === "other" && presets !== null ? (
        <div className="grid gap-sm">
          <label className="grid gap-1 text-label text-fg-secondary">
            {t.customArabic}
            <Textarea dir="rtl" rows={2} maxLength={300} value={ar} onChange={(e) => setAr(e.target.value)} />
          </label>
          <label className="grid gap-1 text-label text-fg-secondary">
            {t.customEnglish}
            <Textarea dir="ltr" rows={2} maxLength={300} value={en} onChange={(e) => setEn(e.target.value)} />
          </label>
          <p className="text-caption text-fg-muted">{t.customHint}</p>
        </div>
      ) : null}
      {withInternalNote ? (
        <label className="grid gap-1 text-label text-fg-secondary">
          {t.internalNoteLabel}
          <Textarea rows={2} maxLength={300} value={internal} onChange={(e) => setInternal(e.target.value)} />
        </label>
      ) : null}
      {error ? <p role="alert" className="text-label text-danger">{t.reasonRequired}</p> : null}
      <div className="flex flex-wrap gap-sm">
        <Button variant={danger ? "danger" : "primary"} onClick={submit} disabled={busy || presets === null}>{confirmLabel}</Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>{keepLabel}</Button>
      </div>
    </section>
  );
}

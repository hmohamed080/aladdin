"use client";

import { useState, useTransition } from "react";
import { Button, Input, LabeledField } from "@/components/ui/controls";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { saveReturnSettingsAction } from "@/server/actions/marketplace-returns";
import { RETURN_POLICY_COPY, returnErrorText } from "./copy";
import type { ReturnSettings } from "./contract";

const MAX_DAYS = 365;

/** The showroom's return windows in days. It may offer more than the platform minimum, never less (the database enforces it). */
export function ReturnPolicyForm({ organizationId, initial, locale }: { organizationId: string; initial: ReturnSettings; locale: "ar" | "en" }) {
  const c = RETURN_POLICY_COPY[locale];
  const [general, setGeneral] = useState(String(initial.general_days));
  const [defect, setDefect] = useState(String(initial.defect_days));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const within = (raw: string, min: number) => /^\d{1,3}$/.test(raw) && Number(raw) >= min && Number(raw) <= MAX_DAYS;
  const valid = within(general, initial.min_general_days) && within(defect, initial.min_defect_days);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    start(async () => {
      setResult(null);
      const r = await saveReturnSettingsAction(organizationId, Number(general), Number(defect));
      setResult(r.ok ? { ok: true, text: c.saved } : { ok: false, text: returnErrorText(locale, r.code) });
    });
  };

  return (
    <form onSubmit={save} noValidate className="grid max-w-md gap-md rounded-md border bg-surface p-md">
      <LabeledField label={c.general} htmlFor="return-general-days" hint={c.minimum(initial.min_general_days)}>
        <Input id="return-general-days" type="number" inputMode="numeric" min={initial.min_general_days} max={MAX_DAYS} value={general} onChange={(e) => setGeneral(e.target.value)} />
      </LabeledField>
      <LabeledField label={c.defect} htmlFor="return-defect-days" hint={c.minimum(initial.min_defect_days)}>
        <Input id="return-defect-days" type="number" inputMode="numeric" min={initial.min_defect_days} max={MAX_DAYS} value={defect} onChange={(e) => setDefect(e.target.value)} />
      </LabeledField>
      {result ? (result.ok ? <InlineSuccess>{result.text}</InlineSuccess> : <InlineError>{result.text}</InlineError>) : null}
      <div>
        <Button type="submit" disabled={!valid || pending}>{pending ? c.saving : c.save}</Button>
      </div>
    </form>
  );
}

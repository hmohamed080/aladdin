"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/context";
import { InlineError } from "@/components/ui/primitives";
import { PhoneField } from "@/components/ui/phone-field";
import { WizardShell, WizardProgress, FlowActions } from "@/features/onboarding/wizard";
import {
  BasicsLocationFields,
  BasicsSpecialtiesField,
  basicsLocationDone,
  type BasicsLocation,
  type SpecialtySource,
  useSpecialtyOptions,
} from "@/features/onboarding/basics-fields";
import { saveAccountBasics, type AccountBasicsState } from "@/server/actions/account-basics";
import type { MissingBasics } from "@/server/queries/account-basics";

const INITIAL: AccountBasicsState = { ok: false };
type Step = "phone" | "location" | "specialties";

/**
 * Onboarding steps for the basics (owner decision 2026-10-29): one question
 * per step, in the order a person answers fastest (how to reach you, where you
 * are, what you do), with the usual onboarding progress. Steps the account
 * already completed are left out entirely. One form spans the steps (hidden
 * steps stay mounted so their fields submit), and the last step saves; a
 * server error jumps back to the step it belongs to.
 */
export function AccountBasicsForm({ missing, source, next }: { missing: MissingBasics; source: SpecialtySource | null; next: string }) {
  const { t } = useI18n();
  const options = useSpecialtyOptions(source);
  const [state, dispatch, pending] = useActionState(saveAccountBasics, INITIAL);
  const steps: Step[] = (["phone", "location", "specialties"] as const).filter((s) => missing[s]);
  const [step, setStep] = useState(0);
  const [phoneOk, setPhoneOk] = useState(false);
  const [location, setLocation] = useState<BasicsLocation>({ governorate: "", city: "", cityCustom: "" });
  const [picked, setPicked] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [, startTransition] = useTransition();
  // Submitted without the form action prop, so React never resets the form:
  // after a refused save every answer (the governorate included) is still there.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => dispatch(data));
  };

  // A rejected save returns to the step the error belongs to.
  useEffect(() => {
    if (state.field) setStep(Math.max(steps.indexOf(state.field), 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to a new server answer only
  }, [state]);

  const current: Step = steps[step] ?? steps[0] ?? "phone";
  const last = step === steps.length - 1;
  const errorFor = (field: Step) => (state.field === field && state.code ? t(state.code) : undefined);
  const done = current === "phone" ? phoneOk : current === "location" ? basicsLocationDone(location) : picked.length > 0;

  const titles: Record<Step, string> = {
    phone: t("accountBasics.phoneLabel"),
    location: t("accountBasics.locationLabel"),
    specialties: t("accountBasics.specialtiesLabel"),
  };
  const hints: Record<Step, string> = {
    phone: t("accountBasics.phoneHint"),
    location: t("accountBasics.subtitle"),
    specialties: t("accountBasics.specialtiesHint"),
  };

  return (
    <WizardShell
      progress={<WizardProgress current={step} total={steps.length} label={t("accountBasics.title")} />}
      title={titles[current]}
      subtitle={hints[current]}
    >
      <form ref={formRef} onSubmit={submit} className="flex flex-col gap-lg" noValidate>
        <input type="hidden" name="next" value={next} />

        {missing.phone ? (
          <section hidden={current !== "phone"} className="flex flex-col gap-xs">
            <PhoneField
              id="phone"
              name="phone"
              countryName="phoneCountry"
              joined
              placeholder={t("accountBasics.phoneLabel")}
              onChange={(value) => setPhoneOk(Boolean(value))}
              error={errorFor("phone")}
            />
          </section>
        ) : null}

        {missing.location ? (
          <section hidden={current !== "location"}>
            <BasicsLocationFields value={location} onChange={setLocation} error={errorFor("location")} />
          </section>
        ) : null}

        {missing.specialties ? (
          <section hidden={current !== "specialties"}>
            <BasicsSpecialtiesField options={options} picked={picked} onChange={setPicked} error={errorFor("specialties")} />
          </section>
        ) : null}

        {state.code && !state.field ? <InlineError>{t(state.code)}</InlineError> : null}
        <FlowActions
          onBack={step > 0 ? () => setStep(step - 1) : undefined}
          onPrimary={() => (last ? formRef.current?.requestSubmit() : setStep(step + 1))}
          primaryLabel={t("accountBasics.submit")}
          primaryDisabled={!done}
          pending={pending}
        />
      </form>
    </WizardShell>
  );
}

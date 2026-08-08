"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { saveContactAction, type OnboardingActionState } from "@/server/actions/onboarding";
import { StepCard } from "@/features/onboarding/step-card";
import { Input, LabeledField, SubmitButton, Button } from "@/components/ui/controls";
import { Badge } from "@/components/ui/primitives";

const initial: OnboardingActionState = { ok: false };

/**
 * Step 2 — Contact Information. The verified email is read-only (never editable
 * here). The phone is an Egyptian mobile collected as UNVERIFIED — it is clearly
 * labelled "not verified yet" and no OTP is sent (Phone/WhatsApp OTP are out of
 * scope). Email/phone render `dir="ltr"` so the digits read correctly in RTL.
 */
export function ContactStep({ email, phone }: { email: string; phone: string | null }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(saveContactAction, initial);

  return (
    <StepCard step="contact" title={t("onboarding.contact.title")} subtitle={t("onboarding.contact.subtitle")}>
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <LabeledField label={t("onboarding.contact.emailLabel")} htmlFor="email">
          <div className="flex items-center gap-2">
            <Input id="email" name="email" type="email" value={email} readOnly dir="ltr" className="flex-1 bg-surface-2/40 text-fg-secondary" />
            <Badge tone="success">{t("onboarding.contact.emailVerified")}</Badge>
          </div>
        </LabeledField>

        <LabeledField
          label={t("onboarding.contact.phoneLabel")}
          htmlFor="phone"
          hint={t("onboarding.contact.phoneHint")}
          error={state.code === "onboarding.error.phone" ? t(state.code) : undefined}
        >
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            dir="ltr"
            defaultValue={phone ?? ""}
            placeholder={t("onboarding.contact.phonePlaceholder")}
            aria-invalid={state.code === "onboarding.error.phone" ? true : undefined}
          />
        </LabeledField>
        <p className="text-label text-fg-muted">{t("onboarding.contact.phoneUnverified")}</p>

        {state.code === "onboarding.error.saveFailed" ? (
          <p role="alert" className="text-label text-danger">{t(state.code)}</p>
        ) : null}

        <div className="flex items-center gap-sm">
          <Link href="/onboarding/profile">
            <Button type="button" variant="ghost">{t("onboarding.back")}</Button>
          </Link>
          <SubmitButton className="flex-1" pendingLabel={t("onboarding.saving")}>{t("onboarding.continue")}</SubmitButton>
        </div>
      </form>
    </StepCard>
  );
}

"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { saveContactAction, type OnboardingActionState } from "@/server/actions/onboarding";
import { EG_PHONE_PATTERN } from "@/lib/onboarding/validation";
import { WizardShell, WizardProgress } from "@/features/onboarding/wizard";
import { Input, LabeledField, SubmitButton, Button } from "@/components/ui/controls";
import { Badge, InlineError } from "@/components/ui/primitives";

const initial: OnboardingActionState = { ok: false };

/**
 * Step 2 — Contact Information. The verified email is read-only (never editable
 * here). The phone is an Egyptian mobile collected as UNVERIFIED — it is clearly
 * labelled "not verified yet" and no OTP is sent (Phone/WhatsApp OTP are out of
 * scope). Email/phone render `dir="ltr"` so the digits read correctly in RTL.
 *
 * The phone field also gets an on-blur client check against the exact same
 * `EG_PHONE_PATTERN` the server enforces (`onboarding.ts`'s `egPhoneSchema`) —
 * immediate feedback, not a second validation rule. The server response
 * remains authoritative and always overrides once a submit round-trips.
 */
export function ContactStep({ email, phone }: { email: string; phone: string | null }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(saveContactAction, initial);
  const [phoneValue, setPhoneValue] = useState(phone ?? "");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const progress = <WizardProgress current={1} total={3} label={t("onboarding.stepContact")} />;

  const localPhoneInvalid = phoneTouched && phoneValue.length > 0 && !EG_PHONE_PATTERN.test(phoneValue);
  const phoneError = state.code === "onboarding.error.phone" ? t(state.code) : localPhoneInvalid ? t("onboarding.error.phone") : undefined;

  return (
    <WizardShell progress={progress} title={t("onboarding.contact.title")} subtitle={t("onboarding.contact.subtitle")}>
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
          error={phoneError}
        >
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            dir="ltr"
            value={phoneValue}
            onChange={(e) => setPhoneValue(e.target.value)}
            onBlur={() => setPhoneTouched(true)}
            placeholder={t("onboarding.contact.phonePlaceholder")}
            aria-invalid={Boolean(phoneError) || undefined}
          />
        </LabeledField>
        <p className="text-label text-fg-muted">{t("onboarding.contact.phoneUnverified")}</p>

        {state.code === "onboarding.error.saveFailed" ? <InlineError>{t(state.code)}</InlineError> : null}

        <div className="flex items-center gap-sm">
          <Link href="/onboarding/profile">
            <Button type="button" variant="ghost">{t("onboarding.back")}</Button>
          </Link>
          <SubmitButton className="flex-1" pendingLabel={t("onboarding.saving")}>{t("onboarding.continue")}</SubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}

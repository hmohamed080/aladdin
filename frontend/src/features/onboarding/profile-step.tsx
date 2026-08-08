"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { saveProfileAction, type OnboardingActionState } from "@/server/actions/onboarding";
import { StepCard } from "@/features/onboarding/step-card";
import { Input, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { UsersIcon } from "@/components/ui/icons";

const initial: OnboardingActionState = { ok: false };

/**
 * Step 1 — Basic Profile: display name + preferred language. First/last name are
 * intentionally omitted (the profile model has no such fields). Avatar is a
 * placeholder only (no upload this sprint). Autosaves on Continue; a failed save
 * keeps the entered values (uncontrolled inputs with defaultValue).
 */
export function ProfileStep({ displayName, locale }: { displayName: string; locale: "en" | "ar" }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(saveProfileAction, initial);

  return (
    <StepCard step="profile" title={t("onboarding.profile.title")} subtitle={t("onboarding.profile.subtitle")}>
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <div className="flex items-center gap-3">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-pill bg-surface-2 text-fg-muted" aria-hidden="true">
            <UsersIcon size={24} />
          </span>
          <div className="flex flex-col">
            <span className="text-label font-medium text-fg-secondary">{t("onboarding.profile.avatarLabel")}</span>
            <span className="text-label text-fg-muted">{t("onboarding.profile.avatarHint")}</span>
          </div>
        </div>

        <LabeledField
          label={t("onboarding.profile.displayNameLabel")}
          htmlFor="displayName"
          error={state.code === "onboarding.error.displayName" ? t(state.code) : undefined}
        >
          <Input
            id="displayName"
            name="displayName"
            required
            maxLength={80}
            defaultValue={displayName}
            placeholder={t("onboarding.profile.displayNamePlaceholder")}
            aria-invalid={state.code === "onboarding.error.displayName" ? true : undefined}
          />
        </LabeledField>

        <LabeledField label={t("onboarding.profile.localeLabel")} htmlFor="locale">
          <Select id="locale" name="locale" defaultValue={locale}>
            <option value="ar">{t("onboarding.profile.localeAr")}</option>
            <option value="en">{t("onboarding.profile.localeEn")}</option>
          </Select>
        </LabeledField>

        {state.code === "onboarding.error.saveFailed" ? (
          <p role="alert" className="text-label text-danger">{t(state.code)}</p>
        ) : null}

        <SubmitButton className="w-full" pendingLabel={t("onboarding.saving")}>{t("onboarding.continue")}</SubmitButton>
        <p className="text-center text-label text-fg-muted">{t("onboarding.savedProgress")}</p>
      </form>
    </StepCard>
  );
}

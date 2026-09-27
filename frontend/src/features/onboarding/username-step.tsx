"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { chooseUsernameAction, type UsernameState } from "@/server/actions/registration";
import { isUsernameWellFormed } from "@/lib/identity/username";
import { Card } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { Brand } from "@/components/layout/brand";

const initial: UsernameState = { ok: false };

/**
 * Deliberately minimal — one field, no wizard chrome. See this route's page
 * doc comment (`app/onboarding/username/page.tsx`) for why this exists as
 * its own narrow screen rather than a step inside the legacy wizard.
 *
 * `titleKey` / `subtitleKey` let the password-registration recovery path say
 * WHY it is asking (the name chosen at sign-up is no longer available) instead
 * of looking as if the product forgot it. Defaults keep every other caller
 * unchanged.
 */
export function UsernameStep({
  titleKey = "registration.username.title",
  subtitleKey = "registration.username.subtitle",
}: { titleKey?: string; subtitleKey?: string } = {}) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(chooseUsernameAction, initial);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const localInvalid = touched && value.length > 0 && !isUsernameWellFormed(value);
  const error = state.code
    ? t(state.code)
    : localInvalid
      ? t("registration.error.usernameShape")
      : undefined;

  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <div className="flex flex-col gap-md">
        <Brand name={t("common.appName")} size="sm" wordmark={false} />
        <div className="flex flex-col gap-1">
          <h1 className="font-display-ar text-headline text-fg">{t(titleKey)}</h1>
          <p className="text-body-lg text-fg-secondary">{t(subtitleKey)}</p>
        </div>
      </div>
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <LabeledField label={t("registration.username.label")} htmlFor="username" hint={t("registration.username.hint")} error={error}>
          <Input
            id="username"
            name="username"
            type="text"
            autoComplete="username"
            required
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t("registration.username.placeholder")}
            aria-invalid={Boolean(error) || undefined}
          />
        </LabeledField>
        <SubmitButton className="w-full" pendingLabel={t("registration.username.saving")}>
          {t("registration.username.continue")}
        </SubmitButton>
      </form>
    </Card>
  );
}

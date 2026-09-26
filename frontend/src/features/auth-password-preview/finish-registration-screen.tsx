"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { chooseAccountTypeAction, type AccountTypeChoiceState } from "@/server/actions/registration";
import { CHOICE_GROUPS, CHOICES_BY_KEY } from "@/lib/onboarding/account-types";
import { UsernameStep } from "@/features/onboarding/username-step";
import { Card } from "@/components/ui/primitives";
import { LabeledField, Select, SubmitButton } from "@/components/ui/controls";
import { Brand } from "@/components/layout/brand";

const initial: AccountTypeChoiceState = { ok: false };

/**
 * The isolated preview's minimal recovery screen (see
 * `app/preview/auth-password/finish-registration/page.tsx`'s doc comment).
 * `needsAccountType` covers the rarer gap (the pending-registration write
 * never landed at all — see `savePendingRegistration`'s best-effort
 * comment); the far more common case is `needsAccountType={false}` — the
 * account type WAS recorded, only the username claim lost a race — which
 * renders the same minimal `UsernameStep` the canonical
 * `/onboarding/username` page uses.
 */
export function FinishRegistrationScreen({
  needsAccountType,
  usernameUnavailable = false,
}: {
  needsAccountType: boolean;
  /**
   * The username chosen at sign-up lost the post-OTP claim (23505). Only
   * changes the explanation — never whether the name was reserved or taken.
   */
  usernameUnavailable?: boolean;
}) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(chooseAccountTypeAction, initial);
  const [accountTypeKey, setAccountTypeKey] = useState("");

  if (!needsAccountType) {
    return usernameUnavailable ? (
      <UsernameStep
        titleKey="registration.username.unavailableTitle"
        subtitleKey="registration.username.unavailableSubtitle"
      />
    ) : (
      <UsernameStep />
    );
  }

  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <div className="flex flex-col gap-md">
        <Brand name={t("common.appName")} size="sm" wordmark={false} />
        <div className="flex flex-col gap-1">
          <h1 className="font-display-ar text-headline text-fg">{t("authPasswordPreview.accountTypeLabel")}</h1>
        </div>
      </div>
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <LabeledField
          label={t("authPasswordPreview.accountTypeLabel")}
          htmlFor="accountType"
          error={state.code ? t(state.code) : undefined}
        >
          <Select id="accountType" name="accountType" required value={accountTypeKey} onChange={(e) => setAccountTypeKey(e.target.value)}>
            <option value="" disabled>
              {t("authPasswordPreview.accountTypePlaceholder")}
            </option>
            {CHOICE_GROUPS.flatMap((group) => group.keys).map((key) => {
              const choice = CHOICES_BY_KEY[key];
              return (
                <option key={key} value={key} disabled={choice?.comingSoon}>
                  {t(`onboarding.accountType.types.${key}`)}
                  {choice?.comingSoon ? ` (${t("onboarding.accountType.comingSoon")})` : ""}
                </option>
              );
            })}
          </Select>
        </LabeledField>
        <SubmitButton className="w-full">{t("onboarding.continue")}</SubmitButton>
      </form>
    </Card>
  );
}

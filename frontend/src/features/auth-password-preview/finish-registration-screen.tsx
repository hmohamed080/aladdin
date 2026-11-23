"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { chooseAccountTypeAction, type AccountTypeChoiceState } from "@/server/actions/registration";
import { CHOICE_GROUPS, CHOICES_BY_KEY } from "@/lib/onboarding/account-types";
import { Card } from "@/components/ui/primitives";
import { LabeledField, Select, SubmitButton } from "@/components/ui/controls";
import { Brand } from "@/components/layout/brand";

const initial: AccountTypeChoiceState = { ok: false };

/**
 * Canonical password auth's minimal finish-registration screen (see
 * `app/auth/finish-registration/page.tsx`'s doc comment): the rare gap where the
 * pending-registration write never landed, so the account type is still missing
 * (see `savePendingRegistration`'s best-effort comment).
 */
export function FinishRegistrationScreen() {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(chooseAccountTypeAction, initial);
  const [accountTypeKey, setAccountTypeKey] = useState("");

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

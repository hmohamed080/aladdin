"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { selectAccountTypeAction, type OnboardingActionState } from "@/server/actions/onboarding";
import { CHOICE_GROUPS, CHOICES_BY_KEY, INVITED_EMPLOYEE_KEY } from "@/lib/onboarding/account-types";
import { WizardShell, WizardProgress, ChoiceCard } from "@/features/onboarding/wizard";
import { InlineError } from "@/components/ui/primitives";
import { SubmitButton, Button } from "@/components/ui/controls";

const initial: OnboardingActionState = { ok: false };

/**
 * Step 3 — the direct Personal-or-Business question.
 *
 * The two groups are not cosmetic. A PERSONAL choice claims a persona for the
 * person; a BUSINESS choice declares the kind of business they are about to
 * create, and flows straight into business setup. Nobody is asked to pick
 * "Organization owner / manager" — owning is what creating a business makes you,
 * so it is a relationship, never a type to choose.
 *
 * Some persona types (see `comingSoon` in account-types.ts) are shown but not yet
 * open for self-service registration — a real `ChoiceCard`, disabled, with a
 * "Coming soon" badge, never simply omitted (the architecture already models
 * them; only the registration entry point is gated).
 *
 * Also here: a non-selectable "joining a team?" note directing invited employees
 * to their invitation link (that path is never a public choice). The chosen key is
 * controlled so a validation error keeps the selection. Records intent only — no
 * persona and no organization is written at this step.
 */
export function AccountTypeStep({ selectedKey }: { selectedKey: string | null }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(selectAccountTypeAction, initial);
  const [choice, setChoice] = useState<string | null>(selectedKey);

  const progress = <WizardProgress current={2} total={3} label={t("onboarding.stepAccountType")} />;

  return (
    <WizardShell progress={progress} title={t("onboarding.accountType.title")} subtitle={t("onboarding.accountType.subtitle")}>
      <form action={dispatch} className="flex flex-col gap-lg" noValidate>
        <input type="hidden" name="choice" value={choice ?? ""} />

        {CHOICE_GROUPS.map(({ group, keys }) => (
          <fieldset key={group} className="flex flex-col gap-2.5" data-group={group}>
            <legend className="mb-1 text-label font-semibold uppercase tracking-wide text-fg-muted">
              {group === "personal" ? t("onboarding.accountType.groupPersonal") : t("onboarding.accountType.groupBusiness")}
            </legend>
            <p className="-mt-0.5 mb-0.5 text-label text-fg-secondary">
              {group === "personal"
                ? t("onboarding.accountType.personalHint")
                : t("onboarding.accountType.businessHint")}
            </p>
            <div className="grid gap-2.5 tablet:grid-cols-2">
              {keys.map((key) => {
                const comingSoon = CHOICES_BY_KEY[key]?.comingSoon === true;
                return (
                  <ChoiceCard
                    key={key}
                    selected={choice === key}
                    disabled={comingSoon}
                    badge={comingSoon ? t("onboarding.accountType.comingSoon") : undefined}
                    title={t(`onboarding.accountType.types.${key}`)}
                    description={
                      comingSoon
                        ? t("onboarding.accountType.comingSoonHint")
                        : t(`onboarding.accountType.types.${key}Desc`)
                    }
                    onSelect={() => setChoice(key)}
                  />
                );
              })}
            </div>
          </fieldset>
        ))}

        {/* Invitation path — informational only, never a selectable account type. */}
        <div className="rounded-md border border-dashed border-strong/70 bg-surface-2/30 p-md" data-invited={INVITED_EMPLOYEE_KEY}>
          <p className="text-label font-semibold uppercase tracking-wide text-fg-muted">{t("onboarding.accountType.groupInvitation")}</p>
          <p className="mt-1 text-body text-fg-secondary">{t("onboarding.accountType.invitedNote")}</p>
        </div>

        {state.code ? <InlineError>{t(state.code)}</InlineError> : null}

        <div className="flex items-center gap-sm">
          <Link href="/onboarding/contact">
            <Button type="button" variant="ghost">{t("onboarding.back")}</Button>
          </Link>
          <SubmitButton className="flex-1" pendingLabel={t("onboarding.saving")} disabled={!choice}>
            {t("onboarding.continue")}
          </SubmitButton>
        </div>
      </form>
    </WizardShell>
  );
}

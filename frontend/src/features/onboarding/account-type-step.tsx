"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { selectAccountTypeAction, type OnboardingActionState } from "@/server/actions/onboarding";
import { CHOICE_GROUPS, INVITED_EMPLOYEE_KEY } from "@/lib/onboarding/account-types";
import { StepCard } from "@/features/onboarding/step-card";
import { SubmitButton, Button } from "@/components/ui/controls";
import { cn } from "@/lib/ui/cn";

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
 * Also here: a non-selectable "joining a team?" note directing invited employees
 * to their invitation link (that path is never a public choice). The chosen key is
 * controlled so a validation error keeps the selection. Records intent only — no
 * persona and no organization is written at this step.
 */
export function AccountTypeStep({ selectedKey }: { selectedKey: string | null }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(selectAccountTypeAction, initial);
  const [choice, setChoice] = useState<string | null>(selectedKey);

  return (
    <StepCard step="account_type" title={t("onboarding.accountType.title")} subtitle={t("onboarding.accountType.subtitle")}>
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
                const active = choice === key;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => setChoice(key)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-md border p-md text-start transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                      active ? "border-accent bg-accent-solid/10" : "border-strong hover:bg-surface-2/60",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="font-medium text-fg">{t(`onboarding.accountType.types.${key}`)}</span>
                      {active ? (
                        <span className="shrink-0 text-label font-medium text-accent">{t("onboarding.accountType.selected")}</span>
                      ) : null}
                    </span>
                    <span className="text-label text-fg-secondary">{t(`onboarding.accountType.types.${key}Desc`)}</span>
                  </button>
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

        {state.code ? <p role="alert" className="text-label text-danger">{t(state.code)}</p> : null}

        <div className="flex items-center gap-sm">
          <Link href="/onboarding/contact">
            <Button type="button" variant="ghost">{t("onboarding.back")}</Button>
          </Link>
          <SubmitButton className="flex-1" pendingLabel={t("onboarding.saving")} disabled={!choice}>
            {t("onboarding.continue")}
          </SubmitButton>
        </div>
      </form>
    </StepCard>
  );
}

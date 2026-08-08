"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { RegistrationState } from "@/server/queries/registration";
import { recordConsentAction, type ConsentState } from "@/server/actions/registration";
import { Card, Badge } from "@/components/ui/primitives";
import { SubmitButton, Checkbox } from "@/components/ui/controls";
import { ApertureMark, CalendarCheckIcon } from "@/components/ui/icons";

const initialConsent: ConsentState = { ok: false };

/**
 * The post-registration NOTICE surface for the non-step states: outstanding
 * consent, a pending invitation, or a manually-blocked account. The collected
 * onboarding steps and the handoff summary live on their own routes; the router
 * forwards active users to the workspace before this renders.
 */
export function OnboardingPanel({ state }: { state: RegistrationState }) {
  const { t } = useI18n();

  const copy: Record<string, { title: string; body: string }> = {
    invitation_pending: { title: t("onboarding.invitationTitle"), body: t("onboarding.invitationBody") },
    manually_blocked: { title: t("onboarding.blockedTitle"), body: t("onboarding.blockedBody") },
  };

  return (
    <Card className="flex flex-col gap-lg p-lg tablet:p-xl">
      <div className="flex flex-col gap-md">
        <ApertureMark size={36} />
        <div className="flex items-center gap-2">
          <Badge tone="success">
            <span className="inline-flex items-center gap-1.5">
              <CalendarCheckIcon size={14} />
              {t("onboarding.verified")}
            </span>
          </Badge>
        </div>
      </div>

      {state === "consent_pending" ? (
        <ConsentStep />
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-label font-medium uppercase tracking-wide text-fg-muted">{t("onboarding.nextStep")}</p>
          <h1 className="font-display-ar text-headline text-fg">{copy[state]?.title ?? t("onboarding.invitationTitle")}</h1>
          <p className="text-body-lg text-fg-secondary">{copy[state]?.body ?? t("onboarding.invitationBody")}</p>
        </div>
      )}
    </Card>
  );
}

/** Outstanding-consent step: accept all three, then continue. */
function ConsentStep() {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(recordConsentAction, initialConsent);
  const [c, setC] = useState({ terms: false, privacy: false, pilot: false });
  const all = c.terms && c.privacy && c.pilot;

  return (
    <form action={dispatch} className="flex flex-col gap-md">
      <div className="flex flex-col gap-1">
        <h1 className="font-display-ar text-headline text-fg">{t("onboarding.consentTitle")}</h1>
        <p className="text-body-lg text-fg-secondary">{t("onboarding.consentBody")}</p>
      </div>
      <fieldset className="flex flex-col gap-2.5 rounded-md border border-strong/70 bg-surface-2/40 p-md">
        <legend className="px-1 text-label font-medium text-fg-secondary">{t("auth.consent.heading")}</legend>
        <Checkbox id="consent_terms" name="consent_terms" checked={c.terms} onChange={(v) => setC((s) => ({ ...s, terms: v }))}>
          {t("auth.consent.terms")}
        </Checkbox>
        <Checkbox id="consent_privacy" name="consent_privacy" checked={c.privacy} onChange={(v) => setC((s) => ({ ...s, privacy: v }))}>
          {t("auth.consent.privacy")}
        </Checkbox>
        <Checkbox id="consent_pilot" name="consent_pilot" checked={c.pilot} onChange={(v) => setC((s) => ({ ...s, pilot: v }))}>
          {t("auth.consent.pilot")}
        </Checkbox>
        {state.code ? (
          <p role="alert" className="text-label text-danger">{t(state.code)}</p>
        ) : (
          <p className="text-label text-fg-muted">{t("auth.consent.note")}</p>
        )}
      </fieldset>
      <SubmitButton className="w-full" disabled={!all}>{t("onboarding.acceptContinue")}</SubmitButton>
    </form>
  );
}

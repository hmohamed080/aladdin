"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { StaffConsentStep } from "@/features/staff-invitation/consent-step";
import { AuthCard } from "@/features/auth/auth-card";
import { ButtonLink, SubmitButton } from "@/components/ui/controls";
import { acceptStaffInvitationAction, type StaffInvitationState } from "@/server/actions/staff-invitation";
import type { StaffInvitationView } from "@/server/queries/staff-invitations";

const SIGN_IN_HREF = `/auth/sign-in?next=${encodeURIComponent("/auth/staff-invitation")}`;

/**
 * The tokenless landing of an Admin Staff invitation. It shows only what the anti-enumeration lookup returns: a state and, for a live
 * invitation, the role name and a masked address. Acceptance is an explicit button; the database re-checks identity, the inviter's current
 * authority and dedicated-staff eligibility, so this screen is presentation only.
 */
export function StaffInvitationEntry({ view, isSignedIn }: { view: StaffInvitationView; isSignedIn: boolean }) {
  const { t } = useI18n();
  const [state, accept] = useActionState(async (previous: StaffInvitationState) => (previous.ok ? previous : await acceptStaffInvitationAction()), { ok: false } as StaffInvitationState);

  if (view.status !== "pending") {
    return <AuthCard title={t("staffInvitation.title")} subtitle={t(`staffInvitation.states.${view.status}`)}>{null}</AuthCard>;
  }
  const role = view.roleName ?? "";
  const email = view.emailMasked ?? "";

  if (!isSignedIn) {
    return (
      <AuthCard title={t("staffInvitation.title")} subtitle={t("staffInvitation.intro", { role })}>
        <div className="flex flex-col gap-md" data-staff-invitation="signed-out">
          <p className="text-body text-fg-secondary">{t("staffInvitation.forAddress", { email })}</p>
          <p className="text-label text-fg-muted">{t("staffInvitation.signedOutHint")}</p>
          <ButtonLink href="/auth/staff-invitation/register" className="w-full">
            {t("staffInvitation.createAccount")}
          </ButtonLink>
          <ButtonLink href={SIGN_IN_HREF} variant="outline" className="w-full">
            {t("staffInvitation.haveAccount")}
          </ButtonLink>
        </div>
      </AuthCard>
    );
  }

  if (!view.matchesCaller) {
    return (
      <AuthCard title={t("staffInvitation.title")} subtitle={t("staffInvitation.intro", { role })}>
        <p role="alert" className="text-body text-danger" data-staff-invitation="mismatch">
          {t("staffInvitation.mismatch", { email })}
        </p>
      </AuthCard>
    );
  }

  if (!view.consentComplete) {
    return (
      <AuthCard title={t("staffInvitation.consent.title")} subtitle={t("staffInvitation.intro", { role })}>
        <StaffConsentStep />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("staffInvitation.acceptTitle")} subtitle={t("staffInvitation.intro", { role })}>
      <form action={accept} className="flex flex-col gap-md" data-staff-invitation="accept">
        <p className="text-body text-fg-secondary">{t("staffInvitation.acceptBody", { role })}</p>
        {state.code && !state.ok ? (
          <p role="alert" className="text-label text-danger">
            {t(state.code)}
          </p>
        ) : null}
        <SubmitButton className="w-full" pendingLabel={t("staffInvitation.accepting")}>
          {t("staffInvitation.accept")}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}

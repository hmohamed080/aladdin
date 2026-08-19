"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { acceptInvitation, type InviteState } from "@/server/actions/invitations";
import type { InvitationView } from "@/server/queries/invitations";
import { AuthCard } from "@/features/auth/auth-card";
import { StatePanel } from "@/components/ui/primitives";
import { Button, SubmitButton } from "@/components/ui/controls";
import { AlertIcon } from "@/components/ui/icons";

const initial: InviteState = { ok: false };

/**
 * Organization invitation entry. Renders a clear state for invalid / expired /
 * used / withdrawn invitations, and for a pending one shows the org + masked email
 * with the right call to action:
 *  - signed-in matching invitee  -> accept (bridges into the membership model)
 *  - signed-in non-matching user -> must sign in as the invited email
 *  - guest                        -> create an account or sign in to accept
 * The email match, single-use, and authority are all enforced by the backend RPC.
 */
export function InvitePanel({
  view,
  token,
  isSignedIn,
}: {
  view: InvitationView;
  token: string;
  isSignedIn: boolean;
}) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(acceptInvitation, initial);

  if (view.status !== "pending") {
    const map = {
      invalid: ["invite.invalidTitle", "invite.invalidBody"],
      expired: ["invite.expiredTitle", "invite.expiredBody"],
      accepted: ["invite.usedTitle", "invite.usedBody"],
      revoked: ["invite.revokedTitle", "invite.revokedBody"],
    } as const;
    const [title, body] = map[view.status];
    return (
      <AuthCard
        title={t("invite.title")}
        subtitle=""
        footer={
          <Link href="/auth/sign-in" className="text-fg-muted hover:text-fg hover:underline">
            {t("support.backToSignIn")}
          </Link>
        }
      >
        <StatePanel icon={<AlertIcon size={22} />} title={t(title)} body={t(body)} tone="warning" />
      </AuthCard>
    );
  }

  const orgLine = view.organizationName
    ? t("invite.joinOrg", { org: view.organizationName })
    : t("invite.joinOrgGeneric");
  const returnTo = `/auth/invite/${token}`;

  /**
   * An EMAIL invitation is bound to an identity: only the verified holder of
   * that address may accept it, whoever is holding the link. A PHONE invitation
   * cannot be bound the same way while this deployment verifies email only —
   * there is no phone identity to compare against — so acceptance rests on the
   * unguessable single-use token, and the same rule is enforced in the RPC (see
   * the invitation_contact_channel migration). Mirroring the distinction here
   * matters because otherwise a phone invitee would be told to "sign in as the
   * invited email address", which for them names an address that does not exist.
   */
  const identityBound = view.channel === "email";
  const canAccept = isSignedIn && (view.matchesCaller || !identityBound);

  return (
    <AuthCard title={t("invite.title")} subtitle={orgLine}>
      <div className="flex flex-col gap-md">
        {view.contactMasked ? (
          <p className="text-body text-fg-secondary">
            <span dir="ltr">
              {view.channel === "phone"
                ? t("invite.forPhone", { phone: view.contactMasked })
                : t("invite.forEmail", { email: view.contactMasked })}
            </span>
          </p>
        ) : null}

        {canAccept ? (
          <>
            <p className={view.matchesCaller ? "text-body text-success" : "text-body text-fg-secondary"}>
              {view.matchesCaller ? t("invite.matches") : t("invite.phoneLinkNote")}
            </p>
            <form action={dispatch}>
              <input type="hidden" name="token" value={token} />
              <SubmitButton className="w-full">{t("invite.acceptCta")}</SubmitButton>
            </form>
            {state.code ? <p role="alert" className="text-label text-danger">{t(state.code)}</p> : null}
          </>
        ) : isSignedIn ? (
          <>
            <p className="text-body text-warning">{t("invite.notMatches")}</p>
            <Link href={`/auth/sign-in?next=${encodeURIComponent(returnTo)}`} className="w-full">
              <Button variant="outline" className="w-full">{t("invite.signInToAccept")}</Button>
            </Link>
          </>
        ) : (
          <div className="flex flex-col gap-sm">
            <Link href="/auth/sign-up" className="w-full">
              <Button variant="primary" className="w-full">{t("invite.createToAccept")}</Button>
            </Link>
            <Link href={`/auth/sign-in?next=${encodeURIComponent(returnTo)}`} className="w-full">
              <Button variant="outline" className="w-full">{t("invite.signInToAccept")}</Button>
            </Link>
          </div>
        )}
      </div>
    </AuthCard>
  );
}

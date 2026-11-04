const GENERIC = "staffInvitation.error.generic";

/** Maps a database refusal to an i18n code. Never forwards the database's own wording. */
export function staffInvitationErrorCode(error: { code?: string; message?: string } | null | undefined): string {
  const message = String(error?.message ?? "");
  const known: Array<[RegExp, string]> = [
    [/invalid_email/, "invalidEmail"],
    [/reason_required/, "reasonRequired"],
    [/role_not_invitable/, "roleNotInvitable"],
    [/role_not_assignable/, "roleNotAssignable"],
    [/cannot invite yourself/, "self"],
    [/cannot accept your own/, "self"],
    [/already_holds_role/, "alreadyHoldsRole"],
    [/already_pending/, "alreadyPending"],
    [/too_many_pending/, "tooManyPending"],
    [/recipient_mismatch/, "recipientMismatch"],
    [/inviter_not_authorized/, "inviterNotAuthorized"],
    [/account_not_eligible/, "accountNotEligible"],
    [/expired/, "expired"],
    [/not_pending|not_found/, "notAvailable"],
    [/staff_invitation: invalid/, "invalid"],
    [/at or above your own authority|cannot withdraw/, "forbidden"],
  ];
  for (const [pattern, key] of known) if (pattern.test(message)) return `staffInvitation.error.${key}`;
  if (error?.code === "42501") return "staffInvitation.error.forbidden";
  if (error?.code === "23505") return "staffInvitation.error.alreadyPending";
  return GENERIC;
}

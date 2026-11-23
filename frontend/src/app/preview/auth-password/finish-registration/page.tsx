import { redirect } from "next/navigation";

/**
 * Legacy preview URL — canonical at /auth/finish-registration now. Query
 * parameters (such as the retired username `reason`) are dropped; access is
 * re-derived from the database there.
 */
export default function LegacyPreviewFinishRegistrationRedirect(): never {
  redirect("/auth/finish-registration");
}

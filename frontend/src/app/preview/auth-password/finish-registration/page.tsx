import { redirect } from "next/navigation";

/**
 * Legacy preview URL — canonical at /auth/finish-registration now. Only the
 * allow-listed `reason` value is forwarded (it chooses explanatory copy and
 * nothing else; access is re-derived from the database there).
 */
export default async function LegacyPreviewFinishRegistrationRedirect({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string | string[] }>;
}): Promise<never> {
  const { reason } = await searchParams;
  redirect(
    reason === "username_unavailable"
      ? "/auth/finish-registration?reason=username_unavailable"
      : "/auth/finish-registration",
  );
}

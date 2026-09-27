import { redirect } from "next/navigation";
import { migrationEligibility } from "@/server/actions/auth-password-preview";
import { ChangePasswordForm } from "@/features/auth-password-preview/change-password-form";

export const dynamic = "force-dynamic";

/**
 * Authenticated Change Password entry point — requires an existing password
 * (reuses the `migrationEligibility` session/flag check; a passwordless
 * account has nothing to "change" here and belongs on `/migrate` instead).
 */
export default async function AuthPasswordPreviewChangePasswordPage() {
  const eligibility = await migrationEligibility();
  if (!eligibility) redirect("/preview/auth-password/sign-in");
  if (!eligibility.hasPassword) redirect("/preview/auth-password/migrate");
  return <ChangePasswordForm email={eligibility.email} />;
}

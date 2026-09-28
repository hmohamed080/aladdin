import { redirect } from "next/navigation";
import { migrationEligibility } from "@/server/actions/auth-password-preview";
import { MigrationForm } from "@/features/auth-password-preview/migration-form";
import { AlreadyHasPassword } from "@/features/auth-password-preview/already-has-password";

export const dynamic = "force-dynamic";

/**
 * Existing-passwordless-user migration entry point. Reuses whatever session
 * cookie already exists (a passwordless-created account signed in via the
 * legacy email-code flow at `/auth/recovery` is recognized here too — same
 * Supabase project, same cookie). Unauthenticated visitors have nothing to
 * migrate and are sent to the canonical sign-in.
 */
export default async function AuthPasswordPreviewMigratePage() {
  const eligibility = await migrationEligibility();
  if (!eligibility) redirect("/auth/sign-in");
  if (eligibility.hasPassword) return <AlreadyHasPassword />;
  return <MigrationForm email={eligibility.email} />;
}

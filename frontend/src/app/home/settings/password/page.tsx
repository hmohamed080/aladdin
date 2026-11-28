import { redirect } from "next/navigation";
import { migrationEligibility } from "@/server/actions/auth-password-preview";
import { ChangePasswordForm } from "@/features/auth-password-preview/change-password-form";
import { isSettingsSectionId } from "@/features/engineer/settings-sections";
import { ContactPageShell, loadContactPageFrame } from "../_contact-page";

export const dynamic = "force-dynamic";

/**
 * `/home/settings/password` — the authenticated Change Password form inside the settings frame.
 * Same rule as the standalone page: the current password is re-verified, and an account with no
 * password yet is sent to set one first.
 */
export default async function SettingsPasswordPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const { ar } = await loadContactPageFrame();
  const eligibility = await migrationEligibility();
  if (!eligibility) redirect("/auth/sign-in");
  if (!eligibility.hasPassword) redirect("/preview/auth-password/migrate");
  return (
    <ContactPageShell
      ar={ar}
      from={isSettingsSectionId(from) ? from : "account"}
      title={ar ? "تغيير كلمة المرور" : "Change password"}
      intro={ar ? "أدخل كلمة المرور الحالية ثم اختر كلمة جديدة." : "Enter your current password, then choose a new one."}
    >
      <ChangePasswordForm email={eligibility.email} embedded />
    </ContactPageShell>
  );
}

import { redirect } from "next/navigation";
import { requireRecoverySession } from "@/server/actions/auth-password-preview";
import { RecoveryResetForm } from "@/features/auth-password-preview/recovery-reset-form";

export const dynamic = "force-dynamic";

/**
 * SCREEN 3 route boundary — the real security gate (docs/frontend/auth-
 * password-preview.md §Recovery-session security). `requireRecoverySession`
 * requires BOTH a live session AND that session's most recent auth event to
 * be `verifyOtp({type:"recovery"})` (checked via the `amr` JWT claim) — an
 * already-signed-in NORMAL session reaching this route directly is refused
 * exactly like a signed-out visitor, because it did not come through Screen
 * 2. This is also Supabase's own `redirectTo` target for the emailed
 * recovery link, so a link click lands here too (though this preview's
 * primary, supported path is the OTP code on Screen 2, not the link).
 */
export default async function AuthPasswordPreviewRecoveryResetPage() {
  const recovery = await requireRecoverySession();
  if (!recovery) redirect("/preview/auth-password/forgot-password");
  return <RecoveryResetForm email={recovery.email} />;
}

import { redirect } from "next/navigation";
import { consumeRecoverySuccess } from "@/server/actions/auth-password-preview";
import { RecoverySuccess } from "@/features/auth-password-preview/recovery-success";

export const dynamic = "force-dynamic";

/**
 * SCREEN 4 route boundary: reachable only immediately after a real reset
 * completed in THIS browser (a short-lived cookie set by
 * `resetPasswordAndSignOut`, checked here read-only — see
 * `consumeRecoverySuccess`'s doc comment for why it cannot delete it). No
 * session exists at this point (Screen 3 already ended it), so this cannot
 * be gated by `getUser()` the way Screen 3 is.
 */
export default async function AuthPasswordPreviewRecoverySuccessPage() {
  const reachedHonestly = await consumeRecoverySuccess();
  if (!reachedHonestly) redirect("/preview/auth-password/forgot-password");
  return <RecoverySuccess />;
}

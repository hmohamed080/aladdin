import { redirect } from "next/navigation";
import { recoveryFlowEmail } from "@/server/actions/auth-password-preview";
import { RecoveryVerifyForm } from "@/features/auth-password-preview/recovery-verify-form";

export const dynamic = "force-dynamic";

/**
 * SCREEN 2 route boundary: reachable only after Screen 1 set the routing
 * cookie (direct navigation here — a fresh tab, a stale bookmark, an expired
 * 10-minute window — has nothing to verify and is sent back to Screen 1;
 * this is the "direct navigation to a recovery screen without state" guard).
 */
export default async function AuthPasswordPreviewRecoveryVerifyPage() {
  const email = await recoveryFlowEmail();
  if (!email) redirect("/preview/auth-password/forgot-password");
  return <RecoveryVerifyForm email={email} />;
}

import { redirect } from "next/navigation";

/**
 * Legacy preview URL — the password recovery flow is canonical at
 * /auth/forgot-password/success now. Kept during rollout so recovery emails sent with the old
 * link still land on the real flow. No query parameters are forwarded: the
 * recovery flow never reads any (its state lives in HttpOnly cookies).
 */
export default function LegacyPreviewRecoveryRedirect(): never {
  redirect("/auth/forgot-password/success");
}

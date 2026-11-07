"use server";
import "server-only";
import { headers } from "next/headers";
import { clientIpFrom } from "@/server/auth/turnstile";
import { getCurrentUser } from "@/server/auth/session";
import { getPhoneVerificationService } from "@/server/phone-verification/runtime";

/**
 * Phone verification for the signed-in account's EXISTING primary phone (Phase B1). Disabled by default: with the feature
 * flag off these return `unavailable` and touch nothing.
 *
 * The account is ALWAYS the authenticated session user - these actions accept no user id, phone number or "verified" flag
 * from the client. Results are deliberately coarse (no ownership, number or delivery detail). The destination number never
 * leaves the server and the code is never returned.
 */
export type PhoneVerificationActionResult =
  | { status: "sent"; challengeId: string; expiresAt: string; resendAvailableAt: string }
  | { status: "verified" | "invalid" | "already_verified" | "unavailable" }
  | { status: "rate_limited"; retryAfterSeconds: number };

async function callerIp(): Promise<string | null> {
  const h = await headers();
  // Behind Cloudflare the connecting address is set by the edge; a client-supplied X-Forwarded-For is never trusted.
  return clientIpFrom((name) => (name === "x-forwarded-for" ? h.get("cf-connecting-ip") : null));
}

export async function startPrimaryPhoneVerification(): Promise<PhoneVerificationActionResult> {
  try {
    const service = getPhoneVerificationService();
    if (!service) return { status: "unavailable" };
    const user = await getCurrentUser();
    if (!user) return { status: "unavailable" };
    return await service.start(user.id, await callerIp());
  } catch {
    return { status: "unavailable" }; // no configuration, network or database detail escapes
  }
}

export async function verifyPrimaryPhone(challengeId: string, code: string): Promise<PhoneVerificationActionResult> {
  try {
    const service = getPhoneVerificationService();
    if (!service) return { status: "unavailable" };
    const user = await getCurrentUser();
    if (!user) return { status: "unavailable" };
    return await service.verify(user.id, String(challengeId), String(code), await callerIp());
  } catch {
    return { status: "unavailable" };
  }
}

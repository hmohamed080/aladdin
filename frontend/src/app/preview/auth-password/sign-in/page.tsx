import { redirect } from "next/navigation";
import { sanitizeNext } from "@/server/auth/next";

/**
 * Legacy preview URL — the password flow is canonical at /auth/sign-in now.
 * A caller-supplied `next` is forwarded only after the same allowlist the
 * sign-in page itself applies; anything else falls back to the default.
 */
export default async function LegacyPreviewSignInRedirect({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<never> {
  const { next } = await searchParams;
  // Forward `next` only when the allowlist accepts it unchanged — a rejected
  // value is dropped rather than replaced with the fallback.
  const safe = typeof next === "string" && sanitizeNext(next) === next ? next : null;
  redirect(safe ? `/auth/sign-in?next=${encodeURIComponent(safe)}` : "/auth/sign-in");
}

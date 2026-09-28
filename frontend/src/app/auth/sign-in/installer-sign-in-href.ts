import { INSTALLER_SIGN_IN_PATH } from "@/features/installer-phone-auth/routes";
import { sanitizeNext } from "@/server/auth/next";

/**
 * The installer/technician phone sign-in link on `/auth/sign-in`
 * (docs/frontend/installer-phone-auth.md). Forwards the caller's `next` only
 * when the allowlist accepts it UNCHANGED — never sanitizeNext's fallback,
 * never the raw query value — the same rule the legacy
 * `/preview/auth-password/sign-in` redirect applies.
 */
export function installerSignInHref(next: string | undefined): string {
  const forwarded = typeof next === "string" && sanitizeNext(next) === next ? next : null;
  return forwarded ? `${INSTALLER_SIGN_IN_PATH}?next=${encodeURIComponent(forwarded)}` : INSTALLER_SIGN_IN_PATH;
}

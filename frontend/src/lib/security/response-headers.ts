/**
 * Baseline security headers on every app response, on both hosts (next.config.ts
 * `headers()`). The Cloudflare Worker does not add them by itself.
 *
 * - `X-Frame-Options: SAMEORIGIN`: no other site may frame the app (clickjacking
 *   on Sign In, Server Action forms and the B2B workspace). The app only frames
 *   other sites (the OpenStreetMap embed, Turnstile), never its own pages
 *   cross-origin.
 * - `X-Content-Type-Options: nosniff`: the browser trusts the declared type.
 *
 * Deliberately not here: `Referrer-Policy` (the browser default,
 * `strict-origin-when-cross-origin`, is already right, and media routes send a
 * stricter `no-referrer` of their own) and a Content-Security-Policy (needs a
 * nonce strategy for Next's inline scripts; tracked in the 2026-10-22 audit).
 */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

/**
 * Admin View-As responses (/admin/users/[id]/view/**) carry another person's private account data. They are never
 * stored by a shared or browser cache, never indexed, and never leak the URL (which contains the subject's id) as a
 * referrer. Applied by next.config.ts `headers()` in ADDITION to SECURITY_HEADERS.
 */
export const VIEW_AS_HEADERS: readonly { key: string; value: string }[] = [
  { key: "Cache-Control", value: "private, no-store, max-age=0" },
  { key: "Pragma", value: "no-cache" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

/**
 * Baseline security headers on every app response, on both hosts (next.config.ts
 * `headers()`). Neither Vercel nor the Cloudflare Worker adds them by itself.
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

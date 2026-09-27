import "server-only";

import { isIP } from "node:net";
import { parseServerEnv, readPublicEnv } from "@/lib/env";

/**
 * APPLICATION-SCOPED Cloudflare Turnstile verification — the ONE place a
 * CAPTCHA token is judged.
 *
 * The approved architecture: Supabase's project-wide `[auth.captcha]` switch
 * stays OFF (it has no per-endpoint scope and would force a token onto every
 * canonical passwordless flow and onto Sign In). Instead the app verifies the
 * token itself, server-side, against Cloudflare Siteverify, BEFORE calling
 * Supabase Auth — on exactly the abuse-sensitive endpoints that need it:
 * Create Account (signUp + resend code) and Forgot Password request. Normal
 * Email+Password Sign In carries no CAPTCHA at all.
 *
 * FAIL CLOSED. Anything other than an explicit `success: true` from Cloudflare
 * — a missing/oversized token, a rejected token, a network error, a timeout,
 * a non-2xx status, malformed JSON, or a missing secret outside local dev —
 * is a failure. Tokens are single-use at Cloudflare (a replay comes back as
 * `timeout-or-duplicate`), and nothing here caches a success.
 *
 * Neither the secret nor the token is ever logged, and Cloudflare's
 * `error-codes` are never returned to the caller — only a coarse reason the
 * server action maps onto neutral, existing copy.
 */

export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Cloudflare's published always-pass TEST secret. Used ONLY when
 * `TURNSTILE_SECRET_KEY` is unset AND `NEXT_PUBLIC_APP_ENV` is `local`, pairing
 * with the always-pass TEST site key the widget falls back to. It still goes
 * through real Siteverify — nothing is bypassed — and it can never validate a
 * token minted for a real site key. Staging/production without a real secret
 * fail closed.
 */
export const CLOUDFLARE_TEST_SECRET_ALWAYS_PASS = "1x0000000000000000000000000000000AA";

/** Cloudflare caps tokens at 2048 characters. */
const MAX_TOKEN_LENGTH = 2048;
const SITEVERIFY_TIMEOUT_MS = 5_000;

export type TurnstileVerdict =
  | { ok: true }
  | { ok: false; reason: "missing" | "rejected" | "unavailable" };

/** The secret to verify with, or null (→ fail closed). Never throws. */
function resolveSecret(): string | null {
  try {
    // An empty value (e.g. `TURNSTILE_SECRET_KEY=` copied from .env.example)
    // counts as unset.
    const { TURNSTILE_SECRET_KEY } = parseServerEnv({
      TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY?.trim() || undefined,
    });
    if (TURNSTILE_SECRET_KEY) return TURNSTILE_SECRET_KEY;
    return readPublicEnv().NEXT_PUBLIC_APP_ENV === "local" ? CLOUDFLARE_TEST_SECRET_ALWAYS_PASS : null;
  } catch {
    return null;
  }
}

/**
 * Verify one Turnstile token. `remoteIp` is forwarded only when it parses as
 * an IP address; it is advisory for Cloudflare, never trusted by the app.
 */
export async function verifyTurnstileToken(
  token: unknown,
  { remoteIp, fetchImpl = fetch }: { remoteIp?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<TurnstileVerdict> {
  if (typeof token !== "string") return { ok: false, reason: "missing" };
  const response = token.trim();
  if (response.length === 0) return { ok: false, reason: "missing" };
  if (response.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "rejected" };

  const secret = resolveSecret();
  if (!secret) return { ok: false, reason: "unavailable" };

  const body = new URLSearchParams({ secret, response });
  if (remoteIp && isIP(remoteIp)) body.set("remoteip", remoteIp);

  try {
    const res = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const data: unknown = await res.json();
    if (typeof data === "object" && data !== null && (data as { success?: unknown }).success === true) {
      return { ok: true };
    }
    return { ok: false, reason: "rejected" };
  } catch {
    // Network failure, timeout (AbortSignal), or malformed JSON — fail closed.
    return { ok: false, reason: "unavailable" };
  }
}

/**
 * The client IP for Siteverify's optional `remoteip`, from the proxy headers
 * the hosting platform sets. Returns null unless the value is a syntactically
 * valid IP address.
 */
export function clientIpFrom(getHeader: (name: string) => string | null): string | null {
  const forwarded = getHeader("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || getHeader("x-real-ip")?.trim() || null;
  return candidate && isIP(candidate) ? candidate : null;
}

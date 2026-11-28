import "server-only";

import { isIP } from "node:net";
import { parseServerEnv, readPublicEnv } from "@/lib/env";

/**
 * Application-side Cloudflare Turnstile verification, FOR OPERATIONS THAT
 * BYPASS SUPABASE AUTH ONLY: the service-role Admin API account creation of
 * the phone sign-up (Installer/Showroom), where Supabase Auth never sees a
 * token. Every operation Supabase Auth processes itself (sign up, resend,
 * password sign in, email code, password recovery) forwards its token to
 * Supabase Auth instead, whose CAPTCHA protection verifies it — never both, a
 * token is single-use (server/auth/captcha.ts, ADR-0023,
 * docs/frontend/auth-captcha.md). Here the hostname and action are checked
 * too, which Supabase Auth does not do.
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
  | {
      ok: false;
      /**
       * `hostname` / `action` / `testing_key` are post-Cloudflare policy
       * failures (a genuine token minted for another site, another form, or by
       * Cloudflare's public test secret outside local development). Callers
       * show the same neutral "rejected" copy for all of them.
       */
      reason: "missing" | "rejected" | "unavailable" | "hostname" | "action" | "testing_key";
    };

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
 * The hostnames a genuine challenge for THIS deployment may report.
 *
 * `TURNSTILE_ALLOWED_HOSTNAMES` (comma-separated) is the authority when set —
 * it is how staging/production pin the exact public hostnames. When unset, the
 * request's own host (`x-forwarded-host`, then `host`; port stripped) is used,
 * which on a managed host is always one of the project's own domains. The
 * Cloudflare widget's own hostname allowlist is the first line of defence;
 * this is the second.
 */
export function turnstileHostnamesFrom(getHeader: (name: string) => string | null): string[] {
  let configured: string | undefined;
  try {
    configured = parseServerEnv({
      TURNSTILE_ALLOWED_HOSTNAMES: process.env.TURNSTILE_ALLOWED_HOSTNAMES?.trim() || undefined,
    }).TURNSTILE_ALLOWED_HOSTNAMES;
  } catch {
    configured = undefined;
  }
  const raw = configured ?? getHeader("x-forwarded-host") ?? getHeader("host") ?? "";
  return raw
    .split(",")
    .map((host) => host.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter((host) => host.length > 0);
}

function isLocalApp(): boolean {
  try {
    return readPublicEnv().NEXT_PUBLIC_APP_ENV === "local";
  } catch {
    return false;
  }
}

/**
 * Verify one Turnstile token — FOR OPERATIONS THAT BYPASS GOTRUE ONLY (see
 * server/auth/captcha.ts). A token verified here is spent; never forward the
 * same token to Supabase Auth afterwards.
 *
 * `expectedAction` and `expectedHostnames` are REQUIRED: a token minted for a
 * different form or another site is refused even when Cloudflare says it is a
 * valid token. `remoteIp` is forwarded only when it parses as an IP address;
 * it is advisory for Cloudflare, never trusted by the app.
 */
export async function verifyTurnstileToken(
  token: unknown,
  {
    remoteIp,
    fetchImpl = fetch,
    expectedAction,
    expectedHostnames,
  }: {
    remoteIp?: string | null;
    fetchImpl?: typeof fetch;
    expectedAction: string;
    expectedHostnames: readonly string[];
  },
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
    if (typeof data !== "object" || data === null || (data as { success?: unknown }).success !== true) {
      return { ok: false, reason: "rejected" };
    }
    const { hostname, action, metadata } = data as {
      hostname?: unknown;
      action?: unknown;
      metadata?: { result_with_testing_key?: unknown } | null;
    };

    // Cloudflare's published TEST secrets report `hostname: "example.com"`, no
    // action, and `metadata.result_with_testing_key: true`. That is a valid
    // local-development result and nothing else: outside `local` it means a
    // test key reached a real environment, which must never authorize anything.
    if (metadata?.result_with_testing_key === true) {
      return isLocalApp() ? { ok: true } : { ok: false, reason: "testing_key" };
    }

    const allowed = expectedHostnames.map((host) => host.toLowerCase());
    if (typeof hostname !== "string" || allowed.length === 0 || !allowed.includes(hostname.toLowerCase())) {
      return { ok: false, reason: "hostname" };
    }
    if (typeof action !== "string" || action !== expectedAction) {
      return { ok: false, reason: "action" };
    }
    return { ok: true };
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

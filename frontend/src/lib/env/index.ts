import { z } from "zod";

/**
 * The ONE validated environment module for the web app.
 *
 * Rules (see root AGENTS.md + docs/security/secrets-and-environments.md):
 * - Components never read `process.env` directly — import from here.
 * - Only `NEXT_PUBLIC_`-prefixed variables may reach the browser.
 * - Server-only secrets live in `serverEnvSchema` and must never be imported
 *   into a Client Component.
 */

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: z
    .enum(["local", "staging", "production"])
    .default("local"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Approved support contact shown on /auth/support for account-recovery help
  // (e.g. "support@aladdin.eg" or a help-desk URL). OPTIONAL: when unset, the
  // support page shows a safe "unavailable" state instead of a fabricated contact.
  NEXT_PUBLIC_SUPPORT_CONTACT: z.string().trim().min(1).optional(),
  // Cloudflare Turnstile SITE key (PUBLIC by design — embedded in the widget).
  // Used on canonical password auth's Create Account and Forgot Password
  // screens and the installer sign-up; Sign In has no CAPTCHA. The matching SECRET is the
  // server-only TURNSTILE_SECRET_KEY below — the APP verifies every token with
  // Cloudflare Siteverify (server/auth/turnstile.ts); Supabase's global
  // [auth.captcha] stays OFF. Optional: unset locally falls back to
  // Cloudflare's published always-pass TEST site key.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().trim().min(1).optional(),
});

export const serverEnvSchema = z.object({
  // Server-only. Never expose to the client.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Base URL of the FastAPI AI/document service. No runtime caller exists yet —
  // the web app reaches Postgres only through @supabase/ssr — so this stays
  // optional. Root Vercel Services deploys the backend at /api/backend.
  AI_SERVICE_URL: z.string().url().optional(),
  // Symmetric key for canonical Forgot Password's recovery-grant cookie
  // (AES-256-GCM — see lib/supabase/recovery-grant.ts). Required wherever
  // Forgot Password is reachable; optional in the schema so other local
  // tooling boots without it. Historical `PREVIEW` name kept (hosted env).
  AUTH_PASSWORD_PREVIEW_GRANT_SECRET: z.string().min(32).optional(),
  // Cloudflare Turnstile SECRET key — server-only, never NEXT_PUBLIC_*. Read
  // solely by server/auth/turnstile.ts to call Cloudflare Siteverify. Unset is
  // allowed only locally (falls back to Cloudflare's always-pass TEST secret);
  // in staging/production an unset secret makes every CAPTCHA check fail
  // closed.
  TURNSTILE_SECRET_KEY: z.string().trim().min(1).optional(),
  // Comma-separated public hostnames a genuine Turnstile challenge may report
  // (e.g. "app.example.com,www.example.com"). Server-only. Optional: when
  // unset the request's own host is used (server/auth/turnstile.ts). Pin it in
  // staging/production.
  TURNSTILE_ALLOWED_HOSTNAMES: z.string().trim().min(1).optional(),
  // Resend API key for transactional email (the optional contact-email verification link). Server-only. Optional:
  // locally an unset key writes the message to `.dev-mail/` instead of sending it; in staging/production an unset key
  // makes the send fail closed (the pending claim is cancelled, nothing is verified).
  RESEND_API_KEY: z.string().trim().min(1).optional(),
  // The verified Resend sender, e.g. "Aladdin <no-reply@aladdindecore.com>". Required wherever RESEND_API_KEY is set.
  EMAIL_FROM: z.string().trim().min(3).optional(),
  // The public origin emailed links point at (e.g. "https://aladdindecore.com"). Never taken from a request header
  // outside local development, so a forged Host cannot redirect a verification link.
  APP_PUBLIC_ORIGIN: z.string().url().optional(),
});

/** Server-only email configuration (contact-email verification links). */
export function readEmailEnv(): Pick<ServerEnv, "RESEND_API_KEY" | "EMAIL_FROM" | "APP_PUBLIC_ORIGIN"> {
  return parseServerEnv({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    APP_PUBLIC_ORIGIN: process.env.APP_PUBLIC_ORIGIN,
  });
}

/**
 * Names that must never appear on a browser-exposed variable. `NEXT_PUBLIC_*` is
 * inlined into the client bundle at build time, so a credential placed there is
 * published, not merely misconfigured — and rotating it is the only remedy.
 * `env.test.ts` enumerates the schemas above against this list, so a variable
 * added to the wrong schema fails CI instead of shipping.
 */
export const SECRET_NAME_PATTERN =
  /(SERVICE_ROLE|SECRET|PASSWORD|PRIVATE|JWT|DATABASE_URL|DB_URL|ACCESS_KEY|TOKEN)/i;

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Pure, testable parser — throws a readable error listing every missing/invalid key. */
export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid public environment configuration:\n${issues}`);
  }
  return result.data;
}

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment configuration:\n${issues}`);
  }
  return result.data;
}

/**
 * The single sanctioned read of `process.env` for public config. Application
 * code calls this (or the Supabase factory) instead of touching `process.env`.
 */
export function readPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPPORT_CONTACT: process.env.NEXT_PUBLIC_SUPPORT_CONTACT,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  });
}

/** Existing server-only grant secret also keys non-reversible auth throttle identifiers. */
export function readAuthIdentifierSecret(): string {
  const secret = parseServerEnv({ AUTH_PASSWORD_PREVIEW_GRANT_SECRET: process.env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET }).AUTH_PASSWORD_PREVIEW_GRANT_SECRET;
  if (!secret) throw new Error("AUTH_PASSWORD_PREVIEW_GRANT_SECRET is required for phone authentication");
  return secret;
}

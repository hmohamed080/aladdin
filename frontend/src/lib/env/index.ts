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
});

export const serverEnvSchema = z.object({
  // Server-only. Never expose to the client.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // Base URL of the FastAPI AI/document service. No runtime caller exists yet —
  // the web app reaches Postgres only through @supabase/ssr — so this stays
  // optional and is NOT provisioned for the first staging deployment.
  AI_SERVICE_URL: z.string().url().optional(),
});

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
  });
}

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

/** Audit output folder (relative to frontend/). */
export const OUT = path.resolve(process.env.AUDIT_OUT ?? "../docs/qa/audits/2026-10-15-full-audit");
mkdirSync(`${OUT}/screenshots`, { recursive: true });
mkdirSync(`${OUT}/traces`, { recursive: true });

function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
  return out;
}
const env = readEnv(".env.local");
const accounts = readEnv(".env.local-test-accounts");
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY!;

/** Disposable-fixture password (generated per run; never written anywhere). */
export const FIXTURE_PASSWORD = `Audit-${Math.random().toString(36).slice(2, 8)}-Kx9!q`;
export const RUN = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

/** Service-role client: LOCAL fixtures and read-only verification only. */
export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
export const anon = () => createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });

export async function sessionClient(email: string, password: string): Promise<SupabaseClient> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for an audit account (${error.code ?? error.status})`);
  return c;
}
export const decoreClient = () => sessionClient(accounts.DECORE_STORE_EMAIL!, accounts.DECORE_STORE_PASSWORD!);
export const adminUserClient = () => sessionClient(accounts.ADMIN_EMAIL!, accounts.ADMIN_PASSWORD!);

/** UI sign-in through the real email+password form (no bypass). */
export async function uiSignIn(page: Page, who: "decore" | "admin" | { email: string; password: string }, next?: string) {
  const cred =
    who === "decore"
      ? { email: accounts.DECORE_STORE_EMAIL!, password: accounts.DECORE_STORE_PASSWORD! }
      : who === "admin"
        ? { email: accounts.ADMIN_EMAIL!, password: accounts.ADMIN_PASSWORD! }
        : who;
  await page.goto(next ? `/auth/sign-in?next=${encodeURIComponent(next)}` : "/auth/sign-in");
  await page.locator('input[type="email"]').fill(cred.email);
  await page.locator('input[type="password"]').first().fill(cred.password);
  // PR #84 added an (interaction-only) Turnstile to email sign-in: wait for its token like a real user would
  await page
    .waitForFunction(() => [...document.querySelectorAll<HTMLInputElement>('input[name^="captcha"]')].every((i) => Boolean(i.value)), null, { timeout: 30_000 })
    .catch(() => undefined);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/auth/sign-in"), { timeout: 30_000 }), page.locator('form button[type="submit"]').first().click()]);
}

export type Status = "PASS" | "FAIL" | "PARTIAL" | "BLOCKED" | "NOT_IMPLEMENTED" | "NOT_TESTED";
export type Result = {
  journey: string;
  id: string;
  scenario: string;
  role: string;
  data: string;
  expected: string;
  actual: string;
  status: Status;
  ms?: number;
  evidence?: string;
};
/** Appends one scenario result (JSON lines) for the E2E matrix. */
export function record(r: Result) {
  appendFileSync(`${OUT}/traces/e2e-results.jsonl`, JSON.stringify({ ...r, at: new Date().toISOString() }) + "\n");
}
export function perf(row: Record<string, string | number | null>) {
  appendFileSync(`${OUT}/traces/perf-results.jsonl`, JSON.stringify({ ...row, at: new Date().toISOString() }) + "\n");
}

/** Runs one scenario body, records PASS/FAIL with the assertion message, never throws. */
export async function scenario(base: Omit<Result, "status" | "actual" | "ms">, body: () => Promise<string | void>, page?: Page) {
  const t0 = Date.now();
  try {
    const actual = (await body()) ?? base.expected;
    record({ ...base, status: "PASS", actual, ms: Date.now() - t0 });
  } catch (e) {
    let evidence: string | undefined;
    if (page) {
      evidence = `screenshots/${base.id}.png`;
      await page.screenshot({ path: `${OUT}/${evidence}`, fullPage: false }).catch(() => undefined);
    }
    const msg = (e instanceof Error ? e.message : String(e)).split("\n").slice(0, 3).join(" ").slice(0, 400);
    record({ ...base, status: "FAIL", actual: msg, ms: Date.now() - t0, evidence });
  }
}

/** Collects console errors and failed requests for a page. */
export function watch(page: Page) {
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("requestfailed", (r) => failed.push(`${r.method()} ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`));
  page.on("response", (r) => {
    if (r.status() >= 500) failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  return { consoleErrors, failed };
}

export { expect };

/**
 * Puts a real Supabase session into a browser context WITHOUT the UI login (used
 * only for journeys that are not about login, so the phone-auth rate limiter —
 * keyed by IP, and every audit request comes from localhost — is not consumed).
 * The session is minted by Supabase Auth itself through @supabase/ssr, so the
 * cookie format is exactly what the app reads.
 */
export async function injectSession(context: import("@playwright/test").BrowserContext, email: string, password: string) {
  const { createServerClient } = await import("@supabase/ssr");
  const jar: { name: string; value: string }[] = [];
  const client = createServerClient(SUPABASE_URL, ANON, {
    cookies: {
      getAll: () => jar,
      setAll: (list) => {
        for (const c of list) {
          const i = jar.findIndex((x) => x.name === c.name);
          if (i >= 0) jar.splice(i, 1);
          if (c.value) jar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`session mint failed (${error.code ?? error.status})`);
  await context.addCookies(jar.map((c) => ({ ...c, domain: "localhost", path: "/", httpOnly: false, secure: false, sameSite: "Lax" as const })));
}

/** Auth email (internal login alias for phone accounts) of a user, for injectSession. */
export async function authEmailOf(userId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("fixture user not found");
  return data.user.email;
}
export const accountsFile = accounts;

/** Re-keys a DISPOSABLE audit fixture user to this run's password, then injects its session. */
export async function fixtureSession(context: import("@playwright/test").BrowserContext, userId: string) {
  const { error } = await admin.auth.admin.updateUserById(userId, { password: FIXTURE_PASSWORD });
  if (error) throw new Error("could not re-key the fixture user");
  await injectSession(context, await authEmailOf(userId), FIXTURE_PASSWORD);
}

/** API session for a DISPOSABLE fixture user (re-keyed to this run's password first). */
export async function fixtureClient(userId: string): Promise<SupabaseClient> {
  const { error } = await admin.auth.admin.updateUserById(userId, { password: FIXTURE_PASSWORD });
  if (error) throw new Error("could not re-key the fixture user");
  return sessionClient(await authEmailOf(userId), FIXTURE_PASSWORD);
}

import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { latestOutboxEntry } from "../../src/server/phone-verification/outbox-reader";
import { E2E_PASSWORD, fillBirthDate, reachLanding, SIGN_UP_BUTTON, SIGN_UP_CONTACT_LABEL, stubTurnstileWhenOffline, waitForCaptchaToken } from "./auth";

/**
 * Mobile-number sign-up (ADR-0025) through the REAL `/auth/sign-up` and server actions, proven by the ONE phone verification authority.
 *
 * The WhatsApp message cannot be received in a local run, so the app is started with PHONE_OTP_DELIVERY=outbox: the delivery adapter
 * writes the message it WOULD have sent to a local, git-ignored directory, and this helper reads the code from there - exactly what a
 * person does with the real message. Nothing in the database is rewritten and no hash is forged: the authority generates, MACs, checks
 * and consumes the code itself, and everything after that (grant, Auth user, first sign-in, initialization, attach) runs for real.
 *
 * Required environment for the app server AND this process (see docs/security/PHONE_SIGNUP_R2_INTEGRATION.md "Running the E2E"):
 *   PHONE_VERIFICATION_ENABLED=true  PHONE_SIGNUP_VERIFICATION_ENABLED=true  PHONE_OTP_DELIVERY=outbox
 *   PHONE_OTP_HMAC_KEYS=<test keyring>  PHONE_OTP_OUTBOX_DIR=<absolute dir>   and the database switches (enablePhoneSignupSwitches()).
 * The outbox is refused when NODE_ENV=production by design, so the app must run as `next dev` (playwright: E2E_NEXT_MODE=dev).
 * LOCAL TEST DB ONLY.
 */

const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
/** When set, delivery goes app -> signed request -> the REAL Worker handler (real SQL D1) -> FAKE Meta, all on this rig (edge/whatsapp-otp-worker/scripts/local-rig.mjs). */
export const RIG = process.env.E2E_WORKER_RIG_URL;
export const deliveryViaRig = process.env.PHONE_OTP_DELIVERY === "worker" && Boolean(RIG);
export async function rigAllow(e164: string): Promise<void> {
  const r = await fetch(`${RIG}/__allow`, { method: "POST", body: JSON.stringify({ to: e164 }) });
  if (!r.ok) throw new Error("rig allowlist failed");
}
export type RigMessage = { at: number; to: string; template: string; language: string; type: string; code: string; buttonCode: string; buttonSubType: string; buttonIndex: string };
export async function rigMessages(e164: string): Promise<RigMessage[]> {
  return (await (await fetch(`${RIG}/__messages?to=${encodeURIComponent(e164)}`)).json()) as RigMessage[];
}
export async function rigClaims(): Promise<Record<string, number>> {
  return (await (await fetch(`${RIG}/__claims`)).json()) as Record<string, number>;
}
export async function rigFailNext(): Promise<void> { await fetch(`${RIG}/__fail_next`, { method: "POST" }); }
export const OUTBOX_DIR = resolve(process.env.PHONE_OTP_OUTBOX_DIR ?? ".local/phone-otp-outbox");

export function sqlValue(query: string): string {
  // No shell: a quoted `-F '|'` is parsed differently by cmd.exe (a pipe), which broke this helper for anyone developing on Windows.
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|"], { input: query }).toString().trim();
}

/**
 * Turns the database side of phone sign-up on for the isolated local stack (it ships OFF). `guard` is the alias guard mode; the database
 * refuses signup_enabled with the guard "off" (ck_config_signup_needs_guard: guard first, then sign-up), so only observe/enforce exist here.
 */
export function enablePhoneSignupSwitches(guard: "observe" | "enforce" = "enforce"): void {
  // Locally the default container name may be a developer's shared stack, so an explicit isolated name is required; on a GitHub runner the
  // default stack is the ephemeral one this job just created.
  if (/^supabase_db_aladdin$/.test(DB) && process.env.CI !== "true") throw new Error("REFUSED: pass E2E_DB_CONTAINER=supabase_db_<isolated project>");
  sqlValue(`update app.phone_verification_config set enabled = true, signup_enabled = true, alias_guard_mode = '${guard}';`);
}

/** A valid Egyptian mobile (010 + 8 digits), unique per run. */
export function uniquePhone(): string {
  return `010${String(Date.now()).slice(-5)}${String(randomInt(1000)).padStart(3, "0")}`;
}

export function uniquePhoneUsername(): string {
  return `ph${Date.now().toString(36)}${randomInt(36 ** 3).toString(36)}`.slice(0, 24);
}

export function e164Of(nationalPhone: string): string {
  return `+20${nationalPhone.slice(1)}`;
}

/**
 * The newest sign-up code the (fake) delivery wrote for this number after `since`. Delivery runs AFTER the server's reply, so this polls.
 * Returns null when nothing arrives - which is the expected outcome for a number that already has an account.
 */
export async function readSignUpCode(e164: string, since: number, waitMs = 15_000): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if (deliveryViaRig) {
      // what the fake Meta received, i.e. what a handset would show
      const last = (await rigMessages(e164)).filter((m) => m.at >= since).at(-1);
      if (last) return last.code;
    } else {
      const entry = latestOutboxEntry(OUTBOX_DIR, e164, "signup_proof");
      if (entry && Date.parse(entry.at) >= since) return entry.code;
    }
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Submits the sign-up form with a mobile number and waits for the WhatsApp code step. Returns when the code was requested (ms epoch). */
export async function requestPhoneSignUp(
  page: Page,
  { phone, name, username, password = E2E_PASSWORD, type = "installer_technician" }: { phone: string; name: string; username: string; password?: string; type?: string },
): Promise<number> {
  await stubTurnstileWhenOffline(page);
  await page.goto(`/auth/sign-up?type=${type}`);
  await page.getByLabel(SIGN_UP_CONTACT_LABEL).fill(phone);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(password);
  await fillBirthDate(page);
  await page.getByLabel(/^full name$|^الاسم الكامل$/i).fill(name);
  await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(username);
  await waitForCaptchaToken(page);
  const since = Date.now() - 1_000;
  if (deliveryViaRig) await rigAllow(e164Of(phone));
  await page.getByRole("button", { name: SIGN_UP_BUTTON }).click();
  await expect(page.getByRole("heading", { name: /enter the whatsapp code|أدخل رمز واتساب/i })).toBeVisible({ timeout: 20_000 });
  return since;
}

/** Types a code into the six boxes and submits it. Does not wait for a landing page. */
export async function submitPhoneCode(page: Page, code: string): Promise<void> {
  const step = page.locator('[data-sign-up-step="phone-code"]');
  const boxes = step.locator('input[autocomplete="one-time-code"]');
  await expect(boxes).toHaveCount(6);
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(code[i]!);
  await expect(step.locator('input[type="hidden"][name="token"]')).toHaveValue(code);
  await expect(step.locator("form").first().locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30_000 });
  await step.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
}

/** Reads the code the delivery "sent", enters it and verifies. */
export async function verifyPhoneSignUp(page: Page, e164: string, since: number, landing: RegExp = /\/home(\/|$|\?)/): Promise<void> {
  const code = await readSignUpCode(e164, since);
  expect(code, "the local outbox should hold the sign-up code").toMatch(/^\d{6}$/);
  await submitPhoneCode(page, code!);
  await reachLanding(page, landing, 30_000);
}

/** Full mobile-number registration; leaves the browser signed in. */
export async function registerWithPhone(
  page: Page,
  options: { phone: string; name: string; username?: string; password?: string; type?: string },
): Promise<void> {
  const since = await requestPhoneSignUp(page, { username: uniquePhoneUsername(), ...options });
  await verifyPhoneSignUp(page, e164Of(options.phone), since);
}

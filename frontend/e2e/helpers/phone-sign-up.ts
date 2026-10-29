import { execSync } from "node:child_process";
import { createHash, createHmac, randomInt } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD, fillBirthDate, reachLanding, SIGN_UP_BUTTON, SIGN_UP_CONTACT_LABEL, stubTurnstileWhenOffline, waitForCaptchaToken } from "./auth";

/**
 * Mobile-number sign-up (ADR-0025) through the REAL `/auth/sign-up` and server
 * actions. The WhatsApp message itself cannot be received in a local run (no
 * Meta token: the app only logs the code), so the helper replaces the stored
 * HMAC of the pending challenge with the HMAC of a code it knows, using the
 * same key the app derives from AUTH_PASSWORD_PREVIEW_GRANT_SECRET.
 * Everything after that (code check, account creation, first sign-in,
 * initialization) runs for real. LOCAL TEST DB ONLY.
 */

const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
export const KNOWN_PHONE_CODE = "246810";

export function sqlValue(query: string): string {
  return execSync(`docker exec -i ${DB} psql -U postgres -d postgres -At -F '|'`, { input: query }).toString().trim();
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

/** Mirrors server/auth/phone-sign-up.ts codeHash(): HMAC-SHA256 keyed by sha256("phone-sign-up-code:" + secret). */
function challengeHash(challengeId: string, code: string): string {
  const secret = process.env.AUTH_PASSWORD_PREVIEW_GRANT_SECRET;
  if (!secret) throw new Error("AUTH_PASSWORD_PREVIEW_GRANT_SECRET must be set (the same value as the app server)");
  const key = createHash("sha256").update(`phone-sign-up-code:${secret}`).digest();
  return createHmac("sha256", key).update(`${challengeId}:${code}`).digest("hex");
}

/** Submits the sign-up form with a mobile number and waits for the WhatsApp code step. Returns the challenge id. */
export async function requestPhoneSignUp(
  page: Page,
  { phone, name, username, password = E2E_PASSWORD, type = "installer_technician" }: { phone: string; name: string; username: string; password?: string; type?: string },
): Promise<string> {
  await stubTurnstileWhenOffline(page);
  await page.goto(`/auth/sign-up?type=${type}`);
  await page.getByLabel(SIGN_UP_CONTACT_LABEL).fill(phone);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(password);
  await fillBirthDate(page);
  await page.getByLabel(/^full name$|^الاسم الكامل$/i).fill(name);
  await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(username);
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: SIGN_UP_BUTTON }).click();
  await expect(page.getByRole("heading", { name: /enter the whatsapp code|أدخل رمز واتساب/i })).toBeVisible({ timeout: 20_000 });
  const challengeId = sqlValue(
    `select id from public.phone_verification_challenges where phone_e164 = '${e164Of(phone)}' and consumed_at is null order by created_at desc limit 1;`,
  );
  expect(challengeId).toMatch(/^[0-9a-f-]{36}$/);
  return challengeId;
}

/** Makes KNOWN_PHONE_CODE the valid code for the challenge, enters it and verifies. */
export async function verifyPhoneSignUp(page: Page, challengeId: string, landing: RegExp = /\/home(\/|$|\?)/): Promise<void> {
  sqlValue(`update public.phone_verification_challenges set code_hash = '${challengeHash(challengeId, KNOWN_PHONE_CODE)}' where id = '${challengeId}';`);
  const step = page.locator('[data-sign-up-step="phone-code"]');
  const boxes = step.locator('input[autocomplete="one-time-code"]');
  await expect(boxes).toHaveCount(6);
  for (let i = 0; i < 6; i++) await boxes.nth(i).fill(KNOWN_PHONE_CODE[i]!);
  await expect(step.locator('input[type="hidden"][name="token"]')).toHaveValue(KNOWN_PHONE_CODE);
  await expect(step.locator("form").first().locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30_000 });
  await step.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
  await reachLanding(page, landing, 30_000);
}

/** Full mobile-number registration; leaves the browser signed in. */
export async function registerWithPhone(
  page: Page,
  options: { phone: string; name: string; username?: string; password?: string; type?: string },
): Promise<void> {
  const challengeId = await requestPhoneSignUp(page, { username: uniquePhoneUsername(), ...options });
  await verifyPhoneSignUp(page, challengeId);
}

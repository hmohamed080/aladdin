import { randomInt } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import {
  E2E_BIRTH_DATE,
  E2E_PASSWORD,
  SIGN_IN_BUTTON,
  SIGN_IN_IDENTIFIER_LABEL,
  SIGN_UP_CONTACT_LABEL,
  stubTurnstileWhenOffline,
  waitForCaptchaToken,
} from "./helpers/auth";
import { e164Of, requestPhoneSignUp, sqlValue as sql, uniquePhone, uniquePhoneUsername as uniqueUsername, verifyPhoneSignUp } from "./helpers/phone-sign-up";

/**
 * One-field sign in and mobile-number sign up (ADR-0025), end to end against
 * the REAL local Supabase and the real server actions. No auth bypass; the
 * WhatsApp code is made known through helpers/phone-sign-up.ts.
 */

const ALIAS_MARKER = "craftsman-login";

async function expectNoAlias(page: Page): Promise<void> {
  const html = await page.content();
  expect(html, `internal login alias leaked on ${page.url()}`).not.toContain(ALIAS_MARKER);
  expect(html).not.toContain(".invalid");
}

async function signInWith(page: Page, identifier: string, password: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel(SIGN_IN_IDENTIFIER_LABEL).fill(identifier);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(password);
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: SIGN_IN_BUTTON }).click();
}

test.describe("one-field sign in and mobile-number sign up", () => {
  // The phone limiter counts per client IP. Under NEXT_PUBLIC_APP_ENV=local the app reads X-Forwarded-For, so each
  // test gets its own bucket.
  test.beforeEach(async ({ page, baseURL }) => {
    await stubTurnstileWhenOffline(page);
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    await page.route(`${baseURL}/**`, (route) =>
      route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
    );
  });

  test("the retired phone pages permanently redirect to /auth", async ({ request }) => {
    const expected: Record<string, string> = {
      "/installer/sign-in": "/auth/sign-in",
      "/installer/sign-up": "/auth/sign-up?type=installer_technician",
      "/showroom/sign-in": "/auth/sign-in",
      "/showroom/sign-up": "/auth/sign-up?type=showroom_dealer",
      "/temporary/craftsman/sign-in": "/auth/sign-in",
      "/temporary/craftsman/sign-up": "/auth/sign-up?type=installer_technician",
    };
    for (const [from, to] of Object.entries(expected)) {
      const res = await request.get(from, { maxRedirects: 0 });
      expect(res.status(), from).toBe(308);
      expect(res.headers()["location"], from).toBe(to);
    }
  });

  test("sign in is one identifier field; sign up asks for mobile number or email and a birthday", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await expect(page.getByLabel(SIGN_IN_IDENTIFIER_LABEL)).toHaveCount(1);
    await expect(page.locator('input[type="tel"], input[type="email"]')).toHaveCount(0);
    await expect(page.locator('a[href^="/installer/"], a[href^="/showroom/sign"]')).toHaveCount(0);

    await page.goto("/auth/sign-up");
    await expect(page.getByLabel(SIGN_UP_CONTACT_LABEL)).toHaveCount(1);
    await expect(page.locator('input[name="birthDate"]')).toHaveCount(1);
    await expect(page.locator('input[name="confirmPassword"], input[type="checkbox"]')).toHaveCount(0);
  });

  test("a mobile number signs up with a WhatsApp code, then signs in by number or username", async ({ page }) => {
    const phone = uniquePhone();
    const e164 = e164Of(phone);
    const username = uniqueUsername();
    const name = `Phone Tester ${phone.slice(-4)}`;

    const challengeId = await requestPhoneSignUp(page, { phone, name, username });
    // Nothing exists yet but the pending challenge: no account before the code is verified.
    expect(sql(`select count(*) from public.profiles where phone_e164 = '${e164}';`)).toBe("0");
    await verifyPhoneSignUp(page, challengeId);
    await expectNoAlias(page);

    const row = sql(`
      select a.raw_app_meta_data->>'registration_source',
             a.phone is null,
             p.display_name,
             p.username,
             u.birth_date,
             (select count(distinct consent_type) from public.consent_receipts c where c.user_id = a.id),
             (select consumed_at is not null from public.phone_verification_challenges where id = '${challengeId}')
      from public.profiles p
      join auth.users a on a.id = p.user_id
      join public.users u on u.id = a.id
      where p.phone_e164 = '${e164}';`);
    const [source, noAuthPhone, displayName, storedUsername, birthDate, consents, consumed] = row.split("|");
    expect(source).toBe("phone_whatsapp_sign_up");
    expect(noAuthPhone).toBe("t");
    expect(displayName).toBe(name);
    expect(storedUsername).toBe(username);
    expect(birthDate).toBe(E2E_BIRTH_DATE);
    expect(consents).toBe("3");
    expect(consumed).toBe("t");

    // Sign in by mobile number: a wrong password gets the generic message, the right one lands.
    await page.context().clearCookies();
    await signInWith(page, phone, "definitely-the-wrong-one");
    await expect(page.getByText(/don't match|غير متطابقة/i)).toBeVisible();
    await signInWith(page, e164, E2E_PASSWORD);
    await page.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
    await expectNoAlias(page);

    // ...and by username.
    await page.context().clearCookies();
    await signInWith(page, username.toUpperCase(), E2E_PASSWORD);
    await page.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
  });

  test("an unknown username or number gets the same generic sign-in error", async ({ page }) => {
    for (const identifier of [uniqueUsername(), uniquePhone()]) {
      await page.context().clearCookies();
      await signInWith(page, identifier, E2E_PASSWORD);
      await expect(page.getByText(/don't match|غير متطابقة/i)).toBeVisible();
    }
  });
});

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
import { e164Of, readSignUpCode, requestPhoneSignUp, sqlValue as sql, submitPhoneCode, uniquePhone, uniquePhoneUsername as uniqueUsername, verifyPhoneSignUp } from "./helpers/phone-sign-up";

/**
 * One-field sign in and mobile-number sign up (ADR-0025), end to end against
 * the REAL local Supabase and the real server actions. No auth bypass; the
 * WhatsApp code is read from the local delivery outbox (helpers/phone-sign-up.ts),
 * the way a person reads the message. The mobile sign-up tests need the app started
 * with PHONE_OTP_DELIVERY=outbox (E2E_NEXT_MODE=dev) and are skipped otherwise.
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

  const outbox = process.env.PHONE_OTP_DELIVERY === "outbox";

  test("a mobile number signs up with a WhatsApp code, then signs in by number or username", async ({ page }) => {
    test.skip(!outbox, "needs PHONE_OTP_DELIVERY=outbox and E2E_NEXT_MODE=dev (see helpers/phone-sign-up.ts)");
    const phone = uniquePhone();
    const e164 = e164Of(phone);
    const username = uniqueUsername();
    const name = `Phone Tester ${phone.slice(-4)}`;

    const since = await requestPhoneSignUp(page, { phone, name, username });
    // Nothing exists yet but the pending challenge: no Auth user and no profile before the code is verified.
    expect(sql(`select count(*) from public.profiles where phone_e164 = '${e164}';`)).toBe("0");
    expect(sql(`select count(*) from auth.users where email like 'p${e164.slice(1)}@%';`)).toBe("0");
    await verifyPhoneSignUp(page, e164, since);
    await expectNoAlias(page);

    const row = sql(`
      select a.raw_app_meta_data->>'registration_source',
             a.phone is null,
             p.display_name,
             p.username,
             u.birth_date,
             (select count(distinct consent_type) from public.consent_receipts c where c.user_id = a.id),
             p.phone_verified_at is not null,
             (select count(*) from app.phone_signup_grants g where g.consumed_user_id = a.id and g.attached_at is not null and g.phone_e164 = p.phone_e164),
             (select count(*) from auth.users x where lower(x.email) = lower(a.email))
      from public.profiles p
      join auth.users a on a.id = p.user_id
      join public.users u on u.id = a.id
      where p.phone_e164 = '${e164}';`);
    const [source, noAuthPhone, displayName, storedUsername, birthDate, consents, verified, attachedGrants, aliasUsers] = row.split("|");
    expect(source).toBe("phone_whatsapp_sign_up");
    expect(noAuthPhone).toBe("t");
    expect(displayName).toBe(name);
    expect(storedUsername).toBe(username);
    expect(birthDate).toBe(E2E_BIRTH_DATE);
    expect(consents).toBe("3");
    // The proof is attached to exactly the proven number, and exactly one Auth user holds the alias.
    expect(verified).toBe("t");
    expect(attachedGrants).toBe("1");
    expect(aliasUsers).toBe("1");

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

  test("a wrong code creates no account, and the right code is still accepted afterwards", async ({ page }) => {
    test.skip(!outbox, "needs PHONE_OTP_DELIVERY=outbox and E2E_NEXT_MODE=dev");
    const phone = uniquePhone();
    const e164 = e164Of(phone);
    const since = await requestPhoneSignUp(page, { phone, name: "Wrong Code", username: uniqueUsername() });
    const code = (await readSignUpCode(e164, since))!;
    const wrong = code === "000000" ? "111111" : "000000";
    await submitPhoneCode(page, wrong);
    await expect(page.getByText(/invalid|incorrect|wrong|غير صحيح|خاطئ/i).first()).toBeVisible({ timeout: 20_000 });
    expect(sql(`select count(*) from public.profiles where phone_e164 = '${e164}';`)).toBe("0");
    expect(sql(`select count(*) from auth.users where email like 'p${e164.slice(1)}@%';`)).toBe("0");
    await verifyPhoneSignUp(page, e164, since);
    expect(sql(`select count(*) from public.profiles where phone_e164 = '${e164}' and phone_verified_at is not null;`)).toBe("1");
  });

  test("an already registered number gets the same screen and no message, and no second account", async ({ page, browser }) => {
    test.skip(!outbox, "needs PHONE_OTP_DELIVERY=outbox and E2E_NEXT_MODE=dev");
    const phone = uniquePhone();
    const e164 = e164Of(phone);
    const first = await requestPhoneSignUp(page, { phone, name: "First Owner", username: uniqueUsername() });
    await verifyPhoneSignUp(page, e164, first);
    const accountsBefore = sql(`select count(*) from auth.users where lower(email) like 'p${e164.slice(1)}@%';`);
    expect(accountsBefore).toBe("1");

    // A second visitor asks for the SAME number: the page is identical (the heading appears), but nothing is delivered.
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    await other.route("**/*", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
    const since = await requestPhoneSignUp(other, { phone, name: "Someone Else", username: uniqueUsername() });
    expect(await readSignUpCode(e164, since, 4_000), "a registered number must receive no code").toBeNull();

    // Any code fails and still no second account appears.
    await submitPhoneCode(other, "123456");
    await expect(other.getByText(/invalid|incorrect|wrong|expired|غير صحيح|خاطئ|منتهي/i).first()).toBeVisible({ timeout: 20_000 });
    expect(sql(`select count(*) from auth.users where lower(email) like 'p${e164.slice(1)}@%';`)).toBe(accountsBefore);
    await ctx.close();
  });

  test("an unknown username or number gets the same generic sign-in error", async ({ page }) => {
    for (const identifier of [uniqueUsername(), uniquePhone()]) {
      await page.context().clearCookies();
      await signInWith(page, identifier, E2E_PASSWORD);
      await expect(page.getByText(/don't match|غير متطابقة/i)).toBeVisible();
    }
  });
});

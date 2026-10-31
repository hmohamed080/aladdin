import { randomInt } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import {
  E2E_BIRTH_DATE,
  E2E_PASSWORD,
  reachLanding,
  SIGN_IN_BUTTON,
  SIGN_IN_IDENTIFIER_LABEL,
  SIGN_UP_CONTACT_LABEL,
  stubTurnstileWhenOffline,
  waitForCaptchaToken,
} from "./helpers/auth";
import { deliveryViaRig, e164Of, readSignUpCode, rigClaims, rigFailNext, rigMessages, requestPhoneSignUp, sqlValue as sql, submitPhoneCode, uniquePhone, uniquePhoneUsername as uniqueUsername, verifyPhoneSignUp } from "./helpers/phone-sign-up";

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

  const outbox = process.env.PHONE_OTP_DELIVERY === "outbox" || deliveryViaRig;

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
    // The app answers in the visitor's locale (Arabic by default), so assert on the alert inside the code step, not on English words.
    await expect(page.locator('[data-sign-up-step="phone-code"]').getByRole("alert").first()).toBeVisible({ timeout: 20_000 });
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
    // The code step always offers the way out for people who already have an account - for every number, so it reveals nothing.
    await expect(other.locator('[data-sign-up-step="phone-code"]').locator('xpath=ancestor::main').getByRole("link", { name: /^(sign in|تسجيل الدخول)$/i }).first()).toHaveAttribute("href", "/auth/sign-in");

    // Any code fails and still no second account appears.
    await submitPhoneCode(other, "123456");
    await expect(other.locator('[data-sign-up-step="phone-code"]').getByRole("alert").first()).toBeVisible({ timeout: 20_000 });
    expect(sql(`select count(*) from auth.users where lower(email) like 'p${e164.slice(1)}@%';`)).toBe(accountsBefore);
    await ctx.close();
  });

  test("a legacy phone/password account created before enforcement still signs in by number, and a new grant-less alias is refused", async ({ page }) => {
    test.skip(!outbox, "needs PHONE_OTP_DELIVERY=outbox and E2E_NEXT_MODE=dev");
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const phone = uniquePhone();
    const e164 = e164Of(phone);
    const aliasEmail = `p${e164.slice(1)}@craftsman-login.aladdin.invalid`;
    const admin = (body: object) => fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    // Reproduce the pre-R2 world: guard off, grant-less Admin creation exactly as the retired Installer page did it.
    sql("update app.phone_verification_config set signup_enabled = false, alias_guard_mode = 'off';");
    const legacy = await admin({ email: aliasEmail, password: E2E_PASSWORD, email_confirm: true, user_metadata: { full_name: "Legacy Installer" }, app_metadata: { registration_source: "temporary_craftsman_password_flow", aladdin_pw_preview_password_set: true } });
    expect(legacy.status).toBe(200);
    const userId = ((await legacy.json()) as { id: string }).id;
    sql(`update public.profiles set phone_e164 = '${e164}', phone_national = '${phone}', phone_country_iso2 = 'EG' where user_id = '${userId}';`);
    // Now the shipped target state: guard enforcing.
    sql("update app.phone_verification_config set alias_guard_mode = 'observe';");
    sql("update app.phone_verification_config set alias_guard_mode = 'enforce', signup_enabled = true;");
    try {
      // 1) the legacy account is untouched and signs in by number through the real UI
      await signInWith(page, phone, E2E_PASSWORD);
      await page.waitForURL(/\/(home|onboarding)(\/|$|\?)/, { waitUntil: "commit" });
      expect(sql(`select count(*) from auth.users where id = '${userId}' and lower(email) = '${aliasEmail}';`)).toBe("1");
      expect(sql(`select phone_verified_at is null from public.profiles where user_id = '${userId}';`)).toBe("t");
      // 2) enforcement now refuses a NEW alias created without a grant (what the retired pages used to do)
      const other = `p20${String(Date.now()).slice(-9)}@craftsman-login.aladdin.invalid`;
      const refused = await admin({ email: other, password: E2E_PASSWORD, email_confirm: true, app_metadata: { registration_source: "temporary_craftsman_password_flow" } });
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(sql(`select count(*) from auth.users where lower(email) = '${other}';`)).toBe("0");
    } finally {
      await fetch(`${url}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: { apikey: service, authorization: `Bearer ${service}` } });
    }
  });

  test("through the Worker: Meta receives the approved Authentication template exactly once, D1 holds one claim, and the code on the handset verifies", async ({ page }) => {
    test.skip(!deliveryViaRig, "needs the local Worker rig (E2E_WORKER_RIG_URL, PHONE_OTP_DELIVERY=worker)");
    const phone = uniquePhone(); const e164 = e164Of(phone);
    const claimsBefore = Object.values(await rigClaims()).reduce((a, b) => a + b, 0);
    const since = await requestPhoneSignUp(page, { phone, name: "Worker Path", username: uniqueUsername() });
    const code = (await readSignUpCode(e164, since))!;
    const received = await rigMessages(e164);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ to: e164.slice(1), template: "aladdin_otp", language: "ar", type: "template", code, buttonCode: code, buttonSubType: "url", buttonIndex: "0" });
    expect(Object.values(await rigClaims()).reduce((a, b) => a + b, 0)).toBe(claimsBefore + 1);
    await submitPhoneCode(page, code);
    await reachLanding(page, /\/home(\/|$|\?)/, 30_000);
    expect(sql(`select count(*) from public.profiles where phone_e164 = '${e164}' and phone_verified_at is not null;`)).toBe("1");
    expect(await rigMessages(e164)).toHaveLength(1);
  });

  test("through the Worker: a Meta failure is invisible in the reply, closes the challenge, and a resend (new challenge) delivers", async ({ page }) => {
    test.skip(!deliveryViaRig, "needs the local Worker rig");
    test.setTimeout(240_000); // the Resend button is on a cooldown (about a minute) before the person may ask again
    const phone = uniquePhone(); const e164 = e164Of(phone);
    await rigFailNext();
    const since = await requestPhoneSignUp(page, { phone, name: "Meta Failure", username: uniqueUsername() });
    expect(await readSignUpCode(e164, since, 4_000), "the failed delivery produced no message").toBeNull();
    expect(sql(`select count(*) from app.phone_verification_challenges where phone_e164 = '${e164}' and invalidated_why = 'delivery_failed';`)).toBe("1");
    // the person uses Resend: a NEW challenge, a new delivery id, delivered once
    const step = page.locator('[data-sign-up-step="phone-code"]');
    const resend = step.getByRole("button", { name: /resend|إعادة الإرسال/i }).first();
    await expect(resend).toBeEnabled({ timeout: 120_000 });
    const second = Date.now() - 1_000;
    await expect(step.locator("form").nth(1).locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30_000 });
    await resend.click();
    const code = (await readSignUpCode(e164, second))!;
    expect(code).toMatch(/^\d{6}$/);
    expect(await rigMessages(e164)).toHaveLength(1);
    await submitPhoneCode(page, code);
    await reachLanding(page, /\/home(\/|$|\?)/, 30_000);
    expect(sql(`select count(*) from public.profiles where phone_e164 = '${e164}' and phone_verified_at is not null;`)).toBe("1");
  });

  test("an unknown username or number gets the same generic sign-in error", async ({ page }) => {
    for (const identifier of [uniqueUsername(), uniquePhone()]) {
      await page.context().clearCookies();
      await signInWith(page, identifier, E2E_PASSWORD);
      await expect(page.getByText(/don't match|غير متطابقة/i)).toBeVisible();
    }
  });
});

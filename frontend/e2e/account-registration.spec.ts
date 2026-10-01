import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES, messageIdsFor, readNewOtp } from "./helpers/auth";
import { createConfirmedAccount } from "./helpers/fixtures";
import { E2E_INVITE_TOKEN } from "./global-setup";

/**
 * Sprint 7.2 — account access & registration (no auth bypass; codes read from
 * local Mailpit): the canonical password Sign Up form with consent, resume at
 * /onboarding, legacy Email-OTP recovery, lost-email support, and token
 * invitation entry (invalid + valid). Bilingual + light/dark are covered by
 * setting the locale/theme cookies.
 */

async function prefs(page: Page, locale: "en" | "ar", theme: "light" | "dark") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
  ]);
}

async function noOverflow(page: Page) {
  const o = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(o).toBeLessThanOrEqual(1);
}

test.describe("account registration", () => {
  test("sign up: the canonical password form, gated by the three consents", async ({ page }) => {
    await prefs(page, "en", "light");
    await page.goto("/auth/sign-up");
    await noOverflow(page);

    // Full Name first, then email, username, the account-type dropdown and
    // the password pair. (The full create → OTP → app journey is Turnstile-
    // gated and covered by auth-password-preview.spec.ts.)
    await expect(page.getByLabel(/^full name$/i)).toHaveAttribute("placeholder", "Enter your full name");
    await expect(page.getByLabel(/^email address$/i)).toBeVisible();
    await expect(page.getByLabel(/^username$/i)).toBeVisible();
    await expect(page.locator('select[name="accountType"]')).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByLabel(/^confirm password$/i)).toBeVisible();

    const createBtn = page.getByRole("button", { name: /create account/i });
    // Consent gate: cannot submit until all three are accepted.
    await expect(createBtn).toBeDisabled();
    await page.getByLabel(/terms of service/i).check();
    await page.getByLabel(/privacy policy/i).check();
    await page.getByLabel(/pilot release/i).check();
    await expect(createBtn).toBeEnabled();
  });

  test("a verified account with an incomplete registration is funnelled back from Sign In", async ({ page, request }) => {
    await prefs(page, "en", "light");
    const email = `signup+${Date.now()}@example.test`;
    createConfirmedAccount(email);
    await signIn(page, request, email, /\/auth\/finish-registration$/);
    // Resume: a signed-in caller visiting Sign In is funnelled back into onboarding.
    await page.goto("/auth/sign-in");
    await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  });

  test("sign up in Arabic renders RTL with no mixed-language leakage", async ({ page }) => {
    await prefs(page, "ar", "dark");
    await page.goto("/auth/sign-up");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await noOverflow(page);
    // Consent labels are Arabic; the English catalog strings must not appear.
    await expect(page.getByText(/شروط الخدمة/)).toBeVisible();
    await expect(page.getByLabel(/^الاسم الكامل$/)).toHaveAttribute("placeholder", "اكتب اسمك الكامل");
    await expect(page.locator('select[name="accountType"] option').first()).toHaveText("اختر نوع الحساب");
    await expect(page.getByText(/full name|choose an account type/i)).toHaveCount(0);
    await expect(page.getByText(/I accept the Terms of Service/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /إنشاء حساب/ })).toBeVisible();
  });

  test("recovery sends a fresh code to an existing account", async ({ page, request }) => {
    await prefs(page, "en", "light");
    const email = IDENTITIES.manager;
    const seen = await messageIdsFor(request, email);

    await page.goto("/auth/recovery");
    await noOverflow(page);
    await expect(page.getByText(/email only/i)).toBeVisible(); // single-channel note
    await page.getByLabel(/email address/i).fill(email);
    await page.getByRole("button", { name: /send code/i }).click();
    await expect(page.getByText(/we sent a code/i)).toBeVisible();
    // Prove a real code arrived (recovery reuses the sign-in send path).
    const code = await readNewOtp(request, email, seen);
    expect(code).toMatch(/^\d{6}$/);
    // Lost-email path is one click away.
    await page.goto("/auth/recovery");
    await page.getByRole("link", { name: /lost access to your email/i }).click();
    await page.waitForURL(/\/auth\/support$/, { waitUntil: "commit" });
  });

  test("support shows a safe unavailable state (no fabricated contact)", async ({ page }) => {
    await prefs(page, "en", "light");
    await page.goto("/auth/support");
    await noOverflow(page);
    await expect(page.getByRole("heading", { name: /how manual review works/i })).toBeVisible();
    // No support contact configured in local env → the safe unavailable state.
    await expect(page.getByText(/support contact not configured/i)).toBeVisible();
    await expect(page.getByText(/can't confirm/i)).toBeVisible();
  });

  test("an invalid invitation shows the invalid state", async ({ page }) => {
    await prefs(page, "en", "light");
    await page.goto("/auth/invite/this-token-does-not-exist-000000");
    await noOverflow(page);
    await expect(page.getByText(/invitation not found/i)).toBeVisible();
  });

  test("existing user sign in still reaches the workspace", async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.manager);
    await expect(page).toHaveURL(/\/b2b(\/|$)/);
  });

  test("a valid invitation is accepted by the matching account", async ({ page, request }, testInfo) => {
    // State-consuming: run once (desktop project) since global-setup seeds a single
    // pending invitation shared across projects.
    test.skip(testInfo.project.name !== "chromium-desktop", "runs once on desktop");
    await prefs(page, "en", "light");
    // a-cairo@example.test matches the seeded invitation email. It holds a
    // canonical Sales persona AND a membership, so its landing follows the
    // selected work context — either surface is a valid start here.
    await signIn(page, request, IDENTITIES.branchLimited, /\/(b2b|home)(\/|$)/);

    await page.goto(`/auth/invite/${E2E_INVITE_TOKEN}`);
    await noOverflow(page);
    await expect(page.getByText(/this invitation is for your account/i)).toBeVisible();
    await page.getByRole("button", { name: /accept invitation/i }).click();
    // Acceptance bridges to an active membership. The landing follows the
    // selected work context (this account also has a Personal one), so prove
    // the membership directly: the B2B workspace now renders instead of
    // bouncing back to /home.
    await page.waitForURL(/\/(b2b|home)(\/|$)/, { waitUntil: "commit" });
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/b2b(\/|$)/);
  });
});

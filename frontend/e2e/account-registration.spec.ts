import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES, messageIdsFor, readNewOtp } from "./helpers/auth";
import { E2E_INVITE_TOKEN } from "./global-setup";

/**
 * Sprint 7.2 — account access & registration. Exercises the REAL passwordless
 * Email-OTP path (no auth bypass; codes read from local Mailpit): Sign Up with
 * consent, resume at /onboarding, recovery, lost-email support, and token
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
  test("sign up: consent gate → create → verify → resume at /onboarding", async ({ page, request }) => {
    await prefs(page, "en", "light");
    const email = `signup+${Date.now()}@example.test`;
    const seen = await messageIdsFor(request, email);

    await page.goto("/auth/sign-up");
    await noOverflow(page);

    await page.getByLabel(/email address/i).fill(email);
    const createBtn = page.getByRole("button", { name: /create account/i });
    // Consent gate: cannot request a code until all three are accepted.
    await expect(createBtn).toBeDisabled();
    await page.getByLabel(/terms of service/i).check();
    await page.getByLabel(/privacy policy/i).check();
    await page.getByLabel(/pilot release/i).check();
    await expect(createBtn).toBeEnabled();

    await createBtn.click();
    await expect(page.getByText(/we sent a code/i)).toBeVisible();
    // Change-email returns to step 1 (no nested forms); resend is present.
    await expect(page.getByRole("button", { name: /resend|resend in/i })).toBeVisible();

    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code/i).fill(code);
    await page.getByRole("button", { name: /verify/i }).click();

    // Verified + consented new account resumes at the first onboarding step
    // (Sprint 7.3: /onboarding forwards to the next incomplete step).
    await page.waitForURL(/\/onboarding\/profile$/, { waitUntil: "commit" });
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible();

    // Resume: a signed-in caller visiting Sign In is funnelled back into onboarding.
    await page.goto("/auth/sign-in");
    await page.waitForURL(/\/onboarding\/profile$/, { waitUntil: "commit" });
  });

  test("sign up in Arabic renders RTL with no mixed-language leakage", async ({ page }) => {
    await prefs(page, "ar", "dark");
    await page.goto("/auth/sign-up");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await noOverflow(page);
    // Consent labels are Arabic; the English catalog strings must not appear.
    await expect(page.getByText(/شروط الخدمة/)).toBeVisible();
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
    // a-cairo@example.test matches the seeded invitation email.
    await signIn(page, request, IDENTITIES.branchLimited);

    await page.goto(`/auth/invite/${E2E_INVITE_TOKEN}`);
    await noOverflow(page);
    await expect(page.getByText(/this invitation is for your account/i)).toBeVisible();
    await page.getByRole("button", { name: /accept invitation/i }).click();
    // Acceptance bridges to an active membership and lands in the workspace.
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
  });
});

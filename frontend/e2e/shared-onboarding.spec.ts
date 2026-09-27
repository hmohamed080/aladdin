import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { signIn, IDENTITIES, messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * Shared onboarding, CURRENT contract (staging-prep Increment 7 + 11): a fresh
 * Email-OTP sign-up with consent goes straight to the account-type step, then
 * the one-field username step, then INTO THE APP — the legacy profile →
 * contact → persona wizard is no longer on the path (its pages survive only
 * for direct navigation). Resume, deep-link guards, the business-intent
 * terminal and the active-member skip are asserted against persisted state.
 * Rewritten from the Sprint 7.3 wizard assertions, which the base branch's
 * Increment 7 made permanently stale (they waited for /onboarding/profile).
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

/** Register a brand-new user through the real sign-up + consent + OTP path. */
async function registerFreshUser(page: Page, request: APIRequestContext): Promise<string> {
  const email = `onb+${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
  const seen = await messageIdsFor(request, email);
  // Bilingual label regexes so the same helper works in en and ar.
  await page.goto("/auth/sign-up");
  await page.getByLabel(/email address|البريد/i).fill(email);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|نسخة تجريبية/i).check();
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  await expect(page.getByText(/we sent a code|أرسلنا رمزًا/i)).toBeVisible();
  const code = await readNewOtp(request, email, seen);
  // One box per digit — keyboard input exercises the real auto-advance contract.
  await page.getByLabel(/one-time code|الرمز/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify|تأكيد/i }).click();
  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  return email;
}

const LEGACY_STEP = /\/onboarding\/(profile|contact|professional|consumer|business)(\/|$)/;

test.describe("shared onboarding", () => {
  test("full flow (individual): account type → username → personal home, no legacy wizard", async ({ page, request }) => {
    await prefs(page, "en", "light");
    const visited: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
    });
    await registerFreshUser(page, request);
    await noOverflow(page);

    // Coming Soon types are visible but cannot be chosen.
    await expect(page.getByRole("button", { name: /^engineer/i })).toBeDisabled();
    await page.getByRole("button", { name: /tradespeople & technicians/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.waitForURL(/\/onboarding\/username$/, { waitUntil: "commit" });
    await page.getByLabel(/^username$/i).fill(`onb${Date.now()}`.slice(0, 20));
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
    expect(visited.filter((p) => LEGACY_STEP.test(p))).toEqual([]);
  });

  test("refresh after choosing an account type resumes at the username step", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerFreshUser(page, request);
    await page.getByRole("button", { name: /sales team/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/username$/, { waitUntil: "commit" });

    await page.reload();
    await expect(page).toHaveURL(/\/onboarding\/username$/);
    // The account type is persisted; its step cannot be re-entered.
    await page.goto("/onboarding/account-type");
    await expect(page).toHaveURL(/\/onboarding\/username$/);
  });

  test("deep-linking a later step redirects back to the next incomplete step", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerFreshUser(page, request);
    for (const later of ["/onboarding/username", "/onboarding/complete", "/home", "/settings/profile"]) {
      await page.goto(later);
      await expect(page, later).toHaveURL(/\/onboarding\/account-type$/);
    }
  });

  test("business selection records intent only and enters the app with a create-business path (Arabic)", async ({ page, request }) => {
    await prefs(page, "ar", "dark");
    await registerFreshUser(page, request);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await noOverflow(page);

    await page.getByRole("button", { name: /المورد/ }).click();
    await page.getByRole("button", { name: /متابعة/ }).click();
    await page.waitForURL(/\/onboarding\/username$/, { waitUntil: "commit" });
    await page.getByLabel(/اسم المستخدم/).fill(`biz${Date.now()}`.slice(0, 20));
    await page.getByRole("button", { name: /متابعة/ }).click();

    // access_ready with ZERO organizations: no organization was created for
    // them, so they get the account-safe terminal and its create-business CTA.
    await page.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
    await expect(page.getByTestId("no-personal-workspace")).toBeVisible();
    await expect(page.locator('a[href="/business/new"]').first()).toBeVisible();
    await noOverflow(page);
  });

  test("sign-out then sign-in resumes the next incomplete step", async ({ page, request }) => {
    await prefs(page, "en", "light");
    const email = await registerFreshUser(page, request);
    await page.getByRole("button", { name: /tradespeople & technicians/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/username$/, { waitUntil: "commit" });

    // Sign out from the onboarding chrome, then sign back in via the real OTP path.
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.waitForURL(/\/auth\/sign-in$/, { waitUntil: "commit" });

    const seen = await messageIdsFor(request, email);
    await page.getByLabel(/email address|البريد/i).fill(email);
    await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();
    await expect(page.getByText(/we sent a code|أرسلنا رمزًا/i)).toBeVisible();
    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز/i).pressSequentially(code);
    await page.getByRole("button", { name: /verify|تأكيد/i }).click();

    // An incomplete account signing in resumes exactly where it stopped.
    await page.waitForURL(/\/onboarding\/username$/, { waitUntil: "commit" });
  });

  test("an active existing member skips onboarding and reaches /b2b", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await signIn(page, request, IDENTITIES.manager);
    await expect(page).toHaveURL(/\/b2b(\/|$)/);
    // Visiting /onboarding forwards an active member straight to the workspace.
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/b2b(\/|$)/);
  });
});

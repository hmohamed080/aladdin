import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";
import { createConfirmedAccount } from "./helpers/fixtures";

/**
 * Shared onboarding, CURRENT contract (staging-prep Increment 7 + 11): a
 * verified, consented account with no account type goes to the account-type
 * step, then the one-field username step, then INTO THE APP — the legacy profile →
 * contact → persona wizard is no longer on the path (its pages survive only
 * for direct navigation). Resume, deep-link guards, the business-intent
 * terminal and the active-member skip are asserted against persisted state.
 * Rewritten from the Sprint 7.3 wizard assertions, which the base branch's
 * Increment 7 made permanently stale (they waited for /onboarding/profile).
 *
 * The canonical `/auth/sign-up` now takes the account type and username on
 * Step 1, so it never produces an account_type_pending account. These steps
 * still serve accounts in that state (e.g. pre-password registrations), so
 * the state is seeded as a local-DB fixture and entered through the real
 * password sign-in.
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

/**
 * A verified, consented account with no account type yet (local-DB fixture),
 * signed in through the REAL password sign-in. The password flow's own
 * recovery screen is where such an account lands; `/onboarding` then routes
 * it to the account-type step these tests exercise.
 */
async function registerFreshUser(page: Page, request: APIRequestContext): Promise<string> {
  const email = `onb+${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
  createConfirmedAccount(email);
  await signIn(page, request, email, /\/auth\/finish-registration$/);
  await page.goto("/onboarding");
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
    await page.getByRole("button", { name: /craftsmen/i }).click();
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
    await page.getByRole("button", { name: /craftsmen/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/username$/, { waitUntil: "commit" });

    // Sign out from the onboarding chrome, then sign back in with the password.
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.waitForURL(/\/auth\/sign-in$/, { waitUntil: "commit" });

    // An incomplete account signing in resumes exactly where it stopped: the
    // password flow's recovery screen asks for the missing username only.
    await signIn(page, request, email, /\/auth\/finish-registration$/);
    await expect(page.getByLabel(/^username$/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toHaveCount(0);
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

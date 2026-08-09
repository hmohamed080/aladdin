import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * Sprint 8 — business / organization onboarding. Drives the REAL owner path (no
 * bypass): a fresh Email-OTP sign-up, the shared steps to the business handoff, then
 * the shared organization wizard (identity → type → location → branch → review),
 * where submitting creates the organization + the owner's active membership +
 * primary branch through the trusted backend path and lands the owner in the B2B
 * workspace. Persona isolation (a non-business caller cannot open the business flow)
 * is asserted too. The invited-employee path is covered by account-registration.spec.
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
  const email = `biz+${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
  const seen = await messageIdsFor(request, email);
  await page.goto("/auth/sign-up");
  await page.getByLabel(/email address|البريد/i).fill(email);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|نسخة تجريبية/i).check();
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  await expect(page.getByText(/we sent a code|أرسلنا رمزًا/i)).toBeVisible();
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز/i).fill(code);
  await page.getByRole("button", { name: /verify|تأكيد/i }).click();
  await page.waitForURL(/\/onboarding\/profile$/, { waitUntil: "commit" });
  return email;
}

/** Drive the shared steps (profile → contact → account-type) and pick a choice. */
async function toAccountType(page: Page, displayName: string) {
  await page.locator("#displayName").fill(displayName);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
  await page.locator("#phone").fill("01012345678");
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
}

test.describe("business onboarding", () => {
  test("Organization owner: creates the org and enters the workspace", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerFreshUser(page, request);
    await toAccountType(page, "Founder One");

    // Choose Supplier (business track) → enters the shared business wizard.
    await page.getByRole("button", { name: /supplier/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/business$/, { waitUntil: "commit" });
    await noOverflow(page);

    // Step 1 — identity: an organization name is required to continue.
    await expect(page.getByRole("heading", { name: /set up your organization/i })).toBeVisible();
    await page.locator("#bname").fill("Nile Supply Co");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 2 — business type (Supplier is pre-selected from the chosen account type).
    await expect(page.getByRole("heading", { name: /what kind of business/i })).toBeVisible();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 3 — location (optional).
    await expect(page.getByRole("heading", { name: /where are you based/i })).toBeVisible();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 4 — primary branch (optional).
    await expect(page.getByRole("heading", { name: /your primary branch/i })).toBeVisible();
    await page.locator("#bbranch").fill("Cairo HQ");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 5 — review: create is gated on the owner confirmation.
    await expect(page.getByRole("heading", { name: /review and create/i })).toBeVisible();
    const create = page.getByRole("button", { name: /create organization/i });
    await expect(create).toBeDisabled();
    await page.locator("#owner").check();
    await expect(create).toBeEnabled();
    await create.click();

    // The org + active owner membership exist → the owner reaches the workspace.
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    await expect(page.getByText(/Nile Supply Co/)).toBeVisible();
  });

  test("persona isolation: a consumer cannot open the business flow by URL", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerFreshUser(page, request);
    await toAccountType(page, "Consumer Person");

    // Choose Personal use (consumer track) → lands on the consumer flow.
    await page.getByRole("button", { name: /personal use/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/consumer$/, { waitUntil: "commit" });

    // Deep-linking the business flow bounces back to the consumer flow.
    await page.goto("/onboarding/business");
    await expect(page).toHaveURL(/\/onboarding\/consumer$/);
  });
});

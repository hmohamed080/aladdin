import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * Sprint 7.4 — individual persona onboarding. Drives the REAL flow (no bypass):
 * a fresh Email-OTP sign-up + consent, the Sprint 7.3 shared steps, then the
 * persona-specific journey for each of the five individual personas. Resume,
 * Back, the review/handoff terminals, cross-persona URL isolation, and the
 * account-type safety model (no activation; submit only requests review) are all
 * asserted against the real UI + persisted state.
 */

async function prefs(page: Page, locale: "en" | "ar", theme: "light" | "dark") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
  ]);
}
async function noOverflow(page: Page) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(o).toBeLessThanOrEqual(1);
}

/** Register a fresh user and complete the shared steps up to the account-type page. */
async function toAccountType(page: Page, request: APIRequestContext): Promise<string> {
  const email = `ind+${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
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

  await page.locator("#displayName").fill("Persona Tester");
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
  await page.locator("#phone").fill("01012345678");
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  return email;
}

/** Select an account type and land on the resolved persona route. */
async function pickType(page: Page, label: RegExp, landing: RegExp) {
  await page.getByRole("button", { name: label }).click();
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(landing, { waitUntil: "commit" });
}

test.describe("individual persona onboarding", () => {
  test("End Consumer: optional flow → review → completion; resume + Back preserved", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await toAccountType(page, request);
    await pickType(page, /personal use/i, /\/onboarding\/consumer$/);

    // Step 1 — project overview (optional). Progress shows 1 of 5.
    await expect(page.getByText(/step 1 of 5/i)).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: /planning a project/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 2 — interests. Refresh here must resume on interests (intent was saved).
    await expect(page.getByRole("heading", { name: /what are you interested in\?/i })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: /what are you interested in\?/i })).toBeVisible();
    // Back preserves the saved intent selection.
    await page.getByRole("button", { name: /^back$/i }).click();
    await expect(page.getByRole("button", { name: /planning a project/i })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.getByRole("button", { name: /^flooring$/i }).click();
    await page.getByRole("button", { name: /^lighting$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 3 — general location (governorate + general area, no detailed address).
    await expect(page.getByRole("heading", { name: /your general area/i })).toBeVisible();
    await page.locator("#gov").selectOption("cairo");
    await page.locator("#city").selectOption("new_cairo");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 4 — optional budget (visibly optional; skippable).
    await expect(page.getByRole("heading", { name: /approximate budget/i })).toBeVisible();
    await page.getByRole("button", { name: /EGP 100–250k/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 5 — review, then finish → completion terminal (NOT activation).
    await expect(page.getByRole("heading", { name: /review your setup/i })).toBeVisible();
    await page.getByRole("button", { name: /finish setup/i }).click();
    await expect(page.getByRole("heading", { name: /you're all set for now/i })).toBeVisible();
    await expect(page.getByText(/setup complete/i)).toBeVisible();
  });

  test("Engineer / Designer: resolves the concrete type and submits for review", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await toAccountType(page, request);
    await pickType(page, /engineer \/ designer/i, /\/onboarding\/professional$/);

    // Identity — the engineer/designer sub-choice keeps the two types distinct.
    await expect(page.getByText(/step 1 of 6/i)).toBeVisible();
    await noOverflow(page);
    await page.getByRole("button", { name: /^engineer$/i }).click();
    await page.locator("#headline").fill("Structural engineer, Cairo");
    await page.locator("#years").fill("8");
    await page.getByRole("button", { name: /^structural$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Services & skills — at least one core service is required.
    await expect(page.getByRole("heading", { name: /services & skills/i })).toBeVisible();
    await page.getByRole("button", { name: /^design review$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Service location — no office address; a served area (or remote) is required.
    await expect(page.getByRole("heading", { name: /service areas/i })).toBeVisible();
    await page.locator("#gov").selectOption("cairo");
    await page.getByRole("button", { name: /^nasr city$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Portfolio (optional) → verification (info) → review.
    await expect(page.getByRole("heading", { name: /^portfolio$/i })).toBeVisible();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.getByRole("heading", { name: /verification requirements/i })).toBeVisible();
    await page.getByRole("button", { name: /continue to review/i }).click();

    await page.waitForURL(/\/onboarding\/professional\/review$/, { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: /review your professional profile/i })).toBeVisible();
    // The resolved concrete type (Engineer, not Interior designer) is shown.
    await expect(page.getByText(/engineer · 8 years/i)).toBeVisible();
    await page.getByRole("button", { name: /submit for review/i }).click();

    // Submitted terminal — with review, not activated.
    await expect(page.getByText(/your profile is with our team/i)).toBeVisible();
    await expect(page.getByText(/with review/i)).toBeVisible();
  });

  test("Installer / Technician (Arabic + dark): fixed type, RTL, submits for review", async ({ page, request }) => {
    await prefs(page, "ar", "dark");
    await toAccountType(page, request);
    await pickType(page, /فنّي تركيب/, /\/onboarding\/professional$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await noOverflow(page);

    // Fixed persona: no sub-choice; the profession is shown read-only.
    await expect(page.getByText(/هويتك المهنية/)).toBeVisible();
    await page.locator("#headline").fill("تركيبات دقيقة");
    await page.locator("#years").fill("6");
    await page.getByRole("button", { name: /مطابخ وأبواب/ }).click();
    await page.getByRole("button", { name: /متابعة/ }).click();

    await page.getByRole("button", { name: /تركيب مطابخ/ }).click();
    await page.getByRole("button", { name: /متابعة/ }).click();

    await page.locator("#gov").selectOption("cairo");
    await page.getByRole("button", { name: /مدينة نصر/ }).click();
    await page.getByRole("button", { name: /متابعة/ }).click();

    // Portfolio → verification → review.
    await page.getByRole("button", { name: /^متابعة$/ }).click();
    await page.getByRole("button", { name: /متابعة إلى المراجعة/ }).click();
    await page.waitForURL(/\/onboarding\/professional\/review$/, { waitUntil: "commit" });
    await noOverflow(page);
    await page.getByRole("button", { name: /إرسال للمراجعة/ }).click();
    await expect(page.getByText(/ملفك لدى فريقنا/)).toBeVisible();
  });

  test("Contractor: completes the common flow and submits", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await toAccountType(page, request);
    await pickType(page, /^contractor take on/i, /\/onboarding\/professional$/);
    await page.locator("#headline").fill("Finishing contractor");
    await page.locator("#years").fill("12");
    await page.getByRole("button", { name: /full finishing/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^finishing$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.locator("#gov").selectOption("giza");
    await page.getByRole("button", { name: /sheikh zayed/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /continue to review/i }).click();
    await page.waitForURL(/\/onboarding\/professional\/review$/, { waitUntil: "commit" });
    await page.getByRole("button", { name: /submit for review/i }).click();
    await expect(page.getByText(/your profile is with our team/i)).toBeVisible();
  });

  test("Salesperson: individual identity — submits for review, never enters /b2b", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await toAccountType(page, request);
    await pickType(page, /^salesperson work sales/i, /\/onboarding\/professional$/);
    await page.locator("#headline").fill("Showroom sales specialist");
    await page.locator("#years").fill("4");
    await page.getByRole("button", { name: /showroom sales/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /showroom advice/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    // Remote-only is allowed (no office / showroom attachment required).
    await page.getByRole("checkbox", { name: /i offer remote consultations/i }).check();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /continue to review/i }).click();
    await page.waitForURL(/\/onboarding\/professional\/review$/, { waitUntil: "commit" });
    await page.getByRole("button", { name: /submit for review/i }).click();
    await expect(page.getByText(/your profile is with our team/i)).toBeVisible();
    // A salesperson is never silently activated into the sales workspace.
    await expect(page).not.toHaveURL(/\/b2b(\/|$)/);
  });

  test("persona isolation: a consumer cannot open the professional flow by URL", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await toAccountType(page, request);
    await pickType(page, /personal use/i, /\/onboarding\/consumer$/);
    // Deep-linking the professional flow bounces back to the consumer flow.
    await page.goto("/onboarding/professional");
    await expect(page).toHaveURL(/\/onboarding\/consumer$/);
    await page.goto("/onboarding/professional/review");
    await expect(page).toHaveURL(/\/onboarding\/consumer$/);
  });
});

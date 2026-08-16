import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { signIn, IDENTITIES, messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * Sprint 7.3 — shared onboarding engine. Drives the REAL flow (no bypass): a fresh
 * Email-OTP sign-up with consent, then the resumable steps profile → contact →
 * account-type → handoff. Resume, phone-as-unverified, the invited-only rule, and
 * the individual vs business terminals are all asserted against persisted state.
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
  await page.getByLabel(/one-time code|الرمز/i).fill(code);
  await page.getByRole("button", { name: /verify|تأكيد/i }).click();
  await page.waitForURL(/\/onboarding\/profile$/, { waitUntil: "commit" });
  return email;
}

test.describe("shared onboarding", () => {
  test("full flow (individual): profile → contact → account-type → persona handoff", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerFreshUser(page, request);

    // Step 1 — profile. Progress header shows step 1 of 3.
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible();
    await noOverflow(page);
    await page.locator("#displayName").fill("Test Onboarder");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 2 — contact. Email is verified + read-only; phone is collected unverified.
    await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
    await expect(page.getByText(/step 2 of 3/i)).toBeVisible();
    await expect(page.locator("#email")).toHaveAttribute("readonly", "");
    await expect(page.getByText(/not verified yet/i)).toBeVisible();
    await page.locator("#phone").fill("01012345678");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 3 — account type. Pick an individual professional type.
    await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
    await expect(page.getByText(/step 3 of 3/i)).toBeVisible();
    await noOverflow(page);
    // A single "Engineer / Designer" option was split into two personas in an
    // earlier sprint; anchored so it cannot also match "Interior designer".
    await page.getByRole("button", { name: /^engineer$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 4 — persona handoff: a professional now enters the Sprint 7.4 professional
    // onboarding wizard (not the generic handoff panel). Still not activation.
    await page.waitForURL(/\/onboarding\/professional$/, { waitUntil: "commit" });
    await expect(page.getByText(/step 1 of 6/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /your professional identity/i })).toBeVisible();
  });

  test("refresh resumes saved profile; phone persists and stays unverified", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerFreshUser(page, request);

    await page.locator("#displayName").fill("Persisted Name");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });

    // Refresh mid-flow → still on contact (profile step is saved, not lost).
    await page.reload();
    await expect(page).toHaveURL(/\/onboarding\/contact$/);

    // Going back to the profile step shows the saved name.
    await page.goto("/onboarding/profile");
    await expect(page.locator("#displayName")).toHaveValue("Persisted Name");

    // Save phone, then refresh the account-type step: phone remained unverified.
    await page.goto("/onboarding/contact");
    await page.locator("#phone").fill("01234567890");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
    await page.goto("/onboarding/contact");
    await expect(page.locator("#phone")).toHaveValue("01234567890");
    await expect(page.getByText(/not verified yet/i)).toBeVisible();
  });

  test("deep-linking a later step redirects back to the next incomplete step", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerFreshUser(page, request);
    // Profile not done yet → account-type deep link bounces back to profile.
    await page.goto("/onboarding/account-type");
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
    // Complete deep link also bounces to the first incomplete step.
    await page.goto("/onboarding/complete");
    await expect(page).toHaveURL(/\/onboarding\/profile$/);
  });

  test("business selection enters the organization onboarding flow", async ({ page, request }) => {
    await prefs(page, "ar", "dark");
    await registerFreshUser(page, request);
    // Arabic + dark: dir is rtl, no overflow.
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await noOverflow(page);

    await page.locator("#displayName").fill("منشأة تجريبية");
    await page.getByRole("button", { name: /متابعة/ }).click();
    await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
    await page.locator("#phone").fill("01512345678");
    await page.getByRole("button", { name: /متابعة/ }).click();
    await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });

    // Choose Distributor (business) — Arabic label. Sprint 8: the business track now
    // enters the shared organization onboarding wizard (not the generic handoff).
    await page.getByRole("button", { name: /موزّع/ }).click();
    await page.getByRole("button", { name: /متابعة/ }).click();
    await page.waitForURL(/\/onboarding\/business$/, { waitUntil: "commit" });
    // The business identity step is shown (Arabic).
    await expect(page.getByRole("heading", { name: /أنشئ نشاطك التجاري/ })).toBeVisible();
    await noOverflow(page);
  });

  test("sign-out then sign-in resumes the next incomplete step", async ({ page, request }) => {
    await prefs(page, "en", "light");
    const email = await registerFreshUser(page, request);
    await page.locator("#displayName").fill("Resume User");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });

    // Sign out from the onboarding chrome, then sign back in via the real OTP path.
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.waitForURL(/\/auth\/sign-in$/, { waitUntil: "commit" });

    const seen = await messageIdsFor(request, email);
    await page.getByLabel(/email address|البريد/i).fill(email);
    await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();
    await expect(page.getByText(/we sent a code|أرسلنا رمزًا/i)).toBeVisible();
    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز/i).fill(code);
    await page.getByRole("button", { name: /verify|تأكيد/i }).click();

    // An incomplete account signing in is routed to onboarding, resuming at contact.
    await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
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

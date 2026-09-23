import { test, expect } from "@playwright/test";
import { messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * Real, no-bypass E2E coverage for the isolated password-auth preview
 * (docs/frontend/auth-password-preview.md). Every email/OTP round trip goes
 * through the REAL local Supabase + Mailpit, exactly like the existing
 * passwordless suite's `helpers/auth.ts` — no mocked Supabase client here.
 */

function uniqueEmail(tag: string): string {
  return `pw-e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/**
 * Waits for Cloudflare Turnstile's REAL widget (loaded from
 * challenges.cloudflare.com, using the published always-pass TEST site key —
 * see turnstile-widget.tsx) to auto-solve and populate the hidden
 * `captchaToken` input before submitting Create Account or Forgot Password.
 * No auth bypass: the actual Supabase server action requires this token and
 * GoTrue verifies it against the paired TEST secret in config.toml.
 */
async function waitForCaptchaToken(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30000 });
}

const STRONG_PASSWORD = "Zq9$Kx4#WmT7!Pn2Rb";

test.describe("Password registration — golden path", () => {
  test("weak password is rejected in place (no OTP sent, fields preserved)", async ({ page, request }) => {
    const email = uniqueEmail("weakpw");
    await page.goto("/preview/auth-password/sign-up");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill("qwerty12345");
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill("qwerty12345");
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();

    const seen = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();

    // Weak-password rejection keeps the caller on step 1 — never sends an OTP.
    // (The full weak-password decision matrix — common / sequential /
    // account-related / mismatch — is covered by the 22 unit tests in
    // server/actions/auth-password-preview.test.ts; this just proves the
    // browser round-trip surfaces it and does not advance to the OTP step.)
    await expect(page.getByText(/common or easy to guess|شائعة جدًا أو يسهل تخمينها/i)).toBeVisible();
    await expect(page.getByText(/enter the code we sent|أدخل الرمز الذي أرسلناه/i)).toHaveCount(0);
    expect((await messageIdsFor(request, email)).size).toBe(seen.size);
  });

  test("a strong password registers, verifies by OTP, and reaches onboarding", async ({ page, request }) => {
    const email = uniqueEmail("signup");
    await page.goto("/preview/auth-password/sign-up");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();

    const seen = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();

    await expect(page.getByText(/enter the code we sent|أدخل الرمز الذي أرسلناه/i)).toBeVisible();
    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();

    await page.waitForURL(/\/onboarding/, { waitUntil: "commit" });
  });
});

test.describe("CAPTCHA — required on Create Account and Forgot Password, against the REAL Supabase auth.captcha check", () => {
  test("Create Account is refused when the captcha token is missing, and never sends an OTP", async ({ page, request }) => {
    const email = uniqueEmail("nocaptcha-signup");
    // Block Cloudflare's script entirely — deterministic "no token was ever
    // produced," not a "solve then clear the DOM" race. Turnstile refreshes
    // its token in the background periodically; clearing the hidden input's
    // value and then clicking left a real window for a background refresh to
    // repopulate it via React's controlled-input state before the click
    // landed, occasionally submitting a genuinely valid token instead.
    //
    // A SECOND, separate real bug was found and fixed while getting this test
    // green: `sign-up-form.tsx` never actually rendered
    // `authPasswordPreview.error.captchaRequired`/`captchaRejected` anywhere
    // — every other field/section had its own narrow `sendState.code ===`
    // check, and none of them covered the new captcha codes, so the server
    // action was correctly refusing the submission the whole time but the UI
    // silently showed nothing. Fixed by adding an explicit error paragraph
    // next to `TurnstileWidget`. `forgot-password-form.tsx` never had this
    // bug — its one field already used a catch-all `state.code ? t(state.code)
    // : undefined`, which happened to cover the new codes for free.
    await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
    await page.goto("/preview/auth-password/sign-up");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    // Explicit, auto-retrying confirmation the three consents actually
    // registered in React state before submitting — guards against a
    // checkbox toggling at the native-DOM level microseconds before
    // hydration attaches its handler, which a bare `.check()` call alone
    // would not catch (the click "succeeds" but React never sees it).
    await expect(page.getByLabel(/terms of service|شروط الخدمة/i)).toBeChecked();
    await expect(page.getByLabel(/privacy policy|سياسة الخصوصية/i)).toBeChecked();
    await expect(page.getByLabel(/pilot release|إصدار تجريبي/i)).toBeChecked();

    // Never a token to wait for — the script itself never loaded.
    await expect(page.locator('input[name="captchaToken"]')).toHaveValue("");

    const seen = await messageIdsFor(request, email);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();

    // "before continuing" / "قبل المتابعة" only appear in the captchaRequired
    // ERROR text, not in the widget's always-present sr-only label ("Human
    // verification challenge") — a strict-mode-safe, distinguishing match.
    await expect(page.getByText(/before continuing|قبل المتابعة/i)).toBeVisible();
    await expect(page.getByText(/enter the code we sent|أدخل الرمز الذي أرسلناه/i)).toHaveCount(0);
    expect((await messageIdsFor(request, email)).size).toBe(seen.size);
  });

  test("Forgot Password request is refused when the captcha token is missing, and never advances to Screen 2", async ({ page, request }) => {
    const email = uniqueEmail("nocaptcha-forgot");
    await page.route("https://challenges.cloudflare.com/**", (route) => route.abort());
    await page.goto("/preview/auth-password/forgot-password");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await expect(page.locator('input[name="captchaToken"]')).toHaveValue("");

    const seen = await messageIdsFor(request, email);
    await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();

    await expect(page.getByText(/before continuing|قبل المتابعة/i)).toBeVisible();
    await expect(page).toHaveURL(/\/forgot-password$/);
    expect((await messageIdsFor(request, email)).size).toBe(seen.size);
  });
});

/** Registers a fresh account with a strong password and returns its email, leaving the browser signed in. */
async function registerAccount(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, tag: string): Promise<string> {
  const email = uniqueEmail(tag);
  await page.goto("/preview/auth-password/sign-up");
  await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
  const seen = await messageIdsFor(request, email);
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  await expect(page.getByText(/enter the code we sent|أدخل الرمز الذي أرسلناه/i)).toBeVisible();
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
  await page.waitForURL(/\/onboarding/, { waitUntil: "commit" });
  return email;
}

test.describe("Password sign-in", () => {
  test("wrong password shows the generic error; the correct one signs in", async ({ page, request }) => {
    const email = await registerAccount(page, request, "signin");

    // Sign out (production onboarding chrome) and exercise sign-in.
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.goto("/preview/auth-password/sign-in");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill("definitely-the-wrong-one");
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await expect(page.getByText(/don't match|لا يتطابق/i)).toBeVisible();

    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await page.waitForURL(/\/onboarding/, { waitUntil: "commit" });
  });
});

test.describe("Forgot password — full 4-screen journey", () => {
  test("request → verify → reset → success, then the NEW password actually signs in", async ({ page, request }) => {
    const email = await registerAccount(page, request, "forgot");
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();

    // SCREEN 1 — request.
    await page.goto("/preview/auth-password/forgot-password");
    await expect(page).toHaveURL(/\/forgot-password$/);
    const seen = await messageIdsFor(request, email);
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();

    // SCREEN 2 — a real, separate route; masked email; no password field here.
    await page.waitForURL(/\/forgot-password\/verify$/, { waitUntil: "commit" });
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /^verify$|^تحقق$/i }).click();

    // SCREEN 3 — a real, separate route; no email/OTP field shown again.
    await page.waitForURL(/\/forgot-password\/reset$/, { waitUntil: "commit" });
    await expect(page.getByLabel(/email address|البريد الإلكتروني/i)).toHaveCount(0);
    const newPassword = "Nx8!QpL4#RvC9$Sy1e";
    await page.getByLabel(/new password|كلمة المرور الجديدة/i).fill(newPassword);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(newPassword);
    await page.getByRole("button", { name: /reset password|إعادة تعيين كلمة المرور/i }).click();

    // SCREEN 4 — terminal success, no auto-redirect into the app.
    await page.waitForURL(/\/forgot-password\/success$/, { waitUntil: "commit" });
    await expect(page.getByText(/password changed|تم تغيير كلمة المرور/i)).toBeVisible();

    // The account has NO active session at this point (global sign-out) — a
    // fresh Email + Password sign-in with the NEW password is required.
    await page.getByRole("link", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await page.waitForURL(/\/sign-in$/, { waitUntil: "commit" });
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(newPassword);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await page.waitForURL(/\/onboarding/, { waitUntil: "commit" });
  });

  test("direct navigation to Screen 3 without a recovery session redirects to Screen 1", async ({ page }) => {
    await page.goto("/preview/auth-password/forgot-password/reset");
    await page.waitForURL(/\/forgot-password$/, { waitUntil: "commit" });
  });

  test("direct navigation to Screen 2 without requesting a code redirects to Screen 1", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/preview/auth-password/forgot-password/verify");
    await page.waitForURL(/\/forgot-password$/, { waitUntil: "commit" });
  });

  test("recovery isolation: a real, freshly-verified recovery credential (Screen 3, pwr_grant cookie) cannot browse /b2b, /admin, or any other normal application route — it is denied exactly like a fully signed-out caller, against the REAL production middleware and REAL local Supabase", async ({
    page,
    request,
    context,
  }) => {
    const email = await registerAccount(page, request, "recovery-isolation");
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    // Wait for the sign-out redirect to actually land before navigating away
    // again — otherwise this test's own navigation can race the sign-out
    // response's Set-Cookie (clearing the session), leaving a stale sb-*
    // cookie in the jar that has nothing to do with the recovery flow itself.
    await page.waitForURL(/\/sign-in/, { waitUntil: "commit" });

    // Reach Screen 3 for real: Screen 1 request + Screen 2 OTP verify against
    // the live local Supabase instance, exactly like the golden-path test.
    await page.goto("/preview/auth-password/forgot-password");
    const seen = await messageIdsFor(request, email);
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();
    await page.waitForURL(/\/forgot-password\/verify$/, { waitUntil: "commit" });
    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /^verify$|^تحقق$/i }).click();
    await page.waitForURL(/\/forgot-password\/reset$/, { waitUntil: "commit" });

    // At this exact moment the browser holds a real, valid recovery grant
    // (the `pwr_grant` cookie) and NOTHING else — no normal `sb-*-auth-token`
    // session cookie was ever set, because `verifyRecoveryCode` used the
    // isolated client. Confirm that directly before testing the boundary.
    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name === "pwr_grant")).toBe(true);
    expect(cookies.some((c) => /^sb-.*-auth-token/.test(c.name))).toBe(false);

    // The real production middleware (src/middleware.ts) must treat this
    // exactly like a signed-out caller: redirect to sign-in, never render the
    // authenticated shell or let a normal RLS-authorized query run.
    await page.goto("/b2b");
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    await page.goto("/admin");
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    await page.goto("/home");
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    // The recovery grant itself must still be intact and usable for its ONE
    // legitimate purpose after these denied detours — proving the denial
    // above was a route guard, not an accidental consumption of the grant.
    await page.goto("/preview/auth-password/forgot-password/reset");
    await expect(page.getByLabel(/new password|كلمة المرور الجديدة/i)).toBeVisible();
  });
});

/**
 * Registers a GENUINELY passwordless account through the CANONICAL,
 * already-shipped `/auth/sign-up` flow (production `server/actions/auth.ts`
 * — not this preview's own registration). `verifySignUpOtp` never calls
 * `updateUser({password})`, so this account's `encrypted_password` stays
 * null — a real passwordless user with no usable password, not a stand-in.
 * Leaves the browser signed in and returns the email.
 */
async function registerPasswordlessAccount(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext,
  tag: string,
): Promise<string> {
  const email = uniqueEmail(tag);
  await page.goto("/auth/sign-up");
  await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  // The CANONICAL flow's Arabic pilot-consent wording ("نسخة تجريبية") differs
  // from this preview's own ("إصدار تجريبي") — different `auth.*` vs.
  // `authPasswordPreview.*` i18n namespace, same English string. Match both.
  await page.getByLabel(/pilot release|نسخة تجريبية|إصدار تجريبي/i).check();
  const seen = await messageIdsFor(request, email);
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  // Same cross-namespace wording split for the verify button: canonical
  // "تأكيد ومتابعة" ("Confirm and continue") vs. preview's "تحقق وتابع"
  // ("Verify and continue") — identical English, different Arabic.
  await page.getByRole("button", { name: /verify and continue|confirm and continue|تحقق وتابع|تأكيد ومتابعة/i }).click();
  await page.waitForURL(/\/onboarding/, { waitUntil: "commit" });
  return email;
}

test.describe("Existing-passwordless-user migration — real E2E against a genuinely passwordless account", () => {
  test("passwordless login → migrate → reauthentication → set password → logout → Email+Password login succeeds", async ({ page, request, context }) => {
    const email = await registerPasswordlessAccount(page, request, "migrate-golden");
    const newPassword = "Hd4#Nq8!Tz2$WuY7fR";

    // Still signed in from registration (mirrors "an already-signed-in
    // passwordless user visits /migrate", not a fresh OTP login — the
    // migrate route recognizes whatever session already exists, same
    // Supabase project/cookie as the canonical flow).
    await page.goto("/preview/auth-password/migrate");
    await expect(page.getByText(/set a password for your account|عيّن كلمة مرور لحسابك/i)).toBeVisible();

    const seen = await messageIdsFor(request, email);
    await page.getByRole("button", { name: /send verification code|إرسال رمز التحقق/i }).click();
    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(newPassword);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(newPassword);
    await page.getByRole("button", { name: /^set password$|^تعيين كلمة المرور$/i }).click();

    // Accepts EITHER the transient client-side "password set" success
    // message OR the durable "already has a password" state — found
    // empirically: Next.js's own automatic Server Action revalidation
    // re-renders the parent Server Component (`/migrate/page.tsx`) right
    // after `completeMigration` resolves, and since `migrationEligibility()`
    // now correctly reports `hasPassword:true`, that re-render can swap the
    // whole subtree from `<MigrationForm>` (holding the transient client-side
    // "done" state) to `<AlreadyHasPassword>` before the transient message is
    // ever reliably observed — a real race between Next's revalidation and
    // the client-rendered confirmation, not a test bug. Either text proves
    // the same underlying fact (the password was set); the durable
    // Email+Password sign-in below is the real proof either way. See
    // docs/frontend/auth-password-preview.md §Existing-passwordless-user
    // migration for the full note.
    await expect(page.getByText(/password set|تم تعيين كلمة المرور|already has a password|كلمة مرور بالفعل/i)).toBeVisible({
      timeout: 15000,
    });

    // Sign out of the passwordless session, then sign in with the NEW
    // Email + Password credential — no more OTP needed for this account.
    // `/preview/auth-password/migrate`'s own layout has no sign-out control
    // (unlike `/onboarding`'s production chrome the earlier golden-path test
    // uses) — `previewSignOut()` exists as a server action but isn't wired to
    // any button anywhere in the preview UI. Clearing cookies is the
    // pragmatic equivalent here; the REAL sign-out mechanism is already
    // covered by the other tests in this file that do click a real button.
    await context.clearCookies();
    await page.goto("/preview/auth-password/sign-in");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(newPassword);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();

    // Correct canonical landing: reaches an authenticated route, not back at sign-in.
    await page.waitForURL((url) => !/sign-in/.test(url.pathname), { waitUntil: "commit" });
  });

  test("abandon and resume: requesting a migration code without completing it does not corrupt the account, and a later attempt still succeeds", async ({ page, request, context }) => {
    const email = await registerPasswordlessAccount(page, request, "migrate-resume");
    const newPassword = "Kp3&Lm9#Bx6!QwR4vN";

    // First attempt: request the code, then ABANDON — navigate away without
    // ever submitting it (dropped connection / closed tab, simulated).
    await page.goto("/preview/auth-password/migrate");
    await page.getByRole("button", { name: /send verification code|إرسال رمز التحقق/i }).click();
    await expect(page.getByLabel(/one-time code|الرمز لمرة واحدة/i)).toBeVisible();
    await page.goto("/preview/auth-password/sign-in"); // abandon mid-flow

    // The account is untouched — still eligible, no partial/corrupted state.
    await page.goto("/preview/auth-password/migrate");
    await expect(page.getByText(/set a password for your account|عيّن كلمة مرور لحسابك/i)).toBeVisible();

    // Second attempt: request a FRESH code and complete it normally.
    const seen = await messageIdsFor(request, email);
    await page.getByRole("button", { name: /send verification code|إرسال رمز التحقق/i }).click();
    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(newPassword);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(newPassword);
    await page.getByRole("button", { name: /^set password$|^تعيين كلمة المرور$/i }).click();
    // See the golden-path test's comment above: accepts either the transient
    // success message or the durable "already has a password" state, since
    // Next.js's own post-action revalidation can overwrite the transient one.
    await expect(page.getByText(/password set|تم تعيين كلمة المرور|already has a password|كلمة مرور بالفعل/i)).toBeVisible({
      timeout: 15000,
    });

    // Confirm the resumed migration actually took: Email + Password sign-in works.
    // See the golden-path test's comment above re: no sign-out control on
    // this page's layout — clearing cookies is the pragmatic equivalent.
    await context.clearCookies();
    await page.goto("/preview/auth-password/sign-in");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(newPassword);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await page.waitForURL((url) => !/sign-in/.test(url.pathname), { waitUntil: "commit" });
  });
});

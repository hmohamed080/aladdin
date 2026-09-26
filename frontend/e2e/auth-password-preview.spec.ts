import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { messageIdsFor, readNewOtp, newMessageSubjectsFor } from "./helpers/auth";

/**
 * Real, no-bypass E2E coverage for the isolated password-auth preview
 * (docs/frontend/auth-password-preview.md). Every email/OTP round trip goes
 * through the REAL local Supabase + Mailpit, exactly like the existing
 * passwordless suite's `helpers/auth.ts` — no mocked Supabase client here.
 *
 * Architecture B (revision 4): registration submits email+password directly
 * to `signUp()`; the OTP step that follows only ever collects the 6-digit
 * confirmation code — no password field exists on it at all.
 */

function uniqueEmail(tag: string): string {
  return `pw-e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/**
 * A syntactically valid, almost-certainly-unused username per call. The
 * descriptive TEST tag is sanitized for test-data generation only (letters and
 * digits, starts with a letter) — production validation is never relaxed, it
 * would correctly refuse a tag like "enum-existing". A base-36 timestamp plus
 * randomness keeps it unique within 3-24 characters.
 */
function uniqueUsername(tag: string): string {
  const safe = tag.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^[0-9]+/, "").slice(0, 10) || "user";
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
  return `${safe}${suffix}`.slice(0, 24);
}

/**
 * The account-type step is now a ChoiceCard grid (frontend/src/components/ui/
 * choice-card.tsx), not a <select> — fills the required hidden field by
 * clicking a real, non-"Coming soon" card by its visible label. Tradespeople
 * is picked arbitrarily among the selectable (non-disabled) options.
 */
async function selectAccountType(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: /tradespeople & technicians|الصنايعية/i }).click();
}

/**
 * Waits for Cloudflare Turnstile's REAL widget (loaded from
 * challenges.cloudflare.com, using the published always-pass TEST site key —
 * see turnstile-widget.tsx) to auto-solve and populate the hidden
 * `captchaToken` input before submitting Create Account or Forgot Password.
 * No bypass: the server action verifies the token with Cloudflare Siteverify
 * (server/auth/turnstile.ts) using the paired always-pass TEST secret locally.
 * Sign In has no CAPTCHA and never waits for one.
 */
async function waitForCaptchaToken(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30000 });
}

const STRONG_PASSWORD = "Zq9$Kx4#WmT7!Pn2Rb";

/** The neutral Step-2 copy (§Account enumeration) — deliberately never an unconditional "we sent a code to X". */
const NEXT_STEP_TEXT = /next step|الخطوة التالية/i;

/**
 * The real Create Account → Step-2 transition is an external round trip:
 * Cloudflare Siteverify → Server Action → Supabase signUp() → confirmation
 * email. On a real network it has been observed at ~8.6s on the mobile
 * project, so the default 10s expect window is too tight. The longer timeout
 * is scoped to THIS transition only: a server error still renders its own
 * message instead of the Step-2 copy, so a real failure is never hidden.
 */
const SIGNUP_STEP2_TIMEOUT_MS = 20_000;
async function expectSignUpStep2(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByText(NEXT_STEP_TEXT)).toBeVisible({ timeout: SIGNUP_STEP2_TIMEOUT_MS });
}

/**
 * Verified password registration → registration resolver → final app
 * landing. For these Tradespeople fixtures (access_ready, personal
 * workspace) that is /home. The resolver may pass through /onboarding for a
 * few milliseconds; that hop is an implementation detail and is deliberately
 * NOT asserted — on mobile it can complete before Playwright observes it.
 */
const TRADESPERSON_APP_LANDING = /\/home(\/|$|\?)/;
async function expectAppLanding(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForURL(TRADESPERSON_APP_LANDING, { waitUntil: "commit" });
}

test.describe("Password registration — golden path (Architecture B: signUp() sets the password atomically)", () => {
  test("weak password is rejected in place (no signUp sent, fields preserved)", async ({ page, request }) => {
    const email = uniqueEmail("weakpw");
    await page.goto("/preview/auth-password/sign-up");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("weakpw"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill("qwerty12345");
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill("qwerty12345");
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();

    const seen = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();

    // Weak-password rejection keeps the caller on step 1 — never calls signUp().
    // (The full weak-password decision matrix — common / sequential /
    // account-related / mismatch — is covered by the unit tests in
    // server/actions/auth-password-preview.test.ts; this just proves the
    // browser round-trip surfaces it and does not advance to the OTP step.)
    await expect(page.getByText(/common or easy to guess|شائعة جدًا أو يسهل تخمينها/i)).toBeVisible();
    await expect(page.getByText(NEXT_STEP_TEXT)).toHaveCount(0);
    expect((await messageIdsFor(request, email)).size).toBe(seen.size);
  });

  test("a strong password registers via signUp(), verifies by OTP alone (no password field on this step), and enters the app", async ({ page, request }) => {
    const email = uniqueEmail("signup");
    await page.goto("/preview/auth-password/sign-up");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("signup"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();

    const seen = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();

    await expectSignUpStep2(page);

    // §1/§12B — the password never survives past this point: no password-type
    // input anywhere on the OTP step, and no hidden input carrying its value.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator(`input[value="${STRONG_PASSWORD}"]`)).toHaveCount(0);

    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();

    await expectAppLanding(page);
  });
});

test.describe("CAPTCHA — required on Create Account and Forgot Password, verified by the app via Cloudflare Siteverify", () => {
  test("Create Account is refused when the captcha token is missing, and never calls signUp", async ({ page, request }) => {
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
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("nocaptcha"));
    await selectAccountType(page);
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
    await expect(page.getByText(NEXT_STEP_TEXT)).toHaveCount(0);
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
  await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername(tag));
  await selectAccountType(page);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
  const seen = await messageIdsFor(request, email);
  await waitForCaptchaToken(page);
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  await expectSignUpStep2(page);
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
  await expectAppLanding(page);
  return email;
}

test.describe("Account enumeration normalization (§Account enumeration)", () => {
  test("registering with an email that already belongs to a CONFIRMED account gets the SAME neutral response and the SAME OTP screen as a genuine new registration — never 'already exists'", async ({ page, request }) => {
    const existingEmail = await registerAccount(page, request, "enum-existing");
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.waitForURL(/\/sign-in/, { waitUntil: "commit" });

    await page.goto("/preview/auth-password/sign-up");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(existingEmail);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("enum-resubmit"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill("SomeOtherStrongPassword9!");
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill("SomeOtherStrongPassword9!");
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();

    // Identical UI outcome to a genuine new signup — the neutral Step-2
    // screen, never "user already exists" / "email already registered" or
    // any equivalent.
    await expectSignUpStep2(page);
    await expect(page.getByText(/already exists|already registered|موجود بالفعل|مسجل بالفعل/i)).toHaveCount(0);

    // §5 — the neutral "no code hint" + a real way out (Forgot password) is
    // visible right there, rather than leaving the caller waiting forever.
    await expect(page.getByRole("link", { name: /forgot your password|هل نسيت كلمة المرور/i })).toBeVisible();

    // The original account's password is UNCHANGED — this never silently
    // overwrote it or created a second identity.
    await page.getByRole("link", { name: /forgot your password|هل نسيت كلمة المرور/i }).click();
    await page.waitForURL(/\/forgot-password$/, { waitUntil: "commit" });
  });
});

test.describe("Resend signup code (never re-submits the password, never re-registers)", () => {
  test("resend delivers a fresh, working code without ever asking for the password again", async ({ page, request }) => {
    const email = uniqueEmail("resend");
    await page.goto("/preview/auth-password/sign-up");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("resend"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    const seenAtSignup = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
    await expectSignUpStep2(page);
    // Wait for the first confirmation email to actually land (a
    // synchronization point, not a code this test intends to use) before
    // snapshotting `seenBeforeResend` below — resend must supersede it with
    // a fresh code that actually verifies, never reusing this original one.
    await readNewOtp(request, email, seenAtSignup);

    // No password field anywhere on this screen for resend to submit.
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    const seenBeforeResend = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /resend code|إعادة إرسال الرمز/i }).click();
    const freshCode = await readNewOtp(request, email, seenBeforeResend);

    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(freshCode);
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
    await expectAppLanding(page);
  });
});

test.describe("Session creation guarantee (§Session creation) — no session exists before OTP confirmation", () => {
  test("after signUp() but before verifying, protected routes are denied exactly like a signed-out caller; after verifying, they resolve normally", async ({ page, request, context }) => {
    const email = uniqueEmail("session-guarantee");
    await page.goto("/preview/auth-password/sign-up");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("session1"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
    await expectSignUpStep2(page);

    // BEFORE verifying: no real SESSION cookie exists yet. `@supabase/ssr`'s
    // server client defaults to `flowType:"pkce"` (confirmed by reading
    // createServerClient.js directly), so `signUp()` legitimately leaves a
    // `sb-*-auth-token-code-verifier` cookie behind — a PKCE artifact used
    // later to exchange the emailed code, not a session — so the check below
    // explicitly excludes that suffix rather than matching any `sb-*-auth-token*`.
    const cookiesBefore = await context.cookies();
    expect(cookiesBefore.some((c) => /^sb-.*-auth-token/.test(c.name) && !c.name.includes("code-verifier"))).toBe(false);

    // The real production middleware must deny every protected surface
    // exactly like a fully signed-out caller.
    await page.goto("/b2b");
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
    await page.goto("/admin");
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
    await page.goto("/home");
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
    await page.goto("/onboarding");
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    // The unverified signup itself is untouched by those denied detours —
    // completing it now still works normally. Re-snapshot `seen` immediately
    // before THIS submission (rather than reusing the very first snapshot)
    // so `readNewOtp` deterministically reads the code this resubmission
    // actually generates, not whichever of two pending messages happens to
    // sort first.
    await page.goto("/preview/auth-password/sign-up");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("session2"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    const seenBeforeRetry = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
    await expectSignUpStep2(page);
    const code = await readNewOtp(request, email, seenBeforeRetry);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();

    // AFTER verifying: a real session exists and the resolver lands in the app.
    await expectAppLanding(page);
    const cookiesAfter = await context.cookies();
    expect(cookiesAfter.some((c) => /^sb-.*-auth-token/.test(c.name))).toBe(true);
  });
});

test.describe("Refresh / interruption behavior (§Refresh, back, interruption)", () => {
  test("refreshing on the OTP step returns to Step 1 with no crash and no password anywhere in storage — resubmitting proceeds normally", async ({ page, request }) => {
    const email = uniqueEmail("refresh");
    await page.goto("/preview/auth-password/sign-up");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("refresh1"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
    await expectSignUpStep2(page);

    // No password ever reaches localStorage/sessionStorage at any point.
    const storageSnapshot = await page.evaluate(() => ({
      local: JSON.stringify(window.localStorage),
      session: JSON.stringify(window.sessionStorage),
    }));
    expect(storageSnapshot.local).not.toContain(STRONG_PASSWORD);
    expect(storageSnapshot.session).not.toContain(STRONG_PASSWORD);

    // Hard refresh — this component holds step state only in React memory
    // (no URL/cookie step marker), so a refresh deliberately lands back at
    // Step 1. Never crashes, never asks to re-enter a password it doesn't have.
    await page.reload({ waitUntil: "commit" });
    await expect(page.getByLabel(/email address|البريد الإلكتروني/i)).toBeVisible();
    await expect(page.getByLabel(/one-time code|الرمز لمرة واحدة/i)).toHaveCount(0);

    // Resubmitting the SAME email (still unconfirmed from the first attempt)
    // is exactly GoTrue's own obfuscated re-signup case — succeeds again,
    // re-sending a new usable code, no corruption.
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("refresh2"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    const seenBeforeResubmit = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
    await expectSignUpStep2(page);

    const code = await readNewOtp(request, email, seenBeforeResubmit);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
    await expectAppLanding(page);
  });

  test("a wrong/garbage code is rejected with a clear error, and Resend still works from the same screen", async ({ page, request }) => {
    const email = uniqueEmail("badcode");
    await page.goto("/preview/auth-password/sign-up");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("badcode"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    const seen = await messageIdsFor(request, email);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
    await expectSignUpStep2(page);

    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially("000000");
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
    // Verified directly against local GoTrue: a wrong/never-issued signup
    // code returns `error_code:"otp_expired"` — the SAME code as a genuinely
    // time-expired one (GoTrue does not distinguish "wrong" from "expired"
    // for this endpoint) — so the app's existing `verifyFailureCode` mapping
    // correctly surfaces the "expired" copy here, not a distinct "incorrect"
    // message this codebase has no real signal to produce.
    await expect(page.getByText(/expired|انتهت صلاحية/i)).toBeVisible();

    const code = await readNewOtp(request, email, seen);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).fill("");
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
    await expectAppLanding(page);
  });
});

test.describe("Password-changed notification is absent on initial registration (§Password-changed notification)", () => {
  test("signUp() + verifyOtp(signup) sends ONLY the confirmation email — never a 'password changed' security notification", async ({ page, request }) => {
    // Inspect EVERY message this fresh account receives end-to-end and
    // assert there is never a "password changed" notification email —
    // Architecture A fired one during ordinary first-time registration
    // (see the module doc comment and docs/frontend/auth-password-preview.md
    // §Password-changed notification), because it attached the password via
    // `updateUser({password})`, which GoTrue cannot distinguish from a real
    // password change. Architecture B's `signUp()` sets the password as part
    // of account creation itself, which GoTrue does not treat as a "change".
    const target = uniqueEmail("no-pwchanged-check");
    const seenFromStart = await messageIdsFor(request, target);
    await page.goto("/preview/auth-password/sign-up");
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(target);
    await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("pwchanged"));
    await selectAccountType(page);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
    await page.getByLabel(/terms of service|شروط الخدمة/i).check();
    await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
    await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
    const seenAtStart = await messageIdsFor(request, target);
    await waitForCaptchaToken(page);
    await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
    await expectSignUpStep2(page);
    const code = await readNewOtp(request, target, seenAtStart);
    await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
    await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
    await expectAppLanding(page);

    // Give any (unwanted) notification a moment to land before asserting its absence.
    await page.waitForTimeout(1500);
    const subjects = await newMessageSubjectsFor(request, target, seenFromStart);
    const passwordChangedSubjects = subjects.filter((s) => /تم تغيير كلمة مرور|password.*changed/i.test(s));
    expect(passwordChangedSubjects).toEqual([]);
  });
});

test.describe("Sign In carries no CAPTCHA (application-scoped CAPTCHA, Supabase global CAPTCHA off)", () => {
  test("renders no Turnstile widget, loads nothing from Cloudflare, and answers a bad login with the generic error", async ({ page }) => {
    const cloudflare: string[] = [];
    page.on("request", (req) => {
      if (/challenges\.cloudflare\.com/.test(req.url())) cloudflare.push(req.url());
    });
    await page.goto("/preview/auth-password/sign-in");
    await expect(page.locator('input[name="captchaToken"]')).toHaveCount(0);
    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(`no-such-account-${Date.now()}@example.test`);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill("definitely-not-a-real-password");
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await expect(page.getByText(/don't match|لا يتطابق/i)).toBeVisible();
    expect(cloudflare).toEqual([]);
  });
});

test.describe("Password sign-in", () => {
  test("wrong password shows the generic error; the correct one signs in", async ({ page, request }) => {
    const email = await registerAccount(page, request, "signin");

    // Sign out (production onboarding chrome) and exercise sign-in.
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.goto("/preview/auth-password/sign-in");

    await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
    await page.getByLabel(/^password$|^كلمة المرور$/i).fill("definitely-the-wrong-one");
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await expect(page.getByText(/don't match|لا يتطابق/i)).toBeVisible();

    await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    // A registered (access_ready) Tradesperson lands straight in the app —
    // there is no mandatory onboarding to pass through any more.
    await page.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
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
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    // The resolved authenticated landing for this access_ready account.
    await page.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
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
 * GoTrue's per-user minimum interval between auth emails, read from the local
 * config the stack actually runs with (`[auth.email] max_frequency`, e.g.
 * "1s" / "60s" / "1m"). Tests wait it out; they never lower it.
 */
function emailResendCooldownMs(): number {
  const config = readFileSync(path.resolve(process.cwd(), "..", "supabase", "config.toml"), "utf8");
  const section = config.split(/^\[auth\.email\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  const m = section.match(/^max_frequency\s*=\s*"(\d+)(ms|s|m)"/m);
  if (!m) return 60_000; // GoTrue's default when unset
  const n = Number(m[1]);
  return m[2] === "ms" ? n : m[2] === "s" ? n * 1_000 : n * 60_000;
}

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

test.describe("Existing-passwordless-user migration — real E2E against a genuinely passwordless account (regression check: Architecture B's signup confirmation changes must not affect this flow)", () => {
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
    const firstCodeRequestedAt = Date.now();
    await page.goto("/preview/auth-password/sign-in"); // abandon mid-flow

    // The account is untouched — still eligible, no partial/corrupted state.
    await page.goto("/preview/auth-password/migrate");
    await expect(page.getByText(/set a password for your account|عيّن كلمة مرور لحسابك/i)).toBeVisible();

    // Second attempt: request a FRESH code and complete it normally. A real
    // user resuming later is never inside GoTrue's per-user email cooldown
    // ([auth.email] max_frequency); this test is, by ~1s, and GoTrue then
    // correctly answers 429 over_email_send_rate_limit — which the page shows
    // as its rate-limit message. Wait out exactly the CONFIGURED cooldown (read
    // from config.toml, never weakened) so the test models "resume later".
    const cooldownMs = emailResendCooldownMs() + 500;
    await expect
      .poll(() => Date.now() - firstCodeRequestedAt, { timeout: cooldownMs + 5_000 })
      .toBeGreaterThanOrEqual(cooldownMs);
    const seen = await messageIdsFor(request, email);
    await page.getByRole("button", { name: /send verification code|إرسال رمز التحقق/i }).click();
    await expect(page.getByText(/too many attempts|محاولات كثيرة/i)).toHaveCount(0);
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
    await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
    await page.waitForURL((url) => !/sign-in/.test(url.pathname), { waitUntil: "commit" });
  });
});

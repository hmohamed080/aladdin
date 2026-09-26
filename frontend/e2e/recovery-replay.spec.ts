import { test, expect, chromium } from "@playwright/test";
import { messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * Recovery-grant hardening checks (pre-push architecture verification pass):
 * a REAL measured cookie size, and a REAL concurrent-replay test across two
 * fully isolated browser contexts sharing one copied `pwr_grant` value —
 * not an assumption about either property.
 */

function uniqueEmail(tag: string): string {
  return `pw-replay-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

const STRONG_PASSWORD = "Zq9$Kx4#WmT7!Pn2Rb";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.E2E_PORT ?? 3100}`;

/** Real local browser cookie limits this repo cares about (RFC 6265 practical minimums; Chrome/Firefox both enforce ~4096 bytes per cookie). */
const PRACTICAL_COOKIE_BYTE_LIMIT = 4096;

async function reachRecoveryScreen3(
  browser: import("@playwright/test").Browser,
  request: import("@playwright/test").APIRequestContext,
  tag: string,
): Promise<{ email: string; context: import("@playwright/test").BrowserContext; page: import("@playwright/test").Page; grantValue: string }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();

  const email = uniqueEmail(tag);
  await page.goto("/preview/auth-password/sign-up");
  await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30000 });
  let seen = await messageIdsFor(request, email);
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  let code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
  await page.waitForURL(/\/onboarding/, { waitUntil: "commit" });
  await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
  await page.waitForURL(/\/sign-in/, { waitUntil: "commit" });

  await page.goto("/preview/auth-password/forgot-password");
  seen = await messageIdsFor(request, email);
  await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30000 });
  await page.getByRole("button", { name: /send code|إرسال الرمز/i }).click();
  await page.waitForURL(/\/forgot-password\/verify$/, { waitUntil: "commit" });
  code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  await page.getByRole("button", { name: /^verify$|^تحقق$/i }).click();
  await page.waitForURL(/\/forgot-password\/reset$/, { waitUntil: "commit" });

  const cookies = await context.cookies();
  const grantCookie = cookies.find((c) => c.name === "pwr_grant");
  expect(grantCookie, "pwr_grant cookie must be present on Screen 3").toBeTruthy();
  return { email, context, page, grantValue: grantCookie!.value };
}

async function signInWorks(browser: import("@playwright/test").Browser, email: string, password: string): Promise<boolean> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await page.goto("/preview/auth-password/sign-in");
  await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(password);
  // Sign In has no CAPTCHA.
  await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
  await page.waitForTimeout(1500);
  const works = !/sign-in/.test(page.url());
  await context.close();
  return works;
}

test("pwr_grant cookie stays well below practical browser cookie size limits (measured, not estimated)", async ({ request }) => {
  const browser = await chromium.launch();
  const { context, grantValue } = await reachRecoveryScreen3(browser, request, "size");

  const rawByteLength = Buffer.byteLength(grantValue, "utf8");
  // Approximate full Set-Cookie wire line: name + value + the actual attributes this app sets.
  const setCookieLineLength = Buffer.byteLength(
    `pwr_grant=${grantValue}; Path=/preview/auth-password/forgot-password; Max-Age=300; HttpOnly; SameSite=Lax`,
    "utf8",
  );
  console.log(`MEASURED pwr_grant cookie VALUE byte length: ${rawByteLength} bytes`);
  console.log(`MEASURED approximate full Set-Cookie line length: ${setCookieLineLength} bytes`);
  console.log(`Practical per-cookie limit most browsers enforce: ${PRACTICAL_COOKIE_BYTE_LIMIT} bytes`);
  console.log(`Headroom: ${PRACTICAL_COOKIE_BYTE_LIMIT - setCookieLineLength} bytes`);

  expect(setCookieLineLength).toBeLessThan(PRACTICAL_COOKIE_BYTE_LIMIT);
  await context.close();
  await browser.close();
});

test("recovery grant: at most one of two concurrent replays (copied into isolated browser contexts) may succeed", async ({ request }) => {
  const browser = await chromium.launch();
  const { email, context: ctxA, page: pageA, grantValue } = await reachRecoveryScreen3(browser, request, "golden");

  // Copy the EXACT encrypted cookie value into a second, fully isolated
  // browser context — simulating an attacker (or a duplicate tab/device)
  // who intercepted or otherwise obtained the raw grant value.
  const ctxB = await browser.newContext({ baseURL: BASE_URL });
  await ctxB.addCookies([
    {
      name: "pwr_grant",
      value: grantValue,
      domain: "127.0.0.1",
      path: "/preview/auth-password/forgot-password",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const pageB = await ctxB.newPage();
  await pageB.goto("/preview/auth-password/forgot-password/reset");
  await expect(pageB.getByLabel(/new password|كلمة المرور الجديدة/i)).toBeVisible();

  const passwordA = "Aa1!ReplayCandidateOne9Xy";
  const passwordB = "Bb2@ReplayCandidateTwo7Zw";
  await pageA.getByLabel(/new password|كلمة المرور الجديدة/i).fill(passwordA);
  await pageA.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(passwordA);
  await pageB.getByLabel(/new password|كلمة المرور الجديدة/i).fill(passwordB);
  await pageB.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(passwordB);

  // Fire both submissions as close to simultaneously as Playwright allows —
  // a genuine race, not a sequential "try A then try B."
  const [resultA, resultB] = await Promise.allSettled([
    (async () => {
      await pageA.getByRole("button", { name: /reset password|إعادة تعيين كلمة المرور/i }).click();
      await pageA.waitForURL(/\/forgot-password\/(success|reset)$/, { waitUntil: "commit", timeout: 15000 }).catch(() => {});
      return pageA.url();
    })(),
    (async () => {
      await pageB.getByRole("button", { name: /reset password|إعادة تعيين كلمة المرور/i }).click();
      await pageB.waitForURL(/\/forgot-password\/(success|reset)$/, { waitUntil: "commit", timeout: 15000 }).catch(() => {});
      return pageB.url();
    })(),
  ]);

  const urlA = resultA.status === "fulfilled" ? resultA.value : "ERROR";
  const urlB = resultB.status === "fulfilled" ? resultB.value : "ERROR";
  const successA = /\/forgot-password\/success$/.test(urlA);
  const successB = /\/forgot-password\/success$/.test(urlB);
  console.log(`Context A: ${urlA} (reported success=${successA})`);
  console.log(`Context B: ${urlB} (reported success=${successB})`);
  // Known UX gap (not fixed this pass, not security-relevant): whichever
  // context loses the race stays on Screen 3 with NO error message at all —
  // `resetPasswordAndSignOut` returns `recoveryStateMissing`, but by then the
  // grant cookie has already been deleted by the WINNING request in the
  // SAME browser-cookie-jar sense only when it's the same context; across
  // two independent contexts the loser simply sees its own request fail
  // with no explanation. See docs/frontend/auth-password-preview.md
  // §Recovery-session security for the full note.

  // Ground truth: query which password (if either) actually authenticates —
  // this is the real security property, independent of what the UI reported.
  const [passwordAWorks, passwordBWorks] = await Promise.all([
    signInWorks(browser, email, passwordA),
    signInWorks(browser, email, passwordB),
  ]);
  console.log(`passwordA authenticates: ${passwordAWorks}`);
  console.log(`passwordB authenticates: ${passwordBWorks}`);

  await ctxA.close();
  await ctxB.close();
  await browser.close();

  // The required security property: never BOTH. Empirically, across
  // multiple manual trials during this verification pass, exactly one
  // request won each time (which one varied — a genuine race, not a
  // deterministic ordering bug) — this holds because GoTrue invalidates the
  // underlying session as part of the same `updateUser({password})` call
  // that a concurrent duplicate relies on, NOT because this preview's own
  // code enforces single-use server-side. That distinction matters: it is
  // an emergent side effect of GoTrue's implementation, not a designed,
  // documented guarantee this codebase controls — see the proposed
  // JTI/nonce hardening in docs/frontend/auth-password-preview.md
  // §Recovery-session security for why this assertion should not be the
  // only line of defense going forward.
  expect(passwordAWorks && passwordBWorks, "at most one concurrent recovery-grant replay may succeed").toBe(false);
});

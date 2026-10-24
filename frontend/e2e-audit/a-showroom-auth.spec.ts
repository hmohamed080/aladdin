import { test, type Page } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { FIXTURE_PASSWORD, OUT, RUN, admin, expect, scenario } from "./audit-helpers";

/**
 * Journey A — Showroom phone authentication (PR #84), through the real UI and
 * server actions. ONE disposable showroom account per run (random mobile
 * number), recorded in traces/fixtures.json; a rerun reuses it.
 */
const J = "A. Showroom auth";
const FIX = `${OUT}/traces/fixtures.json`;
const fixtures = existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")) : {};
const phoneLocal: string = fixtures.showroomPhone ?? `010${String(Date.now()).slice(-8)}`;
const name = fixtures.showroomName ?? `Audit Showroom ${RUN}`;
const save = (patch: Record<string, unknown>) => {
  const cur = existsSync(FIX) ? JSON.parse(readFileSync(FIX, "utf8")) : {};
  writeFileSync(FIX, JSON.stringify({ ...cur, ...patch }, null, 2));
};

async function fillSignUp(page: Page, phone: string, password: string, confirm = password) {
  await page.goto("/showroom/sign-up");
  await page.locator("#name").fill(name);
  await page.locator('input[name="phone"]').fill(phone);
  await page.locator("#password").fill(password);
  await page.locator("#confirmPassword").fill(confirm);
  await page.locator("#showroom-consent").check({ force: true });
}
const submitUp = (page: Page) => page.locator('form[data-showroom-form="signUp"] button[type="submit"]').click();
const submitIn = (page: Page) => page.locator('form[data-showroom-form="signIn"] button[type="submit"]').click();
const waitCaptcha = (page: Page, names = ["captchaToken", "captchaSessionToken"]) =>
  page.waitForFunction((n) => n.every((x) => Boolean(document.querySelector<HTMLInputElement>(`input[name="${x}"]`)?.value)), names, { timeout: 30_000 });
/** First alert that actually carries text (empty live regions ignored). */
async function alertText(page: Page): Promise<string> {
  await expect
    .poll(async () => (await page.locator('[role="alert"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  return (await page.locator('[role="alert"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean)[0]!;
}

test.describe.serial("Journey A — showroom auth", () => {
  test("A1-A5 registration form and client validation", async ({ page }) => {
    await scenario({ journey: J, id: "A1", scenario: "Showroom registration form renders", role: "anonymous", data: "-", expected: "name, phone, password, confirm, consent, Turnstile" }, async () => {
      await page.goto("/showroom/sign-up");
      for (const sel of ["#name", 'input[name="phone"]', "#password", "#confirmPassword", "#showroom-consent"]) await expect(page.locator(sel)).toHaveCount(1);
      await waitCaptcha(page);
      return "all fields present; Turnstile (local test key) tokens issued";
    }, page);
    for (const [id, bad] of [["A3a", "12345"], ["A3b", "010123"], ["A3c", "0151234567890"], ["A3d", "abcdefghijk"]] as const) {
      await scenario({ journey: J, id, scenario: `Invalid phone rejected (${bad})`, role: "anonymous", data: bad, expected: "inline phone error; no account" }, async () => {
        await fillSignUp(page, bad, FIXTURE_PASSWORD);
        await submitUp(page);
        const msg = await alertText(page);
        await expect(page).toHaveURL(/\/showroom\/sign-up/);
        return `blocked: "${msg.slice(0, 80)}"`;
      }, page);
    }
    await scenario({ journey: J, id: "A5a", scenario: "Weak password rejected", role: "anonymous", data: "12345678", expected: "password policy error" }, async () => {
      await fillSignUp(page, phoneLocal, "12345678");
      await submitUp(page);
      await expect(page.locator("#password-error")).toBeVisible({ timeout: 20_000 });
      return `blocked: "${(await page.locator("#password-error").innerText()).slice(0, 80)}"`;
    }, page);
    await scenario({ journey: J, id: "A5b", scenario: "Password confirmation mismatch rejected", role: "anonymous", data: "mismatch", expected: "confirm error" }, async () => {
      await fillSignUp(page, phoneLocal, FIXTURE_PASSWORD, FIXTURE_PASSWORD + "x");
      await submitUp(page);
      await expect(page.locator("#confirmPassword-error")).toBeVisible({ timeout: 20_000 });
      return `blocked: "${(await page.locator("#confirmPassword-error").innerText()).slice(0, 80)}"`;
    }, page);
  });

  test("A2 valid registration creates the account", async ({ page }) => {
    test.skip(Boolean(fixtures.showroomPhone), "the run's disposable account already exists");
    await scenario({ journey: J, id: "A2", scenario: "Valid showroom registration (disposable mobile)", role: "anonymous", data: "random 010… number", expected: "account created → /onboarding/business" }, async () => {
      await fillSignUp(page, phoneLocal, FIXTURE_PASSWORD);
      await waitCaptcha(page);
      const t0 = Date.now();
      await Promise.all([page.waitForURL(/\/onboarding/, { timeout: 45_000 }), submitUp(page)]);
      save({ showroomPhone: phoneLocal, showroomName: name, run: RUN, showroomPassword: "(generated in-process, not stored)" });
      return `landed on ${new URL(page.url()).pathname} after ${Date.now() - t0} ms`;
    }, page);
  });

  test("A4 duplicate phone rejected", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await scenario({ journey: J, id: "A4", scenario: "Duplicate phone rejected", role: "anonymous", data: "same phone as A2", expected: "phone-taken error; still one account" }, async () => {
      await fillSignUp(page, phoneLocal, FIXTURE_PASSWORD);
      await waitCaptcha(page);
      await submitUp(page);
      const msg = await alertText(page);
      await expect(page).toHaveURL(/\/showroom\/sign-up/);
      const { count } = await admin.from("profiles").select("user_id", { count: "exact", head: true }).like("phone_e164", `%${phoneLocal.slice(1)}`);
      expect(count).toBe(1);
      return `refused: "${msg.slice(0, 100)}"; accounts with that phone: ${count}`;
    }, page);
  });

  test("A6-A11 sign-in, redirects, session, logout", async ({ browser }) => {
    test.skip(!existsSync(FIX) && !fixtures.showroomPhone, "needs A2");
    // the run's password is generated per process: re-key the DISPOSABLE fixture account only
    const uid = (await admin.from("profiles").select("user_id").like("phone_e164", `%${phoneLocal.slice(1)}`).single()).data!.user_id as string;
    const { error: pwErr } = await admin.auth.admin.updateUserById(uid, { password: FIXTURE_PASSWORD });
    if (pwErr) throw new Error("could not re-key the fixture account");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await scenario({ journey: J, id: "A7", scenario: "Invalid credentials rejected", role: "anonymous", data: "wrong password", expected: "generic error, stays on sign-in" }, async () => {
      await page.goto("/showroom/sign-in");
      await page.locator('input[name="phone"]').fill(phoneLocal);
      await page.locator("#password").fill(FIXTURE_PASSWORD + "wrong");
      await waitCaptcha(page, ["captchaToken"]).catch(() => undefined);
      await submitIn(page);
      const msg = await alertText(page);
      await expect(page).toHaveURL(/\/showroom\/sign-in/);
      return `refused: "${msg.slice(0, 100)}"`;
    }, page);
    await scenario({ journey: J, id: "A8", scenario: "Protected route redirects anonymous visitor", role: "anonymous", data: "/b2b/leads", expected: "redirect to sign-in with next" }, async () => {
      await page.goto("/b2b/leads");
      await expect(page).toHaveURL(/sign-in/);
      return `→ ${new URL(page.url()).pathname}${new URL(page.url()).search}`;
    }, page);
    await scenario({ journey: J, id: "A6+A9", scenario: "Valid showroom sign-in; hostile next ignored", role: "showroom (fixture)", data: "next=https://evil.example/steal", expected: "signed in; stays on localhost" }, async () => {
      await page.goto("/showroom/sign-in?next=https%3A%2F%2Fevil.example%2Fsteal");
      await page.locator('input[name="phone"]').fill(phoneLocal);
      await page.locator("#password").fill(FIXTURE_PASSWORD);
      await waitCaptcha(page, ["captchaToken"]).catch(() => undefined);
      const t0 = Date.now();
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/showroom/sign-in"), { timeout: 30_000 }), submitIn(page)]);
      const u = new URL(page.url());
      if (u.hostname !== "localhost") throw new Error(`OPEN REDIRECT to ${u.hostname}`);
      return `landed on ${u.pathname} after ${Date.now() - t0} ms (hostile next ignored)`;
    }, page);
    await scenario({ journey: J, id: "A10", scenario: "Session persists in a new tab", role: "showroom (fixture)", data: "-", expected: "still signed in" }, async () => {
      const p2 = await ctx.newPage();
      await p2.goto("/onboarding");
      await expect(p2).not.toHaveURL(/sign-in/);
      return `new tab /onboarding → ${new URL(p2.url()).pathname}`;
    }, page);
    await scenario({ journey: J, id: "A11", scenario: "Logout ends the session (UI control)", role: "showroom (fixture)", data: "-", expected: "protected route redirects after logout" }, async () => {
      await page.goto("/onboarding/business");
      const ctl = page.getByRole("button", { name: /تسجيل الخروج|خروج|Sign out|Log out/ }).first();
      if (await ctl.count()) {
        await ctl.click();
        await page.waitForTimeout(1500);
      } else {
        throw new Error("no visible sign-out control on /onboarding/business");
      }
      await page.goto("/b2b");
      await expect(page).toHaveURL(/sign-in/);
      return `after sign-out /b2b → ${new URL(page.url()).pathname}`;
    }, page);
  });
});

test("A12 fixture account state (read-only)", async () => {
  await scenario({ journey: J, id: "A12", scenario: "Created account: one user, phone stored E.164, no organization before onboarding", role: "service (read-only)", data: "A2 account", expected: "1 user; 0 memberships" }, async () => {
    const { data } = await admin.from("profiles").select("user_id, phone_e164").like("phone_e164", `%${phoneLocal.slice(1)}`);
    expect(data?.length).toBe(1);
    const uid = data![0]!.user_id as string;
    const { data: u } = await admin.from("users").select("primary_account_type").eq("id", uid).single();
    const { count } = await admin.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", uid);
    save({ showroomUserId: uid });
    return `persona=${u?.primary_account_type ?? "null"}; memberships=${count}`;
  });
});

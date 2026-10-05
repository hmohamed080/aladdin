import { execSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

/**
 * Installer/Technician phone + password flow (docs/frontend/installer-phone-auth.md),
 * end to end against the REAL local Supabase (GoTrue + Postgres + RLS) and the
 * real server actions. No auth bypass: the account is created by the app,
 * signed in by GoTrue's password grant, and initialized through the canonical
 * RPCs; the database is then inspected directly.
 *
 * TURNSTILE: sign-up is Turnstile-gated. Where challenges.cloudflare.com is
 * reachable the real widget + Cloudflare's published test keys run unchanged.
 * Where it is not (the cloud sandbox), set E2E_TURNSTILE_STUB=1 and serve a
 * local Siteverify stand-in (see the doc's "Local verification" section): the
 * browser then gets a stub widget script instead of Cloudflare's, and the
 * server's Siteverify call still runs for real against that stand-in.
 */

const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const ALIAS_MARKER = "craftsman-login";
const PASSWORD = "green-tiles-on-roof";

function sql(query: string): string {
  return execSync(`docker exec -i ${DB} psql -U postgres -d postgres -At -F '|'`, { input: query }).toString().trim();
}

function uniquePhone(): string {
  // A valid Egyptian mobile (010 + 8 digits), unique per run.
  return `010${String(Date.now()).slice(-5)}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

async function stubTurnstile(page: Page): Promise<void> {
  if (process.env.E2E_TURNSTILE_STUB !== "1") return;
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},50);return "w"},remove:function(){}};`,
    }),
  );
}

/** Every rendered byte of the page — visible text, attributes AND the RSC payload. */
async function expectNoAlias(page: Page): Promise<void> {
  const html = await page.content();
  expect(html, `internal login alias leaked on ${page.url()}`).not.toContain(ALIAS_MARKER);
  expect(html).not.toContain(".invalid");
}

async function fillSignUp(page: Page, { name, phone, password = PASSWORD }: { name: string; phone: string; password?: string }) {
  await page.getByLabel("الاسم الكامل").fill(name);
  await page.getByLabel("رقم الهاتف").fill(phone);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  await page.getByRole("checkbox").check();
}

async function submitSignUp(page: Page) {
  // Wait for the (stub or real) Turnstile token before submitting.
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 20_000 });
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
}

async function register(page: Page, name: string, phone: string): Promise<void> {
  await stubTurnstile(page);
  await page.goto("/installer/sign-up");
  await fillSignUp(page, { name, phone });
  await submitSignUp(page);
  await page.waitForURL(/\/home(\/|$)/, { waitUntil: "commit", timeout: 30_000 });
}

/** Submit sign-in and wait for THAT attempt's server action to settle (the form resets after each one). */
async function attemptSignIn(page: Page, phone: string, password: string): Promise<void> {
  await page.getByLabel("رقم الهاتف").fill(phone);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
  const settled = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/installer/sign-in"));
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await settled;
}

test.describe("installer phone + password auth", () => {
  test("sign-up creates a normal installer/technician account and lands on /home", async ({ page }) => {
    const phone = uniquePhone();
    const name = `صنايعي اختبار ${phone.slice(-4)}`;
    await register(page, name, phone);

    // The existing installer dashboard, not a temporary one.
    await expect(page).toHaveURL(/\/home$/);
    await expectNoAlias(page);

    const e164 = `+20${phone.slice(1)}`;
    const row = sql(`
      select a.raw_app_meta_data->>'registration_source',
             a.email_confirmed_at is not null,
             a.phone is null,
             p.display_name,
             p.phone_e164,
             p.phone_country_iso2,
             p.username,
             io.prof_concrete_type,
             op.selected_persona,
             (select count(distinct consent_type) from public.consent_receipts c where c.user_id = a.id),
             u.status
      from public.profiles p
      join auth.users a on a.id = p.user_id
      join public.users u on u.id = a.id
      left join public.individual_onboarding io on io.user_id = a.id
      left join public.onboarding_progress op on op.user_id = a.id
      where p.phone_e164 = '${e164}';`);
    const [source, confirmed, noAuthPhone, displayName, storedPhone, iso2, username, declared, persona, consents] = row.split("|");
    expect(source).toBe("temporary_craftsman_password_flow");
    expect(confirmed).toBe("t");
    expect(noAuthPhone).toBe("t");
    expect(displayName).toBe(name);
    expect(storedPhone).toBe(e164);
    expect(iso2).toBe("EG");
    expect(username).toMatch(/^craftsman\.[a-z0-9]{8}$/);
    expect(declared).toBe("installer_technician");
    expect(persona).toBe("installer_technician");
    expect(consents).toBe("3");

    // The alias never reaches personal settings or the profile page either.
    for (const path of ["/home/settings", "/settings/profile"]) {
      await page.goto(path);
      await expectNoAlias(page);
    }
  });

  test("duplicate phone, invalid phone and weak password are refused with Arabic messages", async ({ page }) => {
    const phone = uniquePhone();
    await register(page, "صنايعي مكرر", phone);
    await page.context().clearCookies();

    await stubTurnstile(page);
    await page.goto("/installer/sign-up");

    // Invalid phone + weak password — caught before anything is created.
    await fillSignUp(page, { name: "صنايعي", phone: "0100", password: "abc" });
    await page.getByRole("button", { name: "إنشاء الحساب" }).click();
    await expect(page.getByText("من فضلك أدخل رقم هاتف صحيح")).toBeVisible();
    await expect(page.getByText("يجب أن تتكون كلمة المرور من 10 أحرف على الأقل")).toBeVisible();

    // Duplicate (same number typed in international form) — server-side check.
    await page.getByLabel("رقم الهاتف").fill(`+20${phone.slice(1)}`);
    await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
    await submitSignUp(page);
    await expect(page.getByText("يوجد حساب مسجل بالفعل بهذا الرقم")).toBeVisible();
    const signInLink = page.getByRole("link", { name: "تسجيل الدخول بدلًا من ذلك" });
    await expect(signInLink).toHaveAttribute("href", "/installer/sign-in");
    expect(sql(`select count(*) from public.profiles where phone_e164 = '+20${phone.slice(1)}';`)).toBe("1");
  });

  test("sign-in with phone + password; wrong password gets one generic message", async ({ page }) => {
    const phone = uniquePhone();
    await register(page, "صنايعي دخول", phone);
    await page.context().clearCookies();

    await page.goto("/installer/sign-in");
    await expect(page.getByRole("link", { name: "إنشاء حساب جديد" })).toHaveAttribute("href", "/installer/sign-up");
    await expect(page.getByText(/نسيت كلمة المرور/)).toHaveCount(0);

    const generic = "رقم الهاتف أو كلمة المرور غير صحيحة. تحقق منهما وحاول مجددًا.";
    await attemptSignIn(page, phone, "not-the-right-one");
    await expect(page.getByText(generic)).toBeVisible();

    // An unknown number gets the identical message.
    await attemptSignIn(page, uniquePhone(), PASSWORD);
    await expect(page.getByText(generic)).toBeVisible();

    await page.getByLabel("رقم الهاتف").fill(phone);
    await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    await page.waitForURL(/\/home$/, { waitUntil: "commit" });
    await expectNoAlias(page);

    // Signed in: the installer entry points step aside, like /auth/* does
    // (middleware → /onboarding → the caller's landing).
    for (const path of ["/installer/sign-up", "/installer/sign-in"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/installer\/sign-/);
    }
  });

  test("Admin sees the account like any registered craftsman, without the alias", async ({ page, request }) => {
    const phone = uniquePhone();
    const name = `صنايعي أدمن ${phone.slice(-4)}`;
    await register(page, name, phone);
    await page.context().clearCookies();

    await signIn(page, request, IDENTITIES.admin, /\/admin(\/|$)/);
    await page.goto(`/admin/users?q=${encodeURIComponent(name)}`);
    const link = page.getByRole("link", { name });
    await expect(link).toBeVisible();
    await expectNoAlias(page);
    await link.click();
    await expect(page.getByText(name).first()).toBeVisible();
    await expectNoAlias(page);
  });

  test("the canonical /auth flow is email + password (never phone); sign-in keeps one installer link", async ({ page }) => {
    for (const path of ["/auth/sign-up", "/auth/sign-in"]) {
      await page.goto(path);
      await expect(page.locator('input[type="email"]')).toHaveCount(1);
      await expect(page.locator('input[name="password"]')).toHaveCount(1);
      await expect(page.locator('input[type="tel"]')).toHaveCount(0);
    }
    await page.goto("/auth/sign-up");
    await expect(page.locator('a[href^="/installer/"]')).toHaveCount(0);
    await page.goto("/auth/sign-in");
    const installerLink = page.locator('a[href^="/installer/"]');
    await expect(installerLink).toHaveCount(1);
    await expect(installerLink).toHaveAttribute("href", "/installer/sign-in");
    await expect(installerLink).toHaveText("صنايعي؟ سجل الدخول برقم الهاتف");
  });

  test("/auth/sign-in forwards only a validated next to the installer link", async ({ page }) => {
    await page.goto("/auth/sign-in?next=%2Fhome%2Fpoints");
    await expect(page.locator('a[href^="/installer/"]')).toHaveAttribute("href", "/installer/sign-in?next=%2Fhome%2Fpoints");
    for (const unsafe of ["%2F%2Fevil.example", "https%3A%2F%2Fevil.example", "%2F%5Cevil.example"]) {
      await page.goto(`/auth/sign-in?next=${unsafe}`);
      await expect(page.locator('a[href^="/installer/"]')).toHaveAttribute("href", "/installer/sign-in");
    }
  });

  test("old /temporary/craftsman URLs permanently redirect to /installer, keeping the query", async ({ page, request }) => {
    const res = await request.get("/temporary/craftsman/sign-in?next=%2Fhome%2Fpoints", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("/installer/sign-in?next=%2Fhome%2Fpoints");
    const up = await request.get("/temporary/craftsman/sign-up", { maxRedirects: 0 });
    expect(up.status()).toBe(308);
    expect(up.headers()["location"]).toBe("/installer/sign-up");
    await page.goto("/temporary/craftsman/sign-up");
    await expect(page).toHaveURL(/\/installer\/sign-up$/);
  });

  test("homepage installer role leads to the installer phone sign-up", async ({ page }) => {
    await page.goto("/");
    // The canonical Landing (LandingEcosystem) lists every role as a card; the
    // installers' card opens a dialog whose register link is the phone sign-up.
    const card = page.locator("article").filter({ hasText: /للصنايعية|Installers/ });
    await expect(card).toHaveCount(1);
    await card.getByRole("button").click();
    const register = page.locator('dialog[open] a[href="/installer/sign-up"]');
    await expect(register).toHaveCount(1);
    await register.click();
    await expect(page).toHaveURL(/\/installer\/sign-up$/);
  });

  test("signed-out deep link: shared sign-in → installer link keeps a validated next → lands there", async ({ page }) => {
    const phone = uniquePhone();
    await register(page, "صنايعي رابط", phone);
    await page.context().clearCookies();

    // A shared protected route has no installer context: the shared sign-in, with next.
    await page.goto("/home/points");
    await expect(page).toHaveURL(/\/auth\/sign-in\?next=%2Fhome%2Fpoints$/);
    const link = page.locator('a[href^="/installer/sign-in"]');
    await expect(link).toHaveAttribute("href", "/installer/sign-in?next=%2Fhome%2Fpoints");
    await link.click();
    await expect(page).toHaveURL(/\/installer\/sign-in\?next=%2Fhome%2Fpoints$/);

    await attemptSignIn(page, phone, PASSWORD);
    await page.waitForURL(/\/home\/points$/, { waitUntil: "commit" });
  });

  test("no open redirect: hostile next values fall back to the installer's own landing", async ({ page }) => {
    const phone = uniquePhone();
    await register(page, "صنايعي أمان", phone);
    for (const next of ["https://evil.example/home", "//evil.example/home", "/\\evil.example", "/b2b"]) {
      await page.context().clearCookies();
      await page.goto(`/installer/sign-in?next=${encodeURIComponent(next)}`);
      await attemptSignIn(page, phone, PASSWORD);
      await page.waitForURL((url) => url.origin === new URL(page.url()).origin && url.pathname === "/home", { waitUntil: "commit" });
      expect(new URL(page.url()).host).toBe("127.0.0.1:3100");
    }
  });

  test("sign-out returns a phone installer to the installer sign-in", async ({ page }) => {
    const phone = uniquePhone();
    await register(page, "صنايعي خروج", phone);
    await page.goto("/home/settings");
    await page.getByRole("button", { name: /تسجيل الخروج|Sign out|Log out/ }).filter({ visible: true }).first().click();
    await page.waitForURL(/\/installer\/sign-in$/, { waitUntil: "commit" });
    // …and the session is really gone.
    await page.goto("/home");
    await expect(page).toHaveURL(/\/auth\/sign-in/);
  });

  test("a phone account never enters the email password-migration flow, and its alias never reaches the client", async ({ page }) => {
    const phone = uniquePhone();
    await register(page, "صنايعي ترحيل", phone);

    for (const path of ["/preview/auth-password/migrate", "/preview/auth-password/change-password"]) {
      // The server's raw answer, redirects NOT followed — a document request and
      // a client-navigation (RSC) request. Neither may carry the alias.
      for (const headers of [{}, { RSC: "1" }] as Record<string, string>[]) {
        const res = await page.request.get(path, { maxRedirects: 0, headers });
        expect(await res.text(), `${path} response leaked the alias`).not.toContain(ALIAS_MARKER);
        if (res.status() >= 300 && res.status() < 400) expect(res.headers().location).toBe("/home/settings");
      }
      // Direct navigation lands on the account's own settings, not the migration form.
      await page.goto(path);
      await page.waitForURL(/\/home\/settings$/, { waitUntil: "commit" });
      await expect(page.locator('form input[name="token"], input[name="confirmPassword"], input[name="currentPassword"]')).toHaveCount(0);
      await expectNoAlias(page);
      const text = await page.locator("body").innerText();
      expect(text).not.toContain(ALIAS_MARKER);
      // The settings copy states how THIS account signs in: phone + password,
      // never the email + password text (either locale).
      expect(text).toMatch(/phone number you registered with and your password|برقم الهاتف الذي سجّلت به وكلمة المرور/);
      expect(text).not.toMatch(/your email address and your password|ببريدك الإلكتروني وكلمة المرور/);
    }
  });

  test("an email account keeps the email + password sign-in copy in settings", async ({ page, request }) => {
    await signIn(page, request, "hossam@example.test", /\/home$/);
    await page.goto("/home/settings");
    const text = await page.locator("body").innerText();
    expect(text).toMatch(/your email address and your password|ببريدك الإلكتروني وكلمة المرور/);
    expect(text).not.toMatch(/phone number you registered with|برقم الهاتف الذي سجّلت به/);
  });

  test("layout: no horizontal overflow, RTL, no navbar/footer", async ({ page }) => {
    for (const path of ["/installer/sign-up", "/installer/sign-in"]) {
      await stubTurnstile(page);
      await page.goto(path);
      await expect(page.locator('[dir="rtl"]').first()).toBeVisible();
      await expect(page.locator("nav, footer")).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});

import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { IDENTITIES, messageIdsFor, readNewOtp, signIn } from "./helpers/auth";

/**
 * Staging-prep registration + profile completion, end to end against the REAL
 * local Supabase + Mailpit (no auth bypass): the 9-card account-type step,
 * direct post-OTP entry (no six-step wizard), the username_pending recovery
 * screen, and the persistent "Complete your profile" card driven by
 * my_profile_completion() — display name confirmation, phone (country picker,
 * reload persistence, neutral duplicate), avatar crop/upload/replace/cancel.
 */

const STRONG_PASSWORD = "Zq9$Kx4#WmT7!Pn2Rb";

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e5)}`;
}
function uniqueEmail(tag: string): string {
  return `pc-e2e-${tag}-${uniq()}@example.test`;
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
/** An Egyptian mobile national number unlikely to collide across runs. */
function uniqueEgMobile(): string {
  return `10${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

async function fillSignUp(page: Page, email: string, username: string): Promise<void> {
  await page.goto("/preview/auth-password/sign-up");
  await page.getByLabel(/email address|البريد الإلكتروني/i).fill(email);
  await page.getByLabel(/^username$|^اسم المستخدم$/i).fill(username);
  await page.getByRole("button", { name: /tradespeople & technicians|الصنايعية/i }).click();
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/confirm password|تأكيد كلمة المرور/i).fill(STRONG_PASSWORD);
  await page.getByLabel(/terms of service|شروط الخدمة/i).check();
  await page.getByLabel(/privacy policy|سياسة الخصوصية/i).check();
  await page.getByLabel(/pilot release|إصدار تجريبي/i).check();
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30000 });
}

async function submitSignUp(page: Page, request: APIRequestContext, email: string): Promise<Set<string>> {
  const seen = await messageIdsFor(request, email);
  await page.getByRole("button", { name: /create account|إنشاء حساب/i }).click();
  // Real Siteverify → Server Action → signUp() → email round trip; scoped
  // longer timeout for this transition only (see auth-password-preview.spec.ts).
  await expect(page.getByText(/next step|الخطوة التالية/i)).toBeVisible({ timeout: 20_000 });
  return seen;
}

async function verify(page: Page, request: APIRequestContext, email: string, seen: Set<string>): Promise<void> {
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code|الرمز لمرة واحدة/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify and continue|تحقق وتابع/i }).click();
}

/** Registers and verifies a fresh account; returns once it has landed in the app. */
async function register(page: Page, request: APIRequestContext, tag: string): Promise<{ email: string; username: string }> {
  const email = uniqueEmail(tag);
  const username = uniqueUsername(tag);
  await fillSignUp(page, email, username);
  const seen = await submitSignUp(page, request, email);
  await verify(page, request, email, seen);
  await page.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
  return { email, username };
}

/** A small real PNG, drawn by the browser itself (no binary fixture on disk). */
async function pngBytes(page: Page, colour: string): Promise<Buffer> {
  const b64 = await page.evaluate((fill) => {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 96, 64);
    return c.toDataURL("image/png").split(",")[1] ?? "";
  }, colour);
  return Buffer.from(b64, "base64");
}

async function setLocale(context: BrowserContext, locale: "ar" | "en"): Promise<void> {
  await context.addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1:3100" }]);
}

test.describe("Registration — account-type step", () => {
  test("shows exactly the 9 approved cards; Coming Soon ones are disabled; no standalone Installer", async ({ page, context }) => {
    await setLocale(context, "ar");
    await page.goto("/preview/auth-password/sign-up");
    const expected = ["المعرض", "المورد", "المصنع", "المستورد", "المقاول", "المهندس", "الصنايعية", "فريق المبيعات", "حساب شخصي"];
    for (const name of expected) {
      await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(1);
    }
    for (const soon of ["المقاول", "المهندس", "حساب شخصي"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${soon}`) })).toBeDisabled();
    }
    for (const open of ["المعرض", "المورد", "المصنع", "المستورد", "الصنايعية", "فريق المبيعات"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${open}`) })).toBeEnabled();
    }
    // Never a standalone Installer, never interior designer or wholesaler.
    await expect(page.getByRole("button", { name: /مركّب|installer|مصمّم داخلي|تاجر جملة/i })).toHaveCount(0);
    await expect(page.locator("select#accountType")).toHaveCount(0);
  });
});

test.describe("Direct entry after registration", () => {
  test("OTP verification lands in the app directly — no six-step onboarding wizard", async ({ page, request }) => {
    const visited: string[] = [];
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
    });
    await register(page, request, "direct");
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);
    await expect(page.getByTestId("complete-profile-card")).toBeVisible();
    await expect(page.getByText(/setting up your account|جارٍ إعداد حسابك/i)).toHaveCount(0);
    expect(visited.filter((p) => /^\/onboarding\/(profile|contact|professional|consumer|business)/.test(p))).toEqual([]);
  });

  test("the Tradespeople choice becomes an authoritative professional persona — trades are editable", async ({ page, request }) => {
    await register(page, request, "persona");
    await page.goto("/home/profile/edit");
    await expect(page.getByTestId("trade-selector")).toBeVisible();
    const painting = page.getByRole("button", { name: /^(painter \/ decorator|نقاش ودهانات)$/i });
    await painting.click();
    await page.getByRole("button", { name: /save trades|حفظ المهن/i }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: /^(painter \/ decorator|نقاش ودهانات)$/i })).toHaveAttribute("aria-pressed", "true");
  });

  test("a username lost during the OTP window goes to the narrow username screen, then into the app", async ({ browser, request }) => {
    const shared = uniqueUsername("race");
    const a = await browser.newContext();
    const b = await browser.newContext();
    const pageA = await a.newPage();
    const pageB = await b.newPage();

    const emailA = uniqueEmail("racea");
    const emailB = uniqueEmail("raceb");
    await fillSignUp(pageA, emailA, shared);
    const seenA = await submitSignUp(pageA, request, emailA);
    await fillSignUp(pageB, emailB, shared);
    const seenB = await submitSignUp(pageB, request, emailB);

    // B verifies first and claims the name; A's claim now collides.
    await verify(pageB, request, emailB, seenB);
    await pageB.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
    await verify(pageA, request, emailA, seenA);
    await pageA.waitForURL(/\/onboarding\/username/, { waitUntil: "commit" });
    await expect(pageA.getByText(/choose a username|اختر اسم مستخدم/i).first()).toBeVisible();

    await pageA.getByLabel(/^username$|^اسم المستخدم$/i).fill(uniqueUsername("racefix"));
    await pageA.getByRole("button", { name: /continue|متابعة/i }).click();
    await pageA.waitForURL(/\/home(\/|$|\?)/, { waitUntil: "commit" });
    // Recovery keeps the registration choice: A is still a Tradesperson.
    await pageA.goto("/home/profile/edit");
    await expect(pageA.getByTestId("trade-selector")).toBeVisible();
    await a.close();
    await b.close();
  });
});

test.describe("Complete your profile", () => {
  test("display name, phone and avatar each complete an item and persist across reload; the card never blocks the page", async ({ page, request, context }) => {
    // English-specific assertions: pin the locale (Arabic/RTL has its own test).
    await setLocale(context, "en");
    await register(page, request, "complete");
    await page.goto("/home/settings");
    const percent = page.getByTestId("complete-profile-percent");
    // A fresh Tradesperson: 4 shared items + 4 professional items; only the
    // username (mandatory at registration) is done yet — 1/8.
    await expect(percent).toHaveText("13% complete");
    await expect(page.getByText(/preferred language|اللغة المفضّلة/i)).toHaveCount(0);

    // Display name: the automatic value is NOT confirmed until saved here.
    await expect(page.getByTestId("display-name-status")).toContainText("Not confirmed yet");
    await page.getByLabel("Display name").fill("E2E Tester");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("display-name-status")).toHaveText("Confirmed");
    await expect(percent).toHaveText("25% complete");

    // Phone: Egypt is the default, not the only choice.
    const country = page.getByLabel("Country");
    await expect(country).toHaveValue("EG");
    expect(await country.locator("option").count()).toBeGreaterThan(200);
    const national = uniqueEgMobile();
    await page.locator("#phone-national").fill("123");
    await expect(page.getByText(/valid phone number/i)).toBeVisible();
    await page.locator("#phone-national").fill(national);
    await page.getByRole("button", { name: "Save phone" }).click();
    await expect(page.getByText("Phone saved")).toBeVisible();
    await page.reload();
    await expect(page.locator("#phone-national")).toHaveValue(national);
    await expect(country).toHaveValue("EG");
    await expect(percent).toHaveText("38% complete");

    // Avatar: cancel uploads nothing.
    const red = await pngBytes(page, "red");
    await page.getByTestId("avatar-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: red });
    await expect(page.getByTestId("avatar-cropper")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("avatar-cropper")).toHaveCount(0);
    await expect(page.getByTestId("avatar-current")).toHaveCount(0);

    // An unsupported type is refused before the crop step opens.
    await page.getByTestId("avatar-input").setInputFiles({ name: "a.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(page.getByText(/JPEG, PNG, or WebP/)).toBeVisible();

    // Crop (zoom + drag) -> upload -> confirm -> reload.
    await page.getByTestId("avatar-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: red });
    await expect(page.getByTestId("avatar-cropper")).toBeVisible();
    await page.getByLabel("Zoom").fill("1.5");
    const box = (await page.getByTestId("avatar-cropper").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
    await page.mouse.up();
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByTestId("avatar-current")).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(page.getByTestId("avatar-current")).toBeVisible();

    await expect(percent).toHaveText("50% complete");
    // Still incomplete, still visible, and it never blocked anything on the page.
    await expect(page.getByTestId("complete-profile-card")).toBeVisible();
    await expect(page.getByTestId("complete-profile-missing").locator("[data-item=avatar]")).toHaveCount(0);

    // Replacement swaps the current avatar for a new object.
    const firstSrc = await page.getByTestId("avatar-current").getAttribute("src");
    const blue = await pngBytes(page, "blue");
    await page.getByTestId("avatar-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blue });
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByText("Photo updated")).toBeVisible({ timeout: 20000 });
    await page.reload();
    const secondSrc = await page.getByTestId("avatar-current").getAttribute("src");
    expect(secondSrc?.split("?")[0]).not.toBe(firstSrc?.split("?")[0]);
  });

  test("a phone number already held by another account gets a neutral 'unavailable' message", async ({ browser, request }) => {
    const national = uniqueEgMobile();
    // English-specific assertions: pin the locale on both contexts.
    const a = await browser.newContext();
    await setLocale(a, "en");
    const pageA = await a.newPage();
    await register(pageA, request, "dupa");
    await pageA.goto("/home/settings");
    await pageA.locator("#phone-national").fill(national);
    await pageA.getByRole("button", { name: "Save phone" }).click();
    await expect(pageA.getByText("Phone saved")).toBeVisible();
    await a.close();

    const b = await browser.newContext();
    await setLocale(b, "en");
    const pageB = await b.newPage();
    await register(pageB, request, "dupb");
    await pageB.goto("/home/settings");
    await pageB.locator("#phone-national").fill(national);
    await pageB.getByRole("button", { name: "Save phone" }).click();
    await expect(pageB.getByText("That phone number is unavailable. Please use a different one.")).toBeVisible();
    await expect(pageB.getByText(/another account|already (registered|used)|belongs to/i)).toHaveCount(0);
    await b.close();
  });

  test("renders in Arabic, right-to-left", async ({ page, request, context }) => {
    await register(page, request, "arabic");
    await setLocale(context, "ar");
    await page.goto("/home/settings");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("أكمل حسابك").first()).toBeVisible();
    await expect(page.getByText("هويتك")).toBeVisible();
    await expect(page.getByText(/اللغة المفضّلة/)).toHaveCount(0);
  });
});

/**
 * The same profile UI, reached through the canonical passwordless sign-in
 * (no CAPTCHA on that path) with seeded identities — so the identity card,
 * phone picker and avatar crop are exercised in a real browser even where the
 * registration form's Turnstile widget cannot load.
 */
async function percentOf(page: Page): Promise<number> {
  const text = (await page.getByTestId("complete-profile-percent").textContent()) ?? "";
  return Number(text.replace(/[^0-9]/g, ""));
}

test.describe("Complete your profile — seeded account", () => {
  test("display name, phone and avatar save, persist across reload, and raise completion", async ({ page, request, context }) => {
    await setLocale(context, "en");
    await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$|\?)/);
    await page.goto("/home/settings");
    await expect(page.getByTestId("identity-card")).toBeVisible();
    await expect(page.getByText(/preferred language/i)).toHaveCount(0);
    const cardShown = (await page.getByTestId("complete-profile-card").count()) > 0;
    const before = cardShown ? await percentOf(page) : 100;

    await page.getByLabel("Display name").fill(`Seeded Consumer ${uniq().slice(-4)}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("display-name-status")).toHaveText("Confirmed");

    const country = page.getByLabel("Country");
    await expect(country).toHaveValue(/^[A-Z]{2}$/);
    expect(await country.locator("option").count()).toBeGreaterThan(200);
    await country.selectOption("EG");
    const national = uniqueEgMobile();
    await page.locator("#phone-national").fill("123");
    await expect(page.getByText(/valid phone number/i)).toBeVisible();
    await page.locator("#phone-national").fill(national);
    await page.getByRole("button", { name: "Save phone" }).click();
    await expect(page.getByText("Phone saved")).toBeVisible();
    await page.reload();
    await expect(page.locator("#phone-national")).toHaveValue(national);
    await expect(country).toHaveValue("EG");

    const red = await pngBytes(page, "red");
    await page.getByTestId("avatar-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: red });
    await expect(page.getByTestId("avatar-cropper")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("avatar-cropper")).toHaveCount(0);

    await page.getByTestId("avatar-input").setInputFiles({ name: "a.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(page.getByText(/JPEG, PNG, or WebP/)).toBeVisible();

    await page.getByTestId("avatar-input").setInputFiles({ name: "a.png", mimeType: "image/png", buffer: red });
    await expect(page.getByTestId("avatar-cropper")).toBeVisible();
    await page.getByLabel("Zoom").fill("1.5");
    const box = (await page.getByTestId("avatar-cropper").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10);
    await page.mouse.up();
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByText("Photo updated")).toBeVisible({ timeout: 20000 });
    await page.reload();
    await expect(page.getByTestId("avatar-current")).toBeVisible();
    const firstSrc = await page.getByTestId("avatar-current").getAttribute("src");

    const blue = await pngBytes(page, "blue");
    await page.getByTestId("avatar-input").setInputFiles({ name: "b.png", mimeType: "image/png", buffer: blue });
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect(page.getByText("Photo updated")).toBeVisible({ timeout: 20000 });
    await page.reload();
    const secondSrc = await page.getByTestId("avatar-current").getAttribute("src");
    expect(secondSrc?.split("?")[0]).not.toBe(firstSrc?.split("?")[0]);

    const after = (await page.getByTestId("complete-profile-card").count()) > 0 ? await percentOf(page) : 100;
    expect(after).toBeGreaterThanOrEqual(before);
    if (after < 100) await expect(page.getByTestId("complete-profile-card")).toBeVisible();
    else await expect(page.getByTestId("complete-profile-card")).toHaveCount(0);
  });

  test("a phone already held by another account gets the neutral message (business identity card on /b2b/settings)", async ({ browser, request }) => {
    const national = uniqueEgMobile();
    const a = await browser.newContext();
    await setLocale(a, "en");
    const pageA = await a.newPage();
    await signIn(pageA, request, IDENTITIES.consumer, /\/home(\/|$|\?)/);
    await pageA.goto("/home/settings");
    await pageA.getByLabel("Country").selectOption("EG");
    await pageA.locator("#phone-national").fill(national);
    await pageA.getByRole("button", { name: "Save phone" }).click();
    await expect(pageA.getByText("Phone saved")).toBeVisible();
    await a.close();

    const b = await browser.newContext();
    await setLocale(b, "en");
    const pageB = await b.newPage();
    await signIn(pageB, request, IDENTITIES.showroom);
    await pageB.goto("/b2b/settings");
    await expect(pageB.getByTestId("identity-card")).toBeVisible();
    await pageB.getByLabel("Country").selectOption("EG");
    await pageB.locator("#phone-national").fill(national);
    await pageB.getByRole("button", { name: "Save phone" }).click();
    await expect(pageB.getByText("That phone number is unavailable. Please use a different one.")).toBeVisible();
    await expect(pageB.getByText(/another account|belongs to/i)).toHaveCount(0);
    await b.close();
  });

  test("a showroom owner edits its organization subtypes, Mawan included", async ({ page, request, context }) => {
    await setLocale(context, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/settings");
    const selector = page.getByTestId("activity-selector");
    await expect(selector).toBeVisible();
    for (const label of ["Decor showroom", "Paint showroom", "Decor & paint showroom", "Building & finishing supplies retailer"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Distributor", exact: true })).toHaveCount(0);
  });

  test("the settings surface renders in Arabic, right-to-left, without a Preferred Language field", async ({ page, request, context }) => {
    await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$|\?)/);
    await setLocale(context, "ar");
    await page.goto("/home/settings");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByText("هويتك")).toBeVisible();
    await expect(page.getByText(/اللغة المفضّلة/)).toHaveCount(0);
  });
});

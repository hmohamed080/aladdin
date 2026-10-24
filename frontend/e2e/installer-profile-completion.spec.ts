import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import { stubTurnstileWhenOffline } from "./helpers/auth";

/**
 * Installer profile completion across every surface that shows it, driven through the approved
 * "Complete your profile" page (`/home/profile`) — docs: migration 20261024090011.
 *
 * Three surfaces display the same figure and must agree at every step:
 *   1. the dashboard banner on `/home`            (`profile-completion-banner`),
 *   2. the approved profile page `/home/profile`  (`profile-page-percent`),
 *   3. the generic Settings card `/settings/profile` (`complete-profile-card`; an Installer's
 *      `/home/settings` is the installer settings page, which does not display completion).
 *
 * The expectation is NOT read from `my_profile_completion()`. It is counted from the raw tables by
 * the canonical Installer rule — four shared items (username, photo, phone, confirmed name) plus the
 * five the approved page asks for (experience, specialties, availability, a primary governorate/city,
 * at least one portfolio project) — so a regression in the database function shows up as a
 * disagreement between the DB and the three screens, not as a self-confirming number.
 *
 * ISOLATION: a fresh phone account per run, created through the real sign-up. The database is read
 * through the container named by E2E_DB_CONTAINER and never written to directly.
 */

const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const PASSWORD = "green-tiles-on-roof";
const TOTAL_ITEMS = 9;

function sql(query: string): string {
  // Argument array, no shell: the container name comes from the environment and the SQL goes in on stdin.
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At"], { input: query }).toString().trim();
}

function uniq(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`;
}

function uniquePhone(): string {
  // A valid Egyptian mobile (010 + 8 digits), unique per run.
  return `010${String(Date.now()).slice(-5)}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
}

/** The canonical Installer rule, counted from the tables. Returns the done item keys. */
function doneItems(userId: string): string[] {
  const out = sql(`
    select coalesce(string_agg(k, ',' order by k), '') from (
      select 'username' k from public.profiles where user_id = '${userId}' and username is not null
      union all select 'avatar' from public.profiles where user_id = '${userId}' and avatar_media_id is not null
      union all select 'phone' from public.profiles where user_id = '${userId}' and phone_e164 is not null
      union all select 'display_name' from public.profiles where user_id = '${userId}' and display_name_confirmed_at is not null
      union all select 'years_experience' from public.individual_onboarding where user_id = '${userId}' and coalesce(prof_years_experience, 0) > 0
      union all select 'availability' from public.individual_onboarding where user_id = '${userId}' and prof_availability is not null
      union all select 'activities' where exists (
        select 1 from public.user_trades ut join public.trades t on t.id = ut.trade_id where ut.user_id = '${userId}' and t.is_active)
      union all select 'location' where exists (
        select 1 from public.user_service_areas a where a.user_id = '${userId}' and a.is_primary)
      union all select 'portfolio' where exists (
        select 1 from public.portfolio_projects p where p.owner_user_id = '${userId}')
    ) x;`);
  return out ? out.split(",") : [];
}

const ALL_ITEMS = ["activities", "availability", "avatar", "display_name", "location", "phone", "portfolio", "username", "years_experience"];

function expectedFor(done: string[]): { percent: number; missing: string[] } {
  return { percent: Math.round((100 * done.length) / TOTAL_ITEMS), missing: ALL_ITEMS.filter((k) => !done.includes(k)) };
}

/** Western or Arabic-Indic digits to a number. */
function digits(text: string): number {
  const western = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return Number(western.replace(/[^0-9]/g, ""));
}

async function setLocale(page: Page, locale: "ar" | "en"): Promise<void> {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1:3100" }]);
}

/** A small real PNG, drawn by the browser itself (no binary fixture on disk). */
async function pngBytes(page: Page, colour: string): Promise<Buffer> {
  const b64 = await page.evaluate((fill) => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 160;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 160, 160);
    return c.toDataURL("image/png").split(",")[1] ?? "";
  }, colour);
  return Buffer.from(b64, "base64");
}

async function register(page: Page, name: string, phone: string): Promise<void> {
  await stubTurnstileWhenOffline(page);
  await page.goto("/installer/sign-up");
  await page.getByLabel("الاسم الكامل").fill(name);
  // Scoped by name: the sign-up page also has a labelled tab panel for the phone method.
  await page.locator('input[name="phone"]').fill(phone);
  await page.getByLabel("كلمة المرور", { exact: true }).fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30_000 });
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();
  await page.waitForURL(/\/home(\/|$)/, { waitUntil: "commit", timeout: 30_000 });
}

/** What each surface shows right now, as numbers. `null` = the surface is not drawn (hidden at 100%). */
async function readSurfaces(page: Page): Promise<{ banner: number | null; profile: number; card: number | null; cardMissing: string[] }> {
  await page.goto("/home");
  const banner = page.getByTestId("profile-completion-banner-percent");
  await expect(page.getByTestId("installer-home")).toBeVisible();
  const bannerValue = (await banner.count()) ? digits((await banner.textContent()) ?? "") : null;

  await page.goto("/home/profile");
  const profileValue = digits((await page.locator('[data-testid="profile-page-percent"]:visible').first().textContent()) ?? "");

  await page.goto("/settings/profile");
  const card = page.getByTestId("complete-profile-percent");
  const cardValue = (await card.count()) ? digits((await card.textContent()) ?? "") : null;
  const cardMissing = (await page.getByTestId("complete-profile-missing").locator("[data-item]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-item") ?? ""),
  )) as string[];
  return { banner: bannerValue, profile: profileValue, card: cardValue, cardMissing };
}

async function expectAgreement(page: Page, userId: string, label: string): Promise<{ percent: number }> {
  const expected = expectedFor(doneItems(userId));
  const seen = await readSurfaces(page);
  // At 100% the banner and the card are intentionally not drawn; below it, all three show the one figure.
  if (expected.percent >= 100) {
    expect(seen.banner, `${label}: banner hidden at 100%`).toBeNull();
    expect(seen.card, `${label}: settings card hidden at 100%`).toBeNull();
  } else {
    expect(seen.banner, `${label}: dashboard banner`).toBe(expected.percent);
    expect(seen.card, `${label}: settings card`).toBe(expected.percent);
    expect([...seen.cardMissing].sort(), `${label}: settings card missing list`).toEqual(expected.missing);
  }
  expect(seen.profile, `${label}: profile page`).toBe(expected.percent);
  return { percent: expected.percent };
}

test.describe("Installer profile completion — one figure on every surface", () => {
  test("banner, profile page and settings card agree with the canonical rule from first sign-in to 100%", async ({ page }) => {
    test.setTimeout(240_000);
    const name = `E2E Installer ${uniq()}`;
    await register(page, name, uniquePhone());
    await setLocale(page, "en");

    const userId = sql(`select user_id from public.profiles where display_name = '${name}' limit 1;`);
    expect(userId, "the sign-up created a profile").toMatch(/^[0-9a-f-]{36}$/);

    // The rule itself, at the start: only the shared items the sign-up gives can be done.
    const start = doneItems(userId);
    for (const item of ["years_experience", "availability", "activities", "location", "portfolio", "avatar"]) {
      expect(start, `a brand-new installer has not done ${item}`).not.toContain(item);
    }
    const first = await expectAgreement(page, userId, "after sign-up");
    expect(first.percent).toBeLessThan(50);

    // Fill the approved page through its real controls and save.
    await page.goto("/home/profile");
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Increase years" }).click();
    await page.getByRole("button", { name: "Choose specialties" }).click();
    await page.getByRole("listbox", { name: "Specialties list" }).getByRole("option").first().click();
    await page.keyboard.press("Escape");
    await page.locator("button#governorate").click();
    await page.getByRole("listbox").getByRole("option").first().click();
    await page.getByRole("button", { name: "Within a week" }).click();
    // "Save draft" stays on the page and reports the result; "Save and continue" would redirect to /home.
    await page.getByTestId("profile-save-draft").click();
    await expect(page.getByTestId("profile-save-message")).toBeVisible({ timeout: 20_000 });

    const afterForm = doneItems(userId);
    for (const item of ["years_experience", "activities", "location"]) expect(afterForm, `saving the page records ${item}`).toContain(item);
    const second = await expectAgreement(page, userId, "after saving the profile page");
    expect(second.percent).toBeGreaterThan(first.percent);
    expect(afterForm).not.toContain("portfolio");
    expect(afterForm).not.toContain("avatar");

    // A portfolio project counts, and the dashboard banner (a different route) moves with it.
    await page.goto("/home/profile");
    await page.getByTestId("portfolio-add-project").click();
    await page.getByTestId("project-title").fill(`E2E project ${uniq()}`);
    await page.getByTestId("project-save").click();
    await expect.poll(() => doneItems(userId).includes("portfolio"), { timeout: 20_000 }).toBe(true);
    const third = await expectAgreement(page, userId, "after adding a portfolio project");
    expect(third.percent).toBeGreaterThan(second.percent);

    // The last item: a profile photo, through the real crop-and-upload flow. The rule is then complete, so the
    // banner and the settings card stop being drawn and the profile page reads 100%.
    await page.goto("/home/profile");
    const png = await pngBytes(page, "#b5651d");
    await page.getByTestId("profile-avatar-input").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Save photo" }).click();
    await expect.poll(() => doneItems(userId).includes("avatar"), { timeout: 40_000 }).toBe(true);
    expect([...doneItems(userId)].sort()).toEqual(ALL_ITEMS);
    const fourth = await expectAgreement(page, userId, "after adding a profile photo");
    expect(fourth.percent).toBe(100);
  });
});

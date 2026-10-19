import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, devices, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { psql } from "./global-setup";
import { E2E_PASSWORD, IDENTITIES } from "./helpers/auth";
import { createConfirmedAccount } from "./helpers/fixtures";

/**
 * PR #88 — Admin users/staff, Business Verification (admin queue + detail, showroom owner page), phone
 * cooldowns, the unverified second phone, and Offers / My Offers back on. LOCAL stack only.
 *
 * Two layers:
 *   1. Functional journeys on desktop · English · light (the PR's acceptance path).
 *   2. A render matrix (desktop 1440x900 / mobile 390x844 × en/ar × light/dark): every page loads, its key
 *      content is visible, there is no horizontal overflow, and a screenshot is written to
 *      PR88_SCREENSHOT_DIR (default /mnt/project-files/showroom-admin/e2e).
 *
 * Locale and theme are the app's own cookies (NEXT_LOCALE, aladdin-theme). Sign in is the real Email +
 * Password server action; only the third-party Turnstile script is stubbed (the same fixture showroom-auth uses),
 * because the local GoTrue has [auth.captcha] OFF and the sandbox cannot reach challenges.cloudflare.com.
 */

const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const SHOTS = process.env.PR88_SCREENSHOT_DIR ?? "/mnt/project-files/showroom-admin/e2e";
const HANA_ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const CONSUMER = "44444444-4444-4444-8444-444444444444";
const SUPER_EMAIL = "pr88-super-admin@example.test";
// Overrides are immutable, so each run uses its own number (Egyptian mobile, +2010 + 8 digits).
const RUN_NATIONAL = "010" + String(Date.now()).slice(-8);
const RUN_E164 = "+20" + RUN_NATIONAL.slice(1);
// A second run-unique number the consumer briefly holds as its MAIN phone (the "already your main phone" check).
const OWN_PRIMARY_NATIONAL = "011" + String(Date.now()).slice(-8);
const OWN_PRIMARY_E164 = "+20" + OWN_PRIMARY_NATIONAL.slice(1);

type Role = "admin" | "superAdmin" | "showroom" | "consumer" | "b2b";
const EMAIL: Record<Role, string> = {
  admin: IDENTITIES.admin,
  superAdmin: SUPER_EMAIL,
  showroom: IDENTITIES.showroom,
  consumer: IDENTITIES.consumer,
  b2b: IDENTITIES.manager,
};

const TURNSTILE_STUB =
  'window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "local-test"},remove:function(){},reset:function(){}};';

/** One value from the LOCAL test DB ('' when no row). */
function scalar(sql: string): string {
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql]).toString().trim();
}

function resetBusinessVerification(): void {
  psql(`
begin;
update public.organizations set business_verified_at = null, business_verification_id = null where id = '${HANA_ORG}';
delete from public.verifications where organization_id = '${HANA_ORG}' and verification_type = 'business';
commit;`);
}

function resetSecondaryPhone(): void {
  psql(`
delete from public.secondary_phone_reservations where user_id = '${CONSUMER}';
delete from app.password_confirm_attempts where user_id = '${CONSUMER}';`);
}

/** A Super Admin fixture (the seeded admin is an Administrator, which does not hold phones.cooldown_override). */
function ensureSuperAdmin(): void {
  if (!scalar(`select 1 from auth.users where email = '${SUPER_EMAIL}'`)) createConfirmedAccount(SUPER_EMAIL);
  psql(`
update public.users set status = 'active' where id = (select id from auth.users where email = '${SUPER_EMAIL}');
insert into public.admin_role_assignments (user_id, role_id)
select u.id, r.id from auth.users u, public.admin_roles r
 where u.email = '${SUPER_EMAIL}' and r.key = 'super_admin'
   and not exists (select 1 from public.admin_role_assignments a
                    where a.user_id = u.id and a.role_id = r.id and a.is_active);`);
}

const isMobile = (info: TestInfo) => info.project.name.includes("mobile");

async function newRoleContext(browser: Browser, info: TestInfo, locale: "en" | "ar", theme: "light" | "dark"): Promise<BrowserContext> {
  const baseURL = String(info.project.use.baseURL);
  const ctx = await browser.newContext(
    isMobile(info)
      ? { ...devices["Pixel 5"], viewport: { width: 390, height: 844 }, baseURL }
      : { viewport: { width: 1440, height: 900 }, baseURL },
  );
  const host = new URL(baseURL).hostname;
  await ctx.addCookies([
    { name: "NEXT_LOCALE", value: locale, domain: host, path: "/" },
    { name: "aladdin-theme", value: theme, domain: host, path: "/" },
  ]);
  await ctx.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
  return ctx;
}

/** Real Email + Password sign in; lands anywhere outside /auth. */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel(/^email address$|^البريد الإلكتروني$/i).fill(email);
  await page.getByLabel(/^password$|^كلمة المرور$/i).fill(E2E_PASSWORD);
  await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 15_000 });
  await page.getByRole("button", { name: /^sign in$|^تسجيل الدخول$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth"), { waitUntil: "commit", timeout: 30_000 });
}

/** Opens a ConfirmDialog; retries the trigger click because a click that lands before hydration is lost. */
async function openDialog(page: Page, trigger: Locator): Promise<Locator> {
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if ((await dialog.count()) === 0) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return dialog;
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `horizontal overflow ${scroll} > ${inner}`).toBeLessThanOrEqual(inner + 1);
}

async function expectNot404(page: Page, url: string): Promise<void> {
  const res = await page.goto(url);
  expect(res?.status(), `${url} status`).toBeLessThan(400);
  await expect(page.getByText(/this page could not be found|page not found|الصفحة غير موجودة/i)).toHaveCount(0);
}

mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------------------------------------------------------
// 1. Functional journeys — desktop · English · light
// ---------------------------------------------------------------------------------------------------------------
test.describe.serial("PR #88 functional (desktop · en · light)", () => {
  test.skip(({ isMobile: mobile }) => mobile, "functional journeys run on the desktop project");

  // A skipped describe still runs its beforeAll, so the mobile project must not reset the request the desktop
  // journey created (the mobile matrix opens it).
  test.beforeAll(({}, info) => {
    if (isMobile(info)) return;
    resetBusinessVerification();
    resetSecondaryPhone();
    ensureSuperAdmin();
  });

  test("admin users: User type column, account-type filter, search, pagination", async ({ browser }, info) => {
    const ctx = await newRoleContext(browser, info, "en", "light");
    const page = await ctx.newPage();
    await signIn(page, EMAIL.admin);
    await page.goto("/admin/users");
    const table = page.locator("table").first();
    await expect(table.getByRole("columnheader", { name: "User type" })).toBeVisible();
    await expect(page.getByText(/^Showing 1–10 of \d+$/)).toBeVisible();
    const totalAll = Number((await page.getByText(/^Showing 1–10 of \d+$/).innerText()).match(/of (\d+)/)![1]);
    expect(totalAll).toBeGreaterThan(10);
    // Every row carries a User type badge.
    await expect(table.locator("tbody tr")).toHaveCount(10);

    // Pagination: page 2 via the pager.
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/[?&]page=2/);
    await expect(page.getByText(new RegExp(`^Showing 11–\\d+ of ${totalAll}$`))).toBeVisible();

    // Account-type filter: Importer → only the two seeded importers.
    await page.locator('select[aria-label="Any type"]').selectOption("importer");
    await expect(page).toHaveURL(/[?&]type=importer/);
    await expect(page).not.toHaveURL(/[?&]page=/);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    const typeCells = table.locator("tbody tr td:nth-child(2)");
    await expect(typeCells).toHaveCount(2);
    for (const text of await typeCells.allInnerTexts()) expect(text.trim()).toMatch(/importer/i);

    // Search within the filter.
    await page.getByPlaceholder(/search/i).first().fill("fady");
    await expect(page).toHaveURL(/[?&]q=fady/);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(table.locator("tbody tr")).toHaveCount(1);

    // A type with no one in it → the empty state, no table.
    await page.goto("/admin/users?type=none&q=fady");
    await expect(page.locator("table")).toHaveCount(0);
    await ctx.close();
  });

  test("admin staff: search placeholder and the 'No staff match.' empty state", async ({ browser }, info) => {
    const ctx = await newRoleContext(browser, info, "en", "light");
    const page = await ctx.newPage();
    await signIn(page, EMAIL.admin);
    await page.goto("/admin/staff");
    const search = page.getByPlaceholder("Search by name or email");
    await expect(search).toBeVisible();
    await search.fill("zz-no-such-staff-zz");
    await expect(page).toHaveURL(/[?&]q=zz-no-such-staff-zz/);
    await expect(page.getByText("No staff match.")).toBeVisible();
    await ctx.close();
  });

  test("business verification: owner submits, admin queue + detail approves, owner sees Verified", async ({ browser }, info) => {
    const owner = await newRoleContext(browser, info, "en", "light");
    const op = await owner.newPage();
    await signIn(op, EMAIL.showroom);
    await op.goto("/showroom/verification");
    await expect(op.getByRole("heading", { name: "Business verification", level: 1 })).toBeVisible();
    await expect(op.getByTestId("bv-status")).toHaveAttribute("data-status", "none");
    await op.getByTestId("bv-file-input").setInputFiles({
      name: "commercial-register.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
    });
    await expect(op.getByText("Document added.")).toBeVisible({ timeout: 20_000 });
    await expect(op.getByText("commercial-register.pdf")).toBeVisible();
    await op.locator("#bv-note").fill("PR88 e2e — please verify.");
    await op.getByTestId("bv-submit").click();
    await expect(op.getByTestId("bv-status")).toHaveAttribute("data-status", "pending", { timeout: 20_000 });
    await expect(op.getByText("Your documents are being reviewed")).toBeVisible();

    const reviewer = await newRoleContext(browser, info, "en", "light");
    const rp = await reviewer.newPage();
    await signIn(rp, EMAIL.admin);
    await rp.goto("/admin/business-verification");
    await expect(rp.getByRole("heading", { name: "Business verification" }).first()).toBeVisible();
    const row = rp.getByTestId("bv-queue-row").filter({ hasText: "Cairo Ceramics Showroom" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Submitted");
    // Filters are plain GET params: an org-type that does not match hides the row.
    await rp.goto("/admin/business-verification?type=importer");
    await expect(rp.getByText("No requests match these filters.")).toBeVisible();
    await rp.goto("/admin/business-verification?q=Cairo%20Ceramics");
    await rp.getByRole("link", { name: "Cairo Ceramics Showroom" }).click();
    await expect(rp).toHaveURL(/\/admin\/business-verification\/[0-9a-f-]{36}$/);
    await expect(rp.getByText("commercial-register.pdf")).toBeVisible();

    await (await openDialog(rp, rp.getByRole("button", { name: "Start review" }))).getByRole("button", { name: "Start review" }).click();
    // ConfirmDialog closes on success and refreshes the server data; its done copy survives the close as a toast
    // (the "Start review" button itself is gone once the request is under review).
    await expect(rp.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
    await expect(rp.getByTestId("toast").filter({ hasText: "Review started." })).toBeVisible();
    await expect(rp.getByRole("status").filter({ has: rp.getByTestId("toast") })).toHaveAttribute("aria-live", "polite");
    await expect(rp.getByText("Under review", { exact: true }).first()).toBeVisible();
    const dialog = await openDialog(rp, rp.getByRole("button", { name: "Approve and verify" }));
    await dialog.locator("#bv-approve-reason").fill("Commercial register checked (PR88 e2e).");
    await dialog.getByRole("button", { name: "Approve and verify" }).click();
    await expect(rp.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
    await expect(rp.getByTestId("toast").filter({ hasText: "Business verified." })).toBeVisible();
    await rp.screenshot({ path: path.join(SHOTS, "admin-bv-approved-toast-desktop-en-light.png"), fullPage: false });
    await expect(rp.getByText("Verified", { exact: true }).first()).toBeVisible();
    await expect(rp.getByRole("button", { name: "Approve and verify" })).toHaveCount(0);
    expect(scalar(`select business_verified_at is not null from public.organizations where id = '${HANA_ORG}'`)).toBe("t");
    await reviewer.close();

    await op.reload();
    await expect(op.getByTestId("bv-status")).toHaveAttribute("data-status", "verified");
    await expect(op.getByText(/^Verified on /)).toBeVisible();
    await owner.close();
  });

  test("settings identity card: second phone add (wrong + right password), renew, remove", async ({ browser }, info) => {
    const ctx = await newRoleContext(browser, info, "en", "light");
    const page = await ctx.newPage();
    await signIn(page, EMAIL.consumer);
    await page.goto("/settings/profile");
    const section = page.getByTestId("secondary-phone");
    await expect(section.getByText("Second phone", { exact: true })).toBeVisible();
    await expect(section.getByText("Not verified", { exact: true })).toBeVisible();

    await section.locator("#secondary-phone-national").fill(RUN_NATIONAL);
    await section.locator("#secondary-phone-password").fill("definitely-not-the-password");
    await section.getByRole("button", { name: "Add second phone" }).click();
    await expect(section.getByText("That password is not correct.")).toBeVisible({ timeout: 20_000 });

    await section.locator("#secondary-phone-national").fill(RUN_NATIONAL);
    await section.locator("#secondary-phone-password").fill(E2E_PASSWORD);
    await section.getByRole("button", { name: "Add second phone" }).click();
    const current = page.getByTestId("secondary-phone-current");
    await expect(current).toContainText(RUN_E164, { timeout: 20_000 });
    await expect(current).toContainText(/Held until /);

    await current.getByRole("button", { name: "Keep for 7 more days" }).click();
    await expect(current.getByText("Kept for 7 more days.")).toBeVisible({ timeout: 20_000 });
    await expect(current).toContainText("already renewed");
    await expect(current.getByRole("button", { name: "Keep for 7 more days" })).toHaveCount(0);

    await current.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByTestId("secondary-phone-current")).toHaveCount(0, { timeout: 20_000 });
    await expect(section.getByRole("button", { name: "Add second phone" })).toBeVisible();

    // The released number is now in its 30-day cooldown: adding it again is refused.
    await section.locator("#secondary-phone-national").fill(RUN_NATIONAL);
    await section.locator("#secondary-phone-password").fill(E2E_PASSWORD);
    await section.getByRole("button", { name: "Add second phone" }).click();
    await expect(section.getByText(/You released this number recently/)).toBeVisible({ timeout: 20_000 });

    // One number is never both the main and the second phone of one account: the database refuses it and the
    // card says so in plain words. (The consumer has no main phone in the seed; give it one for this check only.)
    psql(`update public.profiles set phone_e164 = '${OWN_PRIMARY_E164}' where user_id = '${CONSUMER}';`);
    try {
      await page.reload();
      await section.locator("#secondary-phone-national").fill(OWN_PRIMARY_NATIONAL);
      await section.locator("#secondary-phone-password").fill(E2E_PASSWORD);
      await section.getByRole("button", { name: "Add second phone" }).click();
      await expect(section.getByText("This is already your main phone.")).toBeVisible({ timeout: 20_000 });
    } finally {
      psql(`update public.profiles set phone_e164 = null where user_id = '${CONSUMER}';`);
    }
    await ctx.close();
  });

  test("phone cooldowns (Super Admin): look up the released number and lift its cooldown", async ({ browser }, info) => {
    const ctx = await newRoleContext(browser, info, "en", "light");
    const page = await ctx.newPage();
    await signIn(page, EMAIL.superAdmin);
    await page.goto("/admin/phone-cooldowns");
    await expect(page.getByRole("heading", { name: "Phone cooldowns" })).toBeVisible();
    await page.getByLabel("Phone number").fill(RUN_E164);
    await page.getByRole("button", { name: "Look up" }).click();
    const status = page.getByTestId("phone-cooldown-status");
    await expect(status).toContainText(/In cooldown until /);
    // The action keeps its intrinsic width on desktop (the status card is a flex column, which used to stretch it).
    const lift = status.getByRole("button", { name: "Lift cooldown" });
    const [liftBox, cardBox] = [await lift.boundingBox(), await status.boundingBox()];
    expect(liftBox!.width).toBeLessThan(cardBox!.width / 3);
    await page.screenshot({ path: path.join(SHOTS, "admin-phone-cooldowns-in-cooldown-desktop-en-light.png"), fullPage: true });
    const dialog = await openDialog(page, lift);
    await dialog.locator("#cooldown-reason").fill("Customer support request (PR88 e2e)");
    await dialog.getByRole("button", { name: "Lift cooldown" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("toast").filter({ hasText: "Cooldown lifted." })).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "admin-phone-cooldowns-lifted-toast-desktop-en-light.png"), fullPage: false });
    await expect(status).toContainText("Not in cooldown.");
    await expect(status).toContainText("Customer support request (PR88 e2e)");

    // An Administrator does not hold phones.cooldown_override: the route is refused.
    const adminCtx = await newRoleContext(browser, info, "en", "light");
    const ap = await adminCtx.newPage();
    await signIn(ap, EMAIL.admin);
    await ap.goto("/admin/phone-cooldowns");
    await expect(ap.getByTestId("admin-phone-cooldowns")).toHaveCount(0);
    await adminCtx.close();
    await ctx.close();
  });

  test("offers and my offers load for showroom, home and B2B users", async ({ browser }, info) => {
    for (const [role, urls] of [
      ["showroom", ["/showroom/offers", "/showroom/my-offers"]],
      ["consumer", ["/home/offers"]],
      ["b2b", ["/b2b/offers"]],
    ] as const) {
      const ctx = await newRoleContext(browser, info, "en", "light");
      const page = await ctx.newPage();
      await signIn(page, EMAIL[role]);
      for (const url of urls) {
        await expectNot404(page, url);
        await expect(page).toHaveURL(new RegExp(`${url}$`));
      }
      await ctx.close();
    }
  });

  // No reset afterwards: the render matrix (both projects) opens the request this journey created. The next run's
  // beforeAll returns the seeded showroom to "not verified".
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Render matrix — device × locale × theme
// ---------------------------------------------------------------------------------------------------------------
type Check = { name: string; role: Role; url: string | (() => string); visible: (page: Page) => Locator };

/** The detail page needs a request: the most recent business verification of the showroom org. */
const openBvId = () =>
  scalar(`select id from public.verifications where organization_id = '${HANA_ORG}' and verification_type = 'business' order by created_at desc limit 1`);

const CHECKS: Check[] = [
  { name: "admin-users", role: "admin", url: "/admin/users", visible: (p) => p.locator("main h1") },
  { name: "admin-users-filtered", role: "admin", url: "/admin/users?type=importer", visible: (p) => p.getByText(/fady|فادي/i) },
  { name: "admin-staff", role: "admin", url: "/admin/staff?q=zz-no-such-staff-zz", visible: (p) => p.getByText(/^(No staff match\.|لا يوجد أعضاء مطابقون\.)$/) },
  { name: "admin-bv-queue", role: "admin", url: "/admin/business-verification?status=verified", visible: (p) => p.getByTestId("admin-business-verification") },
  { name: "admin-bv-detail", role: "admin", url: () => `/admin/business-verification/${openBvId()}`, visible: (p) => p.getByText("commercial-register.pdf") },
  { name: "showroom-verification", role: "showroom", url: "/showroom/verification", visible: (p) => p.getByTestId("bv-status") },
  { name: "admin-phone-cooldowns", role: "superAdmin", url: () => `/admin/phone-cooldowns?phone=${encodeURIComponent(RUN_E164)}`, visible: (p) => p.getByTestId("admin-phone-cooldowns") },
  { name: "settings-secondary-phone", role: "consumer", url: "/settings/profile", visible: (p) => p.getByTestId("secondary-phone") },
  { name: "showroom-offers", role: "showroom", url: "/showroom/offers", visible: (p) => p.locator("main h1") },
  { name: "showroom-my-offers", role: "showroom", url: "/showroom/my-offers", visible: (p) => p.locator("main h1") },
  { name: "home-offers", role: "consumer", url: "/home/offers", visible: (p) => p.locator("main h1") },
  { name: "b2b-offers", role: "b2b", url: "/b2b/offers", visible: (p) => p.locator("main h1") },
];

for (const locale of ["en", "ar"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`PR #88 render matrix · ${locale} · ${theme}`, async ({ browser }, info) => {
      test.setTimeout(240_000);
      ensureSuperAdmin();
      const device = isMobile(info) ? "mobile" : "desktop";
      const failures: string[] = [];
      const byRole = new Map<Role, Check[]>();
      for (const c of CHECKS) byRole.set(c.role, [...(byRole.get(c.role) ?? []), c]);
      for (const [role, checks] of byRole) {
        const ctx = await newRoleContext(browser, info, locale, theme);
        const page = await ctx.newPage();
        await signIn(page, EMAIL[role]);
        for (const c of checks) {
          const url = typeof c.url === "function" ? c.url() : c.url;
          if (url.endsWith("/business-verification/")) {
            test.info().annotations.push({ type: "skipped-check", description: `${c.name}: no business verification request exists yet (run the desktop functional journey first)` });
            continue;
          }
          await test.step(`${c.name} (${url})`, async () => {
            try {
              await expectNot404(page, url);
              await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
              if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
              else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
              await expect(c.visible(page).filter({ visible: true }).first()).toBeVisible();
              await noHorizontalOverflow(page);
            } catch (e) {
              failures.push(`${c.name}: ${(e as Error).message.split("\n")[0]}`);
            } finally {
              await page.screenshot({ path: path.join(SHOTS, `${c.name}-${device}-${locale}-${theme}.png`), fullPage: true });
            }
          });
        }
        await ctx.close();
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
}

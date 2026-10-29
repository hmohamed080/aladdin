import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { answerBusinessContactIfAsked, pickBusinessActivity, registerWithPassword, signIn, IDENTITIES } from "./helpers/auth";

/**
 * Pilot Account & Workspace Model — targeted acceptance.
 *
 * ONE PERSON = ONE USER ID. Everything here drives the REAL flows (no auth bypass) against the local stack. Sign-up is
 * the canonical `/auth/sign-up` (Turnstile-gated: run where challenges.cloudflare.com loads):
 *
 *   1. a fresh user registers AS a showroom, creates that business (mandatory) and owns it in their own workspace;
 *   2. an existing personal professional (a seeded Engineer) applies for a business without signing up again;
 *   3. (RC2: a second business waits for the first application's Admin decision; covered by regression/g-org-application-flow);
 *   4. Consumer + business coexist — Personal still reaches /home;
 *   5. tenant isolation: a stale/foreign organization id grants nothing;
 *   6. a revoked membership disappears from the selector and loses access;
 *   7. an invited employee joins an existing organization — no new organization;
 *   8. the migrated pilot business owners still land and operate.
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

const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e5)}`;

/** Register a brand-new identity through the real canonical sign-up + OTP and stop at `landing`. */
async function registerAs(
  page: Page,
  request: APIRequestContext,
  accountType: RegExp,
  displayName: string,
  landing: RegExp,
): Promise<string> {
  const email = `awm-${uniq()}@example.test`;
  await registerWithPassword(page, request, {
    email,
    username: `awm${uniq()}`.slice(0, 24),
    displayName,
    accountType,
    landing,
  });
  return email;
}

/**
 * Drive the business wizard from its first step through submission. RC2: every business is an APPLICATION that an
 * Admin approves; a Showroom also needs its activity and a valid business phone, and every business needs a
 * governorate and a city. The first application lands in that business's limited (pending) workspace.
 */
async function createBusiness(page: Page, name: string, branch: string, opts: { showroom?: boolean; orgType?: RegExp } = {}) {
  const next = () => page.getByRole("button", { name: /^continue$/i }).click();
  await page.locator("#bname").fill(name);
  await page.locator("#blegal").fill(`${name} Trading LLC`);
  if (opts.showroom) {
    await page.locator("#bactivity").selectOption("decor_showroom");
    await page.locator("#bphone").fill(`10${String(Date.now()).slice(-8)}`);
  }
  if (!opts.showroom) await pickBusinessActivity(page);
  await next();
  if (opts.orgType) {
    await expect(page.getByRole("heading", { name: /what kind of business/i })).toBeVisible();
    await page.getByText(opts.orgType).first().click();
    // Each business type answers its own activity list.
    await pickBusinessActivity(page);
    await next();
  }
  await page.locator("#bgov").selectOption("cairo");
  await page.locator("#bcity").selectOption("maadi");
  await next();
  await answerBusinessContactIfAsked(page);
  await page.locator("#bbranch").fill(branch);
  await next();
  await expect(page.getByRole("heading", { name: /review and create/i })).toBeVisible();
  await page.getByRole("button", { name: /submit for review/i }).click();
  await page.waitForURL(/\/(b2b|showroom)(\/|$)/, { waitUntil: "commit" });
}

// The B2B shell renders the switcher twice — a desktop slot and a mobile row —
// with CSS choosing which is shown. Match the VISIBLE one so the same journeys
// run on both viewports.
const switcher = (page: Page) => page.locator('[data-testid="workspace-switcher"]:visible').first();

// The narrow WORKPLACE control (inside /b2b) for people who work in an
// organization without being one of the approved five categories: no "Workspace"
// framing, no Add business, no ownership semantics. Tablet-and-up header only.
const workplaceSwitcher = (page: Page) => page.locator('[data-testid="workplace-switcher"]:visible').first();
// Sign-out lives in the account menu (the header's loose sign-out button is gone).
async function signOutFromAccountMenu(page: Page) {
  await page.getByTestId("profile-menu-trigger").click();
  await page.getByTestId("profile-sign-out").click();
}
const workplaceMenu = (page: Page) => page.locator('[data-testid="workplace-menu"]:visible').first();

// A press that lands before hydration does nothing, so press again until the menu opens.
async function openSwitcher(page: Page) {
  const menu = page.locator('[data-testid="workspace-menu"]:visible').first();
  await expect(async () => {
    if (!(await menu.isVisible())) await switcher(page).click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
}

test.describe("1 — new business registration", () => {
  test("a fresh user registers AS a showroom and owns it", async ({ page, request }) => {
    await prefs(page, "en", "light");

    // The sign-up choice is a direct question about HOW the person will use Aladdin, and "Organization owner /
    // manager" is NOT offered - owner is a relationship, not a type.
    await page.goto("/auth/sign-up");
    const options = await page.locator('select[name="accountType"] option').allTextContents();
    expect(options.some((o) => /^showroom$/i.test(o.trim()))).toBe(true);
    expect(options.some((o) => /owner\s*\/\s*manager/i.test(o))).toBe(false);

    await registerAs(page, request, /^showroom$/i, "Hala Showroom", /\/onboarding\/business(\/|$|\?)/);

    // Creating the first business is the mandatory continuation of the registration. Copy speaks about a BUSINESS,
    // not an "organization", and the registered type is preset (no type step).
    await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
    await createBusiness(page, "Hala Ceramics", "Nasr City HQ", { showroom: true });

    // RC2: the first application opens the Showroom's limited workspace while Admin reviews it.
    await expect(page.getByText("Hala Ceramics", { exact: true }).first()).toBeAttached();
    await openSwitcher(page);
    const menu = page.locator('[data-testid="workspace-menu"]:visible').first();
    await expect(menu.getByRole("menuitem", { name: /Hala Ceramics/ })).toContainText(/showroom/i);
    // No fake Personal workspace: they never claimed a personal persona.
    await expect(menu.getByRole("menuitem", { name: /^Personal$/ })).toHaveCount(0);
    await noOverflow(page);
  });
});

test.describe("2 + 5 — an existing professional applies for a business", () => {
  test("applies for an organization from the workspace menu, keeps their personal identity, and stays isolated", async ({
    page,
    request,
  }) => {
    await prefs(page, "en", "light");
    // A PERSONAL persona - the seeded Engineer, also a member of Horizon Contracting. He stays an Engineer throughout.
    const office = `AH Engineering Office ${uniq()}`;
    await signIn(page, request, "yasser@example.test", /\/home(\/|$|\?)/);
    await expect(page.getByRole("heading", { name: /welcome, yasser fouad/i })).toBeVisible();

    // ---- 2. Apply for a business from the authenticated product UI. No Sign Up. ----
    // RC2: the menu offers Personal, the organizations he works in, and "Request New Organization".
    await openSwitcher(page);
    const menu = page.locator('[data-testid="workspace-menu"]:visible').first();
    await expect(menu.getByRole("menuitem", { name: /Yasser Fouad.*Personal/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Horizon Contracting/ })).toBeVisible();
    await menu.getByRole("menuitem", { name: /request new organization/i }).click();
    await page.waitForURL(/\/business\/new/, { waitUntil: "commit" });
    await expect(page.getByText(/sign up|create account/i)).toHaveCount(0);

    // An Engineer first chooses how he operates; an organization is an application an Admin approves.
    await expect(page.getByRole("heading", { name: "How do you work?" })).toBeVisible();
    // A press that lands before hydration only focuses the option, so retry until the choice enables Continue.
    const proceed = page.getByRole("button", { name: /^continue$/i });
    await expect(async () => {
      await page.getByText("Engineering Office").first().click();
      await expect(proceed).toBeEnabled({ timeout: 1_000 });
    }).toPass();
    await proceed.click();
    await page.waitForURL(/model=organization/);
    await createBusiness(page, office, "Zayed HQ", { orgType: /^Engineer$/ });

    // The application is tracked; it is not yet an approved workspace.
    await page.goto("/business/applications");
    await expect(page.getByTestId("application-pending_review")).toContainText(office);

    // Applying did NOT change who he is: Personal is still his, with the Engineer persona.
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: /welcome, yasser fouad/i })).toBeVisible();
    await expect(page.getByText("Engineer").first()).toBeVisible();

    // ---- 5. Tenant isolation: a stale/foreign organization id in the context cookie grants nothing. ----
    await page.context().addCookies([
      { name: "aladdin-org", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", url: "http://127.0.0.1" },
    ]);
    await page.goto("/b2b");
    await expect(page.getByText("Nile Finishing Supplies", { exact: true })).toHaveCount(0);
    await noOverflow(page);
  });
});

test.describe("4 — consumer and business creation", () => {
  test("a consumer is never offered Add business, cannot open /business/new, and keeps a working personal home", async ({ page, request }) => {
    await prefs(page, "en", "light");
    // The seeded End Consumer (a personal persona; it is not a registrable type yet).
    await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$|\?)/);

    // Creating a business is not a personal-account action: no generic switcher,
    // no Add business, and the server-side entitlement turns the URL away.
    await expect(page.getByTestId("workspace-switcher")).toHaveCount(0);
    await expect(page.getByText(/add business/i)).toHaveCount(0);
    await page.goto("/business/new");
    await expect(page).toHaveURL(/\/home$/);
    // profile-completion.spec renames this seeded consumer, so match the greeting rather than the name.
    await expect(page.getByRole("heading", { level: 1, name: /^welcome,/i })).toBeVisible();
  });
});

test.describe("7 — invitation regression", () => {
  test("accepting an invitation joins an existing organization, creating none", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "consumes the seeded invitation token");
    await prefs(page, "en", "light");

    // The seeded pending invitation belongs to Karim's address; global setup
    // recreates it each run.
    const { E2E_INVITE_TOKEN } = await import("./global-setup");
    await signIn(page, request, IDENTITIES.branchLimited, /\/(b2b|home)(\/|$)/);
    await page.goto(`/auth/invite/${E2E_INVITE_TOKEN}`);

    const accept = page.getByRole("button", { name: /accept|join/i }).first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
      // Where acceptance lands depends on the caller's work context, and Karim
      // already holds a personal persona — so this asserts that it RESOLVED, not
      // that it went to one particular surface.
      await page.waitForURL(/\/(b2b|home)(\/|$)/, { waitUntil: "commit" });
    }

    // The invariant that matters: he joined the EXISTING organization. Exactly one
    // Organization A entry, no second organization, and no second identity — the
    // workplace control is read from his own memberships, so a duplicate would show
    // here. He is an employee, not one of the approved five: no generic switcher.
    await page.goto("/home");
    await expect(page.getByTestId("workspace-switcher")).toHaveCount(0);
    await page.goto("/b2b");
    await workplaceSwitcher(page).click();
    const menu = workplaceMenu(page);
    await expect(menu.getByRole("menuitem", { name: /Nile Finishing Supplies/ })).toHaveCount(1);
    await expect(menu.getByRole("menuitem", { name: /Karim|^Personal$/ })).toHaveCount(1);
    await expect(menu.getByText(/add business/i)).toHaveCount(0);
  });
});

test.describe("6 — revoked membership", () => {
  test("a revoked membership leaves the selector and loses access", async ({ page, request }, testInfo) => {
    // Destructive: revokes a seeded membership through the trusted people-ops UI.
    test.skip(testInfo.project.name !== "chromium-desktop", "destructive: revokes a seeded membership");
    await prefs(page, "en", "light");

    // Karim (the Cairo branch rep) belongs to exactly one organization.
    await signIn(page, request, IDENTITIES.branchLimited, /\/(home|b2b)(\/|$)/);
    await page.goto("/b2b");
    await workplaceSwitcher(page).click();
    await expect(workplaceMenu(page).getByRole("menuitem", { name: /Nile Finishing Supplies/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await signOutFromAccountMenu(page);
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    // Amina (the org manager) revokes him through the existing people-ops path.
    await signIn(page, request, IDENTITIES.manager, /\/(home|b2b)(\/|$)/);
    await page.goto("/b2b/organization");
    // Member cards are identified by display name — the email is masked in this UI.
    const card = page.locator("div.shadow-card").filter({ hasText: "Karim" }).first();
    await card.getByRole("button", { name: /^revoke$/i }).click();
    const confirm = page.getByRole("button", { name: /^revoke$|^confirm$/i }).last();
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.locator("div.shadow-card").filter({ hasText: "Karim" }).first())
      .toContainText(/revoked/i);
    await signOutFromAccountMenu(page);
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    // Karim now has no business workspace: the organization is gone from the
    // selector, and direct navigation cannot reach it.
    await signIn(page, request, IDENTITIES.branchLimited, /\/(home|b2b)(\/|$)/);
    await page.goto("/b2b");
    await expect(page.getByText("Nile Finishing Supplies", { exact: true })).toHaveCount(0);
  });
});

test.describe("8 — migrated pilot owners", () => {
  // The four seeded Showroom/Manufacturer/Importer/Wholesaler owners became
  // BUSINESS-ONLY identities in the migration: no personal persona, every
  // organization/membership/branch intact. They must still land and operate.
  for (const [who, org] of [
    ["hana@example.test", "Cairo Ceramics Showroom"],
    ["tarek@example.test", "Egypt Marble Manufacturing"],
    ["sara@example.test", "Nile Import & Trade"],
    ["khaled@example.test", "Delta Wholesale Supply"],
  ] as const) {
    test(`${who} still lands in ${org}`, async ({ page, request }) => {
      await prefs(page, "en", "light");
      await signIn(page, request, who, /\/b2b(\/|$)/);
      await expect(page.getByText(org, { exact: true }).first()).toBeAttached();

      // Business-only: no Personal entry is offered (it would be empty and fake).
      await openSwitcher(page);
      await expect(
        page.locator('[data-testid="workspace-menu"]:visible').first().getByRole("menuitem", { name: /^Personal$/ }),
      ).toHaveCount(0);
    });
  }
});

test.describe("bilingual + responsive — changed surfaces", () => {
  test("the workspace selector and registration choice render correctly in Arabic RTL", async ({
    page,
    request,
  }) => {
    await prefs(page, "ar", "light");
    await signIn(page, request, "hana@example.test", /\/b2b(\/|$)/);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await openSwitcher(page);
    const menu = page.locator('[data-testid="workspace-menu"]:visible').first();
    // Arabic copy, not English leaking through.
    await expect(menu.getByText("مساحة العمل").first()).toBeVisible();
    await expect(menu.getByText("طلب إضافة مؤسسة جديدة")).toBeVisible();
    await expect(menu.getByText(/^Workspace$|^Add business$/)).toHaveCount(0);
    await noOverflow(page);
  });

  test("the registration choice is bilingual and business-first in Arabic", async ({ page }) => {
    await prefs(page, "ar", "light");
    await page.goto("/auth/sign-up");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // Every selectable label is Arabic (no English leaking through).
    const options = (await page.locator('select[name="accountType"] option:not([disabled])').allTextContents()).map((o) => o.trim());
    expect(options.length).toBeGreaterThanOrEqual(4);
    for (const label of options) expect(label, label).toMatch(/[\u0600-\u06FF]/);
    const all = (await page.locator('select[name="accountType"] option').allTextContents()).map((o) => o.trim());
    expect(all.join(" ")).not.toMatch(/\bShowroom\b|\bSupplier\b|\bImporter\b|\bManufacturer\b/);
    await noOverflow(page);
  });
});

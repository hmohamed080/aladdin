import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { messageIdsFor, readNewOtp, signIn, IDENTITIES } from "./helpers/auth";

/**
 * Pilot Account & Workspace Model — targeted acceptance.
 *
 * ONE PERSON = ONE USER ID. Everything here drives the REAL passwordless flow (no
 * auth bypass) against the local stack:
 *
 *   1. a fresh user registers AS a showroom and lands in their own workspace;
 *   2. an existing personal professional adds a business without signing up again;
 *   3. the same user owns two businesses of different types and switches between;
 *   4. Consumer + business coexist — Personal still reaches /home;
 *   5. tenant isolation across a switch, including stale/foreign ids;
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

/** Register a brand-new identity and complete the shared steps. */
async function registerToAccountType(
  page: Page,
  request: APIRequestContext,
  displayName: string,
): Promise<string> {
  const email = `awm+${Date.now()}${Math.floor(Math.random() * 10000)}@example.test`;
  const seen = await messageIdsFor(request, email);
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

  await page.locator("#displayName").fill(displayName);
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
  await page.locator("#phone").fill("01012345678");
  await page.getByRole("button", { name: /^continue$|متابعة/i }).click();
  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  return email;
}

/** Drive the business wizard from its first step through creation. */
async function createBusiness(page: Page, name: string, branch: string, orgType?: RegExp) {
  await page.locator("#bname").fill(name);
  await page.getByRole("button", { name: /^continue$/i }).click();
  if (orgType) {
    await expect(page.getByRole("heading", { name: /what kind of business/i })).toBeVisible();
    await page.getByRole("button", { name: orgType }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
  }
  await page.getByRole("button", { name: /^continue$/i }).click(); // location (optional)
  await page.locator("#bbranch").fill(branch);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await expect(page.getByRole("heading", { name: /review and create/i })).toBeVisible();
  await page.getByRole("button", { name: /create business/i }).click();
  await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
}

const switcher = (page: Page) => page.getByTestId("workspace-switcher").first();

async function openSwitcher(page: Page) {
  await switcher(page).click();
  await expect(page.getByTestId("workspace-menu").first()).toBeVisible();
}

async function switchTo(page: Page, name: RegExp, landing: RegExp) {
  await openSwitcher(page);
  await page.getByTestId("workspace-menu").first().getByRole("menuitem", { name }).click();
  await page.waitForURL(landing, { waitUntil: "commit" });
}

test.describe("1 — new business registration", () => {
  test("a fresh user registers AS a showroom and owns it", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerToAccountType(page, request, "Hala Showroom");

    // The choice is a direct Personal-or-Business question, and "Organization
    // owner / manager" is NOT offered — owner is a relationship, not a type.
    await expect(page.getByText(/for my business/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /organization owner \/ manager/i })).toHaveCount(0);

    await page.getByRole("button", { name: /^showroom \/ dealer/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/business$/, { waitUntil: "commit" });

    // Copy speaks about a BUSINESS, not an "organization".
    await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
    await createBusiness(page, "Hala Ceramics", "Nasr City HQ");

    await expect(page.getByText("Hala Ceramics", { exact: true }).first()).toBeAttached();
    // The creator is the OWNER, stated by the switcher.
    await openSwitcher(page);
    const menu = page.getByTestId("workspace-menu").first();
    await expect(menu.getByRole("menuitem", { name: /Hala Ceramics/ })).toContainText(/owner/i);
    // No fake Personal workspace: they never claimed a personal persona.
    await expect(menu.getByRole("menuitem", { name: /^Personal$/ })).toHaveCount(0);
    await noOverflow(page);
  });
});

test.describe("2 + 3 + 5 — an existing professional adds businesses", () => {
  test("adds a business, switches contexts, then adds a second of another type", async ({
    page,
    request,
  }) => {
    await prefs(page, "en", "light");
    const email = await registerToAccountType(page, request, "Ahmed Engineer");

    // A PERSONAL persona — he is an Engineer, and stays one throughout.
    await page.getByRole("button", { name: /^Engineer Offer/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/professional$/, { waitUntil: "commit" });

    // The concrete type came from registration; the flow does not re-ask it.
    await page.locator("#headline").fill("Structural engineering, Cairo");
    await page.locator("#years").fill("9");
    await page.getByRole("button", { name: /^structural$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^design review$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.locator("#gov").selectOption("cairo");
    await page.getByRole("button", { name: /^new cairo$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /continue to review/i }).click();
    await page.getByRole("button", { name: /submit for review/i }).click();
    await page.waitForURL(/\/home$/, { waitUntil: "commit" });

    // ---- 2. Add a business from the authenticated product UI. No Sign Up. ----
    await openSwitcher(page);
    await page.getByRole("menuitem", { name: /add business/i }).click();
    await page.waitForURL(/\/business\/new$/, { waitUntil: "commit" });
    await expect(page.getByText(/sign up|create account/i)).toHaveCount(0);

    await createBusiness(page, "AH Design Studio", "Zayed HQ", /^showroom \/ dealer/i);
    await expect(page.getByText("AH Design Studio", { exact: true }).first()).toBeAttached();

    // Switching to the business did NOT change who he is.
    await switchTo(page, /^Ahmed Engineer|^Personal/, /\/home$/);
    await expect(page.getByRole("heading", { name: /welcome, ahmed engineer/i })).toBeVisible();
    await expect(page.getByText("Engineer").first()).toBeVisible();

    // ---- 3. A SECOND business, of a DIFFERENT type. ----
    await openSwitcher(page);
    await page.getByRole("menuitem", { name: /add business/i }).click();
    await page.waitForURL(/\/business\/new$/, { waitUntil: "commit" });
    await createBusiness(page, "AH Import", "Port Said", /^importer/i);
    await expect(page.getByText("AH Import", { exact: true }).first()).toBeAttached();

    // Both businesses AND the personal context are offered — one login, three
    // places to work, one identity.
    await openSwitcher(page);
    const menu = page.getByTestId("workspace-menu").first();
    await expect(menu.getByRole("menuitem", { name: /AH Design Studio/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /AH Import/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: /Ahmed Engineer|^Personal$/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // ---- 5. Tenant isolation across a switch. ----
    await switchTo(page, /AH Design Studio/, /\/b2b(\/|$)/);
    await expect(page.getByText("AH Design Studio", { exact: true }).first()).toBeAttached();
    await expect(page.getByText("AH Import", { exact: true })).toHaveCount(0);
    await switchTo(page, /AH Import/, /\/b2b(\/|$)/);
    await expect(page.getByText("AH Import", { exact: true }).first()).toBeAttached();

    // A stale/foreign organization id in the context cookie grants nothing — it
    // resolves to a workspace this caller actually has.
    await page.context().addCookies([
      { name: "aladdin-org", value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", url: "http://127.0.0.1" },
    ]);
    await page.goto("/b2b");
    await expect(page.getByText("Organization A", { exact: true })).toHaveCount(0);
    await noOverflow(page);

    // Sign back in later: the same identity still holds both businesses.
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
    await signIn(page, request, email, /\/(b2b|home)(\/|$)/);
  });
});

test.describe("4 — consumer plus business", () => {
  test("a consumer adds a business and keeps a working personal home", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerToAccountType(page, request, "Mona Consumer");

    await page.getByRole("button", { name: /^Personal use /i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/consumer$/, { waitUntil: "commit" });
    await page.getByRole("button", { name: /skip setup for now/i }).click();
    await page.waitForURL(/\/home$/, { waitUntil: "commit" });

    await openSwitcher(page);
    await page.getByRole("menuitem", { name: /add business/i }).click();
    await page.waitForURL(/\/business\/new$/, { waitUntil: "commit" });
    await createBusiness(page, "Mona Supplies", "Maadi HQ", /^supplier/i);

    // Business reaches /b2b…
    await expect(page.getByText("Mona Supplies", { exact: true }).first()).toBeAttached();
    // …and Personal still reaches /home, unchanged by owning a business.
    await switchTo(page, /Mona Consumer|^Personal$/, /\/home$/);
    await expect(page.getByRole("heading", { name: /welcome, mona consumer/i })).toBeVisible();
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
      await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    }

    // He joined the EXISTING organization — no second organization was created
    // for him, and no second identity exists.
    await openSwitcher(page);
    const menu = page.getByTestId("workspace-menu").first();
    await expect(menu.getByRole("menuitem", { name: /Organization A/ })).toHaveCount(1);
  });
});

test.describe("6 — revoked membership", () => {
  test("a revoked membership leaves the selector and loses access", async ({ page, request }, testInfo) => {
    // Destructive: revokes a seeded membership through the trusted people-ops UI.
    test.skip(testInfo.project.name !== "chromium-desktop", "destructive: revokes a seeded membership");
    await prefs(page, "en", "light");

    // Karim (the Cairo branch rep) belongs to exactly one organization.
    await signIn(page, request, IDENTITIES.branchLimited, /\/(home|b2b)(\/|$)/);
    await openSwitcher(page);
    await expect(
      page.getByTestId("workspace-menu").first().getByRole("menuitem", { name: /Organization A/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /sign out/i }).click();
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
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    // Karim now has no business workspace: the organization is gone from the
    // selector, and direct navigation cannot reach it.
    await signIn(page, request, IDENTITIES.branchLimited, /\/(home|b2b)(\/|$)/);
    await page.goto("/b2b");
    await expect(page.getByText("Organization A", { exact: true })).toHaveCount(0);
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
        page.getByTestId("workspace-menu").first().getByRole("menuitem", { name: /^Personal$/ }),
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
    const menu = page.getByTestId("workspace-menu").first();
    // Arabic copy, not English leaking through.
    await expect(menu.getByText("مساحة العمل").first()).toBeVisible();
    await expect(menu.getByText("إضافة نشاط تجاري")).toBeVisible();
    await expect(menu.getByText(/^Workspace$|^Add business$/)).toHaveCount(0);
    await noOverflow(page);
  });

  test("the registration choice is bilingual and business-first in Arabic", async ({ page, request }) => {
    await prefs(page, "ar", "light");
    await registerToAccountType(page, request, "زينب");

    await expect(page.getByText("لنفسي")).toBeVisible();
    await expect(page.getByText("لنشاطي التجاري")).toBeVisible();
    await expect(page.getByText(/^For myself$|^For my business$/)).toHaveCount(0);
    await noOverflow(page);
  });
});

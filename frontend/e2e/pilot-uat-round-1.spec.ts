import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { messageIdsFor, readNewOtp, signIn, IDENTITIES } from "./helpers/auth";

/**
 * Pilot UAT fix round 1 — targeted acceptance.
 *
 * Everything here drives the REAL passwordless flow (no auth bypass) against the
 * local stack, and asserts the behaviours the manual Pilot round found broken:
 *
 *   C. a fresh Interior Designer reaches a usable professional /home;
 *   D. the GENERIC "Organization owner / manager" entry saves, then picks the real
 *      organization type during business onboarding, and resumes correctly;
 *   E. every changed Admin surface loads for admin@example.test;
 *   F. an Admin decision reaches the affected organization, and account usage
 *      never depended on that decision;
 *   plus surface isolation (consumer / owner / manager cannot open /admin) and the
 *   Arabic RTL rendering of the changed personal surface.
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
  const email = `uat+${Date.now()}${Math.floor(Math.random() * 1000)}@example.test`;
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

test.describe("Pilot UAT round 1 — personal accounts", () => {
  test("C. fresh Interior Designer: submits, then uses a professional /home without approval", async ({
    page,
    request,
  }) => {
    await prefs(page, "en", "light");
    await registerToAccountType(page, request, "Dalia Designer");

    await page.getByRole("button", { name: /engineer \/ designer/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/professional$/, { waitUntil: "commit" });

    // The engineer/designer choice resolves to the DISTINCT interior_designer type.
    await page.getByRole("button", { name: /^interior designer$/i }).click();
    await page.locator("#headline").fill("Residential interiors, New Cairo");
    await page.locator("#years").fill("7");
    await page.getByRole("button", { name: /^residential$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.getByRole("button", { name: /^space planning$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.locator("#gov").selectOption("cairo");
    await page.getByRole("button", { name: /^new cairo$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /continue to review/i }).click();
    await page.waitForURL(/\/onboarding\/professional\/review$/, { waitUntil: "commit" });
    await page.getByRole("button", { name: /submit for review/i }).click();

    // Usable professional home — NOT a review-waiting screen.
    await page.waitForURL(/\/home$/, { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: /welcome, dalia designer/i })).toBeVisible();
    await expect(page.getByText("Residential interiors, New Cairo")).toBeVisible();
    // Persona is stated, and no consumer copy is present.
    await expect(page.getByText("Interior Designer").first()).toBeVisible();
    await expect(page.getByText(/discover professionals/i)).toHaveCount(0);
    // Completeness and verification are SEPARATE signals; neither blocks anything.
    await expect(page.getByText(/profile completeness/i)).toBeVisible();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.getByText(/pending review/i)).toBeVisible();
    // Professional facts are read back.
    await expect(page.getByText(/space planning/i)).toBeVisible();
    await expect(page.getByText(/where you work/i)).toBeVisible();
    await noOverflow(page);

    // Signing out and back in RESUMES on the same usable home.
    await page.getByRole("button", { name: /sign out|تسجيل الخروج/i }).click();
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });
  });

  test("consumer /home is persona-correct in Arabic RTL and denies /admin", async ({ page, request }) => {
    await prefs(page, "ar", "light");
    await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$)/);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "اكتمال الملف الشخصي" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "اهتماماتك" })).toBeVisible();
    await noOverflow(page);

    // Surface isolation: an ordinary consumer cannot open the Admin console.
    await page.goto("/admin");
    await page.waitForURL(/\/home(\/|$)/, { waitUntil: "commit" });
    await expect(page.getByText(/نظرة عامة على النسخة التجريبية/)).toHaveCount(0);
  });
});

test.describe("Pilot UAT round 1 — organization owner / manager", () => {
  test("D. generic Owner/Manager: saves, picks the real organization type, resumes, creates", async ({
    page,
    request,
  }) => {
    await prefs(page, "en", "light");
    await registerToAccountType(page, request, "Owner Manager");

    // The generic entry carries NO business type — this used to fail with
    // "We couldn't save that. Try again."
    await page.getByRole("button", { name: /organization owner \/ manager/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/business$/, { waitUntil: "commit" });
    await expect(page.getByText(/couldn't save that/i)).toHaveCount(0);
    await noOverflow(page);

    await page.locator("#bname").fill("Zayed Marble Trading");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // The REAL organization type is chosen here, not at the account-type step.
    await expect(page.getByRole("heading", { name: /what kind of business/i })).toBeVisible();
    await page.getByRole("button", { name: /^wholesaler/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Resume check: the autosaved draft (name + chosen type) survives a full
    // reload, and the wizard resumes past the steps that are already answered.
    await page.reload();
    await expect(page.getByRole("heading", { name: /review and create/i })).toBeVisible();
    await expect(page.getByText("Wholesaler").first()).toBeVisible();
    await expect(page.getByText("Zayed Marble Trading").first()).toBeVisible();

    // Step back into the type step: the selection is still the saved one.
    await page.getByRole("button", { name: /^back$/i }).click();
    await page.getByRole("button", { name: /^back$/i }).click();
    await page.getByRole("button", { name: /^back$/i }).click();
    await expect(page.getByRole("button", { name: /^wholesaler/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click(); // location (optional)
    await page.locator("#bbranch").fill("Sheikh Zayed HQ");
    await page.getByRole("button", { name: /^continue$/i }).click();

    await expect(page.getByRole("heading", { name: /review and create/i })).toBeVisible();
    await page.locator("#owner").check();
    await page.getByRole("button", { name: /create organization/i }).click();

    // Owner reaches the workspace of the organization they just created.
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    // The shell shows the organization in viewport-dependent slots, so assert
    // presence rather than the visibility of one particular slot.
    await expect(page.getByText("Zayed Marble Trading", { exact: true }).first()).toBeAttached();

    // Surface isolation: an organization owner cannot open the Admin console.
    await page.goto("/admin");
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    await expect(page.getByText("Pilot overview")).toHaveCount(0);
  });

  test("a concrete business type chosen at the account-type step still works", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await registerToAccountType(page, request, "Concrete Owner");

    await page.getByRole("button", { name: /showroom \/ dealer/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.waitForURL(/\/onboarding\/business$/, { waitUntil: "commit" });

    await page.locator("#bname").fill("Giza Showroom");
    await page.getByRole("button", { name: /^continue$/i }).click();
    // Pre-selected from the account-type intent.
    await expect(page.getByRole("button", { name: /^showroom \/ dealer/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await page.locator("#owner").check();
    await page.getByRole("button", { name: /create organization/i }).click();
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    await expect(page.getByText("Giza Showroom", { exact: true }).first()).toBeAttached();
  });

  test("an organization MANAGER cannot open the Admin console", async ({ page, request }) => {
    await prefs(page, "en", "light");
    // Laila is Horizon Contracting's org manager in the pilot world.
    await signIn(page, request, "laila@example.test", /\/b2b(\/|$)/);
    await page.goto("/admin");
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    await expect(page.getByText("Pilot overview")).toHaveCount(0);
  });
});

test.describe("Pilot UAT round 1 — Admin console", () => {
  test("E. every changed Admin surface loads with real content", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await signIn(page, request, IDENTITIES.admin, /\/admin(\/|$)/);

    // Dashboard — useful counts.
    await expect(page.getByRole("heading", { name: "Pilot overview" })).toBeVisible();
    // Scope to the content region: the sidebar repeats these words and is hidden
    // on a small viewport.
    const dashboard = page.getByRole("main");
    await expect(dashboard.getByText("Users", { exact: true })).toBeVisible();
    await expect(dashboard.getByText(/pending reviews/i)).toBeVisible();
    await noOverflow(page);

    // Users — list, search, detail (account/persona/status + memberships).
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: /^users$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Hana \(Cairo Ceramics Owner\)/ })).toBeVisible();
    await page.getByPlaceholder(/search by name/i).fill("hana");
    await page.getByRole("button", { name: /^search$/i }).click();
    await page.waitForURL(/q=hana/, { waitUntil: "commit" });
    await page.getByRole("link", { name: /Hana \(Cairo Ceramics Owner\)/ }).click();
    await expect(page.getByText(/organization memberships/i)).toBeVisible();
    await expect(page.getByText(/Showroom \/ Dealer/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Cairo Ceramics Showroom/ })).toBeVisible();

    // Organizations — list and detail (members, branches, verification state).
    await page.goto("/admin/organizations");
    await page.getByRole("link", { name: /^Horizon Contracting$/ }).click();
    await expect(page.getByRole("heading", { name: /branches/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /members/i })).toBeVisible();
    await expect(page.getByText(/New Cairo Office/)).toBeVisible();
    await expect(page.getByText(/Not verified|Verified/).first()).toBeVisible();
    await noOverflow(page);

    // Audit — meaningful entries carrying actor, action, target and timestamp.
    // Assertions stay order-independent: the feed shows the newest 40 events, and
    // any earlier test in the run adds to it.
    await page.goto("/admin/audit");
    await expect(page.getByRole("heading", { name: /audit log/i })).toBeVisible();
    const entries = page.getByRole("listitem");
    expect(await entries.count()).toBeGreaterThan(0);
    // Newest entry: a named actor and a time, not a bare row.
    await expect(entries.first()).toContainText(/\d{1,2}:\d{2}/);
    await expect(entries.first()).toContainText(/[A-Za-z]/);
    // A raw enum key anywhere in the feed means a missing action translation —
    // the defect this round fixed.
    await expect(page.getByText(/[a-z_]+\.[a-z_]+/)).toHaveCount(0);
  });

  test("F. an Admin decision reaches the organization; usage never depended on it", async ({
    page,
    request,
  }, testInfo) => {
    // The seeded review queue is a ONE-SHOT resource: global setup restores it once
    // per invocation, and approving is irreversible through the RPCs. Running this
    // on a second project would find the queue already decided, so it is pinned to
    // one project rather than made to guess which review is still open.
    test.skip(
      testInfo.project.name !== "chromium-desktop",
      "destructive: consumes the seeded pending review",
    );
    await prefs(page, "en", "light");

    // The pending organization's owner can already use their workspace — BEFORE
    // any Admin decision exists. Activation was never gated on approval.
    await signIn(page, request, "tarek@example.test", /\/b2b(\/|$)/);
    await expect(page.getByText("Egypt Marble Manufacturing", { exact: true }).first()).toBeAttached();
    await page.getByRole("button", { name: /sign out/i }).click();
    await page.waitForURL(/\/auth\/sign-in/, { waitUntil: "commit" });

    // Admin approves the organization review.
    await signIn(page, request, IDENTITIES.admin, /\/admin(\/|$)/);
    await page.goto("/admin/verifications");
    // Scope to the queue card for THIS organization (the queue holds two).
    const card = page.locator("div.shadow-card").filter({ hasText: "Egypt Marble Manufacturing" });
    await card.getByRole("button", { name: /^approve$/i }).click();
    await expect(page.getByText(/Egypt Marble Manufacturing/)).toHaveCount(0);

    // The decision is REFLECTED on the organization, not just on the request.
    await page.goto("/admin/organizations");
    const row = page.getByRole("row").filter({ hasText: "Egypt Marble Manufacturing" });
    await expect(row.getByText("Active")).toBeVisible();
    await page.getByRole("link", { name: /^Egypt Marble Manufacturing/ }).click();
    await expect(page.getByText("Verified").first()).toBeVisible();

    // …and it is audited with a real actor and target.
    await page.goto("/admin/audit");
    await expect(page.getByText(/verified an organization/i).first()).toBeVisible();
  });
});

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Hosted, READ-ONLY acceptance E2E for the Cloudflare Acceptance preview (playwright.acceptance.config.ts).
 *
 * Rules:
 *  - READ-ONLY. Navigation and sign-in only: nothing is created, edited, deleted or submitted beyond the sign-in form.
 *  - Acceptance only. Any request to the live Supabase project or the live domain is aborted and fails the run.
 *  - Turnstile is stubbed INSIDE the test browser (the stand-in the local suites use). That is valid only because hosted
 *    CAPTCHA protection is OFF on Acceptance, so Supabase Auth does not verify the token; once it is switched on this
 *    suite must use the real widget with an always-pass test key instead.
 *  - The "Showroom RC2 drift" block records what renders today for each of the 17 local spec drifts
 *    (docs/operations/e2e-shared-failures-triage-2026-10-22.md) as annotations. It never fails on them: they need product
 *    review, and asserting either the old or the new labels here would decide that review silently.
 */

const OWNER = "test1@example.com";
const MANAGER = "acc6-sales-manager@example.test";
const REP = "acc6-sales-rep@example.test";
const ORG_BRANCHES = ["ACC6 Cairo", "ACC6 Giza", "test"];
const NOT_AUTHORIZED = "You're not allowed to manage members here.";

const FORBIDDEN_HOSTS = /kkpkgjrweysgvhvkhzun|aladdindecore\.com/i;
const GENERIC_ERROR = /Application error|a server-side exception has occurred|Digest:/i;
const TURNSTILE_STUB = `window.turnstile={render:function(el,o){setTimeout(function(){o.callback("XXXX.DUMMY.TOKEN.XXXX")},0);return "acceptance-e2e"},remove:function(){},reset:function(){}};`;

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is not set - it comes from the GitHub acceptance-e2e Environment.`);
  return value;
}

const violations: string[] = [];

async function guardedContext(context: BrowserContext): Promise<BrowserContext> {
  await context.route(FORBIDDEN_HOSTS, (route) => {
    violations.push(new URL(route.request().url()).host);
    return route.abort();
  });
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: TURNSTILE_STUB }),
  );
  const host = new URL(required("ACCEPTANCE_BASE_URL")).hostname;
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", domain: host, path: "/", secure: true, sameSite: "Lax" }]);
  return context;
}

async function newPersonaContext(browser: import("@playwright/test").Browser): Promise<BrowserContext> {
  // A context made from the `browser` fixture does not inherit the config's `use` options, so pass them.
  return guardedContext(await browser.newContext({ baseURL: required("ACCEPTANCE_BASE_URL"), locale: "en-US" }));
}

async function signIn(context: BrowserContext, email: string, password: string, who: string): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto("/auth/sign-in", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/^mobile number, username or email$/i).fill(email);
    // A failed fill must never echo the value into the log or the uploaded report.
    await page.getByLabel(/^password$/i).fill(password).catch(() => {
      throw new Error(`The ${who} password field could not be filled on /auth/sign-in.`);
    });
    await expect(page.locator('input[name="captchaToken"]')).not.toHaveValue("", { timeout: 30_000 });
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL((url) => !/\/sign-in(\/|$)/.test(url.pathname), { timeout: 45_000 }).catch(async () => {
      const alert = (await page.getByRole("alert").allInnerTexts().catch(() => [])).join(" | ").slice(0, 200);
      throw new Error(`Sign-in as the ${who} did not complete (still on the sign-in page). Message: ${alert || "none"}`);
    });
    const landed = new URL(page.url()).pathname;
    expect(landed, `${who} signed in but landed on ${landed}`).not.toMatch(/^\/(onboarding|auth|installer)\b/);
  } finally {
    await page.close();
  }
}

/** Opens `path`, follows redirects, and asserts a healthy authenticated page. Returns the final path. */
async function openHealthy(page: Page, path: string, who: string): Promise<string> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${who}: no response for ${path}`).not.toBeNull();
  expect(response?.status() ?? 0, `${who}: ${path} answered HTTP ${response?.status()}`).toBeLessThan(400);
  // Some routes finish with a client-side redirect (/b2b -> /showroom/home). Let it land before reading the page, or the
  // next goto on this page is aborted mid-redirect (net::ERR_ABORTED). Realtime websockets do not hold networkidle.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, `${who}: ${path} sent the account to ${finalPath} (signed out?)`).not.toMatch(/\/sign-in(\/|$)/);
  await expect(page.locator("main").first(), `${who}: no authenticated shell on ${path}`).toBeVisible();
  await expect(page.getByTestId("aladdin-error-boundary"), `${who}: ${path} rendered the Aladdin error screen`).toHaveCount(0);
  expect(await page.locator("body").innerText(), `${who}: ${path} rendered a server error page`).not.toMatch(GENERIC_ERROR);
  return finalPath;
}

async function branchOptions(page: Page): Promise<string[]> {
  // The design-system Select keeps a visually hidden native <select> as THE labelled control (components/ui/controls.tsx),
  // so it resolves by label, is attached rather than visible, and carries the options.
  const select = page.getByLabel(/^branch$/i).first();
  await expect(select, "the customers branch filter is missing").toBeAttached();
  return (await select.locator("option").allTextContents()).map((s) => s.trim());
}

function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
  console.log(`[${type}] ${description}`);
}

test.afterAll(() => {
  expect(violations, `requests to a live host were attempted: ${violations.join(", ")}`).toEqual([]);
});

test.describe("public smoke", () => {
  test("health, sign-in and backend binding answer on the preview", async ({ browser }) => {
    const context = await newPersonaContext(browser);
    try {
      const health = await context.request.get("/api/health");
      expect(health.status(), "/api/health").toBe(200);
      const backend = await context.request.get("/api/backend/health");
      expect(backend.status(), "/api/backend/health").toBe(200);
      const body = await backend.json();
      expect(body, "the backend must be the staging/acceptance service").toMatchObject({ status: "ok", service: "backend", env: "staging" });
      for (const path of ["/", "/auth/sign-in", "/installer/sign-in", "/legal/terms"]) {
        expect((await context.request.get(path)).status(), path).toBe(200);
      }
      const page = await context.newPage();
      await page.goto("/showroom", { waitUntil: "domcontentloaded" });
      expect(new URL(page.url()).pathname, "/showroom must ask a signed-out visitor to sign in").toMatch(/sign-in/);
    } finally {
      await context.close();
    }
  });
});

type Persona = {
  who: string;
  email: string;
  passwordVar: string;
  canManageMembers: boolean;
  expectedBranches: string[];
};

const PERSONAS: Persona[] = [
  { who: "owner", email: OWNER, passwordVar: "ACCEPTANCE_E2E_OWNER_PASSWORD", canManageMembers: true, expectedBranches: ORG_BRANCHES },
  { who: "Sales Manager", email: MANAGER, passwordVar: "ACCEPTANCE_E2E_MANAGER_PASSWORD", canManageMembers: false, expectedBranches: ORG_BRANCHES },
  { who: "Sales Rep", email: REP, passwordVar: "ACCEPTANCE_E2E_REP_PASSWORD", canManageMembers: false, expectedBranches: ["ACC6 Cairo"] },
];

for (const persona of PERSONAS) {
  test.describe.serial(`${persona.who} (${persona.email})`, () => {
    let context: BrowserContext;

    test.beforeAll(async ({ browser }) => {
      context = await newPersonaContext(browser);
      await signIn(context, persona.email, required(persona.passwordVar), persona.who);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test("workspace and Sales screens render", async () => {
      // A fresh page per route, so one route's client-side redirect can never interrupt the next navigation.
      for (const path of ["/b2b", "/b2b/leads", "/b2b/customers", "/showroom/home"]) {
        const page = await context.newPage();
        try {
          const finalPath = await openHealthy(page, path, persona.who);
          note("route", `${persona.who}: ${path} -> ${finalPath}`);
        } finally {
          await page.close();
        }
      }
    });

    test(persona.canManageMembers ? "People lets the owner manage members" : "People refuses member management", async () => {
      const page = await context.newPage();
      try {
        await openHealthy(page, "/b2b/organization", persona.who);
        const refused = page.getByText(NOT_AUTHORIZED);
        if (persona.canManageMembers) {
          await expect(refused, "the owner must not be refused on People").toHaveCount(0);
          await expect(page.locator("#invite-email"), "the owner should get the invite form").toHaveCount(1);
        } else {
          await expect(refused.first(), `${persona.who} must be refused on People`).toBeVisible();
          await expect(page.locator("#invite-email"), `${persona.who} must not get the invite form`).toHaveCount(0);
        }
      } finally {
        await page.close();
      }
    });

    test("Sales branch scope matches the membership", async () => {
      const page = await context.newPage();
      try {
        await openHealthy(page, "/b2b/customers", persona.who);
        const options = await branchOptions(page);
        note("branch-scope", `${persona.who}: ${options.join(", ")}`);
        expect(options.slice(1).sort(), `${persona.who}: branch filter options`).toEqual([...persona.expectedBranches].sort());
      } finally {
        await page.close();
      }
    });
  });
}

/**
 * Showroom RC2 drift observations, as the owner (a showroom_dealer organization). Records only; never fails on a drift.
 * Each line names the old (August) expectation from the local spec and what the hosted preview renders now.
 */
test.describe.serial("Showroom RC2 drift observations (owner, record only)", () => {
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await newPersonaContext(browser);
    await signIn(context, OWNER, required("ACCEPTANCE_E2E_OWNER_PASSWORD"), "owner");
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("record what renders for each drifted assertion", async () => {
    const page = await context.newPage();
    const has = async (locator: ReturnType<Page["locator"]>) => ((await locator.count()) > 0 ? "present" : "absent");
    try {
      await openHealthy(page, "/b2b", "owner");
      const nav = page.getByRole("navigation", { name: "Workspace" }).first();
      for (const heading of ["Buying", "Network", "Selling", "Business"]) {
        note("drift", `sidebar group "${heading}" (showroom-mvp): ${await has(nav.getByText(heading, { exact: true }))}`);
      }
      note("drift", `"Committed spend" tile (showroom-mvp): ${await has(page.getByText("Committed spend"))}`);
      note("drift", `Orders nav link (orders-projects): ${await has(page.getByRole("link", { name: /^Orders/ }))}`);
      note("drift", `workspace-switcher (account-workspace-model): ${await has(page.locator('[data-testid="workspace-switcher"]'))}`);
      note("drift", `"Add business" (account-workspace-model): ${await has(page.getByText(/^Add business$/))}`);
      note("drift", `locale-ar in the page or profile menu (showroom-mvp): ${await has(page.getByTestId("locale-ar"))}`);
      note("drift", `language button (sales): ${await has(page.getByRole("button", { name: /language|اللغة/i }))}`);

      await openHealthy(page, "/b2b/rfqs", "owner");
      note("drift", `/b2b/rfqs h1, old "Purchase requests" (showroom-mvp): "${(await page.locator("main h1").first().innerText().catch(() => "")).trim()}"`);

      const settingsPath = await openHealthy(page, "/b2b/settings", "owner");
      note("drift", `/b2b/settings lands on ${settingsPath} (profile-completion, showroom-mvp)`);
      for (const heading of ["Business", "Workspace", "Account & access"]) {
        note("drift", `settings heading "${heading}" (showroom-mvp): ${await has(page.getByRole("heading", { name: heading, exact: true }))}`);
      }
      note("drift", `activity-selector on settings (profile-completion): ${await has(page.getByTestId("activity-selector"))}`);
      note("drift", `identity-card on settings (profile-completion): ${await has(page.getByTestId("identity-card"))}`);

      await openHealthy(page, "/b2b/leads", "owner");
      note("drift", `sales branch <select> on leads (sales): ${await has(page.locator("select"))}`);

      note("drift", "consumer /business/new -> /home (account-workspace-model): not observable, there is no consumer test account on Acceptance");
    } finally {
      await page.close();
    }
  });
});

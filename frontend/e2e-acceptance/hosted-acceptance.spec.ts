import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { accessHeadersFor, installAccessRouting, isAccessLogin, readAccessCredentials, scrubError } from "./access.mjs";

/**
 * Hosted, READ-ONLY acceptance E2E for the Cloudflare Acceptance preview (playwright.acceptance.config.ts).
 *
 * Rules:
 *  - READ-ONLY. Navigation and sign-in only: nothing is created, edited, deleted or submitted beyond the sign-in form.
 *  - The preview sits behind Cloudflare Access. The service token (ACCEPTANCE_E2E_ACCESS_CLIENT_ID/SECRET, same GitHub Environment) is
 *    attached ONLY to requests to the exact preview origin (context route + per-call API headers, never global extraHTTPHeaders), is
 *    never sent to another host or on a redirect, and an Access login redirect fails the run instead of being followed.
 *  - Acceptance only. Any request to the live Supabase project or the live domain is aborted and fails the run.
 *  - CAPTCHA stays ON and untouched. Acceptance has Supabase Auth CAPTCHA protection ON (Turnstile, since 2026-10-28), which
 *    refuses a made-up token ("That verification challenge didn't pass"). The suite therefore uses the REAL Turnstile widget
 *    and waits for the genuine token it produces (sign-in is an interaction-only challenge, so a normal browser gets it with
 *    no click). Nothing is stubbed, bypassed or switched off. If Cloudflare shows a challenge that needs a person, the run
 *    fails with a clear message. The widget's hostname allowlist must include the preview host (the owner confirmed it does).
 *  - The "Showroom RC2 drift" block records what renders today for each of the 17 local spec drifts
 *    (docs/operations/e2e-shared-failures-triage-2026-10-22.md) as annotations. It never fails on them: they need product
 *    review, and asserting either the old or the new labels here would decide that review silently.
 */

/**
 * Manual run attached to the owner's REAL Chrome/Edge (e2e-acceptance/run-headed.mjs starts it with a debugging port and a fresh
 * profile and passes ACCEPTANCE_E2E_CDP_URL). Without that variable the browser is launched by Playwright as before (CI).
 * Attaching changes only which browser runs; no signal is hidden or altered and Turnstile is completed by the person.
 */
const test = base.extend<object, { browser: Browser }>({
  browser: [
    async ({ playwright, browserName, launchOptions }, use) => {
      const cdp = process.env.ACCEPTANCE_E2E_CDP_URL;
      if (cdp && /^http:\/\/127\.0\.0\.1:\d+$/.test(cdp)) {
        const browser = await playwright.chromium.connectOverCDP(cdp);
        await use(browser);
        await browser.close(); // disconnects; the launcher closes the real browser
        return;
      }
      const browser = await playwright[browserName].launch(launchOptions);
      await use(browser);
      await browser.close();
    },
    { scope: "worker" },
  ],
});

/** Headed manual run: wait long enough for a person to complete a genuine Turnstile challenge in the visible browser. */
const HEADED = process.env.ACCEPTANCE_E2E_HEADED === "1";
const TOKEN_WAIT_MS = HEADED ? 5 * 60_000 : 45_000;
const SIGN_IN_WAIT_MS = HEADED ? 2 * 60_000 : 45_000;

const OWNER = "test1@example.com";
const MANAGER = "acc6-sales-manager@example.test";
const REP = "acc6-sales-rep@example.test";
const ORG_BRANCHES = ["ACC6 Cairo", "ACC6 Giza", "test"];
const NOT_AUTHORIZED = "You're not allowed to manage members here.";

const FORBIDDEN_HOSTS = /kkpkgjrweysgvhvkhzun|aladdindecore\.com/i;
const GENERIC_ERROR = /Application error|a server-side exception has occurred|Digest:/i;

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is not set - it comes from the GitHub acceptance-e2e Environment.`);
  return value;
}

const violations: string[] = [];

// Both credentials are required before anything runs: fail closed, never fall back to unauthenticated requests.
const accessCreds = () => readAccessCredentials(process.env);

/** GET on the preview with the Access headers, without following redirects (a redirect could carry them elsewhere). */
async function apiGet(context: BrowserContext, path: string) {
  const url = new URL(path, required("ACCEPTANCE_BASE_URL")).href;
  const creds = accessCreds();
  // A failed API call's message carries Playwright's call log, which lists request headers: keep only a scrubbed first line,
  // because run.log and the JSON report are uploaded as an artifact.
  const res = await context.request.get(url, { headers: accessHeadersFor(url, creds), maxRedirects: 0 }).catch((e: unknown) => {
    throw new Error(`GET ${path} failed: ${scrubError(e, creds)}`);
  });
  const location = res.headers()["location"] ?? "";
  if (res.status() >= 300 && res.status() < 400 && (!location || isAccessLogin(new URL(location, url).href))) {
    throw new Error(`Cloudflare Access answered ${res.status()} for ${path}: the Access service token is wrong, expired or not authorised for the preview.`);
  }
  return res;
}

async function guardedContext(context: BrowserContext): Promise<BrowserContext> {
  // Service token for the exact preview origin only, never carried across a redirect; an Access login redirect is a violation.
  // (route.continue({headers}) is NOT used: in real Chromium it forwards the headers to a cross-origin redirect target,
  // see e2e-access-routing/access-routing.spec.ts.)
  await installAccessRouting(context, accessCreds(), { onViolation: (m) => violations.push(m) });
  await context.route(FORBIDDEN_HOSTS, (route) => {
    violations.push(new URL(route.request().url()).host);
    return route.abort();
  });
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
  // Turnstile diagnostics only. Everything recorded is a FIXED category word, an HTTP status, an allowlisted network error
  // name, or a purely numeric Turnstile error code. No URL (not even its path), query string, header, console text, token or
  // credential is ever copied into the log or the uploaded report.
  const trace: string[] = [];
  const add = (line: string) => {
    if (trace.length < 20) trace.push(line);
  };
  const category = (u: string): string => {
    try {
      const x = new URL(u);
      if (x.hostname !== "challenges.cloudflare.com" && !x.hostname.endsWith(".challenges.cloudflare.com")) return "";
      const sub = x.hostname === "challenges.cloudflare.com" ? "" : "subdomain ";
      if (/\/turnstile\/v0\/(b\/[^/]+\/)?api\.js$/.test(x.pathname)) return `${sub}api.js`;
      if (x.pathname.startsWith("/cdn-cgi/challenge-platform/")) return `${sub}challenge-platform`;
      return `${sub}other`;
    } catch {
      return "";
    }
  };
  // PASSIVE observation only: a window "message" listener (no wrapping, no property override, nothing that touches the widget or
  // window.turnstile). The Turnstile iframe reports its lifecycle to the page by postMessage; we record only the event NAME
  // (letters only, max 24) and, for failures, a purely numeric code. Nothing else from the message is read or stored.
  // (A previous version wrapped turnstile.render; that changed the widget's behaviour in the hosted run, so it was removed.)
  await page.addInitScript(() => {
    const w = window as unknown as { __tsDiag: string[] };
    w.__tsDiag = [];
    window.addEventListener("message", (e: MessageEvent) => {
      if (e.origin !== "https://challenges.cloudflare.com" || w.__tsDiag.length >= 14) return;
      const d = e.data as { source?: unknown; event?: unknown; code?: unknown } | null;
      if (!d || typeof d !== "object" || d.source !== "cloudflare-challenge") return;
      const event = typeof d.event === "string" && /^[A-Za-z]{2,24}$/.test(d.event) ? d.event : "other";
      const code = d.code !== undefined && /^\d{3,6}$/.test(String(d.code)) ? ` code=${String(d.code)}` : "";
      w.__tsDiag.push(`widget event: ${event}${code}`);
    });
  });
  page.on("response", (r) => {
    const c = category(r.url());
    if (c) add(`${r.status()} ${c}`);
  });
  page.on("requestfailed", (r) => {
    const c = category(r.url());
    const err = r.failure()?.errorText ?? "";
    if (c) add(`FAILED ${c}: ${/^net::ERR_[A-Z_]{3,40}$/.test(err) ? err : "other"}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && /content security policy/i.test(m.text())) add("console: csp-violation");
    else if (m.type() === "error" && /turnstile|captcha|challenge/i.test(m.text())) add("console: turnstile-related error");
  });
  try {
    await page.goto("/auth/sign-in", { waitUntil: "domcontentloaded" });
    if (HEADED) console.log(`[manual] ${who}: if Cloudflare shows a verification in the Chrome window, complete it (waiting up to ${TOKEN_WAIT_MS / 60_000} min).`);
    await page.getByLabel(/^mobile number or email$/i).fill(email);
    // A failed fill must never echo the value into the log or the uploaded report.
    await page.getByLabel(/^password$/i).fill(password).catch(() => {
      throw new Error(`The ${who} password field could not be filled on /auth/sign-in.`);
    });
    // The real Turnstile widget fills this hidden field with a genuine single-use token; nothing here fakes it.
    await expect(page.locator('input[name="captchaToken"]'))
      .not.toHaveValue("", { timeout: TOKEN_WAIT_MS })
      .catch(async () => {
        const frames = page.locator('iframe[src*="challenges.cloudflare.com"]');
        const widget = await frames.count();
        const box = widget ? await frames.first().boundingBox().catch(() => null) : null;
        trace.push(`widget iframes=${widget}${box ? ` size=${Math.round(box.width)}x${Math.round(box.height)}` : ""}`);
        trace.push(...(await page.evaluate(() => (window as unknown as { __tsDiag?: string[] }).__tsDiag ?? []).catch(() => ["lifecycle unavailable"])));
        throw new Error(
          `The ${who} sign-in got no Turnstile token in ${TOKEN_WAIT_MS / 1000} s (${widget && trace.some((t) => t.startsWith("widget event: interactiveBefore")) ? "Cloudflare showed a challenge that needs a person" : "the widget did not produce a token"}). CAPTCHA is not bypassed. Turnstile diagnostics: ${trace.join(" | ") || "no Cloudflare challenge request was made"}.`,
        );
      });
    await page.getByRole("button", { name: /^log in$/i }).click();
    await page.waitForURL((url) => !/\/sign-in(\/|$)/.test(url.pathname), { timeout: SIGN_IN_WAIT_MS }).catch(async () => {
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
  expect(isAccessLogin(page.url()), `${who}: ${path} ended on a Cloudflare Access login page (the service token did not reach a redirect hop)`).toBe(false);
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
      const health = await apiGet(context, "/api/health");
      expect(health.status(), "/api/health").toBe(200);
      const backend = await apiGet(context, "/api/backend/health");
      expect(backend.status(), "/api/backend/health").toBe(200);
      const body = await backend.json();
      expect(body, "the backend must be the staging/acceptance service").toMatchObject({ status: "ok", service: "backend", env: "staging" });
      for (const path of ["/", "/auth/sign-in", "/legal/terms"]) {
        expect((await apiGet(context, path)).status(), path).toBe(200);
      }
      // The retired /installer/sign-in is a permanent redirect (next.config.ts). Check it WITHOUT following it: the status and
      // that the destination is the same-origin /auth/sign-in (a redirect anywhere else, or a temporary one, is a failure).
      const installer = await apiGet(context, "/installer/sign-in");
      expect(installer.status(), "/installer/sign-in must be a permanent redirect").toBe(308);
      const target = new URL(installer.headers()["location"] ?? "", required("ACCEPTANCE_BASE_URL"));
      expect(`${target.origin}${target.pathname}`, "/installer/sign-in must redirect to /auth/sign-in on the same origin").toBe(
        `${new URL(required("ACCEPTANCE_BASE_URL")).origin}/auth/sign-in`,
      );
      // A signed-out visitor to /showroom must be sent to the APP's sign-in page. Checked on the first hop, without following
      // it, so a Cloudflare Access login (a different, infrastructure redirect) can never be mistaken for the app's answer:
      // apiGet already fails on a cloudflareaccess.com / /cdn-cgi/access/ redirect.
      const showroom = await apiGet(context, "/showroom");
      expect([301, 302, 303, 307, 308], `/showroom answered HTTP ${showroom.status()}`).toContain(showroom.status());
      const dest = new URL(showroom.headers()["location"] ?? "", required("ACCEPTANCE_BASE_URL"));
      expect(`${dest.origin}${dest.pathname}`, "/showroom must ask a signed-out visitor to sign in (same origin)").toBe(
        `${new URL(required("ACCEPTANCE_BASE_URL")).origin}/auth/sign-in`,
      );
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

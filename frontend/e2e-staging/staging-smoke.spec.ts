import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Authenticated post-deploy smoke for shared STAGING (docs/operations/staging-deployment-runbook.md).
 *
 * Its one job: catch the incident class "the deployed application is ahead of its database". A server-side exception in
 * an authenticated layout (for example a missing RPC) renders Next's generic "Application error" - or, now, Aladdin's own
 * recovery screen - instead of the page. Both are failures here.
 *
 * Rules:
 *  - READ-ONLY. Navigation only: nothing is created, edited, deleted, submitted or clicked beyond signing in.
 *  - Two dedicated, non-human accounts whose credentials exist ONLY in the GitHub `staging` Environment (SMOKE_*).
 *    Nothing here is a default, a fixture or a fallback; a missing value fails loudly rather than skipping.
 *  - One authenticated session per persona, reused for all of that persona's pages.
 *  - No trace, video or screenshot (see playwright.staging-smoke.config.ts): sign-in values are never recorded, and the
 *    failure messages below contain only a path, a status and a persona name.
 */

type Persona = {
  name: string;
  signInPath: string;
  fillCredentials: (page: Page) => Promise<void>;
  /** Pages to open once signed in. Each must render the authenticated shell at exactly this path. */
  paths: string[];
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name} is not set - the staging smoke needs it from the GitHub staging Environment.`);
  return value;
}

const PERSONAS: Persona[] = [
  {
    name: "installer / craftsman",
    signInPath: "/installer/sign-in",
    fillCredentials: async (page) => {
      await page.locator('input[name="phone"]').fill(required("SMOKE_INSTALLER_PHONE"));
      await page.locator('input[name="password"]').fill(required("SMOKE_INSTALLER_PASSWORD"));
    },
    paths: ["/home", "/home/jobs", "/home/work", "/home/settings"],
  },
  {
    name: "business / poster",
    signInPath: "/auth/sign-in",
    fillCredentials: async (page) => {
      await page.locator('input[name="email"]').fill(required("SMOKE_BUSINESS_EMAIL"));
      await page.locator('input[name="password"]').fill(required("SMOKE_BUSINESS_PASSWORD"));
    },
    paths: ["/b2b", "/b2b/jobs"],
  },
];

/** Next's generic production error page, in any form. */
const GENERIC_ERROR = /Application error|a server-side exception has occurred|Digest:/i;

async function signIn(context: BrowserContext, persona: Persona): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(persona.signInPath, { waitUntil: "domcontentloaded" });
    await persona.fillCredentials(page);
    await page.locator('button[type="submit"]').click();
    // Either the form leaves the sign-in route (success) or it stays (rejected credentials / server error).
    await page.waitForURL((url) => !/\/sign-in(\/|$)/.test(url.pathname), { timeout: 45_000 }).catch(() => {
      throw new Error(`Sign-in as the ${persona.name} smoke account did not complete (still on ${new URL(page.url()).pathname}). Check the account and its secrets.`);
    });
    const landed = new URL(page.url()).pathname;
    if (/^\/(onboarding|auth|installer)\b/.test(landed)) {
      throw new Error(`The ${persona.name} smoke account signed in but landed on ${landed}: it must be a fully onboarded account.`);
    }
  } finally {
    await page.close();
  }
}

async function expectHealthyPage(page: Page, persona: Persona, path: string): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${persona.name}: no response for ${path}`).not.toBeNull();
  expect(response?.status() ?? 0, `${persona.name}: ${path} answered HTTP ${response?.status()}`).toBeLessThan(400);

  // Still signed in, and not redirected anywhere else.
  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, `${persona.name}: ${path} redirected to ${finalPath} (signed out or onboarding?)`).toBe(path);

  // The authenticated shell rendered.
  await expect(page.locator("main").first(), `${persona.name}: no authenticated shell on ${path}`).toBeVisible();

  // Neither the generic Next error nor Aladdin's own recovery screen may be what rendered.
  await expect(page.getByTestId("aladdin-error-boundary"), `${persona.name}: ${path} rendered the Aladdin error screen`).toHaveCount(0);
  const text = await page.locator("body").innerText();
  expect(text, `${persona.name}: ${path} rendered a server error page`).not.toMatch(GENERIC_ERROR);
}

for (const persona of PERSONAS) {
  test.describe.serial(`staging smoke - ${persona.name}`, () => {
    let context: BrowserContext;

    test.beforeAll(async ({ browser }) => {
      // A context made from the `browser` fixture does not inherit the config's `use` options, so pass them.
      context = await browser.newContext({ baseURL: required("SMOKE_BASE_URL"), locale: "en-US" });
      await signIn(context, persona);
    });

    test.afterAll(async () => {
      await context?.close();
    });

    for (const path of persona.paths) {
      test(`${path} renders for the signed-in account`, async () => {
        const page = await context.newPage();
        try {
          await expectHealthyPage(page, persona, path);
        } finally {
          await page.close();
        }
      });
    }
  });
}

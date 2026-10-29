import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { IDENTITIES, answerBusinessContactIfAsked, pickBusinessActivity, registerWithPassword, signIn } from "./helpers/auth";

/**
 * Business / organization onboarding. Drives the REAL owner path (no bypass) through the canonical `/auth/sign-up`:
 * the business type is chosen at sign-up, the Email OTP lands the account in the shared business wizard with that
 * type preset (the first business is MANDATORY: there is no optional "later" and no owner checkbox), and submitting
 * creates the organization + the owner's active membership + primary branch through the trusted backend path and
 * lands the owner in the B2B workspace.
 *
 * Persona isolation (a caller who is not registering a business cannot open the business flow by URL) is asserted
 * too. The invited-employee path is covered by account-registration.spec; the full per-type / resume / direct-URL
 * matrix by business-registration-mandatory.spec. Sign-up is Turnstile-gated: run where challenges.cloudflare.com loads.
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
const BUSINESS_SETUP = /\/onboarding\/business(\/|$|\?)/;

/** Register a brand-new account through the real sign-up + OTP and stop at wherever it is sent. */
async function register(
  page: Page,
  request: APIRequestContext,
  accountType: RegExp,
  landing: RegExp,
  tag: string,
): Promise<string> {
  const email = `biz-${tag}-${uniq()}@example.test`;
  await registerWithPassword(page, request, {
    email,
    username: `biz${tag}${uniq()}`.slice(0, 24),
    displayName: `E2E ${tag}`,
    accountType,
    landing,
  });
  return email;
}

test.describe("business onboarding", () => {
  test.setTimeout(120_000);

  test("Organization owner: creates the org and enters the workspace", async ({ page, request }) => {
    await prefs(page, "en", "light");
    // Distributor is the `supplier` org_type; the sign-up dropdown labels it "Supplier".
    await register(page, request, /^supplier$/i, BUSINESS_SETUP, "owner");
    await noOverflow(page);

    // Step 1 - identity: an organization name is required to continue.
    await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
    await page.locator("#bname").fill("Nile Supply Co");
    // The business name alone is not enough: the legal / registered name is required too.
    await expect(page.getByRole("button", { name: /^continue$/i })).toBeDisabled();
    await page.locator("#blegal").fill("Nile Supply Trading Co LLC");
    // A Supplier answers its own activity list (Distributor / Wholesaler).
    await pickBusinessActivity(page);
    await page.getByRole("button", { name: /^continue$/i }).click();

    // The registered type is preset: there is no "what kind of business" step to confirm or change.
    await expect(page.getByRole("heading", { name: /what kind of business/i })).toHaveCount(0);

    // Step 2 - location (optional).
    await expect(page.getByRole("heading", { name: /where are you based/i })).toBeVisible();
    await page.getByRole("button", { name: /^continue$/i }).click();
    await answerBusinessContactIfAsked(page);

    // Step 3 - primary branch (optional).
    await expect(page.getByRole("heading", { name: /your primary branch/i })).toBeVisible();
    await page.locator("#bbranch").fill("Cairo HQ");
    await page.getByRole("button", { name: /^continue$/i }).click();

    // Step 4 - review: creating the business is what makes the creator its owner; nothing to confirm.
    await expect(page.getByRole("heading", { name: /review and create/i })).toBeVisible();
    await expect(page.locator("#owner")).toHaveCount(0);
    const create = page.getByRole("button", { name: /create business/i });
    await expect(create).toBeEnabled();
    await create.click();

    // The org + active owner membership exist -> the owner reaches the workspace.
    await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
    // The workspace shell shows the organization name in viewport-dependent slots,
    // so assert presence rather than the visibility of one particular slot.
    await expect(page.getByText("Nile Supply Co", { exact: true }).first()).toBeAttached();
  });

  test("persona isolation: a consumer cannot open the business flow by URL", async ({ page, request }) => {
    await prefs(page, "en", "light");
    // The seeded consumer holds a personal persona and registered no business.
    await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$|\?)/);

    // Deep-linking the business flow bounces back to their own Personal home.
    await page.goto("/onboarding/business");
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);
  });

  test("persona isolation: a tradesperson registration cannot open the business flow by URL", async ({ page, request }) => {
    await prefs(page, "en", "light");
    await register(page, request, /craftsmen/i, /\/home(\/|$|\?)/, "trade");

    await page.goto("/onboarding/business");
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);
  });
});

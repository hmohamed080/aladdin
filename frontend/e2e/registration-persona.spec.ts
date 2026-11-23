import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { registerWithPassword } from "./helpers/auth";

/**
 * Registration account type → AUTHORITATIVE persona (staging-prep Increment
 * 11), end to end against the REAL local Supabase + Mailpit, through the
 * CANONICAL `/auth/sign-up` (Full Name, the account-type
 * dropdown on Step 1; `onboarding_select_account_type`
 * applied after the OTP). Turnstile-gated like every
 * Create Account: run where challenges.cloudflare.com loads.
 */

const BASE = "http://127.0.0.1:3100";

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e5)}`;
}

async function english(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
}

/**
 * Fresh account → sign-up (account type chosen in the dropdown) → OTP → app.
 * Records every URL the browser commits, so a test can prove no legacy wizard
 * step (/onboarding/profile, /contact, /professional, /consumer, /business)
 * was ever visited.
 */
async function registerAs(
  page: Page,
  request: APIRequestContext,
  choice: RegExp,
  tag: string,
): Promise<{ visited: string[] }> {
  const visited: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
  });

  const email = `rp-${tag}-${uniq()}@example.test`;
  await registerWithPassword(page, request, { email, accountType: choice, displayName: `E2E ${tag}` });
  return { visited };
}

function noLegacyWizard(visited: string[]): void {
  const legacy = visited.filter((p) =>
    /^\/onboarding\/(profile|contact|professional|consumer|business)(\/|$)/.test(p),
  );
  expect(legacy, `legacy wizard steps visited: ${legacy.join(", ")}`).toEqual([]);
}

/** Every "Complete your profile" link must land on its own route — never a redirect elsewhere. */
async function everyChecklistLinkIsReachable(page: Page): Promise<string[]> {
  const card = page.getByTestId("complete-profile-card");
  await expect(card).toBeVisible();
  const hrefs = await card
    .locator("a[data-item]")
    .evaluateAll((as) => as.map((a) => `${a.getAttribute("data-item")}|${a.getAttribute("href")}`));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const entry of hrefs) {
    const [item, href] = entry.split("|") as [string, string];
    const target = href.split("#")[0]!;
    await page.goto(href);
    await expect(page, `${item} -> ${href}`).toHaveURL(new RegExp(`${target.replace(/\//g, "\\/")}(#|$|\\?)`));
  }
  return hrefs.map((e) => e.split("|")[0]!);
}

test.describe("Registration account type → authoritative persona", () => {
  test.setTimeout(120_000);

  test("Tradespeople: professional identity, trades editable, no legacy wizard, completion reachable", async ({ page, request, context }) => {
    await english(context);
    const { visited } = await registerAs(page, request, /craftsmen/i, "trade");
    noLegacyWizard(visited);
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);

    // The professional profile editor admits the account (it used to show
    // "no professional profile"), and the trade taxonomy saves.
    await page.goto("/home/profile/edit");
    await expect(page.getByTestId("trade-selector")).toBeVisible();
    // TradeSelector's test hook wraps only its heading, so scope by the unique chip name.
    const painting = page.getByRole("button", { name: "Painter / decorator", exact: true });
    await painting.click();
    await expect(painting).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /save trades/i }).click();
    await expect(page.getByText(/could not save your trades/i)).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Painter / decorator", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // The installer dashboard on /home deliberately does not carry the completion card; it lives on the
    // workspace-independent profile settings page.
    await page.goto("/settings/profile");
    const items = await everyChecklistLinkIsReachable(page);
    expect(items).not.toContain("activities"); // satisfied by the saved trade
    expect(items).not.toContain("organization_setup"); // a person, not a business
  });

  test("Sales Team: user-level Sales persona, subtypes editable, NO organization access granted", async ({ page, request, context }) => {
    await english(context);
    const { visited } = await registerAs(page, request, /sales team/i, "sales");
    noLegacyWizard(visited);
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);

    await page.goto("/home/profile/edit");
    const selector = page.getByTestId("activity-selector");
    await expect(selector).toBeVisible();
    const rep = selector.getByRole("button", { name: "Sales representative", exact: true });
    await expect(selector.getByRole("button", { name: "Sales manager", exact: true })).toBeVisible();
    await rep.click();
    await selector.getByRole("button", { name: /^save$/i }).click();
    await page.reload();
    await expect(
      page.getByTestId("activity-selector").getByRole("button", { name: "Sales representative", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    // No membership → the B2B workspace bounces to the personal home.
    await page.goto("/b2b");
    await expect(page).toHaveURL(/\/home(\/|$|\?)/);

    await page.goto("/home");
    await everyChecklistLinkIsReachable(page);
  });

  // The four BUSINESS registrations (Showroom / Distributor / Manufacturer / Importer) are no longer an optional
  // "access_ready with zero organizations" account: creating the first business is the mandatory continuation of the
  // registration. That flow, its resume behaviour and its direct-navigation guard are covered by
  // `business-registration-mandatory.spec.ts`.
});

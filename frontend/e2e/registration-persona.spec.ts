import { test, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * Registration account type → AUTHORITATIVE persona (staging-prep Increment
 * 11), end to end against the REAL local Supabase + Mailpit, through the
 * CANONICAL passwordless sign-up — which carries no CAPTCHA — and the real
 * `/onboarding/account-type` + `/onboarding/username` steps. Both steps call
 * the same authoritative RPCs (`onboarding_select_account_type`,
 * `profile_set_username`) the password-registration preview applies after
 * OTP, so this proves the persona assignment and profile-completion
 * reachability without Turnstile. The password-registration golden path
 * itself (Turnstile-gated) lives in auth-password-preview.spec.ts /
 * profile-completion.spec.ts and must run where challenges.cloudflare.com
 * loads.
 */

const BASE = "http://127.0.0.1:3100";

function uniq(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1e5)}`;
}

async function english(context: BrowserContext): Promise<void> {
  await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: BASE }]);
}

/**
 * Fresh account → consent → OTP → account type → username → app. Records
 * every URL the browser commits, so a test can prove no legacy wizard step
 * (/onboarding/profile, /contact, /professional, /consumer, /business) was
 * ever visited.
 */
async function registerAs(
  page: Page,
  request: APIRequestContext,
  choice: RegExp,
  tag: string,
): Promise<{ visited: string[]; username: string }> {
  const visited: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) visited.push(new URL(f.url()).pathname);
  });

  const email = `rp-${tag}-${uniq()}@example.test`;
  const username = `rp${tag}${uniq()}`.slice(0, 24);
  const seen = await messageIdsFor(request, email);

  await page.goto("/auth/sign-up");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/terms of service/i).check();
  await page.getByLabel(/privacy policy/i).check();
  await page.getByLabel(/pilot release/i).check();
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText(/we sent a code/i)).toBeVisible();
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code/i).pressSequentially(code);
  await page.getByRole("button", { name: /verify/i }).click();

  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  await page.getByRole("button", { name: choice }).click();
  await page.getByRole("button", { name: /^continue$/i }).click();

  await page.waitForURL(/\/onboarding\/username$/, { waitUntil: "commit" });
  await page.getByLabel(/^username$/i).fill(username);
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForURL(/\/(home|b2b)(\/|$|\?)/, { waitUntil: "commit" });
  return { visited, username };
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

test.describe("Registration account type → authoritative persona (no CAPTCHA path)", () => {
  test.setTimeout(120_000);

  test("Tradespeople: professional identity, trades editable, no legacy wizard, completion reachable", async ({ page, request, context }) => {
    await english(context);
    const { visited } = await registerAs(page, request, /tradespeople & technicians/i, "trade");
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

    await page.goto("/home");
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

  for (const [label, tag] of [
    [/^showroom \/ dealer/i, "show"],
    [/^distributor/i, "supp"],
    [/^manufacturer/i, "manu"],
    [/^importer/i, "impo"],
  ] as const) {
    test(`${tag}: zero organizations — enters the app, edits personal identity, no org access`, async ({ page, request, context }) => {
      await english(context);
      const { visited } = await registerAs(page, request, label, tag);
      noLegacyWizard(visited);

      // access_ready with zero organizations: the account-safe terminal, the
      // checklist, and a way to the workspace-independent profile route.
      await page.goto("/home");
      await expect(page.getByTestId("no-personal-workspace")).toBeVisible();
      const items = await everyChecklistLinkIsReachable(page);
      expect(items).toEqual(expect.arrayContaining(["avatar", "phone", "display_name", "organization_setup"]));
      expect(items).not.toContain("organization_activities"); // no organization to describe yet

      // The user identity is editable with no workspace at all.
      await page.goto("/home");
      await page.getByTestId("no-workspace-edit-profile").click();
      await expect(page).toHaveURL(/\/settings\/profile$/);
      await expect(page.getByTestId("identity-card")).toBeVisible();
      const before = Number((await page.getByTestId("complete-profile-percent").textContent())?.match(/\d+/)?.[0]);
      await page.getByLabel(/^display name$/i).fill(`E2E ${tag} Owner`);
      await page.locator("#display-name").getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByTestId("display-name-status")).toHaveText(/^confirmed$/i);
      await page.reload();
      await expect(page.getByLabel(/^display name$/i)).toHaveValue(`E2E ${tag} Owner`);
      const after = Number((await page.getByTestId("complete-profile-percent").textContent())?.match(/\d+/)?.[0]);
      expect(after).toBeGreaterThan(before);

      // Organization-scoped editing is NOT available without an organization.
      await page.goto("/b2b/settings");
      await expect(page.getByTestId("activity-selector")).toHaveCount(0);
    });
  }
});

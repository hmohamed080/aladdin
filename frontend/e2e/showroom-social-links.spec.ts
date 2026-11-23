import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { registerWithPassword } from "./helpers/auth";

/**
 * Showroom links card in business onboarding step 1 (docs/frontend/showroom-social-links-onboarding.md).
 *
 * Drives the REAL showroom registration (canonical `/auth/sign-up` + Email OTP, no bypass), which lands the owner on
 * step 1 of the shared business wizard with the type preset to showroom. A showroom needs at least one valid link
 * (Facebook, Instagram, TikTok or website) to leave step 1, and no invalid one.
 *
 * Covered: Next is blocked with no link (the required message shows and Instagram opens), pressing Instagram and
 * typing `@shop` shows the canonical preview and lets the person continue, the card never overflows at 375px, and the
 * Arabic locale keeps every link input left-to-right. Sign-up is Turnstile-gated: run where challenges.cloudflare.com
 * loads. Needs the local seeded stack (see docs/frontend/sprint-5-sales-ui-depth.md, "Local E2E").
 */

const BUSINESS_SETUP = /\/onboarding\/business(\/|$|\?)/;
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1e5)}`;

async function prefs(page: Page, locale: "en" | "ar") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" }]);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Register a brand-new showroom owner through the real sign-up and stop on step 1 of the business wizard. */
async function registerShowroom(page: Page, request: APIRequestContext, tag: string): Promise<void> {
  await registerWithPassword(page, request, {
    email: `links-${tag}-${uniq()}@example.test`,
    displayName: `E2E links ${tag}`,
    accountType: /^showroom$/i,
    landing: BUSINESS_SETUP,
  });
}

/** The locale-independent handles: the card's own ids (`idPrefix="blinks"`). */
const toggle = (page: Page, platform: string) => page.locator(`button[aria-controls="blinks-${platform}-panel"]`);
const input = (page: Page, platform: string) => page.locator(`#blinks-${platform}`);

/** Everything step 1 needs from a showroom except the links. */
async function fillIdentityWithoutLinks(page: Page) {
  await page.locator("#bname").fill("Links Journey Showroom");
  await page.locator("#blegal").fill("Links Journey Showroom Trading LLC");
  await page.locator("#bactivity").selectOption("decor_showroom");
  await page.locator("#bphone").fill(`10${String(Date.now()).slice(-8)}`);
}

test.describe("showroom links in business onboarding step 1", () => {
  test.setTimeout(120_000);

  test("Next is blocked with no link; pressing Instagram and typing @shop shows the preview and lets the person continue", async ({ page, request }) => {
    await prefs(page, "en");
    await registerShowroom(page, request, "en");
    await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
    await fillIdentityWithoutLinks(page);

    // No link yet: every input is collapsed, the counter says so, and nothing is flagged until the person presses Next.
    await expect(page.getByRole("heading", { name: /showroom links/i })).toBeVisible();
    await expect(page.getByText("Pick at least one")).toBeVisible();
    await expect(input(page, "instagram")).toBeHidden();
    await expect(page.getByText(/add at least one link/i)).toHaveCount(0);

    // Next does not advance: the required message shows and Instagram opens as the place to start.
    const next = page.getByRole("button", { name: /^continue$/i });
    await next.click();
    await expect(page.getByText(/add at least one link to your social media or website/i)).toBeVisible();
    await expect(input(page, "instagram")).toBeVisible();
    await expect(page.getByRole("heading", { name: /where are you based/i })).toHaveCount(0);

    // Pressing Instagram and typing a handle shows what will be saved, clears the message and counts the link.
    await toggle(page, "instagram").click();
    await input(page, "instagram").fill("@shop");
    await expect(page.getByText(/will be saved as/i)).toBeVisible();
    await expect(page.locator("#blinks-instagram-preview bdi")).toHaveText("instagram.com/shop");
    await expect(page.getByText(/add at least one link/i)).toHaveCount(0);
    await expect(page.getByText("1 added")).toBeVisible();

    // With a valid link the person moves on to the location step.
    await next.click();
    await expect(page.getByRole("heading", { name: /where are you based/i })).toBeVisible();

    // The link was saved with the draft: going back shows it again, already open.
    await page.getByRole("button", { name: /^back$/i }).click();
    await expect(input(page, "instagram")).toHaveValue("@shop");
  });

  test("375px: the links card never overflows, even with every input open and an error showing", async ({ page, request }) => {
    await prefs(page, "en");
    await page.setViewportSize({ width: 375, height: 812 });
    await registerShowroom(page, request, "375");
    await expect(page.getByRole("heading", { name: /set up your business/i })).toBeVisible();
    await fillIdentityWithoutLinks(page);
    await noOverflow(page);

    // Required message with Instagram open.
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(input(page, "instagram")).toBeVisible();
    await noOverflow(page);

    // All four inputs open, one holding a long valid link and one an invalid value (its error is shown).
    for (const platform of ["facebook", "tiktok", "website"]) await toggle(page, platform).click();
    await input(page, "facebook").fill("https://www.facebook.com/a-very-long-showroom-page-name-that-keeps-going-and-going/posts/1234567890");
    await input(page, "website").fill("not a web address at all because of spaces");
    for (const platform of ["facebook", "instagram", "tiktok", "website"]) await expect(input(page, platform)).toBeVisible();
    await noOverflow(page);
  });

  test("Arabic locale: the page is right-to-left but every link input stays left-to-right", async ({ page, request }) => {
    // Register in English (the sign-up labels are matched in English), then switch the locale on the wizard.
    await prefs(page, "en");
    await registerShowroom(page, request, "ar");
    await prefs(page, "ar");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    for (const platform of ["facebook", "instagram", "tiktok", "website"]) {
      await toggle(page, platform).click();
      await expect(input(page, platform)).toBeVisible();
      await expect(input(page, platform)).toHaveAttribute("dir", "ltr");
    }

    // A typed handle keeps its direction and its preview stays isolated left-to-right inside the Arabic sentence.
    await input(page, "instagram").fill("@shop");
    await expect(input(page, "instagram")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("#blinks-instagram-preview bdi")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("#blinks-instagram-preview bdi")).toHaveText("instagram.com/shop");
  });
});

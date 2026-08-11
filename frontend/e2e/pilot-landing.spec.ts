import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

type LocaleCase = { locale: "en" | "ar"; dir: "ltr" | "rtl" };

const locales: LocaleCase[] = [
  { locale: "en", dir: "ltr" },
  { locale: "ar", dir: "rtl" },
];

async function setLocale(page: Page, locale: LocaleCase): Promise<void> {
  await page.context().addCookies([
    {
      name: "NEXT_LOCALE",
      value: locale.locale,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}

async function expectDirection(page: Page, locale: LocaleCase): Promise<void> {
  const html = page.locator("html");
  await expect(html).toHaveAttribute("lang", locale.locale);
  await expect(html).toHaveAttribute("dir", locale.dir);
}

for (const locale of locales) {
  test.describe(`Pilot post-login landing (${locale.locale})`, () => {
    test.beforeEach(async ({ page }) => setLocale(page, locale));

    test("platform admin lands on the protected Admin dashboard", async ({ page, request }) => {
      await signIn(page, request, IDENTITIES.admin, /\/admin(\/|$)/);

      await expect(page).toHaveURL(/\/admin(\/|$)/);
      await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
      if (locale.locale === "en") {
        await expect(page.getByRole("heading", { name: "Pilot overview" })).toBeVisible();
      }
      await expectDirection(page, locale);
    });

    test("consumer lands on personal home and is denied Admin", async ({ page, request }) => {
      await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$)/);

      await expect(page).toHaveURL(/\/home(\/|$)/);
      await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
      await expect(page.getByRole("navigation")).toHaveCount(0);
      await expectDirection(page, locale);

      await page.goto("/admin");
      await page.waitForURL(/\/home(\/|$)/, { waitUntil: "commit" });
      await expect(page).toHaveURL(/\/home(\/|$)/);
      await expect(page.getByText("Pilot overview")).toHaveCount(0);
    });

    test("organization owner lands on B2B", async ({ page, request }) => {
      await signIn(page, request, IDENTITIES.manager, /\/b2b(\/|$)/);

      await expect(page).toHaveURL(/\/b2b(\/|$)/);
      await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
      await expectDirection(page, locale);
    });

    test("ordinary B2B salesperson lands on B2B and is denied Admin", async ({ page, request }) => {
      await signIn(page, request, IDENTITIES.salesperson, /\/b2b(\/|$)/);

      await expect(page).toHaveURL(/\/b2b(\/|$)/);
      await expect(page.getByRole("main").getByRole("heading").first()).toBeVisible();
      await expectDirection(page, locale);

      await page.goto("/admin");
      await page.waitForURL(/\/b2b(\/|$)/, { waitUntil: "commit" });
      await expect(page).toHaveURL(/\/b2b(\/|$)/);
      await expect(page.getByText("Pilot overview")).toHaveCount(0);
    });
  });
}

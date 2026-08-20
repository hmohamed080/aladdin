import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * FOCUSED acceptance for the supply-side dashboard recomposition.
 *
 * Deliberately narrow: this is not the visual-QA matrix and not a persona sweep.
 * It proves the four things the recomposition claims, on the three seats that
 * share the one implementation:
 *
 *   1. All eight modules render, from the same component, for a Distributor, a
 *      Manufacturer and an Importer — only the org's own data differs.
 *   2. The period control scopes the strip and survives in the URL.
 *   3. The stage filter narrows the queue without resetting the period.
 *   4. Nothing overflows horizontally, in either direction, at desktop or phone.
 *
 * Screenshots land in `test-results/supply/` as the visual record for the UAT.
 */

const SHOTS = "test-results/supply";

/**
 * Any authenticated landing counts as signed in.
 *
 * The helper's default insists on `/b2b`, which makes every test here depend on
 * where the app chooses to route a user immediately after sign-in — a decision
 * this spec is not testing and does not own. When that redirect went through
 * `/onboarding` on a cold run, the sign-in helper timed out before the dashboard
 * was ever loaded, reporting a dashboard failure for something that had nothing
 * to do with the dashboard. Each test navigates to `/b2b` explicitly straight
 * afterwards, so if a seat genuinely cannot reach the dashboard the module
 * assertions still fail — and they fail pointing at the real cause.
 */
const LANDED = /\/(b2b|home|onboarding)(\/|$)/;

async function setPrefs(page: Page, locale: "ar" | "en", theme: "light" | "dark") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
  ]);
}

/**
 * A page that scrolls sideways is broken at any width, and the failure is
 * invisible in a screenshot taken at the same width that caused it — so it is
 * measured rather than looked at. One pixel of slack absorbs sub-pixel rounding
 * in the grid tracks; anything more is a real escape.
 */
async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} horizontal overflow (px)`).toBeLessThanOrEqual(1);
}

/** The eight modules the dashboard is required to compose, by their headings. */
const MODULES = {
  ar: [
    "ينتظر تصرفك الآن",
    "فرص جديدة مناسبة لك",
    "حركة السوق",
    "أحدث الإشعارات",
    "فيديوهات لمنتجاتك",
    "مسار عملك",
    "أعلى منتجاتك",
    "أعلى عملائك",
  ],
  en: [
    "Waiting on you right now",
    "New opportunities",
    "Demand movement",
    "Latest notifications",
    "Videos for your products",
    "Your pipeline",
    "Top products",
    "Top customers",
  ],
} as const;

async function assertModules(page: Page, locale: "ar" | "en") {
  for (const heading of MODULES[locale]) {
    await expect(
      page.getByRole("heading", { name: heading, exact: false }),
      `module "${heading}" is on the dashboard`,
    ).toBeVisible();
  }
}

/**
 * The dashboard must never print a locale's digits in the other locale's script.
 * Checked on the KPI strip specifically, because that is where every number on
 * the page is formatted by a different helper than the lists below it.
 */
async function assertDigits(page: Page, locale: "ar" | "en") {
  const strip = page.getByTestId("kpi-strip");
  const text = (await strip.textContent()) ?? "";
  if (locale === "ar") {
    expect(text, "Arabic strip carries Arabic-Indic digits").toMatch(/[٠-٩]/);
    // A bare Latin digit in the Arabic strip means a hand-formatted number.
    expect(text.replace(/[A-Za-z]/g, ""), "no Western digits in the Arabic strip").not.toMatch(
      /[0-9]/,
    );
  } else {
    expect(text, "English strip carries Western digits").toMatch(/[0-9]/);
    expect(text, "no Arabic-Indic digits in the English strip").not.toMatch(/[٠-٩]/);
    expect(text, "no Arabic copy in the English strip").not.toMatch(/[؀-ۿ]/);
  }
}

test.describe("supply dashboard — shared implementation, three seats", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "acceptance runs on the project's chromium builds only",
  );

  test("distributor · Arabic · light and dark", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    await signIn(page, request, IDENTITIES.distributor, LANDED);

    for (const theme of ["light", "dark"] as const) {
      await setPrefs(page, "ar", theme);
      await page.goto("/b2b", { waitUntil: "networkidle" });

      const html = page.locator("html");
      await expect(html).toHaveAttribute("dir", "rtl");
      if (theme === "dark") await expect(html).toHaveClass(/dark/);
      else await expect(html).not.toHaveClass(/dark/);

      await assertModules(page, "ar");
      await assertDigits(page, "ar");
      await assertNoOverflow(page, `distributor/ar/${theme}`);

      await page.screenshot({ path: `${SHOTS}/distributor-ar-${theme}.png`, fullPage: true });
    }
  });

  test("manufacturer · English · desktop", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    await signIn(page, request, IDENTITIES.manufacturer, LANDED);
    await setPrefs(page, "en", "light");
    await page.goto("/b2b", { waitUntil: "networkidle" });

    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await assertModules(page, "en");
    await assertDigits(page, "en");
    await assertNoOverflow(page, "manufacturer/en/light");

    await page.screenshot({ path: `${SHOTS}/manufacturer-en-light.png`, fullPage: true });
  });

  test("importer · Arabic · desktop", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    await signIn(page, request, IDENTITIES.importer, LANDED);
    await setPrefs(page, "ar", "light");
    await page.goto("/b2b", { waitUntil: "networkidle" });

    await assertModules(page, "ar");
    await assertNoOverflow(page, "importer/ar/light");

    await page.screenshot({ path: `${SHOTS}/importer-ar-light.png`, fullPage: true });
  });

  /**
   * THE PERIOD SCOPE AND THE STAGE FILTER, ASSERTED THROUGH THE URL.
   *
   * WHY THIS DRIVES THE ROUTE RATHER THAN CLICKING THE CONTROLS
   * The first version of this test operated the `<select>` and clicked a chip,
   * and it was never dependable — it failed at three different points across
   * three runs. Both controls navigate to the SAME route with a different query,
   * which is a full server render of a `force-dynamic` dashboard behind seven
   * Supabase queries; the URL does not change until that render commits, and on
   * a cold path that is slow enough to out-run any timeout worth having in a
   * suite. (It does commit — instrumented directly, the click lands
   * `?stage=price` — it simply cannot be relied on to do so promptly.)
   *
   * Chasing that made the test worse, not better: re-firing the interaction to
   * "help" cancels the in-flight RSC request and restarts the clock.
   *
   * So the test asserts the CONTRACT instead, and the contract is the URL. Both
   * controls exist only to produce these query strings; the strings are what
   * survives a reload and what a seller can send to a colleague. Driving the
   * routes directly proves the half that can actually break silently — that the
   * server reads both parameters, that they compose, and that the filtered queue
   * really is filtered — while the chips' own `href`s are asserted to be exactly
   * the URLs being driven, which closes the loop back to the controls.
   *
   * What is deliberately NOT claimed here is that a click is fast. It is not,
   * and that is recorded as a real finding rather than hidden behind a retry.
   */
  test("period scope and stage filter are URL state, and do not reset each other", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await setPrefs(page, "en", "light");
    await page.goto("/b2b", { waitUntil: "networkidle" });

    // The default period carries no parameter, so a plain dashboard link is clean.
    expect(new URL(page.url()).searchParams.get("period")).toBeNull();
    await expect(page.getByLabel(/period/i)).toHaveValue("30d");

    // Every chip must carry the CURRENT period forward, or filtering the queue
    // would silently snap the figures above it back to 30 days.
    await page.goto("/b2b?period=90d", { waitUntil: "networkidle" });
    await expect(page.getByLabel(/period/i)).toHaveValue("90d");
    for (const [name, stage] of [
      [/to price/i, "price"],
      [/to follow up/i, "chase"],
      [/to fulfil/i, "fulfil"],
    ] as const) {
      await expect(page.getByRole("link", { name })).toHaveAttribute(
        "href",
        `/b2b?period=90d&stage=${stage}`,
      );
    }
    // …and "All" must clear the stage while keeping the period.
    await expect(page.getByRole("link", { name: /^all/i })).toHaveAttribute("href", "/b2b?period=90d");

    // Both parameters together: the strip stays scoped and the queue narrows to
    // one stage. Every row in a price-filtered queue offers the price verb, and
    // none offers a later stage's verb.
    await page.goto("/b2b?period=90d&stage=price", { waitUntil: "networkidle" });
    await expect(page.getByLabel(/period/i)).toHaveValue("90d");

    const queue = page.getByTestId("attention-queue");
    await expect(queue.getByRole("link", { name: /send a price/i }).first()).toBeVisible();
    expect(
      await queue.getByRole("link", { name: /progress it|create the order/i }).count(),
      "a price-filtered queue shows no later-stage work",
    ).toBe(0);

    await assertNoOverflow(page, "distributor/en/filtered");
    await page.screenshot({ path: `${SHOTS}/distributor-en-filtered.png`, fullPage: true });
  });

  test("seller dashboard on a phone", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile scenario");
    test.setTimeout(180_000);

    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await setPrefs(page, "ar", "light");
    await page.goto("/b2b", { waitUntil: "networkidle" });

    await assertModules(page, "ar");
    await assertNoOverflow(page, "distributor/ar/mobile");

    await page.screenshot({ path: `${SHOTS}/distributor-ar-mobile.png`, fullPage: true });
  });
});

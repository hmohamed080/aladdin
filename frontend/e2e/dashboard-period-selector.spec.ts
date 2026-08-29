import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * FOCUSED acceptance for the supply dashboard's reporting-period control.
 *
 * The control's placement was the deferred half of the dashboard visual pass:
 * the chip was pulled out of the heading row (where it competed with "+ New
 * product") and the UI for CHANGING the period went with it, leaving `?period=`
 * reachable only by hand-typing a URL. It now sits directly above the metric
 * strip, which is the only region it governs.
 *
 * WHAT THIS SPEC OWNS, and it is only this: that the control is present where
 * the review put it, that it drives the EXISTING `?period=` contract, and that
 * every way a reader can arrive at a period — click, deep link, reload, back
 * button, junk in the query string — lands on the same, correct state in both
 * locales and both writing directions.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM: that the figures are right. The period's
 * effect on the numbers is `comparePeriods`' business and is covered by the
 * report/summary unit tests; asserting a seeded delta here would pin this spec
 * to the demand seed and fail every time the fixtures moved.
 */

const SHOTS = "test-results/period";

/** Sign-in's landing route is not this spec's subject — see supply-dashboard-uat. */
const LANDED = /\/(b2b|home|onboarding)(\/|$)/;

async function setPrefs(page: Page, locale: "ar" | "en", theme: "light" | "dark" = "light") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
  ]);
}

/* The copy under test, per locale, so the two runs are the same test rather than
   two tests that happen to rhyme. Arabic uses Arabic-Indic digits throughout the
   product, which is why the Arabic labels are not written with Latin numerals. */
const COPY = {
  en: {
    scope: "Metrics period",
    "30d": "Last 30 days",
    "90d": "Last 90 days",
    "365d": "Last 12 months",
    all: "All time",
  },
  ar: {
    scope: "فترة المؤشرات",
    "30d": "آخر ٣٠ يوم",
    "90d": "آخر ٩٠ يوم",
    "365d": "آخر ١٢ شهر",
    all: "كل الفترات",
  },
} as const;

/** The chip, by the test id the design system already styles it through. */
const chip = (page: Page) => page.getByTestId("period-select");

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** What the chip currently says it is showing. */
async function expectChip(page: Page, label: string) {
  await expect(chip(page)).toHaveText(new RegExp(escapeRe(label)));
}

/** The `?period=` the URL is currently carrying, or null for the bare default. */
function periodParam(page: Page): string | null {
  return new URL(page.url()).searchParams.get("period");
}

/**
 * WHY NOTHING BELOW CLICKS AN OPTION TO CHANGE THE PERIOD.
 *
 * `/b2b` currently commits NO client-side navigation. Measured directly: the
 * option's handler runs, Next fetches the new payload, the server answers
 * `200 text/x-component` — and the router never commits, so `page.url()` and the
 * rendered figures stay put. A plain `<Link href="/b2b?stage=price">` — the
 * dashboard's own stage chip, untouched by this change — behaves identically.
 *
 * So it is the ROUTE that cannot navigate to itself, not the control. That is a
 * pre-existing defect (it already breaks the stage chips, which is why the
 * supply-dashboard UAT spec asserts their `href` and never presses them) and it
 * is reported rather than worked around here.
 *
 * The consequence for coverage: the browser cannot demonstrate a period CHANGE,
 * so that half is asserted against the router in
 * `src/features/home/period-select.test.tsx`, where the route defect cannot mask
 * a regression in the URL the control builds. Everything a `page.goto` can still
 * prove — the default, deep links, invalid input, reload, history, both locales,
 * both directions — is proved here, because those are the states a reader
 * actually reaches today.
 */

/** A page that scrolls sideways is broken at any width — measured, not eyeballed. */
async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} horizontal overflow (px)`).toBeLessThanOrEqual(1);
}

test.describe("dashboard reporting period", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "acceptance runs on the project's chromium builds only",
  );

  /* ---------------------------------------------------------------- *
   * PLACEMENT — the half of this that was actually deferred.
   * ---------------------------------------------------------------- */

  test("sits at the metric strip's trailing edge, not beside the primary action", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop composition");
    test.setTimeout(180_000);

    await setPrefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await page.goto("/b2b", { waitUntil: "networkidle" });

    const cta = page.getByRole("link", { name: /new product/i });
    const strip = page.locator("main .grid.grid-cols-2").first();
    await expect(cta).toBeVisible();
    await expect(chip(page)).toBeVisible();
    await expect(strip).toBeVisible();

    const chipBox = (await chip(page).boundingBox())!;
    const ctaBox = (await cta.boundingBox())!;
    const stripBox = (await strip.boundingBox())!;

    /* THE PRIMARY ACTION STAYS VISUALLY ALONE. Not "is not the same element" —
       that would pass with the chip tucked against the button. The chip must be
       on its OWN ROW, strictly below the action band, which is the thing the
       review actually asked for. */
    expect(chipBox.y, "chip starts below the primary action").toBeGreaterThan(
      ctaBox.y + ctaBox.height - 1,
    );

    /* AND IT BELONGS TO THE STRIP. Directly above it, and closer to it than to
       the action above — proximity is the entire mechanism by which a control
       with no visible container declares its scope, so it is asserted rather
       than left to a screenshot. */
    expect(chipBox.y, "chip is above the strip").toBeLessThan(stripBox.y);
    const toStrip = stripBox.y - (chipBox.y + chipBox.height);
    const toAction = chipBox.y - (ctaBox.y + ctaBox.height);
    expect(toStrip, "chip hangs off the strip, not off the heading band").toBeLessThan(toAction);

    // LTR: aligned to the content column's RIGHT edge, which is the strip's.
    expect(
      Math.abs(chipBox.x + chipBox.width - (stripBox.x + stripBox.width)),
      "chip's trailing edge lines up with the strip's",
    ).toBeLessThanOrEqual(2);

    await assertNoOverflow(page, "period/en/desktop");
    await page.screenshot({ path: `${SHOTS}/placement-en-light.png` });
  });

  test("mirrors to the trailing edge in Arabic and keeps its menu on screen", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop composition");
    test.setTimeout(180_000);

    await setPrefs(page, "ar");
    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await page.goto("/b2b", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const strip = page.locator("main .grid.grid-cols-2").first();
    const chipBox = (await chip(page).boundingBox())!;
    const stripBox = (await strip.boundingBox())!;

    // RTL: the logical end is the LEFT, so the chip's left edge is the strip's.
    expect(
      Math.abs(chipBox.x - stripBox.x),
      "chip's trailing edge lines up with the strip's left side in RTL",
    ).toBeLessThanOrEqual(2);
    expect(chipBox.y, "still above the strip in RTL").toBeLessThan(stripBox.y);

    /* THE MENU HANGS FROM THE SAME EDGE THE CHIP IS ANCHORED TO. `start-0` in an
       RTL document is the RIGHT, and a menu that opened the wrong way here would
       run off the content column. Asserted as containment rather than as a
       coordinate, because the exact anchor is the component's business and
       "stays on screen" is the contract. */
    await chip(page).click();
    const menu = page.getByTestId("period-menu");
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    expect(menuBox.x, "menu starts inside the viewport").toBeGreaterThanOrEqual(-1);
    expect(menuBox.x + menuBox.width, "menu ends inside the viewport").toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // The Arabic copy is the Arabic copy — no English leaking through the chip.
    await expectChip(page, COPY.ar["30d"]);
    await expect(chip(page)).not.toHaveText(/[A-Za-z]/);

    await assertNoOverflow(page, "period/ar/desktop");
    await page.screenshot({ path: `${SHOTS}/placement-ar-light.png` });
  });

  test("keeps its placement in dark mode, and stays compact on a phone", async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(180_000);
    const mobile = testInfo.project.name === "chromium-mobile";

    await setPrefs(page, "en", "dark");
    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await page.goto("/b2b", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveClass(/dark/);

    const strip = page.locator("main .grid.grid-cols-2").first();
    await expect(chip(page)).toBeVisible();
    const chipBox = (await chip(page).boundingBox())!;
    const stripBox = (await strip.boundingBox())!;
    expect(chipBox.y, "above the strip in dark mode too").toBeLessThan(stripBox.y);

    /* COMPACT ON A PHONE, NOT FULL-WIDTH. It is a utility control; stretching it
       across a 390px screen would give it the weight of the primary action,
       which is the exact mistake this placement exists to avoid. */
    if (mobile) {
      expect(chipBox.width, "chip stays compact on a phone").toBeLessThan(stripBox.width * 0.75);
    }

    await assertNoOverflow(page, `period/en/dark/${mobile ? "mobile" : "desktop"}`);
    await page.screenshot({
      path: `${SHOTS}/placement-en-dark-${mobile ? "mobile" : "desktop"}.png`,
    });
  });

  /* ---------------------------------------------------------------- *
   * URL STATE — the existing `?period=` contract, exercised through the UI.
   * ---------------------------------------------------------------- */

  for (const locale of ["en", "ar"] as const) {
    test(`period is URL state in ${locale}: default, deep link, junk, reload, history`, async ({
      page,
      request,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
      test.setTimeout(240_000);

      await setPrefs(page, locale);
      await signIn(page, request, IDENTITIES.distributor, LANDED);
      await page.goto("/b2b", { waitUntil: "networkidle" });

      // DEFAULT — and the default carries NO parameter, so a plain dashboard
      // link stays clean and a shared link only ever names a deliberate choice.
      expect(periodParam(page), "bare dashboard carries no period").toBeNull();
      await expectChip(page, COPY[locale]["30d"]);

      // DEEP LINK — a period arrived at by URL is a first-class state, and the
      // chip reflects the window in force rather than its own default.
      for (const value of ["90d", "365d", "all"] as const) {
        await page.goto(`/b2b?period=${value}`, { waitUntil: "networkidle" });
        await expectChip(page, COPY[locale][value]);
      }

      // INVALID — the URL is user input and falls back rather than passing through.
      for (const junk of ["7d", "", "__proto__", "../../etc/passwd", "30d;drop"]) {
        await page.goto(`/b2b?period=${encodeURIComponent(junk)}`, { waitUntil: "networkidle" });
        await expectChip(page, COPY[locale]["30d"]);
      }

      // RELOAD — the period is in the URL, so it survives a full document load.
      await page.goto("/b2b?period=90d", { waitUntil: "networkidle" });
      await expectChip(page, COPY[locale]["90d"]);
      await page.reload({ waitUntil: "networkidle" });
      expect(periodParam(page)).toBe("90d");
      await expectChip(page, COPY[locale]["90d"]);

      // BACK / FORWARD — each period is its own history entry, and the chip
      // follows the entry rather than the last thing that was chosen.
      await page.goto("/b2b?period=365d", { waitUntil: "networkidle" });
      await expectChip(page, COPY[locale]["365d"]);
      await page.goBack({ waitUntil: "networkidle" });
      expect(periodParam(page), "back returns to the previous window").toBe("90d");
      await expectChip(page, COPY[locale]["90d"]);
      await page.goForward({ waitUntil: "networkidle" });
      expect(periodParam(page)).toBe("365d");
      await expectChip(page, COPY[locale]["365d"]);

      await assertNoOverflow(page, `period/${locale}/url-state`);
    });
  }

  test("the period survives a locale switch, and the chip switches with it", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    /* The window lives in the URL and the language lives in a cookie, so the two
       are independent by construction — but only if nothing along the way
       rewrites the query. Reading the SAME deep link under both locales is what
       proves it: same parameter, same window, different copy. */
    await setPrefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await page.goto("/b2b?period=90d&stage=price", { waitUntil: "networkidle" });
    await expectChip(page, COPY.en["90d"]);

    await setPrefs(page, "ar");
    await page.goto("/b2b?period=90d&stage=price", { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const params = new URL(page.url()).searchParams;
    expect(params.get("period"), "the window survives the locale switch").toBe("90d");
    expect(params.get("stage"), "and so does everything beside it").toBe("price");
    await expectChip(page, COPY.ar["90d"]);
    await expect(chip(page)).not.toHaveText(/[A-Za-z]/);

    await assertNoOverflow(page, "period/locale-switch");
  });

  /* ---------------------------------------------------------------- *
   * SCOPE HONESTY — the reason this placement was chosen over a page-level one.
   * ---------------------------------------------------------------- */

  test("the buyer seat gets no period control, because none of its figures move", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    /* A Showroom is the buyer seat: it renders `BuyerDashboard`, which has no
       period-scoped figures at all. Offering a window control over numbers that
       ignore it is a worse lie than offering none, so the chip must be absent
       rather than present-and-inert. */
    await setPrefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom, LANDED);
    await page.goto("/b2b?period=90d", { waitUntil: "networkidle" });

    await expect(chip(page)).toHaveCount(0);
    await assertNoOverflow(page, "period/showroom");
  });
});

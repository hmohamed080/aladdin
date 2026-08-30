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
 * WHY THE CLICK-DRIVEN CASES ARE BACK. They were absent for one release cycle
 * because `/b2b` could not commit ANY same-path query navigation in a production
 * build — a route-level defect that broke the dashboard's own stage chips too.
 * The cause was the segment's `loading.tsx` boundary; with it gone the router
 * commits reliably, so the contract is proved here by real interaction rather
 * than against a mocked router.
 *
 * HOW A PERIOD CHANGE IS PROVED TO HAVE REACHED THE SERVER. The chip's caption
 * is rendered from the RESOLVED period on the server (`<PeriodSelect value={period}>`),
 * so a changed caption is proof the page re-rendered with the new window — not
 * merely that the address bar moved. The delta captions carry a second, one-way
 * check: `vsMonth` ("from last month") is only ever emitted for the 30-day
 * window, so it must be ABSENT on every other one. That holds whatever the seed
 * contains, which a figure-by-figure assertion would not.
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
    vsMonth: "from last month",
  },
  ar: {
    scope: "فترة المؤشرات",
    "30d": "آخر ٣٠ يوم",
    "90d": "آخر ٩٠ يوم",
    "365d": "آخر ١٢ شهر",
    all: "كل الفترات",
    vsMonth: "من الشهر الماضي",
  },
} as const;

type PeriodValue = "30d" | "90d" | "365d" | "all";

/** The chip, by the test id the design system already styles it through. */
const chip = (page: Page) => page.getByTestId("period-select");

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * How long a period change may take to come back from the server.
 *
 * `/b2b` is `force-dynamic` and every figure is fetched inside RLS, so a change
 * is a full RSC round trip rather than a client-side filter. This is a ceiling
 * on a state that is polled for, not a duration anything waits out.
 */
const SETTLE = 20_000;

/** What the chip currently says it is showing — server-rendered from `period`. */
async function expectChip(page: Page, label: string, timeout = SETTLE) {
  await expect(chip(page)).toHaveText(new RegExp(escapeRe(label)), { timeout });
}

/** The `?period=` the URL is currently carrying, or null for the bare default. */
function periodParam(page: Page): string | null {
  return new URL(page.url()).searchParams.get("period");
}

/**
 * Wait for a period change to LAND, by polling state.
 *
 * NOT `page.waitForURL`: that waits on a load event, and `router.push` is a soft
 * navigation, so the document never loads again. Reading `page.url()` on a poll
 * is the same fact observed rather than awaited.
 */
async function expectPeriodParam(page: Page, expected: string | null) {
  await expect.poll(() => periodParam(page), { timeout: SETTLE }).toBe(expected);
}

/** Open the chip and choose a window, then wait for the server render to land. */
async function choose(page: Page, value: PeriodValue, locale: "ar" | "en") {
  await chip(page).click();
  await expect(page.getByTestId("period-menu")).toBeVisible();
  await page.getByTestId(`period-option-${value}`).click();
  await expect(page.getByTestId("period-menu")).toHaveCount(0);
  // The default is expressed as ABSENCE, so choosing it clears the parameter.
  await expectPeriodParam(page, value === "30d" ? null : value);
  await expectChip(page, COPY[locale][value]);
}

/**
 * Whether the strip is showing the 30-day comparison caption.
 *
 * `vsMonth` is emitted ONLY for the 30-day window, so this is a period-specific
 * fact about the RENDERED FIGURES rather than about the URL.
 */
async function stripSaysVsMonth(page: Page, locale: "ar" | "en") {
  const strip = page.locator("main .grid.grid-cols-2").first();
  return ((await strip.textContent()) ?? "").includes(COPY[locale].vsMonth);
}

/**
 * The attention queue, narrowed to the pricing stage.
 *
 * Scoped to `main` rather than to a test id: the queue's own
 * `data-testid="attention-queue"` belongs to `AttentionQueue`, which the visual
 * rebuild replaced on this dashboard with `AttentionBoard` — the id still exists
 * in the codebase but never renders here, so a locator built on it silently
 * matches nothing and "no later-stage work" passes for the wrong reason.
 *
 * The CTA verbs are the real signal: only a price-stage row offers "Send a
 * price", and only later stages offer theirs. Asserting BOTH directions is what
 * makes this a filter check rather than a "something rendered" check.
 *
 * The names are ANCHORED, and that is load-bearing rather than tidy: the board's
 * own stage chips are links too, and they are named after the same stages ("To
 * follow up 1"). An unanchored /follow up/ therefore matches the FILTER rather
 * than the work, and the "no later-stage work" assertion fails while the queue
 * is filtered exactly as asked. Only the CTA is named for the verb alone.
 */
async function expectPriceOnlyQueue(page: Page) {
  const main = page.locator("#main");
  await expect(main.getByRole("link", { name: /^Send a price$/ }).first()).toBeVisible();
  expect(
    await main.getByRole("link", { name: /^(Follow up|Create the order|Progress it)$/ }).count(),
    "a price-filtered queue shows no later-stage work",
  ).toBe(0);
}

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
   * PLACEMENT — the half of this that was deferred.
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
       on its OWN ROW, strictly below the action band. */
    expect(chipBox.y, "chip starts below the primary action").toBeGreaterThan(
      ctaBox.y + ctaBox.height - 1,
    );

    /* AND IT BELONGS TO THE STRIP. Directly above it, and closer to it than to
       the action above — proximity is the entire mechanism by which a control
       with no visible container declares its scope. */
    expect(chipBox.y, "chip is above the strip").toBeLessThan(stripBox.y);
    const toStrip = stripBox.y - (chipBox.y + chipBox.height);
    const toAction = chipBox.y - (ctaBox.y + ctaBox.height);
    expect(toStrip, "chip hangs off the strip, not off the heading band").toBeLessThan(toAction);

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

    expect(
      Math.abs(chipBox.x - stripBox.x),
      "chip's trailing edge lines up with the strip's left side in RTL",
    ).toBeLessThanOrEqual(2);
    expect(chipBox.y, "still above the strip in RTL").toBeLessThan(stripBox.y);

    /* THE MENU HANGS FROM THE EDGE THE CHIP IS ANCHORED TO. Asserted as
       containment rather than as a coordinate: the exact anchor is the
       component's business, "stays on screen" is the contract. */
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
       across a 390px screen would give it the weight of the primary action. */
    if (mobile) {
      expect(chipBox.width, "chip stays compact on a phone").toBeLessThan(stripBox.width * 0.75);
    }

    await assertNoOverflow(page, `period/en/dark/${mobile ? "mobile" : "desktop"}`);
    await page.screenshot({
      path: `${SHOTS}/placement-en-dark-${mobile ? "mobile" : "desktop"}.png`,
    });
  });

  /* ---------------------------------------------------------------- *
   * REAL INTERACTION — the acceptance a component test cannot give.
   * ---------------------------------------------------------------- */

  for (const locale of ["en", "ar"] as const) {
    test(`choosing a window moves the URL and the figures (${locale})`, async ({
      page,
      request,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
      test.setTimeout(240_000);

      await setPrefs(page, locale);
      await signIn(page, request, IDENTITIES.distributor, LANDED);
      await page.goto("/b2b", { waitUntil: "networkidle" });

      // DEFAULT — no parameter, and whatever 30-day comparison the seed supports.
      expect(periodParam(page), "bare dashboard carries no period").toBeNull();
      await expectChip(page, COPY[locale]["30d"]);
      const vsMonthAtDefault = await stripSaysVsMonth(page, locale);

      await choose(page, "90d", locale);
      expect(periodParam(page)).toBe("90d");
      expect(
        await stripSaysVsMonth(page, locale),
        "the 30-day comparison caption cannot survive into a 90-day window",
      ).toBe(false);

      await choose(page, "365d", locale);
      expect(periodParam(page)).toBe("365d");
      expect(await stripSaysVsMonth(page, locale)).toBe(false);

      // "All time" has no previous window, so it carries no comparison at all.
      await choose(page, "all", locale);
      expect(periodParam(page)).toBe("all");
      expect(await stripSaysVsMonth(page, locale)).toBe(false);

      await choose(page, "30d", locale);
      expect(periodParam(page), "the default is expressed as absence").toBeNull();
      expect(
        await stripSaysVsMonth(page, locale),
        "returning to the default restores the comparison it started with",
      ).toBe(vsMonthAtDefault);

      // BACK / FORWARD across the clicked history entries.
      await page.goBack();
      await expectPeriodParam(page, "all");
      await expectChip(page, COPY[locale].all);
      await page.goForward();
      await expectPeriodParam(page, null);
      await expectChip(page, COPY[locale]["30d"]);

      await assertNoOverflow(page, `period/${locale}/interaction`);
    });
  }

  test("changing the window leaves the rest of the query alone", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    /* The queue's stage filter and its sort ride in the same query string. A
       period change that dropped them would make the two controls fight each
       other — the dashboard's `carry` object exists to prevent exactly that on
       the server side, and this is the client half of the same rule. */
    await setPrefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await page.goto("/b2b?period=90d&stage=price&sort=due", { waitUntil: "networkidle" });
    await expectChip(page, COPY.en["90d"]);

    await choose(page, "all", "en");
    const params = new URL(page.url()).searchParams;
    expect(params.get("period")).toBe("all");
    expect(params.get("stage"), "the stage filter survives a period change").toBe("price");
    expect(params.get("sort"), "the sort survives a period change").toBe("due");

    // And the queue is still filtered — the surviving parameter is doing work,
    // not just riding along in the address bar.
    await expectPriceOnlyQueue(page);
  });

  test("the dashboard's own stage chips navigate too", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    /* Same-path query navigation driven by an ordinary `<Link>` rather than by
       `router.push`. It is in this spec because it shares the defect the period
       control hit: while the segment carried a `loading.tsx`, neither committed. */
    await setPrefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor, LANDED);
    await page.goto("/b2b", { waitUntil: "networkidle" });

    await page
      .getByRole("link", { name: /^to price/i })
      .first()
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("stage"), { timeout: SETTLE })
      .toBe("price");

    await expectPriceOnlyQueue(page);
  });

  /* ---------------------------------------------------------------- *
   * URL STATE reached WITHOUT the control — deep links and history.
   * ---------------------------------------------------------------- */

  for (const locale of ["en", "ar"] as const) {
    test(`period is URL state in ${locale}: deep link, junk, reload, history`, async ({
      page,
      request,
    }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
      test.setTimeout(240_000);

      await setPrefs(page, locale);
      await signIn(page, request, IDENTITIES.distributor, LANDED);

      // DEEP LINK — every window is a first-class state.
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
      await page.reload({ waitUntil: "networkidle" });
      expect(periodParam(page)).toBe("90d");
      await expectChip(page, COPY[locale]["90d"]);

      // BACK / FORWARD across document loads.
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
       rewrites the query. Reading the SAME deep link under both locales proves
       it: same parameter, same window, different copy. */
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

  test("the buyer seat gets no period control, because none of its figures move", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    /* A Showroom is the buyer seat: it renders `BuyerDashboard`, which has no
       period-scoped figures at all. Offering a window control over numbers that
       ignore it is a worse lie than offering none. */
    await setPrefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom, LANDED);
    await page.goto("/b2b?period=90d", { waitUntil: "networkidle" });

    await expect(chip(page)).toHaveCount(0);
    await assertNoOverflow(page, "period/showroom");
  });
});

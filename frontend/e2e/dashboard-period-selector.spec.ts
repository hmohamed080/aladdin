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

type PeriodValue = "30d" | "90d" | "365d" | "all";

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
 * Open the chip and choose a window, waiting on the SERVER RENDER rather than on
 * the click.
 *
 * The dashboard is a server component: `router.push` starts a fetch and the
 * figures arrive when it lands, so reading the chip straight after the click can
 * catch the pre-navigation render. Waiting for the URL first and the chip's own
 * text second is deterministic — both are states, not durations.
 */
async function choose(page: Page, value: PeriodValue, locale: "ar" | "en") {
  await chip(page).click();
  await expect(page.getByTestId("period-menu")).toBeVisible();
  await page.getByTestId(`period-option-${value}`).click();
  await expect(page.getByTestId("period-menu")).toHaveCount(0);
  // The default is expressed as ABSENCE, so its landing URL is the bare route.
  await page.waitForURL(value === "30d" ? /\/b2b(\?|$)/ : new RegExp(`period=${value}`));
  await expectChip(page, COPY[locale][value]);
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
    test(`period is URL state in ${locale}: default, choose, deep link, junk, reload, back`, async ({
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

      // SELECT ANOTHER — writes the existing contract, nothing new.
      await choose(page, "90d", locale);
      expect(periodParam(page)).toBe("90d");

      // …and back to the default DELETES the parameter rather than writing it.
      await choose(page, "30d", locale);
      expect(periodParam(page), "the default is expressed as absence").toBeNull();

      // DEEP LINK — a period arrived at by URL is a first-class state.
      await page.goto("/b2b?period=all", { waitUntil: "networkidle" });
      await expectChip(page, COPY[locale].all);

      // INVALID — the URL is user input and falls back rather than passing through.
      for (const junk of ["7d", "", "__proto__", "../../etc/passwd"]) {
        await page.goto(`/b2b?period=${encodeURIComponent(junk)}`, { waitUntil: "networkidle" });
        await expectChip(page, COPY[locale]["30d"]);
      }

      // RELOAD — the period is in the URL, so it survives a full document load.
      await page.goto("/b2b?period=90d", { waitUntil: "networkidle" });
      await expectChip(page, COPY[locale]["90d"]);
      await page.reload({ waitUntil: "networkidle" });
      expect(periodParam(page)).toBe("90d");
      await expectChip(page, COPY[locale]["90d"]);

      /* BACK / FORWARD — `router.push`, not `replace`, so each choice is its own
         history entry. A control that wrote the URL but broke the back button
         would be worse than one that kept the period in React state. */
      await choose(page, "365d", locale);
      await page.goBack({ waitUntil: "networkidle" });
      expect(periodParam(page), "back returns to the previous window").toBe("90d");
      await expectChip(page, COPY[locale]["90d"]);
      await page.goForward({ waitUntil: "networkidle" });
      expect(periodParam(page)).toBe("365d");
      await expectChip(page, COPY[locale]["365d"]);

      await assertNoOverflow(page, `period/${locale}/url-state`);
    });
  }

  test("changing the period preserves the rest of the query", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop scenario");
    test.setTimeout(180_000);

    await setPrefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor, LANDED);

    /* THE CONTROL EDITS `period` AND NOTHING ELSE. Arriving with a stage filter
       and a sort in force, changing the window must leave both standing — a
       period chip that silently reset the queue's filter would make the two
       controls fight each other, which is the failure the dashboard's `carry`
       object exists to prevent on the other side of the same contract. */
    await page.goto("/b2b?period=90d&stage=price&sort=due", { waitUntil: "networkidle" });
    await expectChip(page, COPY.en["90d"]);

    await choose(page, "all", "en");
    const params = new URL(page.url()).searchParams;
    expect(params.get("period")).toBe("all");
    expect(params.get("stage"), "the stage filter survives a period change").toBe("price");
    expect(params.get("sort"), "the sort survives a period change").toBe("due");

    // And the queue is still filtered — the surviving parameter is doing work,
    // not just riding along in the address bar.
    const queue = page.getByTestId("attention-queue");
    await expect(queue.getByRole("link", { name: /send a price/i }).first()).toBeVisible();
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

import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "../e2e/helpers/auth";

/**
 * REDUCED MOTION, asserted rather than photographed.
 *
 * This is the one item in the carve's QA matrix a screenshot cannot answer: a
 * still of an element that is not animating looks exactly like a still of one
 * that is. The check has to be on behaviour, and it has to run in a context that
 * actually reports the preference — `prefers-reduced-motion` is a media query,
 * so setting it on the browser context is the only way to make it match.
 *
 * WHY THIS NO LONGER READS `transitionProperty`
 * It used to assert `transition-property: none`, which was the correct check for
 * as long as the carve was a CSS transition with a `motion-reduce:` variant on
 * it. The carve is now driven by Motion, which animates in JavaScript and sets
 * no CSS transition at all — so the old assertion tested an implementation that
 * no longer exists, and would have gone on passing if Motion had been wired up
 * to ignore the preference entirely. The property was never the thing that
 * mattered; whether the element TWEENS is.
 *
 * So both tests below sample the carve's transform across the frames following a
 * navigation and ask whether it was ever caught between its old position and its
 * new one. That question has the same answer whatever drives the animation, and
 * the second test is the control: it asserts that an unrestricted browser DOES
 * show intermediate positions, which is what stops a broken sampler from
 * reporting "no motion detected" and passing the first test for free.
 */

/** The carve's translateY, read out of the computed transform matrix. */
async function sampleTravel(page: Page, ms: number) {
  return page.evaluate(async (duration) => {
    const el = document.querySelector('[data-testid="nav-carve"]')!;
    const read = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return Math.round(m.f * 10) / 10;
    };
    const seen: number[] = [];
    const deadline = performance.now() + duration;
    while (performance.now() < deadline) {
      const y = read();
      if (seen[seen.length - 1] !== y) seen.push(y);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return seen;
  }, ms);
}

async function arrive(page: Page, request: Parameters<typeof signIn>[1]) {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: "light", url: "http://127.0.0.1" },
    { name: "aladdin-sidebar", value: "expanded", url: "http://127.0.0.1" },
  ]);
  await signIn(page, request, IDENTITIES.importer);
  /* WARM THE DESTINATION FIRST. This is not belt-and-braces — without it the
     reduced-motion test passes vacuously. The sampler watches a fixed window of
     frames after the click, and on a cold dev server the first visit to
     /b2b/quotations spends longer than that window COMPILING, so the window
     closes before the route has changed and the carve has not moved yet. The
     run then records a single position and "at most one jump" is satisfied by an
     element that never went anywhere, whatever the preference is set to. */
  await page.goto("/b2b/quotations", { waitUntil: "networkidle" });
  await page.goto("/b2b/orders", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await expect(page.locator('[data-testid="nav-carve"]')).toHaveCount(1);
}

/**
 * Navigate to another module and collect every distinct carve position painted
 * while it settles. Sampling starts BEFORE the click, so the run always contains
 * the origin position and the comparison has something to be relative to.
 */
async function travelBetweenModules(page: Page) {
  const pending = sampleTravel(page, 900);
  await page.getByRole("link", { name: "Quotations", exact: true }).click();
  return pending;
}

test("carve does not tween under prefers-reduced-motion", async ({ page, request }) => {
  test.setTimeout(180_000);
  /* Set on the PAGE rather than through `test.use({ reducedMotion })`, which
     silently did nothing here — `matchMedia` still reported false, so the first
     version of this test was asserting against a browser that had never been
     told to prefer reduced motion, and "the carve still animates" was a fact
     about the harness. `emulateMedia` is checked below before anything else. */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await arrive(page, request);

  const emulated = await page.evaluate(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  expect(emulated, "the browser must actually be emulating the preference").toBe(true);

  const seen = await travelBetweenModules(page);
  console.log("carve positions under reduced motion:", JSON.stringify(seen));

  /* EXACTLY two positions, and both halves of that are load-bearing. Fewer than
     two means the carve never moved and the sample window missed the navigation
     entirely — a vacuous pass, see the warming note in `arrive`. More than two
     means a frame was painted somewhere between origin and destination, which is
     the tween this preference exists to suppress. */
  expect(seen, "expected one jump: the origin and the destination, nothing between").toHaveLength(2);
});

test("carve DOES tween without the preference — the control", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await arrive(page, request);

  const seen = await travelBetweenModules(page);
  console.log("carve positions without the preference:", JSON.stringify(seen));

  /* If this ever fails, the test above is meaningless rather than merely wrong:
     a sampler that cannot observe movement reports "no movement" for an
     implementation that ignores the preference completely. */
  expect(
    seen.length,
    "the sampler must be able to observe a tween, or the reduced-motion test proves nothing",
  ).toBeGreaterThan(2);
});

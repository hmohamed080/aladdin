import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "../e2e/helpers/auth";

/**
 * Capture the Supplier Dashboard for side-by-side comparison with the approved
 * concept.
 *
 * WHY `importer` AND NOT ONE OF THE OTHER TWO SUPPLY SEATS
 * All three of distributor / manufacturer / importer render the same dashboard,
 * so any of them would exercise the composition. This one is chosen because its
 * organization is *Cairo Sanitary Ware Trading* — the name written on the
 * reference concept — so the shell's organization context, the workspace card at
 * the foot of the sidebar and the branch crumb all read as the same workspace
 * the concept was drawn for. Comparing a page whose header says a different
 * company is a needless difference to have to look past on every iteration.
 */
const OUT = "design-lab-shots";

type Locale = "en" | "ar";
type Theme = "light" | "dark";
type Mode = "expanded" | "collapsed" | "hover";

async function prefs(page: Page, locale: Locale, theme: Theme, mode: Mode = "expanded") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
    { name: "aladdin-sidebar", value: mode, url: "http://127.0.0.1" },
  ]);
}

/**
 * Settle before capturing.
 *
 * `networkidle` is necessary but not sufficient here. The dashboard mounts a
 * measured element — the navigation carve reads `offsetTop` from the live DOM
 * and animates into place over 340ms — and a capture taken while it is in
 * flight shows the carve halfway between two rows, which looks like a bug in
 * every screenshot it appears in. Fonts matter for the same reason: a shot taken
 * before the webfont swaps records the fallback's metrics, and the whole point
 * of the exercise is judging type against a reference.
 */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

test("supplier dashboard — fidelity shots", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, "en", "light");
  await signIn(page, request, IDENTITIES.importer);

  for (const [locale, theme] of [
    ["en", "light"],
    ["ar", "light"],
    ["en", "dark"],
  ] as const) {
    await prefs(page, locale, theme);
    await page.goto("/b2b", { waitUntil: "domcontentloaded" });
    await settle(page);

    const tag = `${locale}-${theme}`;
    // Above the fold at the exact target viewport — this is the frame that gets
    // held up next to the concept.
    await page.screenshot({ path: `${OUT}/dash-${tag}-fold.png`, fullPage: false });
    // And the whole page, because half the composition (the lower modules) is
    // below 1024px and still has to answer to the reference.
    await page.screenshot({ path: `${OUT}/dash-${tag}-full.png`, fullPage: true });
  }
});

/**
 * THE CARVE, in every state it has.
 *
 * Two active positions are the important pair: the carve is supposed to be one
 * element that TRAVELS, so a still of it on Dashboard and a still of it on
 * Orders have to show the same shape in two places — if the fillets or the
 * radius differ between them, the two are being drawn by two different rules and
 * the movement is a cross-fade wearing a costume.
 *
 * The rest of the matrix covers the states where the mechanic is allowed to be
 * something else: a collapsed rail has no carve (there is no body edge to arrive
 * at across 56px), and expand-on-hover floats over the page rather than docking
 * into it, so it does not carve either. Both are captured so that "it does not
 * carve here" stays a decision on the record rather than a bug nobody noticed.
 */
test("sidebar carve — active positions and modes", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, "en", "light");
  await signIn(page, request, IDENTITIES.importer);

  const sidebar = () => page.locator("[data-shell-sidebar]").first();

  /* --- the travelling carve, LTR light --- */
  for (const [name, route] of [
    ["dashboard", "/b2b"],
    ["orders", "/b2b/orders"],
    ["saved", "/b2b/saved"],
  ] as const) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await settle(page);
    await sidebar().screenshot({ path: `${OUT}/carve-${name}.png` });
  }

  /* --- the same two positions mirrored --- */
  await prefs(page, "ar", "light");
  for (const [name, route] of [
    ["rtl-dashboard", "/b2b"],
    ["rtl-orders", "/b2b/orders"],
  ] as const) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await settle(page);
    await sidebar().screenshot({ path: `${OUT}/carve-${name}.png` });
  }

  /* --- dark, where the carve is a dark notch rather than a light one --- */
  await prefs(page, "en", "dark");
  await page.goto("/b2b/orders", { waitUntil: "domcontentloaded" });
  await settle(page);
  await sidebar().screenshot({ path: `${OUT}/carve-dark-orders.png` });

  /* --- the two modes that do NOT carve --- */
  await prefs(page, "en", "light", "collapsed");
  await page.goto("/b2b/orders", { waitUntil: "domcontentloaded" });
  await settle(page);
  await sidebar().screenshot({ path: `${OUT}/carve-rail.png` });

  await prefs(page, "en", "light", "hover");
  await page.goto("/b2b/orders", { waitUntil: "domcontentloaded" });
  await settle(page);
  await sidebar().screenshot({ path: `${OUT}/carve-hover-rest.png` });
  // Reveal it, then capture the floating panel over the page rather than the
  // sidebar's own (still 56px) box.
  await page.locator("[data-shell-sidebar] nav").hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/carve-hover-open.png`, clip: { x: 0, y: 0, width: 460, height: 1024 } });
});

/**
 * The two widths where the shell is a DIFFERENT shell.
 *
 * Below `tablet` there is no sidebar, no frame margin and no floating header —
 * the cards go flush, the header goes back to being a bar with the brand in it,
 * and `MobileNav` owns navigation. At `tablet` the sidebar returns but the
 * viewport is under `wide`, so the attention board drops its three data columns
 * and the boards stack one-up. Both are places the new composition could quietly
 * fall apart, and neither is visible in the 1440 capture.
 */
test("responsive — tablet and phone", async ({ page, request }) => {
  test.setTimeout(300_000);
  await prefs(page, "en", "light");
  await signIn(page, request, IDENTITIES.importer);

  for (const [name, width, height] of [
    ["tablet", 834, 1112],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto("/b2b", { waitUntil: "domcontentloaded" });
    await settle(page);
    await page.screenshot({ path: `${OUT}/dash-${name}.png`, fullPage: false });

    /* Naming the culprit, not just the symptom. A horizontal overflow is
       reported by the document but caused by ONE element, and finding it by
       bisecting a stylesheet is an afternoon; asking the DOM which boxes stick
       out past the viewport is a second.

       It over-reports, on purpose: a child of a horizontally SCROLLING container
       (the attention filter chips) legitimately sticks out past the viewport and
       is clipped by its parent, so it appears here without causing any document
       overflow at all. The assertion below is the verdict; this list is a lead. */
    const wide = await page.evaluate((w) => {
      const out: string[] = [];
      document.querySelectorAll("*").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.right > w + 1 && r.width > 0) {
          const cls = String((el as HTMLElement).className ?? "").slice(0, 90);
          out.push(`${el.tagName}.${cls} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
        }
      });
      return out.slice(0, 8);
    }, width);
    if (wide.length) console.log(`\n[${name}] overflowing boxes:\n` + wide.join("\n"));

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${name} horizontal overflow (px)`).toBeLessThanOrEqual(1);
  }
});

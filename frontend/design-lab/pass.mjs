/**
 * The capture set for THIS pass — the ten frames the brief asks to see, plus
 * whatever intermediate evidence the current question needs.
 *
 *   node design-lab/pass.mjs            # everything
 *   node design-lab/pass.mjs body head  # just those groups
 *
 * Written as a script rather than a Playwright spec because none of it asserts:
 * it produces evidence for a human eye, and a test runner's reporting, retries
 * and worker pool are all overhead against that. The one thing it borrows from
 * the E2E side is the sign-in path, via the cached session in `session.mjs`.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { restore, open, settle, prefs } from "./session.mjs";

const OUT = "design-lab-shots/pass";
const PORT = Number(process.env.SHOT_PORT ?? 3000);
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(OUT, { recursive: true });

const only = process.argv.slice(2);
const want = (group) => !only.length || only.includes(group);

const browser = await chromium.launch();

/** A fresh context at the fidelity viewport, already signed in and configured. */
async function ctx(opts = {}) {
  const context = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 1024 },
    deviceScaleFactor: 2,
    locale: "en-US",
  });
  await restore(context, BASE);
  await prefs(context, opts);
  const page = await context.newPage();
  return { context, page };
}

const shot = async (page, name, opts) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log("  ✓", name);
};

/* ---------------------------------------------------------------- SIDEBAR --
   The three display modes and the transition between two of them. The
   in-progress frame is the one that matters most: it is where a "two systems
   pretending to be one" implementation gives itself away. */
if (want("sidebar")) {
  console.log("sidebar");
  for (const [name, sidebar] of [
    ["01-expanded", "expanded"],
    ["02-collapsed", "collapsed"],
  ]) {
    const { context, page } = await ctx({ sidebar });
    await open(page, context, BASE, "/b2b");
    await settle(page);
    await page.locator("[data-shell-sidebar]").first().screenshot({ path: `${OUT}/${name}.png` });
    console.log("  ✓", name);
    await context.close();
  }

  // Expand-on-hover, caught mid-reveal and then at rest. Both are captured from
  // the PAGE rather than from the sidebar's own box: the question being asked is
  // what the reveal does to everything beside it, which a clip of the sidebar
  // alone cannot answer.
  const { context, page } = await ctx({ sidebar: "hover" });
  await open(page, context, BASE, "/b2b");
  await settle(page);
  await shot(page, "03-hover-rest", { clip: { x: 0, y: 0, width: 620, height: 1024 } });
  await page.locator("[data-shell-sidebar] nav").hover();
  await page.waitForTimeout(110); // mid-flight
  await shot(page, "04-hover-progress", { clip: { x: 0, y: 0, width: 620, height: 1024 } });
  await page.waitForTimeout(700); // settled
  await shot(page, "05-hover-open", { clip: { x: 0, y: 0, width: 620, height: 1024 } });
  await context.close();
}

/* ------------------------------------------------------------------ CARVE --
   Two active positions. They have to show the SAME shape in two places; if the
   fillets or the radius differ, they are two rules and the travel is a
   cross-fade wearing a costume. */
if (want("carve")) {
  console.log("carve");
  const { context, page } = await ctx();
  for (const [name, route] of [
    ["06-carve-dashboard", "/b2b"],
    ["07-carve-orders", "/b2b/orders"],
  ]) {
    await open(page, context, BASE, route);
    await settle(page);
    await page.locator("[data-shell-sidebar]").first().screenshot({ path: `${OUT}/${name}.png` });
    console.log("  ✓", name);
  }
  await context.close();

  /* The mirror and the dark theme. The carve now derives its width from
     `--shell-nav-w` through a `calc()` and its position from a LOGICAL inset, so
     both are places the arithmetic could be right and the direction wrong —
     which renders as a band growing out of the wrong edge and is invisible in
     any LTR capture. */
  for (const [name, opts] of [
    ["06b-carve-rtl", { locale: "ar" }],
    ["06c-carve-dark", { theme: "dark" }],
    ["06d-carve-rtl-rail", { locale: "ar", sidebar: "collapsed" }],
  ]) {
    const c = await ctx(opts);
    await open(c.page, c.context, BASE, "/b2b/orders");
    await settle(c.page);
    await c.page.locator("[data-shell-sidebar]").first().screenshot({ path: `${OUT}/${name}.png` });
    console.log("  ✓", name);
    await c.context.close();
  }
}

/* ----------------------------------------------------------------- SEARCH --
   Close-up, at rest and focused. Focus is half the complaint, so it gets its
   own frame rather than a note. */
if (want("search")) {
  console.log("search");
  const { context, page } = await ctx();
  await open(page, context, BASE, "/b2b");
  await settle(page);
  const box = page.getByTestId("global-search-trigger").first();
  const clip = await box.boundingBox();
  const pad = 24;
  const win = clip
    ? { x: clip.x - pad, y: clip.y - pad, width: clip.width + pad * 2, height: clip.height + pad * 2 }
    : { x: 280, y: 0, width: 700, height: 120 };
  await shot(page, "08-search-rest", { clip: win });

  /* FOCUS IS REACHED BY TABBING, NOT BY CLICKING OR BY `.focus()`.
     Clicking this control opens the command palette over a scrim, so the frame
     that comes back is the palette rather than the field. And a programmatic
     `.focus()` does not set `:focus-visible` — the heuristic exists precisely to
     withhold the ring from pointer-driven focus — so the ring under test would
     not paint. Tabbing is the only input that produces the state the ring is
     for. */
  await page.evaluate(() => document.activeElement?.blur?.());
  // The sidebar precedes the header in the DOM and holds ~20 links plus its own
  // controls, so the field is a long way into the tab order — hence 48 and not
  // "a few".
  let reached = false;
  for (let i = 0; i < 48 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(
      () => document.activeElement?.getAttribute("data-testid") === "global-search-trigger",
    );
  }
  if (!reached) console.log("  ! never tabbed onto the search trigger");
  await page.waitForTimeout(250);
  await shot(page, "08b-search-focus", { clip: win });
  await context.close();
}

/* ------------------------------------------------------------------- BODY --
   The full dashboard, and then the case the brief calls out: a route whose
   content is SHORTER than the viewport. That is where a body that does not
   claim its full height exposes the frame under it, and it is invisible on the
   dashboard, which is tall enough to hide the defect. */
if (want("body")) {
  console.log("body");
  const { context, page } = await ctx();
  await open(page, context, BASE, "/b2b");
  await settle(page);
  await shot(page, "09-dashboard-fold");
  await shot(page, "09b-dashboard-full", { fullPage: true });

  // A tall viewport makes short content shorter still, relative to the screen.
  await page.setViewportSize({ width: 1440, height: 1300 });
  await open(page, context, BASE, "/b2b/saved");
  await settle(page);
  await shot(page, "10-short-content");
  const gap = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    const r = main.getBoundingClientRect();
    return {
      bodyBottom: Math.round(r.bottom),
      viewport: window.innerHeight,
      documentScrolls: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  console.log("  body bottom vs viewport:", JSON.stringify(gap));

  /* THE OTHER HALF OF THE SAME QUESTION. A body that reaches the viewport on a
     SHORT route can still close halfway down a long one, and the dashboard is
     tall enough to hide it above the fold. This is the frame the brief
     describes: scrolled to the end, is there a detached strip below the
     workspace, or does the surface simply continue? */
  await page.setViewportSize({ width: 1440, height: 1024 });
  await open(page, context, BASE, "/b2b");
  await settle(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  await shot(page, "10b-scrolled-to-end");
  const tail = await page.evaluate(() => {
    const main = document.querySelector("main");
    const r = main.getBoundingClientRect();
    return {
      bodyBottomVsViewport: Math.round(window.innerHeight - r.bottom),
      shellReachesFoot:
        Math.round(
          window.innerHeight -
            document.querySelector("[data-shell-sidebar]").getBoundingClientRect().bottom,
        ),
    };
  });
  console.log("  at the end of the page:", JSON.stringify(tail));
  await context.close();
}

await browser.close();
console.log(`\nwrote ${OUT}/`);

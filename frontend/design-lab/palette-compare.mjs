/**
 * The two shell palettes, photographed side by side and sampled.
 *
 *   node design-lab/palette-compare.mjs
 *
 * WHY THIS IS A SCRIPT AND NOT A SETTING
 * A shell palette is not a user preference, so there is deliberately no cookie,
 * no toggle and no app code that can reach option B. It exists as one CSS block
 * keyed on `data-shell-palette="ink"` (see tokens.css), and the only thing that
 * sets that attribute is the line below. Whichever option is chosen, the other
 * one is deleted — nothing here is meant to survive the decision.
 *
 * WHAT IT PRODUCES
 *   pass/11-shell-a-navy.png    the shell and its frame under the sampled navy
 *   pass/11-shell-b-ink.png     the same, under Basalt + Lapis ink
 *   pass/11-shell-a-full.png    full frames, kept for sampling
 *   pass/11-shell-b-full.png
 *
 * and a table of actual sampled bytes for each. That table is the point: these
 * two grounds are being judged against each OTHER, and the eye cannot hold two
 * dark blues in memory across two images — simultaneous contrast will make
 * whichever one is seen second look cooler.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { restore, open, settle, prefs } from "./session.mjs";

const OUT = "design-lab-shots/pass";
const BASE = `http://127.0.0.1:${process.env.SHOT_PORT ?? 3000}`;
mkdirSync(OUT, { recursive: true });

const OPTIONS = [
  ["a-navy", null, "A · current sampled navy  --shell #001537"],
  ["b-ink", "ink", "B · Aladdin Ink  Basalt 78% + Lapis 22%  --shell #15222d"],
];

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1024 },
  deviceScaleFactor: 2,
  locale: "en-US",
});
await restore(context, BASE);
await prefs(context, {});
const page = await context.newPage();

for (const [name, palette] of OPTIONS) {
  await open(page, context, BASE, "/b2b");
  await settle(page);
  await page.evaluate((p) => {
    if (p) document.documentElement.setAttribute("data-shell-palette", p);
    else document.documentElement.removeAttribute("data-shell-palette");
  }, palette);
  // The shell's gradients and the frame plane are pure CSS and swap on the next
  // paint, but the carve re-measures on resize and a capture in the same tick
  // catches it mid-settle.
  await page.waitForTimeout(450);

  // TWO CAPTURES, AND THE SECOND ONE IS NOT REDUNDANT. `sample-shot.mjs` maps
  // its landmarks by scaling the image's width against the 1440 viewport, so it
  // can only read a FULL-viewport frame; a 760px crop would silently shift every
  // probe by 1.9x. The crop is for the eye, the full frame is for the bytes.
  await page.screenshot({
    path: `${OUT}/11-shell-${name}.png`,
    clip: { x: 0, y: 0, width: 720, height: 1024 },
  });
  await page.screenshot({ path: `${OUT}/11-shell-${name}-full.png` });
  console.log("  ✓", `11-shell-${name}`);
}

await context.close();
await browser.close();

console.log("");
for (const [name, , label] of OPTIONS) {
  console.log(`=== ${label}`);
  execFileSync(process.execPath, ["design-lab/sample-shot.mjs", `${OUT}/11-shell-${name}-full.png`], {
    stdio: "inherit",
  });
  console.log("");
}

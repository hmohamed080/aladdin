/**
 * The approved concept and the built page, side by side, at the same scale.
 *
 * This is the acceptance test. Everything else in `design-lab/` exists to serve
 * it: comparing a dashboard against a reference by alternating between two
 * windows does not work, because the eye forgets a layout in the time it takes
 * to switch, and what it forgets is exactly the proportions the exercise is
 * about. Placed edge to edge, a KPI strip 30px too tall or a column ratio one
 * step off is obvious in a second.
 *
 * Both images are normalised to the same rendered WIDTH, so the comparison is of
 * proportion rather than of pixel count — the reference is 1486px wide and the
 * capture is 2880 (1440 at 2x), and at their native sizes neither tells you
 * anything about the other.
 *
 *   node design-lab/compare.mjs [shot.png] [outName]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const shot = process.argv[2] ?? "design-lab-shots/dash-en-light-fold.png";
const outName = process.argv[3] ?? "compare.png";

/** Rendered width of each panel. Wide enough that 11px type stays legible. */
const W = 1180;

const out = "design-lab-shots";
mkdirSync(out, { recursive: true });
const html = path.resolve("design-lab/.compare.html");

writeFileSync(
  html,
  `<body style="margin:0;background:#15171c;font:600 13px/1.4 system-ui,sans-serif;color:#c9ced8">
<div style="display:flex;gap:14px;padding:14px">
  <div style="flex:0 0 ${W}px">
    <div style="padding:6px 2px 8px">APPROVED CONCEPT &nbsp;·&nbsp; dashboard.png</div>
    <img src="../../UI-UX/references/styleUpdate/dashboard.png"
         style="display:block;width:${W}px;height:auto;border-radius:6px">
  </div>
  <div style="flex:0 0 ${W}px">
    <div style="padding:6px 2px 8px">BUILT &nbsp;·&nbsp; ${path.basename(shot)} &nbsp;·&nbsp; 1440x1024</div>
    <img src="../${shot}" style="display:block;width:${W}px;height:auto;border-radius:6px">
  </div>
</div></body>`,
);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({ width: W * 2 + 42, height: 900 });
await page.goto(pathToFileURL(html).href);
await page.waitForLoadState("load");
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/${outName}`, fullPage: true });
console.log("wrote", `${out}/${outName}`);
await browser.close();

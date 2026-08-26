/**
 * Magnify a region of any captured shot, so 1px geometry can actually be judged.
 *
 *   node design-lab/zoom.mjs <file> <x> <y> <w> <h> [scale] [outName]
 *
 * Coordinates are in the SOURCE image's own pixels. Captures from `pass.mjs` are
 * taken at deviceScaleFactor 2, so a CSS coordinate read off the page is double
 * here — that is deliberate, since the point of zooming is to look at the pixels
 * that were actually rendered rather than at the ones that were asked for.
 *
 * Same file:// mechanics as `crop-ref.mjs`: a real HTML file next to a relative
 * path, because `setContent` leaves the document on the about:blank origin,
 * which cannot load `file:` subresources and silently yields a flat rectangle.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [file, x, y, w, h, scale = 2, name] = process.argv.slice(2);
if (!file) {
  console.error("usage: node design-lab/zoom.mjs <file> <x> <y> <w> <h> [scale] [outName]");
  process.exit(1);
}

const out = "design-lab-shots/zoom";
mkdirSync(out, { recursive: true });
const label = name ?? path.basename(file, ".png") + `-${x}_${y}`;
const rel = path.relative("design-lab", file).split(path.sep).join("/");

const html = path.resolve("design-lab/.zoom.html");
writeFileSync(
  html,
  `<body style="margin:0;overflow:hidden;background:#111">
<div style="width:${w}px;height:${h}px;overflow:hidden;transform-origin:0 0;transform:scale(${scale})">
<img src="${rel}" style="display:block;margin-left:${-x}px;margin-top:${-y}px;max-width:none">
</div></body>`,
);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
await page.goto(pathToFileURL(html).href);
await page.waitForLoadState("load");
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}/${label}.png` });
await browser.close();
console.log(`${out}/${label}.png`);

/**
 * The same magnifier as `crop-ref.mjs`, pointed at OUR OWN captures.
 *
 * Comparing a detail against the reference means seeing both at the same
 * magnification. A full-page shot of the dashboard is 2880px wide and gets
 * downsampled to something unreadable the moment it is looked at; this crops the
 * region under discussion at 1:1 or better, so a row height or a pill's fill can
 * actually be judged rather than guessed at.
 *
 *   node design-lab/crop-shot.mjs <file.png> <x> <y> <w> <h> [scale]
 *
 * Coordinates are in the SHOT's own pixels (which are 2x CSS, since the harness
 * captures at deviceScaleFactor 2).
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [file, x, y, w, h, scale = "1"] = process.argv.slice(2);
if (!file) throw new Error("usage: crop-shot.mjs <file.png> <x> <y> <w> <h> [scale]");

const out = "design-lab-shots/crops";
mkdirSync(out, { recursive: true });
const html = path.resolve("design-lab/.cropshot.html");
const s = Number(scale);
const [X, Y, W, H] = [x, y, w, h].map(Number);

writeFileSync(
  html,
  `<body style="margin:0;overflow:hidden;background:#0b0b0c">
<div style="width:${W}px;height:${H}px;overflow:hidden;transform-origin:0 0;transform:scale(${s})">
<img src="../${file}" style="display:block;margin-left:${-X}px;margin-top:${-Y}px;max-width:none">
</div></body>`,
);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({ width: Math.round(W * s), height: Math.round(H * s) });
await page.goto(pathToFileURL(html).href);
await page.waitForLoadState("load");
await page.waitForTimeout(120);
const name = `${path.basename(file, ".png")}-${X}x${Y}.png`;
await page.screenshot({ path: `${out}/${name}` });
console.log("wrote", `${out}/${name}`);
await browser.close();

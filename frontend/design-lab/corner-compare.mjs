/**
 * The top-left corner of both images, at the same rendered scale, side by side.
 *
 * `compare.mjs` puts the whole page next to the whole page, which answers
 * questions about proportion. It cannot answer questions about a 30px gutter's
 * hue or how fast a corner glow falls off, because at 1180px wide that gutter is
 * eleven pixels. This crops the one region the shell composition actually lives
 * in and blows it up.
 *
 *   node design-lab/corner-compare.mjs [shot.png] [outName] [refX refY refW refH]
 *
 * Reference coordinates are in the CONCEPT's own pixels; the shot's matching box
 * is derived from the width ratio, so the two panels always frame the same part
 * of the same design.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const shot = process.argv[2] ?? "design-lab-shots/dash-en-light-fold.png";
const outName = process.argv[3] ?? "corner-compare.png";
const [rx, ry, rw, rh] = (process.argv.slice(4, 8).map(Number).length === 4
  ? process.argv.slice(4, 8).map(Number)
  : [230, 0, 440, 300]);

const REF_W = 1486;
const SHOT_W = 2880;
const k = SHOT_W / REF_W;
const SCALE = 2.5;               // rendered magnification of the REFERENCE box
const out = "design-lab-shots";
mkdirSync(out, { recursive: true });
const html = path.resolve("design-lab/.corner.html");

const panel = (label, src, x, y, w, h, s) => `
  <div>
    <div style="padding:6px 2px 8px">${label}</div>
    <div style="width:${Math.round(rw * SCALE)}px;height:${Math.round(rh * SCALE)}px;overflow:hidden;border-radius:6px">
      <div style="transform-origin:0 0;transform:scale(${s})">
        <img src="${src}" style="display:block;margin-left:${-x}px;margin-top:${-y}px;max-width:none">
      </div>
    </div>
  </div>`;

writeFileSync(
  html,
  `<body style="margin:0;background:#15171c;font:600 13px/1.4 system-ui,sans-serif;color:#c9ced8">
<div style="display:flex;gap:14px;padding:14px">
${panel("APPROVED CONCEPT", "../../UI-UX/references/styleUpdate/dashboard.png", rx, ry, rw, rh, SCALE)}
${panel("BUILT", `../${shot}`, rx * k, ry * k, rw * k, rh * k, SCALE / k)}
</div></body>`,
);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({
  width: Math.round(rw * SCALE) * 2 + 42,
  height: Math.round(rh * SCALE) + 60,
});
await page.goto(pathToFileURL(html).href);
await page.waitForLoadState("load");
await page.screenshot({ path: path.join(out, outName) });
console.log("wrote", path.join(out, outName));
await browser.close();

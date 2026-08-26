/**
 * Read colours OUT of the approved concept instead of estimating them by eye.
 *
 * Every value in the shell block of tokens.css is supposed to have been sampled
 * from this image. "Supposed to have been" is doing a lot of work in that
 * sentence — a navy read off a screenshot by eye lands one or two steps too dark
 * about as often as not, and on a surface this large that is the difference
 * between a material and a hole. This prints the actual bytes.
 *
 * Each probe averages a small box rather than reading a single pixel, because
 * the reference is a rendered concept with grain and gradient in it and one
 * pixel of a noisy surface is not that surface's colour.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const PROBES = [
  ["sidebar navy · top", 60, 60],
  ["sidebar navy · upper-mid", 60, 300],
  ["sidebar navy · mid", 60, 560],
  ["sidebar navy · lower", 60, 820],
  ["sidebar navy · foot", 60, 1010],
  ["sidebar navy · trailing bulge", 235, 300],
  ["org card fill", 120, 955],
  ["page ground · gutter", 276, 250],
  ["page ground · gutter low", 276, 700],
  ["header card fill", 700, 30],
  ["search field fill", 700, 58],
  ["body ground", 700, 320],
  ["body ground · low", 700, 760],
  ["panel fill · kpi", 460, 260],
  ["panel fill · attention", 700, 660],
  ["kpi icon chip · blue", 348, 236],
  ["kpi icon chip · amber", 578, 236],
  ["kpi icon chip · green", 812, 236],
  ["heading ink", 330, 145],
  ["primary button fill", 1254, 150],
  ["secondary button fill", 1395, 150],
  ["accent blue · link", 1436, 410],
  ["status pill · unpriced", 941, 401],

  /* A HORIZONTAL SWEEP ACROSS THE BODY at the page-heading band, and a vertical
     one down its inline-start margin. These two lines settle a question a
     handful of scattered probes cannot: whether the body's tint is a CORNER
     pool arriving from the sidebar, or a full-width band fading downward. The
     answer decides whether the heading zone is translucent (band) or merely
     lit from one side (pool), which is the whole of brief item 6. */
  ["body sweep y=175 · x=320", 320, 175],
  ["body sweep y=175 · x=560", 560, 175],
  ["body sweep y=175 · x=860", 860, 175],
  ["body sweep y=175 · x=1160", 1160, 175],
  ["body sweep y=175 · x=1460", 1460, 175],
  ["body sweep x=300 · y=130", 300, 130],
  ["body sweep x=300 · y=330", 300, 330],
  ["body sweep x=300 · y=560", 300, 560],
  ["body sweep x=300 · y=770", 300, 770],
  ["body sweep x=300 · y=1040", 300, 1040],
];

// `file:` images taint a canvas under the default policy, so `getImageData`
// throws before it can read a single byte. The flag scopes that relaxation to
// this throwaway sampling browser, which loads nothing but two local PNGs.
const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const page = await browser.newPage();
const html = path.resolve("design-lab/.sample.html");
writeFileSync(html, `<img id="i" src="../../UI-UX/references/styleUpdate/dashboard.png">`);
await page.goto(pathToFileURL(html).href);
await page.waitForLoadState("load");

const rows = await page.evaluate((probes) => {
  const img = document.getElementById("i");
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  const ctx = c.getContext("2d");
  const hex = (n) => n.toString(16).padStart(2, "0");
  return [
    `reference is ${img.naturalWidth}x${img.naturalHeight}`,
    ...probes.map(([name, x, y]) => {
      const d = ctx.getImageData(x - 2, y - 2, 5, 5).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      const n = d.length / 4;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      return `${name.padEnd(30)} #${hex(r)}${hex(g)}${hex(b)}   rgb(${r},${g},${b})`;
    }),
  ];
}, PROBES);

console.log(rows.join("\n"));
await browser.close();

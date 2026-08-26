/**
 * Read colours OUT of one of our own captures, at the same landmarks
 * `sample-ref.mjs` reads out of the approved concept.
 *
 * The pair is the point. Judging "is the gutter blue enough" by eye across two
 * images on two different backgrounds is exactly the kind of comparison the eye
 * is worst at — simultaneous contrast makes the same grey read warm beside blue
 * and cool beside cream. Two columns of hex do not have that problem.
 *
 *   node design-lab/sample-shot.mjs <file> [probes.json]
 *
 * Landmarks are given in CSS pixels of a 1440-wide capture and scaled by the
 * image's actual width, so a shot taken at deviceScaleFactor 2 needs no
 * conversion at the call site.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

/** [label, x, y] in CSS px of the 1440x1024 fidelity viewport.
 *
 * Every one of these is a point where a PLANE is visible and no content is —
 * the sidebar's left margin, the gutter between the navy and the cards, the
 * body's own inner margin. That is fussier to choose than it looks and it is
 * the whole reliability of the tool: a probe two pixels into a product
 * thumbnail reports the thumbnail, and reports it as confidently as it reports
 * a background. The layout landmarks are the sidebar at 240 + a 40px gutter,
 * the cards from 280 to 1424, and the body opening at y=100. */
const PROBES = [
  ["shell · top", 20, 200],
  ["shell · mid", 20, 560],
  ["shell · foot", 20, 900],
  ["frame · above header", 800, 6],
  ["frame · gutter high", 260, 120],
  ["frame · gutter mid", 260, 460],
  ["frame · gutter low", 260, 900],
  ["frame · between cards", 800, 94],
  ["frame · far edge", 1434, 500],
  ["header card fill", 1000, 14],
  ["search field fill", 700, 36],
  ["body · heading zone", 300, 150],
  ["body · upper", 300, 300],
  ["body · mid", 300, 600],
  ["body · low", 300, 960],
];


const file = process.argv[2];
if (!file) {
  console.error("usage: node design-lab/sample-shot.mjs <file>");
  process.exit(1);
}

const rel = path.relative("design-lab", file).split(path.sep).join("/");
const html = path.resolve("design-lab/.sample.html");
// Same reason as crop-ref: a real file next to a relative path is same-origin,
// so the canvas is not tainted and `getImageData` is allowed to read it.
writeFileSync(html, `<body style="margin:0"><img id="i" src="${rel}"></body>`);

// `file:` images taint a canvas under the default policy, so `getImageData`
// throws before reading a byte. The flag scopes that relaxation to this
// throwaway sampling browser, which loads nothing but one local PNG.
const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.goto(pathToFileURL(html).href);
await page.waitForFunction(() => document.getElementById("i")?.complete);

const rows = await page.evaluate((probes) => {
  const img = document.getElementById("i");
  const cv = document.createElement("canvas");
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const k = img.naturalWidth / 1440;
  const hex = (n) => n.toString(16).padStart(2, "0");
  return probes.map(([label, x, y]) => {
    // Average a small box: a single pixel of a gradient-and-grain surface is not
    // that surface's colour.
    const px = Math.round(x * k) - 3;
    const py = Math.round(y * k) - 3;
    const d = cx.getImageData(Math.max(0, px), Math.max(0, py), 7, 7).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    const [R, G, B] = [r / n, g / n, b / n].map(Math.round);
    return { label, hex: `#${hex(R)}${hex(G)}${hex(B)}`, rgb: `rgb(${R},${G},${B})`, cool: B - R };
  });
}, PROBES);

await browser.close();
console.log(`${file}  (${rows.length} probes)   "cool" = blue minus red\n`);
for (const r of rows) {
  console.log(r.label.padEnd(24), r.hex, r.rgb.padEnd(18), `cool ${r.cool > 0 ? "+" : ""}${r.cool}`);
}

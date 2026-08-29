/**
 * Re-encode capture frames small enough to INLINE into a review page.
 *
 *   node design-lab/inline-shots.mjs out.json name=path [name=path ...]
 *
 * A published Artifact runs under a strict CSP that blocks every external host,
 * so a review page cannot link its own evidence — the images have to travel
 * inside the document as data URIs. The captures are 2880px wide at
 * deviceScaleFactor 2 and several megabytes each; a dozen of them would blow
 * past the 16MB page cap several times over.
 *
 * So each frame is redrawn at a review width and re-encoded as JPEG. The browser
 * doing the redraw is the same one that took the shots, which is the whole
 * reason this is a Playwright script and not an image library: nothing else here
 * needs to be installed, and a canvas `drawImage` downscale is exactly the
 * filter the screenshots were captured through in the first place.
 *
 * JPEG, not PNG, and that is a deliberate trade rather than an oversight. These
 * frames are photographs of a rendered UI — thousands of distinct values in
 * every gradient — so PNG's palette compression has nothing to work with and
 * lands around 8x the size. What JPEG costs is exact colour, and the review page
 * is not where colour is judged: the sampled hex tables in the report are, and
 * those are read off the untouched PNGs.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const [outFile, ...pairs] = process.argv.slice(2);
if (!outFile || !pairs.length) {
  console.error("usage: node design-lab/inline-shots.mjs out.json name=path [name=path ...]");
  process.exit(1);
}

/** Review width in CSS px. Wide enough to read 11px UI type in the frames. */
const W = 1180;
const QUALITY = 0.74;

const entries = pairs.map((p) => {
  const i = p.indexOf("=");
  return [p.slice(0, i), p.slice(i + 1)];
});

const html = path.resolve("design-lab/.inline.html");
writeFileSync(html, `<body style="margin:0"></body>`);

// Same file:// canvas-tainting relaxation as the samplers — this browser loads
// nothing but local PNGs and is thrown away at the end of the script.
const browser = await chromium.launch({ args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.goto(pathToFileURL(html).href);

const out = {};
for (const [name, file] of entries) {
  const rel = path.relative("design-lab", file).split(path.sep).join("/");
  const { uri, w, h } = await page.evaluate(
    async ([src, width, quality]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      // Never UPSCALE. A crop captured narrower than the review width would
      // otherwise be blown up and land softer than the full frames beside it,
      // which reads as a rendering fault in the thing being reviewed rather
      // than in the page reviewing it.
      const scale = Math.min(1, width / img.naturalWidth);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.naturalWidth * scale);
      cv.height = Math.round(img.naturalHeight * scale);
      const cx = cv.getContext("2d");
      cx.imageSmoothingQuality = "high";
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      return { uri: cv.toDataURL("image/jpeg", quality), w: cv.width, h: cv.height };
    },
    [rel, W, QUALITY],
  );
  out[name] = { uri, w, h };
  console.log(`  ${name.padEnd(22)} ${w}x${h}  ${(uri.length / 1024).toFixed(0)}KB`);
}

await browser.close();
writeFileSync(outFile, JSON.stringify(out));
const total = Object.values(out).reduce((n, v) => n + v.uri.length, 0);
console.log(`\n${entries.length} frames, ${(total / 1024 / 1024).toFixed(2)}MB inlined → ${outFile}`);

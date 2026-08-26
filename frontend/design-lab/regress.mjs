/**
 * THE VISUAL-REGRESSION GATE FOR THE GLOBALIZATION PASS.
 *
 * One question, asked precisely: did promoting the approved direction out of its
 * `fady@example.test` gate and into the shared design system CHANGE what that
 * account sees? The answer has to be "no" — the refactor is not allowed to
 * degrade the reference it was derived from — and "it looks the same to me" is
 * not an answer, because the eye forgets a layout in the time it takes to switch
 * windows and what it forgets is exactly the small stuff a refactor breaks.
 *
 * So it decodes both PNGs and counts pixels that actually differ.
 *
 * WHY IT DECODES IN A BROWSER RATHER THAN WITH AN IMAGE LIBRARY
 * `pngjs`/`pixelmatch`/`sharp` are none of them installed, and adding a runtime
 * dependency to answer one question in one pass is exactly the trade the
 * repository's dependency policy exists to prevent. Playwright is already here,
 * and a browser is a very good PNG decoder: both files go into a canvas as data
 * URIs and come back as RGBA byte arrays.
 *
 * THE TOLERANCE, AND WHY IT IS NOT ZERO
 * Anti-aliasing on text and on the atmosphere's own gradients is not bit-stable
 * between two runs of the same build — the mesh is composed of three overlapping
 * radial gradients, and a channel landing on 231 in one run and 232 in the next
 * is dithering, not a design change. So a pixel counts as DIFFERENT only when a
 * channel moves by more than `THRESHOLD`, and the run is reported by how much of
 * the frame moved rather than judged pass/fail on a number nobody agreed to.
 *
 *   node design-lab/regress.mjs [beforeDir] [afterDir]
 */
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BEFORE = process.argv[2] ?? "design-lab-shots/before";
const AFTER = process.argv[3] ?? "design-lab-shots/after";

/** Per-channel movement below this is decode/AA noise, not a design change. */
const THRESHOLD = 8;
/** Above this share of moved pixels, a frame is worth a human looking at it. */
const REPORT_AT = 0.002;

const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();

/**
 * Decode both images in the page and compare them in one pass. Returns null when
 * the two differ in SIZE — which is not a diff percentage, it is a different
 * layout, and averaging over it would hide that.
 */
async function diff(beforePath, afterPath) {
  return page.evaluate(
    async ([a, b, threshold]) => {
      const load = (src) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if (ia.width !== ib.width || ia.height !== ib.height) {
        return { sizeMismatch: { before: [ia.width, ia.height], after: [ib.width, ib.height] } };
      }
      const px = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const da = px(ia);
      const db = px(ib);
      let moved = 0;
      let worst = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]),
        );
        if (d > worst) worst = d;
        if (d > threshold) moved++;
      }
      return { moved, total: da.length / 4, worst, width: ia.width, height: ia.height };
    },
    [dataUri(beforePath), dataUri(afterPath), THRESHOLD],
  );
}

const names = existsSync(BEFORE) ? readdirSync(BEFORE).filter((f) => f.endsWith(".png")) : [];
if (names.length === 0) {
  console.error(`no baseline PNGs in ${BEFORE}`);
  process.exit(1);
}

const rows = [];
for (const name of names) {
  const a = join(BEFORE, name);
  const b = join(AFTER, name);
  if (!existsSync(b)) {
    rows.push({ name, note: "MISSING in after" });
    continue;
  }
  const r = await diff(a, b);
  if (r.sizeMismatch) {
    rows.push({
      name,
      note: `SIZE ${r.sizeMismatch.before.join("x")} -> ${r.sizeMismatch.after.join("x")}`,
    });
    continue;
  }
  rows.push({ name, pct: (r.moved / r.total) * 100, worst: r.worst });
}

await browser.close();

rows.sort((x, y) => (y.pct ?? Infinity) - (x.pct ?? Infinity));
console.log(`\n  ${BEFORE}  ->  ${AFTER}   (channel delta > ${THRESHOLD} counts as moved)\n`);
for (const r of rows) {
  if (r.note) {
    console.log(`  ${r.note.padEnd(28)}  ${r.name}`);
    continue;
  }
  const flag = r.pct > REPORT_AT * 100 ? "LOOK" : "same";
  console.log(
    `  ${flag}  ${r.pct.toFixed(4).padStart(9)}% moved   max Δ ${String(r.worst).padStart(3)}   ${r.name}`,
  );
}
console.log("");

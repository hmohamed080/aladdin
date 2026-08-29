/**
 * WHERE did two shots differ — a row/column profile, not a single percentage.
 *
 * `regress.mjs` answers "how much moved". When the answer is "17% of the frame,
 * but never by more than 26/255", that number on its own is ambiguous: it is the
 * same reading for "a wide region shifted slightly" and for "a narrow region
 * changed completely, plus decode noise everywhere". This prints the diff as a
 * profile down the page and across it, so the region is visible instead of
 * inferred.
 *
 *   node design-lab/where.mjs before/x.png after/x.png
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const [, , A, B] = process.argv;
const dataUri = (p) => `data:image/png;base64,${readFileSync(p).toString("base64")}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const out = await page.evaluate(
  async ([a, b]) => {
    const load = (src) =>
      new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = src;
      });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const px = (img) => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, img.width, img.height).data;
    };
    const da = px(ia);
    const db = px(ib);
    const W = ia.width;
    const H = ia.height;
    const BANDS = 24;
    const rows = Array.from({ length: BANDS }, () => ({ moved: 0, total: 0, worst: 0 }));
    const cols = Array.from({ length: BANDS }, () => ({ moved: 0, total: 0, worst: 0 }));
    // A couple of representative pixel samples per band, for the actual colours.
    const samples = [];
    for (let y = 0; y < H; y++) {
      const rb = rows[Math.min(BANDS - 1, Math.floor((y / H) * BANDS))];
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const d = Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]),
        );
        const cb = cols[Math.min(BANDS - 1, Math.floor((x / W) * BANDS))];
        rb.total++;
        cb.total++;
        if (d > 8) {
          rb.moved++;
          cb.moved++;
          if (d > rb.worst) rb.worst = d;
          if (d > cb.worst) cb.worst = d;
          if (samples.length < 8 && Math.random() < 0.00002) {
            samples.push({
              x,
              y,
              before: [da[i], da[i + 1], da[i + 2]],
              after: [db[i], db[i + 1], db[i + 2]],
            });
          }
        }
      }
    }
    return { W, H, rows, cols, samples };
  },
  [dataUri(A), dataUri(B)],
);

await browser.close();

const bar = (pct) => "#".repeat(Math.round(pct / 2.5)).padEnd(40);
console.log(`\n  ${A}\n  ${B}\n  ${out.W} x ${out.H}\n`);
console.log("  DOWN THE PAGE (each band = %d px)", Math.round(out.H / 24));
out.rows.forEach((r, i) => {
  const pct = (r.moved / r.total) * 100;
  const y0 = Math.round((i / 24) * out.H);
  console.log(`   y${String(y0).padStart(5)}  ${bar(pct)} ${pct.toFixed(1).padStart(5)}%  Δ${r.worst}`);
});
console.log("\n  ACROSS THE PAGE (each band = %d px)", Math.round(out.W / 24));
out.cols.forEach((c, i) => {
  const pct = (c.moved / c.total) * 100;
  const x0 = Math.round((i / 24) * out.W);
  console.log(`   x${String(x0).padStart(5)}  ${bar(pct)} ${pct.toFixed(1).padStart(5)}%  Δ${c.worst}`);
});
console.log("\n  SAMPLES (rgb before -> after)");
for (const s of out.samples) {
  console.log(`   (${s.x},${s.y})  ${s.before.join(",")}  ->  ${s.after.join(",")}`);
}
console.log("");

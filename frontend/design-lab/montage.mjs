/**
 * A contact sheet of the extracted motion frames.
 *
 * Ten separate PNGs cannot be compared — the eye forgets a shape between two
 * file opens, and shape over time is the entire subject. In a row they read as
 * a strip: where the carve is at rest, where it is mid-travel, and whether the
 * fillets hold their radius while it moves or the whole band cross-fades.
 *
 *   node design-lab/montage.mjs <dir> <out.png> [colWidth]
 */
import { chromium } from "@playwright/test";
import { readdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = process.argv[2] ?? "design-lab-shots/ref-motion";
const out = process.argv[3] ?? "design-lab-shots/ref-motion-sheet.png";
const col = Number(process.argv[4] ?? 250);

const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
const html = path.resolve("design-lab/.montage.html");
writeFileSync(
  html,
  `<body style="margin:0;background:#15171c;font:600 12px system-ui;color:#c9ced8">
<div style="display:flex;gap:8px;padding:10px">
${files
  .map(
    (f, i) =>
      `<div style="flex:0 0 ${col}px"><div style="padding:4px 2px">${i}</div>` +
      `<img src="../${dir}/${f}" style="display:block;width:${col}px;border-radius:4px"></div>`,
  )
  .join("\n")}
</div></body>`,
);

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setViewportSize({ width: files.length * (col + 8) + 20, height: 900 });
await page.goto(pathToFileURL(html).href);
await page.waitForLoadState("load");
await page.waitForTimeout(200);
await page.screenshot({ path: out, fullPage: true });
console.log("wrote", out);
await browser.close();

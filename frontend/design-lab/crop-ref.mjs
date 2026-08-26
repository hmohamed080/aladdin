/**
 * Magnified crops of the approved concept.
 *
 * The reference is 1486px wide, which is exactly the width at which none of its
 * detail is legible: the KPI delta line, the fillet radius where the carve meets
 * the sidebar edge, the row heights in the attention list — all of it is 8-12px
 * type and 1px geometry. Reading those off the whole image means guessing, and
 * guessing is how a pass produces a page that matches the palette and nothing
 * else.
 *
 * The crop page is written to DISK and navigated to, rather than injected with
 * `setContent`. That is not a style preference: `setContent` leaves the document
 * on the `about:blank` origin, which is not allowed to load `file:`
 * subresources, so the image silently never arrives and every crop comes back a
 * flat rectangle of the page background. A real file next to a relative `../`
 * path is same-origin and simply works.
 *
 *   node design-lab/crop-ref.mjs [name ...]
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const out = "design-lab-shots/ref-crops";
mkdirSync(out, { recursive: true });

const REF = "../../UI-UX/references/styleUpdate/dashboard.png";
const SIDE = "../../UI-UX/references/styleUpdate/sidebar.png";

/** [name, x, y, w, h, scale, source] — coordinates in the reference's own pixels. */
const REGIONS = [
  ["shell-topleft", 0, 0, 520, 260, 2.4, REF],
  ["sidebar-full", 0, 0, 300, 1058, 1.6, REF],
  ["header-card", 280, 0, 1206, 120, 1.7, REF],
  ["page-head", 280, 100, 1206, 130, 1.7, REF],
  ["kpi-strip", 300, 190, 1180, 130, 1.9, REF],
  ["attention-head", 300, 330, 760, 90, 2.6, REF],
  ["attention-expanded", 300, 370, 760, 190, 2.6, REF],
  ["attention-rows", 300, 560, 760, 190, 2.6, REF],
  ["incoming", 1040, 330, 446, 420, 2.6, REF],
  ["lower-moving", 290, 750, 440, 300, 2.6, REF],
  ["lower-activity", 720, 750, 340, 300, 2.6, REF],
  ["lower-pipeline", 1040, 750, 446, 300, 2.6, REF],
  ["carve-detail", 540, 130, 260, 380, 3.6, SIDE],
  /* The two states of the reference rail, magnified enough to read the active
     mechanic in each: the collapsed rail's tile and the expanded carve's
     fillets. This pass turned on whether those two are the SAME mechanic. */
  ["rail-active", 396, 140, 108, 380, 4.4, SIDE],
  ["carve-fillets", 552, 340, 260, 190, 5.2, SIDE],
  ["rail-head", 396, 140, 400, 130, 4.4, SIDE],
];

const only = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const html = path.resolve("design-lab/.crop.html");

for (const [name, x, y, w, h, scale, src] of REGIONS) {
  if (only.length && !only.includes(name)) continue;
  // The inner box is sized in SOURCE pixels and scaled up from its top-left, so
  // the crop window is exactly (w x h) of the original however far it is zoomed.
  writeFileSync(
    html,
    `<body style="margin:0;overflow:hidden;background:#0b0b0c">
<div style="width:${w}px;height:${h}px;overflow:hidden;transform-origin:0 0;transform:scale(${scale})">
<img src="${src}" style="display:block;margin-left:${-x}px;margin-top:${-y}px;max-width:none">
</div></body>`,
  );
  await page.setViewportSize({ width: Math.round(w * scale), height: Math.round(h * scale) });
  await page.goto(pathToFileURL(html).href);
  await page.waitForLoadState("load");
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("cropped", name);
}
await browser.close();

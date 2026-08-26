/**
 * REVIEW-ONLY prototype #5: enrich `.workspace-frame` itself (light theme
 * only), not the Body.
 *
 * The body-ceiling test (`fady-body-transparent.mjs`) proved the Body's
 * transparency is genuine in both themes, but showed the light theme has
 * almost nothing to reveal: light `--frame` (#e9ecf2) and light `--workspace`
 * (#fbfcfe) sit only ~10-18 levels apart, so even 0% opacity looks close to
 * "before". This variant leaves the Body's CSS exactly as already tested and
 * instead turns up the plane BEHIND it — the same two colour pools the design
 * already commits to (the cool blue near the sidebar, the warm amber at the
 * far corner — see `globals.css`), just stronger, plus a slightly deeper base
 * `--frame` so the whole plane carries more presence, not only its corners.
 * No new hues invented; nothing about the Body, the board panels, or any
 * other theme is touched.
 *
 * Captures three Body states (opaque / 28% translucent / 0% fully
 * transparent) against the enriched frame, so each can be held up next to its
 * already-captured counterpart against the CURRENT frame:
 *   fady-transparent-shell-before.png      (opaque,  old frame)
 *   fady-body-transparent-light.png        (28%,     old frame)
 *   fady-body-fully-transparent-light.png  (0%,      old frame)
 *
 *   node design-lab/fady-rich-frame-light.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { restore, prefs, open, settle, IMPORTER } from "./session.mjs";

const BASE_URL = `http://127.0.0.1:${process.env.SHOT_PORT ?? 3000}`;
const OUT = "design-lab-shots";
mkdirSync(OUT, { recursive: true });

/* Same two hues `.workspace-frame` already uses (rgba(89,134,207,·) cool,
   rgba(247,198,116,·) warm) at roughly double the alpha, plus a base `--frame`
   nudged from #e9ecf2 to a slightly deeper, still-light #dde4f0 so the
   enrichment reads across the WHOLE plane and not only near the two pools. */
const RICH_FRAME_CSS = `
  :root {
    --frame: #dde4f0 !important;
    --frame-tint: rgba(89, 134, 207, 0.30) !important;
    --frame-tint-soft: rgba(89, 134, 207, 0.20) !important;
    --frame-warm: rgba(247, 198, 116, 0.26) !important;
  }
`;

const BODY_28 = `main#main { background-color: color-mix(in srgb, var(--workspace) 28%, transparent) !important; background-image: none !important; }`;
const BODY_0 = `main#main { background-color: transparent !important; background-image: none !important; }`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1024 },
  deviceScaleFactor: 2,
});
await prefs(context, { locale: "en", theme: "light", sidebar: "expanded" });
await restore(context, BASE_URL, { email: IMPORTER });

const page = await context.newPage();
await open(page, context, BASE_URL, "/b2b", { email: IMPORTER });
await settle(page);

await page.addStyleTag({ content: RICH_FRAME_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-rich-frame-body-opaque.png` });

await page.addStyleTag({ content: BODY_28 });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-rich-frame-body-28.png` });

await page.addStyleTag({ content: BODY_0 });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-rich-frame-body-0.png` });

await browser.close();
console.log(`wrote rich-frame captures (opaque / 28% / 0% body) to ${OUT}/`);

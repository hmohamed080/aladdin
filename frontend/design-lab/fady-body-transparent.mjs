/**
 * REVIEW-ONLY prototype #4: the Body ONLY, pushed to genuine transparency.
 *
 * The faux-glass pass (`fady-faux-glass-shell.mjs`) kept `--workspace` at 70%
 * opacity, which read as "opaque with a faint tint" rather than glass — the
 * pixel samples showed a real shift, but not one a reader would call
 * "see-through". This variant drops the fill hard (28%) and removes
 * `workspace-body`'s own alpha-ramp `background-image` (which fades IN toward
 * solid by `--body-solid`), so the frame's actual gradient — the cool pool at
 * the sidebar's head, the warm corner opposite it — stays visible through the
 * WHOLE body rather than only its top edge.
 *
 * Scoped to `main#main` ONLY this pass, per the request: the header is left
 * untouched, and nothing else (border, shadow, radius) is touched either —
 * one variable changed at a time so it's clear what the transparency alone
 * looks like before layering anything back on.
 *
 *   node design-lab/fady-body-transparent.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { restore, prefs, open, settle, IMPORTER } from "./session.mjs";

const BASE_URL = `http://127.0.0.1:${process.env.SHOT_PORT ?? 3000}`;
const OUT = "design-lab-shots";
mkdirSync(OUT, { recursive: true });

const BODY_TRANSPARENT_CSS = `
  main#main {
    background-color: color-mix(in srgb, var(--workspace) 28%, transparent) !important;
    background-image: none !important;
  }
`;

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
await page.addStyleTag({ content: BODY_TRANSPARENT_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-body-transparent-light.png`, fullPage: false });

await context.addCookies(
  [["aladdin-theme", "dark"]].map(([name, value]) => ({ name, value, url: BASE_URL })),
);
await page.reload({ waitUntil: "domcontentloaded" });
await settle(page);
await page.addStyleTag({ content: BODY_TRANSPARENT_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-body-transparent-dark.png`, fullPage: false });

await browser.close();
console.log(`wrote body-transparent captures (light + dark) to ${OUT}/`);

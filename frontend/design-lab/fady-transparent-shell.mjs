/**
 * REVIEW-ONLY prototype: what the supply dashboard looks like if the header
 * card and the body card lose their fill/border/shadow and sit flush on the
 * frame plane instead.
 *
 * Scope: this captures the REAL running app, signed in as the seeded
 * `fady@example.test` (Cairo Sanitary Ware Trading) session, and applies the
 * transparent treatment with an `page.addStyleTag` injected AFTER the page has
 * rendered. Nothing here touches `AppHeader` / `AppShell` / globals.css or any
 * other app source — the override lives only inside this ephemeral Playwright
 * page, so no other account or workspace is affected in any way. It exists
 * purely to produce before/after evidence for a design decision that has not
 * been approved yet.
 *
 *   node design-lab/fady-transparent-shell.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { restore, prefs, open, settle, IMPORTER } from "./session.mjs";

const BASE_URL = `http://127.0.0.1:${process.env.SHOT_PORT ?? 3000}`;
const OUT = "design-lab-shots";
mkdirSync(OUT, { recursive: true });

const TRANSPARENT_SHELL_CSS = `
  header, main#main {
    background: transparent !important;
    background-color: transparent !important;
    background-image: none !important;
    border-color: transparent !important;
    border-width: 0 !important;
    box-shadow: none !important;
    border-radius: 0 !important;
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

await page.screenshot({ path: `${OUT}/fady-transparent-shell-before.png`, fullPage: false });

await page.addStyleTag({ content: TRANSPARENT_SHELL_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-transparent-shell-after.png`, fullPage: false });

// A dark-mode pass too, since the product is light+dark from day one and a
// treatment that only reads well in one theme is not a treatment yet.
await context.addCookies(
  [["aladdin-theme", "dark"]].map(([name, value]) => ({ name, value, url: BASE_URL })),
);
await page.reload({ waitUntil: "domcontentloaded" });
await settle(page);
await page.screenshot({ path: `${OUT}/fady-transparent-shell-dark-before.png`, fullPage: false });
await page.addStyleTag({ content: TRANSPARENT_SHELL_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-transparent-shell-dark-after.png`, fullPage: false });

await browser.close();
console.log(`wrote before/after captures (light + dark) to ${OUT}/`);

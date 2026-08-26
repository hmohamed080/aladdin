/**
 * REVIEW-ONLY prototype #2: a GLASS treatment on the same two containers —
 * translucent, blurred fill instead of the opaque card, rather than removing
 * the fill outright (see `fady-transparent-shell.mjs` for the flush variant).
 *
 * Requested against the reference glassmorphic dashboard the user attached:
 * frosted, semi-transparent panels over whatever sits behind them, keeping a
 * soft edge and shadow rather than disappearing into the page.
 *
 * Built from the app's OWN tokens (`--workspace`, `--workspace-line`) rather
 * than invented colours, so the glass tints itself correctly in both themes
 * for free — no per-theme branching needed here.
 *
 * Same guarantees as the flush variant: captures the real `fady@example.test`
 * session, injects the override into one ephemeral Playwright page via
 * `page.addStyleTag`, and touches no app source. Nothing here is imported by
 * the app or the E2E gate.
 *
 *   node design-lab/fady-glass-shell.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { restore, prefs, open, settle, IMPORTER } from "./session.mjs";

const BASE_URL = `http://127.0.0.1:${process.env.SHOT_PORT ?? 3000}`;
const OUT = "design-lab-shots";
mkdirSync(OUT, { recursive: true });

/* NOTE for the reviewer: `AppShell`'s own comment block documents "NOT GLASS —
   no backdrop-filter, no blur, no saturation" as a deliberate cost decision
   (a full-page composite on every scroll frame). This variant deliberately
   crosses that line so it can be judged on its merits; it is not a proposal to
   quietly override that decision. */
const GLASS_CSS = `
  header, main#main {
    background: color-mix(in srgb, var(--workspace) 55%, transparent) !important;
    background-image: none !important;
    backdrop-filter: blur(18px) saturate(150%) !important;
    -webkit-backdrop-filter: blur(18px) saturate(150%) !important;
    box-shadow: 0 8px 30px -14px rgba(0, 0, 0, 0.22) !important;
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
await page.addStyleTag({ content: GLASS_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-glass-shell-light.png`, fullPage: false });

await context.addCookies(
  [["aladdin-theme", "dark"]].map(([name, value]) => ({ name, value, url: BASE_URL })),
);
await page.reload({ waitUntil: "domcontentloaded" });
await settle(page);
await page.addStyleTag({ content: GLASS_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-glass-shell-dark.png`, fullPage: false });

await browser.close();
console.log(`wrote glass captures (light + dark) to ${OUT}/`);

/**
 * REVIEW-ONLY prototype #3: "faux glass" — no `backdrop-filter`, no blur.
 *
 * The real glass variant (`fady-glass-shell.mjs`) came back visually flat: it
 * blurs `.workspace-frame`, which is a near-flat gradient with nothing behind
 * it worth revealing. This variant fakes the MATERIAL instead of the optics —
 * a translucent fill (so the frame's own colour actually shows through, no
 * blur needed since there's no texture to hide), a diagonal light sheen, and a
 * soft highlight border along the top edge, the way a static glass card is
 * often faked when a live blur isn't worth its render cost.
 *
 * Still zero `backdrop-filter` — cheap to paint, no per-frame recomposite.
 *
 * Same guarantees as the other two: real `fady@example.test` session, CSS
 * injected into one ephemeral Playwright page via `page.addStyleTag`, no app
 * source touched, nothing imported by the app or the E2E gate.
 *
 *   node design-lab/fady-faux-glass-shell.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { restore, prefs, open, settle, IMPORTER } from "./session.mjs";

const BASE_URL = `http://127.0.0.1:${process.env.SHOT_PORT ?? 3000}`;
const OUT = "design-lab-shots";
mkdirSync(OUT, { recursive: true });

/* `--workspace` for the translucent base (so the tint is correct per theme
   for free), a diagonal white sheen (glass catches light regardless of the
   surface it sits on — dark-mode glass panels use the same trick, just
   dimmer), and an inset highlight on the top edge standing in for a
   physical bevel. `border-workspace-line` becomes the visible edge instead
   of a hairline, since a translucent panel needs a stronger line to read as
   an object at all. */
const FAUX_GLASS_CSS = `
  header, main#main {
    background-color: color-mix(in srgb, var(--workspace) 70%, transparent) !important;
    background-image: linear-gradient(
      135deg,
      color-mix(in srgb, white 16%, transparent) 0%,
      color-mix(in srgb, white 3%, transparent) 30%,
      transparent 55%,
      color-mix(in srgb, white 5%, transparent) 100%
    ) !important;
    border: 1px solid color-mix(in srgb, var(--workspace-line) 260%, transparent) !important;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 22%, transparent),
      0 10px 28px -18px rgba(0, 0, 0, 0.3) !important;
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
await page.addStyleTag({ content: FAUX_GLASS_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-faux-glass-light.png`, fullPage: false });

await context.addCookies(
  [["aladdin-theme", "dark"]].map(([name, value]) => ({ name, value, url: BASE_URL })),
);
await page.reload({ waitUntil: "domcontentloaded" });
await settle(page);
await page.addStyleTag({ content: FAUX_GLASS_CSS });
await settle(page, 200);
await page.screenshot({ path: `${OUT}/fady-faux-glass-dark.png`, fullPage: false });

await browser.close();
console.log(`wrote faux-glass captures (light + dark) to ${OUT}/`);

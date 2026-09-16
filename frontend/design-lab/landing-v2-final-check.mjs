import path from "node:path";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1030, height: 632 }, locale: "ar-EG" });
await context.addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://127.0.0.1:3012" }]);
const page = await context.newPage();
// `/preview/landing-v2` was promoted to `/` and the preview route removed.
await page.goto("http://127.0.0.1:3012/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.locator("h1").waitFor();
await page.waitForTimeout(1_000);
await page.locator("section").screenshot({
  path: path.resolve("..", "UI-UX", "references", "landing", "v2-hero-checkpoint", "landing-v2-background-2-review.png"),
});
await browser.close();

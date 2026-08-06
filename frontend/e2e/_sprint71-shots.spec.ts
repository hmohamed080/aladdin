import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { signIn, IDENTITIES } from "./helpers/auth";

/** Sprint 7.1 evidence: new sign-in + cockpit across viewport/locale/theme. SHOTS=1. */
const VPS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "mobile-390", width: 390, height: 844 },
];
const CELLS = [
  ["en", "light"],
  ["ar", "dark"],
] as const;

async function prefs(page: Page, locale: string, theme: string) {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
  ]);
}
async function noOverflow(page: Page, label: string) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(o, `${label} overflow`).toBeLessThanOrEqual(1);
}

test.describe("sprint 7.1 shots", () => {
  test.skip(process.env.SHOTS !== "1", "set SHOTS=1");
  test.beforeAll(() => mkdirSync("test-results/s71", { recursive: true }));

  test("sign-in (unauthenticated)", async ({ page }) => {
    for (const vp of VPS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [locale, theme] of CELLS) {
        await prefs(page, locale, theme);
        await page.goto("/auth/sign-in", { waitUntil: "networkidle" });
        await noOverflow(page, `sign-in ${vp.name}/${locale}/${theme}`);
        await page.screenshot({ path: `test-results/s71/signin-${vp.name}-${locale}-${theme}.png` });
      }
    }
  });

  test("cockpit + shell (manager)", async ({ page, request }) => {
    test.setTimeout(120_000);
    await signIn(page, request, IDENTITIES.manager);
    for (const vp of VPS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [locale, theme] of CELLS) {
        await prefs(page, locale, theme);
        await page.goto("/b2b", { waitUntil: "networkidle" });
        await noOverflow(page, `cockpit ${vp.name}/${locale}/${theme}`);
        await page.screenshot({ path: `test-results/s71/cockpit-${vp.name}-${locale}-${theme}.png` });
      }
    }
  });
});

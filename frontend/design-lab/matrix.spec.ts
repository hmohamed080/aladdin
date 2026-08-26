import { test, type Page, type APIRequestContext } from "@playwright/test";
import { signIn } from "../e2e/helpers/auth";

/**
 * THE ACCOUNT MATRIX CAPTURE — the visual-regression instrument for the
 * globalization pass.
 *
 * `shots.spec.ts` answers "does fady's dashboard look like the reference".
 * This answers the two questions that one cannot:
 *
 *   1. Did the approved reference SURVIVE the refactor? Run this before the
 *      globalization (`--out before`) and again after (`--out after`); the two
 *      fady frames must be visually equivalent, because the refactor is not
 *      allowed to degrade what was approved.
 *
 *   2. Did the design system PROPAGATE without leaking role content? Every
 *      other account is captured through the same lens, so a supplier-only
 *      module appearing on a buyer's rail, or a consumer inheriting a B2B
 *      surface, is visible rather than inferred.
 *
 * Each identity names its own landing route, because the landing is DERIVED
 * from the account (persona, memberships, platform role) — hardcoding `/b2b`
 * for all of them would make a wrong redirect look like a capture failure.
 *
 * Set `SHOT_OUT` to the subdirectory. Nothing here asserts; the eye is the
 * assertion, same contract as the rest of this harness.
 */
const OUT = `design-lab-shots/${process.env.SHOT_OUT ?? "matrix"}`;

type Theme = "light" | "dark";
type Locale = "en" | "ar";

/**
 * The matrix. `shell` records which chrome the account is EXPECTED to land in,
 * so a capture that shows the wrong one is a finding rather than a surprise —
 * consumer and admin are deliberately not the B2B shell and must not become it.
 */
const ACCOUNTS = [
  {
    key: "fady-importer",
    email: "fady@example.test",
    landing: /\/b2b(\/|$)/,
    route: "/b2b",
    shell: "b2b",
    note: "APPROVED REFERENCE — Cairo Sanitary Ware Trading, org_type importer",
  },
  {
    key: "a-owner-supplier",
    email: "a-owner@example.test",
    landing: /\/b2b(\/|$)/,
    route: "/b2b",
    shell: "b2b",
    note: "second supply-side workspace — proves the system is not fady-shaped",
  },
  /* THE BUYER-SIDE B2B WORKSPACE. `hana` owns Cairo Ceramics Showroom, whose
     `org_type` puts it in the BUYING seat — the buyer-first showroom IA. This is
     the account that proves the design system propagated without the CONTENT
     propagating with it: it must render the approved shell and none of the
     supplier-only modules (incoming demand, quotations to answer, Reels). */
  {
    key: "hana-showroom-buyer",
    email: "hana@example.test",
    landing: /\/b2b(\/|$)/,
    route: "/b2b",
    shell: "b2b",
    note: "buyer-side org (showroom/dealer) — must show NO supplier modules",
  },
  /* THESE TWO ARE `seed.sql` (demo) IDENTITIES, NOT `seed-pilot.sql` ONES.
     They authenticate, but hold no ACTIVE membership in the pilot database this
     harness runs against, so the B2B layout resolves them to Personal — which is
     the correct, designed behaviour for a caller who can work in no business
     (see `app/b2b/layout.tsx`). Captured against `/home` rather than dropped,
     because "an account with no org lands somewhere coherent and on-system" is
     itself part of what this pass has to keep true. */
  {
    key: "a-cairo-no-org",
    email: "a-cairo@example.test",
    landing: /\/home(\/|$)/,
    route: "/home",
    shell: "personal",
    note: "demo-seed identity, no active pilot membership — resolves to Personal",
  },
  {
    key: "b-owner-no-org",
    email: "b-owner@example.test",
    landing: /\/home(\/|$)/,
    route: "/home",
    shell: "personal",
    note: "demo-seed identity, no active pilot membership — resolves to Personal",
  },
  {
    key: "consumer",
    email: "consumer@example.test",
    landing: /\/home(\/|$)/,
    route: "/home",
    shell: "personal",
    note: "personal shell — deliberately not the B2B sidebar",
  },
  {
    key: "admin",
    email: "admin@example.test",
    landing: /\/admin(\/|$)/,
    route: "/admin",
    shell: "admin",
    note: "platform console — its own denser shell",
  },
] as const;

async function prefs(page: Page, locale: Locale, theme: Theme) {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
    { name: "aladdin-sidebar", value: "expanded", url: "http://127.0.0.1" },
  ]);
}

/** Same settle contract as `shots.spec.ts` — the carve animates, fonts swap. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

/**
 * One account, captured in the four combinations that can each break
 * independently: light, dark, Arabic (RTL mirroring), and a narrow viewport
 * (the desktop rail must not be forced onto a phone).
 */
async function captureAccount(
  page: Page,
  request: APIRequestContext,
  account: (typeof ACCOUNTS)[number],
) {
  await prefs(page, "en", "light");
  await signIn(page, request, account.email, account.landing);

  for (const [locale, theme] of [
    ["en", "light"],
    ["en", "dark"],
    ["ar", "light"],
  ] as const) {
    await prefs(page, locale, theme);
    await page.goto(account.route, { waitUntil: "domcontentloaded" });
    await settle(page);
    const tag = `${account.key}-${locale}-${theme}`;
    await page.screenshot({ path: `${OUT}/${tag}-fold.png`, fullPage: false });
    await page.screenshot({ path: `${OUT}/${tag}-full.png`, fullPage: true });
  }

  /* PHONE. Captured for every account, not just the B2B ones, because the
     failure this guards against is a DESKTOP assumption reaching mobile — and
     the shells that never had a sidebar are exactly where such a leak would be
     least expected and therefore least looked for. */
  await prefs(page, "en", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(account.route, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.screenshot({ path: `${OUT}/${account.key}-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1024 });
}

for (const account of ACCOUNTS) {
  test(`matrix — ${account.key} (${account.shell}): ${account.note}`, async ({ page, request }) => {
    test.setTimeout(300_000);
    await captureAccount(page, request, account);
  });
}

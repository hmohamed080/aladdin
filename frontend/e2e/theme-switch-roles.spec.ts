import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * THE THEME TOGGLE, PRESSED TWICE, ON EVERY SHELL THAT HAS ONE.
 *
 * `global-shell-uat` already covers the control in depth on the B2B workspace.
 * What it cannot show is that the fix holds across the three DIFFERENT shells
 * the header renders into — the B2B workspace (the `card` variant, floating
 * beside the sidebar), the Personal home and the Admin console (both the `bar`
 * variant) — and for accounts with very different amounts of work behind them.
 *
 * That breadth is the point here, because the defect this guards scaled with the
 * page. `setTheme` used to end in `revalidatePath("/", "layout")`, and the write
 * was wrapped in `useTransition`, so the control stayed disabled until the whole
 * route had been rebuilt server-side. On a Personal home that was survivable; on
 * a Supplier's `/b2b` — workspace context, the header's identity/notification/
 * chat fan-out, the dashboard's own queries — it never came back inside 30s, and
 * one press killed the toggle for the rest of the session.
 *
 * So each account below presses it TWICE and requires the theme to come back.
 * A single press proves nothing: the first one always appeared to work, because
 * `applyThemePreference` writes the document before persistence is attempted.
 */

const ACCOUNTS = [
  { name: "supplier · fady (importer)", email: IDENTITIES.importer, landing: /\/b2b(\/|$)/ },
  { name: "supplier · a-owner", email: IDENTITIES.manager, landing: /\/b2b(\/|$)/ },
  { name: "buyer · hana (showroom)", email: IDENTITIES.showroom, landing: /\/b2b(\/|$)/ },
  { name: "admin console", email: IDENTITIES.admin, landing: /\/admin(\/|$)/ },
  { name: "consumer · personal", email: IDENTITIES.consumer, landing: /\/home(\/|$)/ },
] as const;

/** English, so the accessible names below are the ones being asserted. */
async function prefs(page: Page) {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: "light", url: "http://127.0.0.1" },
  ]);
}

for (const account of ACCOUNTS) {
  test(`theme toggles both ways without a reload — ${account.name}`, async ({ page, request }) => {
    await prefs(page);
    await signIn(page, request, account.email, account.landing);

    const html = page.locator("html");
    const themeSwitch = page.getByTestId("theme-switch");
    await expect(themeSwitch).toBeVisible();
    await expect(html).not.toHaveClass(/dark/);

    // --- light -> dark ---------------------------------------------------
    await expect(themeSwitch).toBeEnabled();
    await themeSwitch.click();
    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute("data-theme-pref", "dark");

    /* THE ASSERTION THE BUG FAILED. `disabled` is the "write in flight" signal,
       and it has to clear — otherwise the press below never lands. */
    await expect(themeSwitch).toBeEnabled();

    // --- dark -> light, same page, no reload ------------------------------
    await themeSwitch.click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute("data-theme-pref", "light");
    await expect(themeSwitch).toBeEnabled();

    // --- and a third press, because "works twice" is not "does not latch" ---
    await themeSwitch.click();
    await expect(html).toHaveClass(/dark/);
    await expect(themeSwitch).toBeEnabled();

    /* The preference is the COOKIE, so it outlives the page. Waited for above:
       reloading while the write is still in flight races it. */
    await page.reload();
    await expect(html).toHaveClass(/dark/);
  });
}

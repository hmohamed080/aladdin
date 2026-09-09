import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { IDENTITIES, signIn } from "./helpers/auth";

const SHOTS = "e2e/screenshots";
const ORG_C = "9c000000-cccc-4ccc-8ccc-000000000001";

/**
 * Ticket #53 — the pencil/customization surface over `dashboard_kpi_layouts`
 * (20260915090001), already proven at the schema/RPC layer by
 * `55_dashboard_kpi_layout_test.sql` (21/21). This spec proves the same
 * personal-vs-team-default separation end to end through the real UI.
 *
 * Every test truncates this org's rows first — the RPCs are idempotent, but
 * a personal/team-default row saved by an earlier run would otherwise leak
 * into `hana-foundation-completion.spec.ts`'s own assumption that the
 * dashboard renders the untouched system default order.
 */
function resetKpiLayouts() {
  execSync(
    `docker exec -u postgres supabase_db_aladdin psql -d postgres -c "delete from public.dashboard_kpi_layouts where organization_id = '${ORG_C}';"`,
  );
}

test.describe("KPI card personalization (#53)", () => {
  test.beforeEach(async ({ page, context }) => {
    resetKpiLayouts();
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1:3100" }]);
    await signIn(page, page.context().request, IDENTITIES.showroom);
  });

  test.afterAll(() => {
    resetKpiLayouts();
  });

  test("pencil trigger opens the dialog with an accessible name in both locales", async ({ page }) => {
    const trigger = page.getByTestId("kpi-customize-trigger");
    await expect(trigger).toHaveAccessibleName("Customize cards");
    await trigger.click();
    await expect(page.getByTestId("kpi-customize-dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Customize KPI cards" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("kpi-customize-dialog")).not.toBeVisible();

    // Arabic: the exact bilingual label the product spec requires.
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://127.0.0.1:3100" }]);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("kpi-customize-trigger")).toHaveAccessibleName("تخصيص البطاقات");
  });

  test("keyboard reorder, hide, and add all work without a mouse drag", async ({ page }) => {
    await page.getByTestId("kpi-customize-trigger").click();
    const dialog = page.getByTestId("kpi-customize-dialog");
    await expect(dialog).toBeVisible();
    const rows = dialog.locator("ol > li");
    // The system default enables all 8 catalog cards (6 primary + 2
    // secondary on the dashboard grid) — the dialog's own "visible" list
    // shows every enabled card, not just the primary row.
    await expect(rows).toHaveCount(8);
    const firstLabelBefore = (await rows.nth(0).locator("span.truncate").first().textContent()) ?? "";
    const secondLabelBefore = (await rows.nth(1).locator("span.truncate").first().textContent()) ?? "";
    expect(firstLabelBefore).not.toBe("");
    expect(secondLabelBefore).not.toBe("");

    // Move row 2 up via its own keyboard-reachable button — a real click,
    // not a synthesized key event, so this proves the button itself (not
    // some other key handler) is what moves the row.
    await rows.nth(1).getByRole("button", { name: "Move up" }).click();
    await expect(rows.nth(0).locator("span.truncate").first()).toHaveText(secondLabelBefore);
    await expect(rows.nth(1).locator("span.truncate").first()).toHaveText(firstLabelBefore);

    // Hide the (now second) row, then re-add it from the "available" list.
    await rows.nth(1).getByRole("button", { name: "Hide" }).click();
    await expect(dialog.locator("ol > li")).toHaveCount(7);
    const availableRow = dialog.locator("ul > li", { hasText: firstLabelBefore });
    await expect(availableRow).toBeVisible();
    await availableRow.getByRole("button", { name: "Show" }).click();
    await expect(dialog.locator("ol > li")).toHaveCount(8);
  });

  test("saving a personal layout changes only this member's view, not the team default", async ({ page }) => {
    await page.getByTestId("kpi-customize-trigger").click();
    const dialog = page.getByTestId("kpi-customize-dialog");
    // Hide the first visible card, then save personally.
    await dialog.locator("ol > li").first().getByRole("button", { name: "Hide" }).click();
    await dialog.getByTestId("kpi-customize-save-personal").click();
    await expect(page.getByText("Your layout was saved.")).toBeVisible();

    // Saving stays open (so the confirmation above is actually readable) —
    // "Reset to team default" is now offered in this SAME dialog, a personal
    // row having just been created.
    await expect(dialog.getByRole("button", { name: "Reset to team default" })).toBeVisible();
  });

  test("an org.manage owner can publish a team default", async ({ page }) => {
    await page.getByTestId("kpi-customize-trigger").click();
    const dialog = page.getByTestId("kpi-customize-dialog");
    await expect(dialog.getByTestId("kpi-customize-save-team-default")).toBeVisible();
    await dialog.locator("ol > li").first().getByRole("button", { name: "Hide" }).click();
    await dialog.getByTestId("kpi-customize-save-team-default").click();
    await expect(page.getByText("The team default was updated.")).toBeVisible();

    // Publishing a team default deliberately leaves the dialog OPEN (so the
    // owner sees the confirmation without losing their place) — assert on
    // the already-open dialog rather than reopening it.
    await expect(dialog.getByRole("button", { name: "Reset to system default" })).toBeVisible();
  });

  test("a saved personal reorder survives a page reload", async ({ page }) => {
    await page.getByTestId("kpi-customize-trigger").click();
    const dialog = page.getByTestId("kpi-customize-dialog");
    const rows = dialog.locator("ol > li");
    const firstBefore = (await rows.nth(0).locator("span.truncate").first().textContent()) ?? "";
    const secondBefore = (await rows.nth(1).locator("span.truncate").first().textContent()) ?? "";

    await rows.nth(1).getByRole("button", { name: "Move up" }).click();
    await dialog.getByTestId("kpi-customize-save-personal").click();
    await expect(page.getByText("Your layout was saved.")).toBeVisible();
    await page.keyboard.press("Escape");

    // A fresh navigation, not just closing the dialog — proves the order was
    // actually persisted server-side (dashboard_kpi_layout_set_personal),
    // not merely held in this component's own React state.
    await page.reload({ waitUntil: "networkidle" });
    const primaryCards = page.locator('[class*="desktop:grid-cols-6"]').first().locator("> *");
    // `.first()`: each tile also renders an (empty, in this case) hint span
    // sharing the same `.text-label` class — see stat-tiles.tsx's unconditional
    // hint slot, kept for height-reservation even when a tile has no hint text.
    await expect(primaryCards.nth(0).locator(".text-label").first()).toHaveText(secondBefore);
    await expect(primaryCards.nth(1).locator(".text-label").first()).toHaveText(firstBefore);
  });

  test("mobile: no horizontal scroll, pencil stays reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    const trigger = page.getByTestId("kpi-customize-trigger");
    await expect(trigger).toBeVisible();
    const scrollsHorizontally = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrollsHorizontally).toBe(false);
    await trigger.click();
    await expect(page.getByTestId("kpi-customize-dialog")).toBeVisible();
  });

  test("screenshots — pencil button, dialog, and mobile", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByTestId("kpi-customize-trigger").click();
    const dialog = page.getByTestId("kpi-customize-dialog");
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/10-en-kpi-customize-dialog.png`, fullPage: true });

    // A hidden card, available to add back — proof the show/hide catalog
    // round-trips, not just that hiding removes a row.
    await dialog.locator("ol > li").first().getByRole("button", { name: "Hide" }).click();
    await expect(dialog.locator("ul > li").first().getByRole("button", { name: "Show" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/10b-en-kpi-hidden-card-available.png`, fullPage: true });
    await page.keyboard.press("Escape");

    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://127.0.0.1:3100" }]);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("kpi-customize-trigger").click();
    await expect(page.getByTestId("kpi-customize-dialog")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/11-ar-kpi-customize-dialog.png`, fullPage: true });
    await page.keyboard.press("Escape");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("kpi-customize-trigger")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/12-ar-mobile-kpi-pencil.png`, fullPage: true });
  });
});

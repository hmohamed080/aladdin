import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Orders / Projects workspace smoke E2E (Sprint 10). Local Next.js + local
 * Supabase, seeded synthetic identity, real Email-OTP via Mailpit (no bypass).
 *
 * The FULL cross-org execution journey (accepted quotation → order → project →
 * completion) and its security invariants are proven exhaustively in the pgTAP
 * suite (supabase/tests/24_orders_projects_test.sql, 30 assertions) — that is the
 * right layer for a two-tenant workflow the single-identity demo seed can't drive.
 * This spec proves the UI wiring the database tests can't see: routing, navigation,
 * bilingual empty/loading/error states, and no horizontal overflow.
 */

const isMobile = () => test.info().project.name.includes("mobile");

/** The page body must never scroll horizontally (responsive contract). */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "no horizontal overflow").toBeLessThanOrEqual(1);
}

test.describe("orders & projects workspace", () => {
  test.beforeEach(async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.manager);
  });

  test("orders page renders with heading, empty states, and nav", async ({ page }) => {
    await page.goto("/b2b/orders");
    await expect(page.getByRole("heading", { name: /orders|الطلبات/i, level: 1 })).toBeVisible();
    // Both perspective sections render (placed / received) with their empty states.
    await expect(page.getByText(/no orders (placed|received)|لا توجد طلبات/i).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("projects page renders with heading and empty states", async ({ page }) => {
    await page.goto("/b2b/projects");
    await expect(page.getByRole("heading", { name: /projects|المشاريع/i, level: 1 })).toBeVisible();
    await expect(page.getByText(/no projects yet|لا توجد مشاريع/i).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("navigation exposes Orders and Projects and they are reachable", async ({ page }) => {
    await page.goto("/b2b/orders");
    // On mobile the rail collapses to a bottom bar; both expose the same links.
    const ordersLink = page.getByRole("link", { name: /orders|الطلبات/i }).first();
    const projectsLink = page.getByRole("link", { name: /projects|المشاريع/i }).first();
    await expect(ordersLink).toBeVisible();
    await expect(projectsLink).toBeVisible();
    await projectsLink.click();
    await page.waitForURL(/\/b2b\/projects(\?|$)/, { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: /projects|المشاريع/i, level: 1 })).toBeVisible();
  });

  test("a missing order is handled gracefully (no crash, no leaked data)", async ({ page }) => {
    if (isMobile()) test.skip();
    const res = await page.goto("/b2b/orders/00000000-0000-4000-8000-000000000000");
    // No server error, and none of another tenant's order data is rendered.
    expect(res?.status() ?? 200).toBeLessThan(500);
    await expect(page.getByText(/order lines|بنود الطلب/i)).toHaveCount(0);
  });
});

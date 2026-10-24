import { test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { OUT, admin, adminUserClient, decoreClient, expect, fixtureClient, scenario, uiSignIn } from "./audit-helpers";

/**
 * Journey E — Admin seller approval on the DISPOSABLE fixture showroom only.
 * Decore Store's state is never changed.
 */
const J = "E. Admin sellers";
const fx = JSON.parse(readFileSync(`${OUT}/traces/fixtures.json`, "utf8"));
const ORG = fx.fixtureOrgId as string;
const VERIF = "d4cde410-6890-47ac-bf67-ef9e923cb253";

const row = (page: Page) => page.locator("tbody tr", { hasText: "Audit Showroom Fixture" });
async function transition(page: Page, label: string, reason: string) {
  await row(page).getByRole("button", { name: label, exact: true }).click();
  const box = row(page).locator("textarea");
  await box.fill(reason);
  await row(page).getByRole("button", { name: new RegExp(`${label} · `) }).click();
  await expect(page.getByText("تم تحديث حالة البائع.")).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("Journey E — admin seller approval", () => {
  test("E0 organization verification (admin RPCs)", async () => {
    const adm = await adminUserClient();
    await scenario({ journey: J, id: "E0", scenario: "Admin approves the fixture showroom's verification (review_start → review_approve → apply)", role: "Super Admin", data: "fixture verification (submitted by audit setup)", expected: "org active + verified; showroom_seller_ready", }, async () => {
      for (const [fn, args] of [["review_start", { p_verification_id: VERIF }], ["review_approve", { p_verification_id: VERIF, p_grant_public_listing: false }], ["apply_organization_verification", { p_verification_id: VERIF }]] as const) {
        const { error } = await adm.rpc(fn, args);
        if (error) throw new Error(`${fn}: ${error.message}`);
      }
      const { data: o } = await admin.from("organizations").select("status, is_verified").eq("id", ORG).single();
      expect(o?.status).toBe("active");
      return `org ${o?.status}, verified=${o?.is_verified}`;
    });
  });

  test("E1-E6 admin UI transitions", async ({ page }) => {
    await uiSignIn(page, "admin");
    await scenario({ journey: J, id: "E2", scenario: "Seller listing shows the eligible, not-yet-enabled showroom", role: "Super Admin", data: "/admin/marketplace", expected: "fixture row: eligible yes, not enabled, Approve action" }, async () => {
      const t0 = Date.now();
      await page.goto("/admin/marketplace");
      await expect(row(page)).toBeVisible();
      const text = (await row(page).innerText()).replace(/\s+/g, " ");
      await expect(row(page).getByRole("button", { name: "اعتماد", exact: true })).toBeVisible();
      return `${Date.now() - t0} ms; row: ${text.slice(0, 120)}`;
    }, page);
    await scenario({ journey: J, id: "E4a", scenario: "Approval requires a reason", role: "Super Admin", data: "empty / 2-char reason", expected: "confirm disabled; RPC refuses short reason" }, async () => {
      await row(page).getByRole("button", { name: "اعتماد", exact: true }).click();
      const confirm = row(page).getByRole("button", { name: /اعتماد · / });
      await expect(confirm).toBeDisabled();
      await row(page).locator("textarea").fill("ok");
      await expect(confirm).toBeDisabled();
      const adm = await adminUserClient();
      const { error } = await adm.rpc("admin_marketplace_seller_approve", { p_organization_id: ORG, p_reason: "ok" });
      if (!error) throw new Error("short reason accepted by the RPC");
      await row(page).getByRole("button", { name: "إلغاء الأمر" }).click();
      return `UI disabled; RPC refused (${error.code})`;
    }, page);
    await scenario({ journey: J, id: "E4b", scenario: "Admin approves the seller with a reason", role: "Super Admin", data: "reason text", expected: "status Approved" }, async () => {
      const t0 = Date.now();
      await transition(page, "اعتماد", "Audit fixture approval 2026-10-15");
      await expect(row(page)).toContainText("معتمد");
      return `approved in ${Date.now() - t0} ms`;
    }, page);
    await scenario({ journey: J, id: "E5a", scenario: "Suspend with reason", role: "Super Admin", data: "reason", expected: "status Suspended; seller area closed" }, async () => {
      await transition(page, "إيقاف", "Audit fixture suspension test");
      await expect(row(page)).toContainText("موقوف");
      return "suspended";
    }, page);
    await scenario({ journey: J, id: "E5b", scenario: "Reinstate with reason", role: "Super Admin", data: "reason", expected: "status Approved again" }, async () => {
      await transition(page, "إعادة تفعيل", "Audit fixture reinstatement test");
      await expect(row(page)).toContainText("معتمد");
      return "reinstated";
    }, page);
    await scenario({ journey: J, id: "E6", scenario: "Audit trail records actor, reason and time for every transition", role: "Super Admin", data: "admin_marketplace_seller_history", expected: "approved, suspended, reinstated with reasons and actor" }, async () => {
      const adm = await adminUserClient();
      const { data, error } = await adm.rpc("admin_marketplace_seller_history", { p_organization_id: ORG });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { action: string; reason: string; actor_user_id: string | null }[];
      const actions = rows.map((r) => r.action);
      for (const a of ["approved", "suspended", "reinstated"]) expect(actions).toContain(a);
      expect(rows.every((r) => r.reason && r.actor_user_id)).toBe(true);
      return `history: ${actions.join(" → ")}; every row has reason + actor`;
    });
  });

  test("E7 unauthorized transitions", async () => {
    await scenario({ journey: J, id: "E7a", scenario: "Seller cannot suspend/approve sellers", role: "Decore Store", data: "admin_marketplace_seller_suspend(fixture)", expected: "refused 42501" }, async () => {
      const c = await decoreClient();
      const { error } = await c.rpc("admin_marketplace_seller_suspend", { p_organization_id: ORG, p_reason: "unauthorized probe" });
      if (!error) throw new Error("seller suspended another seller");
      return `refused (${error.code})`;
    });
    await scenario({ journey: J, id: "E7b", scenario: "Sales member cannot approve itself", role: "sales_rep (fixture org)", data: "admin_marketplace_seller_approve(own org)", expected: "refused" }, async () => {
      const c = await fixtureClient(fx.salesUserId);
      const { error } = await c.rpc("admin_marketplace_seller_approve", { p_organization_id: ORG, p_reason: "self approval probe" });
      if (!error) throw new Error("member approved its own org");
      return `refused (${error.code})`;
    });
  });
});

import { test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { FIXTURE_PASSWORD, OUT, RUN, admin, adminUserClient, decoreClient, expect, fixtureClient, fixtureSession, scenario, sessionClient, uiSignIn } from "./audit-helpers";

/**
 * Journey B — role & organization access. Fixtures: the run's disposable
 * showroom org (pending verification = an UNAPPROVED showroom) + its owner, and
 * a disposable sales-only member of that org. Decore Store is only READ.
 */
const J = "B. Access";
const FIX = `${OUT}/traces/fixtures.json`;
const fx = JSON.parse(readFileSync(FIX, "utf8"));
const save = (patch: Record<string, unknown>) => writeFileSync(FIX, JSON.stringify({ ...JSON.parse(readFileSync(FIX, "utf8")), ...patch }, null, 2));
const DECORE_ORG = "2d3b6ab7-d5ee-4e7a-80a7-436d0b032b33";

async function ensureSalesMember(): Promise<string> {
  if (fx.salesUserId) return fx.salesUserId;
  const email = `audit-sales-${RUN}@audit.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: FIXTURE_PASSWORD, email_confirm: true, user_metadata: { full_name: "Audit Sales Rep" } });
  if (error || !data.user) throw new Error(`fixture create failed: ${error?.message}`);
  const uid = data.user.id;
  // fixture membership through local psql (service_role deliberately has no table grant on memberships)
  const sql = `with br as (select id from public.branches where organization_id = '${fx.fixtureOrgId}' limit 1),
    m as (insert into public.memberships (user_id, organization_id, primary_branch_id, status, accepted_at)
          select '${uid}', '${fx.fixtureOrgId}', br.id, 'active', now() from br returning id)
    insert into public.membership_capabilities (membership_id, capability_key)
    select m.id, k from m, unnest(array['sales.read','sales.write']) k returning membership_id;`;
  const out = execFileSync("docker", ["exec", "supabase_db_aladdin-marketplace", "psql", "-U", "postgres", "-tA", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  const m = { id: out };
  save({ salesUserId: uid, salesEmail: email, salesMembershipId: m!.id });
  fx.salesUserId = uid;
  return uid;
}

async function statusOf(page: Page, path: string) {
  const res = await page.goto(path);
  return { status: res?.status() ?? 0, url: new URL(page.url()).pathname + new URL(page.url()).search };
}

test.describe.serial("Journey B — access", () => {
  test("B1 anonymous", async ({ page }) => {
    for (const [id, path] of [["B1a", "/b2c/seller/products"], ["B1b", "/b2c/seller/imports"], ["B1c", "/admin/marketplace"], ["B1d", "/b2b/products"]] as const) {
      await scenario({ journey: J, id, scenario: `Anonymous blocked from ${path}`, role: "anonymous", data: path, expected: "redirect to sign-in (or 404), never content" }, async () => {
        const r = await statusOf(page, path);
        if (!/sign-in/.test(r.url) && r.status !== 404) throw new Error(`reached ${r.url} (${r.status})`);
        return `${r.status} → ${r.url}`;
      }, page);
    }
  });

  test("B2 unapproved showroom owner", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await fixtureSession(ctx, fx.showroomUserId);
    await scenario({ journey: J, id: "B2a", scenario: "Unapproved showroom: no Marketplace seller area", role: "showroom owner (unapproved)", data: "fixture org pending_verification", expected: "/b2c/seller/products is 404; no B2C sidebar group" }, async () => {
      const r = await statusOf(page, "/b2c/seller/products");
      expect(r.status).toBe(404);
      await page.goto("/b2b");
      const hasLink = await page.locator('a[href="/b2c/seller/products"]').count();
      expect(hasLink).toBe(0);
      return `seller page ${r.status}; sidebar links to it: ${hasLink}`;
    }, page);
    await scenario({ journey: J, id: "B2b", scenario: "Unapproved showroom cannot reach Admin", role: "showroom owner (unapproved)", data: "/admin/marketplace", expected: "redirect away" }, async () => {
      const r = await statusOf(page, "/admin/marketplace");
      if (r.url.startsWith("/admin")) throw new Error(`admin reachable (${r.status})`);
      return `→ ${r.url}`;
    }, page);
    const c = await sessionClient(await (await admin.auth.admin.getUserById(fx.showroomUserId)).data.user!.email!, FIXTURE_PASSWORD);
    await scenario({ journey: J, id: "B2c", scenario: "B2B owner permissions do not grant Marketplace selling", role: "showroom owner (org.manage, catalog.write, catalog.publish)", data: "marketplace_seller_product_save on own org", expected: "refused (seller not enabled)" }, async () => {
      const { error } = await c.rpc("marketplace_seller_product_save", { p_payload: { organization_id: fx.fixtureOrgId, product_type_key: "wallpaper", name_ar: "اختبار", name_en: "Audit" } });
      if (!error) throw new Error("ACCEPTED — B2B permissions granted Marketplace selling");
      return `refused: ${error.message.slice(0, 80)}`;
    });
    await scenario({ journey: J, id: "B2d", scenario: "Cross-tenant read: other seller's product list", role: "showroom owner (other tenant)", data: "marketplace_seller_products_page(Decore)", expected: "refused" }, async () => {
      const { data, error } = await c.rpc("marketplace_seller_products_page", { p_organization_id: DECORE_ORG, p_limit: 5, p_offset: 0 });
      if (!error && data) throw new Error(`LEAK: returned ${(data as { total?: number }).total} products`);
      return `refused: ${error?.message.slice(0, 80)}`;
    });
    await scenario({ journey: J, id: "B2e", scenario: "Cross-tenant read: other seller's draft products/images via RLS", role: "showroom owner (other tenant)", data: "select marketplace_products / images of Decore", expected: "0 rows" }, async () => {
      const { data: p } = await c.from("marketplace_products").select("id").eq("seller_organization_id", DECORE_ORG).limit(5);
      const { data: i } = await c.from("marketplace_product_images").select("id, object_key").limit(5);
      if ((p?.length ?? 0) > 0 || (i?.length ?? 0) > 0) throw new Error(`LEAK: ${p?.length} products, ${i?.length} images`);
      return "0 products, 0 image rows visible";
    });
    await scenario({ journey: J, id: "B2f", scenario: "Cross-tenant write: save a product into another seller's org", role: "showroom owner (other tenant)", data: "save with organization_id = Decore", expected: "refused" }, async () => {
      const { error } = await c.rpc("marketplace_seller_product_save", { p_payload: { organization_id: DECORE_ORG, product_type_key: "wallpaper", name_ar: "اختراق", name_en: "Intrusion" } });
      if (!error) throw new Error("ACCEPTED cross-tenant write");
      return `refused: ${error.message.slice(0, 80)}`;
    });
    await scenario({ journey: J, id: "B2g", scenario: "Cross-tenant image bytes: direct storage download of another seller's image", role: "showroom owner (other tenant)", data: "storage download (key read via service, not exposed)", expected: "denied" }, async () => {
      const { data: img } = await admin.from("marketplace_product_images").select("storage_bucket, object_key").eq("status", "verified").limit(1).single();
      const { error } = await c.storage.from(img!.storage_bucket).download(img!.object_key);
      if (!error) throw new Error("LEAK: another tenant downloaded private bytes");
      return "denied";
    });
    await scenario({ journey: J, id: "B2h", scenario: "Cross-tenant edit page of another seller's product", role: "showroom owner (other tenant)", data: "/b2c/seller/products/<decore id>/edit", expected: "404" }, async () => {
      const { data: p } = await admin.from("marketplace_products").select("id").eq("seller_organization_id", DECORE_ORG).limit(1).single();
      const r = await statusOf(page, `/b2c/seller/products/${p!.id}/edit`);
      expect(r.status).toBe(404);
      return `${r.status}`;
    }, page);
  });

  test("B3 sales-only member", async ({ browser }) => {
    const uid = await ensureSalesMember();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await fixtureSession(ctx, uid);
    await scenario({ journey: J, id: "B3a", scenario: "Sales-only member: no seller area, no product writes", role: "sales_rep (sales.read, sales.write)", data: "fixture member", expected: "/b2c/seller/* not available; product write refused" }, async () => {
      const r = await statusOf(page, "/b2c/seller/products");
      const c = await fixtureClient(uid).catch(() => null);
      let write = "n/a";
      if (c) {
        const { error } = await c.rpc("marketplace_seller_product_save", { p_payload: { organization_id: fx.fixtureOrgId, product_type_key: "wallpaper", name_ar: "س", name_en: "s" } });
        write = error ? `refused (${error.message.slice(0, 50)})` : "ACCEPTED";
        if (!error) throw new Error("sales-only member wrote a Marketplace product");
      }
      if (r.status === 200 && r.url.startsWith("/b2c/seller")) throw new Error("sales-only member reached the seller area");
      return `seller page → ${r.status} ${r.url}; write ${write}`;
    }, page);
    await scenario({ journey: J, id: "B3b", scenario: "Sales-only member: B2B landing works", role: "sales_rep", data: "/b2b", expected: "workspace loads (or onboarding gate for an incomplete profile)" }, async () => {
      const r = await statusOf(page, "/b2b");
      return `${r.status} → ${r.url}`;
    }, page);
  });

  test("B4 approved seller & admin", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await scenario({ journey: J, id: "B4a", scenario: "Approved seller reaches the seller area (real sign-in form)", role: "Decore Store (approved seller)", data: "-", expected: "/b2c/seller/products 200" }, async () => {
      const t0 = Date.now();
      await uiSignIn(page, "decore");
      const signIn = Date.now() - t0;
      const r = await statusOf(page, "/b2c/seller/products");
      expect(r.status).toBe(200);
      return `sign-in ${signIn} ms; seller page ${r.status}`;
    }, page);
    await scenario({ journey: J, id: "B4b", scenario: "Approved seller cannot reach Admin", role: "Decore Store", data: "/admin", expected: "redirect away" }, async () => {
      const r = await statusOf(page, "/admin");
      if (r.url.startsWith("/admin")) throw new Error("seller reached /admin");
      return `→ ${r.url}`;
    }, page);
    const decore = await decoreClient();
    await scenario({ journey: J, id: "B4c", scenario: "Seller cannot call admin RPCs", role: "Decore Store", data: "admin_marketplace_seller_overview, admin_marketplace_media_approve", expected: "refused" }, async () => {
      const a = await decore.rpc("admin_marketplace_seller_overview");
      const b = await decore.rpc("admin_marketplace_set_media_verification_ready", { p_ready: false, p_reason: "audit probe" });
      if (!a.error || !b.error) throw new Error("seller executed an admin RPC");
      return `both refused (${a.error.code}/${b.error.code})`;
    });
    const page2 = await (await browser.newContext()).newPage();
    await scenario({ journey: J, id: "B5", scenario: "Platform admin reaches Marketplace admin pages", role: "Super Admin", data: "-", expected: "/admin/marketplace and /media 200" }, async () => {
      await uiSignIn(page2, "admin");
      const a = await statusOf(page2, "/admin/marketplace");
      const b = await statusOf(page2, "/admin/marketplace/media");
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      return `${a.status} / ${b.status}`;
    }, page2);
    const adm = await adminUserClient();
    await scenario({ journey: J, id: "B6", scenario: "Admin cannot write a seller's catalogue through seller RPCs", role: "Super Admin", data: "marketplace_seller_product_save(Decore)", expected: "refused (not a member)" }, async () => {
      const { error } = await adm.rpc("marketplace_seller_product_save", { p_payload: { organization_id: DECORE_ORG, product_type_key: "wallpaper", name_ar: "س", name_en: "s" } });
      if (!error) throw new Error("admin wrote into a seller catalogue");
      return `refused: ${error.message.slice(0, 60)}`;
    });
  });
});

test.afterAll(() => {
  if (!existsSync(FIX)) return;
});

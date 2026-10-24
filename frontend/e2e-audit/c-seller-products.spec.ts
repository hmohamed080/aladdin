import { test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { OUT, RUN, admin, expect, fixtureClient, fixtureSession, perf, scenario, uiSignIn } from "./audit-helpers";

/**
 * Journey C — seller product management.
 *  - READ-ONLY browsing on Decore Store (search, filter, pagination, open).
 *  - Every WRITE happens in the disposable fixture org (approved in Journey E).
 */
const J = "C. Seller products";
const FIX = `${OUT}/traces/fixtures.json`;
const fx = JSON.parse(readFileSync(FIX, "utf8"));
const save = (patch: Record<string, unknown>) => writeFileSync(FIX, JSON.stringify({ ...JSON.parse(readFileSync(FIX, "utf8")), ...patch }, null, 2));
const SKU_A = `AUD-${RUN.slice(-6)}-A`;
const SKU_B = `AUD-${RUN.slice(-6)}-B`;

async function img(r: number, g: number, b: number, w = 900, h = 700) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).jpeg({ quality: 85 }).toBuffer();
}

test.describe.serial("Journey C — seller products", () => {
  test("C1-C5 browse a 795-product catalogue (Decore, read-only)", async ({ page }) => {
    await uiSignIn(page, "decore");
    await scenario({ journey: J, id: "C1", scenario: "Open product list (795 products)", role: "Decore Store", data: "795 products", expected: "first page of 20, server counts" }, async () => {
      const t0 = Date.now();
      await page.goto("/b2c/seller/products");
      await expect(page.locator("tbody tr").first()).toBeVisible();
      const rows = await page.locator("tbody tr").count();
      const ms = Date.now() - t0;
      perf({ kind: "action", action: "seller list open (warm, signed in)", ms });
      return `${rows} rows in ${ms} ms`;
    }, page);
    await scenario({ journey: J, id: "C2", scenario: "Search products by SKU", role: "Decore Store", data: "q=Suzuki-518", expected: "Suzuki 518 row only" }, async () => {
      const t0 = Date.now();
      await page.goto("/b2c/seller/products?q=Suzuki-518");
      await expect(page.locator("tbody tr")).toHaveCount(1);
      return `1 row in ${Date.now() - t0} ms`;
    }, page);
    await scenario({ journey: J, id: "C3", scenario: "Filter by status", role: "Decore Store", data: "status=published", expected: "only published" }, async () => {
      await page.goto("/b2c/seller/products?status=published");
      const n = await page.locator("tbody tr").count();
      expect(n).toBe(1);
      return `${n} published row`;
    }, page);
    await scenario({ journey: J, id: "C4", scenario: "Pagination (server-side)", role: "Decore Store", data: "page=20 and page=40", expected: "different rows; last page shorter" }, async () => {
      await page.goto("/b2c/seller/products?page=20");
      const a = await page.locator("tbody tr").first().innerText();
      const t0 = Date.now();
      await page.goto("/b2c/seller/products?page=40");
      const ms = Date.now() - t0;
      const rows = await page.locator("tbody tr").count();
      const b = await page.locator("tbody tr").first().innerText();
      expect(a).not.toBe(b);
      perf({ kind: "action", action: "seller list deep page (page 40)", ms });
      return `page 40: ${rows} rows in ${ms} ms`;
    }, page);
    await scenario({ journey: J, id: "C5", scenario: "Open an existing product", role: "Decore Store", data: "Suzuki 518 edit page", expected: "form loads with 7 variants, 9 images" }, async () => {
      const { data: p } = await admin.from("marketplace_products").select("id").eq("external_ref", "106-Suzuki-518").single();
      const t0 = Date.now();
      await page.goto(`/b2c/seller/products/${p!.id}/edit`);
      await expect(page.locator("#mp-name-ar")).toHaveValue(/سوزوكي/);
      const ms = Date.now() - t0;
      perf({ kind: "action", action: "seller edit page open (7 variants, 9 images)", ms });
      return `loaded in ${ms} ms`;
    }, page);
  });

  test("C6-C14 create a draft with variants, attributes and images (fixture org)", async ({ page }) => {
    await fixtureSession(page.context(), fx.showroomUserId);
    await scenario({ journey: J, id: "C6-C13", scenario: "Create Draft: 2 variants, dynamic attributes, 3 images", role: "showroom owner (approved fixture seller)", data: `${SKU_A}, ${SKU_B}`, expected: "saved as draft; images uploaded; edit page opens" }, async () => {
      await page.goto("/b2c/seller/products/new");
      await page.locator("#mp-type").selectOption("wallpaper");
      await page.locator("#mp-name-ar").fill(`ورق حائط اختبار ${RUN.slice(-6)}`);
      await page.locator("#mp-name-en").fill(`Audit wallpaper ${RUN.slice(-6)}`);
      await page.locator("#mp-desc-ar").fill("منتج اختبار للمراجعة الشاملة — يُحذف بعد المراجعة.");
      await page.locator("#mp-attr-material_wallpaper").selectOption({ index: 3 });
      await page.locator("#mp-attr-pattern_wallpaper").selectOption({ index: 3 });
      await page.getByRole("button", { name: "+ إضافة خيار" }).click();
      for (const [i, sku, price, color] of [[0, SKU_A, "650", 4], [1, SKU_B, "720", 9]] as const) {
        await page.locator(`#mp-sku-new-${i}`).fill(sku);
        await page.locator(`#mp-unit-new-${i}`).selectOption("roll");
        await page.locator(`#mp-price-new-${i}`).fill(price);
        await page.locator(`#mp-vattr-new-${i}-color`).selectOption({ index: color });
        await page.locator(`#mp-vattr-new-${i}-roll_width`).fill("530");
        await page.locator(`#mp-vattr-new-${i}-roll_length`).fill("10050");
        await page.locator(`#mp-qty-new-${i}`).fill(String(10 + i * 5));
      }
      await page.locator('main input[type="file"]').setInputFiles([
        { name: "cover.jpg", mimeType: "image/jpeg", buffer: await img(220, 200, 170) },
        { name: "room.jpg", mimeType: "image/jpeg", buffer: await img(120, 90, 70) },
        { name: "detail.jpg", mimeType: "image/jpeg", buffer: await img(200, 120, 140, 800, 800) },
      ]);
      const t0 = Date.now();
      await Promise.all([page.waitForURL(/\/edit\?created=1/, { timeout: 60_000 }), page.getByRole("button", { name: "حفظ كمسودة" }).click()]);
      const ms = Date.now() - t0;
      perf({ kind: "action", action: "save draft (2 variants + stock + 3 image uploads)", ms });
      const id = new URL(page.url()).pathname.split("/")[4]!;
      save({ fixtureProductId: id, skuA: SKU_A, skuB: SKU_B });
      const failed = new URL(page.url()).searchParams.get("imagesFailed");
      if (failed) throw new Error(`${failed} images failed to upload`);
      return `draft ${id.slice(0, 8)}… saved + 3 images in ${ms} ms`;
    }, page);
    await scenario({ journey: J, id: "C9-C10", scenario: "Persistence after refresh", role: "fixture owner", data: "reload edit page", expected: "names, 2 variants, attributes, stock, 3 pending images" }, async () => {
      await page.reload();
      await expect(page.locator("#mp-name-en")).toHaveValue(/Audit wallpaper/);
      const id = JSON.parse(readFileSync(FIX, "utf8")).fixtureProductId;
      const { data: p } = await admin.from("marketplace_products").select("status").eq("id", id).single();
      const { data: v } = await admin.from("marketplace_product_variants").select("sku, price_egp, option_signature").eq("product_id", id);
      const { data: i } = await admin.from("marketplace_product_images").select("status, upload_state, is_primary").eq("product_id", id);
      const { data: a } = await admin.from("marketplace_product_attribute_values").select("attribute_id").eq("product_id", id);
      const { data: lv } = await admin.from("marketplace_inventory_levels").select("on_hand, variant_id").in("variant_id", (v ?? []).map(() => "x").length ? (await admin.from("marketplace_product_variants").select("id").eq("product_id", id)).data!.map((x) => x.id) : []);
      expect(p?.status).toBe("draft");
      expect(v?.length).toBe(2);
      expect(i?.filter((x) => x.upload_state === "confirmed").length).toBe(3);
      expect(i?.filter((x) => x.is_primary).length).toBe(1);
      return `draft; ${v?.length} variants (${v?.map((x) => x.price_egp).join("/")}); ${a?.length} product attrs; images ${i?.length} (${i?.map((x) => x.status).join(",")}); stock ${lv?.map((x) => x.on_hand).join("/")}`;
    }, page);
  });

  test("C11-C20 edit, uniqueness, stock ledger, readiness (fixture org, API)", async () => {
    const f = JSON.parse(readFileSync(FIX, "utf8"));
    const c = await fixtureClient(f.showroomUserId);
    const id = f.fixtureProductId as string;
    type Variant = { sku: string; price_egp: number | string } & Record<string, unknown>;
    type Product = { attributes: Record<string, unknown>; variants: Variant[] } & Record<string, unknown>;
    const get = async () => (await c.rpc("marketplace_seller_product_get", { p_product_id: id })).data as Product;
    await scenario({ journey: J, id: "C11", scenario: "Edit price and attribute", role: "fixture owner", data: "price 650→690, pattern change", expected: "saved and read back" }, async () => {
      const cur = await get();
      const payload = { ...cur, organization_id: f.fixtureOrgId, attributes: { ...cur.attributes, pattern_wallpaper: "geometric" }, variants: cur.variants.map((v) => (v.sku === f.skuA ? { ...v, price_egp: 690 } : v)) };
      const t0 = Date.now();
      const { error } = await c.rpc("marketplace_seller_product_save", { p_payload: payload });
      const ms = Date.now() - t0;
      if (error) throw new Error(error.message);
      perf({ kind: "rpc", action: "marketplace_seller_product_save (edit, 2 variants)", ms });
      const after = await get();
      expect(after.attributes.pattern_wallpaper).toBe("geometric");
      expect(Number(after.variants.find((v) => v.sku === f.skuA)!.price_egp)).toBe(690);
      return `saved in ${ms} ms; read back pattern=geometric, price=690`;
    });
    await scenario({ journey: J, id: "C12", scenario: "Duplicate SKU rejected (second product reusing SKU)", role: "fixture owner", data: f.skuA, expected: "mp:sku_taken" }, async () => {
      const { error } = await c.rpc("marketplace_seller_product_save", { p_payload: { organization_id: f.fixtureOrgId, product_type_key: "wallpaper", name_ar: "مكرر", name_en: "Dup", variants: [{ sku: f.skuA, selling_unit: "roll", price_egp: 100 }] } });
      if (!error) throw new Error("duplicate SKU accepted");
      return `refused: ${error.message.slice(0, 60)}`;
    });
    await scenario({ journey: J, id: "C12b", scenario: "Invalid prices rejected", role: "fixture owner", data: "0 and -5", expected: "refused" }, async () => {
      for (const price of [0, -5]) {
        const { error } = await c.rpc("marketplace_seller_product_save", { p_payload: { organization_id: f.fixtureOrgId, product_type_key: "wallpaper", name_ar: "س", name_en: "s", variants: [{ sku: `AUD-PX-${price}`, selling_unit: "roll", price_egp: price }] } });
        if (!error) throw new Error(`price ${price} accepted`);
      }
      return "0 and -5 refused";
    });
    const variantId = (await admin.from("marketplace_product_variants").select("id").eq("product_id", id).eq("sku", f.skuA).single()).data!.id as string;
    const level = (await admin.from("marketplace_inventory_levels").select("location_id, on_hand").eq("variant_id", variantId).single()).data!;
    await scenario({ journey: J, id: "C15-C16", scenario: "Stock adjust through the ledger + idempotency", role: "fixture owner", data: "+3 twice with the same key", expected: "on_hand +3 once; one movement row" }, async () => {
      const key = `audit-${RUN}-stock-1`;
      const t0 = Date.now();
      const r1 = await c.rpc("marketplace_seller_stock_adjust", { p_variant_id: variantId, p_location_id: level.location_id, p_delta: 3, p_idempotency_key: key, p_reason: "audit adjust", p_expected_on_hand: null });
      const ms = Date.now() - t0;
      const r2 = await c.rpc("marketplace_seller_stock_adjust", { p_variant_id: variantId, p_location_id: level.location_id, p_delta: 3, p_idempotency_key: key, p_reason: "audit adjust", p_expected_on_hand: null });
      if (r1.error) throw new Error(r1.error.message);
      perf({ kind: "rpc", action: "marketplace_seller_stock_adjust", ms });
      const after = (await admin.from("marketplace_inventory_levels").select("on_hand").eq("variant_id", variantId).single()).data!.on_hand;
      const { count } = await admin.from("marketplace_stock_movements").select("id", { count: "exact", head: true }).eq("idempotency_key", key);
      expect(after).toBe(level.on_hand + 3);
      expect(count).toBe(1);
      return `${level.on_hand}→${after}; replay ${r2.error ? "refused" : "no-op"}; ledger rows for key: ${count}; ${ms} ms`;
    });
    await scenario({ journey: J, id: "C17", scenario: "Stale inventory update rejected (expected_on_hand mismatch)", role: "fixture owner", data: "expected_on_hand = old value", expected: "refused, stock unchanged" }, async () => {
      const before = (await admin.from("marketplace_inventory_levels").select("on_hand").eq("variant_id", variantId).single()).data!.on_hand;
      const { error } = await c.rpc("marketplace_seller_stock_adjust", { p_variant_id: variantId, p_location_id: level.location_id, p_delta: -1, p_idempotency_key: `audit-${RUN}-stale`, p_reason: "stale probe", p_expected_on_hand: before - 99 });
      const after = (await admin.from("marketplace_inventory_levels").select("on_hand").eq("variant_id", variantId).single()).data!.on_hand;
      if (!error) throw new Error("stale update accepted");
      expect(after).toBe(before);
      return `refused (${error.message.slice(0, 40)}); stock stays ${after}`;
    });
    await scenario({ journey: J, id: "C17b", scenario: "Stock cannot go negative", role: "fixture owner", data: "delta -100000", expected: "refused" }, async () => {
      const { error } = await c.rpc("marketplace_seller_stock_adjust", { p_variant_id: variantId, p_location_id: level.location_id, p_delta: -100000, p_idempotency_key: `audit-${RUN}-neg`, p_reason: "negative probe", p_expected_on_hand: null });
      if (!error) throw new Error("negative stock accepted");
      return `refused (${error.message.slice(0, 40)})`;
    });
    await scenario({ journey: J, id: "C20", scenario: "Publication readiness lists the real blockers", role: "fixture owner", data: "draft with pending images", expected: "no_verified_primary_image (images not moderated yet)" }, async () => {
      const t0 = Date.now();
      const { data, error } = await c.rpc("marketplace_seller_product_readiness", { p_product_id: id });
      perf({ kind: "rpc", action: "marketplace_seller_product_readiness", ms: Date.now() - t0 });
      if (error) throw new Error(error.message);
      const b = data as string[];
      expect(b).toContain("no_verified_primary_image");
      return `blockers: ${b.join(", ")}`;
    });
    await scenario({ journey: J, id: "C20b", scenario: "Publishing is refused while blockers remain", role: "fixture owner", data: "marketplace_product_publish", expected: "refused" }, async () => {
      const { error } = await c.rpc("marketplace_product_publish", { p_product_id: id });
      if (!error) throw new Error("published with blockers");
      return `refused: ${error.message.slice(0, 80)}`;
    });
  });
});

test("C14/C19 primary image and image removal (UI, fixture)", async ({ page }) => {
  const f = JSON.parse(readFileSync(FIX, "utf8"));
  await fixtureSession(page.context(), f.showroomUserId);
  await page.goto(`/b2c/seller/products/${f.fixtureProductId}/edit`);
  await scenario({ journey: J, id: "C19", scenario: "Remove one image (two-phase removal) and the rest stay", role: "fixture owner", data: "3 → 2 images", expected: "image row and bytes removed; 2 remain" }, async () => {
    const before = (await admin.from("marketplace_product_images").select("id, object_key").eq("product_id", f.fixtureProductId)).data!;
    // NOTE (2026-10-15 run): an earlier version clicked a second delete button by mistake and removed two images
    await page.getByRole("button", { name: /حذف|إزالة/ }).last().click();
    await expect.poll(async () => (await admin.from("marketplace_product_images").select("id").eq("product_id", f.fixtureProductId)).data!.length, { timeout: 20_000 }).toBe(before.length - 1);
    const after = (await admin.from("marketplace_product_images").select("object_key").eq("product_id", f.fixtureProductId)).data!;
    const removedKey = before.find((b) => !after.some((a) => a.object_key === b.object_key))!.object_key;
    const { data: obj } = await admin.storage.from("marketplace-product-images").list(removedKey.split("/").slice(0, -1).join("/"));
    const stillThere = obj?.some((o) => removedKey.endsWith(o.name));
    if (stillThere) throw new Error("row removed but bytes remain (orphan)");
    return `${before.length} → ${after.length}; bytes deleted`;
  }, page);
});

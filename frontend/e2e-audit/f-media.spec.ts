import { test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { OUT, RUN, admin, adminUserClient, anon, expect, fixtureClient, perf, scenario, uiSignIn } from "./audit-helpers";

/**
 * Journey F — media moderation + publication + revocation, on the fixture
 * product's images only (Decore's media is never moderated or changed).
 */
const J = "F. Media";
const FIX = `${OUT}/traces/fixtures.json`;
const f = JSON.parse(readFileSync(FIX, "utf8"));
const save = (patch: Record<string, unknown>) => writeFileSync(FIX, JSON.stringify({ ...JSON.parse(readFileSync(FIX, "utf8")), ...patch }, null, 2));
const PID = f.fixtureProductId as string;
const BASE = process.env.AUDIT_BASE_URL ?? "http://localhost:3200";
const media = async (id: string) => {
  const r = await fetch(`${BASE}/marketplace/media/${id}`);
  return { status: r.status, cache: r.headers.get("cache-control"), type: r.headers.get("content-type"), bytes: (await r.arrayBuffer()).byteLength };
};
const images = async () => (await admin.from("marketplace_product_images").select("id, status, content_valid, is_primary, object_key").eq("product_id", PID).order("sort_order")).data!;

test.describe.serial("Journey F — media moderation", () => {
  test("F3 MIME spoofing through the direct RPC path", async () => {
    const c = await fixtureClient(f.showroomUserId);
    await scenario({ journey: J, id: "F3", scenario: "Spoofed image (HTML bytes declared image/jpeg) via direct RPC confirm", role: "fixture owner", data: "text bytes, content-type image/jpeg", expected: "app path refuses at confirm; if confirmed via raw RPC, admin byte-validation marks it invalid and approval is refused" }, async () => {
      const { data: t, error } = await c.rpc("marketplace_seller_image_request_upload", { p_product_id: PID, p_content_type: "image/jpeg", p_variant_id: null });
      if (error) throw new Error(error.message);
      const ticket = t as { image_id: string; object_key: string };
      const up = await c.storage.from("marketplace-product-images").upload(ticket.object_key, new Blob(["<html><script>alert(1)</script></html>"], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: false });
      if (up.error) return `storage refused the spoof at upload (${up.error.message})`;
      const conf = await c.rpc("marketplace_seller_image_confirm_upload", { p_image_id: ticket.image_id });
      save({ spoofImageId: ticket.image_id });
      // one more GENUINE image (same raw path) so concurrency can use two verified images
      const { data: t2 } = await c.rpc("marketplace_seller_image_request_upload", { p_product_id: PID, p_content_type: "image/jpeg", p_variant_id: null });
      const k2 = t2 as { image_id: string; object_key: string };
      const sharp = (await import("sharp")).default;
      const jpg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 160 } } }).jpeg().toBuffer();
      await c.storage.from("marketplace-product-images").upload(k2.object_key, jpg, { contentType: "image/jpeg", upsert: false });
      await c.rpc("marketplace_seller_image_confirm_upload", { p_image_id: k2.image_id });
      if (conf.error) return `raw RPC confirm refused (${conf.error.message.slice(0, 50)})`;
      return `raw RPC confirm ACCEPTED the spoof as pending (magic-byte check is app-path only); see F4 for the admin gate`;
    });
  });

  test("F2-F8 admin validation, approval, rejection (UI)", async ({ page }) => {
    await uiSignIn(page, "admin");
    await scenario({ journey: J, id: "F5", scenario: "Admin queue shows the fixture's pending images with previews", role: "Super Admin", data: "/admin/marketplace/media", expected: "cards with loaded previews" }, async () => {
      const t0 = Date.now();
      await page.goto("/admin/marketplace/media?status=pending");
      const cards = page.locator("main li", { hasText: "Audit Showroom Fixture" });
      await expect(cards.first()).toBeVisible();
      const n = await cards.count();
      perf({ kind: "page-action", action: "admin media queue open", ms: Date.now() - t0 });
      return `${n} fixture cards; ${Date.now() - t0} ms`;
    }, page);
    await scenario({ journey: J, id: "F2+F4", scenario: "Server byte validation: real JPEGs valid, spoof invalid", role: "Super Admin", data: "select fixture cards → Check files", expected: "2 valid, 1 invalid (decode/signature)" }, async () => {
      const cards = page.locator("main li", { hasText: "Audit Showroom Fixture" });
      for (let i = 0; i < (await cards.count()); i++) await cards.nth(i).locator('input[type="checkbox"]').check();
      const t0 = Date.now();
      await page.getByRole("button", { name: "فحص الملفات" }).click();
      await expect(page.getByText(/تمت معالجة/)).toBeVisible({ timeout: 30_000 });
      perf({ kind: "action", action: "admin byte-validate 3 images (UI)", ms: Date.now() - t0 });
      const imgs = await images();
      const spoof = imgs.find((x) => x.id === JSON.parse(readFileSync(FIX, "utf8")).spoofImageId);
      const valid = imgs.filter((x) => x.content_valid === true).length;
      if (spoof && spoof.content_valid !== false) throw new Error("spoof not marked invalid");
      return `${(await page.getByText(/تمت معالجة/).innerText()).slice(0, 90)}; valid=${valid}, spoof valid=${spoof?.content_valid}`;
    }, page);
    await scenario({ journey: J, id: "F7", scenario: "Rejection requires a reason", role: "Super Admin", data: "empty reason", expected: "Reject disabled" }, async () => {
      await expect(page.getByRole("button", { name: "رفض المحدد" })).toBeDisabled();
      return "Reject disabled until a reason is typed";
    }, page);
    await scenario({ journey: J, id: "F6+F4b", scenario: "Approve the two valid images; spoof cannot be approved; reject spoof with reason", role: "Super Admin", data: "fixture images", expected: "2 verified; spoof rejected with reason" }, async () => {
      const spoofId = JSON.parse(readFileSync(FIX, "utf8")).spoofImageId as string | undefined;
      const adm = await adminUserClient();
      if (spoofId) {
        const { data } = await adm.rpc("admin_marketplace_media_approve", { p_image_ids: [spoofId] });
        const res = (data as { result: string }[])[0]?.result;
        if (res === "approved") throw new Error("SPOOF APPROVED");
      }
      // approve the valid ones through the UI
      await page.reload();
      const cards = page.locator("main li", { hasText: "Audit Showroom Fixture" });
      for (let i = 0; i < (await cards.count()); i++) {
        const valid = (await cards.nth(i).innerText()).includes("ملف سليم");
        if (valid) await cards.nth(i).locator('input[type="checkbox"]').check();
      }
      const t0 = Date.now();
      await page.getByRole("button", { name: "اعتماد المحدد" }).click();
      await expect(page.getByText(/تمت معالجة/)).toBeVisible({ timeout: 30_000 });
      perf({ kind: "action", action: "admin approve 2 images (re-validates bytes first)", ms: Date.now() - t0 });
      if (spoofId) {
        const { error } = await adm.rpc("admin_marketplace_media_reject", { p_image_ids: [spoofId], p_reason: "Audit: not an image file" });
        if (error) throw new Error(error.message);
      }
      const imgs = await images();
      return `statuses: ${imgs.map((x) => x.status).join(", ")}`;
    }, page);
    await scenario({ journey: J, id: "F8", scenario: "Moderation audit trail", role: "Super Admin", data: "marketplace_image_moderation_events", expected: "validated / approved / rejected events with actor" }, async () => {
      const { data } = await admin.from("marketplace_image_moderation_events").select("action, actor_user_id").eq("product_id", PID);
      const acts = (data ?? []).map((x) => x.action);
      for (const a of ["validated", "approved", "rejected"]) expect(acts).toContain(a);
      expect((data ?? []).every((x) => x.actor_user_id)).toBe(true);
      return `${acts.length} events: ${[...new Set(acts)].join(", ")}`;
    });
  });

  test("F9-F13 publication, public visibility and revocation", async () => {
    const c = await fixtureClient(f.showroomUserId);
    const adm = await adminUserClient();
    const verified = (await images()).filter((x) => x.status === "verified");
    const cover = verified.find((x) => x.is_primary) ?? verified[0]!;
    await scenario({ journey: J, id: "F9", scenario: "Image of a DRAFT product is not public even when verified", role: "anonymous", data: "/marketplace/media/<verified id>", expected: "404 no-store" }, async () => {
      const r = await media(cover.id);
      expect(r.status).toBe(404);
      return `${r.status} (${r.cache})`;
    });
    await scenario({ journey: J, id: "F10a", scenario: "Publish once nothing blocks", role: "fixture owner", data: "marketplace_product_publish", expected: "published" }, async () => {
      const ready = (await c.rpc("marketplace_seller_product_readiness", { p_product_id: PID })).data as string[];
      if (ready.length) throw new Error(`still blocked: ${ready.join(", ")}`);
      const t0 = Date.now();
      const { error } = await c.rpc("marketplace_product_publish", { p_product_id: PID });
      if (error) throw new Error(error.message);
      perf({ kind: "rpc", action: "marketplace_product_publish", ms: Date.now() - t0 });
      save({ fixturePublished: true });
      return "published";
    });
    await scenario({ journey: J, id: "F10b", scenario: "Published product's approved image is served publicly (bytes only)", role: "anonymous", data: "media route", expected: "200 image/jpeg, no-store" }, async () => {
      const r = await media(cover.id);
      expect(r.status).toBe(200);
      return `${r.status} ${r.type} ${r.bytes} B, cache=${r.cache}`;
    });
    await scenario({ journey: J, id: "F10c", scenario: "Anonymous direct storage read still denied", role: "anonymous", data: "storage download of the key", expected: "denied" }, async () => {
      const { error } = await anon().storage.from("marketplace-product-images").download(cover.object_key);
      if (!error) throw new Error("anonymous direct download allowed");
      return "denied";
    });
    await scenario({ journey: J, id: "E8", scenario: "Suspended seller disappears from the public catalogue immediately", role: "Super Admin → anonymous", data: "suspend fixture seller", expected: "catalog total drops; media 404; reinstate restores" }, async () => {
      const before = ((await anon().rpc("marketplace_public_catalog_page", {})).data as { total: number }).total;
      await adm.rpc("admin_marketplace_seller_suspend", { p_organization_id: f.fixtureOrgId, p_reason: "Audit: suspension visibility test" });
      const during = ((await anon().rpc("marketplace_public_catalog_page", {})).data as { total: number }).total;
      const m = await media(cover.id);
      await adm.rpc("admin_marketplace_seller_reinstate", { p_organization_id: f.fixtureOrgId, p_reason: "Audit: reinstate after visibility test" });
      const after = ((await anon().rpc("marketplace_public_catalog_page", {})).data as { total: number }).total;
      expect(during).toBe(before - 1);
      expect(m.status).toBe(404);
      expect(after).toBe(before);
      return `catalog ${before} → ${during} (media ${m.status}) → ${after}`;
    });
    await scenario({ journey: J, id: "F13", scenario: "Concurrent reject-after-approval vs seller removal on the same image", role: "admin + fixture owner", data: "non-primary verified image", expected: "consistent end state; no orphan; no 500" }, async () => {
      const other = (await images()).find((x) => x.status === "verified" && x.id !== cover.id);
      if (!other) return "only one verified image — skipped";
      const [a, b] = await Promise.all([
        adm.rpc("admin_marketplace_media_reject", { p_image_ids: [other.id], p_reason: "Audit concurrency test" }),
        c.rpc("marketplace_seller_image_remove", { p_image_id: other.id }),
      ]);
      const row = (await admin.from("marketplace_product_images").select("status, upload_state").eq("id", other.id).maybeSingle()).data;
      const m = await media(other.id);
      expect(m.status).toBe(404);
      return `reject:${a.error ? a.error.code : "ok"} remove:${b.error ? b.error.code : "ok"} → row ${row ? `${row.status}/${row.upload_state}` : "gone"}; public ${m.status}`;
    });
    await scenario({ journey: J, id: "F12", scenario: "Rejecting the cover after publication unpublishes and revokes", role: "Super Admin", data: "reject cover", expected: "media 404; product unpublished (no other verified product-level image)" }, async () => {
      await adm.rpc("admin_marketplace_media_reject", { p_image_ids: [cover.id], p_reason: "Audit: revocation after approval" });
      const m = await media(cover.id);
      const { data: p } = await admin.from("marketplace_products").select("status").eq("id", PID).single();
      expect(m.status).toBe(404);
      return `media ${m.status}; product ${p?.status}`;
    });
    await scenario({ journey: J, id: "F14", scenario: "Owner cannot approve its own images", role: "fixture owner", data: "admin_marketplace_media_approve", expected: "refused" }, async () => {
      const { error } = await c.rpc("admin_marketplace_media_approve", { p_image_ids: [cover.id] });
      if (!error) throw new Error("owner approved its own image");
      return `refused (${error.code})`;
    });
    void RUN;
  });
});

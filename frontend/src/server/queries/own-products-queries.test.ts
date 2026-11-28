import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getOwnProduct, listCatalog, listOwnProducts, listProductPrices, ownProductCounts } from "./commerce";
import { listCatalogImages, listProductImages, resolveProductImage, signProductImageUrls } from "./product-images";

type Call = [string, ...unknown[]];

function stub(result: { data: unknown; error: unknown }, storage?: { createSignedUrls: (keys: string[], s: number) => unknown }) {
  const calls: Call[] = [];
  const make = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "eq", "neq", "or", "is", "not", "in", "range"]) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.maybeSingle = () => Promise.resolve(result);
    b.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return b;
  };
  const from = vi.fn((relation: string) => {
    calls.push(["from", relation]);
    return make();
  });
  const rpc = vi.fn((fn: string, args: unknown) => {
    calls.push(["rpc", fn, args]);
    return make();
  });
  return { supabase: { from, rpc, storage: { from: () => storage } } as never, calls };
}

describe("own product queries", () => {
  it("hides archived products from production callers by default", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listOwnProducts(supabase, "org-1", {});
    expect(calls).toContainEqual(["is", "archived_at", null]);
  });

  it("shows archived products only when the management page asks", async () => {
    const only = stub({ data: [], error: null });
    await listOwnProducts(only.supabase, "org-1", { archived: "only" });
    expect(only.calls).toContainEqual(["not", "archived_at", "is", null]);
    const all = stub({ data: [], error: null });
    await listOwnProducts(all.supabase, "org-1", { archived: "include" });
    expect(all.calls.some((c) => c[1] === "archived_at")).toBe(false);
  });

  it("always scopes to the organization and never to deleted rows", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listOwnProducts(supabase, "org-1", { archived: "include" });
    expect(calls).toContainEqual(["eq", "organization_id", "org-1"]);
    expect(calls).toContainEqual(["is", "deleted_at", null]);
  });

  it("filters by canonical category, and 'unclassified' means no canonical category at all", async () => {
    const a = stub({ data: [], error: null });
    await listOwnProducts(a.supabase, "org-1", { categoryCode: "paints" });
    expect(a.calls).toContainEqual(["eq", "category_code", "paints"]);
    const b = stub({ data: [], error: null });
    await listOwnProducts(b.supabase, "org-1", { categoryCode: "unclassified" });
    expect(b.calls).toContainEqual(["is", "category_code", null]);
  });

  it("sorts by recently updated by default, and only by the columns the page defines", async () => {
    const dflt = stub({ data: [], error: null });
    await listOwnProducts(dflt.supabase, "org-1", {});
    expect(dflt.calls).toContainEqual(["order", "updated_at", { ascending: false }]);
    const newest = stub({ data: [], error: null });
    await listOwnProducts(newest.supabase, "org-1", { sort: "newest" });
    expect(newest.calls).toContainEqual(["order", "created_at", { ascending: false }]);
    const name = stub({ data: [], error: null });
    await listOwnProducts(name.supabase, "org-1", { sort: "name" });
    expect(name.calls).toContainEqual(["order", "name", { ascending: true }]);
  });

  it("counts archived products apart and never as drafts", async () => {
    const rows = [
      { status: "published", archived_at: null },
      { status: "draft", archived_at: null },
      { status: "draft", archived_at: "2026-10-08T00:00:00Z" },
    ];
    const { supabase } = stub({ data: rows, error: null });
    expect(await ownProductCounts(supabase, "org-1")).toEqual({ total: 2, published: 1, draft: 1, archived: 1 });
  });

  it("opens a product only for its owning organization", async () => {
    const { supabase, calls } = stub({ data: null, error: null });
    expect(await getOwnProduct(supabase, "org-1", "p1")).toBeNull();
    expect(calls).toContainEqual(["eq", "id", "p1"]);
    expect(calls).toContainEqual(["eq", "organization_id", "org-1"]);
  });

  it("matches the public catalog by canonical code without disturbing the legacy filter", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, "org-1", { categoryCode: "paints" });
    expect(calls).toContainEqual(["eq", "category_code", "paints"]);
    expect(calls.some((c) => c[0] === "eq" && c[1] === "category")).toBe(false);
  });
});

describe("product image queries", () => {
  it("groups ready images per product in display order", async () => {
    const { supabase, calls } = stub({
      data: [
        { id: "i1", product_id: "p1", object_key: "k1", slot: 1 },
        { id: "i2", product_id: "p1", object_key: "k2", slot: 2 },
        { id: "i3", product_id: "p2", object_key: "k3", slot: 1 },
      ],
      error: null,
    });
    const map = await listProductImages(supabase, ["p1", "p2"]);
    expect(map.get("p1")?.map((i) => i.objectKey)).toEqual(["k1", "k2"]);
    expect(map.get("p2")?.[0]).toEqual({ id: "i3", objectKey: "k3", slot: 1 });
    expect(calls).toContainEqual(["eq", "state", "ready"]);
    expect(calls).toContainEqual(["order", "slot", { ascending: true }]);
  });

  it("does not query for an empty list", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    expect((await listProductImages(supabase, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("returns application identifiers only for keys authorized with the caller's own identity", async () => {
    const createSignedUrls = vi.fn();
    const { supabase, calls } = stub({ data: ["a", "b"], error: null }, { createSignedUrls });
    const urls = await signProductImageUrls(supabase, ["a", null, "a", "b", undefined]);
    expect(calls[0]).toEqual(["rpc", "organization_media_read_keys", { p_namespace: "product", p_keys: ["a", "b"], p_workspace: undefined }]);
    expect(createSignedUrls).not.toHaveBeenCalled();
    expect([...urls.entries()]).toEqual([["a", "/api/media/product?key=a"], ["b", "/api/media/product?key=b"]]);
  });

  it("leaves out a key that could not be signed instead of failing the page", async () => {
    const createSignedUrls = vi.fn(async () => ({
      data: [{ path: "a", signedUrl: null, error: "Object not found" }, { path: "b", signedUrl: "https://signed/b", error: null }],
      error: null,
    }));
    const { supabase } = stub({ data: ["b"], error: null }, { createSignedUrls });
    expect([...(await signProductImageUrls(supabase, ["a", "b"])).keys()]).toEqual(["b"]);
    const failing = stub({ data: null, error: new Error("authorization unavailable") });
    expect((await signProductImageUrls(failing.supabase, ["a"])).size).toBe(0);
  });

  it("another organization's images are signed only after the ACTIVE workspace is granted them", async () => {
    const createSignedUrls = vi.fn(async (keys: string[]) => ({ data: keys.map((k) => ({ path: k, signedUrl: `https://signed/${k}`, error: null })), error: null }));
    const { supabase, calls } = stub({ data: ["a"], error: null }, { createSignedUrls });
    const urls = await signProductImageUrls(supabase, ["a"], { orgId: "org-1" });
    expect(calls[0]).toEqual(["rpc", "organization_media_read_keys", { p_namespace: "product", p_workspace: "org-1", p_keys: ["a"] }]);
    expect(urls.get("a")).toBe("/api/media/product?key=a&workspace=org-1");
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("signs nothing when the grant is refused (not a member / not targeted) - the card falls back to its placeholder", async () => {
    const createSignedUrls = vi.fn();
    const { supabase } = stub({ data: null, error: { code: "42501", message: "not a member of this organization" } }, { createSignedUrls });
    expect((await signProductImageUrls(supabase, ["a"], { orgId: "org-x" })).size).toBe(0);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("authorizes in batches of60 and rechecks own images without minting bearer grants", async () => {
    const createSignedUrls = vi.fn(async (keys: string[]) => ({ data: keys.map((k) => ({ path: k, signedUrl: `u/${k}`, error: null })), error: null }));
    const many = Array.from({ length: 130 }, (_, i) => `k${i}`);
    const viewer = stub({ data: [], error: null }, { createSignedUrls });
    await signProductImageUrls(viewer.supabase, many, { orgId: "org-1" });
    expect(viewer.calls.filter((c) => c[0] === "rpc").map((c) => ((c[2] as { p_keys: string[] }).p_keys.length))).toEqual([60, 60, 10]);
    const own = stub({ data: [], error: null }, { createSignedUrls });
    await signProductImageUrls(own.supabase, ["a"]);
    expect(own.calls[0]).toEqual(["rpc", "organization_media_read_keys", { p_namespace: "product", p_keys: ["a"], p_workspace: undefined }]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("with edge delivery on, only R2 keys get media-Worker URLs; Supabase keys keep the proxy", async () => {
    vi.stubEnv("MEDIA_EDGE_DELIVERY_ENABLED", "true");
    vi.stubEnv("MEDIA_EDGE_ORIGIN", "https://media.example.test");
    vi.stubEnv("MEDIA_EDGE_TICKET_KID", "k1");
    vi.stubEnv("MEDIA_EDGE_TICKET_SECRET", "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8");
    try {
      const { supabase, calls } = stub({ data: { a: "r2", b: "supabase" }, error: null });
      (supabase as { auth?: unknown }).auth = { getClaims: async () => ({ data: { claims: {
        sub: "70000003-0000-4000-8000-000000000003", session_id: "e9000000-0000-4000-8000-000000000002", role: "authenticated", exp: 4_000_000_000 } }, error: null }) };
      const urls = await signProductImageUrls(supabase, ["a", "b"], { orgId: "9d000000-dddd-4ddd-8ddd-000000000002" });
      expect(calls[0]).toEqual(["rpc", "organization_media_read_providers", { p_namespace: "product", p_keys: ["a", "b"], p_workspace: "9d000000-dddd-4ddd-8ddd-000000000002" }]);
      expect(urls.get("a")).toMatch(/^https:\/\/media\.example\.test\/m\/product\/original\?t=k1\./);
      expect(urls.get("b")).toBe("/api/media/product?key=b&workspace=9d000000-dddd-4ddd-8ddd-000000000002");
    } finally { vi.unstubAllEnvs(); }
  });

  it("lists another organization's gallery through the workspace-aware reader, never the table", async () => {
    const { supabase, calls } = stub({ data: [{ product_id: "p1", id: "i1", object_key: "k1", slot: 1 }], error: null });
    const map = await listCatalogImages(supabase, "org-1", ["p1"]);
    expect(map.get("p1")).toEqual([{ id: "i1", objectKey: "k1", slot: 1 }]);
    expect(calls[0]).toEqual(["rpc", "catalog_product_images", { p_org_id: "org-1", p_product_ids: ["p1"] }]);
    expect(calls.some((c) => c[0] === "from")).toBe(false);
  });

  it("shows the uploaded primary photo, else the legacy reference, else nothing", () => {
    const signed = new Map([["k1", "https://signed/k1"]]);
    expect(resolveProductImage({ primary_image_key: "k1", image_ref: "https://legacy/x.png" }, signed)).toBe("https://signed/k1");
    expect(resolveProductImage({ primary_image_key: "k2", image_ref: "https://legacy/x.png" }, signed)).toBe("https://legacy/x.png");
    expect(resolveProductImage({ primary_image_key: null, image_ref: "https://legacy/x.png" }, signed)).toBe("https://legacy/x.png");
    expect(resolveProductImage({ primary_image_key: null, image_ref: null }, signed)).toBeNull();
  });
});

describe("private product prices", () => {
  it("reads prices from the owner-only table, never from the public products row", async () => {
    const { supabase, calls } = stub({ data: [{ product_id: "p1", base_price: "159.50" }], error: null });
    const prices = await listProductPrices(supabase, ["p1", "p2"]);
    expect(calls).toContainEqual(["from", "product_prices"]);
    expect(calls).not.toContainEqual(["from", "products"]);
    expect(prices.get("p1")).toBe(159.5);
    expect(prices.has("p2")).toBe(false);
  });

  it("does not query at all for an empty list", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    expect((await listProductPrices(supabase, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("browse excludes the active organization's own products", () => {
  it("filters its own organization out in the query itself", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, "org-active", { excludeOrgId: "org-active" });
    expect(calls).toContainEqual(["rpc", "catalog_products", { p_org_id: "org-active" }]);
    expect(calls).toContainEqual(["neq", "organization_id", "org-active"]);
  });

  it("switching workspace changes the excluded organization", async () => {
    const a = stub({ data: [], error: null });
    const b = stub({ data: [], error: null });
    await listCatalog(a.supabase, "org-a", { excludeOrgId: "org-a" });
    await listCatalog(b.supabase, "org-b", { excludeOrgId: "org-b" });
    expect(a.calls).toContainEqual(["neq", "organization_id", "org-a"]);
    expect(b.calls).toContainEqual(["neq", "organization_id", "org-b"]);
    expect(b.calls).not.toContainEqual(["neq", "organization_id", "org-a"]);
  });

  it("does not filter when no organization is given (production catalog keeps its behavior)", async () => {
    const { supabase, calls } = stub({ data: [], error: null });
    await listCatalog(supabase, "org-1", {});
    expect(calls.some((c) => c[0] === "neq")).toBe(false);
  });
});

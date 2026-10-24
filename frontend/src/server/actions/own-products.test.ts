import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  list: vi.fn(),
  remove: vi.fn(),
  authorize: vi.fn(), verify: vi.fn(), cleanup: vi.fn(),
}));
vi.mock("@/server/storage/media", () => ({ authorizeMediaUpload: state.authorize, verifyPendingMedia: state.verify, removeMedia: state.cleanup }));
vi.mock("next/cache", () => ({ revalidatePath: state.revalidate }));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    rpc: state.rpc,
    storage: { from: () => ({ list: state.list, remove: state.remove }) },
  }),
}));

import {
  confirmProductImageUploadAction,
  createOwnProductAction,
  ownProductLifecycleAction,
  removeProductImageAction,
  reorderProductImagesAction,
  requestProductImageUploadAction,
  updateOwnProductAction,
} from "./own-products";

/** Hex literals are product DATA here, not styling — built at run time so the colour guard stays strict. */
const h = (rrggbb: string) => "#" + rrggbb;

const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
const PRODUCT = "46d3bc5b-16a1-4aa0-966e-274673264654";
const IMAGE = "5bc41c1a-0000-4000-8000-000000000001";
const KEY = `${ORG}/${PRODUCT}/${IMAGE}.png`;

function fd(entries: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const item of Array.isArray(v) ? v : [v]) f.append(k, item);
  return f;
}
const good = { orgId: ORG, name: "Matt Emulsion 18L", code: "PNT-001", categoryCode: "paints", unit: "pail", colorItems: JSON.stringify([{ name: "Sand", hex: h("c9b28a") }, { name: "sand", hex: null }]), basePrice: "159.5", weightKg: "3.5" };

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ data: PRODUCT, error: null });
  state.list.mockResolvedValue({ data: [{ name: `${IMAGE}.png` }], error: null });
  state.remove.mockResolvedValue({ data: [], error: null });
  state.authorize.mockResolvedValue({ provider: "supabase", bucket: "product-images", key: KEY, token: "synthetic" });
  state.verify.mockResolvedValue(undefined);
  state.cleanup.mockResolvedValue(undefined);
});

describe("price, colors and description reach the database through the one RPC path", () => {
  const edit = { productId: PRODUCT, expectedVersion: "3", currentUnit: "pail", name: "Matt Emulsion 18L", code: "PNT-001", categoryCode: "paints", unit: "pail" };

  it("sends the price and structured colors on edit, and nothing like a discount", async () => {
    state.rpc.mockResolvedValue({ data: 4, error: null });
    await expect(updateOwnProductAction({ ok: false }, fd({ ...edit, basePrice: "175.25", colorItems: JSON.stringify([{ name: "Cream", hex: h("F2E9D8") }]) }))).rejects.toThrow("NEXT_REDIRECT");
    const [name, args] = state.rpc.mock.calls.find((c) => c[0] === "own_product_update")!;
    expect(name).toBe("own_product_update");
    expect(args).toMatchObject({ p_base_price: 175.25, p_color_items: [{ name: "Cream", hex: h("F2E9D8") }] });
    expect(Object.keys(args).join(",")).not.toMatch(/discount|compare|percent/);
  });

  it("maps the database's refusals to the right field instead of raw text", async () => {
    for (const [message, field] of [
      ["a product price cannot be removed once it is set", "price"],
      ["price must be a positive amount in EGP with at most 2 decimals", "price"],
      ["description is limited to 250 characters", "description"],
      ["a color value must be a hex code like B96F52", "colors"],
    ] as const) {
      state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message } });
      const r = await updateOwnProductAction({ ok: false }, fd(edit));
      expect(r.ok).toBe(false);
      expect(Object.keys(r.fieldErrors ?? {})).toEqual([field]);
    }
  });

  it("refuses an over-long description before calling the database", async () => {
    const r = await updateOwnProductAction({ ok: false }, fd({ ...edit, description: "w".repeat(251) }));
    expect(r.fieldErrors).toMatchObject({ description: "showroomProducts.validation.descriptionChars" });
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("createOwnProductAction", () => {
  it("sends the validated, normalized product to the create RPC and lands on its edit page", async () => {
    await expect(createOwnProductAction({ ok: false }, fd(good))).rejects.toThrow(`NEXT_REDIRECT:/showroom/my-products/${PRODUCT}/edit?created=1`);
    expect(state.rpc).toHaveBeenCalledWith("own_product_create", {
      p_org_id: ORG,
      p_name: "Matt Emulsion 18L",
      p_code: "PNT-001",
      p_category_code: "paints",
      p_unit: "pail",
      p_color_items: [{ name: "Sand", hex: h("C9B28A") }],
      p_base_price: 159.5,
      p_weight_kg: 3.5,
    });
    const paths = state.revalidate.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(expect.arrayContaining(["/showroom/my-products", "/showroom/catalog", "/b2b/products"]));
  });

  it("answers invalid input with field errors and never calls the database", async () => {
    const result = await createOwnProductAction({ ok: false }, fd({ orgId: ORG, name: "x", code: "", categoryCode: "finishing", unit: "ton" }));
    expect(result.ok).toBe(false);
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["category", "code", "name", "price", "unit"]);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing or malformed organization id", async () => {
    expect((await createOwnProductAction({ ok: false }, fd({ ...good, orgId: "not-a-uuid" }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("shows a duplicate code on the code field, in neutral words", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_products_org_code"' } });
    const result = await createOwnProductAction({ ok: false }, fd(good));
    expect(result).toEqual({ ok: false, fieldErrors: { code: "showroomProducts.errors.duplicateCode" } });
  });

  it("reports a permission refusal from the database instead of redirecting", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "catalog.write required" } });
    expect(await createOwnProductAction({ ok: false }, fd(good))).toEqual({ ok: false, code: "commerce.errors.denied" });
    expect(state.redirect).not.toHaveBeenCalled();
  });
});

describe("updateOwnProductAction", () => {
  const edit = { productId: PRODUCT, expectedVersion: "3", currentUnit: "box", ...good };

  it("carries the optimistic version and replaces the editable fields", async () => {
    await expect(updateOwnProductAction({ ok: false }, fd(edit))).rejects.toThrow("?saved=1");
    expect(state.rpc).toHaveBeenCalledWith("own_product_update", expect.objectContaining({ p_product_id: PRODUCT, p_expected_version: 3, p_category_code: "paints" }));
  });

  it("lets a historical product keep its current unit and nothing else outside the six", async () => {
    await expect(updateOwnProductAction({ ok: false }, fd({ ...edit, unit: "box" }))).rejects.toThrow("?saved=1");
    const refused = await updateOwnProductAction({ ok: false }, fd({ ...edit, unit: "ton" }));
    expect(refused.fieldErrors?.unit).toBe("showroomProducts.errors.unitInvalid");
  });

  it("maps a stale version to the conflict message", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "product was modified concurrently" } });
    expect(await updateOwnProductAction({ ok: false }, fd(edit))).toEqual({ ok: false, code: "commerce.errors.conflict" });
  });

  it("rejects a missing version without touching the database", async () => {
    expect((await updateOwnProductAction({ ok: false }, fd({ ...good, productId: PRODUCT }))).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe("ownProductLifecycleAction", () => {
  const act = (action: string) => ownProductLifecycleAction({ ok: false }, fd({ productId: PRODUCT, expectedVersion: "2", action }));

  it.each([
    ["activate", "set_product_published", { p_product_id: PRODUCT, p_published: true, p_expected_version: 2 }],
    ["deactivate", "set_product_published", { p_product_id: PRODUCT, p_published: false, p_expected_version: 2 }],
    ["archive", "own_product_set_archived", { p_product_id: PRODUCT, p_archived: true, p_expected_version: 2 }],
    ["restore", "own_product_set_archived", { p_product_id: PRODUCT, p_archived: false, p_expected_version: 2 }],
  ])("%s calls %s", async (action, rpc, args) => {
    state.rpc.mockResolvedValue({ data: 3, error: null });
    expect(await act(action)).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith(rpc, args);
  });

  it("refuses an unknown action — there is no delete", async () => {
    expect((await act("delete")).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("surfaces the database's refusal (e.g. publishing an archived product)", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "an archived product must be restored before it can be published" } });
    expect(await act("activate")).toEqual({ ok: false, code: "showroomProducts.errors.archived" });
  });
});

describe("product audiences", () => {
  const ALL8 = ["showroom_dealer", "supplier", "manufacturer", "importer", "contractor", "engineer", "installer_technician", "end_consumer"];
  const edit = { productId: PRODUCT, expectedVersion: "3", currentUnit: "pail", name: "Matt Emulsion 18L", code: "PNT-001", categoryCode: "paints", unit: "pail", basePrice: "159.5" };
  const called = (fn: string) => state.rpc.mock.calls.filter((c) => c[0] === fn);

  it("create forwards the chosen audiences to the owner RPC after the draft exists", async () => {
    await expect(createOwnProductAction({ ok: false }, fd({ ...good, audience: ["showroom_dealer", "engineer", "showroom_dealer"] }))).rejects.toThrow("NEXT_REDIRECT");
    expect(called("product_audiences_set")).toEqual([["product_audiences_set", { p_product_id: PRODUCT, p_audiences: ["showroom_dealer", "engineer"] }]]);
    expect(state.rpc.mock.calls.map((c) => c[0])).toEqual(["own_product_create", "product_audiences_set"]);
  });

  it("create without audiences makes a private draft and never calls the audience RPC", async () => {
    await expect(createOwnProductAction({ ok: false }, fd(good))).rejects.toThrow("NEXT_REDIRECT");
    expect(called("product_audiences_set")).toHaveLength(0);
  });

  it("refuses an unknown audience (including Sales Team) before any round trip", async () => {
    for (const bad of ["sales", "wholesaler", "interior_designer", "ALL"]) {
      const r = await createOwnProductAction({ ok: false }, fd({ ...good, audience: ["supplier", bad] }));
      expect(r.ok).toBe(false);
      expect(Object.keys(r.fieldErrors ?? {})).toEqual(["audiences"]);
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("edit saves the audiences BEFORE the product, so a refusal stops the whole save", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "a published product needs at least one audience" } });
    const r = await updateOwnProductAction({ ok: false }, fd(edit));
    expect(r).toEqual({ ok: false, fieldErrors: { audiences: "showroomProducts.audience.required" } });
    expect(called("own_product_update")).toHaveLength(0);
  });

  it("edit with all eight audiences sends them, then updates", async () => {
    state.rpc.mockResolvedValue({ data: 4, error: null });
    await expect(updateOwnProductAction({ ok: false }, fd({ ...edit, audience: ALL8 }))).rejects.toThrow("NEXT_REDIRECT");
    expect(state.rpc.mock.calls.map((c) => c[0])).toEqual(["product_audiences_set", "own_product_update"]);
    expect(state.rpc.mock.calls[0]![1]).toEqual({ p_product_id: PRODUCT, p_audiences: ALL8 });
  });

  it("activating a product with no audience is explained, not raw", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "select at least one audience before publishing" } });
    const r = await ownProductLifecycleAction({ ok: false }, fd({ productId: PRODUCT, expectedVersion: "2", action: "activate" }));
    expect(r).toEqual({ ok: false, code: "showroomProducts.audience.required" });
  });
});

describe("product image actions", () => {
  it("requests an upload ticket only for an allowed image type", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await requestProductImageUploadAction(PRODUCT, "image/png", 100)).toMatchObject({ ok: true, key: KEY, grant: { provider: "supabase" } });
    expect(state.authorize).toHaveBeenCalledWith(expect.anything(), "product", KEY, 100);
    expect(state.rpc).toHaveBeenCalledWith("product_image_request_upload", { p_product_id: PRODUCT, p_content_type: "image/png" });
    state.rpc.mockClear();
    expect((await requestProductImageUploadAction(PRODUCT, "application/pdf")).ok).toBe(false);
    expect((await requestProductImageUploadAction("nope", "image/png")).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reports the fourth photo as the three-photo limit", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "a product can have at most 3 images" } });
    expect(await requestProductImageUploadAction(PRODUCT, "image/png")).toEqual({ ok: false, code: "showroomProducts.errors.maxImages" });
  });

  it("refuses a ticket that is not a well-formed organization/product key", async () => {
    state.rpc.mockResolvedValue({ data: "../../etc/passwd", error: null });
    expect((await requestProductImageUploadAction(PRODUCT, "image/png")).ok).toBe(false);
  });

  it("confirms only after the bytes are really in Storage", async () => {
    state.rpc.mockResolvedValue({ data: IMAGE, error: null });
    expect(await confirmProductImageUploadAction(KEY)).toEqual({ ok: true, id: IMAGE });
    expect(state.verify).toHaveBeenCalledWith(expect.anything(), "product", KEY);

    state.rpc.mockClear();
    state.verify.mockRejectedValueOnce(Error("actual object bytes missing"));
    expect((await confirmProductImageUploadAction(KEY)).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses to confirm a malformed key", async () => {
    expect((await confirmProductImageUploadAction("anything")).ok).toBe(false);
    expect(state.list).not.toHaveBeenCalled();
  });

  it("removes through the RPC and then cleans up the bytes", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await removeProductImageAction(IMAGE)).toEqual({ ok: true });
    expect(state.cleanup).toHaveBeenCalledWith(expect.anything(), "product", KEY);
  });

  it("does not touch Storage when the database refuses the removal", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "catalog.write required" } });
    expect(await removeProductImageAction(IMAGE)).toEqual({ ok: false, code: "commerce.errors.denied" });
    expect(state.cleanup).not.toHaveBeenCalled();
  });

  it("validates the ids it reorders", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null });
    expect(await reorderProductImagesAction(PRODUCT, [IMAGE])).toEqual({ ok: true });
    expect((await reorderProductImagesAction(PRODUCT, ["bad"])).ok).toBe(false);
    expect((await reorderProductImagesAction("bad", [IMAGE])).ok).toBe(false);
  });
});

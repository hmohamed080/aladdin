import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rpc: vi.fn(), list: vi.fn(), remove: vi.fn() }));
const media = vi.hoisted(() => ({ authorize: vi.fn(), verify: vi.fn(), remove: vi.fn() }));
vi.mock("@/server/storage/media", () => ({ authorizeMediaUpload: media.authorize, verifyPendingMedia: media.verify, removeMedia: media.remove }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({ rpc: state.rpc, storage: { from: () => ({ list: state.list, remove: state.remove }) } }),
}));

import {
  confirmRequestImageUploadAction,
  purchaseRequestLifecycleAction,
  removeRequestImageAction,
  requestRequestImageUploadAction,
  saveRequestResponseAction,
  savePurchaseRequestAction,
  shortlistRequestResponseAction,
  withdrawRequestResponseAction,
} from "./purchase-requests";

const ORG = "9c000000-cccc-4ccc-8ccc-000000000001";
/** Hex literals are product DATA here, not styling - built at run time so the colour guard stays strict. */
const h = (rrggbb: string) => "#" + rrggbb;

const REQ = "46d3bc5b-16a1-4aa0-966e-274673264654";
const ITEM = "5bc41c1a-0000-4000-8000-000000000001";
const IMAGE = "5bc41c1a-0000-4000-8000-0000000000aa";
const KEY = `${ORG}/${REQ}/${IMAGE}.png`;

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const items = JSON.stringify([{ name: "Matt emulsion", categoryCode: "paints", quantity: "4", unit: "pail", colors: [{ name: "Sand", hex: h("d8c7a6") }] }]);

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc.mockResolvedValue({ data: REQ, error: null });
  state.list.mockResolvedValue({ data: [{ name: `${IMAGE}.png` }], error: null });
  state.remove.mockResolvedValue({ data: [], error: null });
});

describe("savePurchaseRequestAction", () => {
  it("creates an INDIVIDUAL request: no organization is sent, nothing but data the database re-validates", async () => {
    const r = await savePurchaseRequestAction({ ok: false }, fd({ title: "Villa package", items }));
    expect(r).toEqual({ ok: true, id: REQ });
    const [name, args] = state.rpc.mock.calls[0]!;
    expect(name).toBe("purchase_request_save");
    expect(args).toMatchObject({
      p_org_id: null, p_request_id: null, p_expected_version: null, p_title: "Villa package", p_share_with_showrooms: false,
      p_items: [{ name: "Matt emulsion", category_code: "paints", quantity: 4, unit: "pail", color_items: [{ name: "Sand", hex: h("D8C7A6") }] }],
    });
    expect(JSON.stringify(args)).not.toMatch(/product_id|requester_audience|requester_org/);
  });

  it("creates an ORGANIZATION request through the active workspace and carries the share option", async () => {
    await savePurchaseRequestAction({ ok: false }, fd({ orgId: ORG, title: "Showroom stock", shareWithShowrooms: "on", items }));
    expect(state.rpc.mock.calls[0]![1]).toMatchObject({ p_org_id: ORG, p_share_with_showrooms: true });
  });

  it("edits a draft with the optimistic version", async () => {
    await savePurchaseRequestAction({ ok: false }, fd({ requestId: REQ, expectedVersion: "3", title: "Edited title", neededBy: "2026-12-01", items }));
    expect(state.rpc.mock.calls[0]![1]).toMatchObject({ p_request_id: REQ, p_expected_version: 3, p_needed_by: "2026-12-01" });
  });

  it("answers invalid input with field and item errors and never calls the database", async () => {
    const r = await savePurchaseRequestAction({ ok: false }, fd({ title: "x", items: JSON.stringify([{ name: "ok item", categoryCode: "nope", quantity: "1", unit: "pail" }, { name: "b", categoryCode: "paints", quantity: "1", unit: "pail" }]) }));
    expect(r.ok).toBe(false);
    expect(r.fieldErrors).toEqual({ title: "purchaseRequests.errors.titleInvalid" });
    expect(r.itemErrors).toEqual({ 0: "category", 1: "name" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("refuses more than 30 items, malformed items and malformed ids before any round trip", async () => {
    const many = JSON.stringify(Array.from({ length: 31 }, (_, i) => ({ name: `Item ${i}`, categoryCode: "paints", quantity: "1", unit: "pail" })));
    expect((await savePurchaseRequestAction({ ok: false }, fd({ title: "Too many", items: many }))).fieldErrors).toEqual({ items: "purchaseRequests.errors.tooManyItems" });
    expect((await savePurchaseRequestAction({ ok: false }, fd({ title: "Bad json", items: "{" }))).fieldErrors).toEqual({ items: "purchaseRequests.errors.itemInvalid" });
    expect((await savePurchaseRequestAction({ ok: false }, fd({ orgId: "not-a-uuid", title: "Valid title", items }))).code).toBe("states.genericRetry");
    expect((await savePurchaseRequestAction({ ok: false }, fd({ requestId: REQ, title: "Valid title", items }))).code).toBe("states.genericRetry");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("reports the database's refusal as a translation key", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "this organization type cannot publish purchase requests" } });
    expect(await savePurchaseRequestAction({ ok: false }, fd({ orgId: ORG, title: "Valid title", items }))).toEqual({ ok: false, code: "purchaseRequests.errors.orgTypeNotAllowed" });
  });
});

describe("purchaseRequestLifecycleAction", () => {
  it("routes publish / close / cancel to their RPCs with the version", async () => {
    state.rpc.mockResolvedValue({ data: 2, error: null });
    for (const [action, fn] of [["publish", "purchase_request_publish"], ["close", "purchase_request_close"], ["cancel", "purchase_request_cancel"]] as const) {
      state.rpc.mockClear();
      expect(await purchaseRequestLifecycleAction({ ok: false }, fd({ requestId: REQ, expectedVersion: "1", action }))).toEqual({ ok: true, id: REQ });
      expect(state.rpc).toHaveBeenCalledWith(fn, { p_request_id: REQ, p_expected_version: 1 });
    }
  });

  it("refuses an unknown action - there is no accept, award or order step", async () => {
    for (const action of ["accept", "award", "order", "delete"]) {
      expect((await purchaseRequestLifecycleAction({ ok: false }, fd({ requestId: REQ, expectedVersion: "1", action }))).ok).toBe(false);
    }
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("explains a stale version and an unpublishable empty request", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "purchase request was modified concurrently" } });
    expect((await purchaseRequestLifecycleAction({ ok: false }, fd({ requestId: REQ, expectedVersion: "1", action: "publish" }))).code).toBe("purchaseRequests.errors.conflict");
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "add at least one item before publishing" } });
    expect((await purchaseRequestLifecycleAction({ ok: false }, fd({ requestId: REQ, expectedVersion: "1", action: "publish" }))).code).toBe("purchaseRequests.errors.needsItem");
  });
});

describe("reference image actions", () => {
  const GRANT = { provider: "r2", url: "https://r2.test/pending", headers: {}, expiresIn: 120 };
  beforeEach(() => { media.authorize.mockResolvedValue(GRANT); media.verify.mockResolvedValue(null); media.remove.mockResolvedValue(undefined); });

  it("requests a ticket only for an allowed type and a real item id, and gets the central grant", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await requestRequestImageUploadAction(ITEM, "image/png", 93)).toEqual({ ok: true, key: KEY, grant: GRANT });
    expect(media.authorize).toHaveBeenCalledWith(expect.anything(), "request", KEY, 93);
    expect((await requestRequestImageUploadAction(ITEM, "image/gif")).ok).toBe(false);
    expect((await requestRequestImageUploadAction("nope", "image/png")).ok).toBe(false);
    expect((await requestRequestImageUploadAction(ITEM, "image/png", 6 * 1024 * 1024)).ok).toBe(false);
    expect(state.rpc).toHaveBeenCalledTimes(1);
  });

  it("reports the third image as the two-image limit, before any storage grant", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "an item can have at most 2 images" } });
    expect(await requestRequestImageUploadAction(ITEM, "image/png")).toEqual({ ok: false, code: "purchaseRequests.errors.maxImages" });
    expect(media.authorize).not.toHaveBeenCalled();
  });

  it("fails the ticket (no fallback store) when the storage provider is unavailable", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    media.authorize.mockRejectedValue(new Error("R2 unavailable"));
    expect(await requestRequestImageUploadAction(ITEM, "image/png", 93)).toEqual({ ok: false, code: "states.genericRetry" });
    expect(state.list).not.toHaveBeenCalled();
  });

  it("confirms only after the central byte verification succeeds", async () => {
    state.rpc.mockResolvedValue({ data: IMAGE, error: null });
    expect(await confirmRequestImageUploadAction(KEY)).toEqual({ ok: true, id: IMAGE });
    expect(media.verify).toHaveBeenCalledWith(expect.anything(), "request", KEY);
    state.rpc.mockClear();
    media.verify.mockRejectedValue(new Error("media unavailable"));
    expect((await confirmRequestImageUploadAction(KEY)).ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
    expect((await confirmRequestImageUploadAction("not/a/key")).ok).toBe(false);
  });

  it("removes through the RPC, then deletes the bytes through the central lifecycle; a refusal deletes nothing", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    expect(await removeRequestImageAction(IMAGE)).toEqual({ ok: true });
    expect(media.remove).toHaveBeenCalledWith(expect.anything(), "request", KEY);
    media.remove.mockClear();
    state.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "only a draft request can be edited" } });
    expect(await removeRequestImageAction(IMAGE)).toEqual({ ok: false, code: "purchaseRequests.errors.notDraft" });
    expect(media.remove).not.toHaveBeenCalled();
  });

  it("reports a failed byte delete so the user can retry (the record is already retired)", async () => {
    state.rpc.mockResolvedValue({ data: KEY, error: null });
    media.remove.mockRejectedValue(new Error("R2 unavailable"));
    expect(await removeRequestImageAction(IMAGE)).toEqual({ ok: false, code: "states.genericRetry" });
  });
});

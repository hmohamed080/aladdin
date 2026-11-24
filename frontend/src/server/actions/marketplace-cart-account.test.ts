import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc }) }));

import { syncMarketplaceCartAction } from "./marketplace-cart-account";

const TEST_CART_MERGE_ID = "5b2f4a52-8d0e-4f0e-9d51-6d3b8e0a1c11";
const line = { slug: "p-a", sku: "A", qty: 2 };

beforeEach(() => {
  rpc.mockReset();
  vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_ORDERING", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("syncMarketplaceCartAction", () => {
  it("does nothing while ordering is off (unset, false or anything but the exact string true)", async () => {
    for (const v of ["", "false", "TRUE", "1"]) {
      vi.stubEnv("NEXT_PUBLIC_MARKETPLACE_ORDERING", v);
      expect(await syncMarketplaceCartAction({ mode: "pull" })).toEqual({ ok: false, code: "disabled" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses malformed lines before any database call", async () => {
    const bad = [
      { slug: "Bad Slug", sku: "A", qty: 1 },
      { slug: "p-a", sku: "", qty: 1 },
      { slug: "p-a", sku: "A", qty: 0 },
      { slug: "p-a", sku: "A", qty: 1.5 },
      { slug: "p-a", sku: "A", qty: 10000 },
    ];
    for (const l of bad) {
      expect(await syncMarketplaceCartAction({ mode: "replace", lines: [l] })).toEqual({ ok: false, code: "invalid" });
    }
    expect(await syncMarketplaceCartAction({ mode: "merge", key: "not-a-uuid", lines: [line] })).toEqual({ ok: false, code: "invalid" });
    expect(await syncMarketplaceCartAction({ mode: "replace", lines: Array.from({ length: 51 }, (_, i) => ({ ...line, sku: `S${i}` })) })).toEqual({ ok: false, code: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends only slug, SKU and quantity to the merge RPC (never a price the browser might add) and returns the account cart", async () => {
    rpc.mockResolvedValue({ data: { replayed: false, merged: 1, skipped: 2, own_showroom: 1, open: true, lines: [{ slug: "p-a", sku: "A", qty: 2 }] }, error: null });
    const withPrice = { ...line, price_egp: 1 } as typeof line;
    const out = await syncMarketplaceCartAction({ mode: "merge", key: TEST_CART_MERGE_ID, lines: [withPrice] });
    expect(rpc).toHaveBeenCalledWith("marketplace_cart_merge", { p_merge_key: TEST_CART_MERGE_ID, p_lines: [line] });
    expect(out).toEqual({ ok: true, lines: [line], replayed: false, skipped: 2, ownShowroom: 1 });
  });

  it("maps the database's refusals to codes", async () => {
    const fail = (message: string) => rpc.mockResolvedValueOnce({ data: null, error: { message } });
    fail("mp:own_showroom");
    expect(await syncMarketplaceCartAction({ mode: "replace", lines: [line] })).toEqual({ ok: false, code: "own_showroom" });
    fail("mp:marketplace_closed");
    expect(await syncMarketplaceCartAction({ mode: "merge", key: TEST_CART_MERGE_ID, lines: [line] })).toEqual({ ok: false, code: "closed" });
    fail("mp:auth_required");
    expect(await syncMarketplaceCartAction({ mode: "pull" })).toEqual({ ok: false, code: "signed_out" });
    fail("boom");
    expect(await syncMarketplaceCartAction({ mode: "pull" })).toEqual({ ok: false, code: "failed" });
  });
});

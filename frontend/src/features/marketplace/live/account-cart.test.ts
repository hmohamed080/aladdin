import { beforeEach, describe, expect, it, vi } from "vitest";
import { MERGE_KEY_STORAGE, syncAccountCart, type SyncDeps } from "./account-cart";
import type { CartSyncInput, CartSyncResult } from "@/server/actions/marketplace-cart-account";
import type { StoredCartLine } from "./public-contract";

vi.mock("@/server/actions/marketplace-cart-account", () => ({ syncMarketplaceCartAction: vi.fn() }));

const ACCOUNT = "acct";
const DIRTY = "dirty";
const KEY = "00000000-0000-4000-8000-000000000001";
const line = (sku: string, qty = 1): StoredCartLine => ({ slug: `p-${sku.toLowerCase()}`, sku, qty });

function setup(initial: StoredCartLine[] = [], seed: Record<string, string> = {}) {
  const mem = new Map<string, string>(Object.entries(seed));
  let local = initial;
  const calls: CartSyncInput[] = [];
  const respond = vi.fn<(i: CartSyncInput) => CartSyncResult>(() => ({ ok: true, lines: [] }));
  const deps: SyncDeps = {
    storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) },
    accountKey: ACCOUNT,
    dirtyKey: DIRTY,
    action: async (i) => {
      calls.push(i);
      return respond(i);
    },
    read: () => local,
    write: (l) => {
      local = l;
    },
    newKey: () => KEY,
  };
  return { deps, mem, calls, respond, local: () => local };
}

describe("account cart sync", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("merges the guest cart once and then mirrors the account", async () => {
    t = setup([line("A", 2)]);
    t.respond.mockReturnValueOnce({ ok: true, lines: [line("A", 2), line("B")], skipped: 1, ownShowroom: 1 });
    const out = await syncAccountCart("me", t.deps);
    expect(out).toEqual({ kind: "merged", skipped: 1, ownShowroom: 1 });
    expect(t.calls[0]).toEqual({ mode: "merge", key: KEY, lines: [line("A", 2)] });
    expect(t.local()).toEqual([line("A", 2), line("B")]);
    expect(t.mem.get(ACCOUNT)).toBe("me");
    expect(t.mem.has(MERGE_KEY_STORAGE)).toBe(false);
  });

  it("reuses the same merge key when the answer was lost, so the server can replay", async () => {
    t = setup([line("A")]);
    t.respond.mockReturnValueOnce({ ok: false, code: "failed" });
    expect(await syncAccountCart("me", t.deps)).toEqual({ kind: "failed", code: "failed" });
    expect(t.mem.get(MERGE_KEY_STORAGE)).toBe(KEY);
    expect(t.mem.has(ACCOUNT)).toBe(false);
    t.deps.newKey = () => "never-used";
    t.respond.mockReturnValueOnce({ ok: true, lines: [line("A")], replayed: true });
    await syncAccountCart("me", t.deps);
    expect(t.calls[1]).toMatchObject({ mode: "merge", key: KEY });
  });

  it("never merges twice: once the cart mirrors the account a later visit only pulls", async () => {
    t = setup([line("A")], { [ACCOUNT]: "me" });
    t.respond.mockReturnValueOnce({ ok: true, lines: [line("A"), line("Z", 4)] });
    expect(await syncAccountCart("me", t.deps)).toEqual({ kind: "pulled" });
    expect(t.calls).toEqual([{ mode: "pull" }]);
    expect(t.local()).toEqual([line("A"), line("Z", 4)]);
  });

  it("pushes what changed on this device since the last sync, then clears the mark", async () => {
    t = setup([line("A", 3)], { [ACCOUNT]: "me", [DIRTY]: "1" });
    t.respond.mockReturnValueOnce({ ok: true, lines: [line("A", 3)] });
    expect(await syncAccountCart("me", t.deps)).toEqual({ kind: "pushed" });
    expect(t.calls).toEqual([{ mode: "replace", lines: [line("A", 3)] }]);
    expect(t.mem.has(DIRTY)).toBe(false);
  });

  it("lets the account cart win when the server refuses the pushed cart (own showroom)", async () => {
    t = setup([line("OWN")], { [ACCOUNT]: "me", [DIRTY]: "1" });
    t.respond.mockReturnValueOnce({ ok: false, code: "own_showroom" });
    t.respond.mockReturnValueOnce({ ok: true, lines: [line("B")] });
    expect(await syncAccountCart("me", t.deps)).toEqual({ kind: "pulled" });
    expect(t.local()).toEqual([line("B")]);
  });

  it("keeps the local cart and the mark when the push fails for another reason", async () => {
    t = setup([line("A", 3)], { [ACCOUNT]: "me", [DIRTY]: "1" });
    t.respond.mockReturnValueOnce({ ok: false, code: "failed" });
    expect(await syncAccountCart("me", t.deps)).toEqual({ kind: "failed", code: "failed" });
    expect(t.local()).toEqual([line("A", 3)]);
    expect(t.mem.get(DIRTY)).toBe("1");
  });

  it("drops the previous person's cart on sign-out and never offers it to the next account", async () => {
    t = setup([line("A")], { [ACCOUNT]: "me", [DIRTY]: "1" });
    expect(await syncAccountCart(null, t.deps)).toEqual({ kind: "cleared" });
    expect(t.local()).toEqual([]);
    expect(t.mem.size).toBe(0);

    t = setup([line("A")], { [ACCOUNT]: "me" });
    t.respond.mockReturnValueOnce({ ok: true, lines: [line("Q")] });
    await syncAccountCart("someone-else", t.deps);
    expect(t.calls[0]).toMatchObject({ mode: "merge", lines: [] });
  });

  it("leaves a plain guest cart alone while signed out", async () => {
    t = setup([line("A", 2)]);
    expect(await syncAccountCart(null, t.deps)).toEqual({ kind: "idle" });
    expect(t.local()).toEqual([line("A", 2)]);
    expect(t.calls).toEqual([]);
  });
});

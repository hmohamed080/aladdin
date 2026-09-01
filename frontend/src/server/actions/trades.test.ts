import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ rpc })),
}));

import { setTradesAction } from "./trades";

const form = (keys: string, primary = "") => {
  const fd = new FormData();
  fd.set("keys", keys);
  fd.set("primary", primary);
  return fd;
};

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
});

/**
 * The save action decides nothing, and these tests are about exactly that: what
 * it FORWARDS, and how it names the two refusals that mean something different
 * to the person reading them.
 */
describe("setTradesAction", () => {
  it("forwards the whole selection to the one atomic writer", async () => {
    const result = await setTradesAction({ ok: false }, form("plumbing\nelectrical", "electrical"));

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("user_trades_set", {
      p_trade_keys: ["plumbing", "electrical"],
      p_primary_key: "electrical",
    });
  });

  /**
   * IT POSTS A SET, NOT A CHANGE. Nothing here computes a delta against what the
   * person held before, which is what makes two in-flight submissions converge
   * on the last one rather than compounding. An add/remove API would let a
   * double-click leave trades selected that were just deselected, or — worse —
   * a moment with no primary at all.
   */
  it("sends no delta, no previous state and no user id", async () => {
    await setTradesAction({ ok: false }, form("tiling"));
    const args = rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_primary_key", "p_trade_keys"]);
  });

  it("clears the selection when nothing is submitted", async () => {
    await setTradesAction({ ok: false }, form(""));
    expect(rpc).toHaveBeenCalledWith("user_trades_set", {
      p_trade_keys: [],
      p_primary_key: undefined,
    });
  });

  it("drops blank lines and stray whitespace rather than sending them", async () => {
    await setTradesAction({ ok: false }, form("  plumbing  \n\n  \ntiling\n", "  tiling  "));
    expect(rpc).toHaveBeenCalledWith("user_trades_set", {
      p_trade_keys: ["plumbing", "tiling"],
      p_primary_key: "tiling",
    });
  });

  /**
   * Omitting the primary says "you choose", and the database's answer is the
   * first submitted key — the same rule the selector applies on screen, so the
   * page after a save is the page before it.
   */
  it("omits the primary instead of inventing one", async () => {
    await setTradesAction({ ok: false }, form("plumbing\ntiling"));
    expect((rpc.mock.calls[0]![1] as Record<string, unknown>).p_primary_key).toBeUndefined();
  });

  /**
   * Two refusals, two meanings. 42501 is "this account is not a professional" —
   * something the person can understand and nothing they can fix by retrying.
   * 22023 is "that trade is not available", which is what a retired trade looks
   * like to a client holding a stale catalog. Collapsing them into one generic
   * failure would tell a consumer to try again forever.
   */
  it("names a non-professional refusal for what it is", async () => {
    rpc.mockResolvedValue({ error: { code: "42501" } });
    expect(await setTradesAction({ ok: false }, form("plumbing"))).toEqual({
      ok: false,
      code: "profile.trades.notProfessional",
    });
  });

  it("names an unavailable trade separately from a retry", async () => {
    rpc.mockResolvedValue({ error: { code: "22023" } });
    expect(await setTradesAction({ ok: false }, form("hvac"))).toEqual({
      ok: false,
      code: "profile.trades.unavailable",
    });
  });

  it("falls back to a plain retry for anything else", async () => {
    rpc.mockResolvedValue({ error: { code: "08006" } });
    expect(await setTradesAction({ ok: false }, form("plumbing"))).toEqual({
      ok: false,
      code: "profile.trades.saveFailed",
    });
  });
});

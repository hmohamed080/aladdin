import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const getUser = vi.fn();
const state: { rows: unknown[] } = { rows: [] };
const asked = { from: [] as string[], select: [] as string[], eq: [] as [string, unknown][] };

/**
 * These two loaders end on the QUERY rather than on `.maybeSingle()`:
 * `loadTradeCatalog` awaits after `.order()`, `loadMyTrades` after `.eq()`. So
 * the terminal step returns a THENABLE and the builder itself does not — a
 * thenable builder would be unwrapped by the `await getServerSupabase()` in the
 * loader, which resolves it to the row set and leaves `supabase.auth` undefined.
 */
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => {
    const rows: Record<string, unknown> = {
      order: () => rows,
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: state.rows, error: null }).then(resolve),
    };
    const builder: Record<string, unknown> = {
      auth: { getUser },
      from(t: string) {
        asked.from.push(t);
        return builder;
      },
      select(cols: string) {
        asked.select.push(cols);
        return builder;
      },
      eq(col: string, val: unknown) {
        asked.eq.push([col, val]);
        return rows;
      },
      order: () => rows,
    };
    return builder;
  }),
}));

import { loadTradeCatalog, loadMyTrades } from "./trades";

const user = { id: "71000006-0000-4000-8000-000000000006" };

beforeEach(() => {
  state.rows = [];
  asked.from.length = 0;
  asked.select.length = 0;
  asked.eq.length = 0;
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user } });
});

/** One row as the join returns it. */
const row = (key: string, sort: number, isPrimary: boolean, active = true) => ({
  is_primary: isPrimary,
  trades: { key, sort_order: sort, is_active: active },
});

describe("loadTradeCatalog", () => {
  it("reads the vocabulary table and returns id + key", async () => {
    state.rows = [
      { id: "t1", key: "plumbing" },
      { id: "t2", key: "electrical" },
    ];

    expect(await loadTradeCatalog()).toEqual([
      { id: "t1", key: "plumbing" },
      { id: "t2", key: "electrical" },
    ]);
    expect(asked.from).toEqual(["trades"]);
  });

  /**
   * There is no `.eq("is_active", true)` here and there must not be: the filter
   * is `trades_select_active`, an RLS policy. A client-side filter would look
   * identical on screen while leaving a retired trade one forgotten `.select()`
   * away from being offered again.
   */
  it("does not filter for active itself — RLS does", async () => {
    await loadTradeCatalog();
    expect(asked.eq).toEqual([]);
  });

  it("survives an empty vocabulary without throwing", async () => {
    state.rows = [];
    expect(await loadTradeCatalog()).toEqual([]);
  });
});

describe("loadMyTrades", () => {
  /**
   * The ordering is the assertion that matters. It has to match the public
   * projection's exactly — primary first, then `sort_order` — or the same
   * professional lists their trades in one order on their own profile and
   * another on their public page, and a reader has no way to tell which is the
   * meaningful one.
   */
  it("puts the primary first, then the vocabulary's own order", async () => {
    state.rows = [
      row("tiling", 60, false),
      row("marble_granite", 70, true),
      row("plumbing", 20, false),
    ];

    expect(await loadMyTrades()).toEqual({
      keys: ["marble_granite", "plumbing", "tiling"],
      primaryKey: "marble_granite",
    });
  });

  it("scopes the read to the session's own user, never a parameter", async () => {
    state.rows = [row("plumbing", 20, true)];
    await loadMyTrades();
    expect(asked.from).toEqual(["user_trades"]);
    expect(asked.eq).toEqual([["user_id", user.id]]);
    // The signature has no argument to pass someone else's id through.
    expect(loadMyTrades.length).toBe(0);
  });

  /**
   * A retired trade the person still holds is not shown as a current claim. The
   * ROW survives — a retirement does not rewrite history — but the profile stops
   * publishing a trade the platform has withdrawn, matching what the public
   * projection does on the same data.
   */
  it("hides an inactive trade the person still holds", async () => {
    state.rows = [row("plumbing", 20, true), row("legacy_trade", 99, false, false)];
    expect(await loadMyTrades()).toEqual({ keys: ["plumbing"], primaryKey: "plumbing" });
  });

  it("returns an empty selection rather than null when there is none", async () => {
    state.rows = [];
    expect(await loadMyTrades()).toEqual({ keys: [], primaryKey: null });
  });

  it("returns nothing at all when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect(await loadMyTrades()).toEqual({ keys: [], primaryKey: null });
    expect(asked.from).toEqual([]);
  });

  /**
   * A selection with no primary is not a state the writer can produce — the RPC
   * always names one when the set is non-empty — but the READER must not invent
   * one, or a display bug would be indistinguishable from a data bug.
   */
  it("reports a missing primary as null instead of guessing", async () => {
    state.rows = [row("plumbing", 20, false), row("tiling", 60, false)];
    expect(await loadMyTrades()).toEqual({ keys: ["plumbing", "tiling"], primaryKey: null });
  });
});

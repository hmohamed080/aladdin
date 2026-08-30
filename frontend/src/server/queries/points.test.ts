import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getPointsBalance,
  listPointsEntries,
  resolveEntryOrganizationNames,
  resolveHistoryLimit,
  POINTS_HISTORY_LIMIT,
  POINTS_HISTORY_MAX,
} from "./points";

/**
 * A chainable stand-in for the Supabase query builder, recording what the query
 * ASKS FOR. What RLS then returns is the database's business and is covered by
 * pgTAP (`35_points_core_test`, `36_referral_points_test`); what these functions
 * decide is the bound, the ordering, and — the one that matters most — whether a
 * caller-supplied user id can ever reach the database.
 */
function makeClient({ rows = [] as unknown[], rpc = 0 as unknown } = {}) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    order: [] as [string, unknown][],
    limit: [] as number[],
    in: [] as [string, unknown][],
    eq: [] as [string, unknown][],
    rpc: [] as [string, unknown][],
  };
  const builder: Record<string, unknown> = {
    from(t: string) {
      calls.from.push(t);
      return builder;
    },
    select(cols: string) {
      calls.select.push(cols);
      return builder;
    },
    order(col: string, opts?: unknown) {
      calls.order.push([col, opts]);
      return builder;
    },
    limit(n: number) {
      calls.limit.push(n);
      return builder;
    },
    in(col: string, vals: unknown) {
      calls.in.push([col, vals]);
      return builder;
    },
    eq(col: string, val: unknown) {
      calls.eq.push([col, val]);
      return builder;
    },
    rpc(name: string, args?: unknown) {
      calls.rpc.push([name, args]);
      return Promise.resolve({ data: rpc, error: null });
    },
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: builder as any, calls };
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  user_id: "u1",
  organization_id: null,
  event_type: "referral.organization_approved",
  points_delta: 100,
  source_type: "organization",
  source_id: "o1",
  reverses_entry_id: null,
  awarded_by_user_id: null,
  reason_code: null,
  metadata: {},
  created_at: "2026-08-30T10:00:00Z",
  ...over,
});

describe("getPointsBalance", () => {
  it("calls the derived-balance RPC with NO user id, so it defaults to the caller", async () => {
    const { client, calls } = makeClient({ rpc: 100 });
    await getPointsBalance(client);
    expect(calls.rpc).toHaveLength(1);
    const call = calls.rpc.at(0);
    expect(call?.[0]).toBe("points_balance");
    // The whole privacy argument in one assertion: no argument is sent, so
    // `p_user_id` defaults to auth.uid() inside the database and there is no
    // shape in which a browser could ask about somebody else.
    expect(call?.[1]).toBeUndefined();
  });

  it("returns a negative balance faithfully, never clamped", async () => {
    const { client } = makeClient({ rpc: -40 });
    await expect(getPointsBalance(client)).resolves.toBe(-40);
  });

  it("returns zero for an empty ledger", async () => {
    const { client } = makeClient({ rpc: 0 });
    await expect(getPointsBalance(client)).resolves.toBe(0);
  });

  it("accepts no user-id argument at all", () => {
    // Arity is the guard: the function cannot be handed a user id even by a
    // caller that wants to. A second parameter would be the regression.
    expect(getPointsBalance.length).toBe(1);
  });
});

describe("listPointsEntries", () => {
  it("reads the caller's own ledger, newest first, bounded", async () => {
    const { client, calls } = makeClient({ rows: [entry()] });
    await listPointsEntries(client);
    expect(calls.from).toEqual(["points_ledger"]);
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
    expect(calls.limit).toEqual([POINTS_HISTORY_LIMIT]);
  });

  it("adds NO ownership filter of its own — RLS is the authority", async () => {
    const { client, calls } = makeClient();
    await listPointsEntries(client);
    // No `.eq("user_id", …)`: a duplicated check here would be a second place
    // to get ownership wrong, and it could only narrow what RLS already bounded.
    expect(calls.eq).toEqual([]);
  });

  it("honours a raised bound", async () => {
    const { client, calls } = makeClient();
    await listPointsEntries(client, { limit: 40 });
    expect(calls.limit).toEqual([40]);
  });

  it("surfaces a query failure rather than pretending the ledger is empty", async () => {
    const failing = {
      from: () => failing,
      select: () => failing,
      order: () => failing,
      limit: () => failing,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: new Error("boom") }).then(resolve),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(listPointsEntries(failing)).rejects.toBeTruthy();
  });
});

describe("resolveHistoryLimit", () => {
  it("defaults to the bounded page size", () => {
    expect(resolveHistoryLimit(undefined)).toBe(POINTS_HISTORY_LIMIT);
    expect(resolveHistoryLimit("not-a-number")).toBe(POINTS_HISTORY_LIMIT);
  });

  it("clamps an untrusted value into the allowed range", () => {
    // The query string is browser input. It may raise the bound in steps and
    // may never unbound the read.
    expect(resolveHistoryLimit("1")).toBe(POINTS_HISTORY_LIMIT);
    expect(resolveHistoryLimit("-500")).toBe(POINTS_HISTORY_LIMIT);
    expect(resolveHistoryLimit("999999")).toBe(POINTS_HISTORY_MAX);
    expect(resolveHistoryLimit("40")).toBe(40);
  });

  it("takes the first value when a param is repeated", () => {
    expect(resolveHistoryLimit(["40", "999999"])).toBe(40);
  });
});

describe("resolveEntryOrganizationNames", () => {
  it("does not query at all when no entry carries an organization", async () => {
    const { client, calls } = makeClient();
    const map = await resolveEntryOrganizationNames(client, [entry()]);
    expect(calls.from).toEqual([]);
    expect(map.size).toBe(0);
  });

  it("asks only for the organizations the entries actually name", async () => {
    const { client, calls } = makeClient({ rows: [{ id: "o9", name: "Zayed Tiles" }] });
    const map = await resolveEntryOrganizationNames(client, [
      entry({ organization_id: "o9" }),
      entry({ id: "e2", organization_id: "o9" }),
      entry({ id: "e3", organization_id: null }),
    ]);
    expect(calls.from).toEqual(["organizations"]);
    // Deduplicated, and nulls dropped.
    expect(calls.in).toEqual([["id", ["o9"]]]);
    expect(map.get("o9")).toBe("Zayed Tiles");
  });

  it("omits a name RLS did not return rather than inventing one", async () => {
    // The reader has left that business, so `organizations_select_member` gives
    // nothing back. The entry still renders; it just carries no context.
    const { client } = makeClient({ rows: [] });
    const map = await resolveEntryOrganizationNames(client, [entry({ organization_id: "gone" })]);
    expect(map.has("gone")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countUnread, listNotifications, NOTIFICATION_LIST_LIMIT } from "./notifications";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/**
 * A chainable stand-in for the Supabase query builder. It records every call the
 * assertions below care about, and awaiting it resolves `{ data, error, count }`.
 * The point is to prove what the query ASKS FOR — ordering, bounds, filters,
 * head-vs-rows — because that is the whole of what these functions decide. What
 * RLS then returns is the database's business and is covered by pgTAP.
 */
function makeClient({ rows = [] as unknown[], count = 0 } = {}) {
  const calls = {
    from: [] as string[],
    select: [] as [string, unknown][],
    order: [] as [string, unknown][],
    limit: [] as number[],
    eq: [] as [string, unknown][],
    is: [] as [string, unknown][],
  };
  const builder: Record<string, unknown> = {
    from(t: string) {
      calls.from.push(t);
      return builder;
    },
    select(cols: string, opts?: unknown) {
      calls.select.push([cols, opts]);
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
    eq(col: string, val: unknown) {
      calls.eq.push([col, val]);
      return builder;
    },
    is(col: string, val: unknown) {
      calls.is.push([col, val]);
      return builder;
    },
    then: (resolve: (v: { data: unknown[]; error: null; count: number }) => unknown) =>
      Promise.resolve({ data: rows, error: null, count }).then(resolve),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: builder as any, calls };
}

describe("listNotifications", () => {
  it("asks for the newest first", async () => {
    const { client, calls } = makeClient();
    await listNotifications(client);
    expect(calls.from).toEqual(["notifications"]);
    expect(calls.order).toEqual([["created_at", { ascending: false }]]);
  });

  it("is bounded by default, and honours an explicit smaller bound", async () => {
    const { client, calls } = makeClient();
    await listNotifications(client);
    expect(calls.limit).toEqual([NOTIFICATION_LIST_LIMIT]);

    const second = makeClient();
    await listNotifications(second.client, { limit: 5 });
    expect(second.calls.limit).toEqual([5]);
  });

  it("returns the rows the database handed back, in the order it handed them back", async () => {
    const rows = [{ id: "newest" }, { id: "older" }];
    const { client } = makeClient({ rows });
    // The query orders in Postgres and the function does not re-sort — a client
    // that reordered would silently disagree with `countUnread` about which
    // twenty rows the cap selected.
    await expect(listNotifications(client)).resolves.toEqual(rows);
  });

  it("returns an empty list rather than null when there is nothing", async () => {
    const { client } = makeClient({ rows: [] });
    await expect(listNotifications(client)).resolves.toEqual([]);
  });
});

describe("organization_id is a UX filter, never an authorization mechanism", () => {
  it("narrows to the active workspace when one is supplied", async () => {
    const { client, calls } = makeClient();
    await listNotifications(client, { orgId: ORG_A });
    expect(calls.eq).toEqual([["organization_id", ORG_A]]);
  });

  it("adds NO filter at all without an org — the personal inbox is the default", async () => {
    const { client, calls } = makeClient();
    await listNotifications(client);
    expect(calls.eq).toEqual([]);
  });

  it("never filters on the recipient: that is RLS's decision and only RLS's", async () => {
    // A `recipient_user_id` filter in application code would be a second,
    // divergeable copy of the one rule the table's single policy already
    // enforces. Its absence is the assertion.
    const list = makeClient();
    await listNotifications(list.client, { orgId: ORG_A });
    const count = makeClient();
    await countUnread(count.client, { orgId: ORG_A });

    for (const calls of [list.calls, count.calls]) {
      expect(calls.eq.map(([col]) => col)).not.toContain("recipient_user_id");
      expect(calls.is.map(([col]) => col)).not.toContain("recipient_user_id");
    }
  });
});

describe("countUnread", () => {
  it("counts without transferring rows", async () => {
    const { client, calls } = makeClient({ count: 7 });
    await expect(countUnread(client)).resolves.toBe(7);
    expect(calls.select).toEqual([["*", { count: "exact", head: true }]]);
    // No bound: a count is a count. Capping it would make the badge disagree
    // with the number of unread rows that actually exist.
    expect(calls.limit).toEqual([]);
  });

  it("defines unread as `read_at is null`", async () => {
    const { client, calls } = makeClient();
    await countUnread(client);
    expect(calls.is).toEqual([["read_at", null]]);
  });

  it("scopes to the workspace when one is supplied", async () => {
    const { client, calls } = makeClient({ count: 2 });
    await expect(countUnread(client, { orgId: ORG_A })).resolves.toBe(2);
    expect(calls.eq).toEqual([["organization_id", ORG_A]]);
  });

  it("reads a null count as zero", async () => {
    const { client } = makeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null, count: null }).then(resolve);
    await expect(countUnread(client)).resolves.toBe(0);
  });
});

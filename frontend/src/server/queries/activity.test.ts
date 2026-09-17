import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ORGANIZATION_ACTIVITY_PAGE_SIZE, organizationActivity } from "./activity";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(index: number) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    actor_user_id: null,
    event_type: "customer.created",
    subject_type: "customer",
    subject_id: null,
    params: {},
    created_at: new Date(Date.UTC(2026, 8, 9, 12, 0, 0) - index * 1_000).toISOString(),
  };
}

function makeClient(rows: ReturnType<typeof row>[]) {
  const calls = {
    from: [] as string[],
    select: [] as string[],
    eq: [] as [string, unknown][],
    order: [] as [string, unknown][],
    limit: [] as number[],
    like: [] as [string, unknown][],
    gte: [] as [string, unknown][],
    lt: [] as [string, unknown][],
    or: [] as string[],
  };
  const builder: Record<string, unknown> = {
    from(table: string) {
      calls.from.push(table);
      return builder;
    },
    select(columns: string) {
      calls.select.push(columns);
      return builder;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return builder;
    },
    order(column: string, options: unknown) {
      calls.order.push([column, options]);
      return builder;
    },
    limit(value: number) {
      calls.limit.push(value);
      return builder;
    },
    like(column: string, value: unknown) {
      calls.like.push([column, value]);
      return builder;
    },
    gte(column: string, value: unknown) {
      calls.gte.push([column, value]);
      return builder;
    },
    lt(column: string, value: unknown) {
      calls.lt.push([column, value]);
      return builder;
    },
    or(value: string) {
      calls.or.push(value);
      return builder;
    },
    then: (resolve: (value: { data: ReturnType<typeof row>[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: builder as any, calls };
}

describe("organizationActivity", () => {
  it("always narrows the base-table read to the requested organization", async () => {
    const a = makeClient([]);
    const b = makeClient([]);

    await organizationActivity(a.client, ORG_A);
    await organizationActivity(b.client, ORG_B);

    expect(a.calls.from).toEqual(["organization_activity_events"]);
    expect(a.calls.eq).toContainEqual(["organization_id", ORG_A]);
    expect(a.calls.eq).not.toContainEqual(["organization_id", ORG_B]);
    expect(b.calls.eq).toContainEqual(["organization_id", ORG_B]);
  });

  it("requests one look-ahead row and exposes an older-page cursor", async () => {
    const rows = Array.from({ length: ORGANIZATION_ACTIVITY_PAGE_SIZE + 1 }, (_, index) => row(index));
    const { client, calls } = makeClient(rows);

    const page = await organizationActivity(client, ORG_A);

    expect(calls.limit).toEqual([ORGANIZATION_ACTIVITY_PAGE_SIZE + 1]);
    expect(page.events).toHaveLength(ORGANIZATION_ACTIVITY_PAGE_SIZE);
    expect(page.nextBefore).not.toBeNull();
    expect(page.nextBefore).not.toBe(rows[ORGANIZATION_ACTIVITY_PAGE_SIZE - 1]!.created_at);
  });

  it("matches the (created_at desc, id desc) sort in its older-page predicate", async () => {
    const rows = Array.from({ length: ORGANIZATION_ACTIVITY_PAGE_SIZE + 1 }, (_, index) => row(index));
    rows[ORGANIZATION_ACTIVITY_PAGE_SIZE - 1] = {
      ...rows[ORGANIZATION_ACTIVITY_PAGE_SIZE - 1]!,
      created_at: "2026-09-09T10:00:00.123456+00:00",
    };
    const first = await organizationActivity(makeClient(rows).client, ORG_A);
    const { client, calls } = makeClient([]);

    await organizationActivity(client, ORG_A, first.nextBefore!);

    const boundary = rows[ORGANIZATION_ACTIVITY_PAGE_SIZE - 1]!;
    expect(calls.or).toEqual([
      `created_at.lt.${boundary.created_at},` +
        `and(created_at.eq.${boundary.created_at},id.lt.${boundary.id})`,
    ]);
    expect(calls.lt).toEqual([]);
  });

  it("ignores a malformed opaque cursor instead of composing it into a filter", async () => {
    const { client, calls } = makeClient([]);

    await organizationActivity(client, ORG_A, "not-a-valid-activity-cursor");

    expect(calls.or).toEqual([]);
  });

  it("composes validated family and inclusive date filters with the keyset cursor", async () => {
    const rows = Array.from({ length: ORGANIZATION_ACTIVITY_PAGE_SIZE + 1 }, (_, index) => row(index));
    const first = await organizationActivity(makeClient(rows).client, ORG_A);
    const { client, calls } = makeClient([]);

    await organizationActivity(client, ORG_A, first.nextBefore!, {
      family: "rfq",
      from: "2026-09-01",
      to: "2026-09-09",
    });

    expect(calls.like).toEqual([["event_type", "rfq.%"]]);
    expect(calls.gte).toEqual([["created_at", "2026-09-01T00:00:00.000000+00:00"]]);
    expect(calls.lt).toEqual([["created_at", "2026-09-10T00:00:00.000000+00:00"]]);
    expect(calls.or).toHaveLength(1);
  });

  it("ignores malformed filters before they reach PostgREST grammar", async () => {
    const { client, calls } = makeClient([]);

    await organizationActivity(client, ORG_A, undefined, {
      family: "rfq),organization_id.eq.anything",
      from: "2026-02-30",
      to: "not-a-date",
    });

    expect(calls.like).toEqual([]);
    expect(calls.gte).toEqual([]);
    expect(calls.lt).toEqual([]);
  });

  it("orders newest first with id as a deterministic tie-breaker", async () => {
    const { client, calls } = makeClient([]);

    await organizationActivity(client, ORG_A);

    expect(calls.order).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("keeps an unshown row reachable when it shares the page-boundary timestamp", async () => {
    const sharedTime = "2026-09-09T10:00:00.123456+00:00";
    const boundaryId = "00000000-0000-4000-8000-000000000002";
    const trailingId = "00000000-0000-4000-8000-000000000001";
    const source = [
      ...Array.from({ length: ORGANIZATION_ACTIVITY_PAGE_SIZE - 1 }, (_, index) => row(index)),
      { ...row(100), id: boundaryId, created_at: sharedTime },
      { ...row(101), id: trailingId, created_at: sharedTime },
    ];

    function keysetClient() {
      let timestampBefore: string | undefined;
      let keysetPredicate: string | undefined;
      let requestedLimit = source.length;
      const builder: Record<string, unknown> = {
        from: () => builder,
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit(value: number) {
          requestedLimit = value;
          return builder;
        },
        lt(_column: string, value: string) {
          timestampBefore = value;
          return builder;
        },
        or(value: string) {
          keysetPredicate = value;
          return builder;
        },
        then(resolve: (value: { data: typeof source; error: null }) => unknown) {
          let visible = source;
          if (timestampBefore) {
            visible = visible.filter((event) => event.created_at < timestampBefore!);
          }
          if (keysetPredicate) {
            const expected =
              `created_at.lt.${sharedTime},` +
              `and(created_at.eq.${sharedTime},id.lt.${boundaryId})`;
            visible =
              keysetPredicate === expected
                ? visible.filter(
                    (event) =>
                      event.created_at < sharedTime ||
                      (event.created_at === sharedTime && event.id < boundaryId),
                  )
                : [];
          }
          return Promise.resolve({ data: visible.slice(0, requestedLimit), error: null }).then(resolve);
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return builder as any;
    }

    const first = await organizationActivity(keysetClient(), ORG_A);
    expect(first.events.at(-1)?.id).toBe(boundaryId);
    expect(first.nextBefore).not.toBeNull();

    const second = await organizationActivity(keysetClient(), ORG_A, first.nextBefore!);
    expect(second.events.map((event) => event.id)).toContain(trailingId);
  });
});

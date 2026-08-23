import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CONVERSATION_LIST_LIMIT,
  MESSAGE_PAGE_LIMIT,
  UNREAD_SCAN_LIMIT,
  countUnreadConversations,
  getConversation,
  listConversations,
  listMessages,
  resolveConversationDisplayContext,
} from "./chat";
import { toConversationViews } from "@/features/chat/view-model";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * A chainable stand-in for the Supabase query builder, recording what the query
 * ASKS FOR — ordering, bounds, selected columns. What RLS then returns is the
 * database's business and is covered by pgTAP; these assertions exist to prove
 * the application layer adds no authority of its own and no unbounded reads.
 */
function makeClient({ rows = [] as unknown[] } = {}) {
  const calls = {
    from: [] as string[],
    select: [] as [string][],
    order: [] as [string, unknown][],
    limit: [] as number[],
    eq: [] as [string, unknown][],
    in: [] as [string, unknown[]][],
  };
  const builder: Record<string, unknown> = {
    from(t: string) {
      calls.from.push(t);
      return builder;
    },
    select(cols: string) {
      calls.select.push([cols]);
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
    in(col: string, vals: unknown[]) {
      calls.in.push([col, vals]);
      return builder;
    },
    maybeSingle: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: builder as any, calls };
}

describe("listConversations", () => {
  it("orders by latest activity, opened-fallback second", async () => {
    const { client, calls } = makeClient();
    await listConversations(client);
    expect(calls.order).toEqual([
      ["last_message_at", { ascending: false, nullsFirst: false }],
      ["created_at", { ascending: false }],
    ]);
  });

  it("is bounded by construction", async () => {
    const { client, calls } = makeClient();
    await listConversations(client);
    expect(calls.limit).toEqual([CONVERSATION_LIST_LIMIT]);
  });

  it("adds NO ownership predicate of its own", async () => {
    // Access was decided by `conversations_select_party` before a single row
    // reached this code. Filtering on either party org here would be a
    // TypeScript re-implementation of half the database's rule.
    const { client, calls } = makeClient();
    await listConversations(client);
    expect(calls.eq).toEqual([]);
    for (const [col] of calls.in) {
      expect(col).not.toBe("requester_org_id");
      expect(col).not.toBe("supplier_org_id");
    }
    expect(calls.select[0]![0]).not.toContain("*");
  });

  it("returns the rows in the order the database handed back", async () => {
    const rows = [{ id: "c-new" }, { id: "c-old" }];
    const { client } = makeClient({ rows });
    await expect(listConversations(client)).resolves.toMatchObject(rows);
  });
});

describe("getConversation", () => {
  it("looks up by id alone and accepts whatever RLS decides", async () => {
    const row = { id: "c1", subject_type: "rfq" };
    const { client, calls } = makeClient({ rows: [row] });
    const result = await getConversation(client, "c1");
    expect(result).toMatchObject(row);
    expect(calls.eq).toEqual([["id", "c1"]]);
  });

  it("resolves an invisible conversation to plain null — no error to distinguish it", async () => {
    const { client } = makeClient({ rows: [] });
    await expect(getConversation(client, "someone-elses")).resolves.toBeNull();
  });
});

describe("listMessages", () => {
  it("fetches newest-first (the index direction) and reverses to chronological", async () => {
    const rows = [
      { id: "m3", body: "third", created_at: "2026-08-23T10:02:00Z" },
      { id: "m1", body: "first", created_at: "2026-08-23T10:00:00Z" },
    ];
    const { client, calls } = makeClient({ rows });
    const result = await listMessages(client, "c1");
    expect(calls.eq).toEqual([["conversation_id", "c1"]]);
    expect(calls.order).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(calls.limit).toEqual([MESSAGE_PAGE_LIMIT]);
    // The bounded page holds the NEWEST messages; display order is oldest-at-top.
    expect(result.map((m) => m.body)).toEqual(["first", "third"]);
  });

  it("scopes to exactly one conversation and selects message columns only", async () => {
    const { client, calls } = makeClient();
    await listMessages(client, "c9");
    expect(calls.from).toEqual(["messages"]);
    expect(calls.select[0]![0]).toContain("sender_organization_id");
  });
});

describe("countUnreadConversations follows last_message_at vs last_read_at", () => {
  const base = {
    id: "c1",
    subject_type: "order",
    subject_id: "s1",
    requester_org_id: ORG_A,
    supplier_org_id: ORG_B,
    created_at: "2026-08-20T09:00:00Z",
    conversation_read_state: [] as { last_read_at: string | null }[],
  };

  function scanRows(
    over: Partial<{
      last_message_at: string | null;
      readStates: { last_read_at: string | null }[];
    }>,
  ) {
    return [
      {
        ...base,
        last_message_at: over.last_message_at ?? null,
        conversation_read_state: over.readStates ?? [],
      },
    ];
  }

  it("a conversation with no messages is never unread", async () => {
    const { client } = makeClient({ rows: scanRows({ last_message_at: null }) });
    await expect(countUnreadConversations(client)).resolves.toBe(0);
  });

  it("no read-state row means unread", async () => {
    const { client } = makeClient({
      rows: scanRows({ last_message_at: "2026-08-23T10:00:00Z", readStates: [] }),
    });
    await expect(countUnreadConversations(client)).resolves.toBe(1);
  });

  it("activity newer than the reading position means unread", async () => {
    const { client } = makeClient({
      rows: scanRows({
        last_message_at: "2026-08-23T10:00:00Z",
        readStates: [{ last_read_at: "2026-08-23T09:00:00Z" }],
      }),
    });
    await expect(countUnreadConversations(client)).resolves.toBe(1);
  });

  it("a reading position newer than activity means read", async () => {
    const { client } = makeClient({
      rows: scanRows({
        last_message_at: "2026-08-23T10:00:00Z",
        readStates: [{ last_read_at: "2026-08-23T11:00:00Z" }],
      }),
    });
    await expect(countUnreadConversations(client)).resolves.toBe(0);
  });

  it("scans a bounded set of conversations and never touches public.messages", async () => {
    const { client, calls } = makeClient({ rows: [] });
    await countUnreadConversations(client);
    expect(calls.from).toEqual(["conversations"]);
    expect(calls.limit).toEqual([UNREAD_SCAN_LIMIT]);
    expect(JSON.stringify(calls.select)).not.toContain("messages");
  });
});

describe("resolveConversationDisplayContext", () => {
  it("resolves names through the commerce projections per subject type", async () => {
    const rfqRow = {
      id: "r1",
      title: "Bathroom finishing",
      requester_name: "Cairo Ceramics",
      supplier_name: "Nile Ceramics",
    };
    const { client, calls } = makeClient({ rows: [rfqRow] });
    const result = await resolveConversationDisplayContext(client, [
      { subject_type: "rfq", subject_id: "r1" },
    ]);
    expect(calls.from).toEqual(["rfq_list"]);
    expect(calls.in).toEqual([["id", ["r1"]]]);
    expect(result.get("rfq:r1")).toEqual({
      title: "Bathroom finishing",
      requesterName: "Cairo Ceramics",
      supplierName: "Nile Ceramics",
    });
  });

  it("issues no query at all for a type with no conversations", async () => {
    const { client, calls } = makeClient({ rows: [] });
    await resolveConversationDisplayContext(client, []);
    expect(calls.from).toEqual([]);
  });

  /**
   * THE SEAM. `resolveConversationDisplayContext` keys its map by SUBJECT while
   * the rows it decorates are keyed by CONVERSATION, and each half was once
   * unit-tested against its own idea of the key — so both passed while the panel
   * rendered every row with no counterparty and no title. This test spans the
   * two halves, so the key can only be wrong in one place at a time again.
   */
  it("produces keys the view model actually looks conversations up by", async () => {
    const orderRow = {
      id: "o1",
      title: "Exterior coating",
      requester_name: "Cairo Ceramics",
      supplier_name: "Suez Paints",
    };
    const { client } = makeClient({ rows: [orderRow] });
    const contexts = await resolveConversationDisplayContext(client, [
      { subject_type: "order", subject_id: "o1" },
    ]);

    const views = toConversationViews(
      [
        {
          id: "conversation-id-which-is-NOT-the-subject-id",
          subject_type: "order",
          subject_id: "o1",
          requester_org_id: ORG_A,
          supplier_org_id: ORG_B,
          last_message_at: "2026-08-23T10:00:00Z",
          created_at: "2026-08-23T09:00:00Z",
          last_read_at: null,
        },
      ],
      contexts,
      (k: string) => k,
      "en",
      ORG_A,
    );

    expect(views).toHaveLength(1);
    expect(views[0]!.subjectTitle).toBe("Exterior coating");
    expect(views[0]!.counterpartyName).toBe("Suez Paints");
  });
});

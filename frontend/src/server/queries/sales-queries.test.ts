import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  sanitizeSearchTerm,
  listCustomers,
  listOrgMembers,
  memberNameMap,
  myOpenLeads,
  overdueFollowUps,
  followUpsDueToday,
  recentActivities,
  stageCounts,
} from "./sales";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/**
 * A minimal chainable stand-in for the Supabase query builder: every method
 * returns the same builder and records the calls we assert on; awaiting it
 * resolves `{ data, error }` (the queries all `await q` at the end).
 */
function makeClient(rows: unknown[] = []) {
  const calls = { from: [] as string[], eq: [] as [string, unknown][], or: [] as string[] };
  const builder: Record<string, unknown> = {
    from(t: string) {
      calls.from.push(t);
      return builder;
    },
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    is: () => builder,
    eq(col: string, val: unknown) {
      calls.eq.push([col, val]);
      return builder;
    },
    or(arg: string) {
      calls.or.push(arg);
      return builder;
    },
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: builder as any, calls };
}

const hasEq = (calls: { eq: [string, unknown][] }, col: string, val: unknown) =>
  calls.eq.some(([c, v]) => c === col && v === val);

describe("sanitizeSearchTerm (cannot inject PostgREST filter grammar or wildcards)", () => {
  const forbidden = [",", "(", ")", "%", "_", "*", '"', "\\"];
  const cases: [string, string][] = [
    ["comma", "a,b"],
    ["parenthesis", "a(b)c"],
    ["percent", "50%off"],
    ["underscore", "a_b"],
    ["star", "a*b"],
    ["quote", 'a"b'],
    ["backslash", "a\\b"],
    ["or-injection", "x),display_name.neq.y"],
  ];
  for (const [name, input] of cases) {
    it(`strips every metacharacter from a ${name} term`, () => {
      const out = sanitizeSearchTerm(input);
      for (const ch of forbidden) expect(out.includes(ch)).toBe(false);
    });
  }

  it("preserves Arabic letters, digits, dots and phone punctuation", () => {
    expect(sanitizeSearchTerm("محمد")).toBe("محمد");
    expect(sanitizeSearchTerm("you@co.com")).toBe("you@co.com");
    expect(sanitizeSearchTerm("+20 100-200")).toBe("+20 100-200");
    expect(sanitizeSearchTerm("  علاء   الدين  ")).toBe("علاء الدين");
  });

  it("collapses an all-metacharacter term to empty (filter is then skipped)", () => {
    expect(sanitizeSearchTerm("(),%_*")).toBe("");
  });
});

describe("customer search feeds only a sanitized term into .or()", () => {
  it("skips the .or filter entirely for an all-metacharacter search", async () => {
    const { client, calls } = makeClient();
    await listCustomers(client, { orgId: ORG_A, search: "()%_*" });
    expect(calls.or.length).toBe(0);
    expect(hasEq(calls, "organization_id", ORG_A)).toBe(true);
  });

  it("builds an .or filter whose value carries no grammar metacharacters", async () => {
    const { client, calls } = makeClient();
    await listCustomers(client, { orgId: ORG_A, search: "x),display_name.neq.y%" });
    expect(calls.or.length).toBe(1);
    const value = calls.or[0]!.split(",")[0]!; // display_name.ilike.%<term>%
    expect(value.includes("(")).toBe(false);
    expect(value.includes(")")).toBe(false);
    expect(value.includes("%neq")).toBe(false);
  });
});

describe("active org + branch narrow every cockpit query", () => {
  const widgets: [string, (c: unknown, org: string, br?: string | null) => Promise<unknown>][] = [
    ["myOpenLeads", (c, o, b) => myOpenLeads(c as never, o, b)],
    ["overdueFollowUps", (c, o, b) => overdueFollowUps(c as never, o, b)],
    ["followUpsDueToday", (c, o, b) => followUpsDueToday(c as never, o, b)],
    ["recentActivities", (c, o, b) => recentActivities(c as never, o, b)],
    ["stageCounts", (c, o, b) => stageCounts(c as never, o, b)],
  ];

  for (const [name, run] of widgets) {
    it(`${name} filters by the active organization`, async () => {
      const { client, calls } = makeClient();
      await run(client, ORG_A);
      expect(hasEq(calls, "organization_id", ORG_A)).toBe(true);
    });

    it(`${name} narrows by the active branch when one is selected`, async () => {
      const { client, calls } = makeClient();
      await run(client, ORG_A, BR);
      expect(hasEq(calls, "branch_id", BR)).toBe(true);
    });

    it(`${name} applies no branch filter for the "all" (null) scope`, async () => {
      const { client, calls } = makeClient();
      await run(client, ORG_A, null);
      expect(calls.eq.some(([c]) => c === "branch_id")).toBe(false);
    });
  }

  it("org A and org B never resolve to the same filter (no cross-org mixing)", async () => {
    const a = makeClient();
    const b = makeClient();
    await myOpenLeads(a.client, ORG_A);
    await myOpenLeads(b.client, ORG_B);
    expect(hasEq(a.calls, "organization_id", ORG_A)).toBe(true);
    expect(hasEq(a.calls, "organization_id", ORG_B)).toBe(false);
    expect(hasEq(b.calls, "organization_id", ORG_B)).toBe(true);
  });
});

/**
 * A minimal stand-in for a Supabase client whose only method under test is
 * `.rpc()` — `listOrgMembers` calls `org_members_list` directly rather than
 * chaining `.from()`, so it needs its own mock shape from `makeClient` above.
 */
function makeRpcClient(result: { data: unknown[] | null; error: { code: string } | null }) {
  const calls: { name: string; args: unknown }[] = [];
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls };
}

describe("listOrgMembers resolves teammate names through org_members_list, never a raw id", () => {
  it("resolves Youssef's real name for the Customers/Leads assignment map", async () => {
    const { client } = makeRpcClient({
      data: [
        { membership_id: "50000001-0000-4000-8000-000000000001", display_name: "Hana Mansour", status: "active" },
        { membership_id: "50000002-0000-4000-8000-000000000002", display_name: "Youssef Amin", status: "active" },
      ],
      error: null,
    });
    const members = await listOrgMembers(client, ORG_A);
    expect(members).toEqual([
      { membershipId: "50000001-0000-4000-8000-000000000001", displayName: "Hana Mansour" },
      { membershipId: "50000002-0000-4000-8000-000000000002", displayName: "Youssef Amin" },
    ]);
    // The regression this guards: no entry's displayName is ever the raw/
    // truncated membership id.
    for (const m of members) {
      expect(m.displayName).not.toBe(m.membershipId);
      expect(m.displayName).not.toBe(m.membershipId.slice(0, 8));
    }
  });

  it("memberNameMap (Customers/Leads/Follow-ups) maps membership id -> resolved name", async () => {
    const { client } = makeRpcClient({
      data: [{ membership_id: "50000002-0000-4000-8000-000000000002", display_name: "Youssef Amin", status: "active" }],
      error: null,
    });
    const map = await memberNameMap(client, ORG_A);
    expect(map.get("50000002-0000-4000-8000-000000000002")).toBe("Youssef Amin");
  });

  it("omits (never id-fallback) a member with no resolvable display name", async () => {
    const { client } = makeRpcClient({
      data: [
        { membership_id: "50000003-0000-4000-8000-000000000003", display_name: "", status: "active" },
        { membership_id: "50000004-0000-4000-8000-000000000004", display_name: "   ", status: "active" },
      ],
      error: null,
    });
    const members = await listOrgMembers(client, ORG_A);
    expect(members).toEqual([]);
  });

  it("drops inactive (invited/suspended) members from the name-resolution list", async () => {
    const { client } = makeRpcClient({
      data: [
        { membership_id: "50000005-0000-4000-8000-000000000005", display_name: "Pending Invitee", status: "invited" },
        { membership_id: "50000006-0000-4000-8000-000000000006", display_name: "Suspended Member", status: "suspended" },
      ],
      error: null,
    });
    const members = await listOrgMembers(client, ORG_A);
    expect(members).toEqual([]);
  });

  it("returns an empty list (never a permission error or a raw id) when the caller lacks org.members.manage", async () => {
    const { client } = makeRpcClient({ data: null, error: { code: "42501" } });
    await expect(listOrgMembers(client, ORG_A)).resolves.toEqual([]);
  });

  it("still throws on a genuine, non-permission RPC error", async () => {
    const { client } = makeRpcClient({ data: null, error: { code: "08000" } });
    await expect(listOrgMembers(client, ORG_A)).rejects.toBeTruthy();
  });

  it("calls org_members_list scoped to the caller's own organization only (no cross-org member resolution)", async () => {
    const { client, calls } = makeRpcClient({ data: [], error: null });
    await listOrgMembers(client, ORG_A);
    expect(calls).toEqual([{ name: "org_members_list", args: { p_org_id: ORG_A } }]);
    expect(calls[0]!.args).not.toEqual({ p_org_id: ORG_B });
  });
});

describe("stageCounts tallies branch-scoped active leads", () => {
  it("counts leads per stage from the (RLS-scoped) base table", async () => {
    const rows = [{ stage: "new" }, { stage: "new" }, { stage: "qualified" }];
    const { client, calls } = makeClient(rows);
    const result = await stageCounts(client, ORG_A, BR);
    expect(hasEq(calls, "status", "active")).toBe(true);
    expect(hasEq(calls, "branch_id", BR)).toBe(true);
    const asMap = Object.fromEntries(result.map((r) => [r.stage, r.lead_count]));
    expect(asMap.new).toBe(2);
    expect(asMap.qualified).toBe(1);
  });
});

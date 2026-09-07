import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  sanitizeSearchTerm,
  listCustomers,
  listOrgMembers,
  listOrgMembersByBranch,
  memberNameMap,
  myOpenLeads,
  overdueFollowUps,
  followUpsDueToday,
  recentActivities,
  stageCounts,
} from "./sales";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAIRO = "c1111111-cccc-4ccc-8ccc-cccccccccccc";
const ZAYED = "c2222222-cccc-4ccc-8ccc-cccccccccccc";
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
 * `.rpc()` — `listOrgMembers` calls `sales_assignable_members` directly
 * rather than chaining `.from()`, so it needs its own mock shape from
 * `makeClient` above. `resultFor` maps a `p_branch_id` value (branch uuid or
 * the string "null" for the org-wide bucket) to that call's response, so a
 * single mock client can stand in for `listOrgMembersByBranch`'s N calls too.
 */
function makeRpcClient(
  resultFor: Record<string, { data: unknown[] | null; error: { code: string } | null }>,
) {
  const calls: { name: string; args: { p_org_id: string; p_branch_id: string | null } }[] = [];
  const client = {
    rpc(name: string, args: { p_org_id: string; p_branch_id: string | null }) {
      calls.push({ name, args });
      const key = args.p_branch_id ?? "null";
      const result = resultFor[key] ?? { data: [], error: null };
      return Promise.resolve(result);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { client, calls };
}

/**
 * F3's original fix (PR #43, first commit) called `org_members_list` — the
 * broader, `org.members.manage`-gated People-screen read-model — which
 * turned out to be a capability regression: `sales.assign` (the real
 * predicate every assignment write path requires) does not imply
 * `org.members.manage` (confirmed via the `sales_manager` preset,
 * `frontend/src/lib/org/roles.ts`, and `membership_set_capabilities()`
 * having no coupling rule between the two). The second fix swapped to
 * `sales_assignable_members` — a new, minimal, security-definer RPC
 * authorized on the SAME predicate the write paths already use — but
 * returned every active org member unfiltered by branch. A THIRD pass
 * (this one) closed the remaining product gap: a branch-scoped caller could
 * be offered a name from a branch they (or the target) can't access, only
 * discovering the mismatch when the write RPC rejected it. These tests
 * exercise the branch-parameterized RPC call (`p_branch_id`), the
 * per-branch fan-out (`listOrgMembersByBranch`), and `memberNameMap`'s
 * distinct "a 42501 is an expected outcome for a read-only, non-assigning
 * viewer" degrade-to-empty behavior.
 */
describe("listOrgMembers resolves teammate names through sales_assignable_members, never a raw id", () => {
  it("resolves Youssef's real name for the Customers/Leads assignment map, for a specific branch", async () => {
    const { client, calls } = makeRpcClient({
      [CAIRO]: {
        data: [
          { membership_id: "50000001-0000-4000-8000-000000000001", display_name: "Hana Mansour" },
          { membership_id: "50000002-0000-4000-8000-000000000002", display_name: "Youssef Amin" },
        ],
        error: null,
      },
    });
    const members = await listOrgMembers(client, ORG_A, CAIRO);
    expect(members).toEqual([
      { membershipId: "50000001-0000-4000-8000-000000000001", displayName: "Hana Mansour" },
      { membershipId: "50000002-0000-4000-8000-000000000002", displayName: "Youssef Amin" },
    ]);
    expect(calls).toEqual([{ name: "sales_assignable_members", args: { p_org_id: ORG_A, p_branch_id: CAIRO } }]);
    // The regression this guards: no entry's displayName is ever the raw/
    // truncated membership id.
    for (const m of members) {
      expect(m.displayName).not.toBe(m.membershipId);
      expect(m.displayName).not.toBe(m.membershipId.slice(0, 8));
    }
  });

  it("omits p_branch_id (never sends a bare JS null) for the org-wide bucket — the generated RPC arg type follows the SQL default and is optional, not nullable", async () => {
    const { client, calls } = makeRpcClient({
      null: { data: [{ membership_id: "50000001-0000-4000-8000-000000000001", display_name: "Amina" }], error: null },
    });
    await listOrgMembers(client, ORG_A, null);
    expect(calls[0]!.args).toEqual({ p_org_id: ORG_A });
    expect("p_branch_id" in calls[0]!.args).toBe(false);
  });

  it("listOrgMembersByBranch fans out one call per distinct branch and keys the result by branch id (\"\" = org-wide)", async () => {
    const { client, calls } = makeRpcClient({
      [CAIRO]: { data: [{ membership_id: "50000002-0000-4000-8000-000000000002", display_name: "Youssef Amin" }], error: null },
      [ZAYED]: { data: [{ membership_id: "50000001-0000-4000-8000-000000000001", display_name: "Hana Mansour" }], error: null },
      null: { data: [{ membership_id: "50000001-0000-4000-8000-000000000001", display_name: "Hana Mansour" }], error: null },
    });
    const byBranch = await listOrgMembersByBranch(client, ORG_A, [CAIRO, ZAYED, null, CAIRO]);
    // Deduped: CAIRO appears twice in input but is fetched once.
    expect(calls).toHaveLength(3);
    expect(byBranch[CAIRO]).toEqual([{ membershipId: "50000002-0000-4000-8000-000000000002", displayName: "Youssef Amin" }]);
    expect(byBranch[ZAYED]).toEqual([{ membershipId: "50000001-0000-4000-8000-000000000001", displayName: "Hana Mansour" }]);
    expect(byBranch[""]).toEqual([{ membershipId: "50000001-0000-4000-8000-000000000001", displayName: "Hana Mansour" }]);
  });

  it("memberNameMap (Customers/Leads/Follow-ups) merges every given branch and maps membership id -> resolved name", async () => {
    const { client } = makeRpcClient({
      [CAIRO]: { data: [{ membership_id: "50000002-0000-4000-8000-000000000002", display_name: "Youssef Amin" }], error: null },
      [ZAYED]: { data: [{ membership_id: "50000001-0000-4000-8000-000000000001", display_name: "Hana Mansour" }], error: null },
    });
    const map = await memberNameMap(client, ORG_A, [CAIRO, ZAYED]);
    expect(map.get("50000002-0000-4000-8000-000000000002")).toBe("Youssef Amin");
    expect(map.get("50000001-0000-4000-8000-000000000001")).toBe("Hana Mansour");
  });

  it("omits (never id-fallback) a member with no resolvable display name", async () => {
    const { client } = makeRpcClient({
      [CAIRO]: {
        data: [
          { membership_id: "50000003-0000-4000-8000-000000000003", display_name: "" },
          { membership_id: "50000004-0000-4000-8000-000000000004", display_name: "   " },
        ],
        error: null,
      },
    });
    const members = await listOrgMembers(client, ORG_A, CAIRO);
    expect(members).toEqual([]);
  });

  // Invited/suspended/revoked exclusion, same-org-only scoping, and the
  // branch-compatibility filter are all enforced INSIDE sales_assignable_members
  // (status = 'active', organization_id = p_org_id,
  // app.membership_can_access_branch(m.id, p_branch_id)) — proven against the
  // real database in supabase/tests/52_sales_assignable_members_test.sql, not
  // re-asserted here against a mock that can't express RLS/RPC-level filtering.

  it("listOrgMembers throws — never silently returns an empty list — on a 42501 from sales_assignable_members", async () => {
    // The regression this guards, precisely: every listOrgMembers call site
    // already gates on canAssign() (sales.assign OR sales.manage OR
    // org.manage) — the exact predicate sales_assignable_members itself now
    // enforces — so a 42501 here means the two have drifted out of sync, not
    // "no access as expected". Swallowing it into [] is what produced the F3
    // capability regression (an assignment dropdown with only "Unassigned",
    // no error); surfacing it instead means a caller who already passed
    // canAssign() never sees a silently-broken assignment control.
    const { client } = makeRpcClient({ [CAIRO]: { data: null, error: { code: "42501" } } });
    await expect(listOrgMembers(client, ORG_A, CAIRO)).rejects.toBeTruthy();
  });

  it("listOrgMembers throws on any other RPC error too (connectivity, config, unexpected RLS)", async () => {
    const { client } = makeRpcClient({ [CAIRO]: { data: null, error: { code: "08000" } } });
    await expect(listOrgMembers(client, ORG_A, CAIRO)).rejects.toBeTruthy();
  });

  it("memberNameMap degrades to an empty map on a 42501 — an EXPECTED outcome for a read-only viewer without sales.assign/manage", async () => {
    // Unlike listOrgMembers (always called after canAssign() passes),
    // memberNameMap is called by list/detail pages for EVERY viewer with
    // sales.read, including one who legitimately holds no assignment
    // authority at all. A 42501 there is not a contract mismatch — every id
    // then falls through to the caller's own "—" fallback, same as any other
    // unresolvable historical assignee.
    const { client } = makeRpcClient({ [CAIRO]: { data: null, error: { code: "42501" } } });
    const map = await memberNameMap(client, ORG_A, [CAIRO]);
    expect(map.size).toBe(0);
  });

  it("memberNameMap still throws on a non-permission RPC error (connectivity, config)", async () => {
    const { client } = makeRpcClient({ [CAIRO]: { data: null, error: { code: "08000" } } });
    await expect(memberNameMap(client, ORG_A, [CAIRO])).rejects.toBeTruthy();
  });

  it("calls sales_assignable_members scoped to the caller's own organization only (no cross-org member resolution)", async () => {
    const { client, calls } = makeRpcClient({ [CAIRO]: { data: [], error: null } });
    await listOrgMembers(client, ORG_A, CAIRO);
    expect(calls).toEqual([{ name: "sales_assignable_members", args: { p_org_id: ORG_A, p_branch_id: CAIRO } }]);
    expect(calls[0]!.args).not.toEqual({ p_org_id: ORG_B, p_branch_id: CAIRO });
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

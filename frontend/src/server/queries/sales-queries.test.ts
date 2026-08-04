import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  sanitizeSearchTerm,
  listCustomers,
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

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  countOpenJobOpportunities,
  listMyApplications,
  listOpportunityGovernorates,
  discoverableJobIds,
  countApplicationsByStatus,
  canReapply,
  APPLICATION_STATUSES,
  type MyApplicationRow,
} from "./job-opportunities";

type Result = { data?: unknown; error?: unknown };

/** A PostgREST builder stub; only the terminal call is thenable. */
function client(result: Result, byTable: Record<string, Result> = {}) {
  const calls: {
    table?: string;
    tables: string[];
    select?: string;
    or?: string;
    ors: string[];
    filters: [string, string, unknown][];
  } = { tables: [], ors: [], filters: [] };
  let current = result;
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "select") calls.select = args[0] as string;
    else if (name === "or") {
      calls.or = args[0] as string;
      calls.ors.push(args[0] as string);
    }
    else calls.filters.push([name, args[0] as string, args[1]]);
    return builder;
  };
  for (const m of ["select", "eq", "neq", "in", "or", "order", "limit", "range", "gte", "lte", "ilike"]) builder[m] = chain(m);
  builder.then = (res: (v: unknown) => unknown) => Promise.resolve(current).then(res);
  builder.maybeSingle = () => Promise.resolve(current);
  return {
    calls,
    supabase: {
      from: (t: string) => {
        calls.table = t;
        calls.tables.push(t);
        current = byTable[t] ?? result;
        return builder;
      },
    } as never,
  };
}

describe("listOpportunityGovernorates", () => {
  /**
   * `jobs.governorate` is free text a poster typed, not a key from the onboarding
   * catalog — so the options cannot come from a fixed list, and running these
   * values through `t()` would print the message path.
   */
  it("derives the option list from the openings that exist, deduped and sorted", async () => {
    const { supabase } = client({
      data: [
        { governorate: "Giza" },
        { governorate: "Cairo" },
        { governorate: "Cairo" },
        { governorate: null },
      ],
      error: null,
    });
    expect(await listOpportunityGovernorates(supabase)).toEqual(["Cairo", "Giza"]);
  });
});

describe("listMyApplications", () => {
  /**
   * NOT the discovery projection. This one is deliberately unfiltered by
   * verification and by the job still being open — an application has to outlive
   * the opening it was for.
   */
  it("reads the caller's own candidacies, newest first", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listMyApplications(supabase);
    expect(calls.table).toBe("my_job_applications");
    expect(calls.filters).toContainEqual(["order", "created_at", { ascending: false }]);
  });

  it("takes no user id — the projection resolves the caller itself", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listMyApplications(supabase);
    expect(calls.filters.some(([, c]) => c === "applicant_user_id")).toBe(false);
  });

  it("narrows to one state only when asked", async () => {
    const a = client({ data: [], error: null });
    await listMyApplications(a.supabase);
    expect(a.calls.filters.some(([m, c]) => m === "eq" && c === "status")).toBe(false);

    const b = client({ data: [], error: null });
    await listMyApplications(b.supabase, "withdrawn");
    expect(b.calls.filters).toContainEqual(["eq", "status", "withdrawn"]);
  });
});

describe("discoverableJobIds", () => {
  it("asks discovery, because an application row cannot see the poster's verification", async () => {
    const { supabase, calls } = client({ data: [{ id: "j1" }], error: null });
    const live = await discoverableJobIds(supabase, ["j1", "j2"]);
    expect(calls.table).toBe("open_job_opportunities");
    expect(live.has("j1")).toBe(true);
    expect(live.has("j2")).toBe(false);
  });

  it("issues no request at all for an empty list", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    expect((await discoverableJobIds(supabase, [])).size).toBe(0);
    expect(calls.tables).toEqual([]);
  });
});

describe("countApplicationsByStatus", () => {
  it("counts every state, including the empty ones", () => {
    const counts = countApplicationsByStatus([
      { status: "submitted" },
      { status: "submitted" },
      { status: "rejected" },
    ] as MyApplicationRow[]);
    expect(counts.submitted).toBe(2);
    expect(counts.rejected).toBe(1);
    expect(counts.accepted).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...APPLICATION_STATUSES].sort());
  });
});

describe("canReapply", () => {
  /**
   * The two gates `job_application_submit` applies to a withdrawn row, mirrored
   * so the UI does not offer an action that is guaranteed to be refused. The
   * decided states are the ones that matter: a rejected applicant must not be
   * able to walk back into a competition they were already told they lost.
   */
  it("allows a withdrawn candidacy back only while the job is genuinely live", () => {
    expect(canReapply({ status: "withdrawn", job_status: "open" }, true)).toBe(true);
    // Open, but the poster's verification lapsed — discovery says no.
    expect(canReapply({ status: "withdrawn", job_status: "open" }, false)).toBe(false);
    expect(canReapply({ status: "withdrawn", job_status: "closed" }, true)).toBe(false);
  });

  it("never allows it for a decided candidacy", () => {
    for (const status of ["accepted", "rejected", "submitted"] as const) {
      expect(canReapply({ status, job_status: "open" }, true)).toBe(false);
    }
  });
});

describe("countOpenJobOpportunities", () => {
  it("counts the open openings the caller has not applied to, from the same view as the list", async () => {
    const { supabase, calls } = client({ count: 27, error: null } as never);
    expect(await countOpenJobOpportunities(supabase)).toBe(27);
    expect(calls.tables).toContain("open_job_opportunities");
    expect(calls.filters).toContainEqual(["eq", "has_applied", false]);
  });

  it("is zero, not an error, when there is nothing open", async () => {
    const { supabase } = client({ count: null, error: null } as never);
    expect(await countOpenJobOpportunities(supabase)).toBe(0);
  });

  it("surfaces a read failure instead of reporting a number", async () => {
    const { supabase } = client({ count: null, error: new Error("boom") } as never);
    await expect(countOpenJobOpportunities(supabase)).rejects.toThrow("boom");
  });
});

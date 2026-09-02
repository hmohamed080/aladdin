import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  listOrgJobs,
  getOrgJob,
  listJobApplicants,
  getActiveAssignment,
  countByStatus,
  JOB_STATUSES,
  type JobListRow,
} from "./jobs";

type Result = { data?: unknown; error?: unknown };

/**
 * A PostgREST builder stub. Only the terminal call is thenable, because the
 * intermediate builder is chained, not awaited — the Increment 5 trap.
 *
 * `byTable` lets one stub answer two different reads, which is what the trade
 * seam needs: `jobs` comes back with a null embed, and `job_trade_labels`
 * answers separately. `tables` records the order they were asked in, so a test
 * can assert that the second request was NOT made.
 */
function client(result: Result, byTable: Record<string, Result> = {}) {
  const calls: {
    table?: string;
    tables: string[];
    select?: string;
    filters: [string, string, unknown][];
  } = { tables: [], filters: [] };
  let current = result;
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "select") calls.select = args[0] as string;
    else calls.filters.push([name, args[0] as string, args[1]]);
    return builder;
  };
  for (const m of ["select", "eq", "neq", "in", "order", "limit"]) builder[m] = chain(m);
  // Read `current` at await time, not at definition time — `from()` has already
  // pointed it at the right result by then.
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

const row = (over: Record<string, unknown> = {}) => ({
  id: "j1",
  status: "open",
  poster_org_id: "o1",
  trades: { key: "marble_granite" },
  job_applications: [{ count: 4 }],
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("listOrgJobs", () => {
  it("reads the trade key and the application count in ONE request", async () => {
    const { supabase, calls } = client({ data: [row()], error: null });
    const out = await listOrgJobs(supabase, "o1");
    expect(calls.table).toBe("jobs");
    expect(calls.select).toBe("*, trades(key), job_applications(count)");
    expect(out[0]!.tradeKey).toBe("marble_granite");
    expect(out[0]!.applicationCount).toBe(4);
  });

  it("scopes to the organization it was given", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listOrgJobs(supabase, "o1");
    expect(calls.filters).toContainEqual(["eq", "poster_org_id", "o1"]);
  });

  it("filters by status only when one is asked for", async () => {
    const a = client({ data: [], error: null });
    await listOrgJobs(a.supabase, "o1");
    expect(a.calls.filters.some(([m, c]) => m === "eq" && c === "status")).toBe(false);

    const b = client({ data: [], error: null });
    await listOrgJobs(b.supabase, "o1", "draft");
    expect(b.calls.filters).toContainEqual(["eq", "status", "draft"]);
  });

  /**
   * THE HISTORICAL-READ DEFECT. `trades_select_active` withholds RETIRED rows
   * from ordinary callers, so the embed comes back null even though
   * `jobs.trade_id` is `not null` — and the poster loses the label of a job they
   * posted themselves, in a trade they chose themselves.
   *
   * `job_trade_labels` answers for exactly those, and only those.
   */
  it("recovers a retired trade's label from the poster-side seam", async () => {
    const { supabase, calls } = client(
      { data: [row({ trades: null })], error: null },
      {
        job_trade_labels: {
          data: [{ job_id: "j1", trade_key: "marble_granite", trade_is_active: false }],
          error: null,
        },
      },
    );
    const out = await listOrgJobs(supabase, "o1");
    expect(calls.tables).toEqual(["jobs", "job_trade_labels"]);
    expect(out[0]!.tradeKey).toBe("marble_granite");
    // So the UI can say "no longer offered" instead of implying it is still
    // something the poster could choose today.
    expect(out[0]!.tradeRetired).toBe(true);
  });

  /**
   * The hot path stays at ONE request. Nothing is retired today, so the fallback
   * must not cost every list render a second round trip to discover that.
   */
  it("issues no second request when every label already resolved", async () => {
    const { supabase, calls } = client({ data: [row()], error: null });
    const out = await listOrgJobs(supabase, "o1");
    expect(calls.tables).toEqual(["jobs"]);
    expect(out[0]!.tradeRetired).toBe(false);
  });

  it("asks the seam only about the jobs whose label is missing", async () => {
    const { supabase, calls } = client(
      { data: [row({ id: "j1" }), row({ id: "j2", trades: null })], error: null },
      { job_trade_labels: { data: [], error: null } },
    );
    await listOrgJobs(supabase, "o1");
    expect(calls.filters).toContainEqual(["in", "job_id", ["j2"]]);
  });

  /**
   * The seam is scoped to the caller's own organizations, so it can legitimately
   * answer nothing — platform support reading a job of an org they do not belong
   * to. Losing a label is a gap; losing the row would be data loss.
   */
  it("still returns the job when even the seam cannot answer", async () => {
    const { supabase } = client(
      { data: [row({ trades: null })], error: null },
      { job_trade_labels: { data: [], error: null } },
    );
    const out = await listOrgJobs(supabase, "o1");
    expect(out).toHaveLength(1);
    expect(out[0]!.tradeKey).toBeNull();
    expect(out[0]!.tradeRetired).toBe(false);
  });

  it("treats a job nobody has applied to as zero, not undefined", async () => {
    const { supabase } = client({ data: [row({ job_applications: [] })], error: null });
    expect((await listOrgJobs(supabase, "o1"))[0]!.applicationCount).toBe(0);
  });

  it("throws rather than swallowing a database error", async () => {
    const { supabase } = client({ data: null, error: { message: "boom" } });
    await expect(listOrgJobs(supabase, "o1")).rejects.toBeTruthy();
  });
});

describe("getOrgJob", () => {
  /**
   * The detail page is where the label carries the most weight — it is the only
   * place the trade is stated in full, and on a DRAFT it is also the reason
   * Publish will refuse. It goes through the same seam as the list.
   */
  it("recovers a retired label on the detail read too", async () => {
    const { supabase, calls } = client(
      { data: row({ trades: null }), error: null },
      {
        job_trade_labels: {
          data: [{ job_id: "j1", trade_key: "plumbing", trade_is_active: false }],
          error: null,
        },
      },
    );
    const out = await getOrgJob(supabase, "j1");
    expect(calls.tables).toEqual(["jobs", "job_trade_labels"]);
    expect(out!.tradeKey).toBe("plumbing");
    expect(out!.tradeRetired).toBe(true);
  });

  it("costs one request for a job whose trade is current", async () => {
    const { supabase, calls } = client({ data: row({ id: "j9" }), error: null });
    const out = await getOrgJob(supabase, "j9");
    expect(calls.tables).toEqual(["jobs"]);
    expect(out!.tradeKey).toBe("marble_granite");
  });
});

describe("listJobApplicants", () => {
  /**
   * Not `job_applications`. That table carries a user id and no name, and the
   * poster cannot open the profile behind it — `job_applicants` is the one
   * authorized place an applicant's identity exists on this side.
   */
  it("reads the poster-side projection, never the raw table", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobApplicants(supabase, "j1");
    expect(calls.table).toBe("job_applicants");
    expect(calls.filters).toContainEqual(["eq", "job_id", "j1"]);
  });

  it("puts live candidacies first and decided ones last", async () => {
    const { supabase } = client({
      data: [
        { application_id: "1", status: "rejected" },
        { application_id: "2", status: "submitted" },
        { application_id: "3", status: "accepted" },
        { application_id: "4", status: "submitted" },
      ],
      error: null,
    });
    const out = await listJobApplicants(supabase, "j1");
    expect(out.map((a) => a.application_id)).toEqual(["2", "4", "3", "1"]);
  });

  /** A stable sort, so whoever has waited longest stays at the top. */
  it("keeps the applied-at order within a group", async () => {
    const { supabase } = client({
      data: [
        { application_id: "early", status: "submitted" },
        { application_id: "late", status: "submitted" },
      ],
      error: null,
    });
    const out = await listJobApplicants(supabase, "j1");
    expect(out.map((a) => a.application_id)).toEqual(["early", "late"]);
  });
});

describe("getActiveAssignment", () => {
  /**
   * A job accumulates cancelled assignments over successive rounds and exactly
   * one can be live — `ux_job_assignments_active_job`. Asking without the filter
   * would return whichever row the planner reached first.
   */
  it("excludes cancelled assignments, mirroring the database invariant", async () => {
    const { supabase, calls } = client({ data: null, error: null });
    await getActiveAssignment(supabase, "j1");
    expect(calls.table).toBe("job_assignments");
    expect(calls.filters).toContainEqual(["neq", "status", "cancelled"]);
  });

  it("returns null for a job that has never been awarded", async () => {
    const { supabase } = client({ data: null, error: null });
    expect(await getActiveAssignment(supabase, "j1")).toBeNull();
  });
});

describe("countByStatus", () => {
  it("counts every lifecycle state, including the empty ones", () => {
    const counts = countByStatus([
      { status: "draft" },
      { status: "open" },
      { status: "open" },
    ] as JobListRow[]);
    expect(counts.open).toBe(2);
    expect(counts.draft).toBe(1);
    // A tile for a state with nothing in it must read 0, not blank.
    expect(counts.cancelled).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...JOB_STATUSES].sort());
  });
});

describe("JOB_STATUSES", () => {
  it("is exactly the six the database enum has, in lifecycle order", () => {
    expect(JOB_STATUSES).toEqual([
      "draft",
      "open",
      "awarded",
      "completed",
      "closed",
      "cancelled",
    ]);
  });
});

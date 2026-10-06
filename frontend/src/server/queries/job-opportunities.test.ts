import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  countOpenJobOpportunities,
  listJobOpportunities,
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
    filters: [string, string, unknown][];
  } = { tables: [], filters: [] };
  let current = result;
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => (...args: unknown[]) => {
    if (name === "select") calls.select = args[0] as string;
    else if (name === "or") calls.or = args[0] as string;
    else calls.filters.push([name, args[0] as string, args[1]]);
    return builder;
  };
  for (const m of ["select", "eq", "neq", "in", "or", "order", "limit", "gte", "lte"]) builder[m] = chain(m);
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

describe("listJobOpportunities", () => {
  /**
   * The whole authority of this page. `open_job_opportunities` decides open-ness
   * and the poster's CURRENT verification inside its own definer; a query that
   * reached `jobs` directly would have to reproduce both, and would get one of
   * them wrong the first time verification lapsed.
   */
  it("reads the discovery projection, never the jobs table", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobOpportunities(supabase);
    expect(calls.table).toBe("open_job_opportunities");
  });

  it("orders newest published first, deterministically", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobOpportunities(supabase);
    expect(calls.filters).toContainEqual(["order", "published_at", { ascending: false }]);
  });

  it("applies no filter at all when none was asked for", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobOpportunities(supabase);
    expect(calls.or).toBeUndefined();
    expect(calls.filters.filter(([m]) => m === "eq")).toEqual([]);
  });

  /**
   * O5, AT THE QUERY LAYER. The default list is everything, and the trade filter
   * only appears when the reader chose one. A default of "my trades" would be
   * the restriction the database refuses to make, reintroduced as a convenience.
   */
  it("filters by trade ONLY when the reader picked one", async () => {
    const a = client({ data: [], error: null });
    await listJobOpportunities(a.supabase, {});
    expect(a.calls.filters.some(([m, c]) => m === "eq" && c === "trade_key")).toBe(false);

    const b = client({ data: [], error: null });
    await listJobOpportunities(b.supabase, { tradeKey: "electrical" });
    expect(b.calls.filters).toContainEqual(["eq", "trade_key", "electrical"]);
  });

  it("never consults the caller's declared trades", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobOpportunities(supabase, { tradeKey: "tiling" });
    expect(calls.tables).not.toContain("user_trades");
  });

  it("searches title, description and the posting organization together", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobOpportunities(supabase, { search: "marble" });
    expect(calls.or).toBe(
      "title.ilike.%marble%,description.ilike.%marble%,poster_org_name.ilike.%marble%",
    );
  });

  /** PostgREST reads `,` `(` `)` as grammar — a raw term would rewrite the filter. */
  it("neutralizes a search term before it reaches the filter grammar", async () => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobOpportunities(supabase, { search: "a,b)%*" });
    // The `%` around the value is OURS. What must be clean is the term inside it.
    const term = calls.or!.slice("title.ilike.%".length, calls.or!.indexOf("%,"));
    expect(term).toBe("a b");
  });

  it("filters by application state in both directions", async () => {
    const a = client({ data: [], error: null });
    await listJobOpportunities(a.supabase, { applied: "no" });
    expect(a.calls.filters).toContainEqual(["eq", "has_applied", false]);

    const b = client({ data: [], error: null });
    await listJobOpportunities(b.supabase, { applied: "yes" });
    expect(b.calls.filters).toContainEqual(["eq", "has_applied", true]);
  });

  it("throws rather than swallowing a database error", async () => {
    const { supabase } = client({ data: null, error: { message: "boom" } });
    await expect(listJobOpportunities(supabase)).rejects.toBeTruthy();
  });
});

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

describe("listJobOpportunities — board filters and sorts", () => {
  const run = async (f: Parameters<typeof listJobOpportunities>[1]) => {
    const { supabase, calls } = client({ data: [], error: null });
    await listJobOpportunities(supabase, f);
    return calls;
  };

  it("filters on real numeric amount bounds, both inclusive and independent", async () => {
    const both = await run({ minAmount: 2000, maxAmount: 4500.5 });
    expect(both.filters).toContainEqual(["gte", "offered_amount", 2000]);
    expect(both.filters).toContainEqual(["lte", "offered_amount", 4500.5]);

    const onlyMin = await run({ minAmount: 1000 });
    expect(onlyMin.filters.some(([m]) => m === "lte")).toBe(false);
    const onlyMax = await run({ maxAmount: 9000 });
    expect(onlyMax.filters.some(([m]) => m === "gte")).toBe(false);
  });

  it("invents no threshold: no bound means no amount filter at all", async () => {
    const none = await run({});
    expect(none.filters.some(([, col]) => col === "offered_amount")).toBe(false);
  });

  it("accepts a bound of zero as a real bound", async () => {
    const calls = await run({ minAmount: 0 });
    expect(calls.filters).toContainEqual(["gte", "offered_amount", 0]);
  });

  it("maps each duration bucket to its inclusive day range", async () => {
    const short = await run({ duration: "short" });
    expect(short.filters).toContainEqual(["lte", "expected_duration_days", 2]);
    expect(short.filters.some(([m]) => m === "gte")).toBe(false);

    const medium = await run({ duration: "medium" });
    expect(medium.filters).toContainEqual(["gte", "expected_duration_days", 3]);
    expect(medium.filters).toContainEqual(["lte", "expected_duration_days", 5]);

    const long = await run({ duration: "long" });
    expect(long.filters).toContainEqual(["gte", "expected_duration_days", 6]);
    expect(long.filters.some(([m]) => m === "lte")).toBe(false);
  });

  it("highest pay orders by amount first and newest second", async () => {
    const calls = await run({ sort: "highest" });
    const orders = calls.filters.filter(([m]) => m === "order");
    expect(orders[0]).toEqual(["order", "offered_amount", { ascending: false }]);
    expect(orders[1]).toEqual(["order", "published_at", { ascending: false }]);
  });

  it("newest (the default) orders by publication time only", async () => {
    const calls = await run({ sort: "newest" });
    expect(calls.filters.filter(([m]) => m === "order")).toEqual([["order", "published_at", { ascending: false }]]);
  });

  it("several trades narrow with IN; one trade with EQ; none leaves every trade", async () => {
    const many = await run({ tradeKeys: ["tiling", "painting"] });
    expect(many.filters).toContainEqual(["in", "trade_key", ["tiling", "painting"]]);

    const one = await run({ tradeKeys: ["tiling"] });
    expect(one.filters).toContainEqual(["eq", "trade_key", "tiling"]);

    const none = await run({ tradeKeys: [] });
    expect(none.filters.some(([, col]) => col === "trade_key")).toBe(false);
  });

  it("still accepts the single legacy tradeKey", async () => {
    const calls = await run({ tradeKey: "tiling" });
    expect(calls.filters).toContainEqual(["eq", "trade_key", "tiling"]);
  });
});

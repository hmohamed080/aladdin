import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  DURATION_BUCKETS,
  keysetOf,
  listDashboardOpportunities,
  listJobOpportunities,
  listJobOpportunityPage,
  type BoardOpportunityRow,
  type JobKeyset,
} from "./job-opportunities";

/**
 * THE JOBS BOARD'S READ LAYER, NOW A THIN CALLER OF THE DATABASE PAGING FUNCTION.
 *
 * Every question — discoverability, filters, sort, cursor, LIMIT — is one `job_opportunities_page` call, and the exact
 * total is a separate `job_opportunities_total` call asked for only on request. The ordering, the keyset continuation
 * and the scaling are proved against real rows in `supabase/tests/75_job_opportunities_page_test.sql`; this file proves
 * the application sends the database exactly the question the board means, and nothing else.
 */

type Call = { fn: string; args: Record<string, unknown> };

function rpcClient(handlers: Partial<Record<string, { data?: unknown; error?: unknown }>> = {}) {
  const calls: Call[] = [];
  const from = vi.fn();
  return {
    calls,
    from,
    supabase: {
      from,
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args });
        return Promise.resolve(handlers[fn] ?? { data: [], error: null });
      },
    } as never,
  };
}

const row = (n: number, over: Partial<BoardOpportunityRow> = {}) =>
  ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Job ${n}`,
    published_at: `2027-03-01T12:${String(60 - n).padStart(2, "0")}:00+00:00`,
    offered_amount: 1000 + n,
    proximity_tier: n % 4,
    skill_rank: n % 3,
    ...over,
  }) as BoardOpportunityRow;

describe("hostile input never reaches the database as anything but a bounded, inert VALUE", () => {
  const hostile = `'; drop table jobs; -- ") union select * from users /* ${"x".repeat(400)}`;

  it("search is sanitised and capped at the application edge (well inside the database's own 200-character bound)", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase, { search: hostile });
    const sent = String(calls[0]!.args.p_search);
    expect(sent.length).toBeLessThanOrEqual(100);
    // Quotes, semicolons, backticks, brackets, wildcards and slashes are stripped. (A hyphen survives, for names like
    // "Al-Ahram": a `--` is then just text, because the value is only ever a bound ILIKE pattern, never SQL.)
    expect(sent).not.toMatch(/['";`()*\\/]/);
  });

  it("every other filter is sent as a typed parameter of the paging function, never spliced into a string", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase, { governorateKey: "cairo", cityKey: "new-cairo", tradeKeys: ["painting"], minAmount: 1000, maxAmount: Number.NaN });
    const { args } = calls[0]!;
    expect(args).toMatchObject({ p_governorate_key: "cairo", p_city_key: "new-cairo", p_trade_keys: ["painting"], p_min_amount: 1000 });
    expect(args.p_max_amount).toBeUndefined(); // a non-finite number is dropped, not serialised
    for (const value of Object.values(args)) expect(typeof value === "string" ? value.length : 0).toBeLessThanOrEqual(100);
  });

  it("the call never names a user: the database takes identity from the session, so there is nothing to borrow", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase, { search: "x" });
    expect(Object.keys(calls[0]!.args).filter((k) => /user|uid|caller|applicant/i.test(k))).toEqual([]);
  });
});

describe("listJobOpportunities", () => {
  it("is ONE call to the database paging function, never a read of a view or of the jobs table", async () => {
    const { supabase, calls, from } = rpcClient();
    await listJobOpportunities(supabase);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("job_opportunities_page");
    expect(from).not.toHaveBeenCalled();
  });

  it("asks for newest, capped at 100 by default and never above what the database accepts", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase);
    await listJobOpportunities(supabase, { limit: 5000 });
    await listJobOpportunities(supabase, { limit: 0 });
    expect(calls.map((c) => [c.args.p_sort, c.args.p_limit])).toEqual([
      ["newest", 100],
      ["newest", 101],
      ["newest", 1],
    ]);
  });

  it("sends no filter at all when none was asked for — a trade, a place or an amount is never assumed", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase);
    const args = calls[0]!.args;
    for (const key of ["p_search", "p_trade_keys", "p_governorate_key", "p_city_key", "p_min_amount", "p_max_amount", "p_min_duration", "p_max_duration", "p_applied", "p_saved"]) {
      expect(args[key], key).toBeUndefined();
    }
  });

  it("maps every filter to the database's own parameter (keys, bounds, buckets, states)", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase, {
      search: "gypsum",
      tradeKey: "painting",
      tradeKeys: ["tiling", "painting"],
      governorateKey: "cairo",
      cityKey: "maadi",
      minAmount: 3000,
      maxAmount: 8000,
      duration: "medium",
      applied: "no",
      saved: true,
      sort: "highest",
    });
    expect(calls[0]!.args).toMatchObject({
      p_sort: "highest",
      p_search: "gypsum",
      p_trade_keys: ["painting", "tiling"],
      p_governorate_key: "cairo",
      p_city_key: "maadi",
      p_min_amount: 3000,
      p_max_amount: 8000,
      p_min_duration: DURATION_BUCKETS.medium.min,
      p_max_duration: DURATION_BUCKETS.medium.max,
      p_applied: false,
      p_saved: true,
    });
  });

  it("sends 'applied: yes' as true and leaves 'both' unset", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase, { applied: "yes" });
    await listJobOpportunities(supabase, {});
    expect(calls[0]!.args.p_applied).toBe(true);
    expect(calls[1]!.args.p_applied).toBeUndefined();
  });

  it("a city is only sent together with its governorate — a bare city key is meaningless", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase, { cityKey: "maadi" });
    expect(calls[0]!.args.p_city_key).toBeUndefined();
  });

  it("accepts a bound of zero as a real bound and ignores a non-number", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunities(supabase, { minAmount: 0, maxAmount: Number.NaN });
    expect(calls[0]!.args.p_min_amount).toBe(0);
    expect(calls[0]!.args.p_max_amount).toBeUndefined();
  });

  it("throws rather than swallowing a database error", async () => {
    const { supabase } = rpcClient({ job_opportunities_page: { error: new Error("boom") } });
    await expect(listJobOpportunities(supabase)).rejects.toThrow("boom");
  });
});

describe("keysetOf", () => {
  it("is one shape per sort, each ending on published_at then id", () => {
    const r = row(7);
    expect(keysetOf("newest", r)).toEqual({ sort: "newest", publishedAt: r.published_at, id: r.id });
    expect(keysetOf("highest", r)).toEqual({ sort: "highest", amount: 1007, publishedAt: r.published_at, id: r.id });
    expect(keysetOf("nearest", r)).toEqual({ sort: "nearest", tier: 3, publishedAt: r.published_at, id: r.id });
  });

  it("refuses a row that cannot anchor a page", () => {
    expect(() => keysetOf("newest", { ...row(1), id: "" })).toThrow();
  });
});

describe("listJobOpportunityPage", () => {
  it("reads one extra row to learn whether another page exists, and returns only `size`", async () => {
    const rows = [row(1), row(2), row(3)];
    const { supabase, calls } = rpcClient({ job_opportunities_page: { data: rows, error: null } });
    const page = await listJobOpportunityPage(supabase, { sort: "newest" }, 2);
    expect(calls[0]!.args.p_limit).toBe(3);
    expect(page.rows).toHaveLength(2);
    expect(page.next).toEqual({ sort: "newest", publishedAt: rows[1]!.published_at, id: rows[1]!.id });
  });

  it("has no next page when the database returned no more than `size` rows", async () => {
    const { supabase } = rpcClient({ job_opportunities_page: { data: [row(1), row(2)], error: null } });
    const page = await listJobOpportunityPage(supabase, {}, 2);
    expect(page.rows).toHaveLength(2);
    expect(page.next).toBeNull();
  });

  it("asks for the exact total ONLY when told to — a count is never paid per appended page", async () => {
    const { supabase, calls } = rpcClient({ job_opportunities_total: { data: 342, error: null } });
    const later = await listJobOpportunityPage(supabase, { sort: "newest" }, 6, { sort: "newest", publishedAt: "2027-03-01T10:00:00+00:00", id: row(1).id });
    expect(calls.map((c) => c.fn)).toEqual(["job_opportunities_page"]);
    expect(later.total).toBeNull();

    const first = await listJobOpportunityPage(supabase, { sort: "newest", governorateKey: "cairo" }, 6, null, { withTotal: true });
    expect(calls.map((c) => c.fn)).toEqual(["job_opportunities_page", "job_opportunities_page", "job_opportunities_total"]);
    expect(first.total).toBe(342);
    // the total is the SAME question, and carries no cursor and no sort
    expect(calls[2]!.args).toEqual({ p_governorate_key: "cairo" });
  });

  it("sends the cursor as the database's own keyset parameters, per sort", async () => {
    const { supabase, calls } = rpcClient();
    const at = "2027-03-01T10:00:00+00:00";
    const id = row(9).id;
    await listJobOpportunityPage(supabase, { sort: "newest" }, 6, { sort: "newest", publishedAt: at, id });
    await listJobOpportunityPage(supabase, { sort: "highest" }, 6, { sort: "highest", amount: 5000, publishedAt: at, id });
    await listJobOpportunityPage(supabase, { sort: "nearest" }, 6, { sort: "nearest", tier: 2, publishedAt: at, id });
    expect(calls.map((c) => [c.args.p_after_id, c.args.p_after_published_at, c.args.p_after_amount, c.args.p_after_tier])).toEqual([
      [id, at, undefined, undefined],
      [id, at, 5000, undefined],
      [id, at, undefined, 2],
    ]);
  });

  it("the first page sends no cursor at all", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunityPage(supabase, { sort: "nearest" }, 6);
    for (const key of ["p_after_id", "p_after_published_at", "p_after_amount", "p_after_tier"]) expect(calls[0]!.args[key]).toBeUndefined();
  });

  it("refuses a cursor minted for another ordering", async () => {
    const { supabase, calls } = rpcClient();
    const wrong: JobKeyset = { sort: "highest", amount: 1, publishedAt: "2027-03-01T10:00:00+00:00", id: row(1).id };
    await expect(listJobOpportunityPage(supabase, { sort: "newest" }, 6, wrong)).rejects.toThrow(/different ordering/);
    expect(calls).toHaveLength(0);
  });

  it("never asks the database for more than a page it accepts", async () => {
    const { supabase, calls } = rpcClient();
    await listJobOpportunityPage(supabase, {}, 5000);
    expect(calls[0]!.args.p_limit).toBe(101);
  });

  it("surfaces a read failure of either call", async () => {
    await expect(listJobOpportunityPage(rpcClient({ job_opportunities_page: { error: new Error("rows") } }).supabase, {}, 6)).rejects.toThrow("rows");
    await expect(
      listJobOpportunityPage(rpcClient({ job_opportunities_total: { error: new Error("count") } }).supabase, {}, 6, null, { withTotal: true }),
    ).rejects.toThrow("count");
  });
});

describe("listDashboardOpportunities — the strip's four orderings", () => {
  it("is the SAME paging function, with only a sort and a size — no filter, and every discoverable job stays listed", async () => {
    const { supabase, calls } = rpcClient();
    await listDashboardOpportunities(supabase, "best", 3);
    expect(calls[0]).toEqual({ fn: "job_opportunities_page", args: { p_sort: "best", p_limit: 3 } });
  });

  it.each(["best", "nearest", "newest", "oldest"] as const)("%s is passed to the database as its own ordering", async (mode) => {
    const { supabase, calls } = rpcClient();
    await listDashboardOpportunities(supabase, mode, 3);
    expect(calls[0]!.args.p_sort).toBe(mode);
  });

  it("surfaces a read failure rather than an empty strip", async () => {
    const { supabase } = rpcClient({ job_opportunities_page: { error: new Error("down") } });
    await expect(listDashboardOpportunities(supabase, "best", 3)).rejects.toThrow("down");
  });
});

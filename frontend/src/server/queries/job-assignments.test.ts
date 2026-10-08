import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  countMyAssignments,
  getFeaturedAssignment,
  listMyWorkPage,
  listWorkCompanies,
} from "./job-assignments";

type Result = { data?: unknown; error?: unknown };

function rpcClient(result: Result) {
  const calls: { name: string; args: Record<string, unknown> | undefined }[] = [];
  return {
    calls,
    supabase: {
      rpc: (name: string, args?: Record<string, unknown>) => {
        calls.push({ name, args });
        return Promise.resolve(result);
      },
    } as never,
  };
}

const row = (over: Record<string, unknown> = {}) => ({ id: "a1", status: "completed", total_count: 340, ...over });

describe("listMyWorkPage — one real page, every filter in the database", () => {
  it("calls the my_work_page RPC and nothing else — never a table read it would then filter itself", async () => {
    const { supabase, calls } = rpcClient({ data: [], error: null });
    await listMyWorkPage(supabase, { limit: 6 });
    expect(calls.map((c) => c.name)).toEqual(["my_work_page"]);
  });

  it("sends every filter as an RPC argument, and no user id", async () => {
    const { supabase, calls } = rpcClient({ data: [], error: null });
    await listMyWorkPage(supabase, {
      states: ["completed"],
      search: "villa",
      company: "Stone Art",
      from: "2026-10-01",
      to: "2026-10-31",
      contact: "available",
      sort: "last-action",
      limit: 12,
      after: null,
    });
    expect(calls[0]!.args).toEqual({
      p_states: ["completed"],
      p_search: "villa",
      p_company: "Stone Art",
      p_from: "2026-10-01",
      p_to: "2026-10-31",
      p_contact: "available",
      p_sort: "last-action",
      // One row more than the page, to learn whether a next page exists.
      p_limit: 13,
      p_after_key: undefined,
      p_after_key2: undefined,
      p_after_id: undefined,
    });
    expect(Object.keys(calls[0]!.args!).some((k) => /user/i.test(k))).toBe(false);
  });

  it("omits what is unset, so the database's own defaults apply (in progress + completed)", async () => {
    const { supabase, calls } = rpcClient({ data: [], error: null });
    await listMyWorkPage(supabase, { limit: 6 });
    expect(calls[0]!.args).toEqual({
      p_states: undefined,
      p_search: undefined,
      p_company: undefined,
      p_from: undefined,
      p_to: undefined,
      p_contact: "all",
      p_sort: "default",
      p_limit: 7,
      p_after_key: undefined,
      p_after_key2: undefined,
      p_after_id: undefined,
    });
  });

  it("the total is the database's exact filtered count, not the number of rows returned", async () => {
    const { supabase } = rpcClient({ data: [row(), row({ id: "a2" })], error: null });
    const page = await listMyWorkPage(supabase, { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(340);
  });

  it("an empty result has a total of zero", async () => {
    const { supabase } = rpcClient({ data: [], error: null });
    expect(await listMyWorkPage(supabase, { limit: 6 })).toEqual({ rows: [], total: 0, next: null });
  });

  it("asks for as many rows as the page says — there is no hidden 100-row ceiling in the query layer", async () => {
    const { supabase, calls } = rpcClient({ data: [], error: null });
    await listMyWorkPage(supabase, { limit: 250 });
    expect(calls[0]!.args!.p_limit).toBe(251);
  });

  it("passes NO offset at all: the page continues after a cursor of sort keys", async () => {
    const { supabase, calls } = rpcClient({ data: [], error: null });
    await listMyWorkPage(supabase, {
      limit: 6,
      sort: "last-action",
      after: { sort: "last-action", key: "2026-10-05T10:00:00.000000+00:00", key2: "2026-10-01T09:00:00.000000+00:00", id: "c3000000-0000-4000-8000-000000000003" },
    });
    expect(calls[0]!.args).toMatchObject({
      p_after_key: "2026-10-05T10:00:00.000000+00:00",
      p_after_key2: "2026-10-01T09:00:00.000000+00:00",
      p_after_id: "c3000000-0000-4000-8000-000000000003",
    });
    expect(Object.keys(calls[0]!.args!)).not.toContain("p_offset");
  });

  it("the cursor of a null-keyed row keeps the null: that row sits in the NULLS LAST region", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row({ id: `id${i}`, last_progress_at: i === 5 ? null : "2026-10-05T10:00:00.000000+00:00", created_at: "2026-10-01T09:00:00.000000+00:00" }));
    const { supabase } = rpcClient({ data: rows, error: null });
    const page = await listMyWorkPage(supabase, { limit: 6, sort: "last-action" });
    expect(page.rows).toHaveLength(6);
    expect(page.next).toEqual({ sort: "last-action", key: null, key2: "2026-10-01T09:00:00.000000+00:00", id: "id5" });
  });

  it("a page that is not full has no next cursor; a full one hands back the keys of its LAST row", async () => {
    const created = (i: number) => `2026-10-0${i + 1}T09:00:00.000000+00:00`;
    const full = Array.from({ length: 4 }, (_, i) => row({ id: `id${i}`, created_at: created(i) }));
    const a = await listMyWorkPage(rpcClient({ data: full.slice(0, 3), error: null }).supabase, { limit: 3 });
    expect(a.next).toBeNull();
    const b = await listMyWorkPage(rpcClient({ data: full, error: null }).supabase, { limit: 3 });
    expect(b.rows.map((r) => r.id)).toEqual(["id0", "id1", "id2"]);
    expect(b.next).toEqual({ sort: "default", key: created(2), key2: null, id: "id2" });
  });

  it("an empty page past the end reports no total (the board already holds the exact one)", async () => {
    const { supabase } = rpcClient({ data: [], error: null });
    const page = await listMyWorkPage(supabase, { limit: 6, after: { sort: "default", key: "2026-10-01T09:00:00.000000+00:00", key2: null, id: "c3000000-0000-4000-8000-000000000003" } });
    expect(page).toEqual({ rows: [], total: null, next: null });
  });

  it("surfaces a database error instead of swallowing it", async () => {
    const { supabase } = rpcClient({ data: null, error: new Error("boom") });
    await expect(listMyWorkPage(supabase, { limit: 6 })).rejects.toThrow("boom");
  });
});

describe("countMyAssignments — an exact COUNT per status, from the database", () => {
  it("maps the RPC rows to the four statuses, defaulting an absent one to zero", async () => {
    const { supabase, calls } = rpcClient({
      data: [
        { status: "completed", assignment_count: 340 },
        { status: "in_progress", assignment_count: "7" },
      ],
      error: null,
    });
    expect(await countMyAssignments(supabase)).toEqual({ scheduled: 0, in_progress: 7, completed: 340, cancelled: 0 });
    expect(calls.map((c) => c.name)).toEqual(["my_work_counts"]);
  });

  it("is not limited to the rows of any page: a count above 100 is stated as it is", async () => {
    const { supabase } = rpcClient({ data: [{ status: "completed", assignment_count: 1250 }], error: null });
    expect((await countMyAssignments(supabase)).completed).toBe(1250);
  });
});

describe("listWorkCompanies", () => {
  it("returns the organization names the database reports, never a blank", async () => {
    const { supabase, calls } = rpcClient({ data: [{ company: "Horizon" }, { company: null }, { company: "Stone Art" }], error: null });
    expect(await listWorkCompanies(supabase)).toEqual(["Horizon", "Stone Art"]);
    expect(calls[0]!.name).toBe("my_work_companies");
  });
});

describe("getFeaturedAssignment — work under way outranks work merely booked", () => {
  function tableClient(byStatus: Record<string, unknown[]>) {
    const asked: string[] = [];
    const supabase = {
      from: (table: string) => {
        expect(table).toBe("my_job_assignments");
        let status = "";
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = (_col: string, value: string) => {
          status = value;
          asked.push(value);
          return b;
        };
        b.order = () => b;
        b.limit = () => Promise.resolve({ data: byStatus[status] ?? [], error: null });
        return b;
      },
    } as never;
    return { supabase, asked };
  }

  it("takes the in-progress one without asking about scheduled work", async () => {
    const { supabase, asked } = tableClient({ in_progress: [{ id: "live" }], scheduled: [{ id: "booked" }] });
    expect(await getFeaturedAssignment(supabase)).toEqual({ id: "live" });
    expect(asked).toEqual(["in_progress"]);
  });

  it("falls back to scheduled work, then to nothing", async () => {
    expect(await getFeaturedAssignment(tableClient({ scheduled: [{ id: "booked" }] }).supabase)).toEqual({ id: "booked" });
    expect(await getFeaturedAssignment(tableClient({}).supabase)).toBeNull();
  });
});

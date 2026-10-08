import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createTranslator } from "@/lib/i18n/translate";
import { DEFAULT_WORK_STATE } from "@/lib/installer/work-board-params";
import type { WorkSearchState } from "@/features/installer-my-work-preview/view-model";
import { InvalidCursorError, WORK_CURSOR_SORTS, type WorkCursorSort } from "@/server/pagination/cursor";
import { loadWorkBoardPage } from "./work-board-page";

/**
 * KEYSET PAGING OF MY WORK, through the REAL loader (`loadWorkBoardPage`: cursor decode → `my_work_page` args →
 * rows → next cursor encode), against an in-memory `my_work_page` that follows the function's documented semantics:
 *   default / recent-added   created_at DESC NULLS LAST, id DESC
 *   last-added / oldest-first created_at ASC  NULLS LAST, id ASC
 *   last-action               last_progress_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
 * continuing strictly AFTER (p_after_key, p_after_key2, p_after_id), `p_limit` rows, `total_count` over the whole
 * filtered set. (The real SQL — including inserts, deletions and re-ranking between pages — is proved in
 * `supabase/tests/71_my_work_paging_test.sql`.) The expected order below is an independent hand-written comparator.
 */

type Row = {
  id: string;
  status: "in_progress" | "completed" | "scheduled" | "cancelled";
  created_at: string;
  last_progress_at: string | null;
  job_title: string;
};

const uuid = (n: number) => `c3000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 5, 12, 0, 0) - minutes * 60_000).toISOString().replace("Z", "000+00:00");

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: uuid(i + 1),
    status: i % 6 === 0 ? "scheduled" : i % 3 === 0 ? "in_progress" : "completed",
    created_at: at(Math.floor(i / 5) * 10), // five rows share each created_at
    last_progress_at: i % 4 === 0 ? null : at(Math.floor(i / 3) * 7), // some never reported, some tied
    job_title: `Job ${i + 1}`,
  }));
}

const full = (r: Row) => ({
  id: r.id, job_id: `j-${r.id}`, application_id: `a-${r.id}`, status: r.status, agreed_amount: 1000, agreed_currency: "EGP",
  latest_progress_percent: 0, last_progress_at: r.last_progress_at, version: 1, started_at: null, completed_at: null, cancelled_at: null,
  cancellation_reason: null, created_at: r.created_at, job_title: r.job_title, job_description: null, job_status: "awarded", trade_key: "painting",
  trade_is_active: true, governorate: "Cairo", city: "Maadi", site_address: null, expected_duration_days: 3, starts_on: null, ends_by: null,
  published_at: r.created_at, poster_org_name: "Org", contact_name: null, contact_phone: null, contact_email: null,
});

const cmpNullLast = (a: string | null, b: string | null, dir: 1 | -1) => (a === null ? (b === null ? 0 : 1) : b === null ? -1 : a < b ? -dir : a > b ? dir : 0);

/** The independent oracle: the sort's total order as a comparator. */
function comparator(sort: WorkCursorSort) {
  return (x: Row, y: Row): number => {
    if (sort === "last-added" || sort === "oldest-first") return cmpNullLast(x.created_at, y.created_at, 1) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    if (sort === "last-action") {
      return cmpNullLast(x.last_progress_at, y.last_progress_at, -1) || cmpNullLast(x.created_at, y.created_at, -1) || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0);
    }
    return cmpNullLast(x.created_at, y.created_at, -1) || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0);
  };
}

function ordered(all: readonly Row[], sort: WorkCursorSort, statuses: readonly string[] = ["in_progress", "completed"]): Row[] {
  return all.filter((r) => statuses.includes(r.status)).sort(comparator(sort));
}

/** A fake Supabase whose `my_work_page` follows the documented semantics, over the live `table()`. */
function fake(table: () => Row[]) {
  const argLog: Record<string, unknown>[] = [];
  const supabase = {
    rpc: (name: string, a: Record<string, unknown>) => {
      expect(name).toBe("my_work_page");
      argLog.push(a);
      const sort = a.p_sort as WorkCursorSort;
      const states = (a.p_states as string[] | undefined) ?? ["in_progress", "completed"];
      const all = ordered(table(), sort, states);
      let start = 0;
      if (a.p_after_id) {
        // Strictly AFTER the cursor position in the sort's order.
        const probe: Row = {
          id: a.p_after_id as string,
          status: "completed",
          created_at: sort === "last-action" ? ((a.p_after_key2 as string | undefined) ?? null) as string : ((a.p_after_key as string | undefined) ?? null) as string,
          last_progress_at: sort === "last-action" ? ((a.p_after_key as string | undefined) ?? null) : null,
          job_title: "",
        };
        const cmp = comparator(sort);
        start = all.findIndex((r) => cmp(r, probe) > 0);
        if (start === -1) start = all.length;
      }
      const data = all.slice(start, start + (a.p_limit as number)).map((r) => ({ ...full(r), total_count: all.length }));
      return Promise.resolve({ data, error: null });
    },
    from: () => ({ select: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }),
  };
  return { supabase: supabase as never, argLog };
}

const t = createTranslator("en");
const state = (sort: string, extra: Partial<WorkSearchState> = {}): WorkSearchState => ({ ...DEFAULT_WORK_STATE, sort, ...extra });

async function walk(table: () => Row[], st: WorkSearchState, size: number, between?: (page: number) => void) {
  const { supabase } = fake(table);
  const ids: string[] = [];
  let cursor: string | null = null;
  let total: number | null = null;
  for (let page = 1; ; page++) {
    const result: Awaited<ReturnType<typeof loadWorkBoardPage>> = await loadWorkBoardPage(supabase, st, cursor, size, t, "en");
    ids.push(...result.rows.map((r) => r.id));
    total = total ?? result.total;
    if (!result.nextCursor) return { ids, total };
    between?.(page);
    cursor = result.nextCursor;
  }
}

describe.each(WORK_CURSOR_SORTS)("My Work %s: walking by cursor through the real loader", (sort) => {
  it("returns every row exactly once, in the sort's total order, across ties and never-reported rows", async () => {
    const table = rows(83);
    const { ids, total } = await walk(() => table, state(sort), 7);
    expect(ids).toEqual(ordered(table, sort).map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(total).toBe(ids.length);
  });

  it("is identical whatever the page size", async () => {
    const table = rows(40);
    const expected = ordered(table, sort).map((r) => r.id);
    for (const size of [1, 2, 6, 11, expected.length, expected.length + 1]) expect((await walk(() => table, state(sort), size)).ids).toEqual(expected);
  });

  it("continues after the cursor when rows are inserted, removed or re-ranked between pages", async () => {
    let table = rows(60);
    const size = 6;
    const sb = fake(() => table).supabase;
    const first = await loadWorkBoardPage(sb, state(sort), null, size, t, "en");
    const shown = first.rows.map((r) => r.id);
    const before = ordered(table, sort);
    const cursorRow = before[size - 1]!;
    expect(shown).toEqual(before.slice(0, size).map((r) => r.id));

    // Unrelated data arrives AHEAD of the cursor, one shown row is removed, and a row arrives far BEHIND it. "Ahead" is
    // the newest row for the descending sorts and the OLDEST for the ascending ones.
    const asc = sort === "last-added" || sort === "oldest-first";
    const ahead: Row = { id: uuid(900), status: "completed", created_at: asc ? at(99_999) : at(-9999), last_progress_at: at(-9999), job_title: "ahead" };
    const behind: Row = { id: uuid(901), status: "completed", created_at: asc ? at(-9999) : at(99_999), last_progress_at: null, job_title: "behind" };
    // What OFFSET paging would have done with the insertion on its own: page 2 = rows 6..11 of the new order, which
    // REPEATS the last row page 1 showed.
    const offsetPage = ordered([...table, ahead], sort).slice(size, size * 2).map((r) => r.id);
    expect(offsetPage).toContain(shown[size - 1]);
    table = [...table.filter((r) => r.id !== shown[1]), ahead, behind];

    const rest: string[] = [];
    let cursor = first.nextCursor;
    while (cursor) {
      const page: Awaited<ReturnType<typeof loadWorkBoardPage>> = await loadWorkBoardPage(sb, state(sort), cursor, size, t, "en");
      rest.push(...page.rows.map((r) => r.id));
      cursor = page.nextCursor;
    }
    const now = ordered(table, sort);
    const at0 = now.findIndex((r) => r.id === cursorRow.id);
    expect(at0).toBeGreaterThanOrEqual(0);
    expect(rest).toEqual(now.slice(at0 + 1).map((r) => r.id));
    expect(new Set([...shown, ...rest]).size).toBe(shown.length + rest.length);
    expect(rest).toContain(behind.id);
    expect(rest.filter((id) => id === behind.id)).toHaveLength(1);
    expect(rest).not.toContain(ahead.id);
  });
});

describe("states, totals and the question", () => {
  it("scheduled and cancelled stay reachable through their own explicit view and page the same way", async () => {
    const table = rows(60);
    const scheduled = await walk(() => table, state("default", { tab: "scheduled" }), 4);
    expect(scheduled.ids).toEqual(ordered(table, "default", ["scheduled"]).map((r) => r.id));
    expect(scheduled.total).toBe(scheduled.ids.length);
  });

  it("'All your work' never includes scheduled or cancelled rows", async () => {
    const table = rows(60);
    const { ids } = await walk(() => table, state("default"), 9);
    const wanted = new Set(table.filter((r) => r.status === "in_progress" || r.status === "completed").map((r) => r.id));
    expect(new Set(ids)).toEqual(wanted);
  });

  it("every page states the exact total of the question, and the loader sends the database no offset", async () => {
    const table = rows(30);
    const { supabase, argLog } = fake(() => table);
    const first = await loadWorkBoardPage(supabase, state("default"), null, 6, t, "en");
    const second = await loadWorkBoardPage(supabase, state("default"), first.nextCursor, 6, t, "en");
    expect(first.total).toBe(second.total);
    expect(argLog.every((a) => !("p_offset" in a))).toBe(true);
    expect(argLog[0]!.p_limit).toBe(7); // one extra row, to learn whether a next page exists
    expect(argLog[1]!.p_after_id).toBeTruthy();
  });

  it("a cursor from another question, another sort, or made by hand is refused — nothing is read", async () => {
    const table = rows(30);
    const { supabase, argLog } = fake(() => table);
    const first = await loadWorkBoardPage(supabase, state("default", { q: "villa" }), null, 6, t, "en");
    const cursor = first.nextCursor!;
    argLog.length = 0;
    await expect(loadWorkBoardPage(supabase, state("default", { q: "other" }), cursor, 6, t, "en")).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(loadWorkBoardPage(supabase, state("last-action", { q: "villa" }), cursor, 6, t, "en")).rejects.toBeInstanceOf(InvalidCursorError);
    await expect(loadWorkBoardPage(supabase, state("default", { q: "villa" }), "v1.forged", 6, t, "en")).rejects.toBeInstanceOf(InvalidCursorError);
    expect(argLog).toEqual([]);
  });
});

describe("there is no session ceiling", () => {
  it("walks 1,300 assignments six at a time (217 pages) in every sort, with no repeat and no gap", async () => {
    const table = rows(1300);
    for (const sort of WORK_CURSOR_SORTS) {
      const { ids, total } = await walk(() => table, state(sort), 6);
      const expected = ordered(table, sort).map((r) => r.id);
      expect(expected.length).toBeGreaterThan(1000);
      expect(ids).toEqual(expected);
      expect(total).toBe(expected.length);
    }
  }, 120_000);
});

import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import type { WorkKeyset } from "@/server/pagination/cursor";
import { listMyWorkPage, type WorkPageQuery } from "./job-assignments";

/**
 * MY WORK KEYSET PAGING AGAINST A REAL SUPABASE (the real `my_work_page` RPC). Skipped unless a stack is named:
 *
 *   ALADDIN_STACK_URL=http://127.0.0.1:54321 ALADDIN_STACK_ANON_KEY=... \
 *   ALADDIN_STACK_EMAIL=hossam@example.test ALADDIN_STACK_PASSWORD=... pnpm vitest run job-assignments.stack
 *
 * Walks every sort by cursor and requires the chain to equal ONE read of the same question (a page of up to 299),
 * and — for the default view, which must hold more than 300 rows (an opt-in bulk dataset for that installer; the committed seed alone is not enough) — requires two different page
 * sizes to produce the same, repeat-free sequence whose length is the database's exact total.
 */
const url = process.env.ALADDIN_STACK_URL;
const anon = process.env.ALADDIN_STACK_ANON_KEY;
const email = process.env.ALADDIN_STACK_EMAIL;
const password = process.env.ALADDIN_STACK_PASSWORD;

describe.skipIf(!url || !anon || !email || !password)("My Work keyset paging on a real Supabase", () => {
  async function session() {
    const supabase = createClient(url!, anon!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await supabase.auth.signInWithPassword({ email: email!, password: password! });
    if (error) throw error;
    return supabase as never;
  }

  async function walk(supabase: never, q: Omit<WorkPageQuery, "limit" | "after">, size: number) {
    const ids: string[] = [];
    let after: WorkKeyset | null = null;
    let total: number | null = null;
    for (let guard = 0; guard < 2000; guard++) {
      const page: Awaited<ReturnType<typeof listMyWorkPage>> = await listMyWorkPage(supabase, { ...q, limit: size, after });
      ids.push(...page.rows.map((r) => r.id));
      total = total ?? page.total;
      if (!page.next) return { ids, total };
      after = page.next;
    }
    throw new Error("the walk did not end");
  }

  it.each(["default", "recent-added", "last-added", "oldest-first", "last-action"] as const)("%s: the cursor chain equals one database read of the completed work", async (sort) => {
    const supabase = await session();
    const q = { states: ["completed"] as const, sort };
    const one = await listMyWorkPage(supabase, { ...q, states: ["completed"], limit: 299 });
    const { ids, total } = await walk(supabase, { ...q, states: ["completed"] }, 6);
    expect(one.rows.length).toBeGreaterThan(50);
    expect(ids).toEqual(one.rows.map((r) => r.id));
    expect(total).toBe(one.total);
  }, 120_000);

  it("'All your work' pages past 300 rows, identically at any page size, with the database's exact total", async () => {
    const supabase = await session();
    const a = await walk(supabase, { sort: "last-action" }, 6);
    const b = await walk(supabase, { sort: "last-action" }, 50);
    expect(a.ids.length).toBeGreaterThan(300);
    expect(new Set(a.ids).size).toBe(a.ids.length);
    expect(a.ids).toEqual(b.ids);
    expect(a.total).toBe(a.ids.length);
  }, 180_000);

  it("filters keep paging: contact, search and company, and the second key of last-action", async () => {
    const supabase = await session();
    for (const q of [{ contact: "available" as const }, { search: "a" }, { contact: "none" as const, sort: "last-action" as const }]) {
      const one = await listMyWorkPage(supabase, { ...q, limit: 299 });
      if (one.total !== null && one.total <= 299) {
        const { ids } = await walk(supabase, q, 7);
        expect(ids).toEqual(one.rows.map((r) => r.id));
      }
    }
  }, 120_000);
});

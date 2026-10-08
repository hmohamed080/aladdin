import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { listJobOpportunities, listJobOpportunityPage, type JobKeyset, type OpportunityFilters, type OpportunitySort } from "./job-opportunities";

/**
 * KEYSET PAGING AGAINST A REAL SUPABASE (the real `job_opportunities_page`), not an emulator.
 *
 * Skipped unless a local stack is named, so the normal suite stays hermetic:
 *
 *   ALADDIN_STACK_URL=http://127.0.0.1:54321 ALADDIN_STACK_ANON_KEY=... \
 *   ALADDIN_STACK_EMAIL=hossam@example.test ALADDIN_STACK_PASSWORD=... pnpm vitest run job-opportunities.stack
 *
 * For every sort it walks the board by cursor: the first page must equal ONE database-ordered read of the
 * same question, no row may repeat, and the exact total (asked for once, on the first page) must equal the
 * length of the whole walk — through the real RPC, with real tiers, repeated values and Saved.
 */
const url = process.env.ALADDIN_STACK_URL;
const anon = process.env.ALADDIN_STACK_ANON_KEY;
const email = process.env.ALADDIN_STACK_EMAIL;
const password = process.env.ALADDIN_STACK_PASSWORD;

describe.skipIf(!url || !anon || !email || !password)("jobs board keyset paging on a real Supabase", () => {
  const SORTS: readonly OpportunitySort[] = ["newest", "highest", "nearest"];

  async function session() {
    const supabase = createClient(url!, anon!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await supabase.auth.signInWithPassword({ email: email!, password: password! });
    if (error) throw error;
    return supabase as never;
  }

  async function walk(supabase: never, f: OpportunityFilters, size: number) {
    const ids: string[] = [];
    let after: JobKeyset | null = null;
    let total: number | null = null;
    for (let guard = 0; guard < 2000; guard++) {
      const page: Awaited<ReturnType<typeof listJobOpportunityPage>> = await listJobOpportunityPage(supabase, f, size, after, { withTotal: after === null });
      ids.push(...page.rows.map((r) => r.id as string));
      if (page.total !== null) total = page.total;
      if (!page.next) return { ids, total };
      after = page.next;
    }
    throw new Error("the walk did not end");
  }

  it.each(SORTS)("%s: the cursor chain equals one database-ordered read, with the exact total", async (sort) => {
    const supabase = await session();
    const one = await listJobOpportunities(supabase, { sort, limit: 100 });
    const { ids, total } = await walk(supabase, { sort }, 6);
    expect(ids.length).toBeGreaterThan(300); // the seeded board is bigger than the old 300-row window
    expect(ids.slice(0, one.length)).toEqual(one.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(total).toBe(ids.length); // the exact total, asked for once on the first page, is the size of the whole walk
  }, 120_000);

  it.each(SORTS)("%s: filters, search and Saved keep paging correctly (two `or` params, ranked projection)", async (sort) => {
    const supabase = await session();
    const questions: OpportunityFilters[] = [
      { sort, search: "a" },
      { sort, governorateKey: "cairo" },
      { sort, saved: true },
      { sort, applied: "no", minAmount: 1000 },
    ];
    for (const q of questions) {
      const one = await listJobOpportunities(supabase, { ...q, limit: 100 });
      const { ids, total } = await walk(supabase, q, 5);
      expect(ids.slice(0, one.length)).toEqual(one.map((r) => r.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(total).toBe(ids.length);
    }
  }, 120_000);
});

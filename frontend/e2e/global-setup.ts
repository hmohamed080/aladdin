import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Deterministic local-E2E seed (Sprint 6.2 follow-up). Playwright runs this ONCE
 * before any project (workers=1, single invocation — never concurrently), so
 * every `pnpm e2e` starts from a known-clean SALES state regardless of what a
 * prior run, a destructive scenario, or a concurrency script left behind.
 *
 * It does NOT run migrations or touch identity/tenancy (the maintainer resets
 * those once with `supabase db reset`). It only:
 *   1. truncates the sales fixtures (E2E-created rows accumulate otherwise),
 *   2. restores the two seeded memberships to `active` and strips any leaked
 *      org-wide capabilities from the Cairo rep (its branch-limited scope is what
 *      several tests assert — a leaked `sales.manage`/`org.manage` breaks them),
 *   3. re-applies the documented demo seed.
 * With this in place, running the standard command twice back-to-back is stable
 * with no manual reset between runs.
 */
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const MANAGER = "e1111111-eeee-4eee-8eee-eeeeeeeeeee1";
const REP = "e2222222-eeee-4eee-8eee-eeeeeeeeeee2";

const RESET_SQL = `
begin;
truncate table public.sales_activities, public.follow_up_tasks, public.leads, public.customers cascade;
update public.memberships set status = 'active' where id in ('${MANAGER}', '${REP}');
delete from public.membership_capabilities
  where membership_id = '${REP}'
    and capability_key in ('sales.manage', 'sales.assign', 'org.manage', 'org.members.manage', 'branch.manage');
commit;
`;

function psql(sql: string): void {
  execSync(`docker exec -i ${DB} psql -U postgres -d postgres -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ["pipe", "ignore", "inherit"],
  });
}

export default function globalSetup(): void {
  psql(RESET_SQL);
  // cwd is the frontend package when run via `pnpm --filter frontend e2e`.
  psql(readFileSync(path.resolve(process.cwd(), "../supabase/demo-seed.sql"), "utf8"));
}

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
 *   3. restores the two PENDING pilot organization reviews (the Pilot UAT round-1
 *      acceptance approves one of them, which is irreversible through the RPCs),
 *   4. re-applies the documented demo seed.
 * With this in place, running the standard command twice back-to-back is stable
 * with no manual reset between runs.
 */
const DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_aladdin";
const MANAGER = "e1111111-eeee-4eee-8eee-eeeeeeeeeee1";
const REP = "e2222222-eeee-4eee-8eee-eeeeeeeeeee2";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAIRO = "c1111111-cccc-4ccc-8ccc-cccccccccccc";
const AMINA = "11111111-1111-4111-8111-111111111111";
// Pilot world (supabase/seed-pilot.sql): the two organizations awaiting review and
// their verification rows.
const ORG_MARBLE = "9d000000-dddd-4ddd-8ddd-000000000002";
const ORG_IMPORT = "9e000000-eeee-4eee-8eee-000000000003";
const MARBLE_REVIEW = "d6000001-0000-4000-8000-000000000001";
const IMPORT_REVIEW = "d6000002-0000-4000-8000-000000000002";
// Deterministic pending invitation to a-cairo@example.test (Karim) so the
// invitation-entry E2E has a known token each run (reset to pending here).
export const E2E_INVITE_TOKEN = "e2e0invite0token0cairo0000000000000000";

const RESET_SQL = `
begin;
truncate table public.sales_activities, public.follow_up_tasks, public.leads, public.customers cascade;
update public.memberships set status = 'active' where id in ('${MANAGER}', '${REP}');
delete from public.membership_capabilities
  where membership_id = '${REP}'
    and capability_key in ('sales.manage', 'sales.assign', 'org.manage', 'org.members.manage', 'branch.manage');
delete from public.organization_invitations where email = 'a-cairo@example.test';
insert into public.organization_invitations
  (organization_id, email, primary_branch_id, token, status, invited_by, expires_at)
values ('${ORG_A}', 'a-cairo@example.test', '${CAIRO}', '${E2E_INVITE_TOKEN}', 'pending', '${AMINA}', now() + interval '14 days');
-- Pilot review queue: an APPLIED verification is immutable by design, so the two
-- pending organization reviews are recreated rather than reset in place, and the
-- organizations they decide on are returned to pending_verification.
delete from public.verifications where id in ('${MARBLE_REVIEW}', '${IMPORT_REVIEW}');
insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at)
values ('${MARBLE_REVIEW}', 'organization', '${ORG_MARBLE}', 'organization', 'submitted', now() - interval '2 days'),
       ('${IMPORT_REVIEW}', 'organization', '${ORG_IMPORT}', 'organization', 'submitted', now() - interval '1 day');
update public.organizations set status = 'pending_verification', is_verified = false
  where id in ('${ORG_MARBLE}', '${ORG_IMPORT}');
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

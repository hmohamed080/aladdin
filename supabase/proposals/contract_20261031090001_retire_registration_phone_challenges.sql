-- PROPOSAL (CONTRACT STEP) - NOT A MIGRATION YET. Do not move this into supabase/migrations until every condition below is true.
--
-- Why it is here and not in supabase/migrations: every file in that directory is applied by the next `supabase db push --linked` to whichever
-- project is pushed, in order, with no knowledge of which application build is deployed there. A DROP that is merged early can therefore run
-- ahead of the application that no longer needs the table, and any older build still serving traffic would fail every mobile sign-up with a
-- missing-table error. Expand/contract means this step ships LATER, by itself, after the application has moved.
--
-- The table: public.phone_verification_challenges, created by 20261028090001 (PR #113) so the sign-up server could store an HMAC of a code it
-- generated itself. From R2 on, the sign-up flow uses the phone verification authority (app.phone_verification_challenges, 20261030090001/2) and
-- nothing reads or writes this table. It is harmless to keep (RLS on, service_role only, rows live <= 30 minutes) - dropping it only removes a
-- second, weaker authority from the schema. It is NOT a security fix and must not be rushed.
--
-- PROMOTE TO A MIGRATION ONLY WHEN ALL OF THESE ARE TRUE (record each in the PR):
--   1. The R2 application build is live on EVERY environment that will receive this migration (Acceptance, then Production), and
--   2. no earlier build that references the table can still serve traffic or be rolled back to (the previous Production build is retired, or
--      the rollback plan has been re-written without it), and
--   3. the owner approves the apply for that environment, and a read-only migration-history inspection has confirmed which migrations that
--      project already has (scripts/hosted-db/inspect-auth-security.mjs --only migrations).
-- Promote it with a NEW timestamp later than every migration then in the repo; keep the body.
--
-- The guard below makes a premature run fail loudly instead of breaking sign-ups: it refuses while codes were issued in the last hour (an older
-- build is still handing them out) and cascades nothing.
do $$
declare
  v_recent boolean := false;
begin
  -- A project that never had 20261028090001 has no such table: nothing to guard, nothing to drop.
  if to_regclass('public.phone_verification_challenges') is not null then
    execute 'select exists (select 1 from public.phone_verification_challenges where created_at > now() - interval ''1 hour'')' into v_recent;
  end if;
  if v_recent then
    raise exception 'refusing to drop public.phone_verification_challenges: codes were issued in the last hour, so a build that still uses it is serving traffic';
  end if;
end
$$;

-- Plain DROP, no CASCADE: if anything unexpected depends on the table the migration fails instead of taking the dependent with it.
drop table if exists public.phone_verification_challenges;

-- READ-ONLY readiness check for RF-001 (docs/operations/RELEASE_FOLLOWUPS.md, issue #135): is it safe to promote
-- supabase/proposals/contract_20261031090001_retire_registration_phone_challenges.sql into supabase/migrations on THIS environment?
--
-- Run it against ONE environment at a time, read-only, for example:
--   supabase db query --linked --project-ref <ref> -f supabase/proposals/readiness_check_legacy_phone_challenges.sql
-- It is a single SELECT (no DDL, no DML, no function creation). It works whether or not the legacy table exists and whether or not the
-- R2 authority is installed, because every access to an object that may be missing goes through to_regclass + query_to_xml under a CASE.
--
-- It answers the DATABASE half of the promotion conditions (see the proposal header). Two conditions are NOT database facts and stay an
-- owner attestation recorded in the promotion PR: (a) the R2 application build is the live build on that environment, and (b) no
-- deployment that references the table is still a rollback target there.
--
-- safe_to_promote = true means: the table is absent (the DROP would be a no-op), OR it is idle (no code issued in 24 h), nothing depends
-- on it (no foreign key, view or function body mentions it), and the R2 authority is installed, switched on and has issued a grant in the
-- last 7 days (R2 is demonstrably serving sign-ups).
with probe as (
  select to_regclass('public.phone_verification_challenges') as legacy,
         to_regclass('app.phone_signup_grants')              as grants,
         to_regclass('app.phone_verification_config')        as cfg
), facts as (
  select
    (legacy is not null) as legacy_table_exists,
    case when legacy is null then 0 else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.phone_verification_challenges', false, true, '')))[1]::text::int end as legacy_rows_total,
    case when legacy is null then 0 else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.phone_verification_challenges where created_at > now() - interval ''24 hours''', false, true, '')))[1]::text::int end as legacy_rows_last_24h,
    case when legacy is null then 0 else (select count(*)::int from pg_constraint c where c.confrelid = legacy) end as foreign_keys_into_legacy,
    case when legacy is null then 0 else (select count(*)::int from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class where d.refobjid = legacy and v.oid <> legacy) end as views_depending_on_legacy,
    (select count(*)::int from pg_proc p where p.prosrc ~* 'public\.phone_verification_challenges') as functions_mentioning_legacy,
    (grants is not null and cfg is not null) as r2_authority_installed,
    case when cfg is null then false else coalesce((xpath('/row/v/text()', query_to_xml('select (enabled and signup_enabled)::text as v from app.phone_verification_config limit 1', false, true, '')))[1]::text = 'true', false) end as r2_switches_on,
    case when grants is null then 0 else (xpath('/row/n/text()', query_to_xml('select count(*) as n from app.phone_signup_grants where created_at > now() - interval ''7 days''', false, true, '')))[1]::text::int end as r2_grants_last_7_days
  from probe
)
select facts.*,
       (not legacy_table_exists)
       or (legacy_rows_last_24h = 0 and foreign_keys_into_legacy = 0 and views_depending_on_legacy = 0 and functions_mentioning_legacy = 0
           and r2_authority_installed and r2_switches_on and r2_grants_last_7_days >= 1) as safe_to_promote
from facts;

-- pgTAP: the Admin organization directory/detail follow the REAL application workflow, step by step
-- (companion to 137, which pins the read rules on directly-inserted fixture rows).
--
-- Every state change here goes through the real RPCs, each called as `authenticated` with the caller's own JWT claims:
--   owner:    business_draft_save -> business_draft_submit -> organization_application_submit -> organization_application_abandon
--   reviewer: review_start -> review_reject / review_approve
-- After every step the admin directory row and the admin detail are read and must agree.
-- (The RPC rules themselves - finality of a rejection, abandon idempotency, one open application - are pinned in 77.)
create extension if not exists pgtap;

begin;
select plan(30);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('13800001-0000-4000-8000-000000000138', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p138-1@example.test', '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', 'P138 1', 'locale', 'en'), now(), now(), now());
update public.users set primary_account_type = 'engineer' where id = '13800001-0000-4000-8000-000000000138';

\set owner '{"sub":"13800001-0000-4000-8000-000000000138","role":"authenticated"}'
\set adm   '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

create function pg_temp.admin_list(p_status text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
  execute 'set local role authenticated';
  r := public.admin_organizations_list('Rho Flow', p_status, null, 'registered:asc', 1, 25);
  execute 'reset role';
  return r;
end $$;
create function pg_temp.admin_detail(p_id uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
  execute 'set local role authenticated';
  r := public.admin_organization_detail(p_id);
  execute 'reset role';
  return r;
end $$;
create function pg_temp.row_of(p jsonb, p_id uuid) returns jsonb language sql as $$
  select r from jsonb_array_elements(p -> 'rows') r where (r ->> 'id')::uuid = p_id $$;

-- ===========================================================================
-- 1. The owner opens and submits the first application
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'owner';
select isnt(public.business_draft_save(p_legal_name => 'Rho Flow One LLC', p_display_name => 'Rho Flow One', p_org_type => 'design_office'), null,
  '1: the owner opens an application');
insert into _ids select 'o1', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '13800001-0000-4000-8000-000000000138' and completed_at is null));
insert into _ids select 'a1', public.organization_application_submit((select id from _ids where k = 'o1'));
reset role;

select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o1')) ->> 'approval_state', 'pending',
  '2: submitted application -> directory approval pending');
select is(pg_temp.admin_detail((select id from _ids where k = 'o1')) ->> 'approval_state', 'pending', '3: detail agrees (pending)');
select is((pg_temp.admin_list('pending') ->> 'total')::int, 1, '4: it is the one organization under the Pending tab');
select is((pg_temp.admin_list(null) -> 'counts' ->> 'rejected')::int, 0, '5: nothing under Rejected yet');

-- ===========================================================================
-- 2. A reviewer rejects it
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'a1')), '6: reviewer claims it');
select lives_ok(format($q$select public.review_reject(%L, %L)$q$, (select id from _ids where k = 'a1'), 'Licence missing.'), '7: reviewer rejects it');
reset role;

select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o1')) ->> 'approval_state', 'rejected',
  '8: rejected application -> directory approval rejected');
select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o1')) ->> 'status', 'pending_verification',
  '9: while the lifecycle status is still pending_verification (the two are separate)');
select is(pg_temp.admin_detail((select id from _ids where k = 'o1')) ->> 'approval_state', 'rejected', '10: detail agrees (rejected)');
select is(pg_temp.admin_detail((select id from _ids where k = 'o1')) ->> 'latest_verification_status', 'rejected', '11: detail exposes the latest decision');
select is((pg_temp.admin_list('rejected') ->> 'total')::int, 1, '12: it is the one organization under the Rejected tab');
select is((pg_temp.admin_list(null) -> 'counts' ->> 'pending')::int, 0, '13: and no longer counted as Pending');
select is((pg_temp.admin_list(null) -> 'counts' ->> 'rejected')::int, (pg_temp.admin_list('rejected') ->> 'total')::int,
  '14: the Rejected count equals the Rejected tab total');

-- ===========================================================================
-- 3. The owner abandons the rejected application (rejection is final; there is no resubmission)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'owner';
select lives_ok(format($q$select public.organization_application_abandon(%L)$q$, (select id from _ids where k = 'o1')), '15: the owner abandons it');
reset role;

select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o1')) ->> 'status', 'archived', '16: lifecycle -> archived');
select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o1')) ->> 'approval_state', 'none',
  '17: an abandoned application is neither pending nor rejected (approval none)');
select is(pg_temp.admin_detail((select id from _ids where k = 'o1')) ->> 'latest_verification_status', 'cancelled', '18: the latest request is the closing cancelled record');
select is(pg_temp.admin_detail((select id from _ids where k = 'o1')) ->> 'approval_state', 'none', '19: detail agrees (none)');
select is((pg_temp.admin_list(null) -> 'counts' ->> 'rejected')::int, 0, '20: it leaves the Rejected tab');
select is((select count(*)::int from public.verifications where organization_id = (select id from _ids where k = 'o1') and status = 'rejected'), 1,
  '21: the rejection itself is preserved in the history');

-- ===========================================================================
-- 4. The same owner applies anew; the directory shows both, separately
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = :'owner';
select isnt(public.business_draft_save(p_legal_name => 'Rho Flow Two LLC', p_display_name => 'Rho Flow Two', p_org_type => 'design_office'), null,
  '22: the owner opens a NEW application');
insert into _ids select 'o2', public.business_draft_submit(
  (select id from public.business_creation_drafts where user_id = '13800001-0000-4000-8000-000000000138' and completed_at is null));
insert into _ids select 'a2', public.organization_application_submit((select id from _ids where k = 'o2'));
reset role;

select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o2')) ->> 'approval_state', 'pending',
  '23: the new application is pending');
select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o1')) ->> 'approval_state', 'none',
  '24: the abandoned one is unchanged (none)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.admin_list(null) -> 'rows')), 2, '25: the owner has two distinct organizations in the directory');

set local role authenticated;
set local request.jwt.claims = :'adm';
select lives_ok(format($q$select public.review_start(%L)$q$, (select id from _ids where k = 'a2')), '26: reviewer claims the new application');
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'a2')), '27: reviewer approves it');
reset role;

select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o2')) ->> 'approval_state', 'approved',
  '28: approved -> directory approval approved (lifecycle active, Verified tab)');
select is(pg_temp.admin_detail((select id from _ids where k = 'o2')) ->> 'approval_state', 'approved', '29: detail agrees (approved)');
select is(pg_temp.row_of(pg_temp.admin_list(null), (select id from _ids where k = 'o1')) ->> 'approval_state', 'none',
  '30: approving the replacement never changes the abandoned organization');

select * from finish();
rollback;

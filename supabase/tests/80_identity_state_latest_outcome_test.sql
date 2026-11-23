-- pgTAP: B-1 - organization_identity_state reports the LATEST identity-review outcome
--        (20261015090041). A newer approved request supersedes an older rejection; history is kept;
--        no approval, permission or write rule changes.
create extension if not exists pgtap;

begin;
select plan(24);
-- rc2: this fixture activates / approves showrooms directly, bypassing the seller-readiness triggers PR #84 added
-- (showroom_activation_complete / showroom_product_publish_complete). They are disabled for this
-- transaction only (rolled back with it); the readiness rules themselves are asserted in tests 92-94.
alter table public.organizations disable trigger showroom_activation_complete;
alter table public.products disable trigger showroom_product_publish_complete;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('80' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000080')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p80-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P80 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 3) n;

-- 1 founder   2 plain member (read-only)   3 outsider
\set u1 '{"sub":"80000001-0000-4000-8000-000000000080","role":"authenticated"}'
\set u2 '{"sub":"80000002-0000-4000-8000-000000000080","role":"authenticated"}'
\set u3 '{"sub":"80000003-0000-4000-8000-000000000080","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

create temp table _ids (k text primary key, id uuid);
grant all on _ids to authenticated;

select set_config('request.jwt.claims', :'u1', true);
insert into _ids select 'org', app.organization_create_owned('Beta Showroom', 'showroom_dealer', 'en', 'Main');
insert into public.memberships (user_id, organization_id, status, accepted_at)
values ('80000002-0000-4000-8000-000000000080', (select id from _ids where k = 'org'), 'active', now());
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, 'catalog.read' from public.memberships m
 where m.organization_id = (select id from _ids where k = 'org') and m.user_id = '80000002-0000-4000-8000-000000000080';

set local role authenticated;
set local request.jwt.claims = :'u1';
insert into _ids select 'appl', public.organization_application_submit((select id from _ids where k = 'org'));
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'appl'));
select public.review_approve((select id from _ids where k = 'appl'), false);
reset role;

-- helpers. Real requests are separate transactions with distinct clocks; inside one test transaction every
-- now() is equal, so each request is given its own submission time to model "attempt n".
create function public.t80_at_minute(p_key text, p_minute int) returns void language plpgsql as $$
begin
  alter table public.verifications disable trigger user;
  update public.verifications set submitted_at = timestamptz '2026-01-01 00:00:00+00' + (p_minute || ' minutes')::interval
   where id = (select id from _ids where k = p_key);
  alter table public.verifications enable trigger user;
end $$;
create function public.t80_state() returns table (st text, rid uuid, prop jsonb, rsn text, locked boolean, nm text)
language sql as $$
  select s.request_status, s.request_id, s.proposed, s.reason, s.locked, s.name
    from public.organization_identity_state((select id from _ids where k = 'org')) s;
$$;
grant execute on function public.t80_state() to authenticated;

-- 1. rejected request ----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'u1';
insert into _ids select 'r1', public.organization_identity_change_request((select id from _ids where k = 'org'), 'Beta Group');
reset role; select public.t80_at_minute('r1', 1);
set local role authenticated; set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'r1'));
select public.review_reject((select id from _ids where k = 'r1'), 'Name does not match the licence.');
set local request.jwt.claims = :'u1';
select is((select st from public.t80_state()), 'rejected', 'B1-1: a rejected request is the current outcome');
select is((select rsn from public.t80_state()), 'Name does not match the licence.', 'B1-2: with its reviewer note');

-- 2. corrected request (pending supersedes the older rejection) --------------------------------------
insert into _ids select 'r2', public.organization_identity_change_request((select id from _ids where k = 'org'), 'Beta Showroom Group');
reset role; select public.t80_at_minute('r2', 2);
set local role authenticated; set local request.jwt.claims = :'u1';
select is((select st from public.t80_state()), 'pending_review', 'B1-3: a corrected request supersedes the older rejection while pending');
select is((select prop ->> 'name' from public.t80_state()), 'Beta Showroom Group', 'B1-4: and shows its own proposed value');
select is((select rsn from public.t80_state()), null, 'B1-5: the old rejection note is not shown for the new request');

-- needs changes keeps working
set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'r2'));
select public.review_request_changes((select id from _ids where k = 'r2'), 'Send the licence number.');
set local request.jwt.claims = :'u1';
select is((select st || ':' || rsn from public.t80_state()), 'needs_changes:Send the licence number.', 'B1-6: needs-changes still reports its note');

-- 3. corrected request approved ----------------------------------------------------------------------
insert into _ids select 'r3', public.organization_identity_change_request((select id from _ids where k = 'org'), 'Beta Showroom Group');
reset role; select public.t80_at_minute('r3', 3);
set local role authenticated; set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'r3'));
select lives_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'r3')), 'B1-7: Admin approves the corrected request');
set local request.jwt.claims = :'u1';

-- 4. latest state displays correctly ---------------------------------------------------------------------
select is((select st from public.t80_state()), null, 'B1-8: the approved request is the current outcome - no open or rejected request is reported');
select is((select rsn from public.t80_state()), null, 'B1-9: no stale reviewer note');
select is((select prop from public.t80_state()), null, 'B1-10: no stale proposed value');
select is((select rid from public.t80_state()), null, 'B1-11: no request id to act on');
select is((select nm from public.t80_state()), 'Beta Showroom Group', 'B1-12: the approved name is the current name');
select is((select locked from public.t80_state()), true, 'B1-13: the identity stays locked behind review');

-- 5. history is kept ------------------------------------------------------------------------------------
reset role;
select is((select count(*)::int from public.verifications where verification_type = 'organization_identity'
            and organization_id = (select id from _ids where k = 'org') and status = 'rejected'
            and reason = 'Name does not match the licence.'), 1, 'B1-14: the old rejection stays in history with its reason');
select is((select count(*)::int from public.audit_log where action = 'verification.rejected'
            and subject_id = (select id from _ids where k = 'r1')), 1, 'B1-15: and in the audit log');
select is((select count(*)::int from public.audit_log where action = 'organization.identity_changed'
            and organization_id = (select id from _ids where k = 'org')), 1, 'B1-16: the approved change is audited once');

-- 6. a NEWER rejection after an approval is the current outcome again -------------------------------------
set local role authenticated; set local request.jwt.claims = :'u1';
insert into _ids select 'r4', public.organization_identity_change_request((select id from _ids where k = 'org'), 'Beta Group International');
reset role; select public.t80_at_minute('r4', 4);
set local role authenticated; set local request.jwt.claims = :'adm';
select public.review_start((select id from _ids where k = 'r4'));
select public.review_reject((select id from _ids where k = 'r4'), 'Not supported by documents.');
set local request.jwt.claims = :'u1';
select is((select st || ':' || rsn from public.t80_state()), 'rejected:Not supported by documents.', 'B1-17: attempts are ordered by time - the newest decision wins');
select is((select nm from public.t80_state()), 'Beta Showroom Group', 'B1-18: and the approved name is untouched by a later rejection');

-- 7. rules are unchanged -----------------------------------------------------------------------------------
set local request.jwt.claims = :'u2';
select is((select count(*)::int from public.organization_identity_state((select id from _ids where k = 'org'))), 1, 'B1-19: a member still reads the state');
select throws_ok(format($q$select public.organization_identity_change_request(%L, 'Member Rename')$q$, (select id from _ids where k = 'org')),
  '42501', null, 'B1-20: a plain member still cannot request a rename');
select throws_ok(format($q$select public.review_approve(%L, false)$q$, (select id from _ids where k = 'r4')),
  '42501', null, 'B1-21: only an Admin approves');
set local request.jwt.claims = :'u3';
select is((select count(*)::int from public.organization_identity_state((select id from _ids where k = 'org'))), 0, 'B1-22: an outsider still sees nothing');
set local request.jwt.claims = :'u1';
select throws_ok(format($q$update public.organizations set name = 'Direct Rename' where id = %L$q$, (select id from _ids where k = 'org')),
  '42501', null, 'B1-23: a direct rename is still refused');
select lives_ok(format($q$select public.organization_identity_change_request(%L, 'Beta Showroom Group Egypt')$q$, (select id from _ids where k = 'org')),
  'B1-24: after a decision the owner can still file a new request');

select * from finish();
rollback;

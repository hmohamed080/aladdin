-- pgTAP: My Work — the assignment WORK CONTACT (public.assignment_contacts /
-- public.my_assignment_contacts).
--
-- A work contact is contact data an organization INTENTIONALLY shares for one work
-- relationship, snapshotted when the assignment becomes real. The assertions pin
-- down three things:
--   * READ AUTHORITY BELONGS TO THE ASSIGNMENT — only the assigned installer, only
--     in_progress / completed — and not to the membership of whoever created the
--     row, so the contact survives that person leaving;
--   * NOTHING IS BORROWED FROM A PERSON — no personal profile phone / e-mail is ever
--     read, and no user id is stored or exposed;
--   * NOTHING IS INVENTED — no source, no row.
--
-- Fixtures (seed-pilot): 70000006 (owner of Horizon Contracting), installers
-- 71000006 and 71000007.
create extension if not exists pgtap;

begin;
select plan(34);

\set org '9a000000-aaaa-4aaa-8aaa-000000000005'

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is(
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'my_assignment_contacts'),
  array['assignment_id', 'org_name', 'contact_name', 'phone', 'email'],
  'the read model exposes EXACTLY these five columns — no user id, role or profile field');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'assignment_contacts'
      and (column_name::text collate "C" like '%user%' or column_name::text collate "C" like '%member%' or column_name::text collate "C" like '%profile%')),
  0, 'the table stores NO user, member or profile reference — the contact is not tied to a person');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'assignment_contacts' and grantee in ('anon', 'authenticated')),
  0, 'clients hold NO privilege on the table — the definer reader is the only door');
select is(
  (select relrowsecurity from pg_class where oid = 'public.assignment_contacts'::regclass),
  true, 'RLS is enabled on the table');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'my_assignment_contacts' and grantee = 'anon'),
  0, 'anon holds nothing on the view');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_my_assignment_contacts' and pg_get_function_arguments(p.oid) = ''),
  1, 'the reader takes no parameter — it cannot be pointed at another assignment');
select is(
  (select has_function_privilege('authenticated', 'app.assignment_contact_snapshot(uuid,text,text,text,text)', 'execute')),
  false, 'authenticated cannot call the snapshot writer');
select is(
  (select has_function_privilege('anon', 'app.assignment_contact_snapshot(uuid,text,text,text,text)', 'execute')),
  false, 'nor can anon');
select is(
  (select count(*)::int from pg_proc where prosrc ilike '%assignment_contacts%'
     and prosrc ilike '%profiles%' and proname in ('_my_assignment_contacts', 'assignment_contact_snapshot')),
  0, 'neither function reads profiles — a personal contact can never be borrowed');

-- ===========================================================================
-- B. Fixture: assignments built through the real RPCs
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.job1', public.job_create(:'org'::uuid, 'Contact fixture 1', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);
select set_config('t.job2', public.job_create(:'org'::uuid, 'Contact fixture 2', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);
select set_config('t.job3', public.job_create(:'org'::uuid, 'Contact fixture 3', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);
select set_config('t.job4', public.job_create(:'org'::uuid, 'Contact fixture 4', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);
select public.job_publish(current_setting('t.job1')::uuid, 1);
select public.job_publish(current_setting('t.job2')::uuid, 1);
select public.job_publish(current_setting('t.job3')::uuid, 1);
select public.job_publish(current_setting('t.job4')::uuid, 1);
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.app1', public.job_application_submit(current_setting('t.job1')::uuid, 'x')::text, true);
select set_config('t.app2', public.job_application_submit(current_setting('t.job2')::uuid, 'x')::text, true);
select set_config('t.app3', public.job_application_submit(current_setting('t.job3')::uuid, 'x')::text, true);
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select set_config('t.app4', public.job_application_submit(current_setting('t.job4')::uuid, 'x')::text, true);
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.asg1', public.job_application_accept(current_setting('t.app1')::uuid)::text, true);
select set_config('t.asg2', public.job_application_accept(current_setting('t.app2')::uuid)::text, true);
select set_config('t.asg3', public.job_application_accept(current_setting('t.app3')::uuid)::text, true);
select set_config('t.asg4', public.job_application_accept(current_setting('t.app4')::uuid)::text, true);
reset role;
set local request.jwt.claims = '';

-- A personal phone on the accepting member's profile, which must never surface.
update public.profiles set phone_e164 = '+201999999999' where user_id = '70000006-0000-4000-8000-000000000006';

-- ===========================================================================
-- C. Nothing recorded -> nothing shown, even in progress
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_assignment_start(current_setting('t.asg3')::uuid, 1);
select public.job_assignment_start(current_setting('t.asg1')::uuid, 1);
select is((select count(*)::int from public.my_assignment_contacts), 0,
  'with NO recorded work contact an in-progress assignment shows none — the accepting member''s personal phone / e-mail is never substituted');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- D. The snapshot — written as the owner, as an accept-time hook will
-- ===========================================================================
select throws_ok(
  format($$select app.assignment_contact_snapshot(%L, 'Coordinator', null, null, 'job_contact')$$, current_setting('t.asg1')),
  '23514', null, 'a contact with neither phone nor e-mail is refused');
select throws_ok(
  format($$select app.assignment_contact_snapshot(%L, 'Coordinator', '0100 not e164', null, 'job_contact')$$, current_setting('t.asg1')),
  '23514', null, 'a phone that is not E.164 is refused');
select throws_ok(
  format($$select app.assignment_contact_snapshot(%L, 'Coordinator', '+201001112222', null, 'member_profile')$$, current_setting('t.asg1')),
  '23514', null, 'a source other than an explicit shared one (e.g. a member profile) is refused');

select app.assignment_contact_snapshot(current_setting('t.asg1')::uuid, 'Site coordinator', '+201001112222', 'work@horizon.example.test', 'job_contact');
select app.assignment_contact_snapshot(current_setting('t.asg2')::uuid, 'Site coordinator', '+201001112222', null, 'organization_contact');
select app.assignment_contact_snapshot(current_setting('t.asg4')::uuid, 'Other site', '+201003334444', null, 'job_contact');
select app.assignment_contact_snapshot(current_setting('t.asg1')::uuid, 'REWRITTEN', '+201009999999', null, 'job_contact');
select is((select contact_name from public.assignment_contacts where assignment_id = current_setting('t.asg1')::uuid),
  'Site coordinator', 'a snapshot is taken ONCE — a second call never rewrites what the installer was shown');

-- ===========================================================================
-- E. The assigned installer, by status
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts), 1,
  'IN PROGRESS: the assigned installer reads the snapshotted work contact (the scheduled one is withheld)');
select is((select assignment_id from public.my_assignment_contacts), current_setting('t.asg1')::uuid, 'for exactly that assignment');
select is((select contact_name from public.my_assignment_contacts), 'Site coordinator', 'the contact name is the shared one');
select is((select phone from public.my_assignment_contacts), '+201001112222', 'the phone is the shared work phone, not the member''s personal one');
select is((select email from public.my_assignment_contacts), 'work@horizon.example.test', 'the e-mail is the shared work e-mail');
select is((select org_name from public.my_assignment_contacts), 'Horizon Contracting', 'with the organization name');
select is((select count(*)::int from public.my_assignment_contacts where phone = '+201999999999'), 0,
  'the accepting member''s personal profile phone appears NOWHERE');
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asg4')::uuid), 0,
  'and another installer''s assignment contact is not readable — a caller cannot ask for it');
select throws_ok($$select * from public.assignment_contacts$$, '42501', null, 'the base table is not readable by a client at all');
reset role;
set local request.jwt.claims = '';

-- SCHEDULED withholds it: asg2 has a snapshot but has not started.
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asg2')::uuid), 0,
  'SCHEDULED: a recorded contact is withheld until the work begins');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- F. The contact belongs to the assignment, not to the staff member who accepted
-- ===========================================================================
update public.memberships set status = 'suspended'
 where user_id = '70000006-0000-4000-8000-000000000006' and organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asg1')::uuid), 1,
  'the contact is STILL readable after the accepting member is SUSPENDED');
reset role;
set local request.jwt.claims = '';
update public.memberships set status = 'revoked'
 where user_id = '70000006-0000-4000-8000-000000000006' and organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select phone from public.my_assignment_contacts where assignment_id = current_setting('t.asg1')::uuid), '+201001112222',
  'and after they are REVOKED / removed from the organization');
reset role;
set local request.jwt.claims = '';
update public.memberships set status = 'active'
 where user_id = '70000006-0000-4000-8000-000000000006' and organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005';

-- ===========================================================================
-- G. Everyone else
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asg1')::uuid), 0,
  'an UNRELATED installer reads nothing of that assignment');
select is((select count(*)::int from public.my_assignment_contacts), 0,
  'and their own assignment (not yet started) shows none either');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts), 0, 'the poster side reads nothing here — the view is the INSTALLER''s');
reset role;
set local request.jwt.claims = '';

set local role anon;
set local request.jwt.claims = '';
select throws_ok($$select count(*) from public.my_assignment_contacts$$, '42501', null, 'anonymous cannot read it');
reset role;

-- ===========================================================================
-- H. Completed keeps it; cancelled releases none
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_progress_add(current_setting('t.asg1')::uuid, 100::smallint, 'wrap', 'Done.');
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_assignment_complete(current_setting('t.asg1')::uuid,
  (select version from public.job_assignments where id = current_setting('t.asg1')::uuid));
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asg1')::uuid), 1,
  'COMPLETED: the contact is still available');
reset role;
set local request.jwt.claims = '';

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_assignment_cancel(current_setting('t.asg2')::uuid, 1, 'Plans changed');
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asg2')::uuid), 0,
  'CANCELLED: a recorded contact is not exposed');
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asg3')::uuid), 0,
  'and an in-progress assignment with NO recorded contact still shows none');
select is((select count(*)::int from public.my_assignment_contacts), 1, 'leaving exactly the completed assignment''s contact');
reset role;
set local request.jwt.claims = '';

select * from finish();
rollback;

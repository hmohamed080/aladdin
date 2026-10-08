-- pgTAP: the job WORK CONTACT and its snapshot at award
-- (public.job_work_contacts -> public.assignment_contacts).
--
-- End to end through the REAL RPCs: the poster provides a contact for a job, the
-- award (`job_application_accept`) snapshots it onto the assignment inside its own
-- transaction, and the assigned installer reads that snapshot — only while the work
-- is in progress or completed. Nothing is borrowed from any person's profile.
--
-- Fixtures (seed-pilot): 70000006 owner of Horizon Contracting; installers 71000006
-- and 71000007.
create extension if not exists pgtap;

begin;
select plan(47);

\set org '9a000000-aaaa-4aaa-8aaa-000000000005'

-- ===========================================================================
-- A. Shape and grants
-- ===========================================================================
select has_table('public'::name, 'job_work_contacts'::name, 'job_work_contacts exists');
select is((select relrowsecurity from pg_class where oid = 'public.job_work_contacts'::regclass), true, 'RLS is enabled');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_work_contacts'
      and ((grantee = 'authenticated' and privilege_type <> 'SELECT') or grantee = 'anon')),
  0, 'clients hold only SELECT (and anon nothing) — every write is the RPC');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'job_work_contacts'
      and (column_name::text collate "C" like '%user%' or column_name::text collate "C" like '%member%' or column_name::text collate "C" like '%profile%')),
  0, 'the table stores no user, member or profile reference');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'job_work_contact_set' and pg_get_function_arguments(p.oid) ilike '%user%'),
  0, 'the RPC takes no user argument');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name::text collate "C" like '%contact%'),
  0, 'and jobs itself gained NO contact column — an assigned installer reading jobs cannot see a scheduled job''s contact');
select is(
  (select count(*)::int from pg_proc where proname = 'job_application_accept' and prosrc not ilike '%profiles%'),
  (select count(*)::int from pg_proc where proname = 'job_application_accept'),
  'the award never reads a member profile');

-- ===========================================================================
-- B. The poster provides a work contact
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.jobC', public.job_create(:'org'::uuid, 'Work-contact job', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);
select set_config('t.jobN', public.job_create(:'org'::uuid, 'No-contact job', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);
select set_config('t.jobE', public.job_create(:'org'::uuid, 'Edited-contact job', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);

select lives_ok(
  format($$select public.job_work_contact_set(%L, 'Site coordinator', '+201001112222', 'work@horizon.example.test')$$, current_setting('t.jobC')),
  'the poster can set a valid work contact on a draft job');
select is((select contact_name from public.job_work_contacts where job_id = current_setting('t.jobC')::uuid), 'Site coordinator', 'poster members read it back');
select lives_ok(
  format($$select public.job_work_contact_set(%L, '  Site lead  ', '+201003334444', null)$$, current_setting('t.jobC')),
  'and can change it (phone only, e-mail cleared)');
select is((select contact_phone_e164 || '|' || coalesce(contact_email, 'none') || '|' || contact_name from public.job_work_contacts where job_id = current_setting('t.jobC')::uuid),
  '+201003334444|none|Site lead', 'the change is stored, trimmed');
select lives_ok(
  format($$select public.job_work_contact_set(%L, 'Site coordinator', '+201001112222', 'work@horizon.example.test')$$, current_setting('t.jobC')),
  'and set back');

select throws_ok(
  format($$select public.job_work_contact_set(%L, 'X', '01001112222', null)$$, current_setting('t.jobE')),
  '23514', null, 'a phone that is not E.164 is rejected');
select throws_ok(
  format($$select public.job_work_contact_set(%L, 'X', '+201001112222x', null)$$, current_setting('t.jobE')),
  '23514', null, 'a phone with junk is rejected');
select throws_ok(
  format($$select public.job_work_contact_set(%L, 'X', null, 'not-an-email')$$, current_setting('t.jobE')),
  '23514', null, 'an invalid e-mail is rejected');
select throws_ok(
  format($$select public.job_work_contact_set(%L, 'Name only', null, null)$$, current_setting('t.jobE')),
  '22023', null, 'a name with nothing to reach them by is refused');
select is((select count(*)::int from public.job_work_contacts where job_id = current_setting('t.jobE')::uuid), 0,
  'a refused contact leaves nothing behind');
select lives_ok(
  format($$select public.job_work_contact_set(%L, null, null, null)$$, current_setting('t.jobE')),
  'clearing (all empty) is accepted and is the same as never having one');
select throws_ok(
  format($$select public.job_work_contact_set(%L, 'X', '+201001112222', null)$$, '00000000-0000-4000-8000-00000000dead'),
  '22023', null, 'an unknown job is refused');
select throws_ok(
  format($$insert into public.job_work_contacts (job_id, contact_name, contact_phone_e164) values (%L, 'X', '+201001112222')$$, current_setting('t.jobN')),
  '42501', null, 'a direct INSERT is refused — no write grant');

-- A job WITHOUT a contact is entirely valid: it publishes like any other.
select lives_ok(format($$select public.job_publish(%L, 1)$$, current_setting('t.jobN')), 'a job with NO work contact publishes normally');
select public.job_publish(current_setting('t.jobC')::uuid, 1);
select public.job_publish(current_setting('t.jobE')::uuid, 1);
reset role;
set local request.jwt.claims = '';

-- Another organization's member cannot set or read it.
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format($$select public.job_work_contact_set(%L, 'Evil', '+201009999999', null)$$, current_setting('t.jobC')),
  '42501', null, 'a member of ANOTHER organization cannot set it');
select is((select count(*)::int from public.job_work_contacts), 0, 'nor read it');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- C. Applicants (including the future assignee) cannot read the job contact
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.appC', public.job_application_submit(current_setting('t.jobC')::uuid, 'x')::text, true);
select set_config('t.appN', public.job_application_submit(current_setting('t.jobN')::uuid, 'x')::text, true);
select is((select count(*)::int from public.job_work_contacts), 0, 'an applicant cannot read a job''s work contact before award');
reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- D. The award snapshots the job contact — once — and a job without one makes none
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.asgC', public.job_application_accept(current_setting('t.appC')::uuid)::text, true);
select set_config('t.asgN', public.job_application_accept(current_setting('t.appN')::uuid)::text, true);
reset role;
set local request.jwt.claims = '';

select is((select count(*)::int from public.assignment_contacts where assignment_id = current_setting('t.asgC')::uuid), 1,
  'accepting an application snapshots the job''s work contact — exactly one row');
select is(
  (select contact_name || '|' || phone_e164 || '|' || email || '|' || source || '|' || organization_id::text
     from public.assignment_contacts where assignment_id = current_setting('t.asgC')::uuid),
  'Site coordinator|+201001112222|work@horizon.example.test|job_contact|9a000000-aaaa-4aaa-8aaa-000000000005',
  'with the job''s values, source job_contact and the poster organization');
select is((select count(*)::int from public.assignment_contacts where assignment_id = current_setting('t.asgN')::uuid), 0,
  'an assignment whose job has NO contact gets no contact row — and the award still succeeded');
select is((select status::text from public.job_assignments where id = current_setting('t.asgN')::uuid), 'scheduled', 'the no-contact assignment exists normally');

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(public.job_application_accept(current_setting('t.appC')::uuid), current_setting('t.asgC')::uuid, 'accepting again is idempotent');
reset role;
set local request.jwt.claims = '';
select is((select count(*)::int from public.assignment_contacts where assignment_id = current_setting('t.asgC')::uuid), 1, 'and snapshots nothing a second time');

-- ===========================================================================
-- E. Immutability
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  format($$select public.job_work_contact_set(%L, 'Changed after award', '+201005556666', null)$$, current_setting('t.jobC')),
  '22023', null, 'once awarded, the job''s contact can no longer be edited through the RPC');
reset role;
set local request.jwt.claims = '';
-- Even a direct change to the job's contact (owner session) cannot reach the snapshot.
update public.job_work_contacts set contact_name = 'REWRITTEN', contact_phone_e164 = '+201007778888' where job_id = current_setting('t.jobC')::uuid;
delete from public.job_work_contacts where job_id = current_setting('t.jobC')::uuid;
select is((select contact_name || '|' || phone_e164 from public.assignment_contacts where assignment_id = current_setting('t.asgC')::uuid),
  'Site coordinator|+201001112222', 'editing or deleting the job''s contact never rewrites an existing assignment contact');
-- Personal profile changes cannot reach it either.
update public.profiles set phone_e164 = '+201999999999', display_name = 'Changed Name' where user_id = '70000006-0000-4000-8000-000000000006';
update public.contacts set value = 'changed@example.test' where user_id = '70000006-0000-4000-8000-000000000006' and channel = 'email';
select is((select contact_name || '|' || phone_e164 || '|' || email from public.assignment_contacts where assignment_id = current_setting('t.asgC')::uuid),
  'Site coordinator|+201001112222|work@horizon.example.test', 'a poster / member PERSONAL profile change does not alter the snapshot');

-- ===========================================================================
-- F. Who reads it, and when
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts), 0, 'SCHEDULED: the assigned installer reads nothing yet');
select is((select count(*)::int from public.job_work_contacts), 0, 'and cannot read the job''s own contact row either');
select public.job_assignment_start(current_setting('t.asgC')::uuid, 1);
select is((select count(*)::int from public.my_assignment_contacts), 1, 'IN PROGRESS: the assigned installer reads the snapshotted contact');
select is((select phone from public.my_assignment_contacts), '+201001112222', 'the shared work phone — not the member''s personal one');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'my_assignment_contacts'),
  array['assignment_id', 'org_name', 'contact_name', 'phone', 'email'], 'only these five columns exist — no member or profile field can leak');
reset role;
set local request.jwt.claims = '';

-- The accepting member losing membership changes nothing.
update public.memberships set status = 'revoked'
 where user_id = '70000006-0000-4000-8000-000000000006' and organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts), 1, 'the snapshot survives the accepting member being REVOKED');
reset role;
set local request.jwt.claims = '';
update public.memberships set status = 'suspended'
 where user_id = '70000006-0000-4000-8000-000000000006' and organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts), 1, 'and SUSPENDED');
reset role;
set local request.jwt.claims = '';
update public.memberships set status = 'active'
 where user_id = '70000006-0000-4000-8000-000000000006' and organization_id = '9a000000-aaaa-4aaa-8aaa-000000000005';

set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts), 0, 'an UNRELATED installer reads nothing');
reset role;
set local request.jwt.claims = '';
set local role anon;
set local request.jwt.claims = '';
select throws_ok($$select count(*) from public.my_assignment_contacts$$, '42501', null, 'anon cannot read the snapshot view');
select throws_ok($$select count(*) from public.job_work_contacts$$, '42501', null, 'nor the job contact table');
reset role;

-- COMPLETED keeps it; CANCELLED withholds it.
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_progress_add(current_setting('t.asgC')::uuid, 100::smallint, 'wrap', 'Done.');
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_assignment_complete(current_setting('t.asgC')::uuid, (select version from public.job_assignments where id = current_setting('t.asgC')::uuid));
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asgC')::uuid), 1, 'COMPLETED: the contact is still readable');
reset role;
set local request.jwt.claims = '';

-- A third job with a contact, cancelled before it starts.
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.jobX', public.job_create(:'org'::uuid, 'Cancelled-contact job', 'painting', 6000::numeric, 'x', 'Cairo', 'New Cairo', 'a', 3::smallint)::text, true);
select public.job_work_contact_set(current_setting('t.jobX')::uuid, 'Cancelled lead', '+201002223333', null);
select public.job_publish(current_setting('t.jobX')::uuid, 1);
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.appX', public.job_application_submit(current_setting('t.jobX')::uuid, 'x')::text, true);
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('t.asgX', public.job_application_accept(current_setting('t.appX')::uuid)::text, true);
select public.job_assignment_cancel(current_setting('t.asgX')::uuid, 1, 'Plans changed');
reset role;
set local request.jwt.claims = '';
select is((select count(*)::int from public.assignment_contacts where assignment_id = current_setting('t.asgX')::uuid), 1, 'the cancelled assignment did snapshot a contact at award …');
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asgX')::uuid), 0, '… but CANCELLED withholds it from the installer');
select is((select count(*)::int from public.my_assignment_contacts where assignment_id = current_setting('t.asgN')::uuid), 0, 'and the no-contact assignment still shows none');
reset role;
set local request.jwt.claims = '';

select * from finish();
rollback;

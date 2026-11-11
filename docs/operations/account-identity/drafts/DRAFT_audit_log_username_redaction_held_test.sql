-- ===========================================================================
-- DRAFT pgTAP-style proof, part 2: the narrow guard WHILE it is installed (steps 1-2 of the draft migration only; the
-- redaction UPDATE and the restore are cut out by the harness). Proves the bypass is narrow on the REAL audit_log and
-- the REAL triggers. Always ends with ROLLBACK. LOCAL stack only; synthetic values.
-- ===========================================================================
create extension if not exists pgtap;

begin;
select plan(14);

insert into public.audit_log (id, actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata) values
  ('00000000-0000-4000-8000-0000000000d1', null, null, 'profile.username_set', 'user', gen_random_uuid(), null, '{"username":"synthetic_d1","k":1}'),
  ('00000000-0000-4000-8000-0000000000d2', null, null, 'organization.created', 'organization', gen_random_uuid(), null, '{"username":"synthetic_d2"}');
create temp table _g0 on commit drop as select md5(prosrc) as m from pg_proc where oid = 'app.guard_audit_actor_deletion()'::regprocedure;

-- @@INCLUDE_HELD@@

select isnt((select md5(prosrc) from pg_proc where oid = 'app.guard_audit_actor_deletion()'::regprocedure), (select m from _g0),
            'held: the narrow guard is installed (source differs from the original)');
select is(current_setting('app.audit_redaction', true), 'profile.username_set:remove-username:v1', 'held: token is set');

select throws_ok($$update public.audit_log set metadata = metadata - 'k' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', 'held: removing a key other than username is blocked');
select throws_ok($$update public.audit_log set metadata = '{}' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', 'held: removing more than the username key is blocked');
select throws_ok($$update public.audit_log set metadata = (metadata - 'username') || '{"extra":1}' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', 'held: removal plus an added key is blocked');
select throws_ok($$update public.audit_log set metadata = metadata - 'username', created_at = now() - interval '1 day' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', 'held: removal plus any other column change is blocked');
select throws_ok($$update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000d2'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', 'held: a row of another action is blocked');
select throws_ok($$delete from public.audit_log where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 'P0001', 'public.audit_log is append-only (DELETE forbidden)', 'held: DELETE is blocked');

-- Other database roles cannot use the token: none of them holds UPDATE/DELETE on the table at all, so the statement
-- fails on privileges before any trigger runs. (The guard additionally requires session_user in postgres/supabase_admin;
-- PostgREST connects as the authenticator login, so even a future accidental grant would not satisfy it.)
select is((select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'audit_log' and privilege_type in ('UPDATE', 'DELETE')
              and grantee not in ('postgres'))::int, 0, 'held: no role other than the owner holds UPDATE or DELETE on audit_log');
set local role service_role;
select throws_ok($$update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 '42501', null, 'held: service_role with the token is stopped by privileges');
set local role authenticated;
select throws_ok($$update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 '42501', null, 'held: authenticated with the token is stopped by privileges');
set local role anon;
select throws_ok($$update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                 '42501', null, 'held: anon with the token is stopped by privileges');
reset role;

select lives_ok($$update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000d1'$$,
                'held: exactly the redaction is allowed');
select is((select metadata::text from public.audit_log where id = '00000000-0000-4000-8000-0000000000d1'), '{"k": 1}',
          'held: result keeps the other key');

select * from finish();
rollback;

-- ===========================================================================
-- DRAFT pgTAP-style proof for DRAFT_audit_log_username_redaction.sql. NOT part of supabase/tests (never auto-run).
-- Run it with the harness: docs/operations/account-identity/drafts/run-audit-redaction-proof.sh
-- The harness replaces the single line "-- @@INCLUDE_DRAFT@@" with the draft migration, so the test and the
-- migration run in ONE transaction that always ends with ROLLBACK (audit_log is append-only: a committed test row
-- could never be removed). Cross-transaction checks (token does not persist) are in the harness.
-- LOCAL stack only. All values are synthetic.
-- ===========================================================================
create extension if not exists pgtap;

begin;
select plan(25);

-- ---- fixture (synthetic): 5 redaction targets, 1 target without the key, 1 non-target row that carries a 'username' key
insert into public.audit_log (id, actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata, created_at) values
  ('00000000-0000-4000-8000-0000000000a1', null, null, 'profile.username_set', 'user', gen_random_uuid(), null, '{"username":"synthetic_a1"}', now() - interval '5 days'),
  ('00000000-0000-4000-8000-0000000000a2', null, null, 'profile.username_set', 'user', gen_random_uuid(), null, '{"username":"synthetic_a2"}', now() - interval '4 days'),
  ('00000000-0000-4000-8000-0000000000a3', null, null, 'profile.username_set', 'user', gen_random_uuid(), null, '{"username":"synthetic_a3","kept":"yes","n":7}', now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000000a4', null, null, 'profile.username_set', 'user', gen_random_uuid(), null, '{"username":""}', now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000000a5', null, null, 'profile.username_set', 'user', gen_random_uuid(), null, '{"username":null,"z":[1,2]}', now() - interval '1 day'),
  ('00000000-0000-4000-8000-0000000000b1', null, null, 'profile.username_set', 'user', gen_random_uuid(), null, '{}', now()),
  ('00000000-0000-4000-8000-0000000000c1', null, null, 'organization.created', 'organization', gen_random_uuid(), null, '{"username":"must_stay"}', now());

create temp table _before on commit drop as
  select a.*, md5(a::text) as row_md5 from public.audit_log a;
create temp table _guard_before on commit drop as
  select md5(prosrc) as src_md5, proacl::text as acl, pg_get_userbyid(proowner) as owner, prosecdef, proconfig::text as cfg
    from pg_proc where oid = 'app.guard_audit_actor_deletion()'::regprocedure;

select is((select count(*) from public.audit_log where action = 'profile.username_set' and metadata ? 'username')::int, 5,
          'fixture: 5 username_set rows carry the key (plus any pre-existing rows)') ;

-- ---- hostile attempts BEFORE the migration: the current protection holds
select throws_ok($$update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000a1'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', 'pre: redacting UPDATE is blocked today');
select throws_ok($$set local app.audit_redaction = 'profile.username_set:remove-username:v1';
                   update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000a1'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', 'pre: setting the token alone does nothing with the original guard');

-- ---- THE MIGRATION
-- @@INCLUDE_DRAFT@@

-- (a) username key gone
select is((select count(*) from public.audit_log where action = 'profile.username_set' and metadata ? 'username')::int, 0,
          '(a) no profile.username_set row carries a username key');
select is((select count(*) from public.audit_log a join _before b using (id) where b.action = 'profile.username_set' and (a.metadata ? 'username'))::int, 0,
          '(a) the five fixture rows are redacted');

-- (b) every other column / key byte-identical
select is((select count(*) from public.audit_log a join _before b using (id)
            where (to_jsonb(a) - 'metadata') is distinct from (to_jsonb(b) - 'metadata' - 'row_md5'))::int, 0,
          '(b) every non-metadata column is identical on every row');
select is((select count(*) from public.audit_log a join _before b using (id)
            where a.metadata is distinct from (b.metadata - case when b.action = 'profile.username_set' then 'username' else '' end))::int, 0,
          '(b) metadata differs from before ONLY by the removed username key on username_set rows');
select is((select metadata::text from public.audit_log where id = '00000000-0000-4000-8000-0000000000a3'),
          '{"n": 7, "kept": "yes"}', '(b) other metadata keys survive with their values (a3)');
select is((select metadata::text from public.audit_log where id = '00000000-0000-4000-8000-0000000000a5'),
          '{"z": [1, 2]}', '(b) null-valued username key removed, array key kept (a5)');
select is((select metadata::text from public.audit_log where id = '00000000-0000-4000-8000-0000000000c1'),
          '{"username": "must_stay"}', '(b) a row of ANOTHER action keeps its username key (scope is the action)');
select is((select md5(string_agg(concat_ws('|', id, actor_user_id, actor_role, action, subject_type, subject_id, organization_id, created_at, (case when action = 'profile.username_set' then metadata - 'username' else metadata end)::text), E'\n' order by id))
             from _before),
          (select md5(string_agg(concat_ws('|', id, actor_user_id, actor_role, action, subject_type, subject_id, organization_id, created_at, metadata::text), E'\n' order by id))
             from public.audit_log),
          '(b) aggregate checksum of all non-username content is unchanged');

-- (c) row count unchanged
select is((select count(*) from public.audit_log)::int, (select count(*) from _before)::int, '(c) row count unchanged');

-- guard restored exactly
select is((select md5(prosrc) from pg_proc where oid = 'app.guard_audit_actor_deletion()'::regprocedure),
          (select src_md5 from _guard_before), 'guard source restored byte for byte (md5)');
select is((select proacl::text || pg_get_userbyid(proowner) || prosecdef::text || coalesce(proconfig::text, '') from pg_proc where oid = 'app.guard_audit_actor_deletion()'::regprocedure),
          (select acl || owner || prosecdef::text || coalesce(cfg, '') from _guard_before), 'guard ACL, owner, SECURITY DEFINER and search_path unchanged');
select is((select count(*) from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal and tgenabled = 'O'
            and tgname in ('audit_log_no_update', 'audit_log_no_delete'))::int, 2, 'both immutability triggers still exist and are enabled');
select is(current_setting('app.audit_redaction', true), '', 'token cleared inside the transaction after the update');

-- (d) every other UPDATE / DELETE on audit_log stays blocked
select throws_ok($$update public.audit_log set metadata = metadata || '{"x":1}' where id = '00000000-0000-4000-8000-0000000000a3'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', '(d) adding a key is blocked');
select throws_ok($$update public.audit_log set action = 'organization.created' where id = '00000000-0000-4000-8000-0000000000a3'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', '(d) changing another column is blocked');
select throws_ok($$update public.audit_log set metadata = metadata - 'kept' where id = '00000000-0000-4000-8000-0000000000a3'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', '(d) removing a key other than username is blocked');
select throws_ok($$delete from public.audit_log where id = '00000000-0000-4000-8000-0000000000a1'$$,
                 'P0001', 'public.audit_log is append-only (DELETE forbidden)', '(d) DELETE is blocked');
-- The token is useless once the original guard is back: set it AND attempt exactly the redaction shape again.
select throws_ok($$set local app.audit_redaction = 'profile.username_set:remove-username:v1';
                   update public.audit_log set metadata = metadata - 'username' where id = '00000000-0000-4000-8000-0000000000c1'$$,
                 'P0001', 'audit_log is append-only (UPDATE forbidden)', '(d) token + redaction-shaped UPDATE is blocked after the migration');
select lives_ok($$set local app.audit_redaction = ''$$, 'token reset');

-- (f) idempotent re-run: the same file again changes nothing and still verifies itself
-- @@INCLUDE_DRAFT@@
select is((select count(*) from public.audit_log where action = 'profile.username_set' and metadata ? 'username')::int, 0, '(f) re-run: still zero username keys');
select is((select count(*) from public.audit_log)::int, (select count(*) from _before)::int, '(f) re-run: row count unchanged');
select is((select md5(prosrc) from pg_proc where oid = 'app.guard_audit_actor_deletion()'::regprocedure),
          (select src_md5 from _guard_before), '(f) re-run: guard still the original');

select * from finish();
rollback;

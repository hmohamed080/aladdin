-- Storage API and Realtime refuse a signed-out, expired, banned or deleted session
-- (migration 20261019163000). Neither service runs the PostgREST pre-request hook, so
-- the check lives in restrictive RLS policies, evaluated exactly as each service runs
-- them: Storage sets role + request.jwt.claims per request; Realtime's
-- realtime.apply_rls sets them per subscription before a SELECT by primary key.
create extension if not exists pgtap;
begin;
select no_plan();

\set u '70000001-0000-4000-8000-000000000001'
\set lead 'cb000001-0000-4000-8000-000000000001'
\set task 'cc000005-0000-4000-8000-000000000005'
\set live 'e2000000-0000-4000-8000-000000000001'
\set ended 'e2000000-0000-4000-8000-000000000002'
\set gone 'e2000000-0000-4000-8000-000000000003'
insert into auth.sessions(id, user_id, created_at, aal, not_after) values
  (:'live',  :'u', now(), 'aal1', null),
  (:'ended', :'u', now(), 'aal1', now() - interval '1 minute');

-- Policies are evaluated as the caller, so authenticated (only) may run the helper.
select ok(has_function_privilege('authenticated', 'app.jwt_session_is_live()', 'EXECUTE'), 'authenticated can evaluate the session helper inside policies');
select ok(not has_function_privilege(r, 'app.jwt_session_is_live()', 'EXECUTE'), format('%s cannot call the helper', r))
  from unnest(array['anon', 'service_role']) r;

-- Every table Realtime publishes, and storage.objects, carries a restrictive session policy.
select ok(exists (select 1 from pg_policies p
   where p.schemaname = t.schemaname and p.tablename = t.tablename and p.permissive = 'RESTRICTIVE'
     and p.roles = '{authenticated}' and p.cmd in ('SELECT', 'ALL') and p.qual like '%jwt_session_is_live()%'),
  format('%s.%s refuses ended sessions', t.schemaname, t.tablename))
  from (select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime'
        union all select 'storage', 'objects') t;
select ok(exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
   and policyname = 'storage_objects_session_live' and permissive = 'RESTRICTIVE' and cmd = 'ALL'
   and with_check like '%jwt_session_is_live()%'), 'storage writes are checked too (WITH CHECK)');

-- ---------------------------------------------------------------------------
-- Storage: a throwaway private bucket with a permissive owner-free policy, so the
-- only thing that can refuse is the restrictive session policy.
-- ---------------------------------------------------------------------------
insert into storage.buckets(id, name, public) values ('t-session-revocation', 't-session-revocation', false);
create policy t_session_revocation_all on storage.objects for all to authenticated
  using (bucket_id = 't-session-revocation') with check (bucket_id = 't-session-revocation');
insert into storage.objects(bucket_id, name) values ('t-session-revocation', 'kept.pdf');

-- The GUCs storage-api sets on every request (internal/database/pg-connection).
create function pg_temp.as_storage(p_session text, p_operation text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '70000001-0000-4000-8000-000000000001',
    'role', 'authenticated', 'session_id', p_session)::text, true);
  perform set_config('request.jwt.claim.sub', '70000001-0000-4000-8000-000000000001', true);
  perform set_config('storage.operation', p_operation, true);
  perform set_config('storage.allow_delete_query', 'true', true);
end $$;
grant execute on function pg_temp.as_storage(text, text) to authenticated;
create function pg_temp.storage_delete() returns int language plpgsql as $$
declare n int;
begin
  delete from storage.objects where bucket_id = 't-session-revocation';
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.storage_delete() to authenticated;

set local role authenticated;
select pg_temp.as_storage(:'live', 'storage.object.get');
select is((select count(*)::int from storage.objects where bucket_id = 't-session-revocation'), 1, 'storage: a live session reads');
select pg_temp.as_storage(:'live', 'storage.object.upload');
select lives_ok($$insert into storage.objects(bucket_id, name) values ('t-session-revocation', 'live.pdf')$$, 'storage: a live session uploads');

select pg_temp.as_storage(:'gone', 'storage.object.get');
select is((select count(*)::int from storage.objects where bucket_id = 't-session-revocation'), 0, 'storage: a signed-out session reads nothing');
select pg_temp.as_storage(:'gone', 'storage.object.sign');
select is((select count(*)::int from storage.objects where bucket_id = 't-session-revocation' and name = 'kept.pdf'), 0, 'storage: a signed-out session cannot sign a URL');
select pg_temp.as_storage(:'gone', 'storage.object.upload');
select throws_ok($$insert into storage.objects(bucket_id, name) values ('t-session-revocation', 'gone.pdf')$$, '42501', null, 'storage: a signed-out session cannot upload');
select pg_temp.as_storage(:'gone', 'storage.object.delete');
select is(pg_temp.storage_delete(), 0, 'storage: a signed-out session deletes nothing');
select pg_temp.as_storage(:'ended', 'storage.object.get');
select is((select count(*)::int from storage.objects where bucket_id = 't-session-revocation'), 0, 'storage: a session past not_after reads nothing');
select pg_temp.as_storage(null, 'storage.object.get');
select is((select count(*)::int from storage.objects where bucket_id = 't-session-revocation'), 2, 'storage: a token without a session claim is unaffected');

reset role;
update auth.users set banned_until = now() + interval '1 day' where id = :'u';
set local role authenticated;
select pg_temp.as_storage(:'live', 'storage.object.get');
select is((select count(*)::int from storage.objects where bucket_id = 't-session-revocation'), 0, 'storage: a banned user''s live session reads nothing');
reset role;
update auth.users set banned_until = null, deleted_at = now() where id = :'u';
set local role authenticated;
select pg_temp.as_storage(:'live', 'storage.object.upload');
select throws_ok($$insert into storage.objects(bucket_id, name) values ('t-session-revocation', 'deleted.pdf')$$, '42501', null, 'storage: a deleted user''s session cannot upload');
reset role;
update auth.users set deleted_at = null where id = :'u';

-- anon and service_role are not subject to the session policy.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((select count(*)::int from storage.objects where bucket_id = 't-session-revocation'), 2, 'storage: service_role is unaffected');
reset role;

-- ---------------------------------------------------------------------------
-- Realtime postgres_changes: the delivery decision realtime.apply_rls makes for a
-- subscriber, before and after the subscriber's session ends.
-- ---------------------------------------------------------------------------
insert into realtime.subscription(subscription_id, entity, claims) values
  ('e2100000-0000-4000-8000-000000000001', 'public.leads',
   json_build_object('sub', :'u', 'role', 'authenticated', 'session_id', :'live')::jsonb),
  ('e2100000-0000-4000-8000-000000000002', 'public.follow_up_tasks',
   json_build_object('sub', :'u', 'role', 'authenticated', 'session_id', :'live')::jsonb);

create function pg_temp.delivered(p_table text, p_id uuid) returns boolean language sql as $$
  select coalesce(bool_or(cardinality(r.subscription_ids) > 0), false)
    from realtime.apply_rls(jsonb_build_object('action', 'U', 'schema', 'public', 'table', p_table,
      'timestamp', now(), 'columns', jsonb_build_array(jsonb_build_object('name', 'id', 'type', 'uuid', 'value', p_id)),
      'pk', jsonb_build_array(jsonb_build_object('name', 'id', 'type', 'uuid')))) r;
$$;

select ok(pg_temp.delivered('leads', :'lead'), 'realtime: a live session receives a lead change');
select ok(pg_temp.delivered('follow_up_tasks', :'task'), 'realtime: a live session receives a follow-up change');
delete from auth.sessions where id = :'live';  -- sign-out
select ok(not pg_temp.delivered('leads', :'lead'), 'realtime: a signed-out session no longer receives lead changes');
select ok(not pg_temp.delivered('follow_up_tasks', :'task'), 'realtime: a signed-out session no longer receives follow-up changes');

-- The Data API path is unchanged for a live session (the hook already checked it).
insert into auth.sessions(id, user_id, created_at, aal) values (:'live', :'u', now(), 'aal1');
select set_config('request.jwt.claims', json_build_object('sub', :'u', 'role', 'authenticated', 'session_id', :'live')::text, true);
set local role authenticated;
select ok((select count(*) from public.leads where id = :'lead') = 1, 'a live session still reads its leads');
reset role;

select * from finish();
rollback;

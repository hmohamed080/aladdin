-- pgTAP: Admin View-As is STRICTLY READ-ONLY at the database (20261114090002..090004).
--   A. The only functions that consult app.require_view_as are the allow-listed readers + the audited session/media functions
--   B. With a LIVE view session, the admin gains no write authority over the viewed account's rows (RLS refuses every write)
--   C. A live view session does not make the shared resolvers accept the admin
--   D. After all of that, the subject's data is unchanged
create extension if not exists pgtap;

begin;
select plan(10);

\set adminA '55555555-5555-4555-8555-555555555555'
\set craft  '71000006-0000-4000-8000-000000000006'

create function pg_temp.act_as(p_user uuid, p_session uuid default 'a0000000-0000-4000-8000-000000000001') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.act_as(uuid, uuid), pg_temp.as_dba() to authenticated, anon;

-- A. exact allow-list of functions that call the view gate
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc like '%require_view_as(%'),
  array['admin_view_as_current','admin_view_as_media_open','admin_view_craftsman_dashboard','admin_view_craftsman_points','admin_view_craftsman_portfolio',
        'admin_view_craftsman_profile','admin_view_craftsman_reviews','admin_view_craftsman_work']::text[],
  'A: only the read functions and the audited media door consult the view gate (no mutating RPC can be added unnoticed)');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'admin\_view%' and p.provolatile = 'v'
      and p.proname not in ('admin_view_as_begin','admin_view_as_end','admin_view_as_end_all','admin_view_as_media_open')),
  0, 'A: every other admin_view_* function is stable (cannot write)');

-- Fixture: viewed craftsman with a ready portfolio item
insert into public.portfolio_projects (id, owner_user_id, title) values ('b1000000-0000-4000-8000-0000000000a1', :'craft', 'Villa kitchen');
insert into public.portfolio_items (id, owner_user_id, object_key, content_type, title, project_id, state)
  values ('d1000000-0000-4000-8000-0000000000a1', :'craft', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01.jpg', 'image/jpeg', 'Ready', 'b1000000-0000-4000-8000-0000000000a1', 'ready');
create temp table t_before as
  select (select md5(row(u.*)::text) from public.users u where u.id = :'craft') as u,
         (select md5(row(i.*)::text) from public.portfolio_items i where i.id = 'd1000000-0000-4000-8000-0000000000a1') as i,
         (select count(*) from public.portfolio_items where owner_user_id = :'craft') as items;
grant select on t_before to authenticated;

select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'B: the admin has a LIVE view session on the craftsman');

-- B. writes through the API role: RLS yields zero rows or an error, never a change
create temp table t_res (what text, changed int);
grant all on t_res to authenticated;
do $$
declare n int;
begin
  begin update public.users set status = 'suspended' where id = '71000006-0000-4000-8000-000000000006'; get diagnostics n = row_count; exception when others then n := 0; end;
  insert into t_res values ('users', n);
  begin update public.portfolio_items set title = 'hijacked' where id = 'd1000000-0000-4000-8000-0000000000a1'; get diagnostics n = row_count; exception when others then n := 0; end;
  insert into t_res values ('portfolio update', n);
  begin delete from public.portfolio_items where id = 'd1000000-0000-4000-8000-0000000000a1'; get diagnostics n = row_count; exception when others then n := 0; end;
  insert into t_res values ('portfolio delete', n);
  begin
    insert into public.portfolio_items (owner_user_id, object_key, content_type, title, project_id, state)
      values ('71000006-0000-4000-8000-000000000006', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02.jpg', 'image/jpeg', 'planted', 'b1000000-0000-4000-8000-0000000000a1', 'ready');
    n := 1;
  exception when others then n := 0; end;
  insert into t_res values ('portfolio insert as subject', n);
  begin update public.admin_view_sessions set expires_at = now() + interval '30 days'; get diagnostics n = row_count; exception when others then n := 0; end;
  insert into t_res values ('extend own view session', n);
end $$;
select is((select coalesce(sum(changed), 0)::int from t_res where what in ('users','portfolio update','portfolio delete','portfolio insert as subject')), 0,
  'B: a live view session lets the admin update, delete or insert NOTHING of the viewed account');
select is((select changed from t_res where what = 'extend own view session'), 0, 'B: the view session cannot be edited through the API (it is only ever created by begin)');

-- C. the shared resolvers still refuse
select is(public.media_storage_resolve('portfolio', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01.jpg', 'read'), null, 'C: the shared media resolver still refuses the admin inside a view');
select is(public.media_storage_resolve('portfolio', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01.jpg', 'write'), null, 'C: ... and for write');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, '00000000-0000-4000-8000-000000000000'), null, null, 'C: a view cannot be started on a non-existent subject');

-- D. nothing changed
select pg_temp.as_dba();
select is((select md5(row(u.*)::text) from public.users u where u.id = :'craft'), (select u from t_before), 'D: the viewed user row is unchanged');
select is((select md5(row(i.*)::text) from public.portfolio_items i where i.id = 'd1000000-0000-4000-8000-0000000000a1'), (select i from t_before), 'D: the viewed portfolio item is unchanged');

select * from finish();
rollback;

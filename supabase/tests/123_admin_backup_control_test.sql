-- pgTAP: Admin backup control (20261107090005_admin_backup_control.sql).
--
--   A. Permissions: catalog, locked Super Admin grants, Administrator = view only, nobody else
--   B. Status read: backup.view only; fails visibly closed before the environment is bound
--   C. Environment binding: service role only, Super Admin actor, idempotent, a second value refused
--   D. Manual requests: server-derived actor, single-use receipt bound to (actor, operation, environment), reason
--   E. Production gate: nothing runs until the separate activation (typed phrase + receipt)
--   F. Schedule: optimistic version, validation, audit
--   G. Workflow reports vs the server cross-check: a report can never mark a run succeeded
--   H. Closed tables and API-role isolation
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(71);

\set sa    'b1000000-0000-4000-8000-000000000001'
\set adm   'b1000000-0000-4000-8000-000000000002'
\set mdr   'b1000000-0000-4000-8000-000000000003'
\set plain 'b1000000-0000-4000-8000-000000000004'
\set sa2   'b1000000-0000-4000-8000-000000000005'

create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.call_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  perform pg_temp.as_dba();
  return coalesce(r, '{"void":true}'::jsonb);
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate, 'msg', sqlerrm);
end;
$$;
create function pg_temp.call_anon(p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  perform pg_temp.as_dba();
  return coalesce(r, '{"void":true}'::jsonb);
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate, 'msg', sqlerrm);
end;
$$;
create function pg_temp.call_svc(p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  perform pg_temp.as_dba();
  return coalesce(r, '{"void":true}'::jsonb);
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate, 'msg', sqlerrm);
end;
$$;
create function pg_temp.st(p_user uuid, p_sql text) returns text language sql as $$
  select coalesce(pg_temp.call_as(p_user, p_sql) ->> 'sqlstate', 'ok') $$;
create function pg_temp.sv(p_sql text) returns text language sql as $$
  select coalesce(pg_temp.call_svc(p_sql) ->> 'sqlstate', 'ok') $$;
grant execute on function pg_temp.as_dba() to authenticated, anon, service_role;

-- A current-password receipt as account_password_confirm would have issued it.
create function pg_temp.receipt(p_user uuid, p_op text, p_target text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into app.reauth_receipts (user_id, operation, target, expires_at)
  values (p_user, p_op, p_target, clock_timestamp() + interval '60 seconds') returning id into v;
  return v;
end;
$$;
create function pg_temp.request_as(p_user uuid, p_kind text, p_reason text, p_receipt uuid) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_backup_request(%L::uuid, %L, %L, %L::uuid)', p_user, p_kind, p_reason, p_receipt)) $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@probe.test', now(), jsonb_build_object('full_name', 'Probe ' || n), now(), now()
  from (values (:'sa'::uuid, 'bk-sa'), (:'adm'::uuid, 'bk-adm'), (:'mdr'::uuid, 'bk-mdr'), (:'plain'::uuid, 'bk-plain'), (:'sa2'::uuid, 'bk-sa2')) v(u, n);
insert into public.admin_role_assignments (user_id, role_id)
select v.u, r.id from (values (:'sa'::uuid, 'super_admin'), (:'sa2'::uuid, 'super_admin'), (:'adm'::uuid, 'administrator'), (:'mdr'::uuid, 'moderator')) v(u, k)
  join public.admin_roles r on r.key = v.k;

-- ===========================================================================
-- A. Permissions
-- ===========================================================================
select is((select count(*)::int from public.admin_permissions where key in ('backup.view', 'backup.execute', 'backup.schedule_manage', 'backup.restore_test')), 4,
  'A1 the four permissions exist');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where r.key = 'super_admin' and rp.permission_key like 'backup.%' and rp.is_locked), 4, 'A2 Super Admin holds all four, locked');
select is((select array_agg(rp.permission_key order by rp.permission_key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where r.key = 'administrator' and rp.permission_key like 'backup.%'), array['backup.view'],
  'A3 Administrator holds view only: it can neither run a backup nor change the schedule');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where r.key in ('moderator', 'support') and rp.permission_key like 'backup.%'), 0, 'A4 Moderator and Support hold nothing');

-- ===========================================================================
-- B. Status read (before the environment is bound)
-- ===========================================================================
select is(pg_temp.st(:'sa', 'public.admin_backup_status()'), 'ok', 'B1 Super Admin can read the status');
select is(pg_temp.st(:'adm', 'public.admin_backup_status()'), 'ok', 'B2 Administrator can read the status');
select is(pg_temp.st(:'mdr', 'public.admin_backup_status()'), '42501', 'B3 Moderator is refused');
select is(pg_temp.st(:'plain', 'public.admin_backup_status()'), '42501', 'B4 a user with no admin role is refused');
select is(pg_temp.call_anon('public.admin_backup_status()') ->> 'sqlstate', '42501', 'B5 anon cannot execute it');
select is(pg_temp.call_as(:'sa', 'public.admin_backup_status()') -> 'initialized', 'false'::jsonb, 'B6 an unbound database reports initialized = false');
select is(pg_temp.call_as(:'sa', 'public.admin_backup_status()') #>> '{settings,production_enabled}', 'false', 'B7 Production is OFF by default');
select is(pg_temp.call_as(:'sa', 'public.admin_backup_status()') #>> '{settings,acceptance_schedule}', 'off', 'B8 Acceptance scheduling is OFF by default');

-- ===========================================================================
-- C. Environment binding
-- ===========================================================================
select is(pg_temp.sv(format('public.admin_backup_request(%L::uuid, %L, %L, %L::uuid)', :'sa', 'backup', 'Nightly check before binding', pg_temp.receipt(:'sa', 'backup.execute', 'acceptance'))),
  '55000', 'C1 nothing can be requested before the environment is bound');
select is(pg_temp.st(:'sa', format('public.admin_backup_initialize(%L::uuid, %L)', :'sa', 'acceptance')), '42501',
  'C2 even a Super Admin''s own browser session cannot bind the environment (service role only)');
select is(pg_temp.sv(format('public.admin_backup_initialize(%L::uuid, %L)', :'adm', 'acceptance')), '42501', 'C3 an Administrator actor is refused');
select is(pg_temp.sv(format('public.admin_backup_initialize(%L::uuid, %L)', :'sa', 'staging')), '22023', 'C4 an unknown environment is refused');
select is(pg_temp.sv(format('public.admin_backup_initialize(%L::uuid, %L)', :'sa', 'acceptance')), 'ok', 'C5 a Super Admin actor binds Acceptance');
select is(pg_temp.sv(format('public.admin_backup_initialize(%L::uuid, %L)', :'sa', 'acceptance')), 'ok', 'C6 binding again with the same value is idempotent');
select is(pg_temp.sv(format('public.admin_backup_initialize(%L::uuid, %L)', :'sa', 'production')), '55000', 'C7 a database bound to Acceptance can never be rebound to Production');
select is((select count(*)::int from public.audit_log where action = 'backup.environment_initialized' and actor_user_id = :'sa'::uuid), 1, 'C8 the binding is audited once');
select is(pg_temp.call_as(:'adm', 'public.admin_backup_status()') ->> 'environment', 'acceptance', 'C9 the status now reports the bound environment');

-- ===========================================================================
-- D. Manual requests (Acceptance)
-- ===========================================================================
select is((pg_temp.request_as(:'adm', 'backup', 'Administrators may not run backups', pg_temp.receipt(:'adm', 'backup.execute', 'acceptance'))) ->> 'sqlstate', '42501',
  'D1 an Administrator cannot request a backup');
select is((pg_temp.request_as(:'sa', 'backup', 'No receipt supplied for this one', null)) ->> 'sqlstate', '42501', 'D2 no receipt, no backup');
select is((pg_temp.request_as(:'sa', 'backup', 'Receipt for the wrong operation', pg_temp.receipt(:'sa', 'backup.restore_test', 'acceptance'))) ->> 'sqlstate', '42501',
  'D3 a receipt for a different operation is refused');
select is((pg_temp.request_as(:'sa', 'backup', 'Receipt for the other environment', pg_temp.receipt(:'sa', 'backup.execute', 'production'))) ->> 'sqlstate', '42501',
  'D4 a Production receipt cannot authorise an Acceptance backup');
select is((pg_temp.request_as(:'sa', 'backup', 'Receipt of somebody else here', pg_temp.receipt(:'sa2', 'backup.execute', 'acceptance'))) ->> 'sqlstate', '42501',
  'D5 another user''s receipt is refused');
select is((pg_temp.request_as(:'sa', 'backup', 'short', pg_temp.receipt(:'sa', 'backup.execute', 'acceptance'))) ->> 'sqlstate', '22023', 'D6 a reason under 10 characters is refused');
select is((pg_temp.request_as(:'sa', 'snapshot', 'Unknown kind of run requested', pg_temp.receipt(:'sa', 'backup.execute', 'acceptance'))) ->> 'sqlstate', '22023', 'D7 an unknown kind is refused');
select is((select count(*)::int from app.backup_runs), 0, 'D8 none of the refusals created a run');

create temp table first_run on commit drop as
  select (pg_temp.request_as(:'sa', 'backup', 'Pre-release safety backup of Acceptance', pg_temp.receipt(:'sa', 'backup.execute', 'acceptance')) ->> 'id')::uuid as id;
select isnt((select id from first_run), null, 'D9 a Super Admin with a valid receipt requests a backup');
select is((select status from app.backup_runs where id = (select id from first_run)), 'requested', 'D10 the run starts as requested, never as succeeded');
select is((select environment from app.backup_runs where id = (select id from first_run)), 'acceptance', 'D11 the environment comes from the database, not the caller');
select is((select count(*)::int from public.audit_log where action = 'backup.run_requested' and actor_user_id = :'sa'::uuid), 1, 'D12 the request is audited');

select is((pg_temp.request_as(:'sa2', 'backup', 'Using the receipt of someone else', pg_temp.receipt(:'sa', 'backup.execute', 'acceptance')) ->> 'sqlstate'), '42501',
  'D13 a receipt issued to another user does not work');
select is((pg_temp.request_as(:'sa', 'backup', 'A second backup while one is outstanding', pg_temp.receipt(:'sa', 'backup.execute', 'acceptance')) ->> 'sqlstate'), '23505',
  'D14 a second manual backup is refused while one is outstanding (concurrent requests cannot double-run)');
create temp table spent on commit drop as select pg_temp.receipt(:'sa', 'backup.restore_test', 'acceptance') as r;
select isnt(pg_temp.request_as(:'sa', 'restore_test', 'Restore test on its own independent slot', (select r from spent)) ->> 'id', null,
  'D15 a restore test is independent of the outstanding backup');
select is((pg_temp.request_as(:'sa', 'restore_test', 'Replaying the very same receipt here', (select r from spent)) ->> 'sqlstate'), '42501',
  'D15b a receipt works once only (single use)');

select is(pg_temp.st(:'sa', format('public.admin_backup_request(%L::uuid, %L, %L, %L::uuid)', :'sa', 'backup', 'A browser session may not call this', null)), '42501',
  'D16 the browser (authenticated role) cannot execute the mutation at all');

-- ===========================================================================
-- E. Dispatch bookkeeping
-- ===========================================================================
select is(pg_temp.sv(format('public.admin_backup_mark_dispatched(%L::uuid, %L::uuid, true, 123456789, %L)', :'sa2', (select id from first_run), 'https://github.com/o/r/actions/runs/123456789')),
  '42501', 'E1 only the actor who requested the run can record its dispatch');
select is(pg_temp.sv(format('public.admin_backup_mark_dispatched(%L::uuid, %L::uuid, true, 123456789, %L)', :'sa', (select id from first_run), 'https://evil.example/run/1')),
  '22023', 'E2 a dispatch reference that is not a github.com run is refused');
select is(pg_temp.call_svc(format('public.admin_backup_mark_dispatched(%L::uuid, %L::uuid, true, 123456789, %L)', :'sa', (select id from first_run), 'https://github.com/o/r/actions/runs/123456789')) #>> '{}', 'dispatched',
  'E3 a confirmed dispatch is recorded');
select is((select status from app.backup_runs where id = (select id from first_run)), 'dispatched', 'E4 and the run is dispatched, still not succeeded');

-- ===========================================================================
-- F. Schedule
-- ===========================================================================
select is(pg_temp.sv(format('public.admin_backup_update_schedule(%L::uuid, %L, false, 0, %L, %L::uuid, %L::jsonb)', :'adm', 'daily', 'Administrators cannot change it', pg_temp.receipt(:'adm', 'backup.schedule_manage', 'acceptance'), '{"time":"02:15","weekday":0,"pause_hours":0}')),
  '42501', 'F1 an Administrator cannot change the schedule');
select is(pg_temp.sv(format('public.admin_backup_update_schedule(%L::uuid, %L, false, 0, %L, %L::uuid, %L::jsonb)', :'sa', 'hourly', 'Hourly is not an allowed frequency', pg_temp.receipt(:'sa', 'backup.schedule_manage', 'acceptance'), '{"time":"02:15","weekday":0,"pause_hours":0}')),
  '22023', 'F2 an unknown frequency is refused');
select is(pg_temp.sv(format('public.admin_backup_update_schedule(%L::uuid, %L, false, 7, %L, %L::uuid, %L::jsonb)', :'sa', 'daily', 'Someone else changed it meanwhile', pg_temp.receipt(:'sa', 'backup.schedule_manage', 'acceptance'), '{"time":"02:15","weekday":0,"pause_hours":0}')),
  'VC001', 'F3 a stale version is refused');
select is(pg_temp.sv(format('public.admin_backup_update_schedule(%L::uuid, %L, true, 0, %L, %L::uuid, %L::jsonb)', :'sa', 'daily', 'Restore schedule needs Production on', pg_temp.receipt(:'sa', 'backup.schedule_manage', 'acceptance'), '{"time":"02:15","weekday":0,"pause_hours":0}')),
  '22023', 'F4 a scheduled restore cannot be enabled while Production backups are off');
select is(pg_temp.sv(format('public.admin_backup_update_schedule(%L::uuid, %L, false, 0, %L, %L::uuid, %L::jsonb)', :'sa', 'daily', 'Time must look like a time', pg_temp.receipt(:'sa', 'backup.schedule_manage', 'acceptance'), '{"time":"25:99","weekday":0,"pause_hours":0}')),
  '22023', 'F4b an impossible Cairo time is refused');
select is(pg_temp.sv(format('public.admin_backup_update_schedule(%L::uuid, %L, false, 0, %L, %L::uuid, %L::jsonb)', :'sa', 'daily', 'A pause longer than seven days', pg_temp.receipt(:'sa', 'backup.schedule_manage', 'acceptance'), '{"time":"02:15","weekday":0,"pause_hours":200}')),
  '22023', 'F4c a pause longer than 168 hours (seven days) is refused');
select is(pg_temp.call_svc(format('public.admin_backup_update_schedule(%L::uuid, %L, false, 0, %L, %L::uuid, %L::jsonb)', :'sa', 'daily', 'Enable the daily Acceptance backup', pg_temp.receipt(:'sa', 'backup.schedule_manage', 'acceptance'), '{"time":"02:15","weekday":0,"pause_hours":48}')) #>> '{}', '1',
  'F5 a valid change bumps the version');
select is(pg_temp.call_as(:'adm', 'public.admin_backup_status()') #>> '{settings,acceptance_schedule}', 'daily', 'F6 the status shows the new schedule');
select is(pg_temp.call_as(:'adm', 'public.admin_backup_status()') #>> '{settings,schedule_time}', '02:15:00', 'F6b and the Cairo-local time, editable without a deploy');
select ok((pg_temp.call_as(:'adm', 'public.admin_backup_status()') #>> '{settings,paused_until}')::timestamptz > now() + interval '47 hours', 'F6c and the timed pause (automatic scheduling only)');
select is((select count(*)::int from public.audit_log where action = 'backup.settings_changed' and actor_user_id = :'sa'::uuid and metadata ->> 'reason' = 'Enable the daily Acceptance backup'), 1,
  'F7 the change is audited with its reason');

-- ===========================================================================
-- G. Reports vs the server cross-check
-- ===========================================================================
select is(pg_temp.sv(format('public.backup_report_run(%L, %L, 123456789, %L)', 'production', 'backup', 'running')), '42501', 'G1 a report for the other environment is refused');
select is(pg_temp.sv(format('public.backup_report_run(%L, %L, 123456789, %L)', 'acceptance', 'backup', 'running')), 'ok', 'G2 the workflow can report progress on its own run');
select is(pg_temp.sv(format('public.backup_report_run(%L, %L, 123456789, %L)', 'acceptance', 'backup', 'succeeded')), '42501',
  'G3 a success report without a conclusion and verified coverage is refused: a green planner or skipped job is never a backup');
select is(pg_temp.sv(format('public.backup_report_run(%L, %L, 123456789, %L, %L, %L::jsonb)', 'acceptance', 'backup', 'succeeded', 'success', '{"coverage_verified":"false"}')), '42501',
  'G3b coverage_verified must be exactly true');
select is((select status from app.backup_runs where github_run_id = 123456789), 'running', 'G3c the run is still only running after the refused reports');
select is(pg_temp.sv(format('public.admin_backup_reconcile(%L::uuid, %L::uuid, %L, %L, %L::jsonb, 999, %L)', :'adm', (select id from first_run), 'succeeded', 'success', '{}', 'https://github.com/o/r/actions/runs/999')),
  '42501', 'G4 a cross-check naming a different GitHub run is refused');
select is(pg_temp.call_svc(format('public.admin_backup_reconcile(%L::uuid, %L::uuid, %L, %L, %L::jsonb, 123456789, %L)', :'adm', (select id from first_run), 'succeeded', 'success', '{}', 'https://github.com/o/r/actions/runs/123456789')) #>> '{}', 'succeeded',
  'G5 the verified cross-check marks it succeeded');
select is((select count(*)::int from app.backup_runs where status = 'succeeded' and finished_at is not null), 1, 'G6 a succeeded run always has a finish time');
select is(pg_temp.sv(format('public.backup_report_run(%L, %L, 555, %L)', 'acceptance', 'backup', 'skipped')), 'ok', 'G7 a scheduled run unknown to the app is recorded');
select is((select trigger from app.backup_runs where github_run_id = 555), 'schedule', 'G8 as a scheduled run');
select is((select status from app.backup_runs where github_run_id = 555), 'skipped', 'G9 and a skipped run stays skipped, never succeeded');
select is(pg_temp.call_as(:'adm', 'public.admin_backup_status()') #>> '{latest,backup,id}', (select id::text from first_run), 'G10 the last successful backup is the verified one, not the skipped scheduled run');

-- ===========================================================================
-- H. Closed tables and the vocabulary
-- ===========================================================================
select is(pg_temp.st(:'sa', 'select count(*) from app.backup_runs'), '42501', 'H1 the run ledger is not readable through the API');
select is(pg_temp.st(:'sa', 'select count(*) from app.backup_settings'), '42501', 'H2 the settings table is not readable through the API');
select is(pg_temp.sv('select count(*) from app.backup_runs'), '42501', 'H3 not even the service role reads the ledger directly');
select throws_ok($$select app.reauth_target_normalize('backup.execute', 'staging')$$, '22023', 'invalid backup environment', 'H4 a receipt target must be acceptance or production');
select is(app.reauth_target_normalize('backup.schedule_manage', 'production'), 'production', 'H5 production is a valid receipt target');
select is(pg_temp.call_anon('public.backup_schedule_read()') ->> 'sqlstate', '42501', 'H6 anon cannot read the schedule used by the workflow');

select * from finish();
rollback;

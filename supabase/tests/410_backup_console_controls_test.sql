-- pgTAP: paginated backup history and the simpler backup controls (20261126130001_backup_console_controls.sql).
--   A. History: pages of 20, filters applied before paging, page clamped, own environment only, backup.view only
--   B. Production switch: backup.schedule_manage, Production only, audited once per real change
--   C. Schedule save without password or phrase: optimistic version, validation, audit
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(62);

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

create function pg_temp.hist(p_user uuid, p_args text default '') returns jsonb language sql as $$
  select pg_temp.call_as(p_user, 'public.admin_backup_runs(' || p_args || ')') $$;
create function pg_temp.seed(p_env text, p_kind text, p_status text, p_count int, p_base bigint, p_age interval) returns void language sql as $$
  insert into app.backup_runs (environment, kind, trigger, status, reason, github_run_id, requested_at, dispatched_at, finished_at)
  select p_env, p_kind, 'schedule', p_status, 'Scheduled run reported by GitHub.', p_base + g,
         clock_timestamp() - p_age - make_interval(mins => g), clock_timestamp() - p_age, clock_timestamp() - p_age
    from generate_series(1, p_count) g $$;
create function pg_temp.setting(p_key text) returns text language sql as $$
  select to_jsonb(s) ->> p_key from app.backup_settings s where singleton $$;
create function pg_temp.audits(p_action text) returns int language sql as $$
  select count(*)::int from public.audit_log where action = p_action and actor_user_id = 'b1000000-0000-4000-8000-000000000001' $$;
create function pg_temp.switch(p_user uuid, p_on boolean) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_backup_set_production(%L::uuid, %L::boolean)', p_user, p_on)) $$;
create function pg_temp.save(p_user uuid, p_version int, p_schedule text default 'daily', p_restore boolean default false,
  p_time text default '01:30', p_weekday int default 0, p_pause int default 0) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_backup_save_schedule(%L::uuid, %L, %L::boolean, %s, %L::jsonb)', p_user, p_schedule, p_restore, p_version,
    jsonb_build_object('time', p_time, 'weekday', p_weekday, 'pause_hours', p_pause))) $$;
create function pg_temp.err(p jsonb) returns text language sql as $$
  select case when jsonb_typeof(p) = 'object' then coalesce(p ->> 'sqlstate', 'ok') else 'ok' end $$;

select pg_temp.call_svc(format('public.admin_backup_initialize(%L::uuid, %L)', :'sa', 'acceptance'));

-- ===========================================================================
-- A. History
-- ===========================================================================
select is(pg_temp.hist(:'sa') ->> 'total', '0', 'A1 an empty ledger has nothing');
select is(pg_temp.hist(:'sa', '7') ->> 'page', '1', 'A2 and any page of it is page 1');
select pg_temp.seed('acceptance', 'backup', 'succeeded', 25, 1000, interval '1 day');
select pg_temp.seed('acceptance', 'backup', 'skipped', 15, 2000, interval '2 days');
select pg_temp.seed('acceptance', 'restore_test', 'failed', 5, 3000, interval '3 days');
select pg_temp.seed('production', 'backup', 'succeeded', 3, 4000, interval '1 hour');

select is(pg_temp.hist(:'sa') ->> 'total', '30', 'A3 skipped checks and the other environment are left out by default');
select is(jsonb_array_length(pg_temp.hist(:'sa') -> 'runs'), 20, 'A4 a page holds 20 runs: the filter is applied before paging');
select is(pg_temp.hist(:'sa') ->> 'page', '1', 'A5 page 1');
select is(pg_temp.hist(:'sa') ->> 'page_size', '20', 'A6 the page size is stated');
select is(pg_temp.hist(:'sa') ->> 'skipped_total', '15', 'A7 the hidden checks are counted');
select is((select count(*)::int from jsonb_array_elements(pg_temp.hist(:'sa') -> 'runs') r where r ->> 'status' = 'skipped'), 0, 'A8 none of them is listed');
select is(jsonb_array_length(pg_temp.hist(:'sa', '2') -> 'runs'), 10, 'A9 page 2 holds the rest');
select is((select count(*)::int from jsonb_array_elements(pg_temp.hist(:'sa', '1') -> 'runs') a
            join jsonb_array_elements(pg_temp.hist(:'sa', '2') -> 'runs') b on a ->> 'id' = b ->> 'id'), 0, 'A10 no run is on two pages');
select ok((pg_temp.hist(:'sa', '1') #>> '{runs,0,requested_at}')::timestamptz > (pg_temp.hist(:'sa', '1') #>> '{runs,19,requested_at}')::timestamptz,
  'A11 newest first');
select ok((pg_temp.hist(:'sa', '1') #> '{runs,0}') ?& array['id','kind','trigger','status','requested_by','reason','github_run_id','github_run_url',
  'github_conclusion','summary','error_code','requested_at','dispatched_at','started_at','finished_at','reported_at'], 'A12 a row has the same keys as before');
select is(pg_temp.hist(:'sa', '3') ->> 'page', '2', 'A13 a page past the end is the last page');
select is(jsonb_array_length(pg_temp.hist(:'sa', '99') -> 'runs'), 10, 'A14 and is not empty');
select is(pg_temp.hist(:'sa', '0') ->> 'page', '1', 'A15 page 0 is page 1');
select is(pg_temp.hist(:'sa', '-4') ->> 'page', '1', 'A16 a negative page is page 1');
select is(pg_temp.hist(:'sa', 'null') ->> 'page', '1', 'A17 no page is page 1');
select is(pg_temp.hist(:'sa', '2147483647') ->> 'page', '2', 'A18 the largest integer does not overflow');
select is(pg_temp.hist(:'sa', '1, null, null, true') ->> 'total', '45', 'A19 skipped checks on request');
select is(pg_temp.hist(:'sa', '1, null, ''skipped''') ->> 'total', '15', 'A20 asking for skipped shows them');
select is(pg_temp.hist(:'sa', '1, ''restore_test''') ->> 'total', '5', 'A21 filtered by kind');
select is(pg_temp.hist(:'sa', '1, ''restore_test''') ->> 'skipped_total', '0', 'A22 the hidden count follows the kind');
select is(pg_temp.hist(:'sa', '1, ''restore_test'', ''succeeded''') ->> 'total', '0', 'A23 both filters together');
select is(pg_temp.hist(:'sa', '1, ''x''') ->> 'sqlstate', '22023', 'A24 an unknown kind is refused');
select is(pg_temp.hist(:'sa', '1, null, ''x''') ->> 'sqlstate', '22023', 'A25 an unknown status is refused');
select is(pg_temp.hist(:'adm') ->> 'total', '30', 'A26 an Administrator reads the history');
select is(pg_temp.hist(:'mdr') ->> 'sqlstate', '42501', 'A27 a Moderator does not');
select is(pg_temp.hist(:'plain') ->> 'sqlstate', '42501', 'A28 nor a user without a role');
select is(pg_temp.call_anon('public.admin_backup_runs()') ->> 'sqlstate', '42501', 'A29 nor anon');

-- ===========================================================================
-- B. Production switch
-- ===========================================================================
select is(pg_temp.err(pg_temp.switch(:'sa', true)), '22023', 'B1 Acceptance has no Production switch');
delete from app.backup_environment;
select pg_temp.call_svc(format('public.admin_backup_initialize(%L::uuid, %L)', :'sa', 'production'));
select is(pg_temp.err(pg_temp.switch(:'adm', true)), '42501', 'B2 viewing is not enough to switch');
select is(pg_temp.err(pg_temp.call_svc(format('public.admin_backup_set_production(%L::uuid, null)', :'sa'))), '22023', 'B3 on or off must be said');
select is(pg_temp.switch(:'sa', true), 'true'::jsonb, 'B4 a Super Admin switches it on with no password or phrase');
select is(pg_temp.setting('production_enabled') || ' ' || pg_temp.setting('version'), 'true 1', 'B5 saved, with a new settings version');
select is(pg_temp.audits('backup.production_activated'), 1, 'B6 audited with the actor');
select is(pg_temp.switch(:'sa', true), 'true'::jsonb, 'B7 asking for the state it already has is accepted');
select is(pg_temp.setting('version') || ' ' || pg_temp.audits('backup.production_activated'), '1 1', 'B8 and changes and audits nothing');
update app.backup_settings set production_restore_schedule_enabled = true;
select is(pg_temp.switch(:'sa', false), 'false'::jsonb, 'B9 off');
select is(pg_temp.setting('production_enabled') || ' ' || pg_temp.setting('production_restore_schedule_enabled') || ' ' || pg_temp.setting('version'),
  'false false 2', 'B10 off also clears the restore schedule');
select is(pg_temp.audits('backup.production_deactivated'), 1, 'B11 audited');

-- ===========================================================================
-- C. Schedule save
-- ===========================================================================
select is(pg_temp.err(pg_temp.save(:'sa', 1)), 'VC001', 'C1 a form opened before the switch was flipped is stale');
select is(pg_temp.setting('production_enabled'), 'false', 'C2 and does not switch Production back');
select is(pg_temp.save(:'sa', 2), '3'::jsonb, 'C3 saved with no password, phrase or reason');
select is(pg_temp.setting('acceptance_schedule') || ' ' || pg_temp.setting('schedule_time'), 'daily 01:30:00', 'C4 daily at 01:30');
select is(pg_temp.audits('backup.settings_changed'), 1, 'C5 audited with the actor');
select is((select metadata #>> '{previous,acceptance_schedule}' from public.audit_log where action = 'backup.settings_changed' order by created_at desc limit 1),
  'off', 'C6 the audit keeps what it was before');
select is(pg_temp.err(pg_temp.save(:'sa', 3, 'daily', true)), '22023', 'C7 no restore schedule while Production is off');
select is(pg_temp.err(pg_temp.save(:'sa', 3, 'hourly')), '22023', 'C8 unknown frequency');
select is(pg_temp.err(pg_temp.save(:'sa', 3, 'daily', false, '25:00')), '22023', 'C9 bad time');
select is(pg_temp.err(pg_temp.save(:'sa', 3, 'daily', false, '01:30', 7)), '22023', 'C10 bad weekday');
select is(pg_temp.err(pg_temp.save(:'sa', 3, 'daily', false, '01:30', 0, 169)), '22023', 'C11 pause too long');
select is(pg_temp.err(pg_temp.save(:'sa', 3, 'daily', false, '01:30', 0, -1)), '22023', 'C12 negative pause');
select is(pg_temp.err(pg_temp.call_svc(format('public.admin_backup_save_schedule(%L::uuid, %L, false, 3, %L::jsonb)', :'sa', 'daily', '{"time":"01:30","weekday":"x","pause_hours":0}'))),
  '22023', 'C13 a non-number is refused cleanly');
select is(pg_temp.err(pg_temp.save(:'adm', 3)), '42501', 'C14 viewing is not enough to save');
select is(pg_temp.save(:'sa', 3, 'daily', false, '01:30', 0, 24), '4'::jsonb, 'C15 pause for 24 hours');
select ok(pg_temp.setting('paused_until')::timestamptz between clock_timestamp() + interval '23 hours 55 minutes' and clock_timestamp() + interval '24 hours 5 minutes',
  'C16 until about 24 hours from now');
select is(pg_temp.save(:'sa', 4), '5'::jsonb, 'C17 zero');
select is(pg_temp.setting('paused_until'), null, 'C18 clears the pause');
select is(pg_temp.st(:'sa', format('public.admin_backup_set_production(%L::uuid, true)', :'sa')), '42501', 'C19 a browser session cannot call the switch directly');
select is(pg_temp.call_anon(format('public.admin_backup_set_production(%L::uuid, true)', :'sa')) ->> 'sqlstate', '42501', 'C20 nor anon');
select is(pg_temp.st(:'sa', format('public.admin_backup_save_schedule(%L::uuid, %L, false, 5, %L::jsonb)', :'sa', 'off', '{}')), '42501', 'C21 nor the save');
select is(pg_temp.call_anon(format('public.admin_backup_save_schedule(%L::uuid, %L, false, 5, %L::jsonb)', :'sa', 'off', '{}')) ->> 'sqlstate', '42501', 'C22 nor anon');

select * from finish();
rollback;

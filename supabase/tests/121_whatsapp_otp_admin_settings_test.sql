-- pgTAP: admin-controlled WhatsApp OTP limits (20261103090001_whatsapp_otp_admin_settings.sql).
--
--   A. Permissions: the catalog, the locked Super Admin grants, Administrator = view only, everyone else nothing; view_check
--   B. begin: service role only; the ACTOR's permissions are judged in the database, validation, the Hard Ceiling's elevated permission and rules
--   C. finish: service role only, the actor's own request only, idempotent, audit with actor / old / new / reason / version
--   D. reconcile: service role only, completes from the authoritative record, ignores forgeries, closes stale requests
--   E. notification_record: service role only, fan-out only to staff holding whatsapp_otp.view through the EXISTING notifications,
--      idempotent, statistics-only payloads, malformed input refused
--   F. Closed tables and the allow-lists
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(127);

\set sa1   'a1000000-0000-4000-8000-000000000001'
\set sa2   'a1000000-0000-4000-8000-000000000002'
\set adm   'a1000000-0000-4000-8000-000000000003'
\set mdr   'a1000000-0000-4000-8000-000000000004'
\set sup   'a1000000-0000-4000-8000-000000000005'
\set plain 'a1000000-0000-4000-8000-000000000006'
\set mgr   'a1000000-0000-4000-8000-000000000007'
\set susp  'a1000000-0000-4000-8000-000000000008'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
-- One SQL expression as a signed-in user: its jsonb result, or {"sqlstate":..., "msg":...}.
create function pg_temp.call_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.act_as(p_user);
  execute 'select to_jsonb((' || p_sql || '))' into r;
  perform pg_temp.as_dba();
  return coalesce(r, '{"void":true}'::jsonb);
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate, 'msg', sqlerrm);
end;
$$;
-- The same as the anonymous role and as the service role.
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
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon, service_role;

-- Canonical settings payloads
create function pg_temp.s(p_daily int, p_ceiling int, p_warn int default 70, p_crit int default 90) returns jsonb language sql as $$
  select jsonb_build_object('daily_limit', p_daily, 'hard_ceiling', p_ceiling, 'warn_percent', p_warn, 'critical_percent', p_crit) $$;
-- begin / finish are SERVICE ROLE ONLY: the app server passes the actor it verified from the session. "as p_user" below means "for that actor".
create function pg_temp.begin_as(p_user uuid, p_ver int, p_old jsonb, p_new jsonb, p_reason text) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, %s, %L::jsonb, %L::jsonb, %L)', p_user, p_ver, p_old::text, p_new::text, p_reason)) $$;
create function pg_temp.fin_as(p_user uuid, p_req uuid, p_status text, p_ver int default null, p_code text default null) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_finish(%L::uuid, %L::uuid, %L, %L::int, %L)', p_user, p_req, p_status, p_ver, p_code)) $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@probe.test', now(), jsonb_build_object('full_name', 'Probe ' || n), now(), now()
  from (values (:'sa1'::uuid, 'wo-sa1'), (:'sa2'::uuid, 'wo-sa2'), (:'adm'::uuid, 'wo-adm'), (:'mdr'::uuid, 'wo-mdr'), (:'sup'::uuid, 'wo-sup'),
               (:'plain'::uuid, 'wo-plain'), (:'mgr'::uuid, 'wo-mgr'), (:'susp'::uuid, 'wo-susp')) v(u, n);
insert into public.admin_role_assignments (user_id, role_id)
select v.u, r.id from (values (:'sa1'::uuid, 'super_admin'), (:'sa2'::uuid, 'super_admin'), (:'adm'::uuid, 'administrator'), (:'mdr'::uuid, 'moderator'),
                              (:'sup'::uuid, 'support'), (:'susp'::uuid, 'administrator')) v(u, k)
  join public.admin_roles r on r.key = v.k;
-- A custom role that holds manage but NOT ceiling_manage.
insert into public.admin_roles (key, name, rank, scope_type) values ('probe_wo_manage', 'WO manage only', 70, 'platform');
insert into public.admin_role_permissions (role_id, permission_key) select id, 'whatsapp_otp.manage' from public.admin_roles where key = 'probe_wo_manage';
insert into public.admin_role_assignments (user_id, role_id) select :'mgr', id from public.admin_roles where key = 'probe_wo_manage';
update public.users set status = 'suspended' where id = :'susp';
-- The grant key: in production the owner inserts the value that is also the Worker's OTP_ADMIN_GRANT_SECRET. Here a fixed test key.
insert into app.whatsapp_otp_grant_key (id, key) values (1, decode(repeat('21', 32), 'hex'));

-- ===========================================================================
-- A. Permissions
-- ===========================================================================
select is((select count(*)::int from public.admin_permissions where key in ('whatsapp_otp.view', 'whatsapp_otp.manage', 'whatsapp_otp.ceiling_manage')), 3,
  'A1 the three permissions exist');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where r.key = 'super_admin' and rp.permission_key like 'whatsapp_otp.%' and rp.is_locked), 3,
  'A2 Super Admin holds all three, locked');
select is((select array_agg(rp.permission_key order by rp.permission_key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where r.key = 'administrator' and rp.permission_key like 'whatsapp_otp.%'), array['whatsapp_otp.view'],
  'A3 Administrator holds view only: it can neither change the limit nor the ceiling');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where r.key in ('moderator', 'support') and rp.permission_key like 'whatsapp_otp.%'), 0,
  'A4 Moderator and Support hold nothing');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where r.key = 'super_admin'), (select count(*)::int from public.admin_permissions), 'A5 Super Admin still holds every permission');
select is(pg_temp.st(:'sa1', 'public.admin_whatsapp_otp_view_check()'), 'ok', 'A6 Super Admin passes view_check');
select is(pg_temp.st(:'adm', 'public.admin_whatsapp_otp_view_check()'), 'ok', 'A7 Administrator passes view_check');
select is(pg_temp.st(:'mdr', 'public.admin_whatsapp_otp_view_check()'), '42501', 'A8 Moderator is refused');
select is(pg_temp.st(:'sup', 'public.admin_whatsapp_otp_view_check()'), '42501', 'A9 Support is refused');
select is(pg_temp.st(:'plain', 'public.admin_whatsapp_otp_view_check()'), '42501', 'A10 a user with no admin role is refused');
select is(pg_temp.st(:'susp', 'public.admin_whatsapp_otp_view_check()'), '42501', 'A11 a suspended Administrator is refused');
select is(pg_temp.call_anon('public.admin_whatsapp_otp_view_check()') ->> 'sqlstate', '42501', 'A12 anon cannot even execute it');

-- ===========================================================================
-- B. begin
-- ===========================================================================
select is(pg_temp.begin_as(:'adm', 0, null, pg_temp.s(150, 5000), 'Initial limits approved by the owner')::jsonb ->> 'sqlstate', '42501',
  'B1 an Administrator cannot begin a change');
select is(pg_temp.begin_as(:'plain', 0, null, pg_temp.s(150, 5000), 'Initial limits approved by the owner') ->> 'sqlstate', '42501', 'B2 an ordinary user cannot');
select is(pg_temp.call_anon($q$public.admin_whatsapp_otp_settings_begin('a1000000-0000-4000-8000-000000000001'::uuid, 0, null, '{}'::jsonb, 'x')$q$) ->> 'sqlstate', '42501', 'B3 anon cannot');
select is(pg_temp.call_as(:'sa1', format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, null, %L::jsonb, %L)', :'sa1', pg_temp.s(150, 5000)::text, 'Initial limits approved by the owner for launch')) ->> 'sqlstate', '42501',
  'B3b even a Super Admin''s OWN browser session cannot call begin: the privilege decision never rests on browser input');
select is(pg_temp.call_as(:'mgr', format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 1, %L::jsonb, %L::jsonb, %L)', :'mgr', pg_temp.s(150, 5000)::text, pg_temp.s(150, 5000)::text, 'forging an old ceiling to dodge the ceiling permission')) ->> 'sqlstate', '42501',
  'B3c a manage-only user cannot call it directly with a forged "old" to dodge ceiling_manage');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_begin(null::uuid, 0, null, %L::jsonb, %L)', pg_temp.s(150, 5000)::text, 'Initial limits approved by the owner for launch')) ->> 'sqlstate', '42501',
  'B3d a missing actor is refused');
select is(pg_temp.begin_as(:'susp', 0, null, pg_temp.s(150, 5000), 'Initial limits approved by the owner for launch') ->> 'sqlstate', '42501',
  'B3e a suspended administrator is refused even though the server asked');
select is(pg_temp.begin_as(:'mgr', 0, null, pg_temp.s(150, 5000), 'Initial limits approved by the owner') ->> 'sqlstate', '42501',
  'B4 manage WITHOUT ceiling_manage cannot set the ceiling (initialization is a ceiling change)');
select is((select count(*)::int from app.whatsapp_otp_settings_requests), 0, 'B5 nothing was recorded by any refused call');

create temp table first_req as select pg_temp.begin_as(:'sa1', 0, null, pg_temp.s(150, 5000), 'Initial limits approved by the owner for launch') as r;
select is((select r ->> 'actor_id' from first_req), :'sa1', 'B6 the actor comes from the verified session (auth.uid()), not from a parameter');
select is((select (r ->> 'ceiling_changed')::boolean from first_req), true, 'B7 the first initialization counts as a ceiling change (derived server-side)');
select is((select status || '/' || actor_id::text || '/' || expected_version from app.whatsapp_otp_settings_requests where id = (select (r ->> 'request_id')::uuid from first_req)),
  'pending/' || :'sa1' || '/0', 'B8 a pending ledger row is written for the actor');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.settings_requested' and actor_user_id = :'sa1'::uuid
            and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from first_req)
            and metadata -> 'new' ->> 'daily_limit' = '150' and metadata -> 'old' = 'null'::jsonb), 1,
  'B9 the audit event "requested" records the actor, the old and the new values');

-- Validation: every invalid payload is refused with 22023 and records nothing
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, null, %L::jsonb, %L)', :'sa1', pg_temp.s(6000, 5000)::text, 'Initial limits approved by the owner')), '22023', 'B10 limit above ceiling');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, null, %L::jsonb, %L)', :'sa1', pg_temp.s(150, 5000, 90, 70)::text, 'Initial limits approved by the owner')), '22023', 'B11 warning above critical');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, null, %L::jsonb, %L)', :'sa1', pg_temp.s(0, 5000)::text, 'Initial limits approved by the owner')), '22023', 'B12 zero limit');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, null, %L::jsonb, %L)', :'sa1', pg_temp.s(150, 1000001)::text, 'Initial limits approved by the owner')), '22023', 'B13 ceiling beyond the integer sanity bound');
select is(pg_temp.sv($q$public.admin_whatsapp_otp_settings_begin('a1000000-0000-4000-8000-000000000001'::uuid, 0, null, '{"daily_limit":150.5,"hard_ceiling":5000,"warn_percent":70,"critical_percent":90}'::jsonb, 'Initial limits approved by the owner')$q$), '22023', 'B14 a non-integer');
select is(pg_temp.sv($q$public.admin_whatsapp_otp_settings_begin('a1000000-0000-4000-8000-000000000001'::uuid, 0, null, '{"daily_limit":"150","hard_ceiling":5000,"warn_percent":70,"critical_percent":90}'::jsonb, 'Initial limits approved by the owner')$q$), '22023', 'B15 a string instead of a number');
select is(pg_temp.sv($q$public.admin_whatsapp_otp_settings_begin('a1000000-0000-4000-8000-000000000001'::uuid, 0, null, '{"daily_limit":150,"hard_ceiling":5000,"warn_percent":70}'::jsonb, 'Initial limits approved by the owner')$q$), '22023', 'B16 a missing key');
select is(pg_temp.sv($q$public.admin_whatsapp_otp_settings_begin('a1000000-0000-4000-8000-000000000001'::uuid, 0, null, '{"daily_limit":150,"hard_ceiling":5000,"warn_percent":70,"critical_percent":90,"extra":1}'::jsonb, 'Initial limits approved by the owner')$q$), '22023', 'B17 an extra key');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, null, %L::jsonb, %L)', :'sa1', pg_temp.s(150, 5000)::text, 'short')), '22023', 'B18 reason too short');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, null, %L::jsonb, %L)', :'sa1', pg_temp.s(150, 5000)::text, 'ten chars!!')), '22023', 'B19 a ceiling change needs at least 20 characters');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 1, null, %L::jsonb, %L)', :'sa1', pg_temp.s(150, 5000)::text, 'Initial limits approved by the owner')), '22023', 'B20 version 1 with no old settings');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 0, %L::jsonb, %L::jsonb, %L)', :'sa1', pg_temp.s(100, 5000)::text, pg_temp.s(150, 5000)::text, 'Initial limits approved by the owner')), '22023', 'B21 old settings with version 0');
select is(pg_temp.sv(format('public.admin_whatsapp_otp_settings_begin(%L::uuid, 1, %L::jsonb, %L::jsonb, %L)', :'sa1', pg_temp.s(150, 5000)::text, pg_temp.s(150, 5000)::text, 'No actual change here')), '22023', 'B22 a no-op');

-- The Hard Ceiling rules
select is(pg_temp.begin_as(:'sa1', 1, pg_temp.s(150, 5000), pg_temp.s(150, 100), 'Lowering the ceiling only, to the audit minimum') ->> 'msg', 'whatsapp_otp: ceiling_below_current_limit',
  'B23 lowering the ceiling below the CURRENT limit is rejected with its own explanation');
select is(pg_temp.begin_as(:'sa1', 1, pg_temp.s(150, 5000), pg_temp.s(80, 100), 'Lowering the limit and the ceiling together') ->> 'actor_id', :'sa1',
  'B24 ...unless the same request explicitly and atomically lowers the limit too');
select is(pg_temp.begin_as(:'mgr', 1, pg_temp.s(150, 5000), pg_temp.s(200, 5000), 'Raise the limit for launch week') ->> 'actor_id', :'mgr',
  'B25 a holder of manage (without ceiling_manage) CAN change the limit alone, and the actor is that user');
select is(pg_temp.begin_as(:'mgr', 1, pg_temp.s(150, 5000), pg_temp.s(150, 8000), 'Raise the ceiling after the Meta tier check passed') ->> 'sqlstate', '42501',
  'B26 ...but cannot change the ceiling');
select is(pg_temp.begin_as(:'sa2', 1, pg_temp.s(150, 5000), pg_temp.s(150, 8000), 'Raise the ceiling after the Meta tier check passed') ->> 'ceiling_changed', 'true',
  'B27 a Super Admin can, with a long enough reason');

-- ===========================================================================
-- C. finish
-- ===========================================================================
select is(pg_temp.call_as(:'sa1', format('public.admin_whatsapp_otp_settings_finish(%L::uuid, %L::uuid, ''applied'', 1, null)', :'sa1', (select (r ->> 'request_id') from first_req))) ->> 'sqlstate', '42501',
  'C0 a browser session cannot complete a change: only the server, holding the Worker''s signed answer, can');
select is(pg_temp.call_anon(format('public.admin_whatsapp_otp_settings_finish(%L::uuid, %L::uuid, ''applied'', 1, null)', :'sa1', (select (r ->> 'request_id') from first_req))) ->> 'sqlstate', '42501', 'C0b anon cannot either');
select is(pg_temp.fin_as(:'sa2', (select (r ->> 'request_id')::uuid from first_req), 'applied', 1) ->> 'sqlstate', '42501', 'C1 another Super Admin cannot complete SOMEONE ELSE''S request');
select is(pg_temp.fin_as(:'adm', (select (r ->> 'request_id')::uuid from first_req), 'applied', 1) ->> 'sqlstate', '42501', 'C2 an Administrator (not the actor) cannot complete a request');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'applied', 7) ->> 'sqlstate', '22023', 'C3 the applied version must be expected_version + 1');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'bogus', 1) ->> 'sqlstate', '22023', 'C4 an unknown status is refused');
select is(pg_temp.fin_as(:'sa1', gen_random_uuid(), 'applied', 1) ->> 'sqlstate', '42501', 'C5 an unknown request is refused');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_finish(null::uuid, %L::uuid, ''applied'', 1, null)', (select (r ->> 'request_id') from first_req))) ->> 'sqlstate', '42501', 'C5b a missing actor is refused');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'applied', 1) #>> '{}', 'applied', 'C6 the owner completes it');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.settings_changed' and actor_user_id = :'sa1'::uuid
            and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from first_req)
            and metadata -> 'new' ->> 'hard_ceiling' = '5000' and metadata ->> 'reason' = 'Initial limits approved by the owner for launch'
            and metadata ->> 'version' = '1' and metadata ->> 'ceiling_changed' = 'true'), 1,
  'C7 the audit event records the actor, the old and new values, the reason and the version');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'applied', 1) #>> '{}', 'applied', 'C8 completing twice is idempotent');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.settings_changed' and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from first_req)), 1,
  'C9 ...and writes no second audit row');
create temp table fail_req as select pg_temp.begin_as(:'sa1', 1, pg_temp.s(150, 5000), pg_temp.s(160, 5000), 'Small raise that the Worker will refuse') as r;
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from fail_req), 'failed', null, 'Bad Code!') ->> 'sqlstate', '22023', 'C10 a failure code must be a short lowercase token');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from fail_req), 'failed', null, 'stale_version') #>> '{}', 'failed', 'C11 a refused change is recorded as failed');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.settings_change_failed' and metadata ->> 'code' = 'stale_version' and actor_user_id = :'sa1'::uuid), 1, 'C12 with its own audit event');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from fail_req), 'applied', 2) #>> '{}', 'failed', 'C13 a finished request can never flip to applied');

-- ===========================================================================
-- D. reconcile (service role only)
-- ===========================================================================
create temp table rec_req as select pg_temp.begin_as(:'sa1', 1, pg_temp.s(150, 5000), pg_temp.s(170, 5000), 'Raise that the Worker applied but Supabase missed') as r;
select is(pg_temp.call_as(:'sa1', 'public.admin_whatsapp_otp_settings_reconcile(''[]''::jsonb)') ->> 'sqlstate', '42501', 'D1 a Super Admin''s browser session cannot call reconcile');
select is(pg_temp.call_anon('public.admin_whatsapp_otp_settings_reconcile(''[]''::jsonb)') ->> 'sqlstate', '42501', 'D2 anon cannot');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from rec_req), 'actor', :'sa2', 'version', 2, 'at', 1793600100, 'new', pg_temp.s(170, 5000)))::text)) ->> 'applied', '0',
  'D3 a record naming a DIFFERENT actor is ignored (no forged completion)');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from rec_req), 'actor', :'sa1', 'version', 9, 'at', 1793600101, 'new', pg_temp.s(170, 5000)))::text)) ->> 'applied', '0',
  'D4 a record with the wrong version is ignored');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array('junk', 5, jsonb_build_object('request_id', 'nope'), jsonb_build_object('request_id', (select r ->> 'request_id' from rec_req), 'actor', :'sa1', 'version', 2, 'at', 1793600102, 'new', pg_temp.s(170, 5000)))::text)) ->> 'applied', '1',
  'D5 malformed elements are skipped and the genuine record completes the pending request');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.settings_changed' and metadata ->> 'reconciled' = 'true'
            and metadata ->> 'actor_id' = :'sa1' and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from rec_req)), 1,
  'D6 the reconciled audit event names the original actor in its metadata');
select is(pg_temp.call_svc('public.admin_whatsapp_otp_settings_reconcile(''[]''::jsonb)') ->> 'applied', '0', 'D7 reconciling again completes nothing twice');
select is(pg_temp.call_svc('public.admin_whatsapp_otp_settings_reconcile(''"x"''::jsonb)') ->> 'sqlstate', '22023', 'D8 a non-array input is refused');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)', (select jsonb_agg(jsonb_build_object('request_id', gen_random_uuid())) from generate_series(1, 101))::text)) ->> 'sqlstate', '22023',
  'D9 more than 100 elements are refused');
create temp table stale_req as select pg_temp.begin_as(:'sa1', 1, pg_temp.s(150, 5000), pg_temp.s(175, 5000), 'Request that the Worker never applied') as r;
update app.whatsapp_otp_settings_requests set created_at = created_at - interval '16 minutes' where id = (select (r ->> 'request_id')::uuid from stale_req);
select is(pg_temp.call_svc('public.admin_whatsapp_otp_settings_reconcile(''[]''::jsonb)') ->> 'abandoned', '1', 'D10 a request older than 15 minutes that D1 never applied is closed');
select is((select status || '/' || result_code from app.whatsapp_otp_settings_requests where id = (select (r ->> 'request_id')::uuid from stale_req)), 'abandoned/not_applied', 'D11 as abandoned / not_applied');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.settings_change_failed' and metadata ->> 'code' = 'not_applied'), 1, 'D12 with an audit event');

-- ===========================================================================
-- E. notification_record
-- ===========================================================================
select is(pg_temp.call_as(:'sa1', $q$public.whatsapp_otp_notification_record('budget_warning:1', 'budget_warning', 'acceptance', 1793600000, '{"percent":70}'::jsonb)$q$) ->> 'sqlstate', '42501',
  'E1 a Super Admin''s browser session cannot inject a notification');
select is(pg_temp.call_anon($q$public.whatsapp_otp_notification_record('budget_warning:1', 'budget_warning', 'acceptance', 1793600000, '{"percent":70}'::jsonb)$q$) ->> 'sqlstate', '42501', 'E2 anon cannot');
create temp table n1 as select pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:1', 'budget_warning', 'acceptance', 1793600000,
  '{"limit":150,"ceiling":5000,"consumed":105,"remaining":45,"percent":70,"warn_percent":70,"critical_percent":90,"accepted":100,"failed":5,"reserved":0,"level":"warning"}'::jsonb)$q$) as r;
select is((select r ->> 'status' from n1), 'recorded', 'E3 a valid event is recorded');
create temp table view_holders as
  select distinct a.user_id from public.admin_role_assignments a
    join public.admin_roles r on r.id = a.role_id and r.status = 'active'
    join public.admin_role_permissions rp on rp.role_id = r.id and rp.permission_key = 'whatsapp_otp.view'
    join public.users u on u.id = a.user_id
   where a.is_active and a.scope_type = 'platform' and u.status not in ('suspended', 'deactivated');
select is((select (r ->> 'recipients')::int from n1), (select count(*)::int from view_holders), 'E4 it reaches exactly the active staff holding whatsapp_otp.view');
select ok((select count(*) = 3 from view_holders where user_id in (:'sa1'::uuid, :'sa2'::uuid, :'adm'::uuid))
          and (select count(*) = 3 from public.notifications where event_type = 'whatsapp_otp.budget_warning' and recipient_user_id in (:'sa1'::uuid, :'sa2'::uuid, :'adm'::uuid)),
  'E5 both Super Admins and the Administrator are recipients');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.budget_warning'
            and recipient_user_id in (:'susp'::uuid, :'mdr'::uuid, :'sup'::uuid, :'mgr'::uuid, :'plain'::uuid)), 0,
  'E5b the suspended Administrator, Moderator, Support, the manage-only user and an ordinary user receive nothing');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.budget_warning' and deep_link = '/admin/whatsapp-otp' and read_at is null
            and title_key = 'notifications.whatsapp_otp.budget_warning.title' and body_key = 'notifications.whatsapp_otp.budget_warning.body'
            and params ->> 'percent' = '70' and params ->> 'environment' = 'acceptance' and organization_id is null), (select count(*)::int from view_holders),
  'E6 the rows use the existing inbox shape: i18n keys, a relative deep link, unread, statistics in params');
select is((select count(*)::int from public.notifications where event_type like 'whatsapp_otp.%' and (params::text ~* '(\+20|whsec|token|secret|password|code)')), 0,
  'E7 no credential, phone number or code can appear in a notification');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:1', 'budget_warning', 'acceptance', 1793600000, '{"percent":70}'::jsonb)$q$) ->> 'status', 'duplicate',
  'E8 the same event again (a retry or replay) is a duplicate');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.budget_warning'), (select count(*)::int from view_holders), 'E9 and creates no new notifications');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:1', 'budget_warning', 'acceptance', 1793700000, '{"percent":71}'::jsonb)$q$) ->> 'status', 'recorded',
  'E10 the same key with a different occurrence time (a recreated Worker database) is NOT swallowed');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_exhausted:3', 'budget_exhausted', 'production', 1793700001, '{"level":"exhausted","percent":100}'::jsonb)$q$) ->> 'status', 'recorded', 'E11 the exhausted kind is accepted');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('failure_rate:2', 'failure_rate', 'acceptance', 1793700002, '{"attempts":40,"failed":15,"failure_percent":38,"window_minutes":60}'::jsonb)$q$) ->> 'status', 'recorded', 'E12 the failure-rate kind is accepted');
-- malformed input
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'acceptance', 1793700003, '{"phone":"+201012345678"}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E13 an unknown (possibly personal) key is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'acceptance', 1793700003, '{"percent":"70"}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E14 a number sent as a string is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'acceptance', 1793700003, '{"percent":70.5}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E15 a fraction is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'acceptance', 1793700003, '{"level":"<script>"}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E16 an invalid level is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'acceptance', 1793700003, '{"percent":{"a":1}}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E17 a nested value is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_critical:2', 'budget_warning', 'acceptance', 1793700003, '{"percent":70}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E18 a key that does not match its kind is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('x', 'bogus', 'acceptance', 1793700003, '{"percent":70}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E19 an unknown kind is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'Production!', 1793700003, '{"percent":70}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E20 a malformed environment name is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'acceptance', 5, '{"percent":70}'::jsonb)$q$) ->> 'sqlstate', '22023', 'E21 an impossible time is refused');
select is(pg_temp.call_svc($q$public.whatsapp_otp_notification_record('budget_warning:2', 'budget_warning', 'acceptance', 1793700003, '{"failed":1,"accepted":2}'::jsonb)$q$) ->> 'status', 'recorded', 'E22 a numeric key valid for the kind passes');
select is((select count(*)::int from app.whatsapp_otp_notification_events where kind <> 'audit_unmatched'), 5, 'E23 the ledger holds exactly the five recorded events (each refusal left nothing behind)');
-- the existing inbox rules still apply: only the recipient reads or marks their own row
select is(pg_temp.call_as(:'adm', $q$(select count(*) from public.notifications where event_type = 'whatsapp_otp.budget_warning')$q$) #>> '{}', '3', 'E24 an Administrator sees exactly their own three alerts through RLS');
select is(pg_temp.call_as(:'mdr', $q$(select count(*) from public.notifications where event_type like 'whatsapp_otp.%')$q$) #>> '{}', '0', 'E25 a Moderator sees none of them');

-- ===========================================================================
-- F. Closed tables and allow-lists
-- ===========================================================================
select is(pg_temp.call_as(:'sa1', 'jsonb_build_object(''n'', (select count(*) from app.whatsapp_otp_settings_requests))') ->> 'sqlstate', '42501', 'F1 the requests ledger is closed to every client role');
select is(pg_temp.call_as(:'sa1', 'jsonb_build_object(''n'', (select count(*) from app.whatsapp_otp_notification_events))') ->> 'sqlstate', '42501', 'F2 the notification ledger is closed too');
select ok((select pg_get_constraintdef(oid) like '%whatsapp_otp.settings_changed%' and pg_get_constraintdef(oid) like '%whatsapp_otp.settings_requested%' and pg_get_constraintdef(oid) like '%whatsapp_otp.settings_change_failed%'
            from pg_constraint where conname = 'ck_audit_action_known'), 'F3 the audit allow-list gained the three actions');
select ok((select pg_get_constraintdef(oid) like '%whatsapp_otp.failure_rate%' and pg_get_constraintdef(oid) like '%whatsapp_otp.audit_unmatched%' and pg_get_constraintdef(oid) like '%message.sent%' and pg_get_constraintdef(oid) like '%job.review.received%'
            from pg_constraint where conname = 'ck_notifications_event_type_known'), 'F4 the notification allow-list gained the five events and kept every existing one');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where p.proname in ('admin_whatsapp_otp_settings_begin', 'admin_whatsapp_otp_settings_finish', 'admin_whatsapp_otp_settings_reconcile', 'whatsapp_otp_notification_record')
                         and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  'F5 begin, finish, reconcile and notification_record are executable by no client role');
select ok(not exists (select 1 from pg_proc p where p.proname like 'admin_whatsapp_otp%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  'F6 no admin function is executable by anon or PUBLIC');

-- ===========================================================================
-- G. The database-issued grant (a leaked admin signing secret cannot authorize or impersonate) and detection of unmatched changes
-- ===========================================================================
create temp table grant_req as select pg_temp.begin_as(:'sa1', 1, pg_temp.s(170, 5000), pg_temp.s(180, 5000), 'Grant probe: a small raise of the daily limit') as r;
select ok((select r ->> 'grant' ~ '^[A-Za-z0-9+/]{43}=$' from grant_req), 'G1 begin returns a grant (a base64 HMAC-SHA256)');
select is((select r ->> 'grant' from grant_req),
  encode(extensions.hmac(convert_to(format('v1|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s', (select r ->> 'request_id' from grant_req), :'sa1', 1, 180, 5000, 70, 90, 0,
    (select r ->> 'grant_expires' from grant_req), encode(extensions.digest(convert_to('Grant probe: a small raise of the daily limit', 'UTF8'), 'sha256'), 'hex')), 'UTF8'),
    decode(repeat('21', 32), 'hex'), 'sha256'), 'base64'),
  'G2 it equals an independent HMAC over exactly this request, actor, version, values, ceiling flag, expiry and reason hash');
select ok((select (r ->> 'grant_expires')::bigint between extract(epoch from now())::bigint + 290 and extract(epoch from now())::bigint + 310 from grant_req), 'G3 it is valid for five minutes');
select is((select r ->> 'reason' from grant_req), 'Grant probe: a small raise of the daily limit', 'G4 the reason the grant covers is returned exactly as stored');
create temp table grant_ceiling as select pg_temp.begin_as(:'sa1', 1, pg_temp.s(170, 5000), pg_temp.s(170, 6000), 'Raise the ceiling for the launch window, approved') as r;
select is((select r ->> 'ceiling_changed' from grant_ceiling), 'true', 'G5 a ceiling change is marked as database-authorized inside the grant');
select isnt((select r ->> 'grant' from grant_ceiling), (select r ->> 'grant' from grant_req), 'G6 every request gets its own grant');
select is(pg_temp.call_svc('jsonb_build_object(''n'', (select count(*) from app.whatsapp_otp_grant_key))') ->> 'sqlstate', '42501', 'G7 the grant key is unreadable by the service role');
select is(pg_temp.call_as(:'sa1', 'jsonb_build_object(''n'', (select count(*) from app.whatsapp_otp_grant_key))') ->> 'sqlstate', '42501', 'G8 ...and by a signed-in Super Admin');
select throws_ok($q$insert into app.whatsapp_otp_grant_key (id, key) values (2, decode(repeat('21', 32), 'hex'))$q$, '23514', null, 'G9 only one key row can exist');
select throws_ok($q$update app.whatsapp_otp_grant_key set key = decode('2121', 'hex') where id = 1$q$, '23514', null, 'G10 a short key is refused by the table');
create temp table req_count as select count(*)::int n from app.whatsapp_otp_settings_requests;
delete from app.whatsapp_otp_grant_key;
select is(pg_temp.begin_as(:'sa1', 1, pg_temp.s(170, 5000), pg_temp.s(190, 5000), 'Must not be recorded without a grant key') ->> 'sqlstate', '55000', 'G11 without a grant key no change can begin (fail closed)');
select is((select count(*)::int from app.whatsapp_otp_settings_requests), (select n from req_count), 'G12 ...and nothing was recorded');
insert into app.whatsapp_otp_grant_key (id, key) values (1, decode(repeat('21', 32), 'hex'));

-- Detection: a change in the Worker's audit that no approved request accounts for
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('request_id', gen_random_uuid(), 'actor', :'sa1', 'version', 41, 'at', 1793600200, 'new', pg_temp.s(4000, 5000)))::text)) ->> 'unmatched', '1',
  'G13 a Worker change with no request at all is reported as unmatched');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.audit_unmatched' and params ->> 'version' = '41' and recipient_user_id in (:'sa1'::uuid, :'sa2'::uuid, :'adm'::uuid)), 3,
  'G14 it reaches both Super Admins and the Administrator through the existing notifications');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.audit_unmatched' and recipient_user_id in (:'susp'::uuid, :'mdr'::uuid, :'sup'::uuid, :'mgr'::uuid, :'plain'::uuid)), 0,
  'G15 nobody else, and not a suspended account, receives it');
select is((select params::text from public.notifications where event_type = 'whatsapp_otp.audit_unmatched' and params ->> 'version' = '41' limit 1), '{"version": 41}',
  'G16 the notification carries the version number only (no actor, values or reason)');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('request_id', gen_random_uuid(), 'actor', :'sa1', 'version', 41, 'at', 1793600200, 'new', pg_temp.s(4000, 5000)))::text)) ->> 'unmatched', '0',
  'G17 seeing the same change again alerts nobody twice');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.audit_unmatched' and params ->> 'version' = '41'), (select count(*)::int from view_holders), 'G18 ...and creates no new notifications');
-- a genuine request, but the Worker applied DIFFERENT values than were approved
create temp table mis_req as select pg_temp.begin_as(:'sa1', 1, pg_temp.s(170, 5000), pg_temp.s(185, 5000), 'Values will differ from what the Worker applied') as r;
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from mis_req), 'actor', :'sa1', 'version', 2, 'at', 1793600300, 'new', pg_temp.s(4900, 5000)))::text)) ->> 'unmatched', '1',
  'G19 a real request whose applied values differ from the approved ones is reported');
select is((select status from app.whatsapp_otp_settings_requests where id = (select (r ->> 'request_id')::uuid from mis_req)), 'pending', 'G20 ...and is NOT marked as applied');
-- a request that Supabase already recorded as applied does not alert when it is seen again
create temp table ok_req as select pg_temp.begin_as(:'sa1', 1, pg_temp.s(170, 5000), pg_temp.s(186, 5000), 'A normal change that completes cleanly') as r;
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from ok_req), 'applied', 2) #>> '{}', 'applied', 'G21 a normal change completes');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from ok_req), 'actor', :'sa1', 'version', 2, 'at', 1793600400, 'new', pg_temp.s(186, 5000)))::text)) ->> 'unmatched', '0',
  'G22 a matching applied change is not reported');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_settings_reconcile(%L::jsonb)',
  jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from ok_req), 'actor', :'sa1', 'version', 2, 'at', 12, 'new', pg_temp.s(186, 5000)),
                    jsonb_build_object('request_id', gen_random_uuid(), 'actor', :'sa1', 'version', 77, 'new', pg_temp.s(1, 5000)),
                    jsonb_build_object('request_id', gen_random_uuid(), 'actor', :'sa1', 'version', 78, 'at', 1793600500, 'new', jsonb_build_object('daily_limit', 9)))::text)) ->> 'unmatched', '0',
  'G23 elements with an impossible time, no time or invalid values are skipped, never raised');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'app' and p.proname = 'whatsapp_otp_record_unmatched'
                         and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                              or has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))),
  'G24 the internal alert function is executable by no client role');

select * from finish();
rollback;

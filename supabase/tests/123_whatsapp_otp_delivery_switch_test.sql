-- pgTAP: the Super Admin WhatsApp OTP delivery switch (20261105100001_whatsapp_otp_delivery_switch.sql).
--
--   A. begin: service role only; the ACTOR's whatsapp_otp.manage is judged in the database; refusals record nothing
--   B. begin: the ledger row, the "requested" audit event with actor / old / new / reason, the "v1d" grant, validation
--   C. finish: service role only, the actor's own request only, idempotent, audit with actor / old / new / reason / version
--   D. reconcile: service role only, completes from the authoritative record, ignores forgeries, closes stale requests
--   E. Closed table, vocabulary, function hardening and grants
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(66);

\set sa1   'b1000000-0000-4000-8000-000000000001'
\set sa2   'b1000000-0000-4000-8000-000000000002'
\set adm   'b1000000-0000-4000-8000-000000000003'
\set plain 'b1000000-0000-4000-8000-000000000004'
\set mgr   'b1000000-0000-4000-8000-000000000005'
\set susp  'b1000000-0000-4000-8000-000000000006'

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
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon, service_role;

-- begin / finish / reconcile are SERVICE ROLE ONLY: the app server passes the actor it verified from the session.
create function pg_temp.begin_as(p_user uuid, p_ver int, p_old boolean, p_new boolean, p_reason text) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_whatsapp_otp_delivery_begin(%L::uuid, %s, %L::boolean, %L::boolean, %L)', p_user, p_ver, p_old, p_new, p_reason)) $$;
create function pg_temp.fin_as(p_user uuid, p_req uuid, p_status text, p_ver int default null, p_code text default null) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_whatsapp_otp_delivery_finish(%L::uuid, %L::uuid, %L, %L::int, %L)', p_user, p_req, p_status, p_ver, p_code)) $$;
create function pg_temp.reconcile(p_rows jsonb) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_whatsapp_otp_delivery_reconcile(%L::jsonb)', p_rows::text)) $$;

create function pg_temp.reconcile_drift(p_rows jsonb, p_drift jsonb) returns jsonb language sql as $$
  select pg_temp.call_svc(format('public.admin_whatsapp_otp_delivery_reconcile(%L::jsonb, %L::jsonb)', p_rows::text, p_drift::text)) $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@probe.test', now(), jsonb_build_object('full_name', 'Probe ' || n), now(), now()
  from (values (:'sa1'::uuid, 'wd-sa1'), (:'sa2'::uuid, 'wd-sa2'), (:'adm'::uuid, 'wd-adm'), (:'plain'::uuid, 'wd-plain'),
               (:'mgr'::uuid, 'wd-mgr'), (:'susp'::uuid, 'wd-susp')) v(u, n);
insert into public.admin_role_assignments (user_id, role_id)
select v.u, r.id from (values (:'sa1'::uuid, 'super_admin'), (:'sa2'::uuid, 'super_admin'), (:'adm'::uuid, 'administrator'), (:'susp'::uuid, 'super_admin')) v(u, k)
  join public.admin_roles r on r.key = v.k;
-- A custom role that holds manage but NOT ceiling_manage: the delivery switch needs only manage.
insert into public.admin_roles (key, name, rank, scope_type) values ('probe_wd_manage', 'WD manage only', 70, 'platform');
insert into public.admin_role_permissions (role_id, permission_key) select id, 'whatsapp_otp.manage' from public.admin_roles where key = 'probe_wd_manage';
insert into public.admin_role_assignments (user_id, role_id) select :'mgr', id from public.admin_roles where key = 'probe_wd_manage';
update public.users set status = 'suspended' where id = :'susp';
insert into app.whatsapp_otp_grant_key (id, key) values (1, decode(repeat('21', 32), 'hex'));

-- ===========================================================================
-- A. begin: who may, and refusals record nothing
-- ===========================================================================
select is(pg_temp.begin_as(:'adm', 0, null, true, 'Acceptance window approved by owner') ->> 'sqlstate', '42501', 'A1 an Administrator (view only) cannot begin');
select is(pg_temp.begin_as(:'plain', 0, null, true, 'Acceptance window approved by owner') ->> 'sqlstate', '42501', 'A2 an ordinary user cannot');
select is(pg_temp.call_anon($q$public.admin_whatsapp_otp_delivery_begin('b1000000-0000-4000-8000-000000000001'::uuid, 0, null, true, 'Acceptance window approved')$q$) ->> 'sqlstate', '42501', 'A3 anon cannot');
select is(pg_temp.call_as(:'sa1', format('public.admin_whatsapp_otp_delivery_begin(%L::uuid, 0, null, true, %L)', :'sa1', 'Acceptance window approved by owner')) ->> 'sqlstate', '42501',
  'A4 even a Super Admin''s OWN browser session cannot call begin: the privilege decision never rests on browser input');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_delivery_begin(null::uuid, 0, null, true, %L)', 'Acceptance window approved by owner')) ->> 'sqlstate', '42501', 'A5 a missing actor is refused');
select is(pg_temp.begin_as(:'susp', 0, null, true, 'Acceptance window approved by owner') ->> 'sqlstate', '42501', 'A6 a suspended Super Admin is refused even though the server asked');
select is((select count(*)::int from app.whatsapp_otp_delivery_requests), 0, 'A7 nothing was recorded by any refused call');
select is(pg_temp.begin_as(:'mgr', 0, null, true, 'Acceptance window approved by owner') ->> 'actor_id', :'mgr',
  'A8 manage alone is enough: the delivery switch needs no ceiling permission');

-- ===========================================================================
-- B. begin: ledger, audit, grant, validation
-- ===========================================================================
create temp table first_req as select pg_temp.begin_as(:'sa1', 0, null, true, 'Acceptance window approved by owner') as r;
select is((select r ->> 'actor_id' from first_req), :'sa1', 'B1 the actor is the verified user passed by the server');
select is((select status || '/' || actor_id::text || '/' || expected_version || '/' || new_enabled from app.whatsapp_otp_delivery_requests where id = (select (r ->> 'request_id')::uuid from first_req)),
  'pending/' || :'sa1' || '/0/true', 'B2 a pending ledger row records the actor and the requested state');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.delivery_requested' and actor_user_id = :'sa1'::uuid
            and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from first_req)
            and metadata -> 'new' = 'true'::jsonb and metadata -> 'old' = 'null'::jsonb and metadata ->> 'reason' = 'Acceptance window approved by owner'), 1,
  'B3 the "requested" audit event records the actor, the old and the new state and the reason');
select is((select r ->> 'grant' from first_req),
  (select encode(extensions.hmac(convert_to(format('v1d|%s|%s|0|1|%s|%s', r ->> 'request_id', :'sa1', r ->> 'grant_expires',
      encode(extensions.digest(convert_to('Acceptance window approved by owner', 'UTF8'), 'sha256'), 'hex')), 'UTF8'), decode(repeat('21', 32), 'hex'), 'sha256'), 'base64') from first_req),
  'B4 the grant is the HMAC of exactly "v1d|request|actor|version|enabled|expires|sha256(reason)" under the grant key');
select ok((select (r ->> 'grant_expires')::bigint between extract(epoch from now())::bigint + 200 and extract(epoch from now())::bigint + 400 from first_req), 'B5 the grant lives about five minutes');
select isnt((select r ->> 'grant' from first_req),
  (select encode(extensions.hmac(convert_to(format('v1|%s|%s|0|0|0|0|0|0|%s|%s', r ->> 'request_id', :'sa1', r ->> 'grant_expires',
      encode(extensions.digest(convert_to('Acceptance window approved by owner', 'UTF8'), 'sha256'), 'hex')), 'UTF8'), decode(repeat('21', 32), 'hex'), 'sha256'), 'base64') from first_req),
  'B6 the grant uses its own "v1d" format, so a settings-style grant can never stand in for it');
select is(pg_temp.begin_as(:'sa1', 0, null, true, 'short') ->> 'sqlstate', '22023', 'B7 reason shorter than 10 characters');
select is(pg_temp.begin_as(:'sa1', 0, null, true, repeat('x', 501)) ->> 'sqlstate', '22023', 'B8 reason longer than 500 characters');
select is(pg_temp.begin_as(:'sa1', 1, true, true, 'No actual change requested here') ->> 'msg', 'whatsapp_otp: no_change', 'B9 repeating the current state is a no-op');
select is(pg_temp.begin_as(:'sa1', 0, null, false, 'No row already means off here') ->> 'msg', 'whatsapp_otp: no_change', 'B10 turning OFF when the Worker has no row is a no-op (no row = OFF)');
select is(pg_temp.begin_as(:'sa1', 1, null, true, 'Version one cannot have no old state') ->> 'sqlstate', '22023', 'B11 version 1 with no old state');
select is(pg_temp.begin_as(:'sa1', 0, true, false, 'Version zero cannot have an old state') ->> 'sqlstate', '22023', 'B12 old state with version 0');
select is(pg_temp.call_svc(format('public.admin_whatsapp_otp_delivery_begin(%L::uuid, 0, null, null, %L)', :'sa1', 'A missing requested state is refused')) ->> 'sqlstate', '22023', 'B13 a missing requested state');
select is(pg_temp.begin_as(:'sa1', -1, true, false, 'A negative version is never valid') ->> 'sqlstate', '22023', 'B14 a negative version');
create temp table saved_key as select key from app.whatsapp_otp_grant_key where id = 1;
delete from app.whatsapp_otp_grant_key;
select is(pg_temp.begin_as(:'sa1', 1, true, false, 'No grant key means nothing can be authorized') ->> 'sqlstate', '55000', 'B15 with no grant key nothing can be authorized (fail closed)');
insert into app.whatsapp_otp_grant_key (id, key) select 1, key from saved_key;

-- ===========================================================================
-- C. finish
-- ===========================================================================
select is(pg_temp.call_as(:'sa1', format('public.admin_whatsapp_otp_delivery_finish(%L::uuid, %L::uuid, ''applied'', 1, null)', :'sa1', (select r ->> 'request_id' from first_req))) ->> 'sqlstate', '42501',
  'C1 a browser session cannot complete a change: only the server, holding the Worker''s signed answer, can');
select is(pg_temp.call_anon(format('public.admin_whatsapp_otp_delivery_finish(%L::uuid, %L::uuid, ''applied'', 1, null)', :'sa1', (select r ->> 'request_id' from first_req))) ->> 'sqlstate', '42501', 'C2 anon cannot either');
select is(pg_temp.fin_as(:'sa2', (select (r ->> 'request_id')::uuid from first_req), 'applied', 1) ->> 'sqlstate', '42501', 'C3 another Super Admin cannot complete SOMEONE ELSE''S request');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'applied', 7) ->> 'sqlstate', '22023', 'C4 the applied version must be expected_version + 1');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'bogus', 1) ->> 'sqlstate', '22023', 'C5 an unknown status is refused');
select is(pg_temp.fin_as(:'sa1', gen_random_uuid(), 'applied', 1) ->> 'sqlstate', '42501', 'C6 an unknown request is refused');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'applied', 1) #>> '{}', 'applied', 'C7 the owner completes it');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.delivery_changed' and actor_user_id = :'sa1'::uuid
            and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from first_req)
            and metadata -> 'new' = 'true'::jsonb and metadata -> 'old' = 'null'::jsonb
            and metadata ->> 'reason' = 'Acceptance window approved by owner' and metadata ->> 'version' = '1'), 1,
  'C8 the "changed" audit event records the actor, the old and new state, the reason and the version');
select is(pg_temp.fin_as(:'sa1', (select (r ->> 'request_id')::uuid from first_req), 'applied', 1) #>> '{}', 'applied', 'C9 finishing again is idempotent');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.delivery_changed' and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from first_req)), 1,
  'C10 ...and writes no second audit event');
create temp table second_req as select pg_temp.begin_as(:'sa2', 1, true, false, 'Window closed, switching delivery off') as r;
select is(pg_temp.fin_as(:'sa2', (select (r ->> 'request_id')::uuid from second_req), 'failed', null, 'Bad Code!') ->> 'sqlstate', '22023', 'C11 a failure code must be a short lower-case token');
select is(pg_temp.fin_as(:'sa2', (select (r ->> 'request_id')::uuid from second_req), 'failed', null, 'stale_version') #>> '{}', 'failed', 'C12 a refused change is recorded as failed');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.delivery_change_failed' and actor_user_id = :'sa2'::uuid
            and metadata ->> 'code' = 'stale_version'), 1, 'C13 ...with its own audit event and the code');

-- ===========================================================================
-- D. reconcile
-- ===========================================================================
select is(pg_temp.call_as(:'sa1', 'public.admin_whatsapp_otp_delivery_reconcile(''[]''::jsonb)') ->> 'sqlstate', '42501', 'D1 a browser session cannot reconcile');
create temp table third_req as select pg_temp.begin_as(:'sa1', 1, true, false, 'Closing the rehearsal window now') as r;
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from third_req), 'actor', :'sa2', 'version', 2, 'at', 1800000000, 'new', false))) ->> 'applied', '0',
  'D2 a row naming a different actor is ignored');
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from third_req), 'actor', :'sa1', 'version', 2, 'at', 1800000000, 'new', true))) ->> 'applied', '0',
  'D3 a row with a different requested state is ignored');
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from third_req), 'actor', :'sa1', 'version', 5, 'at', 1800000000, 'new', false))) ->> 'applied', '0',
  'D4 a row with the wrong version is ignored');
select is((select status from app.whatsapp_otp_delivery_requests where id = (select (r ->> 'request_id')::uuid from third_req)), 'pending', 'D5 the request is still pending after the forgeries');
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from third_req), 'actor', :'sa1', 'version', 2, 'at', 1800000000, 'new', false))) ->> 'applied', '1',
  'D6 the Worker''s authoritative row completes it');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.delivery_changed' and actor_user_id = :'sa1'::uuid
            and (metadata ->> 'request_id')::uuid = (select (r ->> 'request_id')::uuid from third_req) and metadata ->> 'reconciled' = 'true'
            and metadata -> 'old' = 'true'::jsonb and metadata -> 'new' = 'false'::jsonb), 1, 'D7 ...with the audit event, marked reconciled');
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from third_req), 'actor', :'sa1', 'version', 2, 'at', 1800000000, 'new', false))) ->> 'applied', '0',
  'D8 reconciling the same row again changes nothing');
select is(pg_temp.reconcile('{"a":1}'::jsonb) ->> 'sqlstate', '22023', 'D9 input that is not an array is refused');
create temp table stale_req as select pg_temp.begin_as(:'sa2', 2, false, true, 'A request that never reaches the Worker') as r;
update app.whatsapp_otp_delivery_requests set created_at = clock_timestamp() - interval '20 minutes' where id = (select (r ->> 'request_id')::uuid from stale_req);
select is(pg_temp.reconcile('[]'::jsonb) ->> 'abandoned', '1', 'D10 only the stale pending request is closed as not applied (the recent manage-only one stays pending)');
select is((select count(*)::int from public.audit_log where action = 'whatsapp_otp.delivery_change_failed' and metadata ->> 'code' = 'not_applied'), 1, 'D11 ...with a failed audit event');

select is((select count(*)::int from app.whatsapp_otp_notification_events where event_key = 'delivery_unmatched:2' and kind = 'delivery_unmatched'), 1,
  'D12 the three forged rows above (same version and time) raised ONE unmatched alert, never one per forgery');
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', (select r ->> 'request_id' from third_req), 'actor', :'sa1', 'version', 2, 'at', 1800000000, 'new', false))) ->> 'unmatched', '0',
  'D13 a Worker row that an approved, applied request accounts for raises no alert');

-- ===========================================================================
-- F. unmatched / drift detection (a change nobody approved here, e.g. a direct write to D1)
-- ===========================================================================
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', gen_random_uuid(), 'actor', :'sa1', 'version', 7, 'at', 1800000100, 'new', true))) ->> 'unmatched', '1',
  'F1 a Worker audit row with no approved request raises one unmatched alert');
select is(pg_temp.reconcile(jsonb_build_array(jsonb_build_object('request_id', gen_random_uuid(), 'actor', :'sa1', 'version', 7, 'at', 1800000100, 'new', true))) ->> 'unmatched', '0',
  'F2 the same version and time again raises nothing (deduplicated)');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.delivery_unmatched' and params ->> 'version' = '7'
            and recipient_user_id in (:'sa1'::uuid, :'sa2'::uuid, :'adm'::uuid)), 3, 'F3 the active staff holding whatsapp_otp.view are notified');
select is((select count(*)::int from public.notifications where event_type = 'whatsapp_otp.delivery_unmatched'
            and recipient_user_id in (:'susp'::uuid, :'mgr'::uuid, :'plain'::uuid)), 0, 'F4 ...and nobody else (suspended, manage-without-view, no role)');
select is((select params::text from public.notifications where event_type = 'whatsapp_otp.delivery_unmatched' and params ->> 'version' = '7' limit 1), '{"version": 7}',
  'F5 the notification carries statistics only: the version number');
select is(pg_temp.reconcile_drift('[]'::jsonb, jsonb_build_object('version', 9, 'at', 1800000200)) ->> 'unmatched', '1',
  'F6 a switch row that no audit row accounts for (a direct write) raises one unmatched alert');
select is(pg_temp.reconcile_drift('[]'::jsonb, jsonb_build_object('version', 9, 'at', 1800000200)) ->> 'unmatched', '0', 'F7 ...once');
select is(pg_temp.reconcile_drift('[]'::jsonb, '{"version":"x","at":1}'::jsonb) ->> 'unmatched', '0', 'F8 malformed drift input is ignored, not an error');
select ok((select bool_and(d like '%delivery_unmatched%') from (
             select pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.notifications'::regclass and c.conname = 'ck_notifications_event_type_known'
             union all select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'app.whatsapp_otp_notification_events'::regclass and c.conname = 'whatsapp_otp_notification_events_kind_check') x),
  'F9 the notification type and the dedupe-ledger kind accept delivery_unmatched');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_function_privilege(r, 'app.whatsapp_otp_record_delivery_unmatched(integer,bigint)', 'execute')), 0,
  'F10 the internal recorder is not callable by any client role or the service role directly');

-- ===========================================================================
-- E. Closed table, vocabulary, hardening, grants
-- ===========================================================================
select is(pg_temp.call_as(:'sa1', '(select count(*) from app.whatsapp_otp_delivery_requests)') ->> 'sqlstate', '42501', 'E1 the ledger is a closed table: not readable by a signed-in user');
select ok((select bool_and(position('''' || a || '''::text' in d) > 0)
             from (select pg_get_constraintdef(c.oid) as d from pg_constraint c where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass) x,
                  unnest(array['whatsapp_otp.delivery_requested', 'whatsapp_otp.delivery_changed', 'whatsapp_otp.delivery_change_failed']) a),
  'E2 the three audit actions are in the allow-list');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin_whatsapp_otp_delivery_%' and p.prosecdef and p.proconfig @> array['search_path=""']), 3,
  'E3 all three functions are SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin_whatsapp_otp_delivery_%'
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0,
  'E4 no client role (anon, authenticated, PUBLIC) can execute any of them');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'admin_whatsapp_otp_delivery_%' and has_function_privilege('service_role', p.oid, 'execute')), 3,
  'E5 the service role can execute all three');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
            where has_table_privilege(r, 'app.whatsapp_otp_delivery_requests', 'select,insert,update,delete')), 0,
  'E6 no client role holds any privilege on the ledger');
select is((select count(*)::int from public.admin_permissions where key like 'whatsapp_otp.%'), 3, 'E7 no new permission was introduced: the three existing ones govern the switch');

select * from finish();
rollback;

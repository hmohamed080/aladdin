-- pgTAP: Admin Staff invitations, the first-assignment path (20261105090001_admin_staff_invitations.sql).
--
--   A. The closed table, grants and the audit allow-list (composed with 20261103090001)
--   B. admin_staff_invite: who may invite whom, validation, caps, hashed token, audit
--   C. list / revoke
--   D. token holder's lookup and registration check
--   E. staff_invitation_accept: identity, replay, authority at acceptance, dedicated-staff eligibility, atomic effects, the QA outcomes
--   F. The existing manageable-target guard is untouched
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(97);

\set sa1  'b1000000-0000-4000-8000-000000000001'
\set adm  'b1000000-0000-4000-8000-000000000002'
\set mdr  'b1000000-0000-4000-8000-000000000003'
\set plain 'b1000000-0000-4000-8000-000000000004'
\set n1   'b1000000-0000-4000-8000-000000000011'
\set n2   'b1000000-0000-4000-8000-000000000012'
\set n3   'b1000000-0000-4000-8000-000000000013'
\set n4   'b1000000-0000-4000-8000-000000000014'
\set n5   'b1000000-0000-4000-8000-000000000015'
\set n6   'b1000000-0000-4000-8000-000000000016'
\set n7   'b1000000-0000-4000-8000-000000000017'
\set n8   'b1000000-0000-4000-8000-000000000018'
\set pers 'b1000000-0000-4000-8000-000000000019'
\set unc  'b1000000-0000-4000-8000-00000000001a'
\set actv 'b1000000-0000-4000-8000-00000000001b'

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
create function pg_temp.st(p_user uuid, p_sql text) returns text language sql as $$
  select coalesce(pg_temp.call_as(p_user, p_sql) ->> 'sqlstate', 'ok') $$;
create function pg_temp.msg(p_user uuid, p_sql text) returns text language sql as $$
  select pg_temp.call_as(p_user, p_sql) ->> 'msg' $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon, service_role;

create function pg_temp.invite(p_user uuid, p_email text, p_role text, p_reason text default 'A7 QA staff onboarding') returns jsonb language sql as $$
  select pg_temp.call_as(p_user, format('public.admin_staff_invite(%L, %L::uuid, %L)', p_email, (select id from public.admin_roles where key = p_role), p_reason)) $$;
create function pg_temp.accept(p_user uuid, p_token text) returns jsonb language sql as $$
  select pg_temp.call_as(p_user, format('public.staff_invitation_accept(%L)', p_token)) $$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', n || '@staffinv.test',
       case when n = 'unc' then null else now() end, jsonb_build_object('full_name', 'Probe ' || n), now(), now()
  from (values (:'sa1'::uuid, 'sa1'), (:'adm'::uuid, 'adm'), (:'mdr'::uuid, 'mdr'), (:'plain'::uuid, 'plain'),
               (:'n1'::uuid, 'n1'), (:'n2'::uuid, 'n2'), (:'n3'::uuid, 'n3'), (:'n4'::uuid, 'n4'), (:'n5'::uuid, 'n5'), (:'n6'::uuid, 'n6'),
               (:'n7'::uuid, 'n7'), (:'n8'::uuid, 'n8'), (:'pers'::uuid, 'pers'), (:'unc'::uuid, 'unc'), (:'actv'::uuid, 'actv')) v(u, n);
insert into public.admin_role_assignments (user_id, role_id)
select v.u, r.id from (values (:'sa1'::uuid, 'super_admin'), (:'adm'::uuid, 'administrator'), (:'mdr'::uuid, 'moderator')) v(u, k)
  join public.admin_roles r on r.key = v.k;
-- Staff accounts are active in the real system; the invitees below are NOT (a fresh sign-up is pending_verification).
update public.users set status = 'active' where id in (:'sa1', :'adm', :'mdr', :'actv');
-- A person who already chose a marketplace persona (not dedicated platform staff).
update public.users set primary_account_type = (select (enum_range(null::public.persona_type))[1]) where id = :'pers';

-- ===========================================================================
-- A. The closed table, grants and the audit allow-list
-- ===========================================================================
select is((select relrowsecurity from pg_class where oid = 'app.admin_staff_invitations'::regclass), true, 'A1 RLS is enabled on the invitation table');
select is((select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'admin_staff_invitations'), 0, 'A2 the table has no policy at all');
select is(pg_temp.st(:'sa1', 'select count(*) from app.admin_staff_invitations'), '42501', 'A3 even a Super Admin cannot read the table directly');
select is(pg_temp.call_anon('(select count(*) from app.admin_staff_invitations)') ->> 'sqlstate', '42501', 'A4 anon cannot read the table');
select is((select bool_or(has_table_privilege(r, 'app.admin_staff_invitations', p)) from unnest(array['anon','authenticated','service_role']) r, unnest(array['select','insert','update','delete']) p), false, 'A5 no client role holds any privilege on the table');
select is((select count(*)::int from information_schema.columns where table_schema = 'app' and table_name = 'admin_staff_invitations' and column_name in ('token', 'raw_token', 'plaintext')), 0, 'A6 no column can hold a raw token');
select is((select string_agg(f || ':' || has_function_privilege('anon', f, 'execute') || ':' || has_function_privilege('authenticated', f, 'execute') || ':' || has_function_privilege('service_role', f, 'execute'), ',' order by f)
             from unnest(array['public.admin_staff_invite(text,uuid,text)', 'public.admin_staff_invitation_revoke(uuid,text)', 'public.admin_staff_invitations_list()',
                               'public.staff_invitation_lookup(text)', 'public.staff_invitation_registration_check(text,text)', 'public.staff_invitation_accept(text)']) f),
          'public.admin_staff_invitation_revoke(uuid,text):false:true:false,public.admin_staff_invitations_list():false:true:false,public.admin_staff_invite(text,uuid,text):false:true:false,public.staff_invitation_accept(text):false:true:false,public.staff_invitation_lookup(text):true:true:false,public.staff_invitation_registration_check(text,text):true:true:false',
          'A7 EXECUTE grants: staff and accept for authenticated only; lookup and registration check for token holders; service_role none');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'app' and p.proname in ('admin_staff_invitation_state', 'admin_staff_token_hash')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'A8 the internal helpers are executable by no client role');
select ok((select bool_and(pg_get_constraintdef(c.oid) like '%''' || a || '''::text%') from pg_constraint c, unnest(array['admin_staff.invited', 'admin_staff.invitation_revoked', 'admin_staff.invitation_accepted']) a
            where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass), 'A9 the three audit actions are in the allow-list');
select ok((select pg_get_constraintdef(c.oid) like '%''whatsapp_otp.settings_changed''::text%' and pg_get_constraintdef(c.oid) like '%''admin_role.assigned''::text%'
             from pg_constraint c where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass), 'A10 the allow-list still holds the WhatsApp OTP and RBAC actions (composition with the stacked PR)');

-- ===========================================================================
-- B. admin_staff_invite
-- ===========================================================================
create temp table tok (k text primary key, v text, id uuid);
grant all on tok to public;
insert into tok select 'n1', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'sa1', 'n1@staffinv.test', 'administrator') j) x;
select is((select length(v) from tok where k = 'n1'), 64, 'B1 a Super Admin can invite an Administrator and receives a 64-hex-character token once');
select is((select count(*)::int from app.admin_staff_invitations where token_hash = encode(extensions.digest((select v from tok where k = 'n1'), 'sha256'), 'hex')), 1, 'B2 only the SHA-256 of the token is stored');
select is((select count(*)::int from app.admin_staff_invitations where token_hash = (select v from tok where k = 'n1') or reason like '%' || (select v from tok where k = 'n1') || '%'), 0, 'B3 the raw token is stored nowhere in the table');
select is((select count(*)::int from public.audit_log where action = 'admin_staff.invited' and subject_id = (select id from tok where k = 'n1')), 1, 'B4 inviting writes exactly one audit event');
select is((select count(*)::int from public.audit_log where metadata::text like '%' || (select v from tok where k = 'n1') || '%' or metadata::text like '%n1@staffinv.test%'), 0, 'B5 no audit record carries the raw token or the full address');
select is((select (metadata ->> 'email_masked') is not null and (metadata ->> 'role_key') = 'administrator' from public.audit_log where action = 'admin_staff.invited' and subject_id = (select id from tok where k = 'n1')), true, 'B6 the audit event records the role and a masked address');
insert into tok select 'n2', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'adm', 'n2@staffinv.test', 'moderator') j) x;
select is((select length(v) from tok where k = 'n2'), 64, 'B7 an Administrator can invite a Moderator (strictly below own rank)');
select is(pg_temp.invite(:'adm', 'n3@staffinv.test', 'administrator') ->> 'sqlstate', '42501', 'B8 an Administrator cannot invite to their own rank (no escalation)');
select is(pg_temp.invite(:'adm', 'n3@staffinv.test', 'super_admin') ->> 'sqlstate', '42501', 'B9 an Administrator cannot invite a Super Admin');
select is(pg_temp.invite(:'sa1', 'n3@staffinv.test', 'super_admin') ->> 'msg', 'staff_invitation: role_not_invitable', 'B10 not even a Super Admin can invite to super_admin in v1');
select is(pg_temp.invite(:'mdr', 'n3@staffinv.test', 'moderator') ->> 'sqlstate', '42501', 'B11 a Moderator cannot invite anyone');
select is(pg_temp.invite(:'plain', 'n3@staffinv.test', 'moderator') ->> 'sqlstate', '42501', 'B12 an ordinary user cannot invite');
select is(pg_temp.call_anon($q$public.admin_staff_invite('n3@staffinv.test', (select id from public.admin_roles where key = 'moderator'), 'A7 QA staff onboarding')$q$) ->> 'sqlstate', '42501', 'B13 anon cannot invite');
select is(pg_temp.invite(:'sa1', 'sa1@staffinv.test', 'administrator') ->> 'msg', 'staff_invitation: you cannot invite yourself', 'B14 nobody invites themselves');
select is(pg_temp.invite(:'sa1', 'not-an-address', 'administrator') ->> 'sqlstate', '22023', 'B15 a malformed address is refused');
select is(pg_temp.invite(:'sa1', 'n3@staffinv.test', 'administrator', 'short') ->> 'sqlstate', '22023', 'B16 a reason shorter than ten characters is refused');
select is(pg_temp.invite(:'sa1', 'n1@staffinv.test', 'administrator') ->> 'msg', 'staff_invitation: already_pending', 'B17 a second pending invitation for the same address and role is refused');
select is(pg_temp.invite(:'sa1', 'ADM@staffinv.test', 'administrator') ->> 'msg', 'staff_invitation: already_holds_role', 'B18 a person who already holds the role needs no invitation (case-insensitive)');
select is(pg_temp.call_as(:'sa1', $q$public.admin_staff_invite('n3@staffinv.test', gen_random_uuid(), 'A7 QA staff onboarding')$q$) ->> 'msg', 'staff_invitation: role_not_assignable', 'B19 an unknown role is refused');
insert into app.admin_staff_invitations (token_hash, email, role_id, invited_by, reason, expires_at)
select encode(extensions.digest('cap' || g, 'sha256'), 'hex'), 'cap' || g || '@staffinv.test', (select id from public.admin_roles where key = 'moderator'), :'sa1', 'filler for the pending cap', now() + interval '3 days'
  from generate_series(1, 19) g;
select is(pg_temp.invite(:'sa1', 'cap-over@staffinv.test', 'moderator') ->> 'sqlstate', '54000', 'B20 an inviter may hold at most 20 live invitations');
delete from app.admin_staff_invitations where email like 'cap%@staffinv.test';

-- ===========================================================================
-- C. list / revoke
-- ===========================================================================
select is(pg_temp.st(:'adm', 'select count(*) from public.admin_staff_invitations_list()'), 'ok', 'C1 an Administrator (admin_staff.read) can list invitations');
select is(pg_temp.st(:'mdr', 'select count(*) from public.admin_staff_invitations_list()'), '42501', 'C2 a Moderator cannot list');
select is(pg_temp.call_as(:'sa1', $q$select bool_and(email_masked not like '%staffinv.test%' and email_masked like '%•••%') from public.admin_staff_invitations_list()$q$) #>> '{}', 'true', 'C4 the list shows masked addresses only');
select is(pg_temp.call_as(:'adm', format('public.admin_staff_invitation_revoke(%L::uuid, %L)', (select id from tok where k = 'n1'), 'not mine to withdraw')) ->> 'sqlstate', '42501', 'C5 an Administrator cannot withdraw an invitation to a role at their own rank');
select is(pg_temp.st(:'mdr', format('public.admin_staff_invitation_revoke(%L::uuid, %L)', (select id from tok where k = 'n2'), 'withdrawn by a moderator')), '42501', 'C6 a Moderator cannot withdraw');
insert into tok select 'rv', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'adm', 'rv@staffinv.test', 'moderator') j) x;
select is(pg_temp.st(:'adm', format('public.admin_staff_invitation_revoke(%L::uuid, %L)', (select id from tok where k = 'rv'), 'withdrawn: invited by mistake')), 'ok', 'C7 the inviter can withdraw their own invitation');
select is((select status from app.admin_staff_invitations where id = (select id from tok where k = 'rv')), 'revoked', 'C8 the invitation is revoked');
select is((select count(*)::int from public.audit_log where action = 'admin_staff.invitation_revoked' and subject_id = (select id from tok where k = 'rv')), 1, 'C9 withdrawing writes one audit event');
select is(pg_temp.call_as(:'adm', format('public.admin_staff_invitation_revoke(%L::uuid, %L)', (select id from tok where k = 'rv'), 'again')) ->> 'sqlstate', '22023', 'C10 a non-pending invitation cannot be withdrawn again');
select is(pg_temp.st(:'sa1', format('public.admin_staff_invitation_revoke(%L::uuid, %L)', (select id from tok where k = 'n2'), 'a Super Admin outranks the role')), 'ok', 'C11 a Super Admin can withdraw an Administrator''s invitation');
insert into tok select 'n2', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'sa1', 'n2@staffinv.test', 'moderator') j) x
  on conflict (k) do update set v = excluded.v, id = excluded.id;

-- ===========================================================================
-- D. lookup and registration check
-- ===========================================================================
select is((select status from public.staff_invitation_lookup('nope')), 'invalid', 'D1 an unknown token looks invalid');
select is(pg_temp.call_anon(format('(select status from public.staff_invitation_lookup(%L))', (select v from tok where k = 'n1'))) #>> '{}', 'pending', 'D2 anon can look up a live invitation');
select is(pg_temp.call_anon(format('(select role_name from public.staff_invitation_lookup(%L))', (select v from tok where k = 'n1'))) #>> '{}', 'Administrator', 'D3 a live invitation names the role');
select is(pg_temp.call_anon(format('(select email_masked from public.staff_invitation_lookup(%L))', (select v from tok where k = 'n1'))) #>> '{}' like '%staffinv.test%', false, 'D4 the address is masked');
select is((select status from public.staff_invitation_lookup((select v from tok where k = 'rv'))), 'revoked', 'D5 a revoked invitation says so and nothing else');
select is((select role_name from public.staff_invitation_lookup((select v from tok where k = 'rv'))), null, 'D6 a revoked invitation discloses no role');
insert into app.admin_staff_invitations (token_hash, email, role_id, invited_by, reason, status, created_at, expires_at)
values (encode(extensions.digest('old', 'sha256'), 'hex'), 'old@staffinv.test', (select id from public.admin_roles where key = 'moderator'), :'sa1', 'an invitation that lapsed', 'pending', now() - interval '10 days', now() - interval '3 days');
select is((select status from public.staff_invitation_lookup('old')), 'expired', 'D7 a lapsed invitation is expired');
select is(pg_temp.call_anon(format('public.staff_invitation_registration_check(%L, %L)', (select v from tok where k = 'n1'), 'N1@STAFFINV.TEST')) #>> '{}', 'true', 'D8 the registration check accepts exactly the invited address (case-insensitive)');
select is(pg_temp.call_anon(format('public.staff_invitation_registration_check(%L, %L)', (select v from tok where k = 'n1'), 'other@staffinv.test')) #>> '{}', 'false', 'D9 any other address is refused');
select is(pg_temp.call_anon(format('public.staff_invitation_registration_check(%L, %L)', 'old', 'old@staffinv.test')) #>> '{}', 'false', 'D10 an expired invitation cannot start a registration');
select is(pg_temp.call_anon(format('public.staff_invitation_registration_check(%L, %L)', (select v from tok where k = 'rv'), 'rv@staffinv.test')) #>> '{}', 'false', 'D11 a revoked invitation cannot start a registration');
select is(pg_temp.call_as(:'n1', format('(select matches_caller from public.staff_invitation_lookup(%L))', (select v from tok where k = 'n1'))) #>> '{}', 'true', 'D12 the invitee sees that the signed-in address matches');
select is(pg_temp.call_as(:'n3', format('(select matches_caller from public.staff_invitation_lookup(%L))', (select v from tok where k = 'n1'))) #>> '{}', 'false', 'D13 another signed-in person does not match');

-- ===========================================================================
-- E. staff_invitation_accept
-- ===========================================================================
select is((select status from public.users where id = :'n1'), 'pending_verification', 'E0 the invitee starts as a fresh, pending, persona-free account');
select is(pg_temp.call_anon(format('public.staff_invitation_accept(%L)', (select v from tok where k = 'n1'))) ->> 'sqlstate', '42501', 'E1 anon cannot accept');
select is(pg_temp.accept(:'n3', (select v from tok where k = 'n1')) ->> 'msg', 'staff_invitation: recipient_mismatch', 'E2 holding the token is not enough: another account is refused');
select is((select count(*)::int from public.admin_role_assignments where user_id = :'n3'), 0, 'E3 the refused account received nothing');
select is(pg_temp.accept(:'n1', 'not-a-token') ->> 'sqlstate', '22023', 'E4 an unknown token fails closed');
-- the QA outcome for the Administrator
select is(pg_temp.st(:'n1', 'public.admin_whatsapp_otp_view_check()'), '42501', 'E5 before acceptance the invitee has no WhatsApp OTP access');
select is(pg_temp.accept(:'n1', (select v from tok where k = 'n1')) ->> 'status', 'accepted', 'E6 the invited Administrator accepts');
select is((select status from public.users where id = :'n1'), 'active', 'E7 the dedicated platform account is activated by acceptance');
select is((select count(*)::int from public.admin_role_assignments where user_id = :'n1' and is_active and scope_type = 'platform' and role_id = (select id from public.admin_roles where key = 'administrator')), 1, 'E8 exactly one active platform assignment was created');
select is((select status from app.admin_staff_invitations where id = (select id from tok where k = 'n1')), 'accepted', 'E9 the invitation is consumed');
select is((select count(*)::int from public.audit_log where action = 'admin_role.assigned' and metadata ->> 'invitation_id' = (select id::text from tok where k = 'n1') and metadata ->> 'source' = 'staff_invitation'), 1, 'E10 one admin_role.assigned audit event names the invitation');
select is((select count(*)::int from public.audit_log where action = 'admin_staff.invitation_accepted' and subject_id = (select id from tok where k = 'n1')), 1, 'E11 one invitation_accepted audit event');
select is((select count(*)::int from public.audit_log where action = 'account.platform_prepared' and subject_id = :'n1'), 1, 'E12 the activation is audited');
select is(pg_temp.st(:'n1', 'public.admin_whatsapp_otp_view_check()'), 'ok', 'E13 QA outcome: the accepted Administrator CAN view WhatsApp OTP');
select is(pg_temp.invite(:'n1', 'z@staffinv.test', 'administrator') ->> 'sqlstate', '42501', 'E14 and cannot invite to their own rank');
select is((select string_agg(p, ',' order by p) from unnest(app.admin_permissions_of(:'n1')) p where p like 'whatsapp_otp.%'), 'whatsapp_otp.view', 'E15 QA outcome: view but NOT manage or ceiling_manage');
select is(pg_temp.accept(:'n1', (select v from tok where k = 'n1')) ->> 'status', 'already_accepted', 'E16 replay by the same person is idempotent');
select is((select count(*)::int from public.admin_role_assignments where user_id = :'n1'), 1, 'E17 the replay created no second assignment');
select is((select count(*)::int from public.audit_log where action = 'admin_staff.invitation_accepted' and subject_id = (select id from tok where k = 'n1')), 1, 'E18 the replay wrote no second audit event');
select is(pg_temp.accept(:'n3', (select v from tok where k = 'n1')) ->> 'sqlstate', '22023', 'E19 replay by anyone else fails closed');
-- the QA outcome for the Moderator
select is(pg_temp.accept(:'n2', (select v from tok where k = 'n2')) ->> 'status', 'accepted', 'E20 the invited Moderator accepts');
select is(pg_temp.st(:'n2', 'public.admin_whatsapp_otp_view_check()'), '42501', 'E21 QA outcome: the accepted Moderator is DENIED WhatsApp OTP access');
select is((select count(*)::int from unnest(app.admin_permissions_of(:'n2')) p where p like 'whatsapp_otp.%'), 0, 'E22 the Moderator holds no whatsapp_otp permission at all');
-- identity
insert into tok select 'unc', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'sa1', 'unc@staffinv.test', 'moderator') j) x;
select is(pg_temp.accept(:'unc', (select v from tok where k = 'unc')) ->> 'msg', 'staff_invitation: recipient_mismatch', 'E23 an unconfirmed Auth address cannot accept');
insert into tok select 'n4', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'sa1', 'n4@staffinv.test', 'moderator') j) x;
update auth.users set email = 'changed@staffinv.test' where id = :'n4';
select is(pg_temp.accept(:'n4', (select v from tok where k = 'n4')) ->> 'msg', 'staff_invitation: recipient_mismatch', 'E24 an address changed after the invitation cannot accept');
insert into tok select 'n5', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'sa1', 'n5@staffinv.test', 'moderator') j) x;
update auth.users set banned_until = now() + interval '1 day' where id = :'n5';
select is(pg_temp.accept(:'n5', (select v from tok where k = 'n5')) ->> 'sqlstate', '42501', 'E25 a banned account cannot accept');
-- state
select is(pg_temp.accept(:'n3', (select v from tok where k = 'rv')) ->> 'sqlstate', '22023', 'E26 a revoked invitation fails closed');
select is(pg_temp.accept(:'n3', 'old') ->> 'msg', 'staff_invitation: expired', 'E27 an expired invitation fails closed');
-- self-acceptance
insert into app.admin_staff_invitations (token_hash, email, role_id, invited_by, reason, expires_at)
values (encode(extensions.digest('selfy', 'sha256'), 'hex'), 'adm@staffinv.test', (select id from public.admin_roles where key = 'moderator'), :'adm', 'a self invitation forced past the guard', now() + interval '1 day');
select is(pg_temp.accept(:'adm', 'selfy') ->> 'msg', 'staff_invitation: you cannot accept your own invitation', 'E28 nobody accepts their own invitation');
-- the inviter's authority at acceptance
insert into tok select 'n6', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'adm', 'n6@staffinv.test', 'moderator') j) x;
update public.users set status = 'suspended' where id = :'adm';
select is(pg_temp.accept(:'n6', (select v from tok where k = 'n6')) ->> 'msg', 'staff_invitation: inviter_not_authorized', 'E29 a suspended inviter can no longer push an invitation through');
select is((select status from app.admin_staff_invitations where id = (select id from tok where k = 'n6')), 'pending', 'E30 the refused acceptance left the invitation untouched');
select is((select count(*)::int from public.admin_role_assignments where user_id = :'n6'), 0, 'E31 and created no assignment');
update public.users set status = 'active' where id = :'adm';
select is(pg_temp.accept(:'n6', (select v from tok where k = 'n6')) ->> 'status', 'accepted', 'E32 once the inviter is authorized again the same invitation works');
-- the inviter was demoted below the role
insert into tok select 'n7', (j ->> 'token'), (j ->> 'id')::uuid from (select pg_temp.invite(:'adm', 'n7@staffinv.test', 'moderator') j) x;
update public.admin_role_assignments set is_active = false, deactivated_at = now(), deactivated_by = :'sa1', deactivation_kind = (select (enum_range(null::public.admin_deactivation_kind))[1])
 where user_id = :'adm' and is_active;
select is(pg_temp.accept(:'n7', (select v from tok where k = 'n7')) ->> 'msg', 'staff_invitation: inviter_not_authorized', 'E33 an inviter who lost their role cannot have an invitation accepted');
-- dedicated-staff eligibility
insert into app.admin_staff_invitations (token_hash, email, role_id, invited_by, reason, expires_at)
values (encode(extensions.digest('pers', 'sha256'), 'hex'), 'pers@staffinv.test', (select id from public.admin_roles where key = 'moderator'), :'sa1', 'an account with a marketplace persona', now() + interval '1 day');
select is(pg_temp.accept(:'pers', 'pers') ->> 'msg', 'staff_invitation: account_not_eligible', 'E34 an account with a marketplace persona is not promoted to platform staff');
select is((select count(*)::int from public.admin_role_assignments where user_id = :'pers'), 0, 'E35 and receives no assignment');
select is((select status from public.users where id = :'pers'), 'pending_verification', 'E36 and its status is unchanged');
insert into app.admin_staff_invitations (token_hash, email, role_id, invited_by, reason, expires_at)
values (encode(extensions.digest('actv', 'sha256'), 'hex'), 'actv@staffinv.test', (select id from public.admin_roles where key = 'moderator'), :'sa1', 'an already active dedicated account', now() + interval '1 day');
select is(pg_temp.accept(:'actv', 'actv') #>> '{account_activated}', 'false', 'E37 an already active dedicated account keeps its status; only the role is added');
select is((select count(*)::int from public.audit_log where action = 'account.platform_prepared' and subject_id = :'actv'), 0, 'E38 and no activation event is written for it');

-- ===========================================================================
-- F. The existing manageable-target guard is untouched
-- ===========================================================================
select is(pg_temp.call_as(:'sa1', format('public.admin_staff_assign_role(%L::uuid, %L::uuid)', :'plain', (select id from public.admin_roles where key = 'moderator'))) ->> 'msg', 'target is not an existing Admin Staff member', 'F1 the existing assign path still refuses a person with no Admin history');
select is(pg_temp.call_as(:'sa1', format('public.admin_staff_assign_role(%L::uuid, %L::uuid)', :'mdr', (select id from public.admin_roles where key = 'support'))) #>> '{}' is not null, true, 'F2 and still works for existing staff');
select is((select count(*)::int from app.admin_staff_invitations where status = 'accepted' and assignment_id is not null), 4, 'F3 each accepted invitation points at its assignment');
select throws_ok($$update app.admin_staff_invitations set status = 'accepted' where status = 'pending'$$, '23514', null, 'F4 the table refuses an accepted row without an acceptance time');
select throws_ok($$update app.admin_staff_invitations set expires_at = created_at + interval '30 days' where id = (select id from app.admin_staff_invitations limit 1)$$, '23514', null, 'F5 a lifetime beyond 15 days is refused');

select * from finish();
rollback;

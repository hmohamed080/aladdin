-- pgTAP: ADR-0031 step 1 - Admin Users shows Registration Status separately; Pending tab = open verification request only
-- (20261122090001_admin_users_registration_status.sql).
--
--   A. app.admin_user_registration_state agrees with public.my_registration_state for the same person (parity)
--   B. The helper has no client grant
--   C. The directory row carries registration_state
--   D. An unfinished registration is NOT in the Pending tab; an open request IS
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(14);

\set padmin '55555555-5555-4555-8555-555555555555'
\set ua '14200000-0000-4000-8000-0000000000a1'
\set ub '14200000-0000-4000-8000-0000000000a2'
\set uc '14200000-0000-4000-8000-0000000000a3'
\set ud '14200000-0000-4000-8000-0000000000a4'
\set ue '14200000-0000-4000-8000-0000000000a5'

create function pg_temp.call_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select (' || p_sql || ')::jsonb' into r;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate);
end;
$$;
create function pg_temp.mine(p_user uuid) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.my_registration_state() into r;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
end;
$$;

-- ua: confirmed email, no consent (consent_pending)   ub: email NOT confirmed (unverified)
-- uc: confirmed + consent, no account type (account_type_pending)   ud: suspended (manually_blocked)
-- ue: confirmed + consent + account type chosen (access_ready) AND an open verification request
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  (:'ua', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rs-a@probe.test', now(), '{"full_name":"Zeta Reg A"}', now(), now()),
  (:'ub', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rs-b@probe.test', null,  '{"full_name":"Zeta Reg B"}', now(), now()),
  (:'uc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rs-c@probe.test', now(), '{"full_name":"Zeta Reg C"}', now(), now()),
  (:'ud', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rs-d@probe.test', now(), '{"full_name":"Zeta Reg D"}', now(), now()),
  (:'ue', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rs-e@probe.test', now(), '{"full_name":"Zeta Reg E"}', now(), now());

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from (values (:'uc'::uuid), (:'ud'::uuid), (:'ue'::uuid)) u(id)
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t);
update public.users set status = 'suspended' where id = :'ud';
insert into public.onboarding_progress (user_id, account_type_completed_at) values (:'ue', now())
  on conflict (user_id) do update set account_type_completed_at = excluded.account_type_completed_at;
insert into public.verifications (subject_type, user_id, verification_type, requested_account_type, status, submitted_at, metadata)
  values ('user', :'ue', 'professional', 'installer_technician', 'submitted', now(), '{}'::jsonb);

-- A. parity with the per-caller function
select is(app.admin_user_registration_state(:'ua'), 'consent_pending', 'confirmed email without consent: consent_pending');
select is(app.admin_user_registration_state(:'ub'), 'unverified', 'unconfirmed email: unverified');
select is(app.admin_user_registration_state(:'uc'), 'account_type_pending', 'consent given, no account type: account_type_pending');
select is(app.admin_user_registration_state(:'ud'), 'manually_blocked', 'suspended: manually_blocked');
select is(app.admin_user_registration_state(:'ue'), 'access_ready', 'consent and account type: access_ready');
select is(app.admin_user_registration_state(:'ua'), pg_temp.mine(:'ua'), 'parity ua');
select is(app.admin_user_registration_state(:'uc'), pg_temp.mine(:'uc'), 'parity uc');
select is(app.admin_user_registration_state(:'ue'), pg_temp.mine(:'ue'), 'parity ue');

-- B. no client grant
select is(has_function_privilege('authenticated', 'app.admin_user_registration_state(uuid)', 'execute'), false, 'authenticated cannot execute the helper');

-- C. directory row carries it
select is(
  (select r ->> 'registration_state'
     from jsonb_array_elements(pg_temp.call_as(:'padmin', $$public.admin_users_directory(p_search => 'Zeta Reg', p_page_size => 50)$$) -> 'rows') r
    where r ->> 'id' = :'uc'),
  'account_type_pending', 'the directory row shows registration_state');

-- D. Pending tab = open request only
select is(
  (pg_temp.call_as(:'padmin', $$public.admin_users_directory(p_search => 'Zeta Reg', p_status => 'pending', p_page_size => 50)$$) -> 'rows') @> jsonb_build_array(jsonb_build_object('id', :'ue'::text)),
  true, 'an account with an open verification request is in Pending');
select is(
  (pg_temp.call_as(:'padmin', $$public.admin_users_directory(p_search => 'Zeta Reg', p_status => 'pending', p_page_size => 50)$$) -> 'rows') @> jsonb_build_array(jsonb_build_object('id', :'ua'::text)),
  false, 'an unfinished registration is NOT in Pending');
select is(
  (pg_temp.call_as(:'padmin', $$public.admin_users_directory(p_search => 'Zeta Reg', p_page_size => 50)$$) -> 'rows') @> jsonb_build_array(jsonb_build_object('id', :'ua'::text)),
  true, 'an unfinished registration still appears under All');
select is(app.admin_user_status_tab('pending_verification', null), null::text, 'tab helper: pending_verification alone has no tab');

select * from finish();
rollback;

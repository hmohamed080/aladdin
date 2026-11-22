-- pgTAP: ADR-0031 - the database refuses state-changing Data API requests from an account whose registration is unfinished
-- (20261122090002_registration_gate_central.sql). Calls app.api_pre_request() the way PostgREST does: with the JWT claims,
-- request.method and request.path settings.
--
--   A. unfinished registration (consent pending / email not confirmed): table writes and volatile RPCs are refused
--   B. reads, read-only functions and the sign-up steps are allowed
--   C. a finished registration, an active member and users.status = 'active' are unaffected
--   D. suspended accounts are still refused first; anon/service_role are untouched; a missing method fails open
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(18);

\set inc  '14300000-0000-4000-8000-0000000000d1'
\set unc  '14300000-0000-4000-8000-0000000000d2'
\set done '14300000-0000-4000-8000-0000000000d3'
\set stf  '14300000-0000-4000-8000-0000000000d4'
\set sus  '14300000-0000-4000-8000-0000000000d5'

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  (:'inc',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-inc@probe.test',  now(), '{"full_name":"Gate Inc"}',  now(), now()),
  (:'unc',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-unc@probe.test',  null,  '{"full_name":"Gate Unc"}',  now(), now()),
  (:'done', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-done@probe.test', now(), '{"full_name":"Gate Done"}', now(), now()),
  (:'stf',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-stf@probe.test',  now(), '{"full_name":"Gate Stf"}',  now(), now()),
  (:'sus',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g-sus@probe.test',  now(), '{"full_name":"Gate Sus"}',  now(), now());
insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from (values (:'done'::uuid)) u(id) cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t);
insert into public.onboarding_progress (user_id, account_type_completed_at) values (:'done', now())
  on conflict (user_id) do update set account_type_completed_at = excluded.account_type_completed_at;
update public.users set status = 'active' where id = :'stf';
update public.users set status = 'suspended' where id = :'sus';

-- Returns '' when the request passes the hook, else 'message|hint' of the refusal.
create function pg_temp.hook(p_user uuid, p_method text, p_path text, p_role text default 'authenticated') returns text language plpgsql as $$
declare v_hint text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_role)::text, true);
  perform set_config('request.method', coalesce(p_method, ''), true);
  perform set_config('request.path', p_path, true);
  begin
    perform app.api_pre_request();
    return '';
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return sqlerrm || '|' || coalesce(v_hint, '');
  end;
end $$;

-- A. unfinished registration: writes refused
select is(pg_temp.hook(:'inc', 'POST', '/organizations'), 'registration incomplete|registration_incomplete', 'consent pending: a direct table INSERT is refused');
select is(pg_temp.hook(:'inc', 'PATCH', '/profiles'), 'registration incomplete|registration_incomplete', 'consent pending: a table UPDATE is refused');
select is(pg_temp.hook(:'inc', 'DELETE', '/user_availability_windows'), 'registration incomplete|registration_incomplete', 'consent pending: a table DELETE is refused');
select is(pg_temp.hook(:'inc', 'POST', '/rpc/avatar_request_upload'), 'registration incomplete|registration_incomplete', 'consent pending: a volatile RPC is refused');
select is(pg_temp.hook(:'unc', 'POST', '/organizations'), 'registration incomplete|registration_incomplete', 'email not confirmed: a direct table INSERT is refused');
select is(pg_temp.hook(:'unc', 'POST', '/rpc/avatar_request_upload'), 'registration incomplete|registration_incomplete', 'email not confirmed: a volatile RPC is refused');

-- B. reads, read-only functions, sign-up steps
select is(pg_temp.hook(:'inc', 'GET', '/organizations'), '', 'consent pending: a read (GET) is allowed');
select is(pg_temp.hook(:'inc', 'HEAD', '/profiles'), '', 'consent pending: HEAD is allowed');
select is(pg_temp.hook(:'inc', 'POST', '/rpc/my_registration_state'), '', 'consent pending: a STABLE function is allowed');
select is(pg_temp.hook(:'inc', 'POST', '/rpc/record_consent'), '', 'consent pending: record_consent (a sign-up step) is allowed');
select is(pg_temp.hook(:'inc', 'POST', '/rpc/onboarding_select_account_type'), '', 'consent pending: onboarding_select_account_type is allowed');
select is(pg_temp.hook(:'inc', 'POST', '/rpc/this_function_does_not_exist'), '', 'an unknown function is left to PostgREST (404), not refused here');

-- C. unaffected accounts
select is(pg_temp.hook(:'done', 'POST', '/organizations'), '', 'access_ready: a table INSERT is not refused');
select is(pg_temp.hook(:'done', 'POST', '/rpc/avatar_request_upload'), '', 'access_ready: a volatile RPC is not refused');
select is(pg_temp.hook(:'stf', 'POST', '/organizations'), '', 'users.status = active (staff) is never refused');

-- D. suspended first; anon/service_role untouched; no method = fail open
select is(pg_temp.hook(:'sus', 'POST', '/organizations'), 'account suspended|account_suspended', 'a suspended account is still refused as suspended');
select is(pg_temp.hook(:'inc', 'POST', '/organizations', 'anon'), '', 'anon is untouched');
select is(pg_temp.hook(:'inc', null, '/organizations'), '', 'no request.method: the registration gate fails open (documented)');

select * from finish();
rollback;

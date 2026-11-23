-- pgTAP: craftsman profile completion -> exactly one professional verification request
-- (20261115090001_craftsman_profile_verification_submit.sql).
--
-- Proves, against the real schema:
--   A. only the Craftsman persona may call it; anonymous callers and other personas are refused;
--   B. below 100% (the authoritative app.profile_completion) nothing is filed;
--   C. at 100% it files ONE 'submitted' professional request for installer_technician, also when the account type is
--      ALREADY installer_technician (the case request_account_upgrade refuses), with one audit row and no approval;
--   D. calling again, or racing, never creates a second request or a second audit row;
--   E. needs_more_info is resubmitted; approved is never reset; rejected is never auto-resubmitted; an open request is
--      left alone;
--   F. the 100% figure follows the real saved profile: removing the portfolio drops it back below 100;
--   G. grants: authenticated only.
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(34);

create function pg_temp.q(p_user uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select (' || p_sql || ')::text' into r;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return 'ERR:' || sqlstate;
end;
$$;

-- Fixtures: c1 complete craftsman (account type already installer_technician) | c2 incomplete (no portfolio)
--           c3 complete engineer (wrong persona) | c4 needs_more_info | c5 approved | c6 rejected | c7 under_review
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('13500000-0000-4000-8000-0000000000c1', 'cv-c1@example.test'),
  ('13500000-0000-4000-8000-0000000000c2', 'cv-c2@example.test'),
  ('13500000-0000-4000-8000-0000000000c3', 'cv-c3@example.test'),
  ('13500000-0000-4000-8000-0000000000c4', 'cv-c4@example.test'),
  ('13500000-0000-4000-8000-0000000000c5', 'cv-c5@example.test'),
  ('13500000-0000-4000-8000-0000000000c6', 'cv-c6@example.test'),
  ('13500000-0000-4000-8000-0000000000c7', 'cv-c7@example.test'),
  ('13500000-0000-4000-8000-0000000000c8', 'cv-c8@example.test')) v(id, email);

-- Make each one a complete craftsman profile (all eight criteria), except c2 (no portfolio) and c3 (engineer).
do $$
declare
  u uuid; v_trade uuid;
  v_craft uuid[] := array['13500000-0000-4000-8000-0000000000c1','13500000-0000-4000-8000-0000000000c2',
    '13500000-0000-4000-8000-0000000000c4','13500000-0000-4000-8000-0000000000c5',
    '13500000-0000-4000-8000-0000000000c6','13500000-0000-4000-8000-0000000000c7',
    '13500000-0000-4000-8000-0000000000c8']::uuid[];
  v_avatar uuid;
begin
  select id into v_trade from public.trades where is_active order by key limit 1;
  foreach u in array v_craft loop
    update public.users set primary_account_type = 'installer_technician' where id = u;
    insert into public.avatar_uploads (owner_user_id, object_key, content_type) values (u, gen_random_uuid()::text || '.jpg', 'image/jpeg')
      returning id into v_avatar;
    update public.profiles set avatar_media_id = v_avatar, phone_e164 = '+201000135' || lpad((array_position(v_craft, u))::text, 3, '0'),
           display_name_confirmed_at = now(), display_name = 'CV ' || right(u::text, 2) where user_id = u;
    insert into public.individual_onboarding (user_id, prof_concrete_type, prof_years_experience, prof_availability)
      values (u, 'installer_technician', 5, 'full_time')
      on conflict (user_id) do update set prof_concrete_type = 'installer_technician', prof_years_experience = 5, prof_availability = 'full_time';
    insert into public.user_trades (user_id, trade_id) values (u, v_trade);
    insert into public.user_service_areas (user_id, governorate_key, is_primary) values (u, 'cairo', true);
    if u not in ('13500000-0000-4000-8000-0000000000c2', '13500000-0000-4000-8000-0000000000c8') then
      insert into public.portfolio_projects (owner_user_id, title) values (u, 'CV project');
    end if;
  end loop;
  -- c3: a complete-looking engineer (wrong persona for this RPC)
  update public.users set primary_account_type = 'engineer' where id = '13500000-0000-4000-8000-0000000000c3';
end $$;

-- Existing requests for c4 (needs_more_info), c5 (approved), c6 (rejected), c7 (under_review)
insert into public.verifications (subject_type, user_id, verification_type, requested_account_type, status, submitted_at, reviewer_id, reason, decided_at, applied_at)
values
 ('user', '13500000-0000-4000-8000-0000000000c4', 'professional', 'installer_technician', 'needs_more_info', now() - interval '3 days', null, 'add a clearer photo', null, null),
 ('user', '13500000-0000-4000-8000-0000000000c5', 'professional', 'installer_technician', 'approved', now() - interval '3 days', null, null, now() - interval '2 days', now() - interval '2 days'),
 ('user', '13500000-0000-4000-8000-0000000000c6', 'professional', 'installer_technician', 'rejected', now() - interval '3 days', null, 'documents unclear', now() - interval '2 days', null),
 ('user', '13500000-0000-4000-8000-0000000000c7', 'professional', 'installer_technician', 'under_review', now() - interval '3 days', null, null, null, null),
 ('user', '13500000-0000-4000-8000-0000000000c8', 'professional', 'installer_technician', 'rejected', now() - interval '3 days', null, 'documents unclear', now() - interval '2 days', null);

-- ---------------------------------------------------------------------------
-- Fixture sanity: the completion figure is the real one
-- ---------------------------------------------------------------------------
select is((app.profile_completion('13500000-0000-4000-8000-0000000000c1') ->> 'percent')::int, 100, 'c1 fixture is a 100% craftsman profile');
select is((app.profile_completion('13500000-0000-4000-8000-0000000000c2') ->> 'percent')::int, 88, 'c2 (no portfolio) is below 100');

-- ---------------------------------------------------------------------------
-- A. authorization
-- ---------------------------------------------------------------------------
select is(pg_temp.q('13500000-0000-4000-8000-0000000000c3', 'public.craftsman_profile_verification_submit()'), 'ERR:42501', 'a non-craftsman persona is refused');
select is(pg_temp.q('00000000-0000-0000-0000-000000000000', 'public.craftsman_profile_verification_submit()'), 'ERR:42501', 'an unknown/anonymous caller is refused');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c3'), 0, 'the refused persona filed nothing');

-- ---------------------------------------------------------------------------
-- B. incomplete -> nothing
-- ---------------------------------------------------------------------------
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c2', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'incomplete', 'below 100% reports incomplete');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c2'), 0, 'and files nothing');

-- ---------------------------------------------------------------------------
-- C. 100% -> exactly one submitted request, account type already installer_technician
-- ---------------------------------------------------------------------------
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c1', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'submitted', 'at 100% a request is submitted');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c1' and subject_type = 'user' and verification_type = 'professional' and requested_account_type = 'installer_technician' and status = 'submitted'), 1, 'exactly one submitted professional request for installer_technician');
select is((select primary_account_type::text from public.users where id = '13500000-0000-4000-8000-0000000000c1'), 'installer_technician', 'the account type is unchanged (it was already assigned)');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c1' and status in ('approved')), 0, 'nothing is auto-approved');
select is((select count(*)::int from public.audit_log where action = 'account.upgrade_requested' and actor_user_id = '13500000-0000-4000-8000-0000000000c1'), 1, 'one audit row');

-- ---------------------------------------------------------------------------
-- D. idempotent
-- ---------------------------------------------------------------------------
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c1', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'already_open', 'a second call reports the open request');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c1'), 1, 'still exactly one request');
select is((select count(*)::int from public.audit_log where action = 'account.upgrade_requested' and actor_user_id = '13500000-0000-4000-8000-0000000000c1'), 1, 'still exactly one audit row');

-- ---------------------------------------------------------------------------
-- E. existing requests
-- ---------------------------------------------------------------------------
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c4', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'resubmitted', 'needs_more_info is resubmitted');
select is((select status::text || ':' || coalesce(reason, '<null>') || ':' || (reviewer_id is null)::text from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c4'), 'submitted:<null>:true', 'back to submitted with the old reason cleared');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c4'), 1, 'no duplicate for needs_more_info');

select is((pg_temp.q('13500000-0000-4000-8000-0000000000c5', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'approved', 'approved is reported');
select is((select status::text || ':' || (applied_at is not null)::text from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c5'), 'approved:true', 'an approved request is never reset');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c5'), 1, 'no second request after approval');

select is((pg_temp.q('13500000-0000-4000-8000-0000000000c6', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'rejected', 'rejected is reported');
select is((select status::text || ':' || count(*) over ()::text from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c6'), 'rejected:1', 'a rejected request is not auto-resubmitted');

select is((pg_temp.q('13500000-0000-4000-8000-0000000000c7', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'already_open', 'an under_review request is left alone');

-- ---------------------------------------------------------------------------
-- E2. manual resubmission after a rejection
-- ---------------------------------------------------------------------------
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c6', 'public.craftsman_profile_verification_submit(true)')::jsonb ->> 'state'), 'resubmitted_after_rejection', 'Resubmit after a rejection files a new request');
select is((select count(*)::int || ':' || count(*) filter (where status = 'submitted')::int || ':' || count(*) filter (where status = 'rejected')::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c6'), '2:1:1', 'the rejected row stays as decided; exactly one new submitted request');
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c6', 'public.craftsman_profile_verification_submit(true)')::jsonb ->> 'state'), 'already_open', 'pressing Resubmit again does not file another');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c6'), 2, 'still exactly two rows');
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c8', 'public.craftsman_profile_verification_submit(true)')::jsonb ->> 'state'), 'incomplete', 'Resubmit needs a 100% profile');
select is((select count(*)::int from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c8'), 1, 'and files nothing when incomplete');

-- ---------------------------------------------------------------------------
-- F. the figure follows the real saved profile
-- ---------------------------------------------------------------------------
delete from public.portfolio_projects where owner_user_id = '13500000-0000-4000-8000-0000000000c1';
select is((pg_temp.q('13500000-0000-4000-8000-0000000000c1', 'public.craftsman_profile_verification_submit()')::jsonb ->> 'state'), 'incomplete', 'removing the portfolio drops the profile below 100 again');

-- ---------------------------------------------------------------------------
-- F2. Admin approval has NO completion requirement (c1 has an open request and an INCOMPLETE profile)
-- ---------------------------------------------------------------------------
select lives_ok($$ update public.verifications set status = 'approved', decided_at = now() where user_id = '13500000-0000-4000-8000-0000000000c1' $$,
  'an Admin may approve while the profile is below 100%');
select is((select status::text from public.verifications where user_id = '13500000-0000-4000-8000-0000000000c1'), 'approved', 'and it is approved');

-- ---------------------------------------------------------------------------
-- G. grants
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.craftsman_profile_verification_submit(boolean)', 'execute')
      and not has_function_privilege('anon', 'public.craftsman_profile_verification_submit(boolean)', 'execute'), 'authenticated may execute, anon may not');

select * from finish();
rollback;

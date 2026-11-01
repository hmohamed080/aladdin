-- READ-ONLY checks for the Admin View-As fixture (run after 01_apply.sql, and again after 03_cleanup.sql with expect=absent by reading the notice).
-- Raises (and so fails the run) if a safety property does not hold. Writes nothing.
do $verify$
declare
  c_craft  constant uuid := '7fa00001-0000-4000-8000-0000000000c1';
  c_poster constant uuid := '7fa00002-0000-4000-8000-0000000000c2';
  c_org    constant uuid := '7fa000a1-aaaa-4aaa-8aaa-0000000000a1';
  n int;
begin
  if not exists (select 1 from auth.users where id = c_craft) then
    raise notice 'view-as fixture: ABSENT (nothing to verify)';
    return;
  end if;

  -- Identity: synthetic, uncredentialed, uncontactable.
  if exists (select 1 from auth.users where id in (c_craft, c_poster)
             and (email not like '%@fixture.invalid' or coalesce(encrypted_password, '') <> '' or phone is not null)) then
    raise exception 'FAIL: a fixture account has a real-looking address, a password or a phone';
  end if;
  if exists (select 1 from auth.identities where user_id in (c_craft, c_poster)) then
    raise exception 'FAIL: a fixture account has a sign-in identity';
  end if;
  if exists (select 1 from public.contacts where user_id in (c_craft, c_poster)) then
    raise exception 'FAIL: a fixture account has a contact row (something could be sent to it)';
  end if;

  -- Not public: not listed, nothing open to other people, organization not visible to anonymous or other users.
  if (select public_profile_status::text from public.profiles where user_id = c_craft) = 'listed' then
    raise exception 'FAIL: the craftsman is publicly listed';
  end if;
  select count(*) into n from public.jobs where poster_org_id = c_org and status in ('open', 'draft');
  if n <> 0 then raise exception 'FAIL: % fixture job(s) are still open to applicants', n; end if;

  -- Anonymous: either no privilege at all (a pass) or zero visible rows. An unrelated signed-in user: zero visible rows.
  begin
    execute 'set local role anon';
    select count(*) into n from public.organizations where id = c_org;
    execute 'reset role';
    if n <> 0 then raise exception 'FAIL: the fixture organization is readable anonymously'; end if;
  exception when insufficient_privilege then
    execute 'reset role';
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.organizations where id = c_org;
  select n + count(*) into n from public.profiles where user_id = c_craft;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  if n <> 0 then raise exception 'FAIL: an unrelated signed-in user can read the fixture organization or craftsman profile (% rows)', n; end if;

  -- Shape: what the six View-As sections show.
  raise notice 'fixture present: assignments=%, reviews=%, points rows=%, projects=%, portfolio files=%, certificates=%, secondary phone=%, in-app notifications=%',
    (select count(*) from public.job_assignments where installer_user_id = c_craft),
    (select count(*) from public.job_reviews r join public.job_assignments a on a.id = r.assignment_id where a.installer_user_id = c_craft),
    (select count(*) from public.points_ledger where user_id = c_craft),
    (select count(*) from public.portfolio_projects where owner_user_id = c_craft),
    (select count(*) from public.portfolio_items where owner_user_id = c_craft),
    (select count(*) from public.professional_certificates where owner_user_id = c_craft),
    (select count(*) from public.secondary_phone_reservations where user_id = c_craft),
    (select count(*) from public.notifications where recipient_user_id in (c_craft, c_poster));
  raise notice 'view-as fixture: all safety checks passed';
end
$verify$;

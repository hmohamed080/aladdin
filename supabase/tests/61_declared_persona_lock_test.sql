-- pgTAP: staging-prep Increment 12 — individual_save_professional is a
-- PROFILE-DATA writer, never an account-type switch. The persona it may write
-- is the caller's established one (declared, else professional canonical);
-- a mismatch — including any Coming Soon type — fails atomically, a caller
-- with no persona is refused, users.primary_account_type is never touched,
-- and ordinary profile fields keep saving.
create extension if not exists pgtap;

begin;
select plan(26);

-- Fixtures:
--   …01 T  Tradesperson registered through onboarding_select_account_type
--   …02 S  Sales registered the same way
--   …03 L  legacy Admin-applied canonical ENGINEER (no declared row)
--   …04 N  professional TRACK only, no persona (never reachable today)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values ('61000000-0000-4000-8000-000000000001', 'p61-t@example.test'),
             ('61000000-0000-4000-8000-000000000002', 'p61-s@example.test'),
             ('61000000-0000-4000-8000-000000000003', 'p61-l@example.test'),
             ('61000000-0000-4000-8000-000000000004', 'p61-n@example.test')) v(id, email);

update public.users set primary_account_type = 'engineer' where id = '61000000-0000-4000-8000-000000000003';
insert into public.onboarding_progress (user_id, selected_track)
values ('61000000-0000-4000-8000-000000000004', 'professional');

-- ===========================================================================
-- T — same-persona save succeeds and every profile field is written
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$,
  'T chooses Tradespeople through the authoritative account-type RPC');
select lives_ok(
  $$ select public.individual_save_professional(
       'installer_technician'::public.persona_type, 'Tiling specialist', 7::smallint,
       'tiling', 'Ten years of floors', array['tiling'], null, array['arabic'], 'within_week',
       array['nasr_city'], false, 'cairo', 'nasr_city', 25::smallint) $$,
  'a same-persona profile save succeeds');
reset role;
select is((select headline from public.profiles where user_id = '61000000-0000-4000-8000-000000000001'),
  'Tiling specialist', 'headline saved');
select is((select bio from public.profiles where user_id = '61000000-0000-4000-8000-000000000001'),
  'Ten years of floors', 'bio saved');
select is((select prof_years_experience::int || '|' || prof_specialization || '|' || prof_city || '|' || prof_max_travel_km::int
             from public.individual_onboarding where user_id = '61000000-0000-4000-8000-000000000001'),
  '7|tiling|nasr_city|25', 'years, specialization, city and travel radius saved');

-- ===========================================================================
-- T — attempted switches fail atomically
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.individual_save_professional(
       'sales'::public.persona_type, 'I sell now', 1::smallint, null, 'changed bio') $$,
  '42501', 'the account type cannot be changed here',
  'switching to another ACTIVE persona is refused');
select throws_ok(
  $$ select public.individual_save_professional(
       'engineer'::public.persona_type, 'Engineer now', 1::smallint, null, 'changed bio') $$,
  '42501', 'the account type cannot be changed here',
  'switching to Coming Soon ENGINEER is refused');
select throws_ok(
  $$ select public.individual_save_professional(
       'contractor'::public.persona_type, 'Contractor now', 1::smallint, null, 'changed bio') $$,
  '42501', 'the account type cannot be changed here',
  'switching to Coming Soon CONTRACTOR is refused');
select throws_ok(
  $$ select public.individual_save_professional(
       'interior_designer'::public.persona_type, 'Designer now', 1::smallint, null, 'changed bio') $$,
  '42501', 'the account type cannot be changed here',
  'switching to the retired interior_designer persona is refused');
reset role;
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '61000000-0000-4000-8000-000000000001'),
  'installer_technician', 'the declared persona is unchanged after every refused switch');
select is((select headline || '|' || bio from public.profiles where user_id = '61000000-0000-4000-8000-000000000001'),
  'Tiling specialist|Ten years of floors', 'a refused call wrote NOTHING (atomic) — profile fields untouched');
select is((select prof_years_experience::int from public.individual_onboarding where user_id = '61000000-0000-4000-8000-000000000001'),
  7, 'and the onboarding row is untouched too');
select is((select primary_account_type::text from public.users where id = '61000000-0000-4000-8000-000000000001'),
  null, 'T''s canonical persona is never written');

-- ===========================================================================
-- S — Sales keeps its persona; cannot become a Tradesperson here
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'sales') $$, 'S chooses Sales');
select lives_ok(
  $$ select public.individual_save_professional('sales'::public.persona_type, 'Showroom sales', 4::smallint) $$,
  'S saves profile data as Sales');
select throws_ok(
  $$ select public.individual_save_professional('installer_technician'::public.persona_type, 'x', 1::smallint) $$,
  '42501', 'the account type cannot be changed here', 'S cannot switch to Tradespeople here');
reset role;
select is((select primary_account_type::text from public.users where id = '61000000-0000-4000-8000-000000000002'),
  null, 'S''s canonical persona is never written');

-- ===========================================================================
-- L — a legacy canonical ENGINEER (now Coming Soon) keeps working
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok(
  $$ select public.individual_save_professional('engineer'::public.persona_type, 'Site engineer', 12::smallint) $$,
  'an existing canonical engineer keeps saving under their current persona');
select throws_ok(
  $$ select public.individual_save_professional('installer_technician'::public.persona_type, 'x', 1::smallint) $$,
  '42501', 'the account type cannot be changed here', 'but cannot switch away from it here');
reset role;
select is((select primary_account_type::text from public.users where id = '61000000-0000-4000-8000-000000000003'),
  'engineer', 'the canonical persona is unchanged');
select is((select headline from public.profiles where user_id = '61000000-0000-4000-8000-000000000003'),
  'Site engineer', 'and their profile data saved normally');

-- ===========================================================================
-- N — no established persona: this RPC never bootstraps one
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select public.individual_save_professional('engineer'::public.persona_type, 'x', 1::smallint) $$,
  '42501', 'select an account type first', 'a track alone cannot pick a Coming Soon persona here');
select throws_ok(
  $$ select public.individual_save_professional('installer_technician'::public.persona_type, 'x', 1::smallint) $$,
  '42501', 'select an account type first', 'nor an active one');
reset role;
select is((select count(*)::int from public.individual_onboarding
            where user_id = '61000000-0000-4000-8000-000000000004' and prof_concrete_type is not null),
  0, 'no declared persona was created by the refused calls');
select is((select primary_account_type::text from public.users where id = '61000000-0000-4000-8000-000000000004'),
  null, 'and no canonical one');

-- ===========================================================================
-- Global: the RPC keeps its signature and security-definer shape
-- ===========================================================================
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'individual_save_professional'),
  true, 'individual_save_professional is still SECURITY DEFINER with one overload');

select * from finish();
rollback;

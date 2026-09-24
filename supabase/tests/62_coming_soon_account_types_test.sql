-- pgTAP: staging-prep Increment 13 — Coming Soon account types are refused by
-- the authoritative onboarding_select_account_type RPC itself (not only by
-- the server actions), while every active type still works and existing
-- holders of a now-closed type keep their persona and data.
create extension if not exists pgtap;

begin;
select plan(36);

-- Fixtures:
--   …01 F  fresh registrant
--   …02 G  fresh registrant (business types)
--   …03 E  legacy Admin-applied canonical ENGINEER
--   …04 C  legacy registrant who selected CONTRACTOR before it closed
--   …05 P  legacy canonical end_consumer (Personal Account)
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values ('62000000-0000-4000-8000-000000000001', 'p62-f@example.test'),
             ('62000000-0000-4000-8000-000000000002', 'p62-g@example.test'),
             ('62000000-0000-4000-8000-000000000003', 'p62-e@example.test'),
             ('62000000-0000-4000-8000-000000000004', 'p62-c@example.test'),
             ('62000000-0000-4000-8000-000000000005', 'p62-p@example.test')) v(id, email);
update public.users set primary_account_type = 'engineer' where id = '62000000-0000-4000-8000-000000000003';
update public.users set primary_account_type = 'end_consumer' where id = '62000000-0000-4000-8000-000000000005';
insert into public.onboarding_progress (user_id, selected_track, selected_persona, account_type_completed_at)
values ('62000000-0000-4000-8000-000000000004', 'professional', 'contractor', now());
insert into public.individual_onboarding (user_id, prof_concrete_type)
values ('62000000-0000-4000-8000-000000000004', 'contractor');

-- ===========================================================================
-- 1. The one database list — must equal the frontend `comingSoon` set
--    (frontend/src/lib/onboarding/coming-soon-parity.test.ts)
-- ===========================================================================
select is((select array_agg(k order by k) from unnest(app.coming_soon_account_types()) k),
  array['contractor', 'end_consumer', 'engineer']::text[],
  'Coming Soon = Contractor, Personal Account (end_consumer), Engineer');

-- ===========================================================================
-- 2. Fresh selection of every Coming Soon type is refused, atomically
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ select public.onboarding_select_account_type('professional', 'engineer') $$,
  '22023', 'this account type is not available yet', 'fresh ENGINEER is refused');
select throws_ok($$ select public.onboarding_select_account_type('professional', 'contractor') $$,
  '22023', 'this account type is not available yet', 'fresh CONTRACTOR is refused');
select throws_ok($$ select public.onboarding_select_account_type('consumer', null) $$,
  '22023', 'this account type is not available yet', 'fresh PERSONAL ACCOUNT (consumer track) is refused');
select throws_ok($$ select public.onboarding_select_account_type('consumer', 'end_consumer') $$,
  '22023', 'this account type is not available yet', 'fresh PERSONAL ACCOUNT by explicit key is refused');
select is(public.my_registration_state(), 'consent_pending', 'F''s registration state is unchanged by the refusals');
reset role;
select is((select count(*)::int from public.onboarding_progress where user_id = '62000000-0000-4000-8000-000000000001'),
  0, 'a refused selection wrote no onboarding row');
select is((select count(*)::int from public.individual_onboarding where user_id = '62000000-0000-4000-8000-000000000001'),
  0, 'and no declared persona');

-- ===========================================================================
-- 3. Every ACTIVE type succeeds
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$,
  'Tradespeople succeeds');
select throws_ok($$ select public.onboarding_select_account_type('professional', 'engineer') $$,
  '22023', 'this account type is not available yet', 'and does not open a path to switch into ENGINEER afterwards');
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'sales') $$, 'Sales Team succeeds');
select lives_ok($$ select public.onboarding_select_account_type('business', 'showroom_dealer') $$, 'Showroom succeeds');
select lives_ok($$ select public.onboarding_select_account_type('business', 'supplier') $$, 'Supplier succeeds');
select lives_ok($$ select public.onboarding_select_account_type('business', 'manufacturer') $$, 'Manufacturer succeeds');
select lives_ok($$ select public.onboarding_select_account_type('business', 'importer') $$, 'Importer succeeds');
reset role;
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '62000000-0000-4000-8000-000000000001'),
  'installer_technician', 'F''s persona stayed Tradespeople after the refused switch');
select is((select selected_org_type::text from public.onboarding_progress where user_id = '62000000-0000-4000-8000-000000000002'),
  'importer', 'G''s last business choice is the intended organization type');
select is((select count(*)::int from public.memberships
            where user_id in ('62000000-0000-4000-8000-000000000001', '62000000-0000-4000-8000-000000000002')),
  0, 'no membership (organization access) was granted by any selection');

-- ===========================================================================
-- 4. Existing legacy holders keep their persona, data and access
-- ===========================================================================
-- E: Admin-applied ENGINEER.
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'engineer') $$,
  'a legacy canonical ENGINEER may still (re-)select Engineer');
select lives_ok($$ select public.individual_save_professional('engineer'::public.persona_type, 'Site engineer', 9::smallint) $$,
  'and keeps editing their engineer profile');
select throws_ok($$ select public.onboarding_select_account_type('professional', 'contractor') $$,
  '22023', 'this account type is not available yet', 'but cannot move into ANOTHER Coming Soon type');
select is((select primary_account_type::text from public.users where id = '62000000-0000-4000-8000-000000000003'),
  'engineer', 'E reads back their own canonical persona (RLS self-read)');
reset role;
select is(app.effective_persona('62000000-0000-4000-8000-000000000003')::text, 'engineer', 'E''s effective persona is intact');
select ok(app.is_professional_persona('62000000-0000-4000-8000-000000000003'), 'E is still recognised as a professional');

-- C: selected CONTRACTOR before it closed.
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000004","role":"authenticated"}';
select is((select selected_persona::text from public.onboarding_progress where user_id = '62000000-0000-4000-8000-000000000004'),
  'contractor', 'C can still read their legacy selection');
select lives_ok($$ select public.onboarding_select_account_type('professional', 'contractor') $$,
  'C may resume/re-select Contractor');
select lives_ok($$ select public.individual_save_professional('contractor'::public.persona_type, 'Fit-out contractor', 15::smallint) $$,
  'and keeps saving their contractor profile');
reset role;
select is((select prof_concrete_type::text from public.individual_onboarding where user_id = '62000000-0000-4000-8000-000000000004'),
  'contractor', 'C''s declared persona is unchanged');

-- P: legacy canonical end_consumer.
set local role authenticated;
set local request.jwt.claims = '{"sub":"62000000-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('consumer', null) $$,
  'a legacy Personal Account holder may resume the consumer track');
select throws_ok($$ select public.onboarding_select_account_type('professional', 'engineer') $$,
  '22023', 'this account type is not available yet', 'but cannot pick a Coming Soon professional type');
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$,
  'and can still choose an ACTIVE type');
reset role;
select is((select primary_account_type::text from public.users where id = '62000000-0000-4000-8000-000000000005'),
  'end_consumer', 'P''s canonical persona is never rewritten by a selection');

-- ===========================================================================
-- 5. active_personal semantics untouched: selections never activate
-- ===========================================================================
select is((select count(*)::int from public.users
            where id::text like '62000000-0000-4000-8000-00000000000_' and status = 'active'),
  0, 'no selection activated an account (users.status unchanged)');
select is((select count(*)::int from public.memberships
            where user_id::text like '62000000-0000-4000-8000-00000000000_'),
  0, 'and none created a membership');

-- ===========================================================================
-- 6. The helpers stay internal
-- ===========================================================================
select ok(not has_function_privilege('authenticated', 'app.coming_soon_account_types()', 'execute'),
  'authenticated cannot call the Coming Soon list directly');
select ok(not has_function_privilege('authenticated', 'app.holds_account_type(uuid, public.onboarding_track, text)', 'execute'),
  'nor the holder check');

select * from finish();
rollback;

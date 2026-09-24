-- pgTAP: staging-prep Increments 1–5, 8, 10 — the parts 58_staging_prep_registration_test.sql
-- does not cover: reserved usernames, canonical-phone uniqueness, activity
-- audience scoping through the RPCs, the 14/7 trade state, the wholesaler
-- remap, the avatar ownership lifecycle, display_name_confirmed_at, and the
-- my_profile_completion() calculation (which no test exercised before, and
-- which raised 22P02 on its first real call until Increment 10).
create extension if not exists pgtap;

begin;
select plan(49);

-- ---------------------------------------------------------------------------
-- Fixtures: three fresh, confirmed registrants.
--   A (…0a) consumer track   B (…0b) Tradesperson   C (…0c) Sales
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values ('59000000-0000-4000-8000-00000000000a', 'p59-a@example.test'),
             ('59000000-0000-4000-8000-00000000000b', 'p59-b@example.test'),
             ('59000000-0000-4000-8000-00000000000c', 'p59-c@example.test')) v(id, email);

-- The two seeded org owners used in §6 act through app.require_verified_caller().
update auth.users set email_confirmed_at = now()
 where id in ('70000001-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111');

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id::uuid, t.t, app.current_consent_version(t.t), 'en'
from (values ('59000000-0000-4000-8000-00000000000a'), ('59000000-0000-4000-8000-00000000000b'),
             ('59000000-0000-4000-8000-00000000000c')) u(id)
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t);

-- ===========================================================================
-- 1. Reserved usernames — refused with the SAME shape as "taken"
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(public.username_available('Admin'), false, 'a reserved name is not available, case-insensitively');
select throws_ok($$ select public.profile_set_username('Support') $$, '23505', 'username is unavailable',
  'claiming a reserved name fails exactly like a taken one — no enumeration signal');
select lives_ok($$ select public.onboarding_select_account_type('consumer', null) $$, 'A records the consumer track');
select lives_ok($$ select public.profile_set_username('p59consumer') $$, 'A claims a normal username');
select is(public.my_registration_state(), 'access_ready', 'A is access_ready');

-- ===========================================================================
-- 2. display_name_confirmed_at + my_profile_completion() (consumer)
-- ===========================================================================
reset role;
select isnt((select display_name from public.profiles where user_id = '59000000-0000-4000-8000-00000000000a'),
  null, 'the account-creation trigger already filled in a fallback display name');
select is((select display_name_confirmed_at from public.profiles where user_id = '59000000-0000-4000-8000-00000000000a'),
  null, '... but it is NOT marked confirmed');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000a","role":"authenticated"}';

select lives_ok($$ select public.my_profile_completion() $$, 'my_profile_completion() runs (raised 22P02 before Increment 10)');
select is((public.my_profile_completion() ->> 'percent')::int, 25, 'consumer: 1 of 4 all-audience items (username) = 25%');
select ok((public.my_profile_completion() -> 'missing') ? 'display_name',
  'an automatic fallback display name does NOT count as complete');
select ok(not ((public.my_profile_completion() -> 'missing') ? 'locality'),
  'locality is not asked for — nothing in the product can write it (Increment 10)');

select throws_ok($$ select public.profile_set_display_name('   ') $$, '22023', null, 'a blank display name is refused');
select lives_ok($$ select public.profile_set_display_name('  Omar Hassan ') $$, 'an explicit display-name save succeeds');
reset role;
select is((select display_name from public.profiles where user_id = '59000000-0000-4000-8000-00000000000a'),
  'Omar Hassan', 'the saved name is trimmed');
select isnt((select display_name_confirmed_at from public.profiles where user_id = '59000000-0000-4000-8000-00000000000a'),
  null, 'and ONLY that explicit save sets display_name_confirmed_at');
set local role authenticated;
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is((public.my_profile_completion() ->> 'percent')::int, 50, 'confirming the display name raises completion to 50%');

-- ===========================================================================
-- 3. Canonical phone — E.164 uniqueness, neutral collision error
-- ===========================================================================
select throws_ok($$ select public.profile_set_phone('EG', '1012345678', '01012345678') $$, '22023', null,
  'a non-E.164 value is refused by the shape backstop');
select lives_ok($$ select public.profile_set_phone('EG', '1012345678', '+201012345678') $$, 'A saves a canonical E.164 phone');
select is((public.my_profile_completion() ->> 'percent')::int, 75, 'the phone raises completion to 75%');

set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1012345678', '+201012345678') $$, '23505',
  'phone number is unavailable', 'a second account cannot hold the same number — and is not told whose it is');

-- ===========================================================================
-- 4. Avatar ownership lifecycle: pending -> upload-authorized -> ready/current
-- ===========================================================================
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select throws_ok($$ select public.avatar_request_upload('image/svg+xml') $$, '22023', null, 'an unsupported type is refused');
select set_config('test.key1', public.avatar_request_upload('image/jpeg'), true);
select ok(current_setting('test.key1') ~ '^[0-9a-f-]{36}\.jpg$', 'the server generates the object key');
select ok(app.can_upload_avatar_object(current_setting('test.key1')), 'the owner may upload to their own PENDING key');

set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select ok(not app.can_upload_avatar_object(current_setting('test.key1')), 'another account may NOT upload to it');
select throws_ok(format($$ select public.avatar_confirm_upload(%L) $$, current_setting('test.key1')), 'P0002', null,
  'nor confirm it');

set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(public.avatar_confirm_upload(current_setting('test.key1')), null, 'the first confirm has no previous avatar to clean up');
select ok(not app.can_upload_avatar_object(current_setting('test.key1')), 'once ready, the key can no longer be uploaded over');
select ok(app.is_current_avatar_object(current_setting('test.key1')), 'and it is the current avatar');
select is((public.my_profile_completion() ->> 'percent')::int, 100, 'consumer with every item done is at 100%');
select is(jsonb_array_length(public.my_profile_completion() -> 'missing'), 0, 'with nothing missing');

select set_config('test.key2', public.avatar_request_upload('image/png'), true);
select is(public.avatar_confirm_upload(current_setting('test.key2')), current_setting('test.key1'),
  'a replacement returns the previous key for cleanup');
reset role;
select is((select state::text from public.avatar_uploads where object_key = current_setting('test.key1')), 'deleted',
  'and the previous row is retired, never overwritten in place');
select ok(not app.is_current_avatar_object(current_setting('test.key1')), 'the old object is no longer current');

-- ===========================================================================
-- 5. Tradesperson: the 14 active / 7 retired trades, and completion via trades
-- ===========================================================================
select is((select count(*)::int from public.trades where is_active), 14, 'exactly 14 trades are active');
select is((select count(*)::int from public.trades where not is_active and key in
  ('kitchens_doors','plumbing','electrical','hvac','gypsum_paint','tiling','marble_granite')), 7,
  'the 7 legacy trades are retired but still present for history');

set local role authenticated;
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$, 'B records the Tradesperson intent');
select lives_ok($$ select public.profile_set_username('p59trade') $$, 'B claims a username');
select ok((public.my_profile_completion() -> 'missing') ? 'activities', 'a Tradesperson with no trade is asked for one');
-- Declared professional type (the review window) so user_trades_set admits B.
reset role;
insert into public.individual_onboarding (user_id, prof_concrete_type, professional_completed_at)
values ('59000000-0000-4000-8000-00000000000b', 'installer_technician', now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$ select public.user_trades_set(array['plumbing']) $$, '22023', null, 'a retired trade cannot be newly selected');
select lives_ok($$ select public.user_trades_set(array['painting']) $$, 'an active trade can');
select ok(not ((public.my_profile_completion() -> 'missing') ? 'activities'),
  'a held ACTIVE trade satisfies a Tradesperson''s "activities" item (Increment 10)');

-- ===========================================================================
-- 6. Activity scoping through the RPCs
-- ===========================================================================
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000c","role":"authenticated"}';
reset role;
update public.users set primary_account_type = 'sales' where id = '59000000-0000-4000-8000-00000000000c';
set local role authenticated;
set local request.jwt.claims = '{"sub":"59000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select throws_ok($$ select public.user_activities_set(array['finishing']) $$, '22023', null,
  'a Sales account cannot take an Engineer activity');
select lives_ok($$ select public.user_activities_set(array['sales_manager']) $$, 'but can take its own');

-- Owner of a SHOWROOM (Cairo Ceramics Showroom) and of a SUPPLIER (Nile Finishing Supplies).
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.organization_activities_set('9c000000-cccc-4ccc-8ccc-000000000001',
  array['building_and_finishing_supplies_retailer']) $$, 'a Showroom may take Mawan (its own retail key)');
select throws_ok($$ select public.organization_activities_set('9c000000-cccc-4ccc-8ccc-000000000001',
  array['distributor']) $$, '22023', null, 'but never the Supplier ''distributor'' key');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$ select public.organization_activities_set('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array['building_and_finishing_supplies_retailer']) $$, '22023', null, 'and a Supplier may not take Mawan');

-- ===========================================================================
-- 7. Wholesaler -> Supplier remap (the migration's own two statements, replayed
--    over fresh wholesaler fixtures, since seeds run after migrations)
-- ===========================================================================
reset role;
select is((select count(*)::int from public.organizations where org_type = 'wholesaler'), 0,
  'no organization is still typed wholesaler after migrations + seed');
insert into public.organizations (id, name, org_type, created_by) values
  ('59000000-0000-4000-8000-0000000000f1', 'P59 Wholesale One', 'wholesaler', '11111111-1111-4111-8111-111111111111'),
  ('59000000-0000-4000-8000-0000000000f2', 'P59 Wholesale Two', 'wholesaler', '11111111-1111-4111-8111-111111111111');
insert into public.organization_activities (organization_id, activity_id)
select o.id, a.id from public.organizations o
  join public.activities a on a.organization_type = 'supplier' and a.key = 'wholesaler'
 where o.org_type = 'wholesaler'
on conflict do nothing;
update public.organizations set org_type = 'supplier' where org_type = 'wholesaler';
select is((select count(*)::int from public.organizations
            where id in ('59000000-0000-4000-8000-0000000000f1', '59000000-0000-4000-8000-0000000000f2')
              and org_type = 'supplier'), 2, 'every remapped wholesaler becomes a supplier');
select is((select count(*)::int from public.organization_activities oa join public.activities a on a.id = oa.activity_id
            where a.key = 'wholesaler'
              and oa.organization_id in ('59000000-0000-4000-8000-0000000000f1', '59000000-0000-4000-8000-0000000000f2')),
  2, 'with exactly one wholesaler activity row per migrated organization');

select * from finish();
rollback;

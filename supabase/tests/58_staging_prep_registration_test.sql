-- pgTAP: staging-prep registration redesign — the highest-risk assertions
-- from the corrected plan (docs/plans "Staging-prep" revision 2 + final
-- corrections): active_personal's tested guarantee is unchanged, the new
-- access_ready/username_pending states behave as specified, username
-- normalization is non-destructive, and the activities schema's
-- exactly-one-audience design actually holds at the constraint level.
create extension if not exists pgtap;

begin;
select plan(17);

-- ---------------------------------------------------------------------------
-- Fixture: two fresh users. One (biz) will complete consent + a business
-- account-type choice and NOTHING else — the exact scenario the corrected
-- design must resolve to access_ready, never active_personal. The other
-- (nouser) proves the username_pending boundary.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('58000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staging-prep-biz@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Staging Prep Biz","locale":"en"}'::jsonb, now(), now(), now()),
  ('58000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'staging-prep-nouser@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Staging Prep Nouser","locale":"en"}'::jsonb, now(), now(), now());

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from (values ('58000000-0000-4000-8000-000000000001'::uuid),
             ('58000000-0000-4000-8000-000000000002'::uuid)) u(id)
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t);

-- ---------------------------------------------------------------------------
-- 1. active_personal is UNCHANGED: a business-track account with an approved
--    account type and ZERO organizations must NOT reach active_personal.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"58000000-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  $$ select public.onboarding_select_account_type('business'::public.onboarding_track, 'supplier') $$,
  'onboarding_select_account_type no longer requires the contact step first');
select lives_ok(
  $$ select public.profile_set_username('bizowner1') $$,
  'a syntactically valid, available username is accepted');
reset role;

-- my_registration_state() reads auth.uid() via the RLS/JWT context, so it
-- must be called under the same role/claims as the write above.
set local role authenticated;
set local request.jwt.claims = '{"sub":"58000000-0000-4000-8000-000000000001","role":"authenticated"}';
select isnt(
  public.my_registration_state(), 'active_personal',
  'a business-track account with an approved type and zero organizations is NEVER active_personal');
select is(
  public.my_registration_state(), 'access_ready',
  'that same account is access_ready — authentication complete, org optional');
reset role;

select is(
  (select count(*)::int from public.memberships where user_id = '58000000-0000-4000-8000-000000000001'),
  0, 'sanity: this account genuinely has zero memberships');

-- ---------------------------------------------------------------------------
-- 2. username_pending: account type set, consent recorded, but no username.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"58000000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ select public.onboarding_select_account_type('professional'::public.onboarding_track, 'installer_technician') $$,
  'account type recorded for the second fixture');
select is(
  public.my_registration_state(), 'username_pending',
  'account type known, consent recorded, but no username -> username_pending, never access_ready');
select lives_ok(
  $$ select public.profile_set_username('secondfixture') $$,
  'the recovery path (picking a username) succeeds');
select is(
  public.my_registration_state(), 'access_ready',
  'after picking a username, the same account reaches access_ready');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Username normalization is non-destructive: shape rejection, not
--    silent stripping.
-- ---------------------------------------------------------------------------
select is(
  app.normalize_username_for_uniqueness('  Ahmed_Test  '), 'ahmed_test',
  'normalization trims + lowercases and does nothing else');
set local role authenticated;
set local request.jwt.claims = '{"sub":"58000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  $$ select public.profile_set_username('ahmed!') $$,
  '22023',
  'username may contain only letters, digits, "." and "_", must start with a letter, and may not start, end, or double up on separators',
  'a disallowed character is REJECTED, never silently stripped');
select throws_ok(
  -- 'SecondFixture' is a case-variant of fixture 2's already-claimed
  -- 'secondfixture' (set in section 2 above) — attempted here by a
  -- DIFFERENT user (fixture 1), which is what actually exercises the
  -- cross-row case-insensitive unique index (re-saving one's own username in
  -- a different case is not a collision at all).
  $$ select public.profile_set_username('SecondFixture') $$,
  '23505', 'username is unavailable',
  'a case-variant of ANOTHER account''s already-claimed username collides (case-insensitive uniqueness)');
reset role;

-- ---------------------------------------------------------------------------
-- 4. activities: exactly-one-audience + per-audience partial uniqueness.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.activities (key, sort_order) values ('both_null_test', 999) $$,
  '23514', null,
  'a row with neither organization_type nor persona_type set is rejected');
select throws_ok(
  $$ insert into public.activities (organization_type, persona_type, key, sort_order)
     values ('supplier', 'sales', 'both_set_test', 999) $$,
  '23514', null,
  'a row with BOTH organization_type and persona_type set is rejected');
select throws_ok(
  $$ insert into public.activities (organization_type, key, sort_order) values ('supplier', 'distributor', 999) $$,
  '23505', null,
  'org-scoped uniqueness: a duplicate (organization_type, key) pair is rejected');
select lives_ok(
  $$ insert into public.activities (persona_type, key, sort_order) values ('engineer', 'distributor', 999) $$,
  'a DIFFERENT audience (persona-scoped) may reuse a key already used by an org-scoped row (the two partial indexes are independent)');
delete from public.activities where key = 'distributor' and persona_type = 'engineer';

select is(
  (select count(*)::int from public.activities
    where organization_type = 'showroom_dealer' and key = 'building_and_finishing_supplies_retailer'),
  1, 'Showroom''s موان activity uses its own distinct key, never Supplier''s distributor');

select * from finish();
rollback;

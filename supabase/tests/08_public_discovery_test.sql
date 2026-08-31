-- pgTAP: public-discovery projection safety (Sprint 1.1 review B1).
-- The base organizations/profiles tables are private; anonymous discovery is
-- served only by curated views exposing approved columns. No internal identifiers
-- (created_by, user_id), operational metadata, or soft-delete state leak.
create extension if not exists pgtap;

begin;
select plan(14);

-- The public views expose ONLY the approved column set (adversarial: no
-- created_by, status, deleted_at, timestamps on orgs; no user_id/timestamps on profiles).
select columns_are(
  'public'::name, 'organization_public_directory'::name,
  array['id','name','slug','org_type','is_verified','primary_locale','locality_id','logo_media_id'],
  'organization_public_directory exposes only approved public columns');
select columns_are(
  'public'::name, 'profile_public_directory'::name,
  array['id','display_name','headline','bio','avatar_media_id','locality_id','languages','persona',
        'specialization','services','years_experience','service_areas'],
  'profile_public_directory exposes only approved display columns (no user_id)');

-- Anonymous discovery through the views.
set local role anon;
set local request.jwt.claims = '';
-- 10 = 2 base fixtures + the 8 verified businesses of the Pilot world. The two
-- organizations sitting in the Admin review queue (pending_verification) are
-- excluded, which is the point: verification is what gates discovery.
select is((select count(*)::int from public.organization_public_directory), 10,
  'anon sees every active+verified org via the org directory view');
-- Only LISTED professionals appear; the seeded sales professional (Karim) is a
-- professional account type left `hidden`, so eligibility — not account type —
-- gates discovery (Sprint 1.2).
-- Sprint 12: only PERSONAL professionals are discoverable here. A business OWNER
-- is a business-only identity (no personal persona) — their business is
-- discovered through organization_public_directory instead. The 8 are the base
-- interior designer plus the Sprint-14 trades and consultants.
select is((select count(*)::int from public.profile_public_directory), 8,
  'anon sees only the LISTED personal professional profiles');
select is(
  (select count(*)::int from public.profile_public_directory where display_name like 'Karim%'),
  0, 'a professional account type left hidden does NOT appear in public discovery');

-- Base tables remain private to anon (hard permission denial).
select throws_ok('select count(*) from public.organizations', '42501', null,
  'anon cannot read the base organizations table');
select throws_ok('select count(*) from public.profiles', '42501', null,
  'anon cannot read the base profiles table');
select throws_ok('select count(*) from public.branches', '42501', null,
  'anon cannot read branches (no public branch view exists)');

-- Unverified / inactive / soft-deleted organizations are NOT discoverable.
reset role;
update public.organizations set is_verified = false
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.organizations (id, name, org_type, status, is_verified, created_by)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Draft Co', 'supplier', 'draft', false,
        '11111111-1111-4111-8111-111111111111');
set local role anon;
set local request.jwt.claims = '';
-- Scoped to the org that was just unverified rather than to the global count:
-- the assertion is about THAT organization leaving the directory, and a scoped
-- check keeps proving it no matter how large the seeded world grows.
select is(
  (select count(*)::int from public.organization_public_directory
     where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'unverifying an org removes it from public discovery');
select is(
  (select count(*)::int from public.organization_public_directory
     where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  0, 'a draft/unverified org never appears in public discovery');

-- End-consumer and platform-staff profiles are NOT professional-discoverable.
-- (Omar is the seeded end consumer; the directory must not contain his profile.)
select is(
  (select count(*)::int from public.profile_public_directory
   where display_name like 'Omar%'),
  0, 'end-consumer profiles are not in the public professional directory');

-- A suspended user's listed profile is not publicly discoverable.
reset role;
update public.users set status = 'suspended'
  where id = '33333333-3333-4333-8333-333333333333';
set local role anon;
set local request.jwt.claims = '';
-- Name-scoped for the same reason as the org check above: what is being proved
-- is that THIS suspended person disappears, not that the directory is empty.
select is(
  (select count(*)::int from public.profile_public_directory where display_name like 'Nadia%'),
  0, 'a suspended user never appears publicly even when listed');

-- Soft-deleted professional profile drops out of discovery (restore the status
-- first, so this proves the DELETE gate rather than re-proving the status gate).
reset role;
update public.users set status = 'active'
  where id = '33333333-3333-4333-8333-333333333333';
update public.profiles set deleted_at = now()
  where user_id = '33333333-3333-4333-8333-333333333333';
set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.profile_public_directory where display_name like 'Nadia%'),
  0, 'soft-deleting a listed professional profile removes it from public discovery');

-- A logged-in non-member also only gets the projection, never base columns.
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.organizations
     where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'an authenticated non-member cannot read another org from the base table');

reset role;
select * from finish();
rollback;

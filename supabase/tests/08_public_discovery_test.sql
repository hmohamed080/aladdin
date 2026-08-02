-- pgTAP: public-discovery projection safety (Sprint 1.1 review B1).
-- The base organizations/profiles tables are private; anonymous discovery is
-- served only by curated views exposing approved columns. No internal identifiers
-- (created_by, user_id), operational metadata, or soft-delete state leak.
create extension if not exists pgtap;

begin;
select plan(12);

-- The public views expose ONLY the approved column set (adversarial: no
-- created_by, status, deleted_at, timestamps on orgs; no user_id/timestamps on profiles).
select columns_are(
  'public'::name, 'organization_public_directory'::name,
  array['id','name','slug','org_type','is_verified','primary_locale','locality_id','logo_media_id'],
  'organization_public_directory exposes only approved public columns');
select columns_are(
  'public'::name, 'profile_public_directory'::name,
  array['id','display_name','headline','bio','avatar_media_id','locality_id','languages'],
  'profile_public_directory exposes only approved display columns (no user_id)');

-- Anonymous discovery through the views.
set local role anon;
set local request.jwt.claims = '';
select is((select count(*)::int from public.organization_public_directory), 2,
  'anon sees the two active+verified orgs via the org directory view');
select is((select count(*)::int from public.profile_public_directory), 3,
  'anon sees the three active professional profiles via the profile directory view');

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
select is((select count(*)::int from public.organization_public_directory), 1,
  'unverifying an org removes it from public discovery');
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

-- Soft-deleted professional profile drops out of discovery.
reset role;
update public.profiles set deleted_at = now()
  where user_id = '11111111-1111-4111-8111-111111111111';
set local role anon;
set local request.jwt.claims = '';
select is((select count(*)::int from public.profile_public_directory), 2,
  'soft-deleting a professional profile removes it from public discovery');

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

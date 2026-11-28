-- pgTAP: Showroom business profile image (20261015090043).
-- Claims: only an organization manager can request/confirm/remove; members (and only members) can read the
-- current image; outsiders and plain members cannot write; the pointer cannot be aimed at another
-- organization's image or written directly; replacement returns the previous key; history/audit is kept.
create extension if not exists pgtap;

begin;
\ir helpers/organization_media_receipt.inc
select plan(32);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('82' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000082')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p82-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P82 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 4) n;

-- 1 manager of org A   2 plain member of A   3 manager of org B   4 anonymous-ish outsider
\set u1 '{"sub":"82000001-0000-4000-8000-000000000082","role":"authenticated"}'
\set u2 '{"sub":"82000002-0000-4000-8000-000000000082","role":"authenticated"}'
\set u3 '{"sub":"82000003-0000-4000-8000-000000000082","role":"authenticated"}'
\set u4 '{"sub":"82000004-0000-4000-8000-000000000082","role":"authenticated"}'

create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated;

select set_config('request.jwt.claims', :'u1', true);
insert into _ids select 'orgA', app.organization_create_owned('Image Org A', 'showroom_dealer', 'en', 'Main')::text;
select set_config('request.jwt.claims', :'u3', true);
insert into _ids select 'orgB', app.organization_create_owned('Image Org B', 'showroom_dealer', 'en', 'Main')::text;
insert into public.memberships (user_id, organization_id, status, accepted_at)
values ('82000002-0000-4000-8000-000000000082', (select v::uuid from _ids where k = 'orgA'), 'active', now());
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, 'catalog.read' from public.memberships m
 where m.organization_id = (select v::uuid from _ids where k = 'orgA') and m.user_id = '82000002-0000-4000-8000-000000000082';

set local role authenticated;

-- 1. manager can request an upload ---------------------------------------------------------------------
set local request.jwt.claims = :'u1';
insert into _ids select 'key1', public.organization_image_request_upload((select v::uuid from _ids where k = 'orgA'), 'image/png');
select matches((select v from _ids where k = 'key1'), '^' || (select v from _ids where k = 'orgA') || '/[0-9a-f-]{36}\.png$',
  'IMG-1: the key is generated server-side and prefixed with the organization id');
select throws_ok(format($q$select public.organization_image_request_upload(%L, 'image/gif')$q$, (select v from _ids where k = 'orgA')),
  '22023', null, 'IMG-2: an unsupported content type is refused');
select ok(app.can_upload_organization_image_object((select v from _ids where k = 'key1')), 'IMG-3: the manager may upload to the pending key');
select ok(not app.can_upload_organization_image_object((select v from _ids where k = 'orgA') || '/00000000-0000-4000-8000-000000000000.png'),
  'IMG-4: a well-formed key without a pending row proves nothing');

-- 2. who cannot write ----------------------------------------------------------------------------------
set local request.jwt.claims = :'u2';
select throws_ok(format($q$select public.organization_image_request_upload(%L, 'image/png')$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'IMG-5: a plain member cannot request an upload');
select ok(not app.can_upload_organization_image_object((select v from _ids where k = 'key1')), 'IMG-6: a plain member may not upload even to a pending key');
set local request.jwt.claims = :'u3';
select throws_ok(format($q$select public.organization_image_request_upload(%L, 'image/png')$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'IMG-7: another organization''s manager cannot request an upload');
select throws_ok(format($q$select public.organization_image_confirm_upload(%L)$q$, (select v from _ids where k = 'key1')),
  '42501', null, 'IMG-8: another organization''s manager cannot confirm someone else''s upload');
set local request.jwt.claims = :'u4';
select throws_ok(format($q$select public.organization_image_request_upload(%L, 'image/png')$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'IMG-9: an outsider cannot request an upload');

-- 3. confirm -------------------------------------------------------------------------------------------
set local request.jwt.claims = :'u1';
select pg_temp.attest_organization_fixture('organization',(select v from _ids where k = 'key1'));
select is(public.organization_image_confirm_upload((select v from _ids where k = 'key1')), null, 'IMG-10: the first verified confirm has no previous key');
select is((select count(*)::int from public.organizations where id = (select v::uuid from _ids where k = 'orgA') and logo_media_id is not null), 1,
  'IMG-11: the organization points at the new image');
reset role;
select is((select count(*)::int from public.audit_log where action = 'organization.image_set' and organization_id = (select v::uuid from _ids where k = 'orgA')), 1,
  'IMG-12: the change is audited');
set local role authenticated;

-- 4. who can read --------------------------------------------------------------------------------------
set local request.jwt.claims = :'u1';
select is(public.organization_image_current((select v::uuid from _ids where k = 'orgA')), (select v from _ids where k = 'key1'), 'IMG-13: the manager reads the current key');
set local request.jwt.claims = :'u2';
select is(public.organization_image_current((select v::uuid from _ids where k = 'orgA')), (select v from _ids where k = 'key1'), 'IMG-14: a member reads the current key');
select ok(app.can_read_organization_image_object((select v from _ids where k = 'key1')), 'IMG-15: a member may read the object');
set local request.jwt.claims = :'u3';
select is(public.organization_image_current((select v::uuid from _ids where k = 'orgA')), null, 'IMG-16: another organization gets nothing');
select ok(not app.can_read_organization_image_object((select v from _ids where k = 'key1')), 'IMG-17: another organization may not read the object');
set local request.jwt.claims = :'u4';
select is(public.organization_image_current((select v::uuid from _ids where k = 'orgA')), null, 'IMG-18: an outsider gets nothing');

-- 5. the pointer is not a free column ------------------------------------------------------------------
set local request.jwt.claims = :'u3';
insert into _ids select 'keyB', public.organization_image_request_upload((select v::uuid from _ids where k = 'orgB'), 'image/jpeg');
select pg_temp.attest_organization_fixture('organization',(select v from _ids where k = 'keyB'));
select public.organization_image_confirm_upload((select v from _ids where k = 'keyB'));
set local request.jwt.claims = :'u1';
select throws_ok(format($q$update public.organizations set logo_media_id = (select logo_media_id from public.organizations where id = %L) where id = %L$q$,
  (select v from _ids where k = 'orgB'), (select v from _ids where k = 'orgA')), '42501', null, 'IMG-19: the pointer cannot be written directly');

-- 6. replacement and removal ---------------------------------------------------------------------------
insert into _ids select 'key2', public.organization_image_request_upload((select v::uuid from _ids where k = 'orgA'), 'image/webp');
select pg_temp.attest_organization_fixture('organization',(select v from _ids where k = 'key2'));
select is(public.organization_image_confirm_upload((select v from _ids where k = 'key2')), (select v from _ids where k = 'key1'),
  'IMG-20: a replacement returns the previous key so its bytes can be deleted');
select is(public.organization_image_current((select v::uuid from _ids where k = 'orgA')), (select v from _ids where k = 'key2'), 'IMG-21: the new image is current');
select ok(not app.can_read_organization_image_object((select v from _ids where k = 'key1')), 'IMG-22: the superseded object is no longer readable');
select ok(app.can_delete_organization_image_object((select v from _ids where k = 'key1')), 'IMG-22b: the manager can still reach the superseded object to delete its bytes');
set local request.jwt.claims = :'u2';
select ok(not app.can_delete_organization_image_object((select v from _ids where k = 'key1')), 'IMG-22c: a plain member cannot');
select throws_ok(format($q$select public.organization_image_remove(%L)$q$, (select v from _ids where k = 'orgA')),
  '42501', null, 'IMG-23: a plain member cannot remove the image');
set local request.jwt.claims = :'u1';
select is(public.organization_image_remove((select v::uuid from _ids where k = 'orgA')), (select v from _ids where k = 'key2'), 'IMG-24: removal returns the key to delete');
select is(public.organization_image_current((select v::uuid from _ids where k = 'orgA')), null, 'IMG-25: no current image after removal');
select is(public.organization_image_remove((select v::uuid from _ids where k = 'orgA')), (select v from _ids where k = 'key2'), 'IMG-26: retry returns the same cleanup key without another lifecycle write');
reset role;
select is((select count(*)::int from public.audit_log where action = 'organization.image_removed' and organization_id = (select v::uuid from _ids where k = 'orgA')), 1,
  'IMG-27: the removal is audited');
select is((select count(*)::int from public.organization_images where organization_id = (select v::uuid from _ids where k = 'orgA') and state = 'deleted'), 2,
  'IMG-28: superseded and removed images stay as history');

-- 7. nothing public ------------------------------------------------------------------------------------
set local role anon;
select throws_ok($q$select public.organization_image_current('00000000-0000-4000-8000-000000000001')$q$, '42501', null, 'IMG-29: anon cannot call the reader');
reset role;
select is((select count(*)::int from storage.buckets where id = 'organization-images' and public = false), 1, 'IMG-30: the bucket is private');

select * from finish();
rollback;

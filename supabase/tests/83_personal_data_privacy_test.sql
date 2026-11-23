-- pgTAP: personal-account privacy - which identities can see which personal fields.
-- Records the audited policy as executable claims: personal email/phone/WhatsApp are private by default,
-- a business identity never carries them, colleagues see the minimum, and business contact channels are
-- a separate consent-controlled record.
create extension if not exists pgtap;

begin;
select plan(24);
-- rc2: this fixture activates / approves showrooms directly, bypassing the seller-readiness triggers PR #84 added
-- (showroom_activation_complete / showroom_product_publish_complete). They are disabled for this
-- transaction only (rolled back with it); the readiness rules themselves are asserted in tests 92-94.
alter table public.organizations disable trigger showroom_activation_complete;
alter table public.products disable trigger showroom_product_publish_complete;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
select ('83' || lpad(n::text, 6, '0') || '-0000-4000-8000-000000000083')::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'p83-' || n || '@example.test',
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', 'P83 ' || n, 'locale', 'en'), now(), now(), now()
from generate_series(1, 3) n;

-- 1 manager of org A (has a PERSONAL phone)   2 plain member of A   3 manager of org B (an outsider to A)
\set u1 '{"sub":"83000001-0000-4000-8000-000000000083","role":"authenticated"}'
\set u2 '{"sub":"83000002-0000-4000-8000-000000000083","role":"authenticated"}'
\set u3 '{"sub":"83000003-0000-4000-8000-000000000083","role":"authenticated"}'

create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated;

select set_config('request.jwt.claims', :'u1', true);
insert into _ids select 'orgA', app.organization_create_owned('Privacy Org A', 'showroom_dealer', 'en', 'Main')::text;
select set_config('request.jwt.claims', :'u3', true);
insert into _ids select 'orgB', app.organization_create_owned('Privacy Org B', 'showroom_dealer', 'en', 'Main')::text;
insert into public.memberships (user_id, organization_id, status, accepted_at)
values ('83000002-0000-4000-8000-000000000083', (select v::uuid from _ids where k = 'orgA'), 'active', now());
insert into public.membership_capabilities (membership_id, capability_key)
select m.id, 'catalog.read' from public.memberships m
 where m.organization_id = (select v::uuid from _ids where k = 'orgA') and m.user_id = '83000002-0000-4000-8000-000000000083';

-- the manager's PERSONAL phone, and a distinct BUSINESS contact record with one channel shared
update public.profiles set phone_e164 = '+201000000083', phone_national = '1000000083', phone_country_iso2 = 'EG'
 where user_id = '83000001-0000-4000-8000-000000000083';
insert into public.organization_contacts (organization_id, phone_e164, whatsapp_e164, contact_email, show_phone, show_whatsapp, show_email)
values ((select v::uuid from _ids where k = 'orgA'), '+20222222083', '+20122222083', 'sales@privacy-a.example.test', true, false, false);
update public.organizations set status = 'active', is_verified = true where id in ((select v::uuid from _ids where k = 'orgA'), (select v::uuid from _ids where k = 'orgB'));
insert into public.notifications (recipient_user_id, organization_id, event_type, subject_type, subject_id, deep_link, title_key, body_key, params)
values ('83000001-0000-4000-8000-000000000083', (select v::uuid from _ids where k = 'orgA'), 'rfq.submitted', 'rfq',
        '00000000-0000-4000-8000-000000000083', '/b2b/rfqs', 'notif.title', 'notif.body', '{"requester_name":"Privacy Org B"}');

set local role authenticated;

-- Base tables: self only ------------------------------------------------------------------------------
set local request.jwt.claims = :'u1';
select is((select phone_e164 from public.profiles where user_id = '83000001-0000-4000-8000-000000000083'), '+201000000083', 'PRIV-1: a person reads their own phone');
set local request.jwt.claims = :'u2';
select is((select count(*)::int from public.profiles where user_id = '83000001-0000-4000-8000-000000000083'), 0, 'PRIV-2: a colleague cannot read the owner''s profile row (phone, username)');
select is((select count(*)::int from public.users where id = '83000001-0000-4000-8000-000000000083'), 0, 'PRIV-3: nor the owner''s account row');
set local request.jwt.claims = :'u3';
select is((select count(*)::int from public.profiles where user_id = '83000001-0000-4000-8000-000000000083'), 0, 'PRIV-4: an outsider cannot read it either');
set role anon;
select throws_ok($q$select count(*) from public.profiles$q$, '42501', null, 'PRIV-5: anonymous visitors have no access to profiles at all');
select throws_ok($q$select count(*) from public.users$q$, '42501', null, 'PRIV-6: or to accounts');
set role authenticated;

-- Colleague directories: managers only, masked, no phone ---------------------------------------------
set local request.jwt.claims = :'u2';
select throws_ok(format($q$select * from public.org_members_list(%L)$q$, (select v from _ids where k = 'orgA')), '42501', null,
  'PRIV-7: a plain member cannot list colleagues');
select throws_ok(format($q$select * from public.org_join_requests_list(%L)$q$, (select v from _ids where k = 'orgA')), '42501', null,
  'PRIV-8: nor join requests');
set local request.jwt.claims = :'u3';
select throws_ok(format($q$select * from public.org_members_list(%L)$q$, (select v from _ids where k = 'orgA')), '42501', null,
  'PRIV-9: another organization''s manager cannot list this organization''s members');
set local request.jwt.claims = :'u1';
select is((select email_masked from public.org_members_list((select v::uuid from _ids where k = 'orgA')) where user_id = '83000002-0000-4000-8000-000000000083'),
  app.mask_email('p83-2@example.test'), 'PRIV-10: a manager sees a colleague''s email masked');
select isnt((select email_masked from public.org_members_list((select v::uuid from _ids where k = 'orgA')) where user_id = '83000002-0000-4000-8000-000000000083'),
  'p83-2@example.test', 'PRIV-11: never the raw address');
reset role;
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('org_members_list', 'org_join_requests_list', 'sales_assignable_members')
  and pg_get_function_result(p.oid) ~* '(phone|whatsapp)'), 0, 'PRIV-12: no colleague directory returns a phone or WhatsApp column');
set local role authenticated;
set local request.jwt.claims = :'u2';
select throws_ok(format($q$select * from public.sales_assignable_members(%L)$q$, (select v from _ids where k = 'orgA')), '42501', null,
  'PRIV-13: the assignee picker needs the sales.assign authority');

-- Public surfaces carry no personal contact data -------------------------------------------------------
reset role;
select is((select count(*)::int from information_schema.columns where table_schema = 'public'
  and table_name in ('organization_public_directory', 'profile_public_directory', 'catalog_published_products')
  and column_name ~* '(phone|whatsapp|email|username|contact)'), 0, 'PRIV-14: public directory views expose no phone, WhatsApp, email or username');
select is((select count(*)::int from public.profile_public_directory where display_name = 'P83 1'), 0,
  'PRIV-15: a personal profile is absent from the public directory unless its owner listed it (default hidden)');
select is((select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'public_profile_status'),
  '''hidden''::public_profile_status', 'PRIV-16: the default is hidden');

-- Business contact: separate record, owner-only, per-channel consent --------------------------------------
set local role authenticated;
set local request.jwt.claims = :'u2';
select is((select count(*)::int from public.organization_contacts where organization_id = (select v::uuid from _ids where k = 'orgA')), 0,
  'PRIV-17: a plain member cannot read the organization''s stored contact record');
set local request.jwt.claims = :'u3';
select is((select count(*)::int from public.organization_contacts where organization_id = (select v::uuid from _ids where k = 'orgA')), 0,
  'PRIV-18: an outsider cannot either');
select is((select phone from public.business_contact((select v::uuid from _ids where k = 'orgB'), (select v::uuid from _ids where k = 'orgA'))), '+20222222083',
  'PRIV-19: a shared channel is the BUSINESS phone, never the owner''s personal phone');
select is((select whatsapp from public.business_contact((select v::uuid from _ids where k = 'orgB'), (select v::uuid from _ids where k = 'orgA'))), null,
  'PRIV-20: a channel the business did not share stays hidden');
select is((select email from public.business_contact((select v::uuid from _ids where k = 'orgB'), (select v::uuid from _ids where k = 'orgA'))), null,
  'PRIV-21: and so does the e-mail');

-- Notifications and chat identity ----------------------------------------------------------------------------
select is((select count(*)::int from public.notifications where recipient_user_id = '83000001-0000-4000-8000-000000000083'), 0,
  'PRIV-22: notifications are readable only by their recipient');
set local request.jwt.claims = :'u1';
select is((select count(*)::int from public.notifications where recipient_user_id = '83000001-0000-4000-8000-000000000083'), 1, 'PRIV-23: the recipient sees their own');
reset role;
select is((select count(*)::int from public.notifications n, jsonb_object_keys(n.params) k where k ~* '(phone|email|whatsapp|username|user)'), 0,
  'PRIV-24: no notification parameter carries personal contact data');

select * from finish();
rollback;

-- pgTAP: the showroom publish guard (20261126090001), with the trigger ENABLED.
--   An independent publisher's product (no organization) publishes; an organization's product still needs a ready showroom.
create extension if not exists pgtap;

begin;
select plan(6);

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('40000001-0000-4000-8000-000000000400', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p400@example.test', '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"P400","locale":"en"}'::jsonb, now(), now(), now());
update public.users set primary_account_type = 'contractor', status = 'active' where id = '40000001-0000-4000-8000-000000000400';
insert into public.verifications (id, subject_type, user_id, verification_type, requested_account_type, status, reviewer_id, decided_at, applied_at)
values ('40000002-0000-4000-8000-000000000400', 'user', '40000001-0000-4000-8000-000000000400', 'independent_publisher', 'contractor',
        'approved', '55555555-5555-4555-8555-555555555555', now(), now());
insert into public.publishers (id, kind, user_id, display_name, status, approval_id, approved_by, approved_at)
values ('40000003-0000-4000-8000-000000000400', 'independent_contractor', '40000001-0000-4000-8000-000000000400', 'P400', 'active',
        '40000002-0000-4000-8000-000000000400', '55555555-5555-4555-8555-555555555555', now());

select ok((select tgenabled = 'O' from pg_trigger where tgname = 'showroom_product_publish_complete' and tgrelid = 'public.products'::regclass),
  'G1. the guard trigger is enabled');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"40000001-0000-4000-8000-000000000400","role":"authenticated"}', true);
select set_config('t.product', public.publisher_product_create('40000003-0000-4000-8000-000000000400', 'Independent tile', 'IND-400', 'wallpaper', 'roll')::text, true);
reset role;
insert into public.product_audiences (product_id, audience) values (current_setting('t.product')::uuid, 'showroom_dealer') on conflict do nothing;
select is((select organization_id from public.products where id = current_setting('t.product')::uuid), null::uuid, 'G2. the product has no organization');

set local role authenticated;
select lives_ok(format($q$select public.set_product_published(%L, true, (select version from public.products where id = %L))$q$,
  current_setting('t.product'), current_setting('t.product')), 'G3. the independent publisher publishes it');
reset role;
select is((select status::text from public.products where id = current_setting('t.product')::uuid), 'published', 'G4. it is published');

-- an organization's showroom that is not ready is still refused by the trigger itself
insert into public.organizations (id, name, org_type, status, created_by)
values ('40000004-0000-4000-8000-000000000400', 'Not ready 400', 'showroom_dealer', 'pending_verification', '40000001-0000-4000-8000-000000000400');
select is(app.showroom_seller_ready('40000004-0000-4000-8000-000000000400'), false, 'G5. the fixture showroom is not ready');
select throws_ok(
  $q$insert into public.products (organization_id, name, category, unit, status, created_by)
     values ('40000004-0000-4000-8000-000000000400', 'Blocked 400', 'finishing', 'square_meter', 'published', '40000001-0000-4000-8000-000000000400')$q$,
  '42501', 'showroom must be active, approved and complete before product publishing', 'G6. its product cannot be published');

select * from finish();
rollback;

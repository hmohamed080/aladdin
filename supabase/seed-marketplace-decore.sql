-- Marketplace local fixture: the Decore Store showroom as an approved seller (LOCAL, SYNTHETIC, MANUAL).
--
-- NOT listed in config.toml [db.seed].sql_paths on purpose: apply by hand to an
-- ISOLATED local stack only (never a shared stack, never acceptance/production):
--   psql "$ISOLATED_DB_URL" -f supabase/seed-marketplace-decore.sql
--
-- Creates decore@example.test (password = the documented E2E password, see
-- frontend/e2e/helpers/auth.ts), owner of the showroom_dealer "Decore Store",
-- approved as a Marketplace seller by the seeded admin@example.test, with test
-- delivery prices (Cairo 80 / Nasr City 60 / Giza 120; Alexandria not covered)
-- and pickup on. Products come from the real spreadsheet through the seller's
-- own import page (/b2c/seller/imports), not from this file. admin@example.test
-- also gets the same password so the admin Marketplace pages can be opened.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        email_change_token_current, reauthentication_token, phone_change, phone_change_token)
values
  ('7e000001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'decore@example.test', extensions.crypt('Zq9$Kx4#WmT7!Pn2Rb', extensions.gen_salt('bf')),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Decore Store","locale":"ar"}'::jsonb, now(), now(), now(), '', '', '', '', '', '', '', '');

update public.users set primary_account_type = null, status = 'active'
  where id = '7e000001-0000-4000-8000-000000000001';
update public.profiles set display_name_ar = 'ديكور ستور', display_name_en = 'Decore Store'
  where user_id = '7e000001-0000-4000-8000-000000000001';

insert into public.contacts (user_id, channel, value, is_primary, is_verified, verified_at) values
  ('7e000001-0000-4000-8000-000000000001', 'email', 'decore@example.test', true, true, now());

insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by, name_ar, name_en) values
  ('7e100001-0000-4000-8000-000000000001', 'Decore Store', 'decore-store', 'showroom_dealer', 'active', true, 'ar',
   '7e000001-0000-4000-8000-000000000001', 'ديكور ستور', 'Decore Store');

insert into public.branches (id, organization_id, name, is_active, name_ar, name_en, address_ar, address_en) values
  ('7e200001-0000-4000-8000-000000000001', '7e100001-0000-4000-8000-000000000001', 'Decore Store Main', true,
   'الفرع الرئيسي', 'Main branch', 'مدينة نصر، القاهرة', 'Nasr City, Cairo');

insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at) values
  ('7e300001-0000-4000-8000-000000000001', '7e000001-0000-4000-8000-000000000001', '7e100001-0000-4000-8000-000000000001', null, 'active', now());

insert into public.membership_capabilities (membership_id, capability_key)
select '7e300001-0000-4000-8000-000000000001'::uuid, cap
from unnest(array[
  'org.manage','org.members.manage','branch.manage',
  'catalog.read','catalog.write','catalog.publish',
  'rfq.create','rfq.respond','quote.submit','quote.decide',
  'order.create','order.manage','project.read','project.write',
  'sales.read','sales.write','sales.assign','sales.manage',
  'verification.submit','verification.read','activity.read'
]) as cap;

update auth.users
   set encrypted_password = extensions.crypt('Zq9$Kx4#WmT7!Pn2Rb', extensions.gen_salt('bf'))
 where email = 'admin@example.test';

set local role authenticated;
-- The platform admin decision, through the same RPC the admin console uses.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_approve('7e100001-0000-4000-8000-000000000001', 'Local fixture: first Marketplace seller');
set local request.jwt.claims = '{"sub":"7e000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar');
-- Delivery places and test prices through the seller's own RPCs (same path as /b2c/seller/areas and /delivery).
select public.marketplace_seller_delivery_areas_save('7e100001-0000-4000-8000-000000000001',
  '[{"governorate_key":"cairo"},{"governorate_key":"cairo","area_key":"nasr-city"},{"governorate_key":"giza"}]'::jsonb);
select public.marketplace_seller_delivery_prices_save('7e100001-0000-4000-8000-000000000001',
  '[{"governorate_key":"cairo","fee_egp":80},{"governorate_key":"cairo","area_key":"nasr-city","fee_egp":60},{"governorate_key":"giza","fee_egp":120}]'::jsonb);
select public.marketplace_seller_pickup_set('7e100001-0000-4000-8000-000000000001', true);

commit;

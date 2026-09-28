-- pgTAP: app.mask_email never renders the internal login alias of
-- Installer/Technician phone authentication (20260927090001), and is otherwise
-- unchanged.
create extension if not exists pgtap;

begin;
select plan(13);

select is(app.mask_email('p201012345678@craftsman-login.aladdin.invalid'), '•••',
  'the internal installer phone login alias masks to the no-email placeholder');
select is(app.mask_email('P201012345678@CRAFTSMAN-LOGIN.ALADDIN.INVALID'), '•••',
  'alias detection is case-insensitive');
select is(app.mask_email('ahmed@example.com'), 'a•••@•••.com', 'a real email masks exactly as before');
select is(app.mask_email(null), '•••', 'NULL still masks to the placeholder');
select is(app.mask_email('not-an-email'), '•••', 'non-email input still masks to the placeholder');

-- Every database caller keeps its response shape: the same masked text column,
-- still produced by app.mask_email (the migration only changes the value
-- returned for alias rows, never a signature).
select matches(pg_get_function_result('public.org_members_list(uuid)'::regprocedure), 'email_masked text',
  'org_members_list still returns email_masked text');
select matches(pg_get_function_result('public.org_join_requests_list(uuid)'::regprocedure), 'email_masked text',
  'org_join_requests_list still returns email_masked text');
select matches(pg_get_function_result('public.admin_showroom_referrals_list(boolean)'::regprocedure), 'referrer_email text',
  'admin_showroom_referrals_list still returns referrer_email text');
select matches(pg_get_function_result('public.invitation_lookup(text)'::regprocedure), 'contact_masked text',
  'invitation_lookup still returns contact_masked text');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('org_members_list', 'org_join_requests_list', 'admin_showroom_referrals_list', 'invitation_lookup')
      and p.prosrc like '%app.mask_email(%'),
  4, 'all four callers still mask through app.mask_email');

-- End to end through a real caller: a phone-login member of a seeded showroom
-- is listed as '•••' to the org manager, while email members keep the existing
-- masked format.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('6400aaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p201099988877@craftsman-login.aladdin.invalid', now(), '{"full_name":"Installer Probe"}', now(), now());
insert into public.memberships (user_id, organization_id, primary_branch_id, status, accepted_at)
values ('6400aaaa-0000-4000-8000-000000000001', '9c000000-cccc-4ccc-8ccc-000000000001',
        'b0000001-0000-4000-8000-000000000001', 'active', now());
update auth.users set email_confirmed_at = now() where id = '70000001-0000-4000-8000-000000000001';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select email_masked from public.org_members_list('9c000000-cccc-4ccc-8ccc-000000000001')
    where user_id = '6400aaaa-0000-4000-8000-000000000001'),
  '•••', 'org_members_list shows a phone-login member as the no-email placeholder');
select is(
  (select email_masked from public.org_members_list('9c000000-cccc-4ccc-8ccc-000000000001')
    where user_id = '70000001-0000-4000-8000-000000000001'),
  'h•••@•••.test', 'org_members_list still masks an email member in the existing format');
select unalike(
  (select string_agg(email_masked, ' ') from public.org_members_list('9c000000-cccc-4ccc-8ccc-000000000001')),
  '%craftsman-login%', 'no row of the caller''s response carries the alias domain');
reset role;

select * from finish();
rollback;

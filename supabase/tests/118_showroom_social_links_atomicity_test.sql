-- Showroom social links (docs/frontend/showroom-social-links-onboarding.md): behaviours pinned by the independent
-- PR #139 verification that 116/117 do not cover.
--   1. business_draft_submit_v3 is one statement: a failure AFTER the organization insert (an invalid showroom
--      activity, raised by business_draft_submit_v2) leaves no organization and no membership, and the draft stays
--      open with its links, so a retry after the fix succeeds and copies them.
--   2. Mixed clients: links saved through _v3 survive a later _v2 save (it does not touch them), but a _v2 SUBMIT
--      creates the showroom without links, and a later _v3 retry returns that organization without copying them
--      (the profile checklist then asks for a link).
create extension if not exists pgtap;
begin;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('118' || lpad(n::text, 5, '0') || '-0000-4000-8000-000000000118')::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'links118-' || n || '@example.test',now(),'{}','{}',now(),now()
from generate_series(1, 2) n;
insert into public.onboarding_progress(user_id,selected_track,selected_org_type,account_type_completed_at,completed_at) values
  ('11800001-0000-4000-8000-000000000118','business','showroom_dealer',now(),now()),
  ('11800002-0000-4000-8000-000000000118','business','showroom_dealer',now(),now());

create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated;

-- 1. Failure after the organization insert rolls everything back -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11800001-0000-4000-8000-000000000118","role":"authenticated"}',true);
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Atomic 118',p_legal_name=>'Atomic 118 LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201011800001',p_activity_type=>'decor_showroom',p_website_url=>'https://atomic118.example.com')$q$,'setup: showroom draft with a link');
reset role;
update public.business_creation_drafts set activity_type = 'not_a_real_activity' where user_id = '11800001-0000-4000-8000-000000000118';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11800001-0000-4000-8000-000000000118","role":"authenticated"}',true);
select throws_ok($q$select public.business_draft_submit_v3()$q$,'22023','invalid showroom activity','submit_v3 fails after the organization insert');
reset role;
select is((select count(*)::int from public.organizations where created_by='11800001-0000-4000-8000-000000000118'),0,'the failed submit leaves no organization');
select is((select count(*)::int from public.memberships where user_id='11800001-0000-4000-8000-000000000118'),0,'the failed submit leaves no membership');
select is((select row(completed_at is null, organization_id is null, website_url)::text from public.business_creation_drafts where user_id='11800001-0000-4000-8000-000000000118'),
  row(true, true, 'https://atomic118.example.com')::text,'the draft stays open with its link');
update public.business_creation_drafts set activity_type = 'decor_showroom' where user_id = '11800001-0000-4000-8000-000000000118';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11800001-0000-4000-8000-000000000118","role":"authenticated"}',true);
insert into _ids select 'o1', public.business_draft_submit_v3()::text;
reset role;
select is((select website_url from public.organizations where id=(select v::uuid from _ids where k='o1')),'https://atomic118.example.com','the retry creates the showroom with the saved link');

-- 2. _v3 save, _v2 save, _v2 submit, _v3 retry ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11800002-0000-4000-8000-000000000118","role":"authenticated"}',true);
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Mixed 118',p_legal_name=>'Mixed 118 LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201011800002',p_activity_type=>'decor_showroom',p_tiktok_url=>'https://www.tiktok.com/@mixed118')$q$,'_v3 save with a link');
select lives_ok($q$select public.business_draft_save_v2(p_display_name=>'Mixed 118',p_legal_name=>'Mixed 118 LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201011800002',p_activity_type=>'decor_showroom')$q$,'a later _v2 save');
reset role;
select is((select tiktok_url from public.business_creation_drafts where user_id='11800002-0000-4000-8000-000000000118'),'https://www.tiktok.com/@mixed118','a _v2 save keeps the links saved through _v3');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11800002-0000-4000-8000-000000000118","role":"authenticated"}',true);
insert into _ids select 'o2', public.business_draft_submit_v2()::text;
select is(public.business_draft_submit_v3()::text,(select v from _ids where k='o2'),'a _v3 retry returns the organization created by _v2');
reset role;
select is((select num_nonnulls(facebook_url,instagram_url,tiktok_url,website_url) from public.organizations where id=(select v::uuid from _ids where k='o2')),0,
  'a _v2 submit creates the showroom without links and the _v3 retry does not copy them');
select ok(app.profile_completion('11800002-0000-4000-8000-000000000118')->'missing' ? 'organization_links','that owner is asked to add a link');

select * from finish();
rollback;

-- Showroom social links (docs/frontend/showroom-social-links-onboarding.md):
-- app.social_link_valid, the four link columns and the _v3 save/submit RPCs.
create extension if not exists pgtap;
begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- 1. app.social_link_valid: canonical forms accepted, Review Focus 1/2 rejected
-- ---------------------------------------------------------------------------
select ok(app.social_link_valid('facebook', null), 'null link is valid');
select ok(app.social_link_valid('facebook', 'https://www.facebook.com/aladdinshowroom'), 'canonical facebook page');
select ok(app.social_link_valid('facebook', 'https://www.facebook.com/profile.php'), 'canonical facebook single segment with dot');
select ok(app.social_link_valid('facebook', 'https://www.facebook.com/pages/Aladdin-Shop/12345'), 'canonical facebook multi-segment path');
select ok(app.social_link_valid('facebook', 'https://www.facebook.com/p/%D8%B9%D9%84%D9%89-1'), 'canonical facebook path with valid percent escapes');
select ok(app.social_link_valid('facebook', 'https://fb.com/aladdinshowroom'), 'facebook alias fb.com');
select ok(app.social_link_valid('facebook', 'https://www.fb.me/aladdinshowroom'), 'facebook alias www.fb.me');
select ok(app.social_link_valid('instagram', 'https://www.instagram.com/aladdin.shop_eg'), 'canonical instagram');
select ok(app.social_link_valid('instagram', 'https://instagram.com/a'), 'instagram one-character handle without www');
select ok(app.social_link_valid('tiktok', 'https://www.tiktok.com/@aladdin.shop'), 'canonical tiktok');
select ok(app.social_link_valid('tiktok', 'https://tiktok.com/@ab'), 'tiktok without www');
select ok(app.social_link_valid('website', 'https://aladdin-showroom.com.eg'), 'canonical website without path');
select ok(app.social_link_valid('website', 'https://www.example.com/en/showroom/%20x'), 'canonical website with path');
select ok(app.social_link_valid('website', 'https://shop.example.co/a/b-c_d.html'), 'canonical website with file path');
select ok(app.social_link_valid('website', 'https://www.facebook.com/aladdinshowroom'), 'a social page is also a valid website');
select ok(app.social_link_valid('website', 'https://' || repeat('a', 63) || '.com/' || repeat('b', 300 - 8 - 63 - 5)), '300-character link accepted');

-- Review Focus 1: look-alike and smuggled hosts.
select ok(not app.social_link_valid('facebook', 'https://facebook.com@evil.io/x'), 'userinfo smuggling rejected');
select ok(not app.social_link_valid('website', 'https://facebook.com@evil.io/x'), 'userinfo smuggling rejected for website');
select ok(not app.social_link_valid('facebook', 'https://evilfacebook.com/x'), 'suffix look-alike host rejected');
select ok(not app.social_link_valid('facebook', 'https://facebook.com.evil.io/x'), 'prefix look-alike host rejected');
select ok(not app.social_link_valid('facebook', U&'https://f\0430cebook.com/aladdinshowroom'), 'Cyrillic look-alike host rejected');
select ok(not app.social_link_valid('website', U&'https://f\0430cebook.com'), 'non-ASCII website host rejected');
select ok(not app.social_link_valid('website', 'https://xn--fcebook-2fg.com'), 'punycode website label rejected');
select ok(not app.social_link_valid('website', 'https://shop.xn--wgbh1c'), 'punycode TLD rejected');
select ok(not app.social_link_valid('instagram', 'https://www.tiktok.com/@aladdin'), 'wrong platform host rejected');
select ok(not app.social_link_valid('tiktok', 'https://www.tiktok.com/aladdin'), 'tiktok without @ rejected');
select ok(not app.social_link_valid('instagram', 'https://www.instagram.com/a/b'), 'instagram extra path rejected');
select ok(not app.social_link_valid('instagram', 'https://www.instagram.com/___'), 'handle without a letter or digit rejected');
select ok(not app.social_link_valid('facebook', 'https://www.facebook.com/abc'), 'facebook single segment shorter than 5 rejected');
select ok(not app.social_link_valid('facebook', 'https://www.facebook.com/'), 'facebook without a path rejected');
select ok(not app.social_link_valid('unknown', 'https://www.facebook.com/aladdinshowroom'), 'unknown platform rejected');

-- Review Focus 2: dangerous or malformed input.
select ok(not app.social_link_valid('website', 'javascript:alert(1)'), 'javascript scheme rejected');
select ok(not app.social_link_valid('website', 'data:text/html,x'), 'data scheme rejected');
select ok(not app.social_link_valid('website', 'file:///etc/passwd'), 'file scheme rejected');
select ok(not app.social_link_valid('website', 'http://example.com'), 'plain http rejected');
select ok(not app.social_link_valid('website', 'https://127.0.0.1'), 'IPv4 host rejected');
select ok(not app.social_link_valid('website', 'https://localhost'), 'localhost rejected');
select ok(not app.social_link_valid('website', 'https://printer.local'), '.local rejected');
select ok(not app.social_link_valid('website', 'https://db.internal'), '.internal rejected');
select ok(not app.social_link_valid('website', 'https://app.localhost'), '.localhost rejected');
select ok(not app.social_link_valid('website', 'https://box.localdomain'), '.localdomain rejected');
select ok(not app.social_link_valid('website', 'https://[::1]'), 'IPv6 literal rejected');
select ok(not app.social_link_valid('facebook', 'https://facebook.com:8080/aladdinshowroom'), 'port rejected');
select ok(not app.social_link_valid('website', 'https://example.com:443'), 'website port rejected');
select ok(not app.social_link_valid('website', 'https://' || repeat('a', 63) || '.com/' || repeat('b', 301 - 8 - 63 - 5)), '301-character link rejected');
select ok(not app.social_link_valid('website', E'https://example.com/a\nb'), 'embedded newline rejected');
select ok(not app.social_link_valid('website', E'https://example.com/a\tb'), 'embedded tab rejected');
select ok(not app.social_link_valid('website', 'https://example.com/a b'), 'embedded space rejected');
select ok(not app.social_link_valid('website', 'https://example.com/?utm_source=x'), 'query rejected');
select ok(not app.social_link_valid('website', 'https://example.com/#top'), 'fragment rejected');
select ok(not app.social_link_valid('website', 'https://example.com/%zz'), 'invalid percent escape rejected');
select ok(not app.social_link_valid('website', 'https://example.com/a\b'), 'backslash rejected');
select ok(not app.social_link_valid('website', 'https://example.com/<script>'), 'angle brackets rejected');
select ok(not app.social_link_valid('website', 'https://example'), 'single-label host rejected');
select ok(not app.social_link_valid('website', 'https://-bad.example.com'), 'label starting with hyphen rejected');
select ok(not app.social_link_valid('website', 'HTTPS://EXAMPLE.COM'), 'non-canonical uppercase rejected');
select ok(not app.social_link_valid('website', ''), 'empty string rejected');

-- Both tables refuse a non-canonical link even from a privileged writer.
select throws_ok($q$update public.organizations set website_url='javascript:alert(1)' where true$q$, '23514', null, 'organizations CHECK rejects a bad link');

-- ---------------------------------------------------------------------------
-- 2. Users
-- ---------------------------------------------------------------------------
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('11600001-0000-4000-8000-000000000116','00000000-0000-0000-0000-000000000000','authenticated','authenticated','links116-1@example.test',now(),'{}','{}',now(),now());
insert into public.onboarding_progress(user_id,selected_track,selected_org_type,account_type_completed_at,completed_at) values('11600001-0000-4000-8000-000000000116','business','showroom_dealer',now(),now());
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('11600002-0000-4000-8000-000000000116','00000000-0000-0000-0000-000000000000','authenticated','authenticated','links116-2@example.test',now(),'{}','{}',now(),now());
insert into public.onboarding_progress(user_id,selected_track,selected_org_type,account_type_completed_at,completed_at) values('11600002-0000-4000-8000-000000000116','business','showroom_dealer',now(),now());
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('11600003-0000-4000-8000-000000000116','00000000-0000-0000-0000-000000000000','authenticated','authenticated','links116-3@example.test',now(),'{}','{}',now(),now());
insert into public.onboarding_progress(user_id,selected_track,selected_org_type,account_type_completed_at,completed_at) values('11600003-0000-4000-8000-000000000116','business','supplier',now(),now());

-- ---------------------------------------------------------------------------
-- 3. Showroom through _v3: save replaces links, submit requires one, idempotent
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','11600001-0000-4000-8000-000000000116',true);
select set_config('request.jwt.claims','{"sub":"11600001-0000-4000-8000-000000000116","role":"authenticated"}',true);
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Links Showroom',p_legal_name=>'Links Legal',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345678',p_activity_type=>'decor_showroom',p_facebook_url=>'https://www.facebook.com/aladdinshowroom',p_instagram_url=>'https://www.instagram.com/aladdin.shop',p_tiktok_url=>'https://www.tiktok.com/@aladdin.shop',p_website_url=>'https://aladdin.example.com/showroom')$q$,'save_v3 stores the showroom and its links');
select is((select row(facebook_url,instagram_url,tiktok_url,website_url)::text from public.business_creation_drafts where user_id='11600001-0000-4000-8000-000000000116'),
  row('https://www.facebook.com/aladdinshowroom','https://www.instagram.com/aladdin.shop','https://www.tiktok.com/@aladdin.shop','https://aladdin.example.com/showroom')::text,'all four links stored on the draft');
select is((select display_name from public.business_creation_drafts where user_id='11600001-0000-4000-8000-000000000116'),'Links Showroom','_v2 fields stored through save_v3');
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Links Showroom',p_legal_name=>'Links Legal',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345678',p_activity_type=>'decor_showroom')$q$,'second save_v3 without links');
select is((select row(facebook_url,instagram_url,tiktok_url,website_url)::text from public.business_creation_drafts where user_id='11600001-0000-4000-8000-000000000116'),
  row(null::text,null::text,null::text,null::text)::text,'second save with nulls clears every link');
select throws_ok($q$select public.business_draft_save_v3(p_display_name=>'Links Showroom',p_legal_name=>'Links Legal',p_org_type=>'showroom_dealer',p_facebook_url=>'https://facebook.com@evil.io/x')$q$,'22023',null,'save_v3 rejects a smuggled host');
select throws_like($q$select public.business_draft_save_v3(p_display_name=>'Links Showroom',p_legal_name=>'Links Legal',p_org_type=>'showroom_dealer',p_website_url=>'http://127.0.0.1')$q$,'%social link%','invalid link message names the social link');
select throws_ok($q$select public.business_draft_save_v3(p_display_name=>'Links Showroom',p_legal_name=>'Links Legal',p_org_type=>'showroom_dealer',p_instagram_url=>'https://www.facebook.com/aladdinshowroom')$q$,'22023',null,'save_v3 rejects a link in the wrong platform column');
select throws_ok($q$select public.business_draft_submit_v3()$q$,'22023','at least one showroom link is required','submit_v3 requires a link for a showroom');
reset role;
select is((select count(*)::int from public.memberships where user_id='11600001-0000-4000-8000-000000000116'),0,'no organization created without a link');
select is((select count(*)::int from public.business_creation_drafts where user_id='11600001-0000-4000-8000-000000000116' and organization_id is not null),0,'draft stays open without a link');
set local role authenticated;
select set_config('request.jwt.claim.sub','11600001-0000-4000-8000-000000000116',true);
select set_config('request.jwt.claims','{"sub":"11600001-0000-4000-8000-000000000116","role":"authenticated"}',true);
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Links Showroom',p_legal_name=>'Links Legal',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345678',p_activity_type=>'decor_showroom',p_instagram_url=>'https://www.instagram.com/aladdin.shop')$q$,'save_v3 with one link');
select lives_ok($q$select set_config('test.org1', public.business_draft_submit_v3()::text, true)$q$,'submit_v3 with one link creates the showroom');
select is(public.business_draft_submit_v3()::text, current_setting('test.org1'),'second submit_v3 returns the same organization');
select is(public.business_draft_submit_v3((select id from public.business_creation_drafts where user_id='11600001-0000-4000-8000-000000000116'))::text, current_setting('test.org1'),'submit_v3 by draft id returns the same organization');
reset role;
select is((select count(*)::int from public.memberships where user_id='11600001-0000-4000-8000-000000000116'),1,'exactly one organization');
select is((select row(facebook_url,instagram_url,tiktok_url,website_url)::text from public.organizations where id=current_setting('test.org1')::uuid),
  row(null::text,'https://www.instagram.com/aladdin.shop',null::text,null::text)::text,'organization carries exactly the saved link');
select is((select org_type::text from public.organizations where id=current_setting('test.org1')::uuid),'showroom_dealer','organization is a showroom');
-- Later edits (Settings) must survive a retried submit.
update public.organizations set instagram_url=null, website_url='https://edited.example.com' where id=current_setting('test.org1')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','11600001-0000-4000-8000-000000000116',true);
select set_config('request.jwt.claims','{"sub":"11600001-0000-4000-8000-000000000116","role":"authenticated"}',true);
select is(public.business_draft_submit_v3()::text, current_setting('test.org1'),'retried submit_v3 after an edit returns the same organization');
-- The CHECK constraints must not break an existing client write path on the same row.
select lives_ok($q$update public.organizations set name='Links Showroom Renamed' where id=current_setting('test.org1')::uuid$q$,'owner can still update an organization column it was granted');
select throws_ok($q$update public.organizations set website_url='https://evil.example.com' where id=current_setting('test.org1')::uuid$q$,'42501',null,'owner cannot write links directly');
reset role;
select is((select name from public.organizations where id=current_setting('test.org1')::uuid),'Links Showroom Renamed','owner rename applied');
select is((select row(facebook_url,instagram_url,tiktok_url,website_url)::text from public.organizations where id=current_setting('test.org1')::uuid),
  row(null::text,null::text,null::text,'https://edited.example.com')::text,'retried submit_v3 leaves edited links untouched');
select throws_ok($q$update public.business_creation_drafts set tiktok_url='https://www.tiktok.com/aladdin' where user_id='11600001-0000-4000-8000-000000000116'$q$,'23514',null,'business_creation_drafts CHECK rejects a bad link');

-- ---------------------------------------------------------------------------
-- 4. Old client: _v2 save + submit without links still creates a showroom
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','11600002-0000-4000-8000-000000000116',true);
select set_config('request.jwt.claims','{"sub":"11600002-0000-4000-8000-000000000116","role":"authenticated"}',true);
select lives_ok($q$select public.business_draft_save_v2(p_display_name=>'Old Client Showroom',p_legal_name=>'Old Client Legal',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345678',p_activity_type=>'decor_showroom')$q$,'_v2 save still works');
select lives_ok($q$select public.business_draft_submit_v2()$q$,'_v2 submit without links still creates a showroom');
reset role;
select is((select count(*)::int from public.organizations o join public.business_creation_drafts d on d.organization_id=o.id where d.user_id='11600002-0000-4000-8000-000000000116' and o.org_type='showroom_dealer' and o.facebook_url is null and o.instagram_url is null and o.tiktok_url is null and o.website_url is null),1,'compat showroom has no links');

-- ---------------------------------------------------------------------------
-- 5. Non-showroom drafts need no link through _v3
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','11600003-0000-4000-8000-000000000116',true);
select set_config('request.jwt.claims','{"sub":"11600003-0000-4000-8000-000000000116","role":"authenticated"}',true);
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Links Supplier',p_legal_name=>'Links Supplier Legal',p_org_type=>'supplier',p_governorate=>'cairo',p_city=>'maadi')$q$,'supplier save_v3 without links');
select lives_ok($q$select public.business_draft_submit_v3()$q$,'supplier submit_v3 without links');
reset role;
select is((select count(*)::int from public.organizations o join public.business_creation_drafts d on d.organization_id=o.id where d.user_id='11600003-0000-4000-8000-000000000116' and o.org_type='supplier'),1,'supplier organization created');

-- ---------------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon','public.business_draft_save_v3(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text,text,text,text,text)','execute'),'anon cannot execute save_v3');
select ok(not has_function_privilege('anon','public.business_draft_submit_v3(uuid)','execute'),'anon cannot execute submit_v3');
select ok(has_function_privilege('authenticated','public.business_draft_save_v3(uuid,text,text,public.organization_type,text,text,text,text,text,text,text,text,text,text,text,text,text)','execute'),'authenticated can execute save_v3');
select ok(has_function_privilege('authenticated','public.business_draft_submit_v3(uuid)','execute'),'authenticated can execute submit_v3');
select ok(not has_function_privilege('anon','app.social_link_valid(text,text)','execute'),'anon cannot execute social_link_valid');
-- authenticated needs EXECUTE because CHECK constraints run with the writer's privileges.
select ok(has_function_privilege('authenticated','app.social_link_valid(text,text)','execute'),'authenticated can evaluate the link CHECK constraints');
select ok(not has_function_privilege('service_role','app.social_link_valid(text,text)','execute'),'service_role has no execute on social_link_valid');
set local role anon;
select throws_ok($q$select public.business_draft_submit_v3()$q$,'42501',null,'anon call to submit_v3 is denied');
reset role;
-- New columns never reach anon and add no client write path.
select ok(not exists(select 1 from information_schema.column_privileges where grantee in ('anon','authenticated') and table_schema='public' and table_name in ('organizations','business_creation_drafts') and column_name in ('facebook_url','instagram_url','tiktok_url','website_url') and privilege_type<>'SELECT'),'no client write grant on link columns');
select ok(not has_column_privilege('anon','public.organizations','website_url','select'),'anon cannot read organization links');
select ok(not has_column_privilege('anon','public.business_creation_drafts','website_url','select'),'anon cannot read draft links');

select * from finish();
rollback;

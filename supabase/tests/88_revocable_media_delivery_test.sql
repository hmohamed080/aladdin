-- Local disposable fixtures; every modification rolls back.
create extension if not exists pgtap;
begin;
select no_plan();
select is((select permissive from pg_policies where policyname='revocable_media_backend_reads' and schemaname='storage'), 'RESTRICTIVE', 'Backend read boundary is restrictive, never an OR grant');
insert into public.portfolio_items(id,owner_user_id,object_key,content_type,state,title)
values('aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa','70000009-0000-4000-8000-000000000009','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','image/png','ready','Revocation test');
insert into public.professional_certificates(owner_user_id,object_path,content_type,state,title)
values('70000009-0000-4000-8000-000000000009','70000009-0000-4000-8000-000000000009/aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.pdf','application/pdf','ready','Revocation certificate');
insert into public.avatar_uploads(owner_user_id,object_key,content_type,state)
values('70000009-0000-4000-8000-000000000009','aaaaaaaa-1313-4131-8131-aaaaaaaaaaab.jpg','image/jpeg','ready');
insert into storage.objects(bucket_id,name) values
('professional-portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png'),
('professional-certificates','70000009-0000-4000-8000-000000000009/aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.pdf'),
('avatars','aaaaaaaa-1313-4131-8131-aaaaaaaaaaab.jpg');
select ok(exists(select 1 from public.memberships a join public.memberships b using(organization_id)
  where a.user_id='70000009-0000-4000-8000-000000000009' and b.user_id='70000006-0000-4000-8000-000000000006'
  and a.status='active' and b.status='active'),'Same-tenant denial fixture really shares an active organization');
select ok(exists(select 1 from public.memberships where user_id='70000003-0000-4000-8000-000000000003' and status='active')
  and not exists(select 1 from public.memberships a join public.memberships b using(organization_id)
  where a.user_id='70000009-0000-4000-8000-000000000009' and b.user_id='70000003-0000-4000-8000-000000000003'),
  'Cross-tenant denial fixture has an active membership in a different organization');
-- A future permissive policy cannot accidentally reopen these buckets.
create policy local_test_permissive_read on storage.objects for select to anon,authenticated using(true);
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is((select count(*)::int from storage.objects),0,'Owner cannot directly read/list/sign private objects even with an additional permissive grant');
select is(public.media_storage_resolve('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','read')->>'provider','supabase','Legacy fallback is metadata based and owner-authorized');
select is(public.media_storage_resolve('certificate','70000009-0000-4000-8000-000000000009/aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.pdf','read')->>'state','ready','Owner certificate application access survives Storage restriction');
select is(public.media_storage_resolve('avatar','aaaaaaaa-1313-4131-8131-aaaaaaaaaaab.jpg','read')->>'state','ready','Owner avatar application access survives Storage restriction');
set local request.jwt.claims='{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(public.media_storage_resolve('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','read'),null::jsonb,'Same-tenant colleague cannot read personal portfolio');
select is(public.media_storage_resolve('certificate','70000009-0000-4000-8000-000000000009/aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.pdf','read'),null::jsonb,'Same-tenant colleague cannot read personal certificate');
set local request.jwt.claims='{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select is(public.media_storage_resolve('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','read'),null::jsonb,'Other user/tenant cannot read private portfolio');
select is(public.media_storage_resolve('certificate','70000009-0000-4000-8000-000000000009/aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.pdf','read'),null::jsonb,'Other user/tenant cannot read certificate');
select is((select count(*)::int from storage.objects),0,'Foreign caller Storage access denied');
reset role;
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select is((select count(*)::int from storage.objects),0,'Anonymous direct Storage access denied');
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select is((select count(*)::int from storage.objects where name like '%1313%'),3,'Backend Storage access remains available');
select ok(has_function_privilege('service_role','public.media_storage_attest(text,text,uuid,text,bigint,text,text)','execute'),'Backend verification receipt permission unchanged');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok($$select public.portfolio_item_set_visibility('aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa',true)$$,'Owner can publish without direct Storage SELECT');
reset role;
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select is(public.public_portfolio_media_key('aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa'),'aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','Public application publication authority preserved');
select is((select count(*)::int from storage.objects),0,'Publishing does not reopen direct Storage signing');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok($$select public.portfolio_item_set_visibility('aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa',false)$$,'Owner can immediately withdraw publication');
select is(public.public_portfolio_media_key('aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa'),null::text,'Even owner public route authority denies after unpublish');
reset role;
insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type)
values('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','70000009-0000-4000-8000-000000000009','r2','image/png');
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is(public.media_storage_resolve('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','read')->>'provider','r2','Explicit R2 mapping is preserved independently of Storage client SELECT');
select lives_ok($$select public.portfolio_item_delete('aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa')$$,'Delete changes metadata before physical cleanup');
select is(public.media_storage_resolve('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','read'),null::jsonb,'Application read denied immediately while bytes remain');
select is(public.media_storage_resolve('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','delete')->>'state','deleted','Owner retains backend cleanup authorization');
select is(public.media_storage_resolve('portfolio','aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png','delete')->>'state','deleted','Interrupted cleanup retries retain exact delete authority without repeating mark-deleted');
reset role;
select is((select count(*)::int from storage.objects where name='aaaaaaaa-1313-4131-8131-aaaaaaaaaaaa.png'),1,'Physical bytes metadata still present; revocation did not depend on deletion');
select * from finish();
rollback;

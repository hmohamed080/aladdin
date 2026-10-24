-- Isolated synthetic fixtures. A fixture receipt represents the trusted verifier;
-- server tests independently prove that missing/spoofed bytes cannot earn that receipt.
create extension if not exists pgtap;
begin;
select plan(25);
select has_table('public','media_storage_locations','explicit media provider metadata exists');
select ok((select relrowsecurity from pg_class where oid='public.media_storage_locations'::regclass),'provider metadata has RLS');
select ok(not has_function_privilege('authenticated','public.media_storage_attest(text,text,uuid,text,bigint,text,text)','EXECUTE'),'clients cannot attest bytes');
select ok(not has_function_privilege('anon','public.media_storage_reserve(text,text,text,uuid)','EXECUTE'),'anonymous users cannot reserve uploads');
select ok(not has_column_privilege('authenticated','public.profiles','avatar_media_id','UPDATE'),'clients cannot point their profile at another owner avatar');

set local role authenticated;
set local request.jwt.claim.sub='70000009-0000-4000-8000-000000000009';
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select item_id as item,object_key as key from public.portfolio_item_create('verified upload test',null,'image/png') \gset
select throws_ok(format('select public.portfolio_item_finalize(%L)',:'item'),'42501','stored object has not been verified','original missing-object finalization is refused');
select lives_ok(format('select public.media_storage_reserve(%L,%L,%L)','portfolio',:'key','supabase'),'owner can reserve legacy provider');
select throws_ok(format('select public.media_storage_reserve(%L,%L,%L)','portfolio',:'key','r2'),'42501','R2 routing requires backend authorization','client cannot bypass disabled R2 routing');
select is(public.media_storage_resolve('portfolio',:'key','read')->>'provider','supabase','pending legacy mapping is explicit');

set local request.jwt.claim.sub='71000006-0000-4000-8000-000000000006';
set local request.jwt.claims='{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(public.media_storage_resolve('portfolio',:'key','upload'),null::jsonb,'cross-user upload authorization denied');
select is(public.media_storage_resolve('portfolio',:'key','delete'),null::jsonb,'cross-user deletion denied');
select is((select count(*)::int from public.media_storage_locations),0,'RLS hides other owner provider metadata');

reset role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok(format('select public.media_storage_attest(%L,%L,%L,%L,100,%L,%L)','portfolio',:'key','70000009-0000-4000-8000-000000000009','supabase','image/png',repeat('a',64)),'backend fixture attestation accepted');
set local role authenticated;
set local request.jwt.claim.sub='70000009-0000-4000-8000-000000000009';
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(format('select public.portfolio_item_finalize(%L)',:'item'),'verified owner finalization succeeds');
select lives_ok(format('select public.portfolio_item_finalize(%L)',:'item'),'finalization retry is idempotent');
select is(public.media_storage_resolve('portfolio',:'key','delete'),null::jsonb,'bytes cannot be deleted before metadata revocation');
select public.portfolio_item_set_visibility(:'item',true);
set local role anon;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{"role":"anon"}';
select is(public.media_storage_resolve('portfolio',:'key','read')->>'provider','supabase','published listed profile is readable');
select is(public.media_storage_resolve('portfolio',:'key','read')->>'owner',null::text,'public resolution does not expose auth user ID');
set local role authenticated;
set local request.jwt.claim.sub='70000009-0000-4000-8000-000000000009';
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select public.portfolio_item_set_visibility(:'item',false);
set local role anon;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{"role":"anon"}';
select is(public.media_storage_resolve('portfolio',:'key','read'),null::jsonb,'withdrawal immediately revokes public resolution');

set local role authenticated;
set local request.jwt.claim.sub='70000009-0000-4000-8000-000000000009';
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select public.avatar_request_upload('image/jpeg') as avatar_key \gset
select throws_ok(format('select public.avatar_confirm_upload(%L)',:'avatar_key'),'42501','stored object has not been verified','missing avatar cannot replace current avatar');
select public.media_storage_reserve('avatar',:'avatar_key','supabase');
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select public.media_storage_attest('avatar',:'avatar_key','70000009-0000-4000-8000-000000000009','supabase',100,'image/jpeg',repeat('b',64));
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(format('select public.avatar_confirm_upload(%L)',:'avatar_key'),'verified avatar replaces current avatar');
select lives_ok(format('select public.avatar_confirm_upload(%L)',:'avatar_key'),'avatar confirmation retry is idempotent');
select lives_ok('select public.avatar_delete_current()','owner can delete current avatar');
select is(public.media_storage_resolve('avatar',:'avatar_key','read'),null::jsonb,'deleted avatar is no longer readable');
select is(public.media_storage_resolve('avatar',:'avatar_key','delete')->>'provider','supabase','retired avatar remains authorized for cleanup');
select * from finish();
rollback;

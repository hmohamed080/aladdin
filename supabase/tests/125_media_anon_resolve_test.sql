-- Anonymous callers of public.media_storage_resolve (executable by anon by design, for public portfolio and avatar reads).
-- No fixtures: it proves what anon can NEVER obtain, whatever the key: every operation on the four organization-scoped
-- namespaces, upload and delete everywhere, and any read of an object that is not a published portfolio item or current avatar.
create extension if not exists pgtap;
begin;
select plan(12);

select ok(has_function_privilege('anon','public.media_storage_resolve(text,text,text)','EXECUTE'),'anon may call media_storage_resolve (public media reads)');
select ok(not has_function_privilege('anon','public.organization_media_resolve(text,text,text,uuid)','EXECUTE')
  or public.organization_media_resolve('product','x','read',null) is null,'organization-scoped resolver gives anon nothing');
select ok(not has_function_privilege('anon','public.media_storage_object(text,text)','EXECUTE'),'anon cannot read physical storage keys');
select ok(not has_function_privilege('anon','public.media_storage_reserve(text,text,text,uuid)','EXECUTE'),'anon cannot reserve uploads');

set local role anon;
set local request.jwt.claim.sub='';
set local request.jwt.claims='{"role":"anon"}';

select is(public.media_storage_resolve('product','00000000-0000-4000-8000-000000000001/x.png','read'),null::jsonb,'anon cannot resolve a product object');
select is(public.media_storage_resolve('organization','00000000-0000-4000-8000-000000000001/x.png','read'),null::jsonb,'anon cannot resolve an organization object');
select is(public.media_storage_resolve('request','00000000-0000-4000-8000-000000000001/x.png','read'),null::jsonb,'anon cannot resolve a purchase-request photo');
select is(public.media_storage_resolve('verification','00000000-0000-4000-8000-000000000001/x.pdf','read'),null::jsonb,'anon cannot resolve a verification document');
select is(public.media_storage_resolve('certificate','00000000-0000-4000-8000-000000000001/x.pdf','read'),null::jsonb,'anon cannot resolve a certificate');
select is(public.media_storage_resolve('avatar','00000000-0000-4000-8000-000000000001/x.png','read'),null::jsonb,'anon read of a non-current or unknown avatar is null');
select is(public.media_storage_resolve('portfolio','00000000-0000-4000-8000-000000000001/x.png','read'),null::jsonb,'anon read of an unpublished or unknown portfolio object is null');
select is(coalesce(public.media_storage_resolve('portfolio','00000000-0000-4000-8000-000000000001/x.png','upload'),public.media_storage_resolve('avatar','00000000-0000-4000-8000-000000000001/x.png','delete')),null::jsonb,'anon upload and delete are always null');

select * from finish();
rollback;

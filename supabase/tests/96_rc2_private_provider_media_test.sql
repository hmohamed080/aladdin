-- RC2 capabilities and lifecycle remain authoritative for both providers.
create extension if not exists pgtap;
begin;
\ir helpers/organization_media_receipt.inc
select no_plan();
update auth.users set email_confirmed_at=now() where email_confirmed_at is null;
update public.organizations set status='active',is_verified=true
 where id='9d000000-dddd-4ddd-8ddd-000000000002';
\set owner '70000001-0000-4000-8000-000000000001'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set hana '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set sara '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set tarek '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'
set local role authenticated;
set local request.jwt.claims=:'hana';
select public.own_product_create(:'org','Provider product','R2-96','paints','pail',p_base_price=>100) as product \gset
select public.product_image_request_upload(:'product','image/png') as key \gset
select public.organization_image_request_upload(:'org','image/png') as logo \gset
select ok(public.organization_media_resolve('product',:'key','upload') is not null,'current catalog writer can authorize pending product');
select is(public.organization_media_resolve('product',:'key','read'),null::jsonb,'pending product cannot be delivered');
select throws_ok(format('select public.product_image_confirm_upload(%L)',:'key'),'42501','stored object has not been verified','missing product bytes cannot become ready');
select throws_ok(format('select public.organization_image_confirm_upload(%L)',:'logo'),'42501','stored object has not been verified','missing logo bytes cannot become current');
select throws_ok(format('select public.media_storage_attest(%L,%L,%L,%L,100,%L,%L)','product',:'key',:'owner','r2','image/png',repeat('a',64)),
 '42501',null,'caller cannot invent a verification receipt');
set local request.jwt.claims=:'sara';
select is(public.organization_media_resolve('product',:'key','upload'),null::jsonb,'same-tenant member without catalog.write cannot upload');
select is(public.organization_media_resolve('organization',:'logo','upload'),null::jsonb,'plain member lacks org.manage');
set local request.jwt.claims=:'tarek';
select is(public.organization_media_resolve('product',:'key','upload'),null::jsonb,'foreign writer cannot upload');
select is(public.organization_media_resolve('organization',:'logo','read'),null::jsonb,'foreign tenant cannot read logo');
set local request.jwt.claims=:'hana';
select pg_temp.attest_organization_fixture('product',:'key');
select pg_temp.attest_organization_fixture('organization',:'logo');
select public.product_image_confirm_upload(:'key') as image \gset
select is(public.product_image_confirm_upload(:'key'),:'image'::uuid,'product confirmation retry is idempotent');
select lives_ok(format('select public.organization_image_confirm_upload(%L)',:'logo'),'verified logo becomes current');
select ok(public.organization_media_resolve('product',:'key','read') is not null,'owner reads draft product through application');
select ok(public.organization_media_resolve('organization',:'logo','read') is not null,'manager reads current logo');
select is(public.organization_media_read_keys('product',array[:'key']),array[:'key'],'batched resolver returns only authorized exact keys');
set local request.jwt.claims=:'sara';
select ok(public.organization_media_resolve('organization',:'logo','read') is not null,'current member can read logo');
set local request.jwt.claims=:'tarek';
select is(public.organization_media_resolve('product',:'key','read','9d000000-dddd-4ddd-8ddd-000000000002'),null::jsonb,'foreign workspace cannot read draft product');
set local request.jwt.claims=:'hana';
select public.product_audiences_set(:'product',array['manufacturer']);
select public.set_product_published(:'product',true,(select version from public.products where id=:'product'));
set local request.jwt.claims=:'tarek';
select ok(public.organization_media_resolve('product',:'key','read','9d000000-dddd-4ddd-8ddd-000000000002') is not null,'targeted active workspace reads published product');
select is(public.organization_media_resolve('product',:'key','read',null),null::jsonb,'personal context cannot borrow workspace audience');
select is(public.organization_media_resolve('product',:'key','read',:'org'),null::jsonb,'forged foreign workspace is rejected');
set local request.jwt.claims=:'hana';
select public.set_product_published(:'product',false,(select version from public.products where id=:'product'));
set local request.jwt.claims=:'tarek';
select is(public.organization_media_resolve('product',:'key','read','9d000000-dddd-4ddd-8ddd-000000000002'),null::jsonb,'unpublish denies future application reads immediately');
reset role;
select is((select count(*)::int from public.audit_log where action='product.image_added' and subject_id=:'product'),1,'retry does not duplicate product audit');
-- Synthetic migration ledger verifies new namespaces and exact rollback guards.
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok(format('select public.media_migration_switch(%L,%L,%L,100,%L,%L)','product',:'key',:'owner','image/png',repeat('a',64)),'verified product migration switches reference');
select is((select organization_id from public.media_storage_locations where namespace='product' and object_key=:'key'),:'org'::uuid,'migration retains organization accounting');
select throws_ok(format('select public.media_migration_rollback(%L,%L,%L)','product',:'key',repeat('b',64)),'42501','no verified legacy migration','wrong checksum cannot roll back');
select lives_ok(format('select public.media_migration_rollback(%L,%L,%L)','product',:'key',repeat('a',64)),'exact product rollback restores source provider');
select is((select provider from public.media_storage_locations where namespace='product' and object_key=:'key'),'supabase','retained legacy provider restored');
select lives_ok(format('select public.media_migration_switch(%L,%L,%L,100,%L,%L)','organization',:'logo',:'owner','image/png',repeat('a',64)),'verified logo migration switches reference');
select lives_ok(format('select public.media_migration_rollback(%L,%L,%L)','organization',:'logo',repeat('a',64)),'exact logo rollback succeeds');
set local role authenticated;
set local request.jwt.claims=:'hana';
select public.organization_image_request_upload(:'org','image/png') as logo2 \gset
select pg_temp.attest_organization_fixture('organization',:'logo2');
select is(public.organization_image_confirm_upload(:'logo2'),:'logo','replacement returns exact retired key');
select is(public.organization_image_confirm_upload(:'logo2'),:'logo','confirmation retry retains exact cleanup key');
select is(public.organization_media_resolve('organization',:'logo','read'),null::jsonb,'retired logo cannot be read');
select ok(public.organization_media_resolve('organization',:'logo','delete') is not null,'retired logo can be cleaned by current manager');
select is(public.organization_image_remove(:'org'),:'logo2','remove returns current key');
select is(public.organization_image_remove(:'org'),:'logo2','interrupted removal retry returns same key');
select is(public.organization_media_resolve('organization',:'logo2','read'),null::jsonb,'removed current logo cannot be read');
select is(public.product_image_remove(:'image'),:'key','product removal returns exact key');
select is(public.product_image_remove(:'image'),:'key','product cleanup retry returns exact key');
select is(public.organization_media_resolve('product',:'key','read'),null::jsonb,'deleted product image denied before bytes cleanup');
reset role;
-- Creator ownership must never survive loss of the relevant membership.
update public.memberships set status='suspended' where user_id=:'owner' and organization_id=:'org';
set local role authenticated;
set local request.jwt.claims=:'hana';
select is(public.organization_media_resolve('product',:'key','delete'),null::jsonb,'original uploader loses delete authority with membership');
select is(public.organization_media_resolve('organization',:'logo2','delete'),null::jsonb,'original logo uploader cannot bypass revoked membership');
reset role;
select ok((select not public from storage.buckets where id='product-images'),'product bucket remains private');
select ok((select not public from storage.buckets where id='organization-images'),'logo bucket remains private');
select ok((select permissive='RESTRICTIVE' and qual like '%product-images%' and qual like '%organization-images%'
 from pg_policies where schemaname='storage' and policyname='revocable_media_backend_reads'),'restrictive direct-read boundary covers both organization buckets');
-- PostgREST runs STABLE functions read-only; the upload branch reaches a FOR SHARE lock.
select is((select provolatile::text from pg_proc where oid='public.organization_media_resolve(text,text,text,uuid)'::regprocedure),
  'v','organization_media_resolve is volatile, so a direct RPC upload check may take row locks');
select * from finish();
rollback;

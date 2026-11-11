-- Forward-fix for 20261110090001 (media ids-only keys): scripts/hosted-db/forward-fix/media-restore-previous.sql,
-- included here byte for byte as helpers/media_forward_fix.inc (a node test pins that the two files are identical).
-- Proves: new semantics, the data-safety guard, the restored previous behaviour, grants, and that no row is touched.
create extension if not exists pgtap;
begin;
\ir helpers/organization_media_receipt.inc
select no_plan();
update auth.users set email_confirmed_at=now() where email_confirmed_at is null;
\set owner '70000001-0000-4000-8000-000000000001'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set hana '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
set local role authenticated;
set local request.jwt.claims=:'hana';
select public.own_product_create(:'org','Forward-fix product','FF-126','paints','pail',p_base_price=>100) as product \gset
select public.product_image_request_upload(:'product','image/png') as key \gset
select pg_temp.attest_organization_fixture('product',:'key');
select public.product_image_confirm_upload(:'key') as image \gset
reset role;

select is((select provider from public.media_storage_locations where namespace='product' and object_key=:'key'),'supabase','fixture is a legacy supabase-provider record');
select is((select storage_key from public.media_storage_locations where namespace='product' and object_key=:'key'),null,'fixture has no key');

-- Current (new) semantics, as the migration defines them.
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok(format('select public.media_migration_switch(%L,%L,%L,100,%L,%L)','product',:'key',:'owner','image/png',repeat('a',64)),'new switch: legacy object is switched');
select is((select storage_key from public.media_storage_locations where namespace='product' and object_key=:'key'),
  app.media_storage_key_for('product',:'key',:'owner'::uuid,:'org'::uuid),'new switch records the ids-only key');
select is(public.media_migration_target_key('product',:'key'),(select storage_key from public.media_storage_locations where namespace='product' and object_key=:'key'),'target key equals the recorded key');
reset role;
select ok(exists(select 1 from public.media_migration_ledger where namespace='product' and object_key=:'key' and rolled_back_at is null),'ledger row is open');

-- Guard: the forward-fix refuses while a switched object holds an ids-only key. This is the guard block of the forward-fix
-- verbatim (a node test pins that it matches the file); the applying run is exercised below once no such row remains.
select throws_ok($g$
do $guard$
begin
  if exists (
    select 1
    from public.media_migration_ledger l
    join public.media_storage_locations s on s.namespace = l.namespace and s.object_key = l.object_key
    where l.rolled_back_at is null and s.provider = 'r2' and s.storage_key is not null
  ) then
    raise exception 'media forward-fix refused: objects were switched under the ids-only semantics (ledger row not rolled back and storage_key set); roll them back with the current media_migration_rollback first'
      using errcode = '55000';
  end if;
end
$guard$;
$g$,'55000',null,'guard refuses while an ids-only switched row exists');
select has_function('public','media_migration_target_key',array['text','text'],'the new function is still present before the forward-fix');

-- Roll the object back with the CURRENT rollback (clears the key), re-switch: same key (deterministic), then roll back again.
set local request.jwt.claims='{"role":"service_role"}';
select storage_key as first_key from public.media_storage_locations where namespace='product' and object_key=:'key' \gset
select lives_ok(format('select public.media_migration_rollback(%L,%L,%L)','product',:'key',repeat('a',64)),'new rollback: provider back to supabase');
select is((select storage_key from public.media_storage_locations where namespace='product' and object_key=:'key'),null,'new rollback clears the key');
select lives_ok(format('select public.media_migration_switch(%L,%L,%L,100,%L,%L)','product',:'key',:'owner','image/png',repeat('a',64)),'re-switch');
select is((select storage_key from public.media_storage_locations where namespace='product' and object_key=:'key'),:'first_key','re-switch recomputes the identical key');
select lives_ok(format('select public.media_migration_rollback(%L,%L,%L)','product',:'key',repeat('a',64)),'rolled back again');
reset role;

-- Row snapshot before the forward-fix.
select md5(coalesce(string_agg(to_jsonb(l)::text,'|' order by namespace,object_key),'')) as rows_before from public.media_storage_locations l \gset

-- Apply the forward-fix (no switched row holds a key now).
\ir helpers/media_forward_fix.inc

select is(md5(coalesce((select string_agg(to_jsonb(l)::text,'|' order by namespace,object_key) from public.media_storage_locations l),'')),:'rows_before','forward-fix changed no media row');
select is(md5(pg_get_functiondef('app.media_storage_key_assign()'::regprocedure)),'d38d4ff772c7e19bff62117d0338145f','trigger function equals the pre-media definition');
select is(md5(pg_get_functiondef('public.media_migration_switch(text,text,uuid,bigint,text,text)'::regprocedure)),'9b0391bf8c827424990d2fa9aa586a96','switch equals the pre-media definition');
select is(md5(pg_get_functiondef('public.media_migration_rollback(text,text,text)'::regprocedure)),'0205a8a0f76326de36901bf743c0d164','rollback equals the pre-media definition');
select hasnt_function('public','media_migration_target_key',array['text','text'],'the added function is dropped');
select ok(has_function_privilege('service_role','public.media_migration_switch(text,text,uuid,bigint,text,text)','EXECUTE'),'service_role keeps execute on switch');
select ok(has_function_privilege('service_role','public.media_migration_rollback(text,text,text)','EXECUTE'),'service_role keeps execute on rollback');
select ok(not has_function_privilege('authenticated','public.media_migration_switch(text,text,uuid,bigint,text,text)','EXECUTE'),'clients still cannot switch');
select ok(not has_function_privilege('authenticated','public.media_migration_rollback(text,text,text)','EXECUTE'),'clients still cannot roll back');
select ok(not has_function_privilege('authenticated','app.media_storage_key_assign()','EXECUTE'),'trigger function stays closed');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='media_storage_locations'),1,'RLS policies on media_storage_locations unchanged');
select ok((select relrowsecurity from pg_class where oid='public.media_storage_locations'::regclass),'RLS stays enabled');

-- Previous behaviour is back: the key is immutable again and the old switch writes the legacy (NULL) key.
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok(format('select public.media_migration_switch(%L,%L,%L,100,%L,%L)','product',:'key',:'owner','image/png',repeat('a',64)),'old switch works');
select is((select storage_key from public.media_storage_locations where namespace='product' and object_key=:'key'),null,'old switch keeps the legacy flat key (NULL)');
select is((select provider from public.media_storage_locations where namespace='product' and object_key=:'key'),'r2','old switch moved the pointer to r2');
select lives_ok(format('select public.media_migration_rollback(%L,%L,%L)','product',:'key',repeat('a',64)),'old rollback works on a legacy-key row');
select is((select provider from public.media_storage_locations where namespace='product' and object_key=:'key'),'supabase','old rollback flips back to supabase');
reset role;
select throws_ok(format($q$update public.media_storage_locations set storage_key=%L where namespace='product' and object_key=%L$q$,'u/'||:'owner'||'/products/'||:'product'||'/'||gen_random_uuid()||'/original.png',:'key'),
  '42501','storage key is immutable','key is immutable for everyone again, even for the table owner');
select * from finish();
rollback;

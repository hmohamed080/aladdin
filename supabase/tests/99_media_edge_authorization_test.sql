-- WP1: the media Worker's database authority. Every case is a SUBSEQUENT request
-- after a lifecycle change: the same ticket claims that were allowed are refused
-- once the database state changes (revocation bound: next request).
create extension if not exists pgtap;
begin;
\ir helpers/organization_media_receipt.inc
select no_plan();
-- Each Worker call runs as media_edge (current_user switches inside the helper),
-- so pgTAP itself never needs privileges granted to the Worker role.
create function pg_temp.auth(ns text,k text,var text,viewer uuid,sess uuid,ws uuid,exp timestamptz) returns jsonb
language plpgsql as $$ declare v jsonb; begin
  set local role media_edge; v := public.media_edge_authorize(ns,k,var,viewer,sess,ws,exp); reset role; return v;
end $$;
create function pg_temp.pub(ns text,id uuid,var text) returns jsonb
language plpgsql as $$ declare v jsonb; begin
  set local role media_edge; v := public.media_edge_public(ns,id,var); reset role; return v;
end $$;
select is(pg_temp.auth('portfolio','x.png','original',gen_random_uuid(),gen_random_uuid(),null,now()),null::jsonb,'helper really calls as media_edge')
  where current_user='postgres';
update auth.users set email_confirmed_at=now() where email_confirmed_at is null;
update public.organizations set status='active',is_verified=true where id='9d000000-dddd-4ddd-8ddd-000000000002';
\set pro '70000009-0000-4000-8000-000000000009'
\set other '70000003-0000-4000-8000-000000000003'
\set hana '70000001-0000-4000-8000-000000000001'
\set sara '70000002-0000-4000-8000-000000000002'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set ws_other '9d000000-dddd-4ddd-8ddd-000000000002'
\set s_pro 'e9000000-0000-4000-8000-000000000001'
\set s_other 'e9000000-0000-4000-8000-000000000002'
\set s_hana 'e9000000-0000-4000-8000-000000000003'
\set s_sara 'e9000000-0000-4000-8000-000000000004'
\set s_old 'e9000000-0000-4000-8000-000000000005'
\set item 'e9100000-0000-4000-8000-000000000001'
\set pkey 'e9100000-0000-4000-8000-000000000001.png'
\set ckey '70000009-0000-4000-8000-000000000009/e9100000-0000-4000-8000-000000000002.pdf'
\set legacy 'e9100000-0000-4000-8000-000000000003.png'
\set akey 'e9100000-0000-4000-8000-000000000004.jpg'
\set exp 'now()+interval ''90 seconds'''

-- ---------------------------------------------------------------- privileges
select ok(not (select rolcanlogin from pg_roles where rolname='media_edge'),'media_edge is NOLOGIN by default');
select ok(not (select rolsuper or rolbypassrls or rolcreaterole or rolcreatedb from pg_roles where rolname='media_edge'),'media_edge holds no elevated attributes');
select is((select array_agg(p.oid::regprocedure::text order by 1) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','app') and has_function_privilege('media_edge',p.oid,'EXECUTE')
    and has_schema_privilege('media_edge',n.oid,'USAGE')),
  array['media_edge_authorize(text,text,text,uuid,uuid,uuid,timestamp with time zone)','media_edge_public(text,uuid,text)'],
  'media_edge can execute exactly the two Worker functions');
select ok(not has_schema_privilege('media_edge','app','USAGE') and not has_schema_privilege('media_edge','auth','USAGE')
  and not has_schema_privilege('media_edge','storage','USAGE'),'media_edge has no internal schema usage');
select is((select count(*)::int from information_schema.role_table_grants where grantee='media_edge'),0,'media_edge has no table grants');
select ok(not has_function_privilege(r,'public.media_edge_authorize(text,text,text,uuid,uuid,uuid,timestamptz)','EXECUTE'),
  format('%s cannot call media_edge_authorize',r)) from unnest(array['anon','authenticated','service_role','authenticator']) r;
select ok(not has_function_privilege(r,'public.media_edge_public(text,uuid,text)','EXECUTE'),
  format('%s cannot call media_edge_public',r)) from unnest(array['anon','authenticated','service_role','authenticator']) r;
select ok(not has_function_privilege('anon','public.media_storage_record_variants(text,text,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.media_storage_record_variants(text,text,uuid,jsonb)','EXECUTE'),'only the backend records variants');
select ok(not has_function_privilege('anon','public.organization_media_read_providers(text,text[],uuid)','EXECUTE'),'anon cannot list organization providers');
select is((select proacl::text from pg_proc where oid='public.media_edge_authorize(text,text,text,uuid,uuid,uuid,timestamptz)'::regprocedure),
  '{postgres=X/postgres,media_edge=X/postgres}','no PUBLIC grant on media_edge_authorize');

-- ---------------------------------------------------------------- fixtures
insert into auth.sessions(id,user_id,created_at,aal) values
 (:'s_pro',:'pro',now(),'aal1'),(:'s_other',:'other',now(),'aal1'),(:'s_hana',:'hana',now(),'aal1'),(:'s_sara',:'sara',now(),'aal1'),
 (:'s_old',:'pro',now()-interval '2 days','aal1');
update auth.sessions set not_after=now()-interval '1 hour' where id=:'s_old';
insert into public.portfolio_items(id,owner_user_id,object_key,content_type,state,title)
values(:'item',:'pro',:'pkey','image/png','ready','Edge test'),
      ('e9100000-0000-4000-8000-000000000003',:'pro',:'legacy','image/png','ready','Legacy');
insert into public.professional_certificates(owner_user_id,object_path,content_type,state,title)
values(:'pro',:'ckey','application/pdf','ready','Edge certificate');
insert into public.avatar_uploads(id,owner_user_id,object_key,content_type,state)
values('e9100000-0000-4000-8000-000000000004',:'pro',:'akey','image/jpeg','ready');
update public.profiles set avatar_media_id='e9100000-0000-4000-8000-000000000004' where user_id=:'pro';
select id as profile from public.profiles where user_id=:'pro' \gset
insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,size_bytes,sha256,verified_at) values
 ('portfolio',:'pkey',:'pro','r2','image/png',100,repeat('a',64),now()),
 ('certificate',:'ckey',:'pro','r2','application/pdf',200,repeat('b',64),now()),
 ('avatar',:'akey',:'pro','r2','image/jpeg',300,repeat('c',64),now()),
 ('portfolio',:'legacy',:'pro','supabase','image/png',100,repeat('d',64),now());

-- Organization media (product + logo) uploaded through the RC2 flow, then verified on R2.
set local role authenticated;
set local request.jwt.claims='{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.own_product_create(:'org','Edge product','EDGE-99','paints','pail',p_base_price=>100) as product \gset
select public.product_image_request_upload(:'product','image/png') as prodkey \gset
select public.organization_image_request_upload(:'org','image/png') as logo \gset
reset role;
insert into public.media_storage_locations(namespace,object_key,owner_user_id,organization_id,provider,content_type,size_bytes,sha256,verified_at)
select 'product',object_key,created_by,organization_id,'r2',content_type,100,repeat('e',64),now() from public.product_images where object_key=:'prodkey'
union all
select 'organization',object_key,created_by,organization_id,'r2',content_type,100,repeat('f',64),now() from public.organization_images where object_key=:'logo';
set local role authenticated;
set local request.jwt.claims='{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.product_image_confirm_upload(:'prodkey') as image \gset
select lives_ok(format('select public.organization_image_confirm_upload(%L)',:'logo'),'fixture logo becomes current');
reset role;

-- ---------------------------------------------------------------- Mode P (private)
set local request.jwt.claims='';
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,:exp)->>'object','portfolio/'||:'pkey','owner reads private portfolio original');
select is(pg_temp.auth('certificate',:'ckey','original',:'pro',:'s_pro',null,:exp),
  jsonb_build_object('object','certificate/'||:'ckey','contentType','application/pdf','size',200,'sha256',repeat('b',64),'variants','[]'::jsonb),'owner reads certificate with authoritative type and size');
select ok(pg_temp.auth('avatar',:'akey','original',:'pro',:'s_pro',null,:exp) is not null,'owner reads own avatar');
select is(pg_temp.auth('portfolio',:'pkey','original',:'other',:'s_other',null,:exp),null::jsonb,'another user is denied');
select is(pg_temp.auth('certificate',:'ckey','original',:'other',:'s_other',null,:exp),null::jsonb,'another user is denied a certificate');
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_other',null,:exp),null::jsonb,'a session of another user cannot be borrowed');
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_old',null,:exp),null::jsonb,'an expired session (not_after) is denied');
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,now()-interval '10 seconds'),null::jsonb,'an expired ticket is rejected by claims');
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,now()+interval '10 minutes'),null::jsonb,'a ticket longer than the 120 s TTL is rejected');
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,null),null::jsonb,'a ticket without expiry is rejected');
select is(pg_temp.auth('portfolio',:'legacy','original',:'pro',:'s_pro',null,:exp),null::jsonb,'legacy Supabase rows stay on the application proxy');
select is(pg_temp.auth('portfolio',:'pkey','thumb',:'pro',:'s_pro',null,:exp),null::jsonb,'an unrecorded variant is denied');
select is(pg_temp.auth('portfolio',:'pkey','../x',:'pro',:'s_pro',null,:exp),null::jsonb,'an unknown variant name is denied');
select is(pg_temp.auth('chat',:'pkey','original',:'pro',:'s_pro',null,:exp),null::jsonb,'an unknown namespace is denied');

-- Claims set by the connection cannot impersonate, and the function's own claims do not leak.
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
set local request.jwt.claim.sub='70000009-0000-4000-8000-000000000009';
select is(pg_temp.auth('portfolio',:'pkey','original',:'other',:'s_other',null,:exp),null::jsonb,'pre-set connection claims cannot impersonate the owner');
select is(current_setting('request.jwt.claims'),'{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}','caller claims restored after the call');
set local request.jwt.claims='';
set local request.jwt.claim.sub='';
select ok(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,:exp) is not null,'owner allowed again');
select is(current_setting('request.jwt.claims'),'','viewer claims do not leak past the call');
select is(current_setting('request.jwt.claim.sub'),'','legacy sub claim does not leak past the call');

-- Variants recorded by the backend are served from their own object path.
set local role service_role;
select throws_ok(format('select public.media_storage_record_variants(%L,%L,%L,%L)','portfolio',:'pkey',:'pro','{"poster":{}}'),'22023',null,'unknown variant names are refused');
select throws_ok(format('select public.media_storage_record_variants(%L,%L,%L,%L)','portfolio',:'legacy',:'pro',
  jsonb_build_object('thumb',jsonb_build_object('size',10,'sha256',repeat('1',64),'width',320,'height',200))),'42501',null,'variants need a verified R2 receipt');
select lives_ok(format('select public.media_storage_record_variants(%L,%L,%L,%L)','portfolio',:'pkey',:'pro',
  jsonb_build_object('thumb',jsonb_build_object('size',10,'sha256',repeat('1',64),'width',320,'height',200))),'backend records a verified variant');
reset role;
select is(pg_temp.auth('portfolio',:'pkey','thumb',:'pro',:'s_pro',null,:exp),
  jsonb_build_object('object','v/portfolio/'||:'pkey'||'/thumb.webp','contentType','image/webp','size',10,'sha256',repeat('1',64)),'variant resolves to its derived object');

-- Account suspension: the next request is denied, reactivation restores it.
update public.users set status='suspended' where id=:'pro';
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,:exp),null::jsonb,'account suspension denies the next request');
update public.users set status='active' where id=:'pro';
-- Ban (Auth) also ends delivery.
update auth.users set banned_until=now()+interval '1 day' where id=:'pro';
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,:exp),null::jsonb,'an Auth ban denies the next request');
update auth.users set banned_until=null where id=:'pro';
-- Session revocation (sign-out deletes the auth.sessions row).
delete from auth.sessions where id=:'s_pro';
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,:exp),null::jsonb,'a revoked session denies the next request');
insert into auth.sessions(id,user_id,created_at,aal) values (:'s_pro',:'pro',now(),'aal1');

-- ---------------------------------------------------------------- Mode C (conditional public)
select is(pg_temp.pub('portfolio',:'item','original'),null::jsonb,'unpublished portfolio is not public');
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(format('select public.portfolio_item_set_visibility(%L,true)',:'item'),'owner publishes');
reset role;
set local request.jwt.claims='';
select is(pg_temp.pub('portfolio',:'item','original')->>'object','portfolio/'||:'pkey','published item is served by opaque id');
select is(pg_temp.pub('avatar',:'profile'::uuid,'original')->>'object','avatar/'||:'akey','listed profile current avatar is served by profile id');
select is(pg_temp.pub('certificate',:'item','original'),null::jsonb,'certificates are never public');
select is(pg_temp.pub('portfolio','e9100000-0000-4000-8000-000000000003','original'),null::jsonb,'unpublished legacy item stays denied');
set local role anon;
set local request.jwt.claims='{"role":"anon"}';
select is(public.public_media_edge_sources('portfolio',array[:'item'::uuid,'e9100000-0000-4000-8000-000000000003'::uuid]),
  jsonb_build_object(:'item','["thumb"]'::jsonb),'anon sees only currently eligible edge ids, with their recorded variants');
select throws_ok(format('select public.media_edge_public(%L,%L,%L)','portfolio',:'item','original'),'42501',null,'anon cannot call the Worker function');
select throws_ok(format('select public.media_edge_authorize(%L,%L,%L,%L,%L,null,now())','portfolio',:'pkey','original',:'pro',:'s_pro'),'42501',null,'anon cannot call the private Worker function');
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok(format('select public.media_edge_authorize(%L,%L,%L,%L,%L,null,now())','portfolio',:'pkey','original',:'pro',:'s_pro'),'42501',null,'even the owner cannot call the Worker function directly');
reset role;
-- Delisting withdraws both public portfolio and avatar on the next request.
update public.profiles set public_profile_status='hidden' where user_id=:'pro';
select is(pg_temp.pub('portfolio',:'item','original'),null::jsonb,'delisting withdraws public portfolio');
select is(pg_temp.pub('avatar',:'profile'::uuid,'original'),null::jsonb,'delisting withdraws public avatar');
update public.profiles set public_profile_status='listed' where user_id=:'pro';
update public.users set status='suspended' where id=:'pro';
select is(pg_temp.pub('portfolio',:'item','original'),null::jsonb,'suspension withdraws public portfolio');
select is(pg_temp.pub('avatar',:'profile'::uuid,'original'),null::jsonb,'suspension withdraws public avatar');
update public.users set status='active' where id=:'pro';
select ok(pg_temp.pub('portfolio',:'item','original') is not null,'reactivated listing is public again');
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(format('select public.portfolio_item_set_visibility(%L,false)',:'item'),'owner unpublishes');
reset role;
select is(pg_temp.pub('portfolio',:'item','original'),null::jsonb,'unpublish withdraws on the next request');
select ok(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,:exp) is not null,'owner still reads the private item');
-- Avatar replacement withdraws the old current avatar.
update public.profiles set avatar_media_id=null where user_id=:'pro';
select is(pg_temp.pub('avatar',:'profile'::uuid,'original'),null::jsonb,'a non-current avatar is not public');
-- Delete.
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(format('select public.portfolio_item_delete(%L)',:'item'),'owner deletes');
reset role;
set local request.jwt.claims='';
select is(pg_temp.auth('portfolio',:'pkey','original',:'pro',:'s_pro',null,:exp),null::jsonb,'a deleted item is denied on the next request, bytes still present');
-- A cleaned receipt is never served even if metadata were stale.
update public.media_storage_locations set cleaned_at=now() where namespace='certificate' and object_key=:'ckey';
select is(pg_temp.auth('certificate',:'ckey','original',:'pro',:'s_pro',null,:exp),null::jsonb,'cleaned objects are denied');

-- ---------------------------------------------------------------- tenant isolation (organization media)
select is(pg_temp.auth('product',:'prodkey','original',:'hana',:'s_hana',null,:exp)->>'object','product/'||:'prodkey','owning organization member reads a draft product image');
select is(pg_temp.auth('product',:'prodkey','original',:'other',:'s_other',:'ws_other',:exp),null::jsonb,'a foreign workspace cannot read a draft product image');
select ok(pg_temp.auth('organization',:'logo','original',:'sara',:'s_sara',null,:exp) is not null,'a current member reads the logo');
select is(pg_temp.auth('organization',:'logo','original',:'other',:'s_other',null,:exp),null::jsonb,'a foreign tenant cannot read the logo');
set local role authenticated;
set local request.jwt.claims='{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.product_audiences_set(:'product',array['manufacturer']);
select public.set_product_published(:'product',true,(select version from public.products where id=:'product'));
reset role;
select ok(pg_temp.auth('product',:'prodkey','original',:'other',:'s_other',:'ws_other',:exp) is not null,'a targeted workspace reads a published product image');
select is(pg_temp.auth('product',:'prodkey','original',:'other',:'s_other',null,:exp),null::jsonb,'personal context cannot borrow a workspace audience');
select is(pg_temp.auth('product',:'prodkey','original',:'other',:'s_other',:'org',:exp),null::jsonb,'a forged foreign workspace is rejected');
set local role authenticated;
set local request.jwt.claims='{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.set_product_published(:'product',false,(select version from public.products where id=:'product'));
reset role;
select is(pg_temp.auth('product',:'prodkey','original',:'other',:'s_other',:'ws_other',:exp),null::jsonb,'unpublish (delist) denies the targeted workspace on the next request');
-- Membership suspension.
update public.memberships set status='suspended' where user_id=:'sara' and organization_id=:'org';
select is(pg_temp.auth('organization',:'logo','original',:'sara',:'s_sara',null,:exp),null::jsonb,'membership suspension denies the logo on the next request');
-- Product image removal.
set local role authenticated;
set local request.jwt.claims='{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.product_image_remove(:'image'),:'prodkey','product image removed');
select ok(public.organization_media_read_providers('organization',array[:'logo'])=jsonb_build_object(:'logo','r2'),'caller-scoped provider list reports the readable logo');
reset role;
select is(pg_temp.auth('product',:'prodkey','original',:'hana',:'s_hana',null,:exp),null::jsonb,'a removed product image is denied on the next request');
set local role authenticated;
set local request.jwt.claims='{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select is(public.organization_media_read_providers('organization',array[:'logo']),'{}'::jsonb,'foreign tenant sees no provider for the logo');
reset role;

select * from finish();
rollback;

-- Ids-only physical keys for new R2 uploads (20261029120001). Every new key holds only
-- stable ids under u/<user> or o/<organization>; existing and migrated rows keep their
-- legacy key; the key is immutable; and authorization is still decided by the resolvers.
create extension if not exists pgtap;
begin;
select no_plan();
update auth.users set email_confirmed_at=now() where email_confirmed_at is null;
\set pro '70000009-0000-4000-8000-000000000009'
\set hana '70000001-0000-4000-8000-000000000001'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set uuid '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

-- ------------------------------------------------------------ privileges
select ok(not has_function_privilege(r,'public.media_storage_object(text,text)','EXECUTE'),format('%s cannot look up physical keys',r))
  from unnest(array['anon','authenticated','authenticator','media_edge']) r;
select ok(has_function_privilege('service_role','public.media_storage_object(text,text)','EXECUTE'),'the backend looks up physical keys');
select ok(not has_function_privilege(r,'app.media_storage_key_for(text,text,uuid,uuid)','EXECUTE'),format('%s cannot mint keys',r))
  from unnest(array['anon','authenticated','service_role']) r;

-- ------------------------------------------------------------ personal media (u/)
set local role authenticated;
set local request.jwt.claims='{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select object_key as pkey from public.portfolio_item_create('id keys',null,'image/png') \gset
select public.avatar_request_upload('image/jpeg') as akey \gset
select object_path as ckey from public.certificate_create('id keys',null,null,null,'application/pdf',null) \gset
select public.avatar_request_upload('image/png') as skey \gset
select lives_ok(format('select public.media_storage_reserve(%L,%L,%L)','avatar',:'skey','supabase'),'a Supabase reservation still works');
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select public.media_storage_reserve('portfolio',:'pkey','r2',:'pro');
select public.media_storage_reserve('avatar',:'akey','r2',:'pro');
select public.media_storage_reserve('certificate',:'ckey','r2',:'pro');
select is((select storage_key from public.media_storage_locations where namespace='portfolio' and object_key=:'pkey'),
  'u/'||:'pro'||'/portfolio/'||split_part(:'pkey','.',1)||'/original.png','portfolio key: u/<user>/portfolio/<id>/original.png');
select is((select storage_key from public.media_storage_locations where namespace='avatar' and object_key=:'akey'),
  'u/'||:'pro'||'/profile/'||split_part(:'akey','.',1)||'/original.jpg','avatar key: u/<user>/profile/<id>/original.jpg');
select is((select storage_key from public.media_storage_locations where namespace='certificate' and object_key=:'ckey'),
  'u/'||:'pro'||'/certificates/'||split_part(split_part(:'ckey','/',2),'.',1)||'/original.pdf','certificate key: u/<user>/certificates/<id>/original.pdf');
select is((select storage_key from public.media_storage_locations where namespace='avatar' and object_key=:'skey'),null,'Supabase rows get no R2 key');

-- ------------------------------------------------------------ organization media (o/)
set local role authenticated;
set local request.jwt.claims='{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.own_product_create(:'org','Id keys product','IDK-104','paints','pail',p_base_price=>100) as product \gset
select public.product_image_request_upload(:'product','image/png') as prodkey \gset
select public.organization_image_request_upload(:'org','image/webp') as logo \gset
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select public.media_storage_reserve('product',:'prodkey','r2',:'hana');
select public.media_storage_reserve('organization',:'logo','r2',:'hana');
select is((select storage_key from public.media_storage_locations where namespace='product' and object_key=:'prodkey'),
  'o/'||:'org'||'/products/'||:'product'||'/'||split_part(split_part(:'prodkey','/',3),'.',1)||'/original.png',
  'product key: o/<org>/products/<product>/<id>/original.png (the organization, not the uploader)');
select is((select storage_key from public.media_storage_locations where namespace='organization' and object_key=:'logo'),
  'o/'||:'org'||'/profile/'||split_part(split_part(:'logo','/',2),'.',1)||'/original.webp','organization key: o/<org>/profile/<id>/original.webp');
select is(app.media_storage_key_for('product',:'pro'||'/'||:'product'||'/'||:'pro'||'.png',:'pro',null),
  'u/'||:'pro'||'/products/'||:'product'||'/'||:'pro'||'/original.png','independent publisher product key: u/<user>/products/...');

select ok(storage_key ~ ('^[uo]/'||:'uuid'||'/(profile|portfolio|certificates|products)/('||:'uuid'||'/){1,2}original\.[a-z0-9]+$'),
  format('%s key holds only ids',namespace)) from public.media_storage_locations where storage_key is not null;
select is((select count(*)::int from public.media_storage_locations l, public.organizations o, public.profiles u
  where l.storage_key is not null and (l.storage_key ilike '%'||o.name||'%' or l.storage_key ilike '%'||coalesce(u.username,u.display_name,'-')||'%'
    or l.storage_key ~* '(showroom|supplier|manufacturer|importer|contractor|engineer|craftsman|sales|personal)')),0,
  'no business name, username or account type appears in any key');

-- ------------------------------------------------------------ reads, variants, lookups
select public.media_storage_attest('portfolio',:'pkey',:'pro','r2',100,'image/png',repeat('a',64));
select public.media_storage_record_variants('portfolio',:'pkey',:'pro',
  '{"thumb":{"sha256":"1111111111111111111111111111111111111111111111111111111111111111","size":10,"width":320,"height":160}}');
select is(app.media_edge_grant('portfolio',:'pkey','original')->>'object','u/'||:'pro'||'/portfolio/'||split_part(:'pkey','.',1)||'/original.png',
  'the edge grant names the ids-only object');
select is(app.media_edge_grant('portfolio',:'pkey','thumb')->>'object','u/'||:'pro'||'/portfolio/'||split_part(:'pkey','.',1)||'/v/thumb.webp',
  'variants live in the original''s folder');
select is(public.media_storage_object('portfolio',:'pkey'),'u/'||:'pro'||'/portfolio/'||split_part(:'pkey','.',1)||'/original.png',
  'the backend lookup returns the same object');
select is(public.media_storage_object('avatar',:'skey'),null,'no physical R2 key for a Supabase row');

-- ------------------------------------------------------------ legacy keys stay valid
insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,size_bytes,sha256,verified_at,variants)
  values('portfolio','e9400000-0000-4000-8000-000000000001.png',:'pro','r2','image/png',100,repeat('c',64),now(),
    '{"card":{"sha256":"2222222222222222222222222222222222222222222222222222222222222222","size":10,"width":800,"height":400}}');
select is((select storage_key from public.media_storage_locations where object_key='e9400000-0000-4000-8000-000000000001.png'),null,
  'an already-verified row (existing data, migration tool) keeps the legacy key');
select is(app.media_edge_grant('portfolio','e9400000-0000-4000-8000-000000000001.png','original')->>'object',
  'portfolio/e9400000-0000-4000-8000-000000000001.png','legacy original still resolves to its existing object');
select is(app.media_edge_grant('portfolio','e9400000-0000-4000-8000-000000000001.png','card')->>'object',
  'v/portfolio/e9400000-0000-4000-8000-000000000001.png/card.webp','legacy variant still resolves to its existing object');
select is(public.media_storage_object('portfolio','e9400000-0000-4000-8000-000000000001.png'),
  'portfolio/e9400000-0000-4000-8000-000000000001.png','the backend lookup returns the legacy key');

-- ------------------------------------------------------------ immutability and shape
select throws_ok(format('update public.media_storage_locations set storage_key=null where namespace=%L and object_key=%L','portfolio',:'pkey'),
  '42501','storage key is immutable','a key cannot be cleared');
select throws_ok(format('update public.media_storage_locations set storage_key=%L where object_key=%L',
  'u/'||:'pro'||'/portfolio/'||:'pro'||'/original.png','e9400000-0000-4000-8000-000000000001.png'),
  '42501','storage key is immutable','a legacy row cannot be given a new key');
select throws_ok(format('insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,storage_key) values(%L,%L,%L,%L,%L,%L)',
  'portfolio','e9400000-0000-4000-8000-000000000002.png',:'pro','r2','image/png','u/'||:'pro'||'/portfolio/walid-decor/original.png'),
  '23514',null,'a key with a name in it is refused');
select throws_ok(format('select app.media_storage_key_for(%L,%L,%L,null)','portfolio','../x.png',:'pro'),'22023','unexpected media key',
  'a key without a media id is refused');
select throws_ok(format('select app.media_storage_key_for(%L,%L,%L,null)','organization',:'org'||'/'||:'pro'||'.png',:'pro'),'22023','unexpected media key',
  'organization media needs its organization');

-- ------------------------------------------------------------ authorization is unchanged
set local role authenticated;
set local request.jwt.claims='{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select is(public.media_storage_resolve('portfolio',:'pkey','upload'),null::jsonb,'another user still cannot use the record');
select is((select count(*)::int from public.media_storage_locations),0,'another user still sees no locations');
select * from finish();
rollback;

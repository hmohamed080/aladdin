-- Purchase-request photos and business-verification documents on the central media system
-- (20261101090002): ids-only keys, the same reservation/receipt/resolver path as the other namespaces,
-- compliance evidence never offered to cleanup, and no cross-account access.
create extension if not exists pgtap;
begin;
select no_plan();
update auth.users set email_confirmed_at=now() where email_confirmed_at is null;
\set eng '70000010-0000-4000-8000-000000000010'
\set hana '70000001-0000-4000-8000-000000000001'
\set org '9c000000-cccc-4ccc-8ccc-000000000001'
\set uuid '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
\set item '[{"name":"Cornice","category_code":"cornices","quantity":20,"unit":"meter"}]'

create temp table _k (name text primary key, key text);
create temp table _r (name text primary key, id uuid);
grant all on _k, _r to authenticated;

-- ------------------------------------------------------------ namespaces and key shapes
select is(app.media_storage_key_for('request',:'eng'||'/'||:'org'||'/'||:'hana'||'.png',:'eng',null),
  'u/'||:'eng'||'/requests/'||:'org'||'/'||:'hana'||'/original.png','personal request key: u/<user>/requests/<request>/<id>/original.png');
select is(app.media_storage_key_for('request',:'org'||'/'||:'eng'||'/'||:'hana'||'.png',:'hana',:'org'),
  'o/'||:'org'||'/requests/'||:'eng'||'/'||:'hana'||'/original.png','organization request key is under o/<org>');
select is(app.media_storage_key_for('verification',:'org'||'/'||:'hana'||'.pdf',:'hana',:'org'),
  'o/'||:'org'||'/verification/'||:'hana'||'/original.pdf','verification key: o/<org>/verification/<id>/original.pdf');
select throws_ok(format('select app.media_storage_key_for(%L,%L,%L,null)','verification',:'org'||'/'||:'hana'||'.pdf',:'hana'),
  '22023',null,'a verification document must belong to an organization');
select throws_ok(format('select app.media_storage_key_for(%L,%L,%L,null)','request','not-a-key',:'hana'),
  '22023',null,'a malformed request key is refused');

-- ------------------------------------------------------------ a personal purchase-request photo
set local role authenticated;
set local request.jwt.claims='{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}';
select lives_ok(format($f$insert into _r select 'req', public.purchase_request_save(null,null,null,'Media request','n',current_date+30,false,%L::jsonb)$f$,:'item'),
  'an individual creates a draft request');
select public.purchase_request_image_request_upload(
  (select id from public.purchase_request_items where request_id=(select id from _r where name='req') limit 1),'image/png') as rkey \gset
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok(format('select public.media_storage_reserve(%L,%L,%L,%L)','request',:'rkey','r2',:'eng'),'the backend reserves the request photo on R2');
select ok((select storage_key from public.media_storage_locations where namespace='request' and object_key=:'rkey')
  ~ ('^u/'||:'eng'||'/requests/'||:'uuid'||'/'||:'uuid'||'/original\.png$'),'the reserved key holds only ids');

-- ready needs the central verification receipt once reserved
set local role authenticated;
set local request.jwt.claims='{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}';
select throws_ok(format('select public.purchase_request_image_confirm_upload(%L)',:'rkey'),'42501',null,
  'a reserved photo cannot become ready without a verification receipt');
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok(format('select public.media_storage_attest(%L,%L,%L,%L,100,%L,%L)','request',:'rkey',:'eng','r2','image/png',repeat('a',64)),
  'the backend records the verification receipt');
set local role authenticated;
set local request.jwt.claims='{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}';
select lives_ok(format('select public.purchase_request_image_confirm_upload(%L)',:'rkey'),'confirm succeeds after the receipt');
select is(public.media_storage_resolve('request',:'rkey','read')->>'provider','r2','the owner reads through the resolver, provider r2');
set local request.jwt.claims='{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.media_storage_resolve('request',:'rkey','read'),null,'another account gets no resolution for the photo');
select is(public.media_storage_resolve('request',:'rkey','delete'),null,'nor may it delete it');

-- removal retires the record; the bytes become a cleanup candidate
set local request.jwt.claims='{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}';
select lives_ok(format('select public.purchase_request_image_remove((select id from public.purchase_request_images where object_key=%L))',:'rkey'),
  'the owner removes the draft photo');
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select ok(exists(select 1 from public.media_cleanup_candidates(100) c where c.namespace='request' and c.object_key=:'rkey'),
  'the removed photo is a cleanup candidate');
select lives_ok(format('select public.media_cleanup_retire(%L,%L,%L)','request',:'rkey',:'eng'),'retire is idempotent for a deleted row');

-- ------------------------------------------------------------ verification evidence is retained
select ok(not exists(select 1 from public.media_cleanup_candidates(100) c
  join public.business_verification_documents d on d.object_key=c.object_key
  where c.namespace='verification' and d.submission_id is not null),'submitted verification evidence is never a cleanup candidate');
select ok(has_function_privilege('service_role','public.media_cleanup_candidates(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.media_cleanup_candidates(integer)','EXECUTE'),
  'only the backend runs the lifecycle functions');

select ok(has_function_privilege('media_edge','public.media_edge_authorize(text,text,text,uuid,uuid,uuid,timestamp with time zone)','EXECUTE')
  and not has_function_privilege('authenticated','public.media_edge_authorize(text,text,text,uuid,uuid,uuid,timestamp with time zone)','EXECUTE'),
  'only the edge role runs the edge authorization, including for the two new namespaces');
select is(public.media_edge_authorize('request',:'rkey','original',:'eng','00000000-0000-4000-8000-000000000001',null,now()+interval '60 seconds'),null,
  'an edge ticket without a live Auth session is refused for a request photo');
select is(public.media_edge_authorize('verification',:'rkey','original',:'eng','00000000-0000-4000-8000-000000000001',null,now()+interval '60 seconds'),null,
  'and for a verification document');

select * from finish();
rollback;

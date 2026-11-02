-- CI proof of legacy-media-reset.sql (run as: begin; <reset> <this> rollback). Raises on any failed expectation.
-- Fixtures use the seeded A-owner / B-owner and organization A. Everything is rolled back by the caller.
do $$
declare
  ua constant uuid := '11111111-1111-4111-8111-111111111111';
  ub constant uuid := '33333333-3333-4333-8333-333333333333';
  org constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  k text; n integer; j jsonb; c jsonb; b boolean; e text; oid uuid; st text;
  o_bv1 uuid; o_bv2 uuid; o_bv3 uuid; o_av1 uuid; o_av3 uuid;
  -- ids and keys
  av1 constant uuid := 'f2000000-0000-4000-8000-000000000001';  -- legacy avatar, profile avatar of ua
  av2 constant uuid := 'f2000000-0000-4000-8000-000000000002';  -- legacy avatar used as cover of ua
  av3 constant uuid := 'f2000000-0000-4000-8000-000000000003';  -- R2 avatar of ub
  av4 constant uuid := 'f2000000-0000-4000-8000-000000000004';  -- legacy avatar row without object
  pi1 constant uuid := 'f2000000-0000-4000-8000-000000000011';  -- legacy portfolio photo, project cover
  pi2 constant uuid := 'f2000000-0000-4000-8000-000000000012';  -- R2 portfolio photo
  ce1 constant uuid := 'f2000000-0000-4000-8000-000000000021';
  pr1 constant uuid := 'f2000000-0000-4000-8000-000000000031';
  og1 constant uuid := 'f2000000-0000-4000-8000-000000000041';  -- legacy organization image, logo
  rq1 constant uuid := 'f2000000-0000-4000-8000-000000000051';
  bv1 constant uuid := 'f2000000-0000-4000-8000-000000000061';  -- draft verification document
  bv2 constant uuid := 'f2000000-0000-4000-8000-000000000062';  -- SUBMITTED evidence
  bv4 constant uuid := 'f2000000-0000-4000-8000-000000000064';  -- SUBMITTED evidence already served from R2, no Supabase object
  proj constant uuid := 'f2000000-0000-4000-8000-0000000000a1';
  sub constant uuid := 'f2000000-0000-4000-8000-0000000000b1';
  g constant text := '-0000-4000-8000-';
  k_av1 text := av1 || '.jpg';  k_av2 text := av2 || '.png'; k_av3 text := av3 || '.webp'; k_av4 text := av4 || '.jpg';
  k_pi1 text := pi1 || '.jpg';  k_pi2 text := pi2 || '.jpg';
  k_ce1 text := ua || '/' || ce1 || '.pdf';
  k_pr1 text := org || '/f2000000-0000-4000-8000-0000000000c1/' || pr1 || '.png';
  k_og1 text := org || '/' || og1 || '.png';
  k_rq1 text := 'f2000000-0000-4000-8000-0000000000d1/f2000000-0000-4000-8000-0000000000d2/' || rq1 || '.png';
  k_bv1 text := org || '/' || bv1 || '.pdf';
  k_bv2 text := org || '/' || bv2 || '.pdf';
  k_bv4 text := org || '/' || bv4 || '.pdf';
  k_bv3 text := org || '/f2000000-0000-4000-8000-000000000063.pdf'; -- object with no row
begin
  -- ----------------------------------------------------------- clean slate (rolled back by the caller)
  update public.profiles set avatar_media_id = null, cover_media_id = null;
  update public.organizations set logo_media_id = null;
  delete from public.portfolio_projects;
  delete from public.media_storage_locations;
  delete from public.portfolio_items; delete from public.professional_certificates; delete from public.product_images;
  delete from public.purchase_request_images; delete from public.organization_images;
  delete from public.business_verification_documents; delete from public.avatar_uploads;
  set local session_replication_role = replica; delete from storage.objects where bucket_id in ('avatars','professional-portfolio','professional-certificates','product-images',
    'organization-images','purchase-request-images','business-verification-documents'); set local session_replication_role = origin;

  -- ----------------------------------------------------------- fixtures
  insert into public.avatar_uploads(id, owner_user_id, object_key, content_type, state) values
    (av1, ua, k_av1, 'image/jpeg', 'ready'), (av2, ua, k_av2, 'image/png', 'ready'),
    (av3, ub, k_av3, 'image/webp', 'ready'), (av4, ub, k_av4, 'image/jpeg', 'ready');
  update public.profiles set avatar_media_id = av1, cover_media_id = av2 where user_id = ua;
  update public.profiles set avatar_media_id = av3 where user_id = ub;
  insert into public.portfolio_items(id, owner_user_id, object_key, content_type, title, state, visibility) values
    (pi1, ua, k_pi1, 'image/jpeg', 'p1', 'ready', 'public'), (pi2, ua, k_pi2, 'image/jpeg', 'p2', 'ready', 'public');
  insert into public.portfolio_projects(id, owner_user_id, title, cover_kind, cover_id) values (proj, ua, 'proj', 'image', pi1);
  insert into public.professional_certificates(id, owner_user_id, object_path, content_type, title, state)
    values (ce1, ua, k_ce1, 'application/pdf', 'c', 'ready');
  insert into public.organization_images(id, organization_id, object_key, content_type, state, created_by)
    values (og1, org, k_og1, 'image/png', 'ready', ua);
  update public.organizations set logo_media_id = og1 where id = org;
  -- Product and request images hang off a product / request item the seed does not provide: skip their foreign keys.
  set local session_replication_role = replica;
  insert into public.product_images(id, product_id, organization_id, publisher_id, object_key, content_type, slot, state, created_by)
    values (pr1, 'f2000000-0000-4000-8000-0000000000c1', org, 'f2000000-0000-4000-8000-0000000000c2', k_pr1, 'image/png', 1, 'ready', ua);
  insert into public.purchase_request_images(id, request_id, item_id, owner_scope, object_key, content_type, slot, state, created_by)
    values (rq1, 'f2000000-0000-4000-8000-0000000000d1', 'f2000000-0000-4000-8000-0000000000d2', org, k_rq1, 'image/png', 1, 'ready', ua);
  insert into public.business_verification_documents(id, organization_id, submission_id, doc_type, object_key, content_type, size_bytes, file_name, state, created_by)
    values (bv1, org, null, 'tax_card', k_bv1, 'application/pdf', 10, 'draft.pdf', 'ready', ua),
           (bv2, org, sub, 'commercial_register', k_bv2, 'application/pdf', 10, 'submitted.pdf', 'ready', ua),
           (bv4, org, sub, 'tax_card', k_bv4, 'application/pdf', 10, 'submitted-r2.pdf', 'ready', ua);
  set local session_replication_role = origin;

  insert into public.media_storage_locations(namespace, object_key, owner_user_id, provider, content_type, size_bytes, sha256, verified_at) values
    ('avatar', k_av3, ub, 'r2', 'image/webp', 100, repeat('a', 64), now()),
    ('portfolio', k_pi2, ua, 'r2', 'image/jpeg', 100, repeat('b', 64), now()),
    ('verification', k_bv4, ua, 'r2', 'application/pdf', 100, repeat('c', 64), now()),
    ('avatar', k_av1, ua, 'supabase', 'image/jpeg', null, null, null),
    ('avatar', 'f2000000-0000-4000-8000-0000000000ff.jpg', ua, 'supabase', 'image/jpeg', null, null, null); -- stale location

  insert into storage.objects(bucket_id, name, metadata) values
    ('avatars', k_av1, '{"size": 11, "eTag": "e-av1"}'), ('avatars', k_av2, '{"size": 12, "eTag": "e-av2"}'),
    ('avatars', k_av3, '{"size": 13, "eTag": "e-av3"}'),
    ('avatars', 'f2000000-0000-4000-8000-0000000000ee.jpg', '{"size": 14, "eTag": "e-orphan"}'), -- orphan object
    ('professional-portfolio', k_pi1, '{"size": 21, "eTag": "e-pi1"}'), ('professional-portfolio', k_pi2, '{"size": 22, "eTag": "e-pi2"}'),
    ('professional-certificates', k_ce1, '{"size": 31, "eTag": "e-ce1"}'),
    ('product-images', k_pr1, '{"size": 41, "eTag": "e-pr1"}'),
    ('organization-images', k_og1, '{"size": 51, "eTag": "e-og1"}'),
    ('purchase-request-images', k_rq1, '{"size": 61, "eTag": "e-rq1"}'),
    ('business-verification-documents', k_bv1, '{"size": 71, "eTag": "e-bv1"}'),
    ('business-verification-documents', k_bv2, '{"size": 72, "eTag": "e-bv2"}'),
    ('business-verification-documents', k_bv3, '{"size": 73, "eTag": "e-bv3"}');

  select id into o_bv1 from storage.objects where name = k_bv1; select id into o_bv2 from storage.objects where name = k_bv2;
  select id into o_bv3 from storage.objects where name = k_bv3; select id into o_av1 from storage.objects where name = k_av1;
  select id into o_av3 from storage.objects where name = k_av3;

  -- ----------------------------------------------------------- privileges
  foreach k in array array['public.media_reset_manifest_objects(text,text,integer)','public.media_reset_manifest_rows(text,text,integer)',
      'public.media_reset_manifest_locations(text,text,integer)','public.media_reset_manifest_counts()','public.media_reset_retire(text,jsonb)',
      'public.media_reset_storage_removed(text,text)','public.media_reset_finalize(integer)','public.media_reset_drop_locations(jsonb)',
      'public.media_reset_verify()'] loop
    if has_function_privilege('anon', k, 'execute') or has_function_privilege('authenticated', k, 'execute') then
      raise exception 'an API role can execute %', k; end if;
    if not has_function_privilege('service_role', k, 'execute') then raise exception 'service_role cannot execute %', k; end if;
  end loop;
  foreach k in array array['app.media_reset_rows()','app.media_reset_lock_row(text,text)','app.media_is_r2(text,text)'] loop
    if has_function_privilege('service_role', k, 'execute') or has_function_privilege('authenticated', k, 'execute') then
      raise exception 'internal helper % is callable', k; end if;
  end loop;
  if has_table_privilege('service_role', 'public.media_reset_journal', 'insert') or has_table_privilege('service_role', 'public.media_reset_journal', 'update')
     or has_table_privilege('authenticated', 'public.media_reset_journal', 'select') then
    raise exception 'journal privileges are too wide'; end if;

  set local role service_role;

  -- ----------------------------------------------------------- manifest: counts and decisions
  c := public.media_reset_manifest_counts();
  if (c->'objects'->>'avatars')::int <> 4 or (c->'objects'->>'business-verification-documents')::int <> 3
     or (c->>'rows')::int <> 2 or (c->>'locations')::int <> 1 or (c->>'submitted_verification_rows')::int <> 2 then
    raise exception 'unexpected manifest counts: %', c; end if;

  -- Page the avatar bucket two at a time: every object exactly once, in byte order.
  n := 0; k := null;
  loop
    select count(*), max(m.name collate "C") into n, e from public.media_reset_manifest_objects('avatars', k, 2) m;
    exit when n = 0;
    if k is not null and e <= k then raise exception 'pagination did not advance'; end if;
    k := e; j := coalesce(j, '[]'::jsonb) || to_jsonb(n);
  end loop;
  if (select sum(v::int) from jsonb_array_elements_text(j) v) <> 4 then raise exception 'paging lost or repeated objects: %', j; end if;

  if (select decision || ':' || reason from public.media_reset_manifest_objects('avatars', null, 50) m where m.name = k_av3) <> 'retain:r2-located' then
    raise exception 'R2 object is not retained'; end if;
  if (select decision || ':' || reason from public.media_reset_manifest_objects('avatars', null, 50) m where m.name = k_av1) <> 'delete:legacy-row' then
    raise exception 'legacy avatar is not a delete candidate'; end if;
  if (select decision || ':' || reason from public.media_reset_manifest_objects('avatars', null, 50) m where m.name like 'f2000000-0000-4000-8000-0000000000ee%') <> 'delete:orphan-object' then
    raise exception 'orphan object is not a delete candidate'; end if;
  if (select referenced from public.media_reset_manifest_objects('avatars', null, 50) m where m.name = k_av1) is not true then
    raise exception 'referenced flag missing'; end if;
  if (select decision || ':' || reason from public.media_reset_manifest_objects('business-verification-documents', null, 50) m where m.name = k_bv2) <> 'retain:submitted-verification-evidence' then
    raise exception 'submitted evidence is not retained'; end if;
  if (select decision || ':' || reason from public.media_reset_manifest_objects('business-verification-documents', null, 50) m where m.name = k_bv3) <> 'retain:unreferenced-verification-object' then
    raise exception 'unreferenced verification object is not retained'; end if;
  if (select decision from public.media_reset_manifest_objects('business-verification-documents', null, 50) m where m.name = k_bv1) <> 'delete' then
    raise exception 'draft verification document is not a delete candidate'; end if;
  if (select count(*) from public.media_reset_manifest_rows(null, null, 50) m where m.object_key = k_av4 and m.decision = 'delete') <> 1 then
    raise exception 'row without object missing from manifest'; end if;
  if (select count(*) from public.media_reset_manifest_rows(null, null, 50) m where m.object_key = k_bv4 and m.decision = 'retain' and m.reason = 'submitted-verification-evidence') <> 1 then
    raise exception 'submitted evidence served from R2 missing from the manifest'; end if;
  if (select count(*) from public.media_reset_manifest_locations(null, null, 50)) <> 1 then raise exception 'stale location missing'; end if;
  begin perform public.media_reset_manifest_objects('not-a-bucket', null, 5); raise exception 'accepted a foreign bucket';
  exception when sqlstate '22023' then null; end;

  -- ----------------------------------------------------------- retire: refusals are complete and leave nothing behind
  -- (a) submitted evidence, (b) object with no row, (c) R2-located, (d) replaced object, (e) wrong id
  for k in select unnest(array['evidence','norow','r2','etag','id','mixed']) loop
    b := false;
    begin
      if k = 'evidence' then
        perform public.media_reset_retire('verification', jsonb_build_array(jsonb_build_object('kind','object','key',k_bv2,
          'object_id',o_bv2,'etag','e-bv2')));
      elsif k = 'norow' then
        perform public.media_reset_retire('verification', jsonb_build_array(jsonb_build_object('kind','object','key',k_bv3,
          'object_id',o_bv3,'etag','e-bv3')));
      elsif k = 'r2' then
        perform public.media_reset_retire('avatar', jsonb_build_array(jsonb_build_object('kind','object','key',k_av3,
          'object_id',o_av3,'etag','e-av3')));
      elsif k = 'etag' then
        perform public.media_reset_retire('avatar', jsonb_build_array(jsonb_build_object('kind','object','key',k_av1,
          'object_id',o_av1,'etag','something-else')));
      elsif k = 'id' then
        perform public.media_reset_retire('avatar', jsonb_build_array(jsonb_build_object('kind','object','key',k_av1,
          'object_id',gen_random_uuid(),'etag','e-av1')));
      else -- a good item followed by a protected one: the whole batch must roll back
        perform public.media_reset_retire('verification', jsonb_build_array(
          jsonb_build_object('kind','object','key',k_bv1,'object_id',o_bv1,'etag','e-bv1'),
          jsonb_build_object('kind','object','key',k_bv2,'object_id',o_bv2,'etag','e-bv2')));
      end if;
    exception when others then
      get stacked diagnostics st = returned_sqlstate;
      b := st in ('42501','40001');
      if not b then raise exception 'retire failed for the wrong reason (%): %', k, st; end if;
    end;
    if not b then raise exception 'retire accepted a protected or mismatching item (%)', k; end if;
  end loop;
  reset role;
  if (select count(*) from public.media_reset_journal) <> 0 then raise exception 'a refused batch left journal rows'; end if;
  if (select state from public.business_verification_documents where id = bv1) <> 'ready' then raise exception 'a refused batch changed a row'; end if;
  if (select state from public.business_verification_documents where id = bv2) <> 'ready' then raise exception 'submitted evidence changed'; end if;
  set local role service_role;
  begin perform public.media_reset_retire('nope', '[]'::jsonb); raise exception 'accepted an invalid namespace';
  exception when sqlstate '22023' then null; end;
  begin perform public.media_reset_retire('avatar', '[]'::jsonb); raise exception 'accepted an empty batch';
  exception when sqlstate '22023' then null; end;
  begin perform public.media_reset_retire('row-kind-check', '[]'::jsonb); exception when sqlstate '22023' then null; end;

  -- A replaced object (same name, new identity) is refused even though counts are unchanged.
  reset role;
  select id into oid from storage.objects where name = k_av2;
  set local session_replication_role = replica; delete from storage.objects where name = k_av2; set local session_replication_role = origin;
  insert into storage.objects(bucket_id, name, metadata) values ('avatars', k_av2, '{"size": 12, "eTag": "e-av2"}');
  set local role service_role;
  b := false;
  begin
    perform public.media_reset_retire('avatar', jsonb_build_array(jsonb_build_object('kind','object','key',k_av2,'object_id',oid,'etag','e-av2')));
  exception when sqlstate '40001' then b := true; end;
  if not b then raise exception 'a replaced object (new id) was retired'; end if;

  -- ----------------------------------------------------------- retire: every namespace, pointers cleared
  perform public.media_reset_retire('avatar', (select jsonb_agg(jsonb_build_object('kind','object','key',m.name,'object_id',m.object_id,'etag',m.etag))
    from public.media_reset_manifest_objects('avatars', null, 50) m where m.decision = 'delete'));
  perform public.media_reset_retire('portfolio', (select jsonb_agg(jsonb_build_object('kind','object','key',m.name,'object_id',m.object_id,'etag',m.etag))
    from public.media_reset_manifest_objects('professional-portfolio', null, 50) m where m.decision = 'delete'));
  perform public.media_reset_retire('certificate', (select jsonb_agg(jsonb_build_object('kind','object','key',m.name,'object_id',m.object_id,'etag',m.etag))
    from public.media_reset_manifest_objects('professional-certificates', null, 50) m where m.decision = 'delete'));
  -- The product and request fixtures have no real parent rows (a same-transaction row is always FK-rechecked), so from here
  -- the proof runs without triggers and foreign keys; the refusals above ran with them.
  reset role; set local session_replication_role = replica; set local role service_role;
  perform public.media_reset_retire('product', (select jsonb_agg(jsonb_build_object('kind','object','key',m.name,'object_id',m.object_id,'etag',m.etag))
    from public.media_reset_manifest_objects('product-images', null, 50) m where m.decision = 'delete'));
  perform public.media_reset_retire('organization', (select jsonb_agg(jsonb_build_object('kind','object','key',m.name,'object_id',m.object_id,'etag',m.etag))
    from public.media_reset_manifest_objects('organization-images', null, 50) m where m.decision = 'delete'));
  perform public.media_reset_retire('request', (select jsonb_agg(jsonb_build_object('kind','object','key',m.name,'object_id',m.object_id,'etag',m.etag))
    from public.media_reset_manifest_objects('purchase-request-images', null, 50) m where m.decision = 'delete'));
  perform public.media_reset_retire('verification', (select jsonb_agg(jsonb_build_object('kind','object','key',m.name,'object_id',m.object_id,'etag',m.etag))
    from public.media_reset_manifest_objects('business-verification-documents', null, 50) m where m.decision = 'delete'));
  -- The row that never had an object.
  perform public.media_reset_retire('avatar', jsonb_build_array(jsonb_build_object('kind','row','key',k_av4)));

  reset role;
  if exists (select 1 from public.profiles where user_id = ua and (avatar_media_id is not null or cover_media_id is not null)) then
    raise exception 'avatar or cover pointer survived'; end if;
  if (select avatar_media_id from public.profiles where user_id = ub) is distinct from av3 then raise exception 'R2 avatar pointer was cleared'; end if;
  if (select cover_id from public.portfolio_projects where id = proj) is not null then raise exception 'project cover pointer survived'; end if;
  if (select logo_media_id from public.organizations where id = org) is not null then raise exception 'logo pointer survived'; end if;
  if (select state::text from public.portfolio_items where id = pi1) <> 'deleted' or (select visibility::text from public.portfolio_items where id = pi1) <> 'private' then
    raise exception 'portfolio item not tombstoned private'; end if;
  if (select state::text from public.portfolio_items where id = pi2) <> 'ready' then raise exception 'R2 portfolio item touched'; end if;
  if (select state from public.business_verification_documents where id = bv1) <> 'deleted' then raise exception 'draft document not tombstoned'; end if;
  if (select state from public.business_verification_documents where id = bv2) <> 'ready' then raise exception 'evidence touched'; end if;
  if (select count(*) from public.media_reset_journal) <> 10 then raise exception 'unexpected journal size %', (select count(*) from public.media_reset_journal); end if;

  set local role service_role;
  -- Retire is idempotent (resume): same batch again changes nothing.
  n := public.media_reset_retire('avatar', jsonb_build_array(jsonb_build_object('kind','row','key',k_av4)));
  reset role;
  if n <> 1 or (select count(*) from public.media_reset_journal) <> 10 then raise exception 'retire is not idempotent'; end if;
  set local role service_role;

  -- ----------------------------------------------------------- storage confirmation and finalize
  if public.media_reset_storage_removed('avatar', k_av1) then raise exception 'confirmed removal of an object that still exists'; end if;
  begin perform public.media_reset_storage_removed('avatar', k_av3); raise exception 'confirmed a non-retired object';
  exception when sqlstate '42501' then null; end;
  if public.media_reset_verify()->>'ok' = 'true' then raise exception 'verify says ok before storage removal'; end if;

  reset role;
  set local session_replication_role = replica; delete from storage.objects o using public.media_reset_journal j
   where j.kind = 'object' and o.bucket_id = j.bucket and o.name = j.object_key; set local session_replication_role = origin;
  set local role service_role;
  for k in select object_key from public.media_reset_journal where kind = 'object' loop
    if not public.media_reset_storage_removed((select namespace from public.media_reset_journal where object_key = k), k) then
      raise exception 'removal not confirmed for %', k; end if;
  end loop;

  n := public.media_reset_finalize(100);
  if n <> 10 then raise exception 'finalize completed % of 10', n; end if;
  if public.media_reset_finalize(100) <> 0 then raise exception 'finalize is not idempotent'; end if;
  reset role;
  if exists (select 1 from public.avatar_uploads where id in (av1, av2, av4)) or exists (select 1 from public.portfolio_items where id = pi1)
     or exists (select 1 from public.professional_certificates where id = ce1) or exists (select 1 from public.product_images where id = pr1)
     or exists (select 1 from public.organization_images where id = og1) or exists (select 1 from public.purchase_request_images where id = rq1)
     or exists (select 1 from public.business_verification_documents where id = bv1) then
    raise exception 'a tombstone survived finalize'; end if;
  if not exists (select 1 from public.avatar_uploads where id = av3) or not exists (select 1 from public.portfolio_items where id = pi2)
     or not exists (select 1 from public.business_verification_documents where id in (bv2)) or not exists (select 1 from public.business_verification_documents where id = bv4) then
    raise exception 'finalize removed a protected row'; end if;
  if exists (select 1 from public.media_storage_locations where namespace = 'avatar' and object_key = k_av1) then raise exception 'legacy location survived'; end if;
  if (select count(*) from public.media_storage_locations where provider = 'r2') <> 3 then raise exception 'an R2 location was touched'; end if;

  set local role service_role;
  -- ----------------------------------------------------------- stale locations
  if public.media_reset_verify()->>'ok' = 'true' then raise exception 'verify ignores the stale location'; end if;
  begin
    perform public.media_reset_drop_locations(jsonb_build_array(jsonb_build_object('namespace','avatar','key',k_av3)));
    raise exception 'dropped an R2 location';
  exception when sqlstate '40001' then null; end;
  if public.media_reset_drop_locations(jsonb_build_array(jsonb_build_object('namespace','avatar','key','f2000000-0000-4000-8000-0000000000ff.jpg'))) <> 1 then
    raise exception 'stale location not dropped'; end if;
  if public.media_reset_drop_locations(jsonb_build_array(jsonb_build_object('namespace','avatar','key','f2000000-0000-4000-8000-0000000000ff.jpg'))) <> 0 then
    raise exception 'drop_locations is not idempotent'; end if;

  reset role; set local session_replication_role = origin; set local role service_role;
  -- ----------------------------------------------------------- the post-condition
  j := public.media_reset_verify();
  if j->>'ok' <> 'true' then raise exception 'verify not ok after a complete reset: %', j; end if;
  if (j->'retained'->>'submitted_verification_rows')::int <> 2 or (j->'retained'->>'verification_objects')::int <> 2 then
    raise exception 'retained evidence miscounted: %', j; end if;

  -- A pointer to a legacy (non-R2) file is reported as broken, never silently accepted.
  reset role;
  insert into public.avatar_uploads(id, owner_user_id, object_key, content_type, state)
    values ('f2000000-0000-4000-8000-0000000000a9', ua, 'f2000000-0000-4000-8000-0000000000a9.jpg', 'image/jpeg', 'ready');
  update public.profiles set avatar_media_id = 'f2000000-0000-4000-8000-0000000000a9' where user_id = ua;
  set local role service_role;
  j := public.media_reset_verify();
  if j->>'ok' = 'true' or (j->'broken_pointers'->>'profiles_avatar')::int <> 1 or (j->'legacy_rows_left'->>'avatar')::int <> 1 then
    raise exception 'verify missed a pointer to a legacy file: %', j; end if;
  reset role;
end $$;

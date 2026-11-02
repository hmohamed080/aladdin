-- CI proof of bv-evidence-r2-adoption.sql (run as: begin; <adoption> <this> rollback). Raises on any failed expectation.
do $$
declare
  ua constant uuid := '11111111-1111-4111-8111-111111111111';
  org constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  sub constant uuid := 'f3000000-0000-4000-8000-0000000000b1';
  d1 constant uuid := 'f3000000-0000-4000-8000-000000000001';  -- submitted, legacy supabase location
  d2 constant uuid := 'f3000000-0000-4000-8000-000000000002';  -- submitted, no location row at all
  d3 constant uuid := 'f3000000-0000-4000-8000-000000000003';  -- draft
  k1 text := org || '/' || d1 || '.pdf'; k2 text := org || '/' || d2 || '.pdf'; k3 text := org || '/' || d3 || '.pdf';
  sha1 constant text := repeat('1', 64); sha2 constant text := repeat('2', 64);
  j jsonb; n integer; b boolean; st text; r record;
begin
  delete from public.media_storage_locations;
  delete from public.business_verification_documents;
  delete from storage.objects where bucket_id = 'business-verification-documents';
  set local session_replication_role = replica;
  insert into public.business_verification_documents(id, organization_id, submission_id, doc_type, object_key, content_type, size_bytes, file_name, state, created_by) values
    (d1, org, sub, 'tax_card', k1, 'application/pdf', 100, 'a.pdf', 'ready', ua), (d2, org, sub, 'commercial_register', k2, 'application/pdf', 200, 'b.pdf', 'ready', ua),
    (d3, org, null, 'other', k3, 'application/pdf', 300, 'c.pdf', 'ready', ua);
  set local session_replication_role = origin;
  insert into public.media_storage_locations(namespace, object_key, owner_user_id, organization_id, provider, content_type) values ('verification', k1, ua, org, 'supabase', 'application/pdf');
  insert into storage.objects(bucket_id, name, metadata) values ('business-verification-documents', k1, '{"size":100}'), ('business-verification-documents', k2, '{"size":200}'), ('business-verification-documents', k3, '{"size":300}');

  if has_function_privilege('anon', 'public.bv_evidence_adopt(text,bigint,text)', 'execute') or has_function_privilege('authenticated', 'public.bv_evidence_adopt(text,bigint,text)', 'execute')
     or has_function_privilege('authenticated', 'public.bv_evidence_adoption_inventory(text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.bv_evidence_unadopt(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.bv_evidence_adoption_verify()', 'execute') then
    raise exception 'an API role can run the adoption functions'; end if;
  if not has_function_privilege('service_role', 'public.bv_evidence_adopt(text,bigint,text)', 'execute') then raise exception 'service_role cannot adopt'; end if;

  set local role service_role;
  -- Inventory: only submitted documents, with the exact ids-only R2 key.
  select count(*) into n from public.bv_evidence_adoption_inventory(null, 10);
  if n <> 2 then raise exception 'inventory should list the 2 submitted documents, got %', n; end if;
  if (select storage_key from public.bv_evidence_adoption_inventory(null, 10) where object_key = k1) <> 'o/' || org || '/verification/' || d1 || '/original.pdf' then
    raise exception 'unexpected R2 key'; end if;
  if (select count(*) from public.bv_evidence_adoption_inventory(k1, 10)) <> 1 then raise exception 'inventory pagination failed'; end if;
  if (public.bv_evidence_adoption_verify())->>'ok' = 'true' then raise exception 'verify ok before adoption'; end if;

  -- Refusals: draft document, wrong size, bad hash.
  foreach st in array array['draft','size','sha'] loop
    b := false;
    begin
      if st = 'draft' then perform public.bv_evidence_adopt(k3, 300, sha1);
      elsif st = 'size' then perform public.bv_evidence_adopt(k1, 99, sha1);
      else perform public.bv_evidence_adopt(k1, 100, 'nothex'); end if;
    exception when sqlstate '42501' or sqlstate '40001' then b := true; end;
    if not b then raise exception 'adoption accepted a % case', st; end if;
  end loop;

  -- Adopt both. Replaces the legacy location, never touches row or object.
  if not public.bv_evidence_adopt(k1, 100, sha1) then raise exception 'first adoption returned false'; end if;
  if not public.bv_evidence_adopt(k2, 200, sha2) then raise exception 'second adoption returned false'; end if;
  if public.bv_evidence_adopt(k1, 100, sha1) then raise exception 'adoption is not idempotent'; end if;
  begin perform public.bv_evidence_adopt(k1, 100, sha2); raise exception 'accepted a different checksum';
  exception when sqlstate '40001' then null; end;

  reset role;
  select count(*) into n from public.media_storage_locations where namespace = 'verification' and provider = 'r2' and verified_at is not null and sha256 is not null and storage_key is not null;
  if n <> 2 or exists (select 1 from public.media_storage_locations where provider = 'supabase') then raise exception 'locations were not switched'; end if;
  if (select count(*) from storage.objects where bucket_id = 'business-verification-documents') <> 3 then raise exception 'a Supabase copy was removed'; end if;
  if (select count(*) from public.business_verification_documents) <> 3 or exists (select 1 from public.business_verification_documents where id in (d1, d2) and state <> 'ready') then
    raise exception 'evidence rows changed'; end if;
  set local role service_role;

  j := public.bv_evidence_adoption_verify();
  if j->>'ok' <> 'true' or (j->>'on_r2')::int <> 2 or (j->>'supabase_copy_retained')::int <> 2 then raise exception 'verify after adoption: %', j; end if;

  -- Undo is only possible while the Supabase copy exists, and only for the matching checksum.
  if public.bv_evidence_unadopt(k1, sha2) then raise exception 'unadopted with the wrong checksum'; end if;
  if not public.bv_evidence_unadopt(k1, sha1) then raise exception 'unadopt failed'; end if;
  if (public.bv_evidence_adoption_verify())->>'ok' = 'true' then raise exception 'verify ok after unadopt'; end if;
  reset role;
  delete from storage.objects where bucket_id = 'business-verification-documents' and name = k2;
  set local role service_role;
  begin perform public.bv_evidence_unadopt(k2, sha2); raise exception 'unadopted evidence that has no Supabase copy';
  exception when sqlstate '42501' then null; end;
  reset role;
end $$;

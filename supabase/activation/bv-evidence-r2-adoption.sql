-- HELD activation SQL (NOT a migration). Protected path for retained compliance evidence (decision 2026-11-02):
-- submitted business-verification documents are never touched by the ordinary media reset or cleanup. This file lets them
-- move to PRIVATE R2 by ADOPTION: the bytes are copied and sha256-verified by scripts/bv-evidence-migrate.mjs, then the
-- location of the document is switched to R2 here. Nothing is deleted: the submitted row (immutable by trigger) and the
-- Supabase Storage object are both kept, so evidence is never without a verified copy. Removing the Supabase copy is a
-- separate, later compliance decision with its own approval and is NOT implemented here.
--
-- All functions are service_role only. Roll back one document with bv_evidence_unadopt, or all functions with
-- bv-evidence-r2-adoption-rollback.sql (adopted locations stay until unadopted; the Supabase copies were never touched).

select app.audit_actions_add(array['media.bv_evidence_adopted', 'media.bv_evidence_unadopted']);

-- Every submitted document with the exact R2 key it must be copied to. Read only, keyset-paginated in byte order.
create or replace function public.bv_evidence_adoption_inventory(p_after text default null, p_limit integer default 100)
returns table(object_key text, organization_id uuid, owner_user_id uuid, content_type text, size_bytes integer, storage_key text,
              supabase_object_present boolean, adopted boolean, location_sha256 text)
language sql stable security definer set search_path = '' as $$
  select d.object_key, d.organization_id, d.created_by, d.content_type, d.size_bytes,
         app.media_storage_key_for('verification', d.object_key, d.created_by, d.organization_id),
         exists (select 1 from storage.objects s where s.bucket_id = 'business-verification-documents' and s.name = d.object_key),
         coalesce(l.provider = 'r2' and l.verified_at is not null, false), l.sha256
    from public.business_verification_documents d
    left join public.media_storage_locations l on l.namespace = 'verification' and l.object_key = d.object_key
   where d.submission_id is not null
     and (p_after is null or d.object_key collate "C" > p_after collate "C")
   order by d.object_key collate "C"
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
$$;
revoke all on function public.bv_evidence_adoption_inventory(text, integer) from public, anon, authenticated;
grant execute on function public.bv_evidence_adoption_inventory(text, integer) to service_role;

-- Switch one submitted document to its verified R2 copy. Idempotent; refuses anything that is not exactly that.
create or replace function public.bv_evidence_adopt(p_key text, p_size bigint, p_sha256 text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare
  d public.business_verification_documents%rowtype;
  v_loc public.media_storage_locations%rowtype;
  v_key text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bv_evidence_adopt', 0));
  select * into d from public.business_verification_documents x where x.object_key = p_key for update;
  if not found or d.submission_id is null or d.state <> 'ready' then
    raise exception 'adoption refused' using errcode = '42501';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' or p_size is null or p_size <> d.size_bytes then
    raise exception 'adoption refused: the copy does not match the evidence record' using errcode = '40001';
  end if;
  v_key := app.media_storage_key_for('verification', d.object_key, d.created_by, d.organization_id);
  select * into v_loc from public.media_storage_locations l where l.namespace = 'verification' and l.object_key = p_key for update;
  if found and v_loc.provider = 'r2' then
    if v_loc.sha256 is distinct from p_sha256 or v_loc.storage_key is distinct from v_key then
      raise exception 'adoption refused: checksum conflict' using errcode = '40001';
    end if;
    return false; -- already adopted with the same bytes
  end if;
  -- The provider of a location is immutable, so the legacy (Supabase) location row is replaced. The object itself is untouched.
  delete from public.media_storage_locations l where l.namespace = 'verification' and l.object_key = p_key and l.provider = 'supabase';
  insert into public.media_storage_locations(namespace, object_key, owner_user_id, organization_id, provider, content_type, size_bytes, sha256, verified_at, storage_key)
    values ('verification', p_key, d.created_by, d.organization_id, 'r2', d.content_type, p_size, p_sha256, now(), v_key);
  perform app.record_audit_event('media.bv_evidence_adopted', 'business_verification_document', d.id, d.organization_id,
    jsonb_build_object('size_bytes', p_size, 'supabase_copy_retained', true));
  return true;
end;
$$;
revoke all on function public.bv_evidence_adopt(text, bigint, text) from public, anon, authenticated;
grant execute on function public.bv_evidence_adopt(text, bigint, text) to service_role;

-- Undo one adoption. Only while the Supabase copy still exists, so evidence is never left without a copy.
create or replace function public.bv_evidence_unadopt(p_key text, p_sha256 text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare d public.business_verification_documents%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bv_evidence_adopt', 0));
  select * into d from public.business_verification_documents x where x.object_key = p_key for update;
  if not found or d.submission_id is null then raise exception 'unadopt refused' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects s where s.bucket_id = 'business-verification-documents' and s.name = p_key) then
    raise exception 'unadopt refused: no Supabase copy remains' using errcode = '42501';
  end if;
  delete from public.media_storage_locations l where l.namespace = 'verification' and l.object_key = p_key and l.provider = 'r2' and l.sha256 = p_sha256;
  if not found then return false; end if;
  perform app.record_audit_event('media.bv_evidence_unadopted', 'business_verification_document', d.id, d.organization_id, '{}'::jsonb);
  return true;
end;
$$;
revoke all on function public.bv_evidence_unadopt(text, text) from public, anon, authenticated;
grant execute on function public.bv_evidence_unadopt(text, text) to service_role;

-- Coverage report. `ok` only when every submitted document has a verified R2 location AND still has its Supabase copy.
create or replace function public.bv_evidence_adoption_verify() returns jsonb
language sql stable security definer set search_path = '' as $$
  with docs as (
    select d.object_key,
           coalesce(l.provider = 'r2' and l.verified_at is not null and l.sha256 is not null and l.storage_key is not null, false) as on_r2,
           exists (select 1 from storage.objects s where s.bucket_id = 'business-verification-documents' and s.name = d.object_key) as on_supabase
      from public.business_verification_documents d
      left join public.media_storage_locations l on l.namespace = 'verification' and l.object_key = d.object_key
     where d.submission_id is not null)
  select jsonb_build_object(
    'ok', coalesce(bool_and(on_r2 and on_supabase), true),
    'submitted', count(*), 'on_r2', count(*) filter (where on_r2), 'not_on_r2', count(*) filter (where not on_r2),
    'supabase_copy_retained', count(*) filter (where on_supabase), 'supabase_copy_missing', count(*) filter (where not on_supabase))
  from docs;
$$;
revoke all on function public.bv_evidence_adoption_verify() from public, anon, authenticated;
grant execute on function public.bv_evidence_adoption_verify() to service_role;

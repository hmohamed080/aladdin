-- HELD activation SQL (NOT a migration). Owner decision 2026-11-01: legacy application media in Supabase Storage is
-- removed, never migrated; R2 is the only media store. This file installs the DATABASE side of that reset: the
-- manifest readers, the locked retire/confirm/finalize steps, the stale-location cleanup and the post-condition check.
-- It deletes NOTHING by itself. Every function is service_role only and is called by scripts/media-reset-execute.mjs,
-- whose own gates (enable flag, approved object-level manifest hash, typed confirmation, before-snapshot, journal)
-- must all hold. Roll back with legacy-media-reset-rollback.sql (keeps the journal: it is audit evidence).
--
-- Protection of compliance evidence is enforced HERE, under row locks, not only in the tool:
--   * a business-verification document that belongs to a submission is never retired, whatever the caller sends;
--   * an object in the verification bucket with no draft row is never retired;
--   * an object whose key is served from R2 is never retired;
--   * an object whose identity (storage id + eTag) differs from the approved manifest is refused (replaced or re-uploaded).
-- A refused batch raises and rolls back completely: nothing is half-retired.
--
-- Lifecycle per object (the same three steps as the reviewed historical purge, extended to all seven namespaces):
--   1. media_reset_retire: lock the row, clear every pointer to it (avatar/cover/logo/portfolio-project cover), tombstone
--      the row (state 'deleted'), journal it;
--   2. the tool removes the Storage object, then media_reset_storage_removed confirms storage.objects no longer has it;
--   3. media_reset_finalize: delete the tombstone row and the legacy Supabase location row.
-- Rows that never had an object and locations that point at nothing are handled by the same retire/finalize and
-- media_reset_drop_locations. media_reset_verify must report ok before the tool may say the reset succeeded.

-- Extend the audit vocabulary (never removes an action). Idempotent.
select app.audit_actions_add(array['media.legacy_reset']);

create table if not exists public.media_reset_journal (
  namespace          text not null check (namespace in ('avatar','portfolio','certificate','product','organization','request','verification')),
  object_key         text not null check (length(object_key) between 1 and 512),
  bucket             text not null,
  kind               text not null check (kind in ('object','row')),
  retired_at         timestamptz not null default now(),
  storage_removed_at timestamptz,
  purged_at          timestamptz,
  primary key (namespace, object_key),
  check (purged_at is null or storage_removed_at is not null)
);
comment on table public.media_reset_journal is
  'Resumable journal of the owner-approved clean-media reset (decision 2026-11-01). Service role read only. Keys, never file contents.';
alter table public.media_reset_journal enable row level security;
revoke all on table public.media_reset_journal from public, anon, authenticated, service_role;
grant select on table public.media_reset_journal to service_role;

-- Bucket of a namespace; null for anything outside the seven application namespaces.
create or replace function app.media_reset_bucket(p_namespace text) returns text
language sql immutable set search_path = '' as $$
  select case p_namespace
    when 'avatar' then 'avatars' when 'portfolio' then 'professional-portfolio'
    when 'certificate' then 'professional-certificates' when 'product' then 'product-images'
    when 'organization' then 'organization-images' when 'request' then 'purchase-request-images'
    when 'verification' then 'business-verification-documents' end;
$$;
revoke all on function app.media_reset_bucket(text) from public, anon, authenticated, service_role;

create or replace function app.media_reset_namespace(p_bucket text) returns text
language sql immutable set search_path = '' as $$
  select case p_bucket
    when 'avatars' then 'avatar' when 'professional-portfolio' then 'portfolio'
    when 'professional-certificates' then 'certificate' when 'product-images' then 'product'
    when 'organization-images' then 'organization' when 'purchase-request-images' then 'request'
    when 'business-verification-documents' then 'verification' end;
$$;
revoke all on function app.media_reset_namespace(text) from public, anon, authenticated, service_role;

-- Is (namespace, key) served from a verified R2 object? Those are new uploads and are never legacy.
create or replace function app.media_is_r2(p_namespace text, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.media_storage_locations l
                 where l.namespace = p_namespace and l.object_key = p_key and l.provider = 'r2');
$$;
revoke all on function app.media_is_r2(text, text) from public, anon, authenticated, service_role;

-- Every metadata row of the seven namespaces, one shape. `retained` is true only for submitted verification evidence.
create or replace function app.media_reset_rows()
returns table(namespace text, row_id uuid, object_key text, bucket text, state text, retained boolean)
language sql stable security definer set search_path = '' as $$
  select 'avatar', a.id, a.object_key, 'avatars', a.state::text, false from public.avatar_uploads a
  union all select 'portfolio', p.id, p.object_key, 'professional-portfolio', p.state::text, false from public.portfolio_items p
  union all select 'certificate', c.id, c.object_path, 'professional-certificates', c.state::text, false from public.professional_certificates c
  union all select 'product', i.id, i.object_key, 'product-images', i.state::text, false from public.product_images i
  union all select 'organization', o.id, o.object_key, 'organization-images', o.state::text, false from public.organization_images o
  union all select 'request', r.id, r.object_key, 'purchase-request-images', r.state::text, false from public.purchase_request_images r
  union all select 'verification', d.id, d.object_key, 'business-verification-documents', d.state, d.submission_id is not null
    from public.business_verification_documents d;
$$;
revoke all on function app.media_reset_rows() from public, anon, authenticated, service_role;

-- Is anything still pointing at this row? (Reported in the manifest; the retire step clears the pointers.)
create or replace function app.media_reset_referenced(p_namespace text, p_row uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_row is not null and case p_namespace
    when 'avatar' then exists(select 1 from public.profiles p where p.avatar_media_id = p_row or p.cover_media_id = p_row)
    when 'organization' then exists(select 1 from public.organizations o where o.logo_media_id = p_row)
    when 'portfolio' then exists(select 1 from public.portfolio_projects j where j.cover_kind = 'image' and j.cover_id = p_row)
    else false end;
$$;
revoke all on function app.media_reset_referenced(text, uuid) from public, anon, authenticated, service_role;

-- Lock the metadata row of (namespace, key) for the rest of the transaction.
create or replace function app.media_reset_lock_row(p_namespace text, p_key text)
returns table(row_id uuid, state text, retained boolean)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_namespace = 'avatar' then
    return query select a.id, a.state::text, false from public.avatar_uploads a where a.object_key = p_key for update;
  elsif p_namespace = 'portfolio' then
    return query select p.id, p.state::text, false from public.portfolio_items p where p.object_key = p_key for update;
  elsif p_namespace = 'certificate' then
    return query select c.id, c.state::text, false from public.professional_certificates c where c.object_path = p_key for update;
  elsif p_namespace = 'product' then
    return query select i.id, i.state::text, false from public.product_images i where i.object_key = p_key for update;
  elsif p_namespace = 'organization' then
    return query select o.id, o.state::text, false from public.organization_images o where o.object_key = p_key for update;
  elsif p_namespace = 'request' then
    return query select r.id, r.state::text, false from public.purchase_request_images r where r.object_key = p_key for update;
  elsif p_namespace = 'verification' then
    return query select d.id, d.state, d.submission_id is not null from public.business_verification_documents d where d.object_key = p_key for update;
  else
    raise exception 'invalid namespace' using errcode = '22023';
  end if;
end;
$$;
revoke all on function app.media_reset_lock_row(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Manifest readers (read only). Keyset-paginated in byte order, so a page boundary can neither skip nor repeat an entry.
-- ---------------------------------------------------------------------------------------------------------------

-- Every Storage object of one application bucket with its identity and the reset decision.
create or replace function public.media_reset_manifest_objects(p_bucket text, p_after text default null, p_limit integer default 200)
returns table(bucket text, name text, object_id uuid, size_bytes bigint, etag text, updated_at timestamptz,
              namespace text, row_id uuid, row_state text, referenced boolean, submitted boolean, r2 boolean, decision text, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ns text := app.media_reset_namespace(p_bucket);
begin
  if v_ns is null then raise exception 'invalid bucket' using errcode = '22023'; end if;
  return query
  with o as (
    select s.id, s.name, s.updated_at, (s.metadata->>'size')::bigint as size, s.metadata->>'eTag' as etag
      from storage.objects s
     where s.bucket_id = p_bucket and (p_after is null or s.name collate "C" > p_after collate "C")
     order by s.name collate "C"
     limit least(greatest(coalesce(p_limit, 200), 1), 500)
  )
  select p_bucket, o.name, o.id, o.size, o.etag, o.updated_at, v_ns, r.row_id, r.state,
         app.media_reset_referenced(v_ns, r.row_id), coalesce(r.retained, false), app.media_is_r2(v_ns, o.name),
         case when v_ns = 'verification' and (r.row_id is null or r.retained) then 'retain'
              when app.media_is_r2(v_ns, o.name) then 'retain'
              else 'delete' end,
         case when v_ns = 'verification' and r.row_id is null then 'unreferenced-verification-object'
              when v_ns = 'verification' and r.retained then 'submitted-verification-evidence'
              when app.media_is_r2(v_ns, o.name) then 'r2-located'
              when r.row_id is null then 'orphan-object'
              else 'legacy-row' end
    from o
    left join app.media_reset_rows() r on r.bucket = p_bucket and r.object_key = o.name
   order by o.name collate "C";
end;
$$;
revoke all on function public.media_reset_manifest_objects(text, text, integer) from public, anon, authenticated;
grant execute on function public.media_reset_manifest_objects(text, text, integer) to service_role;

-- Metadata rows that have no Storage object and are not served from R2 (broken pointers waiting to be cleaned).
create or replace function public.media_reset_manifest_rows(p_after_namespace text default null, p_after_key text default null, p_limit integer default 200)
returns table(namespace text, bucket text, object_key text, row_id uuid, row_state text, referenced boolean, submitted boolean, decision text, reason text)
language sql stable security definer set search_path = '' as $$
  select r.namespace, r.bucket, r.object_key, r.row_id, r.state, app.media_reset_referenced(r.namespace, r.row_id), r.retained,
         case when r.retained then 'retain' else 'delete' end,
         case when r.retained then 'submitted-verification-evidence' else 'row-without-object' end
    from app.media_reset_rows() r
   where (r.retained or not app.media_is_r2(r.namespace, r.object_key))
     and not exists (select 1 from storage.objects s where s.bucket_id = r.bucket and s.name = r.object_key)
     and (p_after_namespace is null
          or (r.namespace collate "C", r.object_key collate "C") > (p_after_namespace collate "C", p_after_key collate "C"))
   order by r.namespace collate "C", r.object_key collate "C"
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke all on function public.media_reset_manifest_rows(text, text, integer) from public, anon, authenticated;
grant execute on function public.media_reset_manifest_rows(text, text, integer) to service_role;

-- Legacy Supabase location rows that point at nothing: no metadata row and no Storage object.
create or replace function public.media_reset_manifest_locations(p_after_namespace text default null, p_after_key text default null, p_limit integer default 200)
returns table(namespace text, object_key text, decision text, reason text)
language sql stable security definer set search_path = '' as $$
  select l.namespace, l.object_key, 'delete'::text, 'stale-supabase-location'::text
    from public.media_storage_locations l
   where l.provider = 'supabase'
     and not exists (select 1 from app.media_reset_rows() r where r.namespace = l.namespace and r.object_key = l.object_key)
     and not exists (select 1 from storage.objects s
                      where s.bucket_id = app.media_reset_bucket(l.namespace) and s.name = l.object_key)
     and (p_after_namespace is null
          or (l.namespace collate "C", l.object_key collate "C") > (p_after_namespace collate "C", p_after_key collate "C"))
   order by l.namespace collate "C", l.object_key collate "C"
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke all on function public.media_reset_manifest_locations(text, text, integer) from public, anon, authenticated;
grant execute on function public.media_reset_manifest_locations(text, text, integer) to service_role;

-- Expected totals, so a client that was truncated (by an API row cap or a dropped page) fails closed instead of
-- approving or executing a partial manifest.
create or replace function public.media_reset_manifest_counts() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'objects', (select jsonb_object_agg(b.bucket, (select count(*) from storage.objects s where s.bucket_id = b.bucket))
                  from (values ('avatars'),('professional-portfolio'),('professional-certificates'),('product-images'),
                               ('organization-images'),('purchase-request-images'),('business-verification-documents')) b(bucket)),
    'rows', (select count(*) from app.media_reset_rows() r
              where (r.retained or not app.media_is_r2(r.namespace, r.object_key))
                and not exists (select 1 from storage.objects s where s.bucket_id = r.bucket and s.name = r.object_key)),
    'locations', (select count(*) from public.media_storage_locations l
                   where l.provider = 'supabase'
                     and not exists (select 1 from app.media_reset_rows() r where r.namespace = l.namespace and r.object_key = l.object_key)
                     and not exists (select 1 from storage.objects s where s.bucket_id = app.media_reset_bucket(l.namespace) and s.name = l.object_key)),
    'submitted_verification_rows', (select count(*) from public.business_verification_documents d where d.submission_id is not null));
$$;
revoke all on function public.media_reset_manifest_counts() from public, anon, authenticated;
grant execute on function public.media_reset_manifest_counts() to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Step 1. Retire a batch (one namespace, up to 200 items). All or nothing.
--   p_items: [{ "kind": "object"|"row", "key": text, "object_id": uuid|null, "etag": text|null }]
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.media_reset_retire(p_namespace text, p_items jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_bucket text := app.media_reset_bucket(p_namespace);
  v_item record;
  v_row_id uuid; v_state text; v_retained boolean; v_found boolean;
  v_oid uuid; v_etag text;
  v_done integer := 0;
begin
  if v_bucket is null then raise exception 'invalid namespace' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media_reset', 0));

  for v_item in select * from jsonb_to_recordset(p_items) as x(kind text, key text, object_id uuid, etag text) loop
    if v_item.kind not in ('object','row') or v_item.key is null then
      raise exception 'invalid batch' using errcode = '22023';
    end if;
    -- A previous attempt already retired this one: resume, do not redo.
    if exists (select 1 from public.media_reset_journal j where j.namespace = p_namespace and j.object_key = v_item.key) then
      v_done := v_done + 1;
      continue;
    end if;

    select l.row_id, l.state, l.retained into v_row_id, v_state, v_retained
      from app.media_reset_lock_row(p_namespace, v_item.key) l;
    v_found := found;

    -- Compliance and R2 protection, decided under the row lock.
    if p_namespace = 'verification' and (not v_found or v_retained) then
      raise exception 'reset batch refused' using errcode = '42501';
    end if;
    if app.media_is_r2(p_namespace, v_item.key) then
      raise exception 'reset batch refused' using errcode = '42501';
    end if;

    -- Identity: the object must be exactly the one that was approved.
    select s.id, s.metadata->>'eTag' into v_oid, v_etag
      from storage.objects s where s.bucket_id = v_bucket and s.name = v_item.key;
    if v_item.kind = 'object' then
      if v_oid is null or v_item.object_id is null or v_oid <> v_item.object_id or v_etag is distinct from v_item.etag then
        raise exception 'reset batch refused' using errcode = '40001';
      end if;
    else
      if v_oid is not null or not v_found then
        raise exception 'reset batch refused' using errcode = '40001';
      end if;
    end if;

    if v_found then
      if p_namespace = 'avatar' then
        update public.profiles set avatar_media_id = null where avatar_media_id = v_row_id;
        update public.profiles set cover_media_id = null where cover_media_id = v_row_id;
        update public.avatar_uploads set state = 'deleted'::public.professional_asset_state where id = v_row_id;
      elsif p_namespace = 'portfolio' then
        update public.portfolio_projects set cover_kind = null, cover_id = null where cover_kind = 'image' and cover_id = v_row_id;
        update public.portfolio_items set state = 'deleted'::public.professional_asset_state,
               visibility = 'private'::public.portfolio_visibility where id = v_row_id;
      elsif p_namespace = 'certificate' then
        update public.professional_certificates set state = 'deleted'::public.professional_asset_state where id = v_row_id;
      elsif p_namespace = 'product' then
        update public.product_images set state = 'deleted'::public.professional_asset_state where id = v_row_id;
      elsif p_namespace = 'organization' then
        update public.organizations set logo_media_id = null where logo_media_id = v_row_id;
        update public.organization_images set state = 'deleted'::public.professional_asset_state where id = v_row_id;
      elsif p_namespace = 'request' then
        update public.purchase_request_images set state = 'deleted'::public.professional_asset_state where id = v_row_id;
      else
        update public.business_verification_documents set state = 'deleted'
         where id = v_row_id and submission_id is null;
        if not found then raise exception 'reset batch refused' using errcode = '42501'; end if;
      end if;
    end if;

    insert into public.media_reset_journal(namespace, object_key, bucket, kind, storage_removed_at)
    values (p_namespace, v_item.key, v_bucket, v_item.kind, case when v_item.kind = 'row' then now() end);
    v_done := v_done + 1;
  end loop;

  perform app.record_audit_event('media.legacy_reset', 'media', null, null,
    jsonb_build_object('step', 'retire', 'namespace', p_namespace, 'items', v_done));
  return v_done;
end;
$$;
revoke all on function public.media_reset_retire(text, jsonb) from public, anon, authenticated;
grant execute on function public.media_reset_retire(text, jsonb) to service_role;

-- Step 2 confirmation. True only when Storage no longer has the object.
create or replace function public.media_reset_storage_removed(p_namespace text, p_key text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_bucket text;
begin
  select j.bucket into v_bucket from public.media_reset_journal j where j.namespace = p_namespace and j.object_key = p_key;
  if v_bucket is null then raise exception 'not a retired reset object' using errcode = '42501'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = p_key) then return false; end if;
  update public.media_reset_journal j set storage_removed_at = coalesce(j.storage_removed_at, now())
   where j.namespace = p_namespace and j.object_key = p_key;
  return true;
end;
$$;
revoke all on function public.media_reset_storage_removed(text, text) from public, anon, authenticated;
grant execute on function public.media_reset_storage_removed(text, text) to service_role;

-- Step 3. Delete the tombstone rows and the legacy locations of objects confirmed gone. Returns how many were finished.
create or replace function public.media_reset_finalize(p_limit integer default 100)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_done integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media_reset', 0));
  with batch as (
    select j.namespace, j.object_key from public.media_reset_journal j
     where j.storage_removed_at is not null and j.purged_at is null
     order by j.storage_removed_at, j.namespace, j.object_key limit v_limit for update
  ), d_avatar as (
    delete from public.avatar_uploads a using batch b
     where b.namespace = 'avatar' and a.object_key = b.object_key and a.state = 'deleted'::public.professional_asset_state
       and not exists (select 1 from public.profiles p where p.avatar_media_id = a.id or p.cover_media_id = a.id)
    returning 1
  ), d_portfolio as (
    delete from public.portfolio_items x using batch b
     where b.namespace = 'portfolio' and x.object_key = b.object_key and x.state = 'deleted'::public.professional_asset_state returning 1
  ), d_certificate as (
    delete from public.professional_certificates x using batch b
     where b.namespace = 'certificate' and x.object_path = b.object_key and x.state = 'deleted'::public.professional_asset_state returning 1
  ), d_product as (
    delete from public.product_images x using batch b
     where b.namespace = 'product' and x.object_key = b.object_key and x.state = 'deleted'::public.professional_asset_state returning 1
  ), d_organization as (
    delete from public.organization_images x using batch b
     where b.namespace = 'organization' and x.object_key = b.object_key and x.state = 'deleted'::public.professional_asset_state
       and not exists (select 1 from public.organizations o where o.logo_media_id = x.id)
    returning 1
  ), d_request as (
    delete from public.purchase_request_images x using batch b
     where b.namespace = 'request' and x.object_key = b.object_key and x.state = 'deleted'::public.professional_asset_state returning 1
  ), d_verification as (
    delete from public.business_verification_documents x using batch b
     where b.namespace = 'verification' and x.object_key = b.object_key and x.state = 'deleted' and x.submission_id is null returning 1
  ), d_location as (
    delete from public.media_storage_locations l using batch b
     where l.namespace = b.namespace and l.object_key = b.object_key and l.provider = 'supabase' returning 1
  ) select count(*) into v_done from d_location;
  -- Mark an entry purged only when its tombstone row and its legacy location are really gone. A guard that held a
  -- tombstone back (a pointer still set) leaves the entry open, so verify reports it instead of hiding it.
  update public.media_reset_journal j set purged_at = now()
   where j.storage_removed_at is not null and j.purged_at is null
     and not exists (select 1 from app.media_reset_rows() r where r.namespace = j.namespace and r.object_key = j.object_key)
     and not exists (select 1 from public.media_storage_locations l
                      where l.namespace = j.namespace and l.object_key = j.object_key and l.provider = 'supabase');
  get diagnostics v_done = row_count;
  if v_done > 0 then
    perform app.record_audit_event('media.legacy_reset', 'media', null, null, jsonb_build_object('step', 'finalize', 'rows', v_done));
  end if;
  return v_done;
end;
$$;
revoke all on function public.media_reset_finalize(integer) from public, anon, authenticated;
grant execute on function public.media_reset_finalize(integer) to service_role;

-- Legacy Supabase location rows that point at nothing. Refuses anything that is not exactly that.
--   p_items: [{ "namespace": text, "key": text }]
create or replace function public.media_reset_drop_locations(p_items jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_item record; v_done integer := 0; v_n integer;
begin
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media_reset', 0));
  for v_item in select * from jsonb_to_recordset(p_items) as x(namespace text, key text) loop
    if app.media_reset_bucket(v_item.namespace) is null or v_item.key is null then
      raise exception 'invalid batch' using errcode = '22023';
    end if;
    if not exists (select 1 from public.media_storage_locations l where l.namespace = v_item.namespace and l.object_key = v_item.key) then
      continue; -- already gone: idempotent
    end if;
    if exists (select 1 from app.media_reset_rows() r where r.namespace = v_item.namespace and r.object_key = v_item.key)
       or exists (select 1 from storage.objects s where s.bucket_id = app.media_reset_bucket(v_item.namespace) and s.name = v_item.key)
       or app.media_is_r2(v_item.namespace, v_item.key) then
      raise exception 'reset batch refused' using errcode = '40001';
    end if;
    delete from public.media_storage_locations l
     where l.namespace = v_item.namespace and l.object_key = v_item.key and l.provider = 'supabase';
    get diagnostics v_n = row_count;
    v_done := v_done + v_n;
  end loop;
  perform app.record_audit_event('media.legacy_reset', 'media', null, null, jsonb_build_object('step', 'drop_locations', 'items', v_done));
  return v_done;
end;
$$;
revoke all on function public.media_reset_drop_locations(jsonb) from public, anon, authenticated;
grant execute on function public.media_reset_drop_locations(jsonb) to service_role;

-- Post-condition. `ok` is true only when nothing broken or obsolete is left; compliance evidence is reported, not removed.
create or replace function public.media_reset_verify() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pointers jsonb; v_rows jsonb; v_objects jsonb; v_locations integer; v_journal jsonb; v_ok boolean;
begin
  -- A pointer is broken when its target row is missing, not ready, or still a legacy (non-R2) file.
  v_pointers := jsonb_build_object(
    'profiles_avatar', (select count(*) from public.profiles p where p.avatar_media_id is not null and not exists (
        select 1 from public.avatar_uploads a where a.id = p.avatar_media_id and a.state = 'ready'::public.professional_asset_state
          and app.media_is_r2('avatar', a.object_key))),
    'profiles_cover', (select count(*) from public.profiles p where p.cover_media_id is not null and not exists (
        select 1 from public.avatar_uploads a where a.id = p.cover_media_id and a.state = 'ready'::public.professional_asset_state
          and app.media_is_r2('avatar', a.object_key))),
    'organizations_logo', (select count(*) from public.organizations o where o.logo_media_id is not null and not exists (
        select 1 from public.organization_images i where i.id = o.logo_media_id and i.state = 'ready'::public.professional_asset_state
          and app.media_is_r2('organization', i.object_key))),
    'portfolio_project_cover', (select count(*) from public.portfolio_projects j where j.cover_kind = 'image' and not exists (
        select 1 from public.portfolio_items x where x.id = j.cover_id and x.state = 'ready'::public.professional_asset_state
          and app.media_is_r2('portfolio', x.object_key))));
  -- Legacy rows left (not R2, not retained evidence): must be zero.
  v_rows := (select coalesce(jsonb_object_agg(g.namespace, g.n), '{}'::jsonb) from (
      select r.namespace, count(*) n from app.media_reset_rows() r
       where not r.retained and not app.media_is_r2(r.namespace, r.object_key) group by r.namespace) g);
  -- Storage objects left whose decision is 'delete' (everything but retained evidence and R2-located keys).
  v_objects := (select coalesce(jsonb_object_agg(g.bucket_id, g.n), '{}'::jsonb) from (
      select s.bucket_id, count(*) n from storage.objects s
       where s.bucket_id in ('avatars','professional-portfolio','professional-certificates','product-images','organization-images','purchase-request-images')
         and not app.media_is_r2(app.media_reset_namespace(s.bucket_id), s.name)
       group by s.bucket_id
      union all
      select s.bucket_id, count(*) from storage.objects s
       where s.bucket_id = 'business-verification-documents'
         and exists (select 1 from app.media_reset_rows() r where r.namespace = 'verification' and r.object_key = s.name and not r.retained)
         and not app.media_is_r2('verification', s.name)
       group by s.bucket_id) g);
  v_locations := (select count(*) from public.media_storage_locations l
                   where l.provider = 'supabase'
                     and not exists (select 1 from app.media_reset_rows() r where r.namespace = l.namespace and r.object_key = l.object_key and r.retained));
  v_journal := jsonb_build_object('retired', (select count(*) from public.media_reset_journal),
    'storage_removed', (select count(*) from public.media_reset_journal where storage_removed_at is not null),
    'purged', (select count(*) from public.media_reset_journal where purged_at is not null));
  v_ok := (select coalesce(sum(value::int), 0) from jsonb_each_text(v_pointers)) = 0
      and v_rows = '{}'::jsonb and v_objects = '{}'::jsonb and v_locations = 0
      and (select count(*) from public.media_reset_journal where purged_at is null) = 0;
  return jsonb_build_object('ok', v_ok, 'broken_pointers', v_pointers, 'legacy_rows_left', v_rows, 'legacy_objects_left', v_objects,
    'legacy_locations_left', v_locations, 'journal', v_journal,
    'retained', jsonb_build_object(
      'submitted_verification_rows', (select count(*) from public.business_verification_documents d where d.submission_id is not null),
      'verification_objects', (select count(*) from storage.objects s where s.bucket_id = 'business-verification-documents')));
end;
$$;
revoke all on function public.media_reset_verify() from public, anon, authenticated;
grant execute on function public.media_reset_verify() to service_role;

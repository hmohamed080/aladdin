-- Owner-scoped ids-only keys for the legacy Supabase -> R2 media copy (Option A, planned 2026-11-10).
--
-- Before: public.media_migration_switch wrote storage_key NULL, so a migrated object lived at the flat
-- legacy key <namespace>/<object_key>. After: the switch records the same ids-only key that new uploads
-- get (u/<user>/..., o/<org>/..., app.media_storage_key_for), so one layout covers all R2 media.
--
-- Forward-only: no earlier migration is edited. The key stays immutable for everyone except the two
-- migration functions below, which set the transaction-local flag app.media_migration. Authorization is
-- unchanged: the database resolvers decide access, the key only locates bytes.
--
-- Rollback semantics: rollback flips the pointer back to supabase. The check constraint requires
-- provider = 'r2' whenever storage_key is set, so rollback clears the key; the R2 object is never deleted
-- and a later switch recomputes the identical key (deterministic), so re-running the copy is safe.

create or replace function app.media_storage_key_assign() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'INSERT' then
    if new.provider = 'r2' and new.verified_at is null and new.storage_key is null then
      new.storage_key := app.media_storage_key_for(new.namespace,new.object_key,new.owner_user_id,new.organization_id);
    end if;
  elsif new.storage_key is distinct from old.storage_key then
    -- Only the migration functions may (a) give a supabase-provider legacy row its key when it is
    -- switched to r2, or (b) clear the key when that exact switch is rolled back.
    if coalesce(current_setting('app.media_migration',true),'') = 'on'
       and ((old.storage_key is null and new.storage_key is not null and old.provider = 'supabase' and new.provider = 'r2')
         or (old.storage_key is not null and new.storage_key is null and new.provider = 'supabase')) then
      return new;
    end if;
    raise exception 'storage key is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;

-- The physical key the copy tool must write for a record. An existing r2 record keeps its key
-- (legacy flat key when storage_key is NULL), so a repeated run never moves bytes.
create function public.media_migration_target_key(p_namespace text,p_key text)
returns text language plpgsql stable security definer set search_path='' as $$
declare m jsonb; l public.media_storage_locations;
begin
  select * into l from public.media_storage_locations where namespace=p_namespace and object_key=p_key;
  if found and l.provider = 'r2' then return coalesce(l.storage_key,l.namespace||'/'||l.object_key); end if;
  m := app.media_metadata(p_namespace,p_key);
  if m is null or m->>'state' <> 'ready' then return null; end if;
  return app.media_storage_key_for(p_namespace,p_key,(m->>'owner')::uuid,(m->>'organization')::uuid);
end;
$$;
revoke all on function public.media_migration_target_key(text,text) from public,anon,authenticated;
grant execute on function public.media_migration_target_key(text,text) to service_role;

create or replace function public.media_migration_switch(p_namespace text,p_key text,p_owner uuid,
  p_size bigint,p_content_type text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb; v_limit bigint; v_key text;
begin
  if p_namespace='portfolio' then perform 1 from public.portfolio_items where object_key=p_key for update;
  elsif p_namespace='certificate' then perform 1 from public.professional_certificates where object_path=p_key for update;
  elsif p_namespace='avatar' then perform 1 from public.avatar_uploads where object_key=p_key for update;
  elsif p_namespace='product' then perform 1 from public.product_images where object_key=p_key for update;
  elsif p_namespace='organization' then perform 1 from public.organization_images where object_key=p_key for update;
  else raise exception 'invalid namespace' using errcode='22023'; end if;
  m:=app.media_metadata(p_namespace,p_key);
  v_limit:=case p_namespace when 'avatar' then 3145728 when 'portfolio' then 5242880 when 'product' then 5242880 when 'organization' then 3145728 else 10485760 end;
  if m is null or p_owner is null or p_size is null or p_sha256 is null or p_content_type is null
    or m->>'state'<>'ready' or (m->>'owner')::uuid<>p_owner or m->>'contentType'<>p_content_type
    or p_size<=0 or p_size>v_limit or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'migration snapshot is stale or invalid' using errcode='42501';
  end if;
  if exists(select 1 from public.media_storage_locations where namespace=p_namespace and object_key=p_key
      and provider='r2' and sha256<>p_sha256) then raise exception 'checksum conflict' using errcode='42501'; end if;
  v_key := public.media_migration_target_key(p_namespace,p_key);
  -- An r2 record that already has bytes keeps its key; a first switch gets the ids-only key.
  perform set_config('app.media_migration','on',true);
  insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,size_bytes,sha256,verified_at,organization_id,storage_key)
    values(p_namespace,p_key,p_owner,'r2',p_content_type,p_size,p_sha256,now(),(m->>'organization')::uuid,
      case when v_key like p_namespace||'/%' then null else v_key end)
    on conflict(namespace,object_key) do update set provider='r2',size_bytes=excluded.size_bytes,
      sha256=excluded.sha256,verified_at=now(),
      storage_key=case when public.media_storage_locations.provider='r2' then public.media_storage_locations.storage_key else excluded.storage_key end;
  perform set_config('app.media_migration','off',true);
  insert into public.media_migration_ledger(namespace,object_key,owner_user_id,size_bytes,sha256)
    values(p_namespace,p_key,p_owner,p_size,p_sha256)
    on conflict(namespace,object_key) do update set switched_at=now(),rolled_back_at=null;
end;
$$;

create or replace function public.media_migration_rollback(p_namespace text,p_key text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.media_migration_ledger where namespace=p_namespace and object_key=p_key and sha256=p_sha256) then
    raise exception 'no verified legacy migration' using errcode='42501';
  end if;
  perform set_config('app.media_migration','on',true);
  update public.media_storage_locations set provider='supabase',storage_key=null
    where namespace=p_namespace and object_key=p_key and sha256=p_sha256;
  perform set_config('app.media_migration','off',true);
  update public.media_migration_ledger set rolled_back_at=now() where namespace=p_namespace and object_key=p_key;
end;
$$;

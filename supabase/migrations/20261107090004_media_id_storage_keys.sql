-- IDs-only physical keys for NEW R2 uploads (owner decision, 2026-10-29).
--
--   avatar        u/<user>/profile/<media id>/original.<ext>
--   portfolio     u/<user>/portfolio/<media id>/original.<ext>
--   certificate   u/<user>/certificates/<media id>/original.<ext>
--   product       o/<org>/products/<product>/<media id>/original.<ext>
--                 u/<user>/products/<product>/<media id>/original.<ext>   (independent publisher)
--   organization  o/<org>/profile/<media id>/original.<ext>
--   variants      <same folder>/v/<thumb|card|full>.webp
--   upload stage  pending/<storage_key>
--
-- Only stable ids: no account type, business name or display text ever enters a key.
-- The logical identity stays (namespace, object_key); authorization is unchanged and
-- still decided by the database, never by the path.
--
-- Backward compatible: storage_key is NULL for every existing row and for rows the
-- Supabase-to-R2 migration tool writes (media_migration_switch), which keep the legacy
-- physical key <namespace>/<object_key>. Nothing is moved, copied or deleted.
alter table public.media_storage_locations add column storage_key text
  check (storage_key is null or (provider = 'r2' and storage_key !~ '\.\.' and storage_key ~
    '^(u|o)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(profile|portfolio|certificates|products)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){1,2}original\.[a-z0-9]{2,5}$'));
create unique index media_locations_storage_key on public.media_storage_locations(storage_key) where storage_key is not null;
comment on column public.media_storage_locations.storage_key is
  'Physical R2 key of the original for uploads made after 2026-10-29 (ids only). NULL = legacy key <namespace>/<object_key>. Immutable.';

create function app.media_storage_key_for(p_namespace text,p_key text,p_owner uuid,p_org uuid)
returns text language plpgsql immutable set search_path='' as $$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  f text[]; v_product text;
begin
  -- Every application key ends in <random uuid>.<ext>; product keys carry the product id before it.
  f := regexp_match(p_key,'(?:^|/)('||u||')\.([a-z0-9]{2,5})$');
  if f is null or p_owner is null then raise exception 'unexpected media key' using errcode='22023'; end if;
  case p_namespace
    when 'avatar' then return 'u/'||p_owner||'/profile/'||f[1]||'/original.'||f[2];
    when 'portfolio' then return 'u/'||p_owner||'/portfolio/'||f[1]||'/original.'||f[2];
    when 'certificate' then return 'u/'||p_owner||'/certificates/'||f[1]||'/original.'||f[2];
    when 'product' then
      v_product := (regexp_match(p_key,'^'||u||'/('||u||')/'||u||'\.[a-z0-9]{2,5}$'))[1];
      if v_product is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return case when p_org is not null then 'o/'||p_org else 'u/'||p_owner end
        ||'/products/'||v_product||'/'||f[1]||'/original.'||f[2];
    when 'organization' then
      if p_org is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return 'o/'||p_org||'/profile/'||f[1]||'/original.'||f[2];
    else raise exception 'invalid namespace' using errcode='22023';
  end case;
end;
$$;
revoke all on function app.media_storage_key_for(text,text,uuid,uuid) from public,anon,authenticated,service_role;

-- A fresh application reservation (media_storage_reserve: provider r2, not yet verified)
-- gets an ids-only key. Migration-tool rows arrive already verified and stay legacy.
create function app.media_storage_key_assign() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op = 'INSERT' then
    if new.provider = 'r2' and new.verified_at is null and new.storage_key is null then
      new.storage_key := app.media_storage_key_for(new.namespace,new.object_key,new.owner_user_id,new.organization_id);
    end if;
  elsif new.storage_key is distinct from old.storage_key then
    raise exception 'storage key is immutable' using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function app.media_storage_key_assign() from public,anon,authenticated,service_role;
create trigger media_storage_key_assign before insert or update on public.media_storage_locations
  for each row execute function app.media_storage_key_assign();

-- The edge grant names the physical object: the ids-only key when present, else the legacy key.
create or replace function app.media_edge_grant(p_namespace text,p_key text,p_variant text)
returns jsonb language sql stable security definer set search_path='' as $$
  select case
    -- The original also names the recorded variants, so URL issuers mint only those.
    when p_variant='original' then jsonb_build_object('object',coalesce(l.storage_key,l.namespace||'/'||l.object_key),
      'contentType',l.content_type,'size',l.size_bytes,'sha256',l.sha256,
      'variants',(select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from jsonb_object_keys(l.variants) k))
    when l.variants ? p_variant then jsonb_build_object('object',
      case when l.storage_key is null then 'v/'||l.namespace||'/'||l.object_key||'/'||p_variant||'.webp'
        else regexp_replace(l.storage_key,'/original\.[a-z0-9]+$','')||'/v/'||p_variant||'.webp' end,
      'contentType','image/webp','size',(l.variants->p_variant->>'size')::bigint,'sha256',l.variants->p_variant->>'sha256')
  end
  from public.media_storage_locations l
  where l.namespace=p_namespace and l.object_key=p_key and l.provider='r2'
    and l.verified_at is not null and l.cleaned_at is null and l.sha256 is not null
    and p_variant in ('original','thumb','card','full');
$$;
revoke all on function app.media_edge_grant(text,text,text) from public,anon,authenticated,service_role;

-- Backend-only lookup of the physical original key of an R2 record (writes, reads, deletes).
-- Callers authorize the operation first through the resolvers; this only maps identity to bytes.
create function public.media_storage_object(p_namespace text,p_key text)
returns text language sql stable security definer set search_path='' as $$
  select coalesce(l.storage_key,l.namespace||'/'||l.object_key)
  from public.media_storage_locations l
  where l.namespace=p_namespace and l.object_key=p_key and l.provider='r2';
$$;
revoke all on function public.media_storage_object(text,text) from public,anon,authenticated,service_role;
grant execute on function public.media_storage_object(text,text) to service_role;

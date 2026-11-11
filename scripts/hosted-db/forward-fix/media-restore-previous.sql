-- Media forward-fix: restore the definitions that were live BEFORE 20261110090001_media_migration_ids_only_keys.sql
-- (state of 20261107090006 on Acceptance and Production).
-- NOT a down migration and NOT applied anywhere. Use only with owner approval, on a hosted database, through the Supabase
-- migration path as a NEW migration (never SQL Editor). No BEGIN/COMMIT: the migration runner applies the file atomically.
--
-- What it does: restores app.media_storage_key_assign() (trigger function; the key is immutable for everyone again),
-- public.media_migration_switch (writes storage_key NULL, i.e. the legacy flat key) and public.media_migration_rollback
-- (flips provider back to supabase only), then drops public.media_migration_target_key(text,text), which the media migration added.
-- Extracted with pg_get_functiondef from a clean replay of the 207 repo migrations (pinned CLI 2.110.0). Grants are untouched:
-- the three replaced functions keep their ACLs (the media migration changed none), and the dropped function's ACL goes with it.
-- It changes no stored row and never touches R2 objects.
--
-- DATA-SAFETY GUARD (why this is not unconditional): once the media migration is live, public.media_migration_switch records an
-- ids-only storage_key for a migrated object. The previous rollback function cannot undo such a row (it would set provider =
-- 'supabase' while storage_key stays set, which violates media_storage_locations_storage_key_check), and the previous switch
-- would no longer recompute that key. So this script REFUSES to run while any switched object (ledger row not rolled back)
-- still has a storage_key. If the guard fires: roll those objects back with the CURRENT media_migration_rollback first, or write a
-- different forward-fix with the owner; do not weaken the guard.
-- Operationally: run this before any media_migration_switch call under the new semantics (the Track C copy rehearsal), or accept the guard.

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

CREATE OR REPLACE FUNCTION app.media_storage_key_assign()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.media_migration_switch(p_namespace text, p_key text, p_owner uuid, p_size bigint, p_content_type text, p_sha256 text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m jsonb; v_limit bigint;
begin
  -- Serialize against publish/delete/finalize of the canonical record, not just the mapping.
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
  insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,size_bytes,sha256,verified_at,organization_id)
    values(p_namespace,p_key,p_owner,'r2',p_content_type,p_size,p_sha256,now(),(m->>'organization')::uuid)
    on conflict(namespace,object_key) do update set provider='r2',size_bytes=excluded.size_bytes,
      sha256=excluded.sha256,verified_at=now();
  insert into public.media_migration_ledger(namespace,object_key,owner_user_id,size_bytes,sha256)
    values(p_namespace,p_key,p_owner,p_size,p_sha256)
    on conflict(namespace,object_key) do update set switched_at=now(),rolled_back_at=null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.media_migration_rollback(p_namespace text, p_key text, p_sha256 text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists(select 1 from public.media_migration_ledger where namespace=p_namespace and object_key=p_key and sha256=p_sha256) then
    raise exception 'no verified legacy migration' using errcode='42501';
  end if;
  update public.media_storage_locations set provider='supabase' where namespace=p_namespace and object_key=p_key and sha256=p_sha256;
  update public.media_migration_ledger set rolled_back_at=now() where namespace=p_namespace and object_key=p_key;
end;
$function$;

-- Added by the media migration; nothing else calls it after the switch function above is restored.
drop function public.media_migration_target_key(text, text);

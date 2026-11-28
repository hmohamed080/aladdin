-- Forward-only RC2 adaptation of the verified R2 provider foundation; no historical migration replay.
-- Explicit provider identity + backend-only evidence. No legacy rows are rewritten.
create table public.media_storage_locations (
  namespace text not null check (namespace in ('avatar','portfolio','certificate','product','organization')),
  object_key text not null,
  owner_user_id uuid not null references public.users(id),
  organization_id uuid references public.organizations(id),
  provider text not null check (provider in ('supabase','r2')),
  content_type text not null,
  size_bytes bigint,
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  cleaned_at timestamptz,
  primary key (namespace,object_key),
  check (size_bytes is null or size_bytes > 0)
);
alter table public.media_storage_locations enable row level security;
revoke all on public.media_storage_locations from anon,authenticated,service_role;
grant select on public.media_storage_locations to authenticated,service_role;
create policy media_locations_owner_read on public.media_storage_locations
  for select to authenticated using (owner_user_id = (select auth.uid()));
create index media_locations_owner_created on public.media_storage_locations(owner_user_id,created_at);
create index media_locations_org_created on public.media_storage_locations(organization_id,created_at);
-- A stable retirement marker makes retry cleanup choose the exact latest removed logo,
-- even when several lifecycle changes share PostgreSQL's transaction timestamp.
alter table public.organization_images add column retired_at timestamptz;

create function app.media_metadata(p_namespace text,p_key text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('owner',owner_user_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.portfolio_items where p_namespace='portfolio' and object_key=p_key
  union all
  select jsonb_build_object('owner',owner_user_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.professional_certificates where p_namespace='certificate' and object_path=p_key
  union all
  select jsonb_build_object('owner',owner_user_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.avatar_uploads where p_namespace='avatar' and object_key=p_key
  union all
  select jsonb_build_object('owner',created_by,'organization',organization_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.product_images where p_namespace='product' and object_key=p_key
  union all
  select jsonb_build_object('owner',created_by,'organization',organization_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.organization_images where p_namespace='organization' and object_key=p_key;
$$;
revoke all on function app.media_metadata(text,text) from public,anon,authenticated,service_role;

create function public.media_storage_resolve(p_namespace text,p_key text,p_operation text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb; v_provider text; v_owner boolean; v_allowed boolean := false;
begin
  if p_namespace in ('product','organization') then
    return public.organization_media_resolve(p_namespace,p_key,p_operation,null);
  end if;
  m := app.media_metadata(p_namespace,p_key);
  if m is null then return null; end if;
  v_owner := (m->>'owner')::uuid = (select auth.uid());
  if p_operation='upload' then
    v_allowed := v_owner and m->>'state'='pending' and app.account_is_active((select auth.uid()))
      and (m->>'createdAt')::timestamptz > now()-interval '24 hours';
  elsif p_operation='delete' then
    v_allowed := v_owner and m->>'state'='deleted';
  elsif p_operation='read' then
    v_allowed := (v_owner and m->>'state'<>'deleted')
      or (p_namespace='portfolio' and app.is_published_portfolio_object(p_key))
      or (p_namespace='avatar' and app.is_current_avatar_object(p_key));
  end if;
  if not coalesce(v_allowed,false) then return null; end if;
  select provider into v_provider from public.media_storage_locations
    where namespace=p_namespace and object_key=p_key;
  -- Only an absent explicit mapping means legacy Supabase; a failed query never falls back.
  return jsonb_build_object('provider',coalesce(v_provider,'supabase'),'reserved',v_provider is not null,
    'contentType',m->>'contentType','state',m->>'state','owner',case when v_owner then m->>'owner' else null end);
end;
$$;
revoke all on function public.media_storage_resolve(text,text,text) from public;
grant execute on function public.media_storage_resolve(text,text,text) to anon,authenticated;

create function public.media_storage_reserve(p_namespace text,p_key text,p_provider text,p_owner uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb; v_existing text; v_uid uuid; v_org uuid;
begin
  v_uid := case when auth.jwt()->>'role'='service_role' then p_owner else (select auth.uid()) end;
  m := app.media_metadata(p_namespace,p_key);
  v_org := (m->>'organization')::uuid;
  if v_org is not null and coalesce(auth.jwt()->>'role','')<>'service_role'
    and not (case p_namespace when 'product' then app.can_upload_product_image_object(p_key)
      else app.can_upload_organization_image_object(p_key) end) then
    raise exception 'organization upload not authorized' using errcode='42501';
  end if;
  if m is null or v_uid is null or (m->>'owner')::uuid<>v_uid or m->>'state'<>'pending'
    or not app.account_is_active(v_uid) or (m->>'createdAt')::timestamptz <= now()-interval '24 hours' then
    raise exception 'upload not authorized' using errcode='42501';
  end if;
  if p_provider='r2' and coalesce(auth.jwt()->>'role','')<>'service_role' then
    raise exception 'R2 routing requires backend authorization' using errcode='42501';
  end if;
  if p_provider not in ('supabase','r2') then raise exception 'invalid provider' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text,11));
  if v_org is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_org::text,13));
    if not exists(select 1 from public.organizations where id=v_org and deleted_at is null) then
      raise exception 'organization unavailable' using errcode='42501';
    end if;
  end if;
  select provider into v_existing from public.media_storage_locations where namespace=p_namespace and object_key=p_key;
  if v_existing is not null then
    if v_existing<>p_provider then raise exception 'provider is immutable' using errcode='22023'; end if;
    return;
  end if;
  if (select count(*) from public.media_storage_locations where owner_user_id=v_uid
      and created_at>now()-interval '1 hour') >= 50 then
    raise exception 'upload rate limit' using errcode='54000';
  end if;
  if (select coalesce(sum(coalesce(size_bytes,10485760)),0) from public.media_storage_locations l
      where owner_user_id=v_uid and coalesce(app.media_metadata(l.namespace,l.object_key)->>'state','deleted')<>'deleted') + 10485760 > 1073741824 then
    raise exception 'upload quota exceeded' using errcode='54000';
  end if;
  if v_org is not null then
    if (select count(*) from public.media_storage_locations where organization_id=v_org and created_at>now()-interval '1 hour')>=50 then
      raise exception 'organization upload rate limit' using errcode='54000';
    end if;
    if (select coalesce(sum(coalesce(size_bytes,10485760)),0) from public.media_storage_locations l
       where organization_id=v_org and coalesce(app.media_metadata(l.namespace,l.object_key)->>'state','deleted')<>'deleted')+10485760>1073741824 then
      raise exception 'organization upload quota exceeded' using errcode='54000';
    end if;
  end if;
  insert into public.media_storage_locations(namespace,object_key,owner_user_id,provider,content_type,organization_id)
  values(p_namespace,p_key,v_uid,p_provider,m->>'contentType',v_org);
end;
$$;
revoke all on function public.media_storage_reserve(text,text,text,uuid) from public;
grant execute on function public.media_storage_reserve(text,text,text,uuid) to authenticated,service_role;

create function public.media_storage_attest(p_namespace text,p_key text,p_owner uuid,
  p_provider text,p_size bigint,p_content_type text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb; v_limit bigint; v_existing public.media_storage_locations;
begin
  m := app.media_metadata(p_namespace,p_key);
  v_limit := case p_namespace when 'avatar' then 3145728 when 'portfolio' then 5242880 when 'certificate' then 10485760 when 'product' then 5242880 when 'organization' then 3145728 end;
  if m is null or p_owner is null or p_size is null or p_sha256 is null or p_content_type is null
    or (m->>'owner')::uuid<>p_owner or m->>'state'<>'pending'
    or m->>'contentType'<>p_content_type or p_size<=0 or p_size>v_limit
    or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid verification receipt' using errcode='42501';
  end if;
  select * into v_existing from public.media_storage_locations
    where namespace=p_namespace and object_key=p_key for update;
  if not found or v_existing.provider<>p_provider or v_existing.owner_user_id<>p_owner then
    raise exception 'missing provider reservation' using errcode='42501';
  end if;
  if v_existing.verified_at is not null and
    (v_existing.sha256<>p_sha256 or v_existing.size_bytes<>p_size) then
    raise exception 'immutable receipt conflict' using errcode='42501';
  end if;
  update public.media_storage_locations set size_bytes=p_size,sha256=p_sha256,verified_at=now()
    where namespace=p_namespace and object_key=p_key;
end;
$$;
revoke all on function public.media_storage_attest(text,text,uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.media_storage_attest(text,text,uuid,text,bigint,text,text) to service_role;

create function app.require_verified_media() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_key text; v_namespace text;
begin
  if old.state='pending' and new.state='ready' then
    v_namespace := case tg_table_name when 'portfolio_items' then 'portfolio'
      when 'professional_certificates' then 'certificate' when 'product_images' then 'product' when 'organization_images' then 'organization' else 'avatar' end;
    v_key := case when tg_table_name='professional_certificates' then to_jsonb(new)->>'object_path'
      else to_jsonb(new)->>'object_key' end;
    if not exists(select 1 from public.media_storage_locations
      where namespace=v_namespace and object_key=v_key and owner_user_id=coalesce(to_jsonb(new)->>'owner_user_id',to_jsonb(new)->>'created_by')::uuid
        and content_type=new.content_type and verified_at>now()-interval '10 minutes'
        and size_bytes>0 and sha256 is not null) then
      raise exception 'stored object has not been verified' using errcode='42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function app.require_verified_media() from public,anon,authenticated,service_role;
create trigger portfolio_verified_before_ready before update on public.portfolio_items
  for each row execute function app.require_verified_media();
create trigger certificate_verified_before_ready before update on public.professional_certificates
  for each row execute function app.require_verified_media();
create trigger avatar_verified_before_ready before update on public.avatar_uploads
  for each row execute function app.require_verified_media();

-- Certificates previously allowed insertion by path shape after finalization. Bind insertion to pending metadata.
drop policy professional_certificates_insert_own on storage.objects;
create policy professional_certificates_insert_own on storage.objects for insert to authenticated
  with check(bucket_id='professional-certificates' and app.can_create_professional_asset()
    and exists(select 1 from public.professional_certificates c where c.object_path=name
      and c.owner_user_id=(select auth.uid()) and c.state='pending'));

-- Uploaded bytes cannot disappear between verification and finalization. Product revocation always comes first.
drop policy professional_portfolio_delete_own on storage.objects;
create policy professional_portfolio_delete_own on storage.objects for delete to authenticated
  using(bucket_id='professional-portfolio' and app.owns_portfolio_object(name)
    and app.media_metadata('portfolio',name)->>'state'='deleted');
drop policy professional_certificates_delete_own on storage.objects;
create policy professional_certificates_delete_own on storage.objects for delete to authenticated
  using(bucket_id='professional-certificates' and app.is_professional_asset_key(name,(select auth.uid()))
    and app.media_metadata('certificate',name)->>'state'='deleted');
drop policy avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using(bucket_id='avatars' and app.owns_avatar_object(name)
    and app.media_metadata('avatar',name)->>'state'='deleted');
-- Boolean-only wrapper avoids granting the internal metadata resolver to a Storage caller.
create function app.media_is_deleted(p_namespace text,p_key text) returns boolean
language sql stable security definer set search_path='' as $$
  select app.media_metadata(p_namespace,p_key)->>'state'='deleted';
$$;
revoke all on function app.media_is_deleted(text,text) from public;
grant execute on function app.media_is_deleted(text,text) to authenticated;
alter policy professional_portfolio_delete_own on storage.objects
  using(bucket_id='professional-portfolio' and app.owns_portfolio_object(name) and app.media_is_deleted('portfolio',name));
alter policy professional_certificates_delete_own on storage.objects
  using(bucket_id='professional-certificates' and app.is_professional_asset_key(name,(select auth.uid())) and app.media_is_deleted('certificate',name));
alter policy avatars_delete_own on storage.objects
  using(bucket_id='avatars' and app.owns_avatar_object(name) and app.media_is_deleted('avatar',name));

create function app.limit_pending_media() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_user_id::text,11));
  select (select count(*) from public.portfolio_items where owner_user_id=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.professional_certificates where owner_user_id=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.avatar_uploads where owner_user_id=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours') + (select count(*) from public.product_images where created_by=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.organization_images where created_by=new.owner_user_id and state='pending' and created_at>now()-interval '24 hours') into v_count;
  if v_count>=10 then raise exception 'too many pending uploads' using errcode='54000'; end if;
  return new;
end;
$$;
revoke all on function app.limit_pending_media() from public,anon,authenticated,service_role;
create trigger portfolio_pending_limit before insert on public.portfolio_items for each row execute function app.limit_pending_media();
create trigger certificate_pending_limit before insert on public.professional_certificates for each row execute function app.limit_pending_media();
create trigger avatar_pending_limit before insert on public.avatar_uploads for each row execute function app.limit_pending_media();

-- Preserve the authoritative replacement transaction; add serialization and safe retries.
create or replace function public.avatar_confirm_upload(p_object_key text)
returns text language plpgsql security definer set search_path='' as $$
declare v_uid uuid := (select auth.uid()); v_upload public.avatar_uploads; v_prev_id uuid; v_prev_key text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  select avatar_media_id into v_prev_id from public.profiles where user_id=v_uid for update;
  select * into v_upload from public.avatar_uploads where object_key=p_object_key and owner_user_id=v_uid for update;
  if not found then raise exception 'avatar not found' using errcode='42501'; end if;
  if v_upload.state='ready' and v_prev_id=v_upload.id then return null; end if;
  if v_upload.state<>'pending' then raise exception 'avatar is not pending' using errcode='42501'; end if;
  if v_prev_id is not null then
    select object_key into v_prev_key from public.avatar_uploads where id=v_prev_id;
  end if;
  update public.avatar_uploads set state='ready' where id=v_upload.id;
  update public.profiles set avatar_media_id=v_upload.id where user_id=v_uid;
  if v_prev_id is not null then update public.avatar_uploads set state='deleted' where id=v_prev_id; end if;
  perform app.record_audit_event('profile.avatar_set','user',v_uid,null,jsonb_build_object('object_key',p_object_key));
  return v_prev_key;
end;
$$;

create function public.avatar_delete_current() returns text
language plpgsql security definer set search_path='' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_key text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode='42501'; end if;
  select avatar_media_id into v_id from public.profiles where user_id=v_uid for update;
  select object_key into v_key from public.avatar_uploads where id=v_id and owner_user_id=v_uid;
  update public.profiles set avatar_media_id=null where user_id=v_uid;
  update public.avatar_uploads set state='deleted' where id=v_id and owner_user_id=v_uid;
  perform app.record_audit_event('profile.avatar_set','user',v_uid,null,jsonb_build_object('removed',true));
  return v_key;
end;
$$;
revoke all on function public.avatar_delete_current() from public;
grant execute on function public.avatar_delete_current() to authenticated;

-- The old placeholder column grant predates avatars. Only the owner-checked RPC may change this FK.
revoke update(avatar_media_id) on public.profiles from authenticated;

create table public.media_migration_ledger (
  namespace text not null,
  object_key text not null,
  owner_user_id uuid not null references public.users(id),
  source_provider text not null default 'supabase' check(source_provider='supabase'),
  size_bytes bigint not null check(size_bytes>0),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  switched_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  primary key(namespace,object_key)
);
alter table public.media_migration_ledger enable row level security;
revoke all on public.media_migration_ledger from public,anon,authenticated,service_role;
grant select on public.media_migration_ledger to service_role;

create function public.media_migration_inventory(p_limit integer default 25,p_after text default '')
returns table(namespace text,object_key text,owner_user_id uuid,content_type text,provider text,
  source_exists boolean,max_bytes bigint,cursor_key text,migration_tracked boolean)
language sql stable security definer set search_path='' as $$
  with media as (
    select 'avatar'::text ns,a.object_key key,a.owner_user_id owner,a.content_type mime,'avatars'::text bucket,3145728::bigint lim
      from public.avatar_uploads a where a.state='ready'
    union all
    select 'portfolio',i.object_key,i.owner_user_id,i.content_type,'professional-portfolio',5242880
      from public.portfolio_items i where i.state='ready'
    union all
    select 'certificate',c.object_path,c.owner_user_id,c.content_type,'professional-certificates',10485760
      from public.professional_certificates c where c.state='ready'
    union all
    select 'product',i.object_key,i.created_by,i.content_type,'product-images',5242880 from public.product_images i where i.state='ready'
    union all
    select 'organization',i.object_key,i.created_by,i.content_type,'organization-images',3145728 from public.organization_images i where i.state='ready'
  )
  select m.ns,m.key,m.owner,m.mime,coalesce(l.provider,'supabase'),o.id is not null,m.lim,m.ns||'/'||m.key,exists(select 1 from public.media_migration_ledger g where g.namespace=m.ns and g.object_key=m.key)
    from media m left join public.media_storage_locations l on l.namespace=m.ns and l.object_key=m.key
    left join storage.objects o on o.bucket_id=m.bucket and o.name=m.key
    where m.ns||'/'||m.key>p_after order by m.ns||'/'||m.key limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.media_migration_inventory(integer,text) from public,anon,authenticated;
grant execute on function public.media_migration_inventory(integer,text) to service_role;

create function public.media_migration_switch(p_namespace text,p_key text,p_owner uuid,
  p_size bigint,p_content_type text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
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
$$;
revoke all on function public.media_migration_switch(text,text,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.media_migration_switch(text,text,uuid,bigint,text,text) to service_role;

create function public.media_migration_rollback(p_namespace text,p_key text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.media_migration_ledger where namespace=p_namespace and object_key=p_key and sha256=p_sha256) then
    raise exception 'no verified legacy migration' using errcode='42501';
  end if;
  update public.media_storage_locations set provider='supabase' where namespace=p_namespace and object_key=p_key and sha256=p_sha256;
  update public.media_migration_ledger set rolled_back_at=now() where namespace=p_namespace and object_key=p_key;
end;
$$;
revoke all on function public.media_migration_rollback(text,text,text) from public,anon,authenticated;
grant execute on function public.media_migration_rollback(text,text,text) to service_role;

create function public.media_storage_metrics() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('providers',coalesce((select jsonb_agg(s) from
    (select provider,count(*) as records,sum(size_bytes) as verified_bytes from public.media_storage_locations l where coalesce(app.media_metadata(l.namespace,l.object_key)->>'state','deleted')<>'deleted' group by provider) s),'[]'::jsonb),
    'stale_pending', (select count(*) from public.portfolio_items where state='pending' and created_at<now()-interval '24 hours')
      +(select count(*) from public.professional_certificates where state='pending' and created_at<now()-interval '24 hours')
      +(select count(*) from public.avatar_uploads where state='pending' and created_at<now()-interval '24 hours')
      +(select count(*) from public.product_images where state='pending' and created_at<now()-interval '24 hours')
      +(select count(*) from public.organization_images where state='pending' and created_at<now()-interval '24 hours'));
$$;
revoke all on function public.media_storage_metrics() from public,anon,authenticated;
grant execute on function public.media_storage_metrics() to service_role;

create function public.media_cleanup_candidates(p_limit integer default 25)
returns table(namespace text,object_key text,owner_user_id uuid,provider text)
language sql stable security definer set search_path='' as $$
  with candidates as (
    select 'portfolio'::text ns,object_key key,owner_user_id owner,created_at from public.portfolio_items
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'certificate',object_path,owner_user_id,created_at from public.professional_certificates
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'avatar',object_key,owner_user_id,created_at from public.avatar_uploads
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'product',object_key,created_by,created_at from public.product_images
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'organization',object_key,created_by,created_at from public.organization_images
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
  ) select c.ns,c.key,c.owner,coalesce(l.provider,'supabase') from candidates c
    join public.media_storage_locations l on l.namespace=c.ns and l.object_key=c.key
    where l.provider='r2' and l.cleaned_at is null
    order by c.created_at limit least(greatest(p_limit,1),100);
$$;
revoke all on function public.media_cleanup_candidates(integer) from public,anon,authenticated;
grant execute on function public.media_cleanup_candidates(integer) to service_role;

create function public.media_cleanup_retire(p_namespace text,p_key text,p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_namespace='portfolio' then
    update public.portfolio_items set visibility='private',state='deleted'
      where object_key=p_key and owner_user_id=p_owner and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='certificate' then
    update public.professional_certificates set state='deleted'
      where object_path=p_key and owner_user_id=p_owner and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='avatar' then
    update public.avatar_uploads set state='deleted'
      where object_key=p_key and owner_user_id=p_owner and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='product' then
    update public.product_images set state='deleted' where object_key=p_key and created_by=p_owner
      and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='organization' then
    update public.organization_images set state='deleted' where object_key=p_key and created_by=p_owner
      and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  else raise exception 'invalid namespace' using errcode='22023'; end if;
  if not found then raise exception 'cleanup snapshot is stale' using errcode='42501'; end if;
end;
$$;
revoke all on function public.media_cleanup_retire(text,text,uuid) from public,anon,authenticated;
grant execute on function public.media_cleanup_retire(text,text,uuid) to service_role;

-- Preserve canonical tombstones and auditability; stop retrying completed physical cleanup.
create function public.media_cleanup_complete(p_namespace text,p_key text,p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(app.media_metadata(p_namespace,p_key)->>'state','')<>'deleted' then
    raise exception 'cleanup requires retired metadata' using errcode='42501';
  end if;
  update public.media_storage_locations set cleaned_at=now()
    where namespace=p_namespace and object_key=p_key and owner_user_id=p_owner and provider='r2';
  if not found then raise exception 'cleanup mapping mismatch' using errcode='42501'; end if;
end;
$$;
revoke all on function public.media_cleanup_complete(text,text,uuid) from public,anon,authenticated;
grant execute on function public.media_cleanup_complete(text,text,uuid) to service_role;

create function public.media_source_inventory_summary() returns jsonb
language sql stable security definer set search_path='' as $$
  with media_references as (
    select 'avatars'::text bucket,object_key key from public.avatar_uploads
    union all select 'professional-portfolio',object_key from public.portfolio_items
    union all select 'professional-certificates',object_path from public.professional_certificates
    union all select 'product-images',object_key from public.product_images
    union all select 'organization-images',object_key from public.organization_images
  ), buckets as (
    select unnest(array['avatars','professional-portfolio','professional-certificates','product-images','organization-images']) bucket
  ) select coalesce(jsonb_agg(s),'[]'::jsonb) from (
    select b.bucket,
      (select count(*) from storage.objects o where o.bucket_id=b.bucket) as source_objects,
      (select count(*) from storage.objects o where o.bucket_id=b.bucket and not exists
        (select 1 from media_references r where r.bucket=b.bucket and r.key=o.name)) as orphan_objects,
      (select count(*) from media_references r where r.bucket=b.bucket and not exists
        (select 1 from storage.objects o where o.bucket_id=b.bucket and o.name=r.key)) as missing_references
    from buckets b
  ) s;
$$;
revoke all on function public.media_source_inventory_summary() from public,anon,authenticated;
grant execute on function public.media_source_inventory_summary() to service_role;

-- Organization ownership is distinct from the uploader. These checks use the
-- current caller's RC2 capabilities and explicit workspace, never a bearer grant.
create function public.organization_media_resolve(p_namespace text,p_key text,p_operation text,p_workspace uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb; allowed boolean := false; v_provider text; v_uid uuid := (select auth.uid());
begin
  if p_namespace not in ('product','organization') or v_uid is null or not app.account_is_active(v_uid) then return null; end if;
  m:=app.media_metadata(p_namespace,p_key);
  if m is null or not exists(select 1 from public.organizations where id=(m->>'organization')::uuid and deleted_at is null) then return null; end if;
  if p_operation='upload' then
    allowed:=m->>'state'='pending' and (m->>'createdAt')::timestamptz>now()-interval '24 hours'
      and case p_namespace when 'product' then app.can_upload_product_image_object(p_key)
          else app.can_upload_organization_image_object(p_key) end;
  elsif p_operation='read' then
    if p_namespace='product' then
      allowed:=m->>'state'='ready' and (app.is_org_member((m->>'organization')::uuid)
        or exists(select 1 from public.product_images i where i.object_key=p_key
          and app.product_is_public(i.product_id) and app.product_image_viewable(i.product_id,p_workspace)));
    else
      allowed:=m->>'state'='ready' and exists(select 1 from public.organization_images i
        join public.organizations o on o.logo_media_id=i.id where i.object_key=p_key and app.is_org_member(o.id));
    end if;
  elsif p_operation='delete' then
    allowed:=m->>'state'='deleted' and case p_namespace when 'product' then app.can_write_catalog((m->>'organization')::uuid)
      else app.has_capability((m->>'organization')::uuid,'org.manage') end;
  end if;
  if not coalesce(allowed,false) then return null; end if;
  select provider into v_provider from public.media_storage_locations where namespace=p_namespace and object_key=p_key;
  return jsonb_build_object('provider',coalesce(v_provider,'supabase'),'reserved',v_provider is not null,
    'contentType',m->>'contentType','state',m->>'state',
    'owner',case when p_operation='upload' or (m->>'owner')::uuid=v_uid then m->>'owner' else null end);
end;
$$;
revoke all on function public.organization_media_resolve(text,text,text,uuid) from public,anon,service_role;
grant execute on function public.organization_media_resolve(text,text,text,uuid) to authenticated;

create function public.organization_media_read_keys(p_namespace text,p_keys text[],p_workspace uuid default null)
returns text[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(distinct k),'{}'::text[]) from unnest(p_keys[1:60]) k
    where public.organization_media_resolve(p_namespace,k,'read',p_workspace) is not null;
$$;
revoke all on function public.organization_media_read_keys(text,text[],uuid) from public,anon,service_role;
grant execute on function public.organization_media_read_keys(text,text[],uuid) to authenticated;

create trigger product_verified_before_ready before update on public.product_images
  for each row execute function app.require_verified_media();
create trigger organization_image_verified_before_ready before update on public.organization_images
  for each row execute function app.require_verified_media();

create function app.limit_pending_organization_media() returns trigger
language plpgsql security definer set search_path='' as $$
declare pending bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.created_by::text,11));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.organization_id::text,13));
  select (select count(*) from public.product_images where organization_id=new.organization_id and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.organization_images where organization_id=new.organization_id and state='pending' and created_at>now()-interval '24 hours') into pending;
  if pending>=10 then raise exception 'organization pending upload limit' using errcode='54000'; end if;
  select (select count(*) from public.product_images where created_by=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.organization_images where created_by=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.avatar_uploads where owner_user_id=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.portfolio_items where owner_user_id=new.created_by and state='pending' and created_at>now()-interval '24 hours')
       + (select count(*) from public.professional_certificates where owner_user_id=new.created_by and state='pending' and created_at>now()-interval '24 hours') into pending;
  if pending>=10 then raise exception 'user pending upload limit' using errcode='54000'; end if;
  return new;
end;
$$;
revoke all on function app.limit_pending_organization_media() from public,anon,authenticated,service_role;
create trigger product_pending_media_limit before insert on public.product_images for each row execute function app.limit_pending_organization_media();
create trigger organization_pending_media_limit before insert on public.organization_images for each row execute function app.limit_pending_organization_media();

-- Retrying confirmation must not duplicate audits or revive a replaced image.
create or replace function public.product_image_confirm_upload(p_object_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_i public.product_images;
begin
  select * into v_i from public.product_images where object_key=p_object_key
    and state in ('pending','ready') and created_by=(select auth.uid()) for update;
  if not found then raise exception 'no matching image upload' using errcode='P0002'; end if;
  if not app.can_write_catalog(v_i.organization_id) then raise exception 'catalog.write required' using errcode='42501'; end if;
  if v_i.state='ready' then return v_i.id; end if;
  update public.product_images set state='ready' where id=v_i.id;
  perform app.record_audit_event('product.image_added','product',v_i.product_id,v_i.organization_id,jsonb_build_object('slot',v_i.slot));
  return v_i.id;
end;
$$;

create or replace function public.organization_image_confirm_upload(p_object_key text)
returns text language plpgsql security definer set search_path='' as $$
declare v_row public.organization_images; v_org uuid; v_prev uuid; v_prev_key text;
begin
  select organization_id into v_org from public.organization_images where object_key=p_object_key;
  if v_org is null then raise exception 'image upload not found' using errcode='P0002'; end if;
  select logo_media_id into v_prev from public.organizations where id=v_org and deleted_at is null for update;
  if not found or not app.has_capability(v_org,'org.manage') then raise exception 'org.manage required' using errcode='42501'; end if;
  select * into v_row from public.organization_images where object_key=p_object_key for update;
  if v_row.state='ready' and v_prev=v_row.id then
    select object_key into v_prev_key from public.organization_images
      where organization_id=v_org and state='deleted' order by retired_at desc nulls last,updated_at desc,id limit 1;
    return v_prev_key;
  end if;
  if v_row.state<>'pending' then raise exception 'no matching pending image' using errcode='P0002'; end if;
  if v_prev is not null then select object_key into v_prev_key from public.organization_images where id=v_prev; end if;
  update public.organization_images set state='ready' where id=v_row.id;
  update public.organizations set logo_media_id=v_row.id where id=v_org;
  if v_prev is not null then update public.organization_images set state='deleted',retired_at=clock_timestamp() where id=v_prev; end if;
  perform app.record_audit_event('organization.image_set','organization',v_org,v_org,jsonb_build_object('image_id',v_row.id));
  return v_prev_key;
end;
$$;

create or replace function public.product_image_remove(p_image_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_i public.product_images;
begin
  select * into v_i from public.product_images where id=p_image_id for update;
  if not found then raise exception 'image not found' using errcode='P0002'; end if;
  if not app.can_write_catalog(v_i.organization_id) then raise exception 'catalog.write required' using errcode='42501'; end if;
  if v_i.state<>'deleted' then
    update public.product_images set state='deleted' where id=v_i.id;
    perform app.record_audit_event('product.image_removed','product',v_i.product_id,v_i.organization_id,jsonb_build_object('slot',v_i.slot));
  end if;
  return v_i.object_key;
end;
$$;

create or replace function public.organization_image_remove(p_org_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_prev uuid; v_key text;
begin
  if not app.has_capability(p_org_id,'org.manage') then raise exception 'org.manage required' using errcode='42501'; end if;
  select logo_media_id into v_prev from public.organizations where id=p_org_id and deleted_at is null for update;
  if not found then raise exception 'organization not found' using errcode='P0002'; end if;
  if v_prev is null then
    select object_key into v_key from public.organization_images where organization_id=p_org_id and state='deleted' order by retired_at desc nulls last,updated_at desc,id limit 1;
    return v_key;
  end if;
  select object_key into v_key from public.organization_images where id=v_prev;
  update public.organizations set logo_media_id=null where id=p_org_id;
  update public.organization_images set state='deleted',retired_at=clock_timestamp() where id=v_prev;
  perform app.record_audit_event('organization.image_removed','organization',p_org_id,p_org_id,jsonb_build_object('image_id',v_prev));
  return v_key;
end;
$$;

-- New routines must not inherit extra direct API grants from creator defaults.
revoke execute on function app.limit_pending_media() from public,anon,authenticated,service_role;
revoke execute on function app.limit_pending_organization_media() from public,anon,authenticated,service_role;
revoke execute on function app.media_is_deleted(text,text) from public,anon,service_role;
revoke execute on function app.media_metadata(text,text) from public,anon,authenticated,service_role;
revoke execute on function app.require_verified_media() from public,anon,authenticated,service_role;
revoke execute on function public.avatar_delete_current() from public,anon,service_role;
revoke execute on function public.media_cleanup_candidates(integer) from public,anon,authenticated;
revoke execute on function public.media_cleanup_complete(text,text,uuid) from public,anon,authenticated;
revoke execute on function public.media_cleanup_retire(text,text,uuid) from public,anon,authenticated;
revoke execute on function public.media_migration_inventory(integer,text) from public,anon,authenticated;
revoke execute on function public.media_migration_rollback(text,text,text) from public,anon,authenticated;
revoke execute on function public.media_migration_switch(text,text,uuid,bigint,text,text) from public,anon,authenticated;
revoke execute on function public.media_source_inventory_summary() from public,anon,authenticated;
revoke execute on function public.media_storage_attest(text,text,uuid,text,bigint,text,text) from public,anon,authenticated;
revoke execute on function public.media_storage_metrics() from public,anon,authenticated;
revoke execute on function public.media_storage_reserve(text,text,text,uuid) from public,anon;
revoke execute on function public.media_storage_resolve(text,text,text) from public,service_role;
revoke execute on function public.organization_media_read_keys(text,text[],uuid) from public,anon,service_role;
revoke execute on function public.organization_media_resolve(text,text,text,uuid) from public,anon,service_role;

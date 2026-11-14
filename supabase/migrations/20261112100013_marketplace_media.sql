-- ===========================================================================
-- migration-policy: destructive-reviewed - every dropped object (marketplace_public_image_ref signature, the image storage_provider/storage_bucket columns and the five app.marketplace_storage_* predicates) was created by Migrations 06/07/09 of this same Marketplace release, never applied to Acceptance or Production; no promoted application uses them
-- Marketplace — Migration 13: product photos join the central media system (R2)
-- ===========================================================================
-- Owner decision (2026-11-01, see 20261107090005): no application file bytes in
-- Supabase Storage. Marketplace product photos therefore use the SAME central
-- media system as every other namespace, exactly the way 20261107090005 brought
-- purchase-request photos and business-verification documents in:
--
--   marketplace   o/<org>/products/<product>/<media id>/original.<ext>   (the organization's products/ folder)
--
-- One new namespace, 'marketplace', reuses the existing reservation, verification
-- receipt, resolver, ids-only key, edge and cleanup functions. Each central function
-- below is a create-or-replace of its CURRENT definition with one added branch:
-- no signature, owner, search_path or grant changes, and the other seven namespaces
-- behave exactly as before.
--
-- Authorization stays with the Marketplace predicates (an enabled seller's catalogue
-- manager uploads and deletes; members and media moderators read). The public
-- shop reads through marketplace_public_image_ref (service role only), unchanged.
--
-- Bulk-import photos are paused: an import accepts the spreadsheet only until import
-- photos get their own media flow (the old flow staged bytes in a storage bucket).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Image rows carry the uploader (the media owner) and point at the media system
-- ---------------------------------------------------------------------------
alter table public.marketplace_product_images
  add column created_by uuid references public.users(id) on delete set null;
comment on column public.marketplace_product_images.created_by is
  'The user who requested the upload: the owner of its central media record (media_storage_locations).';

-- ---------------------------------------------------------------------------
-- 2. The namespace in the central location table
-- ---------------------------------------------------------------------------
alter table public.media_storage_locations drop constraint media_storage_locations_namespace_check;
alter table public.media_storage_locations add constraint media_storage_locations_namespace_check
  check (namespace in ('avatar','portfolio','certificate','product','organization','request','verification','marketplace'));

-- The physical R2 key uses the organization's existing products/ folder (media architecture v3:
-- o/<org>/products/<product>/<media id>/original.<ext>), so the storage_key check is unchanged.

-- ---------------------------------------------------------------------------
-- 3. Marketplace predicates (internal)
-- ---------------------------------------------------------------------------
-- Upload: a server-issued, still-fresh key, for a catalogue manager of an enabled seller.
create or replace function app.marketplace_media_can_upload(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key
      and i.upload_state = 'awaiting_upload'
      and i.created_at > now() - interval '1 hour'
      and app.marketplace_can_manage_catalog(p.seller_organization_id)
      and app.marketplace_seller_is_enabled(p.seller_organization_id));
$$;

-- Read (signed-in): a member of the seller organization, or a media moderator.
create or replace function app.marketplace_media_can_read(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state = 'confirmed'
      and (app.is_org_member(p.seller_organization_id) or app.has_admin_permission('marketplace_media.moderate')));
$$;

-- Delete: only bytes of a row awaiting upload or marked for removal, by a catalogue manager.
create or replace function app.marketplace_media_can_delete(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state in ('awaiting_upload', 'deleting')
      and app.marketplace_can_manage_catalog(p.seller_organization_id));
$$;

-- awaiting_upload -> confirmed requires the provider-bound verification receipt
-- (the Marketplace counterpart of app.require_verified_media, whose columns differ).
create or replace function app.marketplace_require_verified_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.upload_state = 'awaiting_upload' and new.upload_state = 'confirmed'
     and not exists (select 1 from public.media_storage_locations l
       where l.namespace = 'marketplace' and l.object_key = new.object_key
         and l.owner_user_id = new.created_by and l.content_type = new.mime_type
         and l.verified_at > now() - interval '10 minutes' and l.size_bytes > 0 and l.sha256 is not null) then
    raise exception 'stored object has not been verified' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger marketplace_image_verified_before_confirmed before update on public.marketplace_product_images
  for each row execute function app.marketplace_require_verified_media();

-- ---------------------------------------------------------------------------
-- 4. Central media functions: current definitions + the 'marketplace' branch
-- ---------------------------------------------------------------------------
create or replace function app.media_metadata(p_namespace text,p_key text)
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
  from public.organization_images where p_namespace='organization' and object_key=p_key
  union all
  select jsonb_build_object('owner',i.created_by,'organization',r.requester_org_id,'contentType',i.content_type,'state',i.state,'createdAt',i.created_at)
  from public.purchase_request_images i join public.purchase_requests r on r.id=i.request_id
  where p_namespace='request' and i.object_key=p_key
  union all
  select jsonb_build_object('owner',created_by,'organization',organization_id,'contentType',content_type,'state',state,'createdAt',created_at)
  from public.business_verification_documents where p_namespace='verification' and object_key=p_key
  union all
  select jsonb_build_object('owner',i.created_by,'organization',p.seller_organization_id,'contentType',i.mime_type,
    'state',case i.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt',i.created_at)
  from public.marketplace_product_images i join public.marketplace_products p on p.id=i.product_id
  where p_namespace='marketplace' and i.object_key=p_key;
$$;

create or replace function public.media_storage_resolve(p_namespace text,p_key text,p_operation text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb; v_provider text; v_owner boolean; v_allowed boolean := false;
begin
  if p_namespace in ('product','organization','request','verification','marketplace') then
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
  return jsonb_build_object('provider',coalesce(v_provider,'supabase'),'reserved',v_provider is not null,
    'contentType',m->>'contentType','state',m->>'state','owner',case when v_owner then m->>'owner' else null end);
end;
$$;

create or replace function public.organization_media_resolve(p_namespace text,p_key text,p_operation text,p_workspace uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m jsonb; allowed boolean := false; v_provider text; v_uid uuid := (select auth.uid());
begin
  if p_namespace not in ('product','organization','request','verification','marketplace') or v_uid is null
    or not app.account_is_active(v_uid) then return null; end if;
  m:=app.media_metadata(p_namespace,p_key);
  -- A personal purchase request has no organization; every other namespace needs a live one.
  if m is null or (p_namespace<>'request' and not exists(select 1 from public.organizations
      where id=(m->>'organization')::uuid and deleted_at is null)) then return null; end if;
  if p_operation='upload' then
    allowed:=m->>'state'='pending' and (m->>'createdAt')::timestamptz>now()-interval '24 hours'
      and case p_namespace when 'product' then app.can_upload_product_image_object(p_key)
          when 'request' then app.can_upload_request_image_object(p_key)
          when 'verification' then app.can_upload_bv_object(p_key)
          when 'marketplace' then app.marketplace_media_can_upload(p_key)
          else app.can_upload_organization_image_object(p_key) end;
  elsif p_operation='read' then
    if p_namespace='product' then
      allowed:=m->>'state'='ready' and (app.is_org_member((m->>'organization')::uuid)
        or exists(select 1 from public.product_images i where i.object_key=p_key
          and app.product_is_public(i.product_id) and app.product_image_viewable(i.product_id,p_workspace)));
    elsif p_namespace='request' then
      -- The requester side, or another workspace that may read the request RIGHT NOW (re-checked per use).
      allowed:=m->>'state'='ready' and exists(select 1 from public.purchase_request_images i
        where i.object_key=p_key and (app.is_request_owner_side(i.request_id)
          or (p_workspace is not null and app.request_image_viewable(i.request_id,p_workspace))));
    elsif p_namespace='verification' then
      allowed:=m->>'state'='ready' and app.can_read_bv_object(p_key);
    elsif p_namespace='marketplace' then
      -- Signed-in reads: the seller's members and media moderators. The public shop uses marketplace_public_image_ref.
      allowed:=m->>'state'='ready' and app.marketplace_media_can_read(p_key);
    else
      allowed:=m->>'state'='ready' and exists(select 1 from public.organization_images i
        join public.organizations o on o.logo_media_id=i.id where i.object_key=p_key and app.is_org_member(o.id));
    end if;
  elsif p_operation='delete' then
    allowed:=m->>'state'='deleted' and case p_namespace
      when 'product' then app.can_write_catalog((m->>'organization')::uuid)
      when 'request' then app.can_delete_request_image_object(p_key)
      when 'verification' then app.can_delete_bv_object(p_key)
      when 'marketplace' then app.marketplace_media_can_delete(p_key)
      else app.has_capability((m->>'organization')::uuid,'org.manage') end;
  end if;
  if not coalesce(allowed,false) then return null; end if;
  select provider into v_provider from public.media_storage_locations where namespace=p_namespace and object_key=p_key;
  return jsonb_build_object('provider',coalesce(v_provider,'supabase'),'reserved',v_provider is not null,
    'contentType',m->>'contentType','state',m->>'state',
    'owner',case when p_operation='upload' or (m->>'owner')::uuid=v_uid then m->>'owner' else null end);
end;
$$;

create or replace function public.media_storage_reserve(p_namespace text,p_key text,p_provider text,p_owner uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb; v_existing text; v_uid uuid; v_org uuid;
begin
  v_uid := case when auth.jwt()->>'role'='service_role' then p_owner else (select auth.uid()) end;
  m := app.media_metadata(p_namespace,p_key);
  v_org := (m->>'organization')::uuid;
  if v_org is not null and coalesce(auth.jwt()->>'role','')<>'service_role'
    and not (case p_namespace when 'product' then app.can_upload_product_image_object(p_key)
      when 'request' then app.can_upload_request_image_object(p_key)
      when 'verification' then app.can_upload_bv_object(p_key)
      when 'marketplace' then app.marketplace_media_can_upload(p_key)
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

create or replace function public.media_storage_attest(p_namespace text,p_key text,p_owner uuid,
  p_provider text,p_size bigint,p_content_type text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb; v_limit bigint; v_existing public.media_storage_locations;
begin
  m := app.media_metadata(p_namespace,p_key);
  v_limit := case p_namespace when 'avatar' then 3145728 when 'portfolio' then 5242880 when 'certificate' then 10485760
    when 'product' then 5242880 when 'organization' then 3145728 when 'request' then 5242880 when 'verification' then 10485760
    when 'marketplace' then 5242880 end;
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

create or replace function app.media_storage_key_for(p_namespace text,p_key text,p_owner uuid,p_org uuid)
returns text language plpgsql immutable set search_path='' as $$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  f text[]; v_product text; v_request text;
begin
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
    when 'request' then
      v_request := (regexp_match(p_key,'^'||u||'/('||u||')/'||u||'\.[a-z0-9]{2,5}$'))[1];
      if v_request is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return case when p_org is not null then 'o/'||p_org else 'u/'||p_owner end
        ||'/requests/'||v_request||'/'||f[1]||'/original.'||f[2];
    when 'verification' then
      if p_org is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return 'o/'||p_org||'/verification/'||f[1]||'/original.'||f[2];
    when 'marketplace' then
      -- <org>/<product>/<media id>.<ext>, issued by marketplace_seller_image_request_upload; stored in the
      -- organization's products/ folder like every other product photo (ids are UUIDs: no collision).
      v_product := (regexp_match(p_key,'^'||u||'/('||u||')/'||u||'\.[a-z0-9]{2,5}$'))[1];
      if v_product is null or p_org is null then raise exception 'unexpected media key' using errcode='22023'; end if;
      return 'o/'||p_org||'/products/'||v_product||'/'||f[1]||'/original.'||f[2];
    else raise exception 'invalid namespace' using errcode='22023';
  end case;
end;
$$;

create or replace function public.media_cleanup_candidates(p_limit integer default 25)
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
    union all select 'request',object_key,created_by,created_at from public.purchase_request_images
      where state='deleted' or (state='pending' and created_at<now()-interval '24 hours')
    union all select 'verification',object_key,created_by,created_at from public.business_verification_documents
      where submission_id is null and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'))
    union all select 'marketplace',object_key,created_by,created_at from public.marketplace_product_images
      where created_by is not null and (upload_state='deleting' or (upload_state='awaiting_upload' and created_at<now()-interval '24 hours'))
  ) select c.ns,c.key,c.owner,coalesce(l.provider,'supabase') from candidates c
    join public.media_storage_locations l on l.namespace=c.ns and l.object_key=c.key
    where l.provider='r2' and l.cleaned_at is null
    order by c.created_at limit least(greatest(p_limit,1),100);
$$;

create or replace function public.media_cleanup_retire(p_namespace text,p_key text,p_owner uuid)
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
  elsif p_namespace='request' then
    update public.purchase_request_images set state='deleted' where object_key=p_key and created_by=p_owner
      and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='verification' then
    update public.business_verification_documents set state='deleted' where object_key=p_key and created_by=p_owner
      and submission_id is null and (state='deleted' or (state='pending' and created_at<now()-interval '24 hours'));
  elsif p_namespace='marketplace' then
    update public.marketplace_product_images set upload_state='deleting', status='rejected', is_primary=false
      where object_key=p_key and created_by=p_owner
      and (upload_state='deleting' or (upload_state='awaiting_upload' and created_at<now()-interval '24 hours'));
  else raise exception 'invalid namespace' using errcode='22023'; end if;
  if not found then raise exception 'cleanup snapshot is stale' using errcode='42501'; end if;
end;
$$;

create or replace function public.media_edge_authorize(p_namespace text,p_key text,p_variant text,
  p_viewer uuid,p_session uuid,p_workspace uuid,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_claims text := current_setting('request.jwt.claims',true);
  v_sub text := current_setting('request.jwt.claim.sub',true);
  v_role text := current_setting('request.jwt.claim.role',true);
  m jsonb;
begin
  if p_namespace is null or p_namespace not in ('avatar','portfolio','certificate','product','organization','request','verification','marketplace')
    or p_key is null or length(p_key)>256 or p_variant is null or p_viewer is null or p_session is null
    -- The ticket expiry is enforced here too, independent of the Worker clock:
    -- at most 120 s lifetime, 5 s skew.
    or p_expires_at is null or p_expires_at < now()-interval '5 seconds'
    or p_expires_at > now()+interval '125 seconds' then
    return null;
  end if;
  if not app.account_is_active(p_viewer) then return null; end if;
  -- Sign-out (any scope) deletes the session row; bans and deletion end it too.
  if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
      where s.id=p_session and s.user_id=p_viewer and (s.not_after is null or s.not_after>now())
        and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
    return null;
  end if;
  perform set_config('request.jwt.claim.sub',p_viewer::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',p_viewer,'role','authenticated',
    'session_id',p_session)::text,true);
  if p_namespace in ('product','organization','request','verification','marketplace') then
    m := public.organization_media_resolve(p_namespace,p_key,'read',p_workspace);
  else
    m := public.media_storage_resolve(p_namespace,p_key,'read');
    -- Parity with /api/media: personal media is owner-only; public reads use Mode C.
    if (m->>'owner')::uuid is distinct from p_viewer then m := null; end if;
  end if;
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(v_role,''),true);
  if m is null or m->>'state'<>'ready' or m->>'provider'<>'r2' then return null; end if;
  return app.media_edge_grant(p_namespace,p_key,p_variant);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Marketplace image lifecycle on the central media system
-- ---------------------------------------------------------------------------
-- Same signature, grants and limits as Migration 07; the row now records its uploader
-- and the response carries only the media key (the server issues the upload grant).
create or replace function public.marketplace_seller_image_request_upload(
  p_product_id uuid, p_content_type text, p_variant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_uid   uuid;
  v_ext   text;
  v_id    uuid := gen_random_uuid();
  v_key   text;
  v_sort  integer;
  v_open  integer;
  v_fresh integer;
  v_hour  integer;
begin
  select seller_organization_id into v_org from public.marketplace_products where id = p_product_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_uid := app.marketplace_assert_seller_writer(v_org);
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    raise exception 'mp:image_type_invalid' using errcode = '22023';
  end if;
  if p_variant_id is not null and not exists (
       select 1 from public.marketplace_product_variants where id = p_variant_id and product_id = p_product_id) then
    raise exception 'mp:variant_not_found' using errcode = '42501';
  end if;

  -- keys that were issued but never uploaded to within their hour are withdrawn
  -- into the removal lifecycle (their rows are forgotten once the bytes are confirmed absent)
  update public.marketplace_product_images
     set upload_state = 'deleting', status = 'rejected', is_primary = false
   where product_id = p_product_id and upload_state = 'awaiting_upload'
     and created_at < now() - interval '1 hour';

  select count(*) into v_open from public.marketplace_product_images where product_id = p_product_id and status <> 'rejected';
  if v_open >= 30 then
    raise exception 'mp:too_many_images' using errcode = '23514';
  end if;
  select count(*) into v_fresh from public.marketplace_product_images
   where product_id = p_product_id and upload_state = 'awaiting_upload';
  if v_fresh >= 10 then
    raise exception 'mp:too_many_pending_uploads' using errcode = '23514';
  end if;
  -- NOT a serialization-failure SQLSTATE (PostgREST would retry it). P0001 is an immediate refusal.
  select count(*) into v_hour from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
   where p.seller_organization_id = v_org and i.created_at > now() - interval '1 hour';
  if v_hour >= 200 then
    raise exception 'mp:upload_rate_limited' using errcode = 'P0001';
  end if;

  v_key := v_org::text || '/' || p_product_id::text || '/' || v_id::text || '.' || v_ext;
  select coalesce(max(sort_order) + 1, 0) into v_sort from public.marketplace_product_images
   where product_id = p_product_id and variant_id is not distinct from p_variant_id;
  insert into public.marketplace_product_images
    (id, product_id, variant_id, object_key, sort_order, is_primary, status, mime_type, upload_state, created_by)
  values (v_id, p_product_id, p_variant_id, v_key, v_sort, false,
          'pending', p_content_type, 'awaiting_upload', v_uid);
  return jsonb_build_object('image_id', v_id, 'object_key', v_key);
end;
$$;

-- Confirms an upload ONLY after the central verifier attested the stored bytes
-- (format, full decode, size, sha256 — trigger marketplace_image_verified_before_confirmed).
-- Content stays `pending` until a moderator approves it.
create or replace function public.marketplace_seller_image_confirm_upload(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i      public.marketplace_product_images;
  v_org  uuid;
  l      public.media_storage_locations;
  v_primary boolean;
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  perform app.marketplace_assert_seller_writer(v_org);
  if i.upload_state = 'deleting' then
    raise exception 'mp:image_removed' using errcode = '23514';
  end if;
  if i.upload_state = 'confirmed' then
    return jsonb_build_object('image_id', i.id, 'upload_state', 'confirmed', 'status', i.status);
  end if;

  select * into l from public.media_storage_locations
   where namespace = 'marketplace' and object_key = i.object_key and verified_at is not null;
  if not found then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;

  -- the first confirmed product-level image becomes the primary one
  v_primary := i.variant_id is null and not exists (
    select 1 from public.marketplace_product_images x
    where x.product_id = i.product_id and x.variant_id is null and x.is_primary and x.status <> 'rejected');
  update public.marketplace_product_images set
    upload_state = 'confirmed',
    is_primary = v_primary,
    byte_size = l.size_bytes,
    checksum_sha256 = l.sha256
  where id = i.id;
  return jsonb_build_object('image_id', i.id, 'upload_state', 'confirmed', 'status', 'pending', 'is_primary', v_primary);
end;
$$;

-- Phase 3 of removal: forget the row only when the media record says the bytes are gone
-- (removeMedia records cleaned_at), or when nothing was ever reserved for the key.
create or replace function public.marketplace_seller_image_remove_finalize(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i     public.marketplace_product_images;
  v_org uuid;
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  perform app.marketplace_assert_seller_writer(v_org);
  -- a live image can only leave through phase 1
  if i.upload_state <> 'deleting' then
    raise exception 'mp:image_not_marked_for_removal' using errcode = '23514';
  end if;
  if exists (select 1 from public.media_storage_locations l
             where l.namespace = 'marketplace' and l.object_key = i.object_key and l.cleaned_at is null) then
    raise exception 'mp:object_still_present' using errcode = '23514';
  end if;
  delete from public.marketplace_product_images where id = i.id;
  return jsonb_build_object('removed', true, 'image_id', i.id, 'object_key', i.object_key);
end;
$$;

-- A VALID verdict must carry the byte size of the verified stored object (from its
-- central media receipt), so a verdict cannot be recorded for other bytes.
create or replace function public.admin_marketplace_media_record_validation(
  p_image_id uuid, p_valid boolean, p_format text, p_width integer, p_height integer,
  p_byte_size bigint, p_sha256 text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  i      public.marketplace_product_images;
  v_size bigint;
  v_org  uuid;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_media.moderate');
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found or i.upload_state <> 'confirmed' then
    raise exception 'mp:image_not_found' using errcode = '42501';
  end if;
  select l.size_bytes into v_size from public.media_storage_locations l
   where l.namespace = 'marketplace' and l.object_key = i.object_key and l.verified_at is not null;
  if v_size is null then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;
  if p_valid and (p_byte_size is distinct from v_size
                  or p_format not in ('jpeg', 'png', 'webp')
                  or coalesce(p_width, 0) < 1 or coalesce(p_height, 0) < 1
                  or p_sha256 !~ '^[0-9a-f]{64}$') then
    raise exception 'mp:validation_mismatch' using errcode = '23514';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  update public.marketplace_product_images set
    content_valid = p_valid,
    content_format = case when p_valid then p_format else null end,
    content_checked_at = now(),
    width_px = case when p_valid then p_width else width_px end,
    height_px = case when p_valid then p_height else height_px end,
    byte_size = v_size,
    checksum_sha256 = case when p_valid then p_sha256 else checksum_sha256 end
  where id = i.id;
  insert into public.marketplace_image_moderation_events (image_id, product_id, organization_id, action, detail, actor_user_id)
  values (i.id, i.product_id, v_org, 'validated',
          jsonb_build_object('valid', p_valid, 'format', p_format, 'width', p_width, 'height', p_height,
                             'byte_size', v_size, 'note', left(p_note, 200)), v_uid);
  return jsonb_build_object('image_id', i.id, 'valid', p_valid);
end;
$$;

-- Import photos are paused: a job takes the spreadsheet only. An empty asset list is
-- accepted (nothing to stage); any photo is refused with a clear, translatable code.
create or replace function app.marketplace_seller_stage_import_assets(p_job uuid, p_org uuid, p_assets jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_assets) is distinct from 'array' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if jsonb_array_length(p_assets) > 0 then
    raise exception 'mp:import_images_unavailable' using errcode = '22023';
  end if;
  return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Public delivery: the image id is the public handle (Worker Mode C + app fallback)
-- ---------------------------------------------------------------------------
-- The object key of a Marketplace image the PUBLIC shop may show, or null: media flag on,
-- verified + byte-validated image, published product of an enabled seller, active type,
-- category and variant. One rule for the Worker (media_edge_public) and the app fallback.
create or replace function app.marketplace_public_image_key(p_image_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.object_key
  from public.marketplace_product_images i
  join public.marketplace_products p on p.id = i.product_id
  join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
  join public.marketplace_categories c on c.id = t.category_id and c.is_active
  left join public.marketplace_product_variants v on v.id = i.variant_id
  where i.id = p_image_id
    and app.marketplace_media_verification_ready()
    and i.status = 'verified' and i.upload_state = 'confirmed' and i.content_valid is true
    and (i.variant_id is null or v.status = 'active')
    and p.status = 'published'
    and app.marketplace_seller_is_enabled(p.seller_organization_id);
$$;

-- Same contract as Migration 09 without the bucket column (bytes are in the media system).
drop function public.marketplace_public_image_ref(uuid);
create function public.marketplace_public_image_ref(p_image_id uuid)
returns table (object_key text, mime_type text, checksum_sha256 text)
language sql
stable
security definer
set search_path = ''
as $$
  select i.object_key, i.mime_type, i.checksum_sha256
  from public.marketplace_product_images i
  where i.id = p_image_id and i.object_key = app.marketplace_public_image_key(p_image_id);
$$;
revoke all on function public.marketplace_public_image_ref(uuid) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_public_image_ref(uuid) to service_role;

-- Central public edge function: current definition + the 'marketplace' branch (Mode C by image id).
CREATE OR REPLACE FUNCTION public.media_edge_public(p_namespace text, p_id uuid, p_variant text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims text := current_setting('request.jwt.claims',true);
  v_sub text := current_setting('request.jwt.claim.sub',true);
  v_role text := current_setting('request.jwt.claim.role',true);
  v_key text;
begin
  if p_id is null or p_variant is null or p_namespace is null or p_namespace not in ('portfolio','avatar','marketplace') then return null; end if;
  perform set_config('request.jwt.claims','',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  if p_namespace='portfolio' then
    v_key := public.public_portfolio_media_key(p_id);
    if v_key is not null and not app.is_published_portfolio_object(v_key) then v_key := null; end if;
  elsif p_namespace='marketplace' then
    -- A Marketplace image only while EVERY public condition holds (same rule as marketplace_public_image_ref).
    v_key := app.marketplace_public_image_key(p_id);
  else
    -- Current avatar only while its profile is listed (active, not deleted, professional).
    select au.object_key into v_key from public.profile_public_directory d
      join public.avatar_uploads au on au.id=d.avatar_media_id
      where d.id=p_id and au.state='ready' and app.is_current_avatar_object(au.object_key);
  end if;
  perform set_config('request.jwt.claims',coalesce(v_claims,''),true);
  perform set_config('request.jwt.claim.sub',coalesce(v_sub,''),true);
  perform set_config('request.jwt.claim.role',coalesce(v_role,''),true);
  if v_key is null then return null; end if;
  return app.media_edge_grant(p_namespace,v_key,p_variant);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. The storage location columns are retired: the media system is the authority
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketplace_seller_product_get(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p public.marketplace_products;
  v jsonb;
begin
  select * into p from public.marketplace_products where id = p_product_id;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_reader(p.seller_organization_id);

  select jsonb_build_object(
    'id', p.id,
    'organization_id', p.seller_organization_id,
    'product_type_key', t.key,
    'category_key', c.key,
    'name_ar', p.name_ar, 'name_en', p.name_en,
    'description_ar', p.description_ar, 'description_en', p.description_en,
    'brand', p.brand, 'external_ref', p.external_ref, 'slug', p.slug,
    'status', p.status, 'published_at', p.published_at, 'updated_at', p.updated_at,
    'attributes', coalesce((
      select jsonb_object_agg(x.key, x.val) from (
        select d.key,
               case when d.data_type = 'multi_option'
                    then jsonb_agg(o.key order by o.sort_order)
                    else (array_agg(app.marketplace_attribute_json(d.data_type, o.key, av.value_number, av.value_boolean, av.value_text)))[1]
               end as val
        from public.marketplace_product_attribute_values av
        join public.marketplace_attribute_definitions d on d.id = av.attribute_id
        left join public.marketplace_attribute_options o on o.id = av.option_id
        where av.product_id = p.id
        group by d.key, d.data_type) x), '{}'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pv.id, 'sku', pv.sku, 'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
               'status', pv.status,
               'attributes', coalesce((
                 select jsonb_object_agg(x.key, x.val) from (
                   select d.key,
                          case when d.data_type = 'multi_option'
                               then jsonb_agg(o.key order by o.sort_order)
                               else (array_agg(app.marketplace_attribute_json(d.data_type, o.key, vv.value_number, vv.value_boolean, vv.value_text)))[1]
                          end as val
                   from public.marketplace_variant_attribute_values vv
                   join public.marketplace_attribute_definitions d on d.id = vv.attribute_id
                   left join public.marketplace_attribute_options o on o.id = vv.option_id
                   where vv.variant_id = pv.id
                   group by d.key, d.data_type) x), '{}'::jsonb),
               'stock', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'location_id', l.id, 'location_name_ar', l.name_ar, 'location_name_en', l.name_en,
                          'location_active', l.is_active,
                          'on_hand', il.on_hand, 'reserved', il.reserved, 'available', il.available)
                        order by l.name_en)
                 from public.marketplace_inventory_levels il
                 join public.marketplace_stock_locations l on l.id = il.location_id
                 where il.variant_id = pv.id), '[]'::jsonb))
             order by pv.created_at, pv.sku)
      from public.marketplace_product_variants pv where pv.product_id = p.id), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'variant_id', i.variant_id, 'object_key', i.object_key,
               'sort_order', i.sort_order, 'is_primary', i.is_primary, 'status', i.status,
               'upload_state', i.upload_state, 'mime_type', i.mime_type, 'byte_size', i.byte_size,
               'alt_text_ar', i.alt_text_ar, 'alt_text_en', i.alt_text_en)
             order by (i.variant_id is not null), i.sort_order)
      from public.marketplace_product_images i where i.product_id = p.id and i.status <> 'rejected'), '[]'::jsonb),
    'blockers', to_jsonb(app.marketplace_publication_blockers(p.id))
  ) into v
  from public.marketplace_product_types t
  join public.marketplace_categories c on c.id = t.category_id
  where t.id = p.product_type_id;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION app.marketplace_import_apply_row(p_row_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_loc     uuid;
  v_qty     integer;
  r         public.marketplace_import_rows;
  m         public.marketplace_import_rows;
  v_type_id uuid;
  v_master  boolean;
  v_product uuid;
  v_ptype   uuid;
  v_variant uuid;
  v_vprod   uuid;
  v_unit    text;
  v_price   numeric;
  v_created boolean := false;
  v_changed boolean := false;
  v_n       integer;
  a         record;
  img       record;
  v_img     record;
  v_sort    integer;
  v_var_for_img uuid;
  v_primary boolean;
begin
  select * into r from public.marketplace_import_rows where id = p_row_id;
  select t.id into v_type_id
  from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
  where t.key = r.product_type_key and t.is_active and c.is_active;
  if v_type_id is null then
    raise exception 'product type is not available' using errcode = '23514';
  end if;
  if not app.marketplace_seller_is_enabled(r.organization_id) then
    raise exception 'the seller is not enabled for the Marketplace' using errcode = '23514';
  end if;

  select * into m from public.marketplace_import_rows
   where job_id = r.job_id and external_ref = r.external_ref order by row_number limit 1;
  v_master := m.id = r.id;

  -- product (identified by seller + external_ref)
  select p.id, p.product_type_id into v_product, v_ptype from public.marketplace_products p
   where p.seller_organization_id = r.organization_id and p.external_ref = r.external_ref for update;
  if v_product is null then
    insert into public.marketplace_products
      (seller_organization_id, product_type_id, slug, name_ar, name_en, description_ar, description_en, brand, external_ref, status)
    values (r.organization_id, v_type_id, app.marketplace_import_slug(m.name_en, r.organization_id, r.external_ref),
            m.name_ar, m.name_en, m.description_ar, m.description_en, m.brand, r.external_ref, 'draft')
    returning id into v_product;
    v_created := true;
  else
    if v_ptype is distinct from v_type_id then
      raise exception 'an existing product''s type cannot be changed by import' using errcode = '23514';
    end if;
    if v_master then
      update public.marketplace_products p set
        name_ar = m.name_ar, name_en = m.name_en, description_ar = m.description_ar,
        description_en = m.description_en, brand = m.brand
      where p.id = v_product
        and (p.name_ar, p.name_en, p.description_ar, p.description_en, p.brand)
            is distinct from (m.name_ar, m.name_en, m.description_ar, m.description_en, m.brand);
      get diagnostics v_n = row_count;
      v_changed := v_changed or v_n > 0;      -- status / seller / type are never touched
    end if;
  end if;

  -- variant (identified by seller + sku)
  select v.id, v.product_id, v.selling_unit, v.price_egp into v_variant, v_vprod, v_unit, v_price
  from public.marketplace_product_variants v
  where v.seller_organization_id = r.organization_id and v.sku = r.sku for update;
  if v_variant is null then
    insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
    values (v_product, r.organization_id, r.sku, r.selling_unit, r.price_egp)
    returning id into v_variant;
    v_created := true;
  else
    if v_vprod <> v_product then
      raise exception 'this SKU belongs to a different product' using errcode = '23514';
    end if;
    if v_unit <> r.selling_unit then
      raise exception 'the selling unit of an existing variant cannot be changed by import' using errcode = '23514';
    end if;
    if v_price is distinct from r.price_egp then
      update public.marketplace_product_variants set price_egp = r.price_egp where id = v_variant;
      v_changed := true;
    end if;
  end if;

  -- attribute values (product-level ones come from the product's first row only)
  for a in
    select d.id as def_id, d.key, d.data_type, ta.level
    from public.marketplace_product_type_attributes ta
    join public.marketplace_attribute_definitions d on d.id = ta.attribute_id
    where ta.product_type_id = v_type_id and ta.is_active and d.is_active and r.attributes ? d.key
  loop
    if a.level = 'product' then
      continue when not v_master;
      v_changed := app.marketplace_import_apply_attribute('product', v_product, a.def_id, a.data_type, r.attributes -> a.key) or v_changed;
    else
      v_changed := app.marketplace_import_apply_attribute('variant', v_variant, a.def_id, a.data_type, r.attributes -> a.key) or v_changed;
    end if;
  end loop;

  -- images: import photos are paused (Migration 13); photos are added on each product page.

  -- initial stock (Migration 09): an import row may carry a quantity. It is entered
  -- ONCE, through the ledger, and only for a variant that has no stock row yet —
  -- re-importing never overwrites stock the seller has since changed.
  if coalesce(r.raw ->> 'quantity', '') ~ '^[0-9]{1,6}$' then
    v_qty := (r.raw ->> 'quantity')::integer;
    if v_qty > 0 and not exists (select 1 from public.marketplace_inventory_levels l where l.variant_id = v_variant) then
      select id into v_loc from public.marketplace_stock_locations
       where organization_id = r.organization_id and is_active order by (key = 'main') desc, created_at limit 1;
      if v_loc is null then
        insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en, kind, supports_pickup)
        values (r.organization_id, 'main', 'المخزن الرئيسي', 'Main stock', 'warehouse', false)
        on conflict (organization_id, key) do update set is_active = true
        returning id into v_loc;
      end if;
      perform * from public.marketplace_stock_apply(
        r.organization_id, v_variant, v_loc, 'initial', v_qty,
        'import:' || r.job_id::text || ':' || r.row_number::text, 'bulk import opening stock', 'import',
        'import_job', r.job_id::text,
        (select j.created_by from public.marketplace_import_jobs j where j.id = r.job_id));
      v_changed := true;
    end if;
  end if;

  update public.marketplace_import_rows set product_id = v_product, variant_id = v_variant where id = r.id;
  return case when v_created then 'create' when v_changed then 'update' else 'unchanged' end;
end;
$function$;

alter table public.marketplace_product_images drop column storage_provider, drop column storage_bucket;
-- The location's uniqueness index included the two dropped columns; an image key is still registered once.
create unique index ux_marketplace_product_images_object_key on public.marketplace_product_images (object_key);

-- ---------------------------------------------------------------------------
-- 8. The Supabase Storage predicates of Migrations 06/07/09 are no longer used
-- ---------------------------------------------------------------------------
drop function app.marketplace_storage_can_upload_image(text);
drop function app.marketplace_storage_owns_image(text);
drop function app.marketplace_storage_can_delete_image(text);
drop function app.marketplace_storage_moderator_can_read(text);
drop function app.marketplace_storage_can_upload_import(text);

-- ---------------------------------------------------------------------------
-- 9. Grants: the new app.marketplace_* helpers are internal (no client role)
-- ---------------------------------------------------------------------------
revoke all on function
  app.marketplace_public_image_key(uuid),
  app.marketplace_media_can_upload(text),
  app.marketplace_media_can_read(text),
  app.marketplace_media_can_delete(text),
  app.marketplace_require_verified_media()
  from public, anon, authenticated, service_role;

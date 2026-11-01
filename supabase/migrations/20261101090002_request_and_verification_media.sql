-- Purchase-request photos and business-verification documents join the central media system
-- (owner decision, 2026-11-01: no application file bytes in Supabase Storage).
--
-- Two new namespaces, 'request' and 'verification', reuse the SAME reservation, verification
-- receipt, resolver, ids-only key and cleanup functions as the other five. Nothing here creates
-- a parallel upload system and no function signature or grant changes (create or replace only),
-- so the permission contract is unchanged.
--
--   request       o/<org>/requests/<request>/<media id>/original.<ext>
--                 u/<user>/requests/<request>/<media id>/original.<ext>   (personal request)
--   verification  o/<org>/verification/<media id>/original.<ext>
--
-- Authorization is still decided by the existing predicates (app.can_*_request_image_object,
-- app.can_*_bv_object, app.request_image_viewable); the path never grants anything.
-- Compliance rules are untouched: a verification document attached to a submission is evidence,
-- cannot be removed, and is never offered to cleanup (state stays 'ready').
--
-- Until R2 routing is on, the two namespaces use the same pre-activation Supabase provider as the other
-- five (reserved and verified centrally); the application closes that path at cutover.
-- Existing Supabase-stored rows keep working (provider 'supabase' by absence of a mapping) until
-- they are retired or migrated under a separately approved plan; nothing is moved or deleted here.

alter table public.media_storage_locations drop constraint media_storage_locations_namespace_check;
alter table public.media_storage_locations add constraint media_storage_locations_namespace_check
  check (namespace in ('avatar','portfolio','certificate','product','organization','request','verification'));

-- The 20261101090001 check spans two columns, so PostgreSQL named it automatically; find it by definition.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.media_storage_locations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%storage_key%'
  loop
    execute format('alter table public.media_storage_locations drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.media_storage_locations add constraint media_storage_locations_storage_key_check
  check (storage_key is null or (provider = 'r2' and storage_key !~ '\.\.' and storage_key ~
    '^(u|o)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(profile|portfolio|certificates|products|requests|verification)/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/){1,2}original\.[a-z0-9]{2,5}$'));

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
  from public.business_verification_documents where p_namespace='verification' and object_key=p_key;
$$;

-- The five resolvers' dispatch: product/organization/request/verification are workspace- or
-- organization-scoped and go through organization_media_resolve.
create or replace function public.media_storage_resolve(p_namespace text,p_key text,p_operation text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m jsonb; v_provider text; v_owner boolean; v_allowed boolean := false;
begin
  if p_namespace in ('product','organization','request','verification') then
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
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare m jsonb; allowed boolean := false; v_provider text; v_uid uuid := (select auth.uid());
begin
  if p_namespace not in ('product','organization','request','verification') or v_uid is null
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
    else
      allowed:=m->>'state'='ready' and exists(select 1 from public.organization_images i
        join public.organizations o on o.logo_media_id=i.id where i.object_key=p_key and app.is_org_member(o.id));
    end if;
  elsif p_operation='delete' then
    allowed:=m->>'state'='deleted' and case p_namespace
      when 'product' then app.can_write_catalog((m->>'organization')::uuid)
      when 'request' then app.can_delete_request_image_object(p_key)
      when 'verification' then app.can_delete_bv_object(p_key)
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
    when 'product' then 5242880 when 'organization' then 3145728 when 'request' then 5242880 when 'verification' then 10485760 end;
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

-- Ready requires a fresh verification receipt. For the two new tables the receipt is mandatory
-- once the object was reserved through the central system (R2); a row that was never reserved
-- is a legacy Supabase upload still finishing through its old confirm RPC.
create or replace function app.require_verified_media() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_key text; v_namespace text;
begin
  if old.state='pending' and new.state='ready' then
    v_namespace := case tg_table_name when 'portfolio_items' then 'portfolio'
      when 'professional_certificates' then 'certificate' when 'product_images' then 'product' when 'organization_images' then 'organization'
      when 'purchase_request_images' then 'request' when 'business_verification_documents' then 'verification' else 'avatar' end;
    v_key := case when tg_table_name='professional_certificates' then to_jsonb(new)->>'object_path'
      else to_jsonb(new)->>'object_key' end;
    if v_namespace in ('request','verification')
      and not exists(select 1 from public.media_storage_locations where namespace=v_namespace and object_key=v_key) then
      return new;
    end if;
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
create trigger request_image_verified_before_ready before update on public.purchase_request_images
  for each row execute function app.require_verified_media();
create trigger bv_document_verified_before_ready before update on public.business_verification_documents
  for each row execute function app.require_verified_media();

-- Ids-only physical keys for the new namespaces.
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
    else raise exception 'invalid namespace' using errcode='22023';
  end case;
end;
$$;

-- Cleanup candidates/retire: abandoned pending uploads and removed drafts of the new namespaces.
-- A verification document that belongs to a submission is evidence and is never a candidate.
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
  else raise exception 'invalid namespace' using errcode='22023'; end if;
  if not found then raise exception 'cleanup snapshot is stale' using errcode='42501'; end if;
end;
$$;

-- Private edge delivery for the two new namespaces. Same session, ticket-expiry and active-account checks;
-- the read decision is still organization_media_resolve (request: requester side, or a workspace that may read
-- the request right now; verification: org.manage, or a reviewer of a ready document). Signature and grants unchanged.
create or replace function public.media_edge_authorize(p_namespace text,p_key text,p_variant text,
  p_viewer uuid,p_session uuid,p_workspace uuid,p_expires_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_claims text := current_setting('request.jwt.claims',true);
  v_sub text := current_setting('request.jwt.claim.sub',true);
  v_role text := current_setting('request.jwt.claim.role',true);
  m jsonb;
begin
  if p_namespace is null or p_namespace not in ('avatar','portfolio','certificate','product','organization','request','verification')
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
  if p_namespace in ('product','organization','request','verification') then
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

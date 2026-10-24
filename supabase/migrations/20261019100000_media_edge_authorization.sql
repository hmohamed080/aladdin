-- WP1: database authority for the Cloudflare media Worker (ADR-0017 follow-up; plan r2-delivery-architecture §3).
-- The Worker never copies authorization logic. Every request calls one of two
-- SECURITY DEFINER functions that evaluate the SAME resolvers the application
-- proxy uses (media_storage_resolve, organization_media_resolve,
-- public_portfolio_media_key, is_published_portfolio_object), re-checked on
-- every request, so delete/unpublish/delist/suspension/sign-out apply at once.
--
-- Least privilege: media_edge is a NOLOGIN group role with EXECUTE on exactly
-- the two Worker functions. The owner later creates a separate LOGIN member
-- role for Hyperdrive (edge/media-worker/README.md); no password is committed.
do $$ begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='media_edge') then
    create role media_edge nologin noinherit nocreatedb nocreaterole;
  end if;
end $$;
-- SET (not INHERIT) lets the migration owner verify the role's view (`set role
-- media_edge` in pgTAP) without gaining any of its privileges.
grant media_edge to postgres with set true, inherit false;
grant usage on schema public to media_edge;

-- Derived image renditions (written by the trusted verifier, WP2). Keys are a
-- closed set; each value {width,height,size,sha256} describes one immutable
-- object at v/<ns>/<key>/<variant>.webp (lib/media/image-variants.ts).
alter table public.media_storage_locations add column variants jsonb not null default '{}'::jsonb
  check (jsonb_typeof(variants)='object' and variants - array['thumb','card','full'] = '{}'::jsonb);

-- The one place that maps an authorized row to the R2 object the Worker may read.
-- Only a verified, not-cleaned R2 receipt qualifies; legacy Supabase rows stay on the app proxy.
create function app.media_edge_grant(p_namespace text,p_key text,p_variant text)
returns jsonb language sql stable security definer set search_path='' as $$
  select case
    -- The original also names the recorded variants, so URL issuers mint only those.
    when p_variant='original' then jsonb_build_object('object',l.namespace||'/'||l.object_key,
      'contentType',l.content_type,'size',l.size_bytes,'sha256',l.sha256,
      'variants',(select coalesce(jsonb_agg(k order by k),'[]'::jsonb) from jsonb_object_keys(l.variants) k))
    when l.variants ? p_variant then jsonb_build_object('object','v/'||l.namespace||'/'||l.object_key||'/'||p_variant||'.webp',
      'contentType','image/webp','size',(l.variants->p_variant->>'size')::bigint,'sha256',l.variants->p_variant->>'sha256')
  end
  from public.media_storage_locations l
  where l.namespace=p_namespace and l.object_key=p_key and l.provider='r2'
    and l.verified_at is not null and l.cleaned_at is null and l.sha256 is not null
    and p_variant in ('original','thumb','card','full');
$$;
revoke all on function app.media_edge_grant(text,text,text) from public,anon,authenticated,service_role;

-- Mode P (private). The ticket's claims are only a binding; the database decides.
-- Claims are set for the nested caller-scoped resolvers and restored before return,
-- including the legacy request.jwt.claim.* keys auth.uid() consults first.
create function public.media_edge_authorize(p_namespace text,p_key text,p_variant text,
  p_viewer uuid,p_session uuid,p_workspace uuid,p_expires_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_claims text := current_setting('request.jwt.claims',true);
  v_sub text := current_setting('request.jwt.claim.sub',true);
  v_role text := current_setting('request.jwt.claim.role',true);
  m jsonb;
begin
  if p_namespace is null or p_namespace not in ('avatar','portfolio','certificate','product','organization')
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
  if p_namespace in ('product','organization') then
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
revoke all on function public.media_edge_authorize(text,text,text,uuid,uuid,uuid,timestamp with time zone) from public,anon,authenticated,service_role;
grant execute on function public.media_edge_authorize(text,text,text,uuid,uuid,uuid,timestamp with time zone) to media_edge;

-- Mode C (conditional public). Opaque public identifiers only: a portfolio item id
-- or a listed profile id; never an object key or users.id. Evaluated as anonymous.
create function public.media_edge_public(p_namespace text,p_id uuid,p_variant text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_claims text := current_setting('request.jwt.claims',true);
  v_sub text := current_setting('request.jwt.claim.sub',true);
  v_role text := current_setting('request.jwt.claim.role',true);
  v_key text;
begin
  if p_id is null or p_variant is null or p_namespace is null or p_namespace not in ('portfolio','avatar') then return null; end if;
  perform set_config('request.jwt.claims','',true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  if p_namespace='portfolio' then
    v_key := public.public_portfolio_media_key(p_id);
    if v_key is not null and not app.is_published_portfolio_object(v_key) then v_key := null; end if;
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
$$;
revoke all on function public.media_edge_public(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.media_edge_public(text,uuid,text) to media_edge;

-- Rendering: which currently public items are servable at the edge, with the
-- variants each one has. Reveals only the provider of media that is already
-- public; ineligible ids are simply absent.
create function public.public_media_edge_sources(p_namespace text,p_ids uuid[])
returns jsonb language sql volatile security definer set search_path='' as $$
  select coalesce(jsonb_object_agg(i::text,g->'variants'),'{}'::jsonb) from (
    select distinct i, public.media_edge_public(p_namespace,i,'original') g from unnest(p_ids[1:100]) i) s
  where g is not null;
$$;
revoke all on function public.public_media_edge_sources(text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.public_media_edge_sources(text,uuid[]) to anon,authenticated;

-- Rendering: the caller's readable organization media keys with their provider,
-- through the same caller-scoped resolver as organization_media_read_keys.
create function public.organization_media_read_providers(p_namespace text,p_keys text[],p_workspace uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(k,r->>'provider'),'{}'::jsonb) from (
    select distinct k, public.organization_media_resolve(p_namespace,k,'read',p_workspace) r
      from unnest(p_keys[1:60]) k) s
  where r is not null;
$$;
revoke all on function public.organization_media_read_providers(text,text[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.organization_media_read_providers(text,text[],uuid) to authenticated;

-- Trusted verifier records the VariantManifest it wrote from verified bytes
-- (server/storage/media.ts verifyPendingMedia): {variant:{width,height,size,sha256}}.
create function public.media_storage_record_variants(p_namespace text,p_key text,p_owner uuid,p_variants jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_name text; v jsonb;
begin
  if jsonb_typeof(p_variants)<>'object' or p_variants - array['thumb','card','full'] <> '{}'::jsonb then
    raise exception 'invalid media variants' using errcode='22023';
  end if;
  for v_name,v in select * from jsonb_each(p_variants) loop
    if jsonb_typeof(v)<>'object' or coalesce(v->>'sha256','') !~ '^[0-9a-f]{64}$'
      or coalesce(v->>'size','') !~ '^[1-9][0-9]{0,8}$'
      or coalesce(v->>'width','') !~ '^[1-9][0-9]{0,4}$' or coalesce(v->>'height','') !~ '^[1-9][0-9]{0,4}$' then
      raise exception 'invalid media variant %',v_name using errcode='22023';
    end if;
  end loop;
  update public.media_storage_locations set variants=variants||p_variants
    where namespace=p_namespace and object_key=p_key and owner_user_id=p_owner and provider='r2'
      and verified_at is not null and cleaned_at is null;
  if not found then raise exception 'no verified R2 media receipt' using errcode='42501'; end if;
end;
$$;
revoke all on function public.media_storage_record_variants(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.media_storage_record_variants(text,text,uuid,jsonb) to service_role;

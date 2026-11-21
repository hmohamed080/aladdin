-- Admin-configurable media upload limits (owner decision 2026-11-21, follow-up to ADR-0030).
--
-- The caps stay 10 MB (images) and 100 MB (videos) by default; an administrator can change them PER PLACE:
--   images: avatar, organization, portfolio, certificate, product, request, verification, marketplace
--   videos: portfolio, product (the product scope also serves Marketplace listings)
-- The stored value is the authority: the verification receipt (media_storage_attest) and the video row
-- trigger read it, and the Next.js server reads it through media_limits_get when it issues an upload
-- grant. The browser only receives it as a hint.
--
-- HARD CEILING: a value above the ceiling cannot be stored (CHECK) and the RPC says so. The ceilings are
-- what the platform can actually carry: 25 MiB per image (decode memory and the 25 MP pixel budget of the
-- image pipeline), 1 GiB per video (the transcode worker's disk and time budget; R2 itself allows far more).
-- The floor keeps a typo from locking a place out (100 KiB image, 1 MiB video).
--
-- Every change appends a media_limit_events row (who, when, old, new, reason). Actor columns carry no foreign
-- key: audit outlives accounts. Lowering a limit never touches files already stored; it applies to new uploads.
--
-- Permissions: media_limits.view (Administrator and higher) reads the page and history;
-- media_limits.manage (Super Admin) changes a limit with a mandatory reason.

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('media_limits.view', 'media_limits', 'view',
   'See the upload size limits per place (images and videos) and their change history (Administrator and higher).', 80),
  ('media_limits.manage', 'media_limits', 'manage',
   'Change the upload size limit of a place within the platform hard ceiling, with a mandatory reason (Super Admin only).', 81)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, p.key, true
  from public.admin_roles r
 cross join (values ('media_limits.view'), ('media_limits.manage')) as p(key)
 where r.key = 'super_admin'
on conflict (role_id, permission_key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'media_limits.view', true
  from public.admin_roles r
 where r.key = 'administrator'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.media_limits (
  kind          text        not null,
  place         text        not null,
  max_bytes     bigint      not null,
  default_bytes bigint      not null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  primary key (kind, place),
  constraint media_limits_place_ck check (
    (kind = 'image' and place in ('avatar', 'organization', 'portfolio', 'certificate', 'product', 'request', 'verification', 'marketplace'))
    or (kind = 'video' and place in ('portfolio', 'product'))),
  -- the hard ceiling and floor: not configurable
  constraint media_limits_ceiling_ck check (
    (kind = 'image' and max_bytes between 102400 and 26214400 and default_bytes between 102400 and 26214400)
    or (kind = 'video' and max_bytes between 1048576 and 1073741824 and default_bytes between 1048576 and 1073741824))
);
comment on table public.media_limits is
  'Upload size limit per place and kind (image | video). Read by media_storage_attest, the media_videos cap trigger and media_limits_get; changed only by admin_media_limit_set, which enforces the hard ceiling and writes media_limit_events.';

insert into public.media_limits (kind, place, max_bytes, default_bytes) values
  ('image', 'avatar',       3145728, 3145728),
  ('image', 'organization', 3145728, 3145728),
  ('image', 'portfolio',    10485760, 10485760),
  ('image', 'certificate',  10485760, 10485760),
  ('image', 'product',      10485760, 10485760),
  ('image', 'request',      10485760, 10485760),
  ('image', 'verification', 10485760, 10485760),
  ('image', 'marketplace',  10485760, 10485760),
  ('video', 'portfolio',    104857600, 104857600),
  ('video', 'product',      104857600, 104857600);

create table public.media_limit_events (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text        not null,
  place      text        not null,
  old_bytes  bigint      not null,
  new_bytes  bigint      not null,
  actor_id   uuid        not null,
  reason     text        not null check (char_length(btrim(reason)) between 3 and 500)
);
comment on table public.media_limit_events is
  'Append-only history of upload-limit changes. Actor carries no foreign key: audit outlives accounts.';

create or replace function app.media_limit_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function app.media_limit_events_append_only() from public, anon, authenticated, service_role;
create trigger media_limit_events_append_only
  before update or delete on public.media_limit_events
  for each row execute function app.media_limit_events_append_only();

alter table public.media_limits       enable row level security;
alter table public.media_limit_events enable row level security;
revoke all on public.media_limits       from public, anon, authenticated, service_role;
revoke all on public.media_limit_events from public, anon, authenticated, service_role;
-- both tables: RLS on, no grant, no policy. Access is through the functions below.

-- ---------------------------------------------------------------------------
-- 3. Internal reader (the database authority for enforcement)
-- ---------------------------------------------------------------------------
create or replace function app.media_limit_bytes(p_kind text, p_place text)
returns bigint language sql stable security definer set search_path = '' as $$
  select max_bytes from public.media_limits where kind = p_kind and place = p_place;
$$;
revoke all on function app.media_limit_bytes(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Enforcement reads the stored value (fail closed: a missing row refuses the upload)
-- ---------------------------------------------------------------------------
create or replace function public.media_storage_attest(p_namespace text,p_key text,p_owner uuid,
  p_provider text,p_size bigint,p_content_type text,p_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare m jsonb; v_limit bigint; v_existing public.media_storage_locations;
begin
  m := app.media_metadata(p_namespace,p_key);
  v_limit := coalesce(app.media_limit_bytes('image', p_namespace), 0);
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

create or replace function app.media_videos_enforce_cap()
returns trigger language plpgsql set search_path = '' as $$
declare v_limit bigint := coalesce(app.media_limit_bytes('video', new.scope::text), 0);
begin
  if new.declared_bytes > v_limit then
    raise exception 'video is larger than the limit for this place' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function app.media_videos_enforce_cap() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------
-- Every signed-in user and the trusted server may read the limits: the browser needs them as hints and the
-- server needs them to issue an upload grant. They reveal nothing about people.
create or replace function public.media_limits_get()
returns table (kind text, place text, max_bytes bigint, default_bytes bigint, ceiling_bytes bigint, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select l.kind, l.place, l.max_bytes, l.default_bytes,
         case l.kind when 'image' then 26214400::bigint else 1073741824::bigint end,
         l.updated_at
    from public.media_limits l
   order by l.kind, l.place;
$$;
revoke all on function public.media_limits_get() from public, anon, authenticated, service_role;
grant execute on function public.media_limits_get() to authenticated, service_role;

create or replace function public.admin_media_limit_set(p_kind text, p_place text, p_max_bytes bigint, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor   uuid := (select auth.uid());
  v_old     bigint;
  v_ceiling bigint;
  v_floor   bigint;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.has_admin_permission('media_limits.manage') then
    raise exception 'permission media_limits.manage is required' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;
  select max_bytes into v_old from public.media_limits where kind = p_kind and place = p_place for update;
  if not found then
    raise exception 'unknown place' using errcode = '22023';
  end if;
  v_ceiling := case p_kind when 'image' then 26214400 else 1073741824 end;
  v_floor   := case p_kind when 'image' then 102400 else 1048576 end;
  if p_max_bytes is null or p_max_bytes > v_ceiling then
    raise exception 'the limit exceeds the platform ceiling' using errcode = '22023', detail = v_ceiling::text;
  end if;
  if p_max_bytes < v_floor then
    raise exception 'the limit is below the minimum' using errcode = '22023', detail = v_floor::text;
  end if;
  if p_max_bytes = v_old then
    return jsonb_build_object('kind', p_kind, 'place', p_place, 'max_bytes', v_old, 'changed', false);
  end if;
  update public.media_limits set max_bytes = p_max_bytes, updated_at = now(), updated_by = v_actor
   where kind = p_kind and place = p_place;
  insert into public.media_limit_events (kind, place, old_bytes, new_bytes, actor_id, reason)
  values (p_kind, p_place, v_old, p_max_bytes, v_actor, btrim(p_reason));
  return jsonb_build_object('kind', p_kind, 'place', p_place, 'max_bytes', p_max_bytes, 'changed', true);
end;
$$;
revoke all on function public.admin_media_limit_set(text, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_media_limit_set(text, text, bigint, text) to authenticated;

create or replace function public.admin_media_limit_events(p_limit integer default 50)
returns table (id bigint, at timestamptz, kind text, place text, old_bytes bigint, new_bytes bigint, actor_id uuid, reason text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (app.has_admin_permission('media_limits.view') or app.has_admin_permission('media_limits.manage')) then
    raise exception 'permission media_limits.view is required' using errcode = '42501';
  end if;
  return query
    select e.id, e.at, e.kind, e.place, e.old_bytes, e.new_bytes, e.actor_id, e.reason
      from public.media_limit_events e
     order by e.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;
revoke all on function public.admin_media_limit_events(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_media_limit_events(integer) to authenticated;

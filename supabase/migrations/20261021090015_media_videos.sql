-- Video for portfolio work and products (ADR-0020). Bytes live only in R2:
-- browsers upload originals straight to R2 with presigned multipart parts, a
-- backend worker transcodes them to HLS renditions and a poster in R2, and the
-- media Worker serves every playlist, segment and poster after asking THIS
-- database (public.media_edge_video) on every request. No video byte passes
-- through Supabase or Vercel.
--
-- Authorization reuses the existing rules, never a copy of them:
--   * portfolio videos follow portfolio publication: public + ready + the owner is
--     listed in profile_public_directory (the same join as public_portfolio_media_key);
--     otherwise owner-only.
--   * product videos follow product image rules: publisher members, or viewers for
--     whom the product is public and app.product_image_viewable(...) is true.
--     Products never get anonymous delivery (ADR-0018 D2).
-- Revocation is immediate: delete, unpublish, delisting, suspension, sign-out and
-- audience changes deny the next playlist or segment request.
--
-- Rollback: drop the functions below, `drop table public.media_videos`, then the
-- two types. R2 objects under video/<id>/ are removed by the worker's purge.

create type public.media_video_state as enum ('uploading', 'processing', 'ready', 'failed', 'deleted');
create type public.media_video_scope as enum ('portfolio', 'product');

create table public.media_videos (
  id               uuid primary key default extensions.gen_random_uuid(),
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  scope            public.media_video_scope not null,
  product_id       uuid references public.products(id) on delete cascade,
  publisher_id     uuid references public.publishers(id) on delete cascade,
  title            text not null,
  visibility       public.portfolio_visibility not null default 'private',
  state            public.media_video_state not null default 'uploading',
  content_type     text not null,
  declared_bytes   bigint not null,
  size_bytes       bigint,
  duration_seconds numeric(12,3),
  width            integer,
  height           integer,
  renditions       text[] not null default '{}',
  has_poster       boolean not null default false,
  -- Output prefix version: video/<id>/<revision>/... Immutable once ready, so
  -- the edge may cache segment bytes keyed by it.
  revision         uuid,
  -- S3 multipart upload id. Never granted to clients (column privileges below).
  upload_id        text,
  -- Delivery provider (ADR-0020 Revision 2). Only r2_hls is implemented; a
  -- Cloudflare Stream row would carry its Stream uid in provider_ref.
  provider         text not null default 'r2_hls',
  provider_ref     text,
  -- Position among the owner's portfolio media, in the same space as
  -- portfolio_items.sort_order, so images and videos share one order.
  sort_order       integer,
  -- Position in the product gallery, in the same 1..3 space as product_images.slot
  -- (4..6 only while reordering). Lowest first.
  slot             smallint,
  attempts         smallint not null default 0,
  lease_until      timestamptz,
  failure_code     text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Last time the uploader asked to continue. An upload expires after a day
  -- without activity, or after six days in all: R2 aborts unfinished multipart
  -- uploads after seven (a provider limit).
  upload_touched_at timestamptz not null default now(),
  uploaded_at      timestamptz,
  ready_at         timestamptz,
  deleted_at       timestamptz,
  purged_at        timestamptz,
  constraint ck_media_videos_title check (char_length(btrim(title)) between 1 and 120),
  constraint ck_media_videos_type check (content_type in ('video/mp4', 'video/quicktime', 'video/webm')),
  -- No product cap on size or length. 5 TiB is R2's own object limit (a provider
  -- constraint): frontend/src/lib/media/video-policy.ts mirrors it.
  constraint ck_media_videos_declared check (declared_bytes > 0 and declared_bytes <= 5497558138880),
  constraint ck_media_videos_size check (size_bytes is null or size_bytes = declared_bytes),
  constraint ck_media_videos_duration check (duration_seconds is null or duration_seconds > 0),
  constraint ck_media_videos_dimensions check ((width is null) = (height is null) and (width is null or (width between 16 and 7680 and height between 16 and 7680))),
  constraint ck_media_videos_renditions check (renditions <@ array['360p', '720p', '1080p']::text[]),
  constraint ck_media_videos_scope check (
    (scope = 'portfolio' and product_id is null and publisher_id is null and sort_order is not null and slot is null)
    or (scope = 'product' and product_id is not null and publisher_id is not null and visibility = 'private'
        and sort_order is null and slot between 1 and 6)),
  constraint ck_media_videos_provider check (provider in ('r2_hls', 'cloudflare_stream')
    and (provider_ref is null or char_length(provider_ref) between 1 and 200)),
  constraint ck_media_videos_public_is_ready check (visibility = 'private' or state = 'ready'),
  constraint ck_media_videos_ready check (state <> 'ready' or (revision is not null and cardinality(renditions) > 0 and duration_seconds is not null)),
  constraint ck_media_videos_attempts check (attempts between 0 and 10),
  constraint ck_media_videos_failure check (failure_code is null or failure_code in
    ('invalid_media', 'no_video_stream', 'transcode_failed', 'upload_incomplete', 'expired'))
);

create index ix_media_videos_owner on public.media_videos (owner_user_id, created_at) where state <> 'deleted';
create index ix_media_videos_product on public.media_videos (product_id) where state <> 'deleted';
-- A gallery slot holds one live item; product_images has the same index.
create unique index uq_media_videos_slot on public.media_videos (product_id, slot) where state <> 'deleted';
create index ix_media_videos_publisher on public.media_videos (publisher_id);
create index ix_media_videos_jobs on public.media_videos (uploaded_at) where state = 'processing';
create index ix_media_videos_purge on public.media_videos (deleted_at) where state = 'deleted' and purged_at is null;

create trigger trg_media_videos_updated_at before update on public.media_videos
  for each row execute function app.set_updated_at();

alter table public.media_videos enable row level security;

create policy media_videos_select_own on public.media_videos
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and state <> 'deleted');

-- Publisher members manage their products' videos, like product images.
create policy media_videos_select_publisher on public.media_videos
  for select to authenticated
  using (scope = 'product' and state <> 'deleted' and app.is_publisher_member(publisher_id));

-- Reads only; every write goes through the functions below.
revoke all on public.media_videos from anon, authenticated, service_role;
grant select (id, owner_user_id, scope, product_id, title, visibility, state, content_type, size_bytes,
  duration_seconds, width, height, renditions, has_poster, failure_code, created_at, updated_at, ready_at,
  provider, sort_order, slot)
  on public.media_videos to authenticated;
grant select, insert, update, delete on public.media_videos to service_role;

-- ---------------------------------------------------------------------------
-- One order for images and videos (ADR-0020 Revision 2)
-- ---------------------------------------------------------------------------
-- Portfolio photos (portfolio_items.sort_order) and portfolio videos
-- (media_videos.sort_order) share one position space per owner; product photos
-- (product_images.slot) and product videos (media_videos.slot) share the product
-- gallery's 1..3 slots. The existing limit of three items per product therefore
-- covers photos and videos together; nothing new is counted.

create function app.portfolio_next_position(p_owner uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(max(x.pos), -1) + 1 from (
    select i.sort_order as pos from public.portfolio_items i
     where i.owner_user_id = p_owner and i.state <> 'deleted'::public.professional_asset_state
    union all
    select v.sort_order from public.media_videos v
     where v.owner_user_id = p_owner and v.scope = 'portfolio' and v.state <> 'deleted') x;
$$;
revoke all on function app.portfolio_next_position(uuid) from public, anon, authenticated, service_role;

-- The lowest gallery slot no live photo or video holds. Callers lock the product row.
create function app.product_media_free_slot(p_product_id uuid)
returns smallint language sql stable security definer set search_path = '' as $$
  select s::smallint from generate_series(1, 3) s
   where not exists (select 1 from public.product_images i
                      where i.product_id = p_product_id and i.state <> 'deleted' and i.slot = s)
     and not exists (select 1 from public.media_videos v
                      where v.product_id = p_product_id and v.state <> 'deleted' and v.slot = s)
   order by s limit 1;
$$;
revoke all on function app.product_media_free_slot(uuid) from public, anon, authenticated, service_role;

-- New portfolio photos go after the last photo OR video.
create or replace function public.portfolio_item_create(
  p_title        text,
  p_description  text,
  p_content_type text
)
returns table (item_id uuid, object_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_ext  text;
  v_key  text;
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.can_create_professional_asset() then
    raise exception 'a professional persona is required to add portfolio work'
      using errcode = '42501';
  end if;
  v_ext := case p_content_type
             when 'image/jpeg' then 'jpg'
             when 'image/png'  then 'png'
             when 'image/webp' then 'webp'
           end;
  if v_ext is null then
    raise exception 'unsupported content type for portfolio work'
      using errcode = '22023';
  end if;
  v_key := extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.portfolio_items
    (owner_user_id, object_key, content_type, title, description, sort_order)
  values
    (v_uid, v_key, p_content_type, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
     app.portfolio_next_position(v_uid))
  returning id into v_id;
  return query select v_id, v_key;
end;
$$;

-- Moves one photo or video earlier or later in the owner's portfolio. Renumbers
-- both tables densely in the current total order first, as portfolio_item_move did.
create function public.portfolio_media_move(p_kind text, p_id uuid, p_direction text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid  uuid := (select auth.uid());
  v_pos  integer;
  v_kind text;
  v_swap uuid;
begin
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception 'unknown direction' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('image', 'video') then
    raise exception 'unknown media kind' using errcode = '22023';
  end if;
  if v_uid is null then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
  -- One reorder per owner at a time: two tables cannot share a row lock.
  perform pg_advisory_xact_lock(hashtext('portfolio_media_order'), hashtext(v_uid::text));
  if p_kind = 'image' then
    perform 1 from public.portfolio_items
     where id = p_id and owner_user_id = v_uid and state <> 'deleted'::public.professional_asset_state;
  else
    perform 1 from public.media_videos
     where id = p_id and owner_user_id = v_uid and scope = 'portfolio' and state <> 'deleted';
  end if;
  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;

  with entries as (
    select 'image'::text as kind, i.id, i.sort_order, i.created_at from public.portfolio_items i
     where i.owner_user_id = v_uid and i.state <> 'deleted'::public.professional_asset_state
    union all
    select 'video', v.id, v.sort_order, v.created_at from public.media_videos v
     where v.owner_user_id = v_uid and v.scope = 'portfolio' and v.state <> 'deleted'
  ), ordered as (
    select kind, id, (row_number() over (order by sort_order, created_at, id) - 1)::integer as rn from entries
  ), images as (
    update public.portfolio_items i set sort_order = o.rn
      from ordered o where o.kind = 'image' and i.id = o.id and i.sort_order is distinct from o.rn
    returning 1
  )
  update public.media_videos v set sort_order = o.rn
    from ordered o where o.kind = 'video' and v.id = o.id and v.sort_order is distinct from o.rn;

  if p_kind = 'image' then
    select sort_order into v_pos from public.portfolio_items where id = p_id;
  else
    select sort_order into v_pos from public.media_videos where id = p_id;
  end if;

  select x.kind, x.id into v_kind, v_swap from (
    select 'image'::text as kind, i.id, i.sort_order from public.portfolio_items i
     where i.owner_user_id = v_uid and i.state <> 'deleted'::public.professional_asset_state
    union all
    select 'video', v.id, v.sort_order from public.media_videos v
     where v.owner_user_id = v_uid and v.scope = 'portfolio' and v.state <> 'deleted') x
   where x.sort_order = case when p_direction = 'up' then v_pos - 1 else v_pos + 1 end;
  -- At either end there is nothing to swap with; that is a no-op, not an error.
  if v_swap is null then
    return;
  end if;

  if v_kind = 'image' then
    update public.portfolio_items set sort_order = v_pos where id = v_swap;
  else
    update public.media_videos set sort_order = v_pos where id = v_swap;
  end if;
  if p_kind = 'image' then
    update public.portfolio_items set sort_order = case when p_direction = 'up' then v_pos - 1 else v_pos + 1 end where id = p_id;
  else
    update public.media_videos set sort_order = case when p_direction = 'up' then v_pos - 1 else v_pos + 1 end where id = p_id;
  end if;
end;
$$;

-- The photo-only mover keeps its signature and now moves within the shared order.
create or replace function public.portfolio_item_move(p_item_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.portfolio_media_move('image', p_item_id, p_direction);
end;
$$;

-- Product photos take the lowest slot no photo or video holds.
create or replace function public.product_image_request_upload(p_product_id uuid, p_content_type text)
 returns text
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_p    public.products;
  v_ext  text;
  v_pos  smallint;
  v_key  text;
begin
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
  if v_ext is null then
    raise exception 'unsupported content type' using errcode = '22023';
  end if;
  -- Locking the product row serializes slot allocation, so concurrent requests cannot overfill it.
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not app.can_write_publisher(v_p.publisher_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  if v_p.archived_at is not null then
    raise exception 'an archived product must be restored before its images change' using errcode = '22023';
  end if;
  -- An abandoned pending slot does not block the product forever.
  update public.product_images set state = 'deleted'
   where product_id = p_product_id and state = 'pending' and created_at < now() - interval '1 hour';
  v_pos := app.product_media_free_slot(p_product_id);
  if v_pos is null then
    raise exception 'a product can have at most 3 images' using errcode = '23514';
  end if;
  v_key := coalesce(v_p.organization_id, v_p.publisher_id)::text || '/' || p_product_id::text || '/' || extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.product_images (product_id, organization_id, object_key, content_type, slot, created_by)
  values (p_product_id, v_p.organization_id, v_key, p_content_type, v_pos, (select auth.uid()));
  return v_key;
end;
$function$;

-- The table-level backstop counts videos too.
create or replace function app.product_images_enforce_max()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.slot > 3 then
    raise exception 'image slot must be 1..3' using errcode = '23514';
  end if;
  if (select count(*) from public.product_images where product_id = new.product_id and state <> 'deleted')
     + (select count(*) from public.media_videos where product_id = new.product_id and state <> 'deleted') >= 3 then
    raise exception 'a product can have at most 3 images' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Reorders a product's ready photos and videos together. p_items lists every
-- ready item exactly once, as [{"kind":"image"|"video","id":"<uuid>"}, ...] in the
-- new order; they take the slots the ready items already hold, lowest first.
-- Items still uploading or processing keep their slots.
create function public.product_media_reorder(p_product_id uuid, p_items jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_p     public.products;
  v_slots smallint[];
  v_have  text[];
  v_want  text[];
  i       integer;
  v_item  jsonb;
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if not app.can_write_publisher(v_p.publisher_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'the order must list every ready photo and video of the product exactly once' using errcode = '22023';
  end if;
  select array_agg(x.slot order by x.slot), array_agg(x.kind || ':' || x.id order by x.kind || ':' || x.id)
    into v_slots, v_have
    from (select 'image'::text as kind, pi.id, pi.slot from public.product_images pi
           where pi.product_id = p_product_id and pi.state = 'ready'
          union all
          select 'video', mv.id, mv.slot from public.media_videos mv
           where mv.product_id = p_product_id and mv.state = 'ready') x;
  select array_agg(e ->> 'kind' || ':' || lower(e ->> 'id') order by e ->> 'kind' || ':' || lower(e ->> 'id'))
    into v_want from jsonb_array_elements(p_items) e;
  if coalesce(cardinality(v_want), 0) is distinct from coalesce(cardinality(v_have), 0)
     or v_want is distinct from v_have then
    raise exception 'the order must list every ready photo and video of the product exactly once' using errcode = '22023';
  end if;
  -- Park everything ready in the scratch slots 4..6, then place it.
  update public.product_images set slot = slot + 3 where product_id = p_product_id and state = 'ready';
  update public.media_videos set slot = slot + 3 where product_id = p_product_id and state = 'ready';
  for i in 1 .. coalesce(jsonb_array_length(p_items), 0) loop
    v_item := p_items -> (i - 1);
    if v_item ->> 'kind' = 'image' then
      update public.product_images set slot = v_slots[i] where id = (v_item ->> 'id')::uuid;
    else
      update public.media_videos set slot = v_slots[i] where id = (v_item ->> 'id')::uuid;
    end if;
  end loop;
  perform app.record_audit_event('product.image_reordered', 'product', p_product_id, v_p.organization_id,
    jsonb_build_object('videos', true));
end;
$$;

-- ---------------------------------------------------------------------------
-- Authoring (signed-in callers)
-- ---------------------------------------------------------------------------

-- Who may change one video: the owner for portfolio work, a catalog writer of the
-- product's publisher for product videos. Locks the row.
create function app.video_writable(p_id uuid)
returns public.media_videos language plpgsql volatile security definer set search_path = '' as $$
declare v public.media_videos; v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v from public.media_videos where id = p_id and state <> 'deleted' for update;
  if not found or not (case v.scope when 'portfolio' then v.owner_user_id = v_uid
      else app.can_write_publisher(v.publisher_id) end) then
    raise exception 'video not found' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function app.video_writable(uuid) from public, anon, authenticated, service_role;

create function public.video_upload_begin(p_scope text, p_product_id uuid, p_title text,
  p_content_type text, p_bytes bigint)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_product public.products;
  v_slot smallint;
  v_id uuid;
begin
  if v_uid is null or not app.account_is_active(v_uid) then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_content_type is null or p_content_type not in ('video/mp4', 'video/quicktime', 'video/webm') then
    raise exception 'unsupported video type' using errcode = '22023';
  end if;
  -- No product size cap: only R2's own 5 TiB object limit.
  if p_bytes is null or p_bytes <= 0 or p_bytes > 5497558138880 then
    raise exception 'video size is outside what storage accepts' using errcode = '22023';
  end if;
  -- Resource protection, not a media quota: the same ten in-flight uploads per
  -- person that app.limit_pending_media allows for images.
  if (select count(*) from public.media_videos
       where owner_user_id = v_uid and state = 'uploading') >= 10 then
    raise exception 'too many unfinished uploads' using errcode = '23514';
  end if;
  if p_scope = 'portfolio' then
    if p_product_id is not null then raise exception 'invalid scope' using errcode = '22023'; end if;
    if not app.can_create_professional_asset() then
      raise exception 'a professional persona is required to add portfolio work' using errcode = '42501';
    end if;
    -- Portfolios have no count limit for photos, so none for videos either.
    insert into public.media_videos (owner_user_id, scope, title, content_type, declared_bytes, sort_order)
    values (v_uid, 'portfolio', btrim(p_title), p_content_type, p_bytes, app.portfolio_next_position(v_uid))
    returning id into v_id;
  elsif p_scope = 'product' then
    -- Locking the product serializes slot allocation with product_image_request_upload.
    select * into v_product from public.products where id = p_product_id and deleted_at is null for update;
    if not found or not app.can_write_publisher(v_product.publisher_id) then
      raise exception 'catalog.write required' using errcode = '42501';
    end if;
    if v_product.archived_at is not null then
      raise exception 'an archived product must be restored before its media change' using errcode = '22023';
    end if;
    -- The product gallery's existing limit (three items) covers images and videos together.
    v_slot := app.product_media_free_slot(p_product_id);
    if v_slot is null then
      raise exception 'a product can have at most 3 photos and videos' using errcode = '23514';
    end if;
    insert into public.media_videos (owner_user_id, scope, product_id, publisher_id, title, content_type, declared_bytes, slot)
    values (v_uid, 'product', p_product_id, v_product.publisher_id, btrim(p_title), p_content_type, p_bytes, v_slot)
    returning id into v_id;
  else
    raise exception 'invalid scope' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- The upload in progress, for the caller who may write it. Returns the multipart
-- id so the server can presign parts; useless without the R2 credentials.
create function app.video_upload_expired(v public.media_videos)
returns boolean language sql stable set search_path = '' as $$
  select v.created_at < now() - interval '6 days' or v.upload_touched_at < now() - interval '24 hours';
$$;
revoke all on function app.video_upload_expired(public.media_videos) from public, anon, authenticated, service_role;

create function public.video_upload_resolve(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v public.media_videos;
begin
  v := app.video_writable(p_id);
  if v.state = 'uploading' and not app.video_upload_expired(v) then
    update public.media_videos set upload_touched_at = now() where id = p_id;
  end if;
  return jsonb_build_object('id', v.id, 'state', v.state, 'contentType', v.content_type,
    'declaredBytes', v.declared_bytes, 'uploadId', case when v.state = 'uploading' then v.upload_id end,
    'expired', v.state = 'uploading' and app.video_upload_expired(v));
end;
$$;

create function public.video_update(p_id uuid, p_title text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  perform app.video_writable(p_id);
  update public.media_videos set title = btrim(p_title) where id = p_id;
end;
$$;

create function public.video_set_visibility(p_id uuid, p_public boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v public.media_videos;
begin
  v := app.video_writable(p_id);
  if v.scope <> 'portfolio' then
    raise exception 'product videos follow the product audience' using errcode = '22023';
  end if;
  if p_public and v.state <> 'ready' then
    raise exception 'an unfinished video cannot be published' using errcode = '22023';
  end if;
  update public.media_videos
     set visibility = case when p_public then 'public' else 'private' end::public.portfolio_visibility
   where id = p_id;
end;
$$;

-- Immediate: the next playlist or segment request is refused. The bytes are
-- removed afterwards by the worker's purge. Returns the multipart id to abort.
create function public.video_delete(p_id uuid)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v public.media_videos;
begin
  v := app.video_writable(p_id);
  update public.media_videos
     set state = 'deleted', visibility = 'private', deleted_at = now(), lease_until = null
   where id = p_id;
  return case when v.state = 'uploading' then v.upload_id end;
end;
$$;

-- Public portfolio page: published, ready videos of a listed profile, with
-- their place in the owner's shared photo-and-video order.
create function public.public_portfolio_videos(p_profile_id uuid)
returns table (id uuid, title text, duration_seconds numeric, width integer, height integer, has_poster boolean,
  sort_order integer, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.duration_seconds, v.width, v.height, v.has_poster, v.sort_order, v.created_at
    from public.profile_public_directory d
    join public.profiles p on p.id = d.id
    join public.media_videos v on v.owner_user_id = p.user_id
   where d.id = p_profile_id and v.scope = 'portfolio' and v.provider = 'r2_hls'
     and v.visibility = 'public' and v.state = 'ready'
   order by v.sort_order, v.created_at, v.id;
$$;

-- Product page: ready videos of a product the caller may see.
create function public.product_videos(p_product_id uuid, p_workspace uuid default null)
returns table (id uuid, title text, duration_seconds numeric, width integer, height integer, has_poster boolean,
  slot smallint)
language sql stable security definer set search_path = '' as $$
  select v.id, v.title, v.duration_seconds, v.width, v.height, v.has_poster, v.slot
    from public.media_videos v
   where v.product_id = p_product_id and v.scope = 'product' and v.state = 'ready' and v.provider = 'r2_hls'
     and (select auth.uid()) is not null and app.account_is_active((select auth.uid()))
     and (app.is_publisher_member(v.publisher_id)
          or (app.product_is_public(p_product_id) and app.product_image_viewable(p_product_id, p_workspace)))
   order by v.slot, v.id;
$$;

-- ---------------------------------------------------------------------------
-- Trusted server and worker (service_role only)
-- ---------------------------------------------------------------------------

create function public.video_upload_attach(p_id uuid, p_upload_id text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_upload_id is null or length(p_upload_id) not between 1 and 1024 then
    raise exception 'invalid upload id' using errcode = '22023';
  end if;
  update public.media_videos set upload_id = p_upload_id
   where id = p_id and state = 'uploading' and upload_id is null;
  if not found then raise exception 'video not found' using errcode = 'P0002'; end if;
end;
$$;

-- Called after the server listed the parts, completed the multipart upload and
-- checked the stored size and the file signature.
create function public.video_upload_complete(p_id uuid, p_size bigint)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.media_videos
     set state = 'processing', size_bytes = p_size, uploaded_at = now(), upload_id = null
   where id = p_id and state = 'uploading' and declared_bytes = p_size
     and created_at >= now() - interval '6 days' and upload_touched_at >= now() - interval '24 hours';
  if not found then raise exception 'upload cannot be completed' using errcode = '22023'; end if;
end;
$$;

-- One job, leased. SKIP LOCKED lets several workers run without coordination;
-- an expired lease (crashed worker) is picked up again, at most three attempts.
-- A long video outlives one lease: the worker renews it (video_job_renew).
create function public.video_job_claim(p_lease_seconds integer default 900)
returns table (id uuid, content_type text, size_bytes bigint, attempts smallint)
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  select v.id into v_id from public.media_videos v
   where v.state = 'processing' and (v.lease_until is null or v.lease_until < now()) and v.attempts < 3
   order by v.uploaded_at
   for update skip locked
   limit 1;
  if v_id is null then return; end if;
  return query
    update public.media_videos v
       set lease_until = now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600))),
           attempts = v.attempts + 1
     where v.id = v_id
    returning v.id, v.content_type, v.size_bytes, v.attempts;
end;
$$;

-- Heartbeat from the worker holding the job. False means the job is gone
-- (deleted meanwhile) and the worker should stop.
create function public.video_job_renew(p_id uuid, p_lease_seconds integer default 900)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.media_videos
     set lease_until = now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600)))
   where id = p_id and state = 'processing';
  return found;
end;
$$;

-- Leases for processing rows whose attempts are spent become failures.
create function public.video_job_expire()
returns integer language sql volatile security definer set search_path = '' as $$
  with failed as (
    update public.media_videos set state = 'failed', failure_code = 'transcode_failed', lease_until = null
     where state = 'processing' and attempts >= 3 and (lease_until is null or lease_until < now())
    returning 1)
  select count(*)::integer from failed;
$$;

create function public.video_job_finish(p_id uuid, p_revision uuid, p_duration numeric,
  p_width integer, p_height integer, p_renditions text[], p_has_poster boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.media_videos
     set state = 'ready', revision = p_revision, duration_seconds = p_duration, width = p_width,
         height = p_height, renditions = p_renditions, has_poster = p_has_poster,
         ready_at = now(), lease_until = null, failure_code = null
   where id = p_id and state = 'processing';
  -- A video deleted while it was being processed stays deleted; its outputs are purged.
end;
$$;

create function public.video_job_fail(p_id uuid, p_code text, p_retry boolean)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.media_videos
     set state = case when p_retry and attempts < 3 then 'processing' else 'failed' end::public.media_video_state,
         failure_code = case when p_retry and attempts < 3 then null else p_code end,
         lease_until = null
   where id = p_id and state = 'processing';
end;
$$;

-- What the purge must remove: deleted videos not yet purged, after unfinished
-- uploads older than a day have been marked deleted.
create function public.video_purge_candidates(p_limit integer default 50)
returns table (id uuid, upload_id text, revision uuid)
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.media_videos
     set state = 'deleted', failure_code = 'expired', deleted_at = now()
   where state = 'uploading'
     and (created_at < now() - interval '6 days' or upload_touched_at < now() - interval '24 hours');
  return query
    select v.id, v.upload_id, v.revision from public.media_videos v
     where v.state = 'deleted' and v.purged_at is null
     order by v.deleted_at
     limit greatest(1, least(p_limit, 500));
end;
$$;

create function public.video_mark_purged(p_id uuid)
returns void language sql volatile security definer set search_path = '' as $$
  update public.media_videos set purged_at = now(), upload_id = null
   where id = p_id and state = 'deleted';
$$;

-- ---------------------------------------------------------------------------
-- Edge authority (media Worker, role media_edge)
-- ---------------------------------------------------------------------------

-- One decision per playlist, segment or poster request. A null viewer asks for
-- anonymous delivery, which only a published portfolio video of a listed profile
-- gets. Otherwise the ticket's viewer and Auth session are checked, as in
-- media_edge_authorize, and the caller-scoped rules run under that identity.
-- Play tickets live up to four hours because every segment request is decided
-- here again; the ticket never carries authority of its own.
create function public.media_edge_video(p_video uuid, p_viewer uuid, p_session uuid,
  p_workspace uuid, p_expires_at timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_role text := current_setting('request.jwt.claim.role', true);
  v public.media_videos;
  v_public boolean;
  v_allowed boolean := false;
begin
  if p_video is null then return null; end if;
  -- Only R2 + HLS videos are delivered by the Worker; another provider serves its own.
  select * into v from public.media_videos where id = p_video and state = 'ready' and provider = 'r2_hls';
  if not found then return null; end if;
  v_public := v.scope = 'portfolio' and v.visibility = 'public' and exists (
    select 1 from public.profiles p join public.profile_public_directory d on d.id = p.id
     where p.user_id = v.owner_user_id);
  if p_viewer is null then
    v_allowed := v_public;
  else
    if p_session is null or p_expires_at is null or p_expires_at < now() - interval '5 seconds'
      or p_expires_at > now() + interval '4 hours 5 seconds' then
      return null;
    end if;
    if not app.account_is_active(p_viewer) then return null; end if;
    perform set_config('request.jwt.claim.sub', p_viewer::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_viewer, 'role', 'authenticated',
      'session_id', p_session)::text, true);
    if app.jwt_session_is_live() then
      v_allowed := v_public or case v.scope
        when 'portfolio' then v.owner_user_id = p_viewer
        else app.is_publisher_member(v.publisher_id)
          or (app.product_is_public(v.product_id) and app.product_image_viewable(v.product_id, p_workspace)) end;
    end if;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_role, ''), true);
  end if;
  if not coalesce(v_allowed, false) then return null; end if;
  return jsonb_build_object('prefix', 'video/' || v.id || '/' || v.revision || '/',
    'revision', v.revision, 'renditions', to_jsonb(v.renditions), 'poster', v.has_poster,
    'public', v_public);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.video_upload_begin(text, uuid, text, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.portfolio_media_move(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.product_media_reorder(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.video_upload_resolve(uuid) from public, anon, authenticated, service_role;
revoke all on function public.video_update(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.video_set_visibility(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.video_delete(uuid) from public, anon, authenticated, service_role;
revoke all on function public.public_portfolio_videos(uuid) from public, anon, authenticated, service_role;
revoke all on function public.product_videos(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.video_upload_attach(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.video_upload_complete(uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function public.video_job_claim(integer) from public, anon, authenticated, service_role;
revoke all on function public.video_job_expire() from public, anon, authenticated, service_role;
revoke all on function public.video_job_renew(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.video_job_finish(uuid, uuid, numeric, integer, integer, text[], boolean) from public, anon, authenticated, service_role;
revoke all on function public.video_job_fail(uuid, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.video_purge_candidates(integer) from public, anon, authenticated, service_role;
revoke all on function public.video_mark_purged(uuid) from public, anon, authenticated, service_role;
revoke all on function public.media_edge_video(uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.video_upload_begin(text, uuid, text, text, bigint) to authenticated;
grant execute on function public.portfolio_media_move(text, uuid, text) to authenticated;
grant execute on function public.product_media_reorder(uuid, jsonb) to authenticated;
grant execute on function public.video_upload_resolve(uuid) to authenticated;
grant execute on function public.video_update(uuid, text) to authenticated;
grant execute on function public.video_set_visibility(uuid, boolean) to authenticated;
grant execute on function public.video_delete(uuid) to authenticated;
grant execute on function public.public_portfolio_videos(uuid) to anon, authenticated;
grant execute on function public.product_videos(uuid, uuid) to authenticated;
grant execute on function public.video_upload_attach(uuid, text) to service_role;
grant execute on function public.video_upload_complete(uuid, bigint) to service_role;
grant execute on function public.video_job_claim(integer) to service_role;
grant execute on function public.video_job_expire() to service_role;
grant execute on function public.video_job_renew(uuid, integer) to service_role;
grant execute on function public.video_job_finish(uuid, uuid, numeric, integer, integer, text[], boolean) to service_role;
grant execute on function public.video_job_fail(uuid, text, boolean) to service_role;
grant execute on function public.video_purge_candidates(integer) to service_role;
grant execute on function public.video_mark_purged(uuid) to service_role;
grant execute on function public.media_edge_video(uuid, uuid, uuid, uuid, timestamptz) to media_edge;

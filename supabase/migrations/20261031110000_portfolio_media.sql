-- ===========================================================================
-- Portfolio: several media per work, including one video.
--
-- A work (public.portfolio_items) keeps its single COVER IMAGE exactly as before
-- (object_key / content_type, created by portfolio_item_create). This migration
-- adds the work's OTHER media — up to 4 more images or one video — as child rows,
-- using the SAME metadata-row ownership model the cover and avatars use:
--
--   child row (owner_user_id a real column) created PENDING by an RPC BEFORE any
--   bytes upload -> constrained storage INSERT (policy requires the pending row
--   for THIS caller and THIS key) -> finalize (pending -> ready). Replacement or
--   removal is delete-the-row + best-effort delete-the-object; keys are
--   immutable, so the bucket has no UPDATE policy.
--
-- Rules enforced HERE (the UI repeats them only to answer quickly):
--   * at most 4 live extras per work (cover + 4 = the 5 the product allows);
--   * at most ONE video per work, and a video is never the cover;
--   * images <= 5 MiB, video <= 50 MiB (mp4 / mov); video length 1..600 s.
--
-- Deliberately OWNER-ONLY: no anon/public read policy and no public projection.
-- Showing extra media on the public profile is a separate, reviewed change (it
-- needs a sign-only public-read policy like professional_portfolio_select_published
-- and the public page to render it). Nothing is exposed by this migration.
-- ===========================================================================

-- A video bucket needs a larger limit than the 5 MiB cover bucket, so extras get
-- their own private bucket rather than loosening the existing one.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'professional-portfolio-media', 'professional-portfolio-media', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.portfolio_item_media (
  id               uuid primary key default extensions.gen_random_uuid(),
  item_id          uuid not null references public.portfolio_items (id) on delete cascade,
  owner_user_id    uuid not null references public.users (id) on delete cascade,
  object_key       text not null,
  content_type     text not null,
  kind             text generated always as (
                     case when content_type like 'video/%' then 'video' else 'image' end
                   ) stored,
  duration_seconds integer,
  -- Display position after the cover (1..4). Server-assigned, dense per item.
  position         smallint not null,
  state            public.professional_asset_state not null default 'pending',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint uq_portfolio_media_object_key unique (object_key),
  constraint ck_portfolio_media_object_key check (
    object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|mp4|mov)$'),
  constraint ck_portfolio_media_content_type check (
    content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')),
  constraint ck_portfolio_media_duration check (
    duration_seconds is null or duration_seconds between 1 and 600),
  constraint ck_portfolio_media_position check (position between 1 and 4)
);

comment on table public.portfolio_item_media is
  'Extra media (images or one video) of a portfolio work, beyond its cover image. Owner-bound metadata row — the authority the storage policies consult. A well-formed key alone proves nothing. Written only via portfolio_media_* RPCs; no client DML grant. Owner-only: no public read path exists.';

-- One live video per work, and one live row per position.
create unique index uq_portfolio_media_one_video
  on public.portfolio_item_media (item_id)
  where kind = 'video' and state <> 'deleted'::public.professional_asset_state;
create unique index uq_portfolio_media_position
  on public.portfolio_item_media (item_id, position)
  where state <> 'deleted'::public.professional_asset_state;
create index ix_portfolio_media_owner on public.portfolio_item_media (owner_user_id, item_id, position);

create trigger trg_portfolio_media_updated_at
  before update on public.portfolio_item_media
  for each row execute function app.set_updated_at();

revoke all on public.portfolio_item_media from anon, authenticated, service_role;
grant select on public.portfolio_item_media to authenticated;
alter table public.portfolio_item_media enable row level security;
create policy portfolio_media_select_own on public.portfolio_item_media
  for select to authenticated
  using (owner_user_id = (select auth.uid()) and state <> 'deleted'::public.professional_asset_state);

-- ---------------------------------------------------------------------------
-- Storage authority — same two predicates as the cover bucket, no public one.
-- ---------------------------------------------------------------------------
create function app.owns_portfolio_media_object(p_object_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.portfolio_item_media m
    where m.object_key = p_object_key and m.owner_user_id = (select auth.uid())
  );
$$;
comment on function app.owns_portfolio_media_object(text) is
  'True when the CALLER owns the media row for this object key (any state, so a superseded or discarded object stays removable by its owner).';

create function app.can_upload_portfolio_media_object(p_object_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.portfolio_item_media m
    where m.object_key = p_object_key
      and m.owner_user_id = (select auth.uid())
      and m.state = 'pending'::public.professional_asset_state
  );
$$;
comment on function app.can_upload_portfolio_media_object(text) is
  'True when the caller owns a PENDING media row for this key — authorization to write those exact bytes, once. A well-formed key is not sufficient.';

revoke execute on function app.owns_portfolio_media_object(text),
                          app.can_upload_portfolio_media_object(text) from public;
grant execute on function app.owns_portfolio_media_object(text),
                         app.can_upload_portfolio_media_object(text) to authenticated;

create policy portfolio_media_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'professional-portfolio-media' and app.can_upload_portfolio_media_object(name));

create policy portfolio_media_select_own_obj on storage.objects
  for select to authenticated
  using (bucket_id = 'professional-portfolio-media' and app.owns_portfolio_media_object(name));

create policy portfolio_media_delete_own_obj on storage.objects
  for delete to authenticated
  using (bucket_id = 'professional-portfolio-media' and app.owns_portfolio_media_object(name));

-- ---------------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------------
create function public.portfolio_media_create(
  p_item_id      uuid,
  p_content_type text,
  p_size         bigint,
  p_duration     integer default null
)
returns table (media_id uuid, object_key text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_state public.professional_asset_state;
  v_ext   text;
  v_video boolean;
  v_max   bigint;
  v_count integer;
  v_pos   smallint;
  v_key   text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.can_create_professional_asset() then
    raise exception 'a professional persona is required to add portfolio work'
      using errcode = '42501';
  end if;

  v_ext := case p_content_type
             when 'image/jpeg'      then 'jpg'
             when 'image/png'       then 'png'
             when 'image/webp'      then 'webp'
             when 'video/mp4'       then 'mp4'
             when 'video/quicktime' then 'mov'
           end;
  if v_ext is null then
    raise exception 'unsupported content type for portfolio media' using errcode = '22023';
  end if;
  v_video := p_content_type like 'video/%';

  if p_size is null or p_size <= 0 then
    raise exception 'empty file' using errcode = '22023';
  end if;
  v_max := case when v_video then 52428800 else 5242880 end;
  if p_size > v_max then
    raise exception 'file is too large' using errcode = '22023';
  end if;
  if v_video and (p_duration is null or p_duration not between 1 and 600) then
    raise exception 'video length is out of range' using errcode = '22023';
  end if;

  -- Lock the parent so two concurrent adds cannot both pass the count check.
  select i.state into v_state
  from public.portfolio_items i
  where i.id = p_item_id and i.owner_user_id = v_uid
  for update;
  if not found then
    raise exception 'portfolio item not found' using errcode = '42501';
  end if;
  if v_state <> 'ready'::public.professional_asset_state then
    raise exception 'the cover image must finish uploading first' using errcode = '22023';
  end if;

  select count(*) into v_count
  from public.portfolio_item_media m
  where m.item_id = p_item_id and m.state <> 'deleted'::public.professional_asset_state;
  if v_count >= 4 then
    raise exception 'a work can hold at most 5 files' using errcode = '22023';
  end if;
  if v_video and exists (
    select 1 from public.portfolio_item_media m
    where m.item_id = p_item_id and m.kind = 'video'
      and m.state <> 'deleted'::public.professional_asset_state
  ) then
    raise exception 'a work can hold only one video' using errcode = '22023';
  end if;

  -- Lowest FREE slot in 1..4 (not max+1): removing an extra frees its slot, and a
  -- later add must reuse it rather than drift past the 4-extra ceiling.
  select min(g.n) into v_pos
  from generate_series(1, 4) as g(n)
  where not exists (
    select 1 from public.portfolio_item_media m
    where m.item_id = p_item_id and m.position = g.n
      and m.state <> 'deleted'::public.professional_asset_state
  );

  v_key := extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.portfolio_item_media
    (item_id, owner_user_id, object_key, content_type, duration_seconds, position)
  values
    (p_item_id, v_uid, v_key, p_content_type, case when v_video then p_duration end, v_pos)
  returning id into v_id;

  return query select v_id, v_key;
end;
$$;
comment on function public.portfolio_media_create(uuid, text, bigint, integer) is
  'Creates a PENDING extra-media row for the caller''s own READY work and returns the opaque key to upload to, once. Enforces: persona, <= 4 extras, <= 1 video, size caps, video length. Metadata first, like every asset in this domain.';

create function public.portfolio_media_finalize(p_media_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_state public.professional_asset_state;
begin
  select m.state into v_state
  from public.portfolio_item_media m
  where m.id = p_media_id and m.owner_user_id = v_uid
  for update;
  if not found then
    raise exception 'portfolio media not found' using errcode = '42501';
  end if;
  if v_state = 'ready'::public.professional_asset_state then
    return;
  end if;
  if v_state <> 'pending'::public.professional_asset_state then
    raise exception 'this media cannot be finalized' using errcode = '22023';
  end if;
  update public.portfolio_item_media
     set state = 'ready'::public.professional_asset_state
   where id = p_media_id;
end;
$$;
comment on function public.portfolio_media_finalize(uuid) is
  'Marks a pending extra-media row ready once its bytes are stored. Idempotent. Does not publish anything — extras have no public path.';

-- Remove one of the caller's own extras (any state). Returns its key so the caller
-- can best-effort delete the bytes; a leftover object is unreachable by every
-- policy once its row is gone.
create function public.portfolio_media_remove(p_media_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text;
begin
  delete from public.portfolio_item_media m
   where m.id = p_media_id and m.owner_user_id = v_uid
  returning m.object_key into v_key;
  if v_key is null then
    raise exception 'portfolio media not found' using errcode = '42501';
  end if;
  return v_key;
end;
$$;
comment on function public.portfolio_media_remove(uuid) is
  'Deletes the caller''s own extra-media row and returns its object key for cleanup. No persona gate: removing your own data is always allowed.';

revoke execute on function public.portfolio_media_create(uuid, text, bigint, integer),
                          public.portfolio_media_finalize(uuid),
                          public.portfolio_media_remove(uuid) from public;
grant execute on function public.portfolio_media_create(uuid, text, bigint, integer),
                         public.portfolio_media_finalize(uuid),
                         public.portfolio_media_remove(uuid) to authenticated;

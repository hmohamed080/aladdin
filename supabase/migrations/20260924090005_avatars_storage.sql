-- ===========================================================================
-- Staging-prep Increment 5 — avatar upload, metadata-row ownership model
--
-- CORRECTED DESIGN. An earlier draft proposed direct client-facing
-- avatars_insert_own/select_own/delete_own storage policies gated ONLY by
-- object-key SHAPE (an "is this a well-formed avatar key" check) with no real
-- ownership proof for opaque (no-owner-segment) keys — that would have
-- granted every authenticated caller broad, effectively-anyone-can-upload
-- access to the whole bucket. This exact mistake was already made once in
-- this codebase for the portfolio bucket (Increment 10) and fixed one
-- migration later (Increment 11,
-- 20260907090001_portfolio_and_certificates.sql) by replacing the key-shape
-- check with a metadata-row ownership model. This migration mirrors that
-- proven pattern exactly rather than repeating the mistake:
--
--   owner-bound metadata row (avatar_uploads, owner_user_id a real column)
--   -> pending upload (state='pending', row created by the RPC BEFORE any
--      bytes are uploaded — a well-formed key is not itself sufficient)
--   -> constrained storage write (INSERT policy requires the pending row)
--   -> confirm (avatar_confirm_upload flips state='ready', updates
--      profiles.avatar_media_id)
--   -> safe previous-object cleanup (old row -> 'deleted', old object
--      best-effort removed — replacement is new-object + metadata-switch +
--      cleanup, never an in-place overwrite, same reasoning Increment 10
--      documents for why neither bucket there has an UPDATE policy).
--
-- Reuses the existing public.professional_asset_state enum ('pending',
-- 'ready', 'deleted') rather than inventing a new one — same convergence-
-- lifecycle discipline already established for portfolio/certificates.
--
-- profiles.avatar_media_id already exists (20260802090001_identity_core.sql,
-- "FK to media added by the media migration (later phase)") and is confirmed
-- (repo-wide grep) to have no FK today and zero writers anywhere in the
-- codebase — safe to repurpose. Repurposed here EXPLICITLY as a real,
-- intentional FK to avatar_uploads(id), not a silent assumption.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.avatar_uploads (
  id            uuid primary key default extensions.gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  object_key    text not null unique check (object_key ~ '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  content_type  text not null,
  state         public.professional_asset_state not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.avatar_uploads is
  'Owner-bound metadata row for an avatar storage object — the authority RLS on storage.objects checks, mirroring public.portfolio_items exactly. A well-formed storage key alone proves nothing; only a matching row here (and, for upload, state=''pending'') does. Written only via avatar_request_upload/avatar_confirm_upload — no direct client INSERT/UPDATE/DELETE grant.';

create index ix_avatar_uploads_owner on public.avatar_uploads (owner_user_id);

revoke all on public.avatar_uploads from anon, authenticated, service_role;
grant select on public.avatar_uploads to authenticated;
alter table public.avatar_uploads enable row level security;
create policy avatar_uploads_select_own on public.avatar_uploads
  for select to authenticated using (owner_user_id = (select auth.uid()));

create trigger set_avatar_uploads_updated_at
  before update on public.avatar_uploads
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ownership/upload/publish predicates — same three-predicate shape as
-- app.owns_portfolio_object / app.can_upload_portfolio_object /
-- app.is_published_portfolio_object.
-- ---------------------------------------------------------------------------
create or replace function app.owns_avatar_object(p_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.avatar_uploads
    where object_key = p_key and owner_user_id = (select auth.uid())
  );
$$;
comment on function app.owns_avatar_object(text) is
  'True when a storage object key belongs to the CALLER, ignoring state — so an object stays readable/deletable by its owner even after being superseded (state=''deleted'').';
revoke execute on function app.owns_avatar_object(text) from public;
grant execute on function app.owns_avatar_object(text) to authenticated;

create or replace function app.can_upload_avatar_object(p_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.avatar_uploads
    where object_key = p_key and owner_user_id = (select auth.uid()) and state = 'pending'
  );
$$;
comment on function app.can_upload_avatar_object(text) is
  'Stricter than owns_avatar_object: also requires state=''pending''. A well-formed key is not sufficient to upload — avatar_request_upload must have already created the pending row for THIS caller and THIS key.';
revoke execute on function app.can_upload_avatar_object(text) from public;
grant execute on function app.can_upload_avatar_object(text) to authenticated;

create or replace function app.is_current_avatar_object(p_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.avatar_uploads au
    join public.profiles p on p.avatar_media_id = au.id
    where au.object_key = p_key and au.state = 'ready'
  );
$$;
comment on function app.is_current_avatar_object(text) is
  'True when a storage object is a profile''s CURRENT ready avatar — the predicate the anon/authenticated sign-only public-read policy consults, mirroring app.is_published_portfolio_object.';
revoke execute on function app.is_current_avatar_object(text) from public;
grant execute on function app.is_current_avatar_object(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Storage policies — mirror 20260907090001/20260908090001 exactly.
-- ---------------------------------------------------------------------------
create policy avatars_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and app.can_upload_avatar_object(name));

create policy avatars_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and app.owns_avatar_object(name));

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and app.owns_avatar_object(name));

-- Sign-only public read (Increment 11's correction, applied from the start
-- here rather than needing a follow-up migration): the operation GUC check
-- comes first (cheap), the join second, and fetching the resulting signed
-- URL consults no policy at all (the token is the authority) — see
-- 20260908090001_portfolio_public_read_sign_only.sql's full measured-not-
-- assumed reasoning, which applies unchanged.
create policy avatars_select_published on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'avatars'
    and storage.allow_only_operation('storage.object.sign')
    and app.is_current_avatar_object(name)
  );

-- No UPDATE policy on this bucket — the overwrite rule, same reasoning as
-- Increment 10: an object key is immutable; a replacement is a new object +
-- a metadata switch + a delete, never bytes changing underneath an identity
-- something else already points at.

-- ---------------------------------------------------------------------------
-- public.avatar_request_upload — generates the key SERVER-SIDE and inserts
-- the pending row FIRST. A well-formed key the client invented on its own is
-- never sufficient to upload (see can_upload_avatar_object above).
-- ---------------------------------------------------------------------------
create or replace function public.avatar_request_upload(p_content_type text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ext text;
  v_key text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  v_ext := case p_content_type
    when 'image/jpeg' then 'jpg'
    when 'image/png'  then 'png'
    when 'image/webp' then 'webp'
    else null
  end;
  if v_ext is null then
    raise exception 'unsupported content type' using errcode = '22023';
  end if;

  v_key := extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.avatar_uploads (owner_user_id, object_key, content_type, state)
  values (v_uid, v_key, p_content_type, 'pending');

  return v_key;
end;
$$;
comment on function public.avatar_request_upload(text) is
  'Generates the object key server-side and inserts the pending avatar_uploads row BEFORE the client uploads any bytes. Returns the key the client must upload to; the storage INSERT policy (avatars_insert_authorized) requires this row to already exist.';
revoke execute on function public.avatar_request_upload(text) from public;
grant execute on function public.avatar_request_upload(text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.avatar_confirm_upload — flips the row to 'ready', atomically points
-- profiles.avatar_media_id at it, and retires the previous avatar (metadata
-- + best-effort storage cleanup happens application-side, since Postgres
-- cannot delete a storage object itself — the RPC returns the previous
-- object's key so the caller can delete it after this transaction commits).
-- ---------------------------------------------------------------------------
create or replace function public.avatar_confirm_upload(p_object_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_upload_id uuid;
  v_prev_id   uuid;
  v_prev_key  text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select id into v_upload_id
    from public.avatar_uploads
   where object_key = p_object_key and owner_user_id = v_uid and state = 'pending';
  if v_upload_id is null then
    raise exception 'no matching pending avatar upload for this caller' using errcode = 'P0002';
  end if;

  select avatar_media_id into v_prev_id from public.profiles where user_id = v_uid;
  if v_prev_id is not null then
    select object_key into v_prev_key from public.avatar_uploads where id = v_prev_id;
  end if;

  update public.avatar_uploads set state = 'ready' where id = v_upload_id;
  update public.profiles set avatar_media_id = v_upload_id where user_id = v_uid;
  if v_prev_id is not null then
    update public.avatar_uploads set state = 'deleted' where id = v_prev_id;
  end if;

  perform app.record_audit_event('profile.avatar_set', 'user', v_uid, null,
    jsonb_build_object('object_key', p_object_key));

  -- The caller deletes this storage object (best-effort) after commit — see
  -- frontend/src/lib/storage/avatar-assets.ts.
  return v_prev_key;
end;
$$;
comment on function public.avatar_confirm_upload(text) is
  'Flips a pending avatar_uploads row to ready, atomically updates profiles.avatar_media_id, and marks the previous avatar row deleted. Returns the previous object''s storage key (or null) so the caller can best-effort delete the underlying bytes — replacement is new-object + metadata-switch + cleanup, never an in-place overwrite.';
revoke execute on function public.avatar_confirm_upload(text) from public;
grant execute on function public.avatar_confirm_upload(text) to authenticated;

alter table public.profiles
  add constraint fk_profiles_avatar_media_id
  foreign key (avatar_media_id) references public.avatar_uploads(id) on delete set null;

comment on column public.profiles.avatar_media_id is
  'FK to avatar_uploads(id) — repurposed explicitly by this migration (Increment 5). Confirmed unused (no FK, zero writers) before this change. Set only by public.avatar_confirm_upload.';

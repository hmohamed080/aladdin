-- ===========================================================================
-- Profile cover photo — owner-bound metadata-row model, mirroring avatars
-- (20260924090005_avatars_storage.sql) exactly:
--
--   cover_uploads row (owner_user_id a real column), created PENDING by the RPC
--   BEFORE any bytes upload -> constrained storage INSERT (policy requires the
--   pending row for THIS caller and THIS key) -> confirm (flip to ready, point
--   profiles.cover_media_id at it, retire the previous row) -> previous object
--   removed best-effort by the caller. Replacement is new-object +
--   metadata-switch + cleanup, never an in-place overwrite, so the bucket has
--   no UPDATE policy.
--
-- Deliberately OWNER-ONLY: there is no anon/public read policy. Showing a cover
-- on the public profile is a separate, reviewed change (it needs a sign-only
-- public-read policy like avatars_select_published). No audit event is
-- recorded: adding one means rewriting the audit-action allowlist, which this
-- cosmetic field does not justify.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('covers', 'covers', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table public.cover_uploads (
  id            uuid primary key default extensions.gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  object_key    text not null unique check (object_key ~ '^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'),
  content_type  text not null,
  state         public.professional_asset_state not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.cover_uploads is
  'Owner-bound metadata row for a profile cover storage object — the authority RLS on storage.objects checks, mirroring public.avatar_uploads. A well-formed key alone proves nothing; only a matching row here (and, for upload, state=''pending'') does. Written only via cover_request_upload/cover_confirm_upload — no direct client INSERT/UPDATE/DELETE grant.';

create index ix_cover_uploads_owner on public.cover_uploads (owner_user_id);

revoke all on public.cover_uploads from anon, authenticated, service_role;
grant select on public.cover_uploads to authenticated;
alter table public.cover_uploads enable row level security;
create policy cover_uploads_select_own on public.cover_uploads
  for select to authenticated using (owner_user_id = (select auth.uid()));

create trigger set_cover_uploads_updated_at
  before update on public.cover_uploads
  for each row execute function app.set_updated_at();

create or replace function app.owns_cover_object(p_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cover_uploads
    where object_key = p_key and owner_user_id = (select auth.uid())
  );
$$;
revoke execute on function app.owns_cover_object(text) from public;
grant execute on function app.owns_cover_object(text) to authenticated;

create or replace function app.can_upload_cover_object(p_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.cover_uploads
    where object_key = p_key and owner_user_id = (select auth.uid()) and state = 'pending'
  );
$$;
revoke execute on function app.can_upload_cover_object(text) from public;
grant execute on function app.can_upload_cover_object(text) to authenticated;

create policy covers_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'covers' and app.can_upload_cover_object(name));

create policy covers_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'covers' and app.owns_cover_object(name));

create policy covers_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'covers' and app.owns_cover_object(name));

-- No UPDATE policy: an object key is immutable (see header).

create or replace function public.cover_request_upload(p_content_type text)
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
  insert into public.cover_uploads (owner_user_id, object_key, content_type, state)
  values (v_uid, v_key, p_content_type, 'pending');

  return v_key;
end;
$$;
comment on function public.cover_request_upload(text) is
  'Generates the object key server-side and inserts the pending cover_uploads row BEFORE the client uploads any bytes (covers_insert_authorized requires it).';
revoke execute on function public.cover_request_upload(text) from public;
grant execute on function public.cover_request_upload(text) to authenticated;

alter table public.profiles add column cover_media_id uuid;
alter table public.profiles
  add constraint fk_profiles_cover_media_id
  foreign key (cover_media_id) references public.cover_uploads(id) on delete set null;
comment on column public.profiles.cover_media_id is
  'FK to cover_uploads(id). Set only by public.cover_confirm_upload; owner-only visibility (no public read policy).';

create or replace function public.cover_confirm_upload(p_object_key text)
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
    from public.cover_uploads
   where object_key = p_object_key and owner_user_id = v_uid and state = 'pending';
  if v_upload_id is null then
    raise exception 'no matching pending cover upload for this caller' using errcode = 'P0002';
  end if;

  select cover_media_id into v_prev_id from public.profiles where user_id = v_uid;
  if v_prev_id is not null then
    select object_key into v_prev_key from public.cover_uploads where id = v_prev_id;
  end if;

  update public.cover_uploads set state = 'ready' where id = v_upload_id;
  update public.profiles set cover_media_id = v_upload_id where user_id = v_uid;
  if v_prev_id is not null then
    update public.cover_uploads set state = 'deleted' where id = v_prev_id;
  end if;

  return v_prev_key;
end;
$$;
comment on function public.cover_confirm_upload(text) is
  'Flips a pending cover_uploads row to ready, atomically points profiles.cover_media_id at it and retires the previous row. Returns the previous object key (or null) so the caller can best-effort delete the bytes.';
revoke execute on function public.cover_confirm_upload(text) from public;
grant execute on function public.cover_confirm_upload(text) to authenticated;

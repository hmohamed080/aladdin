-- ===========================================================================
-- Editable profile COVER image (approved Installer "My account" design), on the EXISTING avatar media pipeline.
--
-- WHY THE AVATAR PIPELINE. A cover is a second profile image of the same owner with the same lifecycle (pending ->
-- verified bytes -> ready -> deleted when replaced). Reusing public.avatar_uploads keeps EVERY guarantee the media stack
-- already enforces on it - the verified-byte trigger (avatar_verified_before_ready), the pending-upload limit, R2 /
-- Supabase resolution (media_storage_resolve), the owner storage policies and the deletion of replaced objects - with
-- no new namespace for the Worker, the edge cache or the purge to learn. A `purpose` column tells the two images apart.
--
--   * profiles.cover_media_id  the current cover (FK to avatar_uploads, ON DELETE SET NULL)
--   * cover_request_upload / cover_confirm_upload / cover_delete_current (owner RPCs, auth.uid()); "adjust the current
--     image" re-crops it in the browser and uploads the result as a new cover, so no position state is stored
--   * avatar_confirm_upload now refuses a cover upload (and cover_confirm_upload an avatar upload)
--   * app.is_current_avatar_object also answers for the CURRENT cover, so the published-read storage policy and the
--     media resolver serve it exactly like the current avatar (and stop the moment it is replaced or removed)
--   * public_profile_cover_key(profile id): the cover of a currently LISTED professional profile only, for /p/cover/[id]
--   * the historical-media purge (PR #91) treats a current cover like a current avatar (patched by exact text match)
-- No API role gains a table or column privilege: profiles stay SELECT-only for authenticated.
-- ===========================================================================

select app.audit_actions_add(array['profile.cover_set']);

alter table public.avatar_uploads add column purpose text not null default 'avatar';
alter table public.avatar_uploads add constraint ck_avatar_uploads_purpose check (purpose in ('avatar', 'cover'));
comment on column public.avatar_uploads.purpose is 'avatar = profile photo; cover = profile cover image. Same storage, verification and lifecycle.';

alter table public.profiles
  add column cover_media_id uuid references public.avatar_uploads (id) on delete set null;
comment on column public.profiles.cover_media_id is 'The current cover image (public.avatar_uploads, purpose = cover). Written only by the cover_* RPCs.';
create index ix_profiles_cover_media on public.profiles (cover_media_id) where cover_media_id is not null;

-- ---------------------------------------------------------------------------
-- The current avatar OR the current cover (published-read policy, resolver, edge)
-- ---------------------------------------------------------------------------
create or replace function app.is_current_avatar_object(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.avatar_uploads au
    join public.profiles p on p.avatar_media_id = au.id or p.cover_media_id = au.id
    where au.object_key = p_key and au.state = 'ready'
  );
$$;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------
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
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' else null end;
  if v_ext is null then
    raise exception 'unsupported content type' using errcode = '22023';
  end if;
  v_key := extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.avatar_uploads (owner_user_id, object_key, content_type, state, purpose)
  values (v_uid, v_key, p_content_type, 'pending', 'cover');
  return v_key;
end;
$$;
comment on function public.cover_request_upload(text) is
  'Start a profile cover upload: a pending avatar_uploads row (purpose cover) with a server-generated key. Same limits and byte verification as an avatar.';

create or replace function public.cover_confirm_upload(p_object_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_upload public.avatar_uploads; v_prev_id uuid; v_prev_key text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select cover_media_id into v_prev_id from public.profiles where user_id = v_uid for update;
  select * into v_upload from public.avatar_uploads where object_key = p_object_key and owner_user_id = v_uid for update;
  if not found or v_upload.purpose <> 'cover' then raise exception 'cover not found' using errcode = '42501'; end if;
  if v_upload.state = 'ready' and v_prev_id = v_upload.id then return null; end if;
  if v_upload.state <> 'pending' then raise exception 'cover is not pending' using errcode = '42501'; end if;
  if v_prev_id is not null then
    select object_key into v_prev_key from public.avatar_uploads where id = v_prev_id;
  end if;
  update public.avatar_uploads set state = 'ready' where id = v_upload.id;   -- the verified-byte trigger runs here
  update public.profiles set cover_media_id = v_upload.id where user_id = v_uid;
  if v_prev_id is not null then update public.avatar_uploads set state = 'deleted' where id = v_prev_id; end if;
  perform app.record_audit_event('profile.cover_set', 'user', v_uid, null, jsonb_build_object('object_key', p_object_key));
  return v_prev_key;
end;
$$;
comment on function public.cover_confirm_upload(text) is
  'Make a verified pending cover upload the current cover; the previous one is marked deleted (its key is returned so the caller removes the object). Refuses an avatar upload.';

create or replace function public.cover_delete_current()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_key text;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select cover_media_id into v_id from public.profiles where user_id = v_uid for update;
  select object_key into v_key from public.avatar_uploads where id = v_id and owner_user_id = v_uid;
  update public.profiles set cover_media_id = null where user_id = v_uid;
  update public.avatar_uploads set state = 'deleted' where id = v_id and owner_user_id = v_uid;
  perform app.record_audit_event('profile.cover_set', 'user', v_uid, null, jsonb_build_object('removed', true));
  return v_key;
end;
$$;

-- An avatar confirmation must never take a cover upload (patched by exact text, fails loudly if the body drifted).
create or replace function pg_temp.cover_patch(p_fn regprocedure, p_pattern text, p_replacement text)
returns void language plpgsql as $$
declare v_def text := pg_get_functiondef(p_fn); v_n int;
begin
  select count(*) into v_n from regexp_matches(v_def, p_pattern, 'g');
  if v_n <> 1 then raise exception 'patch %: expected 1 match of %, found %', p_fn, p_pattern, v_n; end if;
  execute regexp_replace(v_def, p_pattern, p_replacement, 'g');
end $$;

select pg_temp.cover_patch('public.avatar_confirm_upload(text)'::regprocedure,
  'if not found then raise exception ''avatar not found''',
  'if not found or v_upload.purpose <> ''avatar'' then raise exception ''avatar not found''');

-- The historical purge (PR #91): a current cover is "current" exactly like a current avatar.
select pg_temp.cover_patch('public.media_historical_purge_inventory(timestamp with time zone)'::regprocedure,
  'where pr\.avatar_media_id = a\.id\)\)',
  'where pr.avatar_media_id = a.id or pr.cover_media_id = a.id))');
select pg_temp.cover_patch('public.media_historical_purge_retire(timestamp with time zone,integer)'::regprocedure,
  'update public\.profiles pr set avatar_media_id = null\s+from picked where pr\.avatar_media_id = picked\.id',
  'update public.profiles pr set avatar_media_id = case when pr.avatar_media_id = picked.id then null else pr.avatar_media_id end,
                                  cover_media_id = case when pr.cover_media_id = picked.id then null else pr.cover_media_id end
      from picked where pr.avatar_media_id = picked.id or pr.cover_media_id = picked.id');
select pg_temp.cover_patch('public.media_historical_purge_finalize(integer)'::regprocedure,
  'and not exists \(select 1 from public\.profiles pr where pr\.avatar_media_id = a\.id\)',
  'and not exists (select 1 from public.profiles pr where pr.avatar_media_id = a.id or pr.cover_media_id = a.id)');

-- ---------------------------------------------------------------------------
-- Public read: the cover of a currently LISTED professional profile only
-- ---------------------------------------------------------------------------
create or replace function public.public_profile_cover_key(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select au.object_key
    from public.profile_public_directory d
    join public.profiles p on p.id = d.id
    join public.avatar_uploads au on au.id = p.cover_media_id
   where d.id = p_profile_id and au.state = 'ready' and au.purpose = 'cover';
$$;
comment on function public.public_profile_cover_key(uuid) is
  'The object key of the current cover of a currently listed professional profile (the same listing test as the public profile), else NULL - identical for an unlisted, unknown or cover-less profile.';

revoke all on function public.cover_request_upload(text) from public, anon;
revoke all on function public.cover_confirm_upload(text) from public, anon;
revoke all on function public.cover_delete_current() from public, anon;
grant execute on function public.cover_request_upload(text) to authenticated;
grant execute on function public.cover_confirm_upload(text) to authenticated;
grant execute on function public.cover_delete_current() to authenticated;
revoke all on function public.public_profile_cover_key(uuid) from public;
grant execute on function public.public_profile_cover_key(uuid) to anon, authenticated;

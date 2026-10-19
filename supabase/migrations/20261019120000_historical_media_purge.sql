-- Owner decision 2026-10-19: historical portfolio photos and avatars stored in
-- Supabase Storage are NOT migrated to R2. They are permanently deleted, with
-- their media references, and people upload new images themselves (R2 only).
--
-- Scope is closed by construction:
--   * namespaces 'portfolio' (bucket professional-portfolio) and 'avatar'
--     (bucket avatars) only;
--   * rows created before an explicit cutoff, and never a row whose verified
--     object already lives in R2;
--   * certificates, business-verification documents, products, organization
--     images and request images are never selected by any function here.
-- Accounts, profiles, products, routes and relationships are untouched: a
-- portfolio item is only a photo with a caption, and an avatar is only a photo.
--
-- Three steps, the same order as the owner flow (portfolio_item_delete →
-- Storage delete → portfolio_item_purge), run by the trusted backend worker
-- (backend/app/workers/historical_media_purge.py):
--   1. retire: hide and unlink in one transaction, record a journal row;
--   2. the worker removes the Storage object through the Storage API, then
--      storage_removed confirms storage.objects no longer has it;
--   3. finalize: delete the metadata rows whose object is confirmed gone.
-- Every function is service_role only and idempotent; a crash between steps
-- leaves a journal row that the next run resumes.

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'ck_audit_action_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  if position('''media.historical_purge''::text' in v_def) = 0 then
    alter table public.audit_log drop constraint ck_audit_action_known;
    execute 'alter table public.audit_log add constraint ck_audit_action_known '
      || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$', ', ''media.historical_purge''::text])))');
  end if;
end $$;

create table public.media_historical_purge_journal (
  namespace          text not null check (namespace in ('avatar','portfolio')),
  object_key         text not null check (length(object_key) between 1 and 256),
  bucket             text not null check (bucket in ('avatars','professional-portfolio')),
  -- Null only for an orphan object (no metadata row ever referenced it).
  owner_user_id      uuid,
  size_bytes         bigint,
  retired_at         timestamptz not null default now(),
  storage_removed_at timestamptz,
  purged_at          timestamptz,
  primary key (namespace, object_key),
  check ((namespace = 'avatar') = (bucket = 'avatars')),
  check (purged_at is null or storage_removed_at is not null)
);
comment on table public.media_historical_purge_journal is
  'Resumable journal of the one-off deletion of historical Supabase portfolio photos and avatars (owner decision 2026-10-19). Service role only. Rows record keys, never file contents.';
alter table public.media_historical_purge_journal enable row level security;
revoke all on public.media_historical_purge_journal from public, anon, authenticated, service_role;
grant select on public.media_historical_purge_journal to service_role;

-- Is (namespace, key) already served from a verified R2 object? Those are new
-- uploads and are never historical, whatever their timestamp.
create function app.media_is_r2(p_namespace text, p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.media_storage_locations l
                 where l.namespace = p_namespace and l.object_key = p_key and l.provider = 'r2');
$$;
revoke all on function app.media_is_r2(text, text) from public, anon, authenticated, service_role;

-- What the purge would touch, and what it must never touch. Read-only.
create function public.media_historical_purge_inventory(p_cutoff timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_cutoff is null or p_cutoff > now() then
    raise exception 'cutoff must be a past timestamp' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'cutoff', p_cutoff,
    'portfolio', (select jsonb_build_object('rows', count(*),
        'published', count(*) filter (where p.state = 'ready' and p.visibility = 'public'),
        'owners', count(distinct p.owner_user_id))
      from public.portfolio_items p
      where p.created_at < p_cutoff and not app.media_is_r2('portfolio', p.object_key)
        and not exists (select 1 from public.media_historical_purge_journal j
                         where j.namespace = 'portfolio' and j.object_key = p.object_key)),
    'avatar', (select jsonb_build_object('rows', count(*),
        'current', count(*) filter (where exists (select 1 from public.profiles pr where pr.avatar_media_id = a.id)),
        'owners', count(distinct a.owner_user_id))
      from public.avatar_uploads a
      where a.created_at < p_cutoff and not app.media_is_r2('avatar', a.object_key)
        and not exists (select 1 from public.media_historical_purge_journal j
                         where j.namespace = 'avatar' and j.object_key = a.object_key)),
    'storage', (select coalesce(jsonb_object_agg(b.bucket, jsonb_build_object(
        'objects', (select count(*) from storage.objects o where o.bucket_id = b.bucket and o.created_at < p_cutoff),
        'bytes', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o
                   where o.bucket_id = b.bucket and o.created_at < p_cutoff))), '{}'::jsonb)
      from unnest(array['avatars','professional-portfolio']) b(bucket)),
    'journal', (select jsonb_build_object('retired', count(*),
        'storage_removed', count(*) filter (where j.storage_removed_at is not null),
        'purged', count(*) filter (where j.purged_at is not null))
      from public.media_historical_purge_journal j),
    -- Never touched; reported so every run proves it.
    'protected', jsonb_build_object(
      'certificates', (select count(*) from public.professional_certificates),
      'certificate_objects', (select count(*) from storage.objects o where o.bucket_id = 'professional-certificates'),
      'business_verification_objects', (select count(*) from storage.objects o
                                          where o.bucket_id = 'business-verification-documents'))
  );
end;
$$;
revoke all on function public.media_historical_purge_inventory(timestamptz) from public, anon, authenticated;
grant execute on function public.media_historical_purge_inventory(timestamptz) to service_role;

-- Step 1. Hide and unlink up to p_limit historical items, journal them and
-- return the Storage objects the worker must remove. Also returns objects
-- already retired whose removal was not yet confirmed (resume after a crash).
create function public.media_historical_purge_retire(p_cutoff timestamptz, p_limit integer default 25)
returns table(namespace text, object_key text, bucket text)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_portfolio integer;
  v_avatar integer;
  v_orphan integer;
begin
  if p_cutoff is null or p_cutoff > now() then
    raise exception 'cutoff must be a past timestamp' using errcode = '22023';
  end if;
  -- One purge at a time; a second worker waits instead of racing the journal.
  -- (Every data-modifying CTE below runs to completion whether or not the
  -- outer statement reads it, so `unlinked` and the deletes always apply.)
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media_historical_purge', 0));

  with picked as (
    select p.id, p.object_key, p.owner_user_id from public.portfolio_items p
     where p.created_at < p_cutoff and not app.media_is_r2('portfolio', p.object_key)
       and not exists (select 1 from public.media_historical_purge_journal j
                        where j.namespace = 'portfolio' and j.object_key = p.object_key)
     order by p.created_at, p.id limit v_limit for update
  ), hidden as (
    update public.portfolio_items p
       set state = 'deleted'::public.professional_asset_state,
           visibility = 'private'::public.portfolio_visibility
      from picked where p.id = picked.id
    returning p.object_key, p.owner_user_id
  ) insert into public.media_historical_purge_journal(namespace, object_key, bucket, owner_user_id, size_bytes)
    select 'portfolio', h.object_key, 'professional-portfolio', h.owner_user_id,
           (select (o.metadata->>'size')::bigint from storage.objects o
             where o.bucket_id = 'professional-portfolio' and o.name = h.object_key)
      from hidden h;
  get diagnostics v_portfolio = row_count;

  with picked as (
    select a.id, a.object_key, a.owner_user_id from public.avatar_uploads a
     where a.created_at < p_cutoff and not app.media_is_r2('avatar', a.object_key)
       and not exists (select 1 from public.media_historical_purge_journal j
                        where j.namespace = 'avatar' and j.object_key = a.object_key)
     order by a.created_at, a.id limit v_limit for update
  ), unlinked as (
    update public.profiles pr set avatar_media_id = null
      from picked where pr.avatar_media_id = picked.id
    returning pr.user_id
  ), hidden as (
    update public.avatar_uploads a set state = 'deleted'::public.professional_asset_state
      from picked where a.id = picked.id
    returning a.object_key, a.owner_user_id
  ) insert into public.media_historical_purge_journal(namespace, object_key, bucket, owner_user_id, size_bytes)
    select 'avatar', h.object_key, 'avatars', h.owner_user_id,
           (select (o.metadata->>'size')::bigint from storage.objects o
             where o.bucket_id = 'avatars' and o.name = h.object_key)
      from hidden h;
  get diagnostics v_avatar = row_count;

  -- Orphans: objects in the two buckets that no metadata row references.
  insert into public.media_historical_purge_journal(namespace, object_key, bucket, owner_user_id, size_bytes)
  select case o.bucket_id when 'avatars' then 'avatar' else 'portfolio' end, o.name, o.bucket_id, null,
         (o.metadata->>'size')::bigint
    from storage.objects o
   where o.bucket_id in ('avatars','professional-portfolio') and o.created_at < p_cutoff
     and not exists (select 1 from public.portfolio_items p where o.bucket_id = 'professional-portfolio' and p.object_key = o.name)
     and not exists (select 1 from public.avatar_uploads a where o.bucket_id = 'avatars' and a.object_key = o.name)
     and not exists (select 1 from public.media_historical_purge_journal j
                      where j.bucket = o.bucket_id and j.object_key = o.name)
   order by o.created_at limit v_limit;
  get diagnostics v_orphan = row_count;

  if v_portfolio + v_avatar + v_orphan > 0 then
    perform app.record_audit_event('media.historical_purge', 'media', null, null,
      jsonb_build_object('step', 'retire', 'portfolio', v_portfolio, 'avatar', v_avatar, 'orphan', v_orphan,
                         'cutoff', p_cutoff));
  end if;

  return query
    select j.namespace, j.object_key, j.bucket from public.media_historical_purge_journal j
     where j.storage_removed_at is null
     order by j.retired_at, j.namespace, j.object_key limit v_limit;
end;
$$;
revoke all on function public.media_historical_purge_retire(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.media_historical_purge_retire(timestamptz, integer) to service_role;

-- Step 2 confirmation. True only when storage.objects no longer has the object,
-- so a worker cannot mark something removed that is still stored.
create function public.media_historical_purge_storage_removed(p_namespace text, p_key text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare v_bucket text;
begin
  select j.bucket into v_bucket from public.media_historical_purge_journal j
   where j.namespace = p_namespace and j.object_key = p_key;
  if v_bucket is null then raise exception 'not a retired historical object' using errcode = '42501'; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = v_bucket and o.name = p_key) then
    return false;
  end if;
  update public.media_historical_purge_journal j set storage_removed_at = coalesce(j.storage_removed_at, now())
   where j.namespace = p_namespace and j.object_key = p_key;
  return true;
end;
$$;
revoke all on function public.media_historical_purge_storage_removed(text, text) from public, anon, authenticated;
grant execute on function public.media_historical_purge_storage_removed(text, text) to service_role;

-- Step 3. Delete the metadata rows whose object is confirmed gone. Only rows
-- that are still the retired tombstone are deleted (state = 'deleted').
create function public.media_historical_purge_finalize(p_limit integer default 100)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_done integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media_historical_purge', 0));
  with batch as (
    select j.namespace, j.object_key from public.media_historical_purge_journal j
     where j.storage_removed_at is not null and j.purged_at is null
     order by j.storage_removed_at, j.namespace, j.object_key limit v_limit for update
  ), gone_portfolio as (
    delete from public.portfolio_items p using batch b
     where b.namespace = 'portfolio' and p.object_key = b.object_key
       and p.state = 'deleted'::public.professional_asset_state
    returning p.object_key
  ), gone_avatar as (
    delete from public.avatar_uploads a using batch b
     where b.namespace = 'avatar' and a.object_key = b.object_key
       and a.state = 'deleted'::public.professional_asset_state
       and not exists (select 1 from public.profiles pr where pr.avatar_media_id = a.id)
    returning a.object_key
  ), gone_location as (
    delete from public.media_storage_locations l using batch b
     where l.namespace = b.namespace and l.object_key = b.object_key and l.provider = 'supabase'
    returning l.object_key
  ), marked as (
    update public.media_historical_purge_journal j set purged_at = now()
      from batch b where j.namespace = b.namespace and j.object_key = b.object_key
    returning 1
  ) select count(*) into v_done from marked;
  if v_done > 0 then
    perform app.record_audit_event('media.historical_purge', 'media', null, null,
      jsonb_build_object('step', 'finalize', 'rows', v_done));
  end if;
  return v_done;
end;
$$;
revoke all on function public.media_historical_purge_finalize(integer) from public, anon, authenticated;
grant execute on function public.media_historical_purge_finalize(integer) to service_role;

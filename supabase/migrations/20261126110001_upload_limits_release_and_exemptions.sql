-- ===========================================================================
-- Uploads - Migration 20261126110001: a failed upload holds nothing; limits are admin-controlled, with exemptions
-- ===========================================================================
-- WHY (owner decisions 2026-11-26, ADR-0032)
--   A slot, the storage quota and the hourly allowance stayed consumed after an upload failed, was rejected or was deleted.
--   Six failed return photos locked an order until a manual cleanup ran.
-- THE RULE
--   1. Failed, rejected or deleted uploads free their slot and storage at once.
--   2. An abandoned upload stops counting one hour after it was reserved, decided here, without any cleanup job.
--   3. The hourly allowance (default 50) counts successful and in-flight uploads; a separate ceiling (default 150) counts every
--      attempt. Both and the storage quota (default 1024 MB) are admin settings. A chosen account (user or organization) can be
--      exempted from these hourly, pending and storage limits. File-size and per-item count rules (3 photos per product) stay.
-- Existing function bodies are patched in place (each anchor must exist). NOTHING IS DROPPED.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings, exemptions, history
-- ---------------------------------------------------------------------------
create table public.upload_limit_settings (
  id               boolean     primary key default true check (id),
  hourly_uploads   integer     not null default 50   check (hourly_uploads between 1 and 1000),
  hourly_attempts  integer     not null default 150  check (hourly_attempts between 1 and 5000),
  storage_quota_mb integer     not null default 1024 check (storage_quota_mb between 100 and 102400),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  constraint upload_limit_settings_ceiling_ck check (hourly_attempts >= hourly_uploads)
);
comment on table public.upload_limit_settings is 'One row: upload allowances per user and per organization. Changed only by admin_upload_limits_set.';
insert into public.upload_limit_settings (id) values (true);

create table public.upload_limit_exemptions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid,
  organization_id uuid,
  reason          text        not null check (char_length(btrim(reason)) between 3 and 500),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null,
  revoked_at      timestamptz,
  revoked_by      uuid,
  constraint upload_limit_exemptions_subject_ck check (num_nonnulls(user_id, organization_id) = 1)
);
comment on table public.upload_limit_exemptions is
  'Accounts the Super Admin excused from the hourly, pending and storage upload limits. Revoked rows stay as history. No foreign key: audit outlives accounts.';
create unique index uq_upload_exemption_user on public.upload_limit_exemptions (user_id) where user_id is not null and revoked_at is null;
create unique index uq_upload_exemption_org on public.upload_limit_exemptions (organization_id) where organization_id is not null and revoked_at is null;

create table public.upload_limit_events (
  id           bigint      generated always as identity primary key,
  at           timestamptz not null default now(),
  action       text        not null check (action in ('limits_changed', 'exemption_added', 'exemption_removed')),
  subject_type text,
  subject_id   uuid,
  detail       jsonb       not null default '{}'::jsonb,
  actor_id     uuid        not null,
  reason       text        not null check (char_length(btrim(reason)) between 3 and 500)
);
comment on table public.upload_limit_events is 'Append-only history of upload-limit and exemption changes.';
create trigger upload_limit_events_append_only before update or delete on public.upload_limit_events
  for each row execute function app.media_limit_events_append_only();

alter table public.upload_limit_settings   enable row level security;
alter table public.upload_limit_exemptions enable row level security;
alter table public.upload_limit_events     enable row level security;
revoke all on public.upload_limit_settings, public.upload_limit_exemptions, public.upload_limit_events
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The counting rule, in one place
-- ---------------------------------------------------------------------------
create or replace function app.upload_abandon_after()
returns interval language sql immutable set search_path = '' as $$ select interval '1 hour' $$;

create or replace function app.upload_exempt(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.upload_limit_exemptions e
                  where e.revoked_at is null and (e.user_id = p_user or e.organization_id = p_org));
$$;

-- Does a reservation still count against the successful allowance and the storage quota?
create or replace function app.upload_counts(p_namespace text, p_key text, p_reserved_at timestamptz)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_state text := app.media_metadata(p_namespace, p_key) ->> 'state';
begin
  if v_state = 'pending' then
    return p_reserved_at > now() - app.upload_abandon_after();
  end if;
  if v_state is distinct from 'ready' then
    return false;  -- deleted, being deleted, or forgotten
  end if;
  if p_namespace = 'marketplace' and (
       exists (select 1 from public.marketplace_product_images i where i.object_key = p_key and i.status = 'rejected')
       or exists (select 1 from public.marketplace_payment_proofs p where p.object_key = p_key and p.status = 'rejected')) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function app.upload_used_bytes(p_user uuid, p_org uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(sum(coalesce(l.size_bytes, 10485760)), 0)::bigint from public.media_storage_locations l
   where (case when p_org is null then l.owner_user_id = p_user else l.organization_id = p_org end)
     and app.upload_counts(l.namespace, l.object_key, l.created_at);
$$;
revoke all on function app.upload_abandon_after(), app.upload_exempt(uuid, uuid), app.upload_counts(text, text, timestamptz),
  app.upload_used_bytes(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Patch the installed functions
-- ---------------------------------------------------------------------------
create function pg_temp.patch_function_once(p_fn text, p_anchor text, p_replacement text)
returns void language plpgsql as $$
declare v_def text := pg_catalog.pg_get_functiondef(p_fn::regprocedure); v_new text;
begin
  v_new := pg_catalog.replace(v_def, p_anchor, p_replacement);
  if v_new = v_def then
    raise exception 'patch anchor not found in %: %', p_fn, p_anchor;
  end if;
  execute v_new;
end;
$$;

do $do$
declare
  v_reserve constant text := 'public.media_storage_reserve(text,text,text,uuid)';
  v_def text;
  v_from integer;
  v_to integer;
  v_block constant text := $new$if not app.upload_exempt(v_uid, v_org) then
    declare
      s public.upload_limit_settings;
      v_all integer;
      v_good integer;
    begin
      select * into strict s from public.upload_limit_settings;
      select count(*), count(*) filter (where app.upload_counts(l.namespace, l.object_key, l.created_at)) into v_all, v_good
        from public.media_storage_locations l where l.owner_user_id = v_uid and l.created_at > now() - interval '1 hour';
      if v_all >= s.hourly_attempts or v_good >= s.hourly_uploads then
        raise exception 'upload rate limit' using errcode = '54000';
      end if;
      if app.upload_used_bytes(v_uid, null) + 10485760 > s.storage_quota_mb::bigint * 1048576 then
        raise exception 'upload quota exceeded' using errcode = '54000';
      end if;
      if v_org is not null then
        select count(*), count(*) filter (where app.upload_counts(l.namespace, l.object_key, l.created_at)) into v_all, v_good
          from public.media_storage_locations l where l.organization_id = v_org and l.created_at > now() - interval '1 hour';
        if v_all >= s.hourly_attempts or v_good >= s.hourly_uploads then
          raise exception 'organization upload rate limit' using errcode = '54000';
        end if;
        if app.upload_used_bytes(null, v_org) + 10485760 > s.storage_quota_mb::bigint * 1048576 then
          raise exception 'organization upload quota exceeded' using errcode = '54000';
        end if;
      end if;
    end;
  end if;
  $new$;
begin
  -- 3a. the central reservation: replace its whole limits block
  v_def := pg_get_functiondef(v_reserve::regprocedure);
  v_from := strpos(v_def, 'if (select count(*) from public.media_storage_locations where owner_user_id=v_uid');
  v_to := strpos(v_def, 'insert into public.media_storage_locations(namespace,object_key');
  if v_from = 0 or v_to <= v_from then
    raise exception 'patch anchor not found in %', v_reserve;
  end if;
  execute substr(v_def, 1, v_from - 1) || v_block || substr(v_def, v_to);

  -- 3b. a reservation older than the abandon period stopped counting, so confirming it late checks the quota again
  perform pg_temp.patch_function_once('public.media_storage_attest(text,text,uuid,text,bigint,text,text)',
    'update public.media_storage_locations set size_bytes=p_size',
    $new$if v_existing.verified_at is null and v_existing.created_at <= now() - app.upload_abandon_after()
    and not app.upload_exempt(p_owner, v_existing.organization_id)
    and (app.upload_used_bytes(p_owner, null) + p_size
           > (select storage_quota_mb::bigint * 1048576 from public.upload_limit_settings)
         or (v_existing.organization_id is not null and app.upload_used_bytes(null, v_existing.organization_id) + p_size
           > (select storage_quota_mb::bigint * 1048576 from public.upload_limit_settings))) then
    raise exception 'upload quota exceeded' using errcode='54000';
  end if;
  update public.media_storage_locations set size_bytes=p_size$new$);

  -- 3c. "10 unfinished uploads": counted for 24 hours before; now only until abandoned, and not for exempt accounts
  v_def := pg_get_functiondef('app.limit_pending_media()'::regprocedure);
  execute replace(v_def, 'interval ''24 hours''', 'app.upload_abandon_after()');
  perform pg_temp.patch_function_once('app.limit_pending_media()', 'if v_count>=10 then',
    'if v_count>=10 and not app.upload_exempt(new.owner_user_id, null) then');
  v_def := pg_get_functiondef('app.limit_pending_organization_media()'::regprocedure);
  execute replace(v_def, 'interval ''24 hours''', 'app.upload_abandon_after()');
  v_def := pg_get_functiondef('app.limit_pending_organization_media()'::regprocedure);
  if strpos(v_def, 'if pending>=10 then') = 0 then
    raise exception 'patch anchor not found in limit_pending_organization_media';
  end if;
  execute replace(v_def, 'if pending>=10 then', 'if pending>=10 and not app.upload_exempt(new.created_by, new.organization_id) then');

  -- 3d. return photos: an abandoned one leaves the six waiting places; failed ones leave the hourly ten
  perform pg_temp.patch_function_once('public.marketplace_buyer_return_request_upload(uuid,text)',
    '-- at most 6 photos waiting to be attached to a request',
    $new$update public.marketplace_return_evidence set upload_state = 'deleting'
   where order_id = o.id and created_by = v_uid and return_id is null and upload_state = 'awaiting_upload'
     and created_at < now() - app.upload_abandon_after();
  -- at most 6 photos waiting to be attached to a request$new$);
  perform pg_temp.patch_function_once('public.marketplace_buyer_return_request_upload(uuid,text)',
    'if (select count(*) from public.marketplace_return_evidence e where e.order_id = o.id and e.created_at > now() - interval ''1 hour'') >= 10 then',
    'if not app.upload_exempt(v_uid, null) and (select count(*) filter (where e.upload_state <> ''deleting'') >= 10 or count(*) >= 30 from public.marketplace_return_evidence e where e.order_id = o.id and e.created_at > now() - interval ''1 hour'') then');

  -- 3e. payment receipts: failed, removed and rejected ones leave the hourly ten
  perform pg_temp.patch_function_once('public.marketplace_buyer_proof_request_upload(uuid,text)',
    'if (select count(*) from public.marketplace_payment_proofs where order_id = o.id and created_at > now() - interval ''1 hour'') >= 10 then',
    'if not app.upload_exempt((select auth.uid()), null) and (select count(*) filter (where upload_state <> ''deleting'' and status <> ''rejected'') >= 10 or count(*) >= 30 from public.marketplace_payment_proofs where order_id = o.id and created_at > now() - interval ''1 hour'') then');
  perform pg_temp.patch_function_once('public.marketplace_buyer_receipt_resubmit_request_upload(uuid,text)',
    'if (select count(*) from public.marketplace_payment_proofs where order_id = o.id and created_at > now() - interval ''1 hour'') >= 10 then',
    'if not app.upload_exempt(v_uid, null) and (select count(*) filter (where upload_state <> ''deleting'' and status <> ''rejected'') >= 10 or count(*) >= 30 from public.marketplace_payment_proofs where order_id = o.id and created_at > now() - interval ''1 hour'') then');
  perform pg_temp.patch_function_once('public.marketplace_checkout_receipt_request_upload(uuid,text)',
    'if (select count(*) from public.marketplace_payment_proofs where checkout_session_id = s.id and created_at > now() - interval ''1 hour'') >= 10 then',
    'if not app.upload_exempt(v_uid, null) and (select count(*) filter (where upload_state <> ''deleting'' and status <> ''rejected'') >= 10 or count(*) >= 30 from public.marketplace_payment_proofs where checkout_session_id = s.id and created_at > now() - interval ''1 hour'') then');

  -- 3f. showroom marketplace images: failed and rejected ones leave the hourly 200 (600 attempts is the ceiling)
  perform pg_temp.patch_function_once('public.marketplace_seller_image_request_upload(uuid,text,uuid)',
    'select count(*) into v_hour from',
    'select case when app.upload_exempt(v_uid, v_org) then 0 when count(*) >= 600 then 200 else count(*) filter (where i.upload_state <> ''deleting'' and i.status <> ''rejected'') end into v_hour from');

  -- 3g. portfolio: an abandoned photo leaves the project's six places
  perform pg_temp.patch_function_once('public.portfolio_item_create(text,text,text)',
    'v_key := extensions.gen_random_uuid()::text',
    $new$update public.portfolio_items set state = 'deleted', visibility = 'private'
   where owner_user_id = v_uid and state = 'pending' and created_at < now() - app.upload_abandon_after();
  v_key := extensions.gen_random_uuid()::text$new$);

  -- 3h. videos: an expired upload leaves the unfinished ten; a failed or rejected one leaves a full product's slots
  perform pg_temp.patch_function_once('public.video_upload_begin(text,uuid,text,text,bigint)',
    'if (select count(*) from public.media_videos',
    $new$update public.media_videos m set state = 'deleted', visibility = 'private', deleted_at = now(), lease_until = null
   where m.state = 'uploading' and app.video_upload_expired(m.*)
     and (m.owner_user_id = v_uid or m.product_id = p_product_id or m.marketplace_product_id = p_product_id);
  if not app.upload_exempt(v_uid, null) and (select count(*) from public.media_videos$new$);
  perform pg_temp.patch_function_once('public.video_upload_begin(text,uuid,text,text,bigint)',
    'v_slot := app.product_media_free_slot(p_product_id);',
    $new$if app.product_media_free_slot(p_product_id) is null then
      update public.media_videos set state = 'deleted', visibility = 'private', deleted_at = now(), lease_until = null
       where product_id = p_product_id and state = 'failed';
    end if;
    v_slot := app.product_media_free_slot(p_product_id);$new$);
  perform pg_temp.patch_function_once('public.video_upload_begin(text,uuid,text,text,bigint)',
    'v_slot := app.marketplace_video_free_slot(p_product_id);',
    $new$if app.marketplace_video_free_slot(p_product_id) is null then
      update public.media_videos set state = 'deleted', visibility = 'private', deleted_at = now(), lease_until = null
       where marketplace_product_id = p_product_id and scope = 'marketplace' and state <> 'deleted'
         and (state = 'failed' or review_status = 'rejected');
    end if;
    v_slot := app.marketplace_video_free_slot(p_product_id);$new$);
end;
$do$;

-- ---------------------------------------------------------------------------
-- 4. Release: the uploader frees a reservation whose upload did not finish
-- ---------------------------------------------------------------------------
create or replace function public.media_upload_abandon(p_namespace text, p_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  case p_namespace
    when 'portfolio' then
      update public.portfolio_items set state = 'deleted', visibility = 'private'
       where object_key = p_key and owner_user_id = v_uid and state = 'pending';
    when 'certificate' then
      update public.professional_certificates set state = 'deleted'
       where object_path = p_key and owner_user_id = v_uid and state = 'pending';
    when 'avatar' then
      update public.avatar_uploads set state = 'deleted' where object_key = p_key and owner_user_id = v_uid and state = 'pending';
    when 'product' then
      update public.product_images set state = 'deleted' where object_key = p_key and created_by = v_uid and state = 'pending';
    when 'organization' then
      update public.organization_images set state = 'deleted' where object_key = p_key and created_by = v_uid and state = 'pending';
    when 'request' then
      update public.purchase_request_images set state = 'deleted' where object_key = p_key and created_by = v_uid and state = 'pending';
    when 'verification' then
      update public.business_verification_documents set state = 'deleted'
       where object_key = p_key and created_by = v_uid and state = 'pending' and submission_id is null;
    when 'marketplace' then
      update public.marketplace_product_images set upload_state = 'deleting', status = 'rejected', is_primary = false
       where object_key = p_key and created_by = v_uid and upload_state = 'awaiting_upload';
      if not found then
        update public.marketplace_payment_proofs set upload_state = 'deleting'
         where object_key = p_key and created_by = v_uid and upload_state = 'awaiting_upload';
      end if;
      if not found then
        update public.marketplace_return_evidence set upload_state = 'deleting'
         where object_key = p_key and created_by = v_uid and upload_state = 'awaiting_upload';
      end if;
    else
      raise exception 'invalid namespace' using errcode = '22023';
  end case;
  return found;
end;
$$;
revoke all on function public.media_upload_abandon(text, text) from public, anon, authenticated, service_role;
grant execute on function public.media_upload_abandon(text, text) to authenticated;

-- Used by the server's own brake: is the caller's upload of this reservation excused from limits?
create or replace function public.my_upload_exempt(p_namespace text, p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select app.upload_exempt((m ->> 'owner')::uuid, (m ->> 'organization')::uuid)
                     from (select app.media_metadata(p_namespace, p_key) as m) x
                    where (m ->> 'owner')::uuid = (select auth.uid())), false);
$$;
revoke all on function public.my_upload_exempt(text, text) from public, anon, authenticated, service_role;
grant execute on function public.my_upload_exempt(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Admin: media_limits.view reads, media_limits.manage (Super Admin) changes
-- ---------------------------------------------------------------------------
create or replace function app.upload_limits_assert(p_manage boolean)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (app.has_admin_permission('media_limits.manage')
          or (not p_manage and app.has_admin_permission('media_limits.view'))) then
    raise exception 'permission media_limits is required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function app.upload_limits_assert(boolean) from public, anon, authenticated, service_role;

create or replace function public.admin_upload_limits_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.upload_limits_assert(false);
  return jsonb_build_object(
    'settings', (select jsonb_build_object('hourly_uploads', s.hourly_uploads, 'hourly_attempts', s.hourly_attempts,
                   'storage_quota_mb', s.storage_quota_mb, 'updated_at', s.updated_at) from public.upload_limit_settings s),
    'exemptions', coalesce((select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'subject_type', case when e.user_id is null then 'organization' else 'user' end,
          'subject_id', coalesce(e.user_id, e.organization_id),
          'label', coalesce(p.display_name, o.name, left(coalesce(e.user_id, e.organization_id)::text, 8)),
          'reason', e.reason, 'created_at', e.created_at) order by e.created_at desc)
        from public.upload_limit_exemptions e
        left join public.profiles p on p.user_id = e.user_id
        left join public.organizations o on o.id = e.organization_id
       where e.revoked_at is null), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(x.j order by x.id desc) from (
        select ev.id, jsonb_build_object('id', ev.id, 'at', ev.at, 'action', ev.action, 'detail', ev.detail,
                 'reason', ev.reason, 'actor_id', ev.actor_id) as j
          from public.upload_limit_events ev order by ev.id desc limit 30) x), '[]'::jsonb));
end;
$$;

create or replace function public.admin_upload_limits_set(
  p_hourly_uploads integer, p_hourly_attempts integer, p_storage_quota_mb integer, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.upload_limits_assert(true); s public.upload_limit_settings;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;
  if p_hourly_uploads is null or p_hourly_attempts is null or p_storage_quota_mb is null
     or p_hourly_uploads not between 1 and 1000 or p_hourly_attempts not between 1 and 5000
     or p_storage_quota_mb not between 100 and 102400 or p_hourly_attempts < p_hourly_uploads then
    raise exception 'the limits are outside the allowed range' using errcode = '22023';
  end if;
  select * into strict s from public.upload_limit_settings for update;
  if s.hourly_uploads = p_hourly_uploads and s.hourly_attempts = p_hourly_attempts and s.storage_quota_mb = p_storage_quota_mb then
    return jsonb_build_object('changed', false);
  end if;
  update public.upload_limit_settings set hourly_uploads = p_hourly_uploads, hourly_attempts = p_hourly_attempts,
         storage_quota_mb = p_storage_quota_mb, updated_at = now(), updated_by = v_actor where id;
  insert into public.upload_limit_events (action, detail, actor_id, reason)
  values ('limits_changed', jsonb_build_object(
    'from', jsonb_build_object('hourly_uploads', s.hourly_uploads, 'hourly_attempts', s.hourly_attempts, 'storage_quota_mb', s.storage_quota_mb),
    'to', jsonb_build_object('hourly_uploads', p_hourly_uploads, 'hourly_attempts', p_hourly_attempts, 'storage_quota_mb', p_storage_quota_mb)),
    v_actor, btrim(p_reason));
  return jsonb_build_object('changed', true);
end;
$$;

-- Finds the account to excuse: by id, exact email or mobile number, or part of the name. Emails and numbers are never returned.
create or replace function public.admin_upload_subject_search(p_query text)
returns table (subject_type text, subject_id uuid, label text, detail text)
language plpgsql stable security definer set search_path = '' as $$
declare
  q text := btrim(coalesce(p_query, ''));
  v_like text;
begin
  perform app.upload_limits_assert(true);
  if char_length(q) < 2 then
    return;
  end if;
  v_like := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return query
    (select 'user'::text, u.id, coalesce(p.display_name, left(u.id::text, 8)), u.primary_account_type::text
       from public.users u
       join auth.users a on a.id = u.id
       left join public.profiles p on p.user_id = u.id
      where u.id::text = q or lower(a.email) = lower(q) or a.phone = ltrim(q, '+') or p.display_name ilike v_like
      order by p.display_name limit 10)
    union all
    (select 'organization'::text, o.id, o.name, o.org_type::text
       from public.organizations o
      where o.deleted_at is null and (o.id::text = q or o.name ilike v_like)
      order by o.name limit 10);
end;
$$;

create or replace function public.admin_upload_exemption_add(p_subject_type text, p_subject_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.upload_limits_assert(true); v_id uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;
  if p_subject_type is null or p_subject_type not in ('user', 'organization') or p_subject_id is null
     or (p_subject_type = 'user' and not exists (select 1 from public.users where id = p_subject_id))
     or (p_subject_type = 'organization' and not exists (select 1 from public.organizations where id = p_subject_id and deleted_at is null)) then
    raise exception 'unknown account' using errcode = '22023';
  end if;
  insert into public.upload_limit_exemptions (user_id, organization_id, reason, created_by)
  values (case when p_subject_type = 'user' then p_subject_id end,
          case when p_subject_type = 'organization' then p_subject_id end, btrim(p_reason), v_actor)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    return jsonb_build_object('changed', false);
  end if;
  insert into public.upload_limit_events (action, subject_type, subject_id, actor_id, reason)
  values ('exemption_added', p_subject_type, p_subject_id, v_actor, btrim(p_reason));
  return jsonb_build_object('changed', true, 'id', v_id);
end;
$$;

create or replace function public.admin_upload_exemption_remove(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := app.upload_limits_assert(true); e public.upload_limit_exemptions;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;
  update public.upload_limit_exemptions set revoked_at = now(), revoked_by = v_actor
   where id = p_id and revoked_at is null returning * into e;
  if not found then
    return jsonb_build_object('changed', false);
  end if;
  insert into public.upload_limit_events (action, subject_type, subject_id, actor_id, reason)
  values ('exemption_removed', case when e.user_id is null then 'organization' else 'user' end,
          coalesce(e.user_id, e.organization_id), v_actor, btrim(p_reason));
  return jsonb_build_object('changed', true);
end;
$$;

revoke all on function public.admin_upload_limits_get(), public.admin_upload_limits_set(integer, integer, integer, text),
  public.admin_upload_subject_search(text), public.admin_upload_exemption_add(text, uuid, text),
  public.admin_upload_exemption_remove(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_upload_limits_get(), public.admin_upload_limits_set(integer, integer, integer, text),
  public.admin_upload_subject_search(text), public.admin_upload_exemption_add(text, uuid, text),
  public.admin_upload_exemption_remove(uuid, text) to authenticated;

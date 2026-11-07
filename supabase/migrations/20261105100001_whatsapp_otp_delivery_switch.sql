-- Super Admin WhatsApp OTP delivery switch (the audited ON/OFF toggle on /admin/whatsapp-otp).
--
-- The authoritative flag lives in the delivery Worker's D1 (otp_delivery_switch). This migration adds the Aladdin-database half, exactly like
-- the limits change of 20261103090001, and reuses its grant key and permissions (no new permission, no new secret):
--   1. Vocabulary   three audit actions appended to ck_audit_action_known
--   2. Ledger       app.whatsapp_otp_delivery_requests (closed table)
--   3. begin        service role: judges the ACTOR's whatsapp_otp.manage in the database, records the request and its audit event, and signs a
--                   short-lived grant over exactly this request ("v1d|..." - a settings grant can never authorize a delivery change)
--   4. finish       service role: completes the actor's own pending request (applied / failed) and writes the audit event with actor, old
--                   value, new value, reason, version and time
--   5. reconcile    service role: completes a request the Worker's authoritative D1 audit shows as applied; closes stale ones as not applied
-- Nothing here turns delivery on: no row is written to the Worker, no setting is created, no value is seeded.

-- ---------------------------------------------------------------------------
-- 1. Vocabulary: append to the existing allow-list (never rewrite it)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array['whatsapp_otp.delivery_requested', 'whatsapp_otp.delivery_changed', 'whatsapp_otp.delivery_change_failed'];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'ck_audit_action_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  select coalesce(array_agg(a order by a), '{}') into v_missing
    from unnest(v_add) a where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) > 0 then
    alter table public.audit_log drop constraint ck_audit_action_known;
    execute 'alter table public.audit_log add constraint ck_audit_action_known '
      || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$',
           (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a) || ' NOT VALID');
  end if;
end $$;
alter table public.audit_log validate constraint ck_audit_action_known;

-- Same append-only treatment for the notification event type of the unmatched-change alert (read from the live constraint, never rewritten).
do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array['whatsapp_otp.delivery_unmatched'];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_notifications_event_type_known' and c.conrelid = 'public.notifications'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'ck_notifications_event_type_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  select coalesce(array_agg(a order by a), '{}') into v_missing
    from unnest(v_add) a where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) > 0 then
    alter table public.notifications drop constraint ck_notifications_event_type_known;
    execute 'alter table public.notifications add constraint ck_notifications_event_type_known '
      || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$',
           (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a) || ' NOT VALID');
  end if;
end $$;
alter table public.notifications validate constraint ck_notifications_event_type_known;

-- The dedupe ledger of the limits alerts gains one kind. Its own version space is separate from the limits one, so it gets its own key prefix
-- (a delivery version 3 must never be swallowed as "already alerted" because limits version 3 was). Only these two CHECKs of a closed table
-- are replaced; no row is touched.
alter table app.whatsapp_otp_notification_events drop constraint whatsapp_otp_notification_events_event_key_check;
alter table app.whatsapp_otp_notification_events drop constraint whatsapp_otp_notification_events_kind_check;
alter table app.whatsapp_otp_notification_events add constraint whatsapp_otp_notification_events_event_key_check
  check (event_key ~ '^(budget_warning|budget_critical|budget_exhausted|failure_rate|audit_unmatched|delivery_unmatched):[0-9]{1,9}$');
alter table app.whatsapp_otp_notification_events add constraint whatsapp_otp_notification_events_kind_check
  check (kind in ('budget_warning', 'budget_critical', 'budget_exhausted', 'failure_rate', 'audit_unmatched', 'delivery_unmatched'));

-- ---------------------------------------------------------------------------
-- 2. Ledger (closed table)
-- ---------------------------------------------------------------------------
create table app.whatsapp_otp_delivery_requests (
  id               uuid primary key,
  actor_id         uuid not null,                       -- the verified session user at begin, never client input
  expected_version integer not null check (expected_version >= 0),
  old_enabled      boolean,                             -- null only before the Worker has ever had a switch row (expected_version = 0)
  new_enabled      boolean not null,
  reason           text not null check (char_length(reason) between 10 and 500),
  status           text not null default 'pending' check (status in ('pending', 'applied', 'failed', 'abandoned')),
  result_code      text check (result_code is null or result_code ~ '^[a-z_]{1,48}$'),
  result_version   integer,
  created_at       timestamptz not null default clock_timestamp(),
  finished_at      timestamptz,
  constraint ck_wodr_finished check ((status = 'pending') = (finished_at is null)),
  constraint ck_wodr_old_shape check ((old_enabled is null) = (expected_version = 0))
);
create index ix_wodr_pending on app.whatsapp_otp_delivery_requests (created_at) where status = 'pending';
alter table app.whatsapp_otp_delivery_requests enable row level security;
revoke all on app.whatsapp_otp_delivery_requests from public, anon, authenticated, service_role;
comment on table app.whatsapp_otp_delivery_requests is
  'One row per WhatsApp OTP delivery switch change: written by admin_whatsapp_otp_delivery_begin, completed by _finish or reconciled against the Worker''s authoritative D1 audit. Closed table.';

-- ---------------------------------------------------------------------------
-- 3. BEGIN (service role)
-- ---------------------------------------------------------------------------
create function public.admin_whatsapp_otp_delivery_begin(p_actor uuid, p_expected_version integer, p_old boolean, p_new boolean, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_perms  text[];
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid := gen_random_uuid();
  v_key    bytea;
  v_exp    bigint;
  v_grant  text;
begin
  if p_actor is null then
    raise exception 'whatsapp_otp: actor_required' using errcode = '42501';
  end if;
  v_perms := app.admin_permissions_of(p_actor);
  if not ('whatsapp_otp.manage' = any (v_perms)) then
    raise exception 'admin permission whatsapp_otp.manage required' using errcode = '42501';
  end if;
  if p_new is null or p_expected_version is null or p_expected_version < 0 or (p_old is null) <> (p_expected_version = 0) then
    raise exception 'whatsapp_otp: invalid_version' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) > 500 or char_length(v_reason) < 10 then
    raise exception 'whatsapp_otp: reason_required' using errcode = '22023';
  end if;
  -- No row on the Worker means OFF, so turning OFF from "no row" is as much a no-op as repeating the current value.
  if coalesce(p_old, false) = p_new then
    raise exception 'whatsapp_otp: no_change' using errcode = '22023';
  end if;
  select k.key into v_key from app.whatsapp_otp_grant_key k where k.id = 1;
  if v_key is null then
    raise exception 'whatsapp_otp: grant_key_unconfigured' using errcode = '55000';
  end if;
  insert into app.whatsapp_otp_delivery_requests (id, actor_id, expected_version, old_enabled, new_enabled, reason)
  values (v_id, p_actor, p_expected_version, p_old, p_new, v_reason);
  v_exp := extract(epoch from clock_timestamp())::bigint + 300;
  -- "v1d|request|actor|version|enabled|expires|sha256(reason)": the Worker rebuilds the same string from the request it receives.
  v_grant := encode(extensions.hmac(
    convert_to(format('v1d|%s|%s|%s|%s|%s|%s', v_id, p_actor, p_expected_version, case when p_new then 1 else 0 end, v_exp,
      encode(extensions.digest(convert_to(v_reason, 'UTF8'), 'sha256'), 'hex')), 'UTF8'),
    v_key, 'sha256'), 'base64');
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform app.record_audit_event('whatsapp_otp.delivery_requested', 'whatsapp_otp_delivery', v_id, null,
    jsonb_build_object('request_id', v_id, 'old', p_old, 'new', p_new, 'reason', v_reason, 'expected_version', p_expected_version));
  return jsonb_build_object('request_id', v_id, 'actor_id', p_actor, 'reason', v_reason, 'grant', v_grant, 'grant_expires', v_exp);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. FINISH (service role): only the actor's own pending request; cannot alter the values fixed at begin
-- ---------------------------------------------------------------------------
create function public.admin_whatsapp_otp_delivery_finish(p_actor uuid, p_request uuid, p_status text, p_version integer default null, p_code text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row app.whatsapp_otp_delivery_requests;
begin
  select * into v_row from app.whatsapp_otp_delivery_requests where id = p_request for update;
  if not found or p_actor is null or v_row.actor_id is distinct from p_actor then
    raise exception 'whatsapp_otp: request_not_found' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    return v_row.status;                                   -- idempotent
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  if p_status = 'applied' then
    if p_version is distinct from v_row.expected_version + 1 then
      raise exception 'whatsapp_otp: invalid_version' using errcode = '22023';
    end if;
    update app.whatsapp_otp_delivery_requests set status = 'applied', result_version = p_version, finished_at = clock_timestamp() where id = p_request;
    perform app.record_audit_event('whatsapp_otp.delivery_changed', 'whatsapp_otp_delivery', p_request, null,
      jsonb_build_object('request_id', p_request, 'old', v_row.old_enabled, 'new', v_row.new_enabled, 'reason', v_row.reason, 'version', p_version));
    return 'applied';
  elsif p_status = 'failed' then
    if p_code is null or p_code !~ '^[a-z_]{1,48}$' then
      raise exception 'whatsapp_otp: invalid_code' using errcode = '22023';
    end if;
    update app.whatsapp_otp_delivery_requests set status = 'failed', result_code = p_code, finished_at = clock_timestamp() where id = p_request;
    perform app.record_audit_event('whatsapp_otp.delivery_change_failed', 'whatsapp_otp_delivery', p_request, null,
      jsonb_build_object('request_id', p_request, 'code', p_code));
    return 'failed';
  end if;
  raise exception 'whatsapp_otp: invalid_status' using errcode = '22023';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RECONCILE (service role, rows from the Worker's signed usage endpoint)
-- ---------------------------------------------------------------------------
-- UNMATCHED CHANGE (internal): the Worker's authoritative audit shows a delivery switch change that Supabase never approved (no request for that
-- actor, version and value, or one not recorded as applied), e.g. a direct write to D1 by someone holding the Cloudflare token. Raised once per
-- (version, time) through the EXISTING notification system, to active staff holding whatsapp_otp.view. Statistics only: the version number.
create function app.whatsapp_otp_record_delivery_unmatched(p_version integer, p_at bigint)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  v_when timestamptz := to_timestamp(p_at);
  v_n    integer;
  v_user uuid;
  v_id   uuid;
begin
  insert into app.whatsapp_otp_notification_events (event_key, occurred_at, kind, source_env, stats, recipients)
  values ('delivery_unmatched:' || p_version, v_when, 'delivery_unmatched', 'worker', jsonb_build_object('version', p_version), 0)
  on conflict (event_key, occurred_at) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return 0;
  end if;
  v_n := 0;
  for v_user in
    select distinct a.user_id
      from public.admin_role_assignments a
      join public.admin_roles r on r.id = a.role_id and r.status = 'active'
      join public.admin_role_permissions rp on rp.role_id = r.id and rp.permission_key = 'whatsapp_otp.view'
      join public.admin_permissions p on p.key = rp.permission_key and p.is_active
      join public.users u on u.id = a.user_id
     where a.is_active and a.scope_type = 'platform' and u.status not in ('suspended', 'deactivated')
  loop
    v_id := app.notify(v_user, null, 'whatsapp_otp.delivery_unmatched', 'whatsapp_otp', null, '/admin/whatsapp-otp',
                       'notifications.whatsapp_otp.delivery_unmatched.title', 'notifications.whatsapp_otp.delivery_unmatched.body',
                       jsonb_build_object('version', p_version));
    if v_id is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  update app.whatsapp_otp_notification_events set recipients = v_n where event_key = 'delivery_unmatched:' || p_version and occurred_at = v_when;
  return v_n;
end;
$$;

create function public.admin_whatsapp_otp_delivery_reconcile(p_applied jsonb, p_drift jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  e jsonb;
  v_row app.whatsapp_otp_delivery_requests;
  v_applied integer := 0;
  v_abandoned integer := 0;
  v_unmatched integer := 0;
begin
  if p_applied is null or jsonb_typeof(p_applied) <> 'array' or jsonb_array_length(p_applied) > 100 then
    raise exception 'whatsapp_otp: invalid_reconcile_input' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_applied) loop
    continue when jsonb_typeof(e) <> 'object'
      or coalesce(e ->> 'request_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(e ->> 'actor', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(e ->> 'version', '') !~ '^[0-9]{1,9}$'
      or coalesce(e ->> 'at', '') !~ '^[0-9]{9,11}$'
      or jsonb_typeof(e -> 'new') <> 'boolean';
    update app.whatsapp_otp_delivery_requests
       set status = 'applied', result_version = (e ->> 'version')::int, finished_at = clock_timestamp()
     where id = (e ->> 'request_id')::uuid and status = 'pending'
       and actor_id = (e ->> 'actor')::uuid and expected_version + 1 = (e ->> 'version')::int
       and new_enabled = (e ->> 'new')::boolean
    returning * into v_row;
    if found then
      perform app.record_audit_event('whatsapp_otp.delivery_changed', 'whatsapp_otp_delivery', v_row.id, null,
        jsonb_build_object('request_id', v_row.id, 'actor_id', v_row.actor_id, 'old', v_row.old_enabled, 'new', v_row.new_enabled,
                           'reason', v_row.reason, 'version', v_row.result_version, 'reconciled', true));
      v_applied := v_applied + 1;
    elsif not exists (
      select 1 from app.whatsapp_otp_delivery_requests r
       where r.id = (e ->> 'request_id')::uuid and r.status = 'applied'
         and r.actor_id = (e ->> 'actor')::uuid and r.expected_version + 1 = (e ->> 'version')::int and r.new_enabled = (e ->> 'new')::boolean
    ) then
      -- The Worker applied a switch change that no approved request of this actor, version and value accounts for: alert the administrators.
      if app.whatsapp_otp_record_delivery_unmatched((e ->> 'version')::int, (e ->> 'at')::bigint) > 0 then
        v_unmatched := v_unmatched + 1;
      end if;
    end if;
  end loop;
  for v_row in
    update app.whatsapp_otp_delivery_requests
       set status = 'abandoned', result_code = 'not_applied', finished_at = clock_timestamp()
     where status = 'pending' and created_at < clock_timestamp() - interval '15 minutes'
    returning *
  loop
    perform app.record_audit_event('whatsapp_otp.delivery_change_failed', 'whatsapp_otp_delivery', v_row.id, null,
      jsonb_build_object('request_id', v_row.id, 'actor_id', v_row.actor_id, 'code', 'not_applied', 'reconciled', true));
    v_abandoned := v_abandoned + 1;
  end loop;
  -- DRIFT: the Worker's switch row is not accounted for by ANY audit row (a direct write to D1 that bypassed the audit). The Worker already
  -- treats that as OFF; this raises the same once-per-(version, time) alert. Malformed input is ignored, never an error.
  if p_drift is not null and jsonb_typeof(p_drift) = 'object'
     and coalesce(p_drift ->> 'version', '') ~ '^[0-9]{1,9}$' and coalesce(p_drift ->> 'at', '') ~ '^[0-9]{9,11}$' then
    if app.whatsapp_otp_record_delivery_unmatched((p_drift ->> 'version')::int, (p_drift ->> 'at')::bigint) > 0 then
      v_unmatched := v_unmatched + 1;
    end if;
  end if;
  return jsonb_build_object('applied', v_applied, 'abandoned', v_abandoned, 'unmatched', v_unmatched);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants: service role only; nothing is executable by anon, authenticated or PUBLIC
-- ---------------------------------------------------------------------------
revoke all on function public.admin_whatsapp_otp_delivery_begin(uuid, integer, boolean, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_whatsapp_otp_delivery_finish(uuid, uuid, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_whatsapp_otp_delivery_reconcile(jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_whatsapp_otp_delivery_begin(uuid, integer, boolean, boolean, text) to service_role;
grant execute on function public.admin_whatsapp_otp_delivery_finish(uuid, uuid, text, integer, text) to service_role;
grant execute on function public.admin_whatsapp_otp_delivery_reconcile(jsonb, jsonb) to service_role;

comment on function public.admin_whatsapp_otp_delivery_begin(uuid, integer, boolean, boolean, text) is 'Service role only. Checks the ACTOR''s effective whatsapp_otp.manage, records the request and its audit event, and signs a one-request grant ("v1d") for the Worker. Never turns delivery on by itself.';
comment on function public.admin_whatsapp_otp_delivery_finish(uuid, uuid, text, integer, text) is 'Service role only, after the Worker''s signed answer. Completes the actor''s own pending request and writes the audit event with actor, old value, new value, reason and version. Idempotent.';
comment on function public.admin_whatsapp_otp_delivery_reconcile(jsonb, jsonb) is 'Service role only. Completes requests that the Worker''s authoritative D1 audit shows as applied and closes stale ones as not applied.';

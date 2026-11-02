-- ===========================================================================
-- Admin-controlled WhatsApp OTP limits: permissions, audit and notification vocabulary, ledgers and RPCs
-- (docs/security/WHATSAPP_OTP_ADMIN_SETTINGS_PLAN.md).
--
-- WHAT THIS DOES NOT DO. It stores no limit. The authoritative settings (Daily Send Limit, Hard Ceiling, thresholds) live in the delivery
-- Worker's own D1, next to the atomic claim, and are changed through a signed Worker endpoint. This migration gives that flow its
-- authorization, identity and audit in the existing admin infrastructure, and lets the Worker's alerts reach the EXISTING notification
-- inbox. It adds no second permission system, no second audit system and no second notification framework.
--
--   1. Permissions     whatsapp_otp.view (Administrator and higher), whatsapp_otp.manage and whatsapp_otp.ceiling_manage (Super Admin only,
--                      locked). ceiling_manage is the elevated permission for the Hard Ceiling.
--   2. Vocabulary      three audit actions and four notification event types, appended to the existing allow-lists.
--   3. Ledgers         app.whatsapp_otp_settings_requests (a pending/applied/failed record per change, so a change whose Supabase completion
--                      failed can be reconciled from the Worker's authoritative D1 audit) and app.whatsapp_otp_notification_events (the
--                      dedupe ledger in front of app.notify). Both are closed tables: RLS on, no grants.
--   4. RPCs            begin / finish (the caller's own session: auth.uid() IS the actor), view_check, reconcile and notification_record
--                      (service role only, called by the app server).
--
-- SECURITY. Every function is SECURITY DEFINER with search_path = '' and schema-qualified references. Permission checks go through
-- app.admin_require (auth.uid() based), never a caller-supplied actor. The service-role functions are not executable by any client role.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('whatsapp_otp.view', 'whatsapp_otp', 'view',
   'See the WhatsApp OTP send budget, usage, delivery-failure statistics and change history (Administrator and higher).', 70),
  ('whatsapp_otp.manage', 'whatsapp_otp', 'manage',
   'Change the WhatsApp OTP Daily Send Limit and warning thresholds, with a mandatory reason (Super Admin only).', 71),
  ('whatsapp_otp.ceiling_manage', 'whatsapp_otp', 'ceiling_manage',
   'Change the WhatsApp OTP Hard Ceiling, the maximum the Daily Send Limit may take: a sensitive change with a typed confirmation and a longer reason (Super Admin only by default).', 72)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, p.key, true
  from public.admin_roles r
 cross join (values ('whatsapp_otp.view'), ('whatsapp_otp.manage'), ('whatsapp_otp.ceiling_manage')) as p(key)
 where r.key = 'super_admin'
on conflict (role_id, permission_key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'whatsapp_otp.view', true
  from public.admin_roles r
 where r.key = 'administrator'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Vocabulary: append to the existing allow-lists (never rewrite them)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array['whatsapp_otp.settings_requested', 'whatsapp_otp.settings_changed', 'whatsapp_otp.settings_change_failed'];
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

do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array['whatsapp_otp.budget_warning', 'whatsapp_otp.budget_critical', 'whatsapp_otp.budget_exhausted', 'whatsapp_otp.failure_rate'];
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

-- ---------------------------------------------------------------------------
-- 3. Ledgers (closed tables)
-- ---------------------------------------------------------------------------
create table app.whatsapp_otp_settings_requests (
  id               uuid primary key,
  actor_id         uuid not null,                       -- auth.uid() at begin: the verified session, never client input
  expected_version integer not null check (expected_version >= 0),
  old_settings     jsonb,                               -- null only for the first initialization (expected_version = 0)
  new_settings     jsonb not null,
  reason           text not null check (char_length(reason) between 10 and 500),
  ceiling_changed  boolean not null,
  status           text not null default 'pending' check (status in ('pending', 'applied', 'failed', 'abandoned')),
  result_code      text check (result_code is null or result_code ~ '^[a-z_]{1,48}$'),
  result_version   integer,
  created_at       timestamptz not null default clock_timestamp(),
  finished_at      timestamptz,
  constraint ck_wosr_finished check ((status = 'pending') = (finished_at is null)),
  constraint ck_wosr_old_shape check ((old_settings is null) = (expected_version = 0))
);
create index ix_wosr_pending on app.whatsapp_otp_settings_requests (created_at) where status = 'pending';
alter table app.whatsapp_otp_settings_requests enable row level security;
revoke all on app.whatsapp_otp_settings_requests from public, anon, authenticated, service_role;
comment on table app.whatsapp_otp_settings_requests is
  'One row per WhatsApp OTP settings change: written by admin_whatsapp_otp_settings_begin, completed by _finish or reconciled against the Worker''s authoritative D1 audit. Closed table.';

-- The key is (event_key, occurred_at): the Worker retries the same event with the same occurred_at, while a recreated D1 that restarts its
-- episode counter produces a different occurred_at and is therefore never silently swallowed as a duplicate.
create table app.whatsapp_otp_notification_events (
  event_key    text not null check (event_key ~ '^(budget_warning|budget_critical|budget_exhausted|failure_rate):[0-9]{1,9}$'),
  occurred_at  timestamptz not null,
  kind         text not null check (kind in ('budget_warning', 'budget_critical', 'budget_exhausted', 'failure_rate')),
  source_env   text not null check (source_env ~ '^[a-z]{3,16}$'),
  stats        jsonb not null check (jsonb_typeof(stats) = 'object' and length(stats::text) <= 1024),
  recipients   integer not null check (recipients >= 0),
  created_at   timestamptz not null default clock_timestamp(),
  primary key (event_key, occurred_at)
);
alter table app.whatsapp_otp_notification_events enable row level security;
revoke all on app.whatsapp_otp_notification_events from public, anon, authenticated, service_role;
comment on table app.whatsapp_otp_notification_events is
  'Dedupe ledger in front of app.notify for the WhatsApp OTP operational alerts. Closed table.';

-- ---------------------------------------------------------------------------
-- 4. Validation: the same invariants the Worker and its D1 CHECKs enforce
-- ---------------------------------------------------------------------------
-- Integers only; 1 <= daily_limit <= hard_ceiling <= 1,000,000 (a sanity bound, not an operational maximum); 1 <= warn < critical <= 100.
-- CASE guards every cast, because SQL does not promise the order in which AND terms are evaluated.
create function app.whatsapp_otp_settings_valid(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p is null or jsonb_typeof(p) <> 'object' then false
    when (select count(*) from jsonb_object_keys(p)) <> 4 then false
    when not (p ?& array['daily_limit', 'hard_ceiling', 'warn_percent', 'critical_percent']) then false
    when jsonb_typeof(p -> 'daily_limit') <> 'number' or jsonb_typeof(p -> 'hard_ceiling') <> 'number'
      or jsonb_typeof(p -> 'warn_percent') <> 'number' or jsonb_typeof(p -> 'critical_percent') <> 'number' then false
    when (p ->> 'daily_limit') !~ '^[0-9]{1,7}$' or (p ->> 'hard_ceiling') !~ '^[0-9]{1,7}$'
      or (p ->> 'warn_percent') !~ '^[0-9]{1,3}$' or (p ->> 'critical_percent') !~ '^[0-9]{1,3}$' then false
    else (p ->> 'daily_limit')::int >= 1
     and (p ->> 'daily_limit')::int <= (p ->> 'hard_ceiling')::int
     and (p ->> 'hard_ceiling')::int <= 1000000
     and (p ->> 'warn_percent')::int >= 1
     and (p ->> 'warn_percent')::int < (p ->> 'critical_percent')::int
     and (p ->> 'critical_percent')::int <= 100
  end
$$;
revoke all on function app.whatsapp_otp_settings_valid(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RPCs
-- ---------------------------------------------------------------------------
-- The page loader's permission check: the database, not the route rule alone, decides who may read the Worker's usage.
create function public.admin_whatsapp_otp_view_check()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.admin_require('whatsapp_otp.view');
  return true;
end;
$$;

-- BEGIN: authorize and record a requested change. The caller is the verified session; nothing about identity is a parameter.
create function public.admin_whatsapp_otp_settings_begin(p_expected_version integer, p_old jsonb, p_new jsonb, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor   uuid := (select auth.uid());
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ceiling boolean;
  v_min     integer;
  v_id      uuid := gen_random_uuid();
begin
  perform app.admin_require('whatsapp_otp.manage');
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'whatsapp_otp: invalid_version' using errcode = '22023';
  end if;
  -- The clearest refusal first: lowering the ceiling below the CURRENT limit without lowering the limit in the SAME request. (Such a payload
  -- is also generically invalid, so this must run before the generic check or its explanation would never be reachable. Nested IFs keep
  -- every cast behind its regex.)
  if p_old is not null and jsonb_typeof(p_new) = 'object' and app.whatsapp_otp_settings_valid(p_old) then
    if coalesce(p_new ->> 'hard_ceiling', '') ~ '^[0-9]{1,7}$' and coalesce(p_new ->> 'daily_limit', '') ~ '^[0-9]{1,7}$' then
      if (p_new ->> 'hard_ceiling')::int < (p_old ->> 'daily_limit')::int and (p_new ->> 'daily_limit') = (p_old ->> 'daily_limit') then
        raise exception 'whatsapp_otp: ceiling_below_current_limit' using errcode = '22023';
      end if;
    end if;
  end if;
  if not app.whatsapp_otp_settings_valid(p_new) or (p_old is not null and not app.whatsapp_otp_settings_valid(p_old)) then
    raise exception 'whatsapp_otp: invalid_settings' using errcode = '22023';
  end if;
  if (p_old is null) <> (p_expected_version = 0) then
    raise exception 'whatsapp_otp: invalid_version' using errcode = '22023';
  end if;
  -- Derived here, never trusted from the client: the Hard Ceiling changes when it is first set or differs from the current one.
  v_ceiling := p_old is null or (p_old ->> 'hard_ceiling')::int <> (p_new ->> 'hard_ceiling')::int;
  if v_ceiling then
    perform app.admin_require('whatsapp_otp.ceiling_manage');
  end if;
  -- (a CASE ... THEN inside an IF condition would end the condition at its first THEN, so the minimum length is computed first)
  v_min := case when v_ceiling then 20 else 10 end;
  if v_reason is null or char_length(v_reason) > 500 or char_length(v_reason) < v_min then
    raise exception 'whatsapp_otp: reason_required' using errcode = '22023';
  end if;
  if p_old is not null then
    if p_old = p_new then
      raise exception 'whatsapp_otp: no_change' using errcode = '22023';
    end if;
  end if;
  insert into app.whatsapp_otp_settings_requests (id, actor_id, expected_version, old_settings, new_settings, reason, ceiling_changed)
  values (v_id, v_actor, p_expected_version, p_old, p_new, v_reason, v_ceiling);
  perform app.record_audit_event('whatsapp_otp.settings_requested', 'whatsapp_otp_settings', v_id, null,
    jsonb_build_object('request_id', v_id, 'old', p_old, 'new', p_new, 'reason', v_reason, 'ceiling_changed', v_ceiling, 'expected_version', p_expected_version));
  return jsonb_build_object('request_id', v_id, 'actor_id', v_actor, 'ceiling_changed', v_ceiling);
end;
$$;

-- FINISH: the caller's own session completes its own pending request. It cannot supply or alter old/new values: those were fixed at begin.
create function public.admin_whatsapp_otp_settings_finish(p_request uuid, p_status text, p_version integer default null, p_code text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare
  v_row app.whatsapp_otp_settings_requests;
begin
  perform app.admin_require('whatsapp_otp.manage');
  select * into v_row from app.whatsapp_otp_settings_requests where id = p_request for update;
  if not found or v_row.actor_id is distinct from (select auth.uid()) then
    raise exception 'whatsapp_otp: request_not_found' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    return v_row.status;                                   -- idempotent
  end if;
  if p_status = 'applied' then
    if p_version is distinct from v_row.expected_version + 1 then
      raise exception 'whatsapp_otp: invalid_version' using errcode = '22023';
    end if;
    update app.whatsapp_otp_settings_requests set status = 'applied', result_version = p_version, finished_at = clock_timestamp() where id = p_request;
    perform app.record_audit_event('whatsapp_otp.settings_changed', 'whatsapp_otp_settings', p_request, null,
      jsonb_build_object('request_id', p_request, 'old', v_row.old_settings, 'new', v_row.new_settings, 'reason', v_row.reason,
                         'version', p_version, 'ceiling_changed', v_row.ceiling_changed));
    return 'applied';
  elsif p_status = 'failed' then
    if p_code is null or p_code !~ '^[a-z_]{1,48}$' then
      raise exception 'whatsapp_otp: invalid_code' using errcode = '22023';
    end if;
    update app.whatsapp_otp_settings_requests set status = 'failed', result_code = p_code, finished_at = clock_timestamp() where id = p_request;
    perform app.record_audit_event('whatsapp_otp.settings_change_failed', 'whatsapp_otp_settings', p_request, null,
      jsonb_build_object('request_id', p_request, 'code', p_code, 'ceiling_changed', v_row.ceiling_changed));
    return 'failed';
  end if;
  raise exception 'whatsapp_otp: invalid_status' using errcode = '22023';
end;
$$;

-- RECONCILE (service role, called by the app server with rows it got from the Worker's signed usage endpoint): a change that D1 applied
-- but whose Supabase completion never arrived is completed from the AUTHORITATIVE D1 record; a request older than 15 minutes that D1
-- never applied is closed as not applied. A browser can never reach this function.
create function public.admin_whatsapp_otp_settings_reconcile(p_applied jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  e jsonb;
  v_row app.whatsapp_otp_settings_requests;
  v_applied integer := 0;
  v_abandoned integer := 0;
begin
  if p_applied is null or jsonb_typeof(p_applied) <> 'array' or jsonb_array_length(p_applied) > 100 then
    raise exception 'whatsapp_otp: invalid_reconcile_input' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_applied) loop
    continue when jsonb_typeof(e) <> 'object'
      or coalesce(e ->> 'request_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(e ->> 'actor', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or coalesce(e ->> 'version', '') !~ '^[0-9]{1,9}$';
    update app.whatsapp_otp_settings_requests
       set status = 'applied', result_version = (e ->> 'version')::int, finished_at = clock_timestamp()
     where id = (e ->> 'request_id')::uuid and status = 'pending'
       and actor_id = (e ->> 'actor')::uuid and expected_version + 1 = (e ->> 'version')::int
    returning * into v_row;
    if found then
      perform app.record_audit_event('whatsapp_otp.settings_changed', 'whatsapp_otp_settings', v_row.id, null,
        jsonb_build_object('request_id', v_row.id, 'actor_id', v_row.actor_id, 'old', v_row.old_settings, 'new', v_row.new_settings,
                           'reason', v_row.reason, 'version', v_row.result_version, 'ceiling_changed', v_row.ceiling_changed, 'reconciled', true));
      v_applied := v_applied + 1;
    end if;
  end loop;
  for v_row in
    update app.whatsapp_otp_settings_requests
       set status = 'abandoned', result_code = 'not_applied', finished_at = clock_timestamp()
     where status = 'pending' and created_at < clock_timestamp() - interval '15 minutes'
    returning *
  loop
    perform app.record_audit_event('whatsapp_otp.settings_change_failed', 'whatsapp_otp_settings', v_row.id, null,
      jsonb_build_object('request_id', v_row.id, 'actor_id', v_row.actor_id, 'code', 'not_applied', 'reconciled', true));
    v_abandoned := v_abandoned + 1;
  end loop;
  return jsonb_build_object('applied', v_applied, 'abandoned', v_abandoned);
end;
$$;

-- NOTIFICATION RECORD (service role): the one door through which the Worker's signed alert reaches the existing notification inbox.
-- Statistics only: the payload is validated against an allow-list of numeric keys per kind. Idempotent by (event_key, occurred_at).
create function public.whatsapp_otp_notification_record(p_event_key text, p_kind text, p_source_env text, p_occurred_at bigint, p_stats jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_allowed text[];
  v_params  jsonb := '{}'::jsonb;
  v_key     text;
  v_val     jsonb;
  v_when    timestamptz;
  v_n       integer := 0;
  v_user    uuid;
  v_id      uuid;
begin
  if p_kind is null or p_kind not in ('budget_warning', 'budget_critical', 'budget_exhausted', 'failure_rate') then
    raise exception 'whatsapp_otp: invalid_kind' using errcode = '22023';
  end if;
  if p_event_key is null or p_event_key !~ ('^' || p_kind || ':[0-9]{1,9}$') then
    raise exception 'whatsapp_otp: invalid_event_key' using errcode = '22023';
  end if;
  if p_source_env is null or p_source_env !~ '^[a-z]{3,16}$' then
    raise exception 'whatsapp_otp: invalid_source' using errcode = '22023';
  end if;
  if p_occurred_at is null or p_occurred_at < 1700000000 or p_occurred_at > extract(epoch from clock_timestamp() + interval '1 day')::bigint then
    raise exception 'whatsapp_otp: invalid_time' using errcode = '22023';
  end if;
  if p_stats is null or jsonb_typeof(p_stats) <> 'object' or length(p_stats::text) > 1024 then
    raise exception 'whatsapp_otp: invalid_stats' using errcode = '22023';
  end if;
  v_allowed := case p_kind
    when 'failure_rate' then array['attempts', 'failed', 'failure_percent', 'window_minutes']
    else array['limit', 'ceiling', 'consumed', 'remaining', 'percent', 'warn_percent', 'critical_percent', 'accepted', 'failed', 'reserved', 'level']
  end;
  for v_key, v_val in select key, value from jsonb_each(p_stats) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'whatsapp_otp: invalid_stats' using errcode = '22023';
    end if;
    if v_key = 'level' then
      if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') not in ('ok', 'warning', 'critical', 'exhausted') then
        raise exception 'whatsapp_otp: invalid_stats' using errcode = '22023';
      end if;
    elsif jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}') !~ '^[0-9]{1,9}$' then
      raise exception 'whatsapp_otp: invalid_stats' using errcode = '22023';
    end if;
    v_params := v_params || jsonb_build_object(v_key, v_val);
  end loop;
  v_params := v_params || jsonb_build_object('environment', p_source_env);
  v_when := to_timestamp(p_occurred_at);

  insert into app.whatsapp_otp_notification_events (event_key, occurred_at, kind, source_env, stats, recipients)
  values (p_event_key, v_when, p_kind, p_source_env, p_stats, 0)
  on conflict (event_key, occurred_at) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('status', 'duplicate', 'recipients', 0);   -- a retry or replay: nothing is notified twice
  end if;

  -- Fan out through the EXISTING notification system, only to active, non-suspended platform staff holding whatsapp_otp.view.
  -- Any failure here aborts the whole function (the ledger row above rolls back), so the Worker's retry redoes it cleanly.
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
    v_id := app.notify(v_user, null, 'whatsapp_otp.' || p_kind, 'whatsapp_otp', null, '/admin/whatsapp-otp',
                       'notifications.whatsapp_otp.' || p_kind || '.title', 'notifications.whatsapp_otp.' || p_kind || '.body', v_params);
    if v_id is not null then
      v_n := v_n + 1;
    end if;
  end loop;
  update app.whatsapp_otp_notification_events set recipients = v_n where event_key = p_event_key and occurred_at = v_when;
  return jsonb_build_object('status', 'recorded', 'recipients', v_n);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants: nothing is executable by anon or PUBLIC. The admin RPCs are callable by a signed-in user but every one re-checks the
-- admin permission against auth.uid(); the two service-role functions are not executable by any client role.
-- ---------------------------------------------------------------------------
revoke all on function public.admin_whatsapp_otp_view_check() from public, anon, authenticated, service_role;
revoke all on function public.admin_whatsapp_otp_settings_begin(integer, jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_whatsapp_otp_settings_finish(uuid, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_whatsapp_otp_settings_reconcile(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.whatsapp_otp_notification_record(text, text, text, bigint, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_whatsapp_otp_view_check() to authenticated;
grant execute on function public.admin_whatsapp_otp_settings_begin(integer, jsonb, jsonb, text) to authenticated;
grant execute on function public.admin_whatsapp_otp_settings_finish(uuid, text, integer, text) to authenticated;
grant execute on function public.admin_whatsapp_otp_settings_reconcile(jsonb) to service_role;
grant execute on function public.whatsapp_otp_notification_record(text, text, text, bigint, jsonb) to service_role;

comment on function public.admin_whatsapp_otp_view_check() is 'Requires whatsapp_otp.view. The page loader calls it before reading the Worker''s usage, so the database decides who may see it.';
comment on function public.admin_whatsapp_otp_settings_begin(integer, jsonb, jsonb, text) is 'Requires whatsapp_otp.manage (and whatsapp_otp.ceiling_manage when the Hard Ceiling changes). Validates, records the request and its audit event; the actor is auth.uid().';
comment on function public.admin_whatsapp_otp_settings_finish(uuid, text, integer, text) is 'Completes the caller''s own pending request (applied or failed) and writes the audit event with actor, old value, new value and time. Idempotent; cannot alter the recorded values.';
comment on function public.admin_whatsapp_otp_settings_reconcile(jsonb) is 'Service role only. Completes requests that the Worker''s authoritative D1 audit shows as applied and closes stale ones as not applied.';
comment on function public.whatsapp_otp_notification_record(text, text, text, bigint, jsonb) is 'Service role only. Records a Worker alert once (dedupe ledger) and fans it out through app.notify to staff holding whatsapp_otp.view. Statistics only.';

-- ===========================================================================
-- Admin backup control: permissions, schedules, run ledger and audited RPCs
-- (docs/operations/BACKUPS_ADMIN.md).
--
-- WHAT THIS DOES NOT DO. It dispatches nothing, schedules nothing and touches no bucket. The GitHub workflows in the
-- private `aladdin-backups` repository remain the only thing that runs a backup or a restore test. This migration gives
-- that flow its authorization, its single source of schedule truth and its audit in the existing Admin infrastructure.
-- It adds no second permission system, no second audit system and no second scheduler.
--
--   1. Permissions  backup.view (Administrator and higher), backup.execute, backup.schedule_manage and
--                   backup.restore_test (Super Admin only by default, locked).
--   2. Environment  app.backup_environment holds the ONE environment this database serves. It is empty until an operator
--                   initializes it (admin_backup_initialize, service role only). Until then every action fails closed.
--   3. Settings     app.backup_settings (one row) is the schedule the GitHub workflow reads on every firing, so a change
--                   made here needs no redeploy and no frontend availability. Production stays OFF until a separate
--                   activation with its own re-authentication and typed confirmation.
--   4. Ledger       app.backup_runs / app.backup_run_events record what was requested, dispatched, reported and verified.
--                   A planning-only or skipped GitHub job can never become a successful run: only the server's
--                   cross-check of the run AND its backup job may mark `succeeded`.
--   5. RPCs         The browser reaches only admin_backup_status (read, backup.view). Every mutation is service_role only:
--                   the server derives the actor from the verified session, checks the actor's effective permissions in
--                   the database and spends a current-password receipt for the sensitive ones.
--
-- SECURITY. Every function is SECURITY DEFINER with search_path = '' and schema-qualified references. Service-role
-- functions set the transaction-local JWT claims to the actor the trusted server passed, so app.admin_require and
-- app.record_audit_event judge and attribute the ACTOR, never client input. No API role can execute a mutation.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('backup.view', 'backup', 'view',
   'See backup schedules, last successful run, failures and the run history (Administrator and higher).', 90),
  ('backup.execute', 'backup', 'execute',
   'Start a manual backup for this environment, with a reason and a current-password confirmation (Super Admin only).', 91),
  ('backup.schedule_manage', 'backup', 'schedule_manage',
   'Change the backup schedule and activate or deactivate Production backups (Super Admin only).', 92),
  ('backup.restore_test', 'backup', 'restore_test',
   'Start a restore test for this environment, with a reason and a current-password confirmation (Super Admin only).', 93)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, p.key, true
  from public.admin_roles r
 cross join (values ('backup.view'), ('backup.execute'), ('backup.schedule_manage'), ('backup.restore_test')) as p(key)
 where r.key = 'super_admin'
on conflict (role_id, permission_key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'backup.view', true
  from public.admin_roles r
 where r.key = 'administrator'
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Vocabulary: append to the existing allow-list (never rewrite it)
-- ---------------------------------------------------------------------------
select app.audit_actions_add(array[
  'backup.environment_initialized',
  'backup.settings_changed',
  'backup.production_activated',
  'backup.production_deactivated',
  'backup.run_requested',
  'backup.run_dispatched',
  'backup.run_failed',
  'backup.run_verified'
]);

-- ---------------------------------------------------------------------------
-- 3. Environment, settings and ledgers (closed tables)
-- ---------------------------------------------------------------------------
create table app.backup_environment (
  singleton      boolean primary key default true check (singleton),
  environment    text not null check (environment in ('acceptance', 'production')),
  initialized_by uuid references public.users (id) on delete set null,
  initialized_at timestamptz not null default clock_timestamp()
);
alter table app.backup_environment enable row level security;
revoke all on app.backup_environment from public, anon, authenticated, service_role;
comment on table app.backup_environment is
  'The one environment this database serves. Empty until an operator initializes it; every backup action fails closed until then.';

create table app.backup_settings (
  singleton                            boolean primary key default true check (singleton),
  acceptance_schedule                  text not null default 'off' check (acceptance_schedule in ('off', 'daily', 'weekly')),
  production_enabled                   boolean not null default false,
  production_restore_schedule_enabled  boolean not null default false,
  schedule_time                        time not null default '01:30',
  schedule_weekday                     integer not null default 0 check (schedule_weekday between 0 and 6),
  paused_until                         timestamptz,
  version                              integer not null default 0 check (version >= 0),
  updated_by                           uuid references public.users (id) on delete set null,
  updated_at                           timestamptz not null default clock_timestamp(),
  -- A scheduled Production restore is impossible while Production backups are off.
  constraint ck_backup_settings_restore_requires_production
    check (not production_restore_schedule_enabled or production_enabled)
);
alter table app.backup_settings enable row level security;
revoke all on app.backup_settings from public, anon, authenticated, service_role;
insert into app.backup_settings (singleton) values (true) on conflict (singleton) do nothing;
comment on table app.backup_settings is
  'Single source of schedule truth. Read by the private GitHub workflow on every firing and by /admin/backups. Production stays OFF until a separate activation.';

create table app.backup_runs (
  id                 uuid primary key default extensions.gen_random_uuid(),
  environment        text not null check (environment in ('acceptance', 'production')),
  kind               text not null check (kind in ('backup', 'restore_test')),
  trigger            text not null check (trigger in ('schedule', 'manual')),
  status             text not null default 'requested'
                       check (status in ('requested', 'dispatched', 'running', 'succeeded', 'failed', 'skipped', 'unknown')),
  requested_by       uuid references public.users (id) on delete set null,
  reason             text not null check (char_length(reason) between 10 and 500),
  github_run_id      bigint check (github_run_id is null or github_run_id > 0),
  github_run_url     text check (github_run_url is null or github_run_url ~ '^https://github\.com/'),
  github_conclusion  text check (github_conclusion is null or github_conclusion ~ '^[a-z_]{1,32}$'),
  summary            jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_code         text check (error_code is null or error_code ~ '^[a-z0-9_]{1,48}$'),
  requested_at       timestamptz not null default clock_timestamp(),
  dispatched_at      timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  reported_at        timestamptz,
  constraint uq_backup_runs_github unique (environment, github_run_id),
  -- A terminal status always carries its end time; a non-terminal status never does.
  constraint ck_backup_runs_finished
    check ((status in ('succeeded', 'failed', 'skipped', 'unknown')) = (finished_at is not null)),
  constraint ck_backup_runs_dispatched
    check (status in ('requested', 'failed') or dispatched_at is not null)
);
create index ix_backup_runs_environment_requested on app.backup_runs (environment, requested_at desc);
-- Serialize manual and scheduled requests per environment/kind; ambiguous dispatches hold the slot.
create unique index uq_backup_run_pending on app.backup_runs(environment, kind)
  where status in ('requested','dispatched','running','unknown');
create index ix_backup_runs_status on app.backup_runs (status, requested_at desc);
alter table app.backup_runs enable row level security;
revoke all on app.backup_runs from public, anon, authenticated, service_role;
comment on table app.backup_runs is
  'Every backup / restore-test run this environment knows about. Only the server cross-check may mark a run succeeded.';

create table app.backup_run_events (
  id      bigserial primary key,
  run_id  uuid not null references app.backup_runs (id) on delete cascade,
  at      timestamptz not null default clock_timestamp(),
  kind    text not null check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  detail  jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index ix_backup_run_events_run on app.backup_run_events (run_id, at);
alter table app.backup_run_events enable row level security;
revoke all on app.backup_run_events from public, anon, authenticated, service_role;
comment on table app.backup_run_events is 'Append-only run timeline. Counts and codes only: never a credential or a signed URL.';

-- ---------------------------------------------------------------------------
-- 4. Internal helpers
-- ---------------------------------------------------------------------------
create function app.backup_environment_value()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text;
begin
  select environment into v from app.backup_environment where singleton;
  if v is null then
    raise exception 'backup environment is not initialized' using errcode = '55000';
  end if;
  return v;
end;
$$;
revoke all on function app.backup_environment_value() from public, anon, authenticated, service_role;
comment on function app.backup_environment_value() is
  'Internal. The one environment this database serves; raises until an operator initialized it.';

-- The actor a trusted server passed becomes the transaction's JWT subject for app.admin_require and the audit row.
create function app.backup_actor(p_actor uuid, p_permission text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'backup actor required' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor, 'role', 'authenticated')::text, true);
  perform app.admin_require(p_permission);
end;
$$;
revoke all on function app.backup_actor(uuid, text) from public, anon, authenticated, service_role;

-- A sensitive action spends the actor's single-use current-password receipt bound to (actor, operation, environment).
create function app.backup_require_reauth(p_actor uuid, p_receipt uuid, p_operation text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.consume_reauth_receipt_for(p_actor, p_receipt, p_operation, app.backup_environment_value()) then
    raise exception 'a current-password confirmation is required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function app.backup_require_reauth(uuid, uuid, text) from public, anon, authenticated, service_role;

create function app.backup_settings_valid(p_acceptance text, p_restore boolean, p_production boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_acceptance in ('off', 'daily', 'weekly')
     and p_restore is not null
     and p_production is not null
     and (not p_restore or p_production);
$$;
revoke all on function app.backup_settings_valid(text, boolean, boolean) from public, anon, authenticated, service_role;

create function app.backup_run_event(p_run uuid, p_kind text, p_detail jsonb default '{}'::jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into app.backup_run_events (run_id, kind, detail) values (p_run, p_kind, coalesce(p_detail, '{}'::jsonb));
$$;
revoke all on function app.backup_run_event(uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Initialization (operator / deployment step, service role only)
-- ---------------------------------------------------------------------------
create function public.admin_backup_initialize(p_actor uuid, p_environment text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  perform app.backup_actor(p_actor, 'backup.schedule_manage');
  if p_environment not in ('acceptance', 'production') then
    raise exception 'invalid backup environment' using errcode = '22023';
  end if;
  select environment into v_existing from app.backup_environment where singleton for update;
  if v_existing is not null then
    if v_existing <> p_environment then
      raise exception 'backup environment is already initialized as %', v_existing using errcode = '55000';
    end if;
    return v_existing; -- idempotent
  end if;
  insert into app.backup_environment (singleton, environment, initialized_by) values (true, p_environment, p_actor);
  perform app.record_audit_event('backup.environment_initialized', 'backup_environment', null, null,
    jsonb_build_object('environment', p_environment));
  return p_environment;
end;
$$;
revoke all on function public.admin_backup_initialize(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_backup_initialize(uuid, text) to service_role;
comment on function public.admin_backup_initialize(uuid, text) is
  'Service role only. Records the one environment this database serves (acceptance|production). Idempotent; a different value is refused.';

-- ---------------------------------------------------------------------------
-- 6. Read model (the page's only database call)
-- ---------------------------------------------------------------------------
create function public.admin_backup_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_env      text;
  v_settings app.backup_settings;
  v_runs     jsonb;
  v_latest   jsonb;
begin
  perform app.admin_require('backup.view');
  select environment into v_env from app.backup_environment where singleton;
  select * into v_settings from app.backup_settings where singleton;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'trigger', r.trigger, 'status', r.status,
           'requested_by', r.requested_by, 'reason', r.reason,
           'github_run_id', r.github_run_id, 'github_run_url', r.github_run_url,
           'github_conclusion', r.github_conclusion, 'summary', r.summary, 'error_code', r.error_code,
           'requested_at', r.requested_at, 'dispatched_at', r.dispatched_at, 'started_at', r.started_at,
           'finished_at', r.finished_at, 'reported_at', r.reported_at)
         order by r.requested_at desc), '[]'::jsonb)
    into v_runs
    from (select * from app.backup_runs where environment = v_env order by requested_at desc limit 25) r;

  select jsonb_build_object(
           'backup', (select jsonb_build_object('at', r.finished_at, 'id', r.id, 'github_run_id', r.github_run_id)
                        from app.backup_runs r
                       where r.environment = v_env and r.kind = 'backup' and r.status = 'succeeded'
                       order by r.finished_at desc limit 1),
           'restore_test', (select jsonb_build_object('at', r.finished_at, 'id', r.id, 'github_run_id', r.github_run_id)
                        from app.backup_runs r
                       where r.environment = v_env and r.kind = 'restore_test' and r.status = 'succeeded'
                       order by r.finished_at desc limit 1),
           'last_failure', (select jsonb_build_object('at', r.finished_at, 'id', r.id, 'kind', r.kind, 'code', r.error_code)
                        from app.backup_runs r
                       where r.environment = v_env and r.status in ('failed', 'unknown')
                       order by r.finished_at desc limit 1))
    into v_latest;

  return jsonb_build_object(
    'initialized', v_env is not null,
    'environment', v_env,
    'settings', jsonb_build_object(
      'acceptance_schedule', v_settings.acceptance_schedule,
      'production_enabled', v_settings.production_enabled,
      'production_restore_schedule_enabled', v_settings.production_restore_schedule_enabled,
      'schedule_time', v_settings.schedule_time,
      'schedule_weekday', v_settings.schedule_weekday,
      'paused_until', v_settings.paused_until,
      'version', v_settings.version,
      'updated_at', v_settings.updated_at,
      'updated_by', v_settings.updated_by),
    'latest', v_latest,
    'runs', v_runs);
end;
$$;
revoke all on function public.admin_backup_status() from public, anon;
grant execute on function public.admin_backup_status() to authenticated;
comment on function public.admin_backup_status() is
  'Admin read model for /admin/backups. Requires backup.view; returns the environment, schedule, latest outcomes and the last 25 runs.';

-- ---------------------------------------------------------------------------
-- 7. Mutations (service role only; the server passes the verified actor)
-- ---------------------------------------------------------------------------
create function public.admin_backup_request(p_actor uuid, p_kind text, p_reason text, p_receipt uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env     text := app.backup_environment_value();
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_settings app.backup_settings;
  v_id      uuid;
begin
  if p_kind not in ('backup', 'restore_test') then
    raise exception 'invalid backup kind' using errcode = '22023';
  end if;
  perform app.backup_actor(p_actor, case when p_kind = 'backup' then 'backup.execute' else 'backup.restore_test' end);
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023';
  end if;
  select * into v_settings from app.backup_settings where singleton;
  -- Production stays fail-closed until its separate activation.
  if v_env = 'production' and not v_settings.production_enabled then
    raise exception 'Production backups are not activated' using errcode = '55000';
  end if;
  perform app.backup_require_reauth(p_actor, p_receipt, case when p_kind = 'backup' then 'backup.execute' else 'backup.restore_test' end);

  insert into app.backup_runs (environment, kind, trigger, status, requested_by, reason)
  values (v_env, p_kind, 'manual', 'requested', p_actor, v_reason)
  returning id into v_id;
  perform app.backup_run_event(v_id, 'requested', jsonb_build_object('actor', p_actor, 'kind', p_kind));
  perform app.record_audit_event('backup.run_requested', 'backup_run', v_id, null,
    jsonb_build_object('environment', v_env, 'kind', p_kind, 'trigger', 'manual', 'reason', v_reason));
  return jsonb_build_object('id', v_id, 'environment', v_env, 'kind', p_kind, 'trigger', 'manual');
end;
$$;
revoke all on function public.admin_backup_request(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_backup_request(uuid, text, text, uuid) to service_role;

create function public.admin_backup_mark_dispatched(
  p_actor uuid, p_run uuid, p_ok boolean, p_github_run_id bigint default null,
  p_github_run_url text default null, p_code text default null)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run app.backup_runs;
begin
  select * into v_run from app.backup_runs where id = p_run for update;
  if not found or v_run.requested_by is distinct from p_actor then
    raise exception 'backup run not found' using errcode = '42501';
  end if;
  perform app.backup_actor(p_actor, case when v_run.kind = 'backup' then 'backup.execute' else 'backup.restore_test' end);
  if v_run.status <> 'requested' then
    return v_run.status; -- idempotent
  end if;
  if p_ok then
    if p_github_run_id is null or p_github_run_id <= 0
       or p_github_run_url is null or p_github_run_url !~ '^https://github\.com/' then
      raise exception 'invalid GitHub run reference' using errcode = '22023';
    end if;
    update app.backup_runs
       set status = 'dispatched', github_run_id = p_github_run_id, github_run_url = p_github_run_url,
           dispatched_at = clock_timestamp()
     where id = p_run;
    perform app.backup_run_event(p_run, 'dispatched', jsonb_build_object('github_run_id', p_github_run_id));
    perform app.record_audit_event('backup.run_dispatched', 'backup_run', p_run, null,
      jsonb_build_object('environment', v_run.environment, 'kind', v_run.kind, 'github_run_id', p_github_run_id));
    return 'dispatched';
  end if;
  if p_code is null or p_code !~ '^[a-z0-9_]{1,48}$' then
    raise exception 'invalid failure code' using errcode = '22023';
  end if;
  update app.backup_runs
     set status = case when p_code in ('run_not_found','dispatch_uncertain') then 'unknown' else 'failed' end,
         dispatched_at = case when p_code in ('run_not_found','dispatch_uncertain') then clock_timestamp() end,
         error_code = p_code, finished_at = clock_timestamp()
   where id = p_run;
  perform app.backup_run_event(p_run, 'dispatch_failed', jsonb_build_object('code', p_code));
  perform app.record_audit_event('backup.run_failed', 'backup_run', p_run, null,
    jsonb_build_object('environment', v_run.environment, 'kind', v_run.kind, 'code', p_code, 'stage', 'dispatch'));
  return 'failed';
end;
$$;
revoke all on function public.admin_backup_mark_dispatched(uuid, uuid, boolean, bigint, text, text) from public, anon, authenticated;
grant execute on function public.admin_backup_mark_dispatched(uuid, uuid, boolean, bigint, text, text) to service_role;

-- The private workflow's report. A scheduled run has no app-requested row, so it is created here; a manual run is updated.
-- A report can record progress or a definite failure, but it can NEVER mark a run succeeded: that is the server's
-- cross-check of the GitHub run AND its data-moving job (admin_backup_reconcile). A reported "succeeded" is therefore
-- stored as `running` until the server verifies it.
create function public.backup_report_run(
  p_environment text, p_kind text, p_github_run_id bigint, p_status text,
  p_conclusion text default null, p_summary jsonb default '{}'::jsonb, p_code text default null,
  p_request_id uuid default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env  text := app.backup_environment_value();
  v_run  app.backup_runs;
  v_id   uuid;
  v_status text := p_status;
  v_terminal boolean := v_status in ('succeeded', 'failed', 'skipped', 'unknown');
begin
  if p_environment is distinct from v_env then
    raise exception 'environment mismatch' using errcode = '42501';
  end if;
  if p_kind not in ('backup', 'restore_test') or p_status not in ('running', 'succeeded', 'failed', 'skipped', 'unknown') then
    raise exception 'invalid backup report' using errcode = '22023';
  end if;
  if p_github_run_id is null or p_github_run_id <= 0 then
    raise exception 'invalid GitHub run id' using errcode = '22023';
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'summary must be a JSON object' using errcode = '22023';
  end if;
  if p_code is not null and p_code !~ '^[a-z0-9_]{1,48}$' then
    raise exception 'invalid code' using errcode = '22023';
  end if;

  -- The trusted completion worker verifies GitHub job and coverage evidence.
  -- This RPC is never executable by a browser/user JWT.
  if p_status = 'succeeded' and (p_conclusion is distinct from 'success' or p_summary->>'coverage_verified' is distinct from 'true') then
    raise exception 'verified coverage required' using errcode = '42501';
  end if;
  select * into v_run from app.backup_runs where environment = v_env
    and (github_run_id = p_github_run_id or (p_request_id is not null and id = p_request_id)) for update;
  if p_request_id is not null and not found then
    raise exception 'request not found in this environment' using errcode = '42501';
  end if;
  if not found then
    insert into app.backup_runs (environment, kind, trigger, status, reason, github_run_id, summary, error_code,
                                 dispatched_at, started_at, finished_at, reported_at)
    values (v_env, p_kind, 'schedule', v_status, 'Scheduled run reported by GitHub.', p_github_run_id,
            p_summary, p_code, clock_timestamp(), case when v_status <> 'requested' then clock_timestamp() end,
            case when v_terminal then clock_timestamp() end, clock_timestamp())
    returning * into v_run;
  else
    if v_run.github_run_id is not null and v_run.github_run_id <> p_github_run_id then
      raise exception 'request already dispatched' using errcode = '42501';
    end if;
    if v_run.kind is distinct from p_kind then
      raise exception 'run kind mismatch' using errcode = '42501';
    end if;
    if v_run.status in ('succeeded','failed','skipped') then return v_run.id; end if;
    update app.backup_runs
       set status = v_status,
           github_run_id = p_github_run_id,
           dispatched_at = coalesce(dispatched_at, clock_timestamp()),
           github_conclusion = p_conclusion,
           summary = p_summary,
           error_code = p_code,
           started_at = coalesce(started_at, clock_timestamp()),
           finished_at = case when v_terminal then coalesce(finished_at, clock_timestamp()) else null end,
           reported_at = clock_timestamp()
     where id = v_run.id
     returning * into v_run;
  end if;
  v_id := v_run.id;
  perform app.backup_run_event(v_id, 'reported', jsonb_build_object('reported_status', p_status, 'stored_status', v_status, 'conclusion', p_conclusion, 'code', p_code));
  return v_id;
end;
$$;
revoke all on function public.backup_report_run(text, text, bigint, text, text, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.backup_report_run(text, text, bigint, text, text, jsonb, text, uuid) to service_role;
comment on function public.backup_report_run(text, text, bigint, text, text, jsonb, text, uuid) is
  'Trusted runner only. Claims work before data movement and settles after the completion worker checks the exact environment job and coverage step in GitHub. Browser access denied.';

-- The server's cross-check after reading the GitHub run AND its backup/restore job. Only this can confirm success.
create function public.admin_backup_reconcile(
  p_actor uuid, p_run uuid, p_status text, p_conclusion text, p_summary jsonb,
  p_github_run_id bigint, p_github_run_url text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run app.backup_runs;
  v_terminal boolean := p_status in ('succeeded', 'failed', 'skipped', 'unknown');
begin
  perform app.backup_actor(p_actor, 'backup.view');
  select * into v_run from app.backup_runs where id = p_run for update;
  if not found or v_run.environment is distinct from app.backup_environment_value() then
    raise exception 'backup run not found' using errcode = '42501';
  end if;
  if p_status not in ('running', 'succeeded', 'failed', 'skipped', 'unknown') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    raise exception 'summary must be a JSON object' using errcode = '22023';
  end if;
  if v_run.github_run_id is not null and p_github_run_id is distinct from v_run.github_run_id then
    raise exception 'GitHub run does not match this record' using errcode = '42501';
  end if;
  update app.backup_runs
     set status = p_status,
         github_conclusion = p_conclusion,
         summary = p_summary,
         github_run_id = coalesce(github_run_id, p_github_run_id),
         github_run_url = coalesce(github_run_url, p_github_run_url),
         started_at = coalesce(started_at, clock_timestamp()),
         finished_at = case when v_terminal then coalesce(finished_at, clock_timestamp()) else null end,
         reported_at = clock_timestamp()
   where id = p_run;
  perform app.backup_run_event(p_run, 'verified', jsonb_build_object('status', p_status, 'conclusion', p_conclusion));
  if p_status in ('failed', 'unknown') then
    perform app.record_audit_event('backup.run_failed', 'backup_run', p_run, null,
      jsonb_build_object('environment', v_run.environment, 'kind', v_run.kind, 'code', v_run.error_code, 'stage', 'verify'));
  else
    perform app.record_audit_event('backup.run_verified', 'backup_run', p_run, null,
      jsonb_build_object('environment', v_run.environment, 'kind', v_run.kind, 'status', p_status, 'conclusion', p_conclusion));
  end if;
  return p_status;
end;
$$;
revoke all on function public.admin_backup_reconcile(uuid, uuid, text, text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.admin_backup_reconcile(uuid, uuid, text, text, jsonb, bigint, text) to service_role;

create function public.admin_backup_update_schedule(
  p_actor uuid, p_acceptance_schedule text, p_production_restore_schedule_enabled boolean,
  p_expected_version integer, p_reason text, p_receipt uuid, p_config jsonb default '{}'::jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env      text := app.backup_environment_value();
  v_settings app.backup_settings;
  v_reason   text := btrim(coalesce(p_reason, ''));
begin
  perform app.backup_actor(p_actor, 'backup.schedule_manage');
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023';
  end if;
  select * into v_settings from app.backup_settings where singleton for update;
  if p_expected_version is distinct from v_settings.version then
    raise exception 'backup settings changed; reload and retry' using errcode = 'VC001';
  end if;
  if not app.backup_settings_valid(p_acceptance_schedule, p_production_restore_schedule_enabled, v_settings.production_enabled) then
    raise exception 'invalid schedule settings' using errcode = '22023';
  end if;
  if p_config->>'time' is null or p_config->>'time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce((p_config->>'weekday')::integer, -1) not between 0 and 6
     or coalesce((p_config->>'pause_hours')::integer, -1) not between 0 and 168 then
    raise exception 'invalid schedule settings' using errcode = '22023';
  end if;
  if v_env = 'production' and p_config->>'confirmation' is distinct from 'change production schedule' then
    raise exception 'type production confirmation' using errcode = '22023';
  end if;
  perform app.backup_require_reauth(p_actor, p_receipt, 'backup.schedule_manage');
  update app.backup_settings
     set acceptance_schedule = p_acceptance_schedule,
         schedule_time = (p_config->>'time')::time,
         schedule_weekday = (p_config->>'weekday')::integer,
         paused_until = case when (p_config->>'pause_hours')::integer > 0
           then clock_timestamp() + make_interval(hours => (p_config->>'pause_hours')::integer) end,
         production_restore_schedule_enabled = p_production_restore_schedule_enabled,
         version = version + 1,
         updated_by = p_actor,
         updated_at = clock_timestamp()
   where singleton;
  perform app.record_audit_event('backup.settings_changed', 'backup_settings', null, null,
    jsonb_build_object('environment', v_env, 'acceptance_schedule', p_acceptance_schedule,
                       'production_restore_schedule_enabled', p_production_restore_schedule_enabled,
                       'version', v_settings.version + 1, 'reason', v_reason, 'schedule', p_config - 'confirmation'));
  return v_settings.version + 1;
end;
$$;
revoke all on function public.admin_backup_update_schedule(uuid, text, boolean, integer, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.admin_backup_update_schedule(uuid, text, boolean, integer, text, uuid, jsonb) to service_role;

create function public.admin_backup_activate(
  p_actor uuid, p_enabled boolean, p_confirmation text, p_reason text, p_receipt uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env      text := app.backup_environment_value();
  v_settings app.backup_settings;
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_expected text;
begin
  perform app.backup_actor(p_actor, 'backup.schedule_manage');
  if v_env <> 'production' then
    raise exception 'only Production has an activation switch' using errcode = '22023';
  end if;
  if char_length(v_reason) not between 10 and 500 then
    raise exception 'a reason of 10 to 500 characters is required' using errcode = '22023';
  end if;
  v_expected := case when p_enabled then 'activate production backups' else 'deactivate production backups' end;
  if p_confirmation is distinct from v_expected then
    raise exception 'type "%" to confirm', v_expected using errcode = '22023';
  end if;
  perform app.backup_require_reauth(p_actor, p_receipt, 'backup.schedule_manage');
  select * into v_settings from app.backup_settings where singleton for update;
  update app.backup_settings
     set production_enabled = p_enabled,
         production_restore_schedule_enabled = case when p_enabled then production_restore_schedule_enabled else false end,
         version = version + 1,
         updated_by = p_actor,
         updated_at = clock_timestamp()
   where singleton;
  perform app.record_audit_event(
    case when p_enabled then 'backup.production_activated' else 'backup.production_deactivated' end,
    'backup_settings', null, null,
    jsonb_build_object('environment', v_env, 'enabled', p_enabled, 'version', v_settings.version + 1, 'reason', v_reason));
  return p_enabled;
end;
$$;
revoke all on function public.admin_backup_activate(uuid, boolean, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_backup_activate(uuid, boolean, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The workflow's read path (no browser access)
-- ---------------------------------------------------------------------------
create function public.backup_schedule_read()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_env text;
  v app.backup_settings;
begin
  select environment into v_env from app.backup_environment where singleton;
  select * into v from app.backup_settings where singleton;
  return jsonb_build_object(
    'initialized', v_env is not null,
    'environment', v_env,
    'acceptance_schedule', v.acceptance_schedule,
    'production_enabled', v.production_enabled,
    'production_restore_schedule_enabled', v.production_restore_schedule_enabled,
    'schedule_time', v.schedule_time,
    'schedule_weekday', v.schedule_weekday,
    'paused_until', v.paused_until,
    'version', v.version);
end;
$$;
revoke all on function public.backup_schedule_read() from public, anon, authenticated;
grant execute on function public.backup_schedule_read() to service_role;
comment on function public.backup_schedule_read() is
  'Read-only schedule for the private GitHub workflow. No browser role can execute it; the workflow reads it over its read-only database connection.';

-- ---------------------------------------------------------------------------
-- 9. Current-password receipts for the three sensitive backup operations
-- ---------------------------------------------------------------------------
create or replace function app.reauth_target_normalize(p_operation text, p_target text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_operation in ('secondary_phone.reserve', 'secondary_phone.change', 'secondary_phone.convert', 'primary_phone.change') then
    return app.require_canonical_phone(p_target);
  elsif p_operation = 'contact_email.set' then
    if p_target is null or p_target <> lower(btrim(p_target)) or char_length(p_target) > 254
       or p_target !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       or right(p_target, 32) = '@craftsman-login.aladdin.invalid' then
      raise exception 'invalid email address' using errcode = '22023';
    end if;
    return p_target;
  elsif p_operation in ('password.change', 'contact_email.remove') then
    if p_target is distinct from 'self' then
      raise exception 'this operation takes no target' using errcode = '22023';
    end if;
    return p_target;
  elsif p_operation in ('backup.execute', 'backup.restore_test', 'backup.schedule_manage') then
    if p_target is distinct from 'acceptance' and p_target is distinct from 'production' then
      raise exception 'invalid backup environment' using errcode = '22023';
    end if;
    return p_target;
  end if;
  raise exception 'unsupported operation' using errcode = '22023';
end;
$$;
revoke all on function app.reauth_target_normalize(text, text) from public, anon, authenticated, service_role;

comment on function public.account_password_confirm(text, text, text) is
  'Checks the caller''s CURRENT password against their own Auth hash and returns {ok, receipt} (single-use, 60 s, bound to user + operation + target) or {ok:false, reason: wrong_password|locked|no_password}. Operations: secondary_phone.reserve|change|convert and primary_phone.change (target = canonical E.164), contact_email.set (target = lower-case address), password.change and contact_email.remove (target = ''self''), backup.execute|restore_test|schedule_manage (target = acceptance|production). ONE budget per account across every operation: 5 wrong passwords in 15 minutes lock confirmation for 15 minutes. Returns a status instead of raising so a failure is always counted.';

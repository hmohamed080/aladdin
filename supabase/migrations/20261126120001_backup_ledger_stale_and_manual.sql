-- Backup run ledger: two faults seen on Production on 2026-11-23 and 2026-11-24.
--
-- 1. A run that never settles keeps the one-pending slot (uq_backup_run_pending) for ever. Every later claim is
--    refused, no backup runs, and a refused claim leaves no ledger row, so the console shows nothing. A data job
--    is limited to 60 minutes, so a run still pending six hours after it was claimed is closed as
--    `failed` / `stale_unverified`. A verified result that arrives later still replaces that mark.
-- 2. A run started by hand on GitHub (no console request) was recorded as scheduled. The runner now sends the
--    GitHub event in the report summary; without it the earlier label is kept.
--
-- EXPAND only: no signature changes, so the runner and the console work before and after this migration.
-- Existing rows are not rewritten.

create function app.backup_expire_stale(p_environment text, p_keep_github_run_id bigint default null, p_keep_run uuid default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_count integer := 0;
begin
  for v_id in
    update app.backup_runs
       set status = 'failed', error_code = 'stale_unverified', finished_at = clock_timestamp()
     where environment = p_environment
       and status in ('requested', 'dispatched', 'running', 'unknown')
       and requested_at < clock_timestamp() - interval '6 hours'
       -- never the run that is reporting right now
       and (p_keep_github_run_id is null or github_run_id is distinct from p_keep_github_run_id)
       and (p_keep_run is null or id <> p_keep_run)
    returning id
  loop
    perform app.backup_run_event(v_id, 'expired', jsonb_build_object('after_hours', 6));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function app.backup_expire_stale(text, bigint, uuid) from public, anon, authenticated, service_role;

create or replace function public.admin_backup_request(p_actor uuid, p_kind text, p_reason text, p_receipt uuid)
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
  perform app.backup_expire_stale(v_env);

  insert into app.backup_runs (environment, kind, trigger, status, requested_by, reason)
  values (v_env, p_kind, 'manual', 'requested', p_actor, v_reason)
  returning id into v_id;
  perform app.backup_run_event(v_id, 'requested', jsonb_build_object('actor', p_actor, 'kind', p_kind));
  perform app.record_audit_event('backup.run_requested', 'backup_run', v_id, null,
    jsonb_build_object('environment', v_env, 'kind', p_kind, 'trigger', 'manual', 'reason', v_reason));
  return jsonb_build_object('id', v_id, 'environment', v_env, 'kind', p_kind, 'trigger', 'manual');
end;
$$;

create or replace function public.backup_report_run(
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
  v_by_hand boolean := coalesce(p_summary ->> 'event', '') = 'workflow_dispatch';
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
  perform app.backup_expire_stale(v_env, p_github_run_id, p_request_id);
  select * into v_run from app.backup_runs where environment = v_env
    and (github_run_id = p_github_run_id or (p_request_id is not null and id = p_request_id)) for update;
  if p_request_id is not null and not found then
    raise exception 'request not found in this environment' using errcode = '42501';
  end if;
  if not found then
    insert into app.backup_runs (environment, kind, trigger, status, reason, github_run_id, summary, error_code,
                                 dispatched_at, started_at, finished_at, reported_at)
    values (v_env, p_kind, case when v_by_hand then 'manual' else 'schedule' end, v_status,
            case when v_by_hand then 'Run started directly on GitHub.' else 'Scheduled run reported by GitHub.' end,
            p_github_run_id, p_summary, p_code, clock_timestamp(), case when v_status <> 'requested' then clock_timestamp() end,
            case when v_terminal then clock_timestamp() end, clock_timestamp())
    returning * into v_run;
  else
    if v_run.github_run_id is not null and v_run.github_run_id <> p_github_run_id then
      raise exception 'request already dispatched' using errcode = '42501';
    end if;
    if v_run.kind is distinct from p_kind then
      raise exception 'run kind mismatch' using errcode = '42501';
    end if;
    -- A settled run does not change, except one closed only because nothing had reported for six hours.
    if v_run.status in ('succeeded','failed','skipped')
       and not (v_run.error_code is not distinct from 'stale_unverified' and v_status in ('succeeded','failed','skipped')) then
      return v_run.id;
    end if;
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

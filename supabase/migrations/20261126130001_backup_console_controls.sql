-- Backup console, phase 1 (docs/operations/BACKUP_ADMIN_CONTROL_DESIGN.md).
--
--   admin_backup_runs            run history in pages of 20; the skipped-check filter applies before paging
--   admin_backup_set_production  the Production On/Off switch: no password, phrase or reason (owner, 2026-11-26)
--   admin_backup_save_schedule   saves the schedule the same way
--
-- Both writes keep today's authority: service role only, with the verified session's actor, whose permission the
-- database re-checks, and every real change is audited with that actor.
--
-- EXPAND only: admin_backup_status, admin_backup_activate and admin_backup_update_schedule are unchanged, so the
-- console that is deployed today keeps working.

create function public.admin_backup_runs(
  p_page integer default 1, p_kind text default null, p_status text default null, p_include_skipped boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_size    constant integer := 20;
  v_env     text;
  v_total   integer;
  v_skipped integer;
  v_page    integer;
  v_runs    jsonb;
  -- asking for the skipped checks by status shows them
  v_with_skipped boolean := coalesce(p_include_skipped, false) or p_status is not distinct from 'skipped';
begin
  perform app.admin_require('backup.view');
  if p_kind is not null and p_kind not in ('backup', 'restore_test') then
    raise exception 'invalid backup kind' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('requested', 'dispatched', 'running', 'succeeded', 'failed', 'skipped', 'unknown') then
    raise exception 'invalid backup status' using errcode = '22023';
  end if;
  select environment into v_env from app.backup_environment where singleton;

  select count(*) filter (where (p_status is null or r.status = p_status) and (v_with_skipped or r.status <> 'skipped')),
         count(*) filter (where r.status = 'skipped')
    into v_total, v_skipped
    from app.backup_runs r
   where r.environment = v_env and (p_kind is null or r.kind = p_kind);

  -- a page outside the history is the nearest real one, never an empty table that looks like lost history
  v_page := least(greatest(coalesce(p_page, 1), 1), greatest((v_total + c_size - 1) / c_size, 1));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'trigger', r.trigger, 'status', r.status,
           'requested_by', r.requested_by, 'reason', r.reason,
           'github_run_id', r.github_run_id, 'github_run_url', r.github_run_url,
           'github_conclusion', r.github_conclusion, 'summary', r.summary, 'error_code', r.error_code,
           'requested_at', r.requested_at, 'dispatched_at', r.dispatched_at, 'started_at', r.started_at,
           'finished_at', r.finished_at, 'reported_at', r.reported_at)
         order by r.requested_at desc, r.id desc), '[]'::jsonb)
    into v_runs
    from (select * from app.backup_runs b
           where b.environment = v_env
             and (p_kind is null or b.kind = p_kind)
             and (p_status is null or b.status = p_status)
             and (v_with_skipped or b.status <> 'skipped')
           order by b.requested_at desc, b.id desc
           limit c_size offset (v_page - 1) * c_size) r;

  return jsonb_build_object('runs', v_runs, 'total', v_total, 'page', v_page, 'page_size', c_size, 'skipped_total', v_skipped);
end;
$$;
revoke all on function public.admin_backup_runs(integer, text, text, boolean) from public, anon;
grant execute on function public.admin_backup_runs(integer, text, text, boolean) to authenticated;
comment on function public.admin_backup_runs(integer, text, text, boolean) is
  'Admin run history for /admin/backups, 20 per page, newest first. Requires backup.view.';

create function public.admin_backup_set_production(p_actor uuid, p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env      text := app.backup_environment_value();
  v_settings app.backup_settings;
begin
  perform app.backup_actor(p_actor, 'backup.schedule_manage');
  if v_env <> 'production' then
    raise exception 'only Production has an activation switch' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'say on or off' using errcode = '22023';
  end if;
  select * into v_settings from app.backup_settings where singleton for update;
  -- a double click or a second administrator asking for the same state changes and audits nothing
  if v_settings.production_enabled = p_enabled then
    return p_enabled;
  end if;
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
    jsonb_build_object('environment', v_env, 'enabled', p_enabled, 'version', v_settings.version + 1));
  return p_enabled;
end;
$$;
revoke all on function public.admin_backup_set_production(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_backup_set_production(uuid, boolean) to service_role;

create function public.admin_backup_save_schedule(
  p_actor uuid, p_acceptance_schedule text, p_production_restore_schedule_enabled boolean,
  p_expected_version integer, p_config jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_env      text := app.backup_environment_value();
  v_settings app.backup_settings;
begin
  perform app.backup_actor(p_actor, 'backup.schedule_manage');
  select * into v_settings from app.backup_settings where singleton for update;
  if p_expected_version is distinct from v_settings.version then
    raise exception 'backup settings changed; reload and retry' using errcode = 'VC001';
  end if;
  if not app.backup_settings_valid(p_acceptance_schedule, p_production_restore_schedule_enabled, v_settings.production_enabled) then
    raise exception 'invalid schedule settings' using errcode = '22023';
  end if;
  -- the patterns are checked before any cast, so a wrong value is a plain refusal
  if coalesce(p_config ->> 'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or coalesce(p_config ->> 'weekday', '') !~ '^[0-6]$'
     or coalesce(p_config ->> 'pause_hours', '') !~ '^[0-9]{1,3}$' then
    raise exception 'invalid schedule settings' using errcode = '22023';
  end if;
  if (p_config ->> 'pause_hours')::integer > 168 then
    raise exception 'invalid schedule settings' using errcode = '22023';
  end if;
  update app.backup_settings
     set acceptance_schedule = p_acceptance_schedule,
         schedule_time = (p_config ->> 'time')::time,
         schedule_weekday = (p_config ->> 'weekday')::integer,
         paused_until = case when (p_config ->> 'pause_hours')::integer > 0
           then clock_timestamp() + make_interval(hours => (p_config ->> 'pause_hours')::integer) end,
         production_restore_schedule_enabled = p_production_restore_schedule_enabled,
         version = version + 1,
         updated_by = p_actor,
         updated_at = clock_timestamp()
   where singleton;
  perform app.record_audit_event('backup.settings_changed', 'backup_settings', null, null,
    jsonb_build_object('environment', v_env, 'acceptance_schedule', p_acceptance_schedule,
      'production_restore_schedule_enabled', p_production_restore_schedule_enabled,
      'version', v_settings.version + 1,
      'schedule', jsonb_build_object('time', p_config ->> 'time', 'weekday', p_config ->> 'weekday', 'pause_hours', p_config ->> 'pause_hours'),
      'previous', jsonb_build_object('acceptance_schedule', v_settings.acceptance_schedule, 'time', v_settings.schedule_time,
        'weekday', v_settings.schedule_weekday, 'paused_until', v_settings.paused_until,
        'production_restore_schedule_enabled', v_settings.production_restore_schedule_enabled)));
  return v_settings.version + 1;
end;
$$;
revoke all on function public.admin_backup_save_schedule(uuid, text, boolean, integer, jsonb) from public, anon, authenticated;
grant execute on function public.admin_backup_save_schedule(uuid, text, boolean, integer, jsonb) to service_role;

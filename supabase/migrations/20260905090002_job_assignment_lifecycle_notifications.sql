-- ===========================================================================
-- Installer Pilot Increment 9 — telling the other party the work moved
--
-- Foundation: 20260822090001_notifications_core.sql (app.notify),
--             20260823090003_message_sent_no_owner_fallback.sql (app.notify_org),
--             20260902090001_jobs_domain.sql (the lifecycle RPCs).
--
-- Increment 9 is the first point at which the two parties to an engagement have
-- to act in turn. The installer reports readiness and the POSTER confirms it;
-- either may end the engagement. Without a notice, each step is discovered by
-- the other side reopening a page and noticing a number changed — and the one
-- that matters most, completion, is the one the installer cannot cause and
-- therefore cannot predict.
--
-- Three events, and each one is `create or replace` on an existing RPC with a
-- notify beside the write it already performed. No new helper, no fan-out
-- mechanism, no realtime, no chat. The constraint gains three names.
--
-- ---------------------------------------------------------------------------
-- WHY THE ORGANIZATION RECIPIENT IS NOT AMBIGUOUS HERE
--
-- Increment 8 RESERVED `job.application.submitted` -> the poster, because the
-- Jobs domain had two equally plausible capabilities for it: `job.post`
-- (whoever authored the opening) and `job.manage` (whoever decides its
-- applications), with nothing choosing between them.
--
-- That coin flip does not exist on this side, and the reason is structural
-- rather than editorial: `job.post` has NO role anywhere in the assignment
-- lifecycle. `app.can_post_job` is consulted by job_create, job_update,
-- job_publish, job_close and job_cancel — and by none of the four assignment
-- RPCs. Every action a recipient could take in response to these notices —
-- confirming completion, ending the engagement, re-awarding the reopened job —
-- requires `job.manage` and refuses `job.post`. So the capability is not chosen,
-- it is READ OFF the action the notice is asking someone to take, and a notice
-- delivered to anyone else would be a notice its reader is refused permission to
-- act on. The owner fallback stays on: an organization with no job.manage holder
-- still has an owner who can act, and a valid notice is never silently dropped.
--
-- The installer recipients need no such argument. Every one is named by
-- `job_assignments.installer_user_id` — one column, one person, no set.
-- ---------------------------------------------------------------------------
--
-- WHAT IS DELIBERATELY NOT WIRED: every individual progress report. A notice per
-- update would make the useful ones unfindable, and progress is a thing the
-- poster goes and looks at. Only the TRANSITION to 100 is announced, because
-- that is the only progress value that hands the next move to somebody else.
--
-- Signatures, authorization, lock order, error codes, idempotency, version
-- arithmetic, audit events, definer settings and grants are all unchanged. Read
-- each diff as: one declare line, one notify.
-- ===========================================================================

alter table public.notifications
  drop constraint ck_notifications_event_type_known;

alter table public.notifications
  add constraint ck_notifications_event_type_known check (event_type in (
    'rfq.submitted', 'rfq.cancelled',
    'quotation.submitted', 'quotation.accepted', 'quotation.rejected',
    'order.created', 'order.started', 'order.completed', 'order.cancelled',
    'project.created', 'project.activated', 'project.completed',
    'verification.approved', 'verification.rejected', 'verification.changes_requested',
    'message.sent',
    'job.application.accepted', 'job.application.rejected',
    'job.assignment.ready', 'job.assignment.completed', 'job.assignment.cancelled'
  ));

-- ===========================================================================
-- 1. job_progress_add — announce the TRANSITION to 100, and nothing else
--
-- The status does not move and this migration does not make it move. Reaching
-- 100 remains a CLAIM (§3.5): the assignment stays `in_progress` until the
-- posting organization confirms. All that is added is that the organization
-- finds out the claim was made.
-- ===========================================================================
create or replace function public.job_progress_add(
  p_assignment_id   uuid,
  p_progress_percent smallint,
  p_stage           text default null,
  p_note            text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_a   public.job_assignments;
  v_id  uuid;
  -- Added by this migration.
  v_job_title text;
begin
  select * into v_a from public.job_assignments where id = p_assignment_id for update;
  if not found then raise exception 'assignment not found' using errcode = '22023'; end if;
  if v_a.installer_user_id <> v_uid then
    raise exception 'only the assigned installer may report progress' using errcode = '42501';
  end if;
  if v_a.status <> 'in_progress' then
    raise exception 'progress can only be reported on work in progress' using errcode = '22023';
  end if;
  if p_progress_percent is null or p_progress_percent < 0 or p_progress_percent > 100 then
    raise exception 'progress must be between 0 and 100' using errcode = '22023';
  end if;

  insert into public.job_progress_updates (
    assignment_id, author_user_id, progress_percent, stage, note)
  values (
    p_assignment_id, v_uid, p_progress_percent,
    nullif(btrim(coalesce(p_stage, '')), ''), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  -- Denormalised in the SAME transaction, so the summary can never disagree
  -- with the history it summarises.
  update public.job_assignments set
    latest_progress_percent = p_progress_percent, last_progress_at = now()
  where id = p_assignment_id;

  perform app.record_audit_event('job.assignment.progress_updated', 'job_assignment',
    p_assignment_id, v_a.poster_org_id,
    jsonb_build_object('job_id', v_a.job_id, 'progress_percent', p_progress_percent));

  -- A TRANSITION, not a value. `v_a` was read before the update, so
  -- `v_a.latest_progress_percent` is the PREVIOUS figure: an installer who
  -- reports 100 twice — correcting a note, adding a stage — announces it once.
  if p_progress_percent = 100 and v_a.latest_progress_percent <> 100 then
    select title into v_job_title from public.jobs where id = v_a.job_id;
    perform app.notify_org(
      v_a.poster_org_id, 'job.manage',
      'job.assignment.ready', 'job_assignment', p_assignment_id,
      '/b2b/jobs/' || v_a.job_id::text,
      'notifications.job.assignment.ready.title',
      'notifications.job.assignment.ready.body',
      jsonb_build_object('job_title', v_job_title));
  end if;

  return v_id;
end;
$$;

-- ===========================================================================
-- 2. job_assignment_complete — the one move the installer cannot make
--
-- Which is exactly why it is the most important notice in this file: it is the
-- only lifecycle event whose subject learns nothing by looking at their own
-- actions. The recipient is a single named column.
-- ===========================================================================
create or replace function public.job_assignment_complete(
  p_assignment_id uuid, p_expected_version integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_a   public.job_assignments;
  v_jid uuid;
  -- Added by this migration.
  v_job_title text;
  v_org_name  text;
begin
  perform app.require_verified_caller();
  -- jobs first, then the assignment (see job_application_accept).
  select job_id into v_jid from public.job_assignments where id = p_assignment_id;
  if v_jid is null then raise exception 'assignment not found' using errcode = '22023'; end if;
  perform 1 from public.jobs where id = v_jid for update;
  select * into v_a from public.job_assignments where id = p_assignment_id for update;
  if not app.is_org_member(v_a.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_manage_job(v_a.poster_org_id) then
    raise exception 'job.manage required' using errcode = '42501';
  end if;
  if v_a.status <> 'in_progress' then
    raise exception 'a % assignment cannot be completed', v_a.status using errcode = '22023';
  end if;
  if v_a.version <> p_expected_version then
    raise exception 'assignment was modified concurrently' using errcode = '40001';
  end if;

  update public.job_assignments
    set status = 'completed', completed_at = now(), version = version + 1
  where id = p_assignment_id;

  -- The job follows its assignment. awarded -> completed is a side effect and
  -- is never set directly.
  update public.jobs
    set status = 'completed', closed_at = now(), version = version + 1
  where id = v_a.job_id;

  perform app.record_audit_event('job.assignment.completed', 'job_assignment',
    p_assignment_id, v_a.poster_org_id, jsonb_build_object('job_id', v_a.job_id));

  select title into v_job_title from public.jobs where id = v_a.job_id;
  v_org_name := app.org_display_name(v_a.poster_org_id);

  perform app.notify(
    v_a.installer_user_id, v_a.poster_org_id,
    'job.assignment.completed', 'job_assignment', p_assignment_id,
    '/home/work/' || p_assignment_id::text,
    'notifications.job.assignment.completed.title',
    'notifications.job.assignment.completed.body',
    jsonb_build_object('job_title', v_job_title, 'org_name', v_org_name));

  return v_a.version + 1;
end;
$$;

-- ===========================================================================
-- 3. job_assignment_cancel — whichever party did NOT do it
--
-- Both directions are legitimate under Increment 6, which admits either party,
-- so the recipient is decided by who called. `app.notify` already suppresses a
-- self-notification, but the branch is explicit here anyway: notifying the org
-- when the org cancelled would be writing a row for the whole `job.manage` set
-- about their colleague's own action.
--
-- The reason IS carried as a param, unlike the application-rejection notice. It
-- is at most 500 characters, the other party has no other route to it until they
-- open the record, and an engagement ending without a stated cause is the case
-- this domain most needs to avoid.
-- ===========================================================================
create or replace function public.job_assignment_cancel(
  p_assignment_id uuid, p_expected_version integer, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_a      public.job_assignments;
  v_j      public.jobs;
  v_jid    uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'a reason is required to cancel an assignment' using errcode = '22023';
  end if;
  -- Same lock order as job_cancel — jobs first, then the assignment — so the
  -- two cancel paths cannot deadlock against each other.
  select job_id into v_jid from public.job_assignments where id = p_assignment_id;
  if v_jid is null then raise exception 'assignment not found' using errcode = '22023'; end if;
  select * into v_j from public.jobs where id = v_jid for update;
  select * into v_a from public.job_assignments where id = p_assignment_id for update;

  if not (
    v_a.installer_user_id = v_uid
    or (app.is_org_member(v_a.poster_org_id) and app.can_manage_job(v_a.poster_org_id))
  ) then
    raise exception 'only a party to this assignment may cancel it' using errcode = '42501';
  end if;
  if v_a.status not in ('scheduled', 'in_progress') then
    raise exception 'a % assignment cannot be cancelled', v_a.status using errcode = '22023';
  end if;
  if v_a.version <> p_expected_version then
    raise exception 'assignment was modified concurrently' using errcode = '40001';
  end if;

  update public.job_assignments set
    status = 'cancelled', cancelled_at = now(), cancellation_reason = v_reason,
    version = version + 1
  where id = p_assignment_id;

  -- The opening returns to the pool. Only from `awarded`: if the job was
  -- itself cancelled, job_cancel already handled the assignment and there is
  -- nothing to reopen.
  if v_j.status = 'awarded' then
    update public.jobs set status = 'open', version = version + 1 where id = v_j.id;
  end if;

  perform app.record_audit_event('job.assignment.cancelled', 'job_assignment',
    p_assignment_id, v_a.poster_org_id,
    jsonb_build_object('job_id', v_a.job_id, 'reopened', v_j.status = 'awarded'));

  -- BOTH branches carry the SAME two params, and the copy uses only those two.
  -- The organization's notice cannot name the organization to itself, so a body
  -- referencing `{org_name}` would render a hole on one of the two paths — the
  -- failure `view-model.test.ts` exists to catch.
  if v_a.installer_user_id = v_uid then
    -- The installer walked away. The organization has a job back in the pool.
    perform app.notify_org(
      v_a.poster_org_id, 'job.manage',
      'job.assignment.cancelled', 'job_assignment', p_assignment_id,
      '/b2b/jobs/' || v_a.job_id::text,
      'notifications.job.assignment.cancelled.title',
      'notifications.job.assignment.cancelled.body',
      jsonb_build_object('job_title', v_j.title, 'reason', v_reason));
  else
    perform app.notify(
      v_a.installer_user_id, v_a.poster_org_id,
      'job.assignment.cancelled', 'job_assignment', p_assignment_id,
      '/home/work/' || p_assignment_id::text,
      'notifications.job.assignment.cancelled.title',
      'notifications.job.assignment.cancelled.body',
      jsonb_build_object('job_title', v_j.title, 'reason', v_reason));
  end if;

  return v_a.version + 1;
end;
$$;

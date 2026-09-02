-- ===========================================================================
-- Installer Pilot Increment 8 — telling the applicant what was decided
--
-- Foundation: 20260822090001_notifications_core.sql (table, RLS, app.notify),
--             20260902090001_jobs_domain.sql (the two decision RPCs).
--
-- Increment 8 is the first point at which a job decision has a person on the
-- other end of it who is using the product. Until now `job_application_accept`
-- and `job_application_reject` wrote audit rows — a record for us — and nothing
-- the applicant could see. An installer would have had to reopen My Applications
-- and notice the state had changed.
--
-- This migration does exactly two things:
--   1. ck_notifications_event_type_known gains 'job.application.accepted' and
--      'job.application.rejected';
--   2. the two decision RPCs are CREATE OR REPLACE'd with app.notify calls added
--      beside the existing writes, inside the same transaction.
--
-- It adds NO new fan-out mechanism, NO new helper and NO realtime. app.notify
-- already owns single-recipient delivery, payload validation and
-- self-notification suppression; none of it is modified, and neither is
-- public.notifications, its RLS, its indexes or the read-state RPCs.
--
-- WHY app.notify AND NOT app.notify_org. Every recipient here is unambiguous:
-- the exact applicant whose candidacy was decided, named by
-- job_applications.applicant_user_id. There is no fan-out, no capability lookup
-- and no owner fallback, because there is no set to choose from.
--
-- WHY THE SIBLINGS ARE NOTIFIED TOO. `job_application_accept` auto-rejects every
-- other live candidacy in the same statement. Those people were rejected as
-- surely as one rejected by hand, and each is an exact, named recipient. Telling
-- the winner and silently closing four other applications would be the partial
-- state this architecture exists to prevent — so the accept path emits one
-- 'rejected' notice per sibling, in the same loop that already knows who they
-- are, and one 'accepted' notice to the winner.
--
-- WHAT IS DELIBERATELY NOT WIRED. 'job.application.submitted' -> the posting
-- organization. app.notify_org needs a capability to deliver against, and the
-- Jobs domain has two plausible answers — `job.post` (whoever authored the
-- opening) and `job.manage` (whoever decides its applications) — with nothing in
-- the approved contract choosing between them. Guessing would install a
-- recipient rule by accident. That seam stays reserved.
--
-- TRANSACTIONAL COUPLING is the point. Each notify is an ordinary statement in
-- the same transaction as the decision, not a deferred write, and its failures
-- propagate. Either the decision, the assignment, the sibling rejections AND the
-- notices all commit, or none of them does.
--
-- Both RPCs keep their signatures, authorization, idempotency, lock order, error
-- codes, audit events, definer settings and grants. Read the diff as: one
-- declare block, one notify per decided applicant.
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
    'job.application.accepted', 'job.application.rejected'
  ));

-- ===========================================================================
-- 1. job_application_accept — reproduced verbatim, with emission added
-- ===========================================================================
create or replace function public.job_application_accept(p_application_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_a   public.job_applications;
  v_j   public.jobs;
  v_id  uuid;
  -- Added by this migration.
  v_org_name text;
  v_loser    record;
begin
  -- LOCK ORDER: jobs, then the child row. Every write path in this file takes
  -- its locks in that order, which is what makes the cancel paths unable to
  -- deadlock against each other. Reading the application unlocked first is only
  -- to learn which job to lock; it is re-read FOR UPDATE below before any
  -- decision is made on it.
  select job_id into v_id from public.job_applications where id = p_application_id;
  if v_id is null then raise exception 'application not found' using errcode = '22023'; end if;
  select * into v_j from public.jobs where id = v_id for update;
  select * into v_a from public.job_applications where id = p_application_id for update;
  v_id := null;

  if not app.is_org_member(v_j.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_manage_job(v_j.poster_org_id) then
    raise exception 'job.manage required' using errcode = '42501';
  end if;

  -- Idempotent (§12.2): accepting an already-accepted application returns the
  -- assignment it already produced, as showroom_referral_approve returns the
  -- organization it already created. It emits nothing a second time, because the
  -- decision it would announce already happened.
  if v_a.status = 'accepted' then
    select id into v_id from public.job_assignments where application_id = p_application_id;
    if v_id is not null then return v_id; end if;
  end if;

  if v_a.status <> 'submitted' then
    raise exception 'a % application cannot be accepted', v_a.status using errcode = '22023';
  end if;
  if v_j.status <> 'open' then
    raise exception 'only an open job can be awarded' using errcode = '22023';
  end if;

  update public.job_applications set
    status = 'accepted', decided_by = v_uid, decided_at = now()
  where id = p_application_id;

  -- Every sibling still in the running is closed with a system reason, and —
  -- added here — each is TOLD. The loop replaces a bare UPDATE and returns the
  -- rows it closed, so the recipients come from the write itself rather than
  -- from a second query that could disagree with it.
  v_org_name := app.org_display_name(v_j.poster_org_id);

  for v_loser in
    update public.job_applications set
      status = 'rejected', decided_by = v_uid, decided_at = now(),
      decision_reason = 'the job was awarded to another applicant'
    where job_id = v_a.job_id and id <> p_application_id and status = 'submitted'
    returning id, applicant_user_id
  loop
    perform app.notify(
      v_loser.applicant_user_id, v_j.poster_org_id,
      'job.application.rejected', 'job_application', v_loser.id,
      '/home/jobs/applications',
      'notifications.job.application.rejected.title',
      'notifications.job.application.rejected.body',
      jsonb_build_object('job_title', v_j.title, 'org_name', v_org_name));
  end loop;

  insert into public.job_assignments (
    job_id, application_id, installer_user_id, poster_org_id,
    agreed_amount, agreed_currency)
  values (
    v_a.job_id, p_application_id, v_a.applicant_user_id, v_j.poster_org_id,
    v_j.offered_amount, v_j.offered_currency)
  returning id into v_id;

  update public.jobs set status = 'awarded', version = version + 1 where id = v_a.job_id;

  perform app.record_audit_event('job.application.accepted', 'job_application',
    p_application_id, v_j.poster_org_id,
    jsonb_build_object('job_id', v_a.job_id, 'assignment_id', v_id));

  perform app.notify(
    v_a.applicant_user_id, v_j.poster_org_id,
    'job.application.accepted', 'job_application', p_application_id,
    '/home/jobs/applications',
    'notifications.job.application.accepted.title',
    'notifications.job.application.accepted.body',
    jsonb_build_object('job_title', v_j.title, 'org_name', v_org_name));

  return v_id;
end;
$$;

-- ===========================================================================
-- 2. job_application_reject — reproduced verbatim, with emission added
-- ===========================================================================
create or replace function public.job_application_reject(
  p_application_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_a      public.job_applications;
  v_j      public.jobs;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'a reason is required to reject an application' using errcode = '22023';
  end if;
  select * into v_a from public.job_applications where id = p_application_id for update;
  if not found then raise exception 'application not found' using errcode = '22023'; end if;
  select * into v_j from public.jobs where id = v_a.job_id;
  if not app.is_org_member(v_j.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_manage_job(v_j.poster_org_id) then
    raise exception 'job.manage required' using errcode = '42501';
  end if;
  if v_a.status <> 'submitted' then
    raise exception 'a % application cannot be rejected', v_a.status using errcode = '22023';
  end if;

  update public.job_applications set
    status = 'rejected', decided_by = v_uid, decided_at = now(), decision_reason = v_reason
  where id = p_application_id;

  perform app.record_audit_event('job.application.rejected', 'job_application',
    p_application_id, v_j.poster_org_id, jsonb_build_object('job_id', v_a.job_id));

  -- The reason itself is NOT a param. It is the poster's own words, up to 500
  -- characters, and a notification line is not where somebody should read a
  -- decision about themselves for the first time — the notice says a decision
  -- landed and opens the application, where the reason is shown in full.
  perform app.notify(
    v_a.applicant_user_id, v_j.poster_org_id,
    'job.application.rejected', 'job_application', p_application_id,
    '/home/jobs/applications',
    'notifications.job.application.rejected.title',
    'notifications.job.application.rejected.body',
    jsonb_build_object(
      'job_title', v_j.title,
      'org_name',  app.org_display_name(v_j.poster_org_id)));
end;
$$;

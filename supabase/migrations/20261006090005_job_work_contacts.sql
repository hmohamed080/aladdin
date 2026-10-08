-- ===========================================================================
-- Jobs — the optional WORK CONTACT of a job, and its snapshot at award
--
-- `assignment_contacts` (20261006090004) holds the contact an installer sees for
-- their assignment, but nothing populated it: the platform had no explicit
-- work/business contact. This adds the smallest clean source — a contact the
-- poster INTENTIONALLY provides for ONE job — and wires it into the award.
--
--   * public.job_work_contacts       the poster's optional contact for a job
--   * public.job_work_contact_set    the poster's write path (set / change / clear)
--   * public.job_application_accept  reproduced, with the snapshot added
--
-- WHY A TABLE BESIDE `jobs` RATHER THAN COLUMNS ON IT. `jobs` is readable by the
-- assigned installer from the moment of the award (`jobs_select_assigned_installer`,
-- every column, cancelled aside). Columns there would hand over the contact while
-- the assignment is still SCHEDULED — the one state the approved rule withholds it
-- in. A separate table readable only by the poster's organization keeps the rule
-- exactly where it is: the installer reaches a contact ONLY through the snapshot
-- view, and only once work is in progress or completed.
--
-- NOTHING IS BORROWED FROM A PERSON. The contact is whatever the poster typed into
-- the job form for this work. No profile, membership or personal contact is read
-- anywhere in this migration, and nothing is backfilled: every existing job simply
-- has no work contact until its poster adds one.
--
-- SNAPSHOT SEMANTICS. At award, inside `job_application_accept`'s transaction, the
-- job's contact (if any) is copied to `assignment_contacts` with source
-- 'job_contact'. After that the two are independent: editing or removing the job's
-- contact never rewrites an existing assignment's, and a job that has been awarded
-- cannot have its contact edited at all (the same draft/open rule as `job_update`).
-- A job with no contact awards normally and produces no assignment contact row.
-- ===========================================================================

create table public.job_work_contacts (
  job_id             uuid        primary key references public.jobs (id) on delete cascade,
  contact_name       text,
  contact_phone_e164 text,
  contact_email      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint ck_job_work_contacts_name  check (contact_name is null or (contact_name = btrim(contact_name) and char_length(contact_name) between 1 and 120)),
  constraint ck_job_work_contacts_phone check (contact_phone_e164 is null or contact_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint ck_job_work_contacts_email check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  -- A contact with nothing to reach them by is not a contact: the row is absent instead.
  constraint ck_job_work_contacts_reachable check (contact_phone_e164 is not null or contact_email is not null)
);

comment on table public.job_work_contacts is
  'The optional work contact a poster provides for ONE job (name, E.164 phone, e-mail). Deliberately separate from jobs so the assigned installer cannot read it before work begins; readable only by the posting organization''s members. Snapshotted into assignment_contacts when the job is awarded. Written only through job_work_contact_set.';

create trigger set_job_work_contacts_updated_at
  before update on public.job_work_contacts
  for each row execute function app.set_updated_at();

alter table public.job_work_contacts enable row level security;

create policy job_work_contacts_select_poster_org on public.job_work_contacts
  for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_work_contacts.job_id and app.is_org_member(j.poster_org_id)));

-- No INSERT / UPDATE / DELETE policy and no write grant: the RPC is the only writer.
revoke all on public.job_work_contacts from anon, authenticated, service_role;
grant select on public.job_work_contacts to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The poster's write path
-- ---------------------------------------------------------------------------
create function public.job_work_contact_set(
  p_job_id       uuid,
  p_contact_name text,
  p_phone_e164   text,
  p_email        text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_j     public.jobs;
  v_name  text := nullif(btrim(coalesce(p_contact_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone_e164, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  perform app.require_verified_caller();
  select * into v_j from public.jobs where id = p_job_id for update;
  if not found then raise exception 'job not found' using errcode = '22023'; end if;
  if not app.is_org_member(v_j.poster_org_id) then
    raise exception 'not a member of the posting organization' using errcode = '42501';
  end if;
  if not app.can_post_job(v_j.poster_org_id) then
    raise exception 'job.post required' using errcode = '42501';
  end if;
  -- The same window as job_update: once the job is awarded (or closed) its contact is
  -- history, and the snapshot taken at award is the only copy that matters.
  if v_j.status not in ('draft', 'open') then
    raise exception 'a % job cannot be edited', v_j.status using errcode = '22023';
  end if;

  -- Nothing supplied: clearing is the same as never having set one.
  if v_name is null and v_phone is null and v_email is null then
    delete from public.job_work_contacts where job_id = p_job_id;
    return;
  end if;
  if v_phone is null and v_email is null then
    raise exception 'a work contact needs a phone or an e-mail' using errcode = '22023';
  end if;

  insert into public.job_work_contacts (job_id, contact_name, contact_phone_e164, contact_email)
  values (p_job_id, v_name, v_phone, v_email)
  on conflict (job_id) do update
    set contact_name = excluded.contact_name,
        contact_phone_e164 = excluded.contact_phone_e164,
        contact_email = excluded.contact_email;
end;
$$;

comment on function public.job_work_contact_set(uuid, text, text, text) is
  'Sets, changes or clears the work contact of a draft or open job the caller''s organization posted (job.post). All three values empty clears it; otherwise a phone (E.164) or e-mail is required. Values are validated by the table constraints. Refused once the job is awarded or closed.';

revoke execute on function public.job_work_contact_set(uuid, text, text, text) from public, anon;
grant  execute on function public.job_work_contact_set(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The award: job_application_accept, reproduced from
-- 20260904090002_job_application_decision_notifications.sql with ONE addition —
-- the work-contact snapshot, in the same transaction as the assignment.
-- ---------------------------------------------------------------------------
create or replace function public.job_application_accept(p_application_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_a   public.job_applications;
  v_j   public.jobs;
  v_id  uuid;
  v_org_name text;
  v_loser    record;
begin
  -- LOCK ORDER: jobs, then the child row (see the jobs domain migration).
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
  -- assignment it already produced and emits (and snapshots) nothing again.
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

  -- THE SNAPSHOT. The job's own work contact (and nothing else — no profile, no
  -- membership) is frozen onto the assignment, here, in the authoritative path.
  -- No contact on the job means no row; the award itself is unaffected either way.
  perform app.assignment_contact_snapshot(v_id, c.contact_name, c.contact_phone_e164, c.contact_email, 'job_contact')
  from public.job_work_contacts c
  where c.job_id = v_a.job_id;

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

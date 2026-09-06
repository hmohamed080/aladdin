-- ===========================================================================
-- Installer Pilot Increment 9 — the installer's own work record
--
-- Foundation: 20260902090001_jobs_domain.sql (job_assignments,
--             job_progress_updates, the four lifecycle RPCs).
--
-- Increment 6 shipped two installer-facing projections — `open_job_opportunities`
-- for browsing and `my_job_applications` for the caller's own candidacies — and
-- deferred the third. This is it, and it is the last one this domain needs.
--
-- WHAT IS ALREADY READABLE, AND IS NOT DUPLICATED HERE
--
--   * public.job_assignments — `job_assignments_select_installer` is a FLAT
--     column check, `installer_user_id = auth.uid()`, with no status predicate.
--     The installer can already read every assignment row that is theirs,
--     cancelled ones included.
--   * public.job_progress_updates — `job_progress_select_parties` admits both
--     parties of the parent assignment. The history needs no seam at all, and
--     this migration adds none: the pages read that table directly.
--
-- So this projection exists for exactly one reason: an assignment row on its own
-- is a pile of uuids and a number. THREE SEPARATE POLICIES stand between the
-- installer and the context that makes it a work record, and each one is a real
-- rule that should stay exactly as it is:
--
--   1. `organizations_select_member` — an installer is NOT a member of the
--      organization that hired them, so they cannot read its name. Without this
--      projection, "who am I doing this work for" is unanswerable on the very
--      surface built to answer it.
--   2. `trades_select_active` — a retired trade vanishes. §24: a completed
--      assignment must not lose its trade label because the taxonomy moved on
--      afterwards. Same requirement as Increment 7's `job_trade_labels`, same
--      shape of answer.
--   3. `jobs_select_assigned_installer` — carries `and a.status <> 'cancelled'`,
--      so the moment an assignment is cancelled the installer loses the JOB
--      behind it: title, description, location, dates. §19 requires the opposite
--      — a cancelled assignment stays a historical record, shown neutrally, not
--      erased.
--
-- WHY A PROJECTION AND NOT THREE POLICY EDITS. Each edit would widen a TABLE for
-- a question asked on one screen. Relaxing `trades_select_active` puts retired
-- trades back in every catalog, including the "post a job" dropdown — the exact
-- defect Increment 7 fixed by scoping to the question instead. Adding an
-- installer policy to `organizations` would hand the whole installer pool every
-- future column of the tenancy root. The projection names its columns; a policy
-- names none, and grants every column added after it.
--
-- SITE ADDRESS IS THE ONE COLUMN WITH A CONDITION ON IT. §11 withholds
-- `jobs.site_address` from the pool and releases it to the professional who is
-- awarded the work — which is precisely what `jobs_select_assigned_installer`
-- encodes, cancellation clause included. This projection reproduces that clause
-- rather than relaxing it: while the assignment is live the address is theirs to
-- read, and a cancelled engagement returns to knowing where the work was only in
-- the general sense the rest of the row already gives. Every OTHER column here
-- survives cancellation, because none of them is the thing §11 protects.
--
-- WHAT IS NOT HERE, and could have crept in: no sibling application, no
-- competing installer, no poster-side management metadata (`created_by`,
-- `version` of the JOB, `closed_at`), no organization column beyond the display
-- name, no billing, no contact detail. The assignment's OWN `version` is here
-- and has to be — `job_assignment_start` and `job_assignment_cancel` take
-- `p_expected_version`, and a UI that cannot read it cannot call them.
--
-- NO TABLE, COLUMN, POLICY, GRANT, TRIGGER, ENUM, STATUS OR WRITE PATH FROM
-- INCREMENT 6 IS TOUCHED. This migration is one function, one view, and their
-- grants.
-- ===========================================================================

create function app._my_job_assignments()
returns table (
  id                      uuid,
  job_id                  uuid,
  application_id          uuid,
  status                  public.job_assignment_status,
  agreed_amount           numeric(12,2),
  agreed_currency         text,
  latest_progress_percent smallint,
  last_progress_at        timestamptz,
  version                 integer,
  started_at              timestamptz,
  completed_at            timestamptz,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  created_at              timestamptz,
  job_title               text,
  job_description         text,
  job_status              public.job_status,
  trade_key               text,
  trade_is_active         boolean,
  governorate             text,
  city                    text,
  site_address            text,
  expected_duration_days  smallint,
  starts_on               date,
  ends_by                 date,
  published_at            timestamptz,
  poster_org_name         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.job_id, a.application_id, a.status,
         a.agreed_amount, a.agreed_currency,
         a.latest_progress_percent, a.last_progress_at, a.version,
         a.started_at, a.completed_at, a.cancelled_at, a.cancellation_reason,
         a.created_at,
         j.title, j.description, j.status,
         -- No `is_active` filter, deliberately: this is the label the work was
         -- agreed under, and it does not change because the taxonomy did.
         t.key, t.is_active,
         j.governorate, j.city,
         -- The §11 clause, reproduced rather than relaxed.
         case when a.status <> 'cancelled'::public.job_assignment_status
              then j.site_address end,
         j.expected_duration_days, j.starts_on, j.ends_by, j.published_at,
         -- No verification filter either: who hired you is a historical fact,
         -- and a lapse on their side does not make your own work record
         -- anonymous.
         o.name
  from public.job_assignments a
  join public.jobs j on j.id = a.job_id
  join public.trades t on t.id = j.trade_id
  join public.organizations o on o.id = a.poster_org_id
  -- The whole authority, and it is the same predicate the base-table policy
  -- uses: the denormalised installer column against auth.uid(). No parameter,
  -- so it cannot be pointed at another professional's work.
  where a.installer_user_id = (select auth.uid())
    and (select auth.uid()) is not null;
$$;

comment on function app._my_job_assignments() is
  'Internal SECURITY DEFINER reader backing public.my_job_assignments. The CALLER''s own assignments joined to the context three separate policies otherwise withhold: the posting organization''s display name (organizations is member-only), the trade label with NO is_active filter so a retired trade keeps its historical name, and the job itself after cancellation (jobs_select_assigned_installer excludes cancelled assignments). Scoped to auth.uid() with no parameter. site_address is released only while the assignment is live, reproducing installer-jobs.md §11 exactly. Never a sibling application, never another installer, never poster-side management metadata, never a contact detail.';

revoke execute on function app._my_job_assignments() from public;
grant  execute on function app._my_job_assignments() to authenticated, service_role;

create view public.my_job_assignments with (security_invoker = true) as
  select id, job_id, application_id, status,
         agreed_amount, agreed_currency,
         latest_progress_percent, last_progress_at, version,
         started_at, completed_at, cancelled_at, cancellation_reason, created_at,
         job_title, job_description, job_status, trade_key, trade_is_active,
         governorate, city, site_address,
         expected_duration_days, starts_on, ends_by, published_at,
         poster_org_name
  from app._my_job_assignments();

comment on view public.my_job_assignments is
  'The caller''s own work assignments with the context that makes each one a record rather than a set of uuids. security_invoker=true over app._my_job_assignments(). Read-only: every lifecycle move is still job_assignment_start, job_progress_add, job_assignment_complete or job_assignment_cancel, and completion remains the posting organization''s alone. Deliberately NOT filtered on the job still being discoverable, its poster still being verified, or the assignment still being live — an assignment is historical authority and stays readable through completion, cancellation, trade retirement and a poster''s lapse.';

revoke all on public.my_job_assignments from anon, authenticated, service_role;
grant select on public.my_job_assignments to authenticated, service_role;

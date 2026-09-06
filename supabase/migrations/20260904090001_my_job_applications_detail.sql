-- ===========================================================================
-- Installer Pilot Increment 8 — the applicant's own record, complete
--
-- WHY. `open_job_opportunities` shows a job only while it is open AND its poster
-- is currently verified. That is correct for DISCOVERY and wrong as the only way
-- an applicant can read a job: the moment the job is awarded to somebody else,
-- closed, cancelled, or its poster's verification lapses, the row vanishes — and
-- with it every detail of the thing this person applied to. `my_job_applications`
-- already exists precisely so that does not happen (it deliberately does NOT
-- filter on verification), but it carries the LIST half of a job: title, trade,
-- amount, city, status, poster name.
--
-- It does not carry the description, the duration, the dates or when the job was
-- published. Those are exactly what someone re-reading their own candidacy needs
-- — "what did I say I would do, and by when" — and without them the installer's
-- job detail route has to render two different pages depending on whether the
-- opportunity happens to still be discoverable today.
--
-- WHAT THIS ADDS AND WHAT IT DOES NOT. Five columns, every one of them ALREADY
-- projected by `open_job_opportunities` to any authenticated caller. Here they
-- are narrower still: only on the caller's OWN application, resolved from
-- `auth.uid()` inside the definer with no parameter to point elsewhere.
--
-- Still NEVER: `site_address` (§11 — the applicant is not the assignee), any
-- competing application, `version`, `created_by`, `closed_at`, or any poster-side
-- management column. The privacy line of Increment 6 is where it was.
--
-- DROP + CREATE rather than CREATE OR REPLACE, because the reader's RETURNS TABLE
-- signature changes and Postgres will not replace a function's result type. That
-- destroys the function's ACL, so every grant below is reasserted verbatim — a
-- security_invoker view over a reader the caller cannot EXECUTE fails with 42501
-- for everybody, and it fails at read time rather than at migration time.
-- ===========================================================================

drop view if exists public.my_job_applications;
drop function if exists app._my_job_applications();

create function app._my_job_applications()
returns table (
  id                     uuid,
  job_id                 uuid,
  status                 public.job_application_status,
  note                   text,
  created_at             timestamptz,
  decided_at             timestamptz,
  decision_reason        text,
  job_title              text,
  job_description        text,
  trade_key              text,
  offered_amount         numeric(12,2),
  offered_currency       text,
  governorate            text,
  city                   text,
  expected_duration_days smallint,
  starts_on              date,
  ends_by                date,
  published_at           timestamptz,
  job_status             public.job_status,
  poster_org_name        text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.job_id, a.status, a.note, a.created_at, a.decided_at, a.decision_reason,
         j.title, j.description, t.key, j.offered_amount, j.offered_currency,
         j.governorate, j.city,
         j.expected_duration_days, j.starts_on, j.ends_by, j.published_at,
         j.status, o.name
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  -- NO `t.is_active` filter, and that is the Increment 7 rule applied here: a
  -- trade that is retired after the fact must not erase the label of a job
  -- somebody already applied to. The join reads through the definer, so
  -- `trades_select_active` never sees it — this projection needs no counterpart
  -- to `job_trade_labels`, it already IS one for the applicant's own row.
  join public.trades t on t.id = j.trade_id
  join public.organizations o on o.id = j.poster_org_id
  where a.applicant_user_id = (select auth.uid())
    and (select auth.uid()) is not null;
$$;

comment on function app._my_job_applications() is
  'Internal SECURITY DEFINER reader backing public.my_job_applications. The CALLER''s own candidacies joined to the display half of the job, extended in Increment 8 with description, expected_duration_days, starts_on, ends_by and published_at so an application stays fully readable after its job leaves discovery. Scoped to auth.uid() with no parameter, so it cannot be pointed at another applicant. Never site_address (the applicant is not assigned), never a competing application, never poster-side management metadata. Unlike discovery it does NOT filter on verification: a candidacy already submitted stays fully readable if the poster later loses verification. It also does not filter on trades.is_active, so a retired trade keeps its historical label here.';

revoke execute on function app._my_job_applications() from public;
grant  execute on function app._my_job_applications() to authenticated, service_role;

create view public.my_job_applications with (security_invoker = true) as
  select id, job_id, status, note, created_at, decided_at, decision_reason,
         job_title, job_description, trade_key, offered_amount, offered_currency,
         governorate, city, expected_duration_days, starts_on, ends_by,
         published_at, job_status, poster_org_name
  from app._my_job_applications();

comment on view public.my_job_applications is
  'The caller''s own job applications with the display half of each job. security_invoker=true over app._my_job_applications(). Exists because the base-table policy on jobs deliberately excludes applicants — site_address is withheld until assignment (§11) — so an applicant needs a projection to read their own candidacy as a record rather than as a uuid. Increment 8 widened it to the job''s description, duration, dates and publication time: every one of those is already in open_job_opportunities for any authenticated caller, and here they are restricted to the caller''s own application, so the applicant''s record survives the job leaving discovery.';

revoke all on public.my_job_applications from anon, authenticated, service_role;
grant select on public.my_job_applications to authenticated, service_role;

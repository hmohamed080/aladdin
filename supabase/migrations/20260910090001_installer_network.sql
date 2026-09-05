-- ===========================================================================
-- Installer Pilot Increment 13 — the Network, derived from completed work
--
-- Foundation: 20260902090001_jobs_domain.sql (job_assignments, jobs, trades)
--             20260905090001_my_job_assignments.sql (the read-past-three-policies
--             pattern this file reuses)
--             20260909090001_job_reviews.sql (job_reviews, app.review_is_suppressed)
--
-- THE AUTHORITY IS A SHAPE, NOT A FLAG. There is no `network_memberships` table
-- and no boolean anywhere that says "in network". An organization is in an
-- installer's Network exactly when `public.job_assignments` holds at least one
-- row for that pair with `status = 'completed'`, and that fact is recomputed on
-- every read from the same table Jobs already owns — never cached, never
-- written by a second authority that could disagree with the first.
--
-- WHY NOT `my_job_assignments`. That projection already answers "what is MY
-- work", and this file does not touch it. But it does not carry the poster's
-- `id` — only its display name — because nothing that shipped before this
-- needed to GROUP BY the organization. A network page does, and an organization
-- detail route needs a real key to filter on rather than a name string that two
-- different organizations could share. So this is a NEW, narrower projection
-- (§ increment brief: "add a narrow projection; do not widen generic policies"),
-- not an extension of an existing contract three other surfaces already depend
-- on.
--
-- THE SAME THREE POLICIES `my_job_assignments` READS PAST, again: an installer
-- is not a member of the organizations they have worked for
-- (`organizations_select_member`), a retired trade disappears from the live
-- catalog (`trades_select_active`), and losing verification removes an
-- organization from ordinary discovery. None of the three may erase a
-- COMPLETED relationship — that is precisely the historical contract this
-- Increment exists to keep. Neither projection here filters on verification,
-- on `deleted_at`, or on the job's own current status: the assignment already
-- reached `completed`, which is a terminal, historical fact no later event can
-- undo.
--
-- WHAT NEVER APPEARS: an application without an award, an awarded assignment
-- that never completed, a cancelled engagement, organization membership,
-- Sales affiliation, or a manually added relationship. The only predicate
-- either reader applies is `a.status = 'completed'::public.job_assignment_status
-- and a.installer_user_id = auth.uid()`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app._my_network_organizations() — one row per organization
-- ---------------------------------------------------------------------------
-- `review_count` is read directly off `public.job_reviews`, the same way
-- `app._my_job_reviews` does, rather than through `my_job_reviews`: that view
-- carries the organization's NAME, not its id, and this reader already has the
-- id from the join it is building anyway. Suppressed reviews are excluded with
-- the same `app.review_is_suppressed` test §9 of the reviews migration uses, so
-- a suppressed review cannot surface here either.
create function app._my_network_organizations()
returns table (
  org_id               uuid,
  org_name             text,
  completed_count      integer,
  first_completed_at   timestamptz,
  last_completed_at    timestamptz,
  trade_keys           text[],
  latest_job_title     text,
  latest_assignment_id uuid,
  review_count         integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with completed as (
    select a.id as assignment_id, a.poster_org_id, a.completed_at,
           j.title as job_title, t.key as trade_key
    from public.job_assignments a
    join public.jobs j on j.id = a.job_id
    join public.trades t on t.id = j.trade_id
    where a.installer_user_id = (select auth.uid())
      and a.status = 'completed'::public.job_assignment_status
      and (select auth.uid()) is not null
  ),
  -- One row per organization: the most recently completed assignment, so the
  -- aggregate below can name a "latest job" without a second correlated
  -- subquery per organization.
  latest as (
    select distinct on (poster_org_id)
      poster_org_id, assignment_id, job_title
    from completed
    order by poster_org_id, completed_at desc nulls last, assignment_id desc
  )
  select
    o.id,
    o.name,
    count(c.assignment_id)::integer,
    min(c.completed_at),
    max(c.completed_at),
    array_agg(distinct c.trade_key order by c.trade_key),
    l.job_title,
    l.assignment_id,
    (
      select count(*)::integer from public.job_reviews r
      where r.installer_user_id = (select auth.uid())
        and r.poster_org_id = o.id
        and not app.review_is_suppressed(r.id)
    )
  from completed c
  join latest l on l.poster_org_id = c.poster_org_id
  join public.organizations o on o.id = c.poster_org_id
  group by o.id, o.name, l.job_title, l.assignment_id;
$$;

comment on function app._my_network_organizations() is
  'Internal SECURITY DEFINER reader backing public.my_network_organizations. One row per organization the CALLER has at least one completed job_assignment with, aggregated straight off job_assignments — no membership table, no cached flag. Scoped to auth.uid() with no parameter. Never filters on the organization''s current verification, deleted_at or the job''s current status: a completed assignment is a terminal historical fact. review_count excludes suppressed reviews via app.review_is_suppressed, the same test my_job_reviews applies.';

revoke execute on function app._my_network_organizations() from public;
grant  execute on function app._my_network_organizations() to authenticated, service_role;

create view public.my_network_organizations with (security_invoker = true) as
  select org_id, org_name, completed_count, first_completed_at, last_completed_at,
         trade_keys, latest_job_title, latest_assignment_id, review_count
  from app._my_network_organizations();

comment on view public.my_network_organizations is
  'The caller''s real professional network — organizations they have at least one COMPLETED job_assignment with, one row each. security_invoker=true over app._my_network_organizations(). Not sales affiliation, not organization membership, not a following/contact list: derived exclusively from public.job_assignments.status = ''completed''. Never rating, revenue, CRM stage or any invented relationship score.';

revoke all on public.my_network_organizations from anon, authenticated, service_role;
grant select on public.my_network_organizations to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. app._my_network_work_history() — the completed-work rows behind one org
-- ---------------------------------------------------------------------------
-- The organization detail route filters this by `org_id`, which is exactly why
-- it is a SEPARATE projection from `my_job_assignments` rather than a widening
-- of it: that view has no organization id to filter on, and adding one would
-- change a contract three existing surfaces already read. This one exists
-- solely to answer "what did I complete for THIS organization", so it carries
-- only completed rows and only the columns that answer that question — the
-- assignment id to link back to `/home/work/[assignmentId]` (§8 of the
-- increment brief: Network links to My Work rather than duplicating it), the
-- job's display context, and the frozen agreed amount as a disclosure exactly
-- as `my_job_assignments` already shows it.
create function app._my_network_work_history()
returns table (
  assignment_id   uuid,
  org_id          uuid,
  org_name        text,
  job_title       text,
  trade_key       text,
  agreed_amount   numeric(12,2),
  agreed_currency text,
  completed_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, o.id, o.name, j.title, t.key, a.agreed_amount, a.agreed_currency, a.completed_at
  from public.job_assignments a
  join public.jobs j on j.id = a.job_id
  join public.trades t on t.id = j.trade_id
  join public.organizations o on o.id = a.poster_org_id
  where a.installer_user_id = (select auth.uid())
    and a.status = 'completed'::public.job_assignment_status
    and (select auth.uid()) is not null;
$$;

comment on function app._my_network_work_history() is
  'Internal SECURITY DEFINER reader backing public.my_network_work_history. The CALLER''s own completed assignments with enough context to render a work-history row and the organization id to filter one organization''s relationship detail by. Scoped to auth.uid() with no parameter. Deliberately excludes site_address, cancellation fields and progress history — this is the Network''s relationship view; the operational record stays on my_job_assignments and public.job_progress_updates.';

revoke execute on function app._my_network_work_history() from public;
grant  execute on function app._my_network_work_history() to authenticated, service_role;

create view public.my_network_work_history with (security_invoker = true) as
  select assignment_id, org_id, org_name, job_title, trade_key,
         agreed_amount, agreed_currency, completed_at
  from app._my_network_work_history();

comment on view public.my_network_work_history is
  'The caller''s own completed work, one row per assignment, filterable by org_id for the organization relationship detail page. security_invoker=true over app._my_network_work_history(). Only completed assignments — scheduled, in_progress and cancelled rows never appear here, by construction rather than by a query-time filter a future caller could drop.';

revoke all on public.my_network_work_history from anon, authenticated, service_role;
grant select on public.my_network_work_history to authenticated, service_role;

-- ===========================================================================
-- Installer Jobs — Saved Opportunities
--
-- A professional bookmarks job openings they intend to come back to. This is a
-- PRIVATE shortlist: a saved job confers nothing (no application, no reservation,
-- no signal to the poster), and nobody but its owner can see that it exists.
--
-- It follows the repo's saved-items shape (`saved_products`, ADR-0008): the base
-- table is SELECT-only for client roles, every write is a SECURITY DEFINER RPC
-- that derives the actor from auth.uid(), and no function takes a user id — so
-- there is no parameter a client could point at somebody else.
--
--   * public.saved_jobs               (user_id, job_id) — one row per saved job
--   * public.job_save(job_id)         idempotent save, discoverable jobs only
--   * public.job_unsave(job_id)       idempotent unsave, always the caller's own
--   * public.saved_job_opportunities  the caller's saved jobs that are STILL
--                                     discoverable (open + verified poster)
--
-- A saved job that later closes, is awarded or loses its verified poster is KEPT
-- (the row survives, and survives the job being hidden), but it drops out of
-- `saved_job_opportunities`, so it never reappears on the active board as if it
-- were live. The count of kept-but-unavailable rows is readable from saved_jobs
-- itself, which lets the UI say so honestly.
--
-- Deliberately NOT audited: a private bookmark is not a business-consequential
-- event (same reasoning as saved_products), so the audit allow-list is untouched.
-- ===========================================================================

create table public.saved_jobs (
  user_id    uuid        not null references public.users (id) on delete cascade,
  job_id     uuid        not null references public.jobs  (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- A second save of the same job is the same row, never a duplicate.
  primary key (user_id, job_id)
);

comment on table public.saved_jobs is
  'A user''s private shortlist of job openings. Owner-readable only; written exclusively through job_save / job_unsave, which derive the owner from auth.uid(). A bookmark: confers no application, reservation or visibility to the poster.';

-- "My saved jobs, newest first" is the only list read.
create index ix_saved_jobs_user_created on public.saved_jobs (user_id, created_at desc);
-- Supports the cascade from jobs.
create index ix_saved_jobs_job on public.saved_jobs (job_id);

alter table public.saved_jobs enable row level security;

create policy saved_jobs_select_own on public.saved_jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT / UPDATE / DELETE policy exists: writes go through the RPCs below.
revoke all on public.saved_jobs from anon, authenticated, service_role;
grant select on public.saved_jobs to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Write paths
-- ---------------------------------------------------------------------------
create function public.job_save(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- Only a job the caller could actually see on the board. Without this check the
  -- function would answer "does job <uuid> exist?" for drafts and other tenants'
  -- private jobs.
  if not exists (select 1 from public.open_job_opportunities o where o.id = p_job_id) then
    raise exception 'job not found' using errcode = 'P0002';
  end if;

  insert into public.saved_jobs (user_id, job_id)
  values (v_uid, p_job_id)
  on conflict (user_id, job_id) do nothing;
end;
$$;

comment on function public.job_save(uuid) is
  'Saves a currently-discoverable job opening to the CALLER''s private shortlist. The owner is auth.uid(); there is no user parameter. Idempotent.';

create function public.job_unsave(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- The caller's own row only; a missing row (or someone else's) is a no-op.
  delete from public.saved_jobs
  where user_id = v_uid and job_id = p_job_id;
end;
$$;

comment on function public.job_unsave(uuid) is
  'Removes a job from the CALLER''s shortlist. Works for jobs that are no longer discoverable too. Idempotent.';

revoke execute on function public.job_save(uuid)   from public, anon;
revoke execute on function public.job_unsave(uuid) from public, anon;
grant  execute on function public.job_save(uuid)   to authenticated;
grant  execute on function public.job_unsave(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The caller's saved jobs that are still on the board
-- ---------------------------------------------------------------------------
-- security_invoker: saved_jobs RLS scopes the rows to the caller, and the join to
-- open_job_opportunities (itself scoped inside its own definer) is what drops a
-- closed / awarded / unverified-poster job from the active list.
create view public.saved_job_opportunities with (security_invoker = true) as
  select s.job_id, s.created_at as saved_at
  from public.saved_jobs s
  join public.open_job_opportunities o on o.id = s.job_id;

comment on view public.saved_job_opportunities is
  'The caller''s saved jobs that are still discoverable. A saved job that has closed, been awarded or lost its verified poster stays in saved_jobs but is not listed here.';

revoke all on public.saved_job_opportunities from anon, authenticated, service_role;
grant select on public.saved_job_opportunities to authenticated, service_role;

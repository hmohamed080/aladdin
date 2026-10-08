-- ===========================================================================
-- Jobs — a published job ALWAYS has a publication time, and it never changes
--
-- "Newest" is `published_at DESC, id DESC`, so `published_at` is the sort key of the Jobs board and of its keyset
-- cursor. A NULL on a job that is on the board breaks both: Postgres sorts it FIRST under DESC (ahead of every
-- genuinely newer job), it falls out of the Oldest chain altogether, and a cursor anchored on it is refused. A value
-- that silently moves would reorder the board and break a cursor mid-walk. Until now the only thing preventing either
-- was that `job_publish` happens to be the only writer.
--
-- THE REAL LIFECYCLE (app.jobs_status_transition_guard, 20260902090001):
--
--     draft  -> open | cancelled
--     open   -> awarded | closed | cancelled
--     awarded-> completed | open          (open again = the assignment was cancelled)
--
--   never published ........ draft                       (published_at may be NULL)
--   published now .......... open, awarded               (awarded is still published: it returns to open)
--   post-publication ....... closed, completed           (reachable ONLY from open / awarded)
--   either ................. cancelled                   (draft -> cancelled is legal, AND open -> cancelled)
--
-- Only `job_publish` sets `published_at` (draft -> open); no other transition touches it, there is no reopen or
-- republish action, and an edit (`job_update`) never writes it. That is a Product rule, kept as it is.
--
-- THE INVARIANT, in two parts, because `cancelled` cannot be decided from the status alone:
--   1. CHECK: open / awarded / closed / completed require a published_at. (draft and cancelled do not: a job cancelled
--      straight from draft was never published and has none.)
--   2. GUARD: published_at is IMMUTABLE once set.
--        NULL     -> non-NULL          allowed (the initial publication)
--        non-NULL -> the same value    allowed (an UPDATE that does not change it)
--        non-NULL -> NULL              refused
--        non-NULL -> a different value refused
--      So a job that was published and is later cancelled keeps its original time, and no direct UPDATE, service-role
--      script, import or application bug can clear or move it. There is deliberately NO escape hatch for a future
--      Republish: if that ever becomes a feature it gets its own authoritative RPC and a deliberate change to this guard.
-- Neither part depends on job_publish being the only writer.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Backfill legacy rows (deterministic: created_at; never now(); never overwrites a real value)
-- ---------------------------------------------------------------------------
-- Inline and one-off: nothing is left behind in the runtime schema. The updated_at trigger is paused because a data
-- repair is not an edit and must not make 'recently updated' lie.
alter table public.jobs disable trigger set_jobs_updated_at;

do $$
declare
  v_n integer;
begin
  update public.jobs
     set published_at = created_at
   where published_at is null
     and status in ('open', 'awarded', 'closed', 'completed');
  get diagnostics v_n = row_count;
  raise notice 'jobs.published_at backfilled from created_at for % legacy row(s)', v_n;
end $$;

alter table public.jobs enable trigger set_jobs_updated_at;

-- ---------------------------------------------------------------------------
-- 2. The CHECK
-- ---------------------------------------------------------------------------
alter table public.jobs
  add constraint ck_jobs_published_at_after_publication
  check (status not in ('open', 'awarded', 'closed', 'completed') or published_at is not null);

comment on constraint ck_jobs_published_at_after_publication on public.jobs is
  'A job that is published (open, awarded) or has progressed from a published job (closed, completed) always has a publication time: the Jobs board sorts and pages by it. draft (never published) and cancelled (legal both before and after publication) are not constrained here; jobs_published_at_immutable covers a cancelled job that WAS published.';

-- ---------------------------------------------------------------------------
-- 3. The guard: a publication time, once set, is immutable
-- ---------------------------------------------------------------------------
create function app.jobs_published_at_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'a job''s publication time cannot be changed or cleared once it has been published'
      using errcode = '23514', constraint = 'jobs_published_at_immutable';
  end if;
  return new;
end;
$$;

comment on function app.jobs_published_at_immutable() is
  'BEFORE UPDATE OF published_at on public.jobs: once published_at has a value it can be neither cleared nor changed (NULL -> value and value -> same value are allowed). Together with ck_jobs_published_at_after_publication this keeps the Newest sort key present and stable for every job that was ever published, including one that is later cancelled. There is intentionally no Republish exception.';

revoke execute on function app.jobs_published_at_immutable() from public, anon, authenticated, service_role;

create trigger jobs_published_at_immutable
  before update of published_at on public.jobs
  for each row execute function app.jobs_published_at_immutable();

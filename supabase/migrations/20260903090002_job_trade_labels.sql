-- ===========================================================================
-- Installer Pilot Increment 7 — the poster-side trade label for their own jobs
--
-- A historical-read defect, recorded during Increment 7's review and fixed here.
--
-- THE DEFECT. `jobs.trade_id` is `not null references public.trades on delete
-- restrict`, so every job keeps its trade forever — that FK is the whole
-- mechanism by which retirement preserves history (20260901090001 §1, and the
-- `on delete restrict` there is deliberate). But `trades_select_active` withholds
-- retired rows from ordinary callers, so the poster's own embed
-- `jobs -> trades(key)` comes back NULL the moment the platform retires that
-- trade. The row the poster wrote is intact in the database and unreadable by
-- the poster: their list and their detail page lose the label of a job THEY
-- posted, in a trade THEY chose, and show a dash instead.
--
-- WHY NOT A POLICY. The obvious one-line fix is another permissive policy on
-- `public.trades` — "also show me an inactive trade referenced by a job my
-- organization posted". It is one line and it is the wrong line, because a
-- permissive policy widens the TABLE, not the question: every `from("trades")`
-- in the product would start returning that retired row, including
-- `loadTradeCatalog()`, which is the vocabulary the create and edit forms offer.
-- The retired trade would reappear as a selectable option in the "post a job"
-- dropdown — the exact outcome `trades_select_active` exists to prevent — and
-- the only thing standing between a poster and picking it would be the RPC's
-- refusal. A list nobody can see is still the mistake nobody can make.
--
-- So the seam is scoped to the QUESTION instead of to the table: for jobs the
-- caller's own organization posted, what trade did we post them in. It answers
-- that and nothing else. `public.trades` is untouched — no policy, no grant, no
-- column — and general inactive-trade discovery is exactly as narrow as it was
-- an hour ago.
--
-- WHAT IT DOES NOT CHANGE, deliberately:
--
--   * SELECTION. `job_create` and `job_update` still resolve `p_trade_key`
--     against `is_active` inside their definers and still raise 22023 on a
--     retired key; `job_publish` still re-checks that a draft's trade is active
--     before it becomes visible. This seam is read-only and grants nothing —
--     being able to READ the label of a retired trade never becomes permission
--     to POST in it. Test 44 §C asserts all three, after the retirement.
--   * DISCOVERY. `open_job_opportunities` still joins `public.trades` plainly.
--     An installer's browse surface is not a poster's history and does not need
--     this.
--
-- `trade_is_active` rides along because it is the same row at no cost, and
-- because "Marble & granite" and "Marble & granite (no longer offered)" are
-- different facts for someone deciding whether to repost. Nothing gates on it.
-- ===========================================================================

create function app._job_trade_labels()
returns table (
  job_id          uuid,
  trade_key       text,
  trade_is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.id, t.key, t.is_active
    from public.jobs j
    join public.trades t on t.id = j.trade_id
   -- The same predicate `jobs`' own RLS uses for the poster side, and the whole
   -- of the authority. A caller who cannot see the job cannot see its label:
   -- there is no parameter here to point somewhere else with.
   where app.is_org_member(j.poster_org_id)
     and (select auth.uid()) is not null;
$$;

comment on function app._job_trade_labels() is
  'Internal SECURITY DEFINER reader backing public.job_trade_labels. For jobs posted by an organization the CALLER is an active member of: the key of the trade that job was posted in, ACTIVE OR RETIRED, plus whether it is still active. Exists because trades_select_active withholds retired rows, which would otherwise erase the label of the caller''s own historical jobs (jobs.trade_id is not null and on delete restrict, so the row itself always survives). Deliberately NOT a policy on public.trades: a permissive policy would widen the table for every reader, including loadTradeCatalog(), and put the retired trade back in the "post a job" dropdown. Read-only, and grants nothing — job_create, job_update and job_publish still refuse a retired trade.';

revoke execute on function app._job_trade_labels() from public;
grant  execute on function app._job_trade_labels() to authenticated, service_role;

create view public.job_trade_labels with (security_invoker = true) as
  select job_id, trade_key, trade_is_active
  from app._job_trade_labels();

comment on view public.job_trade_labels is
  'Poster-side trade label for an organization''s own jobs, retired trades included. security_invoker=true over app._job_trade_labels(); scoped to the caller''s own organizations with no parameter to point elsewhere. Three columns and no more: it is a LABEL seam, not a second vocabulary — the create and edit forms still read public.trades, where a retired trade remains invisible and therefore unselectable.';

revoke all on public.job_trade_labels from anon, authenticated, service_role;
grant select on public.job_trade_labels to authenticated, service_role;

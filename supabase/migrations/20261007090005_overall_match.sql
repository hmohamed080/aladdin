-- ===========================================================================
-- Installer Jobs — OVERALL MATCH: the ONE canonical match authority
--
-- A single caller-scoped function answers "how well does this job fit the signed-in
-- professional". The same installer + the same job give the same answer on every
-- surface, because every surface reads THIS.
--
--     TRADE         50   the job's required trade is one of the caller's trades
--     SPECIALTY     20   only when the trade matches: the required specialty is held (20),
--                        missing (0), or the job requires none (20)
--     LOCATION      15   same city 15 · primary governorate 10 · another declared
--                        service area 5 · outside 0
--     AVAILABILITY  15   binary when DECLARED; no points either way when NOT DECLARED (see below)
--                  ---
--                  100
--
-- Presentation only. Match is never read by RLS, never by a gate, never by
-- application eligibility: a 0 % job stays discoverable, openable and applicable.
--
-- INPUTS (all the CALLER's own rows, resolved from auth.uid() — no identity is ever a parameter of a
-- PUBLIC function):
--   trade         public.user_trades                      vs jobs.trade_id
--   specialty     public.user_trade_specialties           vs jobs.required_specialty_id
--   location      public.user_service_areas               vs jobs.governorate_key / city_key
--                 (canonical keys; a job whose location did not resolve is `job_location_unknown`, 0)
--   availability  public.profiles.available_for_work + availability_updated_at (the declaration
--                 marker)  +  public.user_availability_windows
--                 vs jobs.starts_on / ends_by
--
-- AVAILABILITY is a THREE-state fact (see 20261007090003): AVAILABLE, UNAVAILABLE, or NOT DECLARED. "Never said" is NOT
-- "said no", and nothing here infers one from the other:
--   NOT DECLARED (false, availability_updated_at NULL) -> NULL availability_points, availability_not_declared.
--                       The component is reported as not specified and contributes NO points; the overall percent
--                       is the points actually earned out of 100, so a caller who has not said whether they are
--                       available can reach at most 85 until they do. Nothing is invented and nothing is
--                       normalised: the breakdown says exactly what is missing.
--   UNAVAILABLE (declared false)                       -> 0   not_available_for_work
--   AVAILABLE (true), binary, no fractional overlap:
--   the job has neither starts_on nor ends_by          -> 15  available_no_dates
--   the job has a date: its window is
--       [coalesce(starts_on, ends_by), coalesce(ends_by, starts_on)]
--     i.e. ONE boundary is a single day — the same semantics the My Work planned-window filter
--     already uses (lib/work/planned-window.ts). Declared windows are UNIONed (overlapping or
--     touching ones merge); the job window must lie entirely inside the union:
--       covered                                          -> 15  window_covers
--       windows declared, not covering                   -> 0   window_not_covering
--       no window declared                               -> 0   no_window_declared
--   expected_duration_days is NOT used: it is a length, not a position in time.
--
-- REASON CODES are stable machine strings. SQL stores no localized text.
--
-- ORDERINGS THAT ARE NOT THE OVERALL SCORE (they are deliberately separate):
--   Near Me     location only      tier 0 city / 1 primary governorate / 2 other service area / 3 rest
--   Best Match  trade + specialty  70 (trade + specialty) / 50 (trade only) / 0
-- Both are applied inside public.job_opportunities_page (20261007090006), from the same inputs; pgTAP
-- asserts they agree with this function (app.job_match_rows; app.job_match_for is its single-job wrapper).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The authority. `app` schema, NOT executable by any client role: the public wrappers
-- (job_matches, job_opportunities_page) call it with auth.uid(), so no caller can name another user.
-- ---------------------------------------------------------------------------
create function app.job_match_rows(p_uid uuid, p_job_ids uuid[])
returns table (
  job_id              uuid,
  overall_percent     smallint,
  trade_points        smallint,
  specialty_points    smallint,
  location_points     smallint,
  availability_points smallint,
  trade_reason        text,
  specialty_reason    text,
  location_reason     text,
  availability_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  with j as (
    select jb.id, jb.trade_id, jb.required_specialty_id, jb.governorate_key, jb.city_key, jb.starts_on, jb.ends_by
    from public.jobs jb
    where jb.id = any (p_job_ids)
  ),
  me as (
    select
      array(select ut.trade_id from public.user_trades ut where ut.user_id = p_uid)                      as trades,
      array(select us.specialty_id from public.user_trade_specialties us where us.user_id = p_uid)       as specs,
      (select a.governorate_key from public.user_service_areas a where a.user_id = p_uid and a.is_primary) as pgov,
      -- THREE states, never two: only a stamped false is an explicit "unavailable".
      coalesce((select case when pr.available_for_work then 'available'
                            when pr.availability_updated_at is not null then 'unavailable'
                            else 'unknown' end
                  from public.profiles pr
                 where pr.user_id = p_uid and pr.deleted_at is null), 'unknown')                          as avs,
      (select range_agg(daterange(w.available_from, w.available_to, '[]'))
         from public.user_availability_windows w where w.user_id = p_uid)                                 as windows
  ),
  facts as (
    select j.*, me.trades, me.specs, me.pgov, me.avs, me.windows,
           case when j.starts_on is null and j.ends_by is null then null
                else daterange(least(coalesce(j.starts_on, j.ends_by), coalesce(j.ends_by, j.starts_on)),
                               greatest(coalesce(j.starts_on, j.ends_by), coalesce(j.ends_by, j.starts_on)), '[]')
           end as job_window
    from j cross join me
  ),
  parts as (
    select f.id,
      (f.trade_id = any (f.trades)) as trade_ok,
      case
        when f.trade_id = any (f.trades)    then 'trade_matches'
        when cardinality(f.trades) = 0      then 'no_declared_trade'
        else 'trade_mismatch'
      end as trade_reason,
      case
        when not (f.trade_id = any (f.trades)) then 'trade_mismatch'
        when f.required_specialty_id is null   then 'no_specialty_required'
        when f.required_specialty_id = any (f.specs) then 'specialty_matches'
        else 'specialty_missing'
      end as specialty_reason,
      case
        when f.governorate_key is null then 'job_location_unknown'
        when f.pgov is null            then 'no_service_area'
        when f.governorate_key = f.pgov
             and f.city_key is not null and f.city_key <> 'other'
             and exists (select 1 from public.user_service_areas a
                          where a.user_id = p_uid and a.governorate_key = f.pgov and a.city_key = f.city_key)
                                       then 'same_city'
        when f.governorate_key = f.pgov then 'primary_governorate'
        when exists (select 1 from public.user_service_areas a
                      where a.user_id = p_uid and a.governorate_key = f.governorate_key
                        and (a.city_key is null or (a.city_key = f.city_key and a.city_key <> 'other')))
                                       then 'other_service_area'
        else 'outside_service_area'
      end as location_reason,
      case
        when f.avs = 'unknown'         then 'availability_not_declared'
        when f.avs = 'unavailable'     then 'not_available_for_work'
        when f.job_window is null      then 'available_no_dates'
        when f.windows is null         then 'no_window_declared'
        when f.windows @> f.job_window then 'window_covers'
        else 'window_not_covering'
      end as availability_reason
    from facts f
  )
  select p.id,
         (tp + sp + lp + coalesce(ap, 0))::smallint,
         tp::smallint, sp::smallint, lp::smallint, ap::smallint,
         p.trade_reason, p.specialty_reason, p.location_reason, p.availability_reason
  from parts p
  cross join lateral (select case p.trade_reason when 'trade_matches' then 50 else 0 end as tp) t
  cross join lateral (select case p.specialty_reason when 'specialty_matches' then 20 when 'no_specialty_required' then 20 else 0 end as sp) s
  cross join lateral (select case p.location_reason
                               when 'same_city' then 15 when 'primary_governorate' then 10
                               when 'other_service_area' then 5 else 0 end as lp) l
  cross join lateral (select case p.availability_reason
                               when 'availability_not_declared' then null
                               when 'available_no_dates' then 15 when 'window_covers' then 15 else 0 end as ap) a;
$$;

comment on function app.job_match_rows(uuid, uuid[]) is
  'THE canonical Overall Match for (user, jobs): trade 50 + specialty 20 + location 15 + availability 15, with stable reason codes. Availability is three-state: a caller who has never declared it gets NULL availability_points (availability_not_declared), not 0. The caller''s own facts are read ONCE for the whole batch. Internal: takes a user id, so it is executable by NO client role — every public caller passes auth.uid(). Presentation only; never read by RLS or eligibility.';

revoke execute on function app.job_match_rows(uuid, uuid[]) from public, anon, authenticated, service_role;

-- The single-job form (tests, oracles, one-off reads). A thin wrapper: there is no second formula.
create function app.job_match_for(p_uid uuid, p_job_id uuid)
returns table (
  job_id              uuid,
  overall_percent     smallint,
  trade_points        smallint,
  specialty_points    smallint,
  location_points     smallint,
  availability_points smallint,
  trade_reason        text,
  specialty_reason    text,
  location_reason     text,
  availability_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.job_match_rows(p_uid, array[p_job_id]);
$$;

comment on function app.job_match_for(uuid, uuid) is
  'Single-job form of app.job_match_rows. A wrapper, not a second formula. Executable by no client role.';

revoke execute on function app.job_match_for(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The caller-scoped read: job detail, and any batch of jobs the caller may see.
-- Visible = discoverable now (open, verified poster) OR a job the caller has applied to (their own record).
-- ---------------------------------------------------------------------------
create function public.job_matches(p_job_ids uuid[])
returns table (
  job_id              uuid,
  overall_percent     smallint,
  trade_points        smallint,
  specialty_points    smallint,
  location_points     smallint,
  availability_points smallint,
  trade_reason        text,
  specialty_reason    text,
  location_reason     text,
  availability_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_job_ids is null or cardinality(p_job_ids) = 0 then
    return;
  end if;
  if cardinality(p_job_ids) > 200 then
    raise exception 'too many jobs requested' using errcode = '22023';
  end if;

  return query
  select m.*
  from app.job_match_rows(v_uid, (
         select array_agg(j.id)
         from public.jobs j
         join public.organizations o on o.id = j.poster_org_id
         where j.id = any (p_job_ids)
           and (
             (j.status = 'open'::public.job_status and o.is_verified and o.deleted_at is null and o.status = 'active'::public.org_status)
             or exists (select 1 from public.job_applications a where a.job_id = j.id and a.applicant_user_id = v_uid)
           ))) m;
end;
$$;

comment on function public.job_matches(uuid[]) is
  'Overall Match breakdown for jobs the CALLER can see (discoverable now, or one they applied to). Identity is auth.uid(); no user parameter. Presentation only — never an eligibility input.';

revoke execute on function public.job_matches(uuid[]) from public, anon;
grant  execute on function public.job_matches(uuid[]) to authenticated;

-- Does the caller have a declared primary service area? (Explains why Near me shows newest-first.)
create function public.caller_has_service_location()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.user_service_areas a where a.user_id = (select auth.uid()) and a.is_primary);
$$;

comment on function public.caller_has_service_location() is
  'True when the CALLER has declared a primary service governorate. No parameter. Used only to explain the Near me ordering.';

revoke execute on function public.caller_has_service_location() from public, anon;
grant  execute on function public.caller_has_service_location() to authenticated;

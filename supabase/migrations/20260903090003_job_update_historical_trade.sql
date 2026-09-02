-- ===========================================================================
-- Installer Pilot Increment 7 — editing a job whose trade has been retired
--
-- THE DEFECT. `job_update` resolved `p_trade_key` against `is_active` and
-- refused anything else, which is correct for a trade CHANGE and wrong for
-- everything else: a poster whose job sits under a since-retired trade could
-- not fix a typo in the title, correct the site address, or extend the
-- schedule. The whole edit was refused, because the value it was RETAINING no
-- longer resolved. `20260903090002` restored the poster's ability to READ that
-- label; this restores their ability to keep working on the job it belongs to.
--
-- THE DISTINCTION, and it is the whole change: retiring a trade must stop it
-- being CHOSEN, not stop the job that already holds it from being maintained.
-- So the resolution now happens in two steps —
--
--   1. resolve the key at all (an unknown key is still 22023, unchanged);
--   2. an INACTIVE trade is accepted only when it is the one this job already
--      holds. Any other inactive trade — including one the caller could read a
--      label for on a DIFFERENT job of theirs — is still refused.
--
-- WHAT IS DELIBERATELY UNCHANGED:
--
--   * `job_create` still resolves against `is_active` only. There is no
--     historical value to retain when the job does not exist yet, so a retired
--     trade remains unpostable.
--   * `job_publish` still refuses while the job's trade is inactive. Editing a
--     job is private housekeeping; publishing is the moment it becomes visible
--     to the installer pool, and the platform's decision to withdraw a trade
--     has to bite somewhere. It bites there.
--   * THE POST-APPLICATION FREEZE. The `v_has_apps` check below is untouched
--     and still compares the RESOLVED id against the stored one, so retaining
--     the retired trade is not a change and passes, while switching to an
--     active trade on a job with applications is refused exactly as before —
--     and `app.jobs_offer_immutable_after_application` enforces it underneath
--     regardless of what this function decides.
--
-- The error message and SQLSTATE for a refused trade are unchanged, so
-- `mapJobError`'s `jobs.errors.tradeUnavailable` branch still names it.
--
-- Only the body changes; the signature, grants and audit action are identical.
-- ===========================================================================

create or replace function public.job_update(
  p_job_id                 uuid,
  p_expected_version       integer,
  p_title                  text,
  p_trade_key              text,
  p_offered_amount         numeric,
  p_description            text default null,
  p_governorate            text default null,
  p_city                   text default null,
  p_site_address           text default null,
  p_expected_duration_days smallint default null,
  p_starts_on              date default null,
  p_ends_by                date default null
)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_j            public.jobs;
  v_trade_id     uuid;
  v_trade_active boolean;
  v_has_apps     boolean;
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
  if v_j.status not in ('draft', 'open') then
    raise exception 'a % job cannot be edited', v_j.status using errcode = '22023';
  end if;
  if v_j.version <> p_expected_version then
    raise exception 'job was modified concurrently' using errcode = '40001';
  end if;

  -- Resolved WITHOUT the is_active filter, then judged. An unknown key fails
  -- the same way it always has; a retired one is accepted only as the value
  -- this job is already carrying.
  select t.id, t.is_active into v_trade_id, v_trade_active
  from public.trades t where t.key = btrim(coalesce(p_trade_key, ''));
  if v_trade_id is null
     or (not v_trade_active and v_trade_id is distinct from v_j.trade_id) then
    raise exception 'unknown or retired trade' using errcode = '22023';
  end if;

  -- Unchanged, and it still reads as "did the trade actually move" rather than
  -- "was an active trade supplied" — which is why retaining a retired one is
  -- not a change and switching away from one still is.
  v_has_apps := exists (select 1 from public.job_applications a where a.job_id = p_job_id);
  if v_has_apps and (p_offered_amount <> v_j.offered_amount or v_trade_id <> v_j.trade_id) then
    raise exception
      'the offer and trade cannot change once someone has applied; close this job and post a new one'
      using errcode = '22023';
  end if;

  update public.jobs set
    title                  = btrim(p_title),
    description            = nullif(btrim(coalesce(p_description, '')), ''),
    trade_id               = v_trade_id,
    offered_amount         = p_offered_amount,
    governorate            = nullif(btrim(coalesce(p_governorate, '')), ''),
    city                   = nullif(btrim(coalesce(p_city, '')), ''),
    site_address           = nullif(btrim(coalesce(p_site_address, '')), ''),
    expected_duration_days = p_expected_duration_days,
    starts_on              = p_starts_on,
    ends_by                = p_ends_by,
    version                = version + 1
  where id = p_job_id;

  perform app.record_audit_event('job.updated', 'job', p_job_id, v_j.poster_org_id,
    jsonb_build_object('status', v_j.status));
  return v_j.version + 1;
end;
$$;

comment on function public.job_update(uuid, integer, text, text, numeric, text, text, text, text, smallint, date, date) is
  'Edits a draft or open job the caller''s organization posted, under job.post and optimistic concurrency on p_expected_version. The trade must resolve to an ACTIVE trade, with one exception: a job may RETAIN the trade it already holds after that trade is retired, so retirement stops a trade being chosen without freezing every job posted under it. job_create has no such exception (nothing to retain) and job_publish still refuses while the job''s trade is inactive. The post-application freeze on the offer and the trade is unchanged, and app.jobs_offer_immutable_after_application enforces it regardless.';

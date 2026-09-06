-- ===========================================================================
-- Installer Pilot Increment 7 — the poster-side applicants projection
--
-- A defect in Increment 6's READ model, found while building the organization
-- Jobs UI. Increment 6 shipped two projections — `open_job_opportunities` for
-- the installer browsing work, and `my_job_applications` for the installer
-- reading their own candidacies — and no counterpart for the poster, who is the
-- party that actually has to decide.
--
-- `installer-jobs.md` §11 already required one:
--
--     "A poster sees a candidate's public projection, not their raw record."
--     "Application views join profile_public_directory and read nothing else."
--
-- WHY THE LITERAL READING COULD NOT SHIP. `profile_public_directory` exposes
-- `profiles.id` and deliberately never `user_id`, so there is no key to join an
-- application to it — the projection the spec names is unreachable from the
-- table that needs it. And the join it describes is an INNER one against
-- `public_profile_status = 'listed'`, whose column default is `hidden`: today
-- 17 of 26 profiles are hidden. A poster-side list built that way would render
-- most of its applicants anonymous, and the poster would be choosing who to
-- hand work to from a list of blanks.
--
-- WHAT THIS RETURNS INSTEAD, and the line it draws:
--
--   * IDENTITY — `display_name`, `headline`, avatar — for every applicant,
--     listed or not. Somebody who applies to your job has, by that act, told you
--     who they are; that is a party-to-a-transaction fact, not a directory
--     lookup. Reading it here is what §11's other rows actually protect against
--     being *absent*: a decision made about a person nobody can name.
--   * PRACTICE — trades, years of experience, service areas — the same
--     self-declared columns `profile_public_directory` carries, because the
--     professional wrote them in order to be found for work like this.
--   * `public_profile_id` ONLY when the person is genuinely listed, so the UI's
--     "View profile" link appears exactly where /p/[id] will render something.
--
-- AND NEVER: contacts, phone, email, base address, travel radius, availability
-- lead-time, any consumer_* answer, or `applicant_user_id`. Those are what §11
-- is protecting, and every one of them is still unreachable through this domain.
--
-- The narrowing is recorded in `installer-jobs.md` §3.6. No table, column,
-- policy, grant or write path from Increment 6 is touched.
-- ===========================================================================

create function app._job_applicants()
returns table (
  application_id     uuid,
  job_id             uuid,
  status             public.job_application_status,
  note               text,
  applied_at         timestamptz,
  decided_at         timestamptz,
  decision_reason    text,
  display_name       text,
  headline           text,
  avatar_media_id    uuid,
  public_profile_id  uuid,
  years_experience   smallint,
  service_areas      text[],
  trade_keys         text[],
  primary_trade_key  text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.job_id, a.status, a.note, a.created_at, a.decided_at, a.decision_reason,
         p.display_name, p.headline, p.avatar_media_id,
         -- The link target, and null is the honest answer for a professional who
         -- has not published a profile. Returning `p.id` unconditionally would
         -- hand the UI a route that 404s.
         case
           when p.public_profile_status = 'listed'::public.public_profile_status
                and p.deleted_at is null
           then p.id
         end,
         io.prof_years_experience,
         io.prof_service_areas,
         coalesce(tr.keys, '{}'::text[]),
         tr.primary_key
  from public.job_applications a
  join public.jobs j on j.id = a.job_id
  join public.profiles p on p.user_id = a.applicant_user_id
  -- LEFT, and it is the common case: an installer may have declared no practice
  -- detail at all and their application must still appear.
  left join public.individual_onboarding io on io.user_id = a.applicant_user_id
  left join lateral (
    select array_agg(t.key order by ut.is_primary desc, t.sort_order, t.key) as keys,
           max(t.key) filter (where ut.is_primary)                           as primary_key
      from public.user_trades ut
      join public.trades t on t.id = ut.trade_id
     where ut.user_id = a.applicant_user_id
       and t.is_active
  ) tr on true
  -- The whole authority, and it is the same predicate job_applications' own RLS
  -- uses: membership of the POSTING organization. Reading applicants is not
  -- gated on job.manage — a colleague who cannot decide can still see the queue,
  -- exactly as chat lets a colleague read a thread they cannot answer.
  where app.is_org_member(j.poster_org_id)
    and (select auth.uid()) is not null;
$$;

comment on function app._job_applicants() is
  'Internal SECURITY DEFINER reader backing public.job_applicants. For jobs posted by an organization the CALLER is an active member of: the application (status, note, timestamps, decision reason) plus the applicant''s identity and self-declared practice. public_profile_id is non-null ONLY for a genuinely listed profile, so the UI links only where /p/[id] renders. NEVER contacts, phone, email, base address, travel radius, prof_availability, any consumer_* column, or applicant_user_id. Widens installer-jobs.md §11 from "join profile_public_directory" to "identity + the same practice columns", because that projection carries no user_id to join on and its listed-only filter would render most applicants anonymous (public_profile_status defaults to hidden).';

revoke execute on function app._job_applicants() from public;
grant  execute on function app._job_applicants() to authenticated, service_role;

create view public.job_applicants with (security_invoker = true) as
  select application_id, job_id, status, note, applied_at, decided_at, decision_reason,
         display_name, headline, avatar_media_id, public_profile_id,
         years_experience, service_areas, trade_keys, primary_trade_key
  from app._job_applicants();

comment on view public.job_applicants is
  'Poster-side applicants projection. security_invoker=true over the constrained SECURITY DEFINER reader app._job_applicants(); scoped to jobs the caller''s organization posted, with no parameter to point elsewhere. An applicant still never sees a competing application: this view returns nothing to a caller who is not a member of the posting organization. Read-only — every decision is still job_application_accept / job_application_reject.';

revoke all on public.job_applicants from anon, authenticated, service_role;
grant select on public.job_applicants to authenticated, service_role;

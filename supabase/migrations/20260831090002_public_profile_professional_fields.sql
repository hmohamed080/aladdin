-- ===========================================================================
-- Public professional profile — the four fields that make it honest
-- ===========================================================================
-- WHY. `/p/[profileId]` shipped in Increment 2 able to say a professional's name,
-- trade label, headline, summary and languages — and nothing about WHAT THEY DO.
-- A public installer profile with no specialization, no services and no service
-- areas is not a discovery surface; the `/b2b/technicians` directory that links
-- to it already shows more than the profile it opens.
--
-- WHAT CHANGES. `app._profile_public_directory()` gains four already-stored,
-- non-sensitive columns from `individual_onboarding`:
--
--   prof_specialization    — the trade the professional wrote for themselves
--   prof_services          — the core services they offer
--   prof_years_experience  — a single integer they entered
--   prof_service_areas     — the cities they work in
--
-- All four are values the professional supplied ABOUT THEIR PRACTICE for the
-- express purpose of being found, and all four are already visible to any
-- authenticated workspace user through the trade directory's own filters. None is
-- personal data.
--
-- WHAT DELIBERATELY DOES NOT CHANGE.
--   * NO new table, column, enum, bucket or storage concept. Every value already
--     exists; this projection simply stops hiding four of them.
--   * The listing predicate is UNTOUCHED — still `public_profile_status =
--     'listed'` (server-controlled, never self-set) AND a canonical persona AND an
--     active user AND not soft-deleted. Nothing becomes public that was not
--     already public; the same rows return, with more columns.
--   * `individual_onboarding` stays private. Its RLS is not altered and no policy
--     is added; the four columns arrive only through this constrained reader,
--     which selects those four and no others.
--   * NOT exposed, each for a reason: every `consumer_*` column (a different
--     person's shopping intent, and not professional practice at all);
--     `prof_availability` (out of scope by instruction — Availability is its own
--     increment); `prof_max_travel_km` and `prof_governorate`/`prof_city` (the
--     reference's distance/radius display is unapproved, and a base address is
--     closer to a home than to a service area); `prof_additional_services` (the
--     secondary list — the core services are what the public page needs, and the
--     smaller change is the right one); `professional_completed_at` and every
--     verification timestamp (process state, not profile content).
--
-- THE JOIN IS A LEFT JOIN, AND THAT IS THE WHOLE CORRECTNESS RISK HERE. A listed
-- professional need not have an `individual_onboarding` row at all — a seeded
-- Pilot account or an Admin-applied upgrade writes `users`/`profiles` without
-- ever touching the onboarding table. An inner join would have silently removed
-- those people from the technicians directory, the consultants directory and
-- their own public pages: a data-loss regression that no new-column test would
-- have caught, because every column asked about would have been correct on the
-- rows that survived. They keep appearing, with nulls in the four new columns.
--
-- Forward-only. The function's RETURNS TABLE signature changes, so — exactly as
-- 20260816090001 did — the dependent view and the function must be dropped and
-- recreated rather than replaced.

drop view public.profile_public_directory;
drop function app._profile_public_directory();

create function app._profile_public_directory()
returns table (
  id                  uuid,
  display_name        text,
  headline            text,
  bio                 text,
  avatar_media_id     uuid,
  locality_id         uuid,
  languages           text[],
  persona             public.persona_type,
  specialization      text,
  services            text[],
  years_experience    smallint,
  service_areas       text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.headline, p.bio,
         p.avatar_media_id, p.locality_id, p.languages,
         u.primary_account_type,
         io.prof_specialization,
         io.prof_services,
         io.prof_years_experience,
         io.prof_service_areas
  from public.profiles p
  join public.users u on u.id = p.user_id
  -- LEFT: a listed professional with no onboarding row must not disappear.
  left join public.individual_onboarding io on io.user_id = p.user_id
  where p.deleted_at is null
    and p.public_profile_status = 'listed'::public.public_profile_status
    and u.status = 'active'::public.user_status
    and u.primary_account_type is not null
    and u.primary_account_type <> 'end_consumer'::public.persona_type;
$$;

comment on function app._profile_public_directory() is
  'Internal SECURITY DEFINER reader backing public.profile_public_directory. Returns ONLY approved display columns of listed, active, non-deleted PERSONAL professional profiles: identity (name/headline/bio/languages), the persona that gates listing, and the four self-declared practice columns (specialization, core services, years of experience, service areas) LEFT JOINed from individual_onboarding. Never user_id, contacts, timestamps, deleted_at, availability, travel radius, base address, or any consumer_* column. A business-only identity (null persona) is never listed. Not in an exposed schema; PUBLIC execute revoked.';

-- DROP destroyed the previous ACL, so the full grant set must be reasserted here,
-- not just the revoke: the view is security_invoker, which means the CALLER needs
-- EXECUTE on this reader. Reasserting only the revoke would leave the directory
-- readable by nobody (42501 for every caller, anon and authenticated alike).
revoke execute on function app._profile_public_directory() from public;
grant  execute on function app._profile_public_directory() to anon, authenticated, service_role;

create view public.profile_public_directory
  with (security_invoker = true) as
  select id, display_name, headline, bio, avatar_media_id, locality_id, languages,
         persona, specialization, services, years_experience, service_areas
  from app._profile_public_directory();

comment on view public.profile_public_directory is
  'Approved PUBLIC projection of professional profiles for discovery. security_invoker=true view over the constrained SECURITY DEFINER reader app._profile_public_directory(). Requires listed + active + not-deleted + a professional persona. Exposes the persona so callers can filter (e.g. installer_technician for the Technicians directory), plus the self-declared practice fields the public profile page renders; never user_id/contacts/timestamps/deleted_at/availability/address.';

revoke all on public.profile_public_directory from anon, authenticated, service_role;
grant select on public.profile_public_directory to anon, authenticated, service_role;

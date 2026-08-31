-- ===========================================================================
-- Availability (D6) — persisted, user-controlled, and nobody else's to change
-- ===========================================================================
-- WHAT THIS IS. Two columns on `public.profiles` holding one fact a professional
-- states about themselves: am I taking work right now, and when did I last say
-- so. §8 of `docs/database/installer-jobs.md`.
--
-- WHAT IT IS NOT (§8.2), because every one of these has a column that looks like
-- it and means something else: not online presence, not Realtime presence, not a
-- calendar, not shifts, and NOT AN AUTHORIZATION BOUNDARY. Nothing reads
-- `available_for_work` to decide what anybody may do. It gates no route, no RPC,
-- no policy and no capability. It is a claim displayed to humans who then decide
-- for themselves, which is the whole design.
--
-- IT IS ALSO NOT `individual_onboarding.prof_availability`, and the two must not
-- be conflated. That column is a LEAD TIME the professional picked once during
-- onboarding — `within_week` / `within_month` / `flexible`, "how soon could you
-- start". This one is a live on/off state they flip whenever it changes. A person
-- can honestly be `flexible` and not currently available, or `within_month` and
-- available today. Both are kept, separately, and the UI labels them differently.
--
-- ---------------------------------------------------------------------------
-- THE WRITE PATH, AND THE ONE PLACE THIS DEPARTS FROM §8.1
-- ---------------------------------------------------------------------------
-- §8.1 says the columns join the existing narrow `grant update` on `profiles`
-- "so the user controls it directly — no RPC needed". The grant is the right
-- shape and there is no RPC here. But the grant covers `available_for_work`
-- ALONE. `availability_updated_at` is deliberately NOT client-writable, and the
-- reason is O3 itself.
--
-- O3 forbids expiring the flag because that would be the platform asserting
-- something the person never said. It keeps the timestamp so a READER can weigh
-- staleness for themselves. A client-writable timestamp defeats exactly that: a
-- professional could re-stamp `availability_updated_at = now()` forever without
-- ever revisiting whether the claim is still true, and the one signal a poster
-- has for judging it would become the one thing most worth faking. The same
-- failure O3 guards against, inverted — the platform would not be manufacturing
-- state, but it would be publishing a freshness claim nobody actually made.
--
-- So the timestamp is stamped by a trigger, from `now()`, on every change. It
-- records WHEN THE VALUE CHANGED, which is the only thing it is displayed as
-- meaning. This is narrower than granting both columns and strictly safer, and it
-- satisfies §8.1's table ("Stamped on every change") more literally than a client
-- write would. §8.1's grant sentence needs one line of reconciliation.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A CHECK IN THE ACTION
-- ---------------------------------------------------------------------------
-- Non-professional rejection is enforced at the COLUMN, in the database, for the
-- same reason Increment 1 put the Sales guard on `app.membership_grant_sales`
-- instead of on each door: a rule that lives at the chokepoint is structural,
-- while a rule repeated at every entry point is a list somebody must remember to
-- keep adding to. `profiles_update_self` already restricts the ROW to its owner;
-- this trigger restricts CLAIMING the column to a professional identity. Any
-- writer that reaches it — this increment's Server Action, a future settings
-- screen, a future RPC, psql — passes through the same check.
--
-- Forward-only. New columns, one new trigger function, one trigger, one grant,
-- and the §8.4 projection widening. No existing function body changes.

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column available_for_work      boolean not null default false,
  add column availability_updated_at timestamptz;

comment on column public.profiles.available_for_work is
  'Self-declared: is this professional currently taking work. NOT presence, not a schedule, not an authorization boundary — nothing reads it to decide access. Never expires (O3): only the person changes it, and no job, cron, trigger or query may flip it to false. Distinct from individual_onboarding.prof_availability, which is a one-off lead-time preference.';

comment on column public.profiles.availability_updated_at is
  'When available_for_work last CHANGED. Stamped by app.stamp_availability(); not in any client grant, because a forgeable freshness signal is worse than none — it is displayed so a reader can judge staleness themselves (O3). NULL means the professional has never set availability, which is displayed as such rather than as "false, a long time ago".';

-- ---------------------------------------------------------------------------
-- 2. The guard + the stamp
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because it calls `app.is_professional_persona`, whose EXECUTE
-- is revoked from `authenticated` — the predicate is internal by design, and a
-- trigger running as the invoking user could not call it.
--
-- The WHEN clause is what keeps this narrow: the function runs ONLY when
-- `available_for_work` actually changes. Editing a headline, a bio, languages or
-- soft-deleting a row never enters it, so `individual_save_professional` and
-- every other existing writer are completely unaffected.
create or replace function app.stamp_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Availability is professional state. A consumer CLAIMING it would be
  -- meaningless rather than dangerous — the public directory excludes them, so
  -- nothing would ever display it — but "meaningless" is how a column quietly
  -- acquires a second meaning later. Refused at the write instead.
  --
  -- THE GUARD IS ONLY ON CLAIMING IT, not on withdrawing it. Refusing every
  -- change would trap a stale `true`: an identity that stops being a professional
  -- while marked available could never turn it off again, and the platform would
  -- keep publishing a claim the person is no longer allowed to retract. Turning
  -- availability OFF is always permitted, for anyone, on their own row — there is
  -- no state in which "I am not taking work" is a claim worth refusing.
  if new.available_for_work and not app.is_professional_persona(new.user_id) then
    raise exception 'a professional account is required to set availability'
      using errcode = '42501';
  end if;

  -- The timestamp is DERIVED, never accepted. Whatever the writer supplied is
  -- discarded, so there is no path — grant, RPC, or superuser — by which the
  -- stamp can disagree with the change it records.
  new.availability_updated_at := now();
  return new;
end;
$$;

comment on function app.stamp_availability() is
  'BEFORE UPDATE trigger on public.profiles, fired ONLY when available_for_work changes. Refuses a non-professional identity that tries to CLAIM availability (42501); WITHDRAWING it is always allowed, so an identity that stops being a professional cannot be trapped at true. Always overwrites availability_updated_at with now(), so the timestamp records the change it names and can never be supplied by a caller. SECURITY DEFINER so it can call the internal app.is_professional_persona predicate.';

revoke execute on function app.stamp_availability() from public, anon, authenticated, service_role;

create trigger stamp_profiles_availability
  before update on public.profiles
  for each row
  when (new.available_for_work is distinct from old.available_for_work)
  execute function app.stamp_availability();

-- ---------------------------------------------------------------------------
-- 3. The grant — one column, added to the existing narrow update grant
-- ---------------------------------------------------------------------------
-- `grant update (col)` is additive per column, so this leaves the existing
-- display_name/headline/bio/avatar_media_id/locality_id/languages/deleted_at
-- grant from `20260802090001` exactly as it was.
--
-- `availability_updated_at` is POINTEDLY absent. See the header.
grant update (available_for_work) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 4. §8.4 — the public projection
-- ---------------------------------------------------------------------------
-- A poster browsing `/b2b/technicians` must see the same state the installer
-- set, and the public profile page must be able to show its age. Both columns go
-- into the projection; neither is personal data, and both are things the person
-- published about their own practice.
--
-- The listing predicate does NOT move. The same rows return with two more
-- columns — availability is not a discovery filter here and gates nothing. A
-- professional who is unavailable stays listed and stays findable; hiding them
-- would be the platform deciding that "not right now" means "not at all", which
-- is precisely the inference O3 refuses to make on their behalf.
--
-- Forward-only, and the same dance `20260831090002` performed for the same
-- reason: the RETURNS TABLE signature changes, so the dependent view and the
-- function must be dropped and recreated. DROP destroys the ACL, so the full
-- grant set is reasserted below — reasserting only the revoke would leave the
-- directory readable by nobody.
drop view public.profile_public_directory;
drop function app._profile_public_directory();

create function app._profile_public_directory()
returns table (
  id                      uuid,
  display_name            text,
  headline                text,
  bio                     text,
  avatar_media_id         uuid,
  locality_id             uuid,
  languages               text[],
  persona                 public.persona_type,
  specialization          text,
  services                text[],
  years_experience        smallint,
  service_areas           text[],
  available_for_work      boolean,
  availability_updated_at timestamptz
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
         io.prof_service_areas,
         p.available_for_work,
         p.availability_updated_at
  from public.profiles p
  join public.users u on u.id = p.user_id
  -- LEFT: a listed professional with no onboarding row must not disappear.
  -- (`20260831090002` — the seeded Pilot professionals are exactly that case.)
  left join public.individual_onboarding io on io.user_id = p.user_id
  where p.deleted_at is null
    and p.public_profile_status = 'listed'::public.public_profile_status
    and u.status = 'active'::public.user_status
    and u.primary_account_type is not null
    and u.primary_account_type <> 'end_consumer'::public.persona_type;
$$;

comment on function app._profile_public_directory() is
  'Internal SECURITY DEFINER reader backing public.profile_public_directory. Returns ONLY approved display columns of listed, active, non-deleted PERSONAL professional profiles: identity (name/headline/bio/languages), the persona that gates listing, the four self-declared practice columns LEFT JOINed from individual_onboarding, and self-declared availability with the timestamp of its last change. Never user_id, contacts, created_at/updated_at, deleted_at, travel radius, base address, prof_availability (the private lead-time preference), or any consumer_* column. A business-only identity (null persona) is never listed. Not in an exposed schema; PUBLIC execute revoked.';

revoke execute on function app._profile_public_directory() from public;
grant  execute on function app._profile_public_directory() to anon, authenticated, service_role;

create view public.profile_public_directory
  with (security_invoker = true) as
  select id, display_name, headline, bio, avatar_media_id, locality_id, languages,
         persona, specialization, services, years_experience, service_areas,
         available_for_work, availability_updated_at
  from app._profile_public_directory();

comment on view public.profile_public_directory is
  'Approved PUBLIC projection of professional profiles for discovery. security_invoker=true view over the constrained SECURITY DEFINER reader app._profile_public_directory(). Requires listed + active + not-deleted + a professional persona. Exposes the persona so callers can filter, the self-declared practice fields the public profile page renders, and availability + when it last changed (displayed so a reader can judge staleness themselves — it never filters or gates anything). Never user_id/contacts/timestamps/deleted_at/address.';

revoke all on public.profile_public_directory from anon, authenticated, service_role;
grant select on public.profile_public_directory to anon, authenticated, service_role;

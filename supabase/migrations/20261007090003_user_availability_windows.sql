-- ===========================================================================
-- Installer Jobs — availability WINDOWS
--
-- `profiles.available_for_work` says "am I taking work right now". It cannot say
-- WHEN. A window can: "I am free from this date to that date" (open-ended when
-- available_to is NULL). Windows are declared by the person, about themselves,
-- and are compared against a job's real planned execution period by
-- app.job_match_for — nothing is inferred (no "no conflicting assignment means
-- free", no onboarding lead time).
--
--   public.user_availability_windows (user_id, available_from, available_to NULL)
--
-- RLS: a person manages ONLY their own windows (select / insert / update / delete
-- all keyed by auth.uid()); platform support may read. Only a professional
-- identity may CLAIM availability — the same rule the available_for_work flag
-- already enforces — and the number of windows is bounded.
--
-- Overlapping or touching windows are legal and are treated as their UNION when
-- compared (a multirange), so splitting a fortnight into two entries cannot make
-- a job inside it look uncovered.
--
-- NOT AN AUTHORIZATION BOUNDARY (docs/database/installer-jobs.md §8.2). Nothing
-- reads a window to decide what anybody may do.
-- ===========================================================================

create table public.user_availability_windows (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null references public.users(id) on delete cascade,
  available_from date        not null,
  available_to   date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ck_user_availability_order check (available_to is null or available_to >= available_from)
);

create index ix_user_availability_windows_user on public.user_availability_windows (user_id, available_from);

create trigger set_user_availability_windows_updated_at
  before update on public.user_availability_windows
  for each row execute function app.set_updated_at();

comment on table public.user_availability_windows is
  'Date windows a PERSON declares themselves available for work (available_to NULL = open-ended). Own rows only (RLS). Compared against a job''s planned execution period by app.job_match_for; overlapping windows count as their union. Not online presence, not a calendar of assignments, not an authorization boundary.';

create or replace function app.guard_availability_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_professional_persona(new.user_id) then
    raise exception 'only a professional identity may declare availability' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.user_availability_windows w where w.user_id = new.user_id) >= 50 then
    raise exception 'too many availability windows' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke execute on function app.guard_availability_window() from public, anon, authenticated;

create trigger guard_user_availability_window
  before insert or update on public.user_availability_windows
  for each row execute function app.guard_availability_window();

alter table public.user_availability_windows enable row level security;

create policy user_availability_windows_select_self on public.user_availability_windows
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_availability_windows_insert_self on public.user_availability_windows
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_availability_windows_update_self on public.user_availability_windows
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy user_availability_windows_delete_self on public.user_availability_windows
  for delete to authenticated using (user_id = (select auth.uid()));
create policy user_availability_windows_select_platform on public.user_availability_windows
  for select to authenticated using (app.is_platform('support'));

revoke all on public.user_availability_windows from anon, authenticated, service_role;
grant select, delete                              on public.user_availability_windows to authenticated, service_role;
grant insert (user_id, available_from, available_to) on public.user_availability_windows to authenticated;
grant update (available_from, available_to)          on public.user_availability_windows to authenticated;

-- ---------------------------------------------------------------------------
-- Availability is a THREE-state fact: available, unavailable, or NOT DECLARED
--
-- `profiles.available_for_work` is NOT NULL DEFAULT false, so the boolean alone cannot tell "I said no" from "I
-- never said". The authoritative marker is the column that already exists for exactly that purpose,
-- `profiles.availability_updated_at` (20260831090004: NULL means the professional has never set availability):
--
--     available_for_work = true                                 AVAILABLE    a true can only ever be a choice
--     available_for_work = false AND availability_updated_at    UNAVAILABLE  explicitly declared
--                                              IS NOT NULL
--     available_for_work = false AND availability_updated_at    NOT DECLARED the default nobody touched
--                                              IS NULL
--
-- One gap is closed here. The stamp trigger fired only when the VALUE changed, so the very first explicit "I am not
-- available" (false -> false) left the timestamp NULL and was indistinguishable from never answering. The trigger
-- now also fires on the first write to the column from an undeclared row. It is still `UPDATE OF available_for_work`,
-- so no other writer (a headline edit, a soft delete) ever enters it, and the stamp is still derived, never accepted.
--
-- Nothing is inferred from `false`. Overall Match reads this three-way state (20261007090005): NOT DECLARED is never
-- scored as UNAVAILABLE.
-- ---------------------------------------------------------------------------
drop trigger stamp_profiles_availability on public.profiles;

create trigger stamp_profiles_availability
  before update of available_for_work on public.profiles
  for each row
  when (new.available_for_work is distinct from old.available_for_work or old.availability_updated_at is null)
  execute function app.stamp_availability();

comment on column public.profiles.availability_updated_at is
  'When the professional last DECLARED availability: stamped by app.stamp_availability() on a change, and on the first explicit declaration even when it equals the default (so "unavailable" can be told apart from "never said"). NULL means NOT DECLARED — the person has never set availability. Not in any client grant, because a forgeable freshness signal is worse than none; it is displayed so a reader can judge staleness themselves (O3).';

comment on function app.stamp_availability() is
  'BEFORE UPDATE OF available_for_work trigger on public.profiles, fired when the value changes OR when the row has never declared availability. Refuses a non-professional identity that tries to CLAIM availability (42501); WITHDRAWING it is always allowed. Always overwrites availability_updated_at with now(), so the timestamp records the declaration it names and can never be supplied by a caller. SECURITY DEFINER so it can call the internal app.is_professional_persona predicate.';

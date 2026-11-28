-- ===========================================================================
-- Profile birth date and gender (personal details).
--
-- Two optional, self-only profile attributes. profiles is a private base
-- table (own-row select only; authenticated has no blanket UPDATE grant), so
-- neither column is readable by other callers or exposed by the public
-- directory view. The only write path is public.profile_set_personal_details,
-- which validates and clears either value (NULL = not provided).
-- ===========================================================================

alter table public.profiles
  add column birth_date date,
  add column gender text;

alter table public.profiles
  add constraint ck_profiles_gender_values check (gender is null or gender in ('female', 'male')),
  add constraint ck_profiles_birth_date_floor check (birth_date is null or birth_date >= date '1900-01-01');

comment on column public.profiles.birth_date is
  'Optional, self-reported. Private: never part of any public projection. Written only by public.profile_set_personal_details.';
comment on column public.profiles.gender is
  'Optional, self-reported: female | male | NULL (not provided). Private. Written only by public.profile_set_personal_details.';

create or replace function public.profile_set_personal_details(p_birth_date date, p_gender text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_gender text := nullif(btrim(coalesce(p_gender, '')), '');
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then
    raise exception 'birth date is out of range' using errcode = '22023';
  end if;
  if v_gender is not null and v_gender not in ('female', 'male') then
    raise exception 'unsupported gender value' using errcode = '22023';
  end if;

  update public.profiles
    set birth_date = p_birth_date,
        gender = v_gender
    where user_id = v_uid;

  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;
end;
$$;
comment on function public.profile_set_personal_details(date, text) is
  'The only write path for profiles.birth_date and profiles.gender. Either value may be NULL to clear it.';
revoke execute on function public.profile_set_personal_details(date, text) from public;
grant execute on function public.profile_set_personal_details(date, text) to authenticated;

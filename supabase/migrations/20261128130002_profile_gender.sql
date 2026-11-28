-- ===========================================================================
-- Profile gender (personal details).
--
-- One optional, self-only profile attribute. profiles is a private base table
-- (own-row select only; authenticated has no blanket UPDATE grant), so the
-- column is not readable by other callers or exposed by the public directory
-- view. The only write path is public.profile_set_gender, which validates the
-- value (NULL or empty = not provided).
-- ===========================================================================

alter table public.profiles
  add column gender text;

alter table public.profiles
  add constraint ck_profiles_gender_values check (gender is null or gender in ('female', 'male'));

comment on column public.profiles.gender is
  'Optional, self-reported: female | male | NULL (not provided). Private. Written only by public.profile_set_gender.';

create or replace function public.profile_set_gender(p_gender text)
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
  if v_gender is not null and v_gender not in ('female', 'male') then
    raise exception 'unsupported gender value' using errcode = '22023';
  end if;

  update public.profiles
    set gender = v_gender
    where user_id = v_uid;

  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;
end;
$$;
comment on function public.profile_set_gender(text) is
  'The only write path for profiles.gender. NULL or empty clears it.';
revoke execute on function public.profile_set_gender(text) from public;
grant execute on function public.profile_set_gender(text) to authenticated;

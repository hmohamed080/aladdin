-- ===========================================================================
-- Installer Jobs — the canonical SERVICE-AREA authority
--
-- Until now a professional's service location was one governorate plus a few
-- cities inside it, stored as free keys on individual_onboarding
-- (prof_governorate / prof_city / prof_service_areas). That cannot say "I also
-- work in Giza". This table can.
--
--   public.user_service_areas   one row per declared area:
--       (user_id, governorate_key, city_key)   city_key NULL = the WHOLE governorate
--       is_primary                             exactly one governorate row per
--                                              person: where they are based
--
-- KEYS COME FROM THE EXISTING CATALOGUE (app.place_governorates / app.place_cities,
-- generated from frontend/src/lib/installer/location-data.ts). No new taxonomy; the
-- writer validates every key against it, because the catalogue's composite key
-- (a name per row) cannot be a foreign-key target.
--
-- WRITE PATH: `user_service_areas_set`, SECURITY DEFINER, keyed by auth.uid().
-- Reads: own rows, plus platform support. Nothing here is an authorization input.
--
-- COMPATIBILITY WITH ONBOARDING. The old columns stay, because onboarding and
-- the profile editor still write them and the public projection still reads
-- them. They are kept in step both ways:
--   * legacy -> canonical: a trigger on individual_onboarding rebuilds ONLY the
--     primary-governorate group (primary row + its cities); areas the person
--     declared in OTHER governorates are never touched by a legacy save;
--   * canonical -> legacy: the writer mirrors the primary governorate and its
--     cities back, with the trigger switched off for that one statement.
-- The CANONICAL table is the source Overall Match and Near Me read.
-- ===========================================================================

create table public.user_service_areas (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users(id) on delete cascade,
  governorate_key text        not null,
  city_key        text,
  is_primary      boolean     not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ck_user_service_areas_gov_shape  check (governorate_key ~ '^[a-z][a-z0-9-]*$' and char_length(governorate_key) <= 64),
  constraint ck_user_service_areas_city_shape check (city_key is null or (city_key ~ '^[a-z][a-z0-9-]*$' and char_length(city_key) <= 64)),
  -- The primary row is the GOVERNORATE-level row: where the person is based.
  constraint ck_user_service_areas_primary_is_governorate check (not is_primary or city_key is null)
);

create unique index ux_user_service_areas_place
  on public.user_service_areas (user_id, governorate_key, coalesce(city_key, ''));
create unique index ux_user_service_areas_one_primary
  on public.user_service_areas (user_id) where is_primary;

create trigger set_user_service_areas_updated_at
  before update on public.user_service_areas
  for each row execute function app.set_updated_at();

comment on table public.user_service_areas is
  'The areas a PERSON declares they work in, as catalogue keys: (governorate, city) with city NULL meaning the whole governorate. Exactly one is_primary governorate row (where they are based). Written ONLY through user_service_areas_set (or mirrored from onboarding by a trigger). The source Overall Match and Near Me read. No km, no coordinates.';

alter table public.user_service_areas enable row level security;

create policy user_service_areas_select_self on public.user_service_areas
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_service_areas_select_platform on public.user_service_areas
  for select to authenticated using (app.is_platform('support'));

revoke all    on public.user_service_areas from anon, authenticated, service_role;
grant  select on public.user_service_areas to   authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Legacy onboarding -> canonical rows (the primary-governorate group only)
-- ---------------------------------------------------------------------------
create or replace function app.rebuild_primary_service_area(
  p_user_id uuid, p_governorate text, p_city text, p_areas text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gov text := app.resolve_governorate(p_governorate);
  v_old text;
begin
  if v_gov is null then
    return;
  end if;

  -- Replace the group this save speaks for: the whole OLD primary governorate group (its row and its
  -- cities) and the new governorate's rows. Areas in any other governorate are never touched.
  select a.governorate_key into v_old from public.user_service_areas a where a.user_id = p_user_id and a.is_primary;
  delete from public.user_service_areas
   where user_id = p_user_id
     and governorate_key in (v_gov, coalesce(v_old, v_gov));

  insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary)
  values (p_user_id, v_gov, null, true);

  insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary)
  select p_user_id, v_gov, c, false
  from (
    select distinct app.resolve_city(v_gov, x) as c
    from unnest(coalesce(p_areas, '{}'::text[]) || array[p_city]) as x
  ) s
  where c is not null and c <> 'other';
end;
$$;

revoke execute on function app.rebuild_primary_service_area(uuid, text, text, text[]) from public, anon, authenticated;

create or replace function app.sync_service_areas_from_onboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The canonical writer mirrors INTO onboarding and switches this off for that statement.
  if coalesce(current_setting('app.service_areas_sync', true), 'on') = 'off' then
    return new;
  end if;
  perform app.rebuild_primary_service_area(new.user_id, new.prof_governorate, new.prof_city, new.prof_service_areas);
  return new;
end;
$$;

revoke execute on function app.sync_service_areas_from_onboarding() from public, anon, authenticated;

create trigger sync_service_areas_from_onboarding
  after insert or update of prof_governorate, prof_city, prof_service_areas on public.individual_onboarding
  for each row execute function app.sync_service_areas_from_onboarding();

-- Backfill: every person whose current service location the catalogue can vouch for. Unresolvable values
-- are skipped — nothing is guessed.
do $$
declare
  r record;
begin
  for r in
    select user_id, prof_governorate, prof_city, prof_service_areas
    from public.individual_onboarding
    where app.resolve_governorate(prof_governorate) is not null
  loop
    perform app.rebuild_primary_service_area(r.user_id, r.prof_governorate, r.prof_city, r.prof_service_areas);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The ONLY client writer: the COMPLETE set replaces what the caller declared.
--
--   p_primary_governorate_key   where they are based; required whenever any area is given
--   p_areas                     jsonb array of {"governorate_key": "...", "city_key": "..."|null}
--
--   unknown governorate / city, or a city outside its governorate  -> 22023, whole call refused
--   duplicates and areas already implied by the primary row         -> converge, never error
--   empty / null set                                                -> every area removed
-- ---------------------------------------------------------------------------
create or replace function public.user_service_areas_set(
  p_primary_governorate_key text,
  p_areas                   jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_verified_caller();
  v_primary text := nullif(btrim(coalesce(p_primary_governorate_key, '')), '');
  v_elem    jsonb;
  v_g       text;
  v_c       text;
  v_cities  text[];
  v_first   text;
  v_any     boolean := false;
begin
  if not app.is_professional_persona(v_uid) then
    raise exception 'a professional account is required to declare service areas'
      using errcode = '42501';
  end if;
  if p_areas is not null and jsonb_typeof(p_areas) <> 'array' then
    raise exception 'service areas must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_areas, '[]'::jsonb)) > 100 then
    raise exception 'too many service areas' using errcode = '22023';
  end if;

  if v_primary is not null and not exists (select 1 from app.place_governorates where key = v_primary) then
    raise exception 'unknown governorate' using errcode = '22023';
  end if;

  for v_elem in select * from jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) loop
    v_g := nullif(btrim(coalesce(v_elem ->> 'governorate_key', '')), '');
    v_c := nullif(btrim(coalesce(v_elem ->> 'city_key', '')), '');
    if v_g is null or not exists (select 1 from app.place_governorates where key = v_g) then
      raise exception 'unknown governorate' using errcode = '22023';
    end if;
    if v_c is not null and not exists (select 1 from app.place_cities where governorate_key = v_g and key = v_c) then
      raise exception 'unknown city' using errcode = '22023';
    end if;
    v_any := true;
  end loop;

  if v_primary is null and v_any then
    raise exception 'a primary governorate is required' using errcode = '22023';
  end if;

  delete from public.user_service_areas where user_id = v_uid;

  insert into public.user_service_areas (user_id, governorate_key, city_key, is_primary)
  select distinct v_uid, x.g, x.c, (x.c is null and x.g = v_primary)
  from (
    select v_primary as g, null::text as c where v_primary is not null
    union
    select nullif(btrim(coalesce(e ->> 'governorate_key', '')), ''), nullif(btrim(coalesce(e ->> 'city_key', '')), '')
    from jsonb_array_elements(coalesce(p_areas, '[]'::jsonb)) e
  ) x;

  -- Mirror the primary group back to onboarding, with the legacy->canonical trigger off for this statement.
  if v_primary is not null then
    select coalesce(array_agg(city_key order by city_key), '{}'::text[]) into v_cities
      from public.user_service_areas
     where user_id = v_uid and governorate_key = v_primary and city_key is not null and city_key <> 'other';
    v_first := v_cities[1];
  else
    v_cities := '{}'::text[];
    v_first := null;
  end if;

  perform set_config('app.service_areas_sync', 'off', true);
  update public.individual_onboarding
     set prof_governorate = v_primary,
         prof_city = v_first,
         prof_service_areas = v_cities
   where user_id = v_uid;
  perform set_config('app.service_areas_sync', 'on', true);
end;
$$;

comment on function public.user_service_areas_set(text, jsonb) is
  'The ONLY client writer for public.user_service_areas. Replaces the caller''s COMPLETE set of areas atomically; every key is validated against the existing Egypt catalogue. Identity is auth.uid(); no user parameter. Mirrors the primary governorate group back to individual_onboarding for compatibility. Never an authorization input.';

revoke execute on function public.user_service_areas_set(text, jsonb) from public, anon;
grant  execute on function public.user_service_areas_set(text, jsonb) to   authenticated, service_role;

-- ===========================================================================
-- Account basics: phone, location (governorate + town) and specialties for
-- EVERY account type (owner request 2026-10-28, ADR-0026).
--
-- After sign-up, and once at the next sign-in for existing accounts, a person
-- who is missing any of the three sees one "Complete your account" screen.
-- Whatever the account already holds counts and is not asked again.
--
-- 1. public.profiles.governorate_key / city_key / city_custom_name — where the
--    account is based, on the one canonical Egypt place catalogue
--    (app.place_governorates / app.place_cities) and the SAME rule a branch
--    location uses (app.normalize_business_location). General location only:
--    never a street address. No client UPDATE grant: written only through
--    public.account_basics_set.
--
-- 2. public.user_specialties — the specialties a NON-professional account
--    picks (showroom, supplier, manufacturer, importer, personal ...), from
--    the canonical trade vocabulary (public.trades). Professionals keep using
--    public.user_trades through public.user_trades_set, unchanged: that table
--    stays the professional discovery signal and its persona rule (41_, 60_)
--    is not relaxed. Like user_trades this is a profile signal and NEVER an
--    authorization input: no RLS policy, capability or app.can_* predicate may
--    read it.
--
-- 3. public.account_basics_set — the one writer for (1) and (2).
--    public.my_account_basics — what the caller already holds, for the screen
--    and for the "is anything missing?" check. Phone stays on the existing
--    public.profile_set_phone path.
-- ===========================================================================

alter table public.profiles
  add column governorate_key  text,
  add column city_key         text,
  add column city_custom_name text,
  add constraint ck_profiles_city_requires_governorate
    check ((city_key is null and city_custom_name is null) or governorate_key is not null),
  add constraint ck_profiles_city_one_of
    check (city_key is null or city_custom_name is null),
  add constraint ck_profiles_city_key_not_other
    check (city_key is null or city_key <> 'other'),
  add constraint ck_profiles_city_custom_len
    check (city_custom_name is null or char_length(city_custom_name) between 2 and 80);

comment on column public.profiles.governorate_key is
  'Where the account is based: a governorate key of app.place_governorates. Written only by public.account_basics_set (normalized by app.normalize_business_location).';
comment on column public.profiles.city_key is
  'A city key of app.place_cities inside governorate_key, or null when city_custom_name is used.';
comment on column public.profiles.city_custom_name is
  'A town the catalogue does not list, typed through "Other" (2..80 chars); mutually exclusive with city_key.';

create table public.user_specialties (
  user_id    uuid        not null references public.users (id) on delete cascade,
  trade_id   uuid        not null references public.trades (id),
  is_primary boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, trade_id)
);

create unique index ux_user_specialties_one_primary on public.user_specialties (user_id) where is_primary;
create index ix_user_specialties_trade on public.user_specialties (trade_id);

comment on table public.user_specialties is
  'Specialties a NON-professional account picked at onboarding (ADR-0026), from public.trades. At most one is_primary. Written only by public.account_basics_set; no client write grant. A profile signal, never an authorization input. Professionals use public.user_trades instead.';

alter table public.user_specialties enable row level security;

create policy user_specialties_select_self on public.user_specialties
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_specialties_select_platform on public.user_specialties
  for select to authenticated
  using ((select app.is_platform('support')));

revoke all    on public.user_specialties from anon, authenticated, service_role;
grant  select on public.user_specialties to   authenticated, service_role;

-- ---------------------------------------------------------------------------
-- public.account_basics_set
-- ---------------------------------------------------------------------------
-- Each part is optional so the screen only sends what was missing:
--   p_governorate null            → location left as it is
--   p_specialties null            → specialties left as they are
-- A part that IS sent must be complete: a governorate with a town (or a typed
-- town), and at least one active specialty. The first specialty is primary.
create or replace function public.account_basics_set(
  p_governorate text,
  p_city        text,
  p_city_custom text,
  p_specialties text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_gov    text;
  v_city   text;
  v_custom text;
  v_keys   text[];
  v_ids    uuid[];
  v_key    text;
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  perform 1 from public.profiles where user_id = v_uid for update;
  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;

  if nullif(btrim(coalesce(p_governorate, '')), '') is not null then
    select l.o_governorate, l.o_city, l.o_custom into v_gov, v_city, v_custom
    from app.normalize_business_location(p_governorate, p_city, p_city_custom, true) l;
    update public.profiles
       set governorate_key  = v_gov,
           city_key         = v_city,
           city_custom_name = v_custom
     where user_id = v_uid;
  elsif nullif(btrim(coalesce(p_city, '')), '') is not null or nullif(btrim(coalesce(p_city_custom, '')), '') is not null then
    raise exception 'a city requires a governorate' using errcode = '22023';
  end if;

  if p_specialties is not null then
    -- Distinct, in the order given (the first one is the primary).
    select coalesce(array_agg(k order by first_pos), '{}') into v_keys
    from (
      select btrim(k) as k, min(pos) as first_pos
      from unnest(p_specialties) with ordinality as s(k, pos)
      where nullif(btrim(k), '') is not null
      group by btrim(k)
    ) d;
    if cardinality(v_keys) = 0 then
      raise exception 'choose at least one specialty' using errcode = '22023';
    end if;
    if cardinality(v_keys) > 30 then
      raise exception 'too many specialties' using errcode = '22023';
    end if;

    if app.is_professional_persona(v_uid) then
      -- The professional discovery signal keeps its one writer and its rules.
      perform public.user_trades_set(v_keys, null);
    else
      v_ids := '{}';
      foreach v_key in array v_keys loop
        select t.id into v_id from public.trades t where t.key = v_key and t.is_active;
        if v_id is null then
          raise exception 'unknown specialty' using errcode = '22023';
        end if;
        v_ids := v_ids || v_id;
      end loop;
      delete from public.user_specialties where user_id = v_uid;
      insert into public.user_specialties (user_id, trade_id, is_primary)
      select v_uid, ids.id, ids.pos = 1
      from unnest(v_ids) with ordinality as ids(id, pos);
    end if;
  end if;
end;
$$;

comment on function public.account_basics_set(text, text, text, text[]) is
  'Onboarding writer (ADR-0026): sets the caller''s profile location (catalogue-normalized, governorate + town required once sent) and/or specialties (>= 1 active trade key, first is primary). Professionals'' specialties go through public.user_trades_set; everyone else''s into public.user_specialties. A null part is left unchanged.';

revoke execute on function public.account_basics_set(text, text, text, text[]) from public, anon, service_role;
grant  execute on function public.account_basics_set(text, text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- public.my_account_basics
-- ---------------------------------------------------------------------------
-- What the caller already holds. Location falls back to the primary branch of
-- an organization the caller is an active member of, so a business that gave
-- its location in business onboarding is not asked again.
create or replace function public.my_account_basics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'phone', p.phone_e164,
    'governorate', coalesce(p.governorate_key, b.governorate_key),
    'city', case when p.governorate_key is not null then p.city_key else b.city_key end,
    'cityCustom', case when p.governorate_key is not null then p.city_custom_name else b.city_custom_name end,
    'specialties', coalesce((
      select jsonb_agg(s.key order by s.is_primary desc, s.sort_order, s.key)
      from (
        select t.key, bool_or(x.is_primary) as is_primary, min(t.sort_order) as sort_order
        from (
          select ut.trade_id, ut.is_primary from public.user_trades ut where ut.user_id = v_uid
          union all
          select us.trade_id, us.is_primary from public.user_specialties us where us.user_id = v_uid
        ) x
        join public.trades t on t.id = x.trade_id and t.is_active
        group by t.key
      ) s
    ), '[]'::jsonb)
  )
  into v_result
  from public.profiles p
  left join lateral (
    select br.governorate_key, br.city_key, br.city_custom_name
    from public.memberships m
    join public.branches br on br.id = m.primary_branch_id and br.deleted_at is null
    where m.user_id = v_uid and m.status = 'active' and br.governorate_key is not null
    order by m.created_at
    limit 1
  ) b on true
  where p.user_id = v_uid and p.deleted_at is null;

  return v_result;
end;
$$;

comment on function public.my_account_basics() is
  'The caller''s onboarding basics (ADR-0026): phone, location (profile, else the primary branch of an active membership) and active specialty keys (user_trades and user_specialties, primary first). Null when the caller has no profile.';

revoke execute on function public.my_account_basics() from public, anon, service_role;
grant  execute on function public.my_account_basics() to authenticated;

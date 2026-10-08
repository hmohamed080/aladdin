-- ===========================================================================
-- Installer Jobs — detailed SPECIALTIES, one level beneath a trade
--
-- A TRADE (public.trades) is the broad craft a person works in and a job requires.
-- A SPECIALTY is a detail INSIDE one trade ("within tiling: ..."). It is its own
-- table, strictly CHILD-OF-ONE-TRADE, so an exact match is the only relation there
-- is: a specialty is the same specialty or it is not. There is no related-specialty
-- graph, and no relation between specialties of different trades.
--
--   public.trade_specialties        reference data: (trade, key). Seeded by a later,
--                                   product-approved migration. THIS migration seeds
--                                   NOTHING — the schema exists with an empty
--                                   catalogue, and every surface stays hidden until
--                                   a trade has at least one specialty.
--   public.user_trade_specialties   the specialties one PERSON holds. A person may
--                                   hold a specialty only inside a trade they hold
--                                   (composite FK onto user_trades, ON DELETE CASCADE:
--                                   dropping a trade drops its specialties with it).
--   public.jobs.required_specialty_id   added by 20261007090004, an OPTIONAL requirement
--                                   whose trade must equal the job's trade.
--
-- WRITE PATH. Same posture as trades: reference data has no client write grant;
-- a person's own set is written ONLY by `user_trade_specialties_set`, SECURITY
-- DEFINER, keyed by auth.uid() — no user id parameter exists to spoof.
--
-- SPECIALTY IS NEVER AUTHORIZATION (O5). Nothing here gates discovery, a route,
-- an application or a policy; it only feeds the Overall Match presentation score.
-- ===========================================================================

create table public.trade_specialties (
  id         uuid        primary key default gen_random_uuid(),
  trade_id   uuid        not null references public.trades(id) on delete restrict,
  key        text        not null,
  is_active  boolean     not null default true,
  sort_order smallint    not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trade_specialties_key_shape check (
    char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$'
  ),
  -- A key is unique INSIDE its trade, not globally: two trades may each have an "other".
  constraint uq_trade_specialties_trade_key unique (trade_id, key),
  -- The composite-FK target that lets a child row prove "this specialty belongs to THIS trade".
  constraint uq_trade_specialties_trade_id unique (trade_id, id)
);

comment on table public.trade_specialties is
  'Detailed specialties, each belonging to exactly ONE trade (strict child-of-trade; exact matching only, no relation graph). Reference data: NO client write grant. Display names live in the i18n catalogs keyed by key, like trades. Seeded only by a product-approved migration; empty until then.';

create trigger set_trade_specialties_updated_at
  before update on public.trade_specialties
  for each row execute function app.set_updated_at();

create table public.user_trade_specialties (
  user_id      uuid        not null references public.users(id) on delete cascade,
  trade_id     uuid        not null,
  specialty_id uuid        not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, specialty_id),
  -- A person holds a specialty only inside a trade they hold; losing the trade loses its specialties.
  constraint fk_user_trade_specialties_user_trade
    foreign key (user_id, trade_id) references public.user_trades (user_id, trade_id) on delete cascade,
  -- ...and the specialty must really belong to that trade.
  constraint fk_user_trade_specialties_specialty
    foreign key (trade_id, specialty_id) references public.trade_specialties (trade_id, id) on delete restrict
);

create index ix_user_trade_specialties_specialty on public.user_trade_specialties (specialty_id);

comment on table public.user_trade_specialties is
  'The detailed specialties one PERSON holds, each inside a trade they hold (composite FK onto user_trades, cascading). Written ONLY through public.user_trade_specialties_set. Never an authorization input (O5).';

alter table public.trade_specialties      enable row level security;
alter table public.user_trade_specialties enable row level security;

-- Retired specialties are withheld from ordinary readers (a list nobody can see is a mistake nobody can make);
-- a person's OWN held rows stay readable below, retired or not, through the join in the editor query.
create policy trade_specialties_select_active on public.trade_specialties
  for select to authenticated using (is_active);

create policy trade_specialties_select_platform on public.trade_specialties
  for select to authenticated using (app.is_platform('support'));

create policy user_trade_specialties_select_self on public.user_trade_specialties
  for select to authenticated using (user_id = (select auth.uid()));

create policy user_trade_specialties_select_platform on public.user_trade_specialties
  for select to authenticated using (app.is_platform('support'));

revoke all    on public.trade_specialties      from anon, authenticated, service_role;
revoke all    on public.user_trade_specialties from anon, authenticated, service_role;
grant  select on public.trade_specialties      to   authenticated, service_role;
grant  select on public.user_trade_specialties to   authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The ONLY writer for a person's specialties: the COMPLETE set replaces what they held.
--
--   unknown id                         -> 22023, whole call refused
--   retired specialty not already held -> 22023 (a held one may be kept or dropped)
--   specialty of a trade not held      -> 22023 (declare the trade first)
--   duplicates                         -> deduplicated; converges, never errors
--   empty / null                       -> every specialty removed, and that is legal
-- ---------------------------------------------------------------------------
create or replace function public.user_trade_specialties_set(p_specialty_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_ids uuid[];
begin
  if not app.is_professional_persona(v_uid) then
    raise exception 'a professional account is required to declare specialties'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct i), '{}'::uuid[]) into v_ids
  from unnest(coalesce(p_specialty_ids, '{}'::uuid[])) as i
  where i is not null;

  if exists (
    select 1 from unnest(v_ids) as i
    where not exists (select 1 from public.trade_specialties s where s.id = i)
  ) then
    raise exception 'unknown specialty' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.trade_specialties s
    where s.id = any (v_ids)
      and not s.is_active
      and not exists (
        select 1 from public.user_trade_specialties u
        where u.user_id = v_uid and u.specialty_id = s.id
      )
  ) then
    raise exception 'specialty is not available' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.trade_specialties s
    where s.id = any (v_ids)
      and not exists (
        select 1 from public.user_trades ut
        where ut.user_id = v_uid and ut.trade_id = s.trade_id
      )
  ) then
    raise exception 'declare the trade before its specialties' using errcode = '22023';
  end if;

  delete from public.user_trade_specialties
   where user_id = v_uid and specialty_id <> all (v_ids);

  insert into public.user_trade_specialties (user_id, trade_id, specialty_id)
  select v_uid, s.trade_id, s.id
    from public.trade_specialties s
   where s.id = any (v_ids)
  on conflict (user_id, specialty_id) do nothing;
end;
$$;

comment on function public.user_trade_specialties_set(uuid[]) is
  'The ONLY writer for public.user_trade_specialties. Replaces the caller''s COMPLETE specialty set atomically. Caller identity is auth.uid(); no user parameter exists. Every specialty must be active (or already held) and sit inside a trade the caller holds. Never an authorization input.';

revoke execute on function public.user_trade_specialties_set(uuid[]) from public, anon;
grant  execute on function public.user_trade_specialties_set(uuid[]) to   authenticated, service_role;

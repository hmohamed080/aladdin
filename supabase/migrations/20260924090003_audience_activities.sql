-- ===========================================================================
-- Staging-prep Increment 3 — audience activities (org/persona subtypes) +
-- tradesperson specialization refresh
--
-- CORRECTED SCHEMA. An earlier draft used
--   check (audience_kind = 'organization_type' and audience_value in
--          (select unnest(enum_range(null::public.organization_type))::text))
-- which is not valid PostgreSQL — a CHECK constraint cannot contain a
-- subquery. Replaced with two NULLABLE, TYPED columns (organization_type,
-- persona_type — the same live enums used everywhere else in this schema)
-- and a num_nonnulls() constraint requiring exactly one to be set. An invalid
-- audience value is now a type error at INSERT time, not a runtime
-- data-quality problem, and there is no free-text audience column anywhere.
--
-- Because both audience columns are nullable, `unique(organization_type, key)`
-- alone would NOT be enough — Postgres treats NULL <> NULL, so two different
-- persona-scoped rows (both organization_type = null) could collide on the
-- same key undetected. Two PARTIAL unique indexes, each scoped to the
-- audience it actually governs, close that gap.
--
-- SHOWROOM "موان" — CORRECTED MAPPING. An earlier draft mapped this concept
-- onto the same `distributor` key already used for Supplier. The product
-- owner confirmed these are different retail concepts (a Showroom's hardware/
-- paint/building-material/finishing-supplies retail activity vs. a Supplier's
-- wholesale distribution relationship), not the same concept merely
-- namespaced by org type — so Showroom gets its own distinctly-named key,
-- `building_and_finishing_supplies_retailer`, never `distributor`. The
-- Arabic user-facing label stays موان (an i18n string, not stored here).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tradespeople specializations — extend the existing public.trades table.
-- ---------------------------------------------------------------------------
-- The 14 product-approved specializations become the new active/selectable
-- list. The existing 7 (kitchens_doors, plumbing, electrical, hvac,
-- gypsum_paint, tiling, marble_granite) are RETIRED (is_active = false), not
-- deleted: every existing user_trades row referencing one keeps it, visible
-- and unchanged, but the key is never offered to a new selector again. No
-- key-to-key remapping is performed — there is no approved semantic mapping
-- from the old 7 to the new 14, and guessing one is explicitly out of scope.
insert into public.trades (key, sort_order) values
  ('wallpaper_installation',        110),
  ('gypsum_board_installation',     120),
  ('wood_alternative_installation', 130),
  ('marble_alternative_installation', 140),
  ('vinyl_flooring_installation',   150),
  ('hdf_flooring_installation',     160),
  ('painting',                      170),
  ('spray_paint_and_foundation',    180),
  ('decorative_paints',             190),
  ('astarji',                       200),
  ('plastering_and_gypsum',         210),
  ('epoxy_flooring',                220),
  ('door_installation',             230),
  ('foutek_installation',           240)
on conflict (key) do nothing;

update public.trades
   set is_active = false
 where key in ('kitchens_doors', 'plumbing', 'electrical', 'hvac',
               'gypsum_paint', 'tiling', 'marble_granite');

-- ---------------------------------------------------------------------------
-- 2. public.activities — org/persona subtypes, typed-column design
-- ---------------------------------------------------------------------------
create type public.activity_audience_kind as enum ('organization_type', 'persona_type');

create table public.activities (
  id                 uuid primary key default extensions.gen_random_uuid(),
  organization_type  public.organization_type,   -- non-null for an org-scoped activity, else null
  persona_type       public.persona_type,          -- non-null for a persona-scoped activity, else null
  key                text not null,
  is_active          boolean not null default true,
  sort_order         smallint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint activities_key_shape check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$'),
  -- Exactly one audience column set. No free-text audience-kind/value pair —
  -- an invalid enum literal fails at INSERT time as a type error.
  constraint activities_exactly_one_audience check (num_nonnulls(organization_type, persona_type) = 1)
);
comment on table public.activities is
  'Org/persona subtype vocabulary (Showroom/Supplier/Manufacturer/Importer activities, Engineer/Sales specializations). Exactly one of organization_type/persona_type is set per row (activities_exactly_one_audience) — never a free-text audience column. Reference data: seeded by migration, no client write grant. Same lifecycle discipline as public.trades (is_active retires a key without deleting history).';

-- Partial, not combined: with two nullable columns, NULL <> NULL under
-- Postgres uniqueness semantics, so a single unique(organization_type, key)
-- would silently allow two different persona-scoped rows (both
-- organization_type null) to collide on the same key.
create unique index uq_activities_org_key
  on public.activities (organization_type, key) where organization_type is not null;
create unique index uq_activities_persona_key
  on public.activities (persona_type, key) where persona_type is not null;

revoke all on public.activities from anon, authenticated, service_role;
grant select on public.activities to authenticated, anon;
alter table public.activities enable row level security;
create policy activities_select_active on public.activities
  for select to authenticated, anon using (is_active);

-- ---------------------------------------------------------------------------
-- 3. Seed rows
-- ---------------------------------------------------------------------------
insert into public.activities (organization_type, key, sort_order) values
  ('showroom_dealer', 'decor_showroom', 10),
  ('showroom_dealer', 'paint_showroom', 20),
  ('showroom_dealer', 'decor_and_paint_showroom', 30),
  -- موان — a distinct Showroom-scoped retail concept, never Supplier's
  -- `distributor`. Exact English key pending final product-owner sign-off;
  -- tracked as an open item (see plan file, "Open decisions").
  ('showroom_dealer', 'building_and_finishing_supplies_retailer', 40),
  ('supplier', 'distributor', 10),
  ('supplier', 'wholesaler', 20),
  ('manufacturer', 'paint_manufacturer', 10),
  ('manufacturer', 'decor_manufacturer', 20),
  ('importer', 'decor_supplies_importer', 10),
  ('importer', 'paint_importer', 20);

insert into public.activities (persona_type, key, sort_order) values
  ('engineer', 'finishing', 10),
  ('sales', 'sales_rep', 10),
  ('sales', 'sales_manager', 20);

-- ---------------------------------------------------------------------------
-- 4. organization_activities / user_activities — the assignment tables
-- ---------------------------------------------------------------------------
create table public.organization_activities (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  activity_id     uuid not null references public.activities(id) on delete restrict,
  created_at      timestamptz not null default now(),
  primary key (organization_id, activity_id)
);
comment on table public.organization_activities is
  'Whole-set-write assignment of activities to an organization. Written only via public.organization_activities_set — never a direct client INSERT/DELETE grant.';

create table public.user_activities (
  user_id     uuid not null references public.users(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (user_id, activity_id)
);
comment on table public.user_activities is
  'Whole-set-write assignment of activities to a person (persona-scoped). Written only via public.user_activities_set — never a direct client INSERT/DELETE grant.';

revoke all on public.organization_activities from anon, authenticated, service_role;
revoke all on public.user_activities from anon, authenticated, service_role;
alter table public.organization_activities enable row level security;
alter table public.user_activities enable row level security;

create policy organization_activities_select_member on public.organization_activities
  for select to authenticated using (
    exists (
      select 1 from public.memberships m
      where m.organization_id = organization_activities.organization_id
        and m.user_id = (select auth.uid())
        and m.status = 'active'
    )
  );
grant select on public.organization_activities to authenticated;

create policy user_activities_select_own on public.user_activities
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.user_activities to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Whole-set-write RPCs — same contract as public.user_trades_set: the
--    ENTIRE set is supplied every call, an unknown key refuses the whole
--    write, and inactive rows are never newly assignable.
-- ---------------------------------------------------------------------------
create or replace function public.organization_activities_set(
  p_org_id       uuid,
  p_activity_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_org_type public.organization_type;
  v_ids    uuid[];
  v_keys   text[];
begin
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'organization management authority is required' using errcode = '42501';
  end if;

  select o.org_type into v_org_type from public.organizations o where o.id = p_org_id;
  if v_org_type is null then
    raise exception 'organization not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(distinct btrim(k)), '{}'::text[])
    into v_keys
  from unnest(coalesce(p_activity_keys, '{}'::text[])) as u(k)
  where btrim(k) <> '';

  select coalesce(array_agg(a.id), '{}'::uuid[]) into v_ids
  from public.activities a
  where a.organization_type = v_org_type and a.key = any(v_keys) and a.is_active;

  if array_length(v_keys, 1) is distinct from array_length(v_ids, 1) then
    raise exception 'one or more activity keys are unknown or inactive for this organization type'
      using errcode = '22023';
  end if;

  delete from public.organization_activities where organization_id = p_org_id;
  insert into public.organization_activities (organization_id, activity_id)
  select p_org_id, unnest(v_ids)
  where array_length(v_ids, 1) is not null;

  perform app.record_audit_event('organization.activities_set', 'organization', p_org_id, p_org_id,
    jsonb_build_object('activity_keys', v_keys));
end;
$$;
comment on function public.organization_activities_set(uuid, text[]) is
  'Whole-set write of an organization''s activities. An unknown or inactive-for-this-org-type key refuses the ENTIRE write (no partial application). Requires the org.manage capability.';
revoke execute on function public.organization_activities_set(uuid, text[]) from public;
grant execute on function public.organization_activities_set(uuid, text[]) to authenticated;

create or replace function public.user_activities_set(
  p_activity_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_verified_caller();
  v_persona public.persona_type;
  v_ids     uuid[];
  v_keys    text[];
begin
  select u.primary_account_type into v_persona from public.users u where u.id = v_uid;

  select coalesce(array_agg(distinct btrim(k)), '{}'::text[])
    into v_keys
  from unnest(coalesce(p_activity_keys, '{}'::text[])) as u(k)
  where btrim(k) <> '';

  select coalesce(array_agg(a.id), '{}'::uuid[]) into v_ids
  from public.activities a
  where a.persona_type = v_persona and a.key = any(v_keys) and a.is_active;

  if array_length(v_keys, 1) is distinct from array_length(v_ids, 1) then
    raise exception 'one or more activity keys are unknown or inactive for this account type'
      using errcode = '22023';
  end if;

  delete from public.user_activities where user_id = v_uid;
  insert into public.user_activities (user_id, activity_id)
  select v_uid, unnest(v_ids)
  where array_length(v_ids, 1) is not null;

  perform app.record_audit_event('user.activities_set', 'user', v_uid, null,
    jsonb_build_object('activity_keys', v_keys));
end;
$$;
comment on function public.user_activities_set(text[]) is
  'Whole-set write of the caller''s own persona-scoped activities. An unknown or inactive-for-this-persona key refuses the ENTIRE write (no partial application).';
revoke execute on function public.user_activities_set(text[]) from public;
grant execute on function public.user_activities_set(text[]) to authenticated;

-- Migration: KPI card personalization for the Showroom Owner dashboard.
--
-- CONTEXT. The pinned inventory on the "Hana Showroom Owner dashboard
-- milestone" map confirms no preferences/settings table exists anywhere in
-- this schema — `membership_capabilities` is an AUTHORIZATION grant table
-- with a fixed check-constraint catalog, not a place to smuggle a display
-- preference. This is a new, narrow, additive table for exactly one concern:
-- which of the dashboard's eight known KPI cards a member sees, and in what
-- order — never a general-purpose settings blob, and never accepting a
-- free-text card identifier (see the enum below).
--
-- SHAPE. One row per (organization, membership) is the PERSONAL layout; one
-- row per organization with membership_id NULL is the TEAM DEFAULT. A
-- member with no personal row inherits the team default; an org with no
-- team-default row falls back to the application's own hardcoded system
-- default (the eight cards in their original showroom-dashboard.tsx order —
-- never duplicated into this table, so there is exactly one place that
-- default lives).
--
-- `card_order` is the array of ENABLED cards in display order — a card
-- absent from it is hidden, and the first six entries are the primary
-- (collapsed) row, the rest the secondary (Show more) row, matching the
-- Foundation completion pass's 6+2 grid exactly. This is deliberately ONE
-- column rather than separate "hidden"/"primary" flags: the ordering already
-- states both facts, and two representations of the same fact is how they
-- drift.
--
-- AUTHORIZATION, mirroring organization_update_i18n/branch_update_i18n
-- (20260914090001): no direct table grant to `authenticated` at all, only a
-- SELECT policy (RLS) plus four narrow SECURITY DEFINER RPCs for every
-- write. An ordinary member may only ever touch their OWN personal row;
-- setting or resetting the team default requires org.manage, the same
-- authority organization_update_i18n already requires for the org's own
-- record.

create type public.dashboard_kpi_card_key as enum (
  'overdue_followups',
  'due_today',
  'quotations_to_review',
  'open_purchase_requests',
  'orders_in_progress',
  'total_purchases',
  'projects',
  'saved_products'
);

comment on type public.dashboard_kpi_card_key is
  'The Showroom Owner dashboard''s allowlisted KPI card catalog — the ONLY values dashboard_kpi_layouts.card_order may ever contain. Extending the dashboard with a new built-in card means adding a value here, never accepting free text.';

create table public.dashboard_kpi_layouts (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- NULL = this organization's TEAM DEFAULT row. Non-null = one member's
  -- personal override, and it is the member's OWN row only — enforced by the
  -- RPCs below, never by a client-supplied membership id.
  membership_id   uuid references public.memberships(id) on delete cascade,
  card_order      public.dashboard_kpi_card_key[] not null,
  updated_by      uuid not null references public.memberships(id),
  updated_at      timestamptz not null default now(),
  constraint ck_dashboard_kpi_layouts_card_order_len check (cardinality(card_order) between 1 and 8)
);

comment on table public.dashboard_kpi_layouts is
  'Per-organization KPI card layout for the Showroom Owner dashboard. One NULL-membership row per org is the team default; one row per (org, membership) is that member''s personal override. Written only through dashboard_kpi_layout_* RPCs — see 20260915090001.';
comment on column public.dashboard_kpi_layouts.card_order is
  'Enabled cards in display order. First 6 = primary/collapsed row, the rest = secondary row revealed by Show more. A card key absent from this array is hidden. Duplicate-free and 1-8 long, enforced by the writing RPC (a subquery cannot appear in a CHECK constraint, so uniqueness is validated procedurally, not declaratively).';

create unique index uq_dashboard_kpi_layouts_team_default
  on public.dashboard_kpi_layouts (organization_id)
  where membership_id is null;

create unique index uq_dashboard_kpi_layouts_personal
  on public.dashboard_kpi_layouts (organization_id, membership_id)
  where membership_id is not null;

-- ---------------------------------------------------------------------------
-- RLS: read-only for authenticated callers. Every write goes through the
-- RPCs below, which run as the owning role and are therefore unaffected by
-- the absence of write policies here — the same shape organizations/branches
-- already use for their own i18n write paths.
-- ---------------------------------------------------------------------------
alter table public.dashboard_kpi_layouts enable row level security;

create policy dashboard_kpi_layouts_select_member on public.dashboard_kpi_layouts
  for select to authenticated
  using (
    app.is_org_member(organization_id)
    and (
      membership_id is null
      or membership_id in (
        select m.id from public.memberships m where m.user_id = (select auth.uid())
      )
    )
  );

-- RLS filters ROWS; the table also needs the coarse-grained privilege before
-- any row can be read at all. SELECT only — insert/update/delete stay
-- ungranted, so the RPCs above are the only door for writes.
grant select on public.dashboard_kpi_layouts to authenticated;

-- ---------------------------------------------------------------------------
-- Shared validation, called by every write RPC below — kept in one place so
-- the "1-8, no duplicates" rule cannot drift between them.
-- ---------------------------------------------------------------------------
create function app.validate_dashboard_kpi_card_order(p_card_order public.dashboard_kpi_card_key[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_card_order is null or cardinality(p_card_order) < 1 or cardinality(p_card_order) > 8 then
    raise exception 'card_order must list between 1 and 8 cards' using errcode = '22023';
  end if;
  if cardinality(p_card_order) <> (select count(distinct x) from unnest(p_card_order) x) then
    raise exception 'card_order must not repeat a card' using errcode = '22023';
  end if;
end;
$$;

comment on function app.validate_dashboard_kpi_card_order(public.dashboard_kpi_card_key[]) is
  'Shared 1-8-cards, no-duplicates guard for every dashboard_kpi_layout_* write RPC. The enum type itself is what forecloses an arbitrary/free-text card key — this only bounds length and repetition.';

-- ---------------------------------------------------------------------------
-- Personal layout — any active member may set/reset their OWN row.
-- ---------------------------------------------------------------------------
create function public.dashboard_kpi_layout_set_personal(
  p_org_id     uuid,
  p_card_order public.dashboard_kpi_card_key[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  perform app.validate_dashboard_kpi_card_order(p_card_order);

  select m.id into v_membership_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.organization_id = p_org_id
     and m.status = 'active';

  insert into public.dashboard_kpi_layouts (organization_id, membership_id, card_order, updated_by)
  values (p_org_id, v_membership_id, p_card_order, v_membership_id)
  on conflict (organization_id, membership_id) where membership_id is not null
  do update set card_order = excluded.card_order,
                updated_by = excluded.updated_by,
                updated_at = now();
end;
$$;

comment on function public.dashboard_kpi_layout_set_personal(uuid, public.dashboard_kpi_card_key[]) is
  'Upserts the CALLER''S OWN personal KPI layout for p_org_id — the target membership is always resolved server-side from auth.uid(), never accepted as a parameter, so one member can never write another''s row. Any active member may call this; it grants no authority beyond the caller''s own view.';

revoke execute on function public.dashboard_kpi_layout_set_personal(uuid, public.dashboard_kpi_card_key[]) from public;
grant execute on function public.dashboard_kpi_layout_set_personal(uuid, public.dashboard_kpi_card_key[]) to authenticated;

create function public.dashboard_kpi_layout_reset_personal(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  delete from public.dashboard_kpi_layouts
   where organization_id = p_org_id
     and membership_id in (
       select m.id from public.memberships m where m.user_id = (select auth.uid())
     );
end;
$$;

comment on function public.dashboard_kpi_layout_reset_personal(uuid) is
  'Deletes the caller''s own personal KPI layout row, if any — they then inherit the team default (or the system default, if the org has never set one). A no-op, not an error, when no personal row exists.';

revoke execute on function public.dashboard_kpi_layout_reset_personal(uuid) from public;
grant execute on function public.dashboard_kpi_layout_reset_personal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Team default — org.manage only, the same authority organization_update_i18n
-- already requires for this organization's own record.
-- ---------------------------------------------------------------------------
create function public.dashboard_kpi_layout_set_team_default(
  p_org_id     uuid,
  p_card_order public.dashboard_kpi_card_key[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership_id uuid;
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  perform app.validate_dashboard_kpi_card_order(p_card_order);

  select m.id into v_membership_id
    from public.memberships m
   where m.user_id = (select auth.uid())
     and m.organization_id = p_org_id
     and m.status = 'active';

  insert into public.dashboard_kpi_layouts (organization_id, membership_id, card_order, updated_by)
  values (p_org_id, null, p_card_order, v_membership_id)
  on conflict (organization_id) where membership_id is null
  do update set card_order = excluded.card_order,
                updated_by = excluded.updated_by,
                updated_at = now();
end;
$$;

comment on function public.dashboard_kpi_layout_set_team_default(uuid, public.dashboard_kpi_card_key[]) is
  'Sets the organization-wide default KPI layout. Requires org.manage — an ordinary member calling this is rejected before any row is touched (see 14_write_path_security_review_test.sql''s capability-escalation-guard pattern, mirrored for this RPC in 55_dashboard_kpi_layout_test.sql). Members with no personal override inherit this row.';

revoke execute on function public.dashboard_kpi_layout_set_team_default(uuid, public.dashboard_kpi_card_key[]) from public;
grant execute on function public.dashboard_kpi_layout_set_team_default(uuid, public.dashboard_kpi_card_key[]) to authenticated;

create function public.dashboard_kpi_layout_reset_team_default(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;

  delete from public.dashboard_kpi_layouts
   where organization_id = p_org_id
     and membership_id is null;
end;
$$;

comment on function public.dashboard_kpi_layout_reset_team_default(uuid) is
  'Deletes the organization''s team-default KPI layout row, if any — the org then falls back to the application''s hardcoded system default. Requires org.manage. A no-op, not an error, when no team-default row exists.';

revoke execute on function public.dashboard_kpi_layout_reset_team_default(uuid) from public;
grant execute on function public.dashboard_kpi_layout_reset_team_default(uuid) to authenticated;

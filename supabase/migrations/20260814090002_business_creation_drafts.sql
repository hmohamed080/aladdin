-- Migration: durable, resumable, IDEMPOTENT business creation
-- (Pilot Account & Workspace Model, Sprint 12).
--
-- `public.business_onboarding` is keyed `user_id primary key` — one draft per
-- person, forever. That shape encodes an assumption the approved account model
-- rejects: one login may own MANY businesses, created in independent sessions over
-- time (Ahmed: persona Engineer + AH Showroom + AH Import, one user id). It also
-- made the completion idempotency key the USER, so a second business could only
-- ever be created by destroying the record of the first.
--
--   * public.business_creation_drafts — one row per business-creation ATTEMPT.
--       A stable draft id is the resumption handle AND the idempotency key, and
--       `organization_id` is the canonical result. Values here are TEMPORARY: once
--       the organization exists, canonical business reads come from
--       `organizations` / `branches` / membership-owned tables, never from a draft.
--   * business_draft_save()   — create or update the caller's own OPEN draft.
--   * business_draft_submit() — validate, create transactionally, stamp the draft.
--       Retrying the SAME draft returns the SAME organization. Two DIFFERENT
--       drafts from the same user produce two different organizations.
--   * business_save/business_submit — kept as thin transitional wrappers over the
--       caller's open draft so any saved registration draft still resumes. There is
--       now exactly ONE persistence model behind both entry points.
--
-- The legacy `business_onboarding` table is NOT dropped and NOT emptied: its rows
-- are copied forward (deterministically, so the copy is idempotent) and left in
-- place. Nothing is destroyed.
--
-- No generic `workspaces` table exists or is added — a workspace stays derived.

-- ---------------------------------------------------------------------------
-- 1. business_creation_drafts
-- ---------------------------------------------------------------------------
create table public.business_creation_drafts (
  id                  uuid primary key default extensions.gen_random_uuid(),
  user_id             uuid not null references public.users (id) on delete cascade,

  -- Answers the base tables cannot hold BEFORE the organization exists.
  legal_name          text,
  display_name        text,
  org_type            public.account_type,
  description         text,
  governorate         text,
  city                text,
  primary_branch_name text,

  -- The canonical result. Set exactly once, by business_draft_submit.
  organization_id     uuid references public.organizations (id) on delete set null,
  completed_at        timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint ck_bcd_org_type check (
    org_type is null or org_type in
      ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler')
  ),
  constraint ck_bcd_legal_len  check (legal_name is null or char_length(legal_name) <= 120),
  constraint ck_bcd_display_len check (display_name is null or char_length(display_name) <= 120),
  constraint ck_bcd_desc_len   check (description is null or char_length(description) <= 1000),
  constraint ck_bcd_gov_len    check (governorate is null or char_length(governorate) <= 80),
  constraint ck_bcd_city_len   check (city is null or char_length(city) <= 80),
  constraint ck_bcd_branch_len check (primary_branch_name is null or char_length(primary_branch_name) <= 120),
  -- A completed draft always names its organization, and vice versa.
  constraint ck_bcd_completion check (
    (organization_id is null) = (completed_at is null)
  )
);
comment on table public.business_creation_drafts is 'One row per BUSINESS-CREATION ATTEMPT (Sprint 12). The draft id is both the resume handle and the idempotency key for creation: re-submitting a draft returns its existing organization, while a new draft yields a new organization. Draft values are TEMPORARY — after creation, canonical business data lives in organizations/branches/membership-owned tables. Self-owned; written only via the security-definer business_draft_* RPCs.';

create index ix_bcd_user on public.business_creation_drafts (user_id);
-- One draft can only ever have produced ONE organization, and no organization can
-- be claimed by two drafts. This is the structural guarantee behind "a network
-- retry never creates O2".
create unique index uq_bcd_organization
  on public.business_creation_drafts (organization_id)
  where organization_id is not null;
-- At most one OPEN draft per user, so "resume my business setup" is unambiguous
-- and a double-submitting client cannot fan out into parallel half-built drafts.
-- Completed drafts are unconstrained — that is what allows many businesses.
create unique index uq_bcd_open_per_user
  on public.business_creation_drafts (user_id)
  where completed_at is null;

create trigger set_bcd_updated_at
  before update on public.business_creation_drafts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Carry the existing drafts forward (idempotent)
-- ---------------------------------------------------------------------------
-- `id = user_id` makes the copy deterministic, so re-running this migration on a
-- database that already has it changes nothing. The source rows are left intact.
insert into public.business_creation_drafts (
  id, user_id, legal_name, display_name, org_type, description,
  governorate, city, primary_branch_name, organization_id, completed_at,
  created_at, updated_at
)
select bo.user_id, bo.user_id, bo.legal_name, bo.display_name, bo.org_type, bo.description,
       bo.governorate, bo.city, bo.primary_branch_name, bo.organization_id,
       -- Honour the completion invariant: a draft is complete iff it made an org.
       case when bo.organization_id is not null then coalesce(bo.completed_at, bo.updated_at) end,
       bo.created_at, bo.updated_at
from public.business_onboarding bo
on conflict (id) do nothing;

comment on table public.business_onboarding is 'SUPERSEDED by public.business_creation_drafts (Sprint 12). Retained read-only for history; its rows were copied forward. Not written by any current path.';

-- ===========================================================================
-- 3. business_draft_save — create or update the caller's OPEN draft
-- ===========================================================================
-- Returns the draft id so a client that started with none can keep working with a
-- stable handle. Passing a draft id that is not the caller's own, or that is
-- already completed, is refused — a completed draft is history, not a workspace.
create or replace function public.business_draft_save(
  p_draft_id            uuid default null,
  p_legal_name          text default null,
  p_display_name        text default null,
  p_org_type            public.account_type default null,
  p_description         text default null,
  p_governorate         text default null,
  p_city                text default null,
  p_primary_branch_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_id  uuid;
  v_completed timestamptz;
begin
  if p_org_type is not null and p_org_type not in
     ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler') then
    raise exception 'invalid business organization type' using errcode = '22023';
  end if;

  if p_draft_id is null then
    -- Reuse the caller's OPEN draft when one exists (uq_bcd_open_per_user), so a
    -- refresh mid-wizard resumes instead of forking.
    select d.id into v_id
    from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
  else
    select d.id, d.completed_at into v_id, v_completed
    from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
    if v_id is null then
      raise exception 'business draft not found' using errcode = '42501';
    end if;
    if v_completed is not null then
      raise exception 'this business has already been created' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into public.business_creation_drafts (
      user_id, legal_name, display_name, org_type, description,
      governorate, city, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      p_org_type,
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
      nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
      nullif(left(btrim(coalesce(p_city, '')), 80), ''),
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.business_creation_drafts set
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    org_type            = p_org_type,
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    city                = nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;

-- ===========================================================================
-- 4. business_draft_submit — transactional creation, idempotent per draft
-- ===========================================================================
-- The row lock plus the `organization_id is not null` short-circuit is the whole
-- idempotency story: request 1 creates O1; a network retry, a double-clicked
-- button and a third attempt all take the same lock, see O1, and return it. Two
-- concurrent submits of the same draft serialise on the lock, so the second sees
-- the first's result. A DIFFERENT draft is a different key and legitimately makes
-- a second organization.
--
-- The creator becomes Owner automatically — there is no "are you owner or
-- manager?" question, because Owner is the RELATIONSHIP created by the act of
-- creating the business. app.organization_create_owned does organization + owner
-- membership + owner capabilities + primary branch in ONE transaction; any failure
-- rolls the whole thing back, so a half-built business cannot exist.
create or replace function public.business_draft_submit(p_draft_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_d      public.business_creation_drafts;
  v_locale text;
  v_org_id uuid;
begin
  if p_draft_id is null then
    select * into v_d from public.business_creation_drafts d
    where d.user_id = v_uid and d.completed_at is null
    for update;
    -- No OPEN draft: the caller has already completed this creation and is
    -- retrying without a handle (the no-arg registration wrapper). Return their
    -- most recent result rather than erroring — and, crucially, rather than
    -- treating "nothing open" as licence to create another business. A caller who
    -- genuinely wants a second business opens a new draft first.
    if v_d.id is null then
      select * into v_d from public.business_creation_drafts d
      where d.user_id = v_uid and d.organization_id is not null
      order by d.completed_at desc
      limit 1;
    end if;
  else
    select * into v_d from public.business_creation_drafts d
    where d.id = p_draft_id and d.user_id = v_uid
    for update;
  end if;

  if v_d.id is null then
    raise exception 'business draft not found' using errcode = '42501';
  end if;

  -- IDEMPOTENT: this draft already produced its organization.
  if v_d.organization_id is not null then
    return v_d.organization_id;
  end if;

  if nullif(btrim(coalesce(v_d.display_name, '')), '') is null then
    raise exception 'a business name is required' using errcode = '22023';
  end if;
  if v_d.org_type is null then
    raise exception 'a business type is required' using errcode = '22023';
  end if;

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_d.display_name, v_d.org_type, coalesce(v_locale, 'en'), v_d.primary_branch_name);

  update public.business_creation_drafts
     set organization_id = v_org_id, completed_at = now()
   where id = v_d.id;

  -- Keep the superseded per-user row consistent for anything still reading it.
  update public.business_onboarding
     set organization_id = v_org_id, completed_at = now()
   where user_id = v_uid and organization_id is null;

  perform app.record_audit_event('onboarding.organization_created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', v_d.org_type, 'draft_id', v_d.id));
  return v_org_id;
end;
$$;

-- ===========================================================================
-- 5. Transitional wrappers — the registration draft keeps resuming
-- ===========================================================================
-- Same signatures as Sprint 8 so any in-flight client keeps working, but they now
-- operate on the caller's OPEN draft: there is exactly one persistence model, so
-- the two entry points can never diverge. The business-track gate is gone —
-- an existing Engineer adding a business is on the professional track and is
-- entitled to create a business. `p_owner_confirmed` is accepted and ignored:
-- creating a business IS the owner relationship.
create or replace function public.business_save(
  p_legal_name          text default null,
  p_display_name        text default null,
  p_org_type            public.account_type default null,
  p_description         text default null,
  p_governorate         text default null,
  p_city                text default null,
  p_primary_branch_name text default null,
  p_owner_confirmed     boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.business_draft_save(
    null, p_legal_name, p_display_name, p_org_type, p_description,
    p_governorate, p_city, p_primary_branch_name);
end;
$$;

create or replace function public.business_submit()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.business_draft_submit(null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS — self read; every write goes through the definer RPCs
-- ---------------------------------------------------------------------------
alter table public.business_creation_drafts enable row level security;

create policy business_creation_drafts_select_self on public.business_creation_drafts
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. Grants (deny-by-default; strip Supabase defaults first)
-- ---------------------------------------------------------------------------
revoke all on public.business_creation_drafts from anon, authenticated, service_role;
grant select on public.business_creation_drafts to authenticated;
grant select, insert, update on public.business_creation_drafts to service_role;

revoke execute on function public.business_draft_save(
  uuid, text, text, public.account_type, text, text, text, text) from public;
revoke execute on function public.business_draft_submit(uuid) from public;
grant execute on function public.business_draft_save(
  uuid, text, text, public.account_type, text, text, text, text) to authenticated;
grant execute on function public.business_draft_submit(uuid) to authenticated;

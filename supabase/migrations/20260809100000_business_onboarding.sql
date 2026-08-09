-- Migration: business / organization onboarding (Phase 2 — Sprint 8).
--
-- Completes the BUSINESS track of the shared onboarding engine (Sprint 7.3), for
-- the organization OWNER/MANAGER who creates and owns a new organization. The
-- invited-employee path is NOT re-implemented here: it already exists end to end
-- (invitation_lookup / invitation_accept, Sprint 7.2) and joins through the same
-- membership model — an invited employee never creates an org.
--
--   * public.business_onboarding — ONE self-owned draft row per user holding the
--       answers the base tables cannot hold BEFORE the organization exists: the
--       business legal/registered name, the public display name, the chosen
--       business type (org_type), a short description, the primary location
--       (governorate + general city), the primary branch name, and the owner
--       relationship confirmation. Mirrors public.individual_onboarding.
--   * business_save() — upsert the accumulated draft (business track only). No org
--       is created and nothing is activated; it is pure draft persistence.
--   * app.organization_create_owned() — the TRUSTED, transactional owner path:
--       creates the organization (status pending_verification, never self-verified),
--       the owner's ACTIVE membership, the full owner capability grant, and the
--       primary branch, wiring memberships.primary_branch_id to it. Emits the
--       organization.created / membership.granted / membership.activated /
--       branch.created audit events. Internal (definer-only) — reached solely via
--       business_submit so there is no unguarded public org-creation surface.
--   * business_submit() — validates the required draft fields, calls
--       organization_create_owned, stamps completion, and returns the org id. The
--       organization stays pending_verification (Pilot review); the owner reaches
--       the B2B workspace via their now-active membership (my_registration_state
--       short-circuits to active_personal on an active membership).
--
-- All writers are security-definer, auth.uid()-derived, verified-email gated (via
-- app.require_verified_caller, Sprint 7.3) and pin search_path. RLS is self-select
-- only; every write goes through the RPCs. No payments/subscriptions, no OTP, no
-- speculative verification requirements. Design: docs/frontend/sprint-8-business-readiness.md.

-- ---------------------------------------------------------------------------
-- 1. business_onboarding — one self-owned draft row per user
-- ---------------------------------------------------------------------------
create table public.business_onboarding (
  user_id            uuid primary key references public.users (id) on delete cascade,

  -- Business identity: the legal/registered name (kept distinct from the public
  -- display name so the two are never conflated).
  legal_name         text,
  -- The public organization display name (becomes organizations.name).
  display_name       text,
  -- The chosen business type. One of the BUSINESS account types only (see check);
  -- becomes organizations.org_type. Null until the business-type step is done.
  org_type           public.account_type,
  -- Short public description (optional).
  description        text,
  -- Primary location — general only (governorate + general city). No detailed
  -- address is requested at onboarding.
  governorate        text,
  city               text,
  -- Primary branch name (becomes the org's first branch).
  primary_branch_name text,
  -- The caller confirms they are the owner/manager who will run this organization.
  owner_confirmed    boolean not null default false,

  -- Set when the organization has been created (the handoff is reached).
  completed_at       timestamptz,
  -- The organization created on submit (for idempotency / display).
  organization_id    uuid references public.organizations (id) on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Only a business org type may be recorded (never consumer / individual-professional).
  constraint ck_business_org_type check (
    org_type is null or org_type in
      ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler')
  ),
  constraint ck_business_legal_len check (
    legal_name is null or char_length(legal_name) <= 120),
  constraint ck_business_display_len check (
    display_name is null or char_length(display_name) <= 120),
  constraint ck_business_desc_len check (
    description is null or char_length(description) <= 1000),
  constraint ck_business_gov_len check (
    governorate is null or char_length(governorate) <= 80),
  constraint ck_business_city_len check (
    city is null or char_length(city) <= 80),
  constraint ck_business_branch_len check (
    primary_branch_name is null or char_length(primary_branch_name) <= 120)
);
comment on table public.business_onboarding is 'Per-user BUSINESS onboarding draft (Sprint 8): legal + display name, chosen business type (org_type), description, primary location, primary branch name, owner confirmation. Self-owned; written ONLY via the security-definer business_* RPCs. Draft only — the organization is created transactionally on submit via app.organization_create_owned. Never activates a paid state; org starts pending_verification.';

create trigger set_business_onboarding_updated_at
  before update on public.business_onboarding
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Extend the audit action allow-list (business onboarding milestone)
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed', 'onboarding.professional_submitted',
  -- Sprint 8 — business onboarding milestone.
  'onboarding.organization_created'
));

-- ===========================================================================
-- 3. Owner org-creation — the trusted, transactional owner path (internal).
-- ===========================================================================
-- Creates the organization + owner membership + owner capabilities + primary
-- branch in one transaction, deriving the owner from auth.uid(). Internal by
-- design (execute revoked from clients): reached only through business_submit,
-- which reads the caller's own validated draft. The organization ALWAYS starts
-- pending_verification and is_verified stays false — a client can never self-verify
-- (the base RLS insert grant already withholds status/is_verified, and this path
-- honors the same rule). The founding owner receives the FULL org capability
-- catalog so they can run and later submit the org for verification.
create or replace function app.organization_create_owned(
  p_name        text,
  p_org_type    public.account_type,
  p_locale      text,
  p_branch_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_name   text := btrim(coalesce(p_name, ''));
  v_locale text := case when p_locale in ('en', 'ar') then p_locale else 'en' end;
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
  v_org_id uuid;
  v_mid    uuid;
  v_bid    uuid;
  v_cap    text;
  -- The full owner capability set (every key in the fixed catalog).
  v_caps   text[] := array[
    'org.manage', 'org.members.manage', 'branch.manage',
    'verification.submit', 'verification.read',
    'catalog.read', 'catalog.write', 'catalog.publish', 'inventory.write',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
    'project.read', 'project.write', 'conversation.participate', 'ad.manage',
    'subscription.read', 'subscription.manage', 'analytics.view', 'export.data'
  ];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'organization name must be 2..120 characters' using errcode = '22023';
  end if;
  if p_org_type is null or p_org_type = 'end_consumer' then
    raise exception 'a business organization type is required' using errcode = '22023';
  end if;

  -- Organization: unverified draft under review. created_by is the caller.
  insert into public.organizations (name, org_type, status, is_verified, primary_locale, created_by)
  values (v_name, p_org_type, 'pending_verification', false, v_locale, v_uid)
  returning id into v_org_id;

  -- Primary branch (defaults to a "Main branch" name if the caller left it blank).
  insert into public.branches (organization_id, name)
  values (v_org_id, coalesce(v_branch, v_name))
  returning id into v_bid;

  -- Owner membership: ACTIVE from creation (the creator is the org's admin), with
  -- the primary branch wired as descriptive home context.
  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
  values (v_uid, v_org_id, v_bid, 'active', v_uid, now())
  returning id into v_mid;

  -- Grant the full owner capability set.
  foreach v_cap in array v_caps loop
    insert into public.membership_capabilities (membership_id, capability_key)
    values (v_mid, v_cap)
    on conflict (membership_id, capability_key) do nothing;
  end loop;

  perform app.record_audit_event('organization.created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', p_org_type, 'status', 'pending_verification'));
  perform app.record_audit_event('branch.created', 'branch', v_bid, v_org_id,
    jsonb_build_object('primary', true));
  perform app.record_audit_event('membership.granted', 'membership', v_mid, v_org_id,
    jsonb_build_object('user_id', v_uid, 'status', 'active', 'via', 'owner_setup'));
  perform app.record_audit_event('membership.activated', 'membership', v_mid, v_org_id,
    jsonb_build_object('via', 'owner_setup'));

  return v_org_id;
end;
$$;

-- ===========================================================================
-- 4. business_save — persist the accumulated draft (business track only).
-- ===========================================================================
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
declare
  v_uid   uuid := app.require_verified_caller();
  v_track public.onboarding_track := app.onboarding_selected_track(v_uid);
begin
  if v_track is distinct from 'business' then
    raise exception 'business onboarding requires the business track' using errcode = '42501';
  end if;
  if p_org_type is not null and p_org_type not in
     ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler') then
    raise exception 'invalid business organization type' using errcode = '22023';
  end if;

  insert into public.business_onboarding as bo (
    user_id, legal_name, display_name, org_type, description,
    governorate, city, primary_branch_name, owner_confirmed
  ) values (
    v_uid,
    nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    p_org_type,
    nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), ''),
    coalesce(p_owner_confirmed, false)
  )
  on conflict (user_id) do update set
    legal_name          = excluded.legal_name,
    display_name        = excluded.display_name,
    org_type            = excluded.org_type,
    description         = excluded.description,
    governorate         = excluded.governorate,
    city                = excluded.city,
    primary_branch_name = excluded.primary_branch_name,
    owner_confirmed     = excluded.owner_confirmed;
end;
$$;

-- ===========================================================================
-- 5. business_submit — validate the draft, create the org, stamp completion.
-- ===========================================================================
-- Idempotent: if the org was already created for this draft, returns it again
-- (my_registration_state will already have moved the caller to active_personal).
create or replace function public.business_submit()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_track  public.onboarding_track := app.onboarding_selected_track(v_uid);
  v_bo     public.business_onboarding;
  v_locale text;
  v_org_id uuid;
begin
  if v_track is distinct from 'business' then
    raise exception 'business onboarding requires the business track' using errcode = '42501';
  end if;

  select * into v_bo from public.business_onboarding where user_id = v_uid for update;
  -- Idempotent: already created.
  if v_bo.organization_id is not null then
    return v_bo.organization_id;
  end if;

  -- Required to submit.
  if nullif(btrim(coalesce(v_bo.display_name, '')), '') is null then
    raise exception 'an organization name is required' using errcode = '22023';
  end if;
  if v_bo.org_type is null then
    raise exception 'a business type is required' using errcode = '22023';
  end if;
  if not coalesce(v_bo.owner_confirmed, false) then
    raise exception 'owner confirmation is required' using errcode = '22023';
  end if;

  select u.locale into v_locale from public.users u where u.id = v_uid;

  v_org_id := app.organization_create_owned(
    v_bo.display_name, v_bo.org_type, coalesce(v_locale, 'en'), v_bo.primary_branch_name);

  update public.business_onboarding
    set organization_id = v_org_id, completed_at = now()
    where user_id = v_uid;

  perform app.record_audit_event('onboarding.organization_created', 'organization', v_org_id, v_org_id,
    jsonb_build_object('org_type', v_bo.org_type));
  return v_org_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS — self read; writes only via the security-definer RPCs
-- ---------------------------------------------------------------------------
alter table public.business_onboarding enable row level security;

create policy business_onboarding_select_self on public.business_onboarding
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. Grants (deny-by-default; strip Supabase defaults first)
-- ---------------------------------------------------------------------------
revoke all on public.business_onboarding from anon, authenticated, service_role;
grant select on public.business_onboarding to authenticated;
grant select, insert, update on public.business_onboarding to service_role;

-- organization_create_owned is INTERNAL: only business_submit (running as its
-- definer owner) may create an org through it — there is no unguarded public
-- org-creation RPC surface.
revoke execute on function app.organization_create_owned(text, public.account_type, text, text) from public;
grant execute on function app.organization_create_owned(text, public.account_type, text, text) to service_role;

revoke execute on function public.business_save(
  text, text, public.account_type, text, text, text, text, boolean) from public;
revoke execute on function public.business_submit() from public;
grant execute on function public.business_save(
  text, text, public.account_type, text, text, text, text, boolean) to authenticated;
grant execute on function public.business_submit() to authenticated;

-- Migration: persona-gate the showroom SALES-AFFILIATION flow.
--
-- Authority: docs/database/installer-jobs.md §7 (D3-residual, approved
-- 2026-08-31) and the Installer Pilot Change History entries in
-- docs/product/PRODUCT_DIRECTION_GUIDE.md.
--
-- THE DEFECT
-- ----------
-- public.showroom_join_request_create (20260815090002) gated on
-- app.require_verified_caller() and on the target being org_type =
-- 'showroom_dealer' -- but NOT on the caller's persona. Its approval path calls
-- app.membership_grant_sales, which grants the sales.* capability set. So an
-- `installer_technician` -- or any other non-Sales personal persona -- could:
--
--   * create a showroom join request and have an Owner/Manager approve it, or
--   * submit a showroom REFERRAL and have an Admin approve it (which also
--     awards 100 Points to the referrer),
--
-- and in both cases end up holding sales.* authority in a business they have no
-- Sales relationship with. The Installer Pilot makes this reachable in practice,
-- so it is closed before any Installer surface ships.
--
-- WHAT THIS MIGRATION IS
-- ----------------------
-- FORWARD-ONLY and MINIMAL, in the shape 20260830090002_referral_points_wiring
-- established: one new internal helper, plus `create or replace` on existing
-- functions with IDENTICAL signatures. There is NO table, column, type, policy,
-- index, view, grant or trigger change of any kind, and no showroom-affiliation
-- behaviour changes for a legitimate salesperson.
--
-- THE CHOKEPOINT, AND WHY IT IS THE PRIMARY GUARD
-- -----------------------------------------------
-- Every route to sales.* runs through app.membership_grant_sales -- both
-- org_join_request_approve and showroom_referral_approve call it, and any future
-- path would too. Guarding it there closes the capability grant itself rather
-- than each door that leads to it, which is why this migration does NOT need to
-- recreate public.showroom_referral_approve. That function carries the approved
-- Points wiring (referral.organization_approved = +100), and reproducing ~150
-- lines of it to insert one guard would put a frozen contract at risk for no
-- additional protection. See the note on layering below.
--
-- The guard does not alter membership_grant_sales semantics for VALID Sales
-- flows: for a sales persona every branch, capability, audit row, idempotency
-- property and return value is byte-for-byte what it was before.

-- ---------------------------------------------------------------------------
-- 1. The Sales-persona predicate
-- ---------------------------------------------------------------------------
-- TWO branches, and the second is REQUIRED rather than generous.
--
--   * the CANONICAL persona (users.primary_account_type = 'sales'), which is
--     written only by the approved-and-applied account-upgrade workflow; and
--   * the DECLARED persona (individual_onboarding.prof_concrete_type = 'sales'),
--     the transitional compatibility path.
--
-- Between submitting a professional profile and an Admin applying the upgrade,
-- the canonical column is still NULL -- the account is active and usable the
-- whole time (activation is not verification). The shipped personal home already
-- resolves an account exactly this way: "the declared type is what the account
-- actually is, and the separate verification state says how far the platform has
-- gone in trusting the claim". Gating on the canonical value alone would lock a
-- real salesperson out of connecting to their employer for the entire review
-- window -- a regression dressed as a security fix.
--
-- Takes the user id as a PARAMETER rather than reading auth.uid(): the approval
-- paths must test the REQUESTER's persona, not the approver's.
create or replace function app.is_sales_persona(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    exists (
      select 1 from public.users u
      where u.id = p_user_id and u.primary_account_type = 'sales'
    )
    or exists (
      select 1 from public.individual_onboarding io
      where io.user_id = p_user_id and io.prof_concrete_type = 'sales'
    )
  );
$$;

comment on function app.is_sales_persona(uuid) is
  'Internal: is this user a SALESPERSON for the purposes of the showroom affiliation flow? True for the canonical persona (users.primary_account_type = ''sales'') OR the declared one (individual_onboarding.prof_concrete_type = ''sales''), because the canonical column is written only by the applied upgrade and is NULL while a genuine salesperson is under review. Never true for installer_technician or any other personal persona. Sprint: Installer Pilot Increment 1 (D3-residual).';

revoke execute on function app.is_sales_persona(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE CHOKEPOINT -- no non-Sales persona is ever granted sales.*
-- ---------------------------------------------------------------------------
-- Identical to 20260815090002 except for the guard block at the top. Everything
-- below it -- the lock target, the branch fallback, the membership reuse, the
-- capability set, every audit event and the return value -- is unchanged.
--
-- This is the backstop that makes the security property structural rather than
-- procedural: even if a caller reaches an approval path this migration did not
-- recreate, or a future migration adds a new one, the capability grant itself
-- refuses. It is deliberately placed BEFORE the `for update` lock so a refused
-- call takes no locks and mutates nothing.
create or replace function app.membership_grant_sales(
  p_org_id    uuid,
  p_user_id   uuid,
  p_branch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mid   uuid;
  v_cap   text;
  v_bid   uuid := p_branch_id;
  v_caps  text[] := array[
    'catalog.read',
    'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
    'sales.task.write', 'sales.followup.send',
    'rfq.create', 'rfq.respond', 'quote.submit',
    'project.read', 'conversation.participate'
  ];
begin
  -- ---- Installer Pilot Increment 1: the sales.* capability set is for a
  -- SALESPERSON. Refused before any lock is taken and before any row is
  -- written, so a rejected grant leaves no membership, no capability, no branch
  -- assignment and no audit trail of a partial activation.
  if not app.is_sales_persona(p_user_id) then
    raise exception 'a sales affiliation requires a salesperson account'
      using errcode = '42501';
  end if;

  -- Same stable lock target as every other membership mutation, so concurrent
  -- approvals of the same person serialise instead of racing.
  perform 1 from public.organizations where id = p_org_id for update;

  -- Fall back to the organization's own primary branch when no branch was named,
  -- so a member is never left with empty branch scope.
  if v_bid is null then
    select b.id into v_bid from public.branches b
    where b.organization_id = p_org_id and b.is_active
    order by b.created_at
    limit 1;
  end if;

  select m.id into v_mid from public.memberships m
  where m.organization_id = p_org_id and m.user_id = p_user_id
  for update;

  if v_mid is null then
    insert into public.memberships
      (user_id, organization_id, primary_branch_id, status, invited_by, accepted_at)
    values (p_user_id, p_org_id, v_bid, 'active', (select auth.uid()), now())
    returning id into v_mid;
    perform app.record_audit_event('membership.granted', 'membership', v_mid, p_org_id,
      jsonb_build_object('user_id', p_user_id, 'status', 'active', 'via', 'showroom_affiliation'));
  elsif exists (select 1 from public.memberships m where m.id = v_mid and m.status <> 'active') then
    update public.memberships
       set status = 'active',
           accepted_at = coalesce(accepted_at, now()),
           primary_branch_id = coalesce(v_bid, primary_branch_id)
     where id = v_mid;
  end if;

  perform app.record_audit_event('membership.activated', 'membership', v_mid, p_org_id,
    jsonb_build_object('via', 'showroom_affiliation'));

  foreach v_cap in array v_caps loop
    insert into public.membership_capabilities (membership_id, capability_key)
    values (v_mid, v_cap)
    on conflict (membership_id, capability_key) do nothing;
  end loop;

  if v_bid is not null then
    insert into public.membership_branch_access (membership_id, branch_id)
    values (v_mid, v_bid)
    on conflict do nothing;
    perform app.record_audit_event('branch.assignment_changed', 'membership', v_mid, p_org_id,
      jsonb_build_object('branch_id', v_bid, 'via', 'showroom_affiliation'));
  end if;

  return v_mid;
end;
$$;

comment on function app.membership_grant_sales(uuid, uuid, uuid) is
  'Internal: activate a SALESPERSON membership in an organization with the sales capability set and branch scope, reusing an existing membership row where one exists. Never grants org.manage or org.members.manage — an affiliated salesperson is a member, never an owner. Idempotent. Since the Installer Pilot Increment 1 hardening it REFUSES any user who is not a sales persona (app.is_sales_persona), which is the structural guarantee that no other persona can ever hold sales.* through an affiliation — this is the chokepoint every approval path runs through.';

revoke execute on function app.membership_grant_sales(uuid, uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. The entry door -- creating a request
-- ---------------------------------------------------------------------------
-- Identical to 20260815090002 except for the persona gate. Refusing here rather
-- than only at approval matters: a queue of requests an approver can never
-- legitimately act on is itself a defect, and it invites an Owner to try.
--
-- The gate sits AFTER require_verified_caller and BEFORE the organization
-- lookup, so a non-Sales caller cannot use the error shape to probe which
-- organization ids exist.
create or replace function public.showroom_join_request_create(
  p_organization_id uuid,
  p_branch_id       uuid default null,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_org public.organizations;
  v_id  uuid;
begin
  -- ---- Installer Pilot Increment 1: Sales affiliation is for salespeople.
  if not app.is_sales_persona(v_uid) then
    raise exception 'a sales affiliation requires a salesperson account'
      using errcode = '42501';
  end if;

  select * into v_org from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null;
  if not found then
    raise exception 'showroom not found' using errcode = '42501';
  end if;
  if v_org.org_type <> 'showroom_dealer' then
    raise exception 'sales affiliation applies to a showroom/dealer' using errcode = '22023';
  end if;

  -- Already working there: this is a no-op, not an error the UI must explain.
  if exists (
    select 1 from public.memberships m
    where m.organization_id = p_organization_id and m.user_id = v_uid and m.status = 'active'
  ) then
    raise exception 'you already work in this business' using errcode = '23505';
  end if;

  -- A named branch must belong to the named showroom. Silently accepting a foreign
  -- branch id would leak that it exists and would scope the future membership into
  -- another tenant.
  if p_branch_id is not null and not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.organization_id = p_organization_id and b.is_active
  ) then
    raise exception 'that branch does not belong to this showroom' using errcode = '22023';
  end if;

  -- IDEMPOTENT: an existing open request is returned, so a retry or a second tap
  -- never queues a duplicate for the approver.
  select r.id into v_id from public.organization_join_requests r
  where r.user_id = v_uid and r.organization_id = p_organization_id and r.status = 'pending'
  for update;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.organization_join_requests
    (user_id, organization_id, requested_branch_id, note)
  values (v_uid, p_organization_id, p_branch_id,
          nullif(left(btrim(coalesce(p_note, '')), 500), ''))
  returning id into v_id;

  perform app.record_audit_event('affiliation.requested', 'organization_join_request', v_id,
    p_organization_id, jsonb_build_object('user_id', v_uid, 'branch_id', p_branch_id));
  return v_id;
end;
$$;

comment on function public.showroom_join_request_create(uuid, uuid, text) is
  'A SALESPERSON''s request to be affiliated with an existing showroom. Creates a request and nothing else — no membership, capability or workspace follows from it; an Owner/Manager holding org.members.manage decides. Idempotent: an open request is returned rather than duplicated. Since the Installer Pilot Increment 1 hardening the caller must be a sales persona (app.is_sales_persona); every other personal persona is refused with 42501.';

revoke execute on function public.showroom_join_request_create(uuid, uuid, text) from public;
grant execute on function public.showroom_join_request_create(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The approval door -- an already-created request
-- ---------------------------------------------------------------------------
-- Defence in depth, and the reason it is not redundant with §2: a request
-- created BEFORE this migration is still sitting in the queue, and an Owner
-- acting in good faith would otherwise reach the chokepoint's refusal only after
-- the branch validation and the row lock. Checking the REQUESTER's persona up
-- front gives the approver an accurate error and touches nothing.
--
-- Identical to 20260815090002 except for that block.
create or replace function public.org_join_request_approve(
  p_request_id uuid,
  p_branch_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r   public.organization_join_requests;
  v_bid uuid;
  v_mid uuid;
begin
  select * into v_r from public.organization_join_requests r
  where r.id = p_request_id
  for update;
  if not found then
    raise exception 'request not found' using errcode = '42501';
  end if;
  -- Capability is checked against the request's OWN organization, so a manager of
  -- another business cannot reach this row (part P).
  if not app.has_capability(v_r.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  -- IDEMPOTENT: approving twice returns the one membership it created.
  if v_r.status = 'approved' then
    return v_r.membership_id;
  end if;
  if v_r.status <> 'pending' then
    raise exception 'this request was already % ', v_r.status using errcode = '22023';
  end if;

  -- ---- Installer Pilot Increment 1: the REQUESTER, not the approver. A request
  -- from a non-Sales persona cannot be converted into sales.* authority, however
  -- it came to exist -- including one created before this hardening shipped.
  if not app.is_sales_persona(v_r.user_id) then
    raise exception 'a sales affiliation requires a salesperson account'
      using errcode = '42501';
  end if;

  -- Branch scope: the approver's choice wins, otherwise the requested branch, and
  -- app.membership_grant_sales falls back to the primary branch.
  v_bid := coalesce(p_branch_id, v_r.requested_branch_id);
  if v_bid is not null and not exists (
    select 1 from public.branches b
    where b.id = v_bid and b.organization_id = v_r.organization_id and b.is_active
  ) then
    raise exception 'that branch does not belong to this showroom' using errcode = '22023';
  end if;

  v_mid := app.membership_grant_sales(v_r.organization_id, v_r.user_id, v_bid);

  update public.organization_join_requests
     set status = 'approved',
         membership_id = v_mid,
         decided_by = (select auth.uid()),
         decided_at = now(),
         requested_branch_id = coalesce(v_bid, requested_branch_id)
   where id = p_request_id;

  perform app.record_audit_event('affiliation.approved', 'organization_join_request',
    p_request_id, v_r.organization_id,
    jsonb_build_object('user_id', v_r.user_id, 'membership_id', v_mid,
                       'branch_id', v_bid, 'relationship', 'sales_member'));
  return v_mid;
end;
$$;

comment on function public.org_join_request_approve(uuid, uuid) is
  'Approves an affiliation request: activates exactly ONE Sales membership through app.membership_grant_sales, preserving the requested/approved branch scope. Requires org.members.manage in the request''s own organization. Idempotent. Never grants owner or manager capabilities. Since the Installer Pilot Increment 1 hardening it also refuses when the REQUESTER is not a sales persona, so a request created before that hardening cannot be converted into sales.* authority.';

revoke execute on function public.org_join_request_approve(uuid, uuid) from public;
grant execute on function public.org_join_request_approve(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The referral path -- draft and submit
-- ---------------------------------------------------------------------------
-- A referral by itself grants nothing, but its APPROVAL calls
-- app.membership_grant_sales and awards the referrer 100 Points. §2 already makes
-- that approval impossible for a non-Sales persona; gating draft/submit stops the
-- queue filling with candidates an Admin can never approve, and stops a non-Sales
-- account being told it has "referred a business" that can never be actioned.
--
-- Both are identical to 20260815090002 except for the gate.
create or replace function public.showroom_referral_save(
  p_referral_id         uuid default null,
  p_legal_name          text default null,
  p_display_name        text default null,
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
  v_uid    uuid := app.require_verified_caller();
  v_id     uuid;
  v_status public.referral_status;
begin
  -- ---- Installer Pilot Increment 1.
  if not app.is_sales_persona(v_uid) then
    raise exception 'a sales affiliation requires a salesperson account'
      using errcode = '42501';
  end if;

  if p_referral_id is null then
    select f.id into v_id from public.organization_referrals f
    where f.referred_by = v_uid and f.status = 'draft'
    for update;
  else
    select f.id, f.status into v_id, v_status from public.organization_referrals f
    where f.id = p_referral_id and f.referred_by = v_uid
    for update;
    if v_id is null then
      raise exception 'referral not found' using errcode = '42501';
    end if;
    if v_status <> 'draft' then
      raise exception 'this referral has already been submitted' using errcode = '22023';
    end if;
  end if;

  if v_id is null then
    insert into public.organization_referrals (
      referred_by, legal_name, display_name, description,
      governorate, city, primary_branch_name
    ) values (
      v_uid,
      nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
      nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
      nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
      nullif(left(btrim(coalesce(p_city, '')), 80), ''),
      nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.organization_referrals set
    legal_name          = nullif(left(btrim(coalesce(p_legal_name, '')), 120), ''),
    display_name        = nullif(left(btrim(coalesce(p_display_name, '')), 120), ''),
    description         = nullif(left(btrim(coalesce(p_description, '')), 1000), ''),
    governorate         = nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    city                = nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    primary_branch_name = nullif(left(btrim(coalesce(p_primary_branch_name, '')), 120), '')
  where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.showroom_referral_save(
  uuid, text, text, text, text, text, text) from public;
grant execute on function public.showroom_referral_save(
  uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.showroom_referral_submit(p_referral_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app.require_verified_caller();
  v_f   public.organization_referrals;
begin
  -- ---- Installer Pilot Increment 1.
  if not app.is_sales_persona(v_uid) then
    raise exception 'a sales affiliation requires a salesperson account'
      using errcode = '42501';
  end if;

  if p_referral_id is null then
    select * into v_f from public.organization_referrals f
    where f.referred_by = v_uid and f.status in ('draft', 'submitted')
    order by case f.status when 'draft' then 0 else 1 end
    limit 1
    for update;
  else
    select * into v_f from public.organization_referrals f
    where f.id = p_referral_id and f.referred_by = v_uid
    for update;
  end if;

  if v_f.id is null then
    raise exception 'referral not found' using errcode = '42501';
  end if;
  -- Already submitted or decided: hand back the same referral.
  if v_f.status <> 'draft' then
    return v_f.id;
  end if;

  -- The minimum the existing business path needs to create an organization and its
  -- primary branch. Nothing beyond it is collected.
  if nullif(btrim(coalesce(v_f.display_name, '')), '') is null then
    raise exception 'the showroom name is required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_f.governorate, '')), '') is null
     or nullif(btrim(coalesce(v_f.city, '')), '') is null then
    raise exception 'the showroom location is required' using errcode = '22023';
  end if;

  update public.organization_referrals
     set status = 'submitted'
   where id = v_f.id;

  perform app.record_audit_event('referral.submitted', 'organization_referral', v_f.id, null,
    jsonb_build_object('display_name', v_f.display_name, 'org_type', v_f.org_type,
                       'referred_by', v_uid));
  return v_f.id;
end;
$$;

comment on function public.showroom_referral_submit(uuid) is
  'Submits a referred showroom candidate for Admin review. Creates NO organization and grants NO access — the personal account stays usable and the referral is simply pending. Retry-safe: re-submitting returns the same referral. Since the Installer Pilot Increment 1 hardening the referrer must be a sales persona (app.is_sales_persona).';

revoke execute on function public.showroom_referral_submit(uuid) from public;
grant execute on function public.showroom_referral_submit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Deliberately NOT changed
-- ---------------------------------------------------------------------------
-- public.showroom_referral_approve — the Points-wired approval
--   (20260830090002). It reaches sales.* only through
--   app.membership_grant_sales, which §2 now guards, so the security property
--   holds without recreating a function that carries the frozen
--   referral.organization_approved = 100 contract. Its refusal for a non-Sales
--   referrer surfaces as 42501 from the chokepoint, inside the same transaction,
--   so no organization, membership, join request, audit row or Points entry is
--   left behind.
-- public.showroom_join_request_cancel / org_join_request_reject /
--   showroom_referral_reject — they only ever REMOVE or refuse a relationship.
-- public.showroom_directory_search / showroom_branches /
--   my_showroom_affiliations / my_showroom_referrals / org_join_requests_list /
--   admin_showroom_referrals_list — read-only; they grant nothing.
-- Every table, policy, index, enum, capability set and audit event in the
--   affiliation domain, and the Points, Notifications and Chat contracts.

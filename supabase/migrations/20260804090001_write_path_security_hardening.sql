-- Migration: independent Sprint 2 write-path security hardening.
--
-- Closes two merge-blocking bypasses found during review:
--   1. service_role could directly mutate privileged identity/verification state;
--   2. authenticated/service_role could directly mutate membership state and
--      bypass lifecycle, no-escalation, last-owner, tenant-match, and audit rules.
--
-- Normal application services now preserve the caller JWT and use the constrained
-- RPCs. Database-owner access remains an operational root-of-trust for migrations
-- and emergency recovery, not an application write path.

-- ---------------------------------------------------------------------------
-- 1. One enforceable table-write boundary
-- ---------------------------------------------------------------------------

-- Identity: bootstrap still runs as the postgres-owned auth trigger. Client and
-- service roles may read. The ONLY retained service-role write on any reviewed
-- privileged table is the non-privileged `users.locale` UI-language preference:
-- it lets trusted localization/support flows set a user's display language
-- (en/ar) without a bespoke RPC and confers no escalation (it cannot touch
-- identity, primary_account_type, verification, membership, visibility, or
-- platform authority). This single deliberate exception is asserted by pgTAP
-- test 14 as service_role's only column-update grant. Every other privileged
-- write below is revoked from service_role.
revoke insert, update, delete on public.users from service_role;
grant update (locale) on public.users to service_role;

revoke insert, update, delete on public.profiles from service_role;

-- Contact verification is deferred to the OTP feature. A caller may manage only
-- pending contact data; neither authenticated nor service_role can forge the
-- server-controlled verification fields.
revoke insert, update, delete on public.contacts from authenticated, service_role;
grant insert (user_id, channel, value, is_primary) on public.contacts to authenticated;
grant update (channel, value, is_primary) on public.contacts to authenticated;
grant delete on public.contacts to authenticated;

-- Organization/branch privileged state has no direct trusted-service writer.
-- Authenticated organization profile edits remain column-scoped; branch lifecycle
-- writes are prohibited until their own auditable RPC lands.
revoke insert, update, delete on public.organizations from service_role;
revoke insert, update, delete on public.branches from authenticated, service_role;

-- Verification requests/decisions are RPC-only. Evidence writes are intentionally
-- unavailable until the private-storage/OCR feature defines its constrained path.
revoke insert, update, delete on public.verifications from service_role;
revoke insert, update, delete on public.verification_documents from service_role;

-- Membership/capability/assignment state is RPC-only for every application role.
revoke insert, update, delete on public.memberships from authenticated, service_role;
revoke insert, update, delete on public.membership_capabilities from authenticated, service_role;
revoke insert, update, delete on public.membership_branch_access from authenticated, service_role;

-- Platform-role provisioning is migration/DBA-only until a separately approved,
-- attributed platform-role administration workflow exists.
revoke insert, update, delete on public.platform_role_grants from service_role;

-- Audit rows can be created only by the internal constrained writer called from
-- workflow RPCs. service_role cannot forge actor, subject, organization, or metadata.
revoke insert, update, delete on public.audit_log from service_role;

-- Remove obsolete write policies as well as grants so the catalog cannot imply
-- that the RPCs are optional convenience wrappers.
drop policy if exists branches_write_manager on public.branches;
drop policy if exists branches_update_manager on public.branches;
drop policy if exists memberships_insert_manager on public.memberships;
drop policy if exists memberships_update_manager on public.memberships;
drop policy if exists membership_caps_insert_manager on public.membership_capabilities;
drop policy if exists membership_caps_delete_manager on public.membership_capabilities;
drop policy if exists membership_branch_access_write_manager on public.membership_branch_access;
drop policy if exists membership_branch_access_delete_manager on public.membership_branch_access;

-- ---------------------------------------------------------------------------
-- 2. Verification consistency and post-submission immutability
-- ---------------------------------------------------------------------------

alter table public.verifications
  add constraint ck_verifications_type_matches_subject check (
    (verification_type = 'professional'
      and subject_type = 'user'
      and user_id is not null
      and requested_account_type is not null)
    or (verification_type = 'identity'
      and subject_type = 'user'
      and user_id is not null
      and requested_account_type is null)
    or (verification_type = 'organization'
      and subject_type = 'organization'
      and organization_id is not null
      and requested_account_type is null)
  ),
  add constraint ck_verifications_listing_only_professional check (
    not grants_public_listing or verification_type = 'professional'
  ),
  add constraint ck_verifications_applied_only_approved check (
    applied_at is null or status = 'approved'
  ),
  add constraint ck_verifications_expiry_after_submission check (
    expires_at is null or expires_at > submitted_at
  ),
  add constraint ck_verifications_reason_length check (
    reason is null or length(reason) <= 2000
  );

create or replace function app.guard_verification_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
      new.subject_type, new.user_id, new.organization_id,
      new.verification_type, new.requested_account_type,
      new.submitted_at, new.created_at, new.metadata
    ) is distinct from row(
      old.subject_type, old.user_id, old.organization_id,
      old.verification_type, old.requested_account_type,
      old.submitted_at, old.created_at, old.metadata
    ) then
    raise exception 'verification subject, type, target, submission, and metadata are immutable'
      using errcode = '23514';
  end if;

  if old.applied_at is not null and row(
      new.status, new.reviewer_id, new.reason, new.decided_at,
      new.grants_public_listing, new.applied_at, new.expires_at
    ) is distinct from row(
      old.status, old.reviewer_id, old.reason, old.decided_at,
      old.grants_public_listing, old.applied_at, old.expires_at
    ) then
    raise exception 'an applied verification is immutable' using errcode = '23514';
  end if;

  if old.status in ('approved', 'rejected', 'expired') then
    if not (
      old.status = 'approved'
      and new.status = 'approved'
      and old.applied_at is null
      and new.applied_at is not null
      and row(
        new.reviewer_id, new.reason, new.decided_at,
        new.grants_public_listing, new.expires_at
      ) is not distinct from row(
        old.reviewer_id, old.reason, old.decided_at,
        old.grants_public_listing, old.expires_at
      )
    ) then
      raise exception 'a decided or expired verification is immutable'
        using errcode = '23514';
    end if;
  end if;

  if new.grants_public_listing is distinct from old.grants_public_listing
     and not (old.status = 'under_review' and new.status = 'approved') then
    raise exception 'public-listing eligibility is set only by approval'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function app.guard_verification_update() from public;

create trigger guard_verification_update
  before update on public.verifications
  for each row execute function app.guard_verification_update();

-- Review ownership is sticky: another reviewer cannot silently decide a stale
-- review. Row locking serializes concurrent decisions; the first valid decision wins.
create or replace function public.request_account_upgrade(
  p_requested_account_type public.account_type
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current public.account_type;
  v_v public.verifications;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_requested_account_type = 'end_consumer' then
    raise exception 'cannot upgrade to end_consumer';
  end if;
  select u.primary_account_type into v_current
    from public.users u where u.id = v_uid;
  if v_current is null then
    raise exception 'no identity row for caller' using errcode = '42501';
  end if;
  if v_current = p_requested_account_type then
    raise exception 'account is already of the requested type';
  end if;

  insert into public.verifications
    (subject_type, user_id, verification_type, requested_account_type, status, submitted_at)
  values ('user', v_uid, 'professional', p_requested_account_type, 'submitted', now())
  on conflict do nothing
  returning * into v_v;

  if v_v.id is null then
    select * into v_v from public.verifications
    where subject_type = 'user' and user_id = v_uid
      and status in ('draft','submitted','under_review','needs_more_info')
    for update;
    if v_v.requested_account_type is distinct from p_requested_account_type then
      raise exception 'an open upgrade request already exists for a different account type'
        using errcode = '23505';
    end if;
    if v_v.status = 'needs_more_info' then
      update public.verifications
        set status = 'submitted', reviewer_id = null, reason = null
        where id = v_v.id;
      perform app.record_audit_event(
        'account.upgrade_requested', 'verification', v_v.id, null,
        jsonb_build_object('requested_account_type', p_requested_account_type, 'resubmission', true)
      );
    end if;
    return v_v.id;
  end if;

  perform app.record_audit_event(
    'account.upgrade_requested', 'verification', v_v.id, null,
    jsonb_build_object('requested_account_type', p_requested_account_type)
  );
  return v_v.id;
end;
$$;

create or replace function public.review_start(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not review their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'under_review' then
    if v_v.reviewer_id = v_uid then return; end if;
    raise exception 'verification is already assigned to another reviewer'
      using errcode = '55000';
  end if;
  if v_v.status <> 'submitted' then
    raise exception 'invalid transition to under_review from %', v_v.status using errcode = '22023';
  end if;
  update public.verifications
    set status = 'under_review', reviewer_id = v_uid
    where id = p_verification_id;
  perform app.record_audit_event('verification.review_started', 'verification', p_verification_id,
    v_v.organization_id, '{}'::jsonb);
end;
$$;

create or replace function public.review_request_changes(p_verification_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(btrim(p_reason)) > 2000 then
    raise exception 'a reason of 1 to 2000 characters is required when requesting changes'
      using errcode = '22023';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not review their own verification' using errcode = '42501';
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to needs_more_info from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may request changes' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'needs_more_info', reason = btrim(p_reason)
    where id = p_verification_id;
  perform app.record_audit_event('verification.changes_requested', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

create or replace function public.review_reject(p_verification_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(btrim(p_reason)) > 2000 then
    raise exception 'a reason of 1 to 2000 characters is required when rejecting'
      using errcode = '22023';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not decide their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'rejected' then
    if v_v.reviewer_id is distinct from v_uid then
      raise exception 'only the assigned reviewer may confirm rejection' using errcode = '42501';
    end if;
    return;
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to rejected from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may reject' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'rejected', reason = btrim(p_reason), decided_at = now()
    where id = p_verification_id;
  perform app.record_audit_event('verification.rejected', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

create or replace function public.review_approve(
  p_verification_id uuid,
  p_grant_public_listing boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not approve their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'approved' then
    if v_v.reviewer_id is distinct from v_uid then
      raise exception 'only the assigned reviewer may confirm approval' using errcode = '42501';
    end if;
    return;
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to approved from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may approve' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'approved', decided_at = now(),
        grants_public_listing = coalesce(p_grant_public_listing, false)
    where id = p_verification_id;
  perform app.record_audit_event('verification.approved', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('grants_public_listing', coalesce(p_grant_public_listing, false)));
end;
$$;

create or replace function public.apply_account_upgrade(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_v public.verifications;
  v_from public.account_type;
  v_rows integer;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'approved' then
    raise exception 'only an approved verification can be applied (status=%)', v_v.status
      using errcode = '22023';
  end if;
  if v_v.applied_at is not null then return; end if;
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'an expired verification cannot be applied' using errcode = '22023';
  end if;
  if v_v.subject_type <> 'user'
     or v_v.verification_type <> 'professional'
     or v_v.user_id is null
     or v_v.requested_account_type is null then
    raise exception 'verification is not a user account-upgrade approval'
      using errcode = '22023';
  end if;

  select u.primary_account_type into v_from
    from public.users u where u.id = v_v.user_id for update;
  if v_from is null then
    raise exception 'verification subject has no identity row' using errcode = '23503';
  end if;
  if v_from is distinct from v_v.requested_account_type then
    update public.users set primary_account_type = v_v.requested_account_type where id = v_v.user_id;
    perform app.record_audit_event('account.type_changed', 'user', v_v.user_id, null,
      jsonb_build_object('from', v_from, 'to', v_v.requested_account_type));
  end if;

  if v_v.grants_public_listing then
    update public.profiles set public_profile_status = 'listed'
      where user_id = v_v.user_id and public_profile_status <> 'listed';
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      perform app.record_audit_event('profile.listed', 'user', v_v.user_id, null, '{}'::jsonb);
    end if;
  end if;

  update public.verifications set applied_at = now() where id = p_verification_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Stable organization lock + membership/branch RPC hardening
-- ---------------------------------------------------------------------------

create or replace function app.assert_not_last_owner(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m public.memberships;
  v_others integer;
begin
  select * into v_m from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;

  -- The organization row is the stable lock target. Every allowed membership and
  -- capability mutation takes this same lock before changing the protected set,
  -- so concurrent removals serialize even when they target different owners.
  perform 1 from public.organizations where id = v_m.organization_id for update;

  if v_m.status <> 'active' or not exists (
      select 1 from public.membership_capabilities c
      where c.membership_id = p_membership_id and c.capability_key = 'org.manage') then
    return;
  end if;

  select count(*) into v_others
  from public.memberships m
  join public.membership_capabilities c on c.membership_id = m.id
  where m.organization_id = v_m.organization_id
    and m.id <> p_membership_id
    and m.status = 'active'
    and c.capability_key = 'org.manage';
  if v_others = 0 then
    raise exception 'cannot remove the last active org.manage owner' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.membership_invite(
  p_org_id uuid,
  p_user_id uuid,
  p_primary_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform 1 from public.organizations where id = p_org_id for update;
  if not found then raise exception 'organization not found'; end if;
  if not app.has_capability(p_org_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  if p_primary_branch_id is not null and not exists (
      select 1 from public.branches b
      where b.id = p_primary_branch_id
        and b.organization_id = p_org_id
        and b.is_active
        and b.deleted_at is null) then
    raise exception 'primary branch is unavailable or belongs to a different organization'
      using errcode = '42501';
  end if;
  insert into public.memberships (user_id, organization_id, primary_branch_id, status, invited_by)
  values (p_user_id, p_org_id, p_primary_branch_id, 'invited', (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event('membership.granted', 'membership', v_id, p_org_id,
    jsonb_build_object('user_id', p_user_id, 'status', 'invited'));
  return v_id;
end;
$$;

create or replace function public.membership_activate(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
begin
  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not (v_m.user_id = (select auth.uid())
          or app.has_capability(v_m.organization_id, 'org.members.manage')) then
    raise exception 'not authorized to activate this membership' using errcode = '42501';
  end if;
  if v_m.status = 'active' then return; end if;
  if v_m.status not in ('invited', 'suspended') then
    raise exception 'invalid transition to active from %', v_m.status using errcode = '22023';
  end if;
  update public.memberships
    set status = 'active', accepted_at = coalesce(accepted_at, now())
    where id = p_membership_id;
  perform app.record_audit_event('membership.activated', 'membership', p_membership_id,
    v_m.organization_id, '{}'::jsonb);
end;
$$;

create or replace function public.membership_set_capabilities(
  p_membership_id uuid,
  p_capabilities text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
  v_cap text;
  v_before text[];
  v_after text[];
begin
  if p_capabilities is null then
    raise exception 'capabilities must be an array (empty means remove all)'
      using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_capabilities) c where c is null)
     or cardinality(p_capabilities) <> (select count(distinct c) from unnest(p_capabilities) c) then
    raise exception 'capabilities must contain unique, non-null keys'
      using errcode = '22023';
  end if;

  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;

  select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
    into v_before
    from public.membership_capabilities c where c.membership_id = p_membership_id;

  foreach v_cap in array p_capabilities loop
    if v_cap not in (
      'org.manage', 'org.members.manage', 'branch.manage',
      'verification.submit', 'verification.read',
      'catalog.read', 'catalog.write', 'catalog.publish',
      'inventory.write',
      'sales.opportunity.read', 'sales.opportunity.write', 'sales.match.share',
      'sales.task.write', 'sales.followup.send',
      'rfq.create', 'rfq.respond', 'quote.submit', 'quote.decide',
      'project.read', 'project.write', 'conversation.participate',
      'ad.manage', 'subscription.read', 'subscription.manage',
      'analytics.view', 'export.data'
    ) then
      raise exception 'invalid capability key: %', v_cap using errcode = '22023';
    end if;
    if not app.has_capability(v_m.organization_id, v_cap) then
      raise exception 'cannot grant a capability you do not hold: %', v_cap using errcode = '42501';
    end if;
  end loop;

  if 'org.manage' = any(v_before) and not ('org.manage' = any(p_capabilities)) then
    perform app.assert_not_last_owner(p_membership_id);
  end if;

  delete from public.membership_capabilities where membership_id = p_membership_id;
  insert into public.membership_capabilities (membership_id, capability_key)
    select p_membership_id, c from unnest(p_capabilities) c;

  select coalesce(array_agg(c.capability_key order by c.capability_key), array[]::text[])
    into v_after
    from public.membership_capabilities c where c.membership_id = p_membership_id;
  perform app.record_audit_event('membership.role_changed', 'membership', p_membership_id,
    v_m.organization_id, jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
end;
$$;

create or replace function public.membership_suspend(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
begin
  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  if v_m.status = 'suspended' then return; end if;
  if v_m.status <> 'active' then
    raise exception 'invalid transition to suspended from %', v_m.status using errcode = '22023';
  end if;
  perform app.assert_not_last_owner(p_membership_id);
  update public.memberships set status = 'suspended' where id = p_membership_id;
  perform app.record_audit_event('membership.suspended', 'membership', p_membership_id,
    v_m.organization_id, '{}'::jsonb);
end;
$$;

create or replace function public.membership_revoke(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
begin
  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not app.has_capability(v_m.organization_id, 'org.members.manage') then
    raise exception 'org.members.manage required' using errcode = '42501';
  end if;
  if v_m.status = 'revoked' then return; end if;
  if v_m.status not in ('invited', 'active', 'suspended') then
    raise exception 'invalid transition to revoked from %', v_m.status using errcode = '22023';
  end if;
  perform app.assert_not_last_owner(p_membership_id);
  update public.memberships set status = 'revoked' where id = p_membership_id;
  perform app.record_audit_event('membership.revoked', 'membership', p_membership_id,
    v_m.organization_id, '{}'::jsonb);
end;
$$;

create or replace function public.branch_assign(p_membership_id uuid, p_branch_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
  v_branch public.branches;
  v_id uuid;
begin
  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not app.has_capability(v_m.organization_id, 'branch.manage') then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  if v_m.status <> 'active' then
    raise exception 'only an active membership can receive branch access'
      using errcode = '22023';
  end if;
  select * into v_branch from public.branches where id = p_branch_id;
  if not found then raise exception 'branch not found'; end if;
  if v_branch.organization_id <> v_m.organization_id then
    raise exception 'cannot assign a membership to another tenant''s branch'
      using errcode = '42501';
  end if;
  if not v_branch.is_active or v_branch.deleted_at is not null then
    raise exception 'cannot assign an inactive branch' using errcode = '22023';
  end if;

  select id into v_id from public.membership_branch_access
    where membership_id = p_membership_id and branch_id = p_branch_id;
  if found then return v_id; end if;

  insert into public.membership_branch_access (membership_id, branch_id)
    values (p_membership_id, p_branch_id) returning id into v_id;
  perform app.record_audit_event('branch.assignment_changed', 'membership', p_membership_id,
    v_m.organization_id, jsonb_build_object('branch_id', p_branch_id, 'op', 'assign'));
  return v_id;
end;
$$;

create or replace function public.branch_unassign(p_membership_id uuid, p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_m public.memberships;
  v_rows integer;
begin
  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then raise exception 'membership not found'; end if;
  perform 1 from public.organizations where id = v_org_id for update;
  select * into v_m from public.memberships where id = p_membership_id for update;
  if not app.has_capability(v_m.organization_id, 'branch.manage') then
    raise exception 'branch.manage required' using errcode = '42501';
  end if;
  delete from public.membership_branch_access
    where membership_id = p_membership_id and branch_id = p_branch_id;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    perform app.record_audit_event('branch.assignment_changed', 'membership', p_membership_id,
      v_m.organization_id, jsonb_build_object('branch_id', p_branch_id, 'op', 'unassign'));
  end if;
end;
$$;

-- Enforce tenant matching even for migration/DBA inserts, not only inside RPCs.
create or replace function app.enforce_membership_branch_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_membership_org uuid;
  v_branch_org uuid;
begin
  select organization_id into v_membership_org from public.memberships where id = new.membership_id;
  select organization_id into v_branch_org from public.branches where id = new.branch_id;
  if v_membership_org is null or v_branch_org is null or v_membership_org <> v_branch_org then
    raise exception 'membership and branch must belong to the same organization'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke execute on function app.enforce_membership_branch_tenant() from public;

create trigger enforce_membership_branch_tenant
  before insert or update on public.membership_branch_access
  for each row execute function app.enforce_membership_branch_tenant();

-- Reassert the intended execute ACLs after replacing functions.
revoke execute on function app.assert_not_last_owner(uuid) from public;
revoke execute on function public.request_account_upgrade(public.account_type) from public;
revoke execute on function public.review_start(uuid) from public;
revoke execute on function public.review_request_changes(uuid, text) from public;
revoke execute on function public.review_reject(uuid, text) from public;
revoke execute on function public.review_approve(uuid, boolean) from public;
revoke execute on function public.apply_account_upgrade(uuid) from public;
revoke execute on function public.membership_invite(uuid, uuid, uuid) from public;
revoke execute on function public.membership_activate(uuid) from public;
revoke execute on function public.membership_set_capabilities(uuid, text[]) from public;
revoke execute on function public.membership_suspend(uuid) from public;
revoke execute on function public.membership_revoke(uuid) from public;
revoke execute on function public.branch_assign(uuid, uuid) from public;
revoke execute on function public.branch_unassign(uuid, uuid) from public;
revoke execute on function public.set_profile_hidden(uuid) from public;

grant execute on function public.request_account_upgrade(public.account_type) to authenticated;
grant execute on function public.review_start(uuid) to authenticated;
grant execute on function public.review_request_changes(uuid, text) to authenticated;
grant execute on function public.review_reject(uuid, text) to authenticated;
grant execute on function public.review_approve(uuid, boolean) to authenticated;
grant execute on function public.apply_account_upgrade(uuid) to authenticated;
grant execute on function public.membership_invite(uuid, uuid, uuid) to authenticated;
grant execute on function public.membership_activate(uuid) to authenticated;
grant execute on function public.membership_set_capabilities(uuid, text[]) to authenticated;
grant execute on function public.membership_suspend(uuid) to authenticated;
grant execute on function public.membership_revoke(uuid) to authenticated;
grant execute on function public.branch_assign(uuid, uuid) to authenticated;
grant execute on function public.branch_unassign(uuid, uuid) to authenticated;
grant execute on function public.set_profile_hidden(uuid) to authenticated;

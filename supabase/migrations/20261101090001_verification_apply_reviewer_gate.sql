-- Administrative verification: close the direct-RPC gap on the APPLY step and make public listing opt-in.
--
-- 1. apply_account_upgrade / apply_organization_verification only checked the permission
--    (users.verify / organizations.verify). A holder could call them directly on ANY approved request, including
--    their own or one another reviewer decided. They now enforce the same restrictions as review_approve's
--    confirm path, BEFORE the idempotent "already applied" early return:
--      - the caller may not be the subject (own user request / member of the subject organization);
--      - the caller must be the reviewer assigned to the request.
--    Idempotent recovery is preserved: the assigned reviewer can re-run apply any number of times (a no-op once
--    applied_at is set). A non-assigned admin is refused: the request is owned by its reviewer.
-- 2. review_approve's p_grant_public_listing default changes true -> false. Listing also publishes portfolio media
--    (ADR-0007 D14), so an omitted argument must never publish. The app always passes the flag explicitly.
--
-- Nothing else in these functions changes. Grants are unchanged (create or replace keeps them).

create or replace function app.assert_assigned_reviewer(p_verification public.verifications)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if p_verification.user_id = v_uid
     or (p_verification.organization_id is not null and app.is_org_member(p_verification.organization_id)) then
    raise exception 'a reviewer may not approve their own verification' using errcode = '42501';
  end if;
  if p_verification.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may confirm approval' using errcode = '42501';
  end if;
end;
$$;
-- Internal only: called from the SECURITY DEFINER apply functions below (which run as the owner), never by a client role.
revoke all on function app.assert_assigned_reviewer(public.verifications) from public, anon, authenticated, service_role;
comment on function app.assert_assigned_reviewer(public.verifications) is 'Internal guard shared by the verification apply RPCs: refuses the subject of the request and any admin who is not the assigned reviewer. Mirrors the confirm path of review_approve.';

create or replace function public.apply_account_upgrade(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_v    public.verifications;
  v_from public.persona_type;
  v_rows integer;
begin
  if not app.has_admin_permission('users.verify') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'approved' then
    raise exception 'only an approved verification can be applied (status=%)', v_v.status
      using errcode = '22023';
  end if;
  perform app.assert_assigned_reviewer(v_v);
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

  -- Lock the identity ROW and read its persona, which may legitimately be null.
  perform 1 from public.users u where u.id = v_v.user_id for update;
  if not found then
    raise exception 'verification subject has no identity row' using errcode = '23503';
  end if;
  select u.primary_account_type into v_from
    from public.users u where u.id = v_v.user_id;

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

create or replace function public.apply_organization_verification(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_v public.verifications;
begin
  if not app.has_admin_permission('organizations.verify') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'approved' then
    raise exception 'only an approved verification can be applied (status=%)', v_v.status
      using errcode = '22023';
  end if;
  perform app.assert_assigned_reviewer(v_v);
  if v_v.applied_at is not null then return; end if;  -- idempotent (the trigger normally got there first)
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'an expired verification cannot be applied' using errcode = '22023';
  end if;
  if v_v.subject_type <> 'organization'
     or v_v.verification_type <> 'organization'
     or v_v.organization_id is null then
    raise exception 'verification is not an organization approval' using errcode = '22023';
  end if;
  perform app._apply_org_approval(p_verification_id);
end;
$$;

create or replace function public.review_approve(p_verification_id uuid, p_grant_public_listing boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.can_review_verification(p_verification_id) or app.org_review_requires_administrator(p_verification_id) then
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
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.approved', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.approved.title', 'notifications.verification.approved.body',
      '{}'::jsonb);
  end if;
end;
$$;

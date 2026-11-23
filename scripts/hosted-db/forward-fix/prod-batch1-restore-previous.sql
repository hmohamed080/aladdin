-- Forward-fix "prod-batch1": undo 20261114090001..20261115090001 (verification apply reviewer gate; craftsman profile verification submit).
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase
-- migration path as a NEW migration (never the SQL Editor).
-- Function/trigger-only: restores public.apply_account_upgrade, public.apply_organization_verification and public.review_approve to their exact
-- definitions on PRODUCTION before the batch (md5 of pg_get_functiondef read live on Production 2026-11-23: 7ac34c47..., 2b5b185a..., a8929887...;
-- these are the definitions of 20260815090001, 20261015090028 and 20260822090002), and removes what the batch added: the trigger
-- craftsman_review_complete, app.craftsman_review_guard(), public.craftsman_profile_verification_submit(boolean) and
-- app.assert_assigned_reviewer(public.verifications). The batch never changes the ACL or the comment of the three restored functions (CREATE OR
-- REPLACE keeps both), so neither is touched. No table, row, policy or data change.
-- Order: the three RPCs stop calling the guard BEFORE it is dropped. DROP ... IF EXISTS so a partial apply (only 20261114090001) still recovers.
-- Data caveat: it does not undo rows written while the batch was live (e.g. a verification request filed by the new craftsman RPC); only a
-- restore-tested backup can. One transaction.
begin;

CREATE OR REPLACE FUNCTION public.apply_account_upgrade(p_verification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.apply_organization_verification(p_verification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.review_approve(p_verification_id uuid, p_grant_public_listing boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

drop trigger if exists craftsman_review_complete on public.verifications;
drop function if exists app.craftsman_review_guard();
drop function if exists public.craftsman_profile_verification_submit(boolean);
drop function if exists app.assert_assigned_reviewer(public.verifications);

commit;

-- ===========================================================================
-- ATOMIC: disposable sign-up cleanup + dedicated platform-account preparation.
--
-- Run ONCE per dedicated platform-staff account, as the DATABASE OWNER, through the
-- reviewed operational channel. Procedure and rationale:
-- docs/admin/PLATFORM_ADMIN_ACCOUNT_PREPARATION.md. NOT a migration: it is operational
-- and names a specific account, which no migration may do.
--
-- ONE transaction. Every precondition is re-checked under lock; ANY failure raises and
-- the WHOLE transaction (cleanup + preparation) rolls back - nothing is half-applied.
-- It does NOT bootstrap a Super Admin: that is a separate, documented call
-- (docs/admin/SUPER_ADMIN_BOOTSTRAP.md) made after this commits and is verified.
--
--   1. lock + re-check the selected account and every cleanup precondition
--   2. confirm the disposable organization: created exclusively by this account, no other
--      member, no business history beyond the already-audited sign-up artifacts
--   3. soft-ARCHIVE that organization (status = archived, deleted_at = now()); never
--      hard-delete it: its immutable audit history stays linked
--   4. remove the account's membership (its capability rows cascade)
--   5. remove the business creation draft
--   6. remove the business onboarding_progress row
--   6b. write ONE explicit audit event, account.platform_cleanup (the steps above are direct DML
--      on tables with no automatic audit trigger): the account and the archived organization
--      (internal ids), the operator reason/source, and the removed-row counts - no personal data
--   7. call app.admin_prepare_platform_account() (strict mode, audited)
--   8. confirm users.status = 'active' and that every retained record is intact
--   9. COMMIT
--
-- NEVER touched: the Auth identity, the core users row, the profile, the avatar upload,
-- consent receipts, audit history.
-- ===========================================================================
begin;
set local lock_timeout = '5s';

create temp table op_result (k text, v text) on commit drop;

do $$
declare
  -- ---- the ONLY two inputs ---------------------------------------------------
  v_email  constant text := '<platform-admin-email>';
  v_reason constant text := 'Dedicated platform account: disposable sign-up business artifacts (organization archived, membership, draft, onboarding row removed) and account prepared atomically.';
  -- ----------------------------------------------------------------------------
  v_uid        uuid;
  v_status     public.user_status;
  v_persona    public.persona_type;
  v_confirmed  timestamptz;
  v_org        uuid;
  v_org_status public.org_status;
  v_org_ver    boolean;
  v_org_del    timestamptz;
  v_mid        uuid;
  v_n          bigint;
  r            record;
  v_bad        text := '';
  v_caps       bigint;
  v_draft_n    bigint;
  v_onb_n      bigint;
  c_cleanup_ev bigint;
  -- retained-record counts, captured before and compared after
  c_profile bigint; c_consent bigint; c_avatar bigint; c_ident bigint; c_audit bigint; c_org_audit bigint;
begin
  -- ===== 1. the selected account -------------------------------------------------
  select count(*) into v_n from auth.users where lower(email) = lower(v_email);
  if v_n <> 1 then raise exception 'ABORT: expected exactly 1 Auth account for the selected email, found %', v_n; end if;
  select au.id, au.email_confirmed_at into v_uid, v_confirmed from auth.users au where lower(au.email) = lower(v_email);
  if v_confirmed is null then raise exception 'ABORT: the Auth email is not confirmed'; end if;

  select u.status, u.primary_account_type into v_status, v_persona
  from public.users u where u.id = v_uid for update;
  if not found then raise exception 'ABORT: no public.users row for the account'; end if;
  if v_persona is not null then raise exception 'ABORT: the account holds a persona (%), it is not a dedicated platform account', v_persona; end if;

  -- Idempotent re-run: already prepared and nothing left to clean -> nothing to do.
  if v_status = 'active'
     and not exists (select 1 from public.memberships where user_id = v_uid)
     and not exists (select 1 from public.organizations where created_by = v_uid and deleted_at is null) then
    insert into op_result values ('result', 'NO-OP: account is already active and has no disposable artifacts left');
    return;
  end if;
  if v_status <> 'pending_verification' then
    raise exception 'ABORT: account status is %, expected pending_verification', v_status;
  end if;

  -- ===== 2. the disposable organization -------------------------------------------
  select count(*) into v_n from public.organizations where created_by = v_uid;
  if v_n <> 1 then raise exception 'ABORT: expected exactly 1 organization created by the account, found %', v_n; end if;
  select o.id, o.status, o.is_verified, o.deleted_at into v_org, v_org_status, v_org_ver, v_org_del
  from public.organizations o where o.created_by = v_uid for update;
  if v_org_status <> 'pending_verification' or v_org_ver or v_org_del is not null then
    raise exception 'ABORT: the organization is not a pristine pending, unverified, non-deleted record (status %, verified %, deleted %)',
      v_org_status, v_org_ver, v_org_del;
  end if;

  select count(*) into v_n from public.memberships where user_id = v_uid;
  if v_n <> 1 then raise exception 'ABORT: expected exactly 1 membership for the account, found %', v_n; end if;
  select m.id into v_mid from public.memberships m where m.user_id = v_uid and m.organization_id = v_org and m.status = 'active';
  if v_mid is null then raise exception 'ABORT: the account''s membership is not the active membership of its own organization'; end if;

  select count(*) into v_n from public.memberships where organization_id = v_org and user_id <> v_uid;
  if v_n <> 0 then raise exception 'ABORT: the organization has % other member(s)', v_n; end if;

  select count(*) into v_n from public.audit_log where organization_id = v_org and actor_user_id is distinct from v_uid;
  if v_n <> 0 then raise exception 'ABORT: % audit row(s) about the organization were written by someone else', v_n; end if;

  -- Every single-column FK into public.organizations: only the known sign-up artifacts may exist.
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1 and c.confrelid = 'public.organizations'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into v_n using v_org;
    if v_n > 0 and (r.tbl || '.' || r.col) not in
       ('audit_log.organization_id', 'branches.organization_id',
        'business_creation_drafts.organization_id', 'memberships.organization_id') then
      v_bad := v_bad || format(' %s.%s=%s', r.tbl, r.col, v_n);
    end if;
  end loop;
  if v_bad <> '' then raise exception 'ABORT: unexpected business history on the organization:%', v_bad; end if;

  -- Every single-column FK into public.users / auth.users: only known sign-up / identity artifacts may exist.
  v_bad := '';
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and array_length(c.conkey, 1) = 1
      and c.confrelid in ('public.users'::regclass, 'auth.users'::regclass)
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into v_n using v_uid;
    if v_n > 0 and r.tbl not like 'auth.%'
       and (r.tbl || '.' || r.col) not in
       ('audit_log.actor_user_id', 'avatar_uploads.owner_user_id', 'business_creation_drafts.user_id',
        'consent_receipts.user_id', 'memberships.invited_by', 'memberships.user_id',
        'onboarding_progress.user_id', 'organizations.created_by', 'profiles.user_id', 'users.id') then
      v_bad := v_bad || format(' %s.%s=%s', r.tbl, r.col, v_n);
    end if;
  end loop;
  if v_bad <> '' then raise exception 'ABORT: the account owns unexpected records:%', v_bad; end if;

  select count(*) into v_n from public.memberships where invited_by = v_uid and id <> v_mid;
  if v_n <> 0 then raise exception 'ABORT: the account invited % other membership(s)', v_n; end if;
  select count(*) into v_n from public.onboarding_progress where user_id = v_uid and selected_track is distinct from 'business';
  if v_n <> 0 then raise exception 'ABORT: onboarding_progress is not the business sign-up track'; end if;

  -- Retained-record baseline.
  select count(*) into c_profile from public.profiles where user_id = v_uid;
  select count(*) into c_consent from public.consent_receipts where user_id = v_uid;
  select count(*) into c_avatar  from public.avatar_uploads where owner_user_id = v_uid;
  select count(*) into c_ident   from auth.identities where user_id = v_uid;
  select count(*) into c_audit   from public.audit_log where actor_user_id = v_uid or subject_id = v_uid;
  select count(*) into c_org_audit from public.audit_log where organization_id = v_org;
  select count(*) into c_cleanup_ev from public.audit_log where action = 'account.platform_cleanup' and subject_id = v_uid;
  select count(*) into v_caps from public.membership_capabilities where membership_id = v_mid;

  -- ===== 3. soft-archive the organization (never hard-delete) ----------------------
  update public.organizations set status = 'archived', deleted_at = now() where id = v_org;

  -- ===== 4. remove the account's membership (capability rows cascade) ---------------
  delete from public.memberships where id = v_mid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'ABORT: expected to remove exactly 1 membership, removed %', v_n; end if;

  -- ===== 5. remove the business creation draft ------------------------------------
  delete from public.business_creation_drafts where user_id = v_uid;
  get diagnostics v_draft_n = row_count;
  -- ===== 6. remove the business onboarding_progress row ---------------------------
  delete from public.onboarding_progress where user_id = v_uid;
  get diagnostics v_onb_n = row_count;

  -- ===== 6b. explicit audit record of the cleanup itself ---------------------------
  -- The four steps above are direct DML on tables with NO automatic audit trigger, so the
  -- retained history alone would not say that a cleanup happened. One event, written in THIS
  -- transaction: it commits only if everything commits and vanishes on any rollback. Internal
  -- ids and counts only - no name, email or other personal data.
  perform app.record_audit_event('account.platform_cleanup', 'user', v_uid, v_org,
    jsonb_build_object(
      'source', 'dba_platform_prepare',
      'reason', v_reason,
      'organization_id', v_org,
      'organization_archived', true,
      'organization_status_before', v_org_status,
      'membership_removed', 1,
      'membership_capabilities_removed', v_caps,
      'business_draft_removed', v_draft_n,
      'business_onboarding_removed', v_onb_n));

  -- ===== 7. platform-account preparation (strict, audited) -------------------------
  if not app.admin_prepare_platform_account(v_uid, v_reason) then
    raise exception 'ABORT: preparation reported no change';
  end if;

  -- ===== 8. postconditions: any mismatch rolls EVERYTHING back --------------------
  select u.status, u.primary_account_type into v_status, v_persona from public.users u where u.id = v_uid;
  if v_status <> 'active' then raise exception 'ABORT: status is % after preparation', v_status; end if;
  if v_persona is not null then raise exception 'ABORT: a persona appeared'; end if;
  if exists (select 1 from public.memberships where user_id = v_uid) then raise exception 'ABORT: a membership remains'; end if;
  if not exists (select 1 from public.organizations where id = v_org and status = 'archived' and deleted_at is not null) then
    raise exception 'ABORT: the organization is not archived'; end if;
  if (select count(*) from public.profiles where user_id = v_uid) <> c_profile
     or (select count(*) from public.consent_receipts where user_id = v_uid) <> c_consent
     or (select count(*) from public.avatar_uploads where owner_user_id = v_uid) <> c_avatar
     or (select count(*) from auth.identities where user_id = v_uid) <> c_ident then
    raise exception 'ABORT: a retained record changed'; end if;
  if (select count(*) from public.audit_log where organization_id = v_org) < c_org_audit then
    raise exception 'ABORT: audit linkage to the organization was lost'; end if;
  if (select count(*) from public.audit_log where actor_user_id = v_uid or subject_id = v_uid) < c_audit + 2 then
    raise exception 'ABORT: the cleanup and/or preparation audit row is missing'; end if;
  if (select count(*) from public.audit_log where action = 'account.platform_cleanup' and subject_id = v_uid) <> c_cleanup_ev + 1 then
    raise exception 'ABORT: expected exactly one new account.platform_cleanup audit row'; end if;
  if (select count(*) from public.audit_log where organization_id = v_org) <> c_org_audit + 1 then
    raise exception 'ABORT: the cleanup audit row is not linked to the archived organization'; end if;

  insert into op_result values
    ('result', 'PREPARED'),
    ('status', v_status::text),
    ('organization', 'archived (history intact)'),
    ('cleanup audit event', 'account.platform_cleanup written (1)'),
    ('retained profile/consent/avatar/identity', format('%s/%s/%s/%s', c_profile, c_consent, c_avatar, c_ident)),
    ('audit rows (account) before -> after', format('%s -> %s', c_audit,
       (select count(*) from public.audit_log where actor_user_id = v_uid or subject_id = v_uid)));
end $$;

select k, v from op_result order by k;

commit;

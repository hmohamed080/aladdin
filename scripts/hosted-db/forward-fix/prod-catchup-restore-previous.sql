-- Forward-fix "prod-catchup (restore previous)": undo the NON-table part of the Production catch-up (210 -> 237) and restore the exact PRODUCTION definitions.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor). Run it LAST, after forward-fix/media-notify-remove.sql and forward-fix/marketplace-remove.sql (reverse order of the push):
--   1. media-notify-remove.sql   2. marketplace-remove.sql   3. this file.
-- Scope (migrations 20261114090001, 20261115090001..006, 20261116090001, 20261122090001..002; the verification, organization-approval and registration-gate work):
--   * restores 14 functions to the definitions they have on PRODUCTION today (md5 of pg_get_functiondef and of the comment read live on Production on
--     2026-11-23 equal the md5 of the definitions below; the ACL is never touched: CREATE OR REPLACE keeps it and the live ACL inventory equals the contract 20261112090001),
--   * re-creates trigger showroom_review_complete on public.verifications with its function app.showroom_review_guard() (20261115090002 dropped both),
--   * restores constraint ck_verifications_reason_required (a rejection needs a reason again) and the audit_log action vocabulary (removes 'verification.admin_initiated'),
--   * drops the 5 functions the catch-up added: app.admin_user_registration_state, app.registration_gate_allows, app.assert_assigned_reviewer,
--     public.craftsman_profile_verification_submit, public.admin_initiate_verification.
-- The audit_log constraint list below has the same members as Production (md5 of the member list sorted by byte order, read live on Production 2026-11-23: 7a5e10f77d98c87f392db57872a12b29); its text order differs from
-- the live text (the Production migrations were applied in a different order), which does not change what it accepts.
-- DATA CAVEAT: it does not undo ROWS written while the catch-up was live (verification requests filed by admin_initiate_verification or the craftsman RPC, a
-- verification approved or rejected without a reason, audit rows 'verification.admin_initiated'). Only a restore-tested backup can. A constraint that existing rows
-- already violate is re-added NOT VALID (it still guards new rows) and a notice says so; nothing is deleted.
-- One transaction. Proven on a scratch database: Production-pre-state + the 27 migrations + the three forward-fixes gives a catalog fingerprint identical to the pre-state.
begin;

-- app.showroom_review_guard()
CREATE OR REPLACE FUNCTION app.showroom_review_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status='approved' and new.status is distinct from old.status and new.subject_type='organization' and exists(select 1 from public.organizations o where o.id=new.organization_id and o.org_type='showroom_dealer') and not app.showroom_profile_complete(new.organization_id) then
 raise exception 'complete showroom business information before approval' using errcode='22023'; end if;
 return new;
end;
$function$;

-- app.showroom_activation_guard()
CREATE OR REPLACE FUNCTION app.showroom_activation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if tg_op='INSERT' then
  -- The database owner may bootstrap historical fixtures/migrations. Neither
  -- authenticated nor service-role Data API callers can insert an active or
  -- pre-approved showroom instead of using the existing review/apply process.
  if new.org_type='showroom_dealer' and (new.status='active' or new.is_verified) and coalesce(current_setting('role',true),'none') not in ('none','postgres') then
   raise exception 'create showroom pending approval; activation requires approved verification' using errcode='22023';
  end if;
  return new;
 end if;
 if new.org_type='showroom_dealer' and new.status='active' and new.status is distinct from old.status and not exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=new.id) and (not new.is_verified or not exists(select 1 from public.verifications v where v.organization_id=new.id and v.subject_type='organization' and v.verification_type='organization' and v.status='approved' and (v.expires_at is null or v.expires_at>now()))) then
 raise exception 'approved organization verification is required before showroom activation' using errcode='22023'; end if;
 if new.org_type='showroom_dealer' and ((new.status='active' and new.status is distinct from old.status) or (new.is_verified and new.is_verified is distinct from old.is_verified))
 and not (old.is_verified and new.is_verified and exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=new.id and e.closed_at is null)) and not app.showroom_profile_complete(new.id) then
 raise exception 'showroom business information and detailed address are required before activation' using errcode='22023'; end if;
 return new;
end;
$function$;

-- app.admin_user_status_tab(p_status user_status, p_latest verification_status)
CREATE OR REPLACE FUNCTION app.admin_user_status_tab(p_status user_status, p_latest verification_status)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_status = 'suspended' then 'suspended'
    when p_latest = 'rejected' then 'rejected'
    when p_status = 'active' then 'verified'
    when p_status = 'pending_verification' then 'pending'
  end
$function$;

-- app.bv_decide(p_verification_id uuid, p_approve boolean, p_reason text)
CREATE OR REPLACE FUNCTION app.bv_decide(p_verification_id uuid, p_approve boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        public.verifications;
  v_uid    uuid := (select auth.uid());
  v_reason text := app.bv_reason(p_reason, case when p_approve then 'approving' else 'rejecting' end);
  v_org    public.organizations;
begin
  if not app.has_admin_permission('verification.approve') then
    raise exception 'admin permission verification.approve required' using errcode = '42501';
  end if;
  v := app.bv_lock_for_review(p_verification_id);
  if v.status = 'submitted' then
    update public.verifications set status = 'under_review', reviewer_id = v_uid where id = v.id;
    perform app.record_audit_event('business_verification.review_started', 'verification', v.id, v.organization_id, '{}'::jsonb);
  elsif v.status <> 'under_review' then
    raise exception 'invalid transition to % from %', case when p_approve then 'approved' else 'rejected' end, v.status
      using errcode = '22023';
  end if;

  if p_approve then
    select * into v_org from public.organizations where id = v.organization_id for update;
    if v_org.status <> 'active' or v_org.deleted_at is not null then
      raise exception 'only an active organization can be verified' using errcode = '22023';
    end if;
    update public.verifications set status = 'approved', reason = v_reason, reviewer_id = v_uid, decided_at = now()
     where id = v.id;
    update public.organizations set business_verified_at = now(), business_verification_id = v.id where id = v.organization_id;
    update public.verifications set applied_at = now() where id = v.id;
    perform app.record_audit_event('business_verification.approved', 'verification', v.id, v.organization_id,
      jsonb_build_object('reason', v_reason));
    perform app.notify_org(v.organization_id, 'org.manage', 'verification.approved', 'verification', v.id,
      '/showroom/verification', 'notifications.businessVerification.approved.title',
      'notifications.businessVerification.approved.body', '{}'::jsonb);
  else
    update public.verifications set status = 'rejected', reason = v_reason, reviewer_id = v_uid, decided_at = now()
     where id = v.id;
    perform app.record_audit_event('business_verification.rejected', 'verification', v.id, v.organization_id,
      jsonb_build_object('reason', v_reason));
    perform app.notify_org(v.organization_id, 'org.manage', 'verification.rejected', 'verification', v.id,
      '/showroom/verification', 'notifications.businessVerification.rejected.title',
      'notifications.businessVerification.rejected.body', '{}'::jsonb);
  end if;
end;
$function$;

-- app.api_pre_request()
CREATE OR REPLACE FUNCTION app.api_pre_request()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claims jsonb;
  v_sub    uuid;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null or v_claims ->> 'role' is distinct from 'authenticated' then
    return;
  end if;
  begin
    v_sub := (v_claims ->> 'sub')::uuid;
  exception when others then
    return;
  end;
  if v_sub is null or coalesce(current_setting('request.path', true), '') = '/rpc/my_account_status' then
    return;
  end if;
  if not app.jwt_session_is_live() then
    raise exception 'session revoked' using errcode = '42501', hint = 'session_revoked';
  end if;
  if exists (select 1 from public.users u where u.id = v_sub and u.status in ('suspended', 'deactivated')) then
    raise exception 'account suspended' using errcode = '42501', hint = 'account_suspended';
  end if;
end;
$function$;
COMMENT ON FUNCTION app.api_pre_request() IS 'PostgREST db_pre_request hook (Admin Core 1B-B, PD-010): refuses every Data API request made by a revoked session (app.jwt_session_is_live) or a suspended/deactivated account, except my_account_status. No effect for anon/service_role.';

-- public.admin_organization_detail(p_organization_id uuid)
CREATE OR REPLACE FUNCTION public.admin_organization_detail(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  perform app.admin_require('organizations.read');

  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'name_ar', o.name_ar,
    'name_en', o.name_en,
    'org_type', o.org_type,
    'status', o.status,
    'is_verified', o.is_verified, 'business_verified_at', o.business_verified_at,
    'created_at', o.created_at,
    'source', o.source,
    'referred_by', case when o.referred_by_user_id is null then null else jsonb_build_object(
        'user_id', o.referred_by_user_id,
        'display_name', coalesce((select pr.display_name from public.profiles pr where pr.user_id = o.referred_by_user_id), '')) end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
          'membership_id', m.id,
          'user_id', m.user_id,
          'display_name', coalesce(pr.display_name, ''),
          'status', m.status,
          'created_at', m.created_at,
          'capabilities', coalesce((
            select jsonb_agg(c.capability_key order by c.capability_key)
            from public.membership_capabilities c where c.membership_id = m.id), '[]'::jsonb))
        order by (m.status = 'active') desc, m.created_at, m.id)
      from public.memberships m
      left join public.profiles pr on pr.user_id = m.user_id
      where m.organization_id = o.id), '[]'::jsonb),
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', coalesce(pr.display_name, ''))
        order by m.created_at, m.id)
      from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
      left join public.profiles pr on pr.user_id = m.user_id
      where m.organization_id = o.id and m.status = 'active'), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'name_ar', b.name_ar, 'name_en', b.name_en, 'is_active', b.is_active)
        order by b.created_at, b.id)
      from public.branches b
      where b.organization_id = o.id and b.deleted_at is null), '[]'::jsonb),
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', v.id,
          'verification_type', v.verification_type,
          'requested_account_type', v.requested_account_type,
          'status', v.status,
          'reason', v.reason,
          'submitted_at', v.submitted_at,
          'decided_at', v.decided_at)
        order by v.submitted_at desc, v.id desc)
      from public.verifications v
      where v.organization_id = o.id and v.subject_type = 'organization'), '[]'::jsonb)
  )
  into v_result
  from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null;

  return v_result;  -- NULL: no such (non-deleted) organization
end;
$function$;
COMMENT ON FUNCTION public.admin_organization_detail(uuid) IS 'Admin Organization Details read model (Phase 1B-A). Platform-scoped organizations.read; NULL when the organization does not exist or is deleted. Ownership = active members holding org.manage (no separate ownership record exists). Audit (audit.read) is not included; it reads through its own RLS-guarded path.';

-- public.admin_organizations_list(p_search text, p_status text, p_org_type organization_type, p_sort text, p_page integer, p_page_size integer)
CREATE OR REPLACE FUNCTION public.admin_organizations_list(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_org_type organization_type DEFAULT NULL::organization_type, p_sort text DEFAULT 'registered:desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_q      text := nullif(btrim(coalesce(p_search, '')), '');
  v_like   text;
  v_dir    text := split_part(coalesce(p_sort, ''), ':', 2);
  v_result jsonb;
begin
  perform app.admin_require('organizations.read');
  perform app.admin_require_page_args(p_page, p_page_size);
  if p_sort not in ('registered:desc', 'registered:asc') then
    raise exception 'unsupported sort %', p_sort using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'verified', 'suspended') then
    raise exception 'unsupported status filter' using errcode = '22023';
  end if;
  if v_q is not null then
    if char_length(v_q) > 100 then
      raise exception 'search term too long' using errcode = '22023';
    end if;
    v_like := app.admin_search_pattern(v_q);
  end if;

  with scoped as materialized (
    select o.id, o.created_at, app.admin_org_status_tab(o.status) as tab
    from public.organizations o
    where o.deleted_at is null
      and (p_org_type is null or o.org_type = p_org_type)
      and (
        v_q is null
        or o.name ilike v_like escape '\'
        or o.name_ar ilike v_like escape '\'
        or o.name_en ilike v_like escape '\'
      )
  ),
  filtered as materialized (
    select * from scoped where p_status is null or tab = p_status
  ),
  total as (
    select count(*)::int as n from filtered
  ),
  paging as (
    select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::int)) as page from total t
  ),
  ranked as (
    select f.id, row_number() over (order by
        case when v_dir = 'desc' then f.created_at end desc nulls last,
        case when v_dir = 'asc'  then f.created_at end asc  nulls last,
        f.id) as ord
    from filtered f
  ),
  page_ids as (
    select r.id, r.ord from ranked r
    where r.ord > ((select page from paging) - 1) * p_page_size
      and r.ord <= (select page from paging) * p_page_size
  ),
  page_rows as (
    select pi.ord, jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'name_ar', o.name_ar,
      'name_en', o.name_en,
      'org_type', o.org_type,
      'status', o.status,
      'is_verified', o.is_verified,
      'verification_state', case when o.is_verified then 'verified'
                                 when o.status = 'pending_verification' then 'pending'
                                 else 'unverified' end,
      'created_at', o.created_at,
      'source', o.source,
      'member_count', (select count(*) from public.memberships m
                       where m.organization_id = o.id and m.status = 'active'),
      'branch_count', (select count(*) from public.branches b
                       where b.organization_id = o.id and b.deleted_at is null),
      'contact_phone', o.contact_phone,
      'governorate', (select b.governorate_key from public.branches b where b.organization_id = o.id and b.deleted_at is null order by b.created_at, b.id limit 1),
      'city', (select b.city_key from public.branches b where b.organization_id = o.id and b.deleted_at is null order by b.created_at, b.id limit 1),
      'city_custom_name', (select b.city_custom_name from public.branches b where b.organization_id = o.id and b.deleted_at is null order by b.created_at, b.id limit 1),
      'owner', (
        select jsonb_build_object('user_id', m.user_id, 'display_name', coalesce(pr.display_name, ''))
        from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
        left join public.profiles pr on pr.user_id = m.user_id
        where m.organization_id = o.id and m.status = 'active'
        order by m.created_at, m.id
        limit 1)
    ) as row
    from page_ids pi
    join public.organizations o on o.id = pi.id
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(pr.row order by pr.ord) from page_rows pr), '[]'::jsonb),
    'total', (select n from total),
    'page', (select page from paging),
    'page_size', p_page_size,
    'sort', p_sort,
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'pending', count(*) filter (where tab = 'pending'),
        'verified', count(*) filter (where tab = 'verified'),
        'suspended', count(*) filter (where tab = 'suspended'))
      from scoped)
  ) into v_result;

  return v_result;
end;
$function$;
COMMENT ON FUNCTION public.admin_organizations_list(text,text,organization_type,text,integer,integer) IS 'Admin Organizations directory (Phase 1B-A). Platform-scoped organizations.read. Excludes deleted organizations. Server-side search over name / name_ar / name_en, AND-combined filters (status tab, org_type), sort registered asc|desc with organizations.id as the tie-break, pagination over the full matching set. Returns {rows,total,page,page_size,sort,counts}. Contact, city and completion are not returned: organizations have no authoritative source for them.';

-- public.admin_user_detail(p_user_id uuid)
CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  perform app.admin_require('users.read');

  select jsonb_build_object(
    'id', u.id,
    'display_name', coalesce(p.display_name, ''),
    'display_name_ar', p.display_name_ar,
    'display_name_en', p.display_name_en,
    'headline', p.headline,
    'bio', p.bio,
    'email', app.user_facing_email(au.email),
    'phone', p.phone_e164,
    'account_type', app.user_account_type(u.id), 'registered_account', app.registered_account(u.id),
    'status', u.status,
    'is_verified', u.is_verified,
    'locale', u.locale,
    'created_at', u.created_at,
    'last_sign_in_at', au.last_sign_in_at,
    'verification_state', app.admin_user_verification_state(u.is_verified, lv.status),
    'governorate', coalesce(io.prof_governorate, io.consumer_governorate),
    'city', coalesce(io.prof_city, io.consumer_city),
    'completion', (select jsonb_build_object('percent', c -> 'percent', 'missing', c -> 'missing')
                   from app.profile_completion(u.id) c),
    'profile_id', p.id,
    'public_profile_available', p.id is not null
      and exists (select 1 from public.profile_public_directory d where d.id = p.id),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
          'membership_id', m.id,
          'organization_id', o.id,
          'organization_name', o.name,
          'organization_name_ar', o.name_ar,
          'organization_name_en', o.name_en,
          'org_type', o.org_type,
          'status', m.status,
          'created_at', m.created_at,
          'capabilities', coalesce((
            select jsonb_agg(c.capability_key order by c.capability_key)
            from public.membership_capabilities c where c.membership_id = m.id), '[]'::jsonb))
        order by (m.status = 'active') desc, m.created_at, m.id)
      from public.memberships m
      join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = u.id), '[]'::jsonb),
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', v.id,
          'verification_type', v.verification_type,
          'requested_account_type', v.requested_account_type,
          'status', v.status,
          'reason', v.reason,
          'submitted_at', v.submitted_at,
          'decided_at', v.decided_at)
        order by v.submitted_at desc, v.id desc)
      from public.verifications v
      where v.user_id = u.id and v.subject_type = 'user'), '[]'::jsonb)
  )
  into v_result
  from public.users u
  left join public.profiles p on p.user_id = u.id
  left join auth.users au on au.id = u.id
  left join public.individual_onboarding io on io.user_id = u.id
  left join lateral (
    select v.status from public.verifications v
    where v.user_id = u.id and v.subject_type = 'user'
    order by v.submitted_at desc, v.id desc
    limit 1
  ) lv on true
  where u.id = p_user_id;

  return v_result;  -- NULL: no such user
end;
$function$;
COMMENT ON FUNCTION public.admin_user_detail(uuid) IS 'Admin User Details read model (Phase 1B-A). Platform-scoped users.read; NULL when the user does not exist. Points (points.read) and Audit (audit.read) are NOT included — those panels read through their own RLS-guarded paths so a users.read holder never sees them by opening this page. last_sign_in_at is the account''s last sign-in, not product activity.';

-- public.admin_users_directory(p_search text, p_status text, p_account_type text, p_verification text, p_governorate text, p_sort text, p_page integer, p_page_size integer)
CREATE OR REPLACE FUNCTION public.admin_users_directory(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_account_type text DEFAULT NULL::text, p_verification text DEFAULT NULL::text, p_governorate text DEFAULT NULL::text, p_sort text DEFAULT 'registered:desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_q      text := nullif(btrim(coalesce(p_search, '')), '');
  v_like   text;
  v_digits text;
  v_phone  text;
  v_local  text;
  v_field  text := split_part(coalesce(p_sort, ''), ':', 1);
  v_dir    text := split_part(coalesce(p_sort, ''), ':', 2);
  v_result jsonb;
begin
  perform app.admin_require('users.read');
  perform app.admin_require_page_args(p_page, p_page_size);
  if p_sort not in ('registered:desc', 'registered:asc', 'completeness:desc', 'completeness:asc') then
    raise exception 'unsupported sort %', p_sort using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'verified', 'suspended', 'rejected') then
    raise exception 'unsupported status filter' using errcode = '22023';
  end if;
  if p_account_type is not null and p_account_type not in (
       'showroom_dealer', 'supplier', 'manufacturer', 'importer', 'contractor', 'engineer',
       'installer_technician', 'sales', 'end_consumer', 'none') then
    raise exception 'unsupported account type filter' using errcode = '22023';
  end if;
  if p_verification is not null and p_verification not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'unsupported verification filter' using errcode = '22023';
  end if;
  if v_q is not null then
    if char_length(v_q) > 100 then
      raise exception 'search term too long' using errcode = '22023';
    end if;
    v_like := app.admin_search_pattern(v_q);
    -- Phone: fold Arabic-Indic / Persian digits to ASCII, then match the
    -- canonical E.164 column by digit substring or by the database's own
    -- normalization (app.normalize_phone) of the whole term.
    v_digits := regexp_replace(translate(v_q, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
    if char_length(v_digits) >= 3 then
      v_phone := app.normalize_phone(v_digits);
      -- A local number is typed with its trunk 0 (010...), which E.164 drops (+2010...): a partial local
      -- number must match on the digits after that 0.
      if v_digits like '0%' and char_length(v_digits) >= 4 then
        v_local := substr(v_digits, 2);
      end if;
    else
      v_digits := null;
    end if;
  end if;

  with base as materialized (
    select u.id, u.created_at,
           app.admin_user_verification_state(u.is_verified, lv.status) as vstate,
           app.admin_user_status_tab(u.status, lv.status) as tab
    from public.users u
    left join public.profiles p on p.user_id = u.id
    left join public.individual_onboarding io on io.user_id = u.id
    left join lateral (
      select v.status from public.verifications v
      where v.user_id = u.id and v.subject_type = 'user'
      order by v.submitted_at desc, v.id desc
      limit 1
    ) lv on true
    where (p_account_type is null or coalesce(app.user_account_type(u.id), 'none') = p_account_type)
      and (p_governorate is null or coalesce(io.prof_governorate, io.consumer_governorate) = p_governorate)
      and (
        v_q is null
        or p.display_name ilike v_like escape '\'
        or p.display_name_ar ilike v_like escape '\'
        or p.display_name_en ilike v_like escape '\'
        or u.id in (
          select au.id from auth.users au
          where app.user_facing_email(au.email) ilike v_like escape '\')
        or (v_digits is not null and (p.phone_e164 like '%' || v_digits || '%' or p.phone_e164 = v_phone
                                    or (v_local is not null and p.phone_e164 like '%' || v_local || '%')))
      )
  ),
  scoped as materialized (
    select * from base where p_verification is null or vstate = p_verification
  ),
  filtered as materialized (
    select * from scoped where p_status is null or tab = p_status
  ),
  total as (
    select count(*)::int as n from filtered
  ),
  paging as (
    select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::int)) as page from total t
  ),
  -- Completion is computed only when it is the sort key (CASE is lazy), and
  -- users.id is the final key, so equal dates/percentages never reorder
  -- between pages.
  ranked as (
    select f.id, row_number() over (order by
        case when v_field = 'registered' and v_dir = 'desc' then f.created_at end desc nulls last,
        case when v_field = 'registered' and v_dir = 'asc'  then f.created_at end asc  nulls last,
        case when v_field = 'completeness' and v_dir = 'desc' then (app.profile_completion(f.id) ->> 'percent')::int end desc nulls last,
        case when v_field = 'completeness' and v_dir = 'asc'  then (app.profile_completion(f.id) ->> 'percent')::int end asc  nulls last,
        f.id) as ord
    from filtered f
  ),
  page_ids as (
    select r.id, r.ord from ranked r
    where r.ord > ((select page from paging) - 1) * p_page_size
      and r.ord <= (select page from paging) * p_page_size
  ),
  page_rows as (
    select pi.ord, jsonb_build_object(
      'id', u.id,
      'display_name', coalesce(p.display_name, ''),
      'display_name_ar', p.display_name_ar,
      'display_name_en', p.display_name_en,
      'email', app.user_facing_email(au.email),
      'phone', p.phone_e164,
      'account_type', app.user_account_type(u.id), 'registered_account', app.registered_account(u.id),
      'status', u.status,
      'is_verified', u.is_verified,
      'created_at', u.created_at,
      'verification_state', app.admin_user_verification_state(u.is_verified, lv.status),
      'latest_verification_status', lv.status,
      'governorate', coalesce(io.prof_governorate, io.consumer_governorate),
      'city', coalesce(io.prof_city, io.consumer_city),
      'completion', (app.profile_completion(u.id) ->> 'percent')::int,
      'organization', case when org.id is null then null
                           else jsonb_build_object('id', org.id, 'name', org.name, 'name_ar', org.name_ar, 'name_en', org.name_en) end,
      'organization_count', coalesce(org.cnt, 0),
      'profile_id', p.id,
      'public_profile_available', p.id is not null
        and exists (select 1 from public.profile_public_directory d where d.id = p.id),
      'flags', case when lv.status = 'rejected' then '["verification_issue"]'::jsonb else '[]'::jsonb end
    ) as row
    from page_ids pi
    join public.users u on u.id = pi.id
    left join public.profiles p on p.user_id = u.id
    left join auth.users au on au.id = u.id
    left join public.individual_onboarding io on io.user_id = u.id
    left join lateral (
      select v.status from public.verifications v
      where v.user_id = u.id and v.subject_type = 'user'
      order by v.submitted_at desc, v.id desc
      limit 1
    ) lv on true
    left join lateral (
      select o.id, o.name, o.name_ar, o.name_en, count(*) over () as cnt
      from public.memberships m
      join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = u.id and m.status = 'active'
      order by m.created_at, m.id
      limit 1
    ) org on true
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(pr.row order by pr.ord) from page_rows pr), '[]'::jsonb),
    'total', (select n from total),
    'page', (select page from paging),
    'page_size', p_page_size,
    'sort', p_sort,
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'pending', count(*) filter (where tab = 'pending'),
        'verified', count(*) filter (where tab = 'verified'),
        'suspended', count(*) filter (where tab = 'suspended'),
        'rejected', count(*) filter (where tab = 'rejected'))
      from scoped)
  ) into v_result;

  return v_result;
end;
$function$;
COMMENT ON FUNCTION public.admin_users_directory(text,text,text,text,text,text,integer,integer) IS 'Admin Users directory. Platform-scoped users.read. Server-side search (display names, account email, canonical phone incl. a local number with its trunk 0), AND-combined filters (status tab, derived account type = one of the nine public account keys or none, verification state, governorate), sort registered|completeness asc|desc with users.id as the deterministic tie-break, and pagination over the FULL matching set. Returns {rows,total,page,page_size,sort,counts}; page is clamped to the last page. counts are the status-tab totals under every filter except the status tab itself. rows[].account_type is app.user_account_type.';

-- public.apply_account_upgrade(p_verification_id uuid)
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
COMMENT ON FUNCTION public.apply_account_upgrade(uuid) IS 'Applies an APPROVED personal-persona review to the identity. Platform authority, approved-only, expiry-checked, idempotent via applied_at, audited. Accepts a NULL starting persona — since Sprint 13 that is the normal state of an individual professional awaiting their first approval.';

-- public.apply_organization_verification(p_verification_id uuid)
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
COMMENT ON FUNCTION public.apply_organization_verification(uuid) IS 'Apply an APPROVED organization verification: sets organizations.is_verified and releases a draft/pending_verification organization to active. Platform-authority only, approved-only, expiry-checked, idempotent via verifications.applied_at, audited as organization.verified. The organization-subject counterpart of apply_account_upgrade — same review system, not a second one.';

-- public.business_verification_request_info(p_verification_id uuid, p_reason text)
CREATE OR REPLACE FUNCTION public.business_verification_request_info(p_verification_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        public.verifications;
  v_reason text := app.bv_reason(p_reason, 'requesting more information');
begin
  if not app.is_business_verification_reviewer() then
    raise exception 'admin permission organizations.verify required' using errcode = '42501';
  end if;
  v := app.bv_lock_for_review(p_verification_id);
  if v.status <> 'under_review' then
    raise exception 'invalid transition to needs_more_info from %', v.status using errcode = '22023';
  end if;
  -- The assigned reviewer, or an approver taking over.
  if v.reviewer_id is distinct from (select auth.uid()) and not app.has_admin_permission('verification.approve') then
    raise exception 'only the assigned reviewer may request more information' using errcode = '42501';
  end if;
  update public.verifications set status = 'needs_more_info', reason = v_reason, reviewer_id = (select auth.uid())
   where id = v.id;
  perform app.record_audit_event('business_verification.info_requested', 'verification', v.id, v.organization_id,
    jsonb_build_object('reason', v_reason));
  perform app.notify_org(v.organization_id, 'org.manage', 'verification.changes_requested', 'verification', v.id,
    '/showroom/verification', 'notifications.businessVerification.infoRequested.title',
    'notifications.businessVerification.infoRequested.body', '{}'::jsonb);
end;
$function$;

-- public.review_approve(p_verification_id uuid, p_grant_public_listing boolean)
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

-- public.review_reject(p_verification_id uuid, p_reason text)
CREATE OR REPLACE FUNCTION public.review_reject(p_verification_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.can_review_verification(p_verification_id) then
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
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.rejected', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.rejected.title', 'notifications.verification.rejected.body',
      '{}'::jsonb);
  end if;
end;
$function$;

-- the dropped function comes back with the Production ACL: owner only (acl {postgres=X/postgres})
REVOKE ALL ON FUNCTION app.showroom_review_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS showroom_review_complete ON public.verifications;
CREATE TRIGGER showroom_review_complete BEFORE UPDATE OF status ON public.verifications FOR EACH ROW EXECUTE FUNCTION app.showroom_review_guard();

-- 20261115090002 relaxed the rejection reason; put the old rule back. NOT VALID first so a row that now breaks it cannot make the recovery fail.
ALTER TABLE public.verifications DROP CONSTRAINT IF EXISTS ck_verifications_reason_required;
ALTER TABLE public.verifications ADD CONSTRAINT ck_verifications_reason_required CHECK (((status <> ALL (ARRAY['rejected'::verification_status, 'needs_more_info'::verification_status])) OR ((reason IS NOT NULL) AND (length(btrim(reason)) > 0)))) NOT VALID;
do $v1$ begin
  alter table public.verifications validate constraint ck_verifications_reason_required;
exception when check_violation then
  raise notice 'ck_verifications_reason_required stays NOT VALID: rows written while the catch-up was live break it (they are not changed)';
end $v1$;

-- 'verification.admin_initiated' was added by 20261115090002 through app.audit_actions_add
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS ck_audit_action_known;
ALTER TABLE public.audit_log ADD CONSTRAINT ck_audit_action_known CHECK ((action = ANY (ARRAY['organization.created'::text, 'membership.granted'::text, 'membership.activated'::text, 'membership.role_changed'::text, 'membership.suspended'::text, 'membership.revoked'::text, 'branch.created'::text, 'branch.assignment_changed'::text, 'platform_role.granted'::text, 'platform_role.revoked'::text, 'platform.override_used'::text, 'account.upgrade_requested'::text, 'verification.review_started'::text, 'verification.changes_requested'::text, 'verification.approved'::text, 'verification.rejected'::text, 'account.type_changed'::text, 'profile.listed'::text, 'profile.hidden'::text, 'customer.created'::text, 'customer.updated'::text, 'lead.created'::text, 'lead.assigned'::text, 'lead.reassigned'::text, 'lead.stage_changed'::text, 'lead.won'::text, 'lead.lost'::text, 'lead.reopened'::text, 'lead.archived'::text, 'followup.created'::text, 'followup.reassigned'::text, 'followup.completed'::text, 'followup.reopened'::text, 'customer.reassigned'::text, 'lead.details_changed'::text, 'onboarding.completed'::text, 'onboarding.consumer_completed'::text, 'onboarding.professional_submitted'::text, 'onboarding.organization_created'::text, 'product.created'::text, 'product.updated'::text, 'product.published'::text, 'product.unpublished'::text, 'rfq.created'::text, 'rfq.submitted'::text, 'rfq.updated'::text, 'rfq.cancelled'::text, 'rfq.closed'::text, 'quotation.created'::text, 'quotation.updated'::text, 'quotation.submitted'::text, 'quotation.accepted'::text, 'quotation.rejected'::text, 'order.created'::text, 'order.started'::text, 'order.completed'::text, 'order.cancelled'::text, 'project.created'::text, 'project.activated'::text, 'project.completed'::text, 'organization.verified'::text, 'affiliation.requested'::text, 'affiliation.cancelled'::text, 'affiliation.approved'::text, 'affiliation.rejected'::text, 'referral.submitted'::text, 'referral.approved'::text, 'referral.rejected'::text, 'conversation.opened'::text, 'points.adjusted'::text, 'points.reversed'::text, 'job.created'::text, 'job.updated'::text, 'job.published'::text, 'job.closed'::text, 'job.cancelled'::text, 'job.application.submitted'::text, 'job.application.withdrawn'::text, 'job.application.accepted'::text, 'job.application.rejected'::text, 'job.assignment.started'::text, 'job.assignment.progress_updated'::text, 'job.assignment.completed'::text, 'job.assignment.cancelled'::text, 'job.review.submitted'::text, 'job.review.suppressed'::text, 'job.review.restored'::text, 'network_referral.submitted'::text, 'network_referral.joined'::text, 'network_referral.approved'::text, 'network_referral.rejected'::text, 'network_referral.cancelled'::text, 'profile.username_set'::text, 'profile.phone_set'::text, 'profile.avatar_set'::text, 'organization.activities_set'::text, 'user.activities_set'::text, 'product.archived'::text, 'product.restored'::text, 'product.image_added'::text, 'product.image_removed'::text, 'product.image_reordered'::text, 'offer.created'::text, 'offer.updated'::text, 'offer.published'::text, 'offer.paused'::text, 'offer.resumed'::text, 'offer.archived'::text, 'organization.contact_set'::text, 'profile.contact_visibility_set'::text, 'network_candidate.submitted'::text, 'network_candidate.approved'::text, 'network_candidate.rejected'::text, 'network_candidate.cancelled'::text, 'product.audiences_set'::text, 'purchase_request.created'::text, 'purchase_request.updated'::text, 'purchase_request.published'::text, 'purchase_request.closed'::text, 'purchase_request.cancelled'::text, 'purchase_request.image_added'::text, 'purchase_request.image_removed'::text, 'purchase_request_response.submitted'::text, 'purchase_request_response.withdrawn'::text, 'purchase_request_response.shortlisted'::text, 'purchase_request_response.unshortlisted'::text, 'organization.application_submitted'::text, 'organization.application_abandoned'::text, 'organization.identity_change_requested'::text, 'organization.identity_change_withdrawn'::text, 'organization.identity_changed'::text, 'organization.co_owner_requested'::text, 'organization.co_owner_verified'::text, 'organization.co_owner_revoked'::text, 'branch.verification_requested'::text, 'branch.verified'::text, 'branch.deactivated'::text, 'branch.reactivated'::text, 'branch.verification_revoked'::text, 'publisher.requested'::text, 'publisher.approved'::text, 'publisher.suspended'::text, 'publisher.revoked'::text, 'publisher.reinstated'::text, 'organization.image_set'::text, 'organization.image_removed'::text, 'organization.description_changed'::text, 'account.platform_cleanup'::text, 'account.platform_prepared'::text, 'account.restored'::text, 'account.suspended'::text, 'admin_case.created'::text, 'admin_follow_up.completed'::text, 'admin_follow_up.logged'::text, 'admin_note.created'::text, 'admin_role.archived'::text, 'admin_role.assigned'::text, 'admin_role.assignment_changed'::text, 'admin_role.created'::text, 'admin_role.permissions_changed'::text, 'admin_role.restored'::text, 'admin_role.unassigned'::text, 'admin_role.updated'::text, 'admin_staff.disabled'::text, 'admin_staff.restored'::text, 'organization.duplicate_dismissed'::text, 'organization.duplicate_linked'::text, 'organization.restored'::text, 'organization.suspended'::text, 'organization.legal_name_changed'::text, 'branch.location_changed'::text, 'business_verification.approved'::text, 'business_verification.document_added'::text, 'business_verification.document_removed'::text, 'business_verification.info_requested'::text, 'business_verification.rejected'::text, 'business_verification.review_started'::text, 'business_verification.submitted'::text, 'account.password_confirm_locked'::text, 'account.password_confirmed'::text, 'phone_cooldown.overridden'::text, 'secondary_phone.cancelled'::text, 'secondary_phone.changed'::text, 'secondary_phone.converted'::text, 'secondary_phone.renewed'::text, 'secondary_phone.reserved'::text, 'media.historical_purge'::text, 'profile.password_changed'::text, 'profile.phone_change_compensated'::text, 'profile.phone_change_needs_attention'::text, 'profile.phone_changed'::text, 'profile.phone_alias_exception_issued'::text, 'profile.phone_alias_exception_revoked'::text, 'profile.phone_alias_exception_used'::text, 'contact.email_claim_started'::text, 'contact.email_removed'::text, 'contact.email_verified'::text, 'contact.support_lookup'::text, 'contact.support_released'::text, 'profile.cover_set'::text, 'phone_verification.completed'::text, 'phone_verification.started'::text, 'whatsapp_otp.settings_change_failed'::text, 'whatsapp_otp.settings_changed'::text, 'whatsapp_otp.settings_requested'::text, 'admin_staff.invitation_accepted'::text, 'admin_staff.invitation_revoked'::text, 'admin_staff.invited'::text, 'whatsapp_otp.delivery_change_failed'::text, 'whatsapp_otp.delivery_changed'::text, 'whatsapp_otp.delivery_requested'::text, 'organization.social_links_changed'::text, 'backup.environment_initialized'::text, 'backup.production_activated'::text, 'backup.production_deactivated'::text, 'backup.run_dispatched'::text, 'backup.run_failed'::text, 'backup.run_requested'::text, 'backup.run_verified'::text, 'backup.settings_changed'::text]))) NOT VALID;
do $v2$ begin
  alter table public.audit_log validate constraint ck_audit_action_known;
exception when check_violation then
  raise notice 'ck_audit_action_known stays NOT VALID: audit rows with the new action exist (they are not changed)';
end $v2$;

DROP TRIGGER IF EXISTS craftsman_review_complete ON public.verifications;
DROP FUNCTION IF EXISTS app.craftsman_review_guard();
DROP FUNCTION IF EXISTS public.craftsman_profile_verification_submit(boolean);
DROP FUNCTION IF EXISTS public.admin_initiate_verification(text, uuid, text);
DROP FUNCTION IF EXISTS app.admin_user_registration_state(uuid);
DROP FUNCTION IF EXISTS app.registration_gate_allows(text, text);
DROP FUNCTION IF EXISTS app.assert_assigned_reviewer(public.verifications);

commit;

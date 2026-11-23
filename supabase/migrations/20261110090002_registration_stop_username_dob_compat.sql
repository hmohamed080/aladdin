-- ===========================================================================
-- P1 / M1 - registration stops requiring a username and a birth date (DATABASE COMPATIBILITY STEP).
-- Master plan: ALADDIN_ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md section 4. Forward-only, expand step only.
--
-- GOAL. After this migration the NEW app (sends no username and no birth date; never calls username_available or
-- profile_set_username) AND the OLD app (still sends them) both work against the same database. Nothing is dropped.
--
--   1. app.pending_registrations.username - NO CHANGE NEEDED. 20261028090003 already dropped NOT NULL and replaced the
--      shape with ck_pending_registrations_lease_shape ((username is null) = (username_reserved_at is null)), which
--      admits a NULL/NULL row and still validates the old shape whenever a username is present. The audience columns
--      stay NOT NULL (the new app still sends the account type). pgTAP 125 proves it.
--   2. public.pending_registration_save - NO CHANGE NEEDED. A NULL p_username already skips the name check, takes no
--      advisory lock and no lease, and stores only audience_kind/audience_value (v_norm stays NULL, v_grant false).
--      The signature is unchanged, so supabase.rpc('pending_registration_save', {..., p_username: null}) binds by name
--      (a NULL argument is valid; OMITTING p_username would not resolve, because only p_ttl_minutes has a default and
--      Postgres cannot default a middle argument - the new app must pass p_username: null explicitly).
--   3. public.pending_registration_consume - NO CHANGE NEEDED. It already returns username NULL whenever no active lease
--      backs it and never requires or claims one; the return type stays table(username, audience_kind, audience_value).
--   4. public.my_registration_state - CHANGED: the username_pending branch is removed (section 1 below).
--   5. app.profile_completion - CHANGED: the 'username' criterion is removed and the denominator rebalanced (section 2).
--   6. public.admin_users_directory - CHANGED: the free-text search no longer matches profiles.username (section 3).
--      public.admin_user_detail is NOT touched: it never searched by username.
--   7. public.username_available and public.profile_set_username are deliberately left exactly as they are so an OLD app
--      keeps working. They are slated for retirement in M2 (after the old app is gone), together with the
--      username lease helpers; this migration neither drops nor changes them.
--
-- BIRTH DATE. The birth date was never a database requirement: it is validated and kept in the application and in the
-- auth metadata of the account; no table, column or function here requires it, so nothing in SQL changes for it.
-- Existing stored usernames (profiles.username, profiles.username_normalized and its unique index) are left untouched.
--
-- SECURITY. Every function below is re-created SECURITY DEFINER with search_path = '' and its grants re-asserted; no
-- function is dropped, no signature or return type changes, nothing uses CASCADE, and auth.users is not touched.
--
-- ROLLBACK (forward-fix, never a down migration): CREATE OR REPLACE the three functions again with their previous
-- definitions - my_registration_state from 20260924090007, app.profile_completion from 20261107090002,
-- admin_users_directory from 20261021090003 - and re-assert the same grants.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. my_registration_state: a missing username no longer blocks anything.
--    Copied from its latest definition (20260924090007) with ONLY the username lookup and the username_pending return
--    removed. Every earlier return, and its order, is byte-for-byte the same:
--    unverified -> manually_blocked -> active_personal (membership or users.status = 'active') -> consent_pending ->
--    account_type_pending -> access_ready. username_pending was the last gate before access_ready, so removing it can
--    only turn that one outcome into access_ready; it can never skip account_type_pending, consent_pending,
--    verification (unverified) or a block, all of which are decided earlier in the function.
-- ---------------------------------------------------------------------------
create or replace function public.my_registration_state()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_confirmed   boolean;
  v_status      public.user_status;
  v_has_consent boolean;
  v_op          public.onboarding_progress;
begin
  if v_uid is null then
    return 'unverified';
  end if;
  select (au.email_confirmed_at is not null) into v_confirmed from auth.users au where au.id = v_uid;
  if not coalesce(v_confirmed, false) then
    return 'unverified';
  end if;

  select u.status into v_status from public.users u where u.id = v_uid;
  if v_status in ('suspended', 'deactivated') then
    return 'manually_blocked';
  end if;

  -- UNCHANGED early-return, UNCHANGED meaning, UNCHANGED position — this
  -- branch is never touched by anything below it. active_personal keeps
  -- exactly its current, tested guarantee (22_business_onboarding_test.sql
  -- keeps passing unmodified). An account that reaches this point never sees
  -- account_type_pending/access_ready below, no matter what state its
  -- account-type intent is in.
  if exists (select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active')
     or v_status = 'active' then
    return 'active_personal';
  end if;

  select count(distinct cr.consent_type) = 3 into v_has_consent
  from public.consent_receipts cr
  where cr.user_id = v_uid
    and cr.consent_type in ('terms', 'privacy', 'pilot')
    and cr.version = app.current_consent_version(cr.consent_type);
  if not coalesce(v_has_consent, false) then
    return 'consent_pending';
  end if;
  -- Documented explicitly (correction #6 of the staging-prep revision): the
  -- active-membership/status check above runs BEFORE this consent check.
  -- That ordering is pre-existing across every historical version of this
  -- function and is intentional ONLY as a grandfather clause for
  -- already-active legacy accounts that predate consent capture. It cannot
  -- be reached by a genuinely NEW registrant before they pass consent:
  -- nothing in this codebase creates a membership or sets
  -- users.status='active' before consent is recorded, so a new registrant
  -- always fails the membership/status check first and lands on the consent
  -- check on the very same call.

  select * into v_op from public.onboarding_progress where user_id = v_uid;

  -- profile_pending / contact_pending / every track-specific sub-state:
  -- REMOVED as return values of THIS function. They stop gating entry. Their
  -- informational value (e.g. "business track, no org yet") moves to the
  -- new, non-gating public.my_profile_completion() RPC — this function no
  -- longer knows or cares about profile/contact/org completeness.
  if v_op.account_type_completed_at is null then
    return 'account_type_pending';
  end if;


  -- Session + confirmed email + consent + a known audience: the person may enter. (P1 M1: a username is no longer
  -- part of this; the old username_pending gate between account_type_pending and here is gone.) access_ready stays
  -- distinct from active_personal by construction: it is never returned by the early-return above, never implies an
  -- active membership and never implies users.status = 'active'.
  return 'access_ready';
end;
$$;

comment on function public.my_registration_state() is
  'Derived registration/access state: unverified, manually_blocked, active_personal (real active membership or users.status=active, unchanged), consent_pending, account_type_pending, access_ready. username_pending is no longer returned (P1 M1): a username is not registration data any more. The earlier branches and their order are unchanged, so removing it cannot bypass account type, consent, verification or a block.';
revoke execute on function public.my_registration_state() from public, anon, service_role;
grant  execute on function public.my_registration_state() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.profile_completion: the 'username' criterion is gone.
--    Copied from its latest definition (20261107090002) with ONLY the username line removed and the all-audiences
--    denominator lowered from 4 to 3. The checklist is now avatar, phone, display_name (+ the persona and organization
--    items, unchanged), so percent = done / total is computed over the new total. CONTRACT CHANGE (documented, not
--    breaking): `missing` never contains 'username' again and `percent` is rebalanced (a user missing only avatar went
--    from 75 to 67). Return shape {percent, missing, audience, has_org} is unchanged. Old clients that map a
--    'username' key simply never see it; public.my_profile_completion() and the Admin directory both read this one
--    function, so they stay consistent.
-- ---------------------------------------------------------------------------
create or replace function app.profile_completion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid       uuid := p_user_id;
  v_profile   public.profiles;
  v_op        public.onboarding_progress;
  v_io        public.individual_onboarding;
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
  v_missing   text[] := '{}'::text[];
  v_total     int := 0;
  v_done      int := 0;
  v_has_org   boolean := false;
  v_can_manage boolean := false;
  v_needs_activities boolean := false;
begin
  select * into v_profile from public.profiles where user_id = v_uid;
  select * into v_op from public.onboarding_progress where user_id = v_uid;
  select * into v_io from public.individual_onboarding where user_id = v_uid;
  v_persona := coalesce(app.effective_persona(v_uid), v_op.selected_persona);
  v_org_type := v_op.selected_org_type;

  -- ALL-AUDIENCES criteria (username retired in P1 M1). 'locality' is intentionally absent (product-owner
  -- decision 2026-09-24, see 20260924090011 header §7).
  v_total := v_total + 3;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'avatar'); end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'phone'); end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'display_name'); end if;

  -- Installers: the approved "Complete your profile" page (/home/profile) has no headline and makes "about me"
  -- optional, so they are not counted. It asks for experience, specialties, availability, a governorate and city,
  -- and at least one portfolio project, and those are what count.
  if v_persona = 'installer_technician' then
    v_total := v_total + 5;
    if coalesce(v_io.prof_years_experience, 0) > 0 then v_done := v_done + 1; else v_missing := array_append(v_missing, 'years_experience'); end if;
    if exists (select 1 from public.user_trades ut join public.trades t on t.id = ut.trade_id
                where ut.user_id = v_uid and t.is_active) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'activities');
    end if;
    if v_io.prof_availability is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'availability'); end if;
    if exists (select 1 from public.user_service_areas a where a.user_id = v_uid and a.is_primary) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'location');
    end if;
    if exists (select 1 from public.portfolio_projects p where p.owner_user_id = v_uid) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'portfolio');
    end if;
  elsif v_persona is not null and v_persona in
     ('installer_technician', 'engineer', 'contractor', 'sales') then
    v_total := v_total + 3;
    if v_profile.headline is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'headline'); end if;
    if v_io.prof_years_experience is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'years_experience'); end if;
    if v_profile.bio is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'bio'); end if;

    v_needs_activities := v_persona = 'installer_technician'
      or exists (select 1 from public.activities a where a.persona_type = v_persona and a.is_active);
    if v_needs_activities then
      v_total := v_total + 1;
      if exists (select 1 from public.user_activities ua where ua.user_id = v_uid)
         or (v_persona = 'installer_technician' and exists (
               select 1 from public.user_trades ut
               join public.trades t on t.id = ut.trade_id
               where ut.user_id = v_uid and t.is_active)) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'activities');
      end if;
    end if;
  end if;

  if v_org_type is not null then
    select exists (
      select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active'
    ) into v_has_org;
    select exists (
      select 1 from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id
      where m.user_id = v_uid and m.status = 'active' and c.capability_key = 'org.manage'
    ) into v_can_manage;

    v_total := v_total + 1;
    if v_has_org then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'organization_setup');
    end if;
    if v_can_manage then
      v_total := v_total + 1;
      if exists (
        select 1 from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
        join public.organization_activities oa on oa.organization_id = m.organization_id
        where m.user_id = v_uid and m.status = 'active'
      ) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'organization_activities');
      end if;
    end if;
  end if;

  if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer') then
    v_total := v_total + 1;
    if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer' and not app.showroom_address_complete(o.id)) then
      v_missing := array_append(v_missing,'organization_address');
    else v_done := v_done + 1; end if;

    -- A showroom needs at least one social or website link (a legacy showroom created by an old client has none).
    v_total := v_total + 1;
    if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer' and num_nonnulls(o.facebook_url, o.instagram_url, o.tiktok_url, o.website_url) = 0) then
      v_missing := array_append(v_missing,'organization_links');
    else v_done := v_done + 1; end if;
  end if;
  return jsonb_build_object(
    'percent', case when v_total = 0 then 100 else round(100.0 * v_done / v_total) end,
    'missing', to_jsonb(v_missing),
    'audience', jsonb_build_object('persona', v_persona, 'organization_type', v_org_type),
    'has_org', v_has_org
  );
end;
$function$;
revoke execute on function app.profile_completion(uuid) from public,anon,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. public.admin_users_directory: search no longer matches profiles.username.
--    Copied from its latest definition (20261021090003) with ONLY the `p.username ilike` search term removed and the
--    comment text updated. Permission check (users.read), argument list, return shape, SECURITY DEFINER and
--    search_path = '' are unchanged. rows[].username is still emitted from the stored legacy value (existing accounts
--    keep their username; the Admin mapper reads it with a null-tolerant reader), so neither the old nor the new
--    Admin UI breaks; the key is slated for removal with the column in a later migration. public.admin_users_list
--    delegates to this function and needs no change.
-- ---------------------------------------------------------------------------
create or replace function public.admin_users_directory(
  p_search       text default null,
  p_status       text default null,
  p_account_type text default null,
  p_verification text default null,
  p_governorate  text default null,
  p_sort         text default 'registered:desc',
  p_page         int  default 1,
  p_page_size    int  default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      'username', p.username,
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
$$;

comment on function public.admin_users_directory(text, text, text, text, text, text, int, int) is
  'Admin Users directory. Platform-scoped users.read. Server-side search (display names, account email, canonical phone incl. a local number with its trunk 0), AND-combined filters (status tab, derived account type = one of the nine public account keys or none, verification state, governorate), sort registered|completeness asc|desc with users.id as the deterministic tie-break, and pagination over the FULL matching set. Returns {rows,total,page,page_size,sort,counts}; page is clamped to the last page. counts are the status-tab totals under every filter except the status tab itself. rows[].account_type is app.user_account_type.';
revoke execute on function public.admin_users_directory(text, text, text, text, text, text, int, int) from public, anon;
grant execute on function public.admin_users_directory(text, text, text, text, text, text, int, int) to authenticated;

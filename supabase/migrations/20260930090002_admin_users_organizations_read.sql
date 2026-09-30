-- ===========================================================================
-- Admin Core Phase 1B-A — Users & Organizations production read contracts.
--
-- Replaces the Admin Preview's 200-row snapshot (listUsers / listOrganizations
-- + JavaScript search/filter/sort/pagination) with four server-side,
-- permission-checked, deterministic read RPCs:
--
--   admin_users_list          users.read            paged directory + tab counts
--   admin_user_detail         users.read            one user's read model
--   admin_organizations_list  organizations.read    paged directory + tab counts
--   admin_organization_detail organizations.read    one organization's read model
--
-- Field sources are audited in docs/admin/ADMIN_USERS_ORGS_READ_AUDIT.md.
--
-- SCOPE (ADR-0011 §3). Every RPC calls app.admin_require(<perm>), i.e.
-- app.has_admin_permission(<perm>) WITHOUT context, which matches PLATFORM
-- assignments only. An organization-, branch- or user-scoped assignment of
-- users.read / organizations.read therefore cannot read the global
-- directories — it is refused (42501), never silently widened.
--
-- PRIVATE IDENTITY DATA. Email comes from auth.users.email (the account's real
-- sign-in email; public.contacts is written by no product path). It is read
-- only inside these security-definer functions, after the permission check,
-- and the Installer/Technician phone-login alias is dropped exactly as the
-- application's userFacingEmail() and app.mask_email do. Only the fields the
-- approved Admin UI renders are returned — no auth metadata, no provider data.
--
-- PROFILE COMPLETION comes from app.profile_completion(user_id)
-- (20260930090001_profile_completion_shared.sql) — the same formula behind the
-- user's own "Complete your profile" card, never a second Admin formula.
--
-- Nothing here writes, and no RLS policy or grant on an existing table changes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2. Small shared derivations (one definition for list and detail)
--
-- The four per-row helpers below deliberately carry NO `set search_path`: a
-- SQL function with a SET clause is never inlined, and at 20k users that cost
-- the directory ~200 ms of pure call overhead (measured: 256 ms -> 61 ms).
-- They are safe without it: every identifier is schema-qualified or a
-- pg_catalog built-in, they have no client grant, and their only callers are
-- the security-definer RPCs below, which pin search_path = '' themselves.
-- ---------------------------------------------------------------------------

-- The account email as a person-facing value: NULL for the Installer/Technician
-- phone-login alias (a login key, never a contact). Same domain as
-- app.mask_email and frontend lib/auth/craftsman-login-alias.ts.
create or replace function app.user_facing_email(p_email text)
returns text
language sql
immutable
as $$
  select case
    when p_email is null or btrim(p_email) = '' then null
    when lower(split_part(p_email, '@', 2)) = 'craftsman-login.aladdin.invalid' then null
    else btrim(p_email)
  end
$$;
revoke execute on function app.user_facing_email(text) from public, anon, authenticated;

-- Verification state shown in the Users directory: the latest user-subject
-- verification decides, falling back to users.is_verified.
create or replace function app.admin_user_verification_state(p_is_verified boolean, p_latest public.verification_status)
returns text
language sql
immutable
as $$
  select case
    when p_latest = 'rejected' then 'rejected'
    when p_latest = 'approved' or p_is_verified then 'verified'
    when p_latest in ('submitted', 'under_review') then 'pending'
    else 'unverified'
  end
$$;
revoke execute on function app.admin_user_verification_state(boolean, public.verification_status) from public, anon, authenticated;

-- The approved Phase 0D status tabs (Pending / Verified / Suspended / Rejected)
-- over real state. NULL = shown under "All" only (e.g. deactivated).
create or replace function app.admin_user_status_tab(p_status public.user_status, p_latest public.verification_status)
returns text
language sql
immutable
as $$
  select case
    when p_status = 'suspended' then 'suspended'
    when p_latest = 'rejected' then 'rejected'
    when p_status = 'active' then 'verified'
    when p_status = 'pending_verification' then 'pending'
  end
$$;
revoke execute on function app.admin_user_status_tab(public.user_status, public.verification_status) from public, anon, authenticated;

create or replace function app.admin_org_status_tab(p_status public.org_status)
returns text
language sql
immutable
as $$
  select case p_status
    when 'suspended' then 'suspended'
    when 'active' then 'verified'
    when 'pending_verification' then 'pending'
  end
$$;
revoke execute on function app.admin_org_status_tab(public.org_status) from public, anon, authenticated;

-- LIKE pattern for a free-text search term (wildcards escaped; '\' is the escape).
create or replace function app.admin_search_pattern(p_term text)
returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;
revoke execute on function app.admin_search_pattern(text) from public, anon, authenticated;

-- Shared argument validation for the two directories.
create or replace function app.admin_require_page_args(p_page int, p_page_size int)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_page is null or p_page < 1 then
    raise exception 'page must be a positive integer' using errcode = '22023';
  end if;
  if p_page_size is null or p_page_size not in (10, 25, 50, 100) then
    raise exception 'page size must be one of 10, 25, 50, 100' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function app.admin_require_page_args(int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Users directory
-- ---------------------------------------------------------------------------
create or replace function public.admin_users_list(
  p_search       text default null,
  p_status       text default null,
  p_account_type public.persona_type default null,
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
    where (p_account_type is null or u.primary_account_type = p_account_type)
      and (p_governorate is null or coalesce(io.prof_governorate, io.consumer_governorate) = p_governorate)
      and (
        v_q is null
        or p.display_name ilike v_like escape '\'
        or p.display_name_ar ilike v_like escape '\'
        or p.display_name_en ilike v_like escape '\'
        or p.username ilike v_like escape '\'
        or u.id in (
          select au.id from auth.users au
          where app.user_facing_email(au.email) ilike v_like escape '\')
        or (v_digits is not null and (p.phone_e164 like '%' || v_digits || '%' or p.phone_e164 = v_phone))
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
      'account_type', u.primary_account_type,
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
comment on function public.admin_users_list(text, text, public.persona_type, text, text, text, int, int) is
  'Admin Users directory (Phase 1B-A). Platform-scoped users.read. Server-side search (display names, username, account email, canonical phone), AND-combined filters (status tab, persona, verification state, governorate), sort registered|completeness asc|desc with users.id as the deterministic tie-break, and pagination over the FULL matching set. Returns {rows,total,page,page_size,sort,counts}; page is clamped to the last page. counts are the status-tab totals under every filter except the status tab itself.';
revoke execute on function public.admin_users_list(text, text, public.persona_type, text, text, text, int, int) from public, anon;
grant execute on function public.admin_users_list(text, text, public.persona_type, text, text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. User details
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform app.admin_require('users.read');

  select jsonb_build_object(
    'id', u.id,
    'display_name', coalesce(p.display_name, ''),
    'display_name_ar', p.display_name_ar,
    'display_name_en', p.display_name_en,
    'username', p.username,
    'headline', p.headline,
    'bio', p.bio,
    'email', app.user_facing_email(au.email),
    'phone', p.phone_e164,
    'account_type', u.primary_account_type,
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
$$;
comment on function public.admin_user_detail(uuid) is
  'Admin User Details read model (Phase 1B-A). Platform-scoped users.read; NULL when the user does not exist. Points (points.read) and Audit (audit.read) are NOT included — those panels read through their own RLS-guarded paths so a users.read holder never sees them by opening this page. last_sign_in_at is the account''s last sign-in, not product activity.';
revoke execute on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Organizations directory
-- ---------------------------------------------------------------------------
create or replace function public.admin_organizations_list(
  p_search    text default null,
  p_status    text default null,
  p_org_type  public.organization_type default null,
  p_sort      text default 'registered:desc',
  p_page      int  default 1,
  p_page_size int  default 10
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
$$;
comment on function public.admin_organizations_list(text, text, public.organization_type, text, int, int) is
  'Admin Organizations directory (Phase 1B-A). Platform-scoped organizations.read. Excludes deleted organizations. Server-side search over name / name_ar / name_en, AND-combined filters (status tab, org_type), sort registered asc|desc with organizations.id as the tie-break, pagination over the full matching set. Returns {rows,total,page,page_size,sort,counts}. Contact, city and completion are not returned: organizations have no authoritative source for them.';
revoke execute on function public.admin_organizations_list(text, text, public.organization_type, text, int, int) from public, anon;
grant execute on function public.admin_organizations_list(text, text, public.organization_type, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Organization details
-- ---------------------------------------------------------------------------
create or replace function public.admin_organization_detail(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    'is_verified', o.is_verified,
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
$$;
comment on function public.admin_organization_detail(uuid) is
  'Admin Organization Details read model (Phase 1B-A). Platform-scoped organizations.read; NULL when the organization does not exist or is deleted. Ownership = active members holding org.manage (no separate ownership record exists). Audit (audit.read) is not included; it reads through its own RLS-guarded path.';
revoke execute on function public.admin_organization_detail(uuid) from public, anon;
grant execute on function public.admin_organization_detail(uuid) to authenticated;

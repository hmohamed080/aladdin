-- ===========================================================================
-- P1 / M3a - stop reading the application username (DATABASE EXPAND STEP, function-only).
-- Plan: docs/operations/account-identity/P1-CLEANUP-READINESS-20261112.md section 5.1 (revision 2). Forward-only.
--
-- GOAL. After this migration no function that the NEW app calls reads or returns profiles.username,
-- app.pending_registrations.username / username_reserved_at, so M3b can drop those columns later. Nothing is dropped
-- here, no table or column changes, no data changes, and the OLD generation of callers keeps working.
--
--   1. public.pending_registration_consume() - SAME signature, SAME RETURNS TABLE(username, audience_kind,
--      audience_value). PostgreSQL cannot overload a zero-argument function and CREATE OR REPLACE cannot change a result
--      table (42P13 / 42723), so the shape is kept and `username` is now always NULL: the body no longer reads
--      username or username_reserved_at. The only caller already ignores that field. M3b drops and recreates this
--      function with the two-column result in the same transaction as the column drops.
--   2. public.pending_registration_save(uuid, activity_audience_kind, text, integer) - NEW username-less OVERLOAD. The
--      old five-argument function is not touched (it still takes the lease and reads profiles/reserved_usernames), so
--      a caller that sends p_username keeps its behaviour until M3b drops it. Callers MUST use named arguments
--      (supabase-js rpc() does): an untyped positional call is ambiguous between the two overloads (42725). The new
--      overload has no p_username, so a named call that includes p_username can only resolve to the old function and a
--      named call that omits it can only resolve to the new one.
--      Grants are those of the old function: service_role only, SECURITY DEFINER, search_path = ''.
--   3. public.admin_users_directory - re-created WITHOUT the rows[].username key (M1 already removed the search term).
--      Signature, return shape otherwise, permission check (users.read), SECURITY DEFINER and grants are unchanged.
--      The Admin mapper ignores the key (directory-mappers.ts), so the old and the new Admin UI both work.
--   4. public.admin_user_detail - re-created WITHOUT the 'username' key, otherwise unchanged.
--
-- NOT HERE (later PRs, each behind its own approval): the restore-tested backup, the Auth metadata scrub, M2 (drops
-- username_available / profile_set_username), the audit redaction and M3b (drops the old save, recreates consume with two
-- columns, drops the lease helpers, the index, the check constraint and the columns).
--
-- app.profile_completion and my_registration_state were already freed from username by M1.
--
-- ROLLBACK (forward-fix, never a down migration): scripts/hosted-db/forward-fix/m3a-restore-previous.sql re-creates the
-- previous consume(), admin_users_directory and admin_user_detail and drops the new overload. The previous definitions are
-- strictly more capable (they read the columns that still exist), so reverting is always possible until M3b.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. pending_registration_consume: same shape, username always NULL, no column read.
-- ---------------------------------------------------------------------------
create or replace function public.pending_registration_consume()
returns table(username text, audience_kind public.activity_audience_kind, audience_value text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row app.pending_registrations;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_row from app.pending_registrations where user_id = v_uid and expires_at > now();
  if not found then
    delete from app.pending_registrations where user_id = v_uid;  -- sweep an expired row
    return;
  end if;

  delete from app.pending_registrations where user_id = v_uid;    -- single use
  username := null;  -- P1 M3a: kept only so the result shape does not change; the column is no longer read
  audience_kind := v_row.audience_kind;
  audience_value := v_row.audience_value;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. pending_registration_save: username-less overload (the five-argument function stays as it is).
-- ---------------------------------------------------------------------------
create or replace function public.pending_registration_save(
  p_user_id        uuid,
  p_audience_kind  public.activity_audience_kind,
  p_audience_value text,
  p_ttl_minutes    integer default 30
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  -- Opportunistic cleanup of long-expired rows (same horizon as the older overload).
  delete from app.pending_registrations where expires_at < now() - interval '1 day';

  -- Only a just-created, still-unconfirmed registrant may stage anything (same guard as the older overload).
  if not exists (
    select 1 from auth.users u
    where u.id = p_user_id and u.email_confirmed_at is null and u.created_at > now() - interval '10 minutes'
  ) then
    return false;
  end if;

  -- First write wins; a repeat call never overwrites the staged audience.
  insert into app.pending_registrations (user_id, audience_kind, audience_value, expires_at)
  values (p_user_id, p_audience_kind, p_audience_value, now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 30), 1)))
  on conflict (user_id) do nothing;
  get diagnostics v_rows = row_count;

  return v_rows = 1;  -- true only when this call staged the row
end;
$$;

revoke all on function public.pending_registration_save(uuid, public.activity_audience_kind, text, integer) from public, anon, authenticated;
grant execute on function public.pending_registration_save(uuid, public.activity_audience_kind, text, integer) to service_role;

comment on function public.pending_registration_save(uuid, public.activity_audience_kind, text, integer) is
  'Stage the registrant''s chosen audience server-side (service_role only). Username-less successor of the five-argument overload (P1 M3a): takes no lease and reads no profile data. Callers must use named arguments. Returns true only when this call staged the row.';

-- ---------------------------------------------------------------------------
-- 3. public.admin_users_directory: rows[] no longer carries the username key.
--    Copied from the M1 definition (20261110090002) with ONLY the 'username' key line removed.
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

-- ---------------------------------------------------------------------------
-- 4. public.admin_user_detail: no 'username' key.
--    Copied from its latest definition (20261021090003) with ONLY the 'username' key line removed.
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
$$;

revoke execute on function public.admin_user_detail(uuid) from public, anon, service_role;
grant execute on function public.admin_user_detail(uuid) to authenticated;

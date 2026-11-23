-- Corrective, forward-only: admin_users_directory (20261115090002) evaluated the derived 'attention' flag
-- (app.profile_completion per VERIFIED account) on EVERY call, which made the Admin Users directory ~10x slower at scale
-- (5,000 users / 2,000 verified: 35-95 ms before, 460-520 ms after, local benchmark). The flag is now evaluated ONLY for the
-- 'attention' filter, and the always-on counts.attention is dropped (the tab shows the filtered total when selected).
-- Signature, owner, search_path, grants and every other behaviour are unchanged.

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
  if p_status is not null and p_status not in ('pending', 'verified', 'suspended', 'rejected', 'attention') then
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
           app.admin_user_status_tab(u.status, lv.status) as tab,
           -- DERIVED, never stored: a verified account whose AUTHORITATIVE profile completion is below 100.
           -- It costs one app.profile_completion() per verified account, so it is evaluated ONLY when the 'attention'
           -- filter is asked for (CASE is lazy); every other request pays nothing for it.
           case when p_status = 'attention'
                 and app.admin_user_verification_state(u.is_verified, lv.status) = 'verified'
                then coalesce((app.profile_completion(u.id) ->> 'percent')::int, 100) < 100
                else false end as attention
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
    select * from scoped
     where p_status is null
        or (p_status = 'attention' and attention)
        or (p_status <> 'attention' and tab = p_status)
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

-- ===========================================================================
-- Admin Users directory: the real account type, and filters that find it
--
-- THE BUG. `admin_users_list` filtered and labelled by users.primary_account_type alone. That column is
-- only written when a personal account is activated, so on the live data 591 of 608 users have it NULL:
-- every Craftsman still awaiting review (502 of them), every business owner (whose account is their
-- organization's type) and everyone mid-onboarding. Filtering by Craftsman returned the 6 activated
-- ones, and a business filter (Showroom, Supplier, ...) was not accepted at all, so the page silently
-- showed everyone.
--
-- THE FIX (read-only functions; no table, data, grant or policy changes):
--   1. app.user_account_type(user) derives the one account a person registered as, from what the
--      database already holds, in this order:
--        a. the established personal persona (app.effective_persona: the declared persona, else the
--           activated primary_account_type);
--        b. else the type of the earliest organization they own (active membership holding org.manage),
--           with the internal contractor_company / design_office mapped to Contractor / Engineer;
--        c. else the account chosen during onboarding (professional persona, consumer, business type);
--        d. else NULL ("not selected").
--      The value is one of the nine public account keys the app already uses
--      (frontend/src/lib/taxonomy/accounts.ts choiceKey).
--   2. admin_users_directory (new; same arguments and output as admin_users_list) takes p_account_type
--      as one of those nine keys or 'none', filters on the derived type over the full table, and returns
--      it as account_type. admin_users_list keeps its persona_type signature for the app version that is
--      live while this migration lands (expand, then contract) and now answers through the same
--      function, so it is fixed too. Drop admin_users_list once no deployed app calls it.
--   3. Phone search also matches a partial local number typed with its trunk 0 (0101... -> +20101...).
--   4. admin_user_detail returns the same derived account_type.
-- users.read stays the only gate; nothing here grants or changes access.
-- ===========================================================================

create or replace function app.account_code_for_org_type(p_org_type public.organization_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_org_type
    when 'contractor_company' then 'contractor'
    when 'design_office' then 'engineer'
    else p_org_type::text
  end;
$$;
revoke execute on function app.account_code_for_org_type(public.organization_type) from public, anon, authenticated;

create or replace function app.user_account_type(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.effective_persona(p_user_id)::text,
    (select app.account_code_for_org_type(o.org_type)
       from public.memberships m
       join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = p_user_id
        and m.status = 'active'
        and exists (select 1 from public.membership_capabilities c
                     where c.membership_id = m.id and c.capability_key = 'org.manage')
      order by m.created_at, m.id
      limit 1),
    (select case op.selected_track
              when 'professional' then op.selected_persona::text
              when 'consumer' then 'end_consumer'
              when 'business' then app.account_code_for_org_type(op.selected_org_type)
            end
       from public.onboarding_progress op
      where op.user_id = p_user_id)
  );
$$;
comment on function app.user_account_type(uuid) is
  'The one public account a person registered as (one of the nine choiceKeys), derived: established personal persona, else the earliest owned organization''s type (contractor_company -> contractor, design_office -> engineer), else the onboarding choice; NULL when none was made. Display and Admin filtering only, never an authorization input.';
revoke execute on function app.user_account_type(uuid) from public, anon, authenticated;

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
        or p.username ilike v_like escape '\'
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
      'account_type', app.user_account_type(u.id),
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
  'Admin Users directory. Platform-scoped users.read. Server-side search (display names, username, account email, canonical phone incl. a local number with its trunk 0), AND-combined filters (status tab, derived account type = one of the nine public account keys or none, verification state, governorate), sort registered|completeness asc|desc with users.id as the deterministic tie-break, and pagination over the FULL matching set. Returns {rows,total,page,page_size,sort,counts}; page is clamped to the last page. counts are the status-tab totals under every filter except the status tab itself. rows[].account_type is app.user_account_type.';
revoke execute on function public.admin_users_directory(text, text, text, text, text, text, int, int) from public, anon;
grant execute on function public.admin_users_directory(text, text, text, text, text, text, int, int) to authenticated;

-- The live app's signature, unchanged, answering through the fixed directory.
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
language sql
stable
security definer
set search_path = ''
as $$
  select public.admin_users_directory(p_search, p_status, p_account_type::text, p_verification, p_governorate,
                                      p_sort, p_page, p_page_size);
$$;
comment on function public.admin_users_list(text, text, public.persona_type, text, text, text, int, int) is
  'Deprecated: the previous app''s Users directory signature (persona filter only). Delegates to admin_users_directory; drop once no deployed app calls it.';

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
    'account_type', app.user_account_type(u.id),
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


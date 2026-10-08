-- ===========================================================================
-- Installer My Work — REAL pagination, in the database
--
-- My Work used to read the newest 100 assignments and filter, count and "reveal"
-- them in application code, so an installer with more than 100 assignments could
-- neither see the rest nor trust a count.
--
-- This migration moves it into SQL, with exact totals, deterministic ordering and
-- KEYSET (cursor) paging, and adds NO new authority. Pages continue AFTER a row's
-- sort keys, never at a row COUNT, so a row inserted or re-ranked while a user
-- pages can neither repeat nor swallow a neighbour:
--
--   public.my_work_page / my_work_counts / my_work_companies — SECURITY DEFINER
--   over the caller's own assignments (app._my_job_assignments(), scoped to
--   auth.uid()), with the work contact released under exactly the rule
--   my_assignment_contacts applies (assigned installer, in_progress or completed
--   only).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- MY WORK: one page of the caller's assignments
-- ---------------------------------------------------------------------------
create function public.my_work_page(
  p_states  text[]  default null,
  p_search  text    default null,
  p_company text    default null,
  p_from    date    default null,
  p_to      date    default null,
  p_contact text    default 'all',
  p_sort    text    default 'default',
  p_limit   integer default 6,
  -- KEYSET CURSOR: the sort keys and id of the last row already shown. All three are null
  -- for the first page; p_after_id is the presence flag (an id is never null), so
  -- p_after_key / p_after_key2 may themselves be null (the NULLS LAST region).
  --   default, recent-added, last-added, oldest-first : p_after_key = created_at
  --   last-action                                      : p_after_key = last_progress_at,
  --                                                      p_after_key2 = created_at
  p_after_key  timestamptz default null,
  p_after_key2 timestamptz default null,
  p_after_id   uuid        default null
)
returns table (
  id                      uuid,
  job_id                  uuid,
  application_id          uuid,
  status                  public.job_assignment_status,
  agreed_amount           numeric(12,2),
  agreed_currency         text,
  latest_progress_percent smallint,
  last_progress_at        timestamptz,
  version                 integer,
  started_at              timestamptz,
  completed_at            timestamptz,
  cancelled_at            timestamptz,
  cancellation_reason     text,
  created_at              timestamptz,
  job_title               text,
  job_description         text,
  job_status              public.job_status,
  trade_key               text,
  trade_is_active         boolean,
  governorate             text,
  city                    text,
  site_address            text,
  expected_duration_days  smallint,
  starts_on               date,
  ends_by                 date,
  published_at            timestamptz,
  poster_org_name         text,
  contact_name            text,
  contact_phone           text,
  contact_email           text,
  total_count             bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_states text[];
  v_term   text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_co     text := nullif(btrim(coalesce(p_company, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  -- "All your work" is the work being DONE or already DONE; scheduled and
  -- cancelled work is reachable only by asking for those states explicitly.
  v_states := case when p_states is null or cardinality(p_states) = 0
                   then array['in_progress', 'completed']
                   else p_states end;
  if exists (
    select 1 from unnest(v_states) s
    where s not in (select e.enumlabel::text from pg_enum e where e.enumtypid = 'public.job_assignment_status'::regtype)
  ) then
    raise exception 'unknown assignment status' using errcode = '22023';
  end if;

  if p_contact is null or p_contact not in ('all', 'available', 'none') then
    raise exception 'unknown contact filter' using errcode = '22023';
  end if;
  if p_sort is null or p_sort not in ('default', 'recent-added', 'last-added', 'oldest-first', 'last-action') then
    raise exception 'unknown sort' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 301 then
    raise exception 'invalid page size' using errcode = '22023';
  end if;
  if p_after_id is null and (p_after_key is not null or p_after_key2 is not null) then
    raise exception 'invalid cursor' using errcode = '22023';
  end if;

  return query
  with filtered as (
    select a.id, a.job_id, a.application_id, a.status, a.agreed_amount, a.agreed_currency,
           a.latest_progress_percent, a.last_progress_at, a.version, a.started_at, a.completed_at,
           a.cancelled_at, a.cancellation_reason, a.created_at, a.job_title, a.job_description,
           a.job_status, a.trade_key, a.trade_is_active, a.governorate, a.city, a.site_address,
           a.expected_duration_days, a.starts_on, a.ends_by, a.published_at, a.poster_org_name,
           c.contact_name as contact_name, c.phone_e164 as contact_phone, c.email as contact_email
    from app._my_job_assignments() a
    -- The contact is released only while the work is under way or done — the same
    -- rule as my_assignment_contacts, and the same snapshot rows.
    left join public.assignment_contacts c
           on c.assignment_id = a.id
          and a.status in ('in_progress'::public.job_assignment_status, 'completed'::public.job_assignment_status)
    where a.status::text = any (v_states)
      and (v_co is null or a.poster_org_name = v_co)
      and (v_term is null or strpos(lower(concat_ws(' ', a.job_title, a.city, a.governorate, a.poster_org_name, c.phone_e164, c.email)), v_term) > 0)
      and (p_contact = 'all'
           or (p_contact = 'available' and c.assignment_id is not null)
           or (p_contact = 'none' and c.assignment_id is null))
      -- The PLANNED WORK WINDOW (starts_on -> ends_by) overlaps the range; both bounds optional.
      -- Mirrors frontend/src/lib/work/planned-window.ts exactly.
      and (
        (p_from is null and p_to is null)
        or (
          (a.starts_on is not null or a.ends_by is not null)
          and (p_to   is null or least(coalesce(a.starts_on, a.ends_by), coalesce(a.ends_by, a.starts_on)) <= p_to)
          and (p_from is null or greatest(coalesce(a.starts_on, a.ends_by), coalesce(a.ends_by, a.starts_on)) >= p_from)
        )
      )
  ), numbered as (
    -- The total is counted over the WHOLE filtered set, before the cursor narrows it.
    select f.*, count(*) over () as total_count,
           case when p_sort = 'last-action' then f.last_progress_at else f.created_at end as k1,
           case when p_sort = 'last-action' then f.created_at end as k2
    from filtered f
  )
  select n.id, n.job_id, n.application_id, n.status, n.agreed_amount, n.agreed_currency,
         n.latest_progress_percent, n.last_progress_at, n.version, n.started_at, n.completed_at,
         n.cancelled_at, n.cancellation_reason, n.created_at, n.job_title, n.job_description,
         n.job_status, n.trade_key, n.trade_is_active, n.governorate, n.city, n.site_address,
         n.expected_duration_days, n.starts_on, n.ends_by, n.published_at, n.poster_org_name,
         n.contact_name, n.contact_phone, n.contact_email, n.total_count
  from numbered n
  where p_after_id is null
     or case
          -- created_at ASC NULLS LAST, id ASC
          when p_sort in ('last-added', 'oldest-first') then
            case when p_after_key is null then n.k1 is null and n.id > p_after_id
                 else n.k1 is null or n.k1 > p_after_key or (n.k1 = p_after_key and n.id > p_after_id) end
          -- last_progress_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
          when p_sort = 'last-action' then
            case when p_after_key is null
                 then n.k1 is null and
                      case when p_after_key2 is null then n.k2 is null and n.id < p_after_id
                           else n.k2 is null or n.k2 < p_after_key2 or (n.k2 = p_after_key2 and n.id < p_after_id) end
                 else n.k1 is null or n.k1 < p_after_key or (n.k1 = p_after_key and
                      case when p_after_key2 is null then n.k2 is null and n.id < p_after_id
                           else n.k2 is null or n.k2 < p_after_key2 or (n.k2 = p_after_key2 and n.id < p_after_id) end)
            end
          -- created_at DESC NULLS LAST, id DESC (default, recent-added)
          else
            case when p_after_key is null then n.k1 is null and n.id < p_after_id
                 else n.k1 is null or n.k1 < p_after_key or (n.k1 = p_after_key and n.id < p_after_id) end
        end
  order by
    case when p_sort in ('default', 'recent-added', 'last-action') then n.k1 end desc nulls last,
    case when p_sort in ('last-added', 'oldest-first') then n.k1 end asc nulls last,
    case when p_sort = 'last-action' then n.k2 end desc nulls last,
    -- id is the final tie-breaker and runs in the sort's own direction, so the order is TOTAL.
    case when p_sort in ('default', 'recent-added', 'last-action') then n.id end desc,
    case when p_sort in ('last-added', 'oldest-first') then n.id end asc
  limit p_limit;
end;
$$;

comment on function public.my_work_page(text[], text, text, date, date, text, text, integer, timestamptz, timestamptz, uuid) is
  'One page of the CALLER''s own assignments with every filter applied in SQL and the EXACT filtered total on each row (total_count). States default to in_progress + completed ("All your work"). Search is a case-insensitive substring over title, city, governorate, organization, contact phone and e-mail. Company is an exact organization name. The date range overlaps the planned window (starts_on -> ends_by). Contact: all / available / none. Sort: default, recent-added, last-added, oldest-first, last-action. Page size 1..301 (a page of up to 300 rows plus the one extra row a caller reads to learn whether another page exists). KEYSET paging: pass the sort keys and id of the last row shown (p_after_key / p_after_key2 / p_after_id) to get the rows AFTER it — there is no offset, so a row inserted or re-ranked between requests can never repeat or swallow a neighbour; the order is total (ends on the id) and NULLS LAST for the nullable keys. total_count is the filtered total, independent of the cursor, and appears on every returned row. The work contact is released only for in_progress / completed (the my_assignment_contacts rule). No user parameter: scoped to auth.uid().';

revoke execute on function public.my_work_page(text[], text, text, date, date, text, text, integer, timestamptz, timestamptz, uuid) from public, anon;
grant  execute on function public.my_work_page(text[], text, text, date, date, text, text, integer, timestamptz, timestamptz, uuid) to authenticated;

-- How many of the caller's assignments sit in each state (tabs and the summary rail).
create function public.my_work_counts()
returns table (status public.job_assignment_status, assignment_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select a.status, count(*)::bigint
  from app._my_job_assignments() a
  where (select auth.uid()) is not null
  group by a.status;
$$;

comment on function public.my_work_counts() is
  'Exact count of the CALLER''s assignments per status — a COUNT in the database, never derived from a fetched page. No parameter.';

revoke execute on function public.my_work_counts() from public, anon;
grant  execute on function public.my_work_counts() to authenticated;

-- The organizations the caller has work with (the Company filter's options).
create function public.my_work_companies()
returns table (company text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.poster_org_name
  from app._my_job_assignments() a
  where (select auth.uid()) is not null
    and a.poster_org_name is not null
  order by a.poster_org_name
  limit 200;
$$;

comment on function public.my_work_companies() is
  'Distinct organization names across the CALLER''s own assignments (at most 200), for the Company filter. No parameter.';

revoke execute on function public.my_work_companies() from public, anon;
grant  execute on function public.my_work_companies() to authenticated;

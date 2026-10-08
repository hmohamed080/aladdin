-- ===========================================================================
-- Installer Jobs — the SCALABLE board: public.job_opportunities_page
--
-- WHY THIS EXISTS. The board used to read `open_job_opportunities`, a view over a
-- SECURITY DEFINER set-returning function. Postgres cannot inline such a function, so
-- every request first built the WHOLE discoverable set (jobs ⨝ trades ⨝ verified orgs,
-- plus a per-row EXISTS) and only then applied the filter, the sort and the LIMIT. At
-- 50 000 open jobs that is ~215 ms for "Newest" and ~3.3 s for "Nearest", and page 20
-- costs exactly what page 1 does — keyset gave stable results, not a cheaper read.
--
-- THE SHAPE HERE. ONE function whose body is the query. The discoverability rule, every
-- filter, the keyset predicate, the ordering and the LIMIT are all in the statement the
-- planner sees, against the real `jobs` table, so it walks a PARTIAL INDEX in sort order
-- and stops after a page. Nothing materialises the discoverable set.
--
--   discoverable   j.status = 'open' AND the poster org is verified, active, not deleted
--                  AND the caller is authenticated  (the exact rule of _open_job_opportunities;
--                  pgTAP asserts the two return the same ids)
--   caller         auth.uid() ONLY. No user parameter exists. A cursor is a CONTINUATION HINT:
--                  it narrows the sort position and can never widen what is discoverable,
--                  because discoverability is a separate, always-applied predicate.
--
-- SORTS (all keyset, id last, so every order is TOTAL):
--   newest    published_at DESC, id DESC
--   oldest    published_at ASC,  id ASC
--   highest   offered_amount DESC (NOT NULL column, so "NULLS LAST" is vacuous), published_at DESC, id DESC
--   nearest   tier ASC, published_at DESC, id DESC      tier = LOCATION ONLY, from canonical keys:
--                0 same city · 1 same primary governorate · 2 another declared service area · 3 the rest
--   best      skill rank ASC, published_at DESC, id DESC  rank = TRADE + SPECIALTY ONLY:
--                0 trade + specialty (70) · 1 trade only (50) · 2 neither (0)
--   Nearest and best are SEGMENTED BY TIER: each tier is its own index-ordered scan with its own
--   LIMIT, and a later tier is only touched if the earlier ones did not fill the page.
--
-- DYNAMIC SQL, AND WHY IT IS SAFE. The statement is assembled with EXECUTE because optional predicates written as
-- `($3 is null or j.x = $3)` defeat the partial indexes. The contract that keeps it injection-proof:
--   * EVERY caller-supplied VALUE reaches the statement as a bind parameter ($1..$21 via USING) — search text,
--     trade keys, governorate / city keys, amounts, durations, the cursor, the limit. None is ever concatenated.
--   * The only text concatenated into the statement is chosen by this function from FIXED LITERALS: the filter
--     fragments (app._job_opportunity_filter, selected by booleans), the tier segment (by the allow-listed sort and an
--     integer loop variable), the cursor predicate (by the allow-listed sort) and the ORDER BY (by the allow-listed
--     sort). The sort is validated against a fixed list before any of it runs; an unknown sort raises 22023.
--   * No identifier, direction or column name is ever derived from input, and nothing is passed through
--     format() / quote_*() — there is nothing to quote because there is nothing interpolated.
-- pgTAP 77 proves it two ways: a structural guard (no input parameter may appear inside a `||` concatenation) and
-- hostile-value tests (quotes, comment markers, semicolons, oversized text, malformed cursors).
--
-- COUNT. `job_opportunities_total` is a separate function so the board can ask for the exact
-- filtered total ONCE per question (first page / filter / sort / saved-switch) and not on every
-- appended page.
--
-- MATCH is NOT used to filter or order here (except the separate Best Match skill rank above, which
-- is trade + specialty only). Each returned row carries the canonical Overall Match breakdown from
-- app.job_match_rows, evaluated for the page's rows only.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- FREE-TEXT SEARCH IS INDEXED (pg_trgm).
--
-- The search is `title ILIKE '%term%' OR description ILIKE '%term%' OR <poster organization name> ILIKE '%term%'`.
-- A leading-wildcard ILIKE cannot use a btree, so every rare or no-result search (and every exact total) read the
-- whole open set: ~415 ms at 50 000 jobs, linear in the board. pg_trgm (already enabled in `extensions`, with a
-- trigram index on organizations.name since the organizations migration) answers it from a GIN index.
--
-- TWO PARTIAL INDEXES on open jobs (the only jobs the board ever searches; the predicate matches the query's
-- `status = 'open'`, so they stay small and never carry drafts or closed jobs):
-- ---------------------------------------------------------------------------
create index ix_jobs_open_title_trgm on public.jobs using gin (title extensions.gin_trgm_ops) where status = 'open';
create index ix_jobs_open_description_trgm on public.jobs using gin (description extensions.gin_trgm_ops) where status = 'open';

-- The organization-name branch used to read `o.name` from the JOINED table, which a BitmapOr over `jobs` cannot
-- combine with the two job-column branches. It is the same predicate written as the set of matching organization ids
-- (evaluated ONCE, through organizations' own trigram index), compared with the job's poster. Identical rows: `o` was
-- always the job's own poster (`o.id = j.poster_org_id`), and the verified / active / not-deleted rule is still the
-- join. Search SEMANTICS are unchanged: same three columns, same case-insensitive substring, same escaping.

-- The filter fragment, shared by the page and the total so they can never disagree. Positional
-- parameters of the dynamic statements that use it:
--   $1 search pattern  $2 trade ids  $3 governorate key  $4 city key  $5 min amount  $6 max amount
--   $7 min duration  $8 max duration  $9 caller uid  $10 ids of organizations whose name matches the search
create function app._job_opportunity_filter(
  p_has_search boolean, p_has_trades boolean, p_has_gov boolean, p_has_city boolean,
  p_has_min boolean, p_has_max boolean, p_has_dmin boolean, p_has_dmax boolean,
  p_applied boolean, p_saved boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select
    case when p_has_search then ' and (j.title ilike $1 or j.description ilike $1 or j.poster_org_id = any ($10))' else '' end
 || case when p_has_trades then ' and j.trade_id = any ($2)' else '' end
 || case when p_has_gov    then ' and j.governorate_key = $3' else '' end
 || case when p_has_city   then ' and j.city_key = $4' else '' end
 || case when p_has_min    then ' and j.offered_amount >= $5' else '' end
 || case when p_has_max    then ' and j.offered_amount <= $6' else '' end
 || case when p_has_dmin   then ' and j.expected_duration_days >= $7' else '' end
 || case when p_has_dmax   then ' and j.expected_duration_days <= $8' else '' end
 || case when p_applied is true  then ' and exists (select 1 from public.job_applications ap where ap.job_id = j.id and ap.applicant_user_id = $9)'
         when p_applied is false then ' and not exists (select 1 from public.job_applications ap where ap.job_id = j.id and ap.applicant_user_id = $9)'
         else '' end
 -- SAVED drives from the caller's OWN saved set (one array, evaluated once), so the cost follows the size of
 -- that set and not the size of the board: a person with five saved jobs never walks fifty thousand.
 || case when p_saved is true then ' and j.id = any (array(select sj.job_id from public.saved_jobs sj where sj.user_id = $9))' else '' end;
$$;

revoke execute on function app._job_opportunity_filter(boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;

-- LIKE-pattern for a free-text search: wildcards typed by the caller are inert.
create function app._job_search_pattern(p_search text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(btrim(coalesce(p_search, '')), '') is null then null
              else '%' || regexp_replace(btrim(p_search), '([\\%_])', '\\\1', 'g') || '%' end;
$$;

revoke execute on function app._job_search_pattern(text) from public, anon, authenticated;

create function public.job_opportunities_page(
  p_sort                text     default 'newest',
  p_search              text     default null,
  p_trade_keys          text[]   default null,
  p_governorate_key     text     default null,
  p_city_key            text     default null,
  p_min_amount          numeric  default null,
  p_max_amount          numeric  default null,
  p_min_duration        smallint default null,
  p_max_duration        smallint default null,
  p_applied             boolean  default null,
  p_saved               boolean  default false,
  p_limit               integer  default 25,
  -- KEYSET CURSOR (continuation state only). The id is the presence flag; the other keys depend on the sort.
  p_after_id            uuid        default null,
  p_after_published_at  timestamptz default null,
  p_after_amount        numeric     default null,
  p_after_tier          smallint    default null
)
returns table (
  id                     uuid,
  title                  text,
  description            text,
  trade_key              text,
  offered_amount         numeric,
  offered_currency       text,
  governorate            text,
  city                   text,
  expected_duration_days smallint,
  starts_on              date,
  ends_by                date,
  published_at           timestamptz,
  poster_org_id          uuid,
  poster_org_name        text,
  has_applied            boolean,
  is_saved               boolean,
  governorate_key        text,
  city_key               text,
  required_specialty_key text,
  proximity_tier         smallint,
  skill_rank             smallint,
  overall_percent        smallint,
  trade_points           smallint,
  specialty_points       smallint,
  location_points        smallint,
  availability_points    smallint,
  trade_reason           text,
  specialty_reason       text,
  location_reason        text,
  availability_reason    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_trade_ids  uuid[];
  v_org_ids    uuid[];
  v_my_trades  uuid[];
  v_specs      uuid[];
  v_pgov       text;
  v_pcities    text[];
  v_other_govs text[];
  v_pair_g     text[];
  v_pair_c     text[];
  v_filter     text;
  v_order      text;
  v_cursor     text;
  v_seg        text;
  v_first      int;
  v_last       int;
  v_remaining  int := p_limit;
  v_n          int;
  v_sql        text;
  v_inner      text;
  c_select constant text :=
    'select j.id, j.title, j.description, t.key, j.offered_amount, j.offered_currency, j.governorate, j.city,'
    || ' j.expected_duration_days, j.starts_on, j.ends_by, j.published_at, j.poster_org_id, o.name,'
    || ' exists (select 1 from public.job_applications ap where ap.job_id = j.id and ap.applicant_user_id = $9),'
    || ' exists (select 1 from public.saved_jobs sj where sj.job_id = j.id and sj.user_id = $9),'
    || ' j.governorate_key, j.city_key, sp.key,'
    || ' (case m.location_reason when ''same_city'' then 0 when ''primary_governorate'' then 1 when ''other_service_area'' then 2 else 3 end)::smallint,'
    || ' (case m.trade_points + m.specialty_points when 70 then 0 when 50 then 1 else 2 end)::smallint,'
    || ' m.overall_percent, m.trade_points, m.specialty_points, m.location_points, m.availability_points,'
    || ' m.trade_reason, m.specialty_reason, m.location_reason, m.availability_reason';
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_sort is null or p_sort not in ('newest', 'oldest', 'highest', 'nearest', 'best') then
    raise exception 'unknown sort' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'invalid page size' using errcode = '22023';
  end if;
  -- Every free-text / list input is BOUNDED before it is used, so a hostile caller cannot make the server do
  -- unbounded work (a megabyte ILIKE pattern, a million trade keys). Values are still only ever bind parameters.
  if length(coalesce(p_search, '')) > 200
     or length(coalesce(p_governorate_key, '')) > 64 or length(coalesce(p_city_key, '')) > 64
     or cardinality(p_trade_keys) > 50 then
    raise exception 'invalid filter' using errcode = '22023';
  end if;
  -- A cursor is all-or-nothing and must carry the keys its sort needs.
  if p_after_id is null then
    if p_after_published_at is not null or p_after_amount is not null or p_after_tier is not null then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
  else
    if p_after_published_at is null
       or (p_sort = 'highest' and p_after_amount is null)
       or (p_sort = 'nearest' and (p_after_tier is null or p_after_tier not between 0 and 3))
       or (p_sort = 'best'    and (p_after_tier is null or p_after_tier not between 0 and 2)) then
      raise exception 'invalid cursor' using errcode = '22023';
    end if;
  end if;

  if p_trade_keys is not null then
    select coalesce(array_agg(t.id), '{}'::uuid[]) into v_trade_ids from public.trades t where t.key = any (p_trade_keys);
  end if;

  -- Organizations whose NAME matches, resolved ONCE through organizations' own trigram index and bound as a typed array,
  -- so the planner knows the real size of the set (a subquery's size is a guess, and a wrong guess picks a scan).
  v_org_ids := case when nullif(btrim(coalesce(p_search, '')), '') is null then '{}'::uuid[]
                    else array(select og.id from public.organizations og where og.name ilike app._job_search_pattern(p_search)) end;
  v_filter := app._job_opportunity_filter(
    nullif(btrim(coalesce(p_search, '')), '') is not null,
    p_trade_keys is not null,
    nullif(btrim(coalesce(p_governorate_key, '')), '') is not null,
    nullif(btrim(coalesce(p_city_key, '')), '') is not null,
    p_min_amount is not null, p_max_amount is not null,
    p_min_duration is not null, p_max_duration is not null,
    p_applied, coalesce(p_saved, false));

  -- The caller's own facts, for the tier segments (the SAME inputs app.job_match_rows reads).
  v_my_trades := array(select ut.trade_id from public.user_trades ut where ut.user_id = v_uid);
  v_specs     := array(select us.specialty_id from public.user_trade_specialties us where us.user_id = v_uid);
  select a.governorate_key into v_pgov from public.user_service_areas a where a.user_id = v_uid and a.is_primary;
  v_pcities := array(select a.city_key from public.user_service_areas a
                      where a.user_id = v_uid and a.governorate_key = v_pgov and a.city_key is not null and a.city_key <> 'other');
  v_other_govs := array(select a.governorate_key from public.user_service_areas a
                         where a.user_id = v_uid and a.governorate_key is distinct from v_pgov and a.city_key is null);
  v_pair_g := array(select a.governorate_key from public.user_service_areas a
                     where a.user_id = v_uid and a.governorate_key is distinct from v_pgov and a.city_key is not null and a.city_key <> 'other' order by a.id);
  v_pair_c := array(select a.city_key from public.user_service_areas a
                     where a.user_id = v_uid and a.governorate_key is distinct from v_pgov and a.city_key is not null and a.city_key <> 'other' order by a.id);

  -- ORDER BY, and the keyset continuation for the segment that holds the cursor.
  v_order := case p_sort
    when 'oldest'  then 'j.published_at asc, j.id asc'
    when 'highest' then 'j.offered_amount desc, j.published_at desc, j.id desc'
    else                'j.published_at desc, j.id desc' end;

  v_cursor := case
    when p_after_id is null then ''
    -- ROW-VALUE comparisons, not the OR expansion: the planner can use a row comparison as an INDEX
    -- CONDITION (every key of each index below runs the same direction), so a deep page starts where the
    -- cursor is instead of reading and discarding everything before it.
    when p_sort = 'oldest'  then ' and (j.published_at, j.id) > ($18, $19)'
    when p_sort = 'highest' then ' and (j.offered_amount, j.published_at, j.id) < ($20, $18, $19)'
    else                         ' and (j.published_at, j.id) < ($18, $19)' end;

  if p_sort in ('newest', 'oldest', 'highest') then
    v_first := 0; v_last := 0;
  elsif p_sort = 'nearest' then
    v_first := coalesce(p_after_tier, 0); v_last := 3;
  else
    v_first := coalesce(p_after_tier, 0); v_last := 2;
  end if;

  for v_tier in v_first .. v_last loop
    exit when v_remaining <= 0;

    v_seg := case
      when p_sort = 'nearest' and v_tier = 0 then ' and j.governorate_key = $11 and j.city_key = any ($12)'
      when p_sort = 'nearest' and v_tier = 1 then ' and j.governorate_key = $11 and (j.city_key is null or j.city_key <> all ($12))'
      when p_sort = 'nearest' and v_tier = 2 then ' and j.governorate_key is distinct from $11 and (j.governorate_key = any ($13) or exists (select 1 from unnest($14, $15) oa(g, c) where oa.g = j.governorate_key and oa.c = j.city_key))'
      when p_sort = 'nearest' and v_tier = 3 then ' and (j.governorate_key is null or (j.governorate_key is distinct from $11 and not (j.governorate_key = any ($13) or exists (select 1 from unnest($14, $15) oa(g, c) where oa.g = j.governorate_key and oa.c = j.city_key))))'
      when p_sort = 'best' and v_tier = 0 then ' and j.trade_id = any ($16) and (j.required_specialty_id is null or j.required_specialty_id = any ($17))'
      when p_sort = 'best' and v_tier = 1 then ' and j.trade_id = any ($16) and j.required_specialty_id is not null and j.required_specialty_id <> all ($17)'
      when p_sort = 'best' and v_tier = 2 then ' and j.trade_id <> all ($16)'
      else '' end;

    -- Only the segment that HOLDS the cursor is narrowed by it; later tiers start from their top.
    v_inner :=
      'select j.* from public.jobs j'
      || ' join public.organizations o on o.id = j.poster_org_id and o.is_verified and o.deleted_at is null and o.status = ''active''::public.org_status'
      || ' where j.status = ''open''::public.job_status'
      || v_filter || v_seg
      || case when v_tier = v_first then v_cursor else '' end   -- v_cursor is '' when there is no cursor
      || ' order by ' || v_order || ' limit $21';

    -- The page's rows first (CTE), then the caller's match for exactly those ids — facts read once per page.
    v_sql := 'with p as materialized (' || v_inner || ') '
      || c_select
      || ' from p j'
      || ' join public.organizations o on o.id = j.poster_org_id'
      || ' join public.trades t on t.id = j.trade_id'
      || ' left join public.trade_specialties sp on sp.id = j.required_specialty_id'
      || ' join app.job_match_rows($9, (select array_agg(p.id) from p)) m on m.job_id = j.id'
      || ' order by ' || v_order;

    return query execute v_sql
      using app._job_search_pattern(p_search), v_trade_ids, nullif(btrim(coalesce(p_governorate_key, '')), ''),
            nullif(btrim(coalesce(p_city_key, '')), ''), p_min_amount, p_max_amount, p_min_duration, p_max_duration,
            v_uid, v_org_ids, v_pgov, v_pcities, v_other_govs, v_pair_g, v_pair_c, v_my_trades, v_specs,
            p_after_published_at, p_after_id, p_after_amount, v_remaining;
    get diagnostics v_n = row_count;
    v_remaining := v_remaining - v_n;
  end loop;
end;
$$;

comment on function public.job_opportunities_page(text, text, text[], text, text, numeric, numeric, smallint, smallint, boolean, boolean, integer, uuid, timestamptz, numeric, smallint) is
  'One keyset page of the caller''s discoverable open jobs, with the filter, the sort, the cursor and the LIMIT applied INSIDE the statement (partial indexes, no materialised set). Caller identity is auth.uid(). The cursor narrows the sort position only; discoverability is always applied. Each row carries the canonical Overall Match breakdown. Near me = location tier only; best = trade + specialty only; neither is the Overall Match.';

revoke execute on function public.job_opportunities_page(text, text, text[], text, text, numeric, numeric, smallint, smallint, boolean, boolean, integer, uuid, timestamptz, numeric, smallint) from public, anon;
grant  execute on function public.job_opportunities_page(text, text, text[], text, text, numeric, numeric, smallint, smallint, boolean, boolean, integer, uuid, timestamptz, numeric, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- The exact filtered total — asked ONCE per question, not once per appended page.
-- ---------------------------------------------------------------------------
create function public.job_opportunities_total(
  p_search          text     default null,
  p_trade_keys      text[]   default null,
  p_governorate_key text     default null,
  p_city_key        text     default null,
  p_min_amount      numeric  default null,
  p_max_amount      numeric  default null,
  p_min_duration    smallint default null,
  p_max_duration    smallint default null,
  p_applied         boolean  default null,
  p_saved           boolean  default false
)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_trade_ids uuid[];
  v_org_ids   uuid[];
  v_filter    text;
  v_sql       text;
  v_total     bigint;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if length(coalesce(p_search, '')) > 200
     or length(coalesce(p_governorate_key, '')) > 64 or length(coalesce(p_city_key, '')) > 64
     or cardinality(p_trade_keys) > 50 then
    raise exception 'invalid filter' using errcode = '22023';
  end if;
  if p_trade_keys is not null then
    select coalesce(array_agg(t.id), '{}'::uuid[]) into v_trade_ids from public.trades t where t.key = any (p_trade_keys);
  end if;
  -- Organizations whose NAME matches, resolved ONCE through organizations' own trigram index and bound as a typed array,
  -- so the planner knows the real size of the set (a subquery's size is a guess, and a wrong guess picks a scan).
  v_org_ids := case when nullif(btrim(coalesce(p_search, '')), '') is null then '{}'::uuid[]
                    else array(select og.id from public.organizations og where og.name ilike app._job_search_pattern(p_search)) end;
  v_filter := app._job_opportunity_filter(
    nullif(btrim(coalesce(p_search, '')), '') is not null,
    p_trade_keys is not null,
    nullif(btrim(coalesce(p_governorate_key, '')), '') is not null,
    nullif(btrim(coalesce(p_city_key, '')), '') is not null,
    p_min_amount is not null, p_max_amount is not null,
    p_min_duration is not null, p_max_duration is not null,
    p_applied, coalesce(p_saved, false));

  -- The statement is assembled from fixed literals ONLY (the same fragments as the page), then run with the
  -- caller's values as bind parameters. No input parameter appears on the concatenation side.
  v_sql := 'select count(*) from public.jobs j'
        || ' join public.organizations o on o.id = j.poster_org_id and o.is_verified and o.deleted_at is null and o.status = ''active''::public.org_status'
        || ' where j.status = ''open''::public.job_status' || v_filter;
  execute v_sql into v_total
    using app._job_search_pattern(p_search), v_trade_ids, nullif(btrim(coalesce(p_governorate_key, '')), ''),
          nullif(btrim(coalesce(p_city_key, '')), ''), p_min_amount, p_max_amount, p_min_duration, p_max_duration, v_uid, v_org_ids;
  return v_total;
end;
$$;

comment on function public.job_opportunities_total(text, text[], text, text, numeric, numeric, smallint, smallint, boolean, boolean) is
  'The exact count of the caller''s discoverable open jobs under the same filters as job_opportunities_page. Identity is auth.uid(). Asked once per question by the board, not per page.';

revoke execute on function public.job_opportunities_total(text, text[], text, text, numeric, numeric, smallint, smallint, boolean, boolean) from public, anon;
grant  execute on function public.job_opportunities_total(text, text[], text, text, numeric, numeric, smallint, smallint, boolean, boolean) to authenticated;

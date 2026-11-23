-- Admin Organizations: one authoritative ORGANIZATION APPROVAL state, shown identically in the directory and on the detail page.
--
-- Until now an organization whose application was REJECTED stayed in the Pending tab (organizations.status is still
-- 'pending_verification' until the owner abandons it), so the Organizations Pending count (5) disagreed with the open requests in
-- the Verifications queue (3). Organization LIFECYCLE status (organizations.status) and Organization APPROVAL (the decision on the
-- organization application) are different things; this adds the approval decision next to, never in place of, the lifecycle.
--
-- The latest application decision is the newest request with subject_type = 'organization' AND verification_type = 'organization'
-- (never business / identity / co-owner / branch requests), ordered submitted_at desc, created_at desc, id desc - the order
-- organization_application_submit / _abandon already use, plus an id tie-breaker so equal timestamps are deterministic.
--
-- approval_state (per organization; independent of lifecycle: suspending an approved organization does not un-approve it):
--   approved  - is_verified or status = 'active'
--   rejected  - not approved and the latest decision is 'rejected' (rejection is final; the owner abandons and applies anew)
--   pending   - not approved, not rejected, and either a request is open (submitted / under_review / needs_more_info) or the
--               lifecycle is 'pending_verification'
--   none      - everything else (draft, archived, an abandoned application whose latest decision is 'cancelled', ...)
-- Directory tab (lifecycle-aware, same inputs):
--   suspended -> Suspended; active -> Verified; pending_verification -> Rejected when the latest decision is rejected, else
--   Pending; draft / archived -> no tab (listed under All only).
--
-- Changes ONLY two existing read functions (CREATE OR REPLACE; signatures, owner, SECURITY DEFINER, search_path, authorization
-- checks and grants are unchanged; no table, policy, index, function or data change):
--   public.admin_organizations_list  - accepts the 'rejected' status filter, counts.rejected, per-row approval_state and
--                                      latest_verification_status; the latest decision is looked up ONCE per organization
--                                      (ix_verifications_org) and reused by the tab, the counts, the filter and the page rows.
--   public.admin_organization_detail - adds the same approval_state and latest_verification_status keys.
-- 'verification_state' keeps its previous meaning for existing callers.

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
  if p_status is not null and p_status not in ('pending', 'verified', 'suspended', 'rejected') then
    raise exception 'unsupported status filter' using errcode = '22023';
  end if;
  if v_q is not null then
    if char_length(v_q) > 100 then
      raise exception 'search term too long' using errcode = '22023';
    end if;
    v_like := app.admin_search_pattern(v_q);
  end if;

  with scoped as materialized (
    select o.id, o.created_at, lr.status::text as latest,
           case o.status
             when 'suspended' then 'suspended'
             when 'active' then 'verified'
             when 'pending_verification' then case when lr.status = 'rejected' then 'rejected' else 'pending' end
           end as tab,
           case when o.is_verified or o.status = 'active' then 'approved'
                when lr.status = 'rejected' then 'rejected'
                when lr.status in ('submitted', 'under_review', 'needs_more_info') or o.status = 'pending_verification' then 'pending'
                else 'none' end as approval
    from public.organizations o
    left join lateral (
      select v.status from public.verifications v
      where v.organization_id = o.id and v.subject_type = 'organization' and v.verification_type = 'organization'
      order by v.submitted_at desc, v.created_at desc, v.id desc
      limit 1
    ) lr on true
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
      'approval_state', f.approval,
      'latest_verification_status', f.latest,
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
    join filtered f on f.id = pi.id
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
        'suspended', count(*) filter (where tab = 'suspended'),
        'rejected', count(*) filter (where tab = 'rejected'))
      from scoped)
  ) into v_result;

  return v_result;
end;
$function$;

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
    -- the SAME approval decision the directory shows (see the header of this migration)
    'approval_state', case when o.is_verified or o.status = 'active' then 'approved'
                           when lr.status = 'rejected' then 'rejected'
                           when lr.status in ('submitted', 'under_review', 'needs_more_info') or o.status = 'pending_verification' then 'pending'
                           else 'none' end,
    'latest_verification_status', lr.status,
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
          'decided_at', v.decided_at,
          -- decision history for authorized Admins: who decided, and whether an Admin started it
          'reviewer_id', v.reviewer_id,
          'reviewer_name', rp.display_name,
          'initiated_by_admin', coalesce((v.metadata ->> 'initiated_by_admin')::boolean, false),
          -- the immutable Audit Log is the source of truth: who did what, and when (oldest first)
          'events', coalesce((
            select jsonb_agg(jsonb_build_object(
                'action', a.action,
                'actor_id', a.actor_user_id,
                'actor_name', ap.display_name,
                'at', a.created_at)
              -- ties inside one transaction fall back to the workflow order
              order by a.created_at,
                       case a.action when 'verification.admin_initiated' then 0 when 'verification.review_started' then 1
                                     when 'verification.changes_requested' then 2 else 3 end,
                       a.id)
            from public.audit_log a
            left join public.profiles ap on ap.user_id = a.actor_user_id
            where a.subject_type = 'verification' and a.subject_id = v.id
              and a.action in ('verification.admin_initiated', 'verification.review_started', 'verification.changes_requested',
                               'verification.approved', 'verification.rejected')), '[]'::jsonb))
        order by v.submitted_at desc, v.id desc)
      from public.verifications v
      left join public.profiles rp on rp.user_id = v.reviewer_id
      where v.organization_id = o.id and v.subject_type = 'organization'), '[]'::jsonb)
  )
  into v_result
  from public.organizations o
  left join lateral (
    select v.status from public.verifications v
    where v.organization_id = o.id and v.subject_type = 'organization' and v.verification_type = 'organization'
    order by v.submitted_at desc, v.created_at desc, v.id desc
    limit 1
  ) lr on true
  where o.id = p_organization_id and o.deleted_at is null;

  return v_result;  -- NULL: no such (non-deleted) organization
end;
$function$;

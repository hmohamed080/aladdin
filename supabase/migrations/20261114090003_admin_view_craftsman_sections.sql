-- Admin "View as account" — Stage 3: the six read-only Craftsman sections
-- (docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §6, pattern C).
--
-- Each function:
--   * is SECURITY DEFINER, STABLE (it cannot write), `set search_path = ''`, every object schema-qualified;
--   * calls app.require_view_as(p_subject) FIRST: users.view_as + eligible subject + rank + a LIVE audited session bound to the
--     caller's Auth session, re-evaluated on every call (so Exit, sign-out, expiry, revocation and rank change cut access);
--   * takes the subject as an argument and reads THAT subject only — never auth.uid()'s own rows;
--   * returns an explicit allow-list of columns. NEVER returned: credentials, OTPs, tokens, auth metadata, storage object
--     keys/paths, original file names, job-site addresses, client contact details, the secondary phone (masked), internal
--     moderator ids. Media are reported as counts/kinds only; delivering them is the separately reviewed private-media stage.
--   * reuses existing business logic where it already takes a user id (app.profile_completion(uuid)) and mirrors the
--     `my_*` definitions otherwise (same joins, same suppression rule) without altering any of them.
-- No table, policy or existing function changes. EXECUTE: authenticated only (revoked from public, anon, service_role).

create or replace function public.admin_view_craftsman_dashboard(p_subject uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_month_start timestamptz := (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo');
begin
  perform app.require_view_as(p_subject, 'craftsman');
  return jsonb_build_object(
    'display_name', (select p.display_name from public.profiles p where p.user_id = p_subject),
    'account_status', (select u.status::text from public.users u where u.id = p_subject),
    'public_profile_status', (select p.public_profile_status::text from public.profiles p where p.user_id = p_subject),
    'completion', app.profile_completion(p_subject),
    'work_counts', coalesce((
      select jsonb_object_agg(s.status, s.n) from (
        select a.status::text as status, count(*)::int as n
          from public.job_assignments a where a.installer_user_id = p_subject group by a.status) s), '{}'::jsonb),
    'points', jsonb_build_object(
      'balance', coalesce((select sum(l.points_delta) from public.points_ledger l where l.user_id = p_subject), 0)::int,
      'month_earned', coalesce((select sum(l.points_delta) from public.points_ledger l
                                 where l.user_id = p_subject and l.points_delta > 0 and l.created_at >= v_month_start), 0)::int),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.job_reviews r where r.installer_user_id = p_subject and not app.review_is_suppressed(r.id))::int,
      'average', (select round(avg(r.rating)::numeric, 1) from public.job_reviews r
                   where r.installer_user_id = p_subject and not app.review_is_suppressed(r.id))),
    'verification', (
      select jsonb_build_object('type', v.verification_type::text, 'status', v.status::text, 'submitted_at', v.submitted_at)
        from public.verifications v where v.user_id = p_subject order by v.submitted_at desc limit 1));
end;
$$;

create or replace function public.admin_view_craftsman_profile(p_subject uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_view_as(p_subject, 'craftsman');
  return jsonb_build_object(
    'display_name', p.display_name,
    'display_name_ar', p.display_name_ar,
    'display_name_en', p.display_name_en,
    'headline', p.headline,
    'bio', p.bio,
    'phone', p.phone_e164,                       -- primary phone: shown as the admin directory already shows it (users.read)
    'phone_verified', p.phone_verified_at is not null,
    'secondary_phone_masked', (
      select '•••' || right(r.phone_e164, 3) from public.secondary_phone_reservations r
       where r.user_id = p_subject and r.status = 'active' and r.expires_at > now() limit 1),
    'has_avatar', p.avatar_media_id is not null,
    'avatar_id', p.avatar_media_id,                -- an opaque id, never a storage key; delivered by 20261114090004
    'has_cover', p.cover_media_id is not null,
    'public_profile_status', p.public_profile_status::text,
    'account_status', u.status::text,
    'is_verified', u.is_verified,
    'member_since', u.created_at,
    'years_experience', io.prof_years_experience,
    'availability', io.prof_availability,
    'trades', coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'is_primary', ut.is_primary) order by ut.is_primary desc, t.key)
                          from public.user_trades ut join public.trades t on t.id = ut.trade_id where ut.user_id = p_subject), '[]'::jsonb),
    'service_areas', coalesce((select jsonb_agg(jsonb_build_object('governorate', a.governorate_key, 'city', a.city_key, 'is_primary', a.is_primary)
                                                 order by a.is_primary desc, a.governorate_key, a.city_key)
                                 from public.user_service_areas a where a.user_id = p_subject), '[]'::jsonb),
    'completion', app.profile_completion(p_subject))
  from public.users u
  left join public.profiles p on p.user_id = u.id
  left join public.individual_onboarding io on io.user_id = u.id
  where u.id = p_subject;
end;
$$;

create or replace function public.admin_view_craftsman_portfolio(p_subject uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_view_as(p_subject, 'craftsman');
  return jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', pr.id, 'title', pr.title, 'location', pr.location, 'description', pr.description,
          'visibility', pr.visibility::text, 'created_at', pr.created_at,
          'items', coalesce((
            select jsonb_agg(jsonb_build_object(
                'id', i.id, 'title', i.title, 'description', i.description,
                'kind', case when i.content_type like 'video/%' then 'video' else 'image' end,
                'visibility', i.visibility::text, 'state', i.state::text) order by i.sort_order, i.created_at)
              from public.portfolio_items i where i.project_id = pr.id and i.owner_user_id = p_subject), '[]'::jsonb))
        order by pr.sort_order, pr.created_at)
        from public.portfolio_projects pr where pr.owner_user_id = p_subject), '[]'::jsonb),
    'certificates', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.id, 'title', c.title, 'issuer', c.issuer, 'issued_on', c.issued_on, 'expires_on', c.expires_on,
          'kind', case when c.content_type = 'application/pdf' then 'pdf' else 'image' end, 'state', c.state::text)
        order by c.created_at desc)
        from public.professional_certificates c where c.owner_user_id = p_subject), '[]'::jsonb));
end;
$$;

create or replace function public.admin_view_craftsman_work(p_subject uuid, p_limit integer default 25)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
begin
  perform app.require_view_as(p_subject, 'craftsman');
  return jsonb_build_object(
    'counts', coalesce((
      select jsonb_object_agg(s.status, s.n) from (
        select a.status::text as status, count(*)::int as n
          from public.job_assignments a where a.installer_user_id = p_subject group by a.status) s), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(x.j order by x.created_at desc) from (
        select a.created_at,
               jsonb_build_object(
                 'id', a.id, 'status', a.status::text, 'job_title', j.title, 'trade_key', t.key,
                 'company', o.name, 'governorate', j.governorate, 'city', j.city,
                 'agreed_amount', a.agreed_amount, 'agreed_currency', a.agreed_currency,
                 'progress_percent', a.latest_progress_percent, 'last_progress_at', a.last_progress_at,
                 'started_at', a.started_at, 'completed_at', a.completed_at, 'cancelled_at', a.cancelled_at,
                 'starts_on', j.starts_on, 'ends_by', j.ends_by) as j
          from public.job_assignments a
          join public.jobs j on j.id = a.job_id
          join public.trades t on t.id = j.trade_id
          join public.organizations o on o.id = a.poster_org_id
         where a.installer_user_id = p_subject
         order by a.created_at desc
         limit v_limit) x), '[]'::jsonb));
end;
$$;

create or replace function public.admin_view_craftsman_points(p_subject uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_month_start timestamptz := (date_trunc('month', now() at time zone 'Africa/Cairo') at time zone 'Africa/Cairo');
begin
  perform app.require_view_as(p_subject, 'craftsman');
  return jsonb_build_object(
    'balance', coalesce((select sum(l.points_delta) from public.points_ledger l where l.user_id = p_subject), 0)::int,
    'month_earned', coalesce((select sum(l.points_delta) from public.points_ledger l
                               where l.user_id = p_subject and l.points_delta > 0 and l.created_at >= v_month_start), 0)::int,
    'month_deducted', coalesce((select -sum(l.points_delta) from public.points_ledger l
                                 where l.user_id = p_subject and l.points_delta < 0 and l.created_at >= v_month_start), 0)::int,
    'entry_count', (select count(*) from public.points_ledger l where l.user_id = p_subject)::int,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', e.id, 'event_type', e.event_type, 'points_delta', e.points_delta,
          'reason_code', e.reason_code, 'created_at', e.created_at) order by e.created_at desc)
        from (select l.* from public.points_ledger l where l.user_id = p_subject order by l.created_at desc limit v_limit) e), '[]'::jsonb));
end;
$$;

create or replace function public.admin_view_craftsman_reviews(p_subject uuid, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform app.require_view_as(p_subject, 'craftsman');
  return jsonb_build_object(
    'total', (select count(*) from public.job_reviews r where r.installer_user_id = p_subject and not app.review_is_suppressed(r.id))::int,
    'average', (select round(avg(r.rating)::numeric, 1) from public.job_reviews r
                 where r.installer_user_id = p_subject and not app.review_is_suppressed(r.id)),
    'monthly', (
      select jsonb_agg(jsonb_build_object('month', m.month, 'reviews', m.n, 'average', m.avg) order by m.month)
        from (
          select g.month::date as month,
                 count(r.id)::int as n,
                 round(avg(r.rating)::numeric, 1) as avg
            from generate_series(0, 5) k
            cross join lateral (select (date_trunc('month', now() at time zone 'Africa/Cairo')::date - make_interval(months => k))::date as month) g
            left join public.job_reviews r
              on r.installer_user_id = p_subject and not app.review_is_suppressed(r.id)
             and date_trunc('month', r.created_at at time zone 'Africa/Cairo')::date = g.month
           group by g.month) m),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', x.id, 'rating', x.rating, 'comment', x.comment, 'company', x.org_name,
          'job_title', x.job_title, 'trade_key', x.trade_key, 'created_at', x.created_at) order by x.created_at desc)
        from (
          select r.id, r.rating, r.comment, o.name as org_name, j.title as job_title, t.key as trade_key, r.created_at
            from public.job_reviews r
            join public.job_assignments a on a.id = r.assignment_id
            join public.jobs j on j.id = a.job_id
            join public.trades t on t.id = j.trade_id
            join public.organizations o on o.id = r.poster_org_id
           where r.installer_user_id = p_subject and not app.review_is_suppressed(r.id)
           order by r.created_at desc
           limit v_limit) x), '[]'::jsonb));
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_view_craftsman_dashboard(uuid)',
    'public.admin_view_craftsman_profile(uuid)',
    'public.admin_view_craftsman_portfolio(uuid)',
    'public.admin_view_craftsman_work(uuid,integer)',
    'public.admin_view_craftsman_points(uuid,integer)',
    'public.admin_view_craftsman_reviews(uuid,integer)'] loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

comment on function public.admin_view_craftsman_dashboard(uuid) is 'Admin View-As (craftsman): dashboard summary for the subject. Read-only; requires a live audited view session (app.require_view_as).';
comment on function public.admin_view_craftsman_profile(uuid) is 'Admin View-As (craftsman): profile for the subject. Secondary phone masked; no storage keys; read-only.';
comment on function public.admin_view_craftsman_portfolio(uuid) is 'Admin View-As (craftsman): portfolio projects, items and certificates as metadata only (no object keys); read-only.';
comment on function public.admin_view_craftsman_work(uuid, integer) is 'Admin View-As (craftsman): assignments, without site address or client contacts; read-only.';
comment on function public.admin_view_craftsman_points(uuid, integer) is 'Admin View-As (craftsman): points balance and recent ledger entries; read-only.';
comment on function public.admin_view_craftsman_reviews(uuid, integer) is 'Admin View-As (craftsman): reviews received (suppressed ones excluded, as for the owner); read-only.';

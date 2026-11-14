-- pgTAP: Admin View-As — the six read-only Craftsman sections (20261114090003_admin_view_craftsman_sections.sql).
--
-- Called as a hostile client would: `authenticated` / `anon` roles with a forged-but-valid JWT (including the Auth `session_id`
-- claim a view is bound to), invoking the functions DIRECTLY.
--   A. Every function refuses without a live audited session, for every kind of caller
--   B. With a session each returns the SUBJECT's data (never the admin's, never another craftsman's)
--   C. Allow-list: no storage key / path / file name / site address / contact / secondary phone in clear text
--   D. After Exit the same call is refused; read-only (STABLE) and grants
--
-- Fixture: 71000006 is the viewed craftsman, built through the REAL job RPCs (create, publish, apply, accept, start, 100%,
-- complete, review) like pgTAP 49; poster 70000006. 71000007 is another craftsman whose data must never leak.
create extension if not exists pgtap;

begin;
select plan(32);

\set adminA  '55555555-5555-4555-8555-555555555555'
\set adminB  '22222222-2222-4222-8222-222222222222'
\set supp    '44444444-4444-4444-8444-444444444444'
\set poster  '70000006-0000-4000-8000-000000000006'
\set craft   '71000006-0000-4000-8000-000000000006'
\set other   '71000007-0000-4000-8000-000000000007'
\set org     '9a000000-aaaa-4aaa-8aaa-000000000005'

create function pg_temp.act_as(p_user uuid, p_session uuid default 'a0000000-0000-4000-8000-000000000001') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.act_as(uuid, uuid), pg_temp.as_dba() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
insert into public.platform_role_grants (user_id, role, granted_by) values (:'adminB', 'administrator', :'adminA');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'supp', 'support', :'adminA');

select pg_temp.act_as(:'poster');
select set_config('t.job', public.job_create(:'org'::uuid, 'Marble staircase cladding - Fifth Settlement',
  (select key from public.trades where is_active order by sort_order limit 1),
  9000::numeric, 'Full cladding, 18 steps.', 'Cairo', 'New Cairo', 'Secret Site Street 9', 4::smallint)::text, true);
select public.job_publish(current_setting('t.job')::uuid, 1);
select pg_temp.as_dba();
select pg_temp.act_as(:'craft');
select set_config('t.app', public.job_application_submit(current_setting('t.job')::uuid, 'Available next week.')::text, true);
select pg_temp.as_dba();
select pg_temp.act_as(:'poster');
select set_config('t.asg', public.job_application_accept(current_setting('t.app')::uuid)::text, true);
select pg_temp.as_dba();
select pg_temp.act_as(:'craft');
select public.job_assignment_start(current_setting('t.asg')::uuid, 1);
select public.job_progress_add(current_setting('t.asg')::uuid, 100::smallint, 'wrap', 'Finished.');
select pg_temp.as_dba();
select pg_temp.act_as(:'poster');
select public.job_assignment_complete(current_setting('t.asg')::uuid, (select version from public.job_assignments where id = current_setting('t.asg')::uuid));
select public.job_review_submit(current_setting('t.asg')::uuid, 5::smallint, 'Excellent finish, on time.');
select pg_temp.as_dba();

insert into public.points_ledger (user_id, event_type, points_delta, source_type, source_id) values
  (:'craft', 'referral.organization_approved', 100, 'referral', gen_random_uuid()),
  (:'other', 'referral.organization_approved', 777, 'referral', gen_random_uuid());
insert into public.portfolio_projects (owner_user_id, title, location, description) values
  (:'craft', 'Villa kitchen', 'New Cairo', 'Full kitchen fit-out'),
  (:'other', 'OTHER-CRAFTSMAN-PROJECT', 'Giza', 'must never appear');
insert into public.portfolio_items (owner_user_id, object_key, content_type, title, project_id, state)
  select owner_user_id, case title when 'Villa kitchen' then 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg' else 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg' end,
         'image/jpeg', 'Before', id, 'ready'
    from public.portfolio_projects where owner_user_id in (:'craft', :'other');
insert into public.professional_certificates (owner_user_id, object_path, content_type, title, issuer, issued_on, original_filename, state)
  values (:'craft', :'craft' || '/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf', 'application/pdf', 'Electrical safety', 'Egypt Board', '2025-01-01', 'my-private-cert.pdf', 'ready');
insert into public.secondary_phone_reservations (user_id, phone_e164, status, expires_at)
  values (:'craft', '+201000000999', 'active', now() + interval '10 days');

-- ===========================================================================
-- A. No live session => refused, for everyone
-- ===========================================================================
create function pg_temp.call_all(p_subject uuid) returns text language plpgsql as $$
declare r text := '';
begin
  perform public.admin_view_craftsman_dashboard(p_subject); r := r || 'd';
  perform public.admin_view_craftsman_profile(p_subject);   r := r || 'p';
  perform public.admin_view_craftsman_portfolio(p_subject); r := r || 'o';
  perform public.admin_view_craftsman_work(p_subject);      r := r || 'w';
  perform public.admin_view_craftsman_points(p_subject);    r := r || 's';
  perform public.admin_view_craftsman_reviews(p_subject);   r := r || 'r';
  return r;
end;
$$;
grant execute on function pg_temp.call_all(uuid) to authenticated, anon;

select pg_temp.act_as(:'adminA');
select throws_ok(format($$select pg_temp.call_all(%L)$$, :'craft'), '42501', 'not permitted', 'A: an authorized admin WITHOUT a live session is refused (first call)');
select pg_temp.act_as(:'supp');
select throws_ok(format($$select public.admin_view_craftsman_profile(%L)$$, :'craft'), '42501', 'not permitted', 'A: Support is refused');
select pg_temp.act_as(:'craft');
select throws_ok(format($$select public.admin_view_craftsman_profile(%L)$$, :'craft'), '42501', 'not permitted', 'A: the craftsman cannot use the admin function on themselves');
set local role anon; set local request.jwt.claims = '';
select throws_ok(format($$select public.admin_view_craftsman_dashboard(%L)$$, :'craft'), '42501', null, 'A: anon cannot execute it');
select pg_temp.as_dba();

-- ===========================================================================
-- B. With a live session: the SUBJECT's data
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'B: the admin opens an audited session');
select lives_ok(format($$select pg_temp.call_all(%L)$$, :'craft'), 'B: all six sections now answer');
create temp table t_out (k text, j jsonb) on commit drop;
grant all on t_out to authenticated;
insert into t_out select 'dashboard', public.admin_view_craftsman_dashboard(:'craft');
insert into t_out select 'profile',   public.admin_view_craftsman_profile(:'craft');
insert into t_out select 'portfolio', public.admin_view_craftsman_portfolio(:'craft');
insert into t_out select 'work',      public.admin_view_craftsman_work(:'craft');
insert into t_out select 'points',    public.admin_view_craftsman_points(:'craft');
insert into t_out select 'reviews',   public.admin_view_craftsman_reviews(:'craft');
select pg_temp.as_dba();

select is((select j #>> '{work_counts,completed}' from t_out where k = 'dashboard'), '1', 'B: dashboard counts the subject''s completed assignment');
select is((select j #>> '{points,balance}' from t_out where k = 'dashboard'), '100', 'B: dashboard balance is the subject''s (not the other craftsman''s 777)');
select is((select j #>> '{reviews,total}' from t_out where k = 'dashboard'), '1', 'B: dashboard review count');
select is((select j ->> 'display_name' from t_out where k = 'profile'), (select display_name from public.profiles where user_id = :'craft'), 'B: profile is the subject''s, not the admin''s');
select is((select jsonb_array_length(j -> 'projects') from t_out where k = 'portfolio'), 1, 'B: only the subject''s portfolio project');
select is((select j #>> '{projects,0,title}' from t_out where k = 'portfolio'), 'Villa kitchen', 'B: the right project');
select is((select jsonb_array_length(j -> 'certificates') from t_out where k = 'portfolio'), 1, 'B: the subject''s certificate');
select is((select j #>> '{items,0,job_title}' from t_out where k = 'work'), 'Marble staircase cladding - Fifth Settlement', 'B: work lists the subject''s assignment');
select is((select j ->> 'balance' from t_out where k = 'points'), '100', 'B: points balance');
select is((select jsonb_array_length(j -> 'entries') from t_out where k = 'points'), 1, 'B: only the subject''s ledger entry');
select is((select j #>> '{items,0,rating}' from t_out where k = 'reviews'), '5', 'B: the subject''s review');
select is((select jsonb_array_length(j -> 'monthly') from t_out where k = 'reviews'), 6, 'B: six-month trend');
select ok(not exists (select 1 from t_out where j::text like '%OTHER-CRAFTSMAN%' or j::text like '%777%'), 'B: nothing of the other craftsman leaks');

-- ===========================================================================
-- C. Allow-list: what must never be in a projection
-- ===========================================================================
select is((select count(*)::int from t_out where j::text ~* 'object_key|object_path|original_filename|aaaaaaaa-aaaa|bbbbbbbb-bbbb|my-private-cert'), 0, 'C: no storage key, path or file name anywhere');
select is((select count(*)::int from t_out where j::text like '%Secret Site Street%'), 0, 'C: no job-site address');
select is((select count(*)::int from t_out where j::text ~* 'contact_(phone|email|name)|password|token|otp|encrypted'), 0, 'C: no contact, credential or token field');
select is((select j ->> 'secondary_phone_masked' from t_out where k = 'profile'), '•••999', 'C: the secondary phone is masked');
select is((select count(*)::int from t_out where j::text like '%+201000000999%'), 0, 'C: the secondary phone never appears in full');
select is((select (j -> 'projects' -> 0 -> 'items' -> 0 ->> 'kind') from t_out where k = 'portfolio'), 'image', 'C: media are reported as metadata only (kind), delivery is a later stage');

-- ===========================================================================
-- D. Isolation between admins, Exit, read-only, grants
-- ===========================================================================
select pg_temp.act_as(:'adminB');
select throws_ok(format($$select public.admin_view_craftsman_points(%L)$$, :'craft'), '42501', 'not permitted', 'D: another admin cannot ride A''s session');
select pg_temp.act_as(:'adminA');
select is(public.admin_view_as_end(:'craft'), true, 'D: Exit');
select throws_ok(format($$select pg_temp.call_all(%L)$$, :'craft'), '42501', 'not permitted', 'D: after Exit every section is refused again');
select pg_temp.as_dba();
select is((select count(*)::int from pg_proc where proname like 'admin\_view\_craftsman\_%' and provolatile <> 's'), 0, 'D: every section function is STABLE (cannot write)');
select is((select count(*)::int from pg_proc where proname like 'admin\_view\_craftsman\_%' and pronamespace = 'public'::regnamespace and (prosecdef is not true or proconfig is null)), 0, 'D: all SECURITY DEFINER with a fixed search_path');
select is((select count(*)::int from pg_proc p where proname like 'admin\_view\_craftsman\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'D: anon and service_role cannot execute any');
select is((select count(*)::int from pg_proc p where proname like 'admin\_view\_craftsman\_%' and has_function_privilege('authenticated', p.oid, 'execute')), 6, 'D: authenticated can (each authorizes internally)');

select * from finish();
rollback;

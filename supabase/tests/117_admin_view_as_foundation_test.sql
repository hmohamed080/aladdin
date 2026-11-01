-- pgTAP: Admin "View as account" — foundation (20261101090002_admin_view_as_foundation.sql;
-- docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md §4–§5).
--
-- Every check calls the database as a hostile client would: `authenticated` / `anon` Postgres roles with a forged-but-valid
-- JWT `sub`, invoking the functions and the table DIRECTLY.
--   A. Catalog + role matrix (only Super Admin and Administrator hold users.view_as)
--   B. Begin: permission, eligibility (self, rank, kind, unknown id), generic error, suspended subjects viewable
--   C. Session: 30-min non-sliding window, reuse without log spam, one audit row per NEW session
--   D. The gate (require_view_as): live session required, per-admin, expiry, immediate revocation
--   E. Exit / sign-out: audited, idempotent, still possible after revocation
--   F. Surface: no client grants on the table, anon / service_role cannot execute, auth.uid() never changes
--
-- Fixtures (seed): 55555555 holds the legacy `administrator` grant. Everything else is granted INSIDE THIS TRANSACTION.
create extension if not exists pgtap;

begin;
select plan(52);

\set adminA   '55555555-5555-4555-8555-555555555555'
\set super1   '11111111-1111-4111-8111-111111111111'
\set adminB   '22222222-2222-4222-8222-222222222222'
\set moder    '33333333-3333-4333-8333-333333333333'
\set supp     '44444444-4444-4444-8444-444444444444'
\set craft    '70000009-0000-4000-8000-000000000009'
\set craft2   '71000006-0000-4000-8000-000000000006'
\set craftSus '71000007-0000-4000-8000-000000000007'
\set engineer '70000008-0000-4000-8000-000000000008'
\set plain    '70000001-0000-4000-8000-000000000001'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

-- Fixture roles (this transaction only).
select app.admin_bootstrap_super_admin(:'super1');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'adminB', 'administrator', :'adminA');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'moder', 'moderator', :'adminA');
insert into public.platform_role_grants (user_id, role, granted_by) values (:'supp', 'support', :'adminA');
-- A craftsman who is ALSO an Administrator (rank 80), to exercise the rank rule.
insert into public.platform_role_grants (user_id, role, granted_by) values (:'craft2', 'administrator', :'adminA');
update public.users set status = 'suspended' where id = :'craftSus';

-- ===========================================================================
-- A. Catalog + role matrix
-- ===========================================================================
select is((select count(*)::int from public.admin_permissions where key = 'users.view_as'), 1, 'the users.view_as permission exists');
select is((select array_agg(r.key order by r.key) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where rp.permission_key = 'users.view_as'),
  array['administrator','super_admin'], 'ONLY Super Admin and Administrator hold it by default (not Moderator / Support)');
select is((select is_locked from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where rp.permission_key = 'users.view_as' and r.key = 'super_admin'), true, 'it is locked on Super Admin');
select is((select count(*)::int from public.admin_role_permissions where role_id = (select id from public.admin_roles where key = 'super_admin')),
  (select count(*)::int from public.admin_permissions), 'Super Admin still holds every permission');

-- ===========================================================================
-- B. Begin: who may open a view, and of whom
-- ===========================================================================
select pg_temp.act_as(:'moder');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), '42501', 'not permitted', 'a Moderator cannot open a view');
select pg_temp.act_as(:'supp');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), '42501', 'not permitted', 'Support cannot open a view');
select pg_temp.act_as(:'plain');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), '42501', 'not permitted', 'an ordinary user cannot open a view');
set local role anon; set local request.jwt.claims = '';
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), '42501', null, 'anon cannot open a view');

select pg_temp.act_as(:'adminA');
select throws_ok($$select public.admin_view_as_begin('00000000-0000-4000-8000-00000000dead')$$, '42501', 'not permitted',
  'an unknown id is refused with the generic error');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'moder'), '42501', 'not permitted',
  'a forbidden subject is refused with the SAME error (no existence oracle)');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'adminA'), '42501', 'not permitted', 'one cannot view one''s own account');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'engineer'), '42501', 'not permitted', 'a non-craftsman is not a craftsman view');
select throws_ok(format($$select public.admin_view_as_begin(%L, 'showroom')$$, :'craft'), '42501', 'not permitted', 'an unregistered account kind is refused');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft2'), '42501', 'not permitted',
  'an Administrator cannot view Admin Staff at their own rank');
select pg_temp.act_as(:'super1');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft2'), 'a Super Admin may view an Administrator');
select pg_temp.act_as(:'craft2');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft2'), '42501', 'not permitted', 'and no one may view themselves, even an Administrator');
-- A SUSPENDED peer admin is still protected (admin_rank_of reports 0 for a suspended account; the gate must not).
select pg_temp.as_dba();
update public.users set status = 'suspended' where id = :'craft2';
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft2'), '42501', 'not permitted',
  'an Administrator cannot view a SUSPENDED Administrator either (rank protection ignores account status)');
select pg_temp.act_as(:'super1');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft2'), 'a Super Admin still may');
select pg_temp.as_dba();
update public.users set status = 'active' where id = :'craft2';
select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craftSus'), 'a SUSPENDED craftsman is viewable');

-- ===========================================================================
-- C. Session: window, reuse, audit
-- ===========================================================================
create temp table t_s1 (j jsonb) on commit drop;
grant all on t_s1 to authenticated;
insert into t_s1 select public.admin_view_as_begin(:'craft');
select pg_temp.as_dba();
select is((select (j->>'expires_at')::timestamptz - (j->>'started_at')::timestamptz from t_s1), interval '30 minutes',
  'the session lasts exactly 30 minutes');
select is((select j->>'subject_name' from t_s1), 'Ahmed Sobhy', 'the banner name comes from the profile');
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.started' and subject_id = :'craft'), 1,
  'a new session writes one audit row');
select is((select actor_user_id from public.audit_log where action = 'admin.view_as.started' and subject_id = :'craft'), :'adminA'::uuid,
  'the audit actor is the Admin, not the subject');
select pg_temp.act_as(:'adminA');
create temp table t_s2 (j jsonb) on commit drop;
grant all on t_s2 to authenticated;
insert into t_s2 select public.admin_view_as_begin(:'craft');
select pg_temp.as_dba();
select is((select j->>'session_id' from t_s2), (select j->>'session_id' from t_s1), 'a refresh reuses the live session');
select is((select (j->>'expires_at') from t_s2), (select (j->>'expires_at') from t_s1), 'and does NOT slide the expiry');
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.started' and subject_id = :'craft'), 1,
  'a reuse writes no second audit row');

-- ===========================================================================
-- D. The gate every admin_view_* read must call
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select lives_ok(format($$select app.require_view_as(%L)$$, :'craft'), 'a live session passes the gate');
select throws_ok(format($$select app.require_view_as(%L)$$, :'craft2'), '42501', 'not permitted', 'no session for ANOTHER subject => refused');
select pg_temp.act_as(:'adminB');
select throws_ok(format($$select app.require_view_as(%L)$$, :'craft'), '42501', 'not permitted', 'another Administrator cannot ride A''s session');
select pg_temp.act_as(:'adminA');

-- Lapse: the window closes by itself.
select pg_temp.as_dba();
update public.admin_view_sessions set started_at = now() - interval '1 hour', expires_at = now() - interval '1 minute'
 where admin_user_id = :'adminA' and subject_user_id = :'craft';
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select app.require_view_as(%L)$$, :'craft'), '42501', 'not permitted', 'an expired session no longer passes the gate');
create temp table t_s3 (j jsonb) on commit drop;
grant all on t_s3 to authenticated;
insert into t_s3 select public.admin_view_as_begin(:'craft');
select pg_temp.as_dba();
select isnt((select j->>'session_id' from t_s3), (select j->>'session_id' from t_s1), 'beginning again after expiry opens a NEW session');
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.started' and subject_id = :'craft'), 2,
  'and that new session is audited');
select is((select count(*)::int from public.admin_view_sessions where admin_user_id = :'adminA' and subject_user_id = :'craft' and ended_at is null), 1,
  'exactly one live session per admin + subject');

-- Immediate revocation: switching the permission off cuts a LIVE session.
update public.admin_permissions set is_active = false where key = 'users.view_as';
select pg_temp.act_as(:'adminA');
select throws_ok(format($$select app.require_view_as(%L)$$, :'craft'), '42501', 'not permitted', 'revoking the permission invalidates a live session immediately');
select throws_ok(format($$select public.admin_view_as_current(%L)$$, :'craft'), '42501', 'not permitted', 'and the banner/guard read is refused too');
-- ... and a demoted admin can still close their own session.
select is(public.admin_view_as_end(:'craft'), true, 'a demoted admin can still Exit their own session');
select pg_temp.as_dba();
update public.admin_permissions set is_active = true where key = 'users.view_as';

-- ===========================================================================
-- E. Exit / sign-out
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craft'), 'a fresh session opens after the permission is restored');
select is(public.admin_view_as_end(:'craft'), true, 'Exit ends the session');
select is(public.admin_view_as_end(:'craft'), false, 'Exit is idempotent');
select throws_ok(format($$select app.require_view_as(%L)$$, :'craft'), '42501', 'not permitted', 'after Exit the gate refuses further reads');
select pg_temp.as_dba();
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.ended' and metadata->>'reason' = 'exit'), 2,
  'each Exit is audited once (the earlier revoked-admin Exit + this one)');

select pg_temp.act_as(:'super1');
select lives_ok(format($$select public.admin_view_as_begin(%L)$$, :'craftSus'), 'the Super Admin opens a second live session');
select is(public.admin_view_as_end_all(), 2, 'sign-out ends EVERY live session of the caller (craft2 + craftSus)');
select throws_ok(format($$select app.require_view_as(%L)$$, :'craft2'), '42501', 'not permitted', 'and the gate refuses afterwards');
select pg_temp.as_dba();
select is((select count(*)::int from public.audit_log where action = 'admin.view_as.ended' and metadata->>'reason' = 'sign_out'), 2,
  'each sign-out closure is audited');

-- ===========================================================================
-- F. Surface
-- ===========================================================================
select pg_temp.act_as(:'adminA');
select throws_ok($$select count(*) from public.admin_view_sessions$$, '42501', null, 'the session table is not readable by clients');
select throws_ok(format($$insert into public.admin_view_sessions (admin_user_id, subject_user_id, account_kind, expires_at) values (%L, %L, 'craftsman', now() + interval '1 day')$$, :'adminA', :'craft'),
  '42501', null, 'nor writable by clients (no forged sessions)');
select is((select auth.uid()), :'adminA'::uuid, 'auth.uid() is still the Admin: no impersonation exists');
select pg_temp.as_dba();
select is(has_function_privilege('anon', 'public.admin_view_as_begin(uuid,text)', 'execute'), false, 'anon cannot execute begin');
select is(has_function_privilege('service_role', 'public.admin_view_as_begin(uuid,text)', 'execute'), false, 'service_role cannot execute begin');
select is(has_function_privilege('authenticated', 'public.admin_view_as_begin(uuid,text)', 'execute'), true, 'authenticated can (the function authorizes internally)');
select is(has_function_privilege('anon', 'app.require_view_as(uuid,text)', 'execute'), false, 'anon cannot execute the gate');

select * from finish();
rollback;

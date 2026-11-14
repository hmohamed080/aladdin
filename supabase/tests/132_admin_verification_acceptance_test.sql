-- pgTAP: administrative verify / reject — Acceptance validation matrix (PR "Admin real verify/reject").
--
-- Complements 128 (reviewer restrictions on retry). This file pins the END-TO-END contract an owner validates on
-- Acceptance, as a hostile client calling the RPCs directly:
--   A. listing    : a reviewer sees the real pending request; an applicant sees only their own; anon sees nothing
--   B. matrix     : anon / applicant / Support / Moderator / Administrator / Super Admin, for start, approve, reject
--   C. approve    : status + decided_at + reviewer_id, account type applied only by the apply step
--   D. reject     : reason required (null, empty, whitespace, > 2000), stored trimmed, account unchanged
--   E. audit      : actor, actor_role, action, subject, reason; one row per decision; rows are immutable
--   F. notify     : the rejection reason is never copied into a notification; the reviewer is never self-notified
--   G. replay     : double submit is a no-op (one audit row), and a SECOND admin racing an already-decided request
--                   is refused without changing it
--
-- Fixtures (seed): 55555555 = legacy `administrator` (users.verify); 22222222 = Super Admin; 33333333 = Moderator;
-- 11111111 = Support. 44444444 / 66666666-less applicants are seeded end consumers. Roles are granted INSIDE this
-- transaction only; the whole file rolls back. Organization notification fan-out is pinned in 32.
create extension if not exists pgtap;

begin;
select plan(51);

\set adm    '55555555-5555-4555-8555-555555555555'
\set sup    '22222222-2222-4222-8222-222222222222'
\set mdr    '33333333-3333-4333-8333-333333333333'
\set supp   '11111111-1111-4111-8111-111111111111'
\set app1   '44444444-4444-4444-8444-444444444444'
\set app2   '70000001-0000-4000-8000-000000000001'
\set app3   '70000002-0000-4000-8000-000000000002'

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
create function pg_temp.vid(p_user uuid) returns uuid language sql security definer as $$
  select id from public.verifications where user_id = p_user order by submitted_at desc limit 1 $$;
grant execute on function pg_temp.vid(uuid) to authenticated, anon;

insert into public.admin_role_assignments (user_id, role_id)
select v.u, r.id from (values (:'sup'::uuid, 'super_admin'), (:'mdr'::uuid, 'moderator')) v(u, k)
  join public.admin_roles r on r.key = v.k;
insert into public.platform_role_grants (user_id, role, granted_by) values (:'supp', 'support', :'adm');

create temp table t_persona on commit drop as select primary_account_type::text as p from public.users where id = '70000001-0000-4000-8000-000000000001';
-- Three applicants file professional upgrade requests.
select pg_temp.act_as(:'app1');
select lives_ok($$ select public.request_account_upgrade('engineer') $$, 'applicant 1 submits');
select pg_temp.act_as(:'app2');
select lives_ok($$ select public.request_account_upgrade('contractor') $$, 'applicant 2 submits');
select pg_temp.act_as(:'app3');
select lives_ok($$ select public.request_account_upgrade('installer_technician') $$, 'applicant 3 submits');
select pg_temp.as_dba();
create temp table t_ids on commit drop as
  select pg_temp.vid(:'app1') as v1, pg_temp.vid(:'app2') as v2, pg_temp.vid(:'app3') as v3;
grant select on t_ids to authenticated, anon;

-- ===========================================================================
-- A. Listing (the real pending queue, not a preview)
-- ===========================================================================
select pg_temp.act_as(:'adm');
select is((select count(*)::int from public.verifications where id in (select v1 from t_ids union select v2 from t_ids union select v3 from t_ids) and status = 'submitted'), 3,
  'A1 an administrator sees all three real pending requests');
select pg_temp.act_as(:'sup');
select is((select count(*)::int from public.verifications where id in (select v1 from t_ids union select v2 from t_ids union select v3 from t_ids) and status = 'submitted'), 3,
  'A2 a Super Admin sees all three real pending requests');
select pg_temp.act_as(:'app2');
select is((select count(*)::int from public.verifications where id in (select v1 from t_ids union select v2 from t_ids union select v3 from t_ids)), 1,
  'A3 an applicant sees only their own request');
select pg_temp.as_dba();
set local role anon; set local request.jwt.claims = '';
select throws_ok($$ select count(*) from public.verifications $$, '42501', null, 'A4 an anonymous caller cannot read verifications');
select pg_temp.as_dba();

-- ===========================================================================
-- B. Permission matrix on review_start (nothing changes on a refusal)
-- ===========================================================================
select pg_temp.act_as(:'app1');
select throws_ok($$ select public.review_start((select v1 from t_ids)) $$, '42501', null, 'B1 applicant: start refused');
select pg_temp.act_as(:'app2');
select throws_ok($$ select public.review_start((select v1 from t_ids)) $$, '42501', null, 'B2 another ordinary user: start refused');
select pg_temp.act_as(:'supp');
select throws_ok($$ select public.review_start((select v1 from t_ids)) $$, '42501', null, 'B3 Support: start refused');
select pg_temp.as_dba();
set local role anon; set local request.jwt.claims = '';
select throws_ok($$ select public.review_start((select v1 from t_ids)) $$, '42501', null, 'B4 anon: start refused');
select pg_temp.as_dba();
select is((select status::text from public.verifications where id = (select v1 from t_ids)), 'submitted', 'B5 the request is untouched by every refusal');

select pg_temp.act_as(:'mdr');
select lives_ok($$ select public.review_start((select v3 from t_ids)) $$, 'B6 Moderator may start a review (reviewer tier)');
select pg_temp.act_as(:'sup');
select lives_ok($$ select public.review_start((select v2 from t_ids)) $$, 'B7 Super Admin may start a review');
select pg_temp.act_as(:'adm');
select lives_ok($$ select public.review_start((select v1 from t_ids)) $$, 'B8 Administrator may start a review');
select pg_temp.as_dba();
select is((select reviewer_id from public.verifications where id = (select v1 from t_ids)), :'adm'::uuid, 'B9 the claiming admin becomes the assigned reviewer');

-- ===========================================================================
-- C. Approve (Administrator) and apply
-- ===========================================================================
select pg_temp.act_as(:'adm');
select lives_ok($$ select public.review_approve((select v1 from t_ids), false) $$, 'C1 the assigned administrator approves');
select pg_temp.as_dba();
select is((select status::text from public.verifications where id = (select v1 from t_ids)), 'approved', 'C2 status is approved');
select ok((select decided_at is not null from public.verifications where id = (select v1 from t_ids)), 'C3 decided_at is stamped');
select is((select primary_account_type::text from public.users where id = :'app1'), 'end_consumer', 'C4 approval alone does not change the account type');
select pg_temp.act_as(:'adm');
select lives_ok($$ select public.apply_account_upgrade((select v1 from t_ids)) $$, 'C5 apply succeeds');
select pg_temp.as_dba();
select is((select primary_account_type::text from public.users where id = :'app1'), 'engineer', 'C6 the account type is applied');

-- ===========================================================================
-- D. Reject: reason required, trimmed, account unchanged (Super Admin is the assigned reviewer of v2)
-- ===========================================================================
select pg_temp.act_as(:'sup');
select throws_ok($$ select public.review_reject((select v2 from t_ids), null) $$, '22023', null, 'D1 null reason refused');
select throws_ok($$ select public.review_reject((select v2 from t_ids), '') $$, '22023', null, 'D2 empty reason refused');
select throws_ok($$ select public.review_reject((select v2 from t_ids), '   ') $$, '22023', null, 'D3 spaces-only reason refused');
select throws_ok($$ select public.review_reject((select v2 from t_ids), repeat('x', 2001)) $$, '22023', null, 'D4 over-long reason refused');
select pg_temp.as_dba();
select is((select status::text from public.verifications where id = (select v2 from t_ids)), 'under_review', 'D5 refusals left the request under review');
select is((select count(*)::int from public.audit_log where subject_id = (select v2 from t_ids) and action like 'verification.re%ected'), 0, 'D6 refusals wrote no decision audit row');
select pg_temp.act_as(:'sup');
select lives_ok($$ select public.review_reject((select v2 from t_ids), '  ID photo is blurry  ') $$, 'D7 a reasoned rejection succeeds');
select pg_temp.as_dba();
select is((select status::text from public.verifications where id = (select v2 from t_ids)), 'rejected', 'D8 status is rejected');
select is((select reason from public.verifications where id = (select v2 from t_ids)), 'ID photo is blurry', 'D9 the reason is stored trimmed');
select is((select primary_account_type::text from public.users where id = :'app2'), (select p from t_persona), 'D10 rejection leaves the account type unchanged');

-- ===========================================================================
-- E. Audit trail: actor, role, action, subject, reason; immutable
-- ===========================================================================
select is((select actor_user_id from public.audit_log where action = 'verification.approved' and subject_id = (select v1 from t_ids)), :'adm'::uuid,
  'E1 approval audit row names the acting administrator');
select is((select actor_role::text from public.audit_log where action = 'verification.approved' and subject_id = (select v1 from t_ids)), 'administrator',
  'E2 approval audit row records the actor role');
select is((select actor_user_id from public.audit_log where action = 'verification.rejected' and subject_id = (select v2 from t_ids)), :'sup'::uuid,
  'E3 rejection audit row names the acting Super Admin');
select is((select metadata ->> 'reason' from public.audit_log where action = 'verification.rejected' and subject_id = (select v2 from t_ids)), 'ID photo is blurry',
  'E4 rejection audit row carries the (trimmed) reason');
select is((select subject_type from public.audit_log where action = 'verification.rejected' and subject_id = (select v2 from t_ids)), 'verification',
  'E5 the audit subject is the verification');
select is((select count(*)::int from public.audit_log where subject_id = (select v2 from t_ids) and action like 'verification.re%ected'), 1, 'E6 exactly one audit row per decision');
select ok((select not (metadata ?| array['email','phone','national_id','document_path','storage_path']) from public.audit_log where action = 'verification.rejected' and subject_id = (select v2 from t_ids)),
  'E7 the audit row carries no contact or document fields (masked: only the reason is recorded)');
select pg_temp.act_as(:'sup');
select throws_ok($$ update public.audit_log set action = 'tampered' where subject_id = (select v2 from t_ids) $$, '42501', null, 'E8 a Super Admin cannot UPDATE an audit row');
select throws_ok($$ delete from public.audit_log where subject_id = (select v2 from t_ids) $$, '42501', null, 'E9 a Super Admin cannot DELETE an audit row');
select pg_temp.as_dba();
select throws_ok($$ update public.audit_log set action = 'tampered' where subject_id = (select v2 from t_ids) $$, null, null, 'E10 even the table owner is stopped by the immutability trigger');

-- ===========================================================================
-- F. Notifications
-- ===========================================================================
select is((select count(*)::int from public.notifications where subject_id = (select v2 from t_ids) and params::text like '%blurry%'), 0,
  'F1 the free-text rejection reason is never copied into a notification');
select is((select count(*)::int from public.notifications where subject_type = 'verification' and recipient_user_id in (:'adm', :'sup')), 0,
  'F2 the deciding reviewers are never self-notified');

-- ===========================================================================
-- G. Double submit and races on an already-decided request
-- ===========================================================================
select pg_temp.act_as(:'sup');
select lives_ok($$ select public.review_reject((select v2 from t_ids), 'ID photo is blurry') $$, 'G1 the same reviewer repeating the rejection (double click) is a no-op');
select pg_temp.as_dba();
select is((select count(*)::int from public.audit_log where subject_id = (select v2 from t_ids) and action like 'verification.re%ected'), 1, 'G2 the repeat wrote no second audit row');
select pg_temp.act_as(:'adm');
select throws_ok($$ select public.review_approve((select v2 from t_ids), false) $$, '22023', null, 'G3 a second admin approving a rejected request is refused');
select throws_ok($$ select public.review_reject((select v2 from t_ids), 'second opinion') $$, '42501', null, 'G4 a second admin cannot re-confirm someone else''s rejection');
select pg_temp.as_dba();
select is((select reason from public.verifications where id = (select v2 from t_ids)), 'ID photo is blurry', 'G5 the losing racer did not overwrite the reason');
select pg_temp.act_as(:'mdr');
select throws_ok($$ select public.review_reject((select v1 from t_ids), 'late') $$, '22023', null, 'G6 an already-approved request cannot be rejected by another reviewer');
select pg_temp.as_dba();
select is((select status::text from public.verifications where id = (select v1 from t_ids)), 'approved', 'G7 the approved request is unchanged by the late reject');

select * from finish();
rollback;

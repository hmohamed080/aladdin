-- pgTAP: constrained audit emission (Sprint 2).
-- record_audit_event derives the actor from auth.uid() (unspoofable), is
-- internal-only, and every sensitive write path emits an immutable audit row.
create extension if not exists pgtap;

begin;
select plan(12);

-- ordinary users cannot invoke the internal audit writer directly (execute revoked)
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  has_function_privilege('authenticated','app.record_audit_event(text,text,uuid,uuid,jsonb)','execute'),
  false, 'authenticated cannot execute app.record_audit_event directly (no actor forgery)');
select is(
  has_function_privilege('anon','app.record_audit_event(text,text,uuid,uuid,jsonb)','execute'),
  false, 'anon cannot execute app.record_audit_event directly');

-- A sensitive path emits an audit row whose actor is the caller (not spoofable).
select lives_ok($$ select public.request_account_upgrade('engineer') $$, 'consumer submits an upgrade request');
-- read audit as a platform admin
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  (select count(*)::int from public.audit_log where action='account.upgrade_requested'
     and actor_user_id='44444444-4444-4444-8444-444444444444'),
  1, 'the upgrade-request audit row records the true caller as actor');

-- The full review chain emits the expected audit actions with the reviewer as actor.
do $$ declare v uuid; begin
  select id into v from public.verifications where user_id='44444444-4444-4444-8444-444444444444' and status='submitted' limit 1;
  perform set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
  perform public.review_start(v);
  perform public.review_approve(v, true);
  perform public.apply_account_upgrade(v);
end $$;
select is((select count(*)::int from public.audit_log where action='verification.review_started'), 1,
  'review_started is audited');
select is((select count(*)::int from public.audit_log where action='verification.approved'), 1,
  'verification.approved is audited');
select is((select count(*)::int from public.audit_log where action='account.type_changed'
            and actor_user_id='55555555-5555-4555-8555-555555555555'), 1,
  'account.type_changed is audited with the reviewer as actor');
select is((select count(*)::int from public.audit_log where action='profile.listed'), 1,
  'profile.listed is audited');
select is((select actor_role::text from public.audit_log where action='verification.approved' limit 1),
  'administrator', 'the actor_role is derived from the reviewer''s platform grant');

-- Audit rows are immutable even for a superuser path (append-only trigger).
reset role;
select throws_ok(
  $$ update public.audit_log set action='tampered' where action='verification.approved' $$,
  'P0001', null, 'audit rows cannot be updated (append-only trigger)');
select throws_ok(
  $$ delete from public.audit_log where action='verification.approved' $$,
  'P0001', null, 'audit rows cannot be deleted (append-only trigger)');

-- Ordinary users cannot read the audit log.
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.audit_log), 0,
  'an ordinary user cannot read the audit log');

reset role;
select * from finish();
rollback;

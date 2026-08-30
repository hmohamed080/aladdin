-- pgTAP: Points Core — the append-only, user-level Points ledger
-- (docs/database/points-core.md, approved 2026-08-30).
--
-- Proves the security contract of the ledger FOUNDATION. No earning event is
-- wired in this increment and none is fabricated here: every fixture is written
-- through the trusted paths this migration actually ships — app.award_points
-- (internal) and the two platform-gated correction RPCs.
--
--   • user_id is the ONLY authority column. organization_id never grants
--     visibility, INCLUDING to an active same-org colleague and to the org
--     owner holding org.manage. That is the assertion that matters most.
--   • no client write path exists (no INSERT/UPDATE/DELETE policy or grant)
--   • app.award_points is internal-only: the browser cannot award itself points
--   • idempotency is deterministic and enforced by a unique INDEX, so a retry,
--     a replay and a concurrent second writer all collapse or are rejected
--   • corrections are compensating entries; the original is never touched, and
--     an entry can be reversed at most once
--   • the derived balance is sum(points_delta) and may legitimately be negative
--
-- Fixtures come from the shared seed:
--   Org A = 'aaaaaaaa…' (Nile Finishing) — owner 11111111 (org.manage),
--                                          staff 22222222 (active member)
--   Org B = 'bbbbbbbb…' (Delta Interiors) — owner 33333333
--   user 44444444 = non-member (intruder)
--   user 55555555 = platform administrator
-- 11111111 and 22222222 are ACTIVE MEMBERS OF THE SAME ORG, which is what makes
-- the colleague-isolation assertions meaningful.
create extension if not exists pgtap;

begin;
select plan(60);

-- ===========================================================================
-- 1. Schema — the ledger, and the absence of a balance
-- ===========================================================================
select ok(to_regclass('public.points_ledger') is not null,
  'public.points_ledger exists');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'points_ledger'
     and column_name in ('id','user_id','organization_id','event_type','points_delta',
                         'source_type','source_id','reverses_entry_id',
                         'awarded_by_user_id','reason_code','metadata','created_at')),
  12, 'the ledger carries exactly the twelve contracted columns');

-- The single most important schema assertion in this suite: there is no stored
-- balance anywhere, so nothing can disagree with the ledger.
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'points_ledger'
     and column_name in ('balance','points_balance','total','points_total','cached_balance')),
  0, 'no mutable balance column exists on the ledger');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'points_ledger'
     and column_name = 'updated_at'),
  0, 'there is no updated_at — a row that can be updated is not append-only');

-- Money must not have leaked into an engagement ledger.
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'points_ledger'
     and column_name in ('amount','currency','currency_code','rate','value_egp','payout')),
  0, 'no monetary column exists — Points are not money');

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'points_ledger' and column_name = 'user_id'),
  'NO', 'user_id is NOT NULL — every entry has an owner');

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'points_ledger' and column_name = 'organization_id'),
  'YES', 'organization_id is nullable — a person with no organization can still earn');

select is(
  (select is_nullable from information_schema.columns
   where table_schema = 'public' and table_name = 'points_ledger' and column_name = 'source_id'),
  'NO', 'source_id is NOT NULL — a nullable one would silently disable the unique idempotency index');

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
          and indexname = 'ux_points_ledger_event_identity'),
  'the deterministic idempotency index exists');

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
          and indexname = 'ux_points_ledger_one_reversal_per_entry'),
  'the one-reversal-per-entry index exists');

select is(
  (select count(*)::int from pg_trigger t
   join pg_class c on c.oid = t.tgrelid
   where c.relname = 'points_ledger' and not t.tgisinternal
     and t.tgname in ('points_ledger_no_update','points_ledger_no_delete')),
  2, 'both append-only triggers are installed');

-- ===========================================================================
-- 2. Fixtures — written through the TRUSTED path, not by hand
--    app.award_points is the only insertion point, so using it here also proves
--    it works. No referral award is fabricated: the entries below are
--    admin.adjustment, the one event this increment actually implements.
-- ===========================================================================
-- P1: +50 to the Org A STAFF member, in Org A context.
select lives_ok(
  $$ select app.award_points(
       '22222222-2222-4222-8222-222222222222',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'admin.adjustment', 'audit_event',
       'aa000000-0000-4000-8000-000000000001',
       50, '{}'::jsonb, 'support_correction',
       '55555555-5555-4555-8555-555555555555') $$,
  'a positive entry is written through the trusted internal path');

-- P2: +20 to the SAME staff member, different source record.
-- P3: +7 to the Org A OWNER (the colleague's own row).
-- P4: +5 to the Org B owner (another tenant).
select lives_ok(
  $$ select app.award_points(
       '22222222-2222-4222-8222-222222222222', null,
       'admin.adjustment', 'audit_event',
       'aa000000-0000-4000-8000-000000000002',
       20, '{}'::jsonb, 'support_correction',
       '55555555-5555-4555-8555-555555555555'),
     app.award_points(
       '11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'admin.adjustment', 'audit_event',
       'aa000000-0000-4000-8000-000000000003',
       7, '{}'::jsonb, 'support_correction',
       '55555555-5555-4555-8555-555555555555'),
     app.award_points(
       '33333333-3333-4333-8333-333333333333',
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
       'admin.adjustment', 'audit_event',
       'aa000000-0000-4000-8000-000000000004',
       5, '{}'::jsonb, 'support_correction',
       '55555555-5555-4555-8555-555555555555') $$,
  'further entries are written for a colleague and another tenant');

select is((select count(*)::int from public.points_ledger where source_id::text like 'aa000000-%'), 4,
  'four ledger entries exist after the trusted writes');

-- A zero delta records nothing and is refused at the writer…
select throws_ok(
  $$ select app.award_points(
       '22222222-2222-4222-8222-222222222222', null,
       'admin.adjustment', 'audit_event',
       'aa000000-0000-4000-8000-00000000000f',
       0, '{}'::jsonb, 'support_correction',
       '55555555-5555-4555-8555-555555555555') $$,
  '22023', null, 'a zero points_delta is rejected by the writer');

-- …and at the column, so a future call site cannot slip past the writer.
select throws_ok(
  $$ insert into public.points_ledger
       (user_id, event_type, points_delta, source_type, source_id)
     values ('22222222-2222-4222-8222-222222222222', 'admin.adjustment', 0,
             'audit_event', 'aa000000-0000-4000-8000-00000000000e') $$,
  '23514', null, 'a zero points_delta is rejected by the CHECK constraint');

-- An unknown event key fails the allow-list rather than being stored.
select throws_ok(
  $$ insert into public.points_ledger
       (user_id, event_type, points_delta, source_type, source_id)
     values ('22222222-2222-4222-8222-222222222222', 'quotation.accepted', 5,
             'quotation', 'aa000000-0000-4000-8000-00000000000d') $$,
  '23514', null, 'an unapproved earning event key is rejected by the allow-list');

-- Metadata is bounded: a nested object would smuggle a business record into a
-- column no policy can filter.
select throws_ok(
  $$ insert into public.points_ledger
       (user_id, event_type, points_delta, source_type, source_id, metadata)
     values ('22222222-2222-4222-8222-222222222222', 'admin.adjustment', 5,
             'audit_event', 'aa000000-0000-4000-8000-00000000000c',
             '{"customer":{"phone":"+201000000000"}}'::jsonb) $$,
  '23514', null, 'nested metadata is rejected — display context only, never a copied record');

-- ===========================================================================
-- 3. Ownership and visibility — organization_id is context, never authority
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.points_ledger), 2,
  'the owner reads their own entries, and only their own');

select is((select sum(points_delta)::int from public.points_ledger), 70,
  'the owner reads both of their entries (50 + 20)');

-- THE assertion. 11111111 is an ACTIVE org.manage member of the very org that
-- entry P1 carries, and still cannot see it.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.points_ledger
   where user_id = '22222222-2222-4222-8222-222222222222'),
  0, 'a SAME-ORG colleague cannot read another user''s points history');

select is(
  (select count(*)::int from public.points_ledger
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'org.manage over the organization does not widen the ledger — only the caller''s own row');

select is(
  (select user_id from public.points_ledger
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the one visible org-context row is the caller''s own');

-- The owner of the organization cannot even count a team total.
select is((select count(*)::int from public.points_ledger), 1,
  'an organization owner sees exactly one row — their own — and no team total');

-- Another tenant sees nothing of Org A.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.points_ledger
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'a member of another organization reads none of the first tenant''s entries');

select is((select count(*)::int from public.points_ledger), 1,
  'the other tenant''s owner sees only their own entry (tenant isolation)');

-- A non-member reads nothing at all.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.points_ledger where source_id::text like 'aa000000-%'), 0,
  'an unrelated user reads no points entries whatsoever');

-- Platform support/administrator reads everything — the contested-record
-- exception the specification approves, and the only read path beyond the owner.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is((select count(*)::int from public.points_ledger where source_id::text like 'aa000000-%'), 4,
  'a platform administrator can inspect every entry (correction requires seeing)');

-- ===========================================================================
-- 4. No client write path
-- ===========================================================================
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.points_ledger
       (user_id, event_type, points_delta, source_type, source_id)
     values ('22222222-2222-4222-8222-222222222222', 'admin.adjustment', 1000,
             'audit_event', 'aa000000-0000-4000-8000-0000000000aa') $$,
  '42501', null, 'authenticated cannot INSERT a points entry directly');

select throws_ok(
  $$ update public.points_ledger set points_delta = 9999 $$,
  '42501', null, 'authenticated cannot UPDATE a points entry');

select throws_ok(
  $$ delete from public.points_ledger $$,
  '42501', null, 'authenticated cannot DELETE a points entry');

-- The primitive itself is unreachable: this is what makes "the browser cannot
-- award itself points" structural rather than a matter of policy wording.
select throws_ok(
  $$ select app.award_points(
       '22222222-2222-4222-8222-222222222222', null,
       'admin.adjustment', 'audit_event',
       'aa000000-0000-4000-8000-0000000000ab',
       999999, '{}'::jsonb, 'support_correction',
       '22222222-2222-4222-8222-222222222222') $$,
  '42501', null, 'authenticated cannot invoke the internal award primitive');

-- An ordinary user cannot reach the correction RPCs either: they are callable,
-- but each re-checks platform authority inside the function body.
select throws_ok(
  $$ select public.adjust_points('22222222-2222-4222-8222-222222222222', 500, 'support_correction') $$,
  '42501', null, 'an ordinary user cannot adjust points — platform authority is required');

-- …and neither can an organization OWNER, whose org.manage buys nothing here.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.adjust_points('22222222-2222-4222-8222-222222222222', 500, 'support_correction') $$,
  '42501', null, 'an organization owner cannot adjust an employee''s points');

select throws_ok(
  $$ select public.reverse_points_entry(
       (select id from public.points_ledger limit 1), 'support_correction') $$,
  '42501', null, 'an organization owner cannot reverse a points entry');

-- ===========================================================================
-- 5. Idempotency — deterministic identity, enforced by the index
-- ===========================================================================
reset role;
set local request.jwt.claims = '';

-- A retry of the exact canonical event is collapsed to a no-op returning null,
-- so the surrounding business transaction still commits.
select is(
  (select app.award_points(
     '22222222-2222-4222-8222-222222222222',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'admin.adjustment', 'audit_event',
     'aa000000-0000-4000-8000-000000000001',
     50, '{}'::jsonb, 'support_correction',
     '55555555-5555-4555-8555-555555555555')),
  null, 'a retry of the same canonical event returns null (no second award)');

select is((select count(*)::int from public.points_ledger where source_id::text like 'aa000000-%'), 4,
  'the retry wrote no second row');

-- A different amount for the same canonical event is still the same event.
-- Identity is the event, not the payload — otherwise a retry with a corrected
-- amount would award twice.
select is(
  (select app.award_points(
     '22222222-2222-4222-8222-222222222222',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'admin.adjustment', 'audit_event',
     'aa000000-0000-4000-8000-000000000001',
     999, '{}'::jsonb, 'support_correction',
     '55555555-5555-4555-8555-555555555555')),
  null, 'the same event with a different amount is still a duplicate, not a top-up');

select is((select sum(points_delta)::int from public.points_ledger
           where user_id = '22222222-2222-4222-8222-222222222222'), 70,
  'the duplicate attempts left the owner''s total untouched at 70');

-- The INDEX, not the application check, is what makes concurrency safe: a
-- direct duplicate insert that bypasses ON CONFLICT is rejected at the storage
-- layer, which is exactly what a second concurrent transaction would hit.
select throws_ok(
  $$ insert into public.points_ledger
       (user_id, organization_id, event_type, points_delta, source_type, source_id,
        reason_code, awarded_by_user_id)
     values ('22222222-2222-4222-8222-222222222222',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             'admin.adjustment', 50, 'audit_event',
             'aa000000-0000-4000-8000-000000000001',
             'support_correction', '55555555-5555-4555-8555-555555555555') $$,
  '23505', null, 'a concurrent-equivalent duplicate is rejected by the unique index');

-- A different source record is a genuinely different event.
select isnt(
  (select app.award_points(
     '22222222-2222-4222-8222-222222222222',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'admin.adjustment', 'audit_event',
     'aa000000-0000-4000-8000-000000000005',
     3, '{}'::jsonb, 'support_correction',
     '55555555-5555-4555-8555-555555555555')),
  null, 'a different source_id is a distinct, legitimate award');

-- A different user is a distinct identity for the SAME source record.
select isnt(
  (select app.award_points(
     '11111111-1111-4111-8111-111111111111',
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     'admin.adjustment', 'audit_event',
     'aa000000-0000-4000-8000-000000000001',
     3, '{}'::jsonb, 'support_correction',
     '55555555-5555-4555-8555-555555555555')),
  null, 'the same source record can award a DIFFERENT user (recipient is part of the identity)');

select is((select count(*)::int from public.points_ledger where source_id::text like 'aa000000-%'), 6,
  'exactly two further legitimate entries were added');

-- ===========================================================================
-- 6. Reversal and correction — compensating entries, never a rewrite
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select isnt(
  (select public.reverse_points_entry(
     (select id from public.points_ledger
      where user_id = '22222222-2222-4222-8222-222222222222'
        and source_id = 'aa000000-0000-4000-8000-000000000001'
        and reverses_entry_id is null),
     'support_correction')),
  null, 'a platform administrator can reverse an entry');

select is(
  (select points_delta from public.points_ledger
   where reverses_entry_id = (select id from public.points_ledger
                              where user_id = '22222222-2222-4222-8222-222222222222'
                                and source_id = 'aa000000-0000-4000-8000-000000000001'
                                and reverses_entry_id is null)),
  -50, 'the compensating entry carries the exact negation of the original');

-- The original is untouched — this is the whole point of the model.
select is(
  (select points_delta from public.points_ledger
   where user_id = '22222222-2222-4222-8222-222222222222'
     and source_id = 'aa000000-0000-4000-8000-000000000001'
     and reverses_entry_id is null),
  50, 'the original entry is unchanged after being reversed');

select is(
  (select count(*)::int from public.points_ledger
   where user_id = '22222222-2222-4222-8222-222222222222'
     and source_id = 'aa000000-0000-4000-8000-000000000001'),
  2, 'history still contains BOTH the original and its reversal');

-- An entry can be reversed at most once.
select throws_ok(
  $$ select public.reverse_points_entry(
       (select id from public.points_ledger
        where user_id = '22222222-2222-4222-8222-222222222222'
          and source_id = 'aa000000-0000-4000-8000-000000000001'
          and reverses_entry_id is null),
       'support_correction') $$,
  '23505', null, 'the same entry cannot be reversed twice');

-- A compensating entry is not itself reversible: a mistaken reversal is fixed
-- by a new administrative adjustment, which carries its own reason and audit row.
select throws_ok(
  $$ select public.reverse_points_entry(
       (select id from public.points_ledger where reverses_entry_id is not null limit 1),
       'support_correction') $$,
  '22023', null, 'a compensating entry cannot itself be reversed');

select throws_ok(
  $$ select public.reverse_points_entry(
       'aa000000-0000-4000-8000-0000000000ff', 'support_correction') $$,
  'P0002', null, 'reversing a non-existent entry is refused');

-- Administrative adjustment: a signed entry whose source is its own audit row.
select isnt(
  (select public.adjust_points(
     '22222222-2222-4222-8222-222222222222', -40, 'event_invalidated')),
  null, 'a platform administrator can write a standalone administrative adjustment');

select is(
  (select count(*)::int from public.audit_log
   where action in ('points.adjusted','points.reversed')
     and metadata->>'subject_user_id' = '22222222-2222-4222-8222-222222222222'),
  2, 'both administrative transitions are recorded in the forensic log');

-- ===========================================================================
-- 7. Balance — derived, faithful, and allowed to be negative
-- ===========================================================================
-- 50 + 20 + 3 (awards) - 50 (reversal) - 40 (adjustment) = -17
select is(
  (select public.points_balance('22222222-2222-4222-8222-222222222222')),
  -17::bigint,
  'the derived balance is negative after a legitimate correction, not clamped at zero');

select is(
  (select public.points_balance('22222222-2222-4222-8222-222222222222')),
  (select sum(points_delta)::bigint from public.points_ledger
   where user_id = '22222222-2222-4222-8222-222222222222'),
  'the balance helper equals SUM(points_delta) exactly');

-- The balance runs under the caller's own RLS, so it cannot become a read path
-- around the policies: an ordinary user asking about someone else gets zero,
-- not that person''s total.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select public.points_balance('22222222-2222-4222-8222-222222222222')),
  0::bigint, 'an unrelated user cannot read another user''s balance through the helper');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select public.points_balance('22222222-2222-4222-8222-222222222222')),
  0::bigint, 'a same-org colleague cannot read a teammate''s balance through the helper');

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select public.points_balance()),
  -17::bigint, 'the owner reads their own balance with no argument');

-- ===========================================================================
-- 8. Multi-tenancy — organization context is retained, never promoted
-- ===========================================================================
select is(
  (select organization_id from public.points_ledger
   where user_id = '22222222-2222-4222-8222-222222222222'
     and source_id = 'aa000000-0000-4000-8000-000000000001'
     and reverses_entry_id is null),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'the business context in which an entry was earned is retained on the entry');

select is(
  (select organization_id from public.points_ledger
   where user_id = '22222222-2222-4222-8222-222222222222'
     and source_id = 'aa000000-0000-4000-8000-000000000002'),
  null, 'an entry earned in personal context carries no organization');

-- The reversal inherits the original's context rather than inventing one.
select is(
  (select organization_id from public.points_ledger
   where reverses_entry_id is not null
     and user_id = '22222222-2222-4222-8222-222222222222'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'a compensating entry inherits the original''s business context');

select finish();
rollback;

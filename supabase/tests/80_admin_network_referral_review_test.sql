-- pgTAP: Admin review queue for Network referrals
-- (20260929090001_admin_network_referral_review.sql).
--
-- This file tests exactly the one RPC that migration adds —
-- admin_network_referrals_list — never the lifecycle RPCs it lists
-- (network_referral_create_new/_existing/_cancel/_approve/_reject), which
-- already have full coverage in 51_network_referrals_test.sql.
--
-- Fixtures, from seed-pilot / seed:
--   71000006 — installer_technician, the referrer
--   9c000000…0001 (org C, "Cairo Ceramics Showroom") — an EXISTING
--              showroom_dealer, used as the de-duplication match target (the
--              dedup hint only ever compares against showroom_dealer orgs,
--              the one classification network_referral_approve produces —
--              a supplier/importer/etc. of a similar name must NOT match)
--   11111111 — an existing user, given the platform moderator role INSIDE
--              this transaction only, exactly as 51_network_referrals_test
--              does for the same user
create extension if not exists pgtap;

begin;
select plan(17);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set install1  '71000006-0000-4000-8000-000000000006'
\set orgC      '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgN      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set reviewer  '11111111-1111-4111-8111-111111111111'

-- ===========================================================================
-- Fixtures: one pending case-B referral with a name close to an existing
-- showroom_dealer (dedup hint should fire), one case-A referral (must NEVER
-- appear in this queue), and a platform moderator role for the reviewer.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- Same showroom_dealer organization name, different case — exercises the
-- case-insensitive exact-match branch of the dedup hint deterministically
-- (trigram similarity against a shorter/longer variant is not reliably
-- above the 0.4 threshold, so this fixture avoids depending on that number).
select set_config('test.ref_new',
  (select public.network_referral_create_new(
     'CAIRO CERAMICS SHOWROOM', 'Cairo', 'Nasr City', '01011112222', 'Met the owner at a site visit.'))::text, true);

-- Case A, against a NON-showroom_dealer org (Nile Finishing Supplies is a
-- supplier) — proves this referral never appears in the queue regardless of
-- classification, and is never mistaken for a dedup candidate either.
select set_config('test.ref_existing',
  (select public.network_referral_create_existing(:'orgN'::uuid, null))::text, true);

reset role;
select lives_ok(
  $$insert into public.platform_role_grants (user_id, role, granted_by)
    values ('11111111-1111-4111-8111-111111111111'::uuid, 'moderator', '11111111-1111-4111-8111-111111111111'::uuid)$$,
  'a platform moderator role is granted INSIDE THIS TRANSACTION ONLY');

-- ===========================================================================
-- A. Authorization
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  $$select * from public.admin_network_referrals_list(true)$$,
  '42501', null, 'an ordinary installer cannot list the admin review queue');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.admin_network_referrals_list(true)$$,
  '42501', null, 'anon cannot list it either');

-- ===========================================================================
-- B. The reviewer's view
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.admin_network_referrals_list(true)),
  1, 'exactly one row is pending review — the case-A referral resolved immediately and is never listed');

select is(
  (select display_name from public.admin_network_referrals_list(true) where id = current_setting('test.ref_new')::uuid),
  'CAIRO CERAMICS SHOWROOM', 'the candidate name is exactly what was typed');

select is(
  (select status::text from public.admin_network_referrals_list(true) where id = current_setting('test.ref_new')::uuid),
  'pending', 'and it is pending');

select is(
  (select phone from public.admin_network_referrals_list(true) where id = current_setting('test.ref_new')::uuid),
  '01011112222', 'the referrer''s own typed phone reaches the reviewer');

select is(
  (select referred_by from public.admin_network_referrals_list(true) where id = current_setting('test.ref_new')::uuid),
  :'install1'::uuid, 'attributed to the real referrer');

select isnt(
  (select referrer_name from public.admin_network_referrals_list(true) where id = current_setting('test.ref_new')::uuid),
  '', 'the referrer''s display name is resolved, not blank');

select is(
  (select match_id from public.admin_network_referrals_list(true) where id = current_setting('test.ref_new')::uuid),
  :'orgC'::uuid, 'the de-duplication hint finds the similarly-named existing showroom_dealer');

select is(
  (select match_count from public.admin_network_referrals_list(true) where id = current_setting('test.ref_new')::uuid)::int,
  1, 'exactly one candidate match');

select ok(
  (select true from public.admin_network_referrals_list(true) where id = current_setting('test.ref_existing')::uuid) is null,
  'the known-organization (case A) referral never appears — it has nothing to review');

-- ===========================================================================
-- C. pending_only = false still excludes case A, and decision still works
-- ===========================================================================
select lives_ok(
  $$select public.network_referral_reject(current_setting('test.ref_new')::uuid, 'Could not confirm this is a distinct branch.')$$,
  'the reviewer rejects the pending candidate using the EXISTING, unchanged reject RPC');

select is(
  (select count(*)::int from public.admin_network_referrals_list(true)),
  0, 'the queue is now empty — the decided referral no longer shows as pending');

select is(
  (select status::text from public.admin_network_referrals_list(false) where id = current_setting('test.ref_new')::uuid),
  'cancelled', 'with pending_only = false the decided referral is still visible, carrying its final status');

select ok(
  (select true from public.admin_network_referrals_list(false) where id = current_setting('test.ref_existing')::uuid) is null,
  'even with pending_only = false, the case-A referral is still never listed — it was never a review candidate');

-- ===========================================================================
-- D. Structural guard — no client DML surface added
-- ===========================================================================
select is(
  (select count(*) from information_schema.role_routine_grants
    where routine_schema = 'public' and routine_name = 'admin_network_referrals_list'
      and grantee = 'authenticated')::int,
  1, 'admin_network_referrals_list is grantable to authenticated (its own internal platform check is the real gate)');

select * from finish();
rollback;

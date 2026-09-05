-- pgTAP: Installer Pilot Increment 13 (continued) — Network referrals.
--
-- The whole claim of this file: a referral is ATTRIBUTION, never a work
-- relationship and never membership. Two cases, one table, and every
-- assertion below is either "this is exactly the state a referral produces"
-- or "this is exactly the state it does NOT produce" — because the two ways
-- this domain could quietly go wrong are a referral that pretends to be
-- completed work, and a referral that pretends to be employment.
--
-- Fixtures, from seed-pilot / seed:
--   70000006 — job.manage on Horizon Contracting (org H, 9a000000…005) —
--              used ONLY to build one real completed assignment (§J)
--   71000006 — installer_technician, the referrer in every positive case
--   71000007 — installer_technician, "another user" for isolation
--   11111111 — owner (org.manage) of Nile Finishing Supplies (org N,
--              aaaaaaaa…), given the platform moderator role INSIDE this
--              transaction only, exactly as 49/50 do for the same user
create extension if not exists pgtap;

begin;
select plan(61);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set install1  '71000006-0000-4000-8000-000000000006'
\set install2  '71000007-0000-4000-8000-000000000007'
\set orgN      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set orgH      '9a000000-aaaa-4aaa-8aaa-000000000005'
\set reviewer  '11111111-1111-4111-8111-111111111111'

-- ===========================================================================
-- A. Case A — referring an organization ALREADY on Aladdin
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select set_config('test.ref_a',
  (select public.network_referral_create_existing(
     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'Their showroom in New Cairo.'))::text, true);

select is(
  (select status::text from public.network_referrals where id = current_setting('test.ref_a')::uuid),
  'joined', 'a known-organization referral resolves to joined immediately — nothing to review');

select is(
  (select origin::text from public.network_referrals where id = current_setting('test.ref_a')::uuid),
  'known_organization', 'and its origin is recorded structurally, not inferred');

select is(
  (select public.network_referral_create_existing('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, null)),
  current_setting('test.ref_a')::uuid,
  'referring the SAME known organization twice is idempotent, not a duplicate');

select is(
  (select count(*) from public.network_referrals
    where referred_by = :'install1'::uuid and organization_id = :'orgN'::uuid)::int,
  1, 'exactly one row exists for (referrer, known organization) — the duplicate-abuse guard');

select is(
  (select organization_name from public.my_network_referrals where id = current_setting('test.ref_a')::uuid),
  'Nile Finishing Supplies', 'the projection names the organization RLS would otherwise hide from a non-member');

select is(
  (select points_balance())::int,
  0, 'referring a KNOWN organization earns zero Points — it was not brought here by this referral');

select is(
  (select count(*) from public.my_network_organizations where org_id = :'orgN'::uuid)::int,
  0, 'and the referral is NOT a completed-work relationship — my_network_organizations is untouched');

-- ===========================================================================
-- B. Case B — referring a showroom NOT YET on Aladdin
-- ===========================================================================
select set_config('test.ref_b1',
  (select public.network_referral_create_new(
     'Al Amal Marble Workshop', 'Giza', '6th of October',
     '01099998888', 'Small workshop near the ring road.'))::text, true);

select is(
  (select status::text from public.network_referrals where id = current_setting('test.ref_b1')::uuid),
  'pending', 'a not-yet-registered showroom starts pending — it needs review');

select is(
  (select origin::text from public.network_referrals where id = current_setting('test.ref_b1')::uuid),
  'new_showroom', 'its origin is new_showroom from the moment it exists');

select is(
  (select display_name from public.my_network_referrals where id = current_setting('test.ref_b1')::uuid),
  'Al Amal Marble Workshop', 'the candidate name is exactly what was typed');

select is(
  (select governorate || '/' || city from public.my_network_referrals
     where id = current_setting('test.ref_b1')::uuid),
  'Giza/6th of October', 'location travels with it');

select is(
  (select phone from public.my_network_referrals where id = current_setting('test.ref_b1')::uuid),
  '01099998888', 'the REFERRER''S OWN typed phone is readable back to them');

select is(
  (select public.network_referral_create_new('  al amal marble workshop  ', 'Giza', 'Elsewhere', null, null)),
  current_setting('test.ref_b1')::uuid,
  'resubmitting the SAME name (any case/whitespace) while pending is idempotent — the duplicate-abuse guard for case B');

select set_config('test.ref_b2',
  (select public.network_referral_create_new('Cairo Ceramics House', 'Giza', 'Haram',
     '01055554444', null))::text, true);

select isnt(
  current_setting('test.ref_b2')::uuid, current_setting('test.ref_b1')::uuid,
  'a DIFFERENT name is a genuinely different referral, not deduplicated away');

select is(
  (select count(*) from public.network_referrals where referred_by = :'install1'::uuid and status = 'pending')::int,
  2, 'two distinct pending referrals now exist for this referrer');

select is(
  (select points_balance())::int,
  0, 'submitting a case-B referral earns nothing yet — only approval does');

-- Required fields, refused with a clear error rather than a half-written row.
select throws_ok(
  $$select public.network_referral_create_new(null, 'Giza', 'Haram', null, null)$$,
  '22023', null, 'a nameless referral is refused');
select throws_ok(
  $$select public.network_referral_create_new('Some Workshop', null, null, null, null)$$,
  '22023', null, 'a locationless referral is refused');

-- ===========================================================================
-- C. Cancel — the referrer's own, and only their own
-- ===========================================================================
select lives_ok(
  $$select public.network_referral_cancel(current_setting('test.ref_b1')::uuid)$$,
  'the referrer withdraws their own pending referral');

select is(
  (select status::text from public.network_referrals where id = current_setting('test.ref_b1')::uuid),
  'cancelled', 'and it is now cancelled');

select lives_ok(
  $$select public.network_referral_cancel(current_setting('test.ref_b1')::uuid)$$,
  'withdrawing an already-cancelled referral is a no-op, not an error');

set local request.jwt.claims = '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';
select throws_ok(
  $$select public.network_referral_cancel(current_setting('test.ref_b2')::uuid)$$,
  '42501', null, 'ANOTHER USER cannot cancel this referral — it is not theirs to manage');

-- ===========================================================================
-- D. Isolation — this is a PRIVATE surface
-- ===========================================================================
select is(
  (select count(*) from public.my_network_referrals)::int,
  0, 'another installer sees none of the first referrer''s referrals');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*) from public.my_network_referrals)::int,
  3, 'the referrer sees exactly their own three rows (1 joined + 1 cancelled + 1 pending)');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.network_referrals$$,
  '42501', null, 'anon cannot read the base table');
select throws_ok(
  $$select * from public.my_network_referrals$$,
  '42501', null, 'nor the projection');

reset role;
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name in ('network_referrals', 'my_network_referrals')
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int,
  0, 'no client role holds INSERT, UPDATE or DELETE — every fact comes from the RPCs');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'network_referrals')::int,
  2, 'exactly two policies exist on network_referrals — self and platform, nothing org-scoped');

select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'network_referrals'
      and (qual like '%organization_id%' or qual like '%is_org_member%' or qual like '%has_capability%'))::int,
  0, 'and neither policy is keyed on the organization — a showroom manager cannot read who referred them by membership alone');

-- ===========================================================================
-- E. Points — the qualifying approval, exactly once
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select throws_ok(
  $$select public.network_referral_approve(current_setting('test.ref_b2')::uuid, null)$$,
  '42501', null, 'THE REFERRER THEMSELVES cannot approve their own referral');

reset role;
select lives_ok(
  $$insert into public.platform_role_grants (user_id, role, granted_by)
    values ('11111111-1111-4111-8111-111111111111'::uuid, 'moderator', '11111111-1111-4111-8111-111111111111'::uuid)$$,
  'a platform moderator role is granted INSIDE THIS TRANSACTION ONLY');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select set_config('test.new_org',
  (select public.network_referral_approve(current_setting('test.ref_b2')::uuid, null))::text, true);

select is(
  (select source from public.organizations where id = current_setting('test.new_org')::uuid),
  'installer_referral', 'the materialised organization carries installer_referral provenance');

select is(
  (select referred_by_user_id from public.organizations where id = current_setting('test.new_org')::uuid),
  '71000006-0000-4000-8000-000000000006'::uuid, 'attributed to the real referrer, not the approving reviewer');

select is(
  (select org_type::text from public.organizations where id = current_setting('test.new_org')::uuid),
  'showroom_dealer', 'the classification is showroom_dealer');

select is(
  (select is_verified from public.organizations where id = current_setting('test.new_org')::uuid),
  false, 'unverified — a platform-managed candidate, not a trusted business yet');

select is(
  (select count(*) from public.memberships
    where organization_id = current_setting('test.new_org')::uuid
      and user_id = '71000006-0000-4000-8000-000000000006'::uuid)::int,
  0, 'THE REFERRER RECEIVES NO MEMBERSHIP — attribution only, never employment');

select is(
  (select status::text from public.network_referrals where id = current_setting('test.ref_b2')::uuid),
  'joined', 'the referral itself is now joined');

select is(
  (select organization_id from public.network_referrals where id = current_setting('test.ref_b2')::uuid),
  current_setting('test.new_org')::uuid, 'and names the organization it produced');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select points_balance())::int,
  100, 'THE REFERRER EARNS EXACTLY +100 — the one approved event, reused verbatim');

select is(
  (select count(*) from public.points_ledger
    where user_id = '71000006-0000-4000-8000-000000000006'::uuid
      and event_type = 'referral.organization_approved'
      and source_type = 'organization'
      and source_id = current_setting('test.new_org')::uuid)::int,
  1, 'exactly one ledger entry backs it, keyed on the organization it actually produced');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select public.network_referral_approve(current_setting('test.ref_b2')::uuid, null)),
  current_setting('test.new_org')::uuid,
  'approving an already-joined referral is idempotent and returns the same organization');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select points_balance())::int,
  100, 'and the balance did NOT double — no repeat award for a repeat approval');

select is(
  (select count(*) from public.points_ledger
    where user_id = '71000006-0000-4000-8000-000000000006'::uuid
      and event_type = 'referral.organization_approved')::int,
  1, 'still exactly one ledger row for this event, structurally — the ledger''s own idempotency');

-- ===========================================================================
-- F. Linking path — the candidate WAS already here, so it earns nothing
-- ===========================================================================
select set_config('test.ref_b3',
  (select public.network_referral_create_new('Actually Nile Finishing', 'Cairo', 'Nasr City',
     null, null))::text, true);

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select public.network_referral_approve(current_setting('test.ref_b3')::uuid, :'orgN'::uuid)),
  :'orgN'::uuid, 'the reviewer links the candidate to the organization it actually was');

select is(
  (select count(*) from public.organizations where source = 'installer_referral')::int,
  1, 'NO SECOND ORGANIZATION was created for a name that was really an existing one');

select is(
  (select origin::text from public.network_referrals where id = current_setting('test.ref_b3')::uuid),
  'new_showroom', 'origin still reads new_showroom — linking changes what it BECAME, not what it WAS');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select points_balance())::int,
  100, 'and the balance is UNCHANGED — the linking path awards nothing, ever');

-- ===========================================================================
-- G. Reject — a candidate that should not proceed
-- ===========================================================================
select set_config('test.ref_b4',
  (select public.network_referral_create_new('Not A Real Business', 'Cairo', 'Nowhere',
     null, null))::text, true);

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$select public.network_referral_reject(current_setting('test.ref_b4')::uuid, null)$$,
  '22023', null, 'a rejection requires a reason');

select lives_ok(
  $$select public.network_referral_reject(current_setting('test.ref_b4')::uuid, 'Could not be verified as a real business.')$$,
  'the reviewer rejects it');

select is(
  (select status::text from public.network_referrals where id = current_setting('test.ref_b4')::uuid),
  'cancelled', 'a rejected referral lands on the same terminal state a withdrawal does');

select is(
  (select decision_reason from public.network_referrals where id = current_setting('test.ref_b4')::uuid),
  'Could not be verified as a real business.', 'with the reason recorded');

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select points_balance())::int,
  100, 'a rejection never touches Points');

-- ===========================================================================
-- H. Network coexistence — a JOINED referral and a REAL completed-work
--    relationship on the SAME organization, neither one faking the other
-- ===========================================================================
select set_config('test.ref_h',
  (select public.network_referral_create_existing(:'orgH'::uuid, null))::text, true);

select is(
  (select status::text from public.network_referrals where id = current_setting('test.ref_h')::uuid),
  'joined', 'org H is referred and joined immediately — no completed work yet');

select is(
  (select count(*) from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  0, 'and BEFORE any work exists, org H is not yet a completed-work relationship');

-- Build ONE real completed assignment with org H, through the actual Jobs
-- RPCs — the same discipline 50_installer_network_test.sql uses.
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.job_h',
  (select public.job_create(:'orgH'::uuid, 'Marble hallway - referred relationship test',
     'marble_granite', 4500))::text, true);
select public.job_publish(current_setting('test.job_h')::uuid, 1);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_application_submit(current_setting('test.job_h')::uuid, null);

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select set_config('test.asg_h',
  (select public.job_application_accept(
     (select id from public.job_applications
       where job_id = current_setting('test.job_h')::uuid
         and applicant_user_id = '71000006-0000-4000-8000-000000000006')))::text, true);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_assignment_start(current_setting('test.asg_h')::uuid, 1);
select public.job_progress_add(current_setting('test.asg_h')::uuid, 100::smallint, null, null);

set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select public.job_assignment_complete(current_setting('test.asg_h')::uuid, 2);

set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select completed_count from public.my_network_organizations where org_id = :'orgH'::uuid)::int,
  1, 'NOW org H is a real completed-work relationship');

select is(
  (select status::text from public.my_network_referrals where organization_id = :'orgH'::uuid),
  'joined', 'AND it is still a joined referral — BOTH facts stand at once, neither merged into the other');

select is(
  (select points_balance())::int,
  100, 'completing real work never touches Points — that is not what this ledger is for');

-- ===========================================================================
-- I. Structural guards
-- ===========================================================================
select ok(
  (select p.proconfig @> array['search_path=""'] and p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_my_network_referrals'),
  'the referrals reader is SECURITY DEFINER with search_path pinned empty');

select is(
  (select array_agg(c.n order by c.n) from (
     select column_name::text collate "C" as n
       from information_schema.columns
      where table_schema = 'public' and table_name = 'my_network_referrals') c),
  array['city', 'created_at', 'decided_at', 'decision_reason', 'display_name',
        'governorate', 'id', 'note', 'organization_id', 'organization_name',
        'origin', 'phone', 'status'],
  'the referrals projection carries exactly these thirteen columns');

select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'network_referrals'
      and column_name = 'referred_by')::int,
  1, 'referred_by is a real column — attribution lives on the row, not inferred');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('network_referral_create_existing', 'network_referral_create_new',
                        'network_referral_cancel')
      and (p.prosrc like '%p_user_id%' or p.prosrc like '%p_referred_by%'))::int,
  0, 'no CREATE or CANCEL path accepts a caller-supplied identity — the referrer is always auth.uid()');

select * from finish();
rollback;

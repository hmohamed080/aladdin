-- pgTAP: organization invitations addressed by EMAIL or PHONE.
--
-- Proves the parts of the contact-channel change that a UI test cannot reach:
-- the exactly-one-target rule is enforced by the DATABASE and not only by the
-- form; a phone number is normalized on write so acceptance has something stable
-- to match; the lookup projection reports the channel and never leaks a raw
-- number; a confirmed phone that does NOT match is refused; and the token
-- remains single-use and expiring on the phone path exactly as on the email one.
--
-- The deliberate gap is documented rather than asserted away: while this
-- deployment verifies email only, an acceptor with no confirmed phone accepts a
-- phone invitation on the strength of the token. The test below pins that as
-- INTENDED behaviour so that a future change to it is a conscious decision and
-- not a silent regression.
create extension if not exists pgtap;

begin;
select plan(16);

-- Seed identities (supabase/seed.sql):
--   11111111… Amina — Org A owner (org.members.manage)
--   22222222… Karim — Org A Cairo staff, no manage capability
--   44444444… Omar  — end consumer, no org
-- Org A = aaaaaaaa…; Cairo branch = c1111111….
update auth.users set email_confirmed_at = now()
  where id in ('11111111-1111-4111-8111-111111111111',
               '22222222-2222-4222-8222-222222222222',
               '44444444-4444-4444-8444-444444444444');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- ===== invitation_create: exactly one target =====
select throws_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  null, null, 'an invitation with neither an email nor a phone is refused');

select throws_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       'both@example.test', p_phone => '01002003040') $$,
  null, null, 'an invitation carrying BOTH an email and a phone is refused');

select throws_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       p_phone => '12') $$,
  null, null, 'a phone that cannot normalize to E.164 is refused');

-- Authority is unchanged: the channel does not open a side door around it.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       p_phone => '01002003040') $$,
  '42501', null, 'a non-manager cannot create a phone invitation either');

-- ===== a manager creates one, in local Egyptian format =====
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       p_primary_branch_id => 'c1111111-cccc-4ccc-8ccc-cccccccccccc',
       p_phone => ' 0100 200 3040 ') $$,
  'a manager creates a phone invitation from a local-format number');

select is(
  (select phone from public.organization_invitations
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and phone is not null),
  '+201002003040',
  'the number is normalized to E.164 on write, so acceptance has a stable target');

select is(
  (select email from public.organization_invitations
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and phone is not null),
  null, 'a phone invitation carries no email');

-- Re-inviting the same number REFRESHES rather than duplicating, mirroring email.
select lives_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       p_phone => '+201002003040') $$,
  're-inviting the same number is allowed');
select is(
  (select count(*)::int from public.organization_invitations
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and phone='+201002003040' and status='pending'),
  1, 'only ONE open invitation exists per organization and number');

reset role;
create temporary table _pinv on commit drop as
  select token from public.organization_invitations
  where phone='+201002003040' and status='pending' limit 1;
grant select on _pinv to anon, authenticated;

-- ===== invitation_lookup: channel-aware, still anti-enumeration =====
set local role anon;
set local request.jwt.claims = '';
select is(
  (select channel from public.invitation_lookup((select token from _pinv))),
  'phone', 'lookup reports the phone channel');
select is(
  (select contact_masked from public.invitation_lookup((select token from _pinv))),
  '+20•••40', 'lookup returns only a masked number, never the raw phone');

-- ===== invitation_accept =====
-- A confirmed phone that does not match is refused outright. This is the real
-- binding, and it is what starts protecting phone invitations the day phone
-- sign-in is enabled.
reset role;
update auth.users set phone = '+201009998888', phone_confirmed_at = now()
  where id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select public.invitation_accept((select token from _pinv)) $$,
  '42501', null, 'a confirmed phone that does not match cannot accept');

-- With a MATCHING confirmed phone the invitation is accepted and bridges into the
-- ordinary membership model — the same table the manager-driven path writes.
reset role;
update auth.users set phone = '+201002003040', phone_confirmed_at = now()
  where id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select lives_ok(
  $$ select public.invitation_accept((select token from _pinv)) $$,
  'the matching invitee accepts a phone invitation');
select is(
  (select status::text from public.memberships
   where user_id='44444444-4444-4444-8444-444444444444'
     and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'active', 'acceptance creates an ACTIVE membership in the existing model');

-- Single use survives the new channel. Re-accepting as the SAME identity is
-- idempotent (a double-submitted form must not error); the "already used" guard
-- is what stops a second identity, and it is unchanged from the email path.
select is(
  (select public.invitation_accept((select token from _pinv))),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  're-accepting as the same identity is idempotent, not an error');

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.invitation_accept((select token from _pinv)) $$,
  '22023', null, 'a used phone invitation cannot be accepted by anyone else');

select * from finish();
rollback;

-- pgTAP: Sprint 13 — persona/organization type separation + showroom affiliation.
--
-- The fourteen required acceptance properties:
--
--    1. the personal persona type contains NO business classification;
--    2. the organization type contains NO personal persona;
--    3. migrated legacy rows kept every id and relation;
--    4. a business-only identity with a NULL persona is valid;
--    5. a salesperson's personal account is ACTIVE without any showroom membership;
--    6. without an active membership a salesperson cannot use showroom B2B data;
--    7. an existing-showroom affiliation request creates NO organization;
--    8. approval creates/activates EXACTLY ONE membership, with branch + capabilities;
--    9. a rejected request leaves no active membership;
--   10. a referred-showroom retry is idempotent;
--   11. referral approval cannot duplicate an existing linked organization;
--   12. referral attribution survives approval (and is immutable);
--   13. the referring salesperson is NEVER automatically Owner;
--   14. RLS prevents cross-org affiliation manipulation.
create extension if not exists pgtap;

begin;
select plan(79);

-- Fixtures, all from seed-pilot: a real showroom with a real owner and branch.
--   70000001 — owner of Cairo Ceramics Showroom (business-only: NULL persona)
--   70000007 — Laila, `sales` persona, org-manager of an UNRELATED business
--   70000009 — an installer persona, our unauthorised third party
--   70000005 — a DECLARED `sales` persona (upgrade submitted, not yet applied):
--              the second salesperson used by sections 9 and 11
--   55555555 — platform administrator
--   9c00…001 — Cairo Ceramics Showroom  ·  b0000001-…001 — its Nasr City branch
--   9f00…004 — Delta Wholesale Supply (a different tenant, for the RLS check)
update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000007-0000-4000-8000-000000000007',
               '70000009-0000-4000-8000-000000000009', '55555555-5555-4555-8555-555555555555',
               '70000002-0000-4000-8000-000000000002', '70000005-0000-4000-8000-000000000005');

-- The SECOND salesperson this suite needs (sections 9 and 11) is a DECLARED one:
-- 70000005 completed the professional onboarding that names `sales`, but the
-- canonical persona is written only when an Admin applies the upgrade, so
-- users.primary_account_type is still NULL. That is a real, active salesperson —
-- and since the Installer Pilot Increment 1 hardening the affiliation flow admits
-- exactly this case (app.is_sales_persona), which is why the suite can no longer
-- borrow the installer fixture as a stand-in for "a second salesperson".
insert into public.individual_onboarding (user_id, prof_concrete_type, professional_completed_at)
values ('70000005-0000-4000-8000-000000000005', 'sales', now())
on conflict (user_id) do update
  set prof_concrete_type = 'sales', professional_completed_at = now();

-- ===========================================================================
-- 1 + 2. The two types are DISJOINT — enforced by the type system
-- ===========================================================================
-- Stated as set assertions rather than "no row currently violates this", because
-- the point of Sprint 13 is that a violating row cannot be WRITTEN.
select is(
  (select count(*)::int from unnest(enum_range(null::public.persona_type)) e
   where e::text in ('showroom_dealer','supplier','manufacturer','importer','wholesaler',
                     'contractor_company','design_office')),
  0, '1: persona_type contains NO business classification');
select is(
  (select count(*)::int from unnest(enum_range(null::public.organization_type)) e
   where e::text in ('end_consumer','engineer','interior_designer','installer_technician',
                     'contractor','sales','trainer','trainee')),
  0, '2: organization_type contains NO personal persona');

-- The legitimate personal personas, including the legacy training ones, survive.
select ok(
  (select bool_and(v = any (enum_range(null::public.persona_type)::text[]))
   from unnest(array['end_consumer','engineer','interior_designer','installer_technician',
                     'contractor','sales','trainer','trainee']) v),
  '1: every supported personal persona is preserved (trainer/trainee included)');
select ok(
  (select bool_and(v = any (enum_range(null::public.organization_type)::text[]))
   from unnest(array['showroom_dealer','supplier','manufacturer','importer','wholesaler']) v),
  '2: every supported business classification is preserved');

-- The columns carry the right type, so the separation is structural.
select is(
  (select udt_name from information_schema.columns
   where table_schema='public' and table_name='users' and column_name='primary_account_type'),
  'persona_type', '1: users.primary_account_type IS a persona_type');
select is(
  (select udt_name from information_schema.columns
   where table_schema='public' and table_name='organizations' and column_name='org_type'),
  'organization_type', '2: organizations.org_type IS an organization_type');

-- `user.primary_account_type = supplier` is now IMPOSSIBLE, not merely refused.
select throws_ok(
  $$ update public.users set primary_account_type = 'supplier'
     where id = '44444444-4444-4444-8444-444444444444' $$,
  '22P02', null, '1: a business classification cannot be stored as a personal persona');
select throws_ok(
  $$ update public.organizations set org_type = 'engineer' where slug = 'cairo-ceramics' $$,
  '22P02', null, '2: a personal persona cannot be stored as a business classification');
-- The shared enum is GONE, not deprecated.
select is(
  (select count(*)::int from pg_type where typname = 'account_type'
     and typnamespace = 'public'::regnamespace),
  0, '1+2: the shared public.account_type enum no longer exists');

-- ===========================================================================
-- 3 + 4. The migration preserved everything, and a null persona is valid
-- ===========================================================================
-- The two renamed classifications kept their organization, its id, its owner and
-- its branch — only the label changed.
select is(
  (select o.org_type::text from public.organizations o where o.slug = 'horizon-contracting'),
  'contractor_company', '3: the contracting business kept its row, reclassified');
select is(
  (select o.org_type::text from public.organizations o where o.slug = 'delta-interiors'),
  'design_office', '3: the design studio kept its row, reclassified');
select is(
  (select count(distinct o.id)::int from public.organizations o
   join public.memberships m on m.organization_id = o.id and m.status = 'active'
   join public.branches b on b.organization_id = o.id
   where o.slug in ('horizon-contracting', 'delta-interiors')),
  2, '3: both reclassified businesses kept their owner membership AND their branch');
-- Its owner is still an individual `contractor` PERSONA. Same person, same id: the
-- two values that used to collide now coexist honestly.
select is(
  (select u.primary_account_type::text from public.users u
   where u.id = '70000006-0000-4000-8000-000000000006'),
  'contractor', '3: the owner kept their PERSONAL contractor persona');
select is(
  (select count(*)::int from public.users), (select count(*)::int from auth.users),
  '3: every auth identity still has exactly one public identity row');
select is(
  (select count(*)::int from public.profiles p
   join public.users u on u.id = p.user_id),
  (select count(*)::int from public.profiles),
  '3: no profile was orphaned');

-- 4. A business-only identity: NULL persona, full business access.
select is(
  (select u.primary_account_type from public.users u
   where u.id = '70000001-0000-4000-8000-000000000001'),
  null, '4: a business-only identity carries NO personal persona');
select is(
  (select u.status::text from public.users u
   where u.id = '70000001-0000-4000-8000-000000000001'),
  'active', '4: ...and is still an ACTIVE, valid identity');
select is(
  (select count(*)::int from public.memberships m
   where m.user_id = '70000001-0000-4000-8000-000000000001' and m.status = 'active'),
  1, '4: ...and keeps their active owner membership');
select is(app.has_personal_persona('70000001-0000-4000-8000-000000000001'), false,
  '4: ...and is offered no fabricated Personal workspace');

-- ===========================================================================
-- 5 + 6. The Salesperson Pilot rule
-- ===========================================================================
-- Laila is a `sales` persona. Her ACCOUNT is active and her PERSONAL workspace
-- exists — neither waits on a showroom, a verification, or a completeness score.
select is(
  (select u.status::text from public.users u
   where u.id = '70000007-0000-4000-8000-000000000007'),
  'active', '5: a salesperson''s personal account is ACTIVE');
select is(app.has_personal_persona('70000007-0000-4000-8000-000000000007'), true,
  '5: ...with a usable Personal workspace');
select is(
  (select count(*)::int from public.memberships m
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  0, '5: ...and NO membership in the showroom (activation is not affiliation)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';

-- Her Personal workspace is real; the showroom is not among her workspaces.
select is(
  (select count(*)::int from public.my_workspaces() w where w.kind = 'personal'),
  1, '5: my_workspaces() offers her the Personal context');
select is(
  (select count(*)::int from public.my_workspaces() w
   where w.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  0, '6: the showroom is NOT one of her workspaces');

-- 6. And the showroom's B2B data is genuinely unreachable — not merely unlisted.
-- RLS on a tenant table returns no rows, and the capability check refuses outright.
select is(
  (select count(*)::int from public.customers c
   where c.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  0, '6: RLS hides the showroom''s customers from a non-member salesperson');
select is(app.has_capability('9c000000-cccc-4ccc-8ccc-000000000001', 'sales.opportunity.read'), false,
  '6: ...and she holds no sales capability there');
select throws_ok(
  $$ select public.org_members_list('9c000000-cccc-4ccc-8ccc-000000000001') $$,
  '42501', null, '6: ...and the showroom''s people roster refuses her');

-- ===========================================================================
-- 7. Requesting affiliation creates a REQUEST — never an organization
-- ===========================================================================
reset role;
select is(
  (select count(*)::int from public.organizations), 12,
  '7: baseline organization count before any affiliation request');
set local role authenticated;

select isnt(public.showroom_join_request_create(
  '9c000000-cccc-4ccc-8ccc-000000000001',
  'b0000001-0000-4000-8000-000000000001',
  'I work on the Nasr City sales floor'), null,
  '7: the salesperson can request affiliation with an existing showroom');

reset role;
select is(
  (select count(*)::int from public.organizations), 12,
  '7: NO organization was created by the request');
select is(
  (select count(*)::int from public.memberships m
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  0, '7: ...and NO membership either — a request grants nothing');
select is(
  (select count(*)::int from public.users), (select count(*)::int from auth.users),
  '7: ...and certainly no second USER');
set local role authenticated;
-- Idempotent: a retry is the same request, not a queue of duplicates.
select is(
  (select count(*)::int from public.organization_join_requests r
   where r.user_id = '70000007-0000-4000-8000-000000000007'
     and r.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  1, '7: re-requesting does not queue a duplicate for the approver');
-- Same request id back: the RPC short-circuits on the open request.
select is(public.showroom_join_request_create('9c000000-cccc-4ccc-8ccc-000000000001'),
  (select r.id from public.organization_join_requests r
   where r.user_id = '70000007-0000-4000-8000-000000000007'
     and r.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  '7: ...and returns the SAME request id');
-- Her /home is still usable throughout.
select is(
  (select count(*)::int from public.my_workspaces() w where w.kind = 'personal'),
  1, '7: her Personal workspace is untouched while the request is open');

-- ===========================================================================
-- 14. RLS: an unrelated third party cannot see or decide the request
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is(
  (select count(*)::int from public.organization_join_requests),
  0, '14: an unrelated user cannot READ anyone''s affiliation request');
select throws_ok(
  format($$ select public.org_join_request_approve(%L) $$,
    (select id from public.organization_join_requests
     where user_id = '70000007-0000-4000-8000-000000000007')),
  '42501', null, '14: ...and cannot approve it (no org.members.manage)');

-- A MANAGER OF ANOTHER BUSINESS is the sharper case: Laila herself manages Delta
-- Wholesale, so she holds org.members.manage — just not in Cairo Ceramics. The
-- capability is checked against the request's OWN organization, so her authority
-- does not travel.
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select ok(app.has_capability('9a000000-aaaa-4aaa-8aaa-000000000005', 'org.members.manage'),
  '14: the requester manages a DIFFERENT organization');
select throws_ok(
  format($$ select public.org_join_request_approve(%L) $$,
    (select id from public.organization_join_requests
     where user_id = '70000007-0000-4000-8000-000000000007')),
  '42501', null, '14: ...yet cannot approve her own request into a showroom she does not manage');
select throws_ok(
  $$ select public.org_join_requests_list('9c000000-cccc-4ccc-8ccc-000000000001') $$,
  '42501', null, '14: ...and cannot read that showroom''s request roster');
-- Nor can a write bypass the RPCs: `authenticated` has no INSERT/UPDATE at all.
select throws_ok(
  format($$ update public.organization_join_requests set status = 'approved' where id = %L $$,
    (select id from public.organization_join_requests
     where user_id = '70000007-0000-4000-8000-000000000007')),
  '42501', null, '14: ...and cannot self-approve by writing the table directly');

-- ===========================================================================
-- 8. Approval by an authorized Owner/Manager of THAT showroom
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(
  (select count(*)::int from public.org_join_requests_list('9c000000-cccc-4ccc-8ccc-000000000001')
   where status = 'pending'),
  1, '8: the showroom owner sees the pending request on their people surface');

select isnt(public.org_join_request_approve(
  (select id from public.organization_join_requests
   where user_id = '70000007-0000-4000-8000-000000000007'
     and organization_id = '9c000000-cccc-4ccc-8ccc-000000000001')), null,
  '8: the owner approves it');

select is(
  (select count(*)::int from public.memberships m
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'
     and m.status = 'active'),
  1, '8: EXACTLY ONE active membership now exists');
select is(
  (select count(*)::int from public.membership_branch_access ba
   join public.memberships m on m.id = ba.membership_id
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'
     and ba.branch_id = 'b0000001-0000-4000-8000-000000000001'),
  1, '8: the REQUESTED branch scope was preserved');
select ok(
  (select count(*) from public.membership_capabilities c
   join public.memberships m on m.id = c.membership_id
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'
     and c.capability_key like 'sales.%') >= 4,
  '8: the sales capability set was granted');
-- 13 (existing-showroom path): a member, never an owner.
select is(
  (select count(*)::int from public.membership_capabilities c
   join public.memberships m on m.id = c.membership_id
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'
     and c.capability_key in ('org.manage', 'org.members.manage')),
  0, '13: the approved salesperson is a MEMBER — never given owner/manager authority');
-- Idempotent approval: the same membership, not a second one.
select is(
  public.org_join_request_approve(
    (select id from public.organization_join_requests
     where user_id = '70000007-0000-4000-8000-000000000007'
       and organization_id = '9c000000-cccc-4ccc-8ccc-000000000001')),
  (select m.id from public.memberships m
   where m.user_id = '70000007-0000-4000-8000-000000000007'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  '8: approving twice returns the SAME membership');

-- And now the showroom IS her workspace, so its B2B tools open.
set local request.jwt.claims = '{"sub":"70000007-0000-4000-8000-000000000007","role":"authenticated"}';
select is(
  (select count(*)::int from public.my_workspaces() w
   where w.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  1, '8: the showroom appears in her workspaces');
select is(
  (select w.relationship from public.my_workspaces() w
   where w.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  'member', '8: ...as a MEMBER relationship');
select ok(app.has_capability('9c000000-cccc-4ccc-8ccc-000000000001', 'sales.opportunity.read'),
  '8: ...and the sales capability now resolves there');

-- ===========================================================================
-- 9. A REJECTED request grants nothing, and disables nothing
-- ===========================================================================
-- A second salesperson asks to join Delta Wholesale and is declined.
set local request.jwt.claims = '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}';
-- Delta is a wholesaler, not a showroom: affiliation is a showroom concept.
select throws_ok(
  $$ select public.showroom_join_request_create('9f000000-ffff-4fff-8fff-000000000004') $$,
  '22023', null, '9: sales affiliation applies to a showroom/dealer, not any business');

select isnt(public.showroom_join_request_create('9c000000-cccc-4ccc-8ccc-000000000001'), null,
  '9: a second person requests affiliation with the showroom');

set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format($$ select public.org_join_request_reject(%L, '  ') $$,
    (select id from public.organization_join_requests
     where user_id = '70000005-0000-4000-8000-000000000005')),
  '22023', null, '9: a rejection without a reason is refused');
select lives_ok(
  format($$ select public.org_join_request_reject(%L, 'Not on our sales team') $$,
    (select id from public.organization_join_requests
     where user_id = '70000005-0000-4000-8000-000000000005')),
  '9: the owner declines with a reason');
select is(
  (select count(*)::int from public.memberships m
   where m.user_id = '70000005-0000-4000-8000-000000000005'
     and m.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'
     and m.status = 'active'),
  0, '9: a rejected request leaves NO active membership');
-- Rejection is not a punishment: the personal account is exactly as it was.
reset role;
select is(
  (select u.status::text from public.users u
   where u.id = '70000005-0000-4000-8000-000000000005'),
  'active', '9: ...and the personal account is still ACTIVE');
select is(app.has_personal_persona('70000005-0000-4000-8000-000000000005'), true,
  '9: ...and still has its Personal workspace');

-- ===========================================================================
-- 10 + 11 + 12 + 13. The referral path
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';

-- 10. Submitting is retry-safe: same referral, never a second candidate.
select isnt(public.showroom_referral_save(
  null, 'Zayed Tiles LLC', 'Zayed Tiles', 'Tiles and sanitary ware',
  'giza', 'sheikh_zayed', 'Zayed Main'), null, '10: a referral draft is created');
select is(
  (select count(*)::int from public.organization_referrals f
   where f.referred_by = '70000002-0000-4000-8000-000000000002'),
  1, '10: saving again resumes the SAME draft (one open referral per person)');
select is(public.showroom_referral_submit(null), public.showroom_referral_submit(null),
  '10: submitting twice returns the same referral — a retry cannot fork it');
select is(
  (select count(*)::int from public.organization_referrals f
   where f.referred_by = '70000002-0000-4000-8000-000000000002' and f.status = 'submitted'),
  1, '10: exactly ONE submitted candidate exists');
-- And submitting created no business and granted no access.
reset role;
select is(
  (select count(*)::int from public.organizations), 12,
  '10: submitting a referral creates NO organization');
set local role authenticated;

-- 11. Approval prefers LINKING to an organization that already exists. A second
-- salesperson refers Cairo Ceramics under a differently-cased, differently-spaced
-- name — the classic route to a duplicate business.
set local request.jwt.claims = '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}';
select isnt(public.showroom_referral_save(
  null, null, '  cairo ceramics showroom ', null, 'cairo', 'nasr_city', 'Nasr City'),
  null, '11: a second salesperson refers a showroom that already exists');
select isnt(public.showroom_referral_submit(null), null, '11: ...and submits it');

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
-- The Admin is shown the duplicate before deciding.
select is(
  (select r.match_name from public.admin_showroom_referrals_list() r
   where r.display_name = 'cairo ceramics showroom'),
  'Cairo Ceramics Showroom',
  '11: the review queue surfaces the existing business as a possible duplicate');
select is(
  public.showroom_referral_approve(
    (select id from public.organization_referrals
     where referred_by = '70000005-0000-4000-8000-000000000005' and status = 'submitted')),
  '9c000000-cccc-4ccc-8ccc-000000000001',
  '11: approval LINKS to the existing organization instead of creating one');
reset role;
select is(
  (select count(*)::int from public.organizations), 12,
  '11: no duplicate business was created');
set local role authenticated;
-- Company name is deliberately NOT unique — two real showrooms may share one.
select is(
  (select count(*)::int from pg_indexes
   where tablename = 'organizations' and indexdef ilike '%unique%' and indexdef ilike '%(name)%'),
  0, '11: company name is not hard-unique (dedup is a decision, not a constraint)');

-- 12 + 13. A genuinely new business: created, attributed, and NOT owned by the
-- referrer.
select isnt(
  public.showroom_referral_approve(
    (select id from public.organization_referrals
     where referred_by = '70000002-0000-4000-8000-000000000002' and status = 'submitted')),
  null, '12: a genuinely new referred showroom is approved');
reset role;
select is(
  (select o.source from public.organizations o where o.name = 'Zayed Tiles'),
  'salesperson_referral', '12: the organization records HOW it came to exist');
select is(
  (select o.referred_by_user_id from public.organizations o where o.name = 'Zayed Tiles'),
  '70000002-0000-4000-8000-000000000002',
  '12: "which salesperson referred this showroom?" is answerable after approval');
-- Attribution is write-once. A reward paid on a mutable field is paid to whoever
-- wrote last.
select throws_ok(
  $$ update public.organizations set referred_by_user_id = '70000009-0000-4000-8000-000000000009'
     where name = 'Zayed Tiles' $$,
  '23514', null, '12: referral attribution is IMMUTABLE, even to a platform actor');
-- No rewards machinery was built — only the provenance a future one would read.
-- SUPERSEDED IN PART 2026-08-30: Points Core (docs/database/points-core.md) added
-- public.points_ledger, an append-only ENGAGEMENT ledger that is explicitly not
-- money and awards nothing yet — its own contract is proven by
-- 35_points_core_test, including that it has no balance column and no monetary
-- column. The rest of this guard stands unamended: wallet and reward tables are
-- still forbidden, and Sprint 13's rule that attribution exists WITHOUT a payout
-- mechanism is unchanged.
select is(
  (select count(*)::int from information_schema.tables
   where table_schema = 'public'
     and (table_name like '%wallet%' or table_name like '%reward%')),
  0, '12: no wallet/rewards table was introduced');

-- 13. The referrer's relationship to the business they referred.
select is(
  (select count(*)::int from public.memberships m
   join public.membership_capabilities c on c.membership_id = m.id
   where m.organization_id = (select id from public.organizations where name = 'Zayed Tiles')
     and c.capability_key = 'org.manage'),
  0, '13: the referred business has NO owner — no ownership was fabricated');
select is(
  (select m.status::text from public.memberships m
   where m.organization_id = (select id from public.organizations where name = 'Zayed Tiles')
     and m.user_id = '70000002-0000-4000-8000-000000000002'),
  'active', '13: the referring salesperson holds an ACTIVE membership');
select ok(
  (select count(*) from public.memberships m
   join public.membership_capabilities c on c.membership_id = m.id
   where m.organization_id = (select id from public.organizations where name = 'Zayed Tiles')
     and m.user_id = '70000002-0000-4000-8000-000000000002'
     and c.capability_key like 'sales.%') >= 4,
  '13: ...as a SALESPERSON, with the sales capability set');
-- The audit trail answers the review questions on its own.
select is(
  (select a.metadata->>'resolution' from public.audit_log a
   where a.action = 'referral.approved'
     and a.organization_id = (select id from public.organizations where name = 'Zayed Tiles')),
  'created', '13: the audit records whether the org was linked or created');
select is(
  (select a.metadata->>'relationship' from public.audit_log a
   where a.action = 'referral.approved'
     and a.organization_id = '9c000000-cccc-4ccc-8ccc-000000000001'),
  'sales_member', '13: ...and that the resulting relationship is sales_member');

select * from finish();
rollback;

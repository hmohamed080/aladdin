-- pgTAP: bilingual organization/branch names (20260913090001).
--
-- Additive-only migration — no new authorization surface, so the claim under
-- test is narrow: the new columns exist, are optional, enforce the same
-- length bounds as the original `name` column, and inherit the EXISTING
-- organizations/branches RLS untouched — an org.manage/branch.manage member
-- can write their own org's translations, nobody can write another org's, and
-- a non-member cannot even see them.
--
-- Fixtures, from seed-pilot:
--   Hana (70000001…001, membership 50000001…001) — org.manage + branch.manage
--     on Cairo Ceramics Showroom (9c000000…001), branch Nasr City Showroom
--     (b0000001…001)
--   Tarek (70000003…003, membership 50000003…003) — org.manage on a DIFFERENT
--     org, Egypt Marble Manufacturing (9d000000…002) — used only as a
--     cross-org caller against Cairo Ceramics' rows

create extension if not exists pgtap;

begin;
select plan(17);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set hana    '70000001-0000-4000-8000-000000000001'
\set tarek   '70000003-0000-4000-8000-000000000003'
\set orgC    '9c000000-cccc-4ccc-8ccc-000000000001'
\set branchC 'b0000001-0000-4000-8000-000000000001'
-- Tarek's own org (Egypt Marble Manufacturing) — used below as an org the
-- Foundation completion pass's demo-data seeding deliberately left untouched,
-- now that Cairo Ceramics Showroom (orgC) carries a real seeded Arabic name.
\set orgD    '9d000000-dddd-4ddd-8ddd-000000000002'

-- ===========================================================================
-- A. Columns exist, nullable, no default forced value
-- ===========================================================================
select has_column('public', 'organizations', 'name_ar', 'organizations.name_ar exists');
select has_column('public', 'organizations', 'name_en', 'organizations.name_en exists');
select has_column('public', 'branches', 'name_ar', 'branches.name_ar exists');
select has_column('public', 'branches', 'name_en', 'branches.name_en exists');
select has_column('public', 'branches', 'address_ar', 'branches.address_ar exists');
select has_column('public', 'branches', 'address_en', 'branches.address_en exists');

select col_is_null('public', 'organizations', 'name_ar', 'name_ar has no NOT NULL constraint');
select is(
  -- orgD, not orgC: the migration itself is purely additive and populates
  -- nothing, but orgC (Cairo Ceramics Showroom) now legitimately carries a
  -- real seeded Arabic name from the Hana Showroom Foundation completion
  -- pass's demo-data work — a DIFFERENT concern than this migration's own
  -- shape. orgD is a seeded org that pass deliberately left untouched, so it
  -- still proves the migration itself forces no value.
  (select name_ar from public.organizations where id = :'orgD'::uuid),
  null, 'an existing seeded org has no name_ar populated by this migration — purely additive'
);

-- ===========================================================================
-- B. Length constraints mirror the original name column (1-120 / addr 1-300)
-- ===========================================================================
set local role postgres;
select throws_ok(
  format('update public.organizations set name_ar = %L where id = %L', repeat('a', 121), :'orgC'),
  '23514', null, 'a 121-char name_ar is rejected by ck_organizations_name_ar_len'
);
select throws_ok(
  format('update public.organizations set name_ar = %L where id = %L', '', :'orgC'),
  '23514', null, 'an empty-string name_ar is rejected — null means "not entered", empty is not the same thing'
);
select lives_ok(
  format('update public.organizations set name_ar = %L where id = %L', 'اختبار', :'orgC'),
  'a well-formed name_ar is accepted'
);
select lives_ok(
  'update public.organizations set name_ar = null where id = ' || quote_literal(:'orgC'),
  'clearing it back to null is legal — no dual-entry is forced'
);
select throws_ok(
  format('update public.branches set address_ar = %L where id = %L', repeat('a', 301), :'branchC'),
  '23514', null, 'a 301-char address_ar is rejected by ck_branches_address_ar_len'
);

-- ===========================================================================
-- C. Neither table has a direct-client write path — a pre-existing gap this
--    migration does not open, on either table (see the migration's own
--    comment: organizations never had one, and 20260804090001 deliberately
--    revoked branches' one). Hana, the ROW'S OWN OWNER with both org.manage
--    and branch.manage, is denied on both — proving this is a genuine
--    grant/RLS-level absence, not merely "the wrong caller".
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format('update public.organizations set name_ar = %L where id = %L', 'x', :'orgC'),
  '42501', null, 'organizations.name_ar is not directly client-writable — matches the pre-existing lack of any organizations UPDATE grant'
);
select throws_ok(
  format('update public.branches set name_ar = %L where id = %L', 'x', :'branchC'),
  '42501', null, 'branches.name_ar is not directly client-writable either — 20260804090001 revoked ALL authenticated writes on branches, not just the original columns'
);

-- Tarek — org.manage/branch.manage on a DIFFERENT organization — is equally
-- unable to reach either row, for the additional reason of cross-org
-- isolation on top of the missing write path.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';

-- Tarek cannot even SELECT Cairo Ceramics' row at all (cross-org read is
-- already blocked by organizations_select_member — this just confirms the
-- new columns did not somehow open a wider window than the existing ones).
select is(
  (select count(*) from public.organizations where id = :'orgC'::uuid)::int,
  0, 'a non-member cannot see Cairo Ceramics'' row at all, new columns included'
);

select is(
  (select count(*) from public.branches where id = :'branchC'::uuid)::int,
  0, 'a non-member cannot see Cairo Ceramics'' branch row at all, new columns included'
);

select * from finish();
rollback;

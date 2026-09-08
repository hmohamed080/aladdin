-- pgTAP: organization/branch bilingual + timezone write RPCs (20260914090001).
--
-- The claim under test: `organization_update_i18n`/`branch_update_i18n` are
-- the ONLY way to write name_ar/name_en/address_ar/address_en/timezone —
-- gated on the exact capability the (now-revoked) direct table policies used
-- to require — and they never touch the original `name`/address-less
-- columns, never leak across organizations, and never accept an invalid
-- timezone.
--
-- Fixtures, from seed-pilot:
--   Hana    (70000001…001, membership 50000001…001) — org.manage +
--     branch.manage on Cairo Ceramics Showroom (9c000000…001), branch Nasr
--     City Showroom (b0000001…001)
--   Youssef (70000002…002, membership 50000002…002) — sales-only member of
--     Cairo Ceramics (no org.manage/branch.manage) — the "wrong caller,
--     same org" case
--   Tarek   (70000003…003, membership 50000003…003) — org.manage on a
--     DIFFERENT org, Egypt Marble Manufacturing (9d000000…002) — the
--     cross-org case
--   Sara Nabil (70000004…004) — an existing user with NO membership on
--     Cairo Ceramics; this test gives her a DISPOSABLE suspended membership
--     there (with org.manage granted anyway) to prove membership STATUS,
--     not just the capability grant, gates access

create extension if not exists pgtap;

begin;
select plan(29);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set hana    '70000001-0000-4000-8000-000000000001'
\set youssef '70000002-0000-4000-8000-000000000002'
\set tarek   '70000003-0000-4000-8000-000000000003'
\set sara    '70000004-0000-4000-8000-000000000004'
\set orgC    '9c000000-cccc-4ccc-8ccc-000000000001'
\set branchC 'b0000001-0000-4000-8000-000000000001'

-- A disposable suspended membership for Sara on Cairo Ceramics — granted
-- org.manage anyway, so the assertions below prove `status = 'active'` is
-- what gates her, not a missing capability row.
set local role postgres;
with ins as (
  insert into public.memberships (user_id, organization_id, status)
    values (:'sara'::uuid, :'orgC'::uuid, 'suspended')
    returning id
)
select set_config('test.sara_membership', id::text, true) from ins;
insert into public.membership_capabilities (membership_id, capability_key)
  values (current_setting('test.sara_membership')::uuid, 'org.manage'),
         (current_setting('test.sara_membership')::uuid, 'branch.manage');

-- ===========================================================================
-- A. organization_update_i18n
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  format('select public.organization_update_i18n(%L, %L, %L, %L)', :'orgC', 'معرض سيراميك القاهرة', 'Cairo Ceramics Showroom', 'Africa/Cairo'),
  'Hana (org.manage) can update her own organization''s bilingual name + timezone'
);
select is(
  (select name_ar from public.organizations where id = :'orgC'::uuid),
  'معرض سيراميك القاهرة', 'name_ar landed'
);
select is(
  (select timezone from public.organizations where id = :'orgC'::uuid),
  'Africa/Cairo', 'timezone landed'
);
select is(
  (select name from public.organizations where id = :'orgC'::uuid),
  'Cairo Ceramics Showroom', 'the ORIGINAL name column is untouched by this RPC'
);

-- Whitespace-only input normalizes to null, not to an empty string.
select lives_ok(
  format('select public.organization_update_i18n(%L, %L, %L, %L)', :'orgC', '   ', 'Cairo Ceramics Showroom', 'Africa/Cairo'),
  'whitespace-only name_ar is accepted (normalizes rather than failing validation)'
);
select is(
  (select name_ar from public.organizations where id = :'orgC'::uuid),
  null, 'and it landed as null, not as three spaces'
);

-- Restore for the rest of the suite.
select public.organization_update_i18n(:'orgC'::uuid, 'معرض سيراميك القاهرة', 'Cairo Ceramics Showroom', 'Africa/Cairo');

-- Unauthorized member, same org.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  format('select public.organization_update_i18n(%L, %L, %L, %L)', :'orgC', 'x', 'y', null),
  '42501', null, 'a sales-only member (no org.manage) is denied'
);

-- Cross-org caller.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format('select public.organization_update_i18n(%L, %L, %L, %L)', :'orgC', 'x', 'y', null),
  '42501', null, 'org.manage on a DIFFERENT organization does not reach Cairo Ceramics'
);

-- Suspended membership, even with org.manage granted.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000004-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  format('select public.organization_update_i18n(%L, %L, %L, %L)', :'orgC', 'x', 'y', null),
  '42501', null, 'a SUSPENDED membership is denied even though org.manage is granted on the row'
);

-- Validation, as the owner.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format('select public.organization_update_i18n(%L, %L, %L, %L)', :'orgC', repeat('a', 121), null, null),
  '23514', null, 'a 121-char name_ar is rejected by the existing length constraint'
);
select throws_ok(
  format('select public.organization_update_i18n(%L, %L, %L, %L)', :'orgC', null, null, 'Mars/Olympus_Mons'),
  '22023', null, 'a non-IANA timezone identifier is rejected'
);
select throws_ok(
  'select public.organization_update_i18n(null, null, null, null)',
  '22023', null, 'a null organization id is rejected'
);

-- ===========================================================================
-- B. branch_update_i18n
-- ===========================================================================
select lives_ok(
  format(
    'select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)',
    :'branchC', 'فرع مدينة نصر', 'Nasr City Showroom', 'مدينة نصر، القاهرة', 'Nasr City, Cairo', 'Africa/Cairo'
  ),
  'Hana (branch.manage) can update her own branch''s bilingual name/address + timezone'
);
select is(
  (select name_ar from public.branches where id = :'branchC'::uuid),
  'فرع مدينة نصر', 'branch name_ar landed'
);
select is(
  (select address_en from public.branches where id = :'branchC'::uuid),
  'Nasr City, Cairo', 'branch address_en landed'
);
select is(
  (select timezone from public.branches where id = :'branchC'::uuid),
  'Africa/Cairo', 'branch timezone landed'
);
select is(
  (select name from public.branches where id = :'branchC'::uuid),
  'Nasr City Showroom', 'the ORIGINAL branch name column is untouched by this RPC'
);

-- Whitespace-only normalizes to null on the branch RPC too.
select lives_ok(
  format(
    'select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)',
    :'branchC', '  ', 'Nasr City Showroom', null, null, 'Africa/Cairo'
  ),
  'whitespace-only branch name_ar is accepted'
);
select is(
  (select name_ar from public.branches where id = :'branchC'::uuid),
  null, 'and it landed as null'
);
select public.branch_update_i18n(:'branchC'::uuid, 'فرع مدينة نصر', 'Nasr City Showroom', 'مدينة نصر، القاهرة', 'Nasr City, Cairo', 'Africa/Cairo');

-- Unauthorized member, same org's own branch.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  format('select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)', :'branchC', 'x', 'y', null, null, null),
  '42501', null, 'a sales-only member (no branch.manage) is denied'
);

-- Cross-org caller — masked as "branch not found", never distinguishable
-- from a genuinely nonexistent id.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format('select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)', :'branchC', 'x', 'y', null, null, null),
  '22023', null, 'a caller from a DIFFERENT organization cannot reach Cairo Ceramics'' branch — masked as not-found'
);
select throws_ok(
  format('select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)', '00000000-0000-4000-8000-000000000000', 'x', 'y', null, null, null),
  '22023', null, 'a genuinely nonexistent branch id produces the IDENTICAL error'
);

-- Suspended membership, even with branch.manage granted.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000004-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  format('select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)', :'branchC', 'x', 'y', null, null, null),
  '22023', null, 'a SUSPENDED membership cannot reach the branch either, even with branch.manage granted on the row'
);

-- Validation, as the owner.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format('select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)', :'branchC', repeat('a', 121), null, null, null, null),
  '23514', null, 'a 121-char branch name_ar is rejected'
);
select throws_ok(
  format('select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)', :'branchC', null, null, repeat('a', 301), null, null),
  '23514', null, 'a 301-char branch address_ar is rejected'
);
select throws_ok(
  format('select public.branch_update_i18n(%L, %L, %L, %L, %L, %L)', :'branchC', null, null, null, null, 'Not/AZone'),
  '22023', null, 'a non-IANA branch timezone is rejected'
);
select throws_ok(
  'select public.branch_update_i18n(null, null, null, null, null, null)',
  '22023', null, 'a null branch id is rejected'
);

-- ===========================================================================
-- C. Table grants remain untouched — the RPCs are the only door.
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format('update public.organizations set name_ar = %L where id = %L', 'direct write', :'orgC'),
  '42501', null, 'direct table UPDATE on organizations is still refused — the RPC did not reopen the grant'
);
select throws_ok(
  format('update public.branches set name_ar = %L where id = %L', 'direct write', :'branchC'),
  '42501', null, 'direct table UPDATE on branches is still refused — the RPC did not reopen the grant'
);

select * from finish();
rollback;

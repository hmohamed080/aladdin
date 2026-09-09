-- pgTAP: localized (Arabic/English) profile display names (20260916090001).
--
-- Additive-only migration over an ALREADY-writable column family
-- (profiles.display_name/headline/bio/... has had a direct
-- `grant update (...) to authenticated` since 20260802090001, gated by the
-- existing `profiles_update_self` row policy). The claim under test is
-- narrow: the two new columns exist, are optional, enforce the same 1-80
-- length bound as `display_name`, the seeded value for Hana is real (not a
-- migration-forced default), and the EXISTING row policy — never touched by
-- this migration — still confines a write to the caller's own row.
--
-- Fixtures, from seed-pilot: Hana (70000001…001) has both display_name_ar
-- and display_name_en seeded; Youssef (70000002…002) is used only as a
-- cross-user caller against Hana's own profile row.

create extension if not exists pgtap;

begin;
select plan(12);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set hana    '70000001-0000-4000-8000-000000000001'
\set youssef '70000002-0000-4000-8000-000000000002'

-- ===========================================================================
-- A. Columns exist, nullable, no default forced value
-- ===========================================================================
select has_column('public', 'profiles', 'display_name_ar', 'profiles.display_name_ar exists');
select has_column('public', 'profiles', 'display_name_en', 'profiles.display_name_en exists');
select col_is_null('public', 'profiles', 'display_name_ar', 'display_name_ar has no NOT NULL constraint');
select col_is_null('public', 'profiles', 'display_name_en', 'display_name_en has no NOT NULL constraint');

-- ===========================================================================
-- B. Hana's seeded value is real, not a migration-forced default — and an
--    unrelated seeded profile this migration never touched stays null.
-- ===========================================================================
select is(
  (select display_name_ar from public.profiles where user_id = :'hana'::uuid),
  'هناء منصور', 'Hana''s seeded Arabic display name is the real entered value'
);
select is(
  (select display_name_en from public.profiles where user_id = :'hana'::uuid),
  'Hana Mansour', 'Hana''s seeded English display name is the real entered value'
);
select is(
  (select display_name_ar from public.profiles where user_id = :'youssef'::uuid),
  null, 'an existing seeded profile this migration does not touch has no display_name_ar populated by it — purely additive'
);

-- ===========================================================================
-- C. Length constraints mirror the original display_name column (1-80)
-- ===========================================================================
set local role postgres;
select throws_ok(
  format('update public.profiles set display_name_ar = %L where user_id = %L', repeat('a', 81), :'hana'),
  '23514', null, 'an 81-char display_name_ar is rejected by ck_profiles_display_name_ar_len'
);
select throws_ok(
  format('update public.profiles set display_name_ar = %L where user_id = %L', '', :'hana'),
  '23514', null, 'an empty-string display_name_ar is rejected — null means "not entered", empty is not the same thing'
);
select lives_ok(
  'update public.profiles set display_name_ar = null where user_id = ' || quote_literal(:'hana'),
  'clearing display_name_ar back to null is legal — no dual-entry is forced'
);
select lives_ok(
  format('update public.profiles set display_name_ar = %L where user_id = %L', 'هناء منصور', :'hana'),
  're-setting a well-formed display_name_ar is accepted'
);

-- ===========================================================================
-- D. The EXISTING self-only row policy, unmodified by this migration, still
--    confines the (now additive) column grant — Youssef cannot touch Hana's
--    profile row, on the new columns any more than on the old ones. The
--    `with check` clause on `profiles_update_self` scopes the UPDATE to zero
--    matching rows for a non-owner (no error, no row touched) rather than
--    throwing — so the proof is that Hana's value survives unchanged.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
update public.profiles set display_name_en = 'hijacked' where user_id = :'hana'::uuid;
set local role postgres;
select is(
  (select display_name_en from public.profiles where user_id = :'hana'::uuid),
  'Hana Mansour', 'a cross-user UPDATE from Youssef leaves Hana''s display_name_en untouched — RLS scoped it to zero rows'
);

select * from finish();
rollback;

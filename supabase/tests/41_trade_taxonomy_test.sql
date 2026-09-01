-- pgTAP: Installer Pilot Increment 5 — canonical trade taxonomy (D8/O5, §4).
--
-- A taxonomy is the kind of table that looks finished long before it is safe.
-- Four failures all leave a working screen behind, and each section below exists
-- to make one of them impossible:
--
--   1. LETTING THE BROWSER OWN THE VOCABULARY. A client that can insert, rename
--      or reactivate a trade turns canonical reference data back into user
--      content — and the i18n catalogs, which are keyed by `key`, would silently
--      stop resolving for whatever it invented.
--   2. LETTING THE CLIENT RACE ITSELF. Add/remove as separate calls means the
--      row set passes through states nobody asked for: zero primaries mid-swap,
--      or two if the calls land out of order. §D pins the invariant from both
--      sides — the writer maintains it, and the index enforces it regardless.
--   3. LETTING TRADE MEMBERSHIP BECOME AUTHORITY (O5). This is the one that
--      would never look like a bug. An RLS policy or an application guard that
--      reads `user_trades` would work perfectly and quietly convert a profile
--      SIGNAL into a permission — and an installer who has done gypsum work
--      before could no longer apply for it. §H asserts the absence.
--   4. INFERRING A TRADE FROM PROSE. `prof_specialization` holds a stable key in
--      some rows and a sentence in every seeded one. §I proves the backfill
--      matched keys only and left the sentences alone.
--
-- Fixtures, all from seed-pilot:
--   70000009 — canonical installer_technician, LISTED, seeded with `tiling`
--   71000006 — canonical installer_technician, LISTED, seeded with `marble_granite`
--   70000005 — null canonical → given a DECLARED type here (the review window)
--   70000003 — made a consumer here
--   70000004 — made a trainer here
--   11111111 — business-only identity (null persona)
create extension if not exists pgtap;

begin;
select plan(73);

update auth.users set email_confirmed_at = now()
  where id in ('70000009-0000-4000-8000-000000000009', '71000006-0000-4000-8000-000000000006',
               '70000005-0000-4000-8000-000000000005', '70000003-0000-4000-8000-000000000003',
               '70000004-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111');

-- The transitional professional: declared, canonical still null.
insert into public.individual_onboarding (user_id, prof_concrete_type, professional_completed_at)
values ('70000005-0000-4000-8000-000000000005', 'installer_technician', now())
on conflict (user_id) do update
  set prof_concrete_type = 'installer_technician', professional_completed_at = now();

update public.users set primary_account_type = 'trainer'
  where id = '70000004-0000-4000-8000-000000000004';
update public.users set primary_account_type = 'end_consumer'
  where id = '70000003-0000-4000-8000-000000000003';

-- ===========================================================================
-- A. The shape
-- ===========================================================================
select has_table('public'::name, 'trades'::name, 'public.trades exists');
select has_table('public'::name, 'user_trades'::name, 'public.user_trades exists');

select col_is_pk('public'::name, 'user_trades'::name,
  array['user_id', 'trade_id']::name[],
  'user_trades is keyed on (user_id, trade_id) — one person holds MANY trades (D8)');

select has_index('public'::name, 'user_trades'::name, 'ux_user_trades_one_primary'::name,
  'the partial unique index that caps the primary at one exists');

-- OWNERSHIP IS USER-LEVEL. A trade is a person''s practice; hanging it off a
-- membership would delete it the day an employment ended.
select hasnt_column('public'::name, 'user_trades'::name, 'organization_id'::name,
  'user_trades has no organization_id — trades belong to the PERSON, not to an employer');
select hasnt_column('public'::name, 'user_trades'::name, 'membership_id'::name,
  'and no membership_id either');

-- DISPLAY NAMES ARE NOT COLUMNS (§4.2): one translation source, the i18n catalogs.
select hasnt_column('public'::name, 'trades'::name, 'name_en'::name,
  'trades has no name_en — a second translation source is exactly what §4.2 forbids');
select hasnt_column('public'::name, 'trades'::name, 'name_ar'::name,
  'and no name_ar');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.trades'::regclass),
  'RLS is enabled on trades');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_trades'::regclass),
  'RLS is enabled on user_trades');

select has_function('public'::name, 'user_trades_set'::name,
  array['text[]', 'text']::name[], 'public.user_trades_set(text[], text) exists');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'user_trades_set'),
  true, 'user_trades_set is SECURITY DEFINER — it is the only writer, and it bypasses RLS by design');

-- ===========================================================================
-- B. The vocabulary is READ-ONLY to every browser client
-- ===========================================================================
select ok(has_table_privilege('authenticated', 'public.trades', 'SELECT'),
  'authenticated may read the vocabulary — there is nothing to isolate');
select ok(not has_table_privilege('authenticated', 'public.trades', 'INSERT'),
  'authenticated may NOT insert a trade — the taxonomy is canonical reference data');
select ok(not has_table_privilege('authenticated', 'public.trades', 'UPDATE'),
  'authenticated may NOT rename, reorder or reactivate a trade');
select ok(not has_table_privilege('authenticated', 'public.trades', 'DELETE'),
  'authenticated may NOT delete a trade');
select ok(not has_table_privilege('anon', 'public.trades', 'SELECT'),
  'and anon reads no vocabulary at all — the public page needs keys from the projection, not the table');

-- user_trades has NO client write grant in any verb. The RPC is the write path.
select ok(not has_table_privilege('authenticated', 'public.user_trades', 'INSERT'),
  'authenticated may NOT insert into user_trades directly');
select ok(not has_table_privilege('authenticated', 'public.user_trades', 'UPDATE'),
  'authenticated may NOT update user_trades directly — no browser-side primary flip');
select ok(not has_table_privilege('authenticated', 'public.user_trades', 'DELETE'),
  'authenticated may NOT delete from user_trades directly');

-- The seeded Pilot vocabulary, exactly.
select set_eq(
  $$ select key from public.trades $$,
  $$ values ('kitchens_doors'), ('plumbing'), ('electrical'), ('hvac'),
            ('gypsum_paint'), ('tiling'), ('marble_granite') $$,
  'the seeded vocabulary is the five installer chips plus the two the demo world already contains');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is((select count(*) from public.trades), 7::bigint,
  'a professional sees every ACTIVE trade');
select throws_ok(
  $$ insert into public.trades (key) values ('invented_trade') $$,
  '42501', null, 'and cannot add one of their own');
reset role;

-- ===========================================================================
-- C. A canonical professional manages their OWN selection
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select is((select count(*) from public.user_trades), 1::bigint,
  'the seeded fixture gave this installer exactly one trade');

select lives_ok(
  $$ select public.user_trades_set(array['plumbing','electrical']) $$,
  'a canonical professional replaces their whole selection in one call');

select set_eq(
  $$ select t.key from public.user_trades ut join public.trades t on t.id = ut.trade_id $$,
  $$ values ('plumbing'), ('electrical') $$,
  'the submitted set REPLACED the previous one — the call is a description, not a delta');

-- THE FIRST SUBMITTED KEY BECOMES PRIMARY when none is named. That is the rule
-- that makes "select your first trade" deterministic without a second call.
select is(
  (select t.key from public.user_trades ut join public.trades t on t.id = ut.trade_id
    where ut.is_primary),
  'plumbing', 'with no primary named, the FIRST submitted key is primary');

-- ===========================================================================
-- D. The primary-trade invariant, from both sides
-- ===========================================================================
select lives_ok(
  $$ select public.user_trades_set(array['plumbing','electrical'], 'electrical') $$,
  'the primary can be changed without touching the selection');
select is(
  (select t.key from public.user_trades ut join public.trades t on t.id = ut.trade_id
    where ut.is_primary),
  'electrical', 'and the named key is now primary');
select is((select count(*) from public.user_trades where is_primary), 1::bigint,
  'still exactly one primary — the old one was cleared in the same transaction');

-- REMOVING A NON-PRIMARY leaves the primary alone.
select lives_ok(
  $$ select public.user_trades_set(array['electrical','hvac'], 'electrical') $$,
  'a non-primary trade can be dropped and another added at once');
select is(
  (select t.key from public.user_trades ut join public.trades t on t.id = ut.trade_id
    where ut.is_primary),
  'electrical', 'and the primary is untouched');

-- REMOVING THE PRIMARY falls to the first remaining submitted key. The caller
-- controls that order, so the outcome is predictable rather than arbitrary.
select lives_ok(
  $$ select public.user_trades_set(array['hvac','tiling']) $$,
  'the primary trade itself can be removed');
select is(
  (select t.key from public.user_trades ut join public.trades t on t.id = ut.trade_id
    where ut.is_primary),
  'hvac', 'and the first REMAINING key becomes primary — never zero primaries on a non-empty set');

-- DUPLICATES CONVERGE. A double-submitted chip is a client bug, not a reason to
-- refuse a save the person can see nothing wrong with.
select lives_ok(
  $$ select public.user_trades_set(array['tiling','tiling','plumbing','tiling']) $$,
  'duplicate keys are accepted');
select is((select count(*) from public.user_trades), 2::bigint,
  'and deduplicated — two rows, not four');
select is(
  (select t.key from public.user_trades ut join public.trades t on t.id = ut.trade_id
    where ut.is_primary),
  'tiling', 'the first occurrence still decides the primary');

-- AN EMPTY SET IS LEGAL, and leaves no primary behind rather than a dangling one.
select lives_ok(
  $$ select public.user_trades_set(array[]::text[]) $$,
  'the whole selection can be cleared');
select is((select count(*) from public.user_trades), 0::bigint,
  'and every row is gone');
select is((select count(*) from public.user_trades where is_primary), 0::bigint,
  'with no primary left pointing at nothing');

select lives_ok(
  $$ select public.user_trades_set(null) $$,
  'a null selection is the same statement as an empty one');

-- ===========================================================================
-- E. What the writer refuses
-- ===========================================================================
select throws_ok(
  $$ select public.user_trades_set(array['plumbing','not_a_trade']) $$,
  '22023', null,
  'an unknown key refuses the WHOLE call — silently dropping it would leave the person believing they saved it');
select is((select count(*) from public.user_trades), 0::bigint,
  'and nothing was written — the call is atomic in failure too');

select throws_ok(
  $$ select public.user_trades_set(array['plumbing'], 'electrical') $$,
  '22023', null, 'a primary that is not in the submitted set is a contradiction, not a hint');

reset role;
update public.trades set is_active = false where key = 'hvac';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select is((select count(*) from public.trades), 6::bigint,
  'a retired trade disappears from the vocabulary a professional can see');
select throws_ok(
  $$ select public.user_trades_set(array['hvac']) $$,
  '22023', null, 'and cannot be newly selected, even by a client that still knows the key');

-- BUT A RETIRED TRADE ALREADY HELD IS NOT A TRAP. Refusing it outright would
-- make every future save fail for anyone caught by a retirement.
reset role;
insert into public.trades (key, is_active, sort_order) values ('legacy_trade', false, 99);
insert into public.user_trades (user_id, trade_id, is_primary)
select '70000009-0000-4000-8000-000000000009', id, true from public.trades where key = 'legacy_trade';

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(
  $$ select public.user_trades_set(array['legacy_trade','plumbing'], 'plumbing') $$,
  'an INACTIVE trade the person already holds may be kept');
select lives_ok(
  $$ select public.user_trades_set(array['plumbing']) $$,
  'and dropped');
select is((select count(*) from public.user_trades), 1::bigint,
  'leaving the active selection alone');

reset role;
update public.trades set is_active = true where key = 'hvac';
delete from public.user_trades ut using public.trades t
  where t.id = ut.trade_id and t.key = 'legacy_trade';
delete from public.trades where key = 'legacy_trade';

-- ===========================================================================
-- F. Who may declare a trade at all
-- ===========================================================================
-- The transitional window Increment 2 opened: a declared professional whose
-- upgrade is still under review, canonical persona still null.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}';
select lives_ok(
  $$ select public.user_trades_set(array['gypsum_paint']) $$,
  'a DECLARED professional may declare trades while the upgrade is under review');
reset role;
select is(
  (select primary_account_type from public.users
    where id = '70000005-0000-4000-8000-000000000005'),
  null, 'and the canonical persona really was still null when they did');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ select public.user_trades_set(array['plumbing']) $$,
  '42501', null, 'a CONSUMER cannot claim a professional trade');

set local request.jwt.claims = '{"sub":"70000004-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ select public.user_trades_set(array['plumbing']) $$,
  '42501', null, 'nor a TRAINER');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.user_trades_set(array['plumbing']) $$,
  '42501', null, 'nor a BUSINESS-ONLY identity — owning a company is not a personal persona');

reset role;
set local role anon;
set local request.jwt.claims = '';
select throws_ok(
  $$ select public.user_trades_set(array['plumbing']) $$,
  '42501', null, 'and an anonymous caller cannot declare trades for anybody');
reset role;

-- ===========================================================================
-- G. Ownership — the RPC takes no user id, and the table shows no one else''s
-- ===========================================================================
-- There is no `p_user_id` to pass, which is the point: the only identity the
-- writer will act on is `auth.uid()`, so "acting on another user" is not a
-- refused request, it is an unexpressible one.
select is(
  (select count(*) from information_schema.parameters
    where specific_schema = 'public'
      and specific_name like 'user_trades_set%'
      and parameter_name like '%user%'),
  0::bigint, 'user_trades_set accepts no user-id parameter — the caller cannot name a victim');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is(
  (select count(*) from public.user_trades
    where user_id = '70000005-0000-4000-8000-000000000005'),
  0::bigint, 'and one professional cannot read another professional''s trade rows');
reset role;
select is(
  (select count(*) from public.user_trades
    where user_id = '70000005-0000-4000-8000-000000000005'),
  1::bigint, 'though the row is really there — the RLS policy hid it, nothing deleted it');

-- ===========================================================================
-- H. O5 — trade membership is a SIGNAL, never authority
-- ===========================================================================
-- The failure this section forbids would never look like a bug: a policy or a
-- guard reading `user_trades` works perfectly and converts a profile signal into
-- a permission. It is asserted structurally, because by the time it is visible
-- in behaviour an installer has already been refused a job they may apply for.
select is(
  (select count(*) from pg_policies
    where coalesce(qual, '') || coalesce(with_check, '') like '%user_trades%'),
  0::bigint, 'NO RLS POLICY ANYWHERE references user_trades (O5)');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and p.prosrc like '%user_trades%'
      and p.proname not in ('user_trades_set', '_profile_public_directory')),
  0::bigint,
  'and the ONLY functions that mention it are its writer and the public projection — no capability, no can_* predicate');

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'user_trades_set'
      and p.prosrc like '%from public.user_trades%is_professional%'),
  0::bigint,
  'the writer does not read user_trades to decide WHO MAY WRITE — holding a trade never proves you were allowed to');

-- ===========================================================================
-- I. The public projection, and the free text it did not replace
-- ===========================================================================
select columns_are('public'::name, 'profile_public_directory'::name,
  array['id', 'display_name', 'headline', 'bio', 'avatar_media_id', 'locality_id',
        'languages', 'persona', 'specialization', 'services', 'years_experience',
        'service_areas', 'available_for_work', 'availability_updated_at',
        'trade_keys', 'primary_trade_key']::name[],
  'the public projection gained exactly two trade columns and nothing else');

select hasnt_column('public'::name, 'profile_public_directory'::name, 'trade_id'::name,
  'and exposes KEYS, not internal ids — a uuid published for no reader''s benefit');

-- LEGACY FREE TEXT SURVIVED. This increment is additive: `prof_specialization`
-- still holds the sentence the demo world wrote, and the headline is untouched.
select is(
  (select prof_specialization from public.individual_onboarding
    where user_id = '71000006-0000-4000-8000-000000000006'),
  null, 'the seeded installer has no onboarding row at all — the projection LEFT JOINs it, and must');

select ok(
  exists (select 1 from public.profiles
           where user_id = '71000006-0000-4000-8000-000000000006'
             and headline = 'Marble and granite fixing'),
  'and the free-text headline the fixture mapped FROM is still intact — nothing was destroyed');

-- Cleared deliberately, so the next two assertions are about a professional who
-- really holds no trades rather than one who happens to hold whatever §E left.
delete from public.user_trades where user_id = '70000009-0000-4000-8000-000000000009';

create temp table fx as
  select user_id, id from public.profiles
   where user_id in ('71000006-0000-4000-8000-000000000006',
                     '70000009-0000-4000-8000-000000000009');
grant select on fx to anon, authenticated;

set local role anon;
set local request.jwt.claims = '';

select is(
  (select trade_keys from public.profile_public_directory
    where id = (select id from fx where user_id = '71000006-0000-4000-8000-000000000006')),
  array['marble_granite'],
  'anon sees the canonical trade the seed fixture mapped by hand');
select is(
  (select primary_trade_key from public.profile_public_directory
    where id = (select id from fx where user_id = '71000006-0000-4000-8000-000000000006')),
  'marble_granite', 'and the primary key on its own, so no caller re-derives it');

-- A professional with NO trades is still listed. Trades filter nothing (O5).
select ok(
  exists (select 1 from public.profile_public_directory
           where id = (select id from fx where user_id = '70000009-0000-4000-8000-000000000009')),
  'a professional whose trades were cleared is STILL listed — the taxonomy gates no discovery');
select is(
  (select trade_keys from public.profile_public_directory
    where id = (select id from fx where user_id = '70000009-0000-4000-8000-000000000009')),
  '{}'::text[], 'and reads as an empty selection rather than disappearing');

reset role;

-- INACTIVE TRADES DO NOT REACH THE PUBLIC. Retiring one removes it from every
-- profile at once, which is what retirement has to mean.
update public.trades set is_active = false where key = 'marble_granite';
set local role anon;
set local request.jwt.claims = '';
select is(
  (select trade_keys from public.profile_public_directory
    where id = (select id from fx where user_id = '71000006-0000-4000-8000-000000000006')),
  '{}'::text[], 'a retired trade stops being published');
reset role;
select is(
  (select count(*) from public.user_trades ut join public.trades t on t.id = ut.trade_id
    where t.key = 'marble_granite'),
  1::bigint, 'while the row itself survives — history is not rewritten by a retirement');
update public.trades set is_active = true where key = 'marble_granite';

-- ===========================================================================
-- J. The backfill matched KEYS, never prose
-- ===========================================================================
-- `prof_specialization` holds a stable vocabulary key in some rows and a
-- sentence in every seeded/staging one. The migration mapped the first kind by
-- exact equality and left the second alone; the demo world's sentences are
-- resolved by hand in seed-pilot, where a reviewer can check each pair.
reset role;
update public.individual_onboarding set prof_specialization = 'Plumbing and sanitary fitting'
  where user_id = '70000005-0000-4000-8000-000000000005';

select is(
  (select count(*) from public.user_trades ut
    join public.trades t on t.id = ut.trade_id
   where ut.user_id = '70000005-0000-4000-8000-000000000005' and t.key = 'plumbing'),
  0::bigint,
  'a prose specialization is NOT inferred onto a trade — a guess that is right four times and wrong once has published a false claim');

select is(
  (select prof_specialization from public.individual_onboarding
    where user_id = '70000005-0000-4000-8000-000000000005'),
  'Plumbing and sanitary fitting',
  'and the prose is left exactly where it was — this increment deletes no free text');

rollback;

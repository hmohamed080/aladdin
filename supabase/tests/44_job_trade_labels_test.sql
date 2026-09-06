-- pgTAP: the poster-side trade label, and the line it does not cross.
--
-- `jobs.trade_id` is `not null references public.trades on delete restrict`, so
-- retiring a trade is designed to leave every historical job intact. It does —
-- in the table. What it does NOT leave intact is the poster's ability to READ
-- the label, because `trades_select_active` withholds inactive rows: the poster's
-- own list and detail page lose the name of a trade they themselves chose.
--
-- The one-line fix would have been another permissive policy on `public.trades`.
-- This file exists mostly to prove the fix ISN'T that, because a policy widens
-- the table rather than answering the question, and the first thing it would
-- widen is `loadTradeCatalog()` — the vocabulary the "post a job" form offers.
--
-- So the three failures this file is written to catch:
--
--   1. THE LABEL GOING MISSING AGAIN (§A). The whole point: after retirement the
--      poster still reads `marble_granite` for the job they posted in it.
--   2. THE SEAM BECOMING A SECOND VOCABULARY (§A, §C). The same caller, in the
--      same transaction, must still NOT see the retired trade in
--      `public.trades` — and `job_create`, `job_update` and `job_publish` must
--      still refuse it. Reading a retired label never becomes posting in one.
--   3. THE SEAM LEAKING SIDEWAYS (§B). It is scoped to the caller's own
--      organizations, so a rival poster, the installer who applied, and anon all
--      get nothing.
create extension if not exists pgtap;

begin;
select plan(30);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

-- The two seeded Horizon jobs: f1000001 is OPEN under marble_granite,
-- f1000002 is a DRAFT under plumbing. Retire both trades — the platform's own
-- act, a migration in real life, never a client one.
update public.trades set is_active = false where key in ('marble_granite', 'plumbing');

-- ===========================================================================
-- A. The poster still reads their own history
-- ===========================================================================
-- Mostafa, owner at Horizon Contracting.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- THE DEFECT, stated as the assertion that would have failed before this seam:
-- the plain embed the list page uses returns nothing for a retired trade.
select is(
  (select count(*) from public.jobs j
     join public.trades t on t.id = j.trade_id
    where j.id = 'f1000001-0000-4000-8000-000000000001')::int,
  0, 'the plain jobs->trades join goes blank once the trade is retired (the defect)');

select is(
  (select trade_key from public.job_trade_labels
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  'marble_granite', 'AND THE SEAM STILL RESOLVES IT — the open job keeps its label');

select is(
  (select trade_key from public.job_trade_labels
    where job_id = 'f1000002-0000-4000-8000-000000000002'),
  'plumbing', 'so does the draft, which is where the label matters most');

select is(
  (select trade_is_active from public.job_trade_labels
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  false, 'and says the trade is retired, so the UI can mark it as history');

-- Restoring the trade must restore the ordinary answer, not leave the seam
-- reporting a stale one: it reads `trades` live and stores nothing. Retirement
-- is a PLATFORM act, so the role drops back to the migration's before touching
-- the vocabulary — `authenticated` holds no update grant on `trades` at all,
-- which is itself the reason this seam had to exist.
reset role;
update public.trades set is_active = true where key = 'marble_granite';
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select trade_is_active from public.job_trade_labels
    where job_id = 'f1000001-0000-4000-8000-000000000001'),
  true, 'un-retiring a trade is reflected live — the seam derives, it does not store');

reset role;
update public.trades set is_active = false where key = 'marble_granite';
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- ===========================================================================
-- THE NON-WIDENING, in the same session as the reads above
-- ===========================================================================
-- If this seam had been a policy on `public.trades`, these two would now fail —
-- and the retired trade would be an option in the "post a job" dropdown.
select is(
  (select count(*) from public.trades where key = 'marble_granite')::int,
  0, 'THE RETIRED TRADE IS STILL INVISIBLE in public.trades to that same caller');

select is(
  (select count(*) from public.trades where not is_active)::int,
  0, 'no retired trade is visible to them at all — general discovery is unchanged');

select ok(
  (select count(*) from public.trades) > 0,
  'while the active vocabulary the create form reads is untouched');

-- ===========================================================================
-- B. It does not reach sideways
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select is(
  (select count(*) from public.job_trade_labels)::int,
  0, 'another organization reads no label of ours');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is(
  (select count(*) from public.job_trade_labels)::int,
  0, 'an installer sees nothing here — this is the POSTER''s history, not a browse surface');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.job_trade_labels$$,
  '42501', null, 'anon cannot read it at all');

-- ===========================================================================
-- C. Reading a retired label never becomes posting in one
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  $$select public.job_create(
      '9a000000-aaaa-4aaa-8aaa-000000000005', 'A new staircase',
      'marble_granite', 12000)$$,
  '22023', null,
  'job_create still refuses the retired trade the caller can now read a label for');

-- A retired trade the caller has no claim on is refused by job_update exactly as
-- before. `plumbing` is retired here and belongs to a DIFFERENT job of the same
-- organization — being able to read a label for it elsewhere buys nothing.
select throws_ok(
  $$select public.job_update(
      'f1000001-0000-4000-8000-000000000001', 1,
      'Marble staircase cladding - Fifth Settlement', 'plumbing', 18000)$$,
  '22023', null, 'job_update refuses a retired trade that is not this job''s own');

select throws_ok(
  $$select public.job_update(
      'f1000001-0000-4000-8000-000000000001', 1,
      'Marble staircase cladding - Fifth Settlement', 'no_such_trade', 18000)$$,
  '22023', null, 'and an unknown key, the same way it always has');

-- ===========================================================================
-- C2. RETAINING a retired trade, which is the whole distinction
-- ===========================================================================
-- Retirement must stop a trade being CHOSEN, not freeze every job already
-- posted under it. Without this the poster could not fix a typo in the title of
-- their own draft.
select lives_ok(
  $$select public.job_update(
      'f1000002-0000-4000-8000-000000000002', 1,
      'Bathroom sanitary fitting - Maadi handover (revised)', 'plumbing', 22500,
      'Now including the guest bathrooms.')$$,
  'A DRAFT UNDER A RETIRED TRADE CAN STILL BE EDITED, keeping that same trade');

select is(
  (select title from public.jobs where id = 'f1000002-0000-4000-8000-000000000002'),
  'Bathroom sanitary fitting - Maadi handover (revised)',
  'the non-trade field actually changed');

select is(
  (select trade_key from public.job_trade_labels
    where job_id = 'f1000002-0000-4000-8000-000000000002'),
  'plumbing', 'and the historical trade is still the one it holds');

-- The same for an OPEN job: the edit window is draft+open, and both halves of it
-- have to survive their trade being withdrawn.
reset role;
update public.trades set is_active = false where key = 'marble_granite';
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  $$select public.job_update(
      'f1000001-0000-4000-8000-000000000001', 1,
      'Marble staircase cladding - Fifth Settlement (phase 2)', 'marble_granite', 18000)$$,
  'an OPEN job under a retired trade can be edited too');

-- Moving OFF a retired trade is a real change and must land on an active one.
select throws_ok(
  $$select public.job_update(
      'f1000002-0000-4000-8000-000000000002', 2,
      'Bathroom sanitary fitting - Maadi handover (revised)', 'marble_granite', 22500)$$,
  '22023', null, 'switching to another RETIRED trade is still refused');

reset role;
update public.trades set is_active = true where key = 'marble_granite';
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select lives_ok(
  $$select public.job_update(
      'f1000002-0000-4000-8000-000000000002', 2,
      'Bathroom sanitary fitting - Maadi handover (revised)', 'marble_granite', 22500)$$,
  'while switching to an ACTIVE trade is exactly as allowed as it was');

-- And publication still refuses, because that is where the platform's decision
-- to withdraw a trade has to bite. Put the draft back under its retired trade
-- first — its version has moved twice by now.
reset role;
update public.jobs set trade_id = (select id from public.trades where key = 'plumbing')
  where id = 'f1000002-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select throws_ok(
  $$select public.job_publish('f1000002-0000-4000-8000-000000000002',
      (select version from public.jobs where id = 'f1000002-0000-4000-8000-000000000002'))$$,
  '22023', null,
  'EDITING is not PUBLISHING — the draft still cannot go out under a retired trade');

-- ===========================================================================
-- C3. The post-application freeze is untouched by any of this
-- ===========================================================================
reset role;
update public.trades set is_active = false where key = 'marble_granite';
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001', 'Available next week.')$$,
  'an installer applies to the open job (its retired trade gates nothing — O5)');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- Retaining the retired trade is not a CHANGE, so the freeze has nothing to
-- object to and ordinary maintenance still works.
select lives_ok(
  $$select public.job_update(
      'f1000001-0000-4000-8000-000000000001', 2,
      'Marble staircase cladding - Fifth Settlement (phase 3)', 'marble_granite', 18000)$$,
  'a title edit still works on an applied-to job holding a retired trade');

-- But moving off it is, and the freeze wins — this is the assertion that would
-- fail if the new resolution had been written as "any trade is fine now".
select throws_ok(
  $$select public.job_update(
      'f1000001-0000-4000-8000-000000000001', 3,
      'Marble staircase cladding - Fifth Settlement (phase 3)', 'tiling', 18000)$$,
  '22023', null, 'THE POST-APPLICATION FREEZE STILL WINS over a valid active trade');

select throws_ok(
  $$select public.job_update(
      'f1000001-0000-4000-8000-000000000001', 3,
      'Marble staircase cladding - Fifth Settlement (phase 3)', 'marble_granite', 21000)$$,
  '22023', null, 'and so does the offer half of it');

-- ===========================================================================
-- D. The shape of the seam
-- ===========================================================================
reset role;

select is(
  (select array_agg(c.n order by c.n) from (
     select column_name::text collate "C" as n
       from information_schema.columns
      where table_schema = 'public' and table_name = 'job_trade_labels') c),
  array['job_id', 'trade_is_active', 'trade_key'],
  'three columns and no more — a label seam, not a second trades table');

-- Named grantees: the owner holds every privilege on any view it owns, so the
-- claim worth asserting is that no CLIENT role does.
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_trade_labels'
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int,
  0, 'no client role can write through it');

select ok(
  (select c.reloptions::text[] @> array['security_invoker=true']
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_trade_labels'),
  'it is a security_invoker view, so the Advisor sweep in test 29 stays clean');

select ok(
  (select p.proconfig @> array['search_path=""'] and p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_job_trade_labels'),
  'the reader is SECURITY DEFINER with search_path pinned empty');

-- O5, one more time. This seam reads `trades` — the one place it would be easy
-- to slip a filter in — and it must project the job's trade, never select jobs
-- or callers by one.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_job_trade_labels'
      and pg_get_functiondef(p.oid) ~* 'user_trades')::int,
  0, 'and it never references user_trades (O5)');

select finish();
rollback;

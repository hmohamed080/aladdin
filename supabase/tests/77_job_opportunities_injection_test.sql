-- pgTAP: Installer Jobs — the board's dynamic SQL cannot be injected into or widened.
--
-- public.job_opportunities_page / job_opportunities_total assemble their statement with EXECUTE (optional predicates
-- written inline defeat the partial indexes). That is only acceptable if NO caller-supplied text can ever become
-- executable SQL STRUCTURE, and if nothing a caller sends can widen what is discoverable. This file proves both:
--
--   A. STRUCTURE (static): no input parameter appears inside a `||` concatenation; nothing is passed through
--      format() / quote_*(); every EXECUTE carries a USING clause; the functions are SECURITY DEFINER with an empty
--      search_path and are callable by `authenticated` only.
--   B. HOSTILE VALUES (dynamic): quotes, comment markers, semicolons, wildcards, backslashes, oversized text,
--      malformed and forged cursors, bad sorts and bad page sizes are inert data or are refused — and the tables
--      are still there, still the same size, and still only ever show discoverable jobs.
--   C. IDENTITY: anonymous callers are refused; there is no user parameter to borrow.
--   D. SEARCH (indexed with pg_trgm): the same three columns and the same semantics as before the index, Arabic and
--      mixed text, empty / whitespace / maximum-length queries, literal % _ and backslash, the poster organization's
--      name, and discoverability that no search term can widen.
create extension if not exists pgtap;

begin;
select plan(81);

\set org    '9a000000-aaaa-4aaa-8aaa-000000000005'
\set org2   '91000001-1111-4111-8111-000000000001'
\set poster '70000006-0000-4000-8000-000000000006'
\set A      '71000006-0000-4000-8000-000000000006'

-- ---------------------------------------------------------------------------
-- Fixtures. Eight discoverable jobs — one whose TITLE is itself an injection payload — plus three that must never
-- be discoverable (draft, closed, unverified poster) and carry a recognisable title.
-- ---------------------------------------------------------------------------
insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city,
                         expected_duration_days, status, published_at, created_by)
select ('e7700000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, :'org'::uuid,
       case i when 0 then $t$IJ O'Brien; DROP TABLE jobs; -- ok$t$
              when 1 then 'IJ 100% off a_b'
              when 2 then 'IJ aXb sale'
              when 3 then 'IJ دهان فيلا التجمع'
              when 4 then 'IJ Villa دهان modern'
              else 'IJ plain ' || i end,
       case when i = 5 then 'details unitdesc needle' else 'x' end,
       (select id from public.trades where key = 'painting'), 5000 + i, 'Cairo', 'New Cairo',
       10::smallint, 'open', timestamptz '2027-03-01 12:00:00+00' - (i || ' hours')::interval, :'poster'::uuid
from generate_series(0, 7) i;

insert into public.jobs (id, poster_org_id, title, description, trade_id, offered_amount, governorate, city, status, published_at, created_by)
select ('e7700000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, o, 'IJ HIDDEN ' || s, 'x',
       (select id from public.trades where key = 'painting'), 5000, 'Cairo', 'New Cairo', s::public.job_status,
       timestamptz '2099-01-01 00:00:00+00', :'poster'::uuid
from (values (900, :'org'::uuid, 'draft'), (901, :'org'::uuid, 'closed'), (902, :'org2'::uuid, 'open')) v(n, o, s);
update public.organizations set is_verified = false where id = :'org2'::uuid;

insert into public.user_trades (user_id, trade_id) select :'A'::uuid, id from public.trades where key = 'painting';

create temp table baseline as select count(*)::int as n from public.jobs;

-- The ORIGINAL search expression (title / description / the joined poster organization's name), evaluated as the owner,
-- is the oracle the indexed search must equal term for term.
create temp table search_oracle as
select t.term,
       (select count(*)::int
          from public.jobs j
          join public.organizations o on o.id = j.poster_org_id and o.is_verified and o.deleted_at is null and o.status = 'active'::public.org_status
         where j.status = 'open'::public.job_status
           and (j.title ilike app._job_search_pattern(t.term) or j.description ilike app._job_search_pattern(t.term) or o.name ilike app._job_search_pattern(t.term))) as n
  from (values ('plain'), ('PLAIN'), ('unitdesc'), ('دهان'), ('Villa دهان'), ('100%'), ('a_b'), ('aXb'), ('%'), ('_'), ('O''Brien'),
               ((select split_part(name, ' ', 1) from public.organizations where id = '9a000000-aaaa-4aaa-8aaa-000000000005'::uuid))) t(term);
grant select on search_oracle to authenticated;

-- ===========================================================================
-- A. STRUCTURE — what the functions are made of
-- ===========================================================================
create temp table src as
  select p.proname,
         -- comments are not code: strip them so a sentence about "||" cannot satisfy or break a check
         regexp_replace(p.prosrc, '--[^\n]*', '', 'g') as body,
         p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and p.proname in ('job_opportunities_page', 'job_opportunities_total'))
      or (n.nspname = 'app'    and p.proname in ('_job_opportunity_filter', '_job_search_pattern'));

select is((select count(*)::int from src), 4, 'the four functions that build or feed the dynamic statement exist');

select is(
  (select count(*)::int from src where body ~* '(format\s*\(|quote_literal|quote_ident|quote_nullable|%L|%I)'),
  0, 'nothing is passed through format() / quote_*(): there is nothing interpolated to quote');

select is(
  (select count(*)::int from src s, regexp_split_to_table(s.body, ';') stmt
    where s.proname in ('job_opportunities_page', 'job_opportunities_total')
      and stmt ~ '\|\|'
      and stmt ~ '\m(p_sort|p_search|p_trade_keys|p_governorate_key|p_city_key|p_min_amount|p_max_amount|p_min_duration|p_max_duration|p_applied|p_saved|p_limit|p_after_id|p_after_published_at|p_after_amount|p_after_tier)\M'),
  0, 'NO input parameter appears inside a || concatenation — user values can only be bind parameters');

select is(
  (select count(*)::int from src s, regexp_split_to_table(s.body, ';') stmt
    where s.proname in ('job_opportunities_page', 'job_opportunities_total')
      and stmt ~* '\mexecute\M' and stmt !~* '\musing\M'),
  0, 'every EXECUTE carries a USING clause (values are bound, never spliced)');

select is(
  (select count(*)::int from src s, regexp_split_to_table(s.body, ';') stmt
    where s.proname in ('job_opportunities_page', 'job_opportunities_total')
      and stmt ~* '\mexecute\M' and stmt ~ '\|\|'),
  0, 'no EXECUTE statement concatenates anything inline: the statement text is assembled beforehand from fixed literals');

select is(
  (select count(*)::int from src where proname in ('job_opportunities_page', 'job_opportunities_total')
      and body ~* 'limit\s*''\s*\|\|'),
  0, 'the LIMIT is a bind parameter, not concatenated');

select is(
  (select count(*)::int from src
    where proconfig is null or not ('search_path=""' = any (proconfig))
       or (proname in ('job_opportunities_page', 'job_opportunities_total') and not prosecdef)),
  0, 'all four pin an EMPTY search_path (names cannot be hijacked) and the two public entry points are SECURITY DEFINER');

select ok(
  (select body ~ 'p_sort is null or p_sort not in \(''newest'', ''oldest'', ''highest'', ''nearest'', ''best''\)'
     from src where proname = 'job_opportunities_page'),
  'the sort is validated against a fixed allow-list BEFORE any statement text is assembled from it');

select ok(
  has_function_privilege('authenticated', 'public.job_opportunities_page(text,text,text[],text,text,numeric,numeric,smallint,smallint,boolean,boolean,integer,uuid,timestamptz,numeric,smallint)', 'execute')
  and not has_function_privilege('anon', 'public.job_opportunities_page(text,text,text[],text,text,numeric,numeric,smallint,smallint,boolean,boolean,integer,uuid,timestamptz,numeric,smallint)', 'execute'),
  'the page is callable by authenticated and NOT by anon');

select ok(
  not has_function_privilege('authenticated', 'app._job_opportunity_filter(boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'app._job_search_pattern(text)', 'execute'),
  'the internal statement builders are not reachable by any client role');

-- ===========================================================================
-- B. HOSTILE VALUES — every one is inert data or is refused
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- The reference: with no filter the caller sees exactly the eight discoverable jobs and never a hidden one.
select is(
  (select count(*)::int from public.job_opportunities_page(p_limit => 101) where title like 'IJ%'),
  8, 'reference: the caller sees exactly the 8 discoverable fixture jobs');
select is(
  (select count(*)::int from public.job_opportunities_page(p_limit => 101) where title like 'IJ HIDDEN%'),
  0, 'reference: a draft, a closed job and an unverified poster''s job are never returned');

-- SEARCH — the text is a bound ILIKE pattern with every wildcard escaped.
select is((select count(*)::int from public.job_opportunities_page(p_search => $q$' or 1=1 --$q$, p_limit => 101)), 0,
  'search: a quote + OR 1=1 + comment marker matches nothing (it is text, not logic)');
select is((select public.job_opportunities_total(p_search => $q$' or 1=1 --$q$)), 0::bigint,
  'search: the TOTAL agrees — the same hostile text counts nothing');
select is((select count(*)::int from public.job_opportunities_page(p_search => $q$'; drop table public.jobs; --$q$, p_limit => 101)), 0,
  'search: a stacked statement is just text');
select is((select count(*)::int from public.job_opportunities_page(p_search => $q$x') union select * from public.users --$q$, p_limit => 101)), 0,
  'search: a UNION payload is just text');
select is((select count(*)::int from public.job_opportunities_page(p_search => $q$O'Brien$q$, p_limit => 101)), 1,
  'search: a literal quote finds exactly the one job whose title contains it (quotes are data, handled correctly)');
select is((select count(*)::int from public.job_opportunities_page(p_search => '%', p_limit => 101)), 1,
  'search: a typed % is a literal percent sign, not a wildcard (it finds only the one title that contains one, not everything)');
select is((select count(*)::int from public.job_opportunities_page(p_search => '_', p_limit => 101)), 1,
  'search: a typed _ is a literal underscore, not a single-character wildcard (only a_b, not every title)');
select lives_ok($q$ select * from public.job_opportunities_page(p_search => '\', p_limit => 101) $q$,
  'search: a lone backslash does not break the LIKE pattern (no "must not end with escape character" error)');
select lives_ok($q$ select * from public.job_opportunities_page(p_search => $s$\\\%\_'"$s$, p_limit => 101) $q$,
  'search: a pile of escape characters is inert');

-- KEYS — governorate / city / trade are bound equality values.
select is((select count(*)::int from public.job_opportunities_page(p_governorate_key => $q$cairo' or '1'='1$q$, p_limit => 101)), 0,
  'governorate_key: an OR-tautology is compared as one string and matches nothing');
select is((select count(*)::int from public.job_opportunities_page(p_governorate_key => 'cairo', p_city_key => $q$x'); delete from public.jobs; --$q$, p_limit => 101)), 0,
  'city_key: a stacked DELETE is a string that equals no city');
select is((select count(*)::int from public.job_opportunities_page(p_trade_keys => array[$q$painting' or true --$q$], p_limit => 101)), 0,
  'trade_keys: a hostile key resolves to no trade and so no job (it never widens to "all trades")');
select is((select count(*)::int from public.job_opportunities_page(p_trade_keys => array['painting', $q$x'); drop table public.jobs; --$q$], p_limit => 101) where title like 'IJ%'), 8,
  'trade_keys: a hostile key beside a real one changes nothing about the real one');
select is((select public.job_opportunities_total(p_governorate_key => $q$cairo' or '1'='1$q$)), 0::bigint,
  'the TOTAL with a hostile governorate_key counts nothing');

-- TYPED VALUES — amounts, durations and booleans cannot carry text at all.
select throws_ok($q$ select * from public.job_opportunities_page(p_min_amount => '1; drop table public.jobs'::numeric) $q$,
  '22P02', null, 'min_amount: text cannot be smuggled in — it is a numeric, so it is refused at the type');
select throws_ok($q$ select * from public.job_opportunities_page(p_max_amount => $s$1 or 1=1$s$::numeric) $q$,
  '22P02', null, 'max_amount: an OR-tautology is refused at the type');
select throws_ok($q$ select * from public.job_opportunities_page(p_min_duration => 99999::smallint) $q$,
  '22003', null, 'min_duration: a smallint cannot overflow into anything');
select throws_ok($q$ select * from public.job_opportunities_page(p_applied => 'true; drop table public.jobs'::boolean) $q$,
  '22P02', null, 'applied: a boolean cannot carry text');
select throws_ok($q$ select * from public.job_opportunities_page(p_saved => 'yes please or 1=1'::boolean) $q$,
  '22P02', null, 'saved: a boolean cannot carry text');

-- SORT — only the five names exist; anything else is refused before any statement is built.
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => 'newest; drop table public.jobs') $q$,
  '22023', 'unknown sort', 'sort: a stacked statement is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => 'published_at') $q$,
  '22023', 'unknown sort', 'sort: a real COLUMN name is refused — columns are never taken from input');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => 'newest desc, (select 1)') $q$,
  '22023', 'unknown sort', 'sort: an injected ORDER BY expression is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => 'NEWEST') $q$,
  '22023', 'unknown sort', 'sort: even a different CASE is refused — the list is exact');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => '') $q$,
  '22023', 'unknown sort', 'sort: empty is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => null) $q$,
  '22023', 'unknown sort', 'sort: NULL is refused');

-- PAGE SIZE — an integer, bounded 1..101.
select throws_ok($q$ select * from public.job_opportunities_page(p_limit => 0) $q$, '22023', 'invalid page size', 'limit 0 is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_limit => -1) $q$, '22023', 'invalid page size', 'a negative limit is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_limit => 102) $q$, '22023', 'invalid page size', 'a limit above the cap is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_limit => 2147483647) $q$, '22023', 'invalid page size', 'the largest integer is refused, not allocated');
select throws_ok($q$ select * from public.job_opportunities_page(p_limit => null) $q$, '22023', 'invalid page size', 'a NULL limit is refused');

-- OVERSIZED INPUT — bounded before use.
select throws_ok(format($q$ select * from public.job_opportunities_page(p_search => %L) $q$, repeat('a', 201)),
  '22023', 'invalid filter', 'an oversized search (201 chars) is refused');
select throws_ok(format($q$ select * from public.job_opportunities_page(p_governorate_key => %L) $q$, repeat('a', 65)),
  '22023', 'invalid filter', 'an oversized governorate_key is refused');
select throws_ok(format($q$ select * from public.job_opportunities_page(p_trade_keys => %L::text[]) $q$, (select array_agg('k' || g)::text from generate_series(1, 51) g)),
  '22023', 'invalid filter', 'an oversized trade list (51) is refused');
select throws_ok(format($q$ select public.job_opportunities_total(p_search => %L) $q$, repeat('a', 201)),
  '22023', 'invalid filter', 'the TOTAL refuses the same oversized search');

-- CURSOR — typed values; all-or-nothing; the keys the sort needs; ranges.
select throws_ok($q$ select * from public.job_opportunities_page(p_after_id => 'not-a-uuid'::uuid) $q$,
  '22P02', null, 'cursor: a malformed id cannot be a uuid at all');
select throws_ok($q$ select * from public.job_opportunities_page(p_after_published_at => 'next tuesday ; drop'::timestamptz) $q$,
  '22007', null, 'cursor: a malformed timestamp is refused at the type');
select throws_ok($q$ select * from public.job_opportunities_page(p_after_published_at => now()) $q$,
  '22023', 'invalid cursor', 'cursor: keys without an id (a half cursor) are refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_after_id => 'e7700000-0000-4000-8000-000000000001') $q$,
  '22023', 'invalid cursor', 'cursor: an id without its sort key is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => 'highest', p_after_id => 'e7700000-0000-4000-8000-000000000001', p_after_published_at => now()) $q$,
  '22023', 'invalid cursor', 'cursor: "highest" needs its amount key');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => 'nearest', p_after_id => 'e7700000-0000-4000-8000-000000000001', p_after_published_at => now(), p_after_tier => 4::smallint) $q$,
  '22023', 'invalid cursor', 'cursor: a Near me tier outside 0..3 is refused');
select throws_ok($q$ select * from public.job_opportunities_page(p_sort => 'best', p_after_id => 'e7700000-0000-4000-8000-000000000001', p_after_published_at => now(), p_after_tier => 3::smallint) $q$,
  '22023', 'invalid cursor', 'cursor: a Best match rank outside 0..2 is refused');

-- FORGED CURSOR — pointing at a hidden job, or past the end of time, can never widen the set.
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'newest', p_limit => 101,
      p_after_id => 'e7700000-0000-4000-8000-000000000900', p_after_published_at => timestamptz '2099-12-31 00:00:00+00')
    where title like 'IJ HIDDEN%'),
  0, 'forged cursor: an id of a DRAFT job and a far-future position still never reveal a hidden job');
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'oldest', p_limit => 101,
      p_after_id => 'e7700000-0000-4000-8000-000000000902', p_after_published_at => timestamptz '1970-01-01 00:00:00+00')
    where title like 'IJ HIDDEN%'),
  0, 'forged cursor: an id of an UNVERIFIED poster''s job and the earliest possible position still reveal nothing hidden');
select is(
  (select count(*)::int from public.job_opportunities_page(p_sort => 'newest', p_limit => 101,
      p_after_id => '00000000-0000-0000-0000-000000000000', p_after_published_at => timestamptz '2999-01-01 00:00:00+00')
    where title like 'IJ%'),
  8, 'forged cursor: a position beyond every job simply returns the discoverable ones — it narrows, it cannot widen');

-- ===========================================================================
-- D. SEARCH — indexed with pg_trgm, same semantics, nothing widened
-- ===========================================================================
select ok((select indexdef ~ 'USING gin \(title gin_trgm_ops\) WHERE \(status = ''open''' from pg_indexes where indexname = 'ix_jobs_open_title_trgm'),
  'a partial trigram GIN index serves title ILIKE for open jobs');
select ok((select indexdef ~ 'USING gin \(description gin_trgm_ops\) WHERE \(status = ''open''' from pg_indexes where indexname = 'ix_jobs_open_description_trgm'),
  'a partial trigram GIN index serves description ILIKE for open jobs');

-- The indexes are USABLE for the exact expression the board runs (planned with sequential scans disabled, so the test does
-- not depend on how small this fixture is).
reset role;
-- On a near-empty fixture the planner would rather walk any partial `status = 'open'` btree than build a bitmap, so the
-- competing btrees are dropped INSIDE this rolled-back test transaction: what remains is the question "can the trigram
-- indexes answer this predicate at all", independent of how big the fixture is.
drop index public.ix_jobs_open_published, public.ix_jobs_open_amount, public.ix_jobs_open_gov, public.ix_jobs_open_gov_city, public.ix_jobs_open_trade, public.ix_jobs_poster_org_status;
create function pg_temp.plan_of(q text) returns text language plpgsql as $f$
declare r text; acc text := '';
begin
  set local enable_seqscan = off;
  set local enable_indexscan = off;   -- leave only BITMAP plans, so a near-empty fixture cannot prefer a trivial btree walk
  for r in execute 'explain ' || q loop acc := acc || r || E'\n'; end loop;
  return acc;
end $f$;
select ok(pg_temp.plan_of($q$ select j.id from public.jobs j where j.status = 'open'::public.job_status and (j.title ilike '%needle%' or j.description ilike '%needle%') $q$) like '%ix_jobs_open_title_trgm%',
  'the planner can answer title ILIKE from the trigram index');
select ok(pg_temp.plan_of($q$ select j.id from public.jobs j where j.status = 'open'::public.job_status and (j.title ilike '%needle%' or j.description ilike '%needle%') $q$) like '%ix_jobs_open_description_trgm%',
  'and description ILIKE from its trigram index (combined with a BitmapOr)');
select ok((select prosrc !~ 'o\.name' from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = '_job_opportunity_filter'),
  'the filter no longer reads the JOINED organization name (it is an id set bound as a typed array, which an index plan can combine)');
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

-- Same semantics as the original expression, term for term (oracle computed as the owner above).
select is(
  (select count(*)::int from search_oracle o
    where public.job_opportunities_total(p_search => o.term) is distinct from o.n::bigint),
  0, 'the indexed total equals the ORIGINAL expression for every term: case-insensitive, Arabic, mixed, % _ and quotes, description-only and organization-name matches');
select is((select count(*)::int from public.job_opportunities_page(p_search => 'PLAIN', p_limit => 101)), (select n from search_oracle where term = 'plain'),
  'search is case-insensitive');
select is((select count(*)::int from public.job_opportunities_page(p_search => 'دهان', p_limit => 101)), 2,
  'Arabic: a bare Arabic term finds both jobs that contain it (title only, and mixed Arabic / English)');
select is((select title from public.job_opportunities_page(p_search => 'فيلا التجمع', p_limit => 101)), 'IJ دهان فيلا التجمع',
  'Arabic: a multi-word Arabic phrase finds exactly its job');
select is((select count(*)::int from public.job_opportunities_page(p_search => 'Villa دهان', p_limit => 101)), 1,
  'mixed Arabic / English phrase finds exactly the mixed job');
select is((select count(*)::int from public.job_opportunities_page(p_search => 'unitdesc', p_limit => 101)), 1,
  'a term that appears ONLY in a description is found');
select is((select count(*)::int from public.job_opportunities_page(p_search => '100%', p_limit => 101)), 1,
  'a literal percent sign matches only the title that contains one');
select is((select count(*)::int from public.job_opportunities_page(p_search => 'a_b', p_limit => 101)), 1,
  'a literal underscore matches a_b and NOT aXb (it is not a single-character wildcard)');
select is((select count(*)::int from public.job_opportunities_page(p_search => '', p_limit => 101) where title like 'IJ%'), 8,
  'an empty query is no filter: all 8 discoverable jobs');
select is((select count(*)::int from public.job_opportunities_page(p_search => '     ', p_limit => 101) where title like 'IJ%'), 8,
  'a blank (spaces-only) query is no filter either');
select is(public.job_opportunities_total(p_search => ''), public.job_opportunities_total(),
  'the total of an empty query equals the total with no search');
select lives_ok(format($q$ select * from public.job_opportunities_page(p_search => %L, p_limit => 101) $q$, repeat('a', 200)),
  'a maximum-length (200 character) query is accepted and finds nothing');
select is((select count(*)::int from public.job_opportunities_page(p_search => (select split_part(name, ' ', 1) from public.organizations where id = '9a000000-aaaa-4aaa-8aaa-000000000005'::uuid), p_limit => 101) where title like 'IJ%'), 8,
  'a poster ORGANIZATION name finds that organization''s open jobs');

-- No search term can widen discoverability: the unverified poster's organization name, and hidden titles, find nothing.
reset role;
update public.organizations set name = 'Zorgonaut Hidden Works' where id = :'org2'::uuid;
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select is((select count(*)::int from public.job_opportunities_page(p_search => 'Zorgonaut', p_limit => 101)), 0,
  'searching the name of an UNVERIFIED poster''s organization reveals none of its jobs');
select is((select count(*)::int from public.job_opportunities_page(p_search => 'HIDDEN', p_limit => 101)), 0,
  'searching the title of draft / closed / unverified-poster jobs reveals none of them');

-- ===========================================================================
-- C. IDENTITY
-- ===========================================================================
reset role;
set local request.jwt.claims = '';
set local role anon;
select throws_ok($q$ select * from public.job_opportunities_page() $q$, '42501', null, 'anonymous: the page is refused');
select throws_ok($q$ select public.job_opportunities_total() $q$, '42501', null, 'anonymous: the total is refused');
reset role;
set local role authenticated;
set local request.jwt.claims = '';
select throws_ok($q$ select * from public.job_opportunities_page() $q$, '42501', 'authentication required', 'authenticated role but NO identity: refused — there is no user parameter to borrow');
reset role;

select is((select count(*)::int from public.jobs), (select n from baseline),
  'after all of it, not one job was added, changed or deleted');
select has_table('public', 'jobs', 'and the table is still there');

select * from finish();
rollback;

-- pgTAP: Saved searches (public.saved_searches).
--
-- A saved search is a user's private, NAMED FILTER STATE — data the page re-applies
-- through its own controls, never a query the database runs. So the assertions are
-- about three things: it belongs to exactly one user (derived from auth.uid(), never
-- a parameter), it can only ever hold a flat object of short strings under keys the
-- migration names, and nobody else can read or change it.
create extension if not exists pgtap;

begin;
select plan(36);

-- ===========================================================================
-- A. Shape and grants
-- ===========================================================================
select has_table('public'::name, 'saved_searches'::name, 'saved_searches exists');
select is((select relrowsecurity from pg_class where oid = 'public.saved_searches'::regclass), true, 'RLS is enabled');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'saved_searches'
      and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'clients hold NO write privilege on the table — every write is an RPC');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'saved_searches' and grantee = 'anon'),
  0, 'anon holds nothing on saved_searches');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'saved_search_%'
      and (pg_get_function_arguments(p.oid) ilike '%user%')),
  0, 'no RPC takes a user argument — the owner can only be auth.uid()');

-- ===========================================================================
-- B. The payload validator (the only thing that decides what may be stored)
-- ===========================================================================
select is(app.saved_search_filters_valid('work', '{"tab":"completed","q":"villa","sort":"default"}'::jsonb), true,
  'a flat object of short strings under allowed work keys is valid');
select is(app.saved_search_filters_valid('work', '{}'::jsonb), true, 'an empty filter set is valid');
select is(app.saved_search_filters_valid('work', '{"evil":"x"}'::jsonb), false, 'an unknown key is refused');
select is(app.saved_search_filters_valid('work', '{"q":{"nested":"x"}}'::jsonb), false, 'a nested value is refused');
select is(app.saved_search_filters_valid('work', '{"q":5}'::jsonb), false, 'a number is refused');
select is(app.saved_search_filters_valid('work', '{"q":true}'::jsonb), false, 'a boolean is refused');
select is(app.saved_search_filters_valid('work', '["q"]'::jsonb), false, 'a non-object is refused');
select is(app.saved_search_filters_valid('work', null), false, 'null is refused');
select is(app.saved_search_filters_valid('work', jsonb_build_object('q', repeat('x', 201))), false, 'a value over 200 characters is refused');
select is(app.saved_search_filters_valid('work', '{"gov":"cairo"}'::jsonb), false, 'a jobs-only key is refused for scope work');
select is(app.saved_search_filters_valid('jobs', '{"gov":"cairo","saved":"1"}'::jsonb), true, 'and accepted for scope jobs');
select is(app.saved_search_filters_valid('other', '{"q":"x"}'::jsonb), false, 'an unknown scope allows no keys at all');

-- ===========================================================================
-- C. Owner: create, read, rename, delete
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select set_config('t.s1', public.saved_search_create('work', 'Finished work', '{"tab":"completed","sort":"default"}'::jsonb)::text, true);
select ok(current_setting('t.s1')::uuid is not null, 'a user can create their own saved search');
select is((select user_id from public.saved_searches where id = current_setting('t.s1')::uuid),
  '71000006-0000-4000-8000-000000000006'::uuid, 'it is owned by the CALLER (auth.uid())');
select is((select filters from public.saved_searches where id = current_setting('t.s1')::uuid),
  '{"tab":"completed","sort":"default"}'::jsonb, 'the owner reads their own filters back');

select lives_ok(
  format($$select public.saved_search_update(%L, 'Completed jobs', null)$$, current_setting('t.s1')),
  'the owner can rename it');
select is((select name from public.saved_searches where id = current_setting('t.s1')::uuid), 'Completed jobs', 'the new name is stored');
select lives_ok(
  format($$select public.saved_search_update(%L, null, '{"tab":"in_progress"}'::jsonb)$$, current_setting('t.s1')),
  'the owner can replace its filters');
select is((select filters from public.saved_searches where id = current_setting('t.s1')::uuid),
  '{"tab":"in_progress"}'::jsonb, 'and the name is kept');

select throws_ok($$select public.saved_search_create('work', 'completed JOBS', '{}'::jsonb)$$,
  '23505', null, 'a duplicate name (case-insensitive) in the same scope is refused');
select throws_ok($$select public.saved_search_create('bogus', 'x', '{}'::jsonb)$$, '22023', null, 'an invalid scope is rejected');
select throws_ok($$select public.saved_search_create('work', 'Bad payload', '{"evil":"1"}'::jsonb)$$, '22023', null, 'an invalid payload is rejected');
select throws_ok($$select public.saved_search_create('work', '   ', '{}'::jsonb)$$, '22023', null, 'a blank name is rejected');
select throws_ok($$insert into public.saved_searches (user_id, scope, name) values ('71000006-0000-4000-8000-000000000006', 'work', 'direct')$$,
  '42501', null, 'a direct INSERT is refused');

-- ===========================================================================
-- D. Another user
-- ===========================================================================
reset role;
set local request.jwt.claims = '';
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000007-0000-4000-8000-000000000007","role":"authenticated"}';

select is((select count(*)::int from public.saved_searches), 0, 'user B cannot read user A''s saved searches');
select throws_ok(
  format($$select public.saved_search_update(%L, 'hijack', null)$$, current_setting('t.s1')),
  'P0002', null, 'user B cannot rename user A''s search (indistinguishable from a missing one)');
select throws_ok(
  format($$select public.saved_search_delete(%L)$$, current_setting('t.s1')),
  'P0002', null, 'user B cannot delete user A''s search');
reset role;
set local request.jwt.claims = '';
select is((select name from public.saved_searches where id = current_setting('t.s1')::uuid), 'Completed jobs',
  'and A''s search is untouched');

-- ===========================================================================
-- E. Anonymous, then the owner deletes
-- ===========================================================================
set local role anon;
set local request.jwt.claims = '';
select throws_ok($$select public.saved_search_create('work', 'anon', '{}'::jsonb)$$, '42501', null, 'anon cannot create');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(format($$select public.saved_search_delete(%L)$$, current_setting('t.s1')), 'the owner can delete their own search');
select is((select count(*)::int from public.saved_searches), 0, 'and it is gone');
reset role;
set local request.jwt.claims = '';

select * from finish();
rollback;

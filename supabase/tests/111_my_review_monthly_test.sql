-- pgTAP: public.my_review_monthly (20261021090006) - the Installer Reviews trend card.
create extension if not exists pgtap;

begin;
select plan(6);

select ok(has_function_privilege('authenticated', 'public.my_review_monthly(integer)', 'execute'), 'authenticated may call it');
select ok(not has_function_privilege('anon', 'public.my_review_monthly(integer)', 'execute'), 'anon may not');
select is((select prosecdef from pg_proc where oid = 'public.my_review_monthly(integer)'::regprocedure), false,
  'SECURITY INVOKER: it sees exactly what my_job_reviews shows the caller');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f111","role":"authenticated"}';
select is((select count(*)::int from public.my_review_monthly(6)), 6, 'six months are returned');
select is((select count(*)::int from public.my_review_monthly(99)), 12, 'never more than twelve');
select ok((select bool_and(reviews = 0 and average is null) from public.my_review_monthly(3)),
  'a caller without reviews gets zero counts and NULL averages (never 0.0)');
reset role;

select * from finish();
rollback;

-- pgTAP: the poster-side applicants projection (Increment 7's one DB change).
--
-- This view exists because Increment 6 shipped both installer-facing read seams
-- and no poster-facing one, and the poster is the party that has to decide. It
-- widens §11 deliberately — identity for every applicant rather than only for
-- publicly listed ones — so the tests that matter most are the ones proving the
-- widening stopped exactly where it was meant to.
--
-- Three failures this file is written to catch:
--
--   1. THE VIEW BECOMING A LEAK. It reads `profiles` and `individual_onboarding`
--      through a definer, which is the only way this data is reachable at all —
--      so it is also the only place a contact detail could escape. Section C
--      asserts the projected column list, by name, against the whole of what
--      those two tables hold.
--   2. AN APPLICANT SEEING A COMPETITOR. The view is scoped by membership of the
--      POSTING organization, and an installer is not one. Section B checks that
--      the person who applied gets nothing back.
--   3. A LINK THAT 404s. public_profile_id must be null for a hidden profile,
--      because the UI renders "View profile" from exactly that column.
create extension if not exists pgtap;

begin;
select plan(22);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated, anon;

-- Two applicants on the seeded OPEN job: Sayed (LISTED) and Ibrahim, whom this
-- test hides on purpose to exercise the unlisted case that is the real default.
update public.profiles set public_profile_status = 'hidden'
  where user_id = '71000008-0000-4000-8000-000000000008';

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001', 'Available next week.')$$,
  'a listed installer applies');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000008-0000-4000-8000-000000000008","role":"authenticated"}';
select lives_ok(
  $$select public.job_application_submit('f1000001-0000-4000-8000-000000000001', 'Free from Sunday.')$$,
  'an installer with a HIDDEN profile applies too');

-- ===========================================================================
-- A. The poster reads the queue
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.job_applicants
    where job_id = 'f1000001-0000-4000-8000-000000000001')::int,
  2, 'the posting organization sees both applications');

select is(
  (select display_name from public.job_applicants
    where job_id = 'f1000001-0000-4000-8000-000000000001'
      and display_name like 'Sayed%'),
  'Sayed Abdel-Rahman', 'a listed applicant is named');

-- THE POINT OF THE WIDENING. Under a literal reading of §11 this row would be
-- blank, and the poster would be choosing between a name and an anonymous entry.
select isnt(
  (select display_name from public.job_applicants
    where job_id = 'f1000001-0000-4000-8000-000000000001'
      and note = 'Free from Sunday.'),
  null, 'AND SO IS AN APPLICANT WHOSE PROFILE IS NOT PUBLIC');

select isnt(
  (select public_profile_id from public.job_applicants
    where display_name like 'Sayed%'),
  null, 'the listed applicant carries a profile id, so the UI can link to it');

select is(
  (select public_profile_id from public.job_applicants
    where note = 'Free from Sunday.'),
  null, 'the hidden one carries NULL — the UI must not offer a link that 404s');

select is(
  (select primary_trade_key from public.job_applicants where display_name like 'Sayed%'),
  'marble_granite', 'the applicant''s canonical primary trade is projected');

select cmp_ok(
  (select array_length(trade_keys, 1) from public.job_applicants where display_name like 'Sayed%'),
  '>', 0, 'and their full active trade list');

select is(
  (select status::text from public.job_applicants where display_name like 'Sayed%'),
  'submitted', 'with the candidacy''s own state');

-- A colleague who cannot DECIDE can still read the queue — the same shape chat
-- uses, and the reason the nav gate is the union of the two capabilities.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000008-0000-4000-8000-000000000008","role":"authenticated"}';

select is(
  (select count(*) from public.job_applicants
    where job_id = 'f1000001-0000-4000-8000-000000000001')::int,
  2, 'an org member without job.manage still reads the queue');

-- ===========================================================================
-- B. And nobody else reads it
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*) from public.job_applicants)::int,
  0, 'AN APPLICANT SEES NOTHING HERE — not even their own row, let alone a rival''s');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';

select is(
  (select count(*) from public.job_applicants)::int,
  0, 'an unrelated organization sees nothing');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select is(
  (select count(*) from public.job_applicants)::int, 0, 'a consumer sees nothing');

reset role;
set local role anon;
select throws_ok(
  $$select * from public.job_applicants$$,
  '42501', null, 'anon cannot read it at all');

-- ===========================================================================
-- C. The projection, asserted by name
-- ===========================================================================
reset role;

-- Not one contact channel, address, radius or private preference, checked
-- against the vocabulary of the two tables the definer actually reads.
select is(
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'job_applicants'
      and column_name ~ 'phone|email|contact|address|travel|radius|consumer|availability|deleted')::int,
  0, 'the projection exposes no contact, address, travel or private-preference column');

-- applicant_user_id is deliberately absent: the UI needs a profile id to link
-- with and an application id to act on, and never the user id itself.
select hasnt_column('public'::name, 'job_applicants'::name, 'applicant_user_id'::name,
  'and never the applicant''s user id');

-- `information_schema.columns.column_name` is a `sql_identifier`, whose collation
-- is "C", and this database's default provider is ICU — so comparing it against
-- a bare literal raises "could not determine which collation to use" and aborts
-- the whole transaction rather than failing one assertion. `collate "C"` on the
-- cast is what makes the comparison well-defined.
select is(
  (select array_agg(c.n order by c.n) from (
     select column_name::text collate "C" as n
       from information_schema.columns
      where table_schema = 'public' and table_name = 'job_applicants') c),
  array['application_id', 'applied_at', 'avatar_media_id', 'decided_at',
        'decision_reason', 'display_name', 'headline', 'job_id', 'note',
        'primary_trade_key', 'public_profile_id', 'service_areas', 'status',
        'trade_keys', 'years_experience'],
  'the projected column list is exactly these fifteen and nothing else');

-- It is a READ seam. Every decision still goes through the Increment 6 RPCs.
-- Named grantees, the way test 14 does it: the view's OWNER always holds every
-- privilege on it, so an unqualified count asserts something that can never be
-- true and hides the claim that matters — no CLIENT role can write here.
select is(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'job_applicants'
      and grantee in ('anon', 'authenticated', 'service_role')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))::int,
  0, 'no client role can write through the view');

select ok(
  (select c.reloptions::text[] @> array['security_invoker=true']
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'job_applicants'),
  'it is a security_invoker view, so the Advisor sweep in test 29 stays clean');

select ok(
  (select p.proconfig @> array['search_path=""'] and p.prosecdef
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_job_applicants'),
  'the reader is SECURITY DEFINER with search_path pinned empty');

-- O5 holds here too: the view PROJECTS trades for display and filters nothing by
-- them. A poster sorting their queue by "matching trade" would be the same gate
-- arriving through the back door.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_job_applicants'
      and pg_get_functiondef(p.oid) ~* 'where[^$]*j\.trade_id')::int,
  0, 'the applicants projection does not filter on the job''s trade (O5)');

select finish();
rollback;

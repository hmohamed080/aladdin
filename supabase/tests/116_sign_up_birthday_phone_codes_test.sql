-- Sign-up birthday stays private and WhatsApp verification codes are service_role only.
create extension if not exists pgtap;
begin;
select plan(7);

select ok(
  not has_column_privilege('authenticated', 'public.users', 'birth_date', 'UPDATE')
  and not has_column_privilege('anon', 'public.users', 'birth_date', 'SELECT'),
  'clients cannot write a birthday and anon cannot read one');

select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'profile_public_directory' and column_name = 'birth_date'),
  0, 'the public directory never exposes a birthday');

select is(
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_users_birth_date_range'),
  'CHECK (((birth_date IS NULL) OR (birth_date >= ''1900-01-01''::date)))',
  'a birthday before 1900 is rejected');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.phone_verification_challenges'::regclass),
  'verification codes have RLS on');

select is(
  (select count(*)::int from pg_policy where polrelid = 'public.phone_verification_challenges'::regclass),
  0, 'no client policy exists on verification codes');

select ok(
  not has_table_privilege('anon', 'public.phone_verification_challenges', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.phone_verification_challenges', 'SELECT,INSERT,UPDATE,DELETE')
  and has_table_privilege('service_role', 'public.phone_verification_challenges', 'SELECT,INSERT,UPDATE,DELETE'),
  'only service_role reaches verification codes');

select throws_ok(
  $$ insert into public.phone_verification_challenges (purpose, phone_e164, code_hash, expires_at)
     values ('sign_up', '+201012345678', repeat('a', 64), now() + interval '2 hours') $$,
  '23514', null, 'a code cannot live longer than 30 minutes');

select * from finish();
rollback;

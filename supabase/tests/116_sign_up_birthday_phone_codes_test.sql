-- Sign-up birthday stays private and the registration flow keeps no WhatsApp code table (R2).
create extension if not exists pgtap;
begin;
select plan(5);

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
  to_regclass('public.phone_verification_challenges') is null,
  'the registration flow keeps no code table of its own (R2: the phone verification authority is the only one)');

select ok(
  to_regclass('app.phone_verification_challenges') is not null
  and not has_table_privilege('service_role', 'app.phone_verification_challenges', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'app.phone_verification_challenges', 'SELECT')
  and not has_table_privilege('authenticated', 'app.phone_verification_challenges', 'SELECT'),
  'the authority table exists and no client role, not even service_role, can touch it directly');

select * from finish();
rollback;

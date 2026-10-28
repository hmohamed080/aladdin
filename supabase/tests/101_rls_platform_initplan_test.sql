-- The platform-staff read policies evaluate `app.is_platform('support')` once per
-- statement (InitPlan), not per row (migration 20261021090012). Same access:
-- support staff still read across tenants; nobody else gains anything.
create extension if not exists pgtap;
begin;
select no_plan();

select is((select count(*)::int from pg_policies
            where coalesce(qual, '') || coalesce(with_check, '') ~ 'app\.is_platform\('
              and qual !~ '^\(\s*SELECT app\.is_platform\('), 0,
  'every platform-staff policy calls is_platform through a scalar sub-select');
select is((select count(*)::int from pg_policies where qual ~ '^\(\s*SELECT app\.is_platform\('), 21,
  'the twenty-one platform-staff read policies are still present (user_specialties added, ADR-0026)');

insert into public.user_service_areas(user_id, governorate_key)
values ('11111111-1111-4111-8111-111111111111', 'cairo'),
       ('22222222-2222-4222-8222-222222222222', 'giza');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select array_agg(governorate_key) from public.user_service_areas
            where governorate_key in ('cairo', 'giza')), array['cairo'],
  'an ordinary user still reads only their own service areas');
select is((select count(*)::int from public.trades), (select count(*)::int from public.trades where is_active),
  'an ordinary user reads only active trades');

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is((select count(*)::int from public.user_service_areas where governorate_key in ('cairo', 'giza')), 2,
  'platform staff still read every service area');
reset role;
select count(*) as all_trades from public.trades \gset
set local role authenticated;
select is((select count(*) from public.trades), :'all_trades'::bigint, 'platform staff still read every trade, inactive included');

select * from finish();
rollback;

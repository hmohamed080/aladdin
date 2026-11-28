-- profile_set_gender: self-only write path for profiles.gender.
create extension if not exists pgtap;
begin;
select no_plan();
select ok(not has_column_privilege('authenticated', 'public.profiles', 'gender', 'update'), 'no direct gender writes');
select ok(not has_function_privilege('anon', 'public.profile_set_gender(text)', 'execute'), 'anonymous caller cannot set gender');
update auth.users set email_confirmed_at = now() where id = '70000010-0000-4000-8000-000000000010';
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}';
select lives_ok($$select public.profile_set_gender('female')$$, 'caller saves their own gender');
select is((select gender from public.profiles where user_id = auth.uid()), 'female', 'gender is stored');
select throws_ok($$select public.profile_set_gender('other')$$, '22023', null, 'unsupported gender is rejected');
select lives_ok($$select public.profile_set_gender('')$$, 'gender can be cleared');
select is((select gender from public.profiles where user_id = auth.uid()), null, 'cleared gender is NULL');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::integer from public.profiles where user_id <> auth.uid() and gender is not null), 0, 'another caller sees no gender');
reset role;
select * from finish();
rollback;

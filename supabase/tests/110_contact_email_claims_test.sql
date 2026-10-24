-- pgTAP: optional contact email (20261024090006).
--
--   A. Start: receipt bound to the address; only a SHA-256 is stored; pending reserves nothing; abuse limits
--   B. Peek never writes; confirm needs an explicit action, the owner, an unexpired single-use token
--   C. Global uniqueness: another account's sign-in email or verified contact is never claimed (generic answers), and a
--      sign-in email can never take another account's verified contact email (the Auth write fails closed)
--   D. Own confirmed sign-in email verifies at once; release needs a receipt for a verified email
--   E. Support: contacts.support_release only; audited with ids only
--   F. Boundaries: private table, service_role-only functions, the legacy public.contacts untouched
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(40);

\set u1  '72000000-0000-4000-8000-000000000001'
\set u2  '72000000-0000-4000-8000-000000000002'
\set u3  '72000000-0000-4000-8000-000000000003'
\set op  '72000000-0000-4000-8000-000000000004'
\set nop '72000000-0000-4000-8000-000000000005'

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  (:'u1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ce1@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Chi One"}', now(), now()),
  (:'u2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ce2@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Chi Two"}', now(), now()),
  (:'u3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p201072000003@craftsman-login.aladdin.invalid',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Chi Craft"}', now(), now()),
  (:'op', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ce-op@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Chi Operator"}', now(), now()),
  (:'nop', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ce-nop@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Chi Support"}', now(), now());
insert into public.admin_role_assignments (user_id, role_id)
select :'op', r.id from public.admin_roles r where r.key = 'super_admin';
insert into public.admin_role_assignments (user_id, role_id)
select :'nop', r.id from public.admin_roles r where r.key = 'support';

-- Receipts exactly as account_password_confirm issues them (the password check is covered by 109).
create function pg_temp.rc(p_user uuid, p_op text, p_target text) returns uuid language sql security definer as $$
  insert into app.reauth_receipts (user_id, operation, target, created_at, expires_at)
  values (p_user, p_op, p_target, clock_timestamp(), clock_timestamp() + interval '60 seconds') returning id $$;
create function pg_temp.tok(t text) returns bytea language sql immutable as $$ select extensions.digest(t, 'sha256') $$;
-- Rate-limit clock: move this user's attempt counters back (tests only).
create function pg_temp.age_events(p_user uuid, p_by interval) returns void language sql as $$
  update app.contact_claim_events set created_at = created_at - p_by where user_id = p_user $$;
create function pg_temp.start(p_user uuid, p_email text, p_token text) returns text language sql as $$
  select s.outcome from public.contact_email_claim_start(p_user, pg_temp.rc(p_user, 'contact_email.set', lower(btrim(p_email))), p_email, pg_temp.tok(p_token), 1800) s $$;

-- ===========================================================================
-- A. Start
-- ===========================================================================
select throws_ok(format('select * from public.contact_email_claim_start(%L, %L, %L, %L, 1800)', :'u1',
                        pg_temp.rc(:'u1', 'contact_email.set', 'other@probe.test'), 'mine@probe.test', pg_temp.tok('t0')),
  '42501', 'password confirmation required', 'a receipt for another address cannot start this claim');
select throws_ok(format('select * from public.contact_email_claim_start(%L, %L, %L, %L, 1800)', :'u1', gen_random_uuid(), 'mine@probe.test', pg_temp.tok('t0')),
  '42501', 'password confirmation required', 'an unknown receipt is refused');
select is(pg_temp.start(:'u1', 'Mine@Probe.test ', 'tA'), 'sent', 'u1 starts a claim (the address is normalized)');
select is((select email || '|' || status from app.contact_emails where user_id = :'u1'), 'mine@probe.test|pending', 'one pending claim, lower-case');
select is((select token_hash from app.contact_emails where user_id = :'u1'), pg_temp.tok('tA'), 'only the SHA-256 of the token is stored');
select is(pg_temp.start(:'u2', 'mine@probe.test', 'tB'), 'sent', 'a PENDING claim reserves nothing: u2 may also start one for the same address');
select is(pg_temp.start(:'u1', 'mine2@probe.test', 'tC'), 'limited', 'a second claim inside 60 seconds is limited');
select pg_temp.age_events(:'u1', interval '2 minutes');
select is(pg_temp.start(:'u1', 'mine2@probe.test', 'tC'), 'sent', 'after 60 seconds a new claim supersedes the pending one');
select is((select count(*)::int from app.contact_emails where user_id = :'u1' and status = 'pending'), 1, 'still one pending claim');
select is((select release_reason from app.contact_emails where user_id = :'u1' and token_hash is null and status = 'released'), 'superseded', 'the old one was superseded');
select pg_temp.age_events(:'u1', interval '2 minutes');
select is(pg_temp.start(:'u1', 'mine3@probe.test', 'tD'), 'sent', 'third start in the hour');
select pg_temp.age_events(:'u1', interval '2 minutes');
select is(pg_temp.start(:'u1', 'mine4@probe.test', 'tE'), 'limited', 'the 4th start inside one hour is limited');
select pg_temp.age_events(:'u1', interval '2 hours');
select is(pg_temp.start(:'u1', 'mine@probe.test', 'tA2'), 'sent', 'u1 restarts its claim for mine@probe.test');

-- ===========================================================================
-- B. Peek and confirm
-- ===========================================================================
select is((select state || '|' || masked_email from public.contact_email_token_peek(:'u1', pg_temp.tok('tA2'))), 'valid|m***@probe.test', 'peek: valid, masked');
select is((select status from app.contact_emails where token_hash = pg_temp.tok('tA2')), 'pending', 'peek wrote nothing');
select is((select state from public.contact_email_token_peek(:'u2', pg_temp.tok('tA2'))), 'invalid', 'peek: another user''s token reads invalid');
select throws_ok(format('select * from public.contact_email_claim_confirm(%L, %L, false)', :'u1', pg_temp.tok('tA2')), '22023', null,
  'confirm refuses without an explicit user action');
select is((select outcome from public.contact_email_claim_confirm(:'u2', pg_temp.tok('tA2'), true)), 'invalid', 'another user cannot confirm it');
select is((select outcome from public.contact_email_claim_confirm(:'u1', pg_temp.tok('tA2'), true)), 'verified', 'the owner confirms by an explicit action');
select is((select outcome from public.contact_email_claim_confirm(:'u1', pg_temp.tok('tA2'), true)), 'invalid', 'the token is single use');
select is((select count(*)::int from app.contact_emails where token_hash = pg_temp.tok('tA2')), 0, 'and its hash is erased');

-- ===========================================================================
-- C. Global uniqueness
-- ===========================================================================
select is((select outcome from public.contact_email_claim_confirm(:'u2', pg_temp.tok('tB'), true)), 'unavailable',
  'u2''s older pending claim for the same address can no longer be confirmed: it is closed, nothing of u1''s is touched');
select is((select status from app.contact_emails where user_id = :'u1' and status = 'verified'), 'verified', 'u1 keeps its verified contact email');
select pg_temp.age_events(:'u2', interval '2 minutes');
select is(pg_temp.start(:'u2', 'mine@probe.test', 'tB2'), 'suppressed', 'starting a claim for another account''s verified contact email is suppressed (no mail)');
select pg_temp.age_events(:'u2', interval '2 minutes');
select is(pg_temp.start(:'u2', 'ce-op@probe.test', 'tB3'), 'suppressed', 'starting a claim for another account''s SIGN-IN email is suppressed');
select is((select count(*)::int from app.contact_emails where user_id = :'u2' and status = 'pending'), 0, 'a suppressed start creates nothing');
select throws_ok($$ update auth.users set email = 'mine@probe.test' where id = '72000000-0000-4000-8000-000000000002' $$, '23505', 'contact is unavailable',
  'a sign-in email change onto another account''s verified contact email fails closed');
select throws_ok($$ insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
                    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'MINE@probe.test', now(), now()) $$,
  '23505', 'contact is unavailable', 'a sign-up with that address (any case) fails closed');
select lives_ok($$ update auth.users set email = 'ce2-new@probe.test' where id = '72000000-0000-4000-8000-000000000002' $$,
  'an unrelated sign-in email change is unaffected');

-- ===========================================================================
-- D. Own sign-in email; release
-- ===========================================================================
select is(pg_temp.start(:'op', 'ce-op@probe.test', 'tO'), 'verified', 'the account''s own confirmed sign-in email verifies at once');
select is((select verified_via from app.contact_emails where user_id = :'op' and status = 'verified'), 'auth_email', 'recorded as the sign-in identity');
select throws_ok(format('select * from public.contact_email_release(%L, null)', :'u1'), '42501', 'password confirmation required',
  'removing a VERIFIED contact email needs a password receipt');
select is((select outcome from public.contact_email_release(:'u1', pg_temp.rc(:'u1', 'contact_email.remove', 'self'))), 'removed', 'with the receipt it is removed');
select is((select count(*)::int from app.contact_emails where user_id = :'u1' and email is not null), 0, 'and no address is kept');

-- ===========================================================================
-- E. Support
-- ===========================================================================
select throws_ok(format('select * from public.contact_email_support_find(%L, %L)', :'nop', 'ce-op@probe.test'), '42501', 'operator is not authorized',
  'Support without contacts.support_release cannot look up a holder');
select is((select count(*)::int from public.contact_email_support_find(:'op', 'ce-op@probe.test')), 1, 'Super Admin finds the claim');
select throws_ok(format('select public.contact_email_support_release(%L, %L, %L, %L)', :'op',
                        (select id from app.contact_emails where user_id = :'op' and status = 'verified'), 'CASE-1', 'own contact, disputed'),
  '42501', 'an operator cannot release their own contact', 'an operator cannot release their own claim');
select ok(not exists (select 1 from public.audit_log where action like 'contact.%' and metadata::text like '%@%'), 'no contact audit event carries an address');

-- ===========================================================================
-- F. Boundaries
-- ===========================================================================
select ok(not has_table_privilege('authenticated', 'app.contact_emails', 'select')
      and not has_table_privilege('service_role', 'app.contact_emails', 'select'), 'the claims table is private');
select ok(not has_function_privilege('authenticated', 'public.contact_email_claim_start(uuid,uuid,text,bytea,integer)', 'execute')
      and not has_function_privilege('anon', 'public.contact_email_claim_confirm(uuid,bytea,boolean)', 'execute')
      and has_function_privilege('service_role', 'public.contact_email_status(uuid)', 'execute'), 'the functions are service_role only');

select * from finish();
rollback;

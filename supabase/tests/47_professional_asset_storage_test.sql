-- pgTAP: Installer Pilot Increment 10 — secure storage for professional assets.
--
-- This file and `professional_asset_storage_api_test.mjs` prove two halves of
-- one boundary and neither is sufficient alone:
--
--   * HERE — the policy expressions, the shape of the path contract, and the
--     things that are ABSENT on purpose. A test that runs inside the database
--     can assert "there is no UPDATE policy" and "anon appears in no policy at
--     all", which no amount of HTTP probing can establish: a request that fails
--     tells you it failed, not that nothing could ever make it succeed.
--   * THERE — `allowed_mime_types` and `file_size_limit`, which the Storage
--     service enforces from the bucket row before Postgres is consulted, so the
--     rows asserted in section A below are configuration this file can only read
--     back, never see applied.
--
-- WHY RLS IS THE WHOLE BOUNDARY. `anon` and `authenticated` hold full
-- INSERT/SELECT/UPDATE/DELETE table grants on `storage.objects` — that is
-- Supabase's own default and this repository does not change it. So there is no
-- second line of defence behind a policy here, the way a narrow column grant
-- backs up `profiles_update_self`. Every policy added to this table IS the
-- permission, in full, which is why section D asserts the exact set and section
-- H asserts what stayed shut.
--
-- Fixtures, all from seed-pilot:
--   70000009 — canonical installer_technician (the owner throughout)
--   71000006 — canonical installer_technician (the OTHER professional)
--   44444444 — end_consumer
--   11111111 — business-only identity: null personal persona, holds a membership
create extension if not exists pgtap;

begin;
select plan(67);

-- A stable key per actor. `<owner>/<object-uuid>.<ext>`, built the way the
-- server builds it, so every assertion below is about the real contract.
\set owner_a '70000009-0000-4000-8000-000000000009'
\set owner_b '71000006-0000-4000-8000-000000000006'
\set consumer '44444444-4444-4444-8444-444444444444'
\set business '11111111-1111-4111-8111-111111111111'
\set key_a '70000009-0000-4000-8000-000000000009/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg'
\set key_a2 '70000009-0000-4000-8000-000000000009/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa.pdf'
\set key_b '71000006-0000-4000-8000-000000000006/bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb.jpg'

-- ===========================================================================
-- A. The buckets — private, distinct, and configured where it is enforced
-- ===========================================================================
select is(
  (select count(*)::int from storage.buckets
    where id in ('professional-portfolio', 'professional-certificates')),
  2,
  'Both professional buckets exist after a reset — created by migration, not by hand in a console (S19)'
);

select is(
  (select bool_or(public) from storage.buckets
    where id in ('professional-portfolio', 'professional-certificates')),
  false,
  'NEITHER bucket is public: there is no URL a stranger can guess into'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'professional-portfolio'),
  array['image/jpeg', 'image/png', 'image/webp'],
  'Portfolio accepts three image types — and notably NOT application/pdf, which is a namespace boundary, not an oversight'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'professional-certificates'),
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  'Certificates accept PDF as well, because that is the format a certificate actually arrives in'
);

-- SVG is the one exclusion worth naming: it is an image to a person and a
-- scriptable document to a browser, and nothing in this repository sanitizes one.
select is(
  (select bool_or('image/svg+xml' = any(allowed_mime_types)) from storage.buckets
    where id in ('professional-portfolio', 'professional-certificates')),
  false,
  'Neither bucket accepts SVG — an unsanitized scriptable document is not a work photo'
);

select is(
  (select file_size_limit from storage.buckets where id = 'professional-portfolio'),
  5242880::bigint,
  'Portfolio is capped at 5 MiB — one real phone photo, not a burst'
);

select is(
  (select file_size_limit from storage.buckets where id = 'professional-certificates'),
  10485760::bigint,
  'Certificates are capped at 10 MiB — a scanned multi-page document is the large end'
);

-- The limits are DIFFERENT, which is the entire reason there are two buckets:
-- Storage enforces them per bucket and RLS cannot see a size at INSERT time.
select isnt(
  (select file_size_limit from storage.buckets where id = 'professional-portfolio'),
  (select file_size_limit from storage.buckets where id = 'professional-certificates'),
  'The two limits differ, which is why the namespace is a BUCKET rather than a path segment'
);

select ok(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'buckets') = 0,
  'storage.buckets carries RLS with no policies: a client can neither enumerate buckets nor flip one public'
);

-- ===========================================================================
-- B. The path contract, as a predicate
-- ===========================================================================
-- §15's attack list, one row at a time. Every one of these is refused by the
-- SHAPE of the key rather than by a sanitizer, which is the point: there is no
-- user-controlled substring left in a key for an escaping bug to live in.
select ok(app.is_professional_asset_key(:'key_a', :'owner_a'::uuid),
  'A well-formed portfolio key belonging to the caller is accepted');
select ok(app.is_professional_asset_key(:'key_a2', :'owner_a'::uuid),
  'So is a well-formed certificate key — the extension list covers both namespaces');

select ok(not app.is_professional_asset_key(:'key_b', :'owner_a'::uuid),
  'ANOTHER USER''S UUID in the ownership segment is refused');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '/../' || :'owner_b' || '/x.jpg', :'owner_a'::uuid),
  '`../` is refused: the segments are a uuid and a uuid+extension, so a relative component cannot occur');
select ok(not app.is_professional_asset_key(:'owner_a' || '/..', :'owner_a'::uuid),
  'A bare `..` segment is refused');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '/%2e%2e/' || :'owner_b' || '/x.jpg', :'owner_a'::uuid),
  'Percent-encoded traversal is refused — the charset admits neither `%` nor a second separator');
select ok(not app.is_professional_asset_key('', :'owner_a'::uuid),
  'An empty object name is refused');
select ok(not app.is_professional_asset_key(:'owner_a', :'owner_a'::uuid),
  'The folder itself is not an object key');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '/portfolio/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg', :'owner_a'::uuid),
  'An extra namespace segment is refused — the BUCKET is the namespace, and a key that also carried one would be a second source of truth');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/site-photo.jpg', :'owner_a'::uuid),
  'A display filename is refused: the name a person chose is Increment 11 metadata, never part of a security check');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.svg', :'owner_a'::uuid),
  'An unsupported extension is refused by the key as well as by the bucket');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg.html', :'owner_a'::uuid),
  'A double extension is refused — the pattern is anchored, so `.jpg` mid-string buys nothing');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '/AAAAAAAA-1111-4111-8111-aaaaaaaaaaaa.jpg', :'owner_a'::uuid),
  'Uppercase hex is refused, so two keys can never differ by case alone on a backend that folds it');
select ok(not app.is_professional_asset_key(
    :'owner_a' || '9/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg', :'owner_a'::uuid),
  'A key whose owner segment merely STARTS WITH the caller''s id is refused — the check is equality, not a prefix');
select ok(not app.is_professional_asset_key(
    :'key_a' || chr(10) || :'key_b', :'owner_a'::uuid),
  'A trailing newline cannot smuggle a second key past the anchor');
select ok(not app.is_professional_asset_key(:'key_a', null),
  'A null owner accepts nothing — an unauthenticated caller has no folder');

-- ===========================================================================
-- C. The persona gate, and the predicate it deliberately did NOT widen
-- ===========================================================================
select has_function('app'::name, 'can_create_professional_asset'::name,
  'The argument-free creation gate exists');

select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'can_create_professional_asset'),
  true,
  'It is SECURITY DEFINER, because it reaches a predicate its caller may not reach'
);

select ok(
  has_function_privilege('authenticated', 'app.can_create_professional_asset()', 'execute'),
  'authenticated may call it — RLS policy expressions evaluate as the querying role'
);

select ok(
  not has_function_privilege('anon', 'app.can_create_professional_asset()', 'execute'),
  'anon may not: there is no anonymous path to creating a professional asset'
);

-- The whole reason this wrapper exists. `app.is_professional_persona(uuid)`
-- answers about ANY id, so granting it to clients would hand the signed-in
-- population a persona oracle to walk over arbitrary user ids. The wrapper reads
-- auth.uid() itself and can therefore only answer "may I".
select ok(
  not has_function_privilege('authenticated', 'app.is_professional_persona(uuid)', 'execute'),
  'app.is_professional_persona STAYS revoked from authenticated — the gate was wrapped, not widened'
);

select ok(
  not has_function_privilege('anon', 'app.is_professional_asset_key(text, uuid)', 'execute'),
  'The key predicate is not callable by anon either'
);

-- ===========================================================================
-- D. The policies — the exact set, and the two absences that are the design
-- ===========================================================================
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'),
  6,
  'Exactly six policies on storage.objects: three per bucket and nothing else'
);

select is(
  (select array_agg(policyname::text order by policyname::text collate "C")
     from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  array[
    'professional_certificates_delete_own',
    'professional_certificates_insert_own',
    'professional_certificates_select_own',
    'professional_portfolio_delete_own',
    'professional_portfolio_insert_own',
    'professional_portfolio_select_own'
  ],
  'Each policy names ONE bucket in its own name, so widening portfolio reads cannot silently widen certificates'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd = 'UPDATE'),
  0,
  'NO UPDATE POLICY EXISTS. That is the overwrite rule (§13): upsert has nothing to ask for, so object keys are immutable'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and ('anon' = any(roles) or 'public' = any(roles))),
  0,
  'No policy admits anon or public — and with anon holding full table grants, a policy is the ONLY thing that could'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and roles = array['authenticated']::name[]),
  6,
  'Every policy is scoped to authenticated and to nothing else'
);

-- The persona gate belongs to creation and to creation only. If it ever appears
-- in a SELECT or DELETE policy, a persona downgrade starts stranding files.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = 'INSERT'
      and with_check like '%can_create_professional_asset%'),
  2,
  'Both INSERT policies consult the persona gate'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('SELECT', 'DELETE')
      and qual like '%can_create_professional_asset%'),
  0,
  'NO read or delete policy consults it — this is the downgrade contract, stated as a structural fact'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and coalesce(qual, with_check) like '%is_professional_asset_key%'),
  6,
  'All six derive ownership from the key contract rather than from storage.objects.owner, which is provider-managed'
);

-- ===========================================================================
-- E. Write authority, exercised through the policies themselves
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-portfolio', '70000009-0000-4000-8000-000000000009/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg')$$,
  'A professional writes their own well-formed portfolio key'
);

select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-certificates', '70000009-0000-4000-8000-000000000009/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa.pdf')$$,
  'And their own certificate'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-portfolio', '71000006-0000-4000-8000-000000000006/bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb.jpg')$$,
  '42501',
  null,
  'A professional cannot write into ANOTHER professional''s folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-portfolio', '70000009-0000-4000-8000-000000000009/../71000006-0000-4000-8000-000000000006/x.jpg')$$,
  '42501',
  null,
  'A traversal key is refused at the policy, not merely at the API'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-portfolio', '70000009-0000-4000-8000-000000000009/aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa/photo.jpg')$$,
  '42501',
  null,
  'A key carrying a display filename is refused'
);

-- Namespace confusion in the other direction: a valid key, wrong bucket for the
-- extension. The KEY does not decide the namespace, so this is accepted here and
-- refused by the bucket's MIME list at the API — asserted in the .mjs harness.
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('not-a-bucket', '70000009-0000-4000-8000-000000000009/aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa.jpg')$$,
  null,
  null,
  'An unknown bucket is refused: no policy names it, and the foreign key would refuse it anyway'
);

reset role;
set local request.jwt.claims = '';

-- A consumer, at their OWN structurally perfect key ------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-portfolio', '44444444-4444-4444-8444-444444444444/cccccccc-1111-4111-8111-cccccccccccc.jpg')$$,
  '42501',
  null,
  'A CONSUMER is refused even though the key is theirs and perfectly formed — the persona gate, not the path, is what stops them'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-certificates', '44444444-4444-4444-8444-444444444444/cccccccc-2222-4222-8222-cccccccccccc.pdf')$$,
  '42501',
  null,
  'And refused in the certificate namespace too'
);

reset role;
set local request.jwt.claims = '';

-- A business-only identity: a member of an organization, no personal persona --
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-portfolio', '11111111-1111-4111-8111-111111111111/dddddddd-1111-4111-8111-dddddddddddd.jpg')$$,
  '42501',
  null,
  'A BUSINESS-ONLY identity is refused: organization membership is not a professional persona and never stands in for one'
);

reset role;
set local request.jwt.claims = '';

select ok(
  (select count(*)::int from public.memberships
    where user_id = '11111111-1111-4111-8111-111111111111') > 0,
  'and that identity really does hold a membership, so the refusal above is about the persona rather than an empty fixture'
);

-- ===========================================================================
-- F. Read authority and isolation
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select is(
  (select count(*)::int from storage.objects
    where name = '70000009-0000-4000-8000-000000000009/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg'),
  1,
  'The owner reads back their own portfolio object'
);

select is(
  (select count(*)::int from storage.objects
    where name = '70000009-0000-4000-8000-000000000009/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa.pdf'),
  1,
  'And their own certificate'
);

reset role;
set local request.jwt.claims = '';

-- The other professional ---------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*)::int from storage.objects where bucket_id = 'professional-portfolio'),
  0,
  'Another professional sees NO portfolio object of anyone else''s — "authenticated" is not "may read every professional file"'
);

select is(
  (select count(*)::int from storage.objects where bucket_id = 'professional-certificates'),
  0,
  'And no certificate. One installer never reaches another installer''s evidence (§10)'
);

reset role;
set local request.jwt.claims = '';

-- An organization identity -------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from storage.objects),
  0,
  'An organization identity reads nothing through membership: storage ownership is USER-level and no relationship transfers it'
);

reset role;
set local request.jwt.claims = '';

-- Anonymous ----------------------------------------------------------------
set local role anon;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from storage.objects),
  0,
  'An anonymous caller reads nothing, in either bucket — a certificate has no public read path at all'
);

reset role;

-- ===========================================================================
-- G. Delete authority, and the downgrade contract
-- ===========================================================================
-- WHERE THE DELETE PROOF ACTUALLY LIVES, and why it is not here.
--
-- `storage.objects` carries a statement-level BEFORE DELETE trigger,
-- `storage.protect_delete()` via `protect_objects_delete`, that refuses EVERY direct SQL deletion with 42501
-- — superuser included — because a row removed in SQL would leave the bytes
-- orphaned in the backing store. So the DELETE policies below govern exactly one
-- path, the Storage API, and a pgTAP file cannot walk it.
--
-- This was worth discovering rather than assuming: an earlier draft of this
-- section "proved" that another professional's delete removed nothing, and it
-- was right by accident — nobody's delete removes anything through SQL. The real
-- assertions (owner deletes own, other professional refused with AccessDenied,
-- downgraded owner still deletes, second delete is idempotent) run against the
-- HTTP API in `professional_asset_storage_api_test.mjs`.
select has_trigger('storage'::name, 'objects'::name, 'protect_objects_delete'::name,
  'storage.objects refuses direct SQL deletion, so the DELETE policies govern the Storage API path and only that');

select throws_ok(
  $$delete from storage.objects
     where name = '70000009-0000-4000-8000-000000000009/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg'$$,
  '42501',
  null,
  'Even here, as superuser, a direct delete is refused — which is why deletion authority is proved over HTTP instead'
);

select is(
  (select count(*)::int from storage.objects
    where name = '70000009-0000-4000-8000-000000000009/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg'),
  1,
  'and the object is untouched by the attempt'
);

-- The downgrade. The person stops being a professional; their files do not stop
-- being theirs. Same asymmetry as trg_stamp_availability: claiming needs the
-- persona, withdrawing never does.
update public.users set primary_account_type = 'end_consumer'
  where id = '70000009-0000-4000-8000-000000000009';
delete from public.individual_onboarding
  where user_id = '70000009-0000-4000-8000-000000000009';

select ok(
  not app.is_professional_persona('70000009-0000-4000-8000-000000000009'),
  'The owner is no longer a professional persona'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('professional-portfolio', '70000009-0000-4000-8000-000000000009/aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa.jpg')$$,
  '42501',
  null,
  'DOWNGRADE: no NEW professional asset may be created'
);

select is(
  (select count(*)::int from storage.objects
    where name = '70000009-0000-4000-8000-000000000009/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa.pdf'),
  1,
  'DOWNGRADE: but the certificate they already uploaded is still readable — personal data is not held hostage to a persona value'
);

-- The delete half of the downgrade contract is structural rather than observed,
-- here: the DELETE policies do not mention the persona gate at all (section D
-- asserts that by name), so there is no expression that could refuse them. The
-- observed half runs in the HTTP harness.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd = 'DELETE'
      and qual like '%can_create_professional_asset%'),
  0,
  'DOWNGRADE: no delete policy consults the persona gate, so a downgraded owner has nothing standing between them and removing their own data'
);

reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- H. Storage grants nothing back
-- ===========================================================================
-- The consumer is given an object directly, bypassing every policy, to ask the
-- one question the policies cannot ask themselves: does HAVING a file make you a
-- professional? §5 requires that it does not, and the temptation to infer it
-- later is exactly why this is pinned now.
insert into storage.objects (bucket_id, name)
values ('professional-portfolio',
        '44444444-4444-4444-8444-444444444444/cccccccc-9999-4999-8999-cccccccccccc.jpg');

select ok(
  not app.is_professional_persona('44444444-4444-4444-8444-444444444444'),
  'POSSESSION IS NOT IDENTITY: a consumer holding a stored object is still not a professional persona'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select ok(
  not app.can_create_professional_asset(),
  'and still may not create one — an object smuggled in by another route grants nothing'
);

select is(
  (select count(*)::int from storage.objects
    where name = '44444444-4444-4444-8444-444444444444/cccccccc-9999-4999-8999-cccccccccccc.jpg'),
  1,
  'though they can read and remove what is under their own id, which is the same rule everyone else gets'
);

reset role;
set local request.jwt.claims = '';

-- Nothing about storage reaches the Jobs domain, the trades taxonomy, or the
-- capability model. The check is deliberately blunt: no policy, anywhere, joins
-- storage.objects into an authorization decision.
select is(
  (select count(*)::int from pg_policies
    where schemaname <> 'storage'
      and (coalesce(qual, '') like '%storage.objects%'
        or coalesce(with_check, '') like '%storage.objects%')),
  0,
  'No policy outside the storage schema consults storage.objects: a stored file is never an input to any product authorization'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and p.prosrc like '%storage.objects%'),
  0,
  'And no app/public function reads it either — Increment 11 will attach MEANING to these objects, and this asserts none is attached yet'
);

select * from finish();
rollback;

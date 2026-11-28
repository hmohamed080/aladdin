-- Owner decision 2026-10-19: historical Supabase portfolio photos and avatars are
-- deleted, never migrated. These checks prove the purge is scoped (cutoff, provider,
-- namespace), resumable, service-role only, and that it never touches certificates,
-- business-verification documents, products, accounts or profiles.
create extension if not exists pgtap;
begin;
select no_plan();

\set pro '70000009-0000-4000-8000-000000000009'
\set other '70000003-0000-4000-8000-000000000003'
\set cutoff '''2026-10-01T00:00:00Z''::timestamptz'
\set old_pub 'f1000000-0000-4000-8000-000000000001'
\set old_priv 'f1000000-0000-4000-8000-000000000002'
\set new_item 'f1000000-0000-4000-8000-000000000003'
\set r2_item 'f1000000-0000-4000-8000-000000000004'
\set old_av 'f1000000-0000-4000-8000-000000000005'
\set new_av 'f1000000-0000-4000-8000-000000000006'
\set other_av 'f1000000-0000-4000-8000-000000000007'

-- ---------------------------------------------------------------- privileges
select ok(not has_function_privilege(r, f, 'EXECUTE'), format('%s cannot call %s', r, f))
  from unnest(array['anon','authenticated']) r,
       unnest(array['public.media_historical_purge_inventory(timestamptz)',
                    'public.media_historical_purge_retire(timestamptz,integer)',
                    'public.media_historical_purge_storage_removed(text,text)',
                    'public.media_historical_purge_finalize(integer)']) f;
select ok(has_function_privilege('service_role', f, 'EXECUTE'), format('service_role can call %s', f))
  from unnest(array['public.media_historical_purge_inventory(timestamptz)',
                    'public.media_historical_purge_retire(timestamptz,integer)',
                    'public.media_historical_purge_storage_removed(text,text)',
                    'public.media_historical_purge_finalize(integer)']) f;
select ok(not has_table_privilege(r, 'public.media_historical_purge_journal', 'SELECT'), format('%s cannot read the journal', r))
  from unnest(array['anon','authenticated']) r;
select ok(not has_table_privilege('service_role', 'public.media_historical_purge_journal', 'INSERT')
  and not has_table_privilege('service_role', 'public.media_historical_purge_journal', 'UPDATE')
  and not has_table_privilege('service_role', 'public.media_historical_purge_journal', 'DELETE'),
  'the journal is written only through the purge functions');
select throws_ok($$select public.media_historical_purge_retire(now() + interval '1 day', 10)$$, '22023', null,
  'a future cutoff is refused (new uploads can never be selected by accident)');
select throws_ok($$select public.media_historical_purge_inventory(null)$$, '22023', null, 'a missing cutoff is refused');

-- ---------------------------------------------------------------- fixtures
-- Start from a known state: no seeded media in the two namespaces.
delete from public.portfolio_items;
update public.profiles set avatar_media_id = null;
delete from public.avatar_uploads;

insert into public.portfolio_items(id, owner_user_id, object_key, content_type, state, visibility, title, created_at) values
 (:'old_pub',  :'pro', :'old_pub'  || '.jpg', 'image/jpeg', 'ready', 'public',  'Old published', '2026-09-01'),
 (:'old_priv', :'pro', :'old_priv' || '.jpg', 'image/jpeg', 'ready', 'private', 'Old private',   '2026-09-02'),
 (:'new_item', :'pro', :'new_item' || '.jpg', 'image/jpeg', 'ready', 'public',  'New (after cutoff)', '2026-10-05'),
 (:'r2_item',  :'pro', :'r2_item'  || '.jpg', 'image/jpeg', 'ready', 'public',  'Already on R2', '2026-09-03');
insert into public.media_storage_locations(namespace, object_key, owner_user_id, provider, content_type, size_bytes, sha256, verified_at)
values ('portfolio', :'r2_item' || '.jpg', :'pro', 'r2', 'image/jpeg', 100, repeat('a', 64), now()),
       ('portfolio', :'old_priv' || '.jpg', :'pro', 'supabase', 'image/jpeg', 100, null, null);
insert into public.avatar_uploads(id, owner_user_id, object_key, content_type, state, created_at) values
 (:'old_av',   :'pro',   :'old_av'   || '.jpg', 'image/jpeg', 'ready', '2026-09-01'),
 (:'new_av',   :'other', :'new_av'   || '.jpg', 'image/jpeg', 'ready', '2026-10-05'),
 (:'other_av', :'other', :'other_av' || '.jpg', 'image/jpeg', 'deleted', '2026-08-01');
update public.profiles set avatar_media_id = :'old_av' where user_id = :'pro';
update public.profiles set avatar_media_id = :'new_av' where user_id = :'other';

insert into storage.objects(bucket_id, name, created_at, metadata) values
 ('professional-portfolio', :'old_pub'  || '.jpg', '2026-09-01', '{"size": 1000}'),
 ('professional-portfolio', :'old_priv' || '.jpg', '2026-09-02', '{"size": 2000}'),
 ('professional-portfolio', :'new_item' || '.jpg', '2026-10-05', '{"size": 3000}'),
 ('professional-portfolio', 'f1000000-0000-4000-8000-0000000000aa.jpg', '2026-09-04', '{"size": 4000}'), -- orphan
 ('avatars', :'old_av' || '.jpg', '2026-09-01', '{"size": 500}'),
 ('avatars', :'new_av' || '.jpg', '2026-10-05', '{"size": 600}'),
 ('avatars', :'other_av' || '.jpg', '2026-08-01', '{"size": 700}'),
 ('professional-certificates', :'pro' || '/f1000000-0000-4000-8000-0000000000bb.pdf', '2026-08-01', '{"size": 800}');
insert into public.professional_certificates(owner_user_id, object_path, content_type, state, title, created_at)
values (:'pro', :'pro' || '/f1000000-0000-4000-8000-0000000000bb.pdf', 'application/pdf', 'ready', 'Old certificate', '2026-08-01');

select count(*) as users_before from public.users \gset
select count(*) as products_before from public.products \gset
select count(*) as profiles_before from public.profiles \gset

-- ---------------------------------------------------------------- inventory
set local role service_role;
select is((public.media_historical_purge_inventory(:cutoff)->'portfolio'->>'rows')::int, 2,
  'inventory: two historical portfolio rows (the R2 row and the post-cutoff row are excluded)');
select is((public.media_historical_purge_inventory(:cutoff)->'avatar'->>'rows')::int, 2,
  'inventory: two historical avatar rows (current and tombstoned), not the post-cutoff one');
select is((public.media_historical_purge_inventory(:cutoff)->'protected'->>'certificates')::int, 1,
  'inventory reports certificates as protected');

-- ---------------------------------------------------------------- step 1: retire
create temp table _batch on commit drop as select * from public.media_historical_purge_retire(:cutoff, 100);
reset role;
select set_eq($$select namespace || ':' || object_key from _batch$$,
  array['portfolio:f1000000-0000-4000-8000-000000000001.jpg', 'portfolio:f1000000-0000-4000-8000-000000000002.jpg',
        'portfolio:f1000000-0000-4000-8000-0000000000aa.jpg',
        'avatar:f1000000-0000-4000-8000-000000000005.jpg', 'avatar:f1000000-0000-4000-8000-000000000007.jpg'],
  'retire returns exactly the historical portfolio photos, avatars and the orphan');
select ok(not exists(select 1 from _batch where bucket not in ('avatars','professional-portfolio')),
  'retire never names a certificate or verification bucket');
select is((select state::text || '/' || visibility::text from public.portfolio_items where id = :'old_pub'), 'deleted/private',
  'a published historical item is hidden at once');
select is((select public_portfolio_media_key from public.public_portfolio_media_key(:'old_pub')), null,
  'the public key resolver no longer serves the retired item');
select is((select avatar_media_id from public.profiles where user_id = :'pro'), null, 'the historical avatar is unlinked');
select is((select avatar_media_id from public.profiles where user_id = :'other'), :'new_av'::uuid,
  'a post-cutoff avatar stays current');
select is((select state::text from public.portfolio_items where id = :'new_item'), 'ready', 'a post-cutoff item is untouched');
select is((select state::text from public.portfolio_items where id = :'r2_item'), 'ready', 'an R2 item is untouched');
select is((select count(*)::int from public.audit_log where action = 'media.historical_purge'), 1, 'retire is audited once per batch');

set local role service_role;
select is((select count(*)::int from public.media_historical_purge_retire(:cutoff, 100)), 5,
  'a rerun before removal resumes the same five objects and journals nothing new');
reset role;
select is((select count(*)::int from public.media_historical_purge_journal), 5, 'the journal holds five rows');

-- ---------------------------------------------------------------- step 2: Storage removal
set local role service_role;
select is(public.media_historical_purge_storage_removed('portfolio', :'old_pub' || '.jpg'), false,
  'removal cannot be confirmed while the object is still stored');
select throws_ok($$select public.media_historical_purge_storage_removed('certificate', 'x')$$, '42501', null,
  'an unjournaled object cannot be marked removed');
reset role;
-- The worker removes objects through the Storage API; simulated here.
set local storage.allow_delete_query = 'true';
delete from storage.objects o using public.media_historical_purge_journal j
 where o.bucket_id = j.bucket and o.name = j.object_key and j.object_key <> :'old_priv' || '.jpg';
set local role service_role;
select is((select count(*)::int from public.media_historical_purge_journal j
            where public.media_historical_purge_storage_removed(j.namespace, j.object_key)), 4,
  'four removals confirmed; the one still stored is not');

-- ---------------------------------------------------------------- step 3: finalize
select is(public.media_historical_purge_finalize(100), 4, 'finalize purges only confirmed rows');
reset role;
select is((select count(*)::int from public.portfolio_items where id in (:'old_pub', :'old_priv')), 1,
  'the confirmed portfolio row is gone; the unconfirmed one stays as a hidden tombstone');
select is((select count(*)::int from public.avatar_uploads where id in (:'old_av', :'other_av')), 0, 'historical avatar rows are gone');
select is((select count(*)::int from public.media_storage_locations where namespace = 'portfolio' and object_key = :'old_priv' || '.jpg'), 1,
  'a location row survives until its object is confirmed gone');

-- Resume: the remaining object is removed and the next run finishes it.
delete from storage.objects where bucket_id = 'professional-portfolio' and name = :'old_priv' || '.jpg';
set local role service_role;
select is((select count(*)::int from public.media_historical_purge_retire(:cutoff, 100)), 1, 'the next run resumes the one leftover');
select ok(public.media_historical_purge_storage_removed('portfolio', :'old_priv' || '.jpg'), 'its removal is confirmed');
select is(public.media_historical_purge_finalize(100), 1, 'and finalized');
select is((select count(*)::int from public.media_historical_purge_retire(:cutoff, 100)), 0, 'nothing is left to purge');
select is((public.media_historical_purge_inventory(:cutoff)->'journal'->>'purged')::int, 5, 'the journal shows five purged');
reset role;

-- ---------------------------------------------------------------- preserved
select is((select count(*)::int from public.media_storage_locations where namespace = 'portfolio' and object_key = :'old_priv' || '.jpg'), 0,
  'the Supabase location row is removed with its item');
select is((select count(*)::int from public.portfolio_items where id in (:'new_item', :'r2_item')), 2, 'new and R2 items remain');
select is((select count(*)::int from storage.objects where bucket_id = 'professional-certificates'), 1, 'the certificate object remains');
select is((select count(*)::int from public.professional_certificates where title = 'Old certificate'), 1, 'the certificate row remains');
select is((select count(*)::int from storage.objects where bucket_id = 'avatars'), 1, 'only the post-cutoff avatar object remains');
select is((select count(*) from public.users), :'users_before'::bigint, 'no account is removed');
select is((select count(*) from public.profiles), :'profiles_before'::bigint, 'no profile is removed');
select is((select count(*) from public.products), :'products_before'::bigint, 'no product is removed');

select * from finish();
rollback;

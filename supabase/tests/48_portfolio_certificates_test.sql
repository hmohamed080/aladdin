-- pgTAP: Installer Pilot Increment 11 — Portfolio and Certificates.
--
-- Increment 10 proved a person may store a file. This proves what the file
-- MEANS, and the two halves of that are not symmetrical:
--
--   PORTFOLIO is the only thing in this product a stranger may read. Every
--   assertion about it is really the same assertion asked from a different angle:
--   an item is public when it is explicitly public AND finished AND its owner's
--   profile is currently listed, and the moment any one of those stops being
--   true the photo is gone — from the projection and from Storage, in the same
--   instant, without touching what the owner chose.
--
--   CERTIFICATES are the opposite: there is no public path at all, and the most
--   important assertions in section J are about things that DO NOT EXIST — no
--   verification column, no approval state, no public projection, no anon grant.
--   S2 says the platform vouches for nothing, and a boolean nobody owns is
--   exactly how that decays.
--
-- WHY THE PORTFOLIO OBJECT KEY IS OPAQUE, since it is the one thing Increment 10
-- did differently: a published photo must be resolvable for a signed-out visitor,
-- and the Next server holds the same anon key the browser does. An owner-prefixed
-- key would therefore have published `users.id`, which
-- `17_public_directory_hardening_test` keeps out of every public projection by
-- name. Section K asserts the replacement is strictly stronger, not merely
-- different.
--
-- Fixtures, all from seed-pilot. Profile ids are generated per reset, so every
-- one is looked up rather than written down:
--   70000009 — installer_technician, profile LISTED   (the owner throughout)
--   71000006 — installer_technician, profile LISTED   (the other professional)
--   44444444 — end_consumer, profile hidden
--   11111111 — business-only identity, holds a membership
create extension if not exists pgtap;

begin;
select plan(91);

\set owner_a '70000009-0000-4000-8000-000000000009'
\set owner_b '71000006-0000-4000-8000-000000000006'
\set consumer '44444444-4444-4444-8444-444444444444'
\set business '11111111-1111-4111-8111-111111111111'

-- ===========================================================================
-- A. The shape, and the columns that are deliberately absent
-- ===========================================================================
select has_table('public'::name, 'portfolio_items'::name, 'portfolio_items exists');
select has_table('public'::name, 'professional_certificates'::name, 'professional_certificates exists');

select col_default_is('public'::name, 'portfolio_items'::name, 'visibility'::name,
  'private', 'A portfolio item is PRIVATE by default, at the column (S1)');
select col_default_is('public'::name, 'portfolio_items'::name, 'state'::name,
  'pending', 'and PENDING by default: metadata exists before bytes do');

-- The constraint that makes "bytes alone never make an item public" structural
-- rather than a rule every writer has to remember.
select throws_ok(
  format($$insert into public.portfolio_items
      (owner_user_id, object_key, content_type, title, visibility, state)
    values (%L, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg', 'image/png', 'x', 'public', 'pending')$$,
    :'owner_a'),
  '23514',
  null,
  'A row cannot be PUBLIC and unfinished at the same time: the table refuses it, so no writer can produce one'
);

select throws_ok(
  format($$insert into public.portfolio_items (owner_user_id, object_key, content_type, title)
    values (%L, '%s/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg', 'image/png', 'x')$$,
    :'owner_a', :'owner_a'),
  '23514',
  null,
  'An OWNER-PREFIXED portfolio key is refused by the table: the key contract for this bucket is opaque now, and the constraint is what keeps the old shape from creeping back'
);

select throws_ok(
  format($$insert into public.portfolio_items (owner_user_id, object_key, content_type, title)
    values (%L, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.pdf', 'application/pdf', 'x')$$,
    :'owner_a'),
  '23514',
  null,
  'A PDF is not portfolio work (S4): JPEG, PNG and WebP only, asserted at the table as well as at the bucket'
);

-- S2, stated as an absence. These are the columns that would quietly turn
-- self-declared evidence into a platform claim.
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'professional_certificates'
      and (column_name::text collate "C" like '%verif%'
        or column_name::text collate "C" like '%approv%'
        or column_name::text collate "C" like '%review%'
        or column_name::text collate "C" like '%public%'
        or column_name::text collate "C" like '%visib%')),
  0,
  'professional_certificates has NO verification, approval, review, public or visibility column — the platform vouches for nothing and cannot be read as vouching (S2)'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'portfolio_items'
      and column_name::text collate "C" in ('rating', 'score', 'views', 'likes', 'client_approved')),
  0,
  'and portfolio_items carries no rating, score, view count, like or client approval: none of those is this increment'
);

-- ===========================================================================
-- B. Reads — ownership, and the cleanup state nobody can see
-- ===========================================================================
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'portfolio_items'),
  'RLS is on for portfolio_items');
select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'professional_certificates'),
  'RLS is on for professional_certificates');

-- No client DML grant on either table: the RPCs are the entire write path, which
-- is the rule this repository has applied to every domain since Sales.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('portfolio_items', 'professional_certificates')
      and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'Neither table grants INSERT, UPDATE or DELETE to a client role: RLS answers who may READ, the RPCs answer who may CHANGE'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('portfolio_items', 'professional_certificates')
      and grantee = 'anon'),
  0,
  'and anon holds no grant of any kind on either — a certificate is not reachable by an anonymous caller through any route'
);

-- Named separately because it is the one Supabase hands out by default and the
-- one RLS does not cover: `alter default privileges` grants TRUNCATE on every
-- new public table to anon, and a TRUNCATE ignores row level security entirely.
-- Enabling RLS without stripping the defaults first would have left anon able to
-- empty both tables. This assertion is what caught exactly that during Increment
-- 11, so it stays.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('portfolio_items', 'professional_certificates')
      and privilege_type = 'TRUNCATE'
      and grantee <> 'postgres'),
  0,
  'NOBODY but the owner holds TRUNCATE on either table — RLS does not restrict it, so the grant is the only thing that can'
);

-- ===========================================================================
-- C. Creation, and the one persona gate in the domain
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  $$select public.portfolio_item_create('Marble staircase', 'Fifth Settlement', 'image/png')$$,
  'A professional creates a portfolio item'
);
select lives_ok(
  $$select public.certificate_create('Safety level 2', 'Ministry of Manpower', '2024-01-10', null, 'application/pdf', 'safety.pdf')$$,
  'and a certificate'
);

select is(
  (select count(*)::int from public.portfolio_items where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  1,
  'The row is visible to its owner'
);

-- The key it generated carries nothing about who owns it. This is the assertion
-- the whole redesign exists for.
select ok(
  (select object_key !~ '/' and object_key not like '%' || owner_user_id::text || '%'
     from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  'The generated portfolio key is OPAQUE: one segment, no separator, and no occurrence of the owner id anywhere in it'
);

-- THE KEY IS INDEPENDENT OF THE ITEM ID, and that is load-bearing rather than
-- incidental. The item id is PUBLIC by necessity — it is the `<img src>` on the
-- profile page — so if the key could be derived from it, "the key is not
-- disclosed" would be an empty claim. It is a separate gen_random_uuid().
select isnt(
  (select split_part(object_key, '.', 1) from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  (select id::text from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  'The object key is NOT the item id: a public item id must not yield the storage key'
);

select ok(
  (select left(split_part(object_key, '.', 1), 8) <> left(id::text, 8)
     from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  'and shares no leading prefix with it either'
);

select ok(
  (select prosrc like '%gen_random_uuid()::text || ''.'' || v_ext%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'portfolio_item_create'),
  'The key is minted from a fresh gen_random_uuid, so it is a random value rather than a function of the row it belongs to'
);

select is(
  (select visibility::text from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  'private',
  'A brand new item is private, whatever the caller asked for — creation takes no visibility argument at all'
);
select is(
  (select state::text from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  'pending',
  'and pending, because no bytes exist yet'
);

select throws_ok(
  $$select public.portfolio_item_create('x', null, 'image/svg+xml')$$,
  '22023',
  null,
  'An SVG is refused at creation: it never gets a key, so it never gets an upload authorization'
);

reset role;
set local request.jwt.claims = '';

-- A consumer ----------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select throws_ok(
  $$select public.portfolio_item_create('mine', null, 'image/png')$$,
  '42501',
  null,
  'A CONSUMER cannot create portfolio work'
);
select throws_ok(
  $$select public.certificate_create('mine', null, null, null, 'application/pdf', null)$$,
  '42501',
  null,
  'nor a certificate'
);

reset role;
set local request.jwt.claims = '';

-- A business-only identity ---------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_ok(
  $$select public.portfolio_item_create('ours', null, 'image/png')$$,
  '42501',
  null,
  'A BUSINESS-ONLY identity cannot either: organization membership is not a professional persona and never stands in for one'
);

reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- D. Publication — three conditions, and none of them alone
-- ===========================================================================
-- Capture the ids as superuser. Reading them under another role's RLS would test
-- the subquery rather than the function, which is the trap test 46 fell into.
select set_config('test.item', (select id::text from public.portfolio_items
  where owner_user_id = '70000009-0000-4000-8000-000000000009'), true);
select set_config('test.key', (select object_key from public.portfolio_items
  where owner_user_id = '70000009-0000-4000-8000-000000000009'), true);
select set_config('test.cert', (select id::text from public.professional_certificates
  where owner_user_id = '70000009-0000-4000-8000-000000000009'), true);
select set_config('test.certpath', (select object_path from public.professional_certificates
  where owner_user_id = '70000009-0000-4000-8000-000000000009'), true);
select set_config('test.profile_a', (select id::text from public.profiles
  where user_id = '70000009-0000-4000-8000-000000000009'), true);

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select throws_ok(
  format($$select public.portfolio_item_set_visibility(%L, true)$$, current_setting('test.item')),
  '22023',
  null,
  'An UNFINISHED item cannot be published: a title and an intention are not a photo (§7)'
);

select lives_ok(
  format($$select public.portfolio_item_finalize(%L)$$, current_setting('test.item')),
  'Finalizing marks it ready...'
);
select is(
  (select visibility::text from public.portfolio_items where id = current_setting('test.item')::uuid),
  'private',
  '...and leaves it PRIVATE: bytes arriving is not a decision to show them to anyone (S1)'
);
select lives_ok(
  format($$select public.portfolio_item_finalize(%L)$$, current_setting('test.item')),
  'and finalize is idempotent, so a client that lost the response simply calls again'
);

reset role;
set local request.jwt.claims = '';

-- Still nothing public, because nothing has been published ------------------
select is(
  (select count(*)::int from public.public_portfolio_items
    where profile_id = current_setting('test.profile_a')::uuid),
  0,
  'A ready but private item is absent from the public projection'
);
select is(
  app.is_published_portfolio_object(current_setting('test.key')),
  false,
  'and Storage will not serve its object either — the two agree because they ask the same question'
);

-- Publish -------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(
  format($$select public.portfolio_item_set_visibility(%L, true)$$, current_setting('test.item')),
  'The owner publishes it'
);
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.public_portfolio_items
    where profile_id = current_setting('test.profile_a')::uuid),
  1,
  'Now it is in the public projection'
);
select is(
  app.is_published_portfolio_object(current_setting('test.key')),
  true,
  'and Storage will serve that exact object'
);
select is(
  public.public_portfolio_media_key(current_setting('test.item')::uuid),
  current_setting('test.key'),
  'and the media resolver returns its opaque key'
);

-- What the projection does NOT carry.
select is(
  (select array_agg(column_name::text order by column_name::text collate "C")
     from information_schema.columns
    where table_schema = 'public' and table_name = 'public_portfolio_items'),
  array['description', 'id', 'profile_id', 'sort_order', 'title'],
  'The public projection exposes only rendering data: no owner_user_id, no object key, no state, no visibility (§6)'
);

-- ===========================================================================
-- E. Anonymous reads exactly the published item, and nothing else
-- ===========================================================================
set local role anon;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.public_portfolio_items
    where profile_id = current_setting('test.profile_a')::uuid),
  1,
  'A signed-out visitor sees the published item'
);
select is(
  public.public_portfolio_media_key(current_setting('test.item')::uuid),
  current_setting('test.key'),
  'and may resolve its media key, which is opaque and discloses no owner'
);
-- Not "sees zero rows" but "cannot ask": with the default grants stripped there
-- is no SELECT for anon to exercise, so the refusal happens before RLS is even
-- consulted. A stronger answer than an empty result, and a different one.
select throws_ok(
  $$select count(*) from public.portfolio_items$$,
  '42501',
  null,
  'but CANNOT ASK the underlying table anything — anon holds no grant on it at all'
);
select throws_ok(
  $$select count(*) from public.professional_certificates$$,
  '42501',
  null,
  'and cannot ask certificates either'
);
select is(
  public.public_portfolio_media_key(current_setting('test.cert')::uuid),
  null,
  'THE CERTIFICATE CANNOT USE THE PORTFOLIO PUBLIC PATH: its id resolves to nothing, because it is not in that table at all'
);
select is(
  app.is_published_portfolio_object(current_setting('test.certpath')),
  false,
  'and its object key is not a published portfolio object either, so the public storage door does not open for it'
);

reset role;

-- ===========================================================================
-- F. Ordering — server-authoritative, and the same order the public reads
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  $$select public.portfolio_item_create('Second piece', null, 'image/jpeg')$$,
  'A second item is created'
);
select lives_ok(
  $$select public.portfolio_item_create('Third piece', null, 'image/webp')$$,
  'and a third'
);

select is(
  (select array_agg(title order by sort_order, created_at, id) from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  array['Marble staircase', 'Second piece', 'Third piece'],
  'New work lands at the END of the order — a person adding a photo is not reordering their gallery'
);

reset role;
set local request.jwt.claims = '';
select set_config('test.item3', (select id::text from public.portfolio_items
  where title = 'Third piece'), true);

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  format($$select public.portfolio_item_move(%L, 'up')$$, current_setting('test.item3')),
  'The owner moves the third item earlier'
);
select is(
  (select array_agg(title order by sort_order, created_at, id) from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  array['Marble staircase', 'Third piece', 'Second piece'],
  'and the order changes exactly one step'
);

select lives_ok(
  format($$select public.portfolio_item_move(%L, 'up')$$, current_setting('test.item')),
  'Moving the FIRST item up is a no-op, not an error'
);
select is(
  (select sort_order from public.portfolio_items where id = current_setting('test.item')::uuid),
  0,
  'and it stays where it was: an inert button is a better answer than an exception nobody can act on'
);

select throws_ok(
  format($$select public.portfolio_item_move(%L, 'sideways')$$, current_setting('test.item')),
  '22023',
  null,
  'An unknown direction is refused'
);

reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- G. Cross-user management is refused everywhere
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"71000006-0000-4000-8000-000000000006","role":"authenticated"}';

select is(
  (select count(*)::int from public.portfolio_items),
  0,
  'Another professional reads none of it, though they are a professional too'
);
select throws_ok(
  format($$select public.portfolio_item_update(%L, 'mine now', null)$$, current_setting('test.item')),
  '42501', null,
  'cannot edit it'
);
select throws_ok(
  format($$select public.portfolio_item_set_visibility(%L, false)$$, current_setting('test.item')),
  '42501', null,
  'cannot unpublish it'
);
select throws_ok(
  format($$select public.portfolio_item_move(%L, 'down')$$, current_setting('test.item')),
  '42501', null,
  'cannot reorder it'
);
select throws_ok(
  format($$select public.portfolio_item_delete(%L)$$, current_setting('test.item')),
  '42501', null,
  'and cannot delete it'
);
select throws_ok(
  format($$select public.certificate_update(%L, 'mine', null, null, null)$$, current_setting('test.cert')),
  '42501', null,
  'nor touch another professional''s certificate'
);
select is(
  app.owns_portfolio_object(current_setting('test.key')),
  false,
  'and the ownership helper answers false for them, which is what refuses their Storage read'
);

reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- H. Delisting withdraws the public portfolio without touching the choice
-- ===========================================================================
update public.profiles set public_profile_status = 'hidden'
  where user_id = '70000009-0000-4000-8000-000000000009';

select is(
  (select count(*)::int from public.public_portfolio_items
    where profile_id = current_setting('test.profile_a')::uuid),
  0,
  'A profile that stops being listed loses its public portfolio immediately'
);
select is(
  app.is_published_portfolio_object(current_setting('test.key')),
  false,
  'and Storage stops serving the object in the same instant — one definition of "listed", consulted by both'
);
select is(
  (select visibility::text from public.portfolio_items where id = current_setting('test.item')::uuid),
  'public',
  'but the OWNER''S CHOICE is untouched: nothing rewrote their visibility to hide the item'
);

update public.profiles set public_profile_status = 'listed'
  where user_id = '70000009-0000-4000-8000-000000000009';

select is(
  (select count(*)::int from public.public_portfolio_items
    where profile_id = current_setting('test.profile_a')::uuid),
  1,
  'so relisting restores exactly what they had chosen, with nothing to re-publish by hand'
);

-- ===========================================================================
-- I. Deletion converges, and stops being visible FIRST
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  format($$select public.portfolio_item_delete(%L)$$, current_setting('test.item')),
  'The owner deletes a published item'
);
select is(
  (select count(*)::int from public.portfolio_items where id = current_setting('test.item')::uuid),
  0,
  'It leaves the owner''s own list at once — the RLS policy excludes the cleanup state, so no query of theirs can resurface it'
);
select is(
  app.owns_portfolio_object(current_setting('test.key')),
  true,
  'but they can still DELETE its object, which is the whole point of the helper ignoring state'
);

reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.public_portfolio_items
    where profile_id = current_setting('test.profile_a')::uuid),
  0,
  'The public projection loses it immediately, before Storage has been asked anything'
);
select is(
  app.is_published_portfolio_object(current_setting('test.key')),
  false,
  'and so does the public storage door: visibility stops in Postgres, atomically, then cleanup follows'
);
select is(
  (select state::text from public.portfolio_items where id = current_setting('test.item')::uuid),
  'deleted',
  'The row survives only as a cleanup obligation, invisible to owner and public alike'
);
select is(
  (select visibility::text from public.portfolio_items where id = current_setting('test.item')::uuid),
  'private',
  'and its visibility was forced back to private, so a later bug cannot republish it'
);

set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select lives_ok(
  format($$select public.portfolio_item_purge(%L)$$, current_setting('test.item')),
  'Purge removes the row once the object is gone'
);
select lives_ok(
  format($$select public.portfolio_item_purge(%L)$$, current_setting('test.item')),
  'and purge is silent when there is nothing left — the last step of a convergent sequence has to be safe to repeat'
);
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.portfolio_items where id = current_setting('test.item')::uuid),
  0,
  'The row is gone for good'
);

-- A metadata row pointing at nothing, and an object pointed at by nothing, are
-- both inert. Neither direction of mismatch can expose bytes.
select is(
  app.is_published_portfolio_object('99999999-9999-4999-8999-999999999999.jpg'),
  false,
  'An object key no metadata row claims is not publicly readable'
);
select is(
  public.public_portfolio_media_key('99999999-9999-4999-8999-999999999999'::uuid),
  null,
  'and an item id that does not exist resolves to nothing rather than erroring'
);

-- ===========================================================================
-- J. Certificates — owner-private, and no authority anywhere
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  format($$select public.certificate_finalize(%L)$$, current_setting('test.cert')),
  'The owner finalizes their certificate'
);
select lives_ok(
  format($$select public.certificate_update(%L, 'Safety level 3', 'Ministry of Manpower', '2024-02-01', '2027-02-01')$$,
    current_setting('test.cert')),
  'edits its metadata'
);
select is(
  (select title from public.professional_certificates where id = current_setting('test.cert')::uuid),
  'Safety level 3',
  'and the edit stuck'
);

select throws_ok(
  format($$select public.certificate_update(%L, 'bad dates', null, '2027-01-01', '2024-01-01')$$,
    current_setting('test.cert')),
  '23514',
  null,
  'An expiry before its issue date is refused — the only validation performed on the CLAIM itself, because everything else is the holder''s word'
);

reset role;
set local request.jwt.claims = '';

-- There is no public certificate seam of any kind, asserted by absence.
select is(
  (select count(*)::int from information_schema.views
    where table_schema = 'public'
      and (table_name::text collate "C" like '%certificate%')),
  0,
  'NO view in public mentions certificates: there is no public projection to accidentally widen later (S2)'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and p.proname::text collate "C" like '%certificate%'
      and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'and anon may execute NO certificate function — the domain is unreachable without a session that owns the row'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and (p.proname::text collate "C" like '%verif%' and p.proname::text collate "C" like '%cert%')),
  0,
  'and there is no certificate verification function anywhere: no authority was invented, so none can be leaned on'
);

-- ===========================================================================
-- K. Persona downgrade — the same asymmetry, one more time
-- ===========================================================================
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
  $$select public.portfolio_item_create('new work', null, 'image/png')$$,
  '42501', null,
  'DOWNGRADE: no NEW portfolio work may be added'
);
select throws_ok(
  $$select public.certificate_create('new cert', null, null, null, 'application/pdf', null)$$,
  '42501', null,
  'and no new certificate'
);

select is(
  (select count(*)::int from public.portfolio_items
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  2,
  'DOWNGRADE: but everything they already had is still theirs to see'
);
select lives_ok(
  format($$select public.portfolio_item_set_visibility(%L, false)$$, current_setting('test.item3')),
  'DOWNGRADE: they can still UNPUBLISH — the control that protects their privacy is never the one taken away'
);
select lives_ok(
  format($$select public.portfolio_item_delete(%L)$$, current_setting('test.item3')),
  'DOWNGRADE: and still delete their own work'
);
select lives_ok(
  format($$select public.certificate_delete(%L)$$, current_setting('test.cert')),
  'DOWNGRADE: and their own certificate'
);
select is(
  (select count(*)::int from public.professional_certificates
    where owner_user_id = '70000009-0000-4000-8000-000000000009'),
  0,
  'DOWNGRADE: personal evidence is never held hostage to a persona value'
);

reset role;
set local request.jwt.claims = '';

-- ===========================================================================
-- L. Storage ownership is still not a product capability
-- ===========================================================================
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename not in ('portfolio_items', 'professional_certificates')
      and (coalesce(qual, '') like '%portfolio_items%'
        or coalesce(qual, '') like '%professional_certificates%')),
  0,
  'No policy on any OTHER table consults portfolio or certificate metadata: holding a photo grants nothing anywhere else in the product'
);

select * from finish();
rollback;

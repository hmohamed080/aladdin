-- ===========================================================================
-- Installer Pilot Increment 10 — secure storage for professional assets
--
-- Foundation: 20260831090003_professional_profile_edit_authority.sql
--             (app.is_professional_persona — the identity predicate)
--             20260831090004_professional_availability.sql
--             (the DOWNGRADE contract this migration reproduces)
--
-- This is the first storage in the product. Before it, `storage.buckets` held
-- zero rows and `storage.objects` had RLS enabled with NO policies at all — a
-- default-deny that was correct precisely because nothing was stored. Everything
-- below exists to keep that default and open exactly two doors through it.
--
-- IT STORES BYTES AND NOTHING ELSE. Increment 11 decides what a stored object
-- MEANS — which photo is the cover, which certificate is which, what is shown on
-- a public profile. This migration answers one question: may THIS person put
-- THIS object here, read it back, and remove it. No product metadata table is
-- created (§16), because ownership is carried by the object KEY and namespace is
-- carried by the BUCKET — a registry would duplicate both and then need its own
-- consistency rules to keep the duplicate honest.
--
-- -------------------------------------------------------------------------
-- TWO BUCKETS, NOT ONE WITH A NAMESPACE SEGMENT
-- -------------------------------------------------------------------------
-- Portfolio and certificates want DIFFERENT limits: a work photo is an image and
-- 5 MiB is generous for one; a certificate is usually a scanned PDF and 5 MiB is
-- not. Supabase enforces `allowed_mime_types` and `file_size_limit` PER BUCKET,
-- in the Storage service, before an object row exists.
--
-- That enforcement point cannot be reached from RLS. A policy on
-- `storage.objects` sees `metadata` as NULL at INSERT time — the Storage service
-- creates the row first and fills in mimetype/size after the bytes land — so a
-- single shared bucket would leave "certificates may be PDFs, portfolio may not"
-- as a rule only the application could state, i.e. a rule a caller could skip.
-- §8 asks for the narrowest RELIABLE layer. For MIME and size that layer is the
-- bucket, so there are two of them.
--
-- The second reason is §22's isolation requirement. With separate buckets, a
-- portfolio read path cannot reach a certificate by any mistake smaller than
-- naming the other bucket out loud. The policies below are deliberately NOT
-- written as one policy with `bucket_id in (...)`: a future edit that widens
-- portfolio reads has to be made twice, in a diff that names certificates, to
-- widen certificates too.
--
-- -------------------------------------------------------------------------
-- THE DOWNGRADE CONTRACT (§5), COPIED FROM AVAILABILITY ON PURPOSE
-- -------------------------------------------------------------------------
-- `trg_stamp_availability` refuses a non-professional who tries to CLAIM
-- availability and always allows WITHDRAWING it, so nobody is trapped at true by
-- a persona change. The same asymmetry is the whole shape of the policies here:
--
--   INSERT  requires the professional persona   -> no new professional uploads
--   SELECT  requires ownership only             -> they keep reading their files
--   DELETE  requires ownership only             -> they can always remove them
--
-- A person who stops being a professional keeps every file they uploaded and
-- keeps the ability to delete it. Personal data is never held hostage to a
-- persona value, and possession of a file is never evidence of a persona.
--
-- -------------------------------------------------------------------------
-- NO UPDATE POLICY. THAT IS THE OVERWRITE RULE (§13)
-- -------------------------------------------------------------------------
-- Supabase upsert needs UPDATE on `storage.objects`. Not granting it makes
-- `upsert: true` fail rather than depending on every future caller remembering
-- to pass `false`, and a second INSERT at an existing key is a duplicate-key
-- error. Object keys are therefore immutable: a replacement in Increment 11 is a
-- new object, a deliberate metadata switch, and a delete — never bytes changing
-- underneath an identity that something else already points at.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The buckets
-- ---------------------------------------------------------------------------
-- Idempotent: `db reset` replays migrations, and a bucket is a configuration row
-- rather than a schema object, so this states the intended configuration instead
-- of assuming the row's history. `public` is repeated in the update on purpose —
-- if a bucket is ever flipped public by hand, the next deploy flips it back, and
-- §19's "no undocumented console state" holds in the direction that matters.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- 5 MiB: a 12 MP phone photo lands at 3-5 MB, so one real work photo fits and
  -- an unprocessed burst or a raw export does not.
  ('professional-portfolio', 'professional-portfolio', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  -- 10 MiB: a scanned multi-page certificate is the large end of this namespace,
  -- and PDF is the format they actually arrive in.
  ('professional-certificates', 'professional-certificates', false, 10485760,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Neither list contains `image/svg+xml`, `text/html` or any executable type, and
-- that is a decision rather than an oversight (§7). An SVG is a document that can
-- carry script; serving one back to a browser from a signed URL would make the
-- storage origin an XSS surface. There is no sanitizer in this repository, so the
-- format is refused until there is one.

-- ---------------------------------------------------------------------------
-- 2. app.is_professional_asset_key — the path contract, as a predicate
-- ---------------------------------------------------------------------------
-- The object key is `<owner-uuid>/<object-uuid>.<ext>` and NOTHING ELSE. It has
-- no room for a user-supplied filename, which is why §15's whole attack list is
-- answered structurally rather than sanitized:
--
--   * `../` and encoded traversal — the two segments are a uuid and a
--     uuid+extension. Neither charset contains `.` except the single literal dot
--     before the extension, and neither contains `/`. The pattern is anchored, so
--     the key has exactly one separator and no relative component can exist.
--   * cross-user overwrite — the first segment must EQUAL the caller's uid, not
--     merely start with it or look like a uuid.
--   * empty object names — an empty string matches nothing.
--   * unsupported namespace — the bucket is the namespace, and each policy names
--     exactly one bucket.
--   * case collisions — uuid::text is lowercase and the pattern accepts only
--     lowercase, so two keys can never differ by case alone on a storage backend
--     that folds it.
--
-- The display filename the person actually chose is Increment 11's metadata. §4
-- shows it as the last path segment; it is dropped here because a name that only
-- ever gets shown has no business being load-bearing in a security check, and a
-- key with no user-controlled bytes needs no escaping rules to review later.
--
-- STABLE, not IMMUTABLE: nothing here reads the database, but marking it
-- immutable would invite the planner to fold it into an index expression, and it
-- is a policy predicate rather than a data constraint.
create or replace function app.is_professional_asset_key(p_name text, p_owner uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_owner is not null
     and p_name is not null
     -- Exact equality on the first segment. The regex below constrains its SHAPE;
     -- this constrains its VALUE, and only together do they mean "yours".
     and split_part(p_name, '/', 1) = p_owner::text
     and p_name ~ ('^[0-9a-f-]{36}/'
                || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
                || '\.(jpg|png|webp|pdf)$');
$$;

comment on function app.is_professional_asset_key(text, uuid) is
  'True when a storage object key is exactly `<p_owner>/<object-uuid>.<jpg|png|webp|pdf>`. The ownership segment must EQUAL p_owner, and the anchored pattern leaves no room for a second separator, a relative component, an empty name or a user-supplied filename — so path traversal and cross-user keys are unrepresentable rather than filtered. Used by the storage.objects policies; grants nothing by itself.';

-- Callable by `authenticated` because RLS policy expressions evaluate as the
-- querying role. It takes the owner as an argument but answers only about a
-- string the caller already holds, so it discloses nothing.
revoke execute on function app.is_professional_asset_key(text, uuid) from public;
grant execute on function app.is_professional_asset_key(text, uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. app.can_create_professional_asset — the persona gate, narrowed to SELF
-- ---------------------------------------------------------------------------
-- `app.is_professional_persona(uuid)` is deliberately revoked from every client
-- role: it answers about ANY user id, so granting it to `authenticated` would
-- hand the whole signed-in population a persona oracle they could walk over
-- arbitrary ids. This wrapper takes no argument and reads `auth.uid()` itself, so
-- the only question it can answer is "may I", which the caller already knows.
--
-- SECURITY DEFINER for the same reason `trg_stamp_availability` is: it has to
-- reach a predicate its caller is not allowed to reach.
create or replace function app.can_create_professional_asset()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_professional_persona((select auth.uid()));
$$;

comment on function app.can_create_professional_asset() is
  'True when the CALLER is an individual professional (canonical or declared persona). Argument-free wrapper over the internal app.is_professional_persona so the storage INSERT policies can consult it without granting client roles a predicate that answers about other people. Gates CREATION only: reading and deleting one''s own stored objects never consult it, so a persona downgrade cannot strand a person''s files.';

revoke execute on function app.can_create_professional_asset() from public, anon;
grant execute on function app.can_create_professional_asset() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Policies — three per bucket, written out rather than shared
-- ---------------------------------------------------------------------------
-- `to authenticated` and never `anon`: there is no anonymous path to a private
-- professional file, which is the half of §10 that must stay true even after
-- Increment 11 adds a public portfolio. A public portfolio record will be read
-- through a server-authorized short-lived URL minted for a specific object, not
-- by relaxing anything below.

-- Portfolio ------------------------------------------------------------------
drop policy if exists professional_portfolio_insert_own on storage.objects;
create policy professional_portfolio_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'professional-portfolio'
    and app.is_professional_asset_key(name, (select auth.uid()))
    and app.can_create_professional_asset()
  );

drop policy if exists professional_portfolio_select_own on storage.objects;
create policy professional_portfolio_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'professional-portfolio'
    and app.is_professional_asset_key(name, (select auth.uid()))
  );

drop policy if exists professional_portfolio_delete_own on storage.objects;
create policy professional_portfolio_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'professional-portfolio'
    and app.is_professional_asset_key(name, (select auth.uid()))
  );

-- Certificates ---------------------------------------------------------------
drop policy if exists professional_certificates_insert_own on storage.objects;
create policy professional_certificates_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'professional-certificates'
    and app.is_professional_asset_key(name, (select auth.uid()))
    and app.can_create_professional_asset()
  );

drop policy if exists professional_certificates_select_own on storage.objects;
create policy professional_certificates_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'professional-certificates'
    and app.is_professional_asset_key(name, (select auth.uid()))
  );

drop policy if exists professional_certificates_delete_own on storage.objects;
create policy professional_certificates_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'professional-certificates'
    and app.is_professional_asset_key(name, (select auth.uid()))
  );

-- No UPDATE policy on either bucket, and no policy of any kind for `anon`.
-- Both absences are the design (§13, §10) and 47_professional_asset_storage_test
-- asserts them, so adding one later is a test failure rather than a quiet change.
--
-- `storage.buckets` itself keeps RLS with no policies: a client can neither list
-- nor reconfigure buckets, so a caller cannot discover the certificate bucket's
-- existence from the browser, and cannot flip `public` from one either.

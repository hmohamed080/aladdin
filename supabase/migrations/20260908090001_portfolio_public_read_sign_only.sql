-- ===========================================================================
-- Installer Pilot Increment 11 — narrowing the one public door to SIGNING only
--
-- Foundation: 20260907090001_portfolio_and_certificates.sql
--
-- WHAT THIS FIXES, and how it was found.
--
-- `public_media_exposure_test.mjs` was written asserting that an anonymous
-- caller could enumerate nothing and read nothing directly. Both assertions
-- FAILED. In Supabase Storage a SELECT policy is consulted by every read-shaped
-- operation, so `professional_portfolio_select_published` — intended to let the
-- media route mint one signed URL — also permitted:
--
--   * LISTING the portfolio bucket, returning every published object key in bulk;
--   * a DIRECT unsigned GET of any published object at its key;
--   * a HEAD/info request revealing size and type.
--
-- None of that disclosed an owner, a filename or a private object, and every
-- byte reachable was already being served by `/p/media/<id>`. But it was a wider
-- capability than the product intended: a bulk corpus reachable without visiting
-- a single profile.
--
-- The earlier conclusion was that this could not be narrowed, because "may sign
-- object X" and "may list objects" looked like the same permission. THAT WAS
-- WRONG, and this migration is the correction: Supabase Storage publishes the
-- operation being performed, and a policy can require a specific one.
--
-- MEASURED, NOT ASSUMED. A temporary logging predicate was added to this policy
-- and each request shape was driven against the real API. `storage.operation()`
-- returned:
--
--   POST /object/sign/<bucket>/<key>   ->  'storage.object.sign'
--   POST /object/list/<bucket>         ->  'storage.object.list'
--   GET  /object/<bucket>/<key>        ->  'storage.object.get_authenticated'
--   HEAD /object/<bucket>/<key>        ->  'object.head_authenticated_info'
--
-- and, decisively:
--
--   GET  /object/sign/<bucket>/<key>?token=…  ->  THE POLICY IS NOT EVALUATED
--
-- Fetching a signed URL consults no policy at all — the token is the
-- authorization. So restricting this policy to the signing operation cannot
-- break byte delivery: the route signs (policy-checked) and then fetches
-- (token-checked), and only the first half passes through here.
--
-- FAIL-CLOSED BY CONSTRUCTION. `storage.operation()` reads a GUC with the
-- missing-ok flag, so outside a Storage request it is NULL and
-- `allow_only_operation` coalesces to FALSE. A direct SQL caller therefore
-- matches nothing, and if a future Storage release renamed the operation the
-- failure would be published images going missing — visible, and caught by the
-- exposure probe — never a silent widening.
--
-- Forward-only: one policy is dropped and recreated. Nothing else moves. The
-- owner's own policies are untouched, so an owner keeps listing and reading
-- their own objects through `professional_portfolio_select_own`, which is a
-- separate permissive policy and is OR'd with this one.
-- ===========================================================================

drop policy if exists professional_portfolio_select_published on storage.objects;

create policy professional_portfolio_select_published on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'professional-portfolio'
    -- FIRST, because it is a GUC read and the publication test below is three
    -- joins. A listing request is refused before any of that work happens.
    and storage.allow_only_operation('storage.object.sign')
    and app.is_published_portfolio_object(name)
  );

comment on policy professional_portfolio_select_published on storage.objects is
  'The only anon-facing door in the product, and it opens for exactly one operation: minting a signed URL for an object that is public, ready, and on a currently listed profile. Listing, direct GET and HEAD are refused because they carry a different storage.operation() — verified against the live API, not inferred. Fetching the resulting signed URL consults no policy, so the byte delivery /p/media depends on is unaffected. Fails closed when the operation GUC is absent.';

-- =============================================================================
-- Catalog view hardening — resolve the Supabase Security Advisor
-- "Security Definer View" (rule 0010) finding for:
--   * public.catalog_published_products
--
-- It was created `with (security_invoker = false)` in
-- 20260810090001_catalog_rfq_quotation.sql. A definer view runs its whole body
-- with the VIEW OWNER's rights (owner is RLS-exempt), which is what rule 0010
-- flags. That migration is historical and is NOT edited; this is forward-only.
--
-- WHY NOT a blind `security_invoker = true` on the ORIGINAL body:
--   the body joins public.products to public.organizations. Under invoker rights
--   the organizations join collapses to the caller's OWN orgs (organizations RLS
--   is member-scoped), so every published product of every OTHER supplier would
--   silently vanish from the catalog. The cross-tenant marketplace is the entire
--   point of this relation, so the flag cannot simply be flipped.
--
-- WHAT THE DEFINER RIGHTS WERE ACTUALLY BUYING:
--   only the supplier's PUBLIC identity columns (name / slug / is_verified) from
--   the member-scoped organizations table. The product half never needed them:
--   policy `products_select_published` (same migration) already grants EVERY
--   authenticated caller SELECT on `status = 'published' and deleted_at is null`
--   rows cross-tenant — byte-for-byte the filter the view itself applied.
--
-- SELECTED DESIGN (the established public-directory pattern, 20260805100000,
-- applied at the narrowest possible scope):
--   * public.catalog_published_products becomes a `security_invoker = true`
--     view. Its products half is now read under the CALLER's own RLS, so
--     products_select_published genuinely decides product visibility instead of
--     being bypassed. A future policy that narrows product visibility is then
--     honoured here automatically rather than silently overridden.
--   * ONLY the supplier-identity half moves into a constrained SECURITY DEFINER
--     helper in the non-exposed `app` schema (pinned empty search_path, every
--     reference schema-qualified, PUBLIC execute revoked).
--
-- EXPOSURE IS UNCHANGED, NOT WIDENED:
--   the helper returns four approved public columns (id, name, slug,
--   is_verified) — never created_by / status / timestamps / deleted_at / any
--   private org column — and only for organizations that ALREADY have at least
--   one published, non-deleted product. That `exists` clause is what keeps the
--   set of revealed organizations exactly equal to what the definer view
--   revealed before: an org with no published product was never surfaced by the
--   old join either, and is not surfaced now.
--
-- Relation name, column set, column order and column types are preserved, so
-- the Data API path, public.saved_product_list and every existing pgTAP
-- assertion in 23_catalog_rfq_quotation_test.sql keep working unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Constrained SECURITY DEFINER reader for the supplier's PUBLIC identity.
--    Internal (`app` schema is not exposed to the Data API); callable only
--    because the invoker view's callers hold EXECUTE.
-- ---------------------------------------------------------------------------
create or replace function app._catalog_supplier_identity()
returns table (
  id          uuid,
  name        text,
  slug        text,
  is_verified boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug, o.is_verified
  from public.organizations o
  where o.deleted_at is null
    and exists (
      select 1
      from public.products p
      where p.organization_id = o.id
        and p.status = 'published'::public.product_status
        and p.deleted_at is null
    );
$$;
comment on function app._catalog_supplier_identity() is
  'Internal SECURITY DEFINER reader backing public.catalog_published_products. Returns ONLY the approved public identity columns (id/name/slug/is_verified) of non-deleted organizations that already expose at least one published product — never private org columns, and never an org the catalog did not already reveal. Not in an exposed schema; PUBLIC execute revoked. See 20260817100000 hardening.';

-- Least privilege: drop the default PUBLIC execute, then grant only the role the
-- catalog view actually runs as. `anon` is deliberately excluded — the catalog
-- has always been an authenticated-only relation.
revoke execute on function app._catalog_supplier_identity() from public;
grant  execute on function app._catalog_supplier_identity() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Replace the definer view with a security_invoker view.
--    public.saved_product_list (20260816090001) selects from this view, so it
--    must be dropped first and recreated verbatim afterwards. An explicit drop
--    is used rather than CASCADE so nothing else can be silently destroyed.
-- ---------------------------------------------------------------------------
drop view if exists public.saved_product_list;
drop view if exists public.catalog_published_products;

create view public.catalog_published_products with (security_invoker = true) as
  select
    p.id, p.organization_id, o.name as supplier_name, o.is_verified as supplier_verified,
    o.slug as supplier_slug, p.name, p.sku, p.category, p.brand, p.short_description,
    p.unit, p.image_ref, p.published_at
  from public.products p
  join app._catalog_supplier_identity() o on o.id = p.organization_id
  where p.status = 'published' and p.deleted_at is null;
comment on view public.catalog_published_products is
  'PUBLIC cross-tenant projection of published catalog products with the supplier org''s public identity (name/verified). security_invoker=true: the products half is read under the caller''s own RLS (products_select_published), and only the supplier identity comes from the constrained SECURITY DEFINER reader app._catalog_supplier_identity() (Advisor hardening 20260817100000). Never exposes draft products or private org columns.';

revoke all on public.catalog_published_products from anon, authenticated, service_role;
grant select on public.catalog_published_products to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Recreate the dependent shortlist view unchanged (20260816090001 A3).
--    Body, options, comment and grants are reproduced verbatim.
-- ---------------------------------------------------------------------------
create view public.saved_product_list with (security_invoker = true) as
  select
    s.organization_id,
    s.product_id,
    s.saved_by,
    s.note,
    s.created_at        as saved_at,
    c.name,
    c.sku,
    c.category,
    c.brand,
    c.short_description,
    c.unit,
    c.image_ref,
    c.organization_id   as supplier_org_id,
    c.supplier_name,
    c.supplier_verified
  from public.saved_products s
  join public.catalog_published_products c on c.id = s.product_id;

comment on view public.saved_product_list is
  'Saved-products shortlist joined to the public catalog projection for display. security_invoker=true, so saved_products RLS scopes the rows and only still-published products appear.';

revoke all on public.saved_product_list from anon, authenticated, service_role;
grant select on public.saved_product_list to authenticated;

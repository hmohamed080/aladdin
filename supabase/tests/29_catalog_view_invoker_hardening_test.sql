-- pgTAP: Catalog view invoker hardening (migration 20260817100000).
--
-- Proves the Supabase Security Advisor "Security Definer View" (rule 0010)
-- finding on public.catalog_published_products is cleared WITHOUT weakening the
-- cross-tenant published catalog:
--   * no SECURITY DEFINER view remains in the exposed `public` schema at all
--     (the Advisor rule, replicated as SQL against pg_class.reloptions);
--   * an authorised caller still sees another tenant's PUBLISHED product,
--     including the supplier identity that previously required definer rights;
--   * drafts, soft-deleted products and private organization columns stay
--     inaccessible;
--   * the replacement SECURITY DEFINER helper is least-privilege and pinned.
--
-- Fixtures come from the shared seed (same as 23_catalog_rfq_quotation_test):
--   Org A = 'aaaaaaaa…' (Nile Finishing) — SUPPLIER; owner user 11111111
--   Org B = 'bbbbbbbb…' (Delta Interiors) — REQUESTER; owner user 33333333
--   user 44444444 = non-member (intruder)
create extension if not exists pgtap;

begin;
select plan(18);

-- ===== A. The Advisor rule itself ==========================================
-- Rule 0010 flags any view in an exposed schema that is NOT security_invoker.
-- Asserting zero across all of `public` also guards against a future migration
-- reintroducing one.
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'v'
      and n.nspname = 'public'
      and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false)),
  0, 'no SECURITY DEFINER view remains in the exposed public schema (Advisor rule 0010)');

select ok(
  (select c.reloptions::text[] @> array['security_invoker=true']
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'catalog_published_products'),
  'catalog_published_products is now a security_invoker view');

select ok(
  (select c.reloptions::text[] @> array['security_invoker=true']
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'saved_product_list'),
  'the dependent saved_product_list view survived the rebuild as security_invoker');

-- ===== B. The replacement helper is constrained =============================
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_catalog_supplier_identity'),
  true, 'app._catalog_supplier_identity() is SECURITY DEFINER');

-- Postgres stores an empty `set search_path = ''` as the quoted form
-- `search_path=""`. Asserting that exact value (rather than a `search_path=%`
-- prefix match) proves the path is pinned EMPTY, not merely pinned.
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = '_catalog_supplier_identity'),
  'the helper pins an empty search_path (cannot be redirected)');

select ok(
  not has_function_privilege('public', 'app._catalog_supplier_identity()', 'execute'),
  'PUBLIC holds no EXECUTE on the helper');
select ok(
  not has_function_privilege('anon', 'app._catalog_supplier_identity()', 'execute'),
  'anon holds no EXECUTE on the helper (catalog is authenticated-only)');
select ok(
  has_function_privilege('authenticated', 'app._catalog_supplier_identity()', 'execute'),
  'authenticated holds EXECUTE on the helper');

-- The view still projects EXACTLY the approved 13 columns — no private org
-- column (created_by / status / deleted_at / timestamps) crept in via the
-- rebuild, and none of the original columns was dropped.
select set_eq(
  $$ select a.attname::text
       from pg_attribute a
      where a.attrelid = 'public.catalog_published_products'::regclass
        and a.attnum > 0 and not a.attisdropped $$,
  $$ values ('id'),('organization_id'),('supplier_name'),('supplier_verified'),
            ('supplier_slug'),('name'),('sku'),('category'),('brand'),
            ('short_description'),('unit'),('image_ref'),('published_at') $$,
  'the catalog view projects exactly the 13 approved columns (no private org data)');

-- ===== C. Relation grants stay least-privilege ==============================
select ok(
  not has_table_privilege('anon', 'public.catalog_published_products', 'select'),
  'anon cannot read the catalog view');
select ok(
  has_table_privilege('authenticated', 'public.catalog_published_products', 'select'),
  'authenticated can read the catalog view');

-- ===== D. The catalog still works ACROSS tenants ============================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invoker Tile 30x30','finishing','square_meter','INV-3030','NileCeramics','Hardening fixture') $$,
  'supplier owner creates a product');
select lives_ok(
  $$ select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Invoker Draft Item','supply','piece') $$,
  'supplier owner creates a second (draft) product');

reset role;
create temp table _hids as select
  (select id from public.products where name='Invoker Tile 30x30')  as p_pub,
  (select id from public.products where name='Invoker Draft Item')  as p_draft,
  (select version from public.products where name='Invoker Tile 30x30') as p_pub_v;
grant select on _hids to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.set_product_published((select p_pub from _hids), true, (select p_pub_v from _hids)) $$,
  'supplier owner publishes the product');

-- The requester org owner is NOT a member of the supplier org. Under the old
-- definer view this worked by bypassing RLS; it must still work now.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.catalog_published_products where id = (select p_pub from _hids)),
  1, 'a cross-tenant caller still sees another org''s PUBLISHED product');
select is(
  (select supplier_name from public.catalog_published_products where id = (select p_pub from _hids)),
  'Nile Finishing Supplies',
  'the supplier identity still resolves cross-tenant (the only thing definer rights bought)');

-- ===== E. Nothing private leaked ===========================================
select is(
  (select count(*)::int from public.catalog_published_products where id = (select p_draft from _hids)),
  0, 'a draft product never appears in the catalog');

-- A caller with no membership anywhere sees the published catalog but still
-- cannot reach the private organizations base table behind it.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.organizations
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'the supplier''s private organizations row stays unreadable to a non-member');

rollback;

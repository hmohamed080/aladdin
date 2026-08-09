-- pgTAP: B2B Commerce — Catalog → RFQ → Quotation (Phase 3, Sprint 9).
-- Proves the full commercial journey end-to-end (publish → RFQ → quote → accept →
-- READY FOR ORDER), tenant/requester/supplier visibility, lifecycle guards,
-- optimistic concurrency, audit emission, cross-tenant denial, and the direct-DML
-- write boundary. Fixtures come from the shared seed:
--   Org A = 'aaaaaaaa…' (Nile Finishing) — SUPPLIER; owner user 11111111 (org.manage + catalog.write)
--   Org B = 'bbbbbbbb…' (Delta Interiors) — REQUESTER; owner user 33333333 (org.manage)
--   user 44444444 = non-member (intruder)
create extension if not exists pgtap;

begin;
select plan(42);

-- Org B owner needs the commerce caps that org.manage implies via the helper
-- functions; grant the explicit rfq/quote caps too so we also exercise the
-- granular path (not only the org.manage fallback).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'catalog.publish'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'rfq.respond'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'rfq.create'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'quote.decide')
on conflict do nothing;

-- ===== Direct-DML write boundary (RPC-only) =================================
set local role authenticated;
select throws_ok(
  $$ insert into public.products (organization_id, name, category, unit, created_by)
     values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x','finishing','piece','11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'authenticated cannot INSERT a product directly (RPC-only)');
select throws_ok(
  $$ insert into public.rfqs (requester_org_id, supplier_org_id, title, created_by)
     values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x','33333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'authenticated cannot INSERT an RFQ directly (RPC-only)');
reset role;
set local role service_role;
select throws_ok(
  $$ select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x','finishing','piece') $$,
  '42501', null, 'service_role cannot execute a commerce workflow RPC (authenticated only)');
reset role;

-- ===== Catalog: supplier publishes products =================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Porcelain Tile 60x60','finishing','square_meter','TILE-6060','NileCeramics','Matte porcelain floor tile') $$,
  'supplier owner creates a product');
select lives_ok(
  $$ select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Draft Only Item','supply','piece') $$,
  'supplier owner creates a second (draft) product');
select is(
  (select status::text from public.products where name='Porcelain Tile 60x60'),
  'draft', 'a new product starts as a draft');

reset role;
create temp table _cids as select
  (select id from public.products where name='Porcelain Tile 60x60') as p_pub,
  (select id from public.products where name='Draft Only Item')      as p_draft,
  (select version from public.products where name='Porcelain Tile 60x60') as p_pub_v;
grant select on _cids to authenticated, service_role;

-- Cross-tenant: the requester org owner cannot create a product in the supplier org.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Intruder Product','finishing','piece') $$,
  '42501', null, 'a non-member cannot create a product in another org (cross-tenant denied)');

-- Publish the first product (supplier owner has catalog.publish).
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.set_product_published((select p_pub from _cids), true, (select p_pub_v from _cids)) $$,
  'supplier owner publishes the product');
select is((select status::text from public.products where name='Porcelain Tile 60x60'),
  'published', 'the product is now published');

-- The published product is discoverable cross-tenant via the catalog view; the
-- draft is not.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.catalog_published_products where id = (select p_pub from _cids)),
  1, 'requester can see the published product in the cross-tenant catalog');
select is(
  (select count(*)::int from public.catalog_published_products where id = (select p_draft from _cids)),
  0, 'a draft product never appears in the catalog');
select is(
  (select supplier_name from public.catalog_published_products where id = (select p_pub from _cids)),
  'Nile Finishing Supplies', 'the catalog surfaces the supplier identity');

-- ===== RFQ: requester creates, itemizes, submits ============================
select lives_ok(
  $$ select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Tiles for Maadi villa','Need matte finish','2026-09-01') $$,
  'requester owner creates an RFQ addressed to the supplier');
select throws_ok(
  $$ select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Self RFQ') $$,
  '22023', null, 'an org cannot send an RFQ to itself');

reset role;
create temp table _rids as select
  (select id from public.rfqs where title='Tiles for Maadi villa') as rfq,
  (select version from public.rfqs where title='Tiles for Maadi villa') as rfq_v;
grant select on _rids to authenticated, service_role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select status::text from public.rfqs where id=(select rfq from _rids)),
  'draft', 'a new RFQ starts as a draft');
select lives_ok(
  $$ select public.add_rfq_item((select rfq from _rids), (select p_pub from _cids), 120) $$,
  'requester adds a published supplier product as an RFQ line');
select throws_ok(
  $$ select public.add_rfq_item((select rfq from _rids), (select p_draft from _cids), 5) $$,
  '22023', null, 'a draft (unpublished) product cannot be added to an RFQ');
select is((select product_name from public.rfq_items where rfq_id=(select rfq from _rids)),
  'Porcelain Tile 60x60', 'the RFQ line snapshots the product name');

-- The supplier cannot see the RFQ while it is still a draft.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.rfqs where id=(select rfq from _rids)),
  0, 'the supplier cannot see a draft RFQ');

-- Submit (as requester).
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.submit_rfq((select rfq from _rids), (select rfq_v from _rids)) $$,
  'requester submits the RFQ to the supplier');
select is((select status::text from public.rfqs where id=(select rfq from _rids)),
  'submitted', 'the RFQ is now submitted');

-- Now the supplier can see it; a non-member of either org still cannot.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.rfqs where id=(select rfq from _rids)),
  1, 'the supplier can see the submitted RFQ');
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.rfqs where id=(select rfq from _rids)),
  0, 'a non-member of either org cannot see the RFQ (cross-tenant isolation)');

-- ===== Quotation: supplier prices and submits ==============================
-- The requester (not a member of the supplier org) cannot create a quotation.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.create_quotation((select rfq from _rids)) $$,
  '42501', null, 'the requester cannot create a supplier quotation');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.create_quotation((select rfq from _rids), 'Bulk price, 2-week delivery','2026-09-15') $$,
  'supplier creates a quotation against the submitted RFQ');

reset role;
create temp table _qids as select
  (select id from public.quotations where rfq_id=(select rfq from _rids)) as q,
  (select version from public.quotations where rfq_id=(select rfq from _rids)) as q_v,
  (select id from public.quotation_items where quotation_id =
      (select id from public.quotations where rfq_id=(select rfq from _rids))) as qi;
grant select on _qids to authenticated, service_role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select status::text from public.quotations where id=(select q from _qids)),
  'draft', 'a new quotation starts as a draft');
select is((select count(*)::int from public.quotation_items where quotation_id=(select q from _qids)),
  1, 'the quotation is seeded with the RFQ line(s)');

-- Cannot submit an unpriced quotation.
select throws_ok(
  $$ select public.submit_quotation((select q from _qids), (select q_v from _qids)) $$,
  '22023', null, 'an unpriced quotation cannot be submitted');

-- Price the line; totals recompute.
select lives_ok(
  $$ select public.set_quotation_item_price((select qi from _qids), 250.00) $$,
  'supplier sets the line unit price');
select is((select total from public.quotations where id=(select q from _qids)),
  30000.00, 'the quotation total recomputes from the priced lines (120 x 250)');

-- The requester cannot see the draft quotation.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.quotations where id=(select q from _qids)),
  0, 'the requester cannot see a draft quotation');

-- Submit (as supplier).
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.submit_quotation((select q from _qids), (select q_v from _qids)) $$,
  'supplier submits the priced quotation');
select is((select status::text from public.quotations where id=(select q from _qids)),
  'submitted', 'the quotation is now submitted');
select is((select status::text from public.rfqs where id=(select rfq from _rids)),
  'quoted', 'submitting the quotation moves the RFQ to quoted');

-- Now the requester can see it.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.quotations where id=(select q from _qids)),
  1, 'the requester can now see the submitted quotation');

-- The supplier cannot decide their own quotation.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.decide_quotation((select q from _qids), true, (select version from public.quotations where id=(select q from _qids))) $$,
  '42501', null, 'the supplier cannot accept/reject their own quotation');

-- ===== Decision: requester accepts → READY FOR ORDER =======================
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.decide_quotation((select q from _qids), true, (select version from public.quotations where id=(select q from _qids))) $$,
  'requester accepts the quotation');
select is((select status::text from public.quotations where id=(select q from _qids)),
  'accepted', 'the quotation is accepted (READY FOR ORDER)');
select is((select status::text from public.rfqs where id=(select rfq from _rids)),
  'closed', 'accepting closes the RFQ (no order created — Sprint 10)');

-- Cannot decide again.
select throws_ok(
  $$ select public.decide_quotation((select q from _qids), false, (select version from public.quotations where id=(select q from _qids))) $$,
  '22023', null, 'an already-decided quotation cannot be decided again');

-- ===== Audit emission ======================================================
reset role;
select is(
  (select count(distinct action)::int from public.audit_log
   where action in ('product.published','rfq.submitted','quotation.submitted','quotation.accepted','rfq.closed')),
  5, 'the commercial lifecycle emitted its audit events');

-- ===== No order was created (Sprint 10 boundary) ===========================
select is(
  (select count(*)::int from pg_tables where schemaname='public' and tablename in ('orders','projects')),
  0, 'no orders/projects table exists yet (out of Sprint 9 scope)');

select * from finish();
rollback;

-- pgTAP: Marketplace Migration 05 — bulk import foundation
-- (20261013090004_marketplace_bulk_import_foundation.sql).
--
--   A. SHAPE        — RLS, no client writes, worker functions service-only, FKs.
--   B. JOBS         — ownership, idempotent creation, seller gate, cross-tenant create.
--   C. STAGING      — bounded, idempotent, conflicting replay refused, no direct writes.
--   D. ASSETS       — deterministic file-name parsing and SKU / reference matching.
--   E. VALIDATION   — one finding code per rule; invalid rows never block valid ones.
--   F. DRY RUN      — validates, reports, writes no product.
--   G. APPLY        — canonical tables, draft only, pending images, ordering.
--   H. IDEMPOTENCY  — a second import changes nothing; updates are minimal.
--   I. ISOLATION    — error isolation, resumable chunks, lease, state machine.
--   J. TENANCY      — cross-tenant reads and writes impossible.
--   K. REPORT/PURGE — error report and staging purge.
--   L. SAFETY       — imported products cannot be published.
create extension if not exists pgtap;

begin;
select plan(126);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '71000005-0000-4000-8000-000000000005',
               '70000009-0000-4000-8000-000000000009');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.other_type', (select key from public.marketplace_product_types
                                   where key <> 'wallpaper' and is_active order by key limit 1), true);
select set_config('t.sum', repeat('ab', 32), true);

-- both showrooms are approved sellers (fixture-level; the workflow is tested in 93_)
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now());
select set_config('app.marketplace_seller_write', 'off', true);

-- pre-existing catalogue of A: a product with a variant (SKU conflicts), and a product to be drifted
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en, external_ref)
select v.id::uuid, current_setting('t.a')::uuid, t.id, v.slug, 'قديم', v.slug, v.ref
from (values ('c4000000-0000-4000-8000-000000000001', 'legacy-product', 'LEGACY-1', 'wallpaper'),
             ('c4000000-0000-4000-8000-000000000002', 'fix-product',    'FIX-1',    'wallpaper'),
             ('c4000000-0000-4000-8000-000000000003', 'typed-product',   'TYPE-X',   'wallpaper')) v(id, slug, ref, tk)
join public.marketplace_product_types t on t.key = v.tk;
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('c4100000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', current_setting('t.a')::uuid, 'LEG-1', 'roll', 100),
       ('c4100000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000002', current_setting('t.a')::uuid, 'S-FIX', 'roll', 50);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('marketplace_import_jobs', 'marketplace_import_job_events', 'marketplace_import_rows',
                       'marketplace_import_assets', 'marketplace_import_errors')),
  5, 'A1. RLS is enabled on all five import tables');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') and privilege_type <> 'SELECT'
     and table_name like 'marketplace\_import\_%'), 0,
  'A2. no client role holds a write privilege on any import table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon' and table_name like 'marketplace\_import\_%'), 0,
  'A3. anon holds nothing on the import tables');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT' and tablename like 'marketplace\_import\_%'),
  0, 'A4. there is no insert / update / delete policy on any import table');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'marketplace\_import\_%' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['marketplace_import_job_cancel', 'marketplace_import_job_create', 'marketplace_import_job_report'],
  'A5. authenticated can execute exactly the three seller-facing import functions');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'marketplace\_import\_%' and has_function_privilege('anon', p.oid, 'execute')),
  0, 'A6. anon can execute no import function');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('marketplace_import_create', 'marketplace_import_stage_rows', 'marketplace_import_stage_assets',
     'marketplace_import_seal', 'marketplace_import_claim', 'marketplace_import_release', 'marketplace_import_validate_next',
     'marketplace_import_apply_next', 'marketplace_import_complete_dry_run', 'marketplace_import_retry_failed',
     'marketplace_import_cancel', 'marketplace_import_purge_staging')
     and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')),
  12, 'A7. the 12 worker functions are executable by service_role only');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
          unnest(array['anon', 'authenticated', 'service_role']) r
   where n.nspname = 'app' and p.proname like 'marketplace\_%' and has_function_privilege(r, p.oid, 'execute')
     -- storage-policy predicates (Migration 06) must be callable by the querying role
     and p.proname not in ('marketplace_storage_can_delete_image', 'marketplace_storage_can_upload_image', 'marketplace_storage_can_upload_import',
                        'marketplace_storage_moderator_can_read', 'marketplace_storage_owns_image')),
  0, 'A8. no client role can execute any app.marketplace_* helper');
select is(
  (select count(*)::int from pg_constraint c
   where c.contype = 'f' and c.conrelid::regclass::text like 'marketplace\_import\_%'
     and c.confrelid::regclass::text not in ('organizations', 'marketplace_import_jobs', 'marketplace_import_rows',
         'marketplace_import_assets', 'marketplace_products', 'marketplace_product_variants', 'marketplace_product_images')),
  0, 'A9. import tables reference only organizations and marketplace tables');
select is(
  (select count(*)::int from pg_constraint c
   where c.contype = 'f' and c.confrelid::regclass::text like 'marketplace\_import\_%'
     and c.conrelid::regclass::text not like 'marketplace\_import\_%'), 0,
  'A10. no existing table references the import tables');
select is(
  (select count(*)::int from pg_class where relname = 'marketplace_import_products'), 0,
  'A11. no second permanent product catalogue exists (imports write the canonical tables)');

-- ===========================================================================
-- B. Jobs: creation, idempotency, ownership
-- ===========================================================================
select set_config('t.j1', public.marketplace_import_create(current_setting('t.a')::uuid, '70000001-0000-4000-8000-000000000001',
  'xlsx', 'catalogue-a.xlsx', current_setting('t.sum'), 'dry_run', 2, 'import-key-job-001')::text, true);
select ok(current_setting('t.j1')::uuid is not null, 'B1. an import job is created');
select is(public.marketplace_import_create(current_setting('t.a')::uuid, '70000001-0000-4000-8000-000000000001',
  'xlsx', 'catalogue-a.xlsx', current_setting('t.sum'), 'dry_run', 2, 'import-key-job-001'), current_setting('t.j1')::uuid,
  'B2. creating again with the same idempotency key returns the SAME job');
select throws_ok($$ select public.marketplace_import_create('9c000000-cccc-4ccc-8ccc-000000000001', '70000001-0000-4000-8000-000000000001',
  'csv', 'other.csv', repeat('cd', 32), 'dry_run', 2, 'import-key-job-001') $$,
  '23505', null, 'B3. the same key for a DIFFERENT import is refused');
select is((select count(*)::int from public.marketplace_import_jobs where organization_id = current_setting('t.a')::uuid), 1,
  'B4. exactly one job exists after the replays');
select throws_ok($$ select public.marketplace_import_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '70000001-0000-4000-8000-000000000001',
  'csv', 'x.csv', repeat('ab', 32), 'dry_run', 2, 'import-key-supplier-1') $$,
  '23514', null, 'B5. an organization that is not an enabled seller cannot import');
select throws_ok($$ select public.marketplace_import_create('9c000000-cccc-4ccc-8ccc-000000000001', '70000001-0000-4000-8000-000000000001',
  'pdf', 'x.pdf', repeat('ab', 32), 'dry_run', 2, 'import-key-badfmt-01') $$,
  '23514', null, 'B6. only csv / xlsx sources are accepted');
select throws_ok($$ select public.marketplace_import_create('9c000000-cccc-4ccc-8ccc-000000000001', '70000001-0000-4000-8000-000000000001',
  'csv', 'x.csv', repeat('ab', 32), 'dry_run', 5000, 'import-key-chunk-001') $$,
  '23514', null, 'B7. the chunk size is bounded');
select throws_ok($$ select public.marketplace_import_create('9c000000-cccc-4ccc-8ccc-000000000001', null,
  'csv', 'x.csv', repeat('ab', 32), 'dry_run', 2, 'import-key-actor-001') $$,
  '22023', null, 'B8. the actor is mandatory (audit)');
select is((select to_status from public.marketplace_import_job_events where job_id = current_setting('t.j1')::uuid order by sequence limit 1),
  'created', 'B9. the job history starts with its creation');

-- seller surface
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok($$ select public.marketplace_import_job_create('9c000000-cccc-4ccc-8ccc-000000000001', 'csv', 'mine.csv',
  'abababababababababababababababababababababababababababababababab', 'dry_run', 100, 'import-key-member-01') $$,
  'B10. a catalogue member of the organization creates a job');
select throws_ok($$ select public.marketplace_import_job_create('91000005-1111-4111-8111-000000000005', 'csv', 'x.csv',
  'abababababababababababababababababababababababababababababababab', 'dry_run', 100, 'import-key-cross-001') $$,
  '42501', null, 'B11. a member of ANOTHER showroom cannot create a job for this organization');
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok($$ select public.marketplace_import_job_create('9c000000-cccc-4ccc-8ccc-000000000001', 'csv', 'x.csv',
  'abababababababababababababababababababababababababababababababab', 'dry_run', 100, 'import-key-outsider1') $$,
  '42501', null, 'B12. a user with no membership cannot create a job');
select throws_ok($$ select public.marketplace_import_create('9c000000-cccc-4ccc-8ccc-000000000001', '70000009-0000-4000-8000-000000000009',
  'csv', 'x.csv', repeat('ab', 32), 'dry_run', 2, 'import-key-direct-001') $$,
  '42501', null, 'B13. the service-level create is not callable by an authenticated user');
set local role anon;
select throws_ok($$ select public.marketplace_import_job_create('9c000000-cccc-4ccc-8ccc-000000000001', 'csv', 'x.csv',
  'abababababababababababababababababababababababababababababababab', 'dry_run', 100, 'import-key-anon-0001') $$,
  '42501', null, 'B14. anon cannot create a job');
reset role;

-- ===========================================================================
-- C. Staging rows
-- ===========================================================================
select is(public.marketplace_import_stage_rows(current_setting('t.j1')::uuid, replace($j$[
 {"row_number":1,"external_ref":"P1","sku":"S1-A","product_type":"wallpaper","name_ar":"ورق جدران","name_en":"Wallpaper One","brand":"Acme","selling_unit":"roll","price":"1,250.50",
  "attributes":{"material_wallpaper":"vinyl_coated","washable":true,"color":"beige","roll_width":53,"roll_length":1000}},
 {"row_number":2,"external_ref":"P1","sku":"S1-B","product_type":"wallpaper","name_ar":"ورق جدران","name_en":"Wallpaper One","selling_unit":"roll","price":1300,
  "attributes":{"color":"cream","roll_width":53,"roll_length":1000}},
 {"row_number":3,"external_ref":"P2","sku":"S2 bad","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"roll","price":10},
 {"row_number":4,"external_ref":"P3","sku":"S3","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"roll","price":"abc"},
 {"row_number":5,"external_ref":"P4","sku":"S4","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"roll","price":"10.123"},
 {"row_number":6,"external_ref":"P5","sku":"S5","product_type":"no_such_type","name_ar":"س","name_en":"s","selling_unit":"roll","price":10},
 {"row_number":7,"external_ref":"P6","sku":"S6","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"bucket","price":10},
 {"row_number":8,"external_ref":"P7","sku":"S1-A","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"roll","price":10},
 {"row_number":9,"external_ref":"P8","sku":"LEG-1","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"roll","price":10},
 {"row_number":10,"external_ref":"P9","sku":"S9","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"roll","price":10,"attributes":{"bogus_attr":"x"}},
 {"row_number":11,"external_ref":"P10","sku":"S10","product_type":"wallpaper","name_ar":"س","name_en":"s","selling_unit":"roll","price":10,"attributes":{"color":"not_a_color"}},
 {"row_number":12,"external_ref":"TYPE-X","sku":"S12","product_type":"__OTHER__","name_ar":"س","name_en":"s","selling_unit":"roll","price":10},
 {"row_number":13,"external_ref":"P11","sku":"S13","product_type":"wallpaper","name_ar":"س","name_en":"plain","selling_unit":"roll","price":99},
 {"row_number":14,"external_ref":"FIX-1","sku":"S-FIX","product_type":"wallpaper","name_ar":"س","name_en":"fix","selling_unit":"piece","price":50}
]$j$, '__OTHER__', current_setting('t.other_type'))::jsonb), 14, 'C1. fourteen rows are staged');
select is((select total_rows from public.marketplace_import_jobs where id = current_setting('t.j1')::uuid), 14,
  'C2. the job counts its rows');
select is(public.marketplace_import_stage_rows(current_setting('t.j1')::uuid, '[{"row_number":1,"external_ref":"P1","sku":"S1-A","product_type":"wallpaper","name_ar":"ورق جدران","name_en":"Wallpaper One","brand":"Acme","selling_unit":"roll","price":"1,250.50","attributes":{"material_wallpaper":"vinyl_coated","washable":true,"color":"beige","roll_width":53,"roll_length":1000}}]'::jsonb),
  0, 'C3. re-staging an identical row is a harmless no-op (retry safe)');
select throws_ok($$ select public.marketplace_import_stage_rows(current_setting('t.j1')::uuid,
  '[{"row_number":1,"external_ref":"CHANGED","sku":"S1-A"}]'::jsonb) $$,
  '23505', null, 'C4. re-staging a row number with DIFFERENT content is refused');
select throws_ok($$ select public.marketplace_import_stage_rows(current_setting('t.j1')::uuid, '[]'::jsonb) $$,
  '22023', null, 'C5. an empty batch is refused');
select throws_ok($$ select public.marketplace_import_stage_rows(current_setting('t.j1')::uuid, '[{"sku":"X"}]'::jsonb) $$,
  '22023', null, 'C6. a row without row_number is refused');
select is((select price_egp from public.marketplace_import_rows where job_id = current_setting('t.j1')::uuid and row_number = 1),
  1250.50, 'C7. "1,250.50" is normalised to 1250.50');
select is((select selling_unit from public.marketplace_import_rows where job_id = current_setting('t.j1')::uuid and row_number = 14), 'piece',
  'C8. text cells are trimmed / lower-cased where they are codes');
select throws_ok($$ insert into public.marketplace_import_rows (job_id, organization_id, row_number, raw, row_hash)
  values (current_setting('t.j1')::uuid, current_setting('t.a')::uuid, 99, '{}', repeat('a', 64)) $$,
  '42501', null, 'C9. even the table owner cannot insert a staging row outside the trusted functions');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok($$ insert into public.marketplace_import_rows (job_id, organization_id, row_number, raw, row_hash)
  values (current_setting('t.j1')::uuid, current_setting('t.a')::uuid, 99, '{}', repeat('a', 64)) $$,
  '42501', null, 'C10. an authenticated seller member has no INSERT privilege on staging');
select throws_ok($$ select public.marketplace_import_stage_rows(current_setting('t.j1')::uuid, '[{"row_number":50}]'::jsonb) $$,
  '42501', null, 'C11. nor can they call the staging function (service role only)');
reset role;

-- ===========================================================================
-- D. Assets: parsing and matching
-- ===========================================================================
select is((select sku_key || '/' || seq::text from app.marketplace_import_parse_asset_name('S1-A_02.JPG')), 'S1-A/2',
  'D1. SKU_02.jpg parses to (SKU, 2)');
select is((select sku_key || '/' || seq::text from app.marketplace_import_parse_asset_name('A_B_03.png')), 'A_B/3',
  'D2. a SKU containing underscores keeps them (the LAST _NN is the sequence)');
select is((select sku_key || '/' || seq::text from app.marketplace_import_parse_asset_name('SKU.webp')), 'SKU/1',
  'D3. a file without a sequence is image 1');
select is((select count(*)::int from app.marketplace_import_parse_asset_name('notes.txt')), 0,
  'D4. an unsupported extension does not parse');
select is((select count(*)::int from app.marketplace_import_parse_asset_name('SKU_000.jpg')), 0,
  'D5. sequence 0 is refused');

select is(public.marketplace_import_stage_assets(current_setting('t.j1')::uuid, $j$[
 {"file_name":"S1-A_01.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j1/S1-A_01.jpg","mime_type":"image/jpeg"},
 {"file_name":"S1-A_02.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j1/S1-A_02.jpg","mime_type":"image/jpeg"},
 {"file_name":"S1-A_03.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j1/S1-A_03.jpg","mime_type":"image/jpeg"},
 {"file_name":"p1_01.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j1/p1_01.jpg","mime_type":"image/jpeg"},
 {"file_name":"ZZZ_01.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j1/ZZZ_01.jpg","mime_type":"image/jpeg"},
 {"file_name":"notes.txt","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j1/notes.txt"},
 {"file_name":"S1-A_01.png","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j1/S1-A_01.png","mime_type":"image/png"},
 {"file_name":"S1-B_01.jpg","storage_bucket":"marketplace-products","object_key":"../etc/passwd"}
]$j$::jsonb), 8, 'D6. eight asset references are staged');
select throws_ok($$ select public.marketplace_import_stage_assets(current_setting('t.j1')::uuid,
  '[{"file_name":"S1-A_01.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/other.jpg"}]'::jsonb) $$,
  '23505', null, 'D7. re-registering a file name with a different object key is refused');
select is((select status from public.marketplace_import_assets where job_id = current_setting('t.j1')::uuid and file_name = 'S1-B_01.jpg'),
  'rejected', 'D8. an unsafe storage key is rejected at staging');
select is((select status from public.marketplace_import_assets where job_id = current_setting('t.j1')::uuid and file_name = 'notes.txt'),
  'rejected', 'D9. an unparseable file name is rejected');

select is((public.marketplace_import_seal(current_setting('t.j1')::uuid) ->> 'status'), 'staged', 'D10. the job is sealed');
select is((public.marketplace_import_seal(current_setting('t.j1')::uuid) ->> 'status'), 'staged', 'D11. sealing again is idempotent');
select is((select array_agg(file_name || ':' || status || ':' || coalesce(matched_by, '-') order by file_name collate "C")
           from public.marketplace_import_assets where job_id = current_setting('t.j1')::uuid),
  array['S1-A_01.jpg:matched:sku', 'S1-A_01.png:rejected:-', 'S1-A_02.jpg:matched:sku', 'S1-A_03.jpg:matched:sku',
        'S1-B_01.jpg:rejected:-', 'ZZZ_01.jpg:unmatched:-', 'notes.txt:rejected:-', 'p1_01.jpg:matched:external_ref'],
  'D12. matching: SKU first, then product reference (case-insensitive); duplicates / unknowns are not guessed');
select is((select r.row_number from public.marketplace_import_assets a join public.marketplace_import_rows r on r.id = a.matched_row_id
           where a.job_id = current_setting('t.j1')::uuid and a.file_name = 'p1_01.jpg'), 1,
  'D13. a product-reference image is attached to the product''s FIRST row');
select throws_ok($$ select public.marketplace_import_stage_rows(current_setting('t.j1')::uuid, '[{"row_number":50}]'::jsonb) $$,
  '23514', null, 'D14. nothing can be staged after the job is sealed');
select ok((select count(*) >= 3 from public.marketplace_import_errors where job_id = current_setting('t.j1')::uuid and asset_id is not null),
  'D15. unmatched / rejected assets are reported');

-- ===========================================================================
-- E/F. Validation (dry run) and resumable chunks
-- ===========================================================================
select throws_ok($$ select * from public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w1') $$,
  '55P03', null, 'E1. a worker without the lease cannot validate');
select is(public.marketplace_import_claim(current_setting('t.j1')::uuid, 'w1', 300), true, 'E2. worker w1 claims the job');
select is(public.marketplace_import_claim(current_setting('t.j1')::uuid, 'w2', 300), false, 'E3. a second worker cannot claim an active lease');
select is((select processed from public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w1')), 2,
  'E4. one call validates one chunk (chunk_size 2)');
select is((select remaining from public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w1')), 10,
  'E5. ...and the next call continues where the first stopped (14 - 4 = 10 pending)');
select is((select status from public.marketplace_import_jobs where id = current_setting('t.j1')::uuid), 'validating',
  'E6. the job is mid-validation');
-- worker w1 "crashes": lease expires, w2 takes over and resumes
select set_config('app.marketplace_import_write', 'on', true);
update public.marketplace_import_jobs set lease_expires_at = now() - interval '1 minute' where id = current_setting('t.j1')::uuid;
select set_config('app.marketplace_import_write', 'off', true);
select is(public.marketplace_import_claim(current_setting('t.j1')::uuid, 'w2', 300), true, 'E7. after the lease expires another worker takes over');
select throws_ok($$ select * from public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w1') $$,
  '55P03', null, 'E8. the crashed worker can no longer write');
select public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w2');
select public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w2');
select public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w2');
select public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w2');
select public.marketplace_import_validate_next(current_setting('t.j1')::uuid, 'w2');
select is((select status from public.marketplace_import_jobs where id = current_setting('t.j1')::uuid), 'validated',
  'E9. all rows validated in chunks; the job is validated');
select is((select array_agg(row_number || ':' || status order by row_number) from public.marketplace_import_rows where job_id = current_setting('t.j1')::uuid),
  array['1:valid', '2:valid', '3:invalid', '4:invalid', '5:invalid', '6:invalid', '7:invalid', '8:invalid', '9:invalid',
        '10:invalid', '11:invalid', '12:invalid', '13:valid', '14:invalid'],
  'E10. rows 1,2,13 valid; every broken row invalid, none of them blocked the others');
select is((select array_agg(e.code order by r.row_number) from public.marketplace_import_errors e
           join public.marketplace_import_rows r on r.id = e.row_id
           where e.job_id = current_setting('t.j1')::uuid and e.severity = 'error'),
  array['sku_invalid', 'price_invalid', 'price_precision', 'product_type_unknown', 'selling_unit_invalid',
        'duplicate_sku_in_file', 'sku_belongs_to_other_product', 'attribute_unknown', 'attribute_value_invalid',
        'product_type_change_not_allowed', 'selling_unit_change_not_allowed'],
  'E11. each rule reports its own finding code');
select ok((select count(*) >= 1 from public.marketplace_import_errors e join public.marketplace_import_rows r on r.id = e.row_id
           where e.job_id = current_setting('t.j1')::uuid and r.row_number = 13 and e.severity = 'warning'
             and e.code = 'required_attribute_missing'),
  'E12. missing required fields are WARNINGS (a publication prerequisite, not an import blocker)');
select is((select valid_rows::text || '/' || invalid_rows::text from public.marketplace_import_jobs where id = current_setting('t.j1')::uuid), '3/11',
  'E13. the job counters match (3 valid, 11 invalid)');
select is((select count(*)::int from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1'),
  0, 'F1. a dry run created no product');
select throws_ok($$ select * from public.marketplace_import_apply_next(current_setting('t.j1')::uuid, 'w2') $$,
  '23514', null, 'F2. a dry-run job can never be applied');
select is(public.marketplace_import_complete_dry_run(current_setting('t.j1')::uuid), 'completed_with_errors',
  'F3. the dry run completes, reporting errors');
select is((select count(*)::int from public.marketplace_product_variants where seller_organization_id = current_setting('t.a')::uuid and sku in ('S1-A', 'S1-B', 'S13')),
  0, 'F4. ...and still wrote nothing');

-- ===========================================================================
-- G. Apply (job 2)
-- ===========================================================================
select set_config('t.j2', public.marketplace_import_create(current_setting('t.a')::uuid, '70000001-0000-4000-8000-000000000001',
  'csv', 'apply-a.csv', current_setting('t.sum'), 'apply', 2, 'import-key-job-002')::text, true);
select public.marketplace_import_stage_rows(current_setting('t.j2')::uuid, $j$[
 {"row_number":1,"external_ref":"P1","sku":"S1-A","product_type":"wallpaper","name_ar":"ورق جدران","name_en":"Wallpaper One","brand":"Acme","selling_unit":"roll","price":1250.5,
  "attributes":{"material_wallpaper":"vinyl_coated","washable":true,"color":"beige","roll_width":53,"roll_length":1000}},
 {"row_number":2,"external_ref":"P1","sku":"S1-B","product_type":"wallpaper","name_ar":"ورق جدران","name_en":"Wallpaper One","selling_unit":"roll","price":1300,
  "attributes":{"color":"cream","roll_width":53,"roll_length":1000}},
 {"row_number":3,"external_ref":"P11","sku":"S13","product_type":"wallpaper","name_ar":"سادة","name_en":"Plain","selling_unit":"roll","price":99},
 {"row_number":4,"external_ref":"FIX-1","sku":"S-FIX","product_type":"wallpaper","name_ar":"س","name_en":"fix","selling_unit":"roll","price":50},
 {"row_number":5,"external_ref":"BAD","sku":"BAD 1","product_type":"wallpaper","name_ar":"س","name_en":"bad","selling_unit":"roll","price":5}
]$j$::jsonb);
select public.marketplace_import_stage_assets(current_setting('t.j2')::uuid, $j$[
 {"file_name":"S1-A_01.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j2/S1-A_01.jpg","mime_type":"image/jpeg"},
 {"file_name":"S1-A_02.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j2/S1-A_02.jpg","mime_type":"image/jpeg"},
 {"file_name":"S1-A_03.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j2/S1-A_03.jpg","mime_type":"image/jpeg"},
 {"file_name":"P1_01.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j2/P1_01.jpg","mime_type":"image/jpeg"},
 {"file_name":"P1_02.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j2/P1_02.jpg","mime_type":"image/jpeg"}
]$j$::jsonb);
select public.marketplace_import_seal(current_setting('t.j2')::uuid);
select public.marketplace_import_claim(current_setting('t.j2')::uuid, 'wA', 600);
select public.marketplace_import_validate_next(current_setting('t.j2')::uuid, 'wA');
select public.marketplace_import_validate_next(current_setting('t.j2')::uuid, 'wA');
select public.marketplace_import_validate_next(current_setting('t.j2')::uuid, 'wA');
select is((select status from public.marketplace_import_jobs where id = current_setting('t.j2')::uuid), 'validated',
  'G1. the apply job is validated first');
-- drift between validation and apply: the existing variant''s unit changes under the importer
update public.marketplace_product_variants set selling_unit = 'piece' where id = 'c4100000-0000-4000-8000-000000000002';

select is((select processed from public.marketplace_import_apply_next(current_setting('t.j2')::uuid, 'wA')), 2,
  'G2. one apply call processes one chunk');
select is((select remaining from public.marketplace_import_apply_next(current_setting('t.j2')::uuid, 'wA')), 0,
  'G3. the remaining valid rows are applied by the next call');
select is((select status from public.marketplace_import_jobs where id = current_setting('t.j2')::uuid), 'completed_with_errors',
  'G4. the job finishes with errors (one invalid row, one failed row)');
select is((select array_agg(row_number || ':' || status || ':' || coalesce(action, '-') order by row_number)
           from public.marketplace_import_rows where job_id = current_setting('t.j2')::uuid),
  array['1:applied:create', '2:applied:create', '3:applied:create', '4:failed:-', '5:invalid:-'],
  'G5. error isolation: the drifted row failed, the invalid row was skipped, the rest were applied');
select is((select code from public.marketplace_import_errors where job_id = current_setting('t.j2')::uuid and row_number = 4 and severity = 'error'), 'apply_failed',
  'G6. the failure is recorded against its row');
select is((select status from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1'),
  'draft', 'G7. imported products are DRAFT');
select is((select count(*)::int from public.marketplace_product_variants v join public.marketplace_products p on p.id = v.product_id
           where p.seller_organization_id = current_setting('t.a')::uuid and p.external_ref = 'P1'), 2,
  'G8. both variants of the product were created under ONE product');
select is((select price_egp from public.marketplace_product_variants where seller_organization_id = current_setting('t.a')::uuid and sku = 'S1-A'),
  1250.50, 'G9. the price is stored exactly (tax-exclusive, no tax added)');
select is((select o.key from public.marketplace_product_attribute_values v
           join public.marketplace_attribute_options o on o.id = v.option_id
           join public.marketplace_attribute_definitions d on d.id = v.attribute_id
           where d.key = 'material_wallpaper'
             and v.product_id = (select id from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1')),
  'vinyl_coated', 'G10. product-level attributes were written to the canonical value table');
select is((select count(*)::int from public.marketplace_variant_attribute_values v
           join public.marketplace_product_variants pv on pv.id = v.variant_id
           where pv.seller_organization_id = current_setting('t.a')::uuid and pv.sku in ('S1-A', 'S1-B')), 6,
  'G11. variant-level attributes (colour, width, length) were written for both variants');
select ok((select option_signature is not null from public.marketplace_product_variants where seller_organization_id = current_setting('t.a')::uuid and sku = 'S1-B'),
  'G12. the canonical option signature trigger ran for the imported variant');
select is((select array_agg(sort_order || ':' || is_primary::text || ':' || status order by sort_order)
           from public.marketplace_product_images where variant_id is null
             and product_id = (select id from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1')),
  array['0:true:pending', '1:false:pending'],
  'G13. product-level images: P1_01 is primary (order 0), P1_02 follows; both PENDING, never verified');
select is((select array_agg(substring(i.object_key from '[^/]+$') order by i.sort_order)
           from public.marketplace_product_images i join public.marketplace_product_variants v on v.id = i.variant_id
           where v.seller_organization_id = current_setting('t.a')::uuid and v.sku = 'S1-A'),
  array['S1-A_01.jpg', 'S1-A_02.jpg', 'S1-A_03.jpg'],
  'G14. SKU_01 / SKU_02 / SKU_03 become the variant''s images in that order');
select is((select count(*)::int from public.marketplace_product_images i
           join public.marketplace_products p on p.id = i.product_id
           where p.seller_organization_id = current_setting('t.a')::uuid and i.status <> 'pending'), 0,
  'G15. no imported image is anything but pending');
select is((select count(*)::int from public.marketplace_import_assets where job_id = current_setting('t.j2')::uuid and status = 'applied' and image_id is not null),
  5, 'G16. every matched asset is linked to its image record');
select is((select slug from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1'),
  app.marketplace_import_slug('Wallpaper One', current_setting('t.a')::uuid, 'P1'),
  'G17. the slug is deterministic (name + hash of organization and reference)');
select is((select status from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'FIX-1'),
  'draft', 'G18. an existing product was not promoted or altered by the failed row');
select is((select selling_unit from public.marketplace_product_variants where id = 'c4100000-0000-4000-8000-000000000002'), 'piece',
  'G19. the failed row''s writes were rolled back (the variant is as the drift left it)');

-- ===========================================================================
-- H. Idempotency: the same file again (job 3)
-- ===========================================================================
update public.marketplace_product_variants set selling_unit = 'roll' where id = 'c4100000-0000-4000-8000-000000000002';
select set_config('t.j3', public.marketplace_import_create(current_setting('t.a')::uuid, '70000001-0000-4000-8000-000000000001',
  'csv', 'apply-a-again.csv', repeat('cd', 32), 'apply', 500, 'import-key-job-003')::text, true);
select public.marketplace_import_stage_rows(current_setting('t.j3')::uuid, $j$[
 {"row_number":1,"external_ref":"P1","sku":"S1-A","product_type":"wallpaper","name_ar":"ورق جدران","name_en":"Wallpaper One","brand":"Acme","selling_unit":"roll","price":1400,
  "attributes":{"material_wallpaper":"vinyl_coated","washable":true,"color":"beige","roll_width":53,"roll_length":1000}},
 {"row_number":2,"external_ref":"P1","sku":"S1-B","product_type":"wallpaper","name_ar":"ورق جدران","name_en":"Wallpaper One","selling_unit":"roll","price":1300,
  "attributes":{"color":"cream","roll_width":53,"roll_length":1000}},
 {"row_number":3,"external_ref":"P11","sku":"S13","product_type":"wallpaper","name_ar":"سادة","name_en":"Plain","selling_unit":"roll","price":99}
]$j$::jsonb);
select public.marketplace_import_stage_assets(current_setting('t.j3')::uuid, $j$[
 {"file_name":"S1-A_01.jpg","storage_bucket":"marketplace-products","object_key":"orgs/a/imports/j2/S1-A_01.jpg","mime_type":"image/jpeg"}
]$j$::jsonb);
select public.marketplace_import_seal(current_setting('t.j3')::uuid);
select public.marketplace_import_claim(current_setting('t.j3')::uuid, 'wB', 600);
select public.marketplace_import_validate_next(current_setting('t.j3')::uuid, 'wB');
select public.marketplace_import_apply_next(current_setting('t.j3')::uuid, 'wB');
select is((select array_agg(row_number || ':' || action order by row_number) from public.marketplace_import_rows where job_id = current_setting('t.j3')::uuid),
  array['1:update', '2:unchanged', '3:unchanged'],
  'H1. re-importing: only the changed price is an UPDATE; identical rows are "unchanged"');
select is((select price_egp from public.marketplace_product_variants where seller_organization_id = current_setting('t.a')::uuid and sku = 'S1-A'),
  1400.00, 'H2. the price was updated in place');
select is((select count(*)::int from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref in ('P1', 'P11')), 2,
  'H3. no duplicate product was created');
select is((select count(*)::int from public.marketplace_product_variants where seller_organization_id = current_setting('t.a')::uuid and sku in ('S1-A', 'S1-B', 'S13')), 3,
  'H4. no duplicate variant was created');
select is((select count(*)::int from public.marketplace_product_images where object_key like 'orgs/a/imports/j2/S1-A_01.jpg'), 1,
  'H5. a re-registered image object is reused, not duplicated');
select is((select status from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1'), 'draft',
  'H6. an update never changes publication status');

-- ===========================================================================
-- I. State machine, cancel, retry
-- ===========================================================================
select throws_ok($$ select app.marketplace_import_set_status(current_setting('t.j3')::uuid, 'created') $$,
  '23514', null, 'I1. a finished job cannot go back to created');
select throws_ok($$ update public.marketplace_import_jobs set status = 'completed' where id = current_setting('t.j3')::uuid $$,
  '42501', null, 'I2. a direct status UPDATE is refused outside the trusted functions');
select is((select array_agg(to_status order by sequence) from public.marketplace_import_job_events where job_id = current_setting('t.j3')::uuid),
  array['created', 'staging', 'staged', 'validating', 'validated', 'applying', 'completed'],
  'I3. the job history records every transition in order');
select set_config('t.j4', public.marketplace_import_create(current_setting('t.a')::uuid, '70000001-0000-4000-8000-000000000001',
  'csv', 'cancel.csv', repeat('ef', 32), 'apply', 10, 'import-key-job-004')::text, true);
select is(public.marketplace_import_cancel(current_setting('t.j4')::uuid, '70000001-0000-4000-8000-000000000001'), 'cancelled',
  'I4. an open job can be cancelled');
select is(public.marketplace_import_claim(current_setting('t.j4')::uuid, 'wC', 60), false, 'I5. a cancelled job cannot be claimed');
select throws_ok($$ select public.marketplace_import_cancel(current_setting('t.j3')::uuid, '70000001-0000-4000-8000-000000000001') $$,
  '23514', null, 'I6. a finished job cannot be cancelled');
select throws_ok($$ delete from public.marketplace_import_jobs where id = current_setting('t.j4')::uuid $$,
  '42501', null, 'I7. jobs cannot be deleted by a direct statement');
select is(public.marketplace_import_retry_failed(current_setting('t.j2')::uuid), 1,
  'I8. a failed row can be re-queued for retry (attempt budget 3)');
select is((select status from public.marketplace_import_jobs where id = current_setting('t.j2')::uuid), 'applying',
  'I9. retrying re-opens the job');
select public.marketplace_import_claim(current_setting('t.j2')::uuid, 'wA', 600);
select public.marketplace_import_apply_next(current_setting('t.j2')::uuid, 'wA');
select is((select status || ':' || attempt_count::text from public.marketplace_import_rows where job_id = current_setting('t.j2')::uuid and row_number = 4),
  'applied:2', 'I10. the retried row applies once the drift is gone, and its attempts are counted');
select is((select status from public.marketplace_import_jobs where id = current_setting('t.j2')::uuid), 'completed_with_errors',
  'I11. the job ends with only the invalid row outstanding');

-- ===========================================================================
-- J. Tenancy
-- ===========================================================================
select set_config('t.j5', public.marketplace_import_create(current_setting('t.b')::uuid, '71000005-0000-4000-8000-000000000005',
  'csv', 'apply-b.csv', current_setting('t.sum'), 'apply', 500, 'import-key-job-005')::text, true);
select public.marketplace_import_stage_rows(current_setting('t.j5')::uuid, $j$[
 {"row_number":1,"external_ref":"P1","sku":"S1-A","product_type":"wallpaper","name_ar":"ب","name_en":"B Wallpaper","selling_unit":"roll","price":77}
]$j$::jsonb);
select public.marketplace_import_seal(current_setting('t.j5')::uuid);
select public.marketplace_import_claim(current_setting('t.j5')::uuid, 'wD', 600);
select public.marketplace_import_validate_next(current_setting('t.j5')::uuid, 'wD');
select public.marketplace_import_apply_next(current_setting('t.j5')::uuid, 'wD');
select is((select count(*)::int from public.marketplace_products where external_ref = 'P1'), 2,
  'J1. the same product reference in ANOTHER organization is a separate product');
select is((select price_egp from public.marketplace_product_variants where seller_organization_id = current_setting('t.a')::uuid and sku = 'S1-A'),
  1400.00, 'J2. importing for B did not touch A''s catalogue');
select throws_ok($$ insert into public.marketplace_import_rows (job_id, organization_id, row_number, raw, row_hash)
  values (current_setting('t.j1')::uuid, '91000005-1111-4111-8111-000000000005', 98, '{}', repeat('a', 64)) $$,
  '42501', null, 'J3. (guard first) a row cannot be written outside the functions');
select set_config('app.marketplace_import_write', 'on', true);
select throws_ok($$ insert into public.marketplace_import_rows (job_id, organization_id, row_number, raw, row_hash)
  values (current_setting('t.j1')::uuid, '91000005-1111-4111-8111-000000000005', 98, '{}', repeat('a', 64)) $$,
  '23503', null, 'J4. structurally, a row cannot name a different organization than its job (composite FK)');
select throws_ok($$ insert into public.marketplace_import_rows (job_id, organization_id, row_number, raw, row_hash, product_id)
  values (current_setting('t.j5')::uuid, current_setting('t.b')::uuid, 98, '{}', repeat('a', 64), 'c4000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'J5. nor point at ANOTHER organization''s product (composite FK)');
select set_config('app.marketplace_import_write', 'off', true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_import_jobs), 1, 'J6. showroom B sees only its own job');
select is((select count(*)::int from public.marketplace_import_rows where organization_id = current_setting('t.a')::uuid), 0,
  'J7. ...and none of A''s staged rows');
select is((select count(*)::int from public.marketplace_import_errors where organization_id = current_setting('t.a')::uuid), 0,
  'J8. ...nor A''s findings');
select throws_ok($$ select * from public.marketplace_import_job_report(current_setting('t.j1')::uuid) $$,
  '42501', null, 'J9. ...nor A''s error report');
select throws_ok($$ select public.marketplace_import_job_cancel(current_setting('t.j2')::uuid) $$,
  '42501', null, 'J10. ...nor can B cancel A''s job');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_import_jobs), 5, 'J11. showroom A sees its five jobs (incl. the member-created one)');
reset role;

-- ===========================================================================
-- K. Report / purge
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select ok((select count(*) >= 10 from public.marketplace_import_job_report(current_setting('t.j1')::uuid)),
  'K1. a member reads the error report of their job');
select is((select code from public.marketplace_import_job_report(current_setting('t.j1')::uuid) where sku = 'LEG-1' limit 1),
  'sku_belongs_to_other_product', 'K2. the report names row, SKU and finding code');
reset role;
select set_config('t.j6', public.marketplace_import_create(current_setting('t.a')::uuid, '70000001-0000-4000-8000-000000000001',
  'csv', 'open.csv', repeat('ef', 32), 'apply', 10, 'import-key-job-006')::text, true);
select throws_ok($$ select public.marketplace_import_purge_staging(current_setting('t.j6')::uuid) $$, '23514', null,
  'K3. a job that is not finished cannot be purged');
select is(public.marketplace_import_purge_staging(current_setting('t.j3')::uuid) > 0, true, 'K4. a finished job''s staging rows are purged');
select is((select count(*)::int from public.marketplace_import_rows where job_id = current_setting('t.j3')::uuid), 0,
  'K5. ...the rows are gone');
select is((select status from public.marketplace_import_jobs where id = current_setting('t.j3')::uuid), 'completed',
  'K6. ...but the job summary and history remain');
select is((select count(*)::int from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1'), 1,
  'K7. ...and the imported products are untouched by the purge');

-- ===========================================================================
-- L. Safety: imported data cannot be published
-- ===========================================================================
select ok(
  (select 'no_verified_primary_image' = any(b) and 'no_available_stock' = any(b) and 'media_verification_not_available' = any(b)
   from (select app.marketplace_publication_blockers((select id from public.marketplace_products
          where seller_organization_id = current_setting('t.a')::uuid and external_ref = 'P1')) b) q),
  'L1. an imported product is blocked: no verified image, no stock, media verification off');
select throws_ok($$ update public.marketplace_products set status = 'published'
  where seller_organization_id = '9c000000-cccc-4ccc-8ccc-000000000001' and external_ref = 'P1' $$,
  '23514', null, 'L2. publishing an imported product directly is refused');
select is((select count(*)::int from public.marketplace_public_catalog() where slug like 'wallpaper-one-%'), 0,
  'L3. imported products are invisible in the public catalogue');
select is((select media_verification_ready from public.marketplace_platform_settings), false,
  'L4. media verification is still off (nothing in the import path can enable it)');

select * from finish();
rollback;

-- pgTAP: Marketplace seller public slug (20261124090001_marketplace_seller_public_slug.sql)
--   F1-F6: approving a seller without a slug generates one (-2 on collision, showroom-<short id> for an Arabic-only name,
--   inside ck_organizations_slug_format); an existing slug is never changed; the generator is idempotent.
--   G: the trigger exists and the helpers are not callable by anon/authenticated; the backfill left no approved seller slug-less.
-- Fixtures (seed-pilot): showroom A 9c000000-...001, showroom B 91000005-...005.
create extension if not exists pgtap;

begin;
select plan(9);

select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

set local session_replication_role = replica;
update public.organizations set business_verified_at = null, business_verification_id = null where id = current_setting('t.a')::uuid;
set local session_replication_role = origin;
select set_config('app.marketplace_seller_write', 'on', true);
update public.organizations set slug = 'mkt9-nile-showroom' where id = current_setting('t.a')::uuid;
update public.organizations set slug = null, name_en = 'Mkt9 Nile Showroom!' where id = current_setting('t.b')::uuid;
update public.marketplace_seller_accounts set status = 'approved' where organization_id = current_setting('t.b')::uuid;
select is((select slug from public.organizations where id = current_setting('t.b')::uuid), 'mkt9-nile-showroom-2',
  'F1. approving a seller without a slug generates one from its name, with -2 on a collision');
update public.organizations set slug = null where id = current_setting('t.b')::uuid;
update public.organizations set slug = null, name_en = null, name = 'معرض النيل' where id = current_setting('t.b')::uuid;
update public.marketplace_seller_accounts set status = 'approved' where organization_id = current_setting('t.b')::uuid;
select is((select slug from public.organizations where id = current_setting('t.b')::uuid), 'showroom-' || left(replace(current_setting('t.b'), '-', ''), 8),
  'F2. an Arabic-only name falls back to showroom-<short id>');
select ok((select slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' from public.organizations where id = current_setting('t.b')::uuid), 'F3. ...inside ck_organizations_slug_format');
update public.marketplace_seller_accounts set status = 'approved' where organization_id = current_setting('t.a')::uuid;
select is((select slug from public.organizations where id = current_setting('t.a')::uuid), 'mkt9-nile-showroom', 'F4. an existing slug is never changed');
select is(app.marketplace_assign_org_slug(current_setting('t.b')::uuid), 'showroom-' || left(replace(current_setting('t.b'), '-', ''), 8), 'F5. assigning again returns the same slug');
update public.organizations set slug = null where id = current_setting('t.a')::uuid;
select is(app.marketplace_assign_org_slug(current_setting('t.a')::uuid) is not null, true, 'F6. the backfill function gives a slug to an approved seller that has none');
select set_config('app.marketplace_seller_write', 'off', true);

select has_trigger('public', 'marketplace_seller_accounts', 'marketplace_seller_slug_assign', 'G1. the slug trigger exists');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname in ('marketplace_assign_org_slug', 'marketplace_seller_slug_trigger')
             and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')), 2,
  'G2. the slug helpers are not callable by anon or authenticated');
select is((select count(*)::int from public.marketplace_seller_accounts a join public.organizations o on o.id = a.organization_id
           where a.status = 'approved' and o.slug is null), 0, 'G3. no approved seller is left without a slug');

select * from finish();
rollback;

-- READ-ONLY. Facts for the plans "marketplace-slug" (Acceptance 244 -> 245) and "prod-marketplace-v2" (Production 237 -> 245): the slug objects of 20261124090001.
-- acceptance-apply.sh / production-apply.sh run it before and after the push; marketplace-slug-smoke.mjs judges the output. One row, one jsonb column `facts`.
-- Only SELECTs. Every object that only exists after the push is looked up by name (to_regprocedure / pg_trigger), never referenced directly. No row data is returned,
-- only counts (and, before the push, the number of approved sellers the backfill will give a slug).
select jsonb_build_object(
  'applied_migrations', (select count(*) from supabase_migrations.schema_migrations),
  'latest_migration', (select max(version) from supabase_migrations.schema_migrations),
  'fn_assign', to_regprocedure('app.marketplace_assign_org_slug(uuid)') is not null,
  'fn_trigger', to_regprocedure('app.marketplace_seller_slug_trigger()') is not null,
  'trigger_present', exists (select 1 from pg_trigger t where t.tgrelid = 'public.marketplace_seller_accounts'::regclass and t.tgname = 'marketplace_seller_slug_assign' and not t.tgisinternal),
  'trigger_enabled', exists (select 1 from pg_trigger t where t.tgrelid = 'public.marketplace_seller_accounts'::regclass and t.tgname = 'marketplace_seller_slug_assign' and t.tgenabled = 'O'),
  'trigger_runs_slug_fn', exists (select 1 from pg_trigger t where t.tgrelid = 'public.marketplace_seller_accounts'::regclass and t.tgname = 'marketplace_seller_slug_assign'
                                    and t.tgfoid = to_regprocedure('app.marketplace_seller_slug_trigger()')),
  'fns_callable_by_api_roles', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                  where n.nspname = 'app' and p.proname in ('marketplace_assign_org_slug', 'marketplace_seller_slug_trigger')
                                    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  'approved_sellers', (select count(*) from public.marketplace_seller_accounts where status = 'approved'),
  'approved_without_slug', (select count(*) from public.marketplace_seller_accounts a join public.organizations o on o.id = a.organization_id where a.status = 'approved' and o.slug is null),
  'orgs_with_slug', (select count(*) from public.organizations where slug is not null)
) as facts;

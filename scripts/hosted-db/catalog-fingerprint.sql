-- READ-ONLY. Catalog fingerprint of schemas public and app: one jsonb object per section, key -> md5 or fact.
-- Used to prove exactly which objects a migration changed (before/after diff in catalog-diff.mjs). SELECT only; no row data.
with fn as (
  select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as id
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
), rel as (
  select c.oid, n.nspname || '.' || c.relname as id, c.relkind
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
)
select jsonb_build_object(
  'functions_def', (select coalesce(jsonb_object_agg(fn.id, md5(pg_get_functiondef(fn.oid))), '{}') from fn),
  'functions_meta', (select coalesce(jsonb_object_agg(fn.id, md5(concat_ws('|', p.prosecdef, p.provolatile, p.proleakproof, coalesce(p.proconfig::text, ''), p.proowner::regrole::text, coalesce(p.proacl::text, '<default>')))), '{}')
                     from fn join pg_proc p on p.oid = fn.oid),
  'columns', (select coalesce(jsonb_object_agg(rel.id || '.' || a.attname, md5(concat_ws('|', format_type(a.atttypid, a.atttypmod), a.attnotnull, coalesce(pg_get_expr(d.adbin, d.adrelid), ''), a.attgenerated, a.attidentity))), '{}')
              from rel join pg_attribute a on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
              left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum),
  'relations', (select coalesce(jsonb_object_agg(rel.id, md5(concat_ws('|', rel.relkind, c.relrowsecurity, c.relforcerowsecurity, c.relowner::regrole::text, coalesce(c.relacl::text, '<default>'), coalesce(c.reloptions::text, '')))), '{}')
                from rel join pg_class c on c.oid = rel.oid),
  'views_def', (select coalesce(jsonb_object_agg(rel.id, md5(pg_get_viewdef(rel.oid))), '{}') from rel where rel.relkind in ('v', 'm')),
  'indexes', (select coalesce(jsonb_object_agg(schemaname || '.' || indexname, md5(indexdef)), '{}') from pg_indexes where schemaname in ('public', 'app')),
  'constraints', (select coalesce(jsonb_object_agg(rel.id || '.' || co.conname, md5(pg_get_constraintdef(co.oid))), '{}') from rel join pg_constraint co on co.conrelid = rel.oid),
  'triggers', (select coalesce(jsonb_object_agg(rel.id || '.' || t.tgname, md5(pg_get_triggerdef(t.oid))), '{}') from rel join pg_trigger t on t.tgrelid = rel.oid where not t.tgisinternal),
  'policies', (select coalesce(jsonb_object_agg(schemaname || '.' || tablename || '.' || policyname, md5(concat_ws('|', permissive, roles::text, cmd, coalesce(qual, ''), coalesce(with_check, '')))), '{}') from pg_policies where schemaname in ('public', 'app')),
  'column_grants', (select coalesce(jsonb_object_agg(table_schema || '.' || table_name || '.' || column_name || '.' || grantee || '.' || privilege_type, true), '{}') from information_schema.column_privileges where table_schema in ('public', 'app') and grantee in ('anon', 'authenticated', 'service_role', 'public')),
  'types', (select coalesce(jsonb_object_agg(n.nspname || '.' || t.typname, md5(t.typtype::text || coalesce((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid), ''))), '{}') from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname in ('public', 'app') and t.typtype in ('e', 'd', 'c') and not exists (select 1 from pg_class c where c.reltype = t.oid)),
  'counts', jsonb_build_object('functions', (select count(*) from fn), 'relations', (select count(*) from rel))
) as fingerprint;

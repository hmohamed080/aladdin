-- Read-only. Every column of every Auth and Storage table the backup carries, as schema.table.column:type:nullable,
-- plus the Auth and Storage service migration markers. Run on Production and on the local restore stack:
-- the rehearsal restores only when the two lists are identical (no missing table, column or type difference).
select t from (
  select 1 o, format('%s.%s.%s:%s:%s', c.table_schema, c.table_name, c.column_name, c.udt_name, c.is_nullable) t
  from information_schema.columns c
  join pg_namespace n on n.nspname = c.table_schema
  join pg_class k on k.relnamespace = n.oid and k.relname = c.table_name and k.relkind in ('r','p')
  where c.table_schema in ('auth','storage')
    and format('%s.%s', c.table_schema, c.table_name) not in ('storage.buckets_vectors','storage.vector_indexes',
        'storage.iceberg_namespaces','storage.iceberg_tables','storage.buckets_analytics')
  union all
  select 2, format('marker auth.schema_migrations:%s rows, latest %s', count(*), max(version)) from auth.schema_migrations
  union all
  select 3, format('marker storage.migrations:%s rows, latest %s', count(*),
    (select name from storage.migrations order by id desc limit 1)) from storage.migrations
) x order by o, t;

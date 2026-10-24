-- Read-only. Row count of every table the backup carries (counts only, no row data).
select format('%s.%s:%s', n.nspname, c.relname,
       (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text) t
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','app','auth','storage','supabase_migrations') and c.relkind in ('r','p')
  and format('%s.%s', n.nspname, c.relname) not in ('storage.buckets_vectors','storage.vector_indexes',
      'storage.iceberg_namespaces','storage.iceberg_tables','storage.buckets_analytics','storage.migrations','auth.schema_migrations')
order by 1;

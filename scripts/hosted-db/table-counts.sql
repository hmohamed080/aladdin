-- READ-ONLY. Exact row count of every table in public, app, auth and storage (counts only, no row data).
select coalesce(jsonb_object_agg(t.sch || '.' || t.tbl,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', t.sch, t.tbl), false, true, '')))[1]::text::bigint
  order by t.sch || '.' || t.tbl), '{}'::jsonb) as counts
from (select n.nspname::text sch, c.relname::text tbl from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') and n.nspname in ('public', 'app', 'auth', 'storage')) t;

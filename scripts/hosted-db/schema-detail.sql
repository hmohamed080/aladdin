-- Read-only. One line per item behind the ACL and function categories of schema-fingerprint.sql (names, hashes and
-- privileges only, never row data), so a fingerprint difference can be traced to the exact objects. Function bodies
-- appear as md5 hashes, both as stored and with carriage returns removed (CRLF text from a Windows paste).
select t from (
  select format('function|%s.%s(%s)|body=%s|body_lf=%s|secdef=%s|volatile=%s|config=%s|acl=%s', n.nspname, p.proname,
           pg_get_function_identity_arguments(p.oid), md5(regexp_replace(p.prosrc, '^--[^\n]*\n', '', 'gn')),
           md5(regexp_replace(replace(p.prosrc, E'\r', ''), '^--[^\n]*\n', '', 'gn')), p.prosecdef, p.provolatile,
           coalesce(array_to_string(p.proconfig, ','), ''), coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x), '')) t
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select format('table_acl|%s.%s|%s', n.nspname, c.relname, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x), ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','app') and c.relkind in ('r','p','v','m','S')
  union all
  select format('column_acl|%s.%s.%s|%s', n.nspname, c.relname, a.attname, (select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x))
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','app') and a.attacl is not null and not a.attisdropped
  union all
  select format('default_acl|%s:%s:%s|%s', pg_get_userbyid(defaclrole), coalesce(n.nspname, '*'), defaclobjtype, defaclacl::text)
  from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
  where n.nspname in ('public','app') or d.defaclnamespace = 0 and pg_get_userbyid(defaclrole) = 'postgres'
) x order by 1;

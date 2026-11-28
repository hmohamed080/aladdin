-- Read-only. Per-category md5 of the application schema (public, app) plus app-owned policies/triggers
-- in auth/storage. ACL entries are sorted and constraint parentheses/spaces dropped, so a pg_dump
-- round trip (which re-deparses CHECKs, re-orders grants and drops whole-line `--` comments inside
-- function bodies) compares equal. Run on the local no-seed replay and on acceptance; matching hashes = same schema.
with
cols as (select string_agg(format('%s.%s.%s:%s:%s:%s', table_schema, table_name, column_name, data_type, is_nullable, coalesce(column_default,'')), E'\n' order by table_schema, table_name, ordinal_position) s
  from information_schema.columns where table_schema in ('public','app')),
cons as (select string_agg(format('%s.%s:%s:%s', n.nspname, c.relname, k.conname, regexp_replace(pg_get_constraintdef(k.oid), '[()[:space:]]', '', 'g')), E'\n' order by format('%s.%s:%s:%s', n.nspname, c.relname, k.conname, regexp_replace(pg_get_constraintdef(k.oid), '[()[:space:]]', '', 'g'))) s
  from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app')),
idx as (select string_agg(indexdef, E'\n' order by indexdef) s from pg_indexes where schemaname in ('public','app')),
fns as (select string_agg(format('%s.%s(%s):%s:%s:%s:%s:%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), md5(regexp_replace(p.prosrc, '^--[^\n]*\n', '', 'gn')), p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig,','),''), coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x),'')), E'\n' order by format('%s.%s(%s):%s:%s:%s:%s:%s', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), md5(regexp_replace(p.prosrc, '^--[^\n]*\n', '', 'gn')), p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig,','),''), coalesce((select string_agg(x::text, ',' order by x::text) from unnest(p.proacl) x),''))) s
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app')
    and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')),
pols as (select string_agg(format('%s.%s:%s:%s:%s:%s:%s:%s', schemaname, tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,'')), E'\n' order by format('%s.%s:%s:%s:%s:%s:%s:%s', schemaname, tablename, policyname, permissive, roles::text, cmd, coalesce(qual,''), coalesce(with_check,''))) s
  from pg_policies where schemaname in ('public','app','storage')),
rls as (select string_agg(format('%s.%s:%s:%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity), E'\n' order by format('%s.%s:%s:%s', n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity)) s
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app') and c.relkind in ('r','p')),
tacl as (select string_agg(format('%s.%s:%s', n.nspname, c.relname, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x),'')), E'\n' order by format('%s.%s:%s', n.nspname, c.relname, coalesce((select string_agg(x::text, ',' order by x::text) from unnest(c.relacl) x),''))) s
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app') and c.relkind in ('r','p','v','m','S')),
cacl as (select string_agg(t, E'\n' order by t) s from (select format('%s.%s.%s:%s', n.nspname, c.relname, a.attname, (select string_agg(x::text, ',' order by x::text) from unnest(a.attacl) x)) t
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app') and a.attacl is not null and not a.attisdropped) y),
trg as (select string_agg(format('%s.%s:%s:%s', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid)), E'\n' order by format('%s.%s:%s:%s', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid))) s
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and (n.nspname in ('public','app') or t.tgfoid in (select p.oid from pg_proc p join pg_namespace pn on pn.oid=p.pronamespace where pn.nspname in ('public','app')))),
typs as (select string_agg(format('%s.%s:%s', n.nspname, t.typname, (select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e where e.enumtypid=t.oid)), E'\n' order by format('%s.%s:%s', n.nspname, t.typname, (select string_agg(enumlabel, ',' order by enumsortorder) from pg_enum e where e.enumtypid=t.oid))) s
  from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','app') and t.typtype in ('e','d','c') and not exists (select 1 from pg_class c where c.reltype=t.oid)),
views as (select string_agg(format('%s.%s:%s:%s', schemaname, viewname, md5(definition), coalesce((select array_to_string(reloptions,',') from pg_class where oid=(schemaname||'.'||viewname)::regclass),'')), E'\n' order by format('%s.%s:%s:%s', schemaname, viewname, md5(definition), coalesce((select array_to_string(reloptions,',') from pg_class where oid=(schemaname||'.'||viewname)::regclass),''))) s
  from pg_views where schemaname in ('public','app')),
buckets as (select string_agg(format('%s:%s:%s:%s', id, public, coalesce(file_size_limit::text,''), coalesce(allowed_mime_types::text,'')), E'\n' order by id) s from storage.buckets),
dacl as (select string_agg(format('%s:%s:%s:%s', pg_get_userbyid(defaclrole), coalesce(n.nspname,'*'), defaclobjtype, defaclacl::text), E'\n' order by format('%s:%s:%s:%s', pg_get_userbyid(defaclrole), coalesce(n.nspname,'*'), defaclobjtype, defaclacl::text)) s
  from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname in ('public','app') or d.defaclnamespace=0 and pg_get_userbyid(defaclrole)='postgres'),
roles as (select string_agg(t, E'\n' order by t) s from (
  select format('%s:%s:%s:%s:%s', rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls) t from pg_roles where rolname in ('media_edge','media_edge_worker')
  union all select format('%s>%s:%s:%s:%s:%s', g.rolname, r.rolname, m.admin_option, m.inherit_option, m.set_option, pg_get_userbyid(m.grantor))
  from pg_auth_members m join pg_roles r on r.oid=m.member join pg_roles g on g.oid=m.roleid where g.rolname in ('media_edge','media_edge_worker') or r.rolname in ('media_edge','media_edge_worker')) y),
rowcounts as (select string_agg(t, E'\n' order by t) s from (
  select format('%s.%s:%s', n.nspname, c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text) t
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','app') and c.relkind='r' and c.relname in ('place_governorates','place_cities','admin_permissions','admin_roles','admin_role_permissions','trades','reserved_usernames','place_catalogue','trade_specialties','units_of_measure','verification_types')) x)
select k, md5(coalesce(s,'')) h, length(coalesce(s,'')) len from (values
 ('columns',(select s from cols)),('constraints',(select s from cons)),('indexes',(select s from idx)),('functions',(select s from fns)),
 ('policies',(select s from pols)),('rls',(select s from rls)),('table_acl',(select s from tacl)),('column_acl',(select s from cacl)),('triggers',(select s from trg)),
 ('types',(select s from typs)),('views',(select s from views)),('buckets',(select s from buckets)),('default_acl',(select s from dacl)),
 ('roles',(select s from roles)),('seeded_rowcounts',(select s from rowcounts))) v(k,s) order by k;

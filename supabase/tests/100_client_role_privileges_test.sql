-- Client roles hold only the table privileges a migration grants on purpose, whatever
-- default privileges the platform applies (hosted projects grant ALL on new objects).
create extension if not exists pgtap;
begin;
select plan(6);

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace,
     aclexplode(c.relacl) a
   where n.nspname in ('public', 'app')
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)
     and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')),
  0, 'no client role holds TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on an app object');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace,
     aclexplode(c.relacl) a
   where n.nspname in ('public', 'app') and a.grantee = 'anon'::regrole and a.privilege_type <> 'SELECT'),
  0, 'anon holds no write privilege on any app object');

select is(
  (select string_agg(format('%s.%s:%s', n.nspname, c.relname, a.privilege_type), ',' order by 1)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
   where n.nspname in ('public', 'app') and a.grantee = 'authenticated'::regrole and a.privilege_type <> 'SELECT'),
  'public.contacts:DELETE,public.user_availability_windows:DELETE',
  'authenticated writes directly only where a delete policy is the design');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace,
     aclexplode(c.relacl) a
   where n.nspname in ('public', 'app') and c.relkind = 'S'
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)),
  0, 'no client role can read or advance an app sequence');

select is(
  (select count(*)::int from pg_default_acl d, aclexplode(d.defaclacl) a
   where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
     and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole)),
  0, 'objects postgres creates in public inherit nothing for client roles');

select ok(
  has_table_privilege('authenticated', 'public.dashboard_kpi_layouts', 'SELECT')
  and not has_table_privilege('anon', 'public.dashboard_kpi_layouts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dashboard_kpi_layouts', 'INSERT,UPDATE,DELETE,TRUNCATE'),
  'KPI layouts stay readable by members and writable only through their RPCs');

select * from finish();
rollback;

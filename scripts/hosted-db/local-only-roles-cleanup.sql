-- Restore step, LOCAL rehearsal stack only (run as supabase_admin with -v prod_roles='a,b,...').
-- The security tail revokes and re-grants privileges for every role that exists on Production. A role the local
-- Supabase image creates but Production does not have is not in that list, so the grants and default privileges
-- the image gives it survive the restore and make the ACL fingerprints differ from Production's. This strips that
-- role's privileges on public/app objects and its default privileges, and prints what it removed (names only).
create temp table _prod_roles as select unnest(string_to_array(:'prod_roles', ',')) r;
create temp table _local_only as
  select rolname from pg_roles
  where rolname !~ '^pg_' and rolname !~ '^cli_login_' and rolname <> 'supabase_admin' and rolname not in (select r from _prod_roles);
select format('local-only role %s: %s table/sequence, %s column, %s function, %s default privilege entries', l.rolname,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
     where n.nspname in ('public','app') and a.grantee = r.oid),
  (select count(*) from pg_attribute t join pg_class c on c.oid = t.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(t.attacl) a
     where n.nspname in ('public','app') and a.grantee = r.oid),
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
     where n.nspname in ('public','app') and a.grantee = r.oid),
  (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) a where a.grantee = r.oid))
from _local_only l join pg_roles r on r.rolname = l.rolname order by 1;
-- Revoke only the entries such a role actually holds, object by object: a blanket REVOKE ... ON ALL ... would turn
-- every NULL (owner-default) ACL into an explicit one and make the restore differ from Production.
do $$
declare x record; o record;
begin
  for x in select l.rolname, r.oid from _local_only l join pg_roles r on r.rolname = l.rolname loop
    for o in select distinct format('%s %s', case when c.relkind = 'S' then 'sequence' else 'table' end, c.oid::regclass) q
             from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a
             where n.nspname in ('public','app') and a.grantee = x.oid loop
      execute format('revoke all on %s from %I', o.q, x.rolname);
    end loop;
    for o in select distinct format('table %s', c.oid::regclass) q
             from pg_attribute t join pg_class c on c.oid = t.attrelid join pg_namespace n on n.oid = c.relnamespace, aclexplode(t.attacl) a
             where n.nspname in ('public','app') and a.grantee = x.oid loop
      execute format('revoke all on %s from %I', o.q, x.rolname);
    end loop;
    for o in select distinct format('%s %s', case p.prokind when 'p' then 'procedure' else 'function' end, p.oid::regprocedure) q
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
             where n.nspname in ('public','app') and a.grantee = x.oid loop
      execute format('revoke all on %s from %I', o.q, x.rolname);
    end loop;
    for o in select distinct pg_get_userbyid(da.defaclrole) owner, n.nspname, da.defaclobjtype t
             from pg_default_acl da left join pg_namespace n on n.oid = da.defaclnamespace, aclexplode(da.defaclacl) a
             where a.grantee = x.oid loop
      execute format('alter default privileges for role %I %s revoke all on %s from %I', o.owner,
        case when o.nspname is null then '' else format('in schema %I', o.nspname) end,
        case o.t when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' end, x.rolname);
    end loop;
  end loop;
end $$;

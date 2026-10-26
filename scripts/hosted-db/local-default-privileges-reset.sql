-- Restore step, LOCAL rehearsal stack only, run as postgres in the restore transaction before schema.sql.
-- The local image starts with its own default privileges for role postgres in public (e.g. UPDATE on new sequences
-- for anon/authenticated/service_role) that Production does not have. Left in place they leak into every object
-- schema.sql creates and stay on objects whose ACL is NULL on Production (the security tail only rewrites objects
-- with an explicit ACL there). Clear them, so the ALTER DEFAULT PRIVILEGES statements in schema.sql alone define them.
do $$
declare d record;
begin
  for d in select distinct n.nspname, da.defaclobjtype t, a.grantee
           from pg_default_acl da join pg_namespace n on n.oid = da.defaclnamespace, aclexplode(da.defaclacl) a
           where da.defaclrole = 'postgres'::regrole and n.nspname in ('public','app') and a.grantee <> da.defaclrole loop
    execute format('alter default privileges for role postgres in schema %I revoke all on %s from %s', d.nspname,
      case d.t when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' when 'T' then 'types' when 'n' then 'schemas' end,
      case when d.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(d.grantee)) end);
  end loop;
end $$;

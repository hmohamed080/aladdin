set local search_path=pg_catalog;
select coalesce(jsonb_agg(jsonb_build_object(
 'signature',p.oid::regprocedure::text,'kind',p.prokind,'owner',pg_get_userbyid(p.proowner),
 'definer',p.prosecdef,'config',p.proconfig,
 'grants',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'grantable',a.is_grantable) order by case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.privilege_type='EXECUTE'),
 'effective',(select jsonb_object_agg(r,has_function_privilege(r,p.oid,'EXECUTE')) from unnest(array['anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin','dashboard_user']) r),
 'schemaUsage',(select jsonb_object_agg(r,has_schema_privilege(r,n.oid,'USAGE')) from unnest(array['anon','authenticated','service_role','authenticator','supabase_auth_admin','supabase_storage_admin','dashboard_user']) r)
) order by p.oid::regprocedure::text),'[]'::jsonb) as permissions
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','app') and p.prokind in ('f','p')
and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');

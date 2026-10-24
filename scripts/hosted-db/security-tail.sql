-- Read-only generator. Run on the database being backed up; it RETURNS SQL text (one statement per row)
-- that restores what `supabase db dump` leaves out or widens:
--   1. exact table/view/sequence and column privileges in public and app (a CLI restore otherwise leaves
--      anon/authenticated with TRUNCATE/REFERENCES/TRIGGER/MAINTAIN from the platform default privileges);
--   2. exact function EXECUTE privileges in public and app;
--   3. RLS policies on auth and storage tables (e.g. every storage.objects media policy);
--   4. triggers on auth and storage tables (e.g. auth.users on_auth_user_created);
--   5. role memberships the migrations granted (e.g. media_edge to postgres).
-- Save the output as security-tail.out.sql and apply it last, in the same transaction as the restore.
with roles as (
  select string_agg(quote_ident(rolname), ', ' order by rolname) r from pg_roles
  where rolname !~ '^pg_' and rolname not in ('supabase_admin')
),
rels as (
  select c.oid, c.relkind, format('%I.%I', n.nspname, c.relname) q, c.relacl
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','app') and c.relkind in ('r','p','v','m','S','f')
),
rel_sql as (
  select 10 ord, q, 0::bigint n, format('revoke all on table %s from public, %s;', q, (select r from roles)) s from rels where relacl is not null
  union all
  select 11, q, min(a.n), format('grant %s on table %s to %s%s;', string_agg(a.privilege_type, ', ' order by a.privilege_type), q,
           case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
           case when bool_or(a.is_grantable) then ' with grant option' else '' end)
  from rels, aclexplode(relacl) with ordinality a(grantor, grantee, privilege_type, is_grantable, n) group by q, a.grantee
  union all
  -- REVOKE ALL on a table also drops its column grants, so re-grant those afterwards.
  select 12, q, min(a.n), format('grant %s (%s) on table %s to %s%s;', a.privilege_type, string_agg(quote_ident(att.attname), ', ' order by att.attnum), q,
           case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
           case when a.is_grantable then ' with grant option' else '' end)
  from rels join pg_attribute att on att.attrelid = rels.oid and att.attacl is not null and not att.attisdropped,
       aclexplode(att.attacl) with ordinality a(grantor, grantee, privilege_type, is_grantable, n) group by q, a.privilege_type, a.grantee, a.is_grantable
),
fns as (
  select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) q,
         case p.prokind when 'p' then 'procedure' else 'function' end k, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app') and p.prokind in ('f','p','w')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
fn_sql as (
  select 20 ord, q, 0::bigint, format('revoke all on %s %s from public, %s;', k, q, (select r from roles)) s from fns where proacl is not null
  union all
  select 21, q, a.n, format('grant execute on %s %s to %s%s;', k, q,
           case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
           case when a.is_grantable then ' with grant option' else '' end)
  from fns, aclexplode(proacl) with ordinality a(grantor, grantee, privilege_type, is_grantable, n)
),
pol_sql as (
  select 30 ord, format('%I.%I.%I', schemaname, tablename, policyname) q, 0::bigint n,
         format('drop policy if exists %I on %I.%I; create policy %I on %I.%I as %s for %s to %s%s%s;',
           policyname, schemaname, tablename, policyname, schemaname, tablename, permissive, cmd,
           (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
           case when qual is not null then ' using (' || qual || ')' else '' end,
           case when with_check is not null then ' with check (' || with_check || ')' else '' end) s
  from pg_policies where schemaname in ('auth','storage')
),
trg_sql as (
  select 40 ord, format('%I.%I.%I', n.nspname, c.relname, t.tgname) q, 0::bigint n,
         format('drop trigger if exists %I on %I.%I; %s;', t.tgname, n.nspname, c.relname, pg_get_triggerdef(t.oid)) s
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('auth','storage')
    and t.tgfoid in (select p.oid from pg_proc p join pg_namespace pn on pn.oid = p.pronamespace where pn.nspname in ('public','app'))
),
mem_sql as (
  -- Role memberships granted by the migrations (grantor postgres), e.g. media_edge TO postgres WITH SET TRUE, INHERIT FALSE.
  select 50 ord, format('%s.%s', g.rolname, r.rolname) q, 0::bigint n,
         format('grant %I to %I with admin %s, inherit %s, set %s;', g.rolname, r.rolname, m.admin_option::text, m.inherit_option::text, m.set_option::text) s
  from pg_auth_members m join pg_roles r on r.oid = m.member join pg_roles g on g.oid = m.roleid
  where pg_get_userbyid(m.grantor) = 'postgres'
)
select s from (select * from mem_sql union all select * from rel_sql union all select * from fn_sql union all select * from pol_sql union all select * from trg_sql) x
-- Grants follow the source ACL order, so restored ACL arrays are identical, not just equivalent.
order by ord / 10, q, ord, n, s;

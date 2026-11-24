-- Forward-fix "marketplace-slug": remove what 20261124090001_marketplace_seller_public_slug.sql added.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor), and only if the slug migration must be undone.
--
-- Removes: trigger public.marketplace_seller_accounts.marketplace_seller_slug_assign and the 2 functions app.marketplace_seller_slug_trigger() and
-- app.marketplace_assign_org_slug(uuid). The migration replaced and dropped nothing else, so there is nothing to restore.
--
-- NOT undone, because it is data: the slugs written into public.organizations.slug (the backfill of approved sellers that had no slug, and every slug the
-- trigger generated after the push). They are valid, unique, harmless and are what the storefront links use (/market/sellers/<slug>); reverting them would
-- break links that were already shared. Only the restore-tested backup restores the old (null) values. After this script, a seller that is approved LATER gets no
-- slug automatically any more (the storefront then cannot address it until an admin sets organizations.slug).
--
-- Combined Production forward-fix ORDER: this file FIRST (marketplace-slug), THEN marketplace-v2-remove.sql. Both are idempotent (IF EXISTS everywhere).
--
-- SAFETY: every check runs BEFORE the first change and RAISES (nothing is dropped) when it cannot prove the removal is safe:
--   1. the trigger, if present, is on public.marketplace_seller_accounts and runs app.marketplace_seller_slug_trigger();
--   2. no other trigger runs either function;
--   3. nothing else depends on either function (pg_depend: triggers, policies, defaults, views, other functions by reference);
--   4. no function body in any non-system schema mentions either function name (dynamic SQL is not tracked by pg_depend);
--   5. the current role owns both functions (or is a superuser) so the drop cannot half-succeed.
-- Safe from a partly applied plan: absent objects are skipped and every drop is IF EXISTS.
begin;

do $guard$
declare
  v_fn_assign  oid := to_regprocedure('app.marketplace_assign_org_slug(uuid)');
  v_fn_trigger oid := to_regprocedure('app.marketplace_seller_slug_trigger()');
  v_trg        oid;
  n            bigint;
  v_names      text;
begin
  select t.oid into v_trg from pg_trigger t
   where t.tgrelid = to_regclass('public.marketplace_seller_accounts') and t.tgname = 'marketplace_seller_slug_assign' and not t.tgisinternal;
  if v_trg is not null and (select tgfoid from pg_trigger where oid = v_trg) is distinct from v_fn_trigger then
    raise exception 'marketplace-slug forward-fix refused: trigger marketplace_seller_slug_assign does not run app.marketplace_seller_slug_trigger()';
  end if;
  select count(*) into n from pg_trigger t
   where not t.tgisinternal and t.oid is distinct from v_trg and t.tgfoid in (coalesce(v_fn_assign, 0), coalesce(v_fn_trigger, 0));
  if n <> 0 then raise exception 'marketplace-slug forward-fix refused: % other trigger(s) run the slug functions', n; end if;
  select count(*), string_agg(distinct d.classid::regclass::text || ':' || d.objid, ', ') into n, v_names from pg_depend d
   where d.refclassid = 'pg_proc'::regclass and d.refobjid in (coalesce(v_fn_assign, 0), coalesce(v_fn_trigger, 0))
     and d.deptype in ('n', 'a')
     and not (d.classid = 'pg_trigger'::regclass and d.objid = v_trg)
     and not (d.classid = 'pg_proc'::regclass and d.objid in (coalesce(v_fn_assign, 0), coalesce(v_fn_trigger, 0)));
  if n <> 0 then raise exception 'marketplace-slug forward-fix refused: % other object(s) depend on the slug functions (%)', n, v_names; end if;
  select count(*), string_agg(distinct n2.nspname || '.' || p.proname, ', ') into n, v_names from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname not in ('pg_catalog', 'information_schema') and p.oid not in (coalesce(v_fn_assign, 0), coalesce(v_fn_trigger, 0))
     and (p.prosrc like '%marketplace_assign_org_slug%' or p.prosrc like '%marketplace_seller_slug_trigger%');
  if n <> 0 then raise exception 'marketplace-slug forward-fix refused: function body of % mentions a slug function', v_names; end if;
  select count(*) into n from pg_proc p
   where p.oid in (coalesce(v_fn_assign, 0), coalesce(v_fn_trigger, 0)) and not pg_has_role(current_user, p.proowner, 'usage');
  if n <> 0 then raise exception 'marketplace-slug forward-fix refused: the current role does not own the slug functions'; end if;
end
$guard$;

drop trigger if exists marketplace_seller_slug_assign on public.marketplace_seller_accounts;
drop function if exists app.marketplace_seller_slug_trigger();
drop function if exists app.marketplace_assign_org_slug(uuid);

commit;

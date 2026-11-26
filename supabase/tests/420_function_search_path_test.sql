-- pgTAP: every application function pins its search_path (20261126120002), and the nine pinned helpers still answer.
create extension if not exists pgtap;

begin;
select plan(8);

select is(
  (select coalesce(array_agg(n.nspname || '.' || p.proname order by 1), '{}')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  '{}'::text[], 'S1. no function in public or app is left without a pinned search_path');

-- the helpers run with an empty search_path: each still resolves what it names
set local search_path = public, extensions;
select is(app.admin_follow_up_status(null, now() - interval '1 day'), 'overdue', 'S2. follow-up status');
select is(app.admin_org_status_tab('active'), 'verified', 'S3. organization tab');
select is(app.admin_user_status_tab('active', 'under_review') || '/' || app.admin_user_verification_state(true, null),
  'pending/verified', 'S4. user tab and verification state');
select is(app.normalize_org_name('  Nile - Ceramics، Co. '), 'nile ceramics co', 'S5. organization name normalisation');
create temp table t420_place as
  select c.governorate_key as gov, c.key as city, c.name_norm as city_name,
         (select g.name_norm from app.place_governorates g where g.key = c.governorate_key order by g.name_norm limit 1) as gov_name
    from app.place_cities c order by c.governorate_key, c.key, c.name_norm limit 1;
select is(app.resolve_governorate(gov_name) || '/' || app.resolve_city(gov, city_name), gov || '/' || city,
  'S6. governorate and city resolve') from t420_place;
select is(app.user_facing_email('x@craftsman-login.aladdin.invalid'), null, 'S7. internal login alias stays hidden');

create temp table t420 (id int, updated_at timestamptz);
create trigger t420_touch before update on t420 for each row execute function app.set_updated_at();
insert into t420 values (1, '2000-01-01');
update t420 set id = 2;
select ok((select updated_at > '2000-01-02' from t420), 'S8. the updated_at trigger still stamps');

select * from finish();
rollback;

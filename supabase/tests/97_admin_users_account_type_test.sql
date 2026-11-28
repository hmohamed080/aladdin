-- pgTAP: Admin Users directory — the derived account type and the filters that use it
-- (20261021090003_admin_users_account_type.sql).
--
--   A. app.user_account_type: persona, owned organization, onboarding choice, none
--   B. admin_users_list type filter over the full table (incl. a Craftsman not yet activated)
--   C. Combined filters, counts, pagination, rejected values
--   D. Row and detail outputs; phone search with a local trunk 0
--   E. The live app's admin_users_list signature answers through the same fix
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(31);

\set padmin '55555555-5555-4555-8555-555555555555'
\set craft  '68000000-0000-4000-8000-000000000001'
\set showr  '68000000-0000-4000-8000-000000000002'
\set design '68000000-0000-4000-8000-000000000003'
\set bizsel '68000000-0000-4000-8000-000000000004'
\set consum '68000000-0000-4000-8000-000000000005'
\set nobody '68000000-0000-4000-8000-000000000006'
\set engown '68000000-0000-4000-8000-000000000007'
\set member '68000000-0000-4000-8000-000000000008'
\set craft2 '68000000-0000-4000-8000-000000000009'
\set orgS   '68000000-0000-4000-8000-00000000b001'
\set orgD   '68000000-0000-4000-8000-00000000b002'
\set orgS2  '68000000-0000-4000-8000-00000000b003'

create function pg_temp.call_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute 'select (' || p_sql || ')::jsonb' into r;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return r;
exception when others then
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return jsonb_build_object('sqlstate', sqlstate);
end;
$$;
create function pg_temp.ul(p_args text) returns jsonb language sql as $$
  select pg_temp.call_as('55555555-5555-4555-8555-555555555555', 'public.admin_users_directory(' || p_args || ')') $$;
create function pg_temp.ids(p jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((r ->> 'id')::uuid order by (r ->> 'id')), '{}') from jsonb_array_elements(p -> 'rows') r $$;

-- ---------------------------------------------------------------------------
-- Fixtures: nine "Theta Kind" people, none with an activated primary_account_type except engown.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select ('68000000-0000-4000-8000-00000000000' || g)::uuid, '00000000-0000-0000-0000-000000000000',
       'authenticated', 'authenticated', 'tk' || g || '@probe.test', now(),
       jsonb_build_object('full_name', 'Theta Kind ' || g), now(), now()
from generate_series(1, 9) g;
update public.profiles set display_name = 'Theta Kind ' || right(user_id::text, 1)
 where user_id::text like '68000000-0000-4000-8000-00000000000_';
update public.users set primary_account_type = null where id::text like '68000000-0000-4000-8000-00000000000_';

-- A Craftsman awaiting review: declared persona only (the live majority).
insert into public.individual_onboarding (user_id, prof_concrete_type, prof_governorate) values
  (:'craft', 'installer_technician', 'giza'),
  (:'craft2', 'installer_technician', 'cairo');
update public.profiles set phone_e164 = '+201068123456' where user_id = :'craft';
update public.users set status = 'suspended' where id = :'craft2';

-- Business owners: org.manage on an active membership.
insert into public.organizations (id, name, org_type, status, created_by) values
  (:'orgS', 'Theta Showroom', 'showroom_dealer', 'active', :'showr'),
  (:'orgD', 'Theta Design', 'design_office', 'active', :'design'),
  (:'orgS2', 'Theta Showroom Two', 'showroom_dealer', 'active', :'engown');
insert into public.memberships (id, user_id, organization_id, status) values
  ('68000000-0000-4000-8000-00000000c001', :'showr', :'orgS', 'active'),
  ('68000000-0000-4000-8000-00000000c002', :'design', :'orgD', 'active'),
  ('68000000-0000-4000-8000-00000000c003', :'engown', :'orgS2', 'active'),
  ('68000000-0000-4000-8000-00000000c004', :'member', :'orgS', 'active');
insert into public.membership_capabilities (membership_id, capability_key) values
  ('68000000-0000-4000-8000-00000000c001', 'org.manage'),
  ('68000000-0000-4000-8000-00000000c002', 'org.manage'),
  ('68000000-0000-4000-8000-00000000c003', 'org.manage');

-- Onboarding choices only.
insert into public.onboarding_progress (user_id, selected_track, selected_org_type) values (:'bizsel', 'business', 'supplier');
insert into public.onboarding_progress (user_id, selected_track) values (:'consum', 'consumer');

-- An activated Engineer who also owns a showroom: the person's persona is the account.
update public.users set primary_account_type = 'engineer' where id = :'engown';

-- ---------------------------------------------------------------------------
-- A. Derivation
-- ---------------------------------------------------------------------------
select is(app.user_account_type(:'craft'), 'installer_technician', 'A1 declared Craftsman persona is the account type');
select is(app.user_account_type(:'showr'), 'showroom_dealer', 'A2 a showroom owner is a Showroom account');
select is(app.user_account_type(:'design'), 'engineer', 'A3 a design_office owner is an Engineer account');
select is(app.user_account_type(:'bizsel'), 'supplier', 'A4 a business choice during onboarding counts');
select is(app.user_account_type(:'consum'), 'end_consumer', 'A5 the consumer track is a Personal account');
select is(app.user_account_type(:'nobody'), null, 'A6 no choice yet: NULL');
select is(app.user_account_type(:'engown'), 'engineer', 'A7 the personal persona wins over an owned organization');
select is(app.user_account_type(:'member'), null, 'A8 a plain member does not inherit the organization type');
select ok(not has_function_privilege('authenticated', 'app.user_account_type(uuid)', 'execute'), 'A9 the helper is not callable by clients');

-- ---------------------------------------------------------------------------
-- B. Type filter over the full table
-- ---------------------------------------------------------------------------
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'installer_technician'$$))
          = array[:'craft', :'craft2']::uuid[], 'B1 Craftsman filter finds the not-yet-activated Craftsmen');
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'showroom_dealer'$$))
          = array[:'showr']::uuid[], 'B2 Showroom filter is accepted and finds only the owner');
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'engineer'$$))
          = array[:'design', :'engown']::uuid[], 'B3 Engineer filter: design office owner and activated engineer');
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'supplier'$$))
          = array[:'bizsel']::uuid[], 'B4 Supplier filter');
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'end_consumer'$$))
          = array[:'consum']::uuid[], 'B5 Personal filter');
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'none'$$))
          = array[:'nobody', :'member']::uuid[], 'B6 "none" lists people with no account yet');
select is((pg_temp.ul($$p_account_type => 'installer_technician', p_page_size => 100$$) ->> 'total')::int,
          (select count(*)::int from public.users u where app.user_account_type(u.id) = 'installer_technician'),
          'B7 the filter total equals the full-table count');

-- ---------------------------------------------------------------------------
-- C. Combined filters, counts, pagination, rejected values
-- ---------------------------------------------------------------------------
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'installer_technician', p_status => 'suspended'$$))
          = array[:'craft2']::uuid[], 'C1 type AND status tab');
select is(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'installer_technician', p_status => 'suspended'$$) -> 'counts' ->> 'all',
          '2', 'C2 tab counts keep the type filter but not the tab');
select ok(pg_temp.ids(pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'installer_technician', p_governorate => 'giza'$$))
          = array[:'craft']::uuid[], 'C3 type AND governorate');
select is(jsonb_array_length(pg_temp.ul($$p_search => 'Theta Kind', p_page_size => 10, p_page => 1$$) -> 'rows'), 9, 'C4 all nine on one page');
select is((pg_temp.ul($$p_search => 'Theta Kind', p_account_type => 'engineer', p_page => 2, p_page_size => 10$$) ->> 'page')::int, 1,
          'C5 a page past the end is clamped');
select is(pg_temp.ul($$p_account_type => 'showroom'$$) ->> 'sqlstate', '22023', 'C6 an unknown type is refused, not ignored');
select is(pg_temp.ul($$p_account_type => 'contractor_company'$$) ->> 'sqlstate', '22023', 'C7 internal org types are not account keys');
select is(pg_temp.call_as(:'craft', $$public.admin_users_directory(p_account_type => 'installer_technician')$$) ->> 'sqlstate', '42501',
          'C8 a non-staff caller is refused');

-- ---------------------------------------------------------------------------
-- D. Outputs and phone search
-- ---------------------------------------------------------------------------
select is((select r ->> 'account_type' from jsonb_array_elements(pg_temp.ul($$p_search => 'Theta Kind 1'$$) -> 'rows') r
            where r ->> 'id' = :'craft'), 'installer_technician', 'D1 the row shows the derived type');
select ok((select r -> 'account_type' = 'null'::jsonb from jsonb_array_elements(pg_temp.ul($$p_search => 'Theta Kind 6'$$) -> 'rows') r
            where r ->> 'id' = :'nobody'), 'D2 no type is null, never a guess');
select is(pg_temp.call_as(:'padmin', format('public.admin_user_detail(%L::uuid)', :'showr')) ->> 'account_type', 'showroom_dealer',
          'D3 the detail shows the derived type');
select ok(pg_temp.ids(pg_temp.ul($$p_search => '0106812'$$)) = array[:'craft']::uuid[], 'D4 a partial local number with its 0 matches');
select ok(pg_temp.ids(pg_temp.ul($$p_search => '01068123456'$$)) = array[:'craft']::uuid[], 'D5 a full local number matches');
select ok(pg_temp.ids(pg_temp.ul($$p_search => '+20 106 812'$$)) = array[:'craft']::uuid[], 'D6 an international partial matches');

-- ---------------------------------------------------------------------------
-- E. Legacy signature
-- ---------------------------------------------------------------------------
select ok(pg_temp.ids(pg_temp.call_as(:'padmin', $$public.admin_users_list(p_search => 'Theta Kind', p_account_type => 'installer_technician')$$))
          = array[:'craft', :'craft2']::uuid[], 'E1 admin_users_list (persona signature) finds the not-yet-activated Craftsmen too');

select * from finish();
rollback;

-- pgTAP: Sprint 6 sales ownership edit paths + scoped Realtime publication.
--
-- Proves the two new trusted RPCs (set_customer_ownership, set_lead_source_branch):
-- security posture (definer, pinned search_path, exact grants, anon/service_role
-- denied), organization/branch/capability rules, optimistic concurrency, audit on
-- success, NO audit on conflict, lifecycle-field immutability, assignee branch-
-- compatibility (strand rejection), cross-tenant branch rejection, and direct-DML
-- denial — plus that the Realtime publication contains EXACTLY the two approved
-- tables and no sensitive/identity table. The true two-session serialization is
-- proven by the companion race scripts.
create extension if not exists pgtap;

begin;
select plan(34);

-- Branch-limited caller e2222 (Cairo only): grant sales.read + sales.write, but
-- deliberately NO sales.assign and NO manage (so we can prove the assign gate).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.read'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.write')
on conflict do nothing;

-- Fixtures (as postgres). Cairo = c1111111, Sheikh Zayed = c2222222. e1111 is the
-- org manager; e2222 is Cairo-limited. All customers/leads are Cairo/assignee e2222.
insert into public.customers (id, organization_id, branch_id, display_name, assigned_membership_id, created_by) values
  ('c0000001-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','Own Cust',   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','22222222-2222-4222-8222-222222222222'),
  ('c0000002-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','Stale Cust', 'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','22222222-2222-4222-8222-222222222222'),
  ('c0000003-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','BL Cust',    'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','22222222-2222-4222-8222-222222222222');
insert into public.leads (id, organization_id, branch_id, title, source, status, stage, assigned_membership_id, created_by) values
  ('1eadf001-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','Own Lead',   'referral','active','qualified','e2222222-eeee-4eee-8eee-eeeeeeeeeee2','22222222-2222-4222-8222-222222222222'),
  ('1eadf002-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','Strand Lead','referral','active','qualified','e2222222-eeee-4eee-8eee-eeeeeeeeeee2','22222222-2222-4222-8222-222222222222'),
  ('1eadf003-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','BL Lead',    'referral','active','qualified','e2222222-eeee-4eee-8eee-eeeeeeeeeee2','22222222-2222-4222-8222-222222222222');

create temp table _o as
  select (select updated_at from public.customers where id='c0000002-0000-4000-8000-000000000002') as stale_u0;
grant select on _o to authenticated, anon, service_role;

-- ===== Catalog / security posture ==========================================
select is((select prosecdef from pg_proc where proname='set_customer_ownership'), true,  'set_customer_ownership is security definer');
select is((select prosecdef from pg_proc where proname='set_lead_source_branch'), true,  'set_lead_source_branch is security definer');
select is((select array_to_string(proconfig,',') from pg_proc where proname='set_customer_ownership'), 'search_path=""', 'set_customer_ownership pins empty search_path');
select is((select array_to_string(proconfig,',') from pg_proc where proname='set_lead_source_branch'), 'search_path=""', 'set_lead_source_branch pins empty search_path');
select ok(has_function_privilege('authenticated','public.set_customer_ownership(uuid,timestamptz,boolean,uuid,boolean,uuid)','EXECUTE'), 'authenticated may execute set_customer_ownership');
select ok(has_function_privilege('authenticated','public.set_lead_source_branch(uuid,integer,boolean,public.sales_source,boolean,uuid,boolean,uuid)','EXECUTE'), 'authenticated may execute set_lead_source_branch');
select ok(not has_function_privilege('anon','public.set_customer_ownership(uuid,timestamptz,boolean,uuid,boolean,uuid)','EXECUTE'), 'anon may NOT execute set_customer_ownership (PUBLIC revoked)');
select ok(not has_function_privilege('anon','public.set_lead_source_branch(uuid,integer,boolean,public.sales_source,boolean,uuid,boolean,uuid)','EXECUTE'), 'anon may NOT execute set_lead_source_branch');
select ok(not has_function_privilege('service_role','public.set_customer_ownership(uuid,timestamptz,boolean,uuid,boolean,uuid)','EXECUTE'), 'service_role gains no browser authority on set_customer_ownership');
select ok(not has_function_privilege('service_role','public.set_lead_source_branch(uuid,integer,boolean,public.sales_source,boolean,uuid,boolean,uuid)','EXECUTE'), 'service_role gains no browser authority on set_lead_source_branch');

-- ===== Realtime publication membership ======================================
select is(
  (select string_agg(c.relname, ',' order by c.relname)
     from pg_publication p
     join pg_publication_rel pr on pr.prpubid = p.oid
     join pg_class c on c.oid = pr.prrelid
    where p.pubname = 'supabase_realtime'),
  'follow_up_tasks,leads',
  'supabase_realtime publishes EXACTLY the two approved sales tables');
select ok(
  not exists (
    select 1 from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    where p.pubname = 'supabase_realtime'
      and c.relname in ('customers','users','profiles','verifications','audit_log','memberships','membership_capabilities','contact_points')),
  'no sensitive/identity/customer-PII table is published to Realtime');

-- ===== Manager (e1111, org-wide) authorized behavior ========================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- Customer: move Cairo → SZ + reassign to the manager (who reaches SZ).
select lives_ok(
  $$ select public.set_customer_ownership('c0000001-0000-4000-8000-000000000001',
       (select updated_at from public.customers where id='c0000001-0000-4000-8000-000000000001'),
       p_change_branch => true, p_new_branch_id => 'c2222222-cccc-4ccc-8ccc-cccccccccccc',
       p_change_assignee => true, p_new_assignee_membership_id => 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  'manager moves a customer between branches and reassigns');
select is((select branch_id from public.customers where id='c0000001-0000-4000-8000-000000000001'), 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'customer branch updated to Sheikh Zayed');
select is((select assigned_membership_id from public.customers where id='c0000001-0000-4000-8000-000000000001'), 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'customer reassigned to the manager');

-- Customer: "no change requested" is rejected.
select throws_ok(
  $$ select public.set_customer_ownership('c0000002-0000-4000-8000-000000000002',
       (select stale_u0 from _o)) $$,
  '22023', null, 'set_customer_ownership with no change flags is rejected');

-- Customer: stale updated_at token is rejected (mismatched token; now() is
-- constant per txn — the true race is the companion .sh script).
select throws_ok(
  $$ select public.set_customer_ownership('c0000002-0000-4000-8000-000000000002',
       (select stale_u0 from _o) - interval '1 hour',
       p_change_assignee => true, p_new_assignee_membership_id => 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  '40001', null, 'a mismatched expected updated_at is rejected (40001)');

-- Lead: change source + branch + reassign in one call.
select is(
  (select public.set_lead_source_branch('1eadf001-0000-4000-8000-000000000001',
     (select version from public.leads where id='1eadf001-0000-4000-8000-000000000001'),
     p_change_source => true, p_new_source => 'campaign',
     p_change_branch => true, p_new_branch_id => 'c2222222-cccc-4ccc-8ccc-cccccccccccc',
     p_reassign => true, p_reassign_membership_id => 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1')),
  2, 'set_lead_source_branch returns the bumped version');
select is((select source::text from public.leads where id='1eadf001-0000-4000-8000-000000000001'), 'campaign', 'lead source updated');
select is((select branch_id from public.leads where id='1eadf001-0000-4000-8000-000000000001'), 'c2222222-cccc-4ccc-8ccc-cccccccccccc', 'lead branch updated');
-- Lifecycle immutability: status/stage are untouched by this RPC.
select is((select status::text || '/' || stage::text from public.leads where id='1eadf001-0000-4000-8000-000000000001'), 'active/qualified', 'lifecycle (status/stage) is NOT changed by set_lead_source_branch');

-- Lead: stale version rejected (audit-count consequence checked at the end as a
-- privileged reader, since audit_log RLS hides rows from the authenticated caller).
select throws_ok(
  $$ select public.set_lead_source_branch('1eadf002-0000-4000-8000-000000000002', 999,
       p_change_source => true, p_new_source => 'phone') $$,
  '40001', null, 'a stale lead version is rejected (40001)');

-- Lead: strand rejection — moving to SZ while keeping the Cairo-only assignee.
select throws_ok(
  $$ select public.set_lead_source_branch('1eadf002-0000-4000-8000-000000000002',
       (select version from public.leads where id='1eadf002-0000-4000-8000-000000000002'),
       p_change_branch => true, p_new_branch_id => 'c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '22023', null, 'a branch move that strands the current assignee is rejected');

-- Lead: cross-tenant / unknown branch is rejected.
select throws_ok(
  $$ select public.set_lead_source_branch('1eadf002-0000-4000-8000-000000000002',
       (select version from public.leads where id='1eadf002-0000-4000-8000-000000000002'),
       p_change_branch => true, p_new_branch_id => '99999999-9999-4999-8999-999999999999') $$,
  '22023', null, 'a branch outside the organization is rejected');

-- ===== Branch-limited caller (e2222: write only, Cairo) =====================
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

-- No sales.assign → an ownership change is denied at the capability gate.
select throws_ok(
  $$ select public.set_customer_ownership('c0000003-0000-4000-8000-000000000003',
       (select updated_at from public.customers where id='c0000003-0000-4000-8000-000000000003'),
       p_change_assignee => true, p_new_assignee_membership_id => 'e1111111-eeee-4eee-8eee-eeeeeeeeeee1') $$,
  '42501', null, 'reassigning a customer without sales.assign is denied');
select throws_ok(
  $$ select public.set_lead_source_branch('1eadf003-0000-4000-8000-000000000003',
       (select version from public.leads where id='1eadf003-0000-4000-8000-000000000003'),
       p_change_branch => true, p_new_branch_id => 'c2222222-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501', null, 'moving a lead branch without sales.assign is denied');

-- Source-only edit needs only sales.write → allowed for the branch-limited owner.
select lives_ok(
  $$ select public.set_lead_source_branch('1eadf003-0000-4000-8000-000000000003',
       (select version from public.leads where id='1eadf003-0000-4000-8000-000000000003'),
       p_change_source => true, p_new_source => 'phone') $$,
  'a source-only edit is allowed with sales.write');
select is((select source::text from public.leads where id='1eadf003-0000-4000-8000-000000000003'), 'phone', 'lead source updated by the branch-limited owner');
select is((select branch_id from public.leads where id='1eadf003-0000-4000-8000-000000000003'), 'c1111111-cccc-4ccc-8ccc-cccccccccccc', 'branch is unchanged by a source-only edit');

-- ===== Direct-DML denial (base tables are SELECT-only for clients) ==========
select throws_ok(
  $$ update public.leads set source = 'other' where id = '1eadf003-0000-4000-8000-000000000003' $$,
  '42501', null, 'direct UPDATE on public.leads is denied (RPC-only write path)');
select throws_ok(
  $$ update public.customers set branch_id = 'c2222222-cccc-4ccc-8ccc-cccccccccccc' where id = '1eadf003-0000-4000-8000-000000000003' $$,
  '42501', null, 'direct UPDATE on public.customers is denied (RPC-only write path)');

-- ===== Audit-trail assertions (privileged read — bypass audit_log RLS) =======
reset role;
select ok(exists(select 1 from public.audit_log where subject_id='c0000001-0000-4000-8000-000000000001' and action='customer.reassigned'),
  'customer.reassigned audit event emitted on the successful move');
select ok(exists(select 1 from public.audit_log where subject_id='1eadf001-0000-4000-8000-000000000001' and action='lead.details_changed'),
  'lead.details_changed audit event emitted on the successful lead edit');
select is((select count(*) from public.audit_log where subject_id='1eadf002-0000-4000-8000-000000000002' and action='lead.details_changed'),
  0::bigint, 'NO audit event is written for the lead whose edits all failed (conflict/strand/cross-tenant)');

select * from finish();
rollback;

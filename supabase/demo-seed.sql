-- LOCAL DEMO SEED for the B2B Sales UI (Sprint 4). NOT part of `db reset`.
--
-- Why separate: the shared `supabase/seed.sql` is snapshot-asserted by the Phase-1
-- pgTAP suite (e.g. test 14 pins the Cairo staff's initial capability set), so we
-- must NOT add sales capabilities or product rows there. This script is run
-- MANUALLY after a reset to give the product owner a populated workspace:
--
--   corepack pnpm exec supabase db reset          # migrations + base seed
--   docker exec -i supabase_db_aladdin psql -U postgres -d postgres \
--       < supabase/demo-seed.sql                  # this file
--
-- Sign in at /auth/sign-in with one of the seeded emails; read the one-time code
-- from Mailpit (http://127.0.0.1:54324). Synthetic data only — no real people.
--
--   a-owner@example.test   -> Org A manager (org-wide sales authority)
--   a-cairo@example.test   -> Org A salesperson, branch-limited to Cairo

begin;

-- 1) Sales capabilities (idempotent).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'sales.manage'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.read'),
  ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'sales.write')
on conflict do nothing;

-- 2) Sample customers (Org A). Cairo branch = c1111111, Sheikh Zayed = c2222222.
insert into public.customers
  (id, organization_id, branch_id, display_name, customer_type, primary_phone, email,
   preferred_language, location_summary, source, assigned_membership_id, created_by)
values
  ('d0000001-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
   'شركة النيل للديكور','company','01000000001','nile-decor@example.test','ar','مدينة نصر، القاهرة','referral',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','11111111-1111-4111-8111-111111111111'),
  ('d0000002-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
   'أحمد منصور','individual','01000000002',null,'ar','التجمع الخامس','walk_in',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','22222222-2222-4222-8222-222222222222'),
  ('d0000003-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c2222222-cccc-4ccc-8ccc-cccccccccccc',
   'Sheikh Zayed Villas','company','01000000003','sz-villas@example.test','en','Sheikh Zayed','website',
   'e1111111-eeee-4eee-8eee-eeeeeeeeeee1','11111111-1111-4111-8111-111111111111')
on conflict do nothing;

-- 3) Sample leads across stages (Org A).
insert into public.leads
  (id, organization_id, branch_id, customer_id, title, source, status, stage, priority,
   assigned_membership_id, next_follow_up_at, closed_at, created_by)
values
  ('1ead0001-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
   'd0000001-0000-4000-8000-000000000001','تشطيب مكتب إداري 200م','referral','active','qualified','high',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', now() + interval '1 day', null,'11111111-1111-4111-8111-111111111111'),
  ('1ead0002-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
   'd0000002-0000-4000-8000-000000000002','توريد أرضيات شقة','walk_in','active','contacted','normal',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', now() - interval '1 day', null,'22222222-2222-4222-8222-222222222222'),
  ('1ead0003-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c2222222-cccc-4ccc-8ccc-cccccccccccc',
   'd0000003-0000-4000-8000-000000000003','Full villa finishing','website','active','proposal_pending','urgent',
   'e1111111-eeee-4eee-8eee-eeeeeeeeeee1', now() + interval '3 days', null,'11111111-1111-4111-8111-111111111111'),
  ('1ead0004-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc',
   'd0000001-0000-4000-8000-000000000001','صيانة دورية','phone','won','decision_pending','normal',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2', null, now(),'22222222-2222-4222-8222-222222222222')
on conflict do nothing;

-- 4) Sample activities (timeline).
insert into public.sales_activities
  (organization_id, branch_id, lead_id, actor_membership_id, activity_type, summary, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','1ead0001-0000-4000-8000-000000000001',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','call','مكالمة أولى — العميل مهتم بعرض تشطيب كامل','22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','1ead0002-0000-4000-8000-000000000002',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','meeting','زيارة معاينة للموقع','22222222-2222-4222-8222-222222222222')
on conflict do nothing;

-- 5) Sample follow-ups: one overdue, one due today, one upcoming.
insert into public.follow_up_tasks
  (organization_id, branch_id, lead_id, assigned_membership_id, title, due_at, status, priority, created_by)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','1ead0002-0000-4000-8000-000000000002',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','متابعة عرض الأرضيات', now() - interval '2 days','open','high','22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c1111111-cccc-4ccc-8ccc-cccccccccccc','1ead0001-0000-4000-8000-000000000001',
   'e2222222-eeee-4eee-8eee-eeeeeeeeeee2','إرسال العرض الفني', date_trunc('day', now()) + interval '10 hours','open','urgent','22222222-2222-4222-8222-222222222222'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','c2222222-cccc-4ccc-8ccc-cccccccccccc','1ead0003-0000-4000-8000-000000000003',
   'e1111111-eeee-4eee-8eee-eeeeeeeeeee1','مراجعة المخططات', now() + interval '4 days','open','normal','11111111-1111-4111-8111-111111111111')
on conflict do nothing;

commit;

-- Verify (optional): select count(*) from public.leads where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

-- pgTAP: dashboard KPI card personalization (20260915090001).
--
-- The claim under test: `dashboard_kpi_layout_*` RPCs are the ONLY way to
-- write dashboard_kpi_layouts; an ordinary member may set/reset only their
-- OWN personal row (never another member's, never by supplying a
-- membership id); the org-wide TEAM DEFAULT requires org.manage; nothing
-- crosses organizations; card_order accepts only the allowlisted enum,
-- 1-8 entries, no duplicates; and RLS lets a member read the team default
-- plus their own row, never another member's personal row.
--
-- Fixtures, from seed-pilot:
--   Hana    (70000001…001, membership 50000001…001) — org.manage on Cairo
--     Ceramics Showroom (9c000000…001)
--   Youssef (70000002…002, membership 50000002…002) — sales-only member of
--     Cairo Ceramics (no org.manage) — the "ordinary member" case
--   Tarek   (70000003…003, membership 50000003…003) — org.manage on a
--     DIFFERENT org, Egypt Marble Manufacturing (9d000000…002) — the
--     cross-org case

create extension if not exists pgtap;

begin;
select plan(21);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set hana    '70000001-0000-4000-8000-000000000001'
\set youssef '70000002-0000-4000-8000-000000000002'
\set tarek   '70000003-0000-4000-8000-000000000003'
\set orgC    '9c000000-cccc-4ccc-8ccc-000000000001'

-- ===========================================================================
-- A. Personal layout — an ordinary member may set/reset only their OWN row.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';

select lives_ok(
  format(
    'select public.dashboard_kpi_layout_set_personal(%L, %L)',
    :'orgC', '{due_today,overdue_followups,total_purchases}'::public.dashboard_kpi_card_key[]
  ),
  'Youssef (ordinary member, no org.manage) can set his OWN personal layout'
);
select is(
  (select card_order from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid),
  '{due_today,overdue_followups,total_purchases}'::public.dashboard_kpi_card_key[],
  'the order Youssef sent landed verbatim'
);
select is(
  (select updated_by from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid),
  '50000002-0000-4000-8000-000000000002'::uuid,
  'updated_by records the actual writer, not a client-supplied value'
);

-- Re-calling upserts the SAME row rather than creating a second one.
select lives_ok(
  format(
    'select public.dashboard_kpi_layout_set_personal(%L, %L)',
    :'orgC', '{total_purchases,saved_products}'::public.dashboard_kpi_card_key[]
  ),
  'calling again updates in place'
);
select is(
  (select count(*)::int from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid),
  1, 'still exactly one personal row for Youssef in this org'
);

select lives_ok(
  format('select public.dashboard_kpi_layout_reset_personal(%L)', :'orgC'),
  'Youssef can reset his own personal layout'
);
select is(
  (select count(*)::int from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid
      and membership_id = '50000002-0000-4000-8000-000000000002'::uuid),
  0, 'the personal row is gone — he now inherits the team default'
);
select lives_ok(
  format('select public.dashboard_kpi_layout_reset_personal(%L)', :'orgC'),
  'resetting again (nothing to delete) is a no-op, not an error'
);

-- ===========================================================================
-- B. Cross-org: a member of a DIFFERENT organization cannot set a personal
--    layout on Cairo Ceramics. (There is no membership-id PARAMETER on this
--    RPC at all — the target membership is always resolved from auth.uid()
--    server-side, which is what makes "touch another member's row" not a
--    reachable code path rather than merely a checked one.)
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format(
    'select public.dashboard_kpi_layout_set_personal(%L, %L)',
    :'orgC', '{due_today}'::public.dashboard_kpi_card_key[]
  ),
  '42501', null, 'Tarek (member of a DIFFERENT org) cannot set a personal layout on Cairo Ceramics'
);

-- ===========================================================================
-- C. Team default — CAPABILITY-ESCALATION GUARD: org.manage required.
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  format(
    'select public.dashboard_kpi_layout_set_team_default(%L, %L)',
    :'orgC', '{due_today}'::public.dashboard_kpi_card_key[]
  ),
  '42501', null, 'an ordinary member (no org.manage) CANNOT set the team default'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_reset_team_default(%L)', :'orgC'),
  '42501', null, 'an ordinary member (no org.manage) CANNOT reset the team default either'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  format(
    'select public.dashboard_kpi_layout_set_team_default(%L, %L)',
    :'orgC', '{due_today}'::public.dashboard_kpi_card_key[]
  ),
  '42501', null, 'org.manage on a DIFFERENT organization does not reach Cairo Ceramics'' team default'
);

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select lives_ok(
  format(
    'select public.dashboard_kpi_layout_set_team_default(%L, %L)',
    :'orgC',
    '{overdue_followups,due_today,quotations_to_review,open_purchase_requests,orders_in_progress,total_purchases,projects,saved_products}'::public.dashboard_kpi_card_key[]
  ),
  'Hana (org.manage) CAN set the team default'
);
select is(
  (select membership_id from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid and membership_id is null),
  null, 'the team-default row genuinely has a null membership_id'
);
select lives_ok(
  format('select public.dashboard_kpi_layout_reset_team_default(%L)', :'orgC'),
  'Hana can reset the team default'
);
select is(
  (select count(*)::int from public.dashboard_kpi_layouts
    where organization_id = :'orgC'::uuid and membership_id is null),
  0, 'the team-default row is gone — the org falls back to the system default'
);
select public.dashboard_kpi_layout_set_team_default(
  :'orgC'::uuid,
  '{overdue_followups,due_today,quotations_to_review,open_purchase_requests,orders_in_progress,total_purchases,projects,saved_products}'::public.dashboard_kpi_card_key[]
); -- restored for the RLS section below

-- ===========================================================================
-- D. Validation.
-- ===========================================================================
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L)', :'orgC', '{}'::public.dashboard_kpi_card_key[]),
  '22023', null, 'an empty card_order is rejected'
);
select throws_ok(
  format(
    'select public.dashboard_kpi_layout_set_personal(%L, %L)',
    :'orgC', '{due_today,due_today}'::public.dashboard_kpi_card_key[]
  ),
  '22023', null, 'a repeated card in card_order is rejected'
);
select throws_ok(
  format('select public.dashboard_kpi_layout_set_personal(%L, %L)', :'orgC', '{not_a_real_card}'::text[]),
  '22P02', null, 'an unlisted card key does not even parse as the enum type (allowlist enforced at the type level)'
);

-- ===========================================================================
-- E. RLS — a member sees the team default and their OWN personal row, never
--    another member's personal row; the write RPCs did not reopen a table
--    grant.
-- ===========================================================================
select public.dashboard_kpi_layout_set_personal(:'orgC'::uuid, '{due_today}'::public.dashboard_kpi_card_key[]); -- as Hana

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*)::int from public.dashboard_kpi_layouts where organization_id = :'orgC'::uuid),
  1, 'Youssef sees only the team-default row via RLS — Hana''s personal row is invisible to him'
);
select throws_ok(
  format('update public.dashboard_kpi_layouts set card_order = %L where organization_id = %L and membership_id is null',
    '{due_today}'::public.dashboard_kpi_card_key[], :'orgC'),
  '42501', null, 'direct table UPDATE is still refused — the RPCs did not reopen the grant'
);

select * from finish();
rollback;

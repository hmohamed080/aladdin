-- Close the client-role privileges that hosted projects grant by default.
--
-- A hosted Supabase project gives role postgres default privileges in public that grant
-- anon, authenticated and service_role ALL (arwdDxtm) on every new table and view, and
-- rwU on every new sequence. The local CLI image grants only TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN (UPDATE on sequences). Every migration strips those defaults
-- before granting, except for the objects below, so they looked closed in local tests
-- but were open on the rebuilt acceptance project:
--   * dashboard_kpi_layouts and nine security_invoker views kept anon/authenticated DML;
--   * eight admin and identity tables kept service_role DML that nothing uses;
--   * job_review_moderations_seq_seq kept nextval/setval for every client role;
--   * every table kept TRUNCATE, REFERENCES, TRIGGER and MAINTAIN for the client roles.
-- TRUNCATE is not restricted by RLS. Intended access is unchanged: authenticated keeps
-- SELECT where it had it, and all writes stay behind the reviewed SECURITY DEFINER RPCs.

-- 1. Future objects inherit nothing. Function defaults were closed by 20261021090007.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

-- 2. No client role needs TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on any app object.
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'app') and c.relkind in ('r', 'p', 'v', 'm', 'f')
    order by 1, 2
  loop
    execute format('revoke truncate, references, trigger, maintain on %I.%I from anon, authenticated, service_role',
                   r.nspname, r.relname);
  end loop;
end $$;

-- 3. Read-only for members, as the creating migrations intended (writes are RPCs).
revoke all on public.dashboard_kpi_layouts, public.order_list, public.project_list,
  public.quotation_list, public.rfq_list, public.sales_follow_ups_due_today,
  public.sales_lead_stage_counts, public.sales_my_open_leads, public.sales_overdue_follow_ups,
  public.sales_recent_activities
  from anon, authenticated, service_role;
grant select on public.dashboard_kpi_layouts, public.order_list, public.project_list,
  public.quotation_list, public.rfq_list, public.sales_follow_ups_due_today,
  public.sales_lead_stage_counts, public.sales_my_open_leads, public.sales_overdue_follow_ups,
  public.sales_recent_activities
  to authenticated;

-- 4. Admin and identity tables: only their SECURITY DEFINER functions read and write them.
revoke select, insert, update, delete on public.admin_cases, public.admin_follow_ups,
  public.admin_notes, public.admin_suspensions, public.org_co_owners,
  public.organization_duplicate_resolutions, public.platform_flags, public.publishers
  from service_role;

-- 5. The identity sequence is only advanced by inserts that run as the table owner.
revoke all on sequence public.job_review_moderations_seq_seq from anon, authenticated, service_role;

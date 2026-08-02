-- Migration: audit foundation (Phase 1 — Identity & Multi-Tenancy, Sprint 1).
--
-- Append-only, immutable record of high-value security/state-change actions
-- (02_domain_model.md §N, 03_database_design.md §12). Written server-side via the
-- service role (which bypasses RLS); ordinary users can never INSERT/UPDATE/DELETE.
-- Reads are platform-admin only for the pilot (org-visible subset is deferred).

create table public.audit_log (
  id              uuid primary key default extensions.gen_random_uuid(),
  actor_user_id   uuid references public.users (id) on delete set null,
  actor_role      public.platform_role,
  action          text not null,
  subject_type    text not null,
  subject_id      uuid,
  organization_id uuid references public.organizations (id) on delete set null,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  constraint ck_audit_action_known check (action in (
    'organization.created',
    'membership.granted',
    'membership.role_changed',
    'membership.revoked',
    'branch.created',
    'branch.assignment_changed',
    'platform_role.granted',
    'platform_role.revoked',
    'platform.override_used'
  ))
);
comment on table public.audit_log is 'Append-only audit trail. INSERT via service_role only; no UPDATE/DELETE ever. Metadata is PII-minimized. Read by platform admins (org-visible subset deferred).';

create index ix_audit_subject on public.audit_log (subject_type, subject_id);
create index ix_audit_org_created on public.audit_log (organization_id, created_at);
create index ix_audit_actor on public.audit_log (actor_user_id);

alter table public.audit_log enable row level security;

-- Read: platform admins only. No INSERT/UPDATE/DELETE policy exists, so those
-- verbs are denied to anon/authenticated; the service role bypasses RLS to write.
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (app.is_platform('administrator'));

-- Immutability guard: block UPDATE/DELETE even for a misconfigured privileged
-- role (defense-in-depth beyond "no policy"). BEFORE trigger raises on any attempt.
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only (%.% forbidden)', tg_op, tg_table_name;
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function app.forbid_mutation();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function app.forbid_mutation();

-- Grant only SELECT to authenticated (RLS narrows to admins). No write grants:
-- writes come exclusively from the service role in server/worker code.
grant select on public.audit_log to authenticated;

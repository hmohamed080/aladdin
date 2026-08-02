-- Migration: verification & account-upgrade write paths (Phase 1 — Sprint 2).
--
-- Adds the Verification entity (deferred from Sprint 1), the constrained
-- record_audit_event() writer (Sprint 1.1 H2 deferral), and the trusted account
-- upgrade workflow: self-service request -> platform review -> approve/reject ->
-- apply transition. All state changes go through security-definer RPCs that derive
-- the actor from auth.uid() (never a spoofable parameter), pin search_path, and
-- schema-qualify every reference. primary_account_type and public_profile_status
-- stay server-controlled (ADR-0007 D10/D11); this migration is the ONLY trusted
-- path that changes them. Design: ADR-0007 amendments (Sprint 2).

-- ---------------------------------------------------------------------------
-- 1. Enums (deferred from Sprint 1 — created with their feature)
-- ---------------------------------------------------------------------------
create type public.verification_subject as enum ('user', 'organization');
create type public.verification_type    as enum ('identity', 'professional', 'organization');
-- Only the spec's approved state-machine values (11_state_machines.md §2).
create type public.verification_status   as enum (
  'draft', 'submitted', 'under_review', 'approved', 'rejected', 'needs_more_info', 'expired'
);

-- ---------------------------------------------------------------------------
-- 2. verifications — request + decision record (02_domain_model.md §C)
-- ---------------------------------------------------------------------------
create table public.verifications (
  id                    uuid primary key default extensions.gen_random_uuid(),
  subject_type          public.verification_subject not null,
  user_id               uuid references public.users (id) on delete cascade,
  organization_id       uuid references public.organizations (id) on delete cascade,
  verification_type     public.verification_type not null,
  -- For a professional account-upgrade request: the target account type the
  -- approval grants. Null for a pure identity/org verification.
  requested_account_type public.account_type,
  -- Whether an approval lists the profile publicly (concept 6, reviewer-set at
  -- approval). Separate from account type and from identity verification.
  grants_public_listing boolean not null default false,
  status                public.verification_status not null default 'submitted',
  reviewer_id           uuid references public.users (id) on delete set null,
  reason                text,
  submitted_at          timestamptz not null default now(),
  decided_at            timestamptz,
  -- Set once the approved transition has been applied (idempotency guard).
  applied_at            timestamptz,
  expires_at            timestamptz,
  metadata              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- Exactly one subject reference, matching subject_type.
  constraint ck_verifications_subject check (
    (subject_type = 'user'         and user_id is not null and organization_id is null) or
    (subject_type = 'organization' and organization_id is not null and user_id is null)
  ),
  -- A requested account type is never end_consumer (cannot "upgrade" to consumer).
  constraint ck_verifications_requested_not_consumer check (
    requested_account_type is null or requested_account_type <> 'end_consumer'
  ),
  -- Reason is required on rejection / changes-requested (11_state_machines.md §2).
  constraint ck_verifications_reason_required check (
    status not in ('rejected', 'needs_more_info') or (reason is not null and length(btrim(reason)) > 0)
  ),
  constraint ck_verifications_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint ck_verifications_metadata_size check (length(metadata::text) <= 8192)
);
comment on table public.verifications is 'Request+decision record for identity/professional/organization verification. Written ONLY via the security-definer RPCs below (no direct client DML). No self-approval; reviewer is a platform role. Never deleted (audit history).';

create index ix_verifications_status on public.verifications (status);
create index ix_verifications_user on public.verifications (user_id);
create index ix_verifications_org on public.verifications (organization_id);
-- At most ONE open verification per user (prevents duplicate active requests).
create unique index uq_verifications_open_per_user
  on public.verifications (user_id)
  where subject_type = 'user' and status in ('draft','submitted','under_review','needs_more_info');

create trigger set_verifications_updated_at
  before update on public.verifications
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. verification_documents — minimal future-compatible evidence link
-- ---------------------------------------------------------------------------
-- Storage/OCR are deferred; this table only records the intended evidence so the
-- relationship exists. `storage_object_path` is a plain nullable text placeholder
-- (a real FK to a documents table + private bucket lands with the storage feature).
create table public.verification_documents (
  id                 uuid primary key default extensions.gen_random_uuid(),
  verification_id    uuid not null references public.verifications (id) on delete cascade,
  doc_type           text not null,
  storage_object_path text,
  created_at         timestamptz not null default now(),
  constraint ck_verification_doc_type check (char_length(doc_type) between 1 and 64)
);
comment on table public.verification_documents is 'Minimal evidence link for a verification. Storage upload + OCR are deferred (05_storage_design.md); path is a placeholder until the documents/bucket feature lands.';
create index ix_verification_documents_verification on public.verification_documents (verification_id);

-- ===========================================================================
-- 4. app.record_audit_event — the constrained audit writer (Sprint 1.1 H2)
--    Internal-only: execute is revoked from clients; the security-definer
--    workflow RPCs below call it while running as the owner. The actor is ALWAYS
--    derived from auth.uid() (never a parameter), so actors cannot be spoofed.
-- ===========================================================================
create or replace function app.record_audit_event(
  p_action          text,
  p_subject_type    text,
  p_subject_id      uuid,
  p_organization_id uuid,
  p_metadata        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role  public.platform_role;
  v_id    uuid;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'audit metadata must be a JSON object';
  end if;
  -- Highest platform role of the actor (null for ordinary users) — recorded, not trusted for authz.
  select g.role into v_role
  from public.platform_role_grants g
  where g.user_id = v_actor
  order by case g.role when 'administrator' then 1 when 'moderator' then 2 when 'support' then 3 end
  limit 1;

  insert into public.audit_log (actor_user_id, actor_role, action, subject_type, subject_id, organization_id, metadata)
  values (v_actor, v_role, p_action, p_subject_type, p_subject_id, p_organization_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Expand the audit action allow-list for Sprint 2 events
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted',
  'membership.activated',
  'membership.role_changed',
  'membership.suspended',
  'membership.revoked',
  'branch.created',
  'branch.assignment_changed',
  'platform_role.granted',
  'platform_role.revoked',
  'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started',
  'verification.changes_requested',
  'verification.approved',
  'verification.rejected',
  'account.type_changed',
  'profile.listed',
  'profile.hidden'
));

-- ===========================================================================
-- 6. Account-upgrade / verification workflow RPCs (public schema, RLS-gated
--    internally). Each is security definer, pinned search_path, schema-qualified.
--    Authorization is derived from auth.uid(); no spoofable user/actor params.
-- ===========================================================================

-- 6a. SELF-SERVICE: request a professional account upgrade. Creates a submitted
-- verification for the CALLER only. Never changes account type or listing.
create or replace function public.request_account_upgrade(
  p_requested_account_type public.account_type
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_current public.account_type;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_requested_account_type = 'end_consumer' then
    raise exception 'cannot upgrade to end_consumer';
  end if;
  select u.primary_account_type into v_current from public.users u where u.id = v_uid;
  if v_current is null then
    raise exception 'no identity row for caller' using errcode = '42501';
  end if;
  if v_current = p_requested_account_type then
    raise exception 'account is already of the requested type';
  end if;

  -- One open request per user (uq_verifications_open_per_user). Idempotent if the
  -- same target is re-requested; conflict on a different open target is rejected.
  insert into public.verifications
    (subject_type, user_id, verification_type, requested_account_type, status, submitted_at)
  values ('user', v_uid, 'professional', p_requested_account_type, 'submitted', now())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select v.id into v_id from public.verifications v
    where v.subject_type = 'user' and v.user_id = v_uid
      and v.status in ('draft','submitted','under_review','needs_more_info');
    if (select v.requested_account_type from public.verifications v where v.id = v_id)
         is distinct from p_requested_account_type then
      raise exception 'an open upgrade request already exists for a different account type'
        using errcode = '23505';
    end if;
    return v_id;  -- idempotent: same open request
  end if;

  perform app.record_audit_event(
    'account.upgrade_requested', 'verification', v_id, null,
    jsonb_build_object('requested_account_type', p_requested_account_type)
  );
  return v_id;
end;
$$;

-- 6b. Platform reviewer claims a submitted verification: submitted -> under_review.
create or replace function public.review_start(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status = 'under_review' then return; end if;  -- idempotent
  if v_v.status <> 'submitted' then
    raise exception 'invalid transition to under_review from %', v_v.status using errcode = '22023';
  end if;
  update public.verifications
    set status = 'under_review', reviewer_id = (select auth.uid())
    where id = p_verification_id;
  perform app.record_audit_event('verification.review_started', 'verification', p_verification_id,
    v_v.organization_id, '{}'::jsonb);
end;
$$;

-- 6c. Request changes: under_review -> needs_more_info (reason required).
create or replace function public.review_request_changes(p_verification_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required when requesting changes';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to needs_more_info from %', v_v.status using errcode = '22023';
  end if;
  update public.verifications
    set status = 'needs_more_info', reviewer_id = (select auth.uid()), reason = p_reason
    where id = p_verification_id;
  perform app.record_audit_event('verification.changes_requested', 'verification', p_verification_id,
    v_v.organization_id, '{}'::jsonb);
end;
$$;

-- 6d. Reject: under_review -> rejected (reason required). No account/listing change.
create or replace function public.review_reject(p_verification_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required when rejecting';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = (select auth.uid()) then
    raise exception 'a reviewer may not decide their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'rejected' then return; end if;  -- idempotent
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to rejected from %', v_v.status using errcode = '22023';
  end if;
  update public.verifications
    set status = 'rejected', reviewer_id = (select auth.uid()), reason = p_reason, decided_at = now()
    where id = p_verification_id;
  perform app.record_audit_event('verification.rejected', 'verification', p_verification_id,
    v_v.organization_id, '{}'::jsonb);
end;
$$;

-- 6e. Approve the decision: under_review -> approved. Records the decision and
-- whether it grants public listing; does NOT apply the transition (that is 6f,
-- kept separate so submission/approval/application never collapse into one call).
create or replace function public.review_approve(
  p_verification_id uuid,
  p_grant_public_listing boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_v public.verifications;
begin
  if not app.is_platform('support') then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = (select auth.uid()) then
    raise exception 'a reviewer may not approve their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'approved' then return; end if;  -- idempotent decision
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to approved from %', v_v.status using errcode = '22023';
  end if;
  update public.verifications
    set status = 'approved', reviewer_id = (select auth.uid()), decided_at = now(),
        grants_public_listing = coalesce(p_grant_public_listing, false)
    where id = p_verification_id;
  perform app.record_audit_event('verification.approved', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('grants_public_listing', coalesce(p_grant_public_listing, false)));
end;
$$;

-- 6f. Apply an APPROVED account upgrade exactly once (idempotent under concurrency
-- via the row lock + applied_at guard). This is the ONLY path that mutates
-- primary_account_type and, when granted, public_profile_status.
create or replace function public.apply_account_upgrade(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_v    public.verifications;
  v_from public.account_type;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'approved' then
    raise exception 'only an approved verification can be applied (status=%)', v_v.status
      using errcode = '22023';
  end if;
  if v_v.applied_at is not null then return; end if;  -- idempotent: already applied

  if v_v.requested_account_type is not null then
    select u.primary_account_type into v_from from public.users u where u.id = v_v.user_id for update;
    if v_from is distinct from v_v.requested_account_type then
      update public.users set primary_account_type = v_v.requested_account_type where id = v_v.user_id;
      perform app.record_audit_event('account.type_changed', 'user', v_v.user_id, null,
        jsonb_build_object('from', v_from, 'to', v_v.requested_account_type));
    end if;
  end if;

  if v_v.grants_public_listing then
    update public.profiles set public_profile_status = 'listed'
      where user_id = v_v.user_id and public_profile_status <> 'listed';
    perform app.record_audit_event('profile.listed', 'user', v_v.user_id, null, '{}'::jsonb);
  end if;

  update public.verifications set applied_at = now() where id = p_verification_id;
end;
$$;

-- 6g. Trusted un-list of a profile (e.g. suspension/withdrawal): listed -> hidden.
create or replace function public.set_profile_hidden(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  update public.profiles set public_profile_status = 'hidden'
    where user_id = p_user_id and public_profile_status <> 'hidden';
  if found then
    perform app.record_audit_event('profile.hidden', 'user', p_user_id, null, '{}'::jsonb);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. RLS — verifications & documents are READ-scoped; writes only via RPCs
-- ---------------------------------------------------------------------------
alter table public.verifications          enable row level security;
alter table public.verification_documents enable row level security;

-- Read: the subject user, org members with verification.read (org subject), or a
-- platform reviewer. No INSERT/UPDATE/DELETE policy exists → direct client writes
-- are denied; the security-definer RPCs (running as owner) perform all writes.
create policy verifications_select_subject on public.verifications
  for select to authenticated
  using (
    (subject_type = 'user' and user_id = (select auth.uid()))
    or (subject_type = 'organization' and app.has_capability(organization_id, 'verification.read'))
    or app.is_platform('support')
  );

create policy verification_documents_select on public.verification_documents
  for select to authenticated
  using (exists (
    select 1 from public.verifications v
    where v.id = verification_id
      and (
        (v.subject_type = 'user' and v.user_id = (select auth.uid()))
        or (v.subject_type = 'organization' and app.has_capability(v.organization_id, 'verification.read'))
        or app.is_platform('support')
      )
  ));

-- ---------------------------------------------------------------------------
-- 8. Grants (deny-by-default; strip Supabase default privileges first)
-- ---------------------------------------------------------------------------
revoke all on public.verifications, public.verification_documents
  from anon, authenticated, service_role;
grant select on public.verifications to authenticated;
grant select on public.verification_documents to authenticated;
-- service_role is the trusted maintenance path (never truncate).
grant select, insert, update on public.verifications to service_role;
grant select, insert, update, delete on public.verification_documents to service_role;

-- record_audit_event is INTERNAL: only the definer workflow functions (running as
-- owner) call it; no client role may invoke it directly (prevents forged actions).
revoke execute on function app.record_audit_event(text, text, uuid, uuid, jsonb) from public;

-- Self-service submission endpoint: authenticated may request their own upgrade.
revoke execute on function public.request_account_upgrade(public.account_type) from public;
grant execute on function public.request_account_upgrade(public.account_type) to authenticated;

-- Privileged workflow RPCs: callable by authenticated, but each rejects callers
-- lacking platform authority internally (auth.uid()-derived; no spoofable params).
-- They are invoked from trusted server actions carrying the reviewer's own JWT.
revoke execute on function public.review_start(uuid) from public;
revoke execute on function public.review_request_changes(uuid, text) from public;
revoke execute on function public.review_reject(uuid, text) from public;
revoke execute on function public.review_approve(uuid, boolean) from public;
revoke execute on function public.apply_account_upgrade(uuid) from public;
revoke execute on function public.set_profile_hidden(uuid) from public;
grant execute on function public.review_start(uuid) to authenticated;
grant execute on function public.review_request_changes(uuid, text) to authenticated;
grant execute on function public.review_reject(uuid, text) to authenticated;
grant execute on function public.review_approve(uuid, boolean) to authenticated;
grant execute on function public.apply_account_upgrade(uuid) to authenticated;
grant execute on function public.set_profile_hidden(uuid) to authenticated;

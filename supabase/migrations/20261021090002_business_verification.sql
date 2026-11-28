-- ===========================================================================
-- Business verification: legal/company evidence -> the Verified badge.
--
-- WHY
--   Until now the organization APPLICATION (verification_type 'organization') did two things at once: it
--   activated the business (status 'active', commercial authority) and set organizations.is_verified, which
--   every surface renders as the Verified badge. No document was ever collected, so the badge meant "an
--   Admin let this business in", not "an Admin checked its legal papers".
--
-- WHAT THIS DOES (reusing the one review system - no second queue)
--   1. Activation and verification are separate facts:
--        organizations.is_verified / status   stay the ACTIVATION trust flags. Their meaning and every gate
--                                             built on them (seller readiness, showroom activation, jobs,
--                                             contact visibility, public directory listing) are unchanged.
--        organizations.business_verified_at   NEW: set ONLY by an approved business verification. Every
--                                             user-facing "verified" OUTPUT below now reads it.
--   2. verification_type 'business' (20261021090001): an ACTIVE organization's org.manage holder submits it
--      with at least one document; one open request per organization; history is kept forever.
--   3. Documents live in a PRIVATE bucket, keyed <org>/<uuid>.<ext>. Only the organization's org.manage
--      holders and Admin verification reviewers can read them; nobody can overwrite them; a document is
--      immutable once it was part of a submission (evidence history).
--   4. Admin authority (decided by the product owner, 2026-10-17):
--        organizations.verify   start a review, request more information (Moderator by default)
--        verification.approve   NEW permission: approve or reject, reason mandatory. Super Admin and
--                               Administrator hold it (locked); any other role only by explicit delegation.
--      verification.approve decides ONLY business verification. Approving an organization APPLICATION
--      (activation) keeps its own Administrator gate (20261015090052) and is never granted by it.
--   5. The generic review_* RPCs refuse a business request, so the only path to the badge is the
--      business_verification_* RPCs below (mandatory reasons, own-organization guard, audit, notifications).
--   6. No backfill (product decision B, 2026-10-18): every existing organization starts WITHOUT the badge,
--      whatever its is_verified, until its documents are reviewed and approved. Activation, access, seller
--      permissions and every gate keep reading is_verified/status, so live businesses keep operating.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Permission: verification.approve (delegable; locked on the two top system roles)
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('verification.approve', 'verification', 'approve',
   'Approve or reject business verification requests and grant the Verified badge (Administrator by default; delegable). Does not approve organization applications.', 23)
on conflict (key) do nothing;

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'verification.approve', true
  from public.admin_roles r
 where r.key in ('super_admin', 'administrator')
on conflict (role_id, permission_key) do nothing;

-- Organization ACTIVATION (the application review, app.org_review_requires_administrator) is untouched: it stays
-- Administrator-tier and is NOT granted by verification.approve (product decision B, 2026-10-18).

-- The generic review engine never decides a business request (its own RPCs below enforce the rules).
create or replace function app.can_review_verification(p_verification_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select v.verification_type from public.verifications v where v.id = p_verification_id) = 'business' then false
    else case (select v.subject_type from public.verifications v where v.id = p_verification_id)
      when 'organization' then app.has_admin_permission('organizations.verify')
      when 'user'         then app.has_admin_permission('users.verify')
      else app.has_admin_permission('users.verify') or app.has_admin_permission('organizations.verify')
    end
  end;
$$;
revoke all on function app.can_review_verification(uuid) from public, anon, service_role;
grant execute on function app.can_review_verification(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Audit vocabulary (appended to whatever list is current, never removing one - 20261015090050 pattern)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_missing text[];
  v_add text[] := array[
    'business_verification.document_added', 'business_verification.document_removed',
    'business_verification.submitted', 'business_verification.review_started',
    'business_verification.info_requested', 'business_verification.approved',
    'business_verification.rejected'];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'ck_audit_action_known' and c.conrelid = 'public.audit_log'::regclass;
  if v_def is null or v_def !~ '\]\)\)\)( NOT VALID)?$' then
    raise exception 'ck_audit_action_known has an unexpected shape: %', coalesce(v_def, '<missing>');
  end if;
  select coalesce(array_agg(a order by a), '{}') into v_missing
    from unnest(v_add) a where position('''' || a || '''::text' in v_def) = 0;
  if cardinality(v_missing) > 0 then
    alter table public.audit_log drop constraint ck_audit_action_known;
    execute 'alter table public.audit_log add constraint ck_audit_action_known '
      || regexp_replace(v_def, '\]\)\)\)( NOT VALID)?$',
           (select ', ' || string_agg('''' || a || '''::text', ', ') || '])))' from unnest(v_missing) a) || ' NOT VALID');
  end if;
end $$;
alter table public.audit_log validate constraint ck_audit_action_known;

-- ---------------------------------------------------------------------------
-- 3. The badge source on the organization (server-written only: no client grant reaches it)
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column business_verified_at timestamptz,
  add column business_verification_id uuid references public.verifications (id);
comment on column public.organizations.business_verified_at is
  'When an Admin approved this organization''s BUSINESS verification (legal documents). The ONLY source of the user-facing Verified badge. Distinct from is_verified/status, which record activation. Written only by business_verification_approve.';
comment on column public.organizations.business_verification_id is
  'The approved business verification behind business_verified_at.';
alter table public.organizations add constraint ck_organizations_business_verified_pair
  check ((business_verified_at is null) = (business_verification_id is null)) not valid;
alter table public.organizations validate constraint ck_organizations_business_verified_pair;

-- ---------------------------------------------------------------------------
-- 4. The request record: a verifications row of type 'business'
-- ---------------------------------------------------------------------------
alter table public.verifications drop constraint ck_verifications_type_matches_subject;
alter table public.verifications add constraint ck_verifications_type_matches_subject check (
     ((verification_type = 'professional' and subject_type = 'user' and user_id is not null
        and requested_account_type is not null))
  or ((verification_type = 'identity' and subject_type = 'user' and user_id is not null
        and requested_account_type is null))
  or ((verification_type = 'organization' and subject_type = 'organization' and organization_id is not null
        and requested_account_type is null))
  or ((verification_type = 'professional' and subject_type = 'user' and user_id is not null
        and requested_account_type is null and metadata ? 'legacy_requested_business_type'))
  or ((verification_type in ('organization_identity', 'co_owner', 'branch_location', 'business')
        and subject_type = 'organization' and organization_id is not null
        and requested_account_type is null))
  or ((verification_type = 'independent_publisher' and subject_type = 'user' and user_id is not null
        and requested_account_type in ('contractor', 'engineer')))
);

create unique index uq_verifications_open_business on public.verifications (organization_id)
  where verification_type = 'business'
    and status in ('draft', 'submitted', 'under_review', 'needs_more_info');

-- One row per (re)submission round: who sent it, when, and the applicant's note. The verification row's
-- submitted_at stays the FIRST submission (immutable); the queue orders by the latest round.
create table public.business_verification_submissions (
  id              uuid primary key default extensions.gen_random_uuid(),
  verification_id uuid not null references public.verifications (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  round           smallint not null,
  note            text,
  submitted_by    uuid not null references public.users (id),
  submitted_at    timestamptz not null default now(),
  constraint uq_bv_submissions_round unique (verification_id, round),
  constraint ck_bv_submissions_round check (round between 1 and 50),
  constraint ck_bv_submissions_note check (note is null or char_length(note) between 1 and 2000)
);
comment on table public.business_verification_submissions is 'Business verification: one row per submission round (first submit and every resubmission after "more information requested"). Append-only; written only by business_verification_submit.';
create index ix_bv_submissions_org on public.business_verification_submissions (organization_id, submitted_at desc);

create table public.business_verification_documents (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- NULL while the document is a draft attachment; set (forever) when a submission includes it.
  submission_id   uuid references public.business_verification_submissions (id) on delete cascade,
  doc_type        text not null,
  object_key      text not null,
  content_type    text not null,
  size_bytes      integer not null,
  file_name       text not null,
  state           text not null default 'pending',
  created_by      uuid not null references public.users (id),
  created_at      timestamptz not null default now(),
  constraint uq_bv_documents_key unique (object_key),
  constraint ck_bv_documents_type check (doc_type in
    ('commercial_register', 'tax_card', 'national_id', 'lease_or_ownership', 'other')),
  constraint ck_bv_documents_content_type check (content_type in
    ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  constraint ck_bv_documents_size check (size_bytes between 1 and 10485760),
  constraint ck_bv_documents_name check (char_length(file_name) between 1 and 120),
  constraint ck_bv_documents_state check (state in ('pending', 'ready', 'deleted')),
  -- A submitted document is evidence: it is ready and stays ready.
  constraint ck_bv_documents_submitted_ready check (submission_id is null or state = 'ready')
);
comment on table public.business_verification_documents is 'Business verification evidence. Metadata for objects in the private business-verification-documents bucket; the authority every storage policy consults. Written only by the business_verification_document_* / submit RPCs; never readable directly by clients.';
create index ix_bv_documents_org on public.business_verification_documents (organization_id, created_at);
create index ix_bv_documents_submission on public.business_verification_documents (submission_id);

-- Submitted evidence never changes (defence in depth under the RPCs).
create or replace function app.guard_bv_document_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.submission_id is not null and row(new.*) is distinct from row(old.*) then
    raise exception 'submitted verification evidence is immutable' using errcode = '23514';
  end if;
  if row(new.organization_id, new.object_key, new.content_type, new.size_bytes, new.created_by, new.created_at)
     is distinct from row(old.organization_id, old.object_key, old.content_type, old.size_bytes, old.created_by, old.created_at) then
    raise exception 'document identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function app.guard_bv_document_update() from public, anon, authenticated, service_role;
create trigger guard_bv_document_update before update on public.business_verification_documents
  for each row execute function app.guard_bv_document_update();

alter table public.business_verification_submissions enable row level security;
alter table public.business_verification_documents enable row level security;
revoke all on public.business_verification_submissions from public, anon, authenticated, service_role;
revoke all on public.business_verification_documents from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Private storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-verification-documents', 'business-verification-documents', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Who reviews business verification evidence.
create or replace function app.is_business_verification_reviewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_admin_permission('organizations.verify') or app.has_admin_permission('verification.approve');
$$;
revoke all on function app.is_business_verification_reviewer() from public, anon, service_role;
grant execute on function app.is_business_verification_reviewer() to authenticated;

create or replace function app.can_upload_bv_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_verification_documents d
                  where d.object_key = p_key and d.state = 'pending' and d.submission_id is null
                    and d.created_by = (select auth.uid())
                    and d.created_at > now() - interval '1 hour'
                    and app.has_capability(d.organization_id, 'org.manage'));
$$;
create or replace function app.can_read_bv_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_verification_documents d
                  where d.object_key = p_key and d.state <> 'deleted'
                    and (app.has_capability(d.organization_id, 'org.manage')
                         or (d.state = 'ready' and app.is_business_verification_reviewer())));
$$;
create or replace function app.can_delete_bv_object(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.business_verification_documents d
                  where d.object_key = p_key and d.submission_id is null
                    and app.has_capability(d.organization_id, 'org.manage'));
$$;
revoke execute on function app.can_upload_bv_object(text), app.can_read_bv_object(text), app.can_delete_bv_object(text)
  from public, anon, service_role;
grant execute on function app.can_upload_bv_object(text), app.can_read_bv_object(text), app.can_delete_bv_object(text)
  to authenticated;

create policy bv_documents_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'business-verification-documents' and app.can_upload_bv_object(name));
create policy bv_documents_select_authorized on storage.objects
  for select to authenticated
  using (bucket_id = 'business-verification-documents' and app.can_read_bv_object(name));
create policy bv_documents_delete_unsubmitted on storage.objects
  for delete to authenticated
  using (bucket_id = 'business-verification-documents' and app.can_delete_bv_object(name));
-- No UPDATE policy: an uploaded object can never be overwritten (upsert is refused).

-- ---------------------------------------------------------------------------
-- 6. Owner side
-- ---------------------------------------------------------------------------
create or replace function app.bv_require_manager(p_org_id uuid)
returns public.organizations
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org public.organizations;
begin
  perform app.require_verified_caller();
  select * into v_org from public.organizations where id = p_org_id and deleted_at is null;
  if not found or not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'organization not found' using errcode = '42501';
  end if;
  return v_org;
end;
$$;
revoke all on function app.bv_require_manager(uuid) from public, anon, authenticated, service_role;

-- Reserve an upload slot; the client then uploads the bytes to the returned key with its own session.
create or replace function public.business_verification_document_request_upload(
  p_org_id       uuid,
  p_doc_type     text,
  p_content_type text,
  p_size_bytes   integer,
  p_file_name    text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  public.organizations := app.bv_require_manager(p_org_id);
  v_ext  text := case p_content_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
                                     when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  -- Display name only (never part of the key): strip path separators and control characters.
  v_name text := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[\\/[:cntrl:]]+', ' ', 'g')), 120);
  v_key  text;
begin
  if v_org.status not in ('active', 'pending_verification') then
    raise exception 'this organization cannot add verification documents' using errcode = '22023';
  end if;
  if v_ext is null then raise exception 'unsupported content type' using errcode = '22023'; end if;
  if p_doc_type is null or p_doc_type not in ('commercial_register', 'tax_card', 'national_id', 'lease_or_ownership', 'other') then
    raise exception 'unknown document type' using errcode = '22023';
  end if;
  if p_size_bytes is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'a document must be at most 10 MB' using errcode = '22023';
  end if;
  if v_name = '' then v_name := 'document.' || v_ext; end if;

  perform pg_advisory_xact_lock(hashtextextended('bv-docs:' || p_org_id::text, 0));
  -- Abandoned reservations expire.
  update public.business_verification_documents set state = 'deleted'
   where organization_id = p_org_id and state = 'pending' and created_at < now() - interval '1 hour';
  if (select count(*) from public.business_verification_documents
       where organization_id = p_org_id and submission_id is null and state <> 'deleted') >= 10 then
    raise exception 'at most 10 documents can be attached to one submission' using errcode = '23514';
  end if;

  v_key := p_org_id::text || '/' || extensions.gen_random_uuid()::text || '.' || v_ext;
  insert into public.business_verification_documents
    (organization_id, doc_type, object_key, content_type, size_bytes, file_name, created_by)
  values (p_org_id, p_doc_type, v_key, p_content_type, p_size_bytes, v_name, (select auth.uid()));
  return v_key;
end;
$$;

-- Confirm after the upload. The caller checks the object exists through its own Storage access first (the
-- product-images pattern): no app/public function reads storage.objects.
create or replace function public.business_verification_document_confirm(p_object_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_d public.business_verification_documents;
begin
  perform app.require_verified_caller();
  select * into v_d from public.business_verification_documents
   where object_key = p_object_key and state = 'pending' and created_by = (select auth.uid())
   for update;
  if not found or not app.has_capability(v_d.organization_id, 'org.manage') then
    raise exception 'no matching pending document upload for this caller' using errcode = 'P0002';
  end if;
  update public.business_verification_documents set state = 'ready' where id = v_d.id;
  perform app.record_audit_event('business_verification.document_added', 'organization', v_d.organization_id,
    v_d.organization_id, jsonb_build_object('document_id', v_d.id, 'doc_type', v_d.doc_type));
  return v_d.id;
end;
$$;

-- Remove a draft attachment (never one that was submitted). Returns the key so the caller can delete the object.
create or replace function public.business_verification_document_remove(p_document_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_d public.business_verification_documents;
begin
  perform app.require_verified_caller();
  select * into v_d from public.business_verification_documents where id = p_document_id and state <> 'deleted' for update;
  if not found or not app.has_capability(v_d.organization_id, 'org.manage') then
    raise exception 'document not found' using errcode = 'P0002';
  end if;
  if v_d.submission_id is not null then
    raise exception 'a submitted document is kept as evidence and cannot be removed' using errcode = '22023';
  end if;
  update public.business_verification_documents set state = 'deleted' where id = v_d.id;
  perform app.record_audit_event('business_verification.document_removed', 'organization', v_d.organization_id,
    v_d.organization_id, jsonb_build_object('document_id', v_d.id, 'doc_type', v_d.doc_type));
  return v_d.object_key;
end;
$$;

-- Submit (first time, after a rejection as a NEW request, or resubmit after more information was requested).
create or replace function public.business_verification_submit(p_org_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   public.organizations := app.bv_require_manager(p_org_id);
  v_uid   uuid := (select auth.uid());
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_open  public.verifications;
  v_id    uuid;
  v_round smallint;
  v_sub   uuid;
  v_new   integer;
begin
  if v_org.status <> 'active' then
    raise exception 'only an approved organization can request business verification' using errcode = '22023';
  end if;
  if v_org.business_verified_at is not null then
    raise exception 'this organization is already verified' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then
    raise exception 'a note must be at most 2000 characters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('bv-docs:' || p_org_id::text, 0));
  select count(*) into v_new from public.business_verification_documents
   where organization_id = p_org_id and submission_id is null and state = 'ready';

  select * into v_open from public.verifications
   where organization_id = p_org_id and verification_type = 'business'
     and status in ('draft', 'submitted', 'under_review', 'needs_more_info')
   for update;

  if found then
    if v_open.status in ('submitted', 'under_review') then
      raise exception 'a verification request is already being reviewed' using errcode = '22023';
    end if;
    -- needs_more_info / draft -> submitted: the applicant must answer with a document or a note.
    if v_new = 0 and v_note is null then
      raise exception 'add a document or a note that answers the reviewer' using errcode = '22023';
    end if;
    update public.verifications set status = 'submitted', decided_at = null where id = v_open.id;
    v_id := v_open.id;
  else
    if v_new = 0 then
      raise exception 'at least one document is required' using errcode = '22023';
    end if;
    insert into public.verifications (subject_type, organization_id, verification_type, status, submitted_at)
    values ('organization', p_org_id, 'business', 'submitted', now())
    returning id into v_id;
  end if;

  select coalesce(max(round), 0) + 1 into v_round from public.business_verification_submissions where verification_id = v_id;
  insert into public.business_verification_submissions (verification_id, organization_id, round, note, submitted_by)
  values (v_id, p_org_id, v_round, v_note, v_uid)
  returning id into v_sub;
  update public.business_verification_documents set submission_id = v_sub
   where organization_id = p_org_id and submission_id is null and state = 'ready';

  perform app.record_audit_event('business_verification.submitted', 'verification', v_id, p_org_id,
    jsonb_build_object('round', v_round, 'documents', v_new, 'has_note', v_note is not null));
  return v_id;
end;
$$;

create or replace function app.bv_status_label(p_status public.verification_status)
returns text language sql immutable set search_path = '' as $$
  select case p_status
    when 'submitted' then 'pending' when 'draft' then 'pending'
    when 'under_review' then 'under_review' when 'needs_more_info' then 'needs_info'
    when 'approved' then 'verified' when 'rejected' then 'rejected' else p_status::text end;
$$;
revoke all on function app.bv_status_label(public.verification_status) from public, anon, service_role;
grant execute on function app.bv_status_label(public.verification_status) to authenticated;

-- Documents of one organization as JSON (internal; callers authorize first).
create or replace function app.bv_documents_json(p_org_id uuid, p_submission_id uuid, p_drafts boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'doc_type', d.doc_type, 'file_name', d.file_name, 'content_type', d.content_type,
           'size_bytes', d.size_bytes, 'object_key', d.object_key, 'created_at', d.created_at)
         order by d.created_at), '[]'::jsonb)
    from public.business_verification_documents d
   where d.organization_id = p_org_id and d.state = 'ready'
     and ((p_drafts and d.submission_id is null) or (not p_drafts and d.submission_id = p_submission_id));
$$;
revoke all on function app.bv_documents_json(uuid, uuid, boolean) from public, anon, authenticated, service_role;

-- Every business request of one organization with its rounds and documents, newest first (internal).
create or replace function app.bv_requests_json(p_org_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'status', app.bv_status_label(v.status), 'reason', v.reason,
           'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
           'last_submitted_at', (select max(s.submitted_at) from public.business_verification_submissions s where s.verification_id = v.id),
           'submissions', coalesce((select jsonb_agg(jsonb_build_object(
                'id', s.id, 'round', s.round, 'note', s.note, 'submitted_at', s.submitted_at,
                'documents', app.bv_documents_json(p_org_id, s.id, false)) order by s.round desc)
              from public.business_verification_submissions s where s.verification_id = v.id), '[]'::jsonb))
         order by v.submitted_at desc), '[]'::jsonb)
    from public.verifications v
   where v.organization_id = p_org_id and v.verification_type = 'business' and v.status <> 'cancelled';
$$;
revoke all on function app.bv_requests_json(uuid) from public, anon, authenticated, service_role;

-- The owner-facing state: badge, current request, history, draft documents, what is allowed next.
create or replace function public.my_business_verification(p_org_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org     public.organizations := app.bv_require_manager(p_org_id);
  v_current public.verifications;
  v_status  text;
begin
  select * into v_current from public.verifications
   where organization_id = p_org_id and verification_type = 'business' and status <> 'cancelled'
   order by submitted_at desc limit 1;
  v_status := case
    when v_org.business_verified_at is not null then 'verified'
    when v_current.id is null then 'none'
    else app.bv_status_label(v_current.status) end;
  return jsonb_build_object(
    'organization_status', v_org.status,
    'status', v_status,
    'verified_at', v_org.business_verified_at,
    'reason', case when v_status in ('needs_info', 'rejected') then v_current.reason end,
    'current_id', v_current.id,
    'can_upload', v_org.business_verified_at is null and v_org.status in ('active', 'pending_verification')
                  and coalesce(v_current.status::text, '') not in ('submitted', 'under_review'),
    'can_submit', v_org.business_verified_at is null and v_org.status = 'active'
                  and coalesce(v_current.status::text, '') not in ('submitted', 'under_review'),
    'is_resubmission', v_current.status = 'needs_more_info',
    'drafts', app.bv_documents_json(p_org_id, null, true),
    'requests', app.bv_requests_json(p_org_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Admin side
-- ---------------------------------------------------------------------------
-- The queue: real filters, organization details, newest round first.
create or replace function public.business_verification_queue(
  p_status   text[] default null,   -- pending / under_review / needs_info / verified / rejected
  p_org_type public.organization_type default null,
  p_search   text default null,
  p_limit    integer default 50,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q    text := nullif(btrim(coalesce(p_search, '')), '');
  v_rows jsonb;
  v_total integer;
begin
  if not (app.is_business_verification_reviewer() or app.has_admin_permission('organizations.read')) then
    raise exception 'admin permission organizations.read required' using errcode = '42501';
  end if;
  select count(*)::integer into v_total
    from public.verifications v join public.organizations o on o.id = v.organization_id
   where v.verification_type = 'business' and v.status <> 'cancelled'
     and (p_status is null or app.bv_status_label(v.status) = any (p_status))
     and (p_org_type is null or o.org_type = p_org_type)
     and (v_q is null or concat_ws(' ', o.name, o.legal_name, o.name_ar, o.name_en) ilike '%' || v_q || '%');

  select coalesce(jsonb_agg(to_jsonb(r) order by r.open desc, r.last_submitted_at desc), '[]'::jsonb) into v_rows
    from (
      select v.id, app.bv_status_label(v.status) as status,
             v.status in ('submitted', 'under_review', 'needs_more_info') as open,
             v.reviewer_id, (select pr.display_name from public.profiles pr where pr.user_id = v.reviewer_id) as reviewer_name,
             v.submitted_at, v.decided_at,
             (select max(s.submitted_at) from public.business_verification_submissions s where s.verification_id = v.id) as last_submitted_at,
             (select max(s.round) from public.business_verification_submissions s where s.verification_id = v.id) as rounds,
             (select count(*) from public.business_verification_documents d
                join public.business_verification_submissions s on s.id = d.submission_id
               where s.verification_id = v.id) as documents,
             o.id as organization_id, o.name, o.name_ar, o.name_en, o.legal_name, o.org_type, o.status as org_status
        from public.verifications v join public.organizations o on o.id = v.organization_id
       where v.verification_type = 'business' and v.status <> 'cancelled'
         and (p_status is null or app.bv_status_label(v.status) = any (p_status))
         and (p_org_type is null or o.org_type = p_org_type)
         and (v_q is null or concat_ws(' ', o.name, o.legal_name, o.name_ar, o.name_en) ilike '%' || v_q || '%')
       order by (v.status in ('submitted', 'under_review', 'needs_more_info')) desc,
                (select max(s.submitted_at) from public.business_verification_submissions s where s.verification_id = v.id) desc
       limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)
    ) r;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

-- One request with the organization, every round, every document and the earlier requests.
create or replace function public.business_verification_detail(p_verification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v   public.verifications;
  o   public.organizations;
  v_owner jsonb;
begin
  if not app.is_business_verification_reviewer() then
    raise exception 'admin permission organizations.verify required' using errcode = '42501';
  end if;
  select * into v from public.verifications where id = p_verification_id and verification_type = 'business';
  if not found then raise exception 'verification not found' using errcode = 'P0002'; end if;
  select * into o from public.organizations where id = v.organization_id;
  select jsonb_build_object('id', u.id, 'display_name', pr.display_name, 'email', a.email)
    into v_owner
    from public.users u join auth.users a on a.id = u.id left join public.profiles pr on pr.user_id = u.id
   where u.id = o.created_by;
  return jsonb_build_object(
    'id', v.id, 'status', app.bv_status_label(v.status), 'reason', v.reason, 'reviewer_id', v.reviewer_id,
    'reviewer_name', (select pr.display_name from public.profiles pr where pr.user_id = v.reviewer_id),
    'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
    'is_own_organization', app.is_org_member(o.id),
    'can_review', app.has_admin_permission('organizations.verify') or app.has_admin_permission('verification.approve'),
    'can_decide', app.has_admin_permission('verification.approve'),
    'organization', jsonb_build_object(
      'id', o.id, 'name', o.name, 'name_ar', o.name_ar, 'name_en', o.name_en, 'legal_name', o.legal_name,
      'org_type', o.org_type, 'status', o.status, 'is_verified', o.is_verified,
      'business_verified_at', o.business_verified_at, 'created_at', o.created_at,
      'contact_phone', o.contact_phone, 'contact_email', o.contact_email, 'owner', v_owner),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
         'id', s.id, 'round', s.round, 'note', s.note, 'submitted_at', s.submitted_at,
         'submitted_by', (select pr.display_name from public.profiles pr where pr.user_id = s.submitted_by),
         'documents', app.bv_documents_json(o.id, s.id, false)) order by s.round desc)
       from public.business_verification_submissions s where s.verification_id = v.id), '[]'::jsonb),
    'previous', coalesce((select jsonb_agg(jsonb_build_object(
         'id', h.id, 'status', app.bv_status_label(h.status), 'reason', h.reason,
         'submitted_at', h.submitted_at, 'decided_at', h.decided_at) order by h.submitted_at desc)
       from public.verifications h
      where h.organization_id = o.id and h.verification_type = 'business' and h.id <> v.id and h.status <> 'cancelled'), '[]'::jsonb),
    'application', (select jsonb_build_object('status', a.status, 'decided_at', a.decided_at)
                      from public.verifications a
                     where a.organization_id = o.id and a.verification_type = 'organization'
                     order by a.submitted_at desc limit 1));
end;
$$;

-- Shared guard for the four decisions: lock the row, refuse a reviewer from the organization itself.
create or replace function app.bv_lock_for_review(p_verification_id uuid)
returns public.verifications
language plpgsql
security definer
set search_path = ''
as $$
declare v public.verifications;
begin
  select * into v from public.verifications
   where id = p_verification_id and verification_type = 'business' for update;
  if not found then raise exception 'verification not found' using errcode = 'P0002'; end if;
  if app.is_org_member(v.organization_id) then
    raise exception 'a reviewer may not review their own organization' using errcode = '42501';
  end if;
  return v;
end;
$$;
revoke all on function app.bv_lock_for_review(uuid) from public, anon, authenticated, service_role;

create or replace function app.bv_reason(p_reason text, p_what text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'a reason of 1 to 2000 characters is required when %', p_what using errcode = '22023';
  end if;
  return btrim(p_reason);
end;
$$;
revoke all on function app.bv_reason(text, text) from public, anon, authenticated, service_role;

create or replace function public.business_verification_start_review(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v public.verifications;
begin
  if not app.is_business_verification_reviewer() then
    raise exception 'admin permission organizations.verify required' using errcode = '42501';
  end if;
  v := app.bv_lock_for_review(p_verification_id);
  if v.status = 'under_review' and v.reviewer_id = (select auth.uid()) then return; end if;  -- idempotent
  if v.status <> 'submitted' then
    raise exception 'invalid transition to under_review from %', v.status using errcode = '22023';
  end if;
  update public.verifications set status = 'under_review', reviewer_id = (select auth.uid()) where id = v.id;
  perform app.record_audit_event('business_verification.review_started', 'verification', v.id, v.organization_id, '{}'::jsonb);
end;
$$;

create or replace function public.business_verification_request_info(p_verification_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.verifications;
  v_reason text := app.bv_reason(p_reason, 'requesting more information');
begin
  if not app.is_business_verification_reviewer() then
    raise exception 'admin permission organizations.verify required' using errcode = '42501';
  end if;
  v := app.bv_lock_for_review(p_verification_id);
  if v.status <> 'under_review' then
    raise exception 'invalid transition to needs_more_info from %', v.status using errcode = '22023';
  end if;
  -- The assigned reviewer, or an approver taking over.
  if v.reviewer_id is distinct from (select auth.uid()) and not app.has_admin_permission('verification.approve') then
    raise exception 'only the assigned reviewer may request more information' using errcode = '42501';
  end if;
  update public.verifications set status = 'needs_more_info', reason = v_reason, reviewer_id = (select auth.uid())
   where id = v.id;
  perform app.record_audit_event('business_verification.info_requested', 'verification', v.id, v.organization_id,
    jsonb_build_object('reason', v_reason));
  perform app.notify_org(v.organization_id, 'org.manage', 'verification.changes_requested', 'verification', v.id,
    '/showroom/verification', 'notifications.businessVerification.infoRequested.title',
    'notifications.businessVerification.infoRequested.body', '{}'::jsonb);
end;
$$;

-- Approve or reject: verification.approve only, from under_review (an approver may decide a submitted
-- request directly; the start is then recorded first). The reason is mandatory for both.
create or replace function app.bv_decide(p_verification_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v        public.verifications;
  v_uid    uuid := (select auth.uid());
  v_reason text := app.bv_reason(p_reason, case when p_approve then 'approving' else 'rejecting' end);
  v_org    public.organizations;
begin
  if not app.has_admin_permission('verification.approve') then
    raise exception 'admin permission verification.approve required' using errcode = '42501';
  end if;
  v := app.bv_lock_for_review(p_verification_id);
  if v.status = 'submitted' then
    update public.verifications set status = 'under_review', reviewer_id = v_uid where id = v.id;
    perform app.record_audit_event('business_verification.review_started', 'verification', v.id, v.organization_id, '{}'::jsonb);
  elsif v.status <> 'under_review' then
    raise exception 'invalid transition to % from %', case when p_approve then 'approved' else 'rejected' end, v.status
      using errcode = '22023';
  end if;

  if p_approve then
    select * into v_org from public.organizations where id = v.organization_id for update;
    if v_org.status <> 'active' or v_org.deleted_at is not null then
      raise exception 'only an active organization can be verified' using errcode = '22023';
    end if;
    update public.verifications set status = 'approved', reason = v_reason, reviewer_id = v_uid, decided_at = now()
     where id = v.id;
    update public.organizations set business_verified_at = now(), business_verification_id = v.id where id = v.organization_id;
    update public.verifications set applied_at = now() where id = v.id;
    perform app.record_audit_event('business_verification.approved', 'verification', v.id, v.organization_id,
      jsonb_build_object('reason', v_reason));
    perform app.notify_org(v.organization_id, 'org.manage', 'verification.approved', 'verification', v.id,
      '/showroom/verification', 'notifications.businessVerification.approved.title',
      'notifications.businessVerification.approved.body', '{}'::jsonb);
  else
    update public.verifications set status = 'rejected', reason = v_reason, reviewer_id = v_uid, decided_at = now()
     where id = v.id;
    perform app.record_audit_event('business_verification.rejected', 'verification', v.id, v.organization_id,
      jsonb_build_object('reason', v_reason));
    perform app.notify_org(v.organization_id, 'org.manage', 'verification.rejected', 'verification', v.id,
      '/showroom/verification', 'notifications.businessVerification.rejected.title',
      'notifications.businessVerification.rejected.body', '{}'::jsonb);
  end if;
end;
$$;
revoke all on function app.bv_decide(uuid, boolean, text) from public, anon, authenticated, service_role;

create or replace function public.business_verification_approve(p_verification_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  select app.bv_decide(p_verification_id, true, p_reason);
$$;
create or replace function public.business_verification_reject(p_verification_id uuid, p_reason text)
returns void language sql security definer set search_path = '' as $$
  select app.bv_decide(p_verification_id, false, p_reason);
$$;

-- Grants: signed-in callers only; every function re-checks its own authority.
revoke all on function
  public.business_verification_document_request_upload(uuid, text, text, integer, text),
  public.business_verification_document_confirm(text),
  public.business_verification_document_remove(uuid),
  public.business_verification_submit(uuid, text),
  public.my_business_verification(uuid),
  public.business_verification_queue(text[], public.organization_type, text, integer, integer),
  public.business_verification_detail(uuid),
  public.business_verification_start_review(uuid),
  public.business_verification_request_info(uuid, text),
  public.business_verification_approve(uuid, text),
  public.business_verification_reject(uuid, text)
  from public, anon, service_role;
grant execute on function
  public.business_verification_document_request_upload(uuid, text, text, integer, text),
  public.business_verification_document_confirm(text),
  public.business_verification_document_remove(uuid),
  public.business_verification_submit(uuid, text),
  public.my_business_verification(uuid),
  public.business_verification_queue(text[], public.organization_type, text, integer, integer),
  public.business_verification_detail(uuid),
  public.business_verification_start_review(uuid),
  public.business_verification_request_info(uuid, text),
  public.business_verification_approve(uuid, text),
  public.business_verification_reject(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Every user-facing "verified" OUTPUT reads the business verification
--    (filters and gates keep reading is_verified/status: activation semantics are unchanged).
--    Each live definition is rewritten in place; exactly one occurrence must match, or this fails.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn  regprocedure;
  v_def text;
  v_pair record;
  v_n   int;
begin
  for v_pair in
    select * from (values
      ('app._catalog_supplier_identity()',              'o.slug, o.is_verified',                  'o.slug, (o.business_verified_at is not null)'),
      ('app._organization_public_directory()',          'o.org_type, o.is_verified,',             'o.org_type, (o.business_verified_at is not null),'),
      ('app.offer_public_json(uuid)',              '''verified'', org.is_verified',          '''verified'', (org.business_verified_at is not null)'),
      ('app.response_json(uuid,boolean)', '''verified'', o.is_verified', '''verified'', (o.business_verified_at is not null)'),
      ('public.purchase_request_detail(uuid,uuid)',     '''verified'', o.is_verified',            '''verified'', (o.business_verified_at is not null)'),
      ('public.purchase_requests_discover(uuid)', 'o.name, o.is_verified,', 'o.name, (o.business_verified_at is not null),'),
      ('public.showroom_directory_search(text,integer)', 'o.org_type, o.is_verified,',            'o.org_type, (o.business_verified_at is not null),'),
      ('public.showroom_directory_search(text,integer)', 'order by o.is_verified desc',           'order by (o.business_verified_at is not null) desc'),
      ('public.my_showroom_affiliations()',             'o.org_type, o.is_verified, b.name',      'o.org_type, (o.business_verified_at is not null), b.name'),
      -- Admin keeps both facts: approval (is_verified) and the badge (business_verified_at).
      ('public.admin_organization_detail(uuid)',        '''is_verified'', o.is_verified,',        '''is_verified'', o.is_verified, ''business_verified_at'', o.business_verified_at,')
    ) t(fn, old_text, new_text)
  loop
    begin
      v_fn := v_pair.fn::regprocedure;
    exception when undefined_function or invalid_text_representation then
      raise exception 'expected function % to exist', v_pair.fn;
    end;
    v_def := pg_get_functiondef(v_fn);
    if position(v_pair.new_text in v_def) > 0 then continue; end if;   -- idempotent
    v_n := (length(v_def) - length(replace(v_def, v_pair.old_text, ''))) / length(v_pair.old_text);
    if v_n <> 1 then raise exception '%: expected exactly one "%", found %', v_fn, v_pair.old_text, v_n; end if;
    execute replace(v_def, v_pair.old_text, v_pair.new_text);
  end loop;
end $$;

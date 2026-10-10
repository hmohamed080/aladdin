-- ===========================================================================
-- Admin Core Phase 1B-B (3/4) — Admin Notes, Follow-ups and internal Cases on
-- users and organizations (docs/admin/ADMIN_USER_ORG_OPERATIONS.md §6–§8).
--
--   Admin Notes  — internal freeform context; APPEND-ONLY.
--   Follow-ups   — operational contact history; status DERIVED, never stored
--                  (Done / Overdue / Open). No reminder is delivered: the due
--                  time is stored, delivery is deferred.
--   Cases        — internal Admin report / case record. NOT the deferred
--                  public support-ticket system (PD-009). No attachments.
--
-- Every table: RLS on, no policy, no client grant — only the security-definer
-- RPCs below read or write, each requiring the parent read permission
-- (users.read / organizations.read) AND its own permission, platform-scoped.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Shared: the subject of an Admin record, checked for permission and existence.
-- ---------------------------------------------------------------------------
create or replace function app.admin_require_subject(p_subject_type text, p_subject_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_subject_type = 'user' then
    perform app.admin_require('users.read');
    if not exists (select 1 from public.users where id = p_subject_id) then
      raise exception 'user not found' using errcode = 'P0002';
    end if;
  elsif p_subject_type = 'organization' then
    perform app.admin_require('organizations.read');
    if not exists (select 1 from public.organizations where id = p_subject_id and deleted_at is null) then
      raise exception 'organization not found' using errcode = 'P0002';
    end if;
  else
    raise exception 'unsupported subject type' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function app.admin_require_subject(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Admin Notes (append-only)
-- ---------------------------------------------------------------------------
create table public.admin_notes (
  id              uuid primary key default extensions.gen_random_uuid(),
  subject_type    text not null,
  user_id         uuid references public.users(id),
  organization_id uuid references public.organizations(id),
  body            text not null,
  author_id       uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  constraint ck_admin_notes_subject check (
    (subject_type = 'user' and user_id is not null and organization_id is null)
    or (subject_type = 'organization' and organization_id is not null and user_id is null)),
  constraint ck_admin_notes_body check (char_length(btrim(body)) between 1 and 4000)
);
comment on table public.admin_notes is
  'Internal Admin Notes on a user or an organization (Admin Core 1B-B). Append-only: never edited or deleted. Read/written only through admin_notes_list / admin_note_add.';
create index ix_admin_notes_user on public.admin_notes (user_id, created_at desc) where user_id is not null;
create index ix_admin_notes_org on public.admin_notes (organization_id, created_at desc) where organization_id is not null;
alter table public.admin_notes enable row level security;
revoke all on public.admin_notes from public, anon, authenticated;

create or replace function app.admin_notes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Admin Notes are append-only' using errcode = '42501';
end;
$$;
create trigger trg_admin_notes_append_only
  before update or delete on public.admin_notes
  for each row execute function app.admin_notes_append_only();

create or replace function public.admin_note_add(p_subject_type text, p_subject_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  perform app.admin_require_subject(p_subject_type, p_subject_id);
  perform app.admin_require('notes.create');
  if char_length(v_body) not between 1 and 4000 then
    raise exception 'a note must be 1-4000 characters' using errcode = '22023';
  end if;
  insert into public.admin_notes (subject_type, user_id, organization_id, body, author_id)
  values (p_subject_type,
          case when p_subject_type = 'user' then p_subject_id end,
          case when p_subject_type = 'organization' then p_subject_id end,
          v_body, (select auth.uid()))
  returning id into v_id;
  -- The body is internal context; the audit trail records that a note exists.
  perform app.record_audit_event('admin_note.created', p_subject_type, p_subject_id,
    case when p_subject_type = 'organization' then p_subject_id end,
    jsonb_build_object('note_id', v_id, 'length', char_length(v_body)));
  return v_id;
end;
$$;
revoke execute on function public.admin_note_add(text, uuid, text) from public, anon;
grant execute on function public.admin_note_add(text, uuid, text) to authenticated;

create or replace function public.admin_notes_list(p_subject_type text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require_subject(p_subject_type, p_subject_id);
  perform app.admin_require('notes.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', n.id, 'body', n.body, 'created_at', n.created_at,
        'author', jsonb_build_object('user_id', n.author_id, 'display_name', coalesce(p.display_name, '')))
      order by n.created_at desc, n.id desc)
    from public.admin_notes n
    left join public.profiles p on p.user_id = n.author_id
    where n.subject_type = p_subject_type
      and (n.user_id = p_subject_id or n.organization_id = p_subject_id)), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_notes_list(text, uuid) from public, anon;
grant execute on function public.admin_notes_list(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Follow-ups
-- ---------------------------------------------------------------------------
create type public.admin_follow_up_type as enum ('call', 'whatsapp', 'email', 'verification_follow_up', 'other');

create table public.admin_follow_ups (
  id              uuid primary key default extensions.gen_random_uuid(),
  subject_type    text not null,
  user_id         uuid references public.users(id),
  organization_id uuid references public.organizations(id),
  action_type     public.admin_follow_up_type not null,
  outcome         text not null,
  due_at          timestamptz,
  assigned_to     uuid references public.users(id),
  logged_by       uuid not null references public.users(id),
  logged_at       timestamptz not null default now(),
  completed_by    uuid references public.users(id),
  completed_at    timestamptz,
  constraint ck_admin_follow_ups_subject check (
    (subject_type = 'user' and user_id is not null and organization_id is null)
    or (subject_type = 'organization' and organization_id is not null and user_id is null)),
  constraint ck_admin_follow_ups_outcome check (char_length(btrim(outcome)) between 1 and 2000),
  constraint ck_admin_follow_ups_completion check ((completed_at is null) = (completed_by is null))
);
comment on table public.admin_follow_ups is
  'Admin follow-ups (operational contact history) on a user or an organization. Status is derived: Done (completed_at), Overdue (due_at passed, not done), Open. due_at is stored; no reminder is delivered yet.';
create index ix_admin_follow_ups_user on public.admin_follow_ups (user_id, logged_at desc) where user_id is not null;
create index ix_admin_follow_ups_org on public.admin_follow_ups (organization_id, logged_at desc) where organization_id is not null;
create index ix_admin_follow_ups_assignee_open on public.admin_follow_ups (assigned_to, due_at) where completed_at is null;
alter table public.admin_follow_ups enable row level security;
revoke all on public.admin_follow_ups from public, anon, authenticated;

create or replace function app.admin_follow_up_status(p_completed_at timestamptz, p_due_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when p_completed_at is not null then 'done'
    when p_due_at is not null and p_due_at < now() then 'overdue'
    else 'open'
  end
$$;
revoke execute on function app.admin_follow_up_status(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.admin_follow_up_log(
  p_subject_type text,
  p_subject_id   uuid,
  p_action_type  public.admin_follow_up_type,
  p_outcome      text,
  p_due_at       timestamptz default null,
  p_assigned_to  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text := btrim(coalesce(p_outcome, ''));
  v_id      uuid;
begin
  perform app.admin_require_subject(p_subject_type, p_subject_id);
  perform app.admin_require('follow_ups.manage');
  if char_length(v_outcome) not between 1 and 2000 then
    raise exception 'an outcome of 1-2000 characters is required' using errcode = '22023';
  end if;
  if p_action_type is null then
    raise exception 'an action type is required' using errcode = '22023';
  end if;
  -- An assignee must be active Admin Staff who can act on follow-ups.
  if p_assigned_to is not null and not ('follow_ups.manage' = any (app.admin_permissions_of(p_assigned_to))) then
    raise exception 'the assignee must be Admin Staff who can manage follow-ups' using errcode = '22023';
  end if;
  insert into public.admin_follow_ups (subject_type, user_id, organization_id, action_type, outcome,
                                       due_at, assigned_to, logged_by)
  values (p_subject_type,
          case when p_subject_type = 'user' then p_subject_id end,
          case when p_subject_type = 'organization' then p_subject_id end,
          p_action_type, v_outcome, p_due_at, p_assigned_to, (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event('admin_follow_up.logged', p_subject_type, p_subject_id,
    case when p_subject_type = 'organization' then p_subject_id end,
    jsonb_build_object('follow_up_id', v_id, 'action_type', p_action_type,
                       'due_at', p_due_at, 'assigned_to', p_assigned_to));
  return v_id;
end;
$$;
revoke execute on function public.admin_follow_up_log(text, uuid, public.admin_follow_up_type, text, timestamptz, uuid) from public, anon;
grant execute on function public.admin_follow_up_log(text, uuid, public.admin_follow_up_type, text, timestamptz, uuid) to authenticated;

create or replace function public.admin_follow_up_complete(p_follow_up_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_f public.admin_follow_ups;
begin
  select * into v_f from public.admin_follow_ups where id = p_follow_up_id for update;
  if not found then
    raise exception 'follow-up not found' using errcode = 'P0002';
  end if;
  perform app.admin_require_subject(v_f.subject_type, coalesce(v_f.user_id, v_f.organization_id));
  perform app.admin_require('follow_ups.manage');
  if v_f.completed_at is not null then
    return jsonb_build_object('status', 'done', 'changed', false);
  end if;
  update public.admin_follow_ups set completed_by = (select auth.uid()), completed_at = now()
  where id = p_follow_up_id;
  perform app.record_audit_event('admin_follow_up.completed', v_f.subject_type, coalesce(v_f.user_id, v_f.organization_id),
    v_f.organization_id,
    jsonb_build_object('follow_up_id', v_f.id, 'status_before', app.admin_follow_up_status(null, v_f.due_at), 'status_after', 'done'));
  return jsonb_build_object('status', 'done', 'changed', true);
end;
$$;
revoke execute on function public.admin_follow_up_complete(uuid) from public, anon;
grant execute on function public.admin_follow_up_complete(uuid) to authenticated;

create or replace function public.admin_follow_ups_list(p_subject_type text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require_subject(p_subject_type, p_subject_id);
  perform app.admin_require('follow_ups.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', f.id, 'action_type', f.action_type, 'outcome', f.outcome,
        'logged_at', f.logged_at, 'due_at', f.due_at, 'completed_at', f.completed_at,
        'status', app.admin_follow_up_status(f.completed_at, f.due_at),
        'logged_by', jsonb_build_object('user_id', f.logged_by, 'display_name', coalesce(pl.display_name, '')),
        'assigned_to', case when f.assigned_to is null then null else
          jsonb_build_object('user_id', f.assigned_to, 'display_name', coalesce(pa.display_name, '')) end)
      order by f.logged_at desc, f.id desc)
    from public.admin_follow_ups f
    left join public.profiles pl on pl.user_id = f.logged_by
    left join public.profiles pa on pa.user_id = f.assigned_to
    where f.subject_type = p_subject_type
      and (f.user_id = p_subject_id or f.organization_id = p_subject_id)), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_follow_ups_list(text, uuid) from public, anon;
grant execute on function public.admin_follow_ups_list(text, uuid) to authenticated;

-- Staff eligible as follow-up assignees (for the assignee picker).
create or replace function public.admin_follow_up_assignees()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require('follow_ups.manage');
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'display_name', coalesce(p.display_name, ''))
      order by coalesce(p.display_name, ''), s.user_id)
    from (select distinct a.user_id from public.admin_role_assignments a where a.is_active and a.scope_type = 'platform') s
    left join public.profiles p on p.user_id = s.user_id
    where 'follow_ups.manage' = any (app.admin_permissions_of(s.user_id))), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_follow_up_assignees() from public, anon;
grant execute on function public.admin_follow_up_assignees() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Internal Report / Case
-- ---------------------------------------------------------------------------
create table public.admin_cases (
  id              uuid primary key default extensions.gen_random_uuid(),
  subject_type    text not null,
  user_id         uuid references public.users(id),
  organization_id uuid references public.organizations(id),
  title           text not null,
  contact_name    text,
  contact_phone   text,
  contact_email   text,
  details         text not null,
  created_by      uuid not null references public.users(id),
  created_at      timestamptz not null default now(),
  constraint ck_admin_cases_subject check (
    (subject_type = 'user' and user_id is not null and organization_id is null)
    or (subject_type = 'organization' and organization_id is not null and user_id is null)),
  constraint ck_admin_cases_title check (char_length(btrim(title)) between 1 and 200),
  constraint ck_admin_cases_details check (char_length(btrim(details)) between 1 and 4000),
  constraint ck_admin_cases_contact check (
    coalesce(char_length(contact_name), 0) <= 120
    and coalesce(char_length(contact_phone), 0) <= 40
    and coalesce(char_length(contact_email), 0) <= 254)
);
comment on table public.admin_cases is
  'Internal Admin report / case about a user or an organization (Admin Core 1B-B). An internal operational record — not the deferred public support-ticket system (PD-009). Attachments are deferred (need their own private bucket and Storage policies).';
create index ix_admin_cases_user on public.admin_cases (user_id, created_at desc) where user_id is not null;
create index ix_admin_cases_org on public.admin_cases (organization_id, created_at desc) where organization_id is not null;
alter table public.admin_cases enable row level security;
revoke all on public.admin_cases from public, anon, authenticated;

create or replace function public.admin_case_create(
  p_subject_type  text,
  p_subject_id    uuid,
  p_title         text,
  p_details       text,
  p_contact_name  text default null,
  p_contact_phone text default null,
  p_contact_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title   text := btrim(coalesce(p_title, ''));
  v_details text := btrim(coalesce(p_details, ''));
  v_email   text := nullif(btrim(coalesce(p_contact_email, '')), '');
  v_id      uuid;
begin
  perform app.admin_require_subject(p_subject_type, p_subject_id);
  perform app.admin_require('cases.create');
  if char_length(v_title) not between 1 and 200 then
    raise exception 'a subject of 1-200 characters is required' using errcode = '22023';
  end if;
  if char_length(v_details) not between 1 and 4000 then
    raise exception 'details of 1-4000 characters are required' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'the contact email is not valid' using errcode = '22023';
  end if;
  insert into public.admin_cases (subject_type, user_id, organization_id, title, details,
                                  contact_name, contact_phone, contact_email, created_by)
  values (p_subject_type,
          case when p_subject_type = 'user' then p_subject_id end,
          case when p_subject_type = 'organization' then p_subject_id end,
          v_title, v_details,
          nullif(btrim(coalesce(p_contact_name, '')), ''),
          nullif(btrim(coalesce(p_contact_phone, '')), ''),
          v_email, (select auth.uid()))
  returning id into v_id;
  -- Contact data and details stay in the case; the audit trail references it.
  perform app.record_audit_event('admin_case.created', p_subject_type, p_subject_id,
    case when p_subject_type = 'organization' then p_subject_id end,
    jsonb_build_object('case_id', v_id));
  return v_id;
end;
$$;
revoke execute on function public.admin_case_create(text, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.admin_case_create(text, uuid, text, text, text, text, text) to authenticated;

create or replace function public.admin_cases_list(p_subject_type text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.admin_require_subject(p_subject_type, p_subject_id);
  perform app.admin_require('cases.read');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'details', c.details,
        'contact_name', c.contact_name, 'contact_phone', c.contact_phone, 'contact_email', c.contact_email,
        'created_at', c.created_at,
        'created_by', jsonb_build_object('user_id', c.created_by, 'display_name', coalesce(p.display_name, '')))
      order by c.created_at desc, c.id desc)
    from public.admin_cases c
    left join public.profiles p on p.user_id = c.created_by
    where c.subject_type = p_subject_type
      and (c.user_id = p_subject_id or c.organization_id = p_subject_id)), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_cases_list(text, uuid) from public, anon;
grant execute on function public.admin_cases_list(text, uuid) to authenticated;
